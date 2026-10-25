import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { Store } from "../server/store.ts";
import { Service, AppError } from "../server/domain.ts";
import { evidenceStale, emptyWorkflow } from "../server/workflow.ts";
import { problem } from "../server/problems.ts";
const code = (code: string) => (e: unknown) =>
  e instanceof AppError && e.code === code;
function fixture(t: TestContext, git = false) {
  const dir = mkdtempSync(join(tmpdir(), "relay-feedback-"));
  if (git) {
    execFileSync("git", ["init", "-q", dir]);
    execFileSync("git", ["-C", dir, "config", "user.name", "Fixture"]);
    execFileSync("git", [
      "-C",
      dir,
      "config",
      "user.email",
      "fixture@example.test",
    ]);
    writeFileSync(join(dir, "a.txt"), "original");
    writeFileSync(join(dir, "b.txt"), "other");
    execFileSync("git", ["-C", dir, "add", "."]);
    execFileSync("git", ["-C", dir, "commit", "-qm", "fixture"]);
  }
  const store = new Store(),
    s = new Service(store);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const p = s.execute("project_create", {
    name: "Feedback",
    objective: "Reliable finish",
    root_path: dir,
  });
  const register = (name = "owner") =>
    s.execute("agent_register", {
      project_id: p.id,
      name,
      runtime: "codex",
      workdir: dir,
    }).run;
  const task = s.execute("task_create", {
    project_id: p.id,
    title: "Task",
    acceptance: "Verify",
    scopes: ["a.txt"],
  });
  const run = register();
  const claimed = s.execute("task_claim", {
    task_id: task.id,
    run_id: run.id,
    expected_version: task.version,
  });
  const cp = (command: string, passed = true) =>
    s.execute("task_checkpoint", {
      task_id: task.id,
      run_id: run.id,
      claim_epoch: claimed.claim_epoch,
      summary: `Actual ${command}`,
      artifacts: [{ path: "a.txt" }],
      verification: [{ command, result: passed ? "pass" : "fail", passed }],
    });
  return { dir, store, s, p, run, task, claimed, register, cp };
}

test("legacy and guided evidence are immutable complete snapshots; failed history remains after replacement and restart", (t) => {
  const f = fixture(t);
  f.cp("obsolete", false);
  const latest = f.cp("new actual checks");
  assert.deepEqual(
    latest.verification.map((v) => v.command),
    ["new actual checks"],
  );
  const page = f.s.query("evidence_history", { task_id: f.task.id, limit: 1 });
  assert.equal(page.total, 2);
  assert.equal(page.items[0].current, true);
  assert.equal(page.next_offset, 1);
  const old = f.s.query("evidence_history", { task_id: f.task.id, offset: 1 });
  assert.equal(old.items[0].failures, 1);
  const full = new Service(f.store).query("evidence_history", {
    task_id: f.task.id,
    snapshot_id: old.items[0].id,
  });
  assert.equal(full.snapshot?.verification[0].passed, false);
  const submitted = f.s.execute("task_submit", {
    task_id: latest.id,
    run_id: f.run.id,
    claim_epoch: latest.claim_epoch,
    summary: "Ready",
  });
  assert.equal(submitted.status, "review");
});

test("scope content survives unrelated commits, own staging and commit; actual scoped changes still expire evidence", (t) => {
  const f = fixture(t, true);
  f.cp("actual check");
  writeFileSync(join(f.dir, "b.txt"), "unrelated commit");
  execFileSync("git", ["-C", f.dir, "add", "b.txt"]);
  execFileSync("git", ["-C", f.dir, "commit", "-qm", "unrelated"]);
  assert.equal(evidenceStale(f.s, f.s.task(f.task.id)), false);
  writeFileSync(join(f.dir, "a.txt"), "changed");
  assert.equal(evidenceStale(f.s, f.s.task(f.task.id)), true);
  f.cp("new check");
  execFileSync("git", ["-C", f.dir, "add", "a.txt"]);
  execFileSync("git", ["-C", f.dir, "commit", "-qm", "own checked bytes"]);
  assert.equal(evidenceStale(f.s, f.s.task(f.task.id)), false);
});

test("explicit human intent is required for anonymous review and cannot suppress supplied self identity", (t) => {
  const f = fixture(t);
  const cp = f.cp("check");
  const task = f.s.execute("task_submit", {
    task_id: cp.id,
    run_id: f.run.id,
    claim_epoch: cp.claim_epoch,
    summary: "Done",
  });
  const args = {
    task_id: task.id,
    expected_version: task.version,
    accepted: true,
    note: "Reviewed",
  };
  assert.throws(
    () => f.s.execute("task_review", args),
    code("REVIEW_IDENTITY_REQUIRED"),
  );
  assert.throws(
    () =>
      f.s.execute("task_review", {
        ...args,
        human_review: true,
        reviewer_run_id: f.run.id,
      }),
    code("SELF_REVIEW"),
  );
  assert.equal(
    f.s.execute("task_review", { ...args, human_review: true }).status,
    "done",
  );
});

