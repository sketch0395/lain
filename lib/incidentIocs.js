// Incident IOCs: the structured indicators (IPs, domains, URLs, file hashes,
// emails) tracked on an incident case, plus enrichment through the lookup
// services Lain already integrates (AbuseIPDB, URLhaus, VirusTotal).
//
// Lain-only (not in the shared assistant-tools submodule). Takes the SQLite
// connection as `db`, and the actual network lookups as an injected
// `lookups` object — see lib/iocs.js for the real wiring — so everything
// here is testable offline.
//
// Safety notes:
// - IOC values usually come from attacker-controlled content. They are
//   stored and displayed as data only; nothing here ever acts on them.
// - Private/reserved IPs are never sent to a third-party service.
// - A clean or empty lookup result never yields "benign": absence from a
//   reputation database is not evidence of safety, so verdicts only move
//   toward suspicious/malicious automatically. An analyst can set "benign"
//   manually, which locks the verdict against later auto-enrichment.
const { extractIocs, classifyIoc, isPrivateOrReservedIpv4 } = require("./iocExtract");
const { logEvent } = require("./incidentCases");

const VERDICTS = ["unknown", "benign", "suspicious", "malicious"];
const VERDICT_RANK = { benign: 0, unknown: 1, suspicious: 2, malicious: 3 };
const DEFAULT_ENRICH_LIMIT = 5;
const MAX_ENRICH_LIMIT = 20;
const MAX_LISTED_IN_EVENT = 10;

function touchIncident(db, incidentId) {
  db.prepare(`UPDATE incidents SET updated_at = ? WHERE id = ?`).run(Date.now(), incidentId);
}

function incidentExists(db, id) {
  return !!db.prepare(`SELECT id FROM incidents WHERE id = ?`).get(id);
}

function pickVerdict(v) {
  const verdict = String(v || "").trim().toLowerCase();
  if (!VERDICTS.includes(verdict)) throw new Error(`verdict must be one of: ${VERDICTS.join(", ")}`);
  return verdict;
}

function parseRow(row) {
  if (!row) return null;
  let enrichment = null;
  if (row.enrichment) {
    try {
      enrichment = JSON.parse(row.enrichment);
    } catch {
      enrichment = null;
    }
  }
  return { ...row, locked: !!row.locked, enrichment };
}

/**
 * Adds IOCs to an incident (idempotent per type+value; re-seeing one just
 * bumps last_seen). `items` are [{ type, value }]. Returns
 * { added, existing } arrays of rows, or null if the incident doesn't exist.
 */
function addIocs(db, incidentId, items, { source = "", author = "" } = {}) {
  if (!incidentExists(db, incidentId)) return null;
  const now = Date.now();
  const added = [];
  const existing = [];
  const insert = db.prepare(
    `INSERT INTO incident_iocs (incident_id, type, value, source, first_seen, last_seen)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (incident_id, type, value) DO NOTHING`
  );
  const bump = db.prepare(`UPDATE incident_iocs SET last_seen = ? WHERE incident_id = ? AND type = ? AND value = ?`);
  const get = db.prepare(`SELECT * FROM incident_iocs WHERE incident_id = ? AND type = ? AND value = ?`);

  for (const { type, value } of items) {
    const info = insert.run(incidentId, type, value, String(source || ""), now, now);
    if (info.changes > 0) {
      added.push(parseRow(get.get(incidentId, type, value)));
    } else {
      bump.run(now, incidentId, type, value);
      existing.push(parseRow(get.get(incidentId, type, value)));
    }
  }

  if (added.length) {
    const listed = added
      .slice(0, MAX_LISTED_IN_EVENT)
      .map((i) => `${i.type} ${i.value}`)
      .join(", ");
    const more = added.length > MAX_LISTED_IN_EVENT ? ` (+${added.length - MAX_LISTED_IN_EVENT} more)` : "";
    logEvent(db, incidentId, "ioc", `IOCs added (${added.length}): ${listed}${more}`, author);
    touchIncident(db, incidentId);
  }
  return { added, existing };
}

/** Extracts IOCs from free text and adds them to the incident. Returns the add result, or null. */
function extractAndAdd(db, incidentId, text, opts = {}) {
  return addIocs(db, incidentId, extractIocs(text), opts);
}

/** Adds one IOC by value, auto-detecting its type. Throws if it doesn't look like an IOC. */
function addIocByValue(db, incidentId, value, opts = {}) {
  const c = classifyIoc(value);
  if (!c) throw new Error("That doesn't look like an IP, domain, URL, hash, or email.");
  return addIocs(db, incidentId, [c], opts);
}

