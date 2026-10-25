import test, { type TestContext } from "node:test";
import type { Task, Run, RelayEvent } from "../server/types.ts";
import type { CommandInput } from "../server/schemas.ts";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { Store } from "../server/store.ts";
import { Service } from "../server/domain.ts";

function fixture(
  t: TestContext,
  opts: Partial<CommandInput<"project_create">> = {},
) {
  const dir = mkdtempSync(join(tmpdir(), "relayboard-domain-"));
  const db = join(dir, "test.sqlite"),
    store = new Store(db),
    s = new Service(store);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const project = s.execute("project_create", {
    name: "测试项目",
    objective: "实现并验证登录模块",
    root_path: dir,
    ...opts,
  });
  const register = (
    name = "Codex",
    extra: Partial<CommandInput<"agent_register">> = {},
  ) =>
    s.execute("agent_register", {
      project_id: project.id,
      name,
      runtime: "codex",
      workdir: dir,
      ...extra,
    }).run;
  const create = (
    title = "认证接口",
    extra: Partial<CommandInput<"task_create">> = {},
  ) =>
    s.execute("task_create", {
      project_id: project.id,
      title,
      acceptance: "测试通过并提供成果",
      scopes: ["src/api"],
      ...extra,
    });
  const claim = (task: Task, run: Run) =>
    s.execute("task_claim", {
      task_id: task.id,
      expected_version: task.version,
      run_id: run.id,
    });
  const checkpoint = (
    task: Task,
    run: Run,
    extra: Partial<CommandInput<"task_checkpoint">> = {},
  ) =>
    s.execute("task_checkpoint", {
      task_id: task.id,
      run_id: run.id,
      claim_epoch: task.claim_epoch,
      summary: "实现已保存",
      next_step: "运行验证",
      artifacts: [{ path: "src/api/login.js" }],
      verification: [
        { command: "node --test", result: "3 tests pass", passed: true },
      ],
      ...extra,
    });
  return { dir, db, s, store, project, register, create, claim, checkpoint };
}
const child = (
  title: string,
  scopes: string[],
  extra: Partial<CommandInput<"task_create">> = {},
) => ({
  title,
  scopes,
  acceptance: "通过独立检查",
  ...extra,
});
const code = (expected: string) => (error: unknown) =>
  error instanceof Error && "code" in error && error.code === expected;

test("claim uses a revision and fences writes from a previous owner after handoff", (t) => {
  const f = fixture(t),
    a = f.register(),
    b = f.register("Claude", { runtime: "claude" });
  const initial = f.create(),
    task = f.claim(initial, a);
  assert.throws(() => f.claim(initial, b), code("STALE_VERSION"));
  const saved = f.checkpoint(task, a);
  const transferred = f.s.execute("task_handoff", {
    task_id: task.id,
    expected_version: saved.version,
    to_run_id: b.id,
    summary: "接手剩余验证",
    descendants: "require_stopped",
    confirmed_stop: true,
  });
  assert.equal(transferred.status, "reconcile");
  assert.throws(() => f.checkpoint(task, a), code("STALE_CLAIM"));
  assert.throws(() => f.checkpoint(transferred, b), code("RECONCILE_REQUIRED"));
  const reconciled = f.s.execute("task_reconcile", {
    task_id: task.id,
    run_id: b.id,
    claim_epoch: transferred.claim_epoch,
    observed: "检查分支与未提交改动，旧写入已停止",
    next_step: "继续集成验证",
  });
  assert.equal(f.checkpoint(reconciled, b).owner_run_id, b.id);
});

test("scope overlaps block claims, distinct directories permit parallel writes, named resources still serialize", (t) => {
  const f = fixture(t),
    a = f.register(),
    b = f.register("Claude");
  f.claim(f.create("A", { scopes: ["src"] }), a);
  const same = f.create("B", { scopes: ["src/api"] });
  assert.throws(() => f.claim(same, b), code("NOT_ELIGIBLE"));
  const c = f.register("isolated", { workdir: join(f.dir, "separate") });
  assert.equal(f.claim(same, c).status, "doing");
  const db1 = f.create("migration A", {
    scopes: ["db"],
    resources: ["database:schema"],
  });
  f.claim(db1, a);
  const db2 = f.create("migration B", {
    scopes: ["db"],
    resources: ["database:schema"],
  });
  assert.throws(() => f.claim(db2, c), code("NOT_ELIGIBLE"));
});

