# Complete coordination workflow

Daily execution is `agent_register` → `work_start` → read guide and inspect scene → `work_report recover` → current step → verification → submission. Each report uses the latest returned handle. Pass `view:"action"` to work_start/work_next/work_report for the compact guide; it returns the next handle after report and omits full bodies, but its `omissions`/`references` still require supplementing contracts, dependencies and requests. Tool details and fallback: [protocol.md](protocol.md).

## Plan for a reader without the old chat

Define task outcome, acceptance, scopes/resources and dependency IDs. Optional execution instructions provide exact inputs, outputs, ordered uniquely identified steps (instructions, done_when, on_failure) and stop_when conditions. Include failed attempts and unknown outcomes in checkpoints so a new executor does not repeat them blindly.

Record agreed interfaces as decisions linked to affected tasks before parallel work. Define artifact/commit delivery into dependent worktrees; an accepted dependency may still be absent locally. Plan a coordinator integration outcome. Keep steps concrete enough to execute and flexible enough for the task's technical judgment.

## Split and claim

Read eligible work first. Coordinator ownership covers planning/integration, not every executable child. Split your assigned task using the service's latest version and actor ID; retain returned parent.claim_epoch. Sibling dependency indices @0, @1 are zero-based. Someone else's claimed task requires a proposal and owner/human approval. Manual-planning projects require human confirmation.

Use separate actual Git worktrees for parallel writers. Scope expansion is requested before writing; expand upstream boundaries first. Keep descendant scope, depth and concurrency within project budgets. Scope checks are coordination, not a file sandbox.

## Native descendants

Register every child/grandchild before native dispatch with its own Run, correct parent_run_id, workdir, branch and permitted scope. Pass service access, task ID, own Run ID, actual worktree, parent destination and instruction to use work_start/recover. Never inherit the parent's handle. Existing user permissions determine dispatch authorization.

Children preserve their own progress and send blockers/delivery to parents through the shared service. Parents acknowledge real reports and summarize; source attribution distinguishes direct facts, forwarded claims and adapter observations. An unseen child is unknown, not stopped or done. Supported native hooks are optional; when absent, report lifecycle observations explicitly.

## Checkpoint and communicate

Report actual progress before compaction, delegation, long operations or exit when model execution is available. Hooks export records already saved; they do not reconstruct unsaved conversation facts. Record concrete next action, failed attempts, unknown operations and evidence locations. Keep large logs as references. A service-observed revision identifies code, not proof of test execution. Guided verify replaces the current verification snapshot with the complete required check list, including failures; old failures remain in event history.

Read the directed inbox between steps. Acknowledge received messages, use work_requests pages for unresolved task/ancestor requests and message_resolve for actual handling, respond to requests and persist confirmed agreements as decisions. Receipt does not mean resolution. External idle clients require polling or a supported wakeup adapter/runner. Do not imply messages wake every client.

## Deliver and review

Follow guide stages, preserve failure evidence and submit actual artifacts/checks. A different reviewer Run or human accepts using task_review and latest expected_version. Coordinators require all required children accepted, their changes integrated and a fresh passing integration checkpoint afterward. Check both diff and [git-commit-style](../../git-commit-style/SKILL.md) for committed work.

## Transfer and recover

Checkpoint while the old session can report. Stop old writers and observe exit before handoff; heartbeat expiry proves neither exit nor release. Explicitly preserve active descendants and redirect reporting, or stop/release them with evidence. Unknown external writers need confirmed stop for a shared directory, or an isolated destination with uncertainty and integration plan.

Register the new session, hand off with current version and descendant policy, and let the new Run read work_start's recover guide. Inspect actual files/branch/processes, read full contracts, receive exact dependency revisions, investigate unknown results and report recover using the new handle. Changed contract/plan/dependency signatures require renewed recovery. Requirement/contract changes conservatively reset the affected task’s steps; a pure unchanged-contract handoff keeps completed steps. Read all work_dependencies pages and unresolved work_requests pages, including old-owner requests. Acknowledge reading separately from message_resolve processing notes. The old epoch is fenced. On old services use task_reconcile.

If disconnected, save a local checkpoint with IDs, last known state, facts and next step. Restore connection before shared ownership changes or new dispatch; do not create a competing task database. Reduced context and orderly steps support weaker executors, while hard technical judgments still require a suitable agent or human.
