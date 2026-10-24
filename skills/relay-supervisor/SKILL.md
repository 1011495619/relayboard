---
name: relay-supervisor
description: Inspect Relayboard cross-project patrol incidents, configure bounded reminders or recovery when requested, and diagnose stalled tasks without confusing heartbeats with progress. Use for project oversight and automatic handoff policies; ordinary task execution uses the execution workflow.
---

# Relayboard project supervisor

Read `relay_supervisor_status` with pagination to see policies, actual incidents, reminders and recovery budgets across projects. Inspect the specific task, current owner and recorded process status before taking action. The server patrol runs every 15 seconds while Relayboard is running; it uses local checks rather than a permanent model conversation.

- `observe` records problems. `remind` sends durable directed requests. A message wakes only a managed Run with an already enabled dispatcher; external clients must poll or use their integration.
- `recover` may consume model quota. Configure it when the user requests automatic continuation, using `relay_supervisor_configure`, the current policy version, allowed CLI order, thresholds and bounded total/per-task attempts. Keep existing client tool permissions. A budget reset requires explicit `reset_budget: true`; ordinary policy edits preserve consumption.
- Check actual task checkpoints and outcomes. Heartbeats, log chatter, model exit 0 and the supervisor's own reminders are not task progress. Coordinators waiting for children are inspected through each child's independent identity.
- A replacement gets its own Run, inherited parent relationship and task scope. Existing checkpoints, ordered steps, evidence, failure records and relevant memory remain; the ownership epoch fences the old writer. The replacement must recover the actual workspace before editing. Managed writers must exit first. An unknown or external writer needs explicit stop verification; elapsed time does not prove exit.
- If a problem needs a human, inspect its recorded reason rather than resetting budgets and repeatedly relaunching. `relay_supervisor_handle` can snooze an incident or recheck after its cause is addressed; use the incident's current version. Recheck does not declare an old writer stopped. Task review remains independent.

Search local project lessons through `relay_memory_search`, then read required evidence using `relay_memory_get` with ID/version. Search a named remote library only when relevant; only the explicit query is sent. Memory is historical reference, not permission or a current contract. Save verified reusable runbooks and failures with `relay_memory_save`; include provenance, evidence and an expiry when appropriate, excluding credentials. Do not turn speculative diagnosis into an established fact.