test("existing symlinks do not hide physical workspace collisions", (t) => {
  const f = fixture(t);
  mkdirSync(join(f.dir, "actual"));
  symlinkSync(join(f.dir, "actual"), join(f.dir, "alias"));
  const a = f.register("A", { workdir: join(f.dir, "actual") }),
    b = f.register("B", { workdir: join(f.dir, "alias") });
  f.claim(f.create("one"), a);
  assert.throws(() => f.claim(f.create("two"), b), code("NOT_ELIGIBLE"));
});

test("symlink aliases with not-yet-created work directories still conflict", (t) => {
  const f = fixture(t);
  mkdirSync(join(f.dir, "actual"));
  symlinkSync(join(f.dir, "actual"), join(f.dir, "alias"));
  const a = f.register("A", { workdir: join(f.dir, "actual", "future") });
  const b = f.register("B", { workdir: join(f.dir, "alias", "future") });
  f.claim(f.create("one"), a);
  assert.throws(() => f.claim(f.create("two"), b), code("NOT_ELIGIBLE"));
});

test("child blocker and uncertain exit notify the parent without freeing the claim", (t) => {
  const f = fixture(t),
    parent = f.register("Coordinator");
  const sub = f.register("Child", { parent_run_id: parent.id });
  const task = f.claim(f.create(), sub);
  f.checkpoint(task, sub, { blocker: "Waiting for interface decision" });
  let inbox = f.s.query("inbox", { run_id: parent.id });
  assert.ok(
    inbox.some(
      (m) =>
        m.task_id === task.id &&
        m.body.includes("Waiting for interface decision"),
    ),
  );
  f.s.execute("run_end", {
    run_id: sub.id,
    status: "unknown",
    note: "Native child disconnected",
  });
  inbox = f.s.query("inbox", { run_id: parent.id });
  assert.ok(inbox.some((m) => m.body.includes("Native child disconnected")));
  assert.equal(f.s.task(task.id).owner_run_id, sub.id);
  assert.equal(f.s.task(task.id).status, "blocked");
});

test("coordinator ownership leaves independent child tasks available to other tools", (t) => {
  const f = fixture(t),
    rootRun = f.register(),
    other = f.register("Claude", { runtime: "claude" });
  const parent = f.claim(f.create("登录模块", { scopes: ["src"] }), rootRun);
  const split = f.s.execute("task_split", {
    task_id: parent.id,
    expected_version: parent.version,
    actor_run_id: rootRun.id,
    rationale: "按接口和页面分工",
    children: [child("接口", ["src/api"]), child("页面", ["src/web"])],
  });
  assert.equal(split.parent.mode, "coordinator");
  const sub = f.register("API child", {
    parent_run_id: rootRun.id,
    delegated_scopes: ["src/api"],
  });
  f.claim(split.children[0], sub);
  assert.equal(f.claim(split.children[1], other).owner_run_id, other.id);
  assert.throws(() => f.checkpoint(parent, rootRun), code("STALE_CLAIM"));
  assert.equal(
    f.s
      .query("snapshot", { project_id: f.project.id })
      .runs.find((r) => r.id === sub.id)!.parent_run_id,
    rootRun.id,
  );
});

