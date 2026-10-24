---
name: relay-subagents
description: 登记每层身份，派发任务并报告进度。 用于 Relayboard 项目中的父子执行者流程，支持 Codex、Claude Code、pi 及原生子 agent；需已连接共享 Relayboard 服务。
---

# Give every descendant a recoverable task

Use the shared running Relayboard service. Discover one tool schema with `relayboard tools <tool>`; invoke real MCP with `relayboard call <tool> -` and JSON on stdin. The service URL is `RELAYBOARD_URL`; inherit optional `RELAYBOARD_TOKEN` without logging it. Register this session with `relay_agent_register`, retain `run.id` (not `agent.id`), and use a new Run for a new chat. Never reuse another executor's identity.

## Register before native dispatch

Register each actual child and grandchild separately with its correct `parent_run_id`, runtime, workdir, branch and delegated scope. Registration does not launch a process. Dispatch follows the user's existing permissions and project budgets.

Assign an explicit executable task. Use `relay_work_start` with the child's own Run/task ID or atomic `relay_task_claim` and then a guide. Never pass the parent's Run/handle as the child's credentials; inherited environment variables may still identify the parent. Parallel writers use separate actual Git worktrees and agreed scopes/interfaces.

## Minimum child packet

```text
Shared service URL and connection method:
Project ID / assigned task ID:
Your own Run ID / parent Run ID:
Actual worktree / branch / allowed paths:
Entry: work_start with your own Run and task
Read guide, inspect actual state, report recover before editing
Execute only the current step; report progress, blockers and delivery
Parent reporting destination:
```

Let the service provide current handles, steps, contracts and dependency receipts. Include tool access and how to fetch a missing/truncated record. If the assignment lacks executable instructions, clarify it before dispatch. Pass [git-commit-style](../git-commit-style/SKILL.md) when commits are part of the task.

## Report through every level

Each child uses `work_report` on its own task and sends directed blockers, delivery and review requests to its parent. Save actual facts before compaction/exit. The parent reads/acknowledges reports and summarizes coordinator progress; it does not fabricate a child's test results or completion.

Where native lifecycle events are unavailable, explicitly forward real child reports with their source. A relay message persists information; waking an external idle client needs a supported adapter/runner or polling. A registered or unseen child is not proof of a running/stopped process. Heartbeat observation (`self`, `parent`, `adapter`) retains provenance.

Before parent handoff, handle every active descendant: preserve its task and redirect reports explicitly, or stop/release it with exit evidence. Never release a subtree solely because the parent chat ended. Independent acceptance follows child submission. After required children are accepted and their exact changes are integrated, record fresh coordinator verification.

## Project memory and patrol

Use `relay_memory_search` for relevant project lessons, then `relay_memory_get` by ID/version for evidence. Summaries omit full bodies; avoid loading the whole library or old conversation. Save reusable verified facts, runbooks and failed approaches with `relay_memory_save`, source and evidence; exclude credentials. Current project constraints and decisions take precedence over memory. `relay_memory_sources` lists explicit remote libraries; only send a focused query via `relay_memory_remote_search` when appropriate.

When a patrol reminder arrives, read `work_next` and report actual progress or a specific blocker. Heartbeat and log output do not resolve a stall. Replacement Runs still recover files and report every native descendant separately. `relay_supervisor_status` explains reminders, recovery attempts and budgets; failed client login or tool approval needs configuration, not repeated blind relaunches.
