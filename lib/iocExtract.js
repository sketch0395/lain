// Pure IOC (indicator of compromise) extraction from free text — no I/O,
// no dependencies, so it's safe to unit test and to run on attacker-
// controlled content (logs, emails, pasted alerts). Handles common
// "defanged" forms (hxxp://, example[.]com, 1[.]2[.]3[.]4, user[@]host).
//
// Deliberately conservative: IPv6 is not extracted (timestamps and MAC
// addresses make it too false-positive-prone), and private/loopback/
// reserved IPv4 ranges are skipped since they're not meaningful external
// indicators and must never be sent to third-party lookup services.

const IOC_TYPES = ["ip", "domain", "url", "hash", "email"];

// Common file extensions that look like (and sometimes are) TLDs — a bare
// "config.json" or "run.sh" in a log line is a filename, not a domain.
const FILE_EXTENSIONS = new Set([
  "js", "json", "py", "md", "txt", "sh", "exe", "dll", "log", "conf", "cfg",
  "yml", "yaml", "xml", "csv", "pdf", "doc", "docx", "xls", "xlsx", "bat",
  "ps1", "so", "bin", "tmp", "bak", "ini", "lnk", "iso", "img", "jpg", "png",
  "gif", "svg", "css", "html", "htm", "php", "rb", "go", "rs", "c", "h", "cpp",
  "java", "class", "jar", "ts", "tsx", "jsx", "lock", "sql", "db", "pem", "key",
]);

const MAX_IOCS_PER_TEXT = 200;

function refang(text) {
  return String(text || "")
    .replace(/\bhxxp(s?)(:\/\/|\[:\]\/\/|\[:\/\/\])/gi, "http$1://")
    .replace(/\bh\*\*p(s?):\/\//gi, "http$1://")
    .replace(/\[\.\]|\(\.\)|\{\.\}|\[dot\]|\(dot\)/gi, ".")
    .replace(/\[@\]|\(at\)|\[at\]/gi, "@")
    .replace(/\[:\]/g, ":");
}

function isPrivateOrReservedIpv4(ip) {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

function isValidIpv4(s) {
  const parts = s.split(".");
  return (
    parts.length === 4 &&
    parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255 && String(Number(p)) === p)
  );
}

function isPlausibleDomain(d) {
  if (d.length > 253 || !d.includes(".")) return false;
  const labels = d.split(".");
  const tld = labels[labels.length - 1];
  if (!/^[a-z]{2,24}$/.test(tld) && !/^xn--[a-z0-9-]+$/.test(tld)) return false;
  if (FILE_EXTENSIONS.has(tld)) return false;
  return labels.every((l) => l.length > 0 && l.length <= 63 && !l.startsWith("-") && !l.endsWith("-"));
}

function cleanUrlTail(u) {
  return u.replace(/[)\]}>.,;:!?'"]+$/, "");
}

/** Classifies a single value into an IOC type, or null if it isn't one. */
function classifyIoc(raw) {
  const v = refang(String(raw || "").trim());
  if (!v) return null;
  if (/^https?:\/\/\S+$/i.test(v)) return { type: "url", value: normalizeIoc("url", v) };
  if (/^[a-f0-9]{32}$|^[a-f0-9]{40}$|^[a-f0-9]{64}$/i.test(v)) return { type: "hash", value: v.toLowerCase() };
  if (/^[^\s@]+@[^\s@]+\.[a-z]{2,24}$/i.test(v)) return { type: "email", value: v.toLowerCase() };
  if (isValidIpv4(v)) return { type: "ip", value: v };
  if (isPlausibleDomain(v.toLowerCase()) && /^[a-z0-9.-]+$/i.test(v)) {
    return { type: "domain", value: v.toLowerCase() };
  }
  return null;
}

/** Canonical form so the same indicator dedupes regardless of casing/trailing noise. */
function normalizeIoc(type, value) {
  const v = String(value).trim();
  switch (type) {
    case "url": {
      const cleaned = cleanUrlTail(v);
      try {
        const u = new URL(cleaned);
        // Hostname is case-insensitive; path/query are not.
        return `${u.protocol}//${u.host.toLowerCase()}${u.pathname === "/" && !cleaned.endsWith("/") ? "" : u.pathname}${u.search}${u.hash}`;
      } catch {
        return cleaned;
      }
    }
    case "hash":
    case "email":
    case "domain":
      return v.toLowerCase();
    default:
      return v;
  }
}

/**
 * Extracts IOCs from text. Returns [{ type, value }] deduped, in order of
 * first appearance. Private/reserved IPv4 addresses are dropped unless
 * includePrivate is set.
 */
function extractIocs(text, { includePrivate = false } = {}) {
  const src = refang(text);
  const found = [];
  const seen = new Set();
  const add = (type, value) => {
    const norm = normalizeIoc(type, value);
    const key = `${type}:${norm}`;
    if (!norm || seen.has(key) || found.length >= MAX_IOCS_PER_TEXT) return;
    seen.add(key);
    found.push({ type, value: norm });
  };

  // URLs first; remember their hosts so the bare-domain/IP pass doesn't
  // re-add them as separate indicators unless they appear elsewhere too.
  const urlHosts = new Set();
  for (const m of src.matchAll(/\bhttps?:\/\/[^\s<>"'`]+/gi)) {
    const url = cleanUrlTail(m[0]);
    add("url", url);
    try {
      urlHosts.add(new URL(url).hostname.toLowerCase());
    } catch {
      // Malformed URL — still recorded as-is above.
    }
  }

  for (const m of src.matchAll(/\b[a-f0-9]{64}\b|\b[a-f0-9]{40}\b|\b[a-f0-9]{32}\b/gi)) {
    add("hash", m[0]);
  }

  const emailDomains = new Set();
  for (const m of src.matchAll(/\b[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,24})\b/g)) {
    add("email", m[0]);
    emailDomains.add(m[1].toLowerCase());
  }

  for (const m of src.matchAll(/(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.]*\d)/g)) {
    if (!isValidIpv4(m[0])) continue;
    if (!includePrivate && isPrivateOrReservedIpv4(m[0])) continue;
    add("ip", m[0]);
  }

  for (const m of src.matchAll(/(?<![\w@./-])(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}\b/gi)) {
    const d = m[0].toLowerCase();
    if (isValidIpv4(d)) continue;
    if (!isPlausibleDomain(d)) continue;
    // Hosts that only appeared inside a URL or email are already covered.
    if (urlHosts.has(d) || emailDomains.has(d)) continue;
    add("domain", d);
  }

  return found;
}

module.exports = {
  IOC_TYPES,
  extractIocs,
  classifyIoc,
  normalizeIoc,
  isPrivateOrReservedIpv4,
  refang,
};
