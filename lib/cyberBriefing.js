// Deep cybersecurity news briefing generator — a from-scratch, much
// heavier alternative to the plain digest in lib/briefing.js. Implements
// the two-stage workflow from the "Cybersecurity News Briefing Prompt":
// (1) RSS discovery across all configured sources, then an LLM selection/
// categorization/ranking pass over the raw candidate list; (2) per-story
// verification/enrichment, where the actual article (not just the RSS
// title/summary) is fetched and a structured technical write-up is
// generated for each selected story. Assembly of the final Markdown is
// done deterministically in code (not by the LLM) so formatting, ordering,
// and the mandatory fields are guaranteed regardless of model compliance.
//
// This module is intentionally identical between Lain and Asuna (like
// lib/tools/cyberIntel.js) since the workflow, categories, and NIST/RMF
// framing aren't personality-specific.

import { callOllama, OLLAMA_MODEL_DEEP } from "./ollama";
import { fetchAllCyberNewsRaw, getCyberBriefingSeenLinks, markCyberBriefingSeen } from "./cyberNews";
import { fetchWebPage } from "./webFetch";

// Keep the candidate list (titles/summaries only) within a comfortable
// slice of the context window for Stage 1 — a few hundred short entries
// is already far more than any RSS pull across 10 feeds in 24-72h will
// realistically produce.
const MAX_CANDIDATES = 200;
const MIN_STORIES = 15;
const MAX_STORIES = 30;
// Small batches for Stage 2 so each enrichment call (with up to 4 full
// articles' extracted text, ~12000 chars each) stays comfortably inside
// OLLAMA_NUM_CTX without needing tool schemas loaded for these isolated
// orchestration calls.
const ENRICH_BATCH_SIZE = 3;
// If verification/enrichment fails for an individual story (dead link,
// paywall, fetch timeout), don't fail the whole briefing — fall back to
// an RSS-only writeup for just that story instead.
const CATEGORIES = [
  "Threats, Active Attacks, Malware & Breaches",
  "Vulnerabilities, Exploits & Security Advisories",
  "AI Security, LLMs & Autonomous Agents",
  "Federal Cybersecurity, RMF, ATO, NIST & DISA STIGs",
  "DevSecOps, Secure Coding & Software Supply-Chain Security",
];

const STAGE1_SYSTEM_PROMPT = `You are a senior cybersecurity news editor \
selecting stories for a technical daily briefing aimed at security \
engineers, DevSecOps teams, vulnerability-management teams, and federal \
RMF/ATO stakeholders.

You will be given a numbered list of recent candidate articles (title, \
source, and a short summary/description from the RSS feed). RSS titles \
and descriptions are discovery leads only, not confirmed evidence.

Select between ${MIN_STORIES} and ${MAX_STORIES} important, \
non-duplicative stories. Deduplicate at the INCIDENT level, not just by \
exact title or URL: treat coverage as the same story when it concerns the \
same CVE or vulnerability chain, affected product and fix, threat actor \
and campaign, breach or victim event, research paper, government \
guidance, or product release. When multiple candidates cover the same \
incident, pick only the single most authoritative one (prefer vendor \
advisories, CISA/NIST/government sources, and primary research over \
secondary aggregation) and drop the rest.

Categorize each selected story into exactly one of these categories:
${CATEGORIES.map((c, i) => `${i + 1}. ${c}`).join("\n")}

Rank stories by: confirmed exploitation or victim impact, KEV/federal \
urgency, systemic blast radius, identity or control-plane compromise, \
software-supply-chain impact, relevance to federal authorization work, \
technical novelty, and practical defensive value. If fewer than \
${MIN_STORIES} candidates are genuinely worth including, select as many \
as are truly warranted rather than padding with filler or weak stories \
— do not force the minimum by including low-value items. Never exceed \
${MAX_STORIES} even if more candidates look plausible; be selective.

Respond with ONLY a JSON object of this exact shape, no other text:
{"selections": [{"index": <candidate number, integer>, "category": <one \
of the category names above, verbatim>, "rank": <integer, 1 = most \
urgent>}]}
The array must be sorted by rank ascending. Do not invent an index that \
wasn't in the candidate list.`;

