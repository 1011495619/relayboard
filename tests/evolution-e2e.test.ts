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
import { fileURLToPath } from "node:url";
import { spawn, execFileSync } from "node:child_process";
import type { AddressInfo } from "node:net";
import { Store } from "../server/store.ts";
import { Service } from "../server/domain.ts";
import type { Run, Task } from "../server/types.ts";
import { createApp } from "../server/app.ts";

const cli = fileURLToPath(new URL("../lib/bin/relayboard.js", import.meta.url));
const mcpStdio = fileURLToPath(new URL("../lib/bin/mcp.js", import.meta.url));

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function waitFor<T>(
  fn: () => T,
  predicate: (value: T) => boolean,
  timeoutMs = 20000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let value = fn();
  while (!predicate(value)) {
    if (Date.now() > deadline)
      throw new Error(`waitFor 超时：${JSON.stringify(value)}`);
    await sleep(60);
    value = fn();
  }
  return value;
}

/** 在 dir 里建一个带 src/ 的 git 仓库，供 observeWorkspace 产生稳定指纹。 */
function makeGitWorkdir(dir: string) {
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "scope.txt"), "scope-v1\n");
  writeFileSync(join(dir, "outside.txt"), "outside-v1\n");
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: dir });
}

function writeProfiles(dir: string, profiles: Record<string, unknown>) {
  writeFileSync(
    join(dir, "verification-profiles.json"),
    JSON.stringify({ version: 1, profiles }),
  );
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

function harness(t: test.TestContext, scopes = ["src"]): Harness {
  const dir = mkdtempSync(join(tmpdir(), "rb007-e2e-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new Store(join(dir, "relayboard.sqlite"));
  const service = new Service(store, { dataDir: dir });
  const workdir = join(dir, "work");
  makeGitWorkdir(workdir);
  const project = service.execute("project_create", {
    name: "e2e",
    objective: "e2e",
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
    title: "E2E",
    acceptance: "pass",
    scopes,
  });
  const task = service.execute("task_claim", {
    task_id: created.id,
    run_id: run.id,
    expected_version: created.version,
  });
  return { service, store, dir, workdir, projectId: project.id, run, task };
}

test("A007-4：服务验证失败后修复再运行，失败历史保留且新执行真实通过", async (t) => {
  const h = harness(t);
  const failFixture = join(h.dir, "fail.mjs");
  const passFixture = join(h.dir, "pass.mjs");
  writeFileSync(failFixture, "process.stdout.write('boom\\n');process.exit(3);\n");
  writeFileSync(passFixture, "process.stdout.write('ok\\n');process.exit(0);\n");
  writeProfiles(h.dir, {
    fail: { command: process.execPath, args: [failFixture] },
    pass: { command: process.execPath, args: [passFixture] },
  });

  const failExec = h.service.execute("verification_start", {
    task_id: h.task.id,
    run_id: h.run.id,
    claim_epoch: h.task.claim_epoch,
    profile_id: "fail",
  });
  await waitFor(
    () => h.service.verification.execution(failExec.id),
    (e) => e.status === "failed",
  );
  const passExec = h.service.execute("verification_start", {
    task_id: h.task.id,
    run_id: h.run.id,
    claim_epoch: h.task.claim_epoch,
    profile_id: "pass",
  });
  await waitFor(
    () => h.service.verification.execution(passExec.id),
    (e) => e.status === "succeeded",
  );

  const history = h.service.query("verification_history", { task_id: h.task.id });
  assert.equal(history.total, 2);
  assert.deepEqual(
    history.items.map((i: { status: string }) => i.status).sort(),
    ["failed", "succeeded"],
  );
  const task = h.service.task(h.task.id);
  assert.equal(task.service_verification?.status, "succeeded");
  // 失败记录从未被改写
  assert.equal(h.service.verification.execution(failExec.id).status, "failed");
});

test("A007-7：scope 内变化失效，范围外变化不误失效", async (t) => {
  const h = harness(t);
  const fixture = join(h.dir, "ok.mjs");
  writeFileSync(fixture, "process.exit(0);\n");
  writeProfiles(h.dir, {
    ok: { command: process.execPath, args: [fixture] },
  });
  const execution = h.service.execute("verification_start", {
    task_id: h.task.id,
    run_id: h.run.id,
    claim_epoch: h.task.claim_epoch,
    profile_id: "ok",
  });
  await waitFor(
    () => h.service.verification.execution(execution.id),
    (e) => e.status === "succeeded",
  );

  // 范围外变化：不误失效
  writeFileSync(join(h.workdir, "outside.txt"), "outside-v2\n");
  const outside = h.service.verification.execution(execution.id);
  assert.equal(outside.freshness.state, "current");

  // 范围内变化：失效并给出原因
  writeFileSync(join(h.workdir, "src", "scope.txt"), "scope-v2\n");
  const inside = h.service.verification.execution(execution.id);
  assert.equal(inside.freshness.state, "stale");
  assert.ok(inside.freshness.reasons.includes("scope_changed_after_run"));
});

test("A007-8：运行中重开库转 unknown+held，阻断再次 start，reconcile 后释放", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "rb007-restart-"));
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

  const fixture = join(dir, "ok.mjs");
  writeFileSync(fixture, "process.exit(0);\n");
  writeProfiles(dir, {
    ok: { command: process.execPath, args: [fixture] },
  });
  const execution = service.execute("verification_start", {
    task_id: task.id,
    run_id: run.id,
    claim_epoch: task.claim_epoch,
    profile_id: "ok",
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

  // 模拟重启：关闭 store 后重开，并调用重启调和
  store.close();
  const reopenedStore = new Store(join(dir, "relayboard.sqlite"));
  const reopened = new Service(reopenedStore, { dataDir: dir });
  reopened.reconcileVerificationAfterRestart();

  const unknown = reopened.verification.execution(execution.id);
  assert.equal(unknown.status, "unknown");
  assert.equal(unknown.reservation.state, "held");

  // 再次 start 被阻断
  assert.throws(
    () =>
      reopened.execute("verification_start", {
        task_id: task.id,
        run_id: run.id,
        claim_epoch: task.claim_epoch,
        profile_id: "ok",
      }),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "VERIFICATION_UNKNOWN",
  );

  // confirmed_stopped reconcile 后释放，新执行生成新 ID
  const reconciled = reopened.execute("verification_reconcile", {
    execution_id: execution.id,
    run_id: run.id,
    expected_version: unknown.version,
    outcome: "confirmed_stopped",
    observed: "受控测试确认进程树已停止",
    confirmed_stop: true,
  });
  assert.equal(reconciled.reservation.state, "released");
  const second = reopened.execute("verification_start", {
    task_id: task.id,
    run_id: run.id,
    claim_epoch: task.claim_epoch,
    profile_id: "ok",
  });
  assert.notEqual(second.id, execution.id);
  await waitFor(
    () => reopened.verification.execution(second.id),
    (e) => e.status === "succeeded",
  );
  reopenedStore.close();
});

test("A007-5：已知停止交接后新 Run 接手，旧 epoch 写入被拒绝", () => {
  const dir = mkdtempSync(join(tmpdir(), "rb007-takeover-"));
  try {
    const store = new Store(join(dir, "relayboard.sqlite"));
    const service = new Service(store, { dataDir: dir });
    const workdir = join(dir, "work");
    makeGitWorkdir(workdir);
    const project = service.execute("project_create", { name: "t", objective: "t" });
    const ownerA = service.execute("agent_register", {
      project_id: project.id,
      name: "old owner",
      runtime: "other",
      workdir,
      observation: "self",
    }).run;
    const ownerB = service.execute("agent_register", {
      project_id: project.id,
      name: "new owner",
      runtime: "other",
      workdir,
      observation: "self",
    }).run;
    const created = service.execute("task_create", {
      project_id: project.id,
      title: "T",
      acceptance: "pass",
      scopes: ["docs"],
    });
    const claimed = service.execute("task_claim", {
      task_id: created.id,
      run_id: ownerA.id,
      expected_version: created.version,
    });
    service.execute("task_checkpoint", {
      task_id: created.id,
      run_id: ownerA.id,
      claim_epoch: claimed.claim_epoch,
      summary: "旧负责人已停止（受控测试）",
      next_step: "新 Run 接手",
    });
    const afterCheckpoint = service.task(created.id);
    service.execute("task_handoff", {
      task_id: created.id,
      expected_version: afterCheckpoint.version,
      from_run_id: ownerA.id,
      to_run_id: ownerB.id,
      summary: "已知停止交接",
      descendants: "continue",
      confirmed_stop: true,
    });
    const afterHandoff = service.task(created.id);
    service.execute("work_takeover", {
      task_id: created.id,
      run_id: ownerB.id,
      expected_version: afterHandoff.version,
      reason: "已知停止后接手（受控测试）",
      confirmed_stop: true,
    });
    const afterTakeover = service.task(created.id);
    assert.equal(afterTakeover.owner_run_id, ownerB.id);
    assert.ok(afterTakeover.claim_epoch > claimed.claim_epoch);

    // 旧 epoch 写入被拒绝
    assert.throws(
      () =>
        service.execute("task_checkpoint", {
          task_id: created.id,
          run_id: ownerA.id,
          claim_epoch: claimed.claim_epoch,
          summary: "旧 owner 越权",
          next_step: "不应成功",
        }),
      (error: unknown) =>
        error instanceof Error && "code" in error && error.code === "STALE_CLAIM",
    );
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function execute(args: string[], env: NodeJS.ProcessEnv): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      env,
      stdio: "pipe",
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (part: Buffer) => {
      stdout += part.toString();
    });
    child.stderr.on("data", (part: Buffer) => {
      stderr += part.toString();
    });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

/** 极简 stdio JSON-RPC MCP 客户端。 */
class StdioMcp {
  readonly child;
  private buffer = "";
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();

  constructor(private env: NodeJS.ProcessEnv) {
    this.child = spawn(process.execPath, [mcpStdio], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stderr.on("data", () => {});
    this.child.stdout.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString();
      for (;;) {
        const newline = this.buffer.indexOf("\n");
        if (newline === -1) break;
        const line = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 1);
        if (!line.trim()) continue;
        try {
          const message = JSON.parse(line) as {
            id?: number;
            result?: unknown;
            error?: { message: string };
          };
          if (typeof message.id === "number") {
            const pending = this.pending.get(message.id);
            if (pending) {
              this.pending.delete(message.id);
              if (message.error) pending.reject(new Error(message.error.message));
              else pending.resolve(message.result);
            }
          }
        } catch {
          /* 忽略非 JSON 行 */
        }
      }
    });
  }

  request(method: string, params: object, timeoutMs = 20000): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`stdio MCP 请求超时：${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
      );
    });
  }

  close() {
    this.child.kill("SIGTERM");
  }
}

test("A007-2/3：HTTP MCP 与 stdio MCP 共享同一隔离库并完成领取到独立验收", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "rb007-mcp-"));
  const instance = createApp({ dataDir: dir, port: 0 });
  const server = instance.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  t.after(async () => {
    await instance.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  });

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    RELAYBOARD_URL: `http://127.0.0.1:${port}`,
  };
  const call = async (name: string, args: object) => {
    const result = await execute(["call", name, JSON.stringify(args)], env);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    return JSON.parse(result.stdout) as Record<string, unknown>;
  };

  const project = (await call("project_create", {
    name: "rb007-mcp",
    objective: "mcp",
  })) as { id: string };
  const executor = (await call("agent_register", {
    project_id: project.id,
    name: "executor",
    runtime: "other",
    workdir: dir,
    observation: "self",
  })) as { run: { id: string } };
  const reviewer = (await call("agent_register", {
    project_id: project.id,
    name: "reviewer",
    runtime: "other",
    workdir: dir,
    observation: "self",
  })) as { run: { id: string } };
  const created = (await call("task_create", {
    project_id: project.id,
    title: "MCP E2E",
    acceptance: "pass",
    scopes: ["src"],
    execution: {
      inputs: [],
      outputs: [],
      steps: [
        {
          id: "run-scenarios",
          title: "执行受控场景",
          instructions: "只记录协议行为。",
          done_when: "步骤报告被服务接受。",
          on_failure: "保留错误并停止。",
        },
      ],
      stop_when: [],
    },
  })) as { id: string; version: number };

  const guide = (await call("work_start", {
    run_id: executor.run.id,
    task_id: created.id,
    view: "action",
  })) as { handle: object };
  const workHandle = guide.handle as {
    task_id: string;
    run_id: string;
    claim_epoch: number;
    task_version: number;
    context_version: string;
  };
  const recover = (await call("work_report", {
    handle: workHandle,
    kind: "recover",
    summary: "已核对现场",
    observed: "受控测试",
    read_decision_ids: [],
    dependency_receipts: [],
  })) as { handle: object };
  const recoverHandle = recover.handle as typeof workHandle;
  const progress = (await call("work_report", {
    handle: recoverHandle,
    kind: "progress",
    summary: "进入步骤",
    observed: "受控测试",
  })) as { handle: object };
  const progressHandle = progress.handle as typeof workHandle;
  const step = (await call("work_report", {
    handle: progressHandle,
    kind: "step",
    step_id: "run-scenarios",
    summary: "步骤完成",
    observed: "受控测试",
  })) as { handle: object };
  const stepHandle = step.handle as typeof workHandle;
  const verify = (await call("work_report", {
    handle: stepHandle,
    kind: "verify",
    summary: "验证通过",
    observed: "受控测试",
    verification: [{ command: "test", result: "pass", passed: true }],
    artifacts: [{ path: join(dir, "result.json"), kind: "report", note: "受控" }],
  })) as { handle: object };
  const verifyHandle = verify.handle as typeof workHandle;
  await call("work_report", {
    handle: verifyHandle,
    kind: "submit",
    summary: "提交待独立验收",
    observed: "受控测试",
  });
  const current = (await call("task", { task_id: created.id })) as {
    version: number;
    status: string;
  };
  assert.equal(current.status, "review");
  await call("task_review", {
    task_id: created.id,
    expected_version: current.version,
    reviewer_run_id: reviewer.run.id,
    accepted: true,
    note: "受控独立验收",
  });
  const finalTask = (await call("task", { task_id: created.id })) as {
    status: string;
  };
  assert.equal(finalTask.status, "done");

  // stdio MCP 读取同一隔离库
  const stdio = new StdioMcp(env);
  const init = (await stdio.request("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "rb007-test", version: "0.0.1" },
  })) as { serverInfo?: { name?: string } };
  assert.equal(init.serverInfo?.name, "relayboard");
  stdio.child.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`,
  );
  const tools = (await stdio.request("tools/list", {})) as {
    tools: { name: string }[];
  };
  assert.ok(tools.tools.some((tool) => tool.name === "relay_task"));
  const stdioResult = (await stdio.request("tools/call", {
    name: "relay_task",
    arguments: { task_id: created.id },
  })) as { structuredContent?: { result?: { status: string } } };
  assert.equal(stdioResult.structuredContent?.result?.status, "done");
  stdio.close();
});
