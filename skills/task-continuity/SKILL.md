---
name: task-continuity
description: Join or recover persistent Relayboard work across Codex, Claude Code, pi and nested subagents. Use when entering a shared task workspace or recovering after context compaction; route to focused planning, execution, subagent, review or handoff workflows. Requires a running Relayboard service.
---

# Task continuity

Use the running Relayboard service as the shared state store. Respect the project objective and the user's existing permissions. MCP tools are named `relay_*` (a client may add a prefix). Discover their schemas before supplying fields. For true MCP through the terminal, use `relayboard tools` for a compact inventory, `relayboard tools relay_agent_register` for the exact input schema, and `relayboard call relay_agent_register -` with JSON on stdin. `call` connects to the running shared `/mcp` endpoint. For REST CLI, use the absolute CLI path from `/api/integration`: `node <cli> query <name> -` or `node <cli> command <operation> -`, sending a JSON object on stdin. The CLI uses RELAYBOARD_URL and optional RELAYBOARD_TOKEN; do not log tokens.

Register the current session with `relay_agent_register`; it returns `{ agent, run }`. Retain `run.id` for claims, checkpoints and inbox; `agent.id` is the logical identity. A new chat gets a new Run; logical agent identity does not transfer task ownership. Read focused `relay_project`, `relay_task`, `relay_context` and `relay_inbox` queries. Respect `truncated` and fetch missing referenced facts when needed; avoid loading the entire event history. Acknowledge addressed messages and record agreed interface decisions with `relay_decision_record`.

Use latest `expected_version` for structural/ownership changes and the returned `claim_epoch` for owned updates. On stale state, re-read and reconsider. A heartbeat is a liveness report, not work or proof of exit. Scope checks coordinate cooperating clients; actual parallel file isolation requires separate Git worktrees. If the service is unreachable, save IDs, epoch, facts and next step locally, restore the connection before shared ownership changes or new parallel dispatch.

## Choose only the workflow needed now

The bundled role skills are independent entry points. If installed, load only the role needed for the current action:

| Workflow | Skill |
| --- | --- |
| Decompose goals, negotiate another owner's task, agree dependencies | relay-planning |
| Claim, execute, checkpoint and submit evidence | relay-execution |
| Register native descendants, dispatch and forward real reports | relay-subagents |
| Independently verify a submission and combined result | relay-review |
| Stop old writers, transfer and reconcile in a new session | relay-handoff |
| Commit code or write a commit message | git-commit-style |

When only this skill is installed, read [references/workflow.md](references/workflow.md) for the equivalent complete workflow. For tool sequence, CLI fallback and state errors, read [references/protocol.md](references/protocol.md). Keep those references unloaded until needed.

## Recover before acting

Read the assigned task's bounded context and actual working files. Register a new Run for a new chat, with correct parent ancestry for a native descendant. For transferred work, reconcile real files and old-writer status before writing. Otherwise query eligible work and claim atomically with the latest version. Own every checkpoint with your own Run and current epoch.

Record a concise checkpoint after meaningful progress and before compaction or exit: facts, exact artifacts, observed checks, unresolved outcomes and next action. Messages persist in the service; external clients must poll or use a supported runner/adapter to receive them. Preserve user constraints and established permissions throughout recovery.
