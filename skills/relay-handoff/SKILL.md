---
name: relay-handoff
description: 停止旧写入，保留现场，让新会话接手。 用于 Relayboard 项目中的交接双方流程，支持 Codex、Claude Code、pi 及原生子 agent；需已连接共享 Relayboard 服务。
---

# 交接与续接

Use the running Relayboard service as the shared state store. Respect the project objective and the user's existing permissions. MCP tools are named `relay_*` (a client may add a prefix). Discover their schemas before supplying fields. For true MCP through the terminal, use `relayboard tools` for a compact inventory, `relayboard tools relay_agent_register` for the exact input schema, and `relayboard call relay_agent_register -` with JSON on stdin. `call` connects to the running shared `/mcp` endpoint. For REST CLI, use the absolute CLI path from `/api/integration`: `node <cli> query <name> -` or `node <cli> command <operation> -`, sending a JSON object on stdin. The CLI uses RELAYBOARD_URL and optional RELAYBOARD_TOKEN; do not log tokens.

Register the current session with `relay_agent_register`; it returns `{ agent, run }`. Retain `run.id` for claims, checkpoints and inbox; `agent.id` is the logical identity. A new chat gets a new Run; logical agent identity does not transfer task ownership. Read focused `relay_project`, `relay_task`, `relay_context` and `relay_inbox` queries. Respect `truncated` and fetch missing referenced facts when needed; avoid loading the entire event history. Acknowledge addressed messages and record agreed interface decisions with `relay_decision_record`.

Use latest `expected_version` for structural/ownership changes and the returned `claim_epoch` for owned updates. On stale state, re-read and reconsider. A heartbeat is a liveness report, not work or proof of exit. Scope checks coordinate cooperating clients; actual parallel file isolation requires separate Git worktrees. If the service is unreachable, save IDs, epoch, facts and next step locally, restore the connection before shared ownership changes or new parallel dispatch.

## Prepare before context is lost

Save `relay_task_checkpoint` with IDs, current epoch, objective, user constraints, actual changes, artifact paths, verification outcomes, failed approaches, unknown results, blockers and one next action. Request a bounded `relay_context` packet; persist it through the workspace export when needed. Keep large logs as referenced files. A packet supports recovery; the shared service remains authoritative.

## Transfer ownership

Stop the old writer and observe its exit. Managed processes must exit before transfer. Heartbeat expiry is not stop evidence. Handle every active descendant explicitly: preserve its execution with reporting redirected, or stop/release it with actual evidence. Keep dirty files and uncommitted work accounted for.

Call `relay_task_handoff` with latest expected version and the chosen destination Run according to the discovered schema. The epoch changes and old credentials become stale. Release only work that has actually stopped. Unknown external writers require confirmed stop in a shared directory, or an isolated destination with explicit uncertainty and a later integration plan.

## Resume in a new client or chat

Register a new Run for the new session, read focused context plus the inbox, and inspect real files, branch, worktree, processes and unfinished changes. Investigate unknown external-operation results before retrying. Compare actual observations with the old packet; use current server ownership and epoch.

Call `relay_task_reconcile` with observed facts and next step before new writes. If destination isolation was used, preserve the old worktree and record how outstanding changes will be reconciled. Post a concise receipt naming what was recovered, what remains uncertain and the next action. Resume ordinary execution and checkpoints from that point.

When code was committed, carry the exact commit hashes, worktree and uncommitted state into the handoff packet. Continue using [git-commit-style](../git-commit-style/SKILL.md) for subsequent commits.
