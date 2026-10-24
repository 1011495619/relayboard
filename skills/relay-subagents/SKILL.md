---
name: relay-subagents
description: 登记每层身份，派发任务并报告进度。 用于 Relayboard 项目中的父子执行者流程，支持 Codex、Claude Code、pi 及原生子 agent；需已连接共享 Relayboard 服务。
---

# 子 agent 协作

Use the running Relayboard service as the shared state store. Respect the project objective and the user's existing permissions. MCP tools are named `relay_*` (a client may add a prefix). Discover their schemas before supplying fields. If using CLI, use the absolute CLI path from `/api/integration`: `node <cli> query <name> -` or `node <cli> command <operation> -`, sending a JSON object on stdin. The CLI uses RELAYBOARD_URL and optional RELAYBOARD_TOKEN; do not log tokens.

Register the current session with `relay_agent_register` and retain its own Run ID. A new chat gets a new Run; logical agent identity does not transfer task ownership. Read focused `relay_project`, `relay_task`, `relay_context` and `relay_inbox` queries. Respect `truncated` and fetch missing referenced facts when needed; avoid loading the entire event history. Acknowledge addressed messages and record agreed interface decisions with `relay_decision_record`.

Use latest `expected_version` for structural/ownership changes and the returned `claim_epoch` for owned updates. On stale state, re-read and reconsider. A heartbeat is a liveness report, not work or proof of exit. Scope checks coordinate cooperating clients; actual parallel file isolation requires separate Git worktrees. If the service is unreachable, save IDs, epoch, facts and next step locally, restore the connection before shared ownership changes or new parallel dispatch.

## Register before dispatch

Every native child and grandchild needs a separate `relay_agent_register` call with the correct `parent_run_id`. Use actual runtime, permitted delegated scope, workdir and branch. Registration records identity; it does not start a process. Existing user permissions determine whether dispatch itself is authorized.

Assign each writer a separate executable task through atomic claim. A coordinator's broad boundary does not reserve every child. Do not reuse the parent's Run ID or claim epoch in child reports; inherited environment variables may still identify the parent. Keep the full descendant tree inside project depth and concurrency budgets.

## Child packet

Pass the following concrete values to each child:

```text
Project / task ID:
Your OWN Run ID / parent Run ID / claim epoch:
Goal / acceptance criteria:
Permitted write paths / exclusive resources:
Actual worktree / branch:
Dependencies / agreed interfaces:
Checkpoint and inbox tools:
Next action / reporting destination:
```

Parallel code writers use distinct actual Git worktrees and disjoint agreed scopes. Record contracts before dispatch. Scope expansion goes through `relay_scope_request`; a child never expands beyond its parent's permitted envelope without upstream changes.

## Report through every level

Children checkpoint their own tasks and send directed blockers, deliveries and review requests to their parent. The parent reads and acknowledges those reports, then summarizes progress on the coordinator. If a child lacks direct service access, the parent explicitly forwards its actual report with source attribution; preserve the child's own identity and distinguish observed facts from an unverified claim.

Use client lifecycle adapters where available. Otherwise report child starts, checkpoints, blockers, delivery and observed exits explicitly. `relay_run_heartbeat` observation distinguishes self/parent/adapter reports. An unseen child is unknown, not stopped or complete.

Before transfer, preserve each active descendant and redirect reporting explicitly, or stop/release it with evidence. Never release an entire subtree merely because the parent chat ended. Child submission still requires independent acceptance; after required children are accepted, run and record fresh coordinator integration checks.