test("dependencies are only released by accepted evidence, with self-review blocked", (t) => {
  const f = fixture(t),
    a = f.register(),
    first = f.claim(f.create("实现"), a);
  const next = f.create("验证", {
    read_only: true,
    scopes: [],
    depends_on: [first.id],
  });
  assert.equal(f.s.eligibility(next, a).eligible, false);
  assert.throws(
    () =>
      f.s.execute("task_submit", {
        task_id: first.id,
        run_id: a.id,
        claim_epoch: first.claim_epoch,
        summary: "完成",
      }),
    code("CHECKPOINT_REQUIRED"),
  );
  const saved = f.checkpoint(first, a);
  const submitted = f.s.execute("task_submit", {
    task_id: saved.id,
    run_id: a.id,
    claim_epoch: saved.claim_epoch,
    summary: "实现与测试完成",
  });
  assert.equal(f.s.eligibility(next, a).eligible, false);
  assert.throws(
    () =>
      f.s.execute("task_review", {
        task_id: first.id,
        expected_version: submitted.version,
        reviewer_run_id: a.id,
        accepted: true,
        human_review: true,
        note: "自己确认",
      }),
    code("SELF_REVIEW"),
  );
  f.s.execute("task_review", {
    task_id: first.id,
    expected_version: submitted.version,
    accepted: true,
    human_review: true,
    note: "人工核对验证成果",
  });
  assert.equal(f.s.eligibility(next, a).eligible, true);
});

test("split is all-or-nothing and rejects scopes escaping parent or cyclic dependencies", (t) => {
  const f = fixture(t),
    parent = f.create("父任务", { scopes: ["src"] });
  assert.throws(
    () =>
      f.s.execute("task_split", {
        task_id: parent.id,
        expected_version: parent.version,
        rationale: "bad",
        children: [child("A", ["src/a"]), child("B", ["outside"])],
      }),
    code("OUTSIDE_PARENT_SCOPE"),
  );
  assert.equal(f.s.task(parent.id).mode, "execute");
  assert.equal(f.s.tasks(f.project.id).length, 1);
  assert.throws(
    () =>
      f.s.execute("task_split", {
        task_id: parent.id,
        expected_version: parent.version,
        rationale: "cycle",
        children: [
          child("A", ["src/a"], { depends_on: ["@1"] }),
          child("B", ["src/b"], { depends_on: ["@0"] }),
        ],
      }),
    code("DEPENDENCY_CYCLE"),
  );
  assert.equal(f.s.tasks(f.project.id).length, 1);
});

test("unclaimed split supports sibling dependency indices and cannot depend on the parent completion", (t) => {
  const f = fixture(t),
    parent = f.create("父任务", { scopes: ["src"] });
  const split = f.s.execute("task_split", {
    task_id: parent.id,
    expected_version: parent.version,
    rationale: "先实现再验证",
    children: [
      child("实现", ["src/a"]),
      child("验证", [], { read_only: true, depends_on: ["@0"] }),
    ],
  });
  assert.deepEqual(split.children[1].depends_on, [split.children[0].id]);
  assert.throws(
    () =>
      f.s.execute("task_update", {
        task_id: split.children[0].id,
        expected_version: 1,
        depends_on: [parent.id],
      }),
    code("DEPENDENCY_CYCLE"),
  );
});

test("another owner proposes decomposition and cannot directly split the claimed task", (t) => {
  const f = fixture(t),
    a = f.register(),
    b = f.register("Claude");
  const task = f.claim(f.create("登录", { scopes: ["src"] }), a);
  const fields = {
    task_id: task.id,
    expected_version: task.version,
    rationale: "并行加入",
    children: [child("A", ["src/a"]), child("B", ["src/b"])],
  };
  assert.throws(
    () => f.s.execute("task_split", { ...fields, actor_run_id: b.id }),
    code("NOT_OWNER"),
  );
  const prop = f.s.execute("proposal_create", {
    ...fields,
    author_run_id: b.id,
  });
  assert.equal(f.s.query("inbox", { run_id: a.id }).length, 1);
  const result = f.s.execute("proposal_resolve", {
    proposal_id: prop.id,
    actor_run_id: a.id,
    approved: true,
    note: "分工确认",
  });
  assert.equal(result.split!.children.length, 2);
  assert.throws(
    () =>
      f.s.execute("proposal_resolve", {
        proposal_id: prop.id,
        approved: true,
        note: "duplicate",
      }),
    code("PROPOSAL_CLOSED"),
  );
});