function listIocs(db, incidentId, { verdict } = {}) {
  const rows = verdict
    ? db
        .prepare(`SELECT * FROM incident_iocs WHERE incident_id = ? AND verdict = ? ORDER BY first_seen, id`)
        .all(incidentId, pickVerdict(verdict))
    : db.prepare(`SELECT * FROM incident_iocs WHERE incident_id = ? ORDER BY first_seen, id`).all(incidentId);
  return rows.map(parseRow);
}

function getIoc(db, id) {
  return parseRow(db.prepare(`SELECT * FROM incident_iocs WHERE id = ?`).get(id));
}

/** Analyst override of verdict/notes. Locks the verdict against later auto-enrichment. */
function updateIoc(db, id, { verdict, notes } = {}, author = "") {
  const existing = getIoc(db, id);
  if (!existing) return null;
  const nextVerdict = verdict !== undefined ? pickVerdict(verdict) : existing.verdict;
  const nextNotes = notes !== undefined ? String(notes || "").trim() : existing.notes;
  const locked = verdict !== undefined ? 1 : existing.locked ? 1 : 0;
  db.prepare(`UPDATE incident_iocs SET verdict = ?, notes = ?, locked = ? WHERE id = ?`).run(
    nextVerdict,
    nextNotes,
    locked,
    id
  );
  if (nextVerdict !== existing.verdict) {
    logEvent(
      db,
      existing.incident_id,
      "ioc_verdict",
      `${existing.value}: verdict set to ${nextVerdict} (was ${existing.verdict})`,
      author
    );
    touchIncident(db, existing.incident_id);
  }
  return getIoc(db, id);
}

function deleteIoc(db, id) {
  return db.prepare(`DELETE FROM incident_iocs WHERE id = ?`).run(id).changes > 0;
}

function worse(a, b) {
  return VERDICT_RANK[b.verdict] > VERDICT_RANK[a.verdict] ? b : a;
}

/** Turns one source's raw result into { verdict, confidence, summary }. */
const interpreters = {
  abuseIpdb(r) {
    const score = Number(r.abuse_confidence_score) || 0;
    const base = `AbuseIPDB: confidence ${score}/100, ${r.total_reports || 0} reports` +
      (r.is_tor ? ", Tor exit" : "");
    if (score >= 75) return { verdict: "malicious", confidence: score, summary: base };
    if (score >= 25) return { verdict: "suspicious", confidence: score, summary: base };
    return { verdict: "unknown", confidence: null, summary: `${base} (no strong signal)` };
  },
  urlhausHost(r) {
    if (!r.found) return { verdict: "unknown", confidence: null, summary: "URLhaus: no malware URLs seen on this host" };
    return {
      verdict: "malicious",
      confidence: 90,
      summary: `URLhaus: ${r.url_count ?? "some"} malware URL(s) seen on this host`,
    };
  },
  urlhausUrl(r) {
    if (!r.found) return { verdict: "unknown", confidence: null, summary: "URLhaus: URL not listed" };
    return {
      verdict: "malicious",
      confidence: 90,
      summary: `URLhaus: listed as ${r.threat || "malware distribution"} (${r.url_status || "status unknown"})`,
    };
  },
  urlhausHash(r) {
    if (!r.found) return { verdict: "unknown", confidence: null, summary: "URLhaus: payload hash not seen" };
    return {
      verdict: "malicious",
      confidence: 90,
      summary: `URLhaus: known malware payload${r.signature ? ` (${r.signature})` : ""}`,
    };
  },
  vtFile(r) {
    if (!r.found) {
      return { verdict: "unknown", confidence: null, summary: "VirusTotal: hash never submitted (not proof of safety)" };
    }
    const s = r.detection_stats || {};
    const total = s.total_engines || 0;
    const base = `VirusTotal: ${s.malicious || 0} malicious / ${s.suspicious || 0} suspicious of ${total} engines`;
    const pct = total ? Math.round((100 * (s.malicious || 0)) / total) : null;
    if ((s.malicious || 0) >= 5) return { verdict: "malicious", confidence: pct, summary: base };
    if ((s.malicious || 0) > 0 || (s.suspicious || 0) > 0) return { verdict: "suspicious", confidence: pct, summary: base };
    return { verdict: "unknown", confidence: null, summary: `${base} (no detections)` };
  },
};

