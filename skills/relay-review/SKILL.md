---
name: relay-review
description: 核对交付证据，验收子任务和集成结果。 用于 Relayboard 项目中的独立验收者流程，支持 Codex、Claude Code、pi 及原生子 agent；需已连接共享 Relayboard 服务。
---

# Independently accept the delivered version

Use the shared running Relayboard service. Discover one tool schema with `relayboard tools <tool>`; invoke real MCP with `relayboard call <tool> -` and JSON on stdin. The service URL is `RELAYBOARD_URL`; inherit optional `RELAYBOARD_TOKEN` without logging it. Register this session with `relay_agent_register`, retain `run.id` (not `agent.id`), and use a new Run for a new chat. Never reuse another executor's identity.

Read the submitted task, acceptance, execution instructions, relevant decisions, artifacts and verification. A reviewer reads `relay_task`/`relay_context` and may use read-only `relay_work_next` for the owner's guide; viewing a guide does not authorize reporting as that owner.

## Verify the actual result

Use a different reviewer Run or human acceptance. Inspect the actual files, commit/worktree and dependent interfaces. Reproduce checks appropriate to the change. A service-observed revision identifies code state; it does not certify agent-reported commands were executed or that semantic correctness follows.

Check evidence freshness against the delivered code. Old logs only establish their recorded version/time. Inspect failed attempts and uncertain actions rather than treating a complete step checklist as proof. Missing required artifacts, unresolved blockers or stale verification need a concrete correction.

For commits, apply [git-commit-style](../git-commit-style/SKILL.md): single purpose, allowed type, title within 50 characters and Chinese rationale. Review the diff as well as its message.

## Accept or return

Use `relay_task_review` with your own `reviewer_run_id`, latest `expected_version`, accepted result and an evidence-based note. Accept only when the full task acceptance is supported. Otherwise return with specific observations, affected artifacts and next correction. The implementing Run does not self-accept.

For a coordinator, check all required children are accepted, exact delivered revisions are integrated and a fresh passing integration checkpoint was saved after child acceptance. Child success alone is insufficient. Preserve review conclusions in durable messages/decisions; “acknowledged” only records receipt of a message.

For independent recovery trials, give the new executor only the service connection, assigned task and relevant Skill. Record actual model/client, human interventions, missed constraints, repeated work and final acceptance. Do not describe a Codex trial as a smaller-model or Claude/pi trial.
