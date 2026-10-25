import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../server/store.ts";
import { Service } from "../server/domain.ts";
import { Supervisor, type SupervisorRunner } from "../server/supervisor.ts";
import { runtimeCatalog } from "../server/runtimes.ts";
import type { CommandInput } from "../server/schemas.ts";

function fixture(store = new Store()) {
  const s = new Service(store);
  let at = Date.now();
  const project = s.execute("project_create", {
    name: "Patrol",
    objective: "recover",
    root_path: tmpdir(),
  });
  const run = s.execute("agent_register", {
    project_id: project.id,
    name: "Original",
    runtime: "codex",
    workdir: tmpdir(),
    delegated_scopes: ["."],
  }).run;
  const fresh = s.execute("task_create", {
    project_id: project.id,
    title: "Task",
    acceptance: "evidence",
    scopes: ["src"],
  });
  const task = s.execute("task_claim", {
    task_id: fresh.id,
    run_id: run.id,
    expected_version: fresh.version,
  });
  const starts: { run_id: string; task_id: string }[] = [],
    stops: string[] = [];
  const runner: SupervisorRunner = {
    live: new Map(),
    availability: async () =>
      runtimeCatalog
        .filter((r) => r.runtime === "codex" || r.runtime === "pi")
        .map(({ profile, ...r }) => ({
          ...r,
          available: true,
          version: "fixture",
          launch_enabled: true,
          launchable: true,
          command: profile!.command,
          args: [],
          reason: "fixture",
          auth_status: "unchecked" as const,
        })),
    preflight: async () => {},
    start: (args) => {
      starts.push(args);
      s.store.transaction(() =>
        s.update("run", s.run(args.run_id), {
          process: {
            status: "running",
            started_at: new Date(at).toISOString(),
            source: "adapter",
            task_id: args.task_id,
          },
        }),
      );
    },
    stop: (runId) => {
      stops.push(runId);
    },
  };
  const supervisor = new Supervisor(s, runner, () => at);
  const configure = (
    fields: Partial<CommandInput<"supervisor_configure">> = {},
  ) => {
    const old = s.store.get("supervisor_policy", project.id);
    return s.execute("supervisor_configure", {
      project_id: project.id,
      expected_version: old?.version,
      mode: "recover",
      stale_after_seconds: 60,
      grace_seconds: 30,
      cooldown_seconds: 30,
      max_launches: 3,
      max_attempts_per_task: 2,
      runtimes: ["codex", "pi"],
      note: "test explicit policy",
      ...fields,
    });
  };
  const advance = (ms: number) => {
    at += ms;
  };
  const stopped = () =>
    s.store.transaction(() =>
      s.update("run", s.run(run.id), {
        process: { status: "exited", source: "adapter", exit_code: 0 },
      }),
    );
  const incident = () => s.store.get("supervisor_incident", `sup_${task.id}`)!;
  return {
    store,
    s,
    project,
    run,
    task,
    starts,
    stops,
    runner,
    supervisor,
    configure,
    advance,
    stopped,
    incident,
    get now() {
      return at;
    },
  };
}
test("all-project patrol observes by default; fresh heartbeats and logs never masquerade as progress", async (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  f.advance(901000);
  f.s.execute("run_heartbeat", { run_id: f.run.id, note: "still online" });
  await f.supervisor.tick();
  assert.equal(f.incident().status, "open");
  assert.equal(f.starts.length, 0);
  assert.equal(f.s.store.list("message").length, 0);
  await f.supervisor.tick();
  assert.equal(
    f.s.store
      .events(f.project.id)
      .filter((e) => e.type === "supervisor.detected").length,
    1,
  );
  f.configure({ mode: "remind" });
  await f.supervisor.tick();
  await f.supervisor.tick();
  assert.equal(f.s.store.list("message").length, 1);
  assert.equal(f.starts.length, 0);
  const p = f.s.execute("project_create", {
    name: "Second project",
    objective: "scan all",
  });
  f.s.execute("task_create", {
    project_id: p.id,
    title: "Unclaimed",
    acceptance: "done",
    read_only: true,
  });
  f.advance(901000);
  await f.supervisor.tick();
  assert.equal(f.s.query("supervisor_status", {}).total, 2);
  const page = f.s.query("supervisor_status", { limit: 1 });
  assert.equal(page.next_offset, 1);
});
test("stopped executor is reminded then replaced under a new Run; memory, checkpoints and write fencing survive", async (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  f.stopped();
  f.configure();
  f.s.execute("task_checkpoint", {
    task_id: f.task.id,
    run_id: f.run.id,
    claim_epoch: f.task.claim_epoch,
    summary: "Step one complete",
    next_step: "Step two",
  });
  const memory = f.s.execute("memory_save", {
    project_id: f.project.id,
    key: "failure",
    title: "Known pitfall",
    summary: "Do not repeat the failed attempt",
    content: "details",
    task_ids: [f.task.id],
    source: { label: "actual prior evidence" },
  });
  f.advance(61000);
  await f.supervisor.tick();
  assert.equal(f.starts.length, 0);
  f.advance(31000);
  await f.supervisor.tick();
  assert.equal(f.starts.length, 1);
  const replacement = f.s.run(f.starts[0].run_id),
    task = f.s.task(f.task.id);
  assert.notEqual(replacement.id, f.run.id);
  assert.equal(task.status, "reconcile");
  assert.equal(task.claim_epoch, 2);
  assert.equal(task.checkpoint?.summary, "Step one complete");
  assert.ok(
    f.s.query("context", { task_id: task.id }).markdown.includes(memory.id),
  );
  assert.throws(
    () =>
      f.s.execute("task_checkpoint", {
        task_id: task.id,
        run_id: f.run.id,
        claim_epoch: 1,
        summary: "stale writer",
        next_step: "bad",
      }),
    /执行权/,
  );
  assert.equal(f.incident().status, "recovering");
  assert.equal(f.s.store.get("supervisor_policy", f.project.id)?.launches, 1);
  await f.supervisor.tick();
  assert.equal(f.starts.length, 1);
});
test("recovery rotates configured clients, has persistent per-task budget, and never loops after exit without progress", async (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  f.stopped();
  f.configure();
  f.advance(61000);
  await f.supervisor.tick();
  f.advance(31000);
  await f.supervisor.tick();
  const first = f.starts[0];
  f.s.store.transaction(() =>
    f.s.update("run", f.s.run(first.run_id), {
      process: { status: "exited", exit_code: 0, source: "adapter" },
    }),
  );
  f.advance(31000);
  await f.supervisor.tick();
  assert.equal(f.starts.length, 2);
  assert.equal(f.s.run(f.starts[1].run_id).runtime, "pi");
  f.s.store.transaction(() =>
    f.s.update("run", f.s.run(f.starts[1].run_id), {
      process: {
        status: "failed",
        source: "adapter",
        error: "fixture failure",
      },
    }),
  );
  f.advance(31000);
  await f.supervisor.tick();
  assert.equal(f.starts.length, 2);
  assert.equal(f.incident().status, "escalated");
  f.configure({ note: "edit keeps budget" });
  assert.equal(f.s.store.get("supervisor_policy", f.project.id)?.launches, 2);
  assert.equal(
    f.s.store.get("supervisor_state", `sup_${f.task.id}`)?.attempts,
    2,
  );
  await f.supervisor.tick();
  assert.equal(f.starts.length, 2);
});
test("unobserved external writer and unknown managed process escalate instead of starting a conflicting replacement", async (t) => {
  for (const process of [
    null,
    { status: "unknown" as const, source: "adapter" },
  ]) {
    const f = fixture();
    t.after(() => f.store.close());
    f.configure();
    f.s.store.transaction(() =>
      f.s.update("run", f.s.run(f.run.id), { process }),
    );
    f.advance(61000);
    await f.supervisor.tick();
    f.advance(31000);
    await f.supervisor.tick();
    assert.equal(f.starts.length, 0);
    assert.equal(f.incident().status, "escalated");
    assert.equal(f.s.task(f.task.id).owner_run_id, f.run.id);
    assert.equal(f.s.store.list("run").length, 1);
  }
});
test("managed stop is explicit policy and waits for authoritative exit; no replacement launches while writer runs", async (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  f.configure({ stop_stalled_managed: true });
  (f.runner.live as Map<string, unknown>).set(f.run.id, {});
  f.s.store.transaction(() =>
    f.s.update("run", f.s.run(f.run.id), {
      process: { status: "running", source: "adapter" },
    }),
  );
  f.advance(61000);
  await f.supervisor.tick();
  f.advance(31000);
  await f.supervisor.tick();
  assert.deepEqual(f.stops, [f.run.id]);
  assert.equal(f.starts.length, 0);
  await f.supervisor.tick();
  assert.equal(f.stops.length, 1);
  (f.runner.live as Map<string, unknown>).delete(f.run.id);
  f.stopped();
  await f.supervisor.tick();
  assert.equal(f.starts.length, 1);
});
test("new task progress resolves an incident; manual recheck cannot bypass unknown writer checks", async (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  f.configure();
  f.advance(61000);
  await f.supervisor.tick();
  f.advance(31000);
  await f.supervisor.tick();
  const incident = f.incident();
  assert.equal(incident.status, "escalated");
  f.s.execute("supervisor_handle", {
    incident_id: incident.id,
    expected_version: incident.version,
    action: "recheck",
    note: "check again",
  });
  await f.supervisor.tick();
  assert.equal(f.starts.length, 0);
  assert.equal(f.incident().status, "escalated");
  f.s.execute("task_checkpoint", {
    task_id: f.task.id,
    run_id: f.run.id,
    claim_epoch: f.task.claim_epoch,
    summary: "Actual progress",
    next_step: "next",
  });
  // Domain timestamps follow wall time; advance the observed clock back near the new checkpoint.
  const now = Date.now();
  f.advance(now - f.now);
  await f.supervisor.tick();
  assert.equal(f.incident().status, "resolved");
});
test("two independent patrol services reserve one recovery atomically and retain reminder state across restart", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "relay-supervisor-race-"));
  const a = new Store(join(dir, "db.sqlite")),
    f = fixture(a),
    b = new Store(join(dir, "db.sqlite"));
  t.after(() => {
    a.close();
    b.close();
    rmSync(dir, { recursive: true, force: true });
  });
  f.stopped();
  f.configure();
  f.advance(61000);
  await f.supervisor.tick();
  const s2 = new Service(b),
    runner2: SupervisorRunner = {
      ...f.runner,
      start: (args) => {
        f.starts.push(args);
        s2.store.transaction(() =>
          s2.update("run", s2.run(args.run_id), {
            process: { status: "running", source: "adapter" },
          }),
        );
      },
    };
  const other = new Supervisor(s2, runner2, () => f.now);
  await other.tick();
  assert.equal(s2.store.list("message").length, 1);
  f.advance(31000);
  await Promise.all([f.supervisor.tick(), other.tick()]);
  assert.equal(f.starts.length, 1);
  assert.equal(s2.store.get("supervisor_policy", f.project.id)?.launches, 1);
  assert.equal(s2.store.list("run").length, 2);
});
test("native grandchildren are inspected with independent identity; waiting coordinator is not falsely replaced", async (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  f.configure();
  const split = f.s.execute("task_split", {
    task_id: f.task.id,
    expected_version: f.task.version,
    actor_run_id: f.run.id,
    rationale: "parallel",
    children: [
      { title: "A", acceptance: "done", scopes: ["src/a"] },
      { title: "B", acceptance: "done", scopes: ["src/b"] },
    ],
  });
  const child = f.s.execute("agent_register", {
    project_id: f.project.id,
    name: "Child",
    runtime: "pi",
    parent_run_id: f.run.id,
    workdir: tmpdir(),
    delegated_scopes: ["src/a"],
  }).run;
  const claimed = f.s.execute("task_claim", {
    task_id: split.children[0].id,
    run_id: child.id,
    expected_version: 1,
  });
  f.s.store.transaction(() =>
    f.s.update("run", child, {
      process: { status: "exited", source: "adapter" },
    }),
  );
  f.advance(61000);
  await f.supervisor.tick();
  f.advance(31000);
  await f.supervisor.tick();
  const replacement = f.s.run(f.s.task(claimed.id).owner_run_id);
  assert.equal(replacement.parent_run_id, f.run.id);
  assert.equal(replacement.depth, 1);
  assert.equal(f.s.task(f.task.id).owner_run_id, f.run.id);
  assert.equal(f.s.store.get("supervisor_incident", `sup_${f.task.id}`), null);
  assert.ok(f.starts.some((x) => x.task_id === claimed.id));
});