/** Which injected lookups apply to which IOC type, in order. */
function plannedSources(ioc) {
  switch (ioc.type) {
    case "ip":
      return [
        ["abuseIpdb", (l) => l.abuseIpdb?.(ioc.value)],
        ["urlhausHost", (l) => l.urlhausHost?.(ioc.value)],
      ];
    case "domain":
      return [["urlhausHost", (l) => l.urlhausHost?.(ioc.value)]];
    case "url":
      return [["urlhausUrl", (l) => l.urlhausUrl?.(ioc.value)]];
    case "hash":
      return [
        ["vtFile", (l) => l.vtFile?.(ioc.value)],
        ...(ioc.value.length === 32 || ioc.value.length === 64
          ? [["urlhausHash", (l) => l.urlhausHash?.(ioc.value)]]
          : []),
      ];
    default:
      return [];
  }
}

/**
 * Enriches one IOC via the injected lookups and stores the result. Returns
 * the updated row plus { skipped } / { errors } info. Never throws on a
 * lookup failure — failures are recorded and the IOC stays re-enrichable.
 */
async function enrichIoc(db, id, lookups = {}) {
  const ioc = getIoc(db, id);
  if (!ioc) return null;

  if (ioc.type === "ip" && isPrivateOrReservedIpv4(ioc.value)) {
    // Mark as handled so it doesn't stay in the "not yet enriched" queue.
    const note = "Private/reserved IP — not sent to external services.";
    db.prepare(`UPDATE incident_iocs SET summary = ?, enriched_at = ? WHERE id = ?`).run(note, Date.now(), id);
    return { ...getIoc(db, id), skipped: note };
  }

  const sources = plannedSources(ioc).filter(([name]) => typeof lookups[name] === "function");
  if (sources.length === 0) {
    return {
      ...ioc,
      skipped:
        ioc.type === "email"
          ? "No enrichment source exists for emails."
          : `No enrichment source is configured for ${ioc.type} indicators.`,
    };
  }

  const results = {};
  const errors = {};
  let best = { verdict: "unknown", confidence: null };
  const summaries = [];
  for (const [name, run] of sources) {
    try {
      const raw = await run(lookups);
      const interpreted = interpreters[name](raw || {});
      results[name] = { ...interpreted, raw };
      summaries.push(interpreted.summary);
      best = worse(best, interpreted);
    } catch (err) {
      errors[name] = String(err.message || err);
      summaries.push(`${name} failed: ${errors[name]}`);
    }
  }

  const succeeded = Object.keys(results).length;
  if (succeeded === 0) {
    return { ...ioc, errors, skipped: "All enrichment lookups failed; try again later." };
  }

  const now = Date.now();
  const newVerdict = ioc.locked ? ioc.verdict : best.verdict;
  const newConfidence = ioc.locked ? ioc.confidence : best.confidence;
  db.prepare(
    `UPDATE incident_iocs SET verdict = ?, confidence = ?, summary = ?, enrichment = ?, enriched_at = ?, last_seen = ?
     WHERE id = ?`
  ).run(
    newVerdict,
    newConfidence,
    summaries.join(" | "),
    JSON.stringify({ results, errors }),
    now,
    now,
    id
  );

  if (!ioc.locked && VERDICT_RANK[newVerdict] >= VERDICT_RANK.suspicious && newVerdict !== ioc.verdict) {
    logEvent(db, ioc.incident_id, "ioc_enrichment", `${ioc.value} → ${newVerdict}: ${summaries.join(" | ")}`);
    touchIncident(db, ioc.incident_id);
  }
  const updated = getIoc(db, id);
  return Object.keys(errors).length ? { ...updated, errors } : updated;
}

/**
 * Enriches an incident's not-yet-enriched IOCs (sequentially, to respect
 * free-tier rate limits), up to `limit`. Pass `iocId` to enrich one specific
 * IOC even if already enriched. Returns { results, remaining }.
 */
