import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { Store } from "../server/store.ts";
import { Service } from "../server/domain.ts";
import type { CommandInput } from "../server/schemas.ts";
import type { WorkGuide, Task } from "../server/types.ts";

const errorCode = (code: string) => (error: unknown) =>
  error instanceof Error && "code" in error && error.code === code;
function fixture(t: TestContext, git = false) {
  const dir = mkdtempSync(join(tmpdir(), "relay-workflow-"));
  if (git) {
    execFileSync("git", ["init", "-q", dir]);
    execFileSync("git", [
      "-C",
      dir,
      "config",
      "user.email",
      "fixture@example.test",
    ]);
    execFileSync("git", ["-C", dir, "config", "user.name", "Fixture"]);
    writeFileSync(join(dir, "result.txt"), "baseline");
    execFileSync("git", ["-C", dir, "add", "."]);
    execFileSync("git", ["-C", dir, "commit", "-qm", "fixture"]);
  }
  const db = join(dir, "board.sqlite");
  if (git)
    writeFileSync(join(dir, ".gitignore"), "board.sqlite*\n.gitignore\n");
  const store = new Store(db),
    s = new Service(store);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const p = s.execute("project_create", {
    name: "接手测试",
    objective: "完成可恢复任务",
    root_path: dir,
  });
  const register = (name = "A") =>
    s.execute("agent_register", {
      project_id: p.id,
      name,
      runtime: "codex",
      workdir: dir,
    }).run;
  const create = (extra: Partial<CommandInput<"task_create">> = {}) =>
    s.execute("task_create", {
      project_id: p.id,
      title: "执行任务",
      acceptance: "产出文件和实际验证",
      scopes: ["result.txt"],
      execution: {
        inputs: ["契约"],
        outputs: ["result.txt"],
        stop_when: ["范围需扩大"],
        steps: [
          {
            id: "write",
            title: "实现",
            instructions: "完成产出",
            done_when: "文件符合契约",
            on_failure: "报告阻塞",
          },
          {
            id: "check",
            title: "检查",
            instructions: "检查边界",
            done_when: "边界结果已观察",
            on_failure: "记录失败并修正",
          },
        ],
      },
      ...extra,
    });
  const next = (run_id: string, task_id: string) =>
    s.query("work_next", { run_id, task_id });
  const report = (
    g: WorkGuide,
    kind: CommandInput<"work_report">["kind"],
    extra: Partial<CommandInput<"work_report">> = {},
  ) =>
    s.execute("work_report", {
      handle: g.handle!,
      kind,
      summary: "实际结果已记录",
      ...extra,
    });
  const recover = (g: WorkGuide) =>
    report(g, "recover", {
      observed: `检查目录${dir}、分支、改动与进程`,
      read_decision_ids: s
        .query("decisions", {
          project_id: p.id,
          task_id: g.task!.id,
          limit: 50,
        })
        .items.map((d) => d.id),
      dependency_receipts: g.dependencies.map((d) => ({
        task_id: d.id,
        revision: d.revision,
        note: "已核对实际成果",
      })),
    });
  return { dir, db, store, s, p, register, create, next, report, recover };
}

