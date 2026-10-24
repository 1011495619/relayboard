---
name: relay-review
description: 核对交付证据，验收子任务和集成结果。 用于 Relayboard 项目中的独立验收者流程，支持 Codex、Claude Code、pi 及原生子 agent；需已连接共享 Relayboard 服务。
---

# 验收与集成

Use the running Relayboard service as the shared state store. Respect the project objective and the user's existing permissions. MCP tools are named `relay_*` (a client may add a prefix). Discover their schemas before supplying fields. If using CLI, use the absolute CLI path from `/api/integration`: `node <cli> query <name> -` or `node <cli> command <operation> -`, sending a JSON object on stdin. The CLI uses RELAYBOARD_URL and optional RELAYBOARD_TOKEN; do not log tokens.

Register the current session with `relay_agent_register` and retain its own Run ID. A new chat gets a new Run; logical agent identity does not transfer task ownership. Read focused `relay_project`, `relay_task`, `relay_context` and `relay_inbox` queries. Respect `truncated` and fetch missing referenced facts when needed; avoid loading the entire event history. Acknowledge addressed messages and record agreed interface decisions with `relay_decision_record`.

Use latest `expected_version` for structural/ownership changes and the returned `claim_epoch` for owned updates. On stale state, re-read and reconsider. A heartbeat is a liveness report, not work or proof of exit. Scope checks coordinate cooperating clients; actual parallel file isolation requires separate Git worktrees. If the service is unreachable, save IDs, epoch, facts and next step locally, restore the connection before shared ownership changes or new parallel dispatch.

## Verify independently

Use an independent reviewer Run or the human. Read the task acceptance, relevant decisions, current artifacts and recorded verification. Inspect the actual files/commit/worktree and reproduce checks appropriate to the change. Past logs only establish the recorded version and time. Keep the reviewer independent of the implementing Run; read-only review is usually enough.

Check that the delivered outcome matches the acceptance, scope and interfaces, and that failed or missing evidence is not presented as a passing result. A submitted task is still waiting for acceptance.

## Accept or return

Use `relay_task_review` with `accepted: true` only after the evidence supports the complete acceptance. Supply the reviewer's own identity and current expected version as required by the tool schema. If incomplete, use `relay_task_review` with `accepted: false` with actionable observations, artifact locations and the next correction. Do not invent a passing command or substitute the implementer's identity for a reviewer.

For a coordinator, verify all required children have been accepted and review fresh integration evidence produced after their acceptance. Child success alone does not establish that the combined result works. If integration fails, return the coordinator with concrete findings and coordinate any new executable work through the shared board.

Save the review result and affected task IDs in durable messages/decisions as appropriate. Acceptance is an evidence-backed state change, not a button used to clear the board.