test("incident diagnosis is emitted with process_unknown category and never changes task state", async (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  f.configure();
  f.s.store.transaction(() =>
    f.s.update("run", f.s.run(f.run.id), {
      process: { status: "unknown", source: "adapter" },
    }),
  );
  f.advance(61000);
  await f.supervisor.tick();
  const events = f.s.store
    .events(f.project.id)
    .filter((e) => e.type === "supervisor.diagnosis");
  assert.ok(events.length >= 1);
  const d = events.at(-1)!.diagnosis as {
    category: string;
    next_action: { kind: string };
  };
  assert.equal(d.category, "process_unknown");
  assert.equal(d.next_action.kind, "confirm_stop");
  assert.equal(f.s.task(f.task.id).status, "doing");
  assert.equal(f.s.task(f.task.id).owner_run_id, f.run.id);
});

test("a policy pause during asynchronous CLI preflight prevents launch and retains the reserved handoff", async (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  f.stopped();
  f.configure();
  f.advance(61000);
  await f.supervisor.tick();
  f.runner.preflight = async () => {
    f.configure({ mode: "observe" });
  };
  f.advance(31000);
  await f.supervisor.tick();
  assert.equal(f.starts.length, 0);
  assert.equal(f.incident().status, "escalated");
  assert.equal(f.s.store.get("supervisor_policy", f.project.id)?.launches, 1);
  assert.notEqual(f.s.task(f.task.id).owner_run_id, f.run.id);
});
test("a failed atomic handoff leaves no orphan Run or consumed budget, and escalates the actual conflict", async (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  f.stopped();
  f.configure();
  const contender = f.s.execute("agent_register", {
    project_id: f.project.id,
    name: "Other writer",
    runtime: "pi",
    workdir: join(tmpdir(), "isolated-sup-worktree"),
  }).run;
  const other = f.s.execute("task_create", {
    project_id: f.project.id,
    title: "Other work",
    acceptance: "done",
    scopes: ["src"],
  });
  f.s.execute("task_claim", {
    task_id: other.id,
    run_id: contender.id,
    expected_version: 1,
  });
  // Target workdir becomes conflicting after it was registered, as can happen after external changes.
  f.s.store.transaction(() =>
    f.s.update("run", contender, { workdir: tmpdir() }),
  );
  f.advance(61000);
  await f.supervisor.tick();
  f.advance(31000);
  await f.supervisor.tick();
  assert.equal(f.starts.length, 0);
  assert.equal(f.s.store.list("run").length, 2);
  assert.equal(f.s.task(f.task.id).owner_run_id, f.run.id);
  assert.equal(f.s.store.get("supervisor_policy", f.project.id)?.launches, 0);
  assert.equal(f.incident().status, "escalated");
  assert.ok(f.incident().resolution.includes("冲突"));
});