test("guided executor must recover and complete ordered steps before verification and independent review", (t) => {
  const f = fixture(t),
    run = f.register(),
    task = f.create();
  let g = f.s.execute("work_start", { run_id: run.id, task_id: task.id });
  assert.equal(g.stage, "recover");
  assert.throws(
    () => f.report(g, "step", { step_id: "write" }),
    errorCode("RECOVERY_REQUIRED"),
  );
  g = f.recover(g);
  assert.equal(g.stage, "execute");
  assert.throws(
    () => f.report(g, "step", { step_id: "check" }),
    errorCode("STEP_ORDER"),
  );
  assert.throws(
    () =>
      f.report(g, "verify", {
        verification: [{ command: "check", result: "pass", passed: true }],
      }),
    errorCode("STEPS_INCOMPLETE"),
  );
  const stale = g;
  g = f.report(g, "step", { step_id: "write" });
  assert.throws(() => f.report(stale, "progress"), errorCode("STALE_VERSION"));
  g = f.report(g, "step", { step_id: "check" });
  assert.equal(g.stage, "verify");
  g = f.report(g, "verify", {
    artifacts: [{ path: "result.txt" }],
    verification: [
      { command: "check", result: "observed failure", passed: false },
    ],
  });
  assert.equal(g.stage, "verify");
  g = f.report(g, "verify", {
    artifacts: [{ path: "result.txt" }],
    verification: [
      { command: "check", result: "observed success", passed: true },
    ],
  });
  assert.equal(g.stage, "submit");
  g = f.report(g, "submit");
  assert.equal(g.stage, "review");
  assert.throws(
    () =>
      f.s.execute("task_review", {
        task_id: task.id,
        expected_version: g.task!.version,
        reviewer_run_id: run.id,
        accepted: true,
        human_review: true,
        note: "self",
      }),
    errorCode("SELF_REVIEW"),
  );
  const reviewer = f.register("reviewer");
  f.s.execute("task_review", {
    task_id: task.id,
    expected_version: g.task!.version,
    reviewer_run_id: reviewer.id,
    accepted: true,
    human_review: true,
    note: "独立核对通过",
  });
  assert.equal(f.next(run.id, task.id).stage, "done");
});

test("fresh Run resumes an explicitly handed-off partial task without losing failed attempts or redoing completed steps", (t) => {
  const f = fixture(t),
    a = f.register(),
    b = f.register("B"),
    task = f.create();
  let g = f.recover(
    f.s.execute("work_start", { run_id: a.id, task_id: task.id }),
  );
  g = f.report(g, "step", {
    step_id: "write",
    facts: ["实现已经保存"],
    failed_attempts: ["旧方案不支持边界"],
    uncertain_actions: ["之前的外部调用结果待核实"],
  });
  assert.equal(g.stage, "blocked");
  const old = g;
  const fresh = new Service(f.store);
  assert.equal(
    fresh.query("work_next", { run_id: a.id, task_id: task.id }).stage,
    "blocked",
  );
  assert.equal(
    f.s.execute("work_start", { run_id: b.id, task_id: task.id }).stage,
    "unavailable",
  );
  const handed = f.s.execute("task_handoff", {
    task_id: task.id,
    expected_version: g.task!.version,
    from_run_id: a.id,
    to_run_id: b.id,
    summary: "继续第二步并核实外部操作",
    descendants: "require_stopped",
    confirmed_stop: true,
  });
  assert.throws(() => f.report(old, "progress"), errorCode("STALE_CLAIM"));
  let received = fresh.query("work_next", { run_id: b.id, task_id: task.id });
  assert.equal(received.stage, "recover");
  received = f.recover(received);
  assert.equal(received.stage, "blocked");
  assert.deepEqual(f.s.task(task.id).workflow?.completed_steps, ["write"]);
  assert.match(received.context!.markdown, /旧方案不支持边界/);
  received = f.report(received, "progress", {
    summary: "已核实调用未执行，允许后续重试",
    uncertain_actions: [],
  });
  assert.equal(received.current_step?.id, "check");
  assert.equal(received.stage, "execute");
  assert.equal(handed.owner_run_id, b.id);
});

test("contract and project changes invalidate handles; coordinator context includes descendant contracts", (t) => {
  const f = fixture(t),
    run = f.register(),
    task = f.create();
  let g = f.recover(
    f.s.execute("work_start", { run_id: run.id, task_id: task.id }),
  );
  const d = f.s.execute("decision_record", {
    project_id: f.p.id,
    title: "新契约",
    body: "完整接口字段",
    task_ids: [task.id],
  });
  assert.throws(
    () => f.report(g, "step", { step_id: "write" }),
    errorCode("CONTEXT_CHANGED"),
  );
  g = f.next(run.id, task.id);
  assert.equal(g.stage, "recover");
  assert.throws(
    () => f.report(g, "recover", { observed: "核对现场" }),
    errorCode("CONTRACTS_UNREAD"),
  );
  g = f.recover(g);
  assert.equal(g.stage, "execute");
  f.s.execute("project_update", {
    project_id: f.p.id,
    expected_version: f.p.version,
    constraints: "保留现有数据",
  });
  assert.equal(f.next(run.id, task.id).stage, "recover");
  const parent = f.create({ title: "协调者", scopes: ["."] });
  const split = f.s.execute("task_split", {
    task_id: parent.id,
    expected_version: parent.version,
    children: [
      { title: "a", acceptance: "通过", scopes: ["a"] },
      { title: "b", acceptance: "通过", scopes: ["b"] },
    ],
    rationale: "并行",
  });
  const childDecision = f.s.execute("decision_record", {
    project_id: f.p.id,
    title: "子任务构建契约",
    body: "输出到lib",
    task_ids: [split.children[0].id],
  });
  assert.match(
    f.s.query("context", { task_id: parent.id }).markdown,
    /子任务构建契约/,
  );
  assert.ok(
    f.s
      .query("decisions", { project_id: f.p.id, task_id: parent.id })
      .items.some((x) => x.id === childDecision.id),
  );
  assert.ok(
    f.s
      .query("decisions", { project_id: f.p.id, task_id: task.id })
      .items.some((x) => x.id === d.id),
  );
});

