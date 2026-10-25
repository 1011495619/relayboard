import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { Store } from "../server/store.ts";
import { Service } from "../server/domain.ts";
import type {
  Task,
  Run,
  VerificationLogView,
} from "../server/types.ts";

const now = () => new Date().toISOString();

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function waitFor<T>(
  fn: () => T,
  predicate: (value: T) => boolean,
  timeoutMs = 15000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let value = fn();
  while (!predicate(value)) {
    if (Date.now() > deadline)
      throw new Error(`waitFor 超时：${JSON.stringify(value)}`);
    await sleep(50);
    value = fn();
  }
  return value;
}

/** 在 dir 里建一个带 src/ 的 git 仓库，供 observeWorkspace 产生稳定指纹。 */
function makeGitWorkdir(dir: string) {
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "hello.txt"), "hello\n");
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: dir });
}

function writeFixture(dir: string, name: string, code: string): string {
  const path = join(dir, name);
  writeFileSync(path, code);
  return path;
}

interface Harness {
  service: Service;
  store: Store;
  dir: string;
  workdir: string;
  projectId: string;
  run: Run;
  task: Task;
}

function harness(t?: test.TestContext): Harness {
  const dir = mkdtempSync(join(tmpdir(), "rb003-verify-"));
  t?.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new Store(join(dir, "relayboard.sqlite"));
  const service = new Service(store, { dataDir: dir });
  const workdir = join(dir, "work");
  makeGitWorkdir(workdir);
  const project = service.execute("project_create", {
    name: "verify",
    objective: "verify",
  });
  const run = service.execute("agent_register", {
    project_id: project.id,
    name: "executor",
    runtime: "other",
    workdir,
    observation: "self",
  }).run;
  const created = service.execute("task_create", {
    project_id: project.id,
    title: "V",
    acceptance: "pass",
    scopes: ["src"],
  });
  const task = service.execute("task_claim", {
    task_id: created.id,
    run_id: run.id,
    expected_version: created.version,
  });
  return { service, store, dir, workdir, projectId: project.id, run, task };
}

function writeProfiles(
  dir: string,
  profiles: Record<string, unknown>,
  version = 1,
) {
  writeFileSync(
    join(dir, "verification-profiles.json"),
    JSON.stringify({ version, profiles }),
  );
}

function profilesWith(
  dir: string,
  overrides: Record<string, Record<string, unknown>>,
) {
  const profiles: Record<string, unknown> = {};
  for (const [id, p] of Object.entries(overrides))
    profiles[id] = { command: process.execPath, args: [], ...p };
  writeProfiles(dir, profiles);
}

