---
slug: bot-not-responding-2026-07-29
status: diagnosed
trigger: "WhatsApp bot stopped responding again on 2026-07-29"
created_at: 2026-07-29T15:23:36-03:00
updated: 2026-07-29T15:34:00-03:00
goal: find_root_cause_only
---

# Debug Session: Bot Not Responding Again (2026-07-29)

## Symptoms

- The WhatsApp bot stopped responding again on 2026-07-29.
- Production is the Oracle VPS project `/home/ubuntu/whatsapp-sticker-bot`, managed by PM2 as `sticker-bot`.
- Diagnose only. Do not mutate production, restart processes, delete or move auth/session files, or touch rank data.
- Compare the current incident with the resolved 2026-07-24 incident in `.planning/debug/bot-not-responding.md`.

## Current Focus

- hypothesis: CONFIRMED — the main WhatsApp auth/Signal state became invalid (Bad MAC followed by badSession); the deployed recovery correctly removed the unusable login and entered QR-pairing mode, but no new pairing completed, so the live PM2 process has no authenticated session and cannot receive or answer messages.
- test: Correlate the final inbound event, badSession cleanup, health state, and all later connection events.
- expecting: No inbound event after session cleanup, hasSession false, and only QR generation plus timedOut reconnects afterward.
- next_action: No automated action. An authorized operator should complete one fresh QR pairing, then confirm health becomes connected and a live test command receives a response.

## Evidence

- timestamp: 2026-07-29T15:26:10-03:00
  checked: Prior 2026-07-24 resolved incident and project-specific rules
  found: The prior outage was caused by badSession (500) reloading corrupt auth; the local code now classifies both badSession and loggedOut as invalid sessions. No project skill directory or debug knowledge base exists.
  implication: The prior signature is a high-value hypothesis candidate, but it must be re-proven against current production chronology; current deployed behavior may differ from the old implementation.

- timestamp: 2026-07-29T15:30:00-03:00
  checked: Production PM2, health endpoint, process resources, disk, and memory
  found: PM2 sticker-bot is online with PID present, 128 cumulative restarts, 89 minutes uptime, and zero unstable restarts. Health reports status reconnecting, hasSession false, lastDisconnect timedOut, and 9 reconnect attempts. Root disk is 14% used, about 489 MB RAM is available, and the process is alive at low CPU.
  implication: The incident is not a stopped/crash-looping PM2 process or disk exhaustion; the application is deliberately reconnecting without an authenticated WhatsApp session.

- timestamp: 2026-07-29T15:30:00-03:00
  checked: Production inbound and connection chronology
  found: The final inbound event was 18:04:03 UTC. At 18:04:09 the application logged invalid-session cleanup and reconnect reason badSession; from 18:04:15 onward it emitted QR codes, followed by repeated timedOut reconnects, with no later inbound events through the 18:29 UTC snapshot.
  implication: Message delivery stopped exactly when badSession invalidated and cleared the main session; the current nonresponse is caused before application-level command handling.

- timestamp: 2026-07-29T15:30:00-03:00
  checked: Production cryptographic/session sequence and deployed disconnect code
  found: After pairing/open at 17:12:37 UTC, production logged repeated Bad MAC errors, then later badSession. Deployed lib/bot.js explicitly treats both badSession and loggedOut as invalid sessions and clears auth before reconnecting.
  implication: Unlike 2026-07-24, the recovery fix is deployed and executed; it is now waiting for a fresh QR pairing rather than silently reloading corrupt credentials.

- timestamp: 2026-07-29T15:30:00-03:00
  checked: Production log growth
  found: The application error log is approximately 54.7 MB but root disk remains only 14% used.
  implication: Log growth is operational debt but does not explain the current outage.

- timestamp: 2026-07-29T15:32:00-03:00
  checked: Post-badSession inbound events
  found: A direct chronological scan found zero inbound events after the 18:04:09 UTC invalid-session event.
  implication: The connection never resumed authenticated message delivery after the session was cleared.

## Eliminated

- hypothesis: PM2 is stopped, unstable, or resource exhaustion prevents handling messages.
  evidence: PM2 is online with a live PID and zero unstable restarts; disk and RAM have headroom, while health responds with explicit reconnecting state.
  timestamp: 2026-07-29T15:30:00-03:00

- hypothesis: The deployed code still has the 2026-07-24 bug that reconnects badSession using corrupt auth files.
  evidence: Production code classifies badSession and loggedOut together, logs invalid-session cleanup at 18:04:09 UTC, and health immediately afterward reports hasSession false.
  timestamp: 2026-07-29T15:30:00-03:00

## Resolution

- root_cause: The current nonresponse is caused by loss of the main WhatsApp authenticated session. After repeated Bad MAC crypto failures, Baileys emitted badSession at 18:04:09 UTC. The deployed 2026-07-24 recovery fix correctly cleared the invalid login and began generating fresh QR codes; because no new QR pairing completed, health remains reconnecting with hasSession false and QR attempts repeatedly expire with timedOut. The PM2 process itself remains healthy, but without WhatsApp authentication it receives no messages.
- fix: not applied
- verification: Diagnose-only production inspection confirmed zero inbound events after the 18:04:09 UTC cleanup, repeated QR/timedOut cycles through the observation window, a responsive health endpoint with hasSession false, a live PM2 PID, and adequate disk/RAM.
- safe_next_step: Have an authorized operator open the existing QR page and pair the intended WhatsApp account once; do not restart or clear anything first. After pairing, verify /health reports connected and hasSession true, then send one benign test command and confirm a new inbound event/response. If badSession recurs after a fresh pairing, open a new investigation into why Signal state repeatedly corrupts rather than repeating session clears.