test("done dependencies must be received by artifact revision, not just declared complete", (t) => {
  const f = fixture(t),
    run = f.register();
  let dep = f.create({
    title: "前置",
    execution: null,
    scopes: ["dependency.txt"],
  });
  dep = f.s.execute("task_claim", {
    task_id: dep.id,
    run_id: run.id,
    expected_version: dep.version,
  });
  dep = f.s.execute("task_checkpoint", {
    task_id: dep.id,
    run_id: run.id,
    claim_epoch: dep.claim_epoch,
    summary: "完成",
    artifacts: [{ path: "dep-commit", kind: "commit" }],
    verification: [{ command: "check", result: "passed", passed: true }],
  });
  dep = f.s.execute("task_submit", {
    task_id: dep.id,
    run_id: run.id,
    claim_epoch: dep.claim_epoch,
    summary: "交付",
  });
  f.s.execute("task_review", {
    task_id: dep.id,
    expected_version: dep.version,
    accepted: true,
    human_review: true,
    note: "人工核对",
  });
  const task = f.create({ depends_on: [dep.id] });
  let g = f.s.execute("work_start", { run_id: run.id, task_id: task.id });
  assert.equal(g.dependencies[0].received, false);
  assert.throws(
    () =>
      f.report(g, "recover", {
        observed: "目录正确",
        dependency_receipts: [
          { task_id: dep.id, revision: "old", note: "误用旧提交" },
        ],
      }),
    errorCode("DEPENDENCIES_NOT_RECEIVED"),
  );
  g = f.recover(g);
  assert.equal(g.dependencies[0].received, true);
});

test("service-observed git fingerprints expire verification when tracked or untracked bytes change", (t) => {
  const f = fixture(t, true),
    run = f.register(),
    task = f.create({ execution: null, scopes: ["."] });
  let g = f.recover(
    f.s.execute("work_start", { run_id: run.id, task_id: task.id }),
  );
  g = f.report(g, "progress", { ready_for_verification: true });
  writeFileSync(join(f.dir, "result.txt"), "new");
  const verify = () =>
    f.report(g, "verify", {
      artifacts: [{ path: "result.txt" }],
      verification: [{ command: "check", result: "actual pass", passed: true }],
    });
  g = verify();
  assert.equal(g.stage, "submit");
  assert.equal(f.s.task(task.id).evidence?.source, "service_observed_git");
  writeFileSync(join(f.dir, "result.txt"), "later change");
  assert.equal(f.next(run.id, task.id).stage, "verify");
  assert.throws(() => f.report(g, "submit"), errorCode("EVIDENCE_STALE"));
  g = verify();
  writeFileSync(join(f.dir, "new.txt"), "first untracked");
  assert.equal(f.next(run.id, task.id).stage, "verify");
  g = verify();
  writeFileSync(join(f.dir, "new.txt"), "changed untracked");
  assert.equal(f.next(run.id, task.id).stage, "verify");
});