test("scope expansion rechecks other active writers and requires a different approver", (t) => {
  const f = fixture(t),
    a = f.register(),
    b = f.register("Claude");
  const task = f.claim(f.create("A", { scopes: ["a"] }), a);
  f.claim(f.create("B", { scopes: ["b"] }), b);
  const p = f.s.execute("scope_request", {
    task_id: task.id,
    run_id: a.id,
    claim_epoch: task.claim_epoch,
    scopes: ["b"],
    rationale: "发现依赖",
  });
  assert.throws(
    () =>
      f.s.execute("scope_resolve", {
        proposal_id: p.id,
        actor_run_id: a.id,
        approved: true,
        note: "self",
      }),
    code("SCOPE_REVIEWER"),
  );
  assert.throws(
    () =>
      f.s.execute("scope_resolve", {
        proposal_id: p.id,
        approved: true,
        note: "human",
      }),
    code("SCOPE_CONFLICT"),
  );
  assert.deepEqual(f.s.task(task.id).scopes, ["a"]);
});

test("descendant registration respects scope, depth, capability and global concurrency budgets", (t) => {
  const f = fixture(t, { max_depth: 1, max_concurrency: 2 }),
    root = f.register();
  f.claim(f.create("总任务", { scopes: ["src"] }), root);
  assert.throws(
    () =>
      f.register("outside", {
        parent_run_id: root.id,
        delegated_scopes: ["db"],
      }),
    code("DELEGATION_SCOPE"),
  );
  const sub = f.register("child", {
    parent_run_id: root.id,
    delegated_scopes: ["src"],
  });
  assert.throws(
    () => f.register("grandchild", { parent_run_id: sub.id }),
    code("DEPTH_BUDGET"),
  );
  const pi = f.register("pi", { runtime: "pi" });
  f.claim(f.create("read", { read_only: true, scopes: [] }), sub);
  assert.throws(
    () => f.claim(f.create("third", { read_only: true, scopes: [] }), pi),
    code("NOT_ELIGIBLE"),
  );
  const needs = f.create("capability", {
    read_only: true,
    scopes: [],
    required_capabilities: ["browser"],
  });
  assert.ok(
    f.s.eligibility(needs, root).reasons.some((r) => r.includes("browser")),
  );
});

test("handoff explicitly handles active descendants and transfers their reporting chain", (t) => {
  const f = fixture(t),
    a = f.register(),
    b = f.register("Claude");
  const parent = f.claim(f.create("父任务", { scopes: ["src"] }), a);
  const split = f.s.execute("task_split", {
    task_id: parent.id,
    expected_version: parent.version,
    actor_run_id: a.id,
    rationale: "拆分",
    children: [child("A", ["src/a"]), child("B", ["src/b"])],
  });
  const sub = f.register("child", { parent_run_id: a.id });
  f.claim(split.children[0], sub);
  const args = {
    task_id: parent.id,
    expected_version: split.parent.version,
    to_run_id: b.id,
    summary: "接手协调",
    confirmed_stop: true,
  };
  assert.throws(
    () =>
      f.s.execute("task_handoff", { ...args, descendants: "require_stopped" }),
    code("DESCENDANTS_ACTIVE"),
  );
  const result = f.s.execute("task_handoff", {
    ...args,
    descendants: "continue",
  });
  assert.equal(f.s.run(sub.id).parent_run_id, b.id);
  assert.equal(result.handoff!.descendant_task_ids.length, 1);
  assert.equal(f.s.query("inbox", { run_id: sub.id }).length, 1);
});

test("unknown liveness never releases active work and same-workspace handoff requires stop confirmation", (t) => {
  const f = fixture(t),
    a = f.register(),
    b = f.register("Claude"),
    task = f.claim(f.create(), a);
  f.s.execute("run_end", { run_id: a.id, status: "unknown", note: "窗口失联" });
  assert.throws(() => f.claim(f.create("重叠工作"), b), code("NOT_ELIGIBLE"));
  assert.throws(
    () =>
      f.s.execute("task_handoff", {
        task_id: task.id,
        expected_version: task.version,
        to_run_id: b.id,
        summary: "接手",
        descendants: "continue",
      }),
    code("OLD_WRITER_UNCONFIRMED"),
  );
});