test("takeover uses new identity, closed notices are specific, and unknown old writers retain their claim", (t) => {
  const f = fixture(t);
  f.cp("check");
  const b = f.register("new owner");
  f.s.execute("run_end", {
    run_id: f.run.id,
    status: "unknown",
    note: "Provider gone; stop not proven",
  });
  const preview = f.s.query("work_recovery", {
    task_id: f.task.id,
    run_id: b.id,
  });
  assert.equal(preview.known_stopped, false);
  assert.throws(
    () =>
      f.s.execute("work_takeover", {
        task_id: f.task.id,
        run_id: b.id,
        expected_version: preview.expected_version,
        reason: "Continue",
      }),
    code("OLD_WRITER_UNCONFIRMED"),
  );
  assert.equal(f.s.task(f.task.id).owner_run_id, f.run.id);
  f.s.execute("run_end", {
    run_id: f.run.id,
    status: "ended",
    note: "Human confirmed the old writer stopped",
  });
  const unrelated = f.s.execute("message_send", {
    project_id: f.p.id,
    task_id: f.task.id,
    to_run_id: b.id,
    kind: "request",
    body: "Must retain interface",
  });
  const g = f.s.execute("work_takeover", {
    task_id: f.task.id,
    run_id: b.id,
    expected_version: f.s.task(f.task.id).version,
    reason: "Confirmed stopped; new Run continues",
  });
  assert.equal(g.stage, "recover");
  assert.equal(g.handle?.run_id, b.id);
  f.s.execute("work_report", {
    handle: g.handle!,
    kind: "recover",
    summary: "Inspected actual fixture",
    observed: "Current files inspected; old writer stopped",
    read_decision_ids: [],
    dependency_receipts: [],
  });
  const snapshot = f.s.query("snapshot", { project_id: f.p.id });
  const handoff = snapshot.messages.find((m) => m.purpose === "handoff");
  assert(handoff?.resolved_at);
  assert(handoff?.acknowledged_at);
  assert.equal(
    snapshot.messages.find((m) => m.id === unrelated.id)?.resolved_at,
    undefined,
  );
  assert.throws(() => f.cp("old writer report"), code("STALE_CLAIM"));
});

test("compact board and schema discovery paginate without task bodies", (t) => {
  const f = fixture(t);
  for (let n = 0; n < 3; n++)
    f.s.execute("task_create", {
      project_id: f.p.id,
      title: `Child ${n}`,
      acceptance: "long".repeat(2000),
      read_only: true,
    });
  const page = f.s.query("board", {
    project_id: f.p.id,
    parent_id: null,
    status: ["pending"],
    limit: 2,
  });
  assert.equal(page.total, 3);
  assert.equal(page.next_offset, 2);
  assert.equal(JSON.stringify(page).includes("longlong"), false);
  const api = f.s.query("api", { name: "message_send" });
  assert.equal(api.items[0].name, "message_send");
  assert(api.items[0].schema);
  assert(f.s.query("api", { limit: 1 }).next_offset);
});

test("batch plans resolve local dependency keys, preserve planning gates and roll back bad cycles or exclusive overlaps", (t) => {
  const f = fixture(t);
  const tasks = [
    { key: "a", title: "A", acceptance: "Pass", scopes: ["x"] },
    { key: "b", title: "B", acceptance: "Pass", scopes: ["y"], needs: ["a"] },
  ];
  const planned = f.s.execute("plan_create", { project_id: f.p.id, tasks });
  assert.equal(planned.tasks[1].depends_on[0], planned.keys.a);
  const count = f.s.tasks(f.p.id).length;
  assert.throws(
    () =>
      f.s.execute("plan_create", {
        project_id: f.p.id,
        tasks: [{ ...tasks[0], needs: ["b"] }, tasks[1]],
      }),
    code("DEPENDENCY_CYCLE"),
  );
  assert.equal(f.s.tasks(f.p.id).length, count);
  assert.throws(
    () =>
      f.s.execute("plan_create", {
        project_id: f.p.id,
        exclusive: true,
        tasks: [tasks[0], { ...tasks[1], scopes: ["x/z"] }],
      }),
    code("PLAN_SCOPE_CONFLICT"),
  );
  assert.equal(f.s.tasks(f.p.id).length, count);
  f.s.execute("project_update", {
    project_id: f.p.id,
    expected_version: f.p.version,
    autonomy: "manual",
  });
  assert.throws(
    () =>
      f.s.execute("plan_create", {
        project_id: f.p.id,
        actor_run_id: f.run.id,
        tasks,
      }),
    code("HUMAN_PLANNING"),
  );
  assert.equal(f.s.tasks(f.p.id).length, count);
});