test("execution plan changes reset ordered completion and legacy tasks require explicit readiness", (t) => {
  const f = fixture(t),
    run = f.register(),
    task = f.create();
  let g = f.recover(
    f.s.execute("work_start", { run_id: run.id, task_id: task.id }),
  );
  g = f.report(g, "step", { step_id: "write" });
  f.s.execute("task_update", {
    task_id: task.id,
    expected_version: g.task!.version,
    actor_run_id: run.id,
    execution: {
      steps: [
        {
          id: "new",
          title: "新步骤",
          instructions: "新约定",
          done_when: "检查通过",
          on_failure: "报告",
        },
      ],
    },
  });
  g = f.recover(f.next(run.id, task.id));
  assert.equal(g.current_step?.id, "new");
  assert.deepEqual(g.completed_steps, []);
  f.s.execute("task_update", {
    task_id: task.id,
    expected_version: g.task!.version,
    actor_run_id: run.id,
    execution: null,
  });
  g = f.recover(f.next(run.id, task.id));
  assert.equal(g.stage, "execute");
  assert.throws(
    () =>
      f.report(g, "verify", {
        verification: [{ command: "check", result: "pass", passed: true }],
      }),
    errorCode("NOT_READY_FOR_VERIFICATION"),
  );
});

test("small bounded handoff declares omissions and preserves essential identity and constraint pointers", (t) => {
  const f = fixture(t),
    run = f.register(),
    task = f.create();
  f.s.execute("project_update", {
    project_id: f.p.id,
    expected_version: f.p.version,
    constraints: "保留数据。".repeat(1500),
  });
  f.s.execute("decision_record", {
    project_id: f.p.id,
    title: "长契约",
    body: "字段约定".repeat(2000),
    task_ids: [task.id],
  });
  const g = f.s.execute("work_start", { run_id: run.id, task_id: task.id });
  const packet = f.s.query("context", { task_id: task.id, max_chars: 1500 });
  assert.equal(packet.truncated, true);
  assert.ok(packet.markdown.length <= 1500);
  assert.match(packet.markdown, /relay_project/);
  assert.match(packet.markdown, /用户约束/);
  assert.ok(g.warnings.some((x) => x.includes("省略")));
  assert.ok(g.next_action.arguments.handle);
});

test("guided verification replaces the current check snapshot while failed history remains auditable", (t) => {
  const f = fixture(t),
    run = f.register(),
    task = f.create({ execution: null });
  let g = f.recover(
    f.s.execute("work_start", { run_id: run.id, task_id: task.id }),
  );
  g = f.report(g, "progress", { ready_for_verification: true });
  g = f.report(g, "verify", {
    artifacts: [{ path: "result.txt" }],
    verification: [{ command: "old check", result: "fail", passed: false }],
  });
  g = f.report(g, "verify", {
    verification: [
      { command: "new complete check", result: "all pass", passed: true },
    ],
  });
  assert.equal(g.stage, "submit");
  assert.equal(f.report(g, "submit").stage, "review");
  assert.ok(
    f.s.store
      .events(f.p.id, 0, 200)
      .some(
        (e) =>
          e.type === "task.checkpoint" &&
          JSON.stringify(e).includes("old check"),
      ),
  );
});

test("dependency revisions are paginated and a coordinator can recover before a child's own prerequisites", (t) => {
  const f = fixture(t),
    run = f.register();
  const deps: Task[] = [];
  for (let n = 0; n < 21; n++) {
    const raw = f.create({
      title: `依赖${n}`,
      scopes: [`dep-${n}`],
      execution: null,
    });
    const done = {
      ...raw,
      status: "done" as const,
      completed_at: new Date().toISOString(),
      artifacts: [
        { path: `hash-${n}`, kind: "commit" as const, note: "a".repeat(5000) },
      ],
    };
    f.store.put("task", done);
    deps.push(done);
  }
  const task = f.create({ depends_on: deps.map((d) => d.id) });
  let g = f.s.execute("work_start", { run_id: run.id, task_id: task.id });
  assert.ok(g.dependencies.length <= 10);
  assert.ok(g.dependency_page.next_offset !== null);
  const receipts = [];
  let offset: number | null = 0;
  while (offset !== null) {
    const page: import("../server/types.ts").QueryResults["work_dependencies"] =
      f.s.query("work_dependencies", { task_id: task.id, offset, limit: 10 });
    receipts.push(
      ...page.items.map((d) => ({
        task_id: d.id,
        revision: d.revision,
        note: "已实际核对成果",
      })),
    );
    offset = page.next_offset;
  }
  g = f.report(g, "recover", {
    observed: "已核对文件和全部依赖",
    dependency_receipts: receipts,
  });
  assert.equal(g.stage, "execute");
  assert.ok(JSON.stringify(g.dependencies).length < 15000);
  const pending = f.create({
    title: "等待外部",
    scopes: ["external"],
    execution: null,
  });
  const parent = f.create({
    title: "协调",
    scopes: ["children"],
    execution: null,
  });
  let claimed = f.s.execute("task_claim", {
    task_id: parent.id,
    run_id: run.id,
    expected_version: parent.version,
  });
  const split = f.s.execute("task_split", {
    task_id: parent.id,
    expected_version: claimed.version,
    actor_run_id: run.id,
    children: [
      {
        title: "需外部",
        scopes: ["children/a"],
        acceptance: "完成",
        depends_on: [pending.id],
      },
      { title: "独立", scopes: ["children/b"], acceptance: "完成" },
    ],
    rationale: "独立推进",
  });
  const coordinator = f.recover(f.next(run.id, split.parent.id));
  assert.equal(coordinator.stage, "wait_children");
});