const STAGE2_SYSTEM_PROMPT = `You are a senior cybersecurity analyst \
writing structured technical write-ups for a daily briefing read by \
security engineers, DevSecOps teams, and federal RMF/ATO stakeholders.

You will be given, for each of a few stories, the RSS discovery lead \
(title/source/summary) AND the extracted full text of the underlying \
article (the actual verification/primary source, when it fetched \
successfully) or a note that it could not be fetched. Treat the RSS lead \
as a discovery hint only — the extracted article text is the actual \
evidence. Trace important claims (affected/fixed versions, exploitation \
status, dates, federal deadlines) to what the article itself states. \
Clearly distinguish confirmed facts from vendor/researcher claims, \
reported allegations, and your own analysis. Do NOT infer active \
exploitation from public proof-of-concept code, scanning activity, or \
blocked attempts alone — that is "Reported" or "Analysis", not \
"Confirmed".

For each story, respond with a structured write-up. Use empty string "" \
or empty array [] for any field that is genuinely not knowable/applicable \
from the given material — never fabricate specifics (CVE IDs, version \
numbers, deadlines) that aren't actually present in the source text.

Respond with ONLY a JSON object of this exact shape, no other text:
{"stories": [{
  "index": <candidate number, integer, matching the one you were given>,
  "headline": <short punchy headline, can differ from the RSS title>,
  "summary": <2-4 sentence concise technical summary with concrete dates>,
  "status": <one of exactly: "Confirmed", "Confirmed research", \
"Reported", "Guidance", "Analysis">,
  "attack_path": <explain the attack path / data flow / technical \
mechanism, or "" if not applicable (e.g. a guidance/policy story)>,
  "why_it_matters": <why this matters to security and engineering teams>,
  "mitigations": <practical mitigations, detection guidance, and \
developer actions, as a single string with "- " bullet lines if there \
are multiple>,
  "affected_versions": <affected products/versions/configuration \
prerequisites, or "">,
  "fixed_versions": <fixed versions / patch availability, or "">,
  "iocs": <known indicators of compromise (hashes, IPs, domains), or "">,
  "federal_deadline": <KEV/BOD/federal remediation deadline if known, \
or "">,
  "nist_controls": <applicable NIST SP 800-53 control family/IDs and a \
brief note on RMF/continuous-monitoring/ATO/inherited-control/STIG \
implications; explicitly say if this is not a mandatory US federal \
baseline, or "" if not applicable>,
  "product_opportunity": <emerging tools/competitors/concrete product \
opportunities this suggests, including potential Epyon or Barbatos \
applications if genuinely relevant, or "" if none>,
  "evidence_boundary": <note when claims depend on seller advertising, \
unnamed sources, incomplete telemetry, vendor assertions, or inference; \
"" if the story is fully corroborated by primary sources>
}]}`;

function truncate(str, max) {
  if (!str) return "";
  return str.length > max ? `${str.slice(0, max)}…` : str;
}