test("A003-1：旧数据副本重开，service_verification 为 null 且历史为空页", () => {
  const dir = mkdtempSync(join(tmpdir(), "rb003-old-"));
  try {
    const store = new Store(join(dir, "relayboard.sqlite"));
    const service = new Service(store, { dataDir: dir });
    const project = service.execute("project_create", {
      name: "old",
      objective: "old",
    });
    const created = service.execute("task_create", {
      project_id: project.id,
      title: "Old",
      acceptance: "pass",
      scopes: ["src"],
    });
    assert.equal(created.service_verification, undefined);
    const history = service.query("verification_history", {
      task_id: created.id,
    });
    assert.deepEqual(history, { items: [], total: 0, next_offset: null });
    const detail = service.query("task", { task_id: created.id });
    assert.ok(!("service_verification" in detail) || detail.service_verification == null);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("A003-2/3：profile 发现与仅传 profile_id 启动，成功执行且不自动验收", async (t) => {
  const h = harness(t);
  const fixture = writeFixture(
    h.dir,
    "ok.mjs",
    'process.stdout.write("stdout-ok\\n");process.stderr.write("stderr-ok\\n");process.exit(0);\n',
  );
  profilesWith(h.dir, { check: { command: process.execPath, args: [fixture], cwd: "." } });
  const discovery = h.service.query("verification_profiles", {});
  assert.equal(discovery.valid, true);
  assert.equal(discovery.config_version, 1);
  assert.ok(discovery.items.some((i: { id: string }) => i.id === "check"));
  assert.ok(discovery.config_sha256);

  const execution = h.service.execute("verification_start", {
    task_id: h.task.id,
    run_id: h.run.id,
    claim_epoch: h.task.claim_epoch,
    profile_id: "check",
  });
  assert.equal(execution.source, "service_executed");
  assert.equal(execution.profile_id, "check");
  assert.ok(execution.workspace_before.fingerprint);
  const final = await waitFor(
    () => h.service.verification.execution(execution.id),
    (e) => ["succeeded", "failed", "timed_out", "stopped", "start_failed", "unknown"].includes(e.status) && e.status !== "running" && e.status !== "queued",
  );
  assert.equal(final.status, "succeeded");
  assert.equal(final.exit_code, 0);
  assert.ok(final.started_at && final.ended_at);
  assert.ok(final.workspace_after?.fingerprint);
  assert.equal(final.reservation.state, "released");

  // 任务不自动 review/done
  const task = h.service.task(h.task.id);
  assert.equal(task.status, "doing");
  assert.equal(task.service_verification?.status, "succeeded");
  assert.equal(task.service_verification?.passed, true);
  // Agent 自报 verification 仍独立为空
  assert.deepEqual(task.verification, []);
});

test("A003-4：非零退出 failed，任何视图不显示通过", async (t) => {
  const h = harness(t);
  const fixture = writeFixture(
    h.dir,
    "fail.mjs",
    'process.stdout.write("boom\\n");process.exit(3);\n',
  );
  profilesWith(h.dir, { fail: { command: process.execPath, args: [fixture] } });
  const execution = h.service.execute("verification_start", {
    task_id: h.task.id,
    run_id: h.run.id,
    claim_epoch: h.task.claim_epoch,
    profile_id: "fail",
  });
  const final = await waitFor(
    () => h.service.verification.execution(execution.id),
    (e) => e.status === "failed",
  );
  assert.equal(final.exit_code, 3);
  const task = h.service.task(h.task.id);
  assert.equal(task.service_verification?.status, "failed");
  assert.equal(task.service_verification?.passed, false);
  const log = h.service.query("verification_log", {
    execution_id: execution.id,
  });
  assert.ok(log.text.includes("boom"));
  assert.equal(log.complete, true);
});

test("A003-5：超时终止进程组，超时或未知且不伪装 stopped", async (t) => {
  const h = harness(t);
  const fixture = writeFixture(
    h.dir,
    "hang.mjs",
    "setInterval(()=>{},1000);\n",
  );
  profilesWith(h.dir, {
    hang: { command: process.execPath, args: [fixture], timeout_ms: 1000 },
  });
  const execution = h.service.execute("verification_start", {
    task_id: h.task.id,
    run_id: h.run.id,
    claim_epoch: h.task.claim_epoch,
    profile_id: "hang",
  });
  const final = await waitFor(
    () => h.service.verification.execution(execution.id),
    (e) => e.status === "timed_out" || e.status === "unknown",
    20000,
  );
  assert.ok(["timed_out", "unknown"].includes(final.status));
  if (final.status === "unknown")
    assert.equal(final.reservation.state, "held");
  else assert.equal(final.reservation.state, "released");
  const log = h.service.query("verification_log", {
    execution_id: execution.id,
  });
  assert.equal(log.capture_complete, true);
});

test("A003-6：显式 stop 长运行进程，全退出才 stopped/released", async (t) => {
  const h = harness(t);
  const fixture = writeFixture(
    h.dir,
    "long.mjs",
    "setInterval(()=>{},1000);\n",
  );
  profilesWith(h.dir, { long: { command: process.execPath, args: [fixture] } });
  const execution = h.service.execute("verification_start", {
    task_id: h.task.id,
    run_id: h.run.id,
    claim_epoch: h.task.claim_epoch,
    profile_id: "long",
  });
  await waitFor(
    () => h.service.verification.execution(execution.id),
    (e) => e.status === "running",
  );
  h.service.execute("verification_stop", {
    execution_id: execution.id,
    run_id: h.run.id,
  });
  const final = await waitFor(
    () => h.service.verification.execution(execution.id),
    (e) => ["stopped", "unknown"].includes(e.status),
    20000,
  );
  assert.ok(["stopped", "unknown"].includes(final.status));
  if (final.status === "stopped")
    assert.equal(final.reservation.state, "released");
});

test("A003-7：不存在命令/损坏 JSON/非法 cwd 分别结构化失败", async (t) => {
  const h = harness(t);
  profilesWith(h.dir, {
    missing: { command: join(h.dir, "no-such-executable") },
  });
  const execution = h.service.execute("verification_start", {
    task_id: h.task.id,
    run_id: h.run.id,
    claim_epoch: h.task.claim_epoch,
    profile_id: "missing",
  });
  assert.equal(execution.status, "start_failed");
  assert.equal(execution.error_code, "ENOENT");
  assert.equal(execution.reservation.state, "released");

  // 损坏 JSON：discovery 仍可读，start 拒绝
  writeFileSync(join(h.dir, "verification-profiles.json"), "{broken");
  const discovery = h.service.query("verification_profiles", {});
  assert.equal(discovery.valid, false);
  assert.equal(discovery.error?.code, "VERIFICATION_PROFILE_INVALID");
  assert.throws(
    () =>
      h.service.execute("verification_start", {
        task_id: h.task.id,
        run_id: h.run.id,
        claim_epoch: h.task.claim_epoch,
        profile_id: "missing",
      }),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "VERIFICATION_PROFILE_INVALID",
  );

  // 非法 cwd：越出 workdir
  profilesWith(h.dir, { badcwd: { command: process.execPath, args: [], cwd: "../outside" } });
  assert.throws(
    () =>
      h.service.execute("verification_start", {
        task_id: h.task.id,
        run_id: h.run.id,
        claim_epoch: h.task.claim_epoch,
        profile_id: "badcwd",
      }),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "VERIFICATION_WORKDIR_INVALID",
  );
});

test("A003-8：输出超过上限，log 有界且 output_truncated=true", async (t) => {
  const h = harness(t);
  const fixture = writeFixture(
    h.dir,
    "noisy.mjs",
    "process.stdout.write('x'.repeat(20000));process.exit(0);\n",
  );
  profilesWith(h.dir, {
    noisy: { command: process.execPath, args: [fixture], max_output_bytes: 1024 },
  });
  const execution = h.service.execute("verification_start", {
    task_id: h.task.id,
    run_id: h.run.id,
    claim_epoch: h.task.claim_epoch,
    profile_id: "noisy",
  });
  const final = await waitFor(
    () => h.service.verification.execution(execution.id),
    (e) => e.status === "succeeded",
  );
  assert.equal(final.status, "succeeded");
  assert.equal(final.output_truncated, true);
  assert.ok(final.log_bytes <= 1024);
  const log = h.service.query("verification_log", {
    execution_id: execution.id,
  });
  assert.equal(log.capture_truncated, true);
  assert.equal(log.capture_complete, false);
  assert.equal(log.complete, false);
  assert.ok(log.log_sha256);
});

test("A003-8a：日志分页读中文/emoji 与非法 UTF-8，游标不切断码点", async (t) => {
  const h = harness(t);
  const fixture = writeFixture(
    h.dir,
    "utf8.mjs",
    "process.stdout.write('中😀A');process.stdout.write(Buffer.from([0xff,0xfe,0x61]));process.exit(0);\n",
  );
  profilesWith(h.dir, { utf8: { command: process.execPath, args: [fixture] } });
  const execution = h.service.execute("verification_start", {
    task_id: h.task.id,
    run_id: h.run.id,
    claim_epoch: h.task.claim_epoch,
    profile_id: "utf8",
  });
  await waitFor(
    () => h.service.verification.execution(execution.id),
    (e) => e.status === "succeeded",
  );
  let cursor: string | null = null;
  let totalText = "";
  let pages = 0;
  for (;;) {
    const log: VerificationLogView = h.service.query("verification_log", {
      execution_id: execution.id,
      cursor: cursor ?? undefined,
      limit: 2,
    });
    totalText += log.text;
    pages++;
    if (log.complete) break;
    cursor = log.next_cursor;
    assert.ok(pages < 40, "分页未终止");
  }
  assert.ok(totalText.includes("中😀A"));
  assert.ok(totalText.includes("\uFFFD"));
  const full = h.service.query("verification_log", {
    execution_id: execution.id,
  });
  assert.equal(full.complete, true);
  assert.ok(full.replacement_count >= 1);
});

test("A003-8b：游标跨执行/丢失日志分别报错", async (t) => {
  const h = harness(t);
  const fixture = writeFixture(h.dir, "a.mjs", "process.exit(0);\n");
  const fixture2 = writeFixture(h.dir, "b.mjs", "process.exit(0);\n");
  profilesWith(h.dir, { a: { command: process.execPath, args: [fixture] }, b: { command: process.execPath, args: [fixture2] } });
  const first = h.service.execute("verification_start", {
    task_id: h.task.id,
    run_id: h.run.id,
    claim_epoch: h.task.claim_epoch,
    profile_id: "a",
  });
  await waitFor(() => h.service.verification.execution(first.id), (e) => e.status === "succeeded");
  const second = h.service.execute("verification_start", {
    task_id: h.task.id,
    run_id: h.run.id,
    claim_epoch: h.task.claim_epoch,
    profile_id: "b",
  });
  await waitFor(() => h.service.verification.execution(second.id), (e) => e.status === "succeeded");
  const logA: VerificationLogView = h.service.query("verification_log", {
    execution_id: first.id,
    limit: 64,
  });
  // 用 A 的游标读 B：文件身份不同报 CURSOR
  assert.throws(
    () =>
      h.service.query("verification_log", {
        execution_id: second.id,
        cursor: logA.next_cursor ?? undefined,
      }),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "VERIFICATION_LOG_CURSOR",
  );
  // 删除日志后读取报 UNAVAILABLE，执行记录保留
  rmSync(first.log_path, { force: true });
  assert.throws(
    () => h.service.query("verification_log", { execution_id: first.id }),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "VERIFICATION_LOG_UNAVAILABLE",
  );
  assert.ok(h.service.verification.execution(first.id).id);
});

test("A003-9/11：执行中与执行后修改 scope 内文件使证据 stale", async (t) => {
  const h = harness(t);
  const fixture = writeFixture(
    h.dir,
    "mutate.mjs",
    `import { writeFileSync } from "node:fs";
setTimeout(() => writeFileSync("src/hello.txt", "changed\\n"), 50);
setTimeout(() => process.exit(0), 150);
`,
  );
  profilesWith(h.dir, { mutate: { command: process.execPath, args: [fixture] } });
  const execution = h.service.execute("verification_start", {
    task_id: h.task.id,
    run_id: h.run.id,
    claim_epoch: h.task.claim_epoch,
    profile_id: "mutate",
  });
  const final = await waitFor(
    () => h.service.verification.execution(execution.id),
    (e) => e.status === "succeeded",
  );
  assert.equal(final.status, "succeeded");
  assert.ok(final.freshness.reasons.includes("scope_changed_during_run"));
  assert.equal(final.freshness.state, "stale");
  const task = h.service.task(h.task.id);
  assert.ok(task.service_verification?.freshness.reasons.includes("scope_changed_during_run"));
});

test("A003-12：profile 变更使历史执行 stale 且旧历史仍可查", async (t) => {
  const h = harness(t);
  const fixture = writeFixture(h.dir, "ok2.mjs", "process.exit(0);\n");
  profilesWith(h.dir, { ok2: { command: process.execPath, args: [fixture] } });
  const execution = h.service.execute("verification_start", {
    task_id: h.task.id,
    run_id: h.run.id,
    claim_epoch: h.task.claim_epoch,
    profile_id: "ok2",
  });
  await waitFor(() => h.service.verification.execution(execution.id), (e) => e.status === "succeeded");
  // 修改 profile（换 args），历史执行应 profile_changed
  profilesWith(h.dir, { ok2: { command: process.execPath, args: [fixture, "extra"] } });
  const after = h.service.verification.execution(execution.id);
  assert.ok(after.freshness.reasons.includes("profile_changed"));
  const history = h.service.query("verification_history", { task_id: h.task.id });
  assert.equal(history.total, 1);
  assert.equal(history.items[0]?.id, execution.id);
});

test("A003-13：重开库后 queued/running 转 unknown+held，阻断再次 start", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "rb003-restart-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new Store(join(dir, "relayboard.sqlite"));
  const service = new Service(store, { dataDir: dir });
  const workdir = join(dir, "work");
  makeGitWorkdir(workdir);
  const project = service.execute("project_create", { name: "r", objective: "r" });
  const run = service.execute("agent_register", {
    project_id: project.id,
    name: "executor",
    runtime: "other",
    workdir,
    observation: "self",
  }).run;
  const created = service.execute("task_create", {
    project_id: project.id,
    title: "R",
    acceptance: "pass",
    scopes: ["src"],
  });
  const task = service.execute("task_claim", {
    task_id: created.id,
    run_id: run.id,
    expected_version: created.version,
  });
  const fixture = writeFixture(dir, "okr.mjs", "process.exit(0);\n");
  writeProfiles(dir, { okr: { command: process.execPath, args: [fixture] } });
  const execution = service.execute("verification_start", {
    task_id: task.id,
    run_id: run.id,
    claim_epoch: task.claim_epoch,
    profile_id: "okr",
  });
  await waitFor(
    () => service.verification.execution(execution.id),
    (e) => e.status === "succeeded",
  );
  // 人为把记录改成 running，模拟服务在运行中重启（真实进程已退出，不残留）
  store.put("verification_execution", {
    ...service.verification.execution(execution.id),
    status: "running",
    ended_at: null,
    workspace_after: null,
  });
  // 模拟重启：新建 Service/Store 打开同一库
  store.close();
  const store2 = new Store(join(dir, "relayboard.sqlite"));
  const service2 = new Service(store2, { dataDir: dir });
  service2.reconcileVerificationAfterRestart();
  const afterRestart = service2.verification.execution(execution.id);
  assert.equal(afterRestart.status, "unknown");
  assert.equal(afterRestart.reservation.state, "held");
  // 未 reconcile 直接 start 被阻断
  assert.throws(
    () =>
      service2.execute("verification_start", {
        task_id: task.id,
        run_id: run.id,
        claim_epoch: task.claim_epoch,
        profile_id: "okr",
      }),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "VERIFICATION_UNKNOWN",
  );
  store2.close();
});

test("A003-13b：confirmed_stopped reconcile 释放后允许新执行且新 ID", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "rb003-recon-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new Store(join(dir, "relayboard.sqlite"));
  const service = new Service(store, { dataDir: dir });
  const workdir = join(dir, "work");
  makeGitWorkdir(workdir);
  const project = service.execute("project_create", { name: "rc", objective: "rc" });
  const run = service.execute("agent_register", {
    project_id: project.id,
    name: "executor",
    runtime: "other",
    workdir,
    observation: "self",
  }).run;
  const created = service.execute("task_create", {
    project_id: project.id,
    title: "RC",
    acceptance: "pass",
    scopes: ["src"],
  });
  const task = service.execute("task_claim", {
    task_id: created.id,
    run_id: run.id,
    expected_version: created.version,
  });
  const fixture = writeFixture(dir, "ok3.mjs", "process.exit(0);\n");
  writeProfiles(dir, { ok3: { command: process.execPath, args: [fixture] } });
  const execution = service.execute("verification_start", {
    task_id: task.id,
    run_id: run.id,
    claim_epoch: task.claim_epoch,
    profile_id: "ok3",
  });
  await waitFor(() => service.verification.execution(execution.id), (e) => e.status === "succeeded");
  // 人为把记录改成 unknown+held 模拟重启遗留
  const unknown = {
    ...service.verification.execution(execution.id),
    status: "unknown" as const,
    reservation: {
      ...service.verification.execution(execution.id).reservation,
      state: "held" as const,
      outcome: null,
    },
  };
  store.put("verification_execution", unknown);
  // confirmed_stopped
  const reconciled = service.execute("verification_reconcile", {
    execution_id: execution.id,
    run_id: run.id,
    expected_version: unknown.version,
    outcome: "confirmed_stopped",
    observed: "ps + kill 0 确认进程树退出",
    confirmed_stop: true,
  });
  assert.equal(reconciled.reservation.state, "released");
  // 新执行生成新 ID
  const second = service.execute("verification_start", {
    task_id: task.id,
    run_id: run.id,
    claim_epoch: task.claim_epoch,
    profile_id: "ok3",
  });
  assert.notEqual(second.id, execution.id);
  await waitFor(() => service.verification.execution(second.id), (e) => e.status === "succeeded");
});

test("A003-14：同 request_id 同参幂等，不同参冲突，并发只一个 running", async (t) => {
  const h = harness(t);
  const fixture = writeFixture(h.dir, "idem.mjs", "setTimeout(()=>process.exit(0), 300);\n");
  profilesWith(h.dir, {
    idem: { command: process.execPath, args: [fixture] },
    other: { command: process.execPath, args: [fixture] },
  });
  const args = {
    task_id: h.task.id,
    run_id: h.run.id,
    claim_epoch: h.task.claim_epoch,
    profile_id: "idem",
  };
  const first = h.service.execute("verification_start", args, "req-same");
  const replay = h.service.execute("verification_start", args, "req-same");
  assert.equal(replay.id, first.id);
  // 同 request_id 不同参数 → 幂等冲突（receipt digest 不匹配）
  assert.throws(
    () =>
      h.service.execute(
        "verification_start",
        { ...args, profile_id: "other" },
        "req-same",
      ),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "IDEMPOTENCY_MISMATCH",
  );
  // 并发第二个 start 报 VERIFICATION_RUNNING（首轮仍未结束）
  assert.throws(
    () => h.service.execute("verification_start", args),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "VERIFICATION_RUNNING",
  );
  await waitFor(
    () => h.service.verification.execution(first.id),
    (e) => e.status === "succeeded",
  );
});

test("A003-15：非 owner/旧 epoch 拒绝 start 与 stop", (t) => {
  const h = harness(t);
  const fixture = writeFixture(h.dir, "guard.mjs", "setInterval(()=>{},1000);\n");
  profilesWith(h.dir, { guard: { command: process.execPath, args: [fixture] } });
  // 另一个 run 非 owner
  const other = h.service.execute("agent_register", {
    project_id: h.projectId,
    name: "other",
    runtime: "other",
    workdir: h.workdir,
    observation: "self",
  }).run;
  assert.throws(
    () =>
      h.service.execute("verification_start", {
        task_id: h.task.id,
        run_id: other.id,
        claim_epoch: h.task.claim_epoch,
        profile_id: "guard",
      }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "STALE_CLAIM",
  );
  // 旧 epoch
  assert.throws(
    () =>
      h.service.execute("verification_start", {
        task_id: h.task.id,
        run_id: h.run.id,
        claim_epoch: h.task.claim_epoch + 1,
        profile_id: "guard",
      }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "STALE_CLAIM",
  );
});
