---
name: relay-execution
description: 领取工作、保存检查点、交付证据。 用于 Relayboard 项目中的执行者流程，支持 Codex、Claude Code、pi 及原生子 agent；需已连接共享 Relayboard 服务。
---

# Execute the next guided step

Use the shared running Relayboard service. Discover one tool schema with `relayboard tools <tool>`; invoke real MCP with `relayboard call <tool> -` and JSON on stdin. The service URL is `RELAYBOARD_URL`; inherit optional `RELAYBOARD_TOKEN` without logging it. Register this session with `relay_agent_register`, retain `run.id` (not `agent.id`), and use a new Run for a new chat. Never reuse another executor's identity.

## Start or resume

Call `relay_work_start {run_id, task_id?}`. Read the returned guide before editing. An unavailable result means inspect the reasons, negotiate or select independent eligible work. A claimed task owned by another Run needs explicit handoff; registration and work_start do not transfer it.

At `recover`, inspect actual cwd, branch, local changes, relevant processes and dependency artifacts. Read the full decisions named in the guide, following omission references when truncated. Report `kind: "recover"` with observed facts, `read_decision_ids` and dependency receipts for artifacts actually received in this worktree: copy each service-generated dependency revision from the guide, and explain the actual receipt in note. Read all relevant decisions with task_id and pagination when the bounded guide omits any. Do not acknowledge unread contracts or another branch's unreceived artifacts.

## Work and report

Use `relay_work_next` after interruptions or changed state. Submit reports with the latest returned `handle` unchanged. The service checks ownership, epoch and task version; on a stale result, re-read rather than replaying old state.

- `progress`: save partial changes, facts, failed attempts, uncertain outcomes and one concrete next step.
- `step`: complete only the guide's current ordered step, using its `step_id` and evidence of `done_when`. A passing title or assertion alone is not evidence.
- `blocked`: explain the missing input, contract conflict or capability needed. Message the relevant coordinator and preserve unfinished state.
- `verify`: supply a nonempty verification array; record commands actually executed, their observed results and pass/fail values, with exact artifacts. Follow the guide when checks fail or evidence becomes stale.
- `submit`: request independent acceptance once the guide permits delivery. Submission does not accept the task.

When no execution plan exists, use `progress` with `ready_for_verification: true` once ready for checks. A planned task becomes ready after its ordered steps complete.

Stay inside assigned paths/resources. Request `relay_scope_request` for expansion. Stop and report when an execution instruction's `stop_when` applies, the next step is ambiguous, dependency artifacts are missing or an external action's result is unknown. Investigate unknown outcomes before retrying. Use distinct actual Git worktrees for parallel writers; interface consistency still needs coordination.

Save progress before compaction, delegation, long operations or exit when the client can execute a report. Export hooks only preserve records already saved. Read and acknowledge addressed messages between meaningful steps; a receipt is not proof that the request has been resolved.

## Commit and deliver

Apply [git-commit-style](../git-commit-style/SKILL.md): `类型(范围): 简述` within 50 characters, a blank line and Chinese rationale; only feat/fix/refactor/docs, one purpose per commit. Commit only assigned changes and record the exact hash and checks.

Verification results reported by an agent remain self-reported even when the service observes the Git revision. Verify the intended version, then submit. A different Run or the human accepts. When transferring unfinished work, checkpoint and handle old writers/descendants before explicit handoff.

On older services without work tools, use `relay_eligible` → `relay_task_claim` → `relay_task_checkpoint` → `relay_task_submit`, retaining latest `expected_version` and returned `claim_epoch`; transferred tasks require `relay_task_reconcile`. Discover schemas first.
