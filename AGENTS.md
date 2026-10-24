# Relayboard development

Read the assigned Relayboard task and context before editing. Prefer work_start → work_next → work_report, copying the current handle unchanged. Recover actual files, full contracts and received dependency revisions first; execute the current ordered step, save failed attempts and unknown outcomes, and report blockers without inventing recovery. Read all omission/pagination references. A read acknowledgement is not request resolution. Register each actual execution session and every native descendant with its own Run. Parallel writers use separate Git worktrees and explicit scopes. Save real checkpoints and directed reports through the MCP service.

The source is strict TypeScript. Run `npm run check` before delivery; published packages contain compiled JavaScript in `lib/` and web assets in `dist/`. Preserve stored data and existing coordination invariants.

When committing or writing commit messages, apply `skills/git-commit-style/SKILL.md`: title `类型(范围): 简述`, at most 50 characters; blank line; Chinese body explaining why, without enumerating files. Types: `feat`, `fix`, `refactor`, `docs`. One purpose per commit. Do not include another writer’s changes or runtime databases. Record hashes and test evidence on the board.