test("restart after an interrupted recovery reservation escalates without spending a second launch", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "relay-supervisor-interruption-"));
  const path = join(dir, "db.sqlite");
  const a = new Store(path),
    f = fixture(a);
  f.stopped();
  f.configure();
  f.advance(61000);
  await f.supervisor.tick();
  // Reservation committed, but no process outcome was persisted before interruption.
  f.runner.start = () => {};
  f.advance(31000);
  await f.supervisor.tick();
  const reserved = f.incident().replacement_run_id;
  assert.ok(reserved);
  a.close();
  const b = new Store(path),
    s = new Service(b);
  t.after(() => {
    b.close();
    rmSync(dir, { recursive: true, force: true });
  });
  let launches = 0;
  const restarted = new Supervisor(
    s,
    {
      ...f.runner,
      start: () => {
        launches++;
      },
    },
    () => f.now,
  );
  await restarted.tick();
  assert.equal(
    s.get("supervisor_incident", `sup_${f.task.id}`).status,
    "recovering",
  );
  f.advance(61000);
  await restarted.tick();
  const incident = s.get("supervisor_incident", `sup_${f.task.id}`);
  assert.equal(incident.status, "escalated");
  assert.equal(s.get("supervisor_policy", f.project.id).launches, 1);
  assert.equal(s.task(f.task.id).owner_run_id, reserved);
  assert.equal(s.store.list("run").length, 2);
  assert.equal(launches, 0);
});