test("contract changes reset step completion while copied action templates cannot claim factual recovery", (t) => {
  const f = fixture(t),
    run = f.register(),
    task = f.create();
  let g = f.s.execute("work_start", { run_id: run.id, task_id: task.id });
  assert.throws(
    () => f.s.execute("work_report" as string, g.next_action.arguments),
    { name: "ZodError" },
  );
  g = f.recover(g);
  g = f.report(g, "step", { step_id: "write" });
  f.s.execute("decision_record", {
    project_id: f.p.id,
    title: "变更字段",
    body: "先前实现须复核",
    task_ids: [task.id],
  });
  g = f.recover(f.next(run.id, task.id));
  assert.deepEqual(g.completed_steps, []);
  assert.equal(g.current_step?.id, "write");
  const old = g;
  f.s.execute("project_update", {
    project_id: f.p.id,
    expected_version: f.p.version,
    root_path: join(f.dir, "new-root"),
  });
  assert.throws(
    () => f.report(old, "step", { step_id: "write" }),
    errorCode("CONTEXT_CHANGED"),
  );
});

test("handoff preserves unresolved requests even after read acknowledgement, until explicit handling", (t) => {
  const f = fixture(t),
    a = f.register(),
    b = f.register("B"),
    task = f.create();
  let g = f.recover(
    f.s.execute("work_start", { run_id: a.id, task_id: task.id }),
  );
  const message = f.s.execute("message_send", {
    project_id: f.p.id,
    to_run_id: a.id,
    task_id: task.id,
    kind: "request",
    body: "接口必须保留旧字段",
  });
  f.s.execute("message_ack", { message_id: message.id, run_id: a.id });
  f.s.execute("task_handoff", {
    task_id: task.id,
    expected_version: g.task!.version,
    from_run_id: a.id,
    to_run_id: b.id,
    summary: "继续实现",
    descendants: "require_stopped",
    confirmed_stop: true,
  });
  g = f.next(b.id, task.id);
  assert.ok(g.messages.some((m) => m.id === message.id));
  assert.match(g.context!.markdown, /接口必须保留旧字段/);
  assert.equal(f.s.query("work_requests", { task_id: task.id }).total, 1);
  const outsider = f.register("other");
  assert.throws(
    () =>
      f.s.execute("message_resolve", {
        message_id: message.id,
        run_id: outsider.id,
        note: "代处理",
      }),
    errorCode("NOT_RECIPIENT"),
  );
  f.s.execute("message_resolve", {
    message_id: message.id,
    run_id: b.id,
    note: "旧字段已保留并验证",
  });
  assert.equal(f.s.query("work_requests", { task_id: task.id }).total, 0);
  assert.equal(
    f.s.query("snapshot", { project_id: f.p.id }).attention?.requests_total,
    0,
  );
});

