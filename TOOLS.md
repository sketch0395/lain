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
  `tools-agent/lib/*.js`.
- **Built-in tools** — always available, run entirely server-side in the
  main app (reminders, news, memory, update-check). No laptop agent
  needed.

## Laptop tools

All of these are read-only except `set_omarchy_theme` (changes desktop
theme) and `update_lain` (pulls + rebuilds/restarts). Every file-path tool
is restricted to `LAIN_TOOLS_ALLOWED_ROOTS` and blocked from a sensitive-path
denylist (see `tools-agent/lib/paths.js`).

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
| `capture_packets`         | Live packet capture for a bounded time/count (via `tcpdump`), optional save to `.pcap` | `interface`, `filter`, `duration`, `limit`, `save_path` | `POST /capture` | `tools-agent/lib/forensics.js`       |
| `omarchy_status`          | Current theme, active window/workspace, monitors (`hyprctl`)         | —                                    | `GET /omarchy/status`   | `tools-agent/lib/omarchy.js`         |
| `list_omarchy_themes`     | Installed theme names (`omarchy-theme-list`)                          | —                                    | `GET /omarchy/themes`   | `tools-agent/lib/omarchy.js`         |
| `set_omarchy_theme`       | Switch the desktop theme (`omarchy-theme-set`, name-validated)        | `theme`                              | `POST /omarchy/theme`  | `tools-agent/lib/omarchy.js`         |
| `update_lain`             | Pull latest changes + rebuild/restart Lain and the tools agent        | —                                    | `POST /update`          | `tools-agent/lib/update.js`          |

The agent also exposes `GET /health` (unauthenticated liveness check) and
`POST /notify` (desktop notifications for fired reminders — not exposed as
an LLM tool, called directly by `lib/notify.js`).

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
