# Relayboard protocol reference

The service exposes the same operations via MCP, HTTP and CLI. A local stdio bridge talks to the one shared service; it never starts a separate task database.

## Minimal sequence

1. `relay_projects {}` → select the intended project.
2. `relay_agent_register {project_id, name, runtime, workdir, capabilities, parent_run_id?}` → retain `run.id`.
3. `relay_eligible {project_id, run_id}` → choose a task with `eligible: true`.
4. `relay_task_claim {task_id, run_id, expected_version}` → retain `claim_epoch`.
5. `relay_task_checkpoint {task_id, run_id, claim_epoch, summary, next_step, artifacts, verification}`.
6. `relay_task_submit {task_id, run_id, claim_epoch, summary}` → independent acceptance follows.

Registration creates a logical agent plus a Run. To preserve an existing logical identity in a new session, supply `agent_id`; the new Run receives a new ID. It does not inherit old claims automatically.

## CLI fallback

Set `RELAYBOARD_URL` to the shared service URL (default `http://127.0.0.1:4317`). If authentication is enabled, inherit `RELAYBOARD_TOKEN` without putting it in logs. Use the absolute CLI path supplied by the operator or `/api/integration`.

```bash
node /path/to/relayboard/bin/relayboard.js query projects
node /path/to/relayboard/bin/relayboard.js query eligible - <<'JSON'
{"project_id":"PROJECT_ID","run_id":"YOUR_RUN_ID"}
JSON
node /path/to/relayboard/bin/relayboard.js command task_checkpoint - <<'JSON'
{
  "task_id": "TASK_ID",
  "run_id": "YOUR_RUN_ID",
  "claim_epoch": 1,
  "summary": "Observed progress, distinct from plans.",
  "next_step": "One concrete next action.",
  "artifacts": [{"path":"src/login.js","kind":"file"}],
  "verification": [{"command":"npm test","result":"Actual observed result","passed":true}]
}
JSON
```

Use an optional stable request ID as the fourth argument to `command` when retrying an uncertain request. Reusing the ID with different arguments is rejected. Re-read state before retrying a non-idempotent external action.

## Errors that change the next action

| Code | Next action |
| --- | --- |
| `STALE_VERSION` | Refresh task state; reconsider changes against the new version. |
| `STALE_CLAIM` | Stop submitting work under old credentials; read the handoff and contact the current owner. |
| `NOT_ELIGIBLE` / `SCOPE_CONFLICT` | Read the reasons; choose independent work or negotiate a bounded split. |
| `RECONCILE_REQUIRED` | Inspect actual files/processes and call `task_reconcile` before writing. |
| `DELEGATION_SCOPE` / `OUTSIDE_PARENT_SCOPE` | Request upstream scope changes or create work within the assigned envelope. |
| `PROCESS_RUNNING` | Stop the managed process and observe its actual exit before transfer. |
| `DESCENDANTS_ACTIVE` | Explicitly preserve or stop descendant tasks. |
| `HUMAN_PLANNING` | Submit a proposal for human confirmation. |
| `EVIDENCE_REQUIRED` | Record artifacts and real verification before submission. |

## Progress, identity and trust

Run heartbeats indicate liveness reports; checkpoints indicate work. `self`, `parent`, `adapter` and `manual` identify observation source. The local service assumes trusted cooperating clients; actor IDs are attribution, not independent per-agent authentication. Do not impersonate another Run or omit your identity to claim human approval.

MCP tools can be discovered with the client's tool listing. `relay_snapshot` contains the task tree, runs, decisions and proposals; use focused queries during ordinary execution. Event pages have a monotonic sequence cursor. Native client logs remain external artifacts; arbitrary log text is not interpreted as commands or proof of completion.