function parseJsonLoose(text) {
  const trimmed = (text || "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Local models occasionally wrap JSON in a code fence or add stray
    // text despite format:"json" — fall back to extracting the outermost
    // {...} block.
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

/** Fetches the full article + og:image for a story, tolerating individual failures. */
async function verifyStory(candidate) {
  try {
    const page = await fetchWebPage(candidate.link);
    return {
      ok: true,
      image: page.image || null,
      articleText: truncate(page.content, 6000),
    };
  } catch (err) {
    return { ok: false, image: null, articleText: "", error: err.message };
  }
}

function formatCandidatesForPrompt(candidates) {
  return candidates
    .map(
      (c, i) =>
        `${i + 1}. [${c.source}] ${c.title}${c.published ? ` (${c.published})` : ""}\n   ${truncate(c.summary || "", 300)}`
    )
    .join("\n");
}

async function runStage1(candidates) {
  const messages = [
    { role: "system", content: STAGE1_SYSTEM_PROMPT },
    {
      role: "user",
      content: `Candidate articles:\n${formatCandidatesForPrompt(candidates)}`,
    },
  ];
  const data = await callOllama(messages, false, {
    model: OLLAMA_MODEL_DEEP,
    format: "json",
    timeoutMs: 300_000,
  });
  const parsed = parseJsonLoose(data.message?.content);
  const selections = Array.isArray(parsed?.selections) ? parsed.selections : [];
  return selections
    .filter((s) => Number.isInteger(s.index) && s.index >= 1 && s.index <= candidates.length)
    .map((s) => ({
      candidate: candidates[s.index - 1],
      index: s.index,
      category: CATEGORIES.includes(s.category) ? s.category : CATEGORIES[0],
      rank: Number.isFinite(s.rank) ? s.rank : 999,
    }))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, MAX_STORIES);
}

async function runStage2Batch(batch) {
  const verified = await Promise.all(batch.map((s) => verifyStory(s.candidate)));
  const userContent = batch
    .map((s, i) => {
      const v = verified[i];
      const articleSection = v.ok
        ? `Extracted article text:\n${v.articleText}`
        : `Article could not be fetched (${v.error}). Rely only on the RSS lead below.`;
      return (
        `Story ${s.index}:\n` +
        `RSS lead — [${s.candidate.source}] ${s.candidate.title}\n` +
        `${s.candidate.summary || ""}\n` +
        `Link: ${s.candidate.link}\n` +
        `${articleSection}`
      );
    })
    .join("\n\n---\n\n");

  const messages = [
    { role: "system", content: STAGE2_SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ];
  const data = await callOllama(messages, false, {
    model: OLLAMA_MODEL_DEEP,
    format: "json",
    timeoutMs: 300_000,
  });
  const parsed = parseJsonLoose(data.message?.content);
  const stories = Array.isArray(parsed?.stories) ? parsed.stories : [];
  const byIndex = new Map(stories.map((s) => [s.index, s]));

  return batch.map((s, i) => {
    const enriched = byIndex.get(s.index);
    const v = verified[i];
    return {
      ...s,
      image: v.image,
      write_up: enriched || {
        headline: s.candidate.title,
        summary: s.candidate.summary || "",
        status: "Reported",
        attack_path: "",
        why_it_matters: "",
        mitigations: "",
        affected_versions: "",
        fixed_versions: "",
        iocs: "",
        federal_deadline: "",
        nist_controls: "",
        product_opportunity: "",
        evidence_boundary:
          "Verification/enrichment did not complete for this story — content is RSS-lead only and unconfirmed.",
      },
    };
  });
}

function renderStory(story) {
  const w = story.write_up;
  const lines = [];
  lines.push(`### ${w.headline || story.candidate.title}`);
  if (story.image) lines.push(`![](${story.image})`);
  lines.push("");
  lines.push(`**Status:** ${w.status || "Reported"}`);
  lines.push("");
  if (w.summary) lines.push(w.summary, "");
  if (w.attack_path) lines.push(`**Attack path / mechanism:** ${w.attack_path}`, "");
  if (w.why_it_matters) lines.push(`**Why it matters:** ${w.why_it_matters}`, "");
  if (w.mitigations) lines.push(`**Mitigations & detection:** ${w.mitigations}`, "");
  if (w.affected_versions) lines.push(`**Affected:** ${w.affected_versions}`, "");
  if (w.fixed_versions) lines.push(`**Fixed in:** ${w.fixed_versions}`, "");
  if (w.iocs) lines.push(`**IOCs:** ${w.iocs}`, "");
  if (w.federal_deadline) lines.push(`**Federal deadline:** ${w.federal_deadline}`, "");
  if (w.nist_controls) lines.push(`**NIST 800-53 / RMF:** ${w.nist_controls}`, "");
  if (w.product_opportunity) lines.push(`**Product opportunity:** ${w.product_opportunity}`, "");
  if (w.evidence_boundary) lines.push(`**Evidence boundary:** ${w.evidence_boundary}`, "");
  lines.push(`**Source:** [${story.candidate.source}](${story.candidate.link})`);
  return lines.join("\n");
}

/**
 * Runs the full two-stage deep briefing workflow and returns a Markdown
 * report string, or null if there simply weren't enough fresh candidates
 * (e.g. no sources configured, or every recent story was already covered).
 */
export async function generateCyberBriefing() {
  const { items: allItems, sources } = await fetchAllCyberNewsRaw({});
  if (allItems.length === 0) return null;

  const seenLinks = getCyberBriefingSeenLinks();
  let candidates = allItems.filter((item) => !seenLinks.has(item.link));
  // If dedup against past briefings leaves too little to reach the
  // minimum story count, fall back to the full unfiltered pool rather
  // than publishing a thin briefing — better a repeated-but-updated
  // story than an artificially short one.
  if (candidates.length < MIN_STORIES) candidates = allItems;
  candidates = candidates.slice(0, MAX_CANDIDATES);
  if (candidates.length === 0) return null;

  const selections = await runStage1(candidates);
  if (selections.length === 0) return null;

  const enrichedStories = [];
  for (let i = 0; i < selections.length; i += ENRICH_BATCH_SIZE) {
    const batch = selections.slice(i, i + ENRICH_BATCH_SIZE);
    const enriched = await runStage2Batch(batch);
    enrichedStories.push(...enriched);
  }

  const topFive = enrichedStories.slice(0, 5);
  const rest = enrichedStories.slice(5);
  const byCategory = new Map();
  for (const story of rest) {
    if (!byCategory.has(story.category)) byCategory.set(story.category, []);
    byCategory.get(story.category).push(story);
  }

  const parts = [];
  parts.push(
    `# Cybersecurity Briefing — ${new Date().toISOString().slice(0, 10)}`,
    "",
    `_${enrichedStories.length} stories, verified against primary sources where available. ` +
      `Sources: ${sources.join(", ")}._`,
    ""
  );
  parts.push("## Top Priority", "");
  parts.push(...topFive.map(renderStory).map((s) => `${s}\n`));

  for (const category of CATEGORIES) {
    const stories = byCategory.get(category);
    if (!stories || stories.length === 0) continue;
    parts.push(`## ${category}`, "");
    parts.push(...stories.map(renderStory).map((s) => `${s}\n`));
  }

  markCyberBriefingSeen(enrichedStories.map((s) => s.candidate.link));

  return parts.join("\n");
}

/** True when a digest's title/note looks cyber-focused and sources are configured. */
export function looksLikeCyberDigest(title, note) {
  return /cyber|security/i.test(`${title || ""} ${note || ""}`);
}
