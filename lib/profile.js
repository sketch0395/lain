import { getDb } from "@/lib/db";

// The user's "about me" profile, stored as a single JSON blob in the
// key/value `settings` table. Lain uses this to personalize replies
// (name, birthday, job, links, etc.) without needing per-message context.
const SETTINGS_KEY = "user_profile";

const FIELDS = [
  "name",
  "birthday", // YYYY-MM-DD
  "occupation",
  "location",
  "about",
  "portfolio_url",
  "linkedin_url",
  "github_url",
];

function emptyProfile() {
  return Object.fromEntries(FIELDS.map((f) => [f, ""]));
}

/** Returns the stored profile, filled in with empty strings for unset fields. */
export function getProfile() {
  const db = getDb();
  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(SETTINGS_KEY);
  if (!row) return emptyProfile();
  try {
    const parsed = JSON.parse(row.value);
    return { ...emptyProfile(), ...parsed };
  } catch {
    return emptyProfile();
  }
}

/** Merges `fields` into the stored profile and persists it. Unknown keys are ignored. */
export function saveProfile(fields) {
  const current = getProfile();
  const next = { ...current };
  for (const key of FIELDS) {
    if (Object.prototype.hasOwnProperty.call(fields, key)) {
      const v = fields[key];
      next[key] = typeof v === "string" ? v.trim() : "";
    }
  }
  const db = getDb();
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(SETTINGS_KEY, JSON.stringify(next));
  return next;
}

/**
 * Builds a system-prompt addendum describing the user, using only whatever
 * fields have been filled in. Returns "" if the profile is entirely empty.
 */
export function profilePromptAddendum() {
  const p = getProfile();
  const lines = [];
  if (p.name) lines.push(`Name: ${p.name}`);
  if (p.birthday) lines.push(`Birthday: ${p.birthday}`);
  if (p.occupation) lines.push(`Occupation: ${p.occupation}`);
  if (p.location) lines.push(`Location: ${p.location}`);
  if (p.about) lines.push(`About: ${p.about}`);
  if (p.portfolio_url) lines.push(`Portfolio: ${p.portfolio_url}`);
  if (p.linkedin_url) lines.push(`LinkedIn: ${p.linkedin_url}`);
  if (p.github_url) lines.push(`GitHub: ${p.github_url}`);
  if (lines.length === 0) return "";
  return (
    `\n\nHere's what you know about the user (use this to personalize your ` +
    `replies naturally — don't just recite it back unprompted):\n${lines.join("\n")}`
  );
}
