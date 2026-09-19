# Copilot instructions for this repo (Lain)

Lain is a personal AI-assistant Next.js app. It has a sibling app, **Asuna**
(`../asuna`), which shares tool logic via a git submodule at
`tools-agent/shared` (the `assistant-tools` repo). Most tool/feature work
gets implemented **identically in both apps** — see "Dual-app workflow"
below.

## System-prompt "skills" methodology (`lib/promptSkills.js`)

All tool-usage guidance text that gets appended to the system prompt lives
in `lib/promptSkills.js`, organized as named **skills** — never add a new
always-on paragraph directly in `app/api/chat/route.js` again.

Each skill is one of:
- `always: true` — cheap, broadly useful, or covers the small
  `ALWAYS_INCLUDE_TOOLS` set in `lib/tools/registry.js` that's never
  filtered out of the tool schema list either (reminders, remember_fact,
  get_news, etc.).
- `category: "<name>"` — gated on the **same** `CATEGORY_KEYWORDS` keyword
  lists each `lib/tools/*.js` category module already exports and that
  `lib/tools/registry.js`'s `selectToolDefinitions()` uses to filter tool
  *schemas*. `matchedCategories()` is exported from `registry.js`
  specifically so `promptSkills.js` can reuse it — a skill's prompt text
  and its tools' schemas must always be gated by the exact same match, or
  they'll drift out of sync (guidance describing a tool the model wasn't
  even given a schema for).
- `configured: (flags) => boolean` — gated on a runtime integration flag
  (Shodan/Obsidian/laptop tools agent) that's either fully on or fully off
  for a given deployment, independent of what the user said.

**When adding a new tool or tool category:**
1. Add the tool definition + `CATEGORY_KEYWORDS` entry in the appropriate
   `lib/tools/*.js` module (or the shared `tools-agent/shared/tools/*.js`
   module if it's shared with Asuna) as usual.
2. Add a new skill in `lib/promptSkills.js` — reuse an existing category
   key if the tool fits one, or add a new category key to both the tool
   module's `CATEGORY_KEYWORDS` and `lib/tools/registry.js`'s
   `CATEGORY_KEYWORDS` map if it doesn't.
3. Never duplicate a tool's full JSON-schema description into the skill
   text — the skill's job is *behavioral* guidance (when to call it,
   how to sequence multiple related tools, what NOT to do), not a
   restatement of parameters.
4. If the tool is a core always-available utility, add it to
   `ALWAYS_INCLUDE_TOOLS` in `registry.js` and mark its skill
   `always: true` (or fold its guidance into `CORE_SKILL`).

**Rationale (don't lose this norm doing future refactors):** the prompt
used to have one giant always-on block sent on every single request
regardless of topic — wasting tokens and diluting model attention with
instructions for tools it wasn't even given a schema for that turn. The
skills system keeps prompt guidance sized to what's actually relevant and
in sync with what's actually callable.

## Dual-app workflow (Lain + Asuna)

- Shared, generic tool *logic* (playbooks, threat intel, incident reports,
  notes, web fetch, cyber news, url provenance) lives in the
  `tools-agent/shared` submodule, checked out identically into both apps.
  App-specific wiring (`lib/tools/*.js`, `lib/promptSkills.js`,
  `app/api/chat/route.js`) stays per-app since personality/branding/env
  var names (`LAIN_*` vs `ASUNA_*`) differ.
- Submodule edits: make the change in one app's `tools-agent/shared`
  checkout, `git commit && git push` from there, then sync the other app's
  submodule pointer (`git fetch origin && git checkout <sha>`) before
  committing the parent repo. Both parent repos should reference the same
  submodule commit after a shared-logic change.
- When a feature/fix isn't purely shared logic (e.g. UI pages, prompt
  skills, per-app tool wiring), port it to the other app manually — do
  not assume file-for-file identical content; diff first, since the two
  apps have diverged in some areas (e.g. Asuna has `send_email`,
  emotional-tone detection, and Obsidian-over-REST-API that Lain doesn't).
- A git commit message containing literal backticks can trip this
  environment's shell-safety block even inside a quoted `-m` string.
  Write the message to a temp file and use `git commit -F <file>` instead.

## Testing philosophy

Never forge auth/session tokens or test against live user data. Use
`docker exec <container> node -e '...'` scripts that build an in-memory
(`:memory:`) or copied SQLite DB and `require()` the shared CJS tool
modules directly, bypassing HTTP/auth/conversations entirely. Only touch a
live container's real DB for read-only verification (e.g. confirming a
schema migration was additive and didn't touch existing rows) after
functional correctness is already proven against an isolated DB.

## Standard change workflow

For any change: implement → lint the changed files → `npm run build` →
commit (both repos, in sync if shared) → push → `./deploy.sh` → confirm
both containers are healthy and, where relevant, exercise the change
against the live app before calling it done.