test("directed messages persist, can only be acknowledged by recipient, and decisions are separate", (t) => {
  const f = fixture(t),
    a = f.register(),
    b = f.register("Claude");
  const m = f.s.execute("message_send", {
    project_id: f.project.id,
    from_run_id: a.id,
    to_run_id: b.id,
    kind: "request",
    body: "确认接口字段",
  });
  assert.equal(f.s.query("inbox", { run_id: b.id })[0].id, m.id);
  assert.throws(
    () => f.s.execute("message_ack", { message_id: m.id, run_id: a.id }),
    code("NOT_RECIPIENT"),
  );
  f.s.execute("message_ack", { message_id: m.id, run_id: b.id });
  assert.equal(f.s.query("inbox", { run_id: b.id }).length, 0);
  const d = f.s.execute("decision_record", {
    project_id: f.project.id,
    title: "接口约定 v1",
    body: "统一 expires_at 为 UTC ISO 时间",
  });
  assert.equal(
    f.s.query("snapshot", { project_id: f.project.id }).decisions[0].id,
    d.id,
  );
});

test("idempotency receipts prevent duplicate tasks and reject reused keys with different arguments", (t) => {
  const f = fixture(t),
    args = {
      project_id: f.project.id,
      title: "任务",
      acceptance: "验证通过",
      scopes: ["a"],
    };
  const a = f.s.execute("task_create", args, "request-1"),
    b = f.s.execute("task_create", args, "request-1");
  assert.equal(a.id, b.id);
  assert.equal(f.s.tasks(f.project.id).length, 1);
  assert.throws(
    () =>
      f.s.execute("task_create", { ...args, title: "不同任务" }, "request-1"),
    code("IDEMPOTENCY_MISMATCH"),
  );
});

test("restart retains claims, checkpoints, messages and bounded handoff packets", (t) => {
  const f = fixture(t),
    a = f.register(),
    task = f.claim(f.create(), a);
  f.checkpoint(task, a);
  const secondStore = new Store(f.db);
  t.after(() => secondStore.close());
  const restarted = new Service(secondStore);
  const snapshot = restarted.query("snapshot", { project_id: f.project.id });
  assert.equal(snapshot.tasks[0].owner_run_id, a.id);
  assert.equal(snapshot.tasks[0].checkpoint!.summary, "实现已保存");
  const packet = restarted.query("context", {
    task_id: task.id,
    max_chars: 1500,
  });
  assert.ok(packet.markdown.length <= 1500);
  assert.equal(packet.claim_epoch, 1);
  assert.ok(packet.markdown.includes(task.id));
});

test("cross-project IDs and escaping relative paths are rejected", (t) => {
  const f = fixture(t),
    p = f.s.execute("project_create", { name: "其他", objective: "隔离" });
  const run = f.s.execute("agent_register", {
    project_id: p.id,
    name: "Other",
    runtime: "other",
  }).run;
  assert.throws(() => f.claim(f.create(), run), code("PROJECT_MISMATCH"));
  assert.throws(
    () => f.create("bad", { scopes: ["../outside"] }),
    code("INVALID_SCOPE"),
  );
  assert.throws(
    () => f.create("bad", { scopes: ["/absolute"] }),
    code("INVALID_SCOPE"),
  );
});

test("a later checkpoint invalidates old passing evidence until verification is reported again", (t) => {
  const f = fixture(t),
    run = f.register(),
    task = f.claim(f.create(), run);
  f.checkpoint(task, run);
  f.s.execute("task_checkpoint", {
    task_id: task.id,
    run_id: run.id,
    claim_epoch: task.claim_epoch,
    summary: "further code changes",
    next_step: "rerun verification",
  });
  assert.throws(
    () =>
      f.s.execute("task_submit", {
        task_id: task.id,
        run_id: run.id,
        claim_epoch: task.claim_epoch,
        summary: "done",
      }),
    code("EVIDENCE_REQUIRED"),
  );
  const saved = f.checkpoint(task, run);
  assert.equal(
    f.s.execute("task_submit", {
      task_id: task.id,
      run_id: run.id,
      claim_epoch: saved.claim_epoch,
      summary: "reverified",
    }).status,
    "review",
  );
});