async function enrichIncidentIocs(db, incidentId, lookups, { limit, iocId } = {}) {
  if (!incidentExists(db, incidentId)) return null;
  if (iocId) {
    const target = getIoc(db, iocId);
    if (!target || target.incident_id !== incidentId) {
      return { results: [], remaining: 0, error: "IOC not found on this incident." };
    }
    return { results: [await enrichIoc(db, iocId, lookups)], remaining: 0 };
  }
  const cap = Math.min(Math.max(Number(limit) || DEFAULT_ENRICH_LIMIT, 1), MAX_ENRICH_LIMIT);
  const pending = db
    .prepare(
      `SELECT id FROM incident_iocs WHERE incident_id = ? AND enriched_at IS NULL
       AND type != 'email' ORDER BY first_seen, id`
    )
    .all(incidentId);
  const results = [];
  let lookedUp = 0;
  let processed = 0;
  // Only IOCs that actually hit an external service count toward the cap;
  // ones skipped locally (private IPs, no source configured) are free.
  for (const { id } of pending) {
    if (lookedUp >= cap) break;
    const r = await enrichIoc(db, id, lookups);
    results.push(r);
    processed++;
    if (!r.skipped || r.errors) lookedUp++;
  }
  return { results, remaining: pending.length - processed };
}

const toolDefinitions = {
  extract_iocs: {
    name: "extract_iocs",
    description:
      "Pull indicators of compromise (IPs, domains, URLs, file hashes, " +
      "emails) out of pasted text — alert text, log lines, email headers, " +
      "a report — and record them on an incident case. Handles defanged " +
      "forms (hxxp://, example[.]com). Private IPs are ignored. This only " +
      "records them; follow up with enrich_iocs to check their " +
      "reputation. Defaults to this conversation's active incident.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "The text to extract indicators from." },
        incident_id: { type: "number", description: "Incident to add to (default: active incident)." },
      },
      required: ["text"],
    },
  },
  list_iocs: {
    name: "list_iocs",
    description:
      "List the indicators recorded on an incident with their verdicts and " +
      "enrichment summaries. Defaults to this conversation's active incident.",
    parameters: {
      type: "object",
      properties: {
        incident_id: { type: "number", description: "Incident to list (default: active incident)." },
        verdict: { type: "string", enum: VERDICTS, description: "Only IOCs with this verdict." },
      },
    },
  },
  enrich_iocs: {
    name: "enrich_iocs",
    description:
      "Check recorded indicators against the configured reputation " +
      "services (AbuseIPDB, URLhaus, VirusTotal) and store the verdicts. " +
      "By default enriches the incident's not-yet-enriched IOCs (a few at " +
      "a time, to respect rate limits — call again if 'remaining' > 0); " +
      "pass ioc_id to re-check one. Private IPs are never sent out. " +
      "Report the verdicts back honestly: 'unknown' means no signal, NOT " +
      "that the indicator is safe.",
    parameters: {
      type: "object",
      properties: {
        incident_id: { type: "number", description: "Incident to enrich (default: active incident)." },
        ioc_id: { type: "number", description: "Enrich only this IOC." },
        limit: { type: "number", description: "Max IOCs to enrich this call (default 5, max 20)." },
      },
    },
  },
  set_ioc_verdict: {
    name: "set_ioc_verdict",
    description:
      "Record the analyst's own verdict (benign/suspicious/malicious/" +
      "unknown) for an indicator, optionally with a note. This overrides " +
      "and locks out automatic enrichment verdicts. Only use when the user " +
      "states or clearly confirms the verdict.",
    parameters: {
      type: "object",
      properties: {
        ioc_id: { type: "number", description: "The IOC's id (see list_iocs)." },
        verdict: { type: "string", enum: VERDICTS },
        notes: { type: "string", description: "Why — e.g. 'our own scanner'." },
      },
      required: ["ioc_id", "verdict"],
    },
  },
};

// extract_iocs only appends data to a case and enrich_iocs/list_iocs are
// read-only lookups (same stance as check_ip_reputation), so they run
// immediately. set_ioc_verdict is an analyst override that suppresses
// future automatic verdicts, so it goes through confirm/deny.
const CONFIRM_REQUIRED_TOOLS = ["set_ioc_verdict"];

function describeToolCall(name, args = {}) {
  switch (name) {
    case "extract_iocs":
      return `extract indicators from text and add them to an incident`;
    case "list_iocs":
      return `list incident indicators`;
    case "enrich_iocs":
      return args.ioc_id ? `enrich indicator #${args.ioc_id}` : `enrich incident indicators`;
    case "set_ioc_verdict":
      return `mark indicator #${args.ioc_id} as ${args.verdict}`;
    default:
      return undefined;
  }
}

module.exports = {
  VERDICTS,
  addIocs,
  extractAndAdd,
  addIocByValue,
  listIocs,
  getIoc,
  updateIoc,
  deleteIoc,
  enrichIoc,
  enrichIncidentIocs,
  toolDefinitions,
  CONFIRM_REQUIRED_TOOLS,
  describeToolCall,
};
