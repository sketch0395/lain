// Lightweight, heuristic sentiment/tone detection on the user's raw message
// — no extra LLM call (keeps chat latency unchanged). Looks at punctuation
// density, caps ratio, sentence fragmentation, and a few keyword cues to
// guess a coarse emotional read, then returns a short system-prompt
// addendum nudging the reply's style/cadence accordingly. Deliberately
// conservative: prefers "neutral" (no nudge) over a false-positive guess.

const STRESS_WORDS =
  /\b(stressed|overwhelmed|panicking|panic|freaking out|can'?t handle|can'?t deal|so much pressure|anxious|frustrated|losing it|breaking down|dread(ing)?)\b/i;
const EXCITED_WORDS =
  /\b(yay+|awesome|amazing|so excited|can'?t wait|omg|love this|thrilled|pumped|woo+hoo)\b/i;
const TIRED_WORDS =
  /\b(tired|exhausted|drained|burnt out|burned out|sleepy|so done|no energy|running on empty)\b/i;

const TONE_META = {
  stressed: {
    emoji: "😥",
    hint: "sounding stressed — keeping replies calm & concise",
    addendum:
      "\n\nThe user's message reads as stressed, overwhelmed, or urgent " +
      "(tone/punctuation/wording). Respond calmly and concisely: get to the " +
      "point, use short steps or a short list if it's actionable, and skip " +
      "extra flourish or tangents for now — reassure without being verbose.",
  },
  excited: {
    emoji: "😄",
    hint: "sounding excited — matching the energy a bit",
    addendum:
      "\n\nThe user's message reads as excited or enthusiastic. It's fine to " +
      "match a bit of that energy and be warmer/livelier, while still being " +
      "genuinely helpful.",
  },
  low_energy: {
    emoji: "😴",
    hint: "sounding tired — keeping it light and gentle",
    addendum:
      "\n\nThe user's message reads as tired or low-energy. Keep your reply " +
      "gentle and easy to read — shorter sentences, low effort required from " +
      "them, no demands or long tangents.",
  },
  rushed: {
    emoji: "⚡",
    hint: "sounding rushed — keeping it tight and fast",
    addendum:
      "\n\nThe user's message reads as rushed or clipped (short fragmented " +
      "phrases). Keep your reply tight and to the point — skip preamble and " +
      "get straight to the answer.",
  },
};

/**
 * Analyzes a single user message and returns { label, emoji, hint, addendum }.
 * label is "neutral" (and emoji/hint/addendum are null) when no confident
 * signal is found.
 */
export function detectTone(message) {
  const trimmed = String(message || "").trim();
  if (!trimmed) return { label: "neutral", emoji: null, hint: null, addendum: "" };

  const exclam = (trimmed.match(/!/g) || []).length;
  const question = (trimmed.match(/\?/g) || []).length;
  const letters = trimmed.replace(/[^a-zA-Z]/g, "");
  const upper = trimmed.replace(/[^A-Z]/g, "");
  const capsRatio = letters.length >= 8 ? upper.length / letters.length : 0;

  const fragments = trimmed
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const avgWordsPerFragment = fragments.length
    ? fragments.reduce((sum, f) => sum + f.split(/\s+/).length, 0) / fragments.length
    : trimmed.split(/\s+/).length;

  let label = "neutral";

  if (STRESS_WORDS.test(trimmed)) {
    label = "stressed";
  } else if (EXCITED_WORDS.test(trimmed)) {
    label = "excited";
  } else if (TIRED_WORDS.test(trimmed)) {
    label = "low_energy";
  } else if ((capsRatio > 0.6 && letters.length >= 8) || exclam >= 3) {
    // Heavy caps/exclamation without an explicit positive or tired keyword —
    // treat as intensity/urgency rather than guessing which emotion it is.
    label = "stressed";
  } else if (
    fragments.length >= 3 &&
    avgWordsPerFragment <= 3 &&
    trimmed.length >= 25 &&
    question === 0
  ) {
    label = "rushed";
  }

  if (label === "neutral") return { label, emoji: null, hint: null, addendum: "" };
  const meta = TONE_META[label];
  return { label, emoji: meta.emoji, hint: meta.hint, addendum: meta.addendum };
}
