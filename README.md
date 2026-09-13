# Lain

A personal, self-hosted chatbot. It runs entirely on your local machine —
the web app (Next.js + SQLite) and the LLM (Ollama) both run locally, so
there's no remote server, no public exposure, and no HTTPS/reverse-proxy
setup required.

```
[ Browser / lain CLI ] --> [ localhost:3000, Next.js + SQLite ]
                                        |
                                        v  http://localhost:11434 (or LAN IP)
                                [ Ollama, local GPU ]
```

## Quick start (new Omarchy machine)

```bash
git clone --recurse-submodules <this repo> && cd lain
./install.sh
```

That one script installs/configures everything it can automate — Docker,
Ollama (including pulling the models and exposing it to the container),
`.env` (with a generated `AUTH_SECRET`), the optional `lain` CLI +
Hyprland keybinding, the optional tools agent, and finally builds and
starts Lain via `./deploy.sh`. It's safe to re-run any time; every step
checks whether it's already done first.

The one thing it *can't* do for you: creating a GitHub or Google OAuth
app (see [section 2](#2-authentication-setup)). The first run will create
`.env` and stop there with instructions — fill in the OAuth
credentials, then run `./install.sh` again to finish.

Non-interactive mode (skip all prompts): `./install.sh --non-interactive`.

<details>
<summary>Manual step-by-step (if you'd rather not run one big script)</summary>

1. **Prerequisites** — Omarchy ships with Docker; if missing:
   `sudo pacman -S docker docker-compose-plugin`, then
   `sudo systemctl enable --now docker` and
   `sudo usermod -aG docker $USER` (log out/in to pick up the group).
   You'll also want `ollama` installed (`sudo pacman -S ollama` or see
   [ollama.com](https://ollama.com)) and `node`/`npm` if you plan to run
   `npm run dev` instead of Docker.
2. `git clone --recurse-submodules <this repo> && cd lain`
3. Follow **1–4** below: pull the Ollama model, create a GitHub/Google
   OAuth app, fill in `.env`, then `./deploy.sh`.
4. Optional: run `./scripts/setup-omarchy-cli.sh` for the `lain` terminal
   command + Hyprland shortcut (default `SUPER + A`, override with
   `LAIN_KEYBIND` if that's already taken), and
   `./scripts/setup-tools-agent.sh` if you want Lain to access
   diagnostics/files/Omarchy theme switching.

</details>

## 1. One-time setup: Ollama

Just make sure Ollama is running locally and has the model pulled:

```bash
ollama pull gemma4:e4b
# optional larger "deep thinking" model
ollama pull gemma4:12b
```

Verify it's reachable: `curl http://localhost:11434/api/tags`. Since Lain
runs in Docker on the same machine, `OLLAMA_HOST` in `.env` should point
at your host's LAN IP (e.g. `http://10.5.1.20:11434`) rather than
`localhost`, since containers don't share the host's loopback interface.

## 2. Authentication setup

Lain is gated behind GitHub and Google OAuth sign-in, plus an allowlist —
only accounts you explicitly approve can get in, even though anyone could
technically authenticate with GitHub/Google.

### Create OAuth apps

**GitHub** (https://github.com/settings/developers → "New OAuth App"):
- Homepage URL: `http://localhost:3000`
- Authorization callback URL: `http://localhost:3000/api/auth/callback/github`
- Copy the Client ID and generate a Client Secret.

**Google** (https://console.cloud.google.com/apis/credentials → "Create OAuth client ID", type "Web application", optional):
- Authorized redirect URI: `http://localhost:3000/api/auth/callback/google`
- Copy the Client ID and Client Secret.

### How access control works

- `proxy.js` (this Next.js version's equivalent of the old `middleware.js`)
  runs on every request and redirects unauthenticated visitors to `/login`
  (or returns `401` for API calls).
- `/login` offers "Continue with GitHub" / "Continue with Google".
- After OAuth completes, `auth.js`'s `signIn` callback checks the
  authenticated user's email/username against `ALLOWED_USERS` and denies
  access to anyone not on the list.
- Sessions are JWT-based cookies, valid for 30 days.
- A "Sign out" button lives at the bottom of the sidebar.

Since Lain is local-only (`http://localhost`), there's no HTTPS/reverse
proxy requirement — `AUTH_URL` just needs to match `http://localhost:3000`
(or whatever port you run on).

## 3. Configuration

Lain runs entirely on this machine, so there's a single `.env` used for
both the Docker deployment and local dev — it's gitignored (see
in one place (not synced anywhere), so a stale or empty file can
never accidentally wipe out or overwrite it on redeploy.

The first time you run `./deploy.sh`, it will notice there's no `.env`
yet, create one from `.env.example`, and tell you to edit it:

```bash
nano .env   # or vim, etc.
```

```
OLLAMA_HOST=http://10.5.1.20:11434
OLLAMA_MODEL=gemma4:e4b
# Optional: larger "deep thinking" model, used when the chat UI toggle is on
OLLAMA_MODEL_DEEP=gemma4:12b

# Host port Lain listens on (change if the default is already taken)
LAIN_HOST_PORT=3000

# Generate with: npx auth secret
AUTH_SECRET=
AUTH_URL=http://localhost:3000

AUTH_GITHUB_ID=
AUTH_GITHUB_SECRET=

AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=

# Comma-separated allowlist: GitHub usernames and/or Google emails
ALLOWED_USERS=sketch0395

# Bearer token for the `lain` CLI (generate with: openssl rand -hex 32)
LAIN_API_TOKEN=
```

Then re-run `./deploy.sh` to pick up the new values.

## 4. Deploy locally

Requires Docker + the compose plugin, and your user in the `docker` group
(`sudo usermod -aG docker $USER`, then log out/in) so it can run without
`sudo`.

```bash
./deploy.sh
```

This runs `docker compose up -d --build` right here on your machine. Lain
will be available at `http://localhost:<LAIN_HOST_PORT>` (defaults to
`3000`).

To redeploy after making changes, just re-run `./deploy.sh`.

## 5. Local development (without Docker)

```bash
npm install
npm run dev
```

Uses the same `.env` (Next.js also picks up `.env.local` if present, for
overrides you don't want in the Docker `.env` — e.g. a separate dev-only
OAuth app). Since everything is local-only, it's fine to reuse the same
OAuth app for both `npm run dev` and the Docker deployment as long as
`AUTH_URL`/callback URLs match `http://localhost:3000`.

## How memory works

Every message is stored in a local SQLite database (Docker volume
`lain-data`, mounted at `/data/lain.db` in the container) under a
conversation. Each request to `/api/chat` reloads recent history for that
conversation and sends it to Ollama as context, so Lain remembers what
you've discussed. Conversations persist across container restarts as long
as the `lain-data` volume isn't removed.

If a chat request fails outright — network drop, phone locking/sleeping
mid-request, Ollama timing out — the error appears as its own bubble with
a **🔄 Retry** button that resends your original message (or re-executes an
Allow/Deny tool confirmation) without you needing to retype anything.

## Personality

Lain has a confident, assertive, and outgoing online persona — talkative,
bold, sassy, and aware of everything going on in the conversation (see
`PERSONALITY_PROMPT` in `app/api/chat/route.js`). Personality can be
toggled on/off per-browser from Settings (click your name in the
sidebar) → "✨ Personality: on/off"; the preference is stored in
`localStorage` and sent with each chat request, falling back to a plain
`NEUTRAL_PROMPT` when off. Tweak her voice by editing those prompts
directly, or override via env vars without touching code:

- `LAIN_SYSTEM_PROMPT` – used when personality mode is on (default: see
  `app/api/chat/route.js`)
- `LAIN_NEUTRAL_PROMPT` – used when personality mode is off

## CLI access (Omarchy / terminal)

A bearer token lets the `lain` terminal command talk to Lain's API
without going through OAuth. Since everything runs on one machine, this
is a single one-time setup.

### 1. Set a token

Add to the local `.env` (generate with `openssl rand -hex 32`):

```
LAIN_API_TOKEN=<random-hex-string>
```

Restart the container (`docker compose up -d`) to pick it up.
Leave this blank/unset to disable CLI access entirely.

### 2. Install the CLI

```
./scripts/setup-omarchy-cli.sh
```

This installs `bin/lain` to `~/.local/bin/lain`, prompts for your
`LAIN_URL`/`LAIN_API_TOKEN` and writes `~/.config/lain/config`
(`chmod 600`), and — if running on Omarchy — adds a Hyprland keybinding
(default `SUPER + A`; set `LAIN_KEYBIND` to override, e.g. `SUPER + L` if
`SUPER + A` is already taken by something else), floating window rule,
and launcher entry (see section 3). It's idempotent: safe to re-run, and
existing config is left alone unless you pass `--force`.

To set up non-interactively:

```
LAIN_URL=http://localhost:3000 LAIN_API_TOKEN=<token> LAIN_KEYBIND="SUPER + L" \
  ./scripts/setup-omarchy-cli.sh --non-interactive
```

Or install manually: copy `bin/lain` anywhere on your `PATH` and
`chmod +x` it, then create `~/.config/lain/config` (`chmod 600`) with:

```
LAIN_URL=http://localhost:3000
LAIN_API_TOKEN=<same token as in .env>
```

Usage:

```
lain "message"          # one-off message, prints the reply
lain                    # interactive REPL ('/new' new thread, '/link' web URL, 'exit' to quit)
lain --new "message"    # start a new conversation
lain --plain "message"  # ask without her personality (neutral mode)
lain --list             # list recent conversations (id + title)
lain --continue <id|name|url> "message"  # resume a conversation by id, name, or URL
lain --rename <id|name|url> "new name"   # rename a chat
```

CLI conversations share the same SQLite database as the web UI — a
conversation started from the terminal shows up in the sidebar there too,
titled from your first message. Every CLI reply also prints a
"Continue in browser" link (`http://localhost:3000/?c=<id>`) that opens
that exact conversation directly in the web UI, so you can pick up right
where you left off.

**Renaming chats:** in the web UI, double-click a chat in the sidebar (or
click the ✎ icon) to rename it inline. From the CLI, use
`lain --rename "old name" "new name"`. Renames sync instantly either way,
since both read/write the same conversation record.

The web UI works the same way in reverse: whenever a conversation is open in
the browser, its ID is reflected in the address bar as `?c=<id>`. Copy that
URL (or just the ID) and hand it to `lain --continue`, or run `lain --list`
to see recent conversations without leaving the terminal — either way the
full message history and memory carry over.

### 3. Omarchy integration (optional)

`scripts/setup-omarchy-cli.sh` handles this automatically. What it sets up:

- **Keybinding**: `SUPER + A` opens a small floating terminal running
  `lain --pick` (`~/.config/hypr/bindings.lua` + a window rule in
  `~/.config/hypr/hyprland.lua` matching `app-id = lain-cli`) — this shows
  a quick picker (fzf if installed, a numbered menu otherwise) of your most
  recently active conversations, so you can jump straight back into one
  instead of always starting fresh.
- **Launcher**: an "Lain" entry in the Omarchy menu
  (`~/.config/omarchy/extensions/omarchy-menu.jsonc`), runs the same
  command: `foot --app-id lain-cli lain --pick`.

## Tools access (diagnostics, files & Omarchy)

> Full technical reference for every tool (params, endpoints,
> implementation): [TOOLS.md](TOOLS.md).

Lain can optionally reach a small agent running on this same machine so
she can check system diagnostics, look up/read files, or check/change
your Omarchy theme when you ask her to — e.g. "can you check your
diagnostics?" or "find files with 'invoice' in the name" or "read my
package.json" or "switch to the Tokyo Night theme". This is entirely
opt-in and off by default.

**Security model:**

- **Read-only, with two narrow exceptions.** The agent runs no arbitrary
  shell commands — every action is a fixed binary invoked with a fixed or
  validated argument list. The only things that actually change anything
  are `notify-send` (reminder notifications) and `omarchy-theme-set`
  (theme switching, and only after the requested theme name is checked
  against the real installed theme list). Nothing else writes or deletes.
- **Confirmation required.** Every tool call Lain wants to make is shown
  to you first (tool + human-readable description of what it will do) and
  only runs after you click **Allow** in the web UI or answer `y` at the
  `Allow? [y/N]` prompt in the CLI. You can **Deny** any request.
  Answering "y" once approves that specific request only — she'll ask
  again next time.
- **Path-restricted.** File access is limited to `LAIN_TOOLS_ALLOWED_ROOTS`
  (defaults to your home directory) and blocked further by a hardcoded
  denylist covering SSH/GPG/AWS keys, `.env*` files, and other sensitive
  paths — even if they're nominally inside an allowed root. Omarchy status/
  theme tools don't touch the filesystem at all (they shell out to
  `hyprctl`/`omarchy-theme-list`/`omarchy-theme-set`), so this restriction
  doesn't apply to them.
- **Token-authenticated + local-only.** The agent requires a bearer token
  for every request (except its own unauthenticated `/health` check).
  Since Lain is local-only, this never needs to leave your machine.

### 1. Install the tools agent

```
./scripts/setup-tools-agent.sh
```

This installs the agent (server.js plus its `lib/` modules) to
`~/.local/share/lain/tools-agent/`, prompts
for (or accepts as env vars) a port, allowed root directories, and
generates/reuses an auth token, then registers and starts it as a
`systemd --user` service (`lain-tools-agent.service`). It prints the
`LAIN_TOOLS_URL`/`LAIN_TOOLS_TOKEN` to copy into the local `.env`.

Check it's running any time with:

```
systemctl --user status lain-tools-agent
```

### 2. Point Lain at it

Add to the local `.env` (the LAN IP is needed, not `localhost`, since the
Lain container is on a separate Docker network from the agent):

```
LAIN_TOOLS_URL=http://<this-machine-lan-ip>:8787
LAIN_TOOLS_TOKEN=<token printed by the setup script>
```

Redeploy (`./deploy.sh` or `docker compose up -d --build`).
Leave these blank/unset to disable tool access entirely — Lain will just
chat normally with no tool prompts.

The sidebar shows a 🧰 indicator when the tools agent is configured and
reachable, so you can confirm connectivity at a glance (also reported by
`/api/health` as `toolsEnabled`/`toolsReachable`).

**Firewall gotcha:** the Lain container runs on its own Docker
compose-managed network (e.g. `172.18.0.0/16`), not the default Docker
bridge (`172.17.0.0/16`) — these are different subnets. If you use `ufw`
and it's blocking the tools agent port, allow the whole private Docker
range rather than a specific `/16`:

```
sudo ufw allow from 172.16.0.0/12 to any port 8788 proto tcp
```

You can confirm what's actually being blocked with
`sudo journalctl -k | grep "UFW BLOCK"` — look at the `SRC=` address in the
log line to see which subnet the container is really using.

### Available tools

Full details (params, endpoints, implementation) are in
[TOOLS.md](TOOLS.md). In short, Lain can: check system diagnostics; find,
search, list, read, and summarize files/directories; check and switch the
Omarchy theme; and run digital-forensics-style checks (file hashing,
metadata/EXIF, string extraction, running processes, network connections,
log search, recent file activity, login history, and pcap analysis).

Two optional system packages unlock extra forensics detail: `tcpdump`
(required for `analyze_pcap`) and `perl-image-exiftool`/`exiftool` (for
EXIF in `file_metadata`). `scripts/setup-tools-agent.sh` detects if either
is missing and offers to install them via `pacman` automatically —
nothing to do manually on a fresh Omarchy install. On a non-Arch system,
or if you skip the prompt, install them yourself: `sudo pacman -S --needed
tcpdump perl-image-exiftool` (or your distro's equivalent).

### Keeping Lain up to date

Just ask, e.g. "are there any updates?" or "check for updates":

- **Check for updates** – fetches from the git remote and reports how many
  commits behind the local checkout is (with a short changelog), without
  changing anything.
- **Update** – if you ask Lain to update, she'll confirm, then pull the
  latest changes and rebuild/restart both the main container and the tools
  agent (if it changed). This briefly interrupts the current session (a
  container rebuild + restart, usually well under a minute).

Both run on the host via the tools agent (`scripts/update.sh`), since
pulling/rebuilding needs access outside Lain's sandboxed Docker container —
so this only works if the tools agent is set up (see above) and
`LAIN_REPO_DIR` is configured (done automatically by
`scripts/setup-tools-agent.sh`). You can also just run
`./scripts/update.sh` yourself any time from the repo directory.

## Reminders & notifications

Ask Lain to remind you about things in plain language — she'll figure out
the timing herself:

- "Remind me in 30 minutes to check the oven"
- "Every weekday at 9am, remind me to do my timesheet"
- "Every morning at 7, get me the news"

Creating or cancelling a reminder requires the same Allow/Deny confirmation
as the other tools; just asking what reminders you have doesn't. When a
reminder is due, Lain delivers it over whichever channels are configured:

- **Desktop notification** on this machine, via the same tools agent used for
  diagnostics/files (`notify-send`) — see the "Tools access" section above
  for setup. No extra configuration needed beyond that.
- **Browser push notification**, which also works on your phone or when the
  this machine is off/asleep. Requires a one-time VAPID keypair:

  ```
  node -e "console.log(require('web-push').generateVAPIDKeys())"
  ```

  Add the printed keys to the local `.env`:

  ```
  VAPID_PUBLIC_KEY=<public key>
  VAPID_PRIVATE_KEY=<private key>
  VAPID_SUBJECT=mailto:you@example.com
  ```

  Redeploy, then open Settings (click your name in the sidebar) → toggle
  "Notifications" on and allow the browser permission prompt.
- **Email**, via SMTP (works even when this machine/your phone are off). Add SMTP
  credentials to the local `.env` — for Gmail, generate an
  [App Password](https://myaccount.google.com/apppasswords) (requires
  2-Step Verification) rather than using your normal password:

  ```
  SMTP_HOST=smtp.gmail.com
  SMTP_PORT=587
  SMTP_SECURE=false
  SMTP_USER=you@gmail.com
  SMTP_PASS=<app password, no spaces>
  SMTP_FROM=Lain <you@gmail.com>
  LAIN_REMINDER_EMAIL_TO=you@gmail.com
  ```

  `LAIN_REMINDER_EMAIL_TO` is just the default recipient — each reminder
  can override it with its own comma-separated recipient list (see below).
  Redeploy after editing `.env`; Settings shows a "📧 email reminders
  enabled" indicator once SMTP is configured.

Reminders also post a 🔔 message into the conversation they were created
from, so you'll see them in your chat history even if you miss the
notification. Recurring reminders (`daily`, `weekly`, `weekdays`) keep
firing until cancelled; one-time reminders fire once and clean themselves
up. Set `LAIN_TIMEZONE` (default `America/Chicago`) in the local `.env`
if you're in a different timezone — this controls how relative times like
"in 30 minutes" or "at 9am" are interpreted.

The "news" style reminder pulls current headlines from a free RSS feed (no
API key needed); override the source with `LAIN_NEWS_FEED_URL` if you'd
rather use a different feed. You can also ask Lain for the news any time
outside of a reminder, e.g. "what's the news today?"

### Proactive briefings and nudges

Lain doesn't just wait to be asked:

- **In-chat nudges** — if you mention a concrete task, deadline, or
  appointment mid-conversation, she may proactively offer to create a
  reminder for it (you'll still get the usual Allow/Deny confirmation
  before it's actually created).
- **Proactive briefings** — a "digest" reminder (create one via the
  Reminders panel, action = "Proactive briefing", or ask in chat e.g.
  "check in on me every morning") generates a fresh, personalized message
  each time it fires — pulling in your upcoming reminders, things she's
  learned about you (see Memories below), and current headlines — instead
  of repeating a fixed message. Give it an optional note (e.g. "focus on
  work stuff") to steer what it focuses on.

### Tone-adaptive replies

Lain does a lightweight, local read of each message's tone before
replying — punctuation, capitalization, sentence fragmentation, and a few
keyword cues (no extra LLM call, so no added latency). If your message
reads as stressed, excited, tired, or rushed, she adjusts her reply's style
and cadence accordingly (calmer and more concise if stressed, warmer if
excited, gentle and low-effort if tired, tight and fast if rushed). A small
indicator with an emoji and short description appears above the message
box when a tone is detected, so you can see what she's picking up on. This
is heuristic and deliberately conservative — ordinary messages stay neutral
(no indicator, no style change).

### Deep Thinking mode

A toggle above the message box lets you switch Lain from her regular
fast model (`gemma4:e4b`) to a larger reasoning model (`gemma4:12b`,
`OLLAMA_MODEL_DEEP`) for harder questions. It's off by default and remembers
your last choice per browser. Switching models means Ollama has to swap
what's loaded on the GPU, so the first reply after toggling is a bit
slower — leave it off for everyday chat and switch it on when you want more
careful reasoning.

### Long-term memory

Lain can remember durable facts about you across conversations —
preferences, habits, important dates, ongoing projects — without you
having to re-explain them every time. She saves these automatically via a
`remember_fact` tool when something seems worth keeping (not small talk).
Review or delete anything she's learned from **Settings → 🧠 Memories**,
or add a fact manually there. This is separate from the **👤 About Me**
profile (Settings), which is for things you tell her directly (name,
birthday, occupation, links, etc.) rather than things inferred from chat.

To erase everything she's learned in one shot, either click **Settings →
🗑️ Wipe All Memory**, or type the phrase **"forget everything"** as a
chat message (see `WIPE_PHRASE` in `app/ChatClient.js` to customize) —
both trigger the same confirm → 4-digit PIN (default
`0395`, override with `LAIN_WIPE_PIN`) flow, ending in an "All Clear"
screen once done. This wipes remembered facts **and every conversation's
chat history**; your About Me profile is untouched.

### Managing reminders (custom/cron schedules)

Click **⏰ Reminders** at the top of the sidebar to open the management
panel — create, edit, enable/disable, or delete reminders directly, without
going through chat. In addition to the simple once/daily/weekly/weekdays
schedules, you can pick **Custom (cron)** and enter a standard 5-field cron
expression (`minute hour day-of-month month day-of-week`) for anything
those presets don't cover, e.g.:

- `*/15 * * * *` — every 15 minutes
- `0 9 * * 1-5` — every weekday at 9am
- `0 18 * * 1,3,5` — every Mon/Wed/Fri at 6pm
- `0 9 1 * *` — the 1st of every month at 9am

A few common presets are offered in a dropdown, or ask Lain in chat to set
a cron schedule for you (e.g. "remind me every 2 hours to stretch") — she'll
pick `repeat: cron` and a matching expression automatically. Cron schedules
respect `LAIN_TIMEZONE` the same way simple schedules do.

Each reminder can also specify its own email recipient(s) — enter a
comma-separated list in the "Email to" field (in the panel, or via
`email_to` when asking Lain to create a reminder in chat). Leave it blank
to fall back to `LAIN_REMINDER_EMAIL_TO` in `.env`.

## Customization

- **Background image**: drop any image at `public/lain-bg.jpeg` (any
  format works, just update the filename/extension referenced in
  `app/ChatClient.js`) and rebuild/redeploy — it's rendered behind the
  chat, bottom-right, via `app/ChatClient.js`.
- **Color theme**: all colors live as CSS custom properties in
  `app/globals.css` (`--lain-bg`, `--lain-panel`, `--lain-accent`,
  `--lain-highlight`, `--lain-text`, `--lain-muted`, etc.) — change the hex
  values there and rebuild/redeploy to retheme the whole app.
- **Chat bubble opacity**: bubble backgrounds are set to 50% opacity
  (`/50` Tailwind modifier) in `app/ChatClient.js` so the background image
  shows through; adjust the `/50` suffixes there to taste.
- **Advanced Ollama tuning** (`LAIN_OLLAMA_NUM_CTX`,
  `LAIN_OLLAMA_TIMEOUT_MS`, `LAIN_HISTORY_LIMIT`, `OLLAMA_MODEL_DEEP`) —
  see the commented-out section in `.env.example`.

## Project structure

- `app/page.js`, `app/ChatClient.js` – chat UI (Tailwind, dark "Lain" theme)
- `app/RemindersPanel.js` – reminders management panel (create/edit/cancel,
  including custom cron schedules)
- `auth.js` – Auth.js config: GitHub/Google providers, allowlist, JWT sessions
- `proxy.js` – protects all routes/APIs, redirects unauthenticated users
- `app/login/page.js` – sign-in page
- `app/api/auth/[...nextauth]/route.js` – Auth.js route handlers
- `app/api/chat/route.js` – proxies chat turns to Ollama, saves to SQLite,
  picks the personality/neutral system prompt based on the toggle
- `app/api/conversations/**` – list/load/delete conversation history
- `app/api/reminders/**` – CRUD for reminders (list/create/update/delete),
  used by the Reminders management panel
- `lib/db.js`, `lib/conversations.js` – SQLite persistence layer
- `Dockerfile`, `docker-compose.yml` – production deployment
- `deploy.sh` – local `docker compose up -d --build`

## License

MIT — see [LICENSE](./LICENSE).