test("children must be accepted before fresh parent integration evidence can submit the coordinator", (t) => {
  const f = fixture(t),
    run = f.register(),
    p = f.claim(f.create("Parent", { scopes: ["src"] }), run);
  const split = f.s.execute("task_split", {
    task_id: p.id,
    expected_version: p.version,
    actor_run_id: run.id,
    rationale: "parallel",
    children: [child("A", ["src/a"]), child("B", ["src/b"])],
  });
  f.checkpoint(split.parent, run);
  for (const c of split.children) {
    const claimed = f.claim(c, run);
    f.checkpoint(claimed, run);
    const submitted = f.s.execute("task_submit", {
      task_id: c.id,
      run_id: run.id,
      claim_epoch: claimed.claim_epoch,
      summary: "ready",
    });
    f.s.execute("task_review", {
      task_id: c.id,
      expected_version: submitted.version,
      accepted: true,
      human_review: true,
      note: "independently checked",
    });
  }
  assert.throws(
    () =>
      f.s.execute("task_submit", {
        task_id: p.id,
        run_id: run.id,
        claim_epoch: split.parent.claim_epoch,
        summary: "integrated",
      }),
    code("INTEGRATION_EVIDENCE_REQUIRED"),
  );
  f.checkpoint(split.parent, run);
  assert.equal(
    f.s.execute("task_submit", {
      task_id: p.id,
      run_id: run.id,
      claim_epoch: split.parent.claim_epoch,
      summary: "integrated and verified",
    }).status,
    "review",
  );
});

test("event observers only see committed work, including adapter events outside command execution", (t) => {
  const f = fixture(t),
    events: RelayEvent[] = [];
  f.s.listeners.add((e) => events.push(e));
  const p = f.create("Parent", { scopes: ["src"] });
  const before = events.length;
  assert.throws(() =>
    f.s.execute("task_split", {
      task_id: p.id,
      expected_version: 1,
      rationale: "bad",
      children: [child("A", ["src/a"]), child("B", ["outside"])],
    }),
  );
  assert.equal(events.length, before);
  f.store.transaction(() =>
    f.s.emit(f.project.id, "adapter.fixture", { summary: "committed" }),
  );
  assert.equal(events.at(-1)!.type, "adapter.fixture");
});

test("two independent SQLite connections racing a claim yield exactly one owner", async (t) => {
  const f = fixture(t),
    a = f.register(),
    b = f.register("Claude"),
    task = f.create();
  const barrier = new SharedArrayBuffer(4);
  const workers = [a, b].map(
    (run) =>
      new Worker(new URL("./race-worker.ts", import.meta.url), {
        workerData: {
          db: f.db,
          barrier,
          task_id: task.id,
          expected_version: task.version,
          run_id: run.id,
        },
      }),
  );
  const exits = workers.map(
    (w) => new Promise((resolve) => w.once("exit", resolve)),
  );
  const outcomes = workers.map(
    (w) =>
      new Promise<{ ok: boolean; owner?: string; code?: string }>(
        (resolve, reject) => {
          w.on("message", (m) => {
            if (m !== "ready") resolve(m);
          });
          w.on("error", reject);
        },
      ),
  );
  await Promise.all(
    workers.map((w) => new Promise((resolve) => w.once("message", resolve))),
  );
  Atomics.store(new Int32Array(barrier), 0, 1);
  Atomics.notify(new Int32Array(barrier), 0, 2);
  const results = await Promise.all(outcomes);
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.equal(results.filter((r) => r.code === "STALE_VERSION").length, 1);
  assert.equal(f.s.task(task.id).claim_epoch, 1);
  await Promise.all(exits);
});