test("same owner repeat claim is an idempotent confirmation only at an observed version", (t) => {
  const f = fixture(t);
  assert.throws(
    () =>
      f.s.execute("task_claim", {
        task_id: f.task.id,
        run_id: f.run.id,
        expected_version: f.task.version,
      }),
    code("STALE_VERSION"),
  );
  const again = f.s.execute("task_claim", {
    task_id: f.task.id,
    run_id: f.run.id,
    expected_version: f.claimed.version,
  });
  assert.equal(again.claim_epoch, f.claimed.claim_epoch);
  assert.equal(again.version, f.claimed.version);
  const hint = problem(new AppError("EVIDENCE_REQUIRED", "Missing"));
  assert.equal(hint.next_action?.tool, "relay_work_next");
  assert.equal(hint.retryable, false);
});

test("finite declared waits suppress patrol temporarily without manufacturing progress; unrelated notices remain open", async (t) => {
  const f = fixture(t);
  let g = f.s.execute("work_start", { run_id: f.run.id, task_id: f.task.id });
  g = f.s.execute("work_report", {
    handle: g.handle!,
    kind: "recover",
    summary: "Recovered",
    observed: "Checked files",
    read_decision_ids: [],
    dependency_receipts: [],
  });
  const before = f.s.task(f.task.id).checkpoint?.at;
  const until = new Date(Date.now() + 120000).toISOString();
  g = f.s.execute("work_report", {
    handle: g.handle!,
    kind: "wait",
    summary: "Long test is running; check in two minutes",
    wait_until: until,
  });
  assert.equal(f.s.task(f.task.id).checkpoint?.at, before);
  const { Supervisor } = await import("../server/supervisor.ts");
  const patrol = new Supervisor(
    f.s,
    {
      live: new Map(),
      availability: async () => [],
      preflight: async () => {},
      start: () => {},
      stop: () => {},
    },
    () => Date.now() + 100000,
  );
  f.s.execute("supervisor_configure", {
    project_id: f.p.id,
    mode: "observe",
    stale_after_seconds: 60,
    note: "Wait regression",
  });
  await patrol.tick();
  assert.equal(f.s.query("supervisor_status", {}).total, 0);
  const expired = new Supervisor(f.s, patrol.runner, () => Date.now() + 130000);
  await expired.tick();
  assert.equal(f.s.query("supervisor_status", {}).total, 1);
  assert.throws(
    () =>
      f.s.execute("work_report", {
        handle: g.handle!,
        kind: "wait",
        summary: "Forever",
        wait_until: new Date(Date.now() + 86460000).toISOString(),
      }),
    code("WAIT_WINDOW"),
  );
});

test("startup reconciles only legacy notices already covered by a completed recovery or review", (t) => {
  const f = fixture(t);
  const b = f.register("recipient");
  const task = {
    ...f.s.task(f.task.id),
    owner_run_id: b.id,
    status: "doing" as const,
    workflow: {
      ...emptyWorkflow(f.s.task(f.task.id)),
      recovered_epoch: f.claimed.claim_epoch,
      recovered_at: "2026-10-25T08:00:00.000Z",
    },
    reconciliation: {
      run_id: b.id,
      at: "2026-10-25T10:00:00.000Z",
      observed: "confirmed",
    },
  };
  f.store.put("task", task);
  const before = f.s.systemMessage(
    f.p.id,
    b.id,
    task.id,
    "收到交接：旧通知，请核验。",
  );
  f.store.put("message", { ...before, created_at: "2026-10-25T09:00:00.000Z" });
  const after = f.s.systemMessage(
    f.p.id,
    b.id,
    task.id,
    "收到交接：新的未核验交接。",
  );
  f.store.put("message", { ...after, created_at: "2026-10-25T11:00:00.000Z" });
  const request = f.s.execute("message_send", {
    project_id: f.p.id,
    task_id: task.id,
    to_run_id: b.id,
    kind: "request",
    body: "Genuine unresolved change",
  });
  f.store.transaction(() => f.s.reconcileSystemNotices());
  assert(f.s.get("message", before.id).resolved_at);
  assert.equal(f.s.get("message", after.id).resolved_at, undefined);
  assert.equal(f.s.get("message", request.id).resolved_at, undefined);
  // A timestamp from an older claim must not close the later handoff.
  f.store.put("task", {
    ...task,
    workflow: {
      ...task.workflow,
      recovered_epoch: task.claim_epoch - 1,
      recovered_at: "2026-10-25T12:00:00.000Z",
    },
  });
  f.store.transaction(() => f.s.reconcileSystemNotices());
  assert.equal(f.s.get("message", after.id).resolved_at, undefined);
});

test("an active managed writer blocks guided takeover even with manual confirmation", (t) => {
  const f = fixture(t);
  const b = f.register("next");
  f.store.put("run", {
    ...f.run,
    process: { status: "running", task_id: f.task.id },
  });
  assert.throws(
    () =>
      f.s.execute("work_takeover", {
        task_id: f.task.id,
        run_id: b.id,
        expected_version: f.claimed.version,
        reason: "Do not bypass writer",
        confirmed_stop: true,
      }),
    code("PROCESS_RUNNING"),
  );
  assert.equal(f.s.task(f.task.id).owner_run_id, f.run.id);
});
