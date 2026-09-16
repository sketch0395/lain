# Lain tools reference

This is the maintainer-facing reference for every tool/function Lain can
call. Each tool is defined in exactly one place — **`lib/tools.js`** — as
an Ollama-compatible function definition (name, description, JSON-schema
parameters), plus a `case` in that file's dispatcher that turns a tool
call into either a plain server-side action or an HTTP request to the
laptop tools agent.

For user-facing docs (what these do, how to set them up), see the
[README](README.md#tools-access-diagnostics-files--omarchy). This file
exists so anyone editing/adding a tool can see the whole surface area
(name, params, implementation, endpoint) at a glance without grepping
across files.

There are two categories:

- **Laptop tools** — require `lain-tools-agent` running on the user's
  machine (`LAIN_TOOLS_URL`/`LAIN_TOOLS_TOKEN` configured). Each one is an
  HTTP call from `lib/tools.js` to an endpoint implemented in
  `tools-agent/lib/*.js`. `extract_image_colors`/`create_omarchy_theme_from_image`
  additionally require ImageMagick (`magick`) installed on that machine.
- **Built-in tools** — always available, run entirely server-side in the
  main app (reminders, news, memory, update-check). No laptop agent
  needed.

## Laptop tools

All of these are read-only except `set_omarchy_theme`/`omarchy_command`/
`omarchy_command_background`/`create_omarchy_theme`/`create_omarchy_theme_from_image` (change desktop
config/state) and `update_lain` (pulls + rebuilds/restarts). Every
file-path tool is restricted to `LAIN_TOOLS_ALLOWED_ROOTS` and blocked from
a sensitive-path denylist (see `tools-agent/lib/paths.js`).

| Tool (function name)     | What it does                                                        | Key params                          | Agent endpoint          | Agent module                       |
|---------------------------|----------------------------------------------------------------------|--------------------------------------|--------------------------|--------------------------------------|
| `system_diagnostics`      | CPU load, memory, disk usage, uptime, hostname                       | —                                    | `GET /diagnostics`      | `tools-agent/lib/diagnostics.js`     |
| `find_files`              | Find files by (partial) filename                                     | `query`, `root`, `limit`             | `GET /find`             | `tools-agent/lib/files.js`           |
| `search_files`            | Search file contents for a substring                                 | `query`, `root`, `limit`             | `GET /search`           | `tools-agent/lib/files.js`           |
| `list_directory`          | List a directory's immediate contents                                | `root`, `limit`                      | `GET /list`             | `tools-agent/lib/files.js`           |
| `summarize_directory`     | Read top-level text files in a directory (binaries skipped)          | `root`, `limit`                      | `GET /read-dir`         | `tools-agent/lib/files.js`           |
| `read_file`               | Read a specific file's contents (truncated if large)                 | `path`, `max_bytes`                  | `GET /read`             | `tools-agent/lib/files.js`           |
| `hash_file`               | Stream MD5/SHA1/SHA256 (or other) hashes of a file                   | `path`, `algorithms`                 | `GET /hash`             | `tools-agent/lib/forensics.js`       |
| `file_metadata`           | Timestamps, permissions, MIME type, EXIF (images)                    | `path`                               | `GET /metadata`         | `tools-agent/lib/forensics.js`       |
| `extract_strings`         | Printable strings from a binary/unknown file                         | `path`, `min_length`, `limit`        | `GET /strings`          | `tools-agent/lib/forensics.js`       |
| `list_processes`          | `ps`-style snapshot sorted by CPU or memory                           | `limit`, `sort_by`                   | `GET /processes`        | `tools-agent/lib/forensics.js`       |
| `network_connections`     | Active/listening sockets (via `ss`)                                  | `limit`                              | `GET /connections`      | `tools-agent/lib/forensics.js`       |
| `search_logs`             | Search `journalctl` for a pattern, optionally since a time            | `query`, `since`, `limit`             | `GET /logs`             | `tools-agent/lib/forensics.js`       |
| `recent_file_activity`    | Files modified within the last N hours under a directory             | `root`, `since_hours`, `limit`       | `GET /recent-activity`  | `tools-agent/lib/forensics.js`       |
| `login_history`           | Recent logins (`last`) + who's currently logged in (`who`)            | `limit`                              | `GET /login-history`   | `tools-agent/lib/forensics.js`       |
| `analyze_pcap`            | Sample packets from a `.pcap`/`.pcapng`/`.cap` (via `tcpdump -r`)     | `path`, `limit`                      | `GET /pcap`             | `tools-agent/lib/forensics.js`       |
| `capture_packets`         | Live packet capture for a bounded time/count (via `tcpdump`), always saved to `.pcap` by default | `interface`, `filter`, `duration`, `limit`, `save_path`, `no_save` | `POST /capture` | `tools-agent/lib/forensics.js`       |
| `create_note`             | Create/append/replace a markdown `.md` note file in `~/Documents` (or `LAIN_TOOLS_NOTES_DIR`) | `title`, `content`, `mode` | `POST /note` | `tools-agent/shared/tools/notes.js` ([assistant-tools](https://github.com/sketch0395/assistant-tools) submodule), adapted by `tools-agent/lib/notes.js` |
| `ping_host`               | ICMP ping (packet loss %, min/avg/max/mdev latency)                   | `host`, `count`                      | `GET /ping`             | `tools-agent/lib/network.js`         |
| `dns_lookup`              | A/AAAA/MX/TXT/CNAME records, or reverse PTR for an IP                  | `host`                                | `GET /dns-lookup`       | `tools-agent/lib/network.js`         |
| `traceroute_host`         | Hop-by-hop path to a host (via `tracepath`, no root required)          | `host`, `max_hops`                    | `GET /traceroute`       | `tools-agent/lib/network.js`         |
| `whois_lookup`            | WHOIS registration info for a domain/IP                                | `query`                               | `GET /whois`            | `tools-agent/lib/network.js`         |
| `port_scan`               | Plain TCP connect scan (open/closed/filtered), no `nmap` dependency, max 256 ports | `host`, `ports`        | `GET /port-scan`        | `tools-agent/lib/network.js`         |
| `omarchy_status`          | Current theme, active window/workspace, monitors (`hyprctl`)         | —                                    | `GET /omarchy/status`   | `tools-agent/lib/omarchy.js`         |
| `list_omarchy_themes`     | Installed theme names (`omarchy-theme-list`)                          | —                                    | `GET /omarchy/themes`   | `tools-agent/lib/omarchy.js`         |
| `set_omarchy_theme`       | Switch the desktop theme (`omarchy-theme-set`, name-validated)        | `theme`                              | `POST /omarchy/theme`  | `tools-agent/lib/omarchy.js`         |
| `list_omarchy_commands`   | Self-discovery: full list of `omarchy` CLI commands/groups/args (`omarchy commands --json`) | — | `GET /omarchy/commands` | `tools-agent/lib/omarchy.js`  |
| `omarchy_command`         | Run any fast/synchronous `omarchy` CLI command (argv array, no shell) | `argv`                               | `POST /omarchy/command` | `tools-agent/lib/omarchy.js`         |
| `omarchy_command_background` | Run a slow/long-running `omarchy` command (update, install, pkg add, theme install) detached, logged to file | `argv` | `POST /omarchy/command/background` | `tools-agent/lib/omarchy.js` |
| `create_omarchy_theme`    | Create a new custom theme under `~/.config/omarchy/themes/<name>` (colors.toml, background from a local path or downloaded URL), optionally apply it | `name`, `colors_toml`, `background_path`, `background_url`, `apply` | `POST /omarchy/theme/create` | `tools-agent/lib/omarchy.js` |
| `extract_image_colors`    | Extract a local image's dominant color palette (hex, sorted by coverage) — read-only | `path`, `count` | `POST /omarchy/image/colors` | `tools-agent/lib/imageColors.js` |
| `create_omarchy_theme_from_image` | One-step: extract a local image's palette, auto-build a full colors.toml, create the theme with that image as background, optionally apply | `name`, `image_path`, `apply` | `POST /omarchy/theme/from-image` | `tools-agent/lib/omarchy.js`, `tools-agent/lib/imageColors.js` |
| `update_lain`             | Pull latest changes + rebuild/restart Lain and the tools agent        | —                                    | `POST /update`          | `tools-agent/lib/update.js`          |

The agent also exposes `GET /health` (unauthenticated liveness check) and
`POST /notify` (desktop notifications for fired reminders — not exposed as
an LLM tool, called directly by `lib/notify.js`).

`capture_packets` always saves the capture as a `.pcap` file — by default to
a timestamped file under `~/Documents/pcaps/`, or to `save_path` if given —
so a capture is never lost just because saving wasn't explicitly requested.
Pass `no_save: true` to skip saving and get only the in-memory summary.

Captures up to ~25s run synchronously and return their full summary in the
same reply. Longer captures (up to 30 minutes, e.g. "run a pcap for 5
minutes") run in the background instead — the tools agent responds
immediately with a "started" acknowledgement, and sends a desktop
notification (via the same `notify-send` mechanism reminders use, in
`tools-agent/lib/notify.js`) with a short summary and the saved file path
once the capture actually finishes. This avoids holding the chat request
open (and risking an Ollama timeout) for a multi-minute capture.

`capture_packets` needs the tools agent's `tcpdump` binary to have
`cap_net_raw`/`cap_net_admin` capabilities (or run as root) — otherwise it
returns a clear permission error. `scripts/setup-tools-agent.sh` offers to
grant this automatically via `setcap`. If you hit the permission error later
(e.g. after an update replaced the `tcpdump` binary), you can also grant it
from the app itself: Settings → "🛡️ Enable packet capture" opens a password
prompt that runs the same `setcap` command via a dedicated, non-chat
endpoint (`POST /grant-capture-permission` in
`tools-agent/lib/capabilities.js`). The password is sent directly from the
browser to the tools agent over a proxied API route
(`app/api/tools/grant-capture-permission/route.js`) and is never passed
through the chat/LLM tool-call flow, logged, or persisted — this is
deliberate, since anything routed through `lib/tools.js` would end up in
conversation history.

## Built-in tools (always available)

| Tool (function name)  | What it does                                                                 | Key params                                                        | Implementation        |
|-------------------------|-------------------------------------------------------------------------------|----------------------------------------------------------------------|--------------------------|
| `check_for_updates`     | Compare running build vs. the public GitHub repo, report commits behind      | —                                                                      | `lib/version.js`        |
| `create_reminder`       | One-time or recurring reminder (notify/news/digest), supports cron schedules | `title`, `message`, `action`, `repeat`, `run_at`, `cron_expr`, `email_to` | `lib/reminders.js`     |
| `list_reminders`        | List active/upcoming reminders                                               | —                                                                      | `lib/reminders.js`       |
| `cancel_reminder`       | Cancel a reminder by id or partial title                                     | `id_or_title`                                                          | `lib/reminders.js`       |
| `get_news`              | Fetch current top headlines, optionally by topic                             | `topic`                                                                | `lib/news.js`            |
| `remember_fact`         | Save a short, durable fact about the user for future conversations           | `fact`                                                                 | `lib/memory.js`          |

## Shared tools (assistant-tools submodule)

These live in `tools-agent/shared/tools/*.js` — the
[assistant-tools](https://github.com/sketch0395/assistant-tools) submodule
shared with Asuna, so definitions/wording/dispatch logic can't drift
between the two assistants. Each has a thin host adapter under `lib/`
(e.g. `lib/shodan.js`) that injects host-specific config (a DB handle, an
API key) into the shared implementation. Always available server-side —
no laptop tools agent required — but some (Shodan) need their own optional
API key configured.

| Tool (function name)       | What it does                                                          | Key params                     | Shared module            | Requires                |
|------------------------------|--------------------------------------------------------------------------|-----------------------------------|-----------------------------|----------------------------|
| `lookup_threat_intel`       | Search the threat intel library (categories/titles/tags/content)        | `query`, `limit`                | `tools/threatIntel.js`     | —                          |
| `add_threat_intel`          | Save/log an entry into the threat intel library                         | `category`, `title`, `content`, `tags` | `tools/threatIntel.js` | —                          |
| `fetch_web_page`            | Fetch a URL and extract readable text (for summarizing articles/advisories) | `url`                        | `tools/webFetch.js`        | —                          |
| `get_cyber_news`            | Fetch recent items from configured cybersecurity RSS/Atom sources        | `topic`, `limit`                | `tools/cyberNews.js`       | —                          |
| `add_cyber_news_source`     | Add an RSS/Atom feed to pull cyber news from                            | `name`, `url`                   | `tools/cyberNews.js`       | —                          |
| `list_cyber_news_sources`   | List configured cyber news sources                                       | —                                | `tools/cyberNews.js`       | —                          |
| `remove_cyber_news_source`  | Remove a configured cyber news source                                    | `name_or_url`                   | `tools/cyberNews.js`       | —                          |
| `set_cyber_news_watch_terms`| Save standing "what to look for" filter terms for `get_cyber_news`       | `watch_terms`                   | `tools/cyberNews.js`       | —                          |
| `shodan_host_lookup`        | Everything Shodan knows about a public IP (ports, banners, CVEs, org)    | `ip`                             | `tools/shodan.js`          | `SHODAN_API_KEY`           |
| `shodan_search`             | Run a Shodan search query (Shodan query syntax)                         | `query`, `limit`                | `tools/shodan.js`          | `SHODAN_API_KEY`           |
| `shodan_dns_lookup`         | Resolve hostname(s) to IP address(es) via Shodan's DNS API               | `hostnames`                      | `tools/shodan.js`          | `SHODAN_API_KEY`           |
| `shodan_account_info`       | Check the configured Shodan API key's plan/remaining credits             | —                                | `tools/shodan.js`          | `SHODAN_API_KEY`           |

## Adding a new tool

1. **Laptop tool**: add the logic + a route in the relevant
   `tools-agent/lib/*.js` module (or a new module, registered from
   `tools-agent/server.js`), then add a function definition to
   `LAPTOP_TOOL_DEFINITIONS` and a `case` in both the arg-building switch
   and (if it needs special handling) the execution switch in
   `lib/tools.js`.
2. **Built-in tool**: implement it server-side (own module under `lib/`),
   then add a function definition to `REMINDER_TOOL_DEFINITIONS` (despite
   the name, this is the "always available" list) and a `case` in
   `lib/tools.js`'s dispatcher.
3. Update this file's table and, if it's user-facing, the README section
   it belongs to.
