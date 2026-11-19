# Next Steps: Lain as a Full Incident Response Tool

## Where we are

Lain already has: playbooks, threat intel, incident reports, IP/file/URL reputation,
CVE lookup, Shodan, forensics and network tools on the laptop agent, a tool-call log,
a scheduler, push notifications, and a confirm-before-mutate convention.

The gap is a **case-centric workflow layer**. Today everything hangs off a
conversation, not an incident.

## What it would take

### 1. Incident as a first-class object (biggest gap)
- Tables: `incidents` (id, title, severity, status, phase, owner, timestamps), plus
  links to conversations, reports, playbook runs, and artifacts.
- A real `incidents` table is justified here despite the "prefer no-schema-change"
  norm. A `case_id` on existing rows can be the starting point.
- UI: `/incidents` board and a case view with a timeline. Chat is scoped to the case
  so the model always has case context.

### 2. Evidence and IOC model
- Structured IOCs (IP, domain, hash, URL, user, host) with source, confidence,
  first/last seen, and verdict.
- Auto-extract IOCs from tool output and pasted text, then enrich them through the
  existing reputation, URLhaus, and Shodan tools.
- Chain-of-custody log: hash, time, and collector for each artifact captured by the
  forensics tools.

### 3. Executable playbooks
- Playbooks are currently text. Turn them into stateful runs with steps, status, and
  checkpoints so the AI walks them step by step and persists progress.
- Gate mutating steps (isolate host, block IP, kill process) through
  `CONFIRM_REQUIRED_TOOLS`.

### 4. Ingestion and triggers
- Alerts arrive without a user typing: webhook endpoint, syslog/Wazuh/Suricata/EDR
  feeds, email or RSS intake.
- Auto-triage via the scheduler: dedupe, enrich, score, open or attach to a case,
  and push-notify.

### 5. Response actions
- Containment tools on the tools agent: firewall block, disconnect network, kill
  process, disable account, snapshot memory and disk.
- All actions allow-listed, confirmed, audited, and reversible where possible.
  This is the riskiest piece.

### 6. Timeline and reporting
- Auto-built timeline from the tool-call log, IOCs, and notes.
- Export to a report (existing `incidentReports` is the base), with MITRE ATT&CK
  mapping and lessons learned.

### 7. Safety and reliability
- Prompt-injection hardening: logs and web content are attacker-controlled. Treat
  tool output as untrusted data and never let it trigger actions without
  confirmation.
- Immutable audit log, permission scoping, secrets redaction.
- Evals: replay fixture incidents against the model to measure triage quality, since
  small local Ollama models can be inconsistent.

### 8. Prompt skills
- Add an `incident` skill category in `lib/promptSkills.js` with phases
  (triage, contain, eradicate, recover, review) and rules like "always attach
  findings to the active case".

## Suggested order

1. `incidents` table, case view, and chat scoped to a case.
2. IOC extraction and auto-enrichment.
3. Playbook runs with state.
4. Webhook ingestion and auto-triage.
5. Gated containment actions.
6. Timeline and report export.

Steps 1-3 turn Lain from a chat bot into a case workspace. Steps 4-5 make it a real
IR tool.

## Notes
- Shared logic belongs in the `tools-agent/shared` submodule so Asuna gets it too.
  Per-app wiring (`lib/tools/*.js`, `lib/promptSkills.js`) stays separate.
- Update `TOOLS.md` whenever tools are added.
