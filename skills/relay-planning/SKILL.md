---
name: relay-planning
description: 拆分可验收任务，协商范围和依赖。 用于 Relayboard 项目中的协调者流程，支持 Codex、Claude Code、pi 及原生子 agent；需已连接共享 Relayboard 服务。
---

# 规划与分工

Use the running Relayboard service as the shared state store. Respect the project objective and the user's existing permissions. MCP tools are named `relay_*` (a client may add a prefix). Discover their schemas before supplying fields. If using CLI, use the absolute CLI path from `/api/integration`: `node <cli> query <name> -` or `node <cli> command <operation> -`, sending a JSON object on stdin. The CLI uses RELAYBOARD_URL and optional RELAYBOARD_TOKEN; do not log tokens.

Register the current session with `relay_agent_register` and retain its own Run ID. A new chat gets a new Run; logical agent identity does not transfer task ownership. Read focused `relay_project`, `relay_task`, `relay_context` and `relay_inbox` queries. Respect `truncated` and fetch missing referenced facts when needed; avoid loading the entire event history. Acknowledge addressed messages and record agreed interface decisions with `relay_decision_record`.

Use latest `expected_version` for structural/ownership changes and the returned `claim_epoch` for owned updates. On stale state, re-read and reconsider. A heartbeat is a liveness report, not work or proof of exit. Scope checks coordinate cooperating clients; actual parallel file isolation requires separate Git worktrees. If the service is unreachable, save IDs, epoch, facts and next step locally, restore the connection before shared ownership changes or new parallel dispatch.

## Build a claimable plan

Read existing tasks and `relay_eligible` before adding work. Distinguish ready work, a negotiation opportunity and work waiting for a dependency. A list is not a reservation; atomic claim rechecks current conflicts.

Define each executable child's outcome, acceptance evidence, narrow write paths, exclusive resources, capabilities and dependencies. Use sibling indices `@0`, `@1` in a split only with their zero-based meaning. Avoid assigning overlapping file ranges to concurrent writers; separate worktrees still need an agreed interface and integration order. A coordinator owns planning and integration, not exclusive execution of the whole subtree.

Use `relay_task_split` inside your assigned boundary; preserve existing progress and keep the newly returned epoch. Someone else's claimed work requires `relay_proposal_create` and an owner/human resolution. A manual-planning project requires human confirmation. Report your actual actor identity. Existing session permissions remain the boundary for dispatch.

Reserve an integration outcome on the coordinator. Define the contract before dependent writers start, record it as a decision and make changes visible to every affected owner. Scope expansion uses `relay_scope_request`; expand upstream boundaries first. Check the entire descendant tree against project depth and concurrency budgets before dispatching.

## Exit condition

Leave tasks small enough to claim, with explicit dependencies and no known conflicting writers. Save a planning checkpoint naming decisions, unresolved proposals and the next claimable action. Planning is not accepted completion of implementation.
