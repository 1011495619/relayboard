---
name: relay-planning
description: 拆分可验收任务，协商范围和依赖。 用于 Relayboard 项目中的协调者流程，支持 Codex、Claude Code、pi 及原生子 agent；需已连接共享 Relayboard 服务。
---

# Plan executable handoffs

Use the shared running Relayboard service. Discover one tool schema with `relayboard tools <tool>`; invoke real MCP with `relayboard call <tool> -` and JSON on stdin. The service URL is `RELAYBOARD_URL`; inherit optional `RELAYBOARD_TOKEN` without logging it. Register this session with `relay_agent_register`, retain `run.id` (not `agent.id`), and use a new Run for a new chat. Never reuse another executor's identity.

Read existing tasks and `relay_eligible` before creating work. Distinguish ready work, negotiation and unmet dependencies. A list is not a reservation; claims recheck current conflicts.

## Write instructions the next executor can follow

Every executable task needs an outcome, acceptance evidence, narrow write paths/resources and dependencies. Add `execution` when the task benefits from an ordered procedure:

- `inputs`: exact artifacts, contracts and prerequisites to read or receive.
- `outputs`: deliverables and their expected locations.
- `steps`: stable unique IDs, title, concrete instructions, `done_when` and `on_failure` for each step.
- `stop_when`: conditions requiring a blocker or coordination instead of improvisation.

Specify what can be observed, not an implementation guess presented as fact. Keep steps at meaningful work boundaries; allow judgment within each step. Provide a useful failure action such as inspecting a particular contract, recording a failed test or requesting a named dependency. A vague “continue implementing” instruction forces the next agent to re-plan.

Record agreed interfaces using `relay_decision_record` with affected task IDs before parallel writers start. Distinct worktrees isolate files but do not establish compatibility. Define how exact commits/artifacts reach dependent worktrees and reserve coordinator integration checks. “Dependency done” alone does not prove its revision is present locally.

## Coordinate ownership

Use `relay_task_split` on your own task within its boundary. It converts the parent to coordinator and returns a new `parent.claim_epoch`; retain it. Sibling dependency indices `@0`, `@1` are zero-based. Creating children under an assigned coordinator requires its owner or a confirmed proposal.

For someone else's claimed task, use `relay_proposal_create` and wait for owner/human resolution. Manual-planning projects require human confirmation. Always supply your actual actor identity. Scope expansion uses `relay_scope_request`, with upstream boundaries expanded first. Keep the entire descendant tree within project depth/concurrency budgets.

Dispatch explicit leaf tasks. Their executors use `work_start` → read guide → `work_report recover` → current step. Plan or contract changes require fresh recovery; communicate the reason and preserve useful completed-work evidence. Do not silently take ownership or treat the coordinator as an exclusive writer of the whole subtree.

Leave a planning checkpoint naming confirmed decisions, unresolved proposals and the next action. Planning completion is not implementation acceptance. For commits, apply [git-commit-style](../git-commit-style/SKILL.md).
