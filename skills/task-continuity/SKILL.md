---
name: task-continuity
description: Join or recover persistent Relayboard work across Codex, Claude Code, pi and nested subagents. Use when entering a shared task workspace or recovering after context compaction; route to focused planning, execution, subagent, review or handoff workflows. Requires a running Relayboard service.
---

# Task continuity

Use Relayboard to continue an assigned task without loading the old conversation. Start with the task ID and service connection; preserve the project's objective and user constraints.

## The everyday loop

1. Register this actual session with `relay_agent_register`; keep `run.id`. A native descendant supplies its own `parent_run_id`. Registration records a session; it does not transfer another session's work.
2. Call `relay_work_start {run_id, task_id?}`. It resumes this Run's task or atomically claims eligible work. If it reports unavailable, read the reasons and request coordination; do not take an occupied task.
3. Read the returned guide: stage, constraints, warnings, decisions, dependencies, current step and next action. Check both guide-level `truncated`/`omissions` and `context.truncated`; retrieve omitted records before acting. Page `work_dependencies` and `work_requests` until `next_offset` is null when those lists are incomplete. Use `relay_work_next {run_id, task_id}` whenever state may have changed.
4. At `recover`, inspect the actual directory, branch, local changes, relevant processes and dependency artifacts. Read full required decisions. Send `relay_work_report` with `kind: "recover"`, the **latest returned handle**, real observations, `read_decision_ids`, and receipts for dependency revisions actually present locally.
5. Execute only the current step within assigned scope. Report partial facts with `progress`, completed current steps with `step`, obstacles with `blocked`, real checks with `verify`, and delivery with `submit`. Without an execution plan, report `progress` with `ready_for_verification: true` when ready for checks; planned tasks become ready when all steps complete. Complete the fields named by `next_action.required_fields` with actual facts; its arguments deliberately omit summary/observed and are not a ready-made report. Follow the returned next action. Report failures and unknown outcomes; do not guess that they succeeded.

A handle contains task/Run IDs, execution epoch, task version and context digest. Copy it from the latest guide rather than constructing it from memory. On stale ownership or version, fetch a fresh guide and reconsider; no automatic takeover or blind replay. Even a recovered session must re-check when plans, contracts or dependencies change. Requirement/contract changes conservatively reset affected task steps; a pure ownership handoff with unchanged requirements preserves completed steps. Read unresolved task/ancestor requests with `work_requests`, including those addressed to an old owner. Acknowledge reading with `message_ack`; record actual handling separately with `message_resolve` and a result note.

## Keep recovery possible

Save facts after meaningful progress and before compaction, delegation or exit: changes, artifact/commit locations, failed attempts, unknown operation results and one concrete next action. Lifecycle hooks export already saved state; they do not reconstruct unreported progress. Heartbeats indicate liveness, not task completion or proof that a writer stopped.

The guide reduces coordination decisions; it does not establish that the agent understands every technical problem. Report a blocker when the next action is ambiguous, a required capability is missing, acceptance conflicts with the contract, or work would exceed scope. Keep large logs in referenced artifacts.

## Load only the role needed

| Action | Bundled Skill |
| --- | --- |
| Plan steps, dependencies, scopes and contracts | relay-planning |
| Execute, checkpoint and submit | relay-execution |
| Dispatch and report native descendants | relay-subagents |
| Independently inspect and accept | relay-review |
| Transfer ownership and recover | relay-handoff |
| Inspect cross-project patrol and bounded recovery | relay-supervisor |
| Commit or write commit messages | git-commit-style |

These role skills are self-contained. If only this skill is installed, read [references/workflow.md](references/workflow.md) for coordination and handoff rules. Tool examples, stages, stale handles and old-service fallback are in [references/protocol.md](references/protocol.md); load them only when needed.

## Project memory and patrol

Use `relay_memory_search` for relevant project lessons, then `relay_memory_get` by ID/version for evidence. Summaries omit full bodies; avoid loading the whole library or old conversation. Save reusable verified facts, runbooks and failed approaches with `relay_memory_save`, source and evidence; exclude credentials. Current project constraints and decisions take precedence over memory. `relay_memory_sources` lists explicit remote libraries; only send a focused query via `relay_memory_remote_search` when appropriate.

When a patrol reminder arrives, read `work_next` and report actual progress or a specific blocker. Heartbeat and log output do not resolve a stall. Replacement Runs still recover files and report every native descendant separately. `relay_supervisor_status` explains reminders, recovery attempts and budgets; failed client login or tool approval needs configuration, not repeated blind relaunches.