test("a whole guide is bounded even when saved uncertainty and scope metadata are very large", (t) => {
  const f = fixture(t),
    run = f.register(),
    task = f.create();
  let g = f.recover(
    f.s.execute("work_start", { run_id: run.id, task_id: task.id }),
  );
  g = f.report(g, "progress", {
    uncertain_actions: Array.from(
      { length: 30 },
      (_, n) => `${n}:` + "x".repeat(9000),
    ),
  });
  assert.ok(
    JSON.stringify(g).length <= g.char_budget,
    JSON.stringify(g).length.toString(),
  );
  assert.equal(g.truncated, true);
  const tiny = f.s.query("work_next", {
    task_id: task.id,
    run_id: run.id,
    max_chars: 1500,
  });
  assert.ok(JSON.stringify(tiny).length <= tiny.char_budget);
  assert.equal(tiny.char_budget, 6000);
  assert.equal(tiny.stage, "blocked");
  assert.ok(tiny.next_action.arguments.handle);
});

test("legacy submit cannot bypass recovery and ordered work on a guided task, and no-artifact guides request verification", (t) => {
  const f = fixture(t),
    run = f.register(),
    task = f.create();
  let g = f.s.execute("work_start", { run_id: run.id, task_id: task.id });
  const cp = f.s.execute("task_checkpoint", {
    task_id: task.id,
    run_id: run.id,
    claim_epoch: g.handle!.claim_epoch,
    summary: "绕过流程",
    artifacts: [{ path: "result.txt" }],
    verification: [{ command: "test", result: "pass", passed: true }],
  });
  assert.throws(
    () =>
      f.s.execute("task_submit", {
        task_id: task.id,
        run_id: run.id,
        claim_epoch: cp.claim_epoch,
        summary: "交付",
      }),
    errorCode("RECOVERY_REQUIRED"),
  );
  g = f.recover(f.next(run.id, task.id));
  assert.throws(
    () =>
      f.s.execute("task_submit", {
        task_id: task.id,
        run_id: run.id,
        claim_epoch: g.handle!.claim_epoch,
        summary: "交付",
      }),
    errorCode("STEPS_INCOMPLETE"),
  );
  const other = f.create({
    title: "无成果验证",
    scopes: ["other"],
    execution: null,
  });
  let o = f.recover(
    f.s.execute("work_start", { run_id: run.id, task_id: other.id }),
  );
  o = f.report(o, "progress", { ready_for_verification: true });
  o = f.report(o, "verify", {
    verification: [{ command: "test", result: "pass", passed: true }],
  });
  assert.equal(o.stage, "verify");
});

test("recovery can report missing inputs before attesting success without unlocking writes", (t) => {
  const f = fixture(t),
    a = f.register(),
    b = f.register("B"),
    task = f.create();
  let g = f.s.execute("work_start", { run_id: a.id, task_id: task.id });
  g = f.report(g, "blocked", { summary: "缺少输入契约，先求助" });
  assert.equal(g.stage, "recover");
  assert.match(g.headline, /缺少输入/);
  assert.throws(
    () => f.report(g, "step", { step_id: "write" }),
    errorCode("RECOVERY_REQUIRED"),
  );
  g = f.recover(g);
  assert.equal(g.stage, "execute");
  f.s.execute("task_handoff", {
    task_id: task.id,
    expected_version: g.task!.version,
    from_run_id: a.id,
    to_run_id: b.id,
    summary: "接手",
    descendants: "require_stopped",
    confirmed_stop: true,
  });
  g = f.next(b.id, task.id);
  g = f.report(g, "blocked", { summary: "本地未找到输入" });
  assert.equal(f.s.task(task.id).status, "reconcile");
  assert.equal(g.stage, "recover");
  g = f.recover(g);
  assert.equal(f.s.task(task.id).status, "doing");
  assert.equal(g.stage, "execute");
});

test("a long release note cannot break the whole-guide character budget on reclaim", (t) => {
  const f = fixture(t),
    a = f.register(),
    b = f.register("B"),
    task = f.create();
  let g = f.recover(
    f.s.execute("work_start", { run_id: a.id, task_id: task.id }),
  );
  f.s.execute("task_release", {
    task_id: task.id,
    run_id: a.id,
    claim_epoch: g.handle!.claim_epoch,
    note: "x".repeat(12000),
    confirmed_stop: true,
  });
  g = f.s.execute("work_start", { run_id: b.id, task_id: task.id });
  assert.ok(JSON.stringify(g).length <= g.char_budget);
});
