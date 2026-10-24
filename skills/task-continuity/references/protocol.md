# Relayboard protocol reference

MCP, HTTP and CLI use the same shared service. A local stdio bridge does not create another database. Discover schemas one at a time with `relayboard tools <tool>`; do not copy all tool schemas into each child packet.

## Daily execution

1. `relay_agent_register {project_id, name, runtime, workdir, parent_run_id?}` → retain `run.id`.
2. `relay_work_start {run_id, task_id?}` → resume own task or atomically claim eligible work; read returned guide.
3. At recover, inspect actual files/processes and full required decisions; receive required dependency artifacts.
4. `relay_work_report {handle, kind:"recover", summary, observed, read_decision_ids, dependency_receipts}` → return refreshed guide.
5. Execute current step; `relay_work_report {handle, kind:"step", step_id, summary, artifacts?}`. Use progress for partial work, blocked for obstacles, verify for real checks and submit for delivery.
6. `relay_work_next {run_id, task_id, max_chars?}` is a focused read at any point. Use its latest handle for the next report.

The handle includes task/Run IDs, claim epoch, task version and a context_version digest. Copy all returned fields unchanged. Never cache it across reports, contract/plan changes or handoff. A new chat registers a new Run; supplying the old logical agent identity does not transfer claims. `work_start` does not take another Run's task.

## Guide stages

| Stage | Executor action |
| --- | --- |
| recover | Read references and inspect the actual scene; report observed facts and actual decision/dependency receipts. |
| execute | Perform only current_step; follow done_when and on_failure. |
| blocked | Preserve facts and request the missing input, scope or capability. |
| verify | Run relevant checks on the delivered revision and report actual results. |
| submit | Submit evidence for independent review. |
| review | Wait for independent acceptance or correction; do not self-accept. |
| wait_children | Resolve required child acceptance and integration before parent delivery. |
| done | No further implementation; new work needs a new task. |
| unavailable | Read eligibility/ownership reasons; coordinate instead of taking occupied work. |

`next_action.arguments` is a template requiring real observations where indicated. Fill actual facts, never repeat instructional placeholders as evidence. Read `warnings`, packet omissions and full required decisions before acknowledging them. “Dependency done” is not a local integration receipt.

## Terminal example

```sh
relayboard call relay_work_start - <<'JSON'
{"run_id":"YOUR_RUN_ID","task_id":"TASK_ID"}
JSON
```

Copy the returned handle unchanged into the next report. The example below illustrates field shape; substitute the real handle, observations and IDs from the guide:

```json
{
  "handle": {
    "task_id": "TASK_ID",
    "run_id": "YOUR_RUN_ID",
    "claim_epoch": 2,
    "task_version": 7,
    "context_version": "DIGEST_FROM_LATEST_GUIDE"
  },
  "kind": "recover",
  "summary": "已核对现场、契约和依赖成果",
  "observed": "实际 cwd/branch、git status、相关进程及成果核验结果",
  "read_decision_ids": ["DECISION_ID_ACTUALLY_READ"],
  "dependency_receipts": [
    {"task_id":"DEPENDENCY_TASK_ID","revision":"REVISION_FROM_GUIDE_DEPENDENCY","note":"如何确认本地包含该成果"}
  ]
}
```

Dependency revision is the service-generated artifact digest from `guide.dependencies`, not a Git hash. Copy that revision into the receipt and explain in note how you verified the actual artifacts are received locally. Required `read_decision_ids` must cover every relevant decision, including records omitted from the bounded guide: fetch `relay_decisions` with task_id and follow all pages before acknowledging. Discover current schema if uncertain. Progress reports can preserve `facts`, `failed_attempts`, `uncertain_actions`, `next_step`, artifact paths and real verification. Results supplied by an agent are self-reported; a service-observed Git fingerprint alone does not establish test execution.

For tasks without an execution plan, save `progress` with `ready_for_verification: true` only when implementation is ready for checks. Planned tasks become ready after all ordered steps complete. A `verify` report requires a nonempty verification array with actual command/result/pass values. Failed checks can be corrected and retried. The service labels supplied test results agent_reported and can mark evidence stale after observed Git changes.

## Coordination and old-service fallback

Coordinators retain structural tools. Use latest `expected_version` for split/update/handoff/review; task_split returns a new `parent.claim_epoch`. Scoped reports through low-level tools require the current owner and epoch. Do not omit actor identity to impersonate human approval.

An older service without work tools uses `eligible` → `task_claim` → `task_checkpoint` → `task_submit`; transferred tasks require `task_reconcile` first. Read tool schemas and retain returned versions. REST terminal access uses `node <absolute-cli> query <name> -` / `command <operation> -`; `call` is actual MCP. Use `RELAYBOARD_URL` and optional inherited token. Stable request IDs support retrying the same mutation; first investigate unknown results, particularly external operations.

## State errors

CONTRACTS_UNREAD requires reading every required decision and resending its IDs; DEPENDENCIES_NOT_RECEIVED requires actually receiving/confirming the listed artifacts and using their guide revision in receipts. On stale handle/version/epoch/context, fetch work_next or current task and reconsider. Ownership changes require explicit handoff. Scope conflicts require independent work or negotiation; scope expansion needs approval. Active managed writers must exit before transfer, and active descendants need an explicit policy. Failed or stale evidence requires verification of the current revision. If the guided schema is unsupported, use the documented old-service sequence rather than fabricating success.

Run heartbeats identify reported liveness, not progress or stopped processes. Scope checks coordinate trusted clients; use actual Git worktrees for parallel files. Read focused records and paged decisions; full snapshots/history are exceptional diagnostic reads. If disconnected, preserve local facts and reconnect before changing shared ownership or dispatching more writers.
