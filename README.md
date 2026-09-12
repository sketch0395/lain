# Lain

A personal, self-hosted chatbot. The web app runs on your home lab server;
the actual LLM (Ollama) runs on your laptop's GPU, and Lain "reaches back"
to it over your LAN. Conversations are persisted in SQLite so Lain
remembers your chat history across sessions. Access is locked down with
OAuth sign-in plus an allowlist, since this is publicly reachable.

```
[ Browser ] --> [ Home lab server: 10.5.1.17, Next.js + SQLite ]
                          |
                          v  LAN, http://10.5.1.20:11434
                 [ Laptop: 10.5.1.20, Ollama + GPU ]
```

## 1. One-time setup on your laptop (the LLM host)

Ollama needs to listen on your LAN interface, not just localhost, and you
need the model pulled:

```bash
# Pull the model Lain will use
ollama pull gemma4:e4b

# Make Ollama listen on all interfaces (persists via systemd override)
sudo systemctl edit ollama
```
Add:
```ini
[Service]
Environment="OLLAMA_HOST=0.0.0.0"
```
Then:
```bash
sudo systemctl restart ollama
```

Allow the server to reach port 11434 through your laptop's firewall, e.g.
with `ufw`:
```bash
sudo ufw allow from 10.5.1.17 to any port 11434
```

Verify from the server side once deployed: `curl http://10.5.1.20:11434/api/tags`.

## 2. Authentication setup (required before exposing publicly)

Lain is gated behind GitHub and Google OAuth sign-in, plus an allowlist —
only accounts you explicitly approve can get in, even though anyone could
technically authenticate with GitHub/Google.

### Create OAuth apps

