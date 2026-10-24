---
name: relay-handoff
description: 停止旧写入，保留现场，让新会话接手。 用于 Relayboard 项目中的交接双方流程，支持 Codex、Claude Code、pi 及原生子 agent；需已连接共享 Relayboard 服务。
---

# Transfer ownership without losing the next action

Use the shared running Relayboard service. Discover one tool schema with `relayboard tools <tool>`; invoke real MCP with `relayboard call <tool> -` and JSON on stdin. The service URL is `RELAYBOARD_URL`; inherit optional `RELAYBOARD_TOKEN` without logging it. Register this session with `relay_agent_register`, retain `run.id` (not `agent.id`), and use a new Run for a new chat. Never reuse another executor's identity.

## Prepare while the current session can still report

Use `relay_work_report kind: "progress"` with the latest handle to save current facts, exact artifacts/commits, failed attempts, uncertain action outcomes and one next step. Read `relay_context` and export when needed. On older services use `relay_task_checkpoint`. Large logs stay in referenced files.

Confirm required inputs, ordered steps, `done_when`, failure actions and `stop_when` are useful to a reader without the old chat. Preserve uncommitted changes and their worktree. Save facts before compaction; hooks can export existing records but do not recover progress that was never reported.

## Explicitly transfer

Register a new Run for the destination. Stop the old writer and observe exit; managed processes must exit first. Heartbeat expiry is not exit evidence. Handle every active descendant: preserve its work and redirect reports, or stop/release it with actual evidence. Do not silently transfer or release the subtree.

Call `relay_task_handoff` using latest expected version, source identity, destination Run and explicit descendant policy. The service changes `claim_epoch`; old handles are stale. Unknown external writers require confirmed stop in a shared directory, or an isolated destination with recorded uncertainty and integration plan. Release only work known to have stopped.

## Recover in the new window/client

1. Call `relay_work_start` with the new Run and assigned task after transfer. It does not itself take an occupied task.
2. Read the guide and missing referenced records. Inspect actual cwd, branch, changes, processes and artifacts; investigate uncertain external operations before repeating them.
3. Read required decisions in full. Page `relay_work_dependencies` until next_offset is null when the guide omits dependencies. Receive the exact dependency artifacts into this worktree and record receipts using their service revision; accepted upstream tasks may live on other branches.
4. Report `kind: "recover"` with the new guide's handle, observed facts, read decision IDs and actual dependency receipts. Follow refreshed guides when contracts, plans or dependencies change.
5. Page `relay_work_requests` to recover unresolved task/ancestor requests, including those sent to the old owner. `message_ack` records reading; the current task owner records actual processing with `message_resolve {message_id, run_id, note}`.
6. Execute the current step, report its observed result and continue from the service's next action.

A pure ownership handoff preserves completed steps when requirements are unchanged; changed requirements/contracts require recover and conservatively reset the affected task’s steps. Keep unresolved discrepancies as blockers.

On an older service, read context/inbox and use `relay_task_reconcile` with observed facts and next step before writes. When the service is unreachable, save a local checkpoint and restore connectivity before ownership changes or new parallel dispatch; use the shared database once reconnected.

Carry exact commits, worktrees and uncommitted state. Apply [git-commit-style](../git-commit-style/SKILL.md) to subsequent commits. A capable recovery process reduces reliance on remembered chat; complex technical judgments may still need escalation to a suitable executor.

## Project memory and patrol

Use `relay_memory_search` for relevant project lessons, then `relay_memory_get` by ID/version for evidence. Summaries omit full bodies; avoid loading the whole library or old conversation. Save reusable verified facts, runbooks and failed approaches with `relay_memory_save`, source and evidence; exclude credentials. Current project constraints and decisions take precedence over memory. `relay_memory_sources` lists explicit remote libraries; only send a focused query via `relay_memory_remote_search` when appropriate.

When a patrol reminder arrives, read `work_next` and report actual progress or a specific blocker. Heartbeat and log output do not resolve a stall. Replacement Runs still recover files and report every native descendant separately. `relay_supervisor_status` explains reminders, recovery attempts and budgets; failed client login or tool approval needs configuration, not repeated blind relaunches.
