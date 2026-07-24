---
slug: bot-not-responding
status: resolved
trigger: "WhatsApp bot was working, then suddenly stopped responding; restart did not restore responses"
created_at: 2026-07-24T17:30:53-03:00
updated: 2026-07-24T18:08:00-03:00
goal: find_and_fix
---

# Debug Session: Bot Not Responding

## Symptoms

- Bot was working and then suddenly stopped responding.
- User already restarted it, but it still does not respond.
- Diagnosis only: do not apply fixes or mutate remote state.

## Current Focus

- hypothesis: CONFIRMED — Baileys badSession (500) represents unusable auth state, but the close handler treats it as transient and reconnects with the same files because only loggedOut (401) enters invalid-session recovery.
- test: Add a focused unit test that invokes the invalid-session recovery decision for 500, 401, and a transient reason, observing whether session clearing and reconnect scheduling occur.
- expecting: 500 and 401 both clear auth and schedule a named invalid-session reconnect; a transient reason does neither and remains on the generic reconnect path.
- next_action: Implement a minimal invalid-session recovery helper, route the close handler through it, and run the focused regression test plus the existing suite.

reasoning_checkpoint:
  hypothesis: "badSession (500) causes the persistent outage because it bypasses clearSession() and scheduleReconnect() reloads the same corrupt auth files."
  confirming_evidence:
    - "Installed Baileys reports DisconnectReason.badSession as 500 and loggedOut as 401."
    - "The close handler calls clearSession() only for loggedOut; all other codes call scheduleReconnect(reason), while startConnection() reloads config.paths.authInfo."
    - "Production evidence shows inbound delivery stopped at badSession and did not resume after automatic reconnect or process restart."
  falsification_test: "If 500 already invokes clearSession() before reconnection, or reconnecting without auth files does not enter QR pairing, the hypothesis is wrong."
  fix_rationale: "Classifying 500 with 401 as invalid auth makes the existing recovery sequence delete only the configured main auth state before reconnect, so Baileys starts without credentials and emits a fresh pairing QR."
  blind_spots: "The local test cannot complete a real WhatsApp QR pairing or prove remote message delivery; that requires human verification after deployment and pairing."

## Evidence

- timestamp: 2026-07-24T17:34:00-03:00
  checked: Project layout and project-specific rules
  found: The app is a small Node.js project with startup in index.js and runtime modules under lib/; no AGENTS.md or rules/*.md files are present.
  implication: The complete startup and inbound-message path can be traced directly without additional project rule constraints.

- timestamp: 2026-07-24T17:34:00-03:00
  checked: Sanitized VPS operations guide
  found: Production is expected at ~/whatsapp-sticker-bot under PM2 process name sticker-bot; QR/status HTTP service is expected on port 3000.
  implication: Read-only PM2 status/logs, port state, and WhatsApp status endpoints are the correct production observation points.

- timestamp: 2026-07-24T17:38:00-03:00
  checked: VPS PM2, health endpoint, resources, sessions, and recent logs (read-only)
  found: PM2 is online but has 115 cumulative restarts; main health says connected with a session, disk and RAM are healthy, and the main auth directory has creds plus thousands of session files.
  implication: The outage is not explained by a stopped process, missing main credentials, disk exhaustion, or memory exhaustion; the high restart count is consistent with repeated recovery attempts.

- timestamp: 2026-07-24T17:38:00-03:00
  checked: Chronology of inbound events and WhatsApp disconnects
  found: The last successful inbound message was 2026-07-24 19:26:36 UTC. A badSession followed at 19:26:44; reconnect completed at 19:26:51 but no later inbound event was observed. Another badSession occurred at 20:16:50, followed by reconnect at 20:16:56 and a manual restart/open at 20:25:45, still without inbound events.
  implication: Loss of message delivery begins exactly at badSession and survives both automatic reconnect and manual restart, falsifying a transient PM2/process-stop explanation.

- timestamp: 2026-07-24T17:38:00-03:00
  checked: Frequency of cryptographic/session errors
  found: Today's logs contain 22 badSession events and 664 Bad MAC errors.
  implication: The main WhatsApp auth/Signal state is repeatedly failing cryptographic/session validation rather than merely being idle.

- timestamp: 2026-07-24T17:38:00-03:00
  checked: Secondary personal-bot state
  found: The personal bot has no session and repeatedly cycles QR generation roughly every 20-60 seconds; its auth directory is empty. The application error log has grown to about 46.8 MB.
  implication: The personal client creates substantial secondary churn and log volume, but it does not explain the exact main-client inbound cutoff, whose timing aligns with badSession.

- timestamp: 2026-07-24T17:40:00-03:00
  checked: lib/bot.js disconnect and reconnect implementation
  found: Installed Baileys maps badSession to 500 and loggedOut to 401. lib/bot.js lines 2384-2390 clearSession() only for loggedOut; all other reasons, including badSession, fall through to scheduleReconnect() at line 2393. startConnection() then reloads config.paths.authInfo through useMultiFileAuthState() at line 2331. The global error handlers at lines 2257-2264 also suppress Bad MAC exceptions.
  implication: Automatic reconnect and PM2 restart preserve and reload the corrupt session, explaining why the socket can reopen and health can say connected while inbound delivery never resumes.

## Eliminated

- hypothesis: The PM2 process is stopped or the VPS is resource-exhausted.
  evidence: PM2 is online and disk/RAM are healthy; the process reconnects and exposes health state.
  timestamp: 2026-07-24T17:38:00-03:00

- hypothesis: Maintenance or an allow-list gate is rejecting otherwise healthy inbound messages.
  evidence: No inbound events are observed after the first badSession, so the failure occurs before application-level command gates; restart would also reset the in-memory maintenance flag.
  timestamp: 2026-07-24T17:40:00-03:00

- hypothesis: The personal bot QR loop is the primary cause of the main bot outage.
  evidence: It is secondary churn, but the main inbound cutoff occurs eight seconds before the first observed badSession and never recovers after the main client's badSession reconnects.
  timestamp: 2026-07-24T17:40:00-03:00

## Resolution

- root_cause: The main Baileys session entered badSession (500) and has corrupt/inconsistent auth/Signal state. The code treats badSession as a normal transient close, reconnecting with the same session; only loggedOut (401) clears auth. Restarts therefore reload the same broken state, yielding a misleading connected health status without subsequent inbound messages.
- fix: Applied locally and deployed to the VPS. `badSession` and `loggedOut` now both clear invalid auth before reconnecting; regression tests cover both invalid-session reasons and preserve auth for ordinary `connectionClosed`. The former main session was archived as `/home/ubuntu/whatsapp-sticker-bot/session-backup-bad-session-20260724-174712`, and a new main session was paired without touching rank data.
- verification: Local and VPS suites both passed with 517 tests and 0 failures. After pairing, the main client reported `connected`, saved the new session, and resumed receiving live group messages from 20:51:17 UTC onward.