**GitHub** (https://github.com/settings/developers → "New OAuth App"):
- Homepage URL: `https://lain.dialtone.cc`
- Authorization callback URL: `https://lain.dialtone.cc/api/auth/callback/github`
- Copy the Client ID and generate a Client Secret.

**Google** (https://console.cloud.google.com/apis/credentials → "Create OAuth client ID", type "Web application"):
- Authorized redirect URI: `https://lain.dialtone.cc/api/auth/callback/google`
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

### Important: HTTPS is required

OAuth providers and secure session cookies require HTTPS in production.
Since you already have a reverse proxy (Caddy/Nginx/Traefik) terminating
TLS at `https://lain.dialtone.cc` in front of the container's port 3000,
no extra config is needed here — just make sure `AUTH_URL` matches that
public HTTPS URL exactly.

## 3. Configuration

`.env*` files are **never synced by `deploy.sh`** — the server's `.env` is
the source of truth for production secrets and must be created/edited
directly on the server (over SSH), so a stale or empty local file can
never accidentally wipe out or overwrite it on redeploy.

The first time you deploy to a fresh server, `deploy.sh` will notice
there's no `.env` yet and create one from `.env.example`, then tell you to
edit it. SSH in and fill in the real values:

```bash
ssh dialtone@10.5.1.17
cd ~/lain
nano .env   # or vim, etc.
```

```
OLLAMA_HOST=http://10.5.1.20:11434
OLLAMA_MODEL=gemma4:e4b
# Optional: larger "deep thinking" model, used when the chat UI toggle is on
OLLAMA_MODEL_DEEP=gemma4:12b

# Host port Lain listens on (change if the default is already taken)
LAIN_HOST_PORT=7869

# Generate with: npx auth secret
AUTH_SECRET=
AUTH_URL=https://lain.dialtone.cc

AUTH_GITHUB_ID=
AUTH_GITHUB_SECRET=

AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=

# Comma-separated allowlist: GitHub usernames and/or Google emails
ALLOWED_USERS=xbikr2@gmail.com,sketch0395
```

Then re-run `./deploy.sh` (or just `docker compose up -d --build` on the
server) to pick up the new values. `ALLOWED_USERS` can be extended any
time (add more of your 6 users) — just edit `.env` on the server and
restart the container, no code changes needed.

For local development, use `.env.local` on your laptop instead (see
"Local development" below) — it's also excluded from sync.

## 4. Deploy to the home lab server

Requires `rsync`, `ssh`, and Docker + the compose plugin on the server
(`10.5.1.17`, user `dialtone`).

```bash
./deploy.sh
```

This syncs the project (excluding `.env*`, `node_modules`, `.next`, `data`)
to `~/lain` on the server and runs `docker compose up -d --build`. Lain
will be available at `http://10.5.1.17:<LAIN_HOST_PORT>` (defaults to
`3000`; set `LAIN_HOST_PORT` in the server's `.env` if that port is
already taken by something else) — proxied publicly via
`https://lain.dialtone.cc`.

To redeploy after making changes, just re-run `./deploy.sh`.

## 5. Local development

```bash
npm install
npm run dev
```

Create a `.env.local` (gitignored, never synced to the server) with
`OLLAMA_HOST`/`OLLAMA_MODEL` pointing at your laptop's Ollama instance,
plus `AUTH_*` values for a **separate, localhost-only OAuth app** (e.g. a
GitHub OAuth App with callback URL `http://localhost:3000/api/auth/callback/github`)
since auth is enforced on every route. Don't reuse the production OAuth
app's credentials for local testing.

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

This is a stripped-down base template — the original character/companion
personality has been removed, leaving a blank, generic assistant prompt
(see `PERSONALITY_PROMPT`/`NEUTRAL_PROMPT` in `app/api/chat/route.js`).
Personality can still be toggled on/off per-browser from Settings (click
your name in the sidebar) → "✨ Personality: on/off"; the preference is
stored in `localStorage` and sent with each chat request. Define Lain's
actual voice/character by editing those prompts directly, or override via
env vars without touching code:

- `LAIN_SYSTEM_PROMPT` – used when personality mode is on (default: see
  `app/api/chat/route.js`)
- `LAIN_NEUTRAL_PROMPT` – used when personality mode is off

## CLI access (Omarchy / terminal)

A bearer token lets trusted local tools talk to Lain's API without going
through OAuth. This is used by the `lain` terminal command.

### 1. Server: set a token

Add to the server's `~/lain/.env` (generate with `openssl rand -hex 32`):

```
LAIN_API_TOKEN=<random-hex-string>
```

Restart the container (`docker compose up -d` on the server) to pick it up.
Leave this blank/unset to disable CLI access entirely.

### 2. Client machine: install the CLI

The easiest way (any machine, Omarchy or not):

```
./scripts/setup-omarchy-cli.sh
```

This installs `bin/lain` to `~/.local/bin/lain`, prompts for your
`LAIN_URL`/`LAIN_API_TOKEN` and writes `~/.config/lain/config`
(`chmod 600`), and — if running on Omarchy — adds a Hyprland keybinding,
floating window rule, and launcher entry (see section 3). It's idempotent:
safe to re-run on the same machine, and existing config is left alone
unless you pass `--force`.

To set up non-interactively (e.g. scripted/other machines):

```
LAIN_URL=https://lain.dialtone.cc LAIN_API_TOKEN=<token> \
  ./scripts/setup-omarchy-cli.sh --non-interactive
```

Or install manually: copy `bin/lain` anywhere on your `PATH` and
`chmod +x` it, then create `~/.config/lain/config` (`chmod 600`) with:

```
LAIN_URL=https://lain.dialtone.cc
LAIN_API_TOKEN=<same token as the server>
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
"Continue in browser" link (`https://lain.dialtone.cc/?c=<id>`) that opens
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

Lain can optionally reach back to a small agent on your laptop so she can
check system diagnostics, look up/read files, or check/change your Omarchy
theme when you ask her to — e.g. "can you check your diagnostics?" or "find
files with 'invoice' in the name" or "read my package.json" or "switch to
the Tokyo Night theme". This is entirely opt-in and off by default.

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
- **Token-authenticated + LAN-only.** The agent requires a bearer token for
  every request (except its own unauthenticated `/health` check) and should
  only be reachable from your home server via a firewall rule, never
  exposed to the internet.

### 1. Laptop: install the tools agent

```
./scripts/setup-tools-agent.sh
```

This installs the agent to `~/.local/share/lain/tools-agent.js`, prompts
for (or accepts as env vars) a port, allowed root directories, and
generates/reuses an auth token, then registers and starts it as a
`systemd --user` service (`lain-tools-agent.service`). It prints the
`LAIN_TOOLS_URL`/`LAIN_TOOLS_TOKEN` to copy into the server's `.env`, plus
the exact `ufw allow` command to run so the home server can reach it.

Check it's running any time with:

```
systemctl --user status lain-tools-agent
```

### 2. Server: point Lain at it

Add to the server's `~/lain/.env`:

```
LAIN_TOOLS_URL=http://<laptop-lan-ip>:8787
LAIN_TOOLS_TOKEN=<token printed by the setup script>
```

Redeploy (`./deploy.sh` or `docker compose up -d --build` on the server).
Leave these blank/unset to disable tool access entirely — Lain will just
chat normally with no tool prompts.

The sidebar shows a 🧰 indicator when the tools agent is configured and
reachable, so you can confirm connectivity at a glance (also reported by
`/api/health` as `toolsEnabled`/`toolsReachable`).

### Available tools

- **System diagnostics** – uptime, CPU/memory/disk usage on the laptop.
- **Find files** – search for files by name under an allowed directory.
- **Search files** – search file contents for a text match.
- **Read file** – read (and summarize) the contents of a specific file.
- **Omarchy status** – current theme, active window, active workspace, and
  connected monitors (via `hyprctl`).
- **List Omarchy themes** – installed theme names (`omarchy-theme-list`).
- **Set Omarchy theme** – switch the desktop to a different installed theme
  (`omarchy-theme-set`); the requested name is validated against the actual
  installed theme list before running anything.

## Reminders & notifications

Ask Lain to remind you about things in plain language — she'll figure out
the timing herself:

- "Remind me in 30 minutes to check the oven"
- "Every weekday at 9am, remind me to do my timesheet"
- "Every morning at 7, get me the news"

Creating or cancelling a reminder requires the same Allow/Deny confirmation
as the laptop tools; just asking what reminders you have doesn't. When a
reminder is due, Lain delivers it over whichever channels are configured:

- **Desktop notification** on your laptop, via the same tools agent used for
  diagnostics/files (`notify-send`) — see the "Tools access" section above
  for setup. No extra configuration needed beyond that.
- **Browser push notification**, which also works on your phone or when the
  laptop is off/asleep. Requires a one-time VAPID keypair:

  ```
  node -e "console.log(require('web-push').generateVAPIDKeys())"
  ```

  Add the printed keys to the server's `~/lain/.env`:

  ```
  VAPID_PUBLIC_KEY=<public key>
  VAPID_PRIVATE_KEY=<private key>
  VAPID_SUBJECT=mailto:you@example.com
  ```

  Redeploy, then open Settings (click your name in the sidebar) → toggle
  "Notifications" on and allow the browser permission prompt.
- **Email**, via SMTP (works even when your laptop/phone are off). Add SMTP
  credentials to the server's `~/lain/.env` — for Gmail, generate an
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
up. Set `LAIN_TIMEZONE` (default `America/Chicago`) in the server's `.env`
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
to fall back to the server's `LAIN_REMINDER_EMAIL_TO` default.

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
- `deploy.sh` – rsync + remote `docker compose up -d --build`
