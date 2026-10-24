---
name: relay-execution
description: 领取工作、保存检查点、交付证据。 用于 Relayboard 项目中的执行者流程，支持 Codex、Claude Code、pi 及原生子 agent；需已连接共享 Relayboard 服务。
---

# 领取与执行

Use the running Relayboard service as the shared state store. Respect the project objective and the user's existing permissions. MCP tools are named `relay_*` (a client may add a prefix). Discover their schemas before supplying fields. For true MCP through the terminal, use `relayboard tools` for a compact inventory, `relayboard tools relay_agent_register` for the exact input schema, and `relayboard call relay_agent_register -` with JSON on stdin. `call` connects to the running shared `/mcp` endpoint. For REST CLI, use the absolute CLI path from `/api/integration`: `node <cli> query <name> -` or `node <cli> command <operation> -`, sending a JSON object on stdin. The CLI uses RELAYBOARD_URL and optional RELAYBOARD_TOKEN; do not log tokens.

Register the current session with `relay_agent_register`; it returns `{ agent, run }`. Retain `run.id` for claims, checkpoints and inbox; `agent.id` is the logical identity. A new chat gets a new Run; logical agent identity does not transfer task ownership. Read focused `relay_project`, `relay_task`, `relay_context` and `relay_inbox` queries. Respect `truncated` and fetch missing referenced facts when needed; avoid loading the entire event history. Acknowledge addressed messages and record agreed interface decisions with `relay_decision_record`.

Use latest `expected_version` for structural/ownership changes and the returned `claim_epoch` for owned updates. On stale state, re-read and reconsider. A heartbeat is a liveness report, not work or proof of exit. Scope checks coordinate cooperating clients; actual parallel file isolation requires separate Git worktrees. If the service is unreachable, save IDs, epoch, facts and next step locally, restore the connection before shared ownership changes or new parallel dispatch.

## Claim and work

Inspect the actual worktree, branch, local changes and relevant processes. Use `relay_eligible` for this Run, then `relay_task_claim` with the task's latest version. Store the returned epoch. A task in reconciliation must complete `relay_task_reconcile` before writing.

Stay within assigned paths and resources. Ask for `relay_scope_request` before expanding them. If blocked by a shared contract or another owner, persist the blocker, message the relevant owner, and choose independent work only through a separate claim. Do not silently take over an active task.

## Save facts, not narration

Call `relay_task_checkpoint` after meaningful progress, changed requirements, a failed approach worth preserving, and before compaction, delegation, long operations or session exit. Record:

- Observed changes and exact artifact paths or commits.
- Commands actually run, their results and whether they passed.
- Unfinished changes, blockers and unknown external-operation results.
- One concrete next action.

Use concise summaries and file references instead of full logs. Read the directed inbox between meaningful steps; answer relevant requests and acknowledge them. Keep user constraints separate from assumptions and pending proposals. Heartbeats do not replace checkpoints.

## Commit when the task calls for it

Apply [git-commit-style](../git-commit-style/SKILL.md) when committing or writing a commit message: `类型(范围): 简述` within 50 characters; a blank line; Chinese rationale explaining why, without a file inventory. Use only `feat`, `fix`, `refactor`, `docs`. Each commit has one purpose and contains only your assigned changes. Record the commit hash and relevant checks in the task artifacts. A commit records changes; it does not accept the task.

## Submit

Persist artifacts and relevant verification, then `relay_task_submit`. Keep failures visible. Submission requests independent acceptance; the implementing Run does not accept its own work. If transferring mid-task, save the checkpoint and resolve old writers before an ownership transfer.