test("snooze survives patrols, dependency waiting resolves old incidents, and explicit reset clears only budgets", async (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  f.stopped();
  f.configure();
  f.advance(61000);
  await f.supervisor.tick();
  const first = f.incident();
  f.s.execute("supervisor_handle", {
    incident_id: first.id,
    expected_version: first.version,
    action: "snooze",
    until: new Date(f.now + 60000).toISOString(),
    note: "wait for maintenance",
  });
  f.advance(31000);
  await f.supervisor.tick();
  assert.equal(f.starts.length, 0);
  f.advance(31000);
  await f.supervisor.tick();
  assert.equal(f.starts.length, 1);
  assert.equal(f.s.get("supervisor_policy", f.project.id).launches, 1);
  f.configure({ reset_budget: true });
  assert.equal(f.s.get("supervisor_policy", f.project.id).launches, 0);
  assert.equal(f.s.get("supervisor_state", `sup_${f.task.id}`).attempts, 0);
  assert.equal(f.incident().replacement_run_id, f.starts[0].run_id);
  const dependency = f.s.execute("task_create", {
    project_id: f.project.id,
    title: "Prerequisite",
    acceptance: "done",
    read_only: true,
  });
  f.s.store.transaction(() =>
    f.s.update("task", f.s.task(f.task.id), { depends_on: [dependency.id] }),
  );
  await f.supervisor.tick();
  assert.equal(f.incident().status, "resolved");
  assert.ok(f.incident().resolution.includes("依赖"));
  assert.equal(f.starts.length, 1);
});

