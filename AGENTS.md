# Relayboard development

Read the assigned Relayboard task and context before editing. Prefer work_start → work_next → work_report, copying the current handle unchanged. Recover actual files, full contracts and received dependency revisions first; execute the current ordered step, save failed attempts and unknown outcomes, and report blockers without inventing recovery. Read all omission/pagination references. A read acknowledgement is not request resolution. Register each actual execution session and every native descendant with its own Run. Parallel writers use separate Git worktrees and explicit scopes. Save real checkpoints and directed reports through the MCP service.

The source is strict TypeScript. Run `npm run check` before delivery; published packages contain compiled JavaScript in `lib/` and web assets in `dist/`. Preserve stored data and existing coordination invariants.

When committing or writing commit messages, apply `skills/git-commit-style/SKILL.md`: title `类型(范围): 简述`, at most 50 characters; blank line; Chinese body explaining why, without enumerating files. Types: `feat`, `fix`, `refactor`, `docs`. One purpose per commit. Do not include another writer’s changes or runtime databases. Record hashes and test evidence on the board.

Search project memory on demand; read full evidence at the returned ID/version before relying on a summary. Save reusable verified facts with source and evidence, excluding secrets. Historical memory does not replace current task contracts. Supervisor reminders require actual progress or a concrete blocker report; they do not prove that any writer stopped. Default observation creates no model requests. Explicit recovery policies retain per-project and per-task budgets.

Use a focused feature/fix/chore branch for new work. Keep generated releases in the sibling releases/<version>/ directory via npm run release:local; do not overwrite archived versions or commit runtime data. Follow docs/DEVELOPMENT.md for directory and push conventions. Preserve old worktrees with uncommitted changes when cleaning the workspace.
