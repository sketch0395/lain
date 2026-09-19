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
- The submodule has **two distinct layers that share base filenames by
  coincidence — don't confuse them:**
  - `tools-agent/shared/tools/*.js` — either the tools-agent **server's**
    own implementation (`network.js`, `forensics.js`, `diagnostics.js`,
    `omarchy.js`; consumed by `tools-agent/server.js` via
    `registerRoutes(router, opts)`), or purely-cloud-side business logic
    consumed directly by the Next.js app (`playbooks.js`, `threatIntel.js`,
    `toolCallLog.js`, `notes.js`, `webFetch.js`, `cyberNews.js`, etc.).
  - `tools-agent/shared/app-tools/*.js` — the **app-side** Ollama tool
    schema + HTTP-dispatch layer (same base names as the server-side
    files above, e.g. `network.js`, but a totally different module) that
    each host project's `lib/tools/*.js` imports directly. These need
    host-specific config (httpClient URL/token env vars, Shodan adapter,
    `getRecentToolCalls`), which is **never imported statically** inside
    `app-tools/` — it's injected via an extra `deps` argument to
    `execute()` (and sometimes `getDefinitions()`), so the module itself
    stays host-agnostic. See `app-tools/network.js` for the pattern.
  - When adding a new always-identical-between-apps `lib/tools/*.js`
    module (or extending an existing shared one), prefer moving/adding it
    to `app-tools/` with DI over leaving it duplicated per-app — but only
    if its host-specific dependency surface is small (1-3 injected
    functions). If a module would need many injected functions (it's
    mostly *wiring*, not reusable logic — e.g. `registry.js`,
    `cyberIntel.js`), leave it per-app instead; forcing DI there just
    adds indirection without reducing real duplication risk.
- Files that **must stay per-app but should stay byte-for-byte identical
  otherwise** (diff before/after any change to one, and port the same
  change to the other): `lib/tools/registry.js`, `lib/tools/cyberIntel.js`.
  Files that are per-app **and expected to differ** (don't try to
  reconcile these): `lib/tools/httpClient.js` (env var names only),
  `lib/tools/core.js`, `lib/tools/obsidian.js`, `lib/tools/systemUpdate.js`
  (Asuna has `send_email`; Obsidian access differs — filesystem vs. REST
  API; naming like `update_lain` vs `update_asuna`).
- Submodule edits: make the change in one app's `tools-agent/shared`
  checkout, `git commit && git push` from there, then sync the other app's
  submodule pointer (`git fetch origin && git checkout <sha>`) before
  committing the parent repo. Both parent repos should reference the same
  submodule commit after a shared-logic change. **Never hand-copy files
  into both apps' `tools-agent/shared` checkouts independently** — that
  creates two untracked/divergent working trees pointing at the same repo;
  always go through one commit+push, then a fetch+checkout in the other.
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

## Other established conventions

- **Prefer no-schema-change designs.** When a feature can be layered onto
  an existing field via a parsing convention (e.g. playbook sections are
  `## Section Title` Markdown headings inside the existing `content`
  column, not a new `sections` column), prefer that over an ALTER/new
  column — it avoids migration risk on live containers and keeps old rows
  valid for free (falls back to one untitled section/whatever the old
  shape was). Only add real schema changes when a parsing convention
  would be genuinely awkward or lossy.
- **Lazy schema init gotcha.** `ensureSchema()` (see `lib/db.js`) only
  runs the first time `getDb()` is called from an authenticated route —
  new tables/columns you add won't exist on an already-running container
  until that happens. This is safe (additive-only) but means a fresh
  deploy can look "not migrated yet" until first real use; don't be
  surprised, and don't add a startup migration step that changes this
  behavior without discussing it first.
- **Client bundle hygiene.** Don't import a server-only CJS tool module
  (`tools-agent/shared/tools/*.js`, `lib/tools/*.js`) into a client
  component just to reuse a couple of small pure-string/parsing helpers —
  it drags the whole module (and its `require()`-only dependencies) into
  the client bundle. Duplicate the small helper(s) inline in the client
  file instead, with a comment noting they must stay in sync with the
  server-side source of truth (see `app/playbooks/page.js`'s duplicated
  section helpers for the pattern).
- **Render-time self-heal for user-facing formatting bugs.** If a
  formatting/normalization bug affects how stored content displays (not
  just how new content is generated), fix it at render time (e.g.
  `app/MarkdownMessage.js`) in addition to/instead of only at generation
  time, so historical rows self-heal too instead of staying permanently
  broken just because they predate the fix.
- **Tool confirmation convention.** Any new tool that mutates state, or
  reads anything sensitive via the laptop tools agent, must be added to
  that category module's `CONFIRM_REQUIRED_TOOLS` set so the user gets an
  explicit Allow/Deny prompt. Pure read-only lookups (search/list/view)
  execute immediately without confirmation — keep that split when adding
  tools.
- **Keep `TOOLS.md` in sync.** It's the maintainer-facing reference table
  of every tool (name/params/implementation/endpoint). Update it whenever
  a tool is added, removed, or changes shape. Note: as of this writing
  it's already slightly stale — it describes tools as living in a single
  `lib/tools.js` file, but that file is now just a barrel re-export over
  `lib/tools/*.js` + `lib/tools/registry.js`. Fix that framing next time
  you're touching the doc for an actual tool change, rather than as a
  standalone cleanup.
