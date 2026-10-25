import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../server/store.ts";
import { Service } from "../server/domain.ts";
import { Scheduler } from "../server/scheduler.ts";

function fixture(t: TestContext) {
  const store = new Store(),
    s = new Service(store);
  t.after(() => store.close());
  const p = s.execute("project_create", {
    name: "Dispatch",
    objective: "bounded work",
  });
  const register = (name = "A", scope = ["."]) =>
    s.execute("agent_register", {
      project_id: p.id,
      name,
      runtime: "codex",
      workdir: "/tmp/relayboard-test",
      delegated_scopes: scope,
    }).run;
  const create = (title = "Task", scope = ["src"]) =>
    s.execute("task_create", {
      project_id: p.id,
      title,
      acceptance: "evidence",
      scopes: scope,
    });
  const starts: { run_id: string; task_id: string }[] = [],
    runner = {
      live: new Map(),
      start: (args: { run_id: string; task_id: string }) => {
        starts.push(args);
      },
    };
  const scheduler = new Scheduler(s, runner);
  return { s, p, register, create, starts, runner, scheduler };
}
test("no automatic execution until explicitly enabled; fresh claims dispatch once and checkpoints do not cause loops", (t) => {
  const f = fixture(t),
    run = f.register(),
    task = f.create();
  f.scheduler.tick();
  assert.equal(f.starts.length, 0);
  assert.equal(f.s.task(task.id).status, "pending");
  f.s.execute("run_dispatch", {
    run_id: run.id,
    enabled: true,
    max_launches: 3,
    note: "execute assigned scope",
  });
  f.scheduler.tick();
  assert.equal(f.starts.length, 1);
  assert.equal(f.s.task(task.id).owner_run_id, run.id);
  f.scheduler.tick();
  assert.equal(f.starts.length, 1);
  const claimed = f.s.task(task.id);
  f.s.execute("task_checkpoint", {
    task_id: task.id,
    run_id: run.id,
    claim_epoch: claimed.claim_epoch,
    summary: "saved",
    next_step: "next",
  });
  f.scheduler.tick();
  assert.equal(
    f.starts.length,
    1,
    "progress updates do not restart a finished CLI in a loop",
  );
});
test("new addressed messages wake the managed run; acknowledgement does not wake it again", (t) => {
  const f = fixture(t),
    run = f.register();
  f.create();
  f.s.execute("run_dispatch", {
    run_id: run.id,
    enabled: true,
    max_launches: 3,
    note: "bounded",
  });
  f.scheduler.tick();
  const m = f.s.execute("message_send", {
    project_id: f.p.id,
    to_run_id: run.id,
    body: "The interface decision is ready.",
  });
  f.scheduler.tick();
  assert.equal(f.starts.length, 2);
  f.s.execute("message_ack", { message_id: m.id, run_id: run.id });
  f.scheduler.tick();
  assert.equal(f.starts.length, 2);
  f.s.execute("message_send", {
    project_id: f.p.id,
    body: "Unrelated broadcast",
  });
  f.scheduler.tick();
  assert.equal(f.starts.length, 2);
});
test("budget disables dispatch and another executor only claims independent available work", (t) => {
  const f = fixture(t),
    a = f.register("A", ["src/a"]),
    b = f.register("B", ["src/b"]);
  const ta = f.create("A", ["src/a"]),
    tb = f.create("B", ["src/b"]);
  for (const r of [a, b])
    f.s.execute("run_dispatch", {
      run_id: r.id,
      enabled: true,
      max_launches: 1,
      note: "one attempt",
    });
  f.scheduler.tick();
  assert.equal(f.starts.length, 2);
  assert.equal(f.s.task(ta.id).owner_run_id, a.id);
  assert.equal(f.s.task(tb.id).owner_run_id, b.id);
  f.scheduler.tick();
  assert.equal(f.s.run(a.id).dispatch!.enabled, false);
  assert.equal(f.s.run(b.id).dispatch!.enabled, false);
});

test("a child blocker wakes its coordinator once without starting unrelated work", (t) => {
  const f = fixture(t),
    parent = f.register("Coordinator"),
    initial = f.create("Module", ["src"]);
  const claimed = f.s.execute("task_claim", {
    task_id: initial.id,
    run_id: parent.id,
    expected_version: initial.version,
  });
  const split = f.s.execute("task_split", {
    task_id: claimed.id,
    expected_version: claimed.version,
    actor_run_id: parent.id,
    rationale: "Independent work",
    children: ["a", "b"].map((n) => ({
      title: n,
      scopes: [`src/${n}`],
      acceptance: "evidence",
    })),
  });
  const child = f.s.execute("agent_register", {
    project_id: f.p.id,
    name: "Child",
    runtime: "pi",
    parent_run_id: parent.id,
    workdir: "/tmp/relayboard-test",
    delegated_scopes: ["src/a"],
  }).run;
  const task = f.s.execute("task_claim", {
    task_id: split.children[0].id,
    run_id: child.id,
    expected_version: split.children[0].version,
  });
  f.s.execute("run_dispatch", {
    run_id: parent.id,
    enabled: true,
    max_launches: 4,
    note: "coordinate",
  });
  f.scheduler.tick();
  assert.equal(f.starts.length, 1);
  f.s.execute("task_checkpoint", {
    task_id: task.id,
    run_id: child.id,
    claim_epoch: task.claim_epoch,
    summary: "Blocked",
    blocker: "Need interface decision",
    next_step: "Ask coordinator",
  });
  f.scheduler.tick();
  assert.equal(f.starts.length, 2);
  assert.equal(f.starts[1].task_id, claimed.id);
  f.scheduler.tick();
  assert.equal(f.starts.length, 2);
  assert.equal(f.s.task(split.children[1].id).status, "pending");
});
test("live handles and unknown processes block automatic redispatch; launch errors disable future retries", (t) => {
  const f = fixture(t),
    run = f.register();
  f.create();
  f.s.execute("run_dispatch", {
    run_id: run.id,
    enabled: true,
    note: "bounded",
  });
  f.runner.live.set(run.id, {});
  f.scheduler.tick();
  assert.equal(f.starts.length, 0);
  f.runner.live.clear();
  f.runner.start = () => {
    throw Error("fixture CLI missing");
  };
  f.scheduler.tick();
  assert.equal(f.s.run(run.id).dispatch!.enabled, false);
  assert.ok(f.s.run(run.id).dispatch!.last_error!.includes("missing"));
  f.scheduler.tick();
  assert.equal(f.s.run(run.id).dispatch!.launches, 1);
});

test("launch errors persist a structured dispatch diagnosis without altering task state", (t) => {
  const f = fixture(t),
    run = f.register();
  f.create();
  f.s.execute("run_dispatch", {
    run_id: run.id,
    enabled: true,
    max_launches: 1,
    note: "single attempt",
  });
  f.runner.start = () => {
    throw Object.assign(new Error("fixture CLI missing"), {
      code: "CLI_UNAVAILABLE",
    });
  };
  f.scheduler.tick();
  const events = f.s.store
    .events(f.p.id)
    .filter((e) => e.type === "dispatch.diagnosis");
  assert.ok(events.length >= 1);
  const d = events.at(-1)!.diagnosis as {
    category: string;
    next_action: { kind: string };
  };
  assert.equal(d.category, "configuration");
  assert.equal(d.next_action.kind, "configure");
  assert.equal(f.s.run(run.id).dispatch!.enabled, false);
});