test("historical acknowledged requests can be explicitly resolved after task acceptance and recipient exit without hiding new requests", (t) => {
  const f = fixture(t),
    run = f.register();
  const task = f.claim(f.create(), run);
  const messages = Array.from({ length: 4 }, (_, i) => {
    const message = f.s.execute("message_send", {
      project_id: f.project.id,
      task_id: task.id,
      to_run_id: run.id,
      kind: i === 0 ? "request" : "blocker",
      body: `历史问题 ${i}`,
    });
    f.s.execute("message_ack", { message_id: message.id, run_id: run.id });
    return message;
  });
  f.checkpoint(task, run);
  const submitted = f.s.execute("task_submit", {
    task_id: task.id,
    run_id: run.id,
    claim_epoch: task.claim_epoch,
    summary: "修复已验证",
  });
  f.s.execute("task_review", {
    task_id: task.id,
    expected_version: submitted.version,
    accepted: true,
    human_review: true,
    note: "独立核验成果",
  });
  f.s.execute("run_end", {
    run_id: run.id,
    status: "ended",
    note: "实际会话已结束",
  });
  assert.equal(
    f.s.query("snapshot", { project_id: f.project.id }).attention
      ?.requests_total,
    4,
  );
  for (const message of messages) {
    const resolved = f.s.execute("message_resolve", {
      message_id: message.id,
      note: `核对已验收成果，${message.body}已落实`,
    });
    assert.ok(resolved.resolved_at);
    assert.equal(resolved.resolved_by, "human");
    assert.ok(resolved.acknowledged_at);
    assert.match(resolved.resolution!, /已验收成果/);
  }
  const snapshot = f.s.query("snapshot", { project_id: f.project.id });
  assert.equal(snapshot.attention?.requests_total, 0);
  assert.deepEqual(snapshot.attention?.request_counts, {});
  assert.equal(snapshot.tasks[0].status, "done");
  assert.equal(f.s.query("work_requests", { task_id: task.id }).total, 0);
  assert.equal(
    snapshot.messages.filter((m) => messages.some((old) => old.id === m.id))
      .length,
    4,
  );
  const newRequest = f.s.execute("message_send", {
    project_id: f.project.id,
    task_id: task.id,
    kind: "request",
    body: "完成后新提出的需求，仍须处理",
  });
  assert.equal(
    f.s.query("snapshot", { project_id: f.project.id }).attention
      ?.requests_total,
    1,
  );
  assert.equal(
    f.s.query("work_requests", { task_id: task.id }).items[0].id,
    newRequest.id,
  );
  const reopened = new Store(f.db);
  t.after(() => reopened.close());
  assert.ok(reopened.get("message", messages[0].id)?.resolved_at);
});

test("request handling retains agent ownership checks and the original resolution on repeated submission", (t) => {
  const f = fixture(t),
    run = f.register(),
    outsider = f.register("旁观执行者");
  const message = f.s.execute("message_send", {
    project_id: f.project.id,
    to_run_id: run.id,
    kind: "request",
    body: "实际请求",
  });
  assert.throws(
    () =>
      f.s.execute("message_resolve", {
        message_id: message.id,
        run_id: outsider.id,
        note: "不属本会话",
      }),
    code("NOT_RECIPIENT"),
  );
  f.s.execute("run_end", {
    run_id: run.id,
    status: "ended",
    note: "执行者实际结束",
  });
  assert.throws(
    () =>
      f.s.execute("message_resolve", {
        message_id: message.id,
        run_id: run.id,
        note: "旧执行者",
      }),
    code("RUN_INACTIVE"),
  );
  assert.throws(() =>
    f.s.execute("message_resolve", { message_id: message.id, note: " " }),
  );
  const resolved = f.s.execute("message_resolve", {
    message_id: message.id,
    note: "人工核验后的具体结论",
  });
  const repeated = f.s.execute("message_resolve", {
    message_id: message.id,
    note: "重复点击的其他文案",
  });
  assert.deepEqual(repeated, resolved);
  assert.equal(
    f.store.events(f.project.id).filter((e) => e.type === "message.resolved")
      .length,
    1,
  );
  const discussion = f.s.execute("message_send", {
    project_id: f.project.id,
    kind: "discussion",
    body: "一般讨论",
  });
  assert.throws(
    () =>
      f.s.execute("message_resolve", {
        message_id: discussion.id,
        note: "不是请求",
      }),
    code("NOT_REQUEST"),
  );
});