test("grandchild recovery retains its immediate parent and ancestor dependencies delay recovery", async (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  f.configure();
  const split = f.s.execute("task_split", {
    task_id: f.task.id,
    expected_version: f.task.version,
    actor_run_id: f.run.id,
    rationale: "delegate nested work",
    children: [
      { title: "Child task", acceptance: "done", scopes: ["src/a"] },
      { title: "Sibling task", acceptance: "done", scopes: ["src/b"] },
    ],
  });
  const child = f.s.execute("agent_register", {
    project_id: f.project.id,
    name: "Child",
    runtime: "pi",
    parent_run_id: f.run.id,
    workdir: tmpdir(),
    delegated_scopes: ["src/a"],
  }).run;
  const claimed = f.s.execute("task_claim", {
    task_id: split.children[0].id,
    run_id: child.id,
    expected_version: 1,
  });
  const nested = f.s.execute("task_split", {
    task_id: claimed.id,
    expected_version: claimed.version,
    actor_run_id: child.id,
    rationale: "nested delegation",
    children: [
      { title: "Grandchild task", acceptance: "done", scopes: ["src/a/part"] },
      {
        title: "Grandchild sibling",
        acceptance: "done",
        scopes: ["src/a/other"],
      },
    ],
  });
  const grandchild = f.s.execute("agent_register", {
    project_id: f.project.id,
    name: "Grandchild",
    runtime: "codex",
    parent_run_id: child.id,
    workdir: tmpdir(),
    delegated_scopes: ["src/a/part"],
  }).run;
  const leaf = f.s.execute("task_claim", {
    task_id: nested.children[0].id,
    run_id: grandchild.id,
    expected_version: 1,
  });
  const dependency = f.s.execute("task_create", {
    project_id: f.project.id,
    title: "Ancestor prerequisite",
    acceptance: "done",
    read_only: true,
  });
  f.s.store.transaction(() => {
    f.s.update("task", dependency, { status: "review" });
    f.s.update("run", grandchild, {
      process: { status: "exited", source: "adapter" },
    });
    f.s.update("task", f.s.task(f.task.id), { depends_on: [dependency.id] });
  });
  f.advance(61000);
  await f.supervisor.tick();
  f.advance(31000);
  await f.supervisor.tick();
  assert.equal(f.starts.length, 0);
  assert.equal(f.s.store.get("supervisor_incident", `sup_${leaf.id}`), null);
  f.s.store.transaction(() =>
    f.s.update("task", f.s.task(f.task.id), { depends_on: [] }),
  );
  await f.supervisor.tick();
  f.advance(31000);
  await f.supervisor.tick();
  const next = f.s.run(f.s.task(leaf.id).owner_run_id);
  assert.equal(next.parent_run_id, child.id);
  assert.equal(next.depth, 2);
  assert.ok(f.starts.some((start) => start.task_id === leaf.id));
  assert.equal(f.s.task(claimed.id).owner_run_id, child.id);
});
