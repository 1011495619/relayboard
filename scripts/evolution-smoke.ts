/**
 * RB-007 端到端交付演练 · 可复跑 smoke 脚本
 *
 * 运行（必须在已完成 npm run build 的 worktree 内）：
 *   node --import tsx scripts/evolution-smoke.ts [--repo <源码根>] [--output-root <证据根>]
 *
 * 脚本只使用隔离数据目录 + 随机回环端口 + RELAYBOARD_RUNNERS=0，不触碰
 * 4317 生产服务与 .relayboard 原库；所有写入都落在 output-root 下（gitignore）。
 * 结果写入 <output-root>/<run-name>/result.json，服务日志写 service.log。
 */

import {
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";

function argValue(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1 || index + 1 >= process.argv.length) return fallback;
  return process.argv[index + 1]!;
}

const repo = resolve(argValue("repo", process.cwd()));
const outputRoot = resolve(
  argValue("output-root", join(repo, ".relayboard", "rb007-evidence")),
);
const cli = join(repo, "lib", "bin", "relayboard.js");
const mcpStdio = join(repo, "lib", "bin", "mcp.js");
const distIndex = join(repo, "dist", "index.html");

if (!existsSync(cli)) {
  throw new Error(`缺少 ${cli}。请先在 worktree 内执行 npm run build。`);
}
if (!existsSync(distIndex)) {
  throw new Error(`缺少 ${distIndex}。请先执行 npm run build。`);
}

const runName = `smoke-${Date.now()}-${randomUUID().slice(0, 6)}`;
const outDir = join(outputRoot, runName);
const dataDir = join(outDir, "data");
const workdir = join(outDir, "work");
mkdirSync(join(dataDir, "verification"), { recursive: true });
mkdirSync(outDir, { recursive: true });

const result: {
  run_name: string;
  repo: string;
  head: string;
  node: string;
  started_at: string;
  port: number;
  service: { ok: boolean; url: string };
  scenarios: Record<string, unknown>;
  metrics: Record<string, unknown>;
} = {
  run_name: runName,
  repo,
  head: spawnSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" })
    .stdout.trim(),
  node: process.version,
  started_at: new Date().toISOString(),
  port: 0,
  service: { ok: false, url: "" },
  scenarios: {},
  metrics: {},
};

/** 随机空闲回环端口。 */
function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") {
        const port = address.port;
        server.close(() => resolvePort(port));
      } else {
        server.close(() => reject(new Error("无法获取端口")));
      }
    });
  });
}

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
  ms: number;
  chars: number;
}

let rpcCount = 0;
let rpcChars = 0;
let rpcMs = 0;

function execute(
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs = 30000,
): CliResult {
  const started = Date.now();
  const child = spawnSync(process.execPath, [cli, ...args], {
    env,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
  const ms = Date.now() - started;
  const stdout = child.stdout || "";
  rpcCount += 1;
  rpcChars += stdout.length;
  rpcMs += ms;
  return {
    code: child.status,
    stdout,
    stderr: child.stderr || "",
    ms,
    chars: stdout.length,
  };
}

function parse<T>(res: CliResult): T {
  if (res.code !== 0)
    throw new Error(`CLI 失败：${res.stderr || res.stdout}`);
  return JSON.parse(res.stdout) as T;
}

/** 从 CLI 错误消息中提取结构化错误码。 */
function errorCode(error: unknown): string {
  if (error instanceof Error) {
    const match = error.message.match(/"code":"([A-Z0-9_]+)"/);
    if (match) return match[1]!;
    return error.message.split("\n")[0] ?? error.message;
  }
  return String(error);
}

/** 用受控 CLI 完成一次 HTTP MCP 工具调用。 */
function mcpCall<T>(env: NodeJS.ProcessEnv, name: string, args: object): T {
  return parse<T>(execute(["call", name, JSON.stringify(args)], env));
}

async function waitFor(
  fn: () => Promise<boolean>,
  timeoutMs = 20000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await fn()) return;
    if (Date.now() > deadline) throw new Error("waitFor 超时");
    await new Promise((resolveWait) => setTimeout(resolveWait, 120));
  }
}

interface ServiceHandle {
  proc: {
    kill: (signal?: NodeJS.Signals | number) => boolean;
    once: (event: "exit", listener: () => void) => void;
    stdout: { on: (event: "data", listener: (chunk: Buffer) => void) => void };
    stderr: { on: (event: "data", listener: (chunk: Buffer) => void) => void };
  };
  port: number;
  url: string;
  logFile: string;
  log: string;
}

/** 启动隔离服务。 */
async function startService(): Promise<ServiceHandle> {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const logFile = join(outDir, "service.log");
  const child = spawn(
    process.execPath,
    [cli, "start", "--port", String(port), "--data-dir", dataDir, "--no-open"],
    {
      cwd: repo,
      env: {
        ...process.env,
        RELAYBOARD_RUNNERS: "0",
        PORT: String(port),
        RELAYBOARD_DATA_DIR: dataDir,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let log = "";
  child.stdout.on("data", (chunk: Buffer) => {
    log += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    log += chunk.toString();
  });
  await waitFor(async () => {
    try {
      const response = await fetch(`${url}/api/health`, {
        signal: AbortSignal.timeout(1000),
      });
      return response.ok;
    } catch {
      return false;
    }
  });
  return { proc: child, port, url, logFile, log };
}

async function stopService(handle: ServiceHandle): Promise<void> {
  handle.proc.kill("SIGTERM");
  await new Promise<void>((resolveStop) => {
    const timer = setTimeout(resolveStop, 5000);
    handle.proc.once("exit", () => {
      clearTimeout(timer);
      resolveStop();
    });
  });
  writeFileSync(handle.logFile, handle.log);
}

function restJson(url: string, path: string, body: object): Promise<unknown> {
  return fetch(`${url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then((response) => response.json());
}

/** 在 workdir 建最小 git 仓库，供 scope 指纹稳定。 */
function makeGitWorkdir(): void {
  mkdirSync(join(workdir, "src"), { recursive: true });
  writeFileSync(join(workdir, "src", "scope.txt"), "scope-v1\n");
  writeFileSync(join(workdir, "outside.txt"), "outside-v1\n");
  spawnSync("git", ["init", "-q"], { cwd: workdir });
  spawnSync("git", ["config", "user.email", "rb007@example.com"], {
    cwd: workdir,
  });
  spawnSync("git", ["config", "user.name", "RB007 Smoke"], { cwd: workdir });
  spawnSync("git", ["add", "."], { cwd: workdir });
  spawnSync("git", ["commit", "-q", "-m", "init"], { cwd: workdir });
}

/** 极简 stdio JSON-RPC MCP 客户端（仅用于 smoke 证据）。 */
class StdioMcpClient {
  private child: ChildProcessWithoutNullStreams;
  private buffer = "";
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();

  constructor(env: NodeJS.ProcessEnv) {
    this.child = spawn(process.execPath, [mcpStdio], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stderr.on("data", () => {
      /* stdio MCP 的 stderr 仅作诊断，不影响协议。 */
    });
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
              if (message.error)
                pending.reject(new Error(message.error.message));
              else pending.resolve(message.result);
            }
          }
        } catch {
          /* 非 JSON 行忽略。 */
        }
      }
    });
  }

  request(method: string, params: object, timeoutMs = 20000): Promise<unknown> {
    const id = this.nextId++;
    const line = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolveReq, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`stdio MCP 请求超时：${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolveReq(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.child.stdin.write(`${line}\n`);
    });
  }

  notify(method: string, params: object): void {
    this.child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`,
    );
  }

  close(): void {
    this.child.kill("SIGTERM");
  }
}

/** 各场景写入原始 stdout 摘要，便于追溯。 */
function saveLog(name: string, text: string): void {
  writeFileSync(join(outDir, `${name}.log`), text);
}

async function main(): Promise<void> {
  makeGitWorkdir();
  const service = await startService();
  result.port = service.port;
  result.service = { ok: true, url: service.url };
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    RELAYBOARD_URL: service.url,
  };

  // ---- 场景 1：HTTP MCP 从领取到独立验收（A007-2 / A007-10） ----
  const s1: Record<string, unknown> = {};
  const project = mcpCall<{ id: string }>(env, "project_create", {
    name: "rb007-smoke",
    objective: "端到端交付演练（受控身份）",
  });
  const executor = mcpCall<{ run: { id: string } }>(env, "agent_register", {
    project_id: project.id,
    name: "RB007 smoke executor",
    runtime: "other",
    workdir,
    observation: "self",
    capabilities: ["e2e", "testing"],
  });
  const reviewer = mcpCall<{ run: { id: string } }>(env, "agent_register", {
    project_id: project.id,
    name: "RB007 smoke reviewer",
    runtime: "other",
    workdir,
    observation: "self",
  });
  const created = mcpCall<{ id: string; version: number }>(env, "task_create", {
    project_id: project.id,
    title: "RB007 E2E 演练任务",
    acceptance: "受控进程通过全部场景",
    scopes: ["src"],
    execution: {
      inputs: ["隔离 QA 项目"],
      outputs: ["结构化结果"],
      steps: [
        {
          id: "run-scenarios",
          title: "执行受控场景",
          instructions: "只记录协议行为，不修改文件。",
          done_when: "步骤报告被服务接受。",
          on_failure: "保留错误并停止。",
        },
      ],
      stop_when: ["需要模型或生产数据"],
    },
  });
  const guide = mcpCall<{ handle: object }>(env, "work_start", {
    run_id: executor.run.id,
    task_id: created.id,
    view: "action",
  });
  const workHandle = guide.handle as {
    task_id: string;
    run_id: string;
    claim_epoch: number;
    task_version: number;
    context_version: string;
  };
  const recoverStart = Date.now();
  const recover = mcpCall<{ handle: object }>(env, "work_report", {
    handle: workHandle,
    kind: "recover",
    summary: "已核对现场",
    observed: "受控 smoke 场景",
    read_decision_ids: [],
    dependency_receipts: [],
  });
  const recoveryMs = Date.now() - recoverStart;
  const handleAfter = (recover as { handle: object }).handle as {
    task_id: string;
    run_id: string;
    claim_epoch: number;
    task_version: number;
    context_version: string;
  };
  const progressOut = mcpCall<{ handle: object }>(env, "work_report", {
    handle: handleAfter,
    kind: "progress",
    summary: "进入步骤执行",
    observed: "受控 smoke",
  });
  const progressHandle = (progressOut as { handle: object }).handle as typeof handleAfter;
  const stepOut = mcpCall<{ handle: object }>(env, "work_report", {
    handle: progressHandle,
    kind: "step",
    step_id: "run-scenarios",
    summary: "场景执行完成",
    observed: "受控 smoke",
  });
  const stepHandle = (stepOut as { handle: object }).handle as typeof handleAfter;
  const verifyOut = mcpCall<{ handle: object }>(env, "work_report", {
    handle: stepHandle,
    kind: "verify",
    summary: "验证通过",
    observed: "受控 smoke",
    verification: [{ command: "smoke", result: "pass", passed: true }],
    artifacts: [
      { path: join(outDir, "result.json"), kind: "report", note: "隔离流程测量结果" },
    ],
  });
  const verifyHandle = (verifyOut as { handle: object }).handle as {
    task_id: string;
    run_id: string;
    claim_epoch: number;
    task_version: number;
    context_version: string;
  };
  mcpCall(env, "work_report", {
    handle: verifyHandle,
    kind: "submit",
    summary: "提交待独立验收",
    observed: "受控 smoke",
    artifacts: [
      { path: join(outDir, "result.json"), kind: "report", note: "隔离流程测量结果" },
    ],
  });
  const afterSubmit = mcpCall<{ version: number; status: string }>(env, "task", {
    task_id: created.id,
  });
  const reviewed = mcpCall<{ status: string }>(env, "task_review", {
    task_id: created.id,
    expected_version: afterSubmit.version,
    reviewer_run_id: reviewer.run.id,
    accepted: true,
    note: "受控 smoke 独立验收通过",
  });
  const finalTask = mcpCall<{ status: string; review: { accepted: boolean } }>(
    env,
    "task",
    { task_id: created.id },
  );
  const executionCalls = 6; // work_start + recover + progress + step + verify + submit（action 视图无 work_next 刷新）
  s1.recovery_ms = recoveryMs;
  s1.claim_epoch = workHandle.claim_epoch;
  s1.after_submit_status = afterSubmit.status;
  s1.review_status = reviewed.status;
  s1.final_status = finalTask.status;
  s1.final_review_accepted = finalTask.review.accepted;
  s1.execution_calls = executionCalls;
  s1.http_mcp_ok = finalTask.status === "done" && finalTask.review.accepted;
  result.scenarios.s1_http_mcp = s1;

  // ---- 场景 2：服务验证失败后修复再运行（A007-4） ----
  const failFixture = join(dataDir, "fail.mjs");
  const passFixture = join(dataDir, "pass.mjs");
  writeFileSync(failFixture, "process.stdout.write('fail-boom\\n');process.exit(3);\n");
  writeFileSync(passFixture, "process.stdout.write('pass-ok\\n');process.exit(0);\n");
  writeFileSync(
    join(dataDir, "verification-profiles.json"),
    JSON.stringify({
      version: 1,
      profiles: {
        fail: { command: process.execPath, args: [failFixture], cwd: "." },
        pass: { command: process.execPath, args: [passFixture], cwd: "." },
      },
    }),
  );
  const task2Created = mcpCall<{ id: string; version: number }>(env, "task_create", {
    project_id: project.id,
    title: "RB007 验证失败修复",
    acceptance: "pass",
    scopes: ["src"],
  });
  const task2 = mcpCall<{ claim_epoch: number }>(env, "task_claim", {
    task_id: task2Created.id,
    run_id: executor.run.id,
    expected_version: task2Created.version,
  });
  const failExec = mcpCall<{ id: string; status: string; exit_code: number }>(
    env,
    "verification_start",
    {
      task_id: task2Created.id,
      run_id: executor.run.id,
      claim_epoch: task2.claim_epoch,
      profile_id: "fail",
    },
  );
  let failFinal: { status: string; exit_code: number | null } = { status: failExec.status, exit_code: failExec.exit_code };
  await waitFor(async () => {
    const e = mcpCall<{ status: string; exit_code: number | null }>(env, "verification_execution", {
      execution_id: failExec.id,
    });
    failFinal = e;
    return e.status === "failed";
  });
  const passExec = mcpCall<{ id: string; status: string }>(env, "verification_start", {
    task_id: task2Created.id,
    run_id: executor.run.id,
    claim_epoch: task2.claim_epoch,
    profile_id: "pass",
  });
  let passFinal: { status: string } = { status: passExec.status };
  await waitFor(async () => {
    const e = mcpCall<{ status: string }>(env, "verification_execution", {
      execution_id: passExec.id,
    });
    passFinal = e;
    return e.status === "succeeded";
  });
  const history = mcpCall<{ total: number; items: { status: string }[] }>(
    env,
    "verification_history",
    { task_id: task2Created.id },
  );
  const task2Detail = mcpCall<{ service_verification: { status: string } }>(
    env,
    "task",
    { task_id: task2Created.id },
  );
  result.scenarios.s2_verify_fail_fix = {
    fail_status: failFinal.status,
    fail_exit_code: failFinal.exit_code,
    pass_status: passFinal.status,
    history_total: history.total,
    history_statuses: history.items.map((i) => i.status),
    latest_status: task2Detail.service_verification.status,
    ok:
      failFinal.status === "failed" &&
      failFinal.exit_code === 3 &&
      passFinal.status === "succeeded" &&
      history.total === 2 &&
      task2Detail.service_verification.status === "succeeded",
  };

  // ---- 场景 3：scope 内变化失效 / 范围外变化保持（A007-7） ----
  writeFileSync(join(workdir, "outside.txt"), "outside-v2\n");
  const outsideChange = mcpCall<{ freshness: { state: string; reasons: string[] } }>(
    env,
    "verification_execution",
    { execution_id: passExec.id },
  );
  writeFileSync(join(workdir, "src", "scope.txt"), "scope-v2\n");
  const insideChange = mcpCall<{ freshness: { state: string; reasons: string[] } }>(
    env,
    "verification_execution",
    { execution_id: passExec.id },
  );
  result.scenarios.s3_scope_change = {
    outside_state: outsideChange.freshness.state,
    outside_reasons: outsideChange.freshness.reasons,
    inside_state: insideChange.freshness.state,
    inside_reasons: insideChange.freshness.reasons,
    ok:
      outsideChange.freshness.state === "current" &&
      insideChange.freshness.state === "stale" &&
      insideChange.freshness.reasons.includes("scope_changed_after_run"),
  };
  // 恢复 scope 文件，保持现场干净
  writeFileSync(join(workdir, "src", "scope.txt"), "scope-v1\n");

  // ---- 场景 4：stdio MCP 重开同一隔离库（A007-3） ----
  const stdio = new StdioMcpClient(env);
  const init = (await stdio.request("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "rb007-smoke", version: "0.0.1" },
  })) as { serverInfo?: { name?: string } };
  stdio.notify("notifications/initialized", {});
  const tools = (await stdio.request("tools/list", {})) as {
    tools: { name: string }[];
  };
  const stdioTask = (await stdio.request("tools/call", {
    name: "relay_task",
    arguments: { task_id: created.id },
  })) as { structuredContent?: { result?: { status: string } } };
  stdio.close();
  const stdioStatus =
    stdioTask.structuredContent?.result?.status ??
    (stdioTask as unknown as { content?: { text?: string }[] }).content?.[0]?.text
      ?.match(/"status":\s*"([^"]+)"/)?.[1] ??
    "unknown";
  result.scenarios.s4_stdio_mcp = {
    server_name: init.serverInfo?.name ?? "unknown",
    tool_count: tools.tools.length,
    has_relay_task: tools.tools.some((t) => t.name === "relay_task"),
    same_db_status: stdioStatus,
    ok: stdioStatus === "done",
  };

  // ---- 场景 5：旧数据重开 + 服务重启（A007-8） ----
  await stopService(service);
  const reopened = await startService();
  const reopenedEnv: NodeJS.ProcessEnv = {
    ...process.env,
    RELAYBOARD_URL: reopened.url,
  };
  const reopenedTask = mcpCall<{ status: string; id: string }>(
    reopenedEnv,
    "task",
    { task_id: created.id },
  );
  result.scenarios.s5_reopen = {
    reopened_status: reopenedTask.status,
    same_task_id: reopenedTask.id === created.id,
    ok: reopenedTask.status === "done" && reopenedTask.id === created.id,
  };
  await stopService(reopened);

  // ---- 场景 6：未知进程保持占用（A007-5 后半 / A007-8） ----
  const hangFixture = join(dataDir, "hang.mjs");
  const hangPidFile = join(dataDir, "hang.pid");
  writeFileSync(
    hangFixture,
    `import { writeFileSync } from "node:fs";
writeFileSync(process.argv[2], String(process.pid));
setInterval(() => {}, 1000);
`,
  );
  writeFileSync(
    join(dataDir, "verification-profiles.json"),
    JSON.stringify({
      version: 1,
      profiles: {
        hang: {
          command: process.execPath,
          args: [hangFixture, hangPidFile],
          cwd: ".",
          timeout_ms: 60000,
        },
      },
    }),
  );
  const s6Service = await startService();
  const s6Env: NodeJS.ProcessEnv = {
    ...process.env,
    RELAYBOARD_URL: s6Service.url,
  };
  const hangExec = mcpCall<{ id: string }>(s6Env, "verification_start", {
    task_id: task2Created.id,
    run_id: executor.run.id,
    claim_epoch: task2.claim_epoch,
    profile_id: "hang",
  });
  await waitFor(async () => {
    const e = mcpCall<{ status: string }>(s6Env, "verification_execution", {
      execution_id: hangExec.id,
    });
    return e.status === "running";
  });
  await stopService(s6Service);
  // 重开同一数据目录：running 应转 unknown + held
  const s6Reopened = await startService();
  const s6ReopenedEnv: NodeJS.ProcessEnv = {
    ...process.env,
    RELAYBOARD_URL: s6Reopened.url,
  };
  const unknownExec = mcpCall<{ status: string; reservation: { state: string } }>(
    s6ReopenedEnv,
    "verification_execution",
    { execution_id: hangExec.id },
  );
  let blockedStart = "";
  try {
    mcpCall(s6ReopenedEnv, "verification_start", {
      task_id: task2Created.id,
      run_id: executor.run.id,
      claim_epoch: task2.claim_epoch,
      profile_id: "hang",
    });
    blockedStart = "not-blocked";
  } catch (error) {
    blockedStart = errorCode(error);
  }
  // 清理 hang 子进程，并按 observed 做 confirmed_stopped reconcile
  const hangPid = existsSync(hangPidFile)
    ? readFileSync(hangPidFile, "utf8").trim()
    : "";
  if (hangPid) spawnSync("kill", [hangPid]);
  let reconcileStatus = "skipped";
  let reservationAfterReconcile = unknownExec.reservation.state;
  if (hangPid) {
    try {
      const unknownVersion = mcpCall<{ version: number }>(
        s6ReopenedEnv,
        "verification_execution",
        { execution_id: hangExec.id },
      );
      const reconciled = mcpCall<{ status: string; reservation: { state: string } }>(
        s6ReopenedEnv,
        "verification_reconcile",
        {
          execution_id: hangExec.id,
          run_id: executor.run.id,
          expected_version: unknownVersion.version,
          outcome: "confirmed_stopped",
          observed: `kill ${hangPid} 后 kill -0 确认进程已停止（受控 smoke 场景）`,
          confirmed_stop: true,
        },
      );
      reconcileStatus = reconciled.status;
      reservationAfterReconcile = reconciled.reservation.state;
    } catch (error) {
      reconcileStatus = `reconcile-error:${errorCode(error)}`;
    }
  }
  result.scenarios.s6_unknown_held = {
    unknown_status: unknownExec.status,
    reservation_state: unknownExec.reservation.state,
    blocked_start: blockedStart,
    reconcile_status: reconcileStatus,
    reservation_after_reconcile: reservationAfterReconcile,
    ok:
      unknownExec.status === "unknown" &&
      unknownExec.reservation.state === "held" &&
      blockedStart === "VERIFICATION_UNKNOWN" &&
      reservationAfterReconcile === "released",
  };
  await stopService(s6Reopened);

  // ---- 已知停止后换新 Run 接手（A007-5 前半） ----
  const s7Service = await startService();
  const s7Env: NodeJS.ProcessEnv = {
    ...process.env,
    RELAYBOARD_URL: s7Service.url,
  };
  const ownerA = mcpCall<{ run: { id: string } }>(s7Env, "agent_register", {
    project_id: project.id,
    name: "RB007 old owner",
    runtime: "other",
    workdir,
    observation: "self",
  });
  const ownerB = mcpCall<{ run: { id: string } }>(s7Env, "agent_register", {
    project_id: project.id,
    name: "RB007 new owner",
    runtime: "other",
    workdir,
    observation: "self",
  });
  const t7 = mcpCall<{ id: string; version: number }>(s7Env, "task_create", {
    project_id: project.id,
    title: "RB007 已知停止接手",
    acceptance: "pass",
    scopes: ["docs"],
  });
  const claimedA = mcpCall<{ claim_epoch: number; version: number }>(s7Env, "task_claim", {
    task_id: t7.id,
    run_id: ownerA.run.id,
    expected_version: t7.version,
  });
  mcpCall(s7Env, "task_checkpoint", {
    task_id: t7.id,
    run_id: ownerA.run.id,
    claim_epoch: claimedA.claim_epoch,
    summary: "旧负责人完成第一步并已停止（受控场景）",
    next_step: "新 Run 接手",
  });
  const t7AfterCheckpoint = mcpCall<{ version: number }>(s7Env, "task", {
    task_id: t7.id,
  });
  mcpCall(s7Env, "task_handoff", {
    task_id: t7.id,
    expected_version: t7AfterCheckpoint.version,
    from_run_id: ownerA.run.id,
    to_run_id: ownerB.run.id,
    summary: "已知停止，交接新 Run（受控场景）",
    descendants: "continue",
    confirmed_stop: true,
  });
  const t7AfterHandoff = mcpCall<{ version: number }>(s7Env, "task", {
    task_id: t7.id,
  });
  const takeover = mcpCall<{ handle?: { claim_epoch?: number } }>(s7Env, "work_takeover", {
    task_id: t7.id,
    run_id: ownerB.run.id,
    expected_version: t7AfterHandoff.version,
    reason: "已知停止后接手（受控场景）",
    confirmed_stop: true,
  });
  const t7AfterTakeover = mcpCall<{ owner_run_id: string; claim_epoch: number }>(
    s7Env,
    "task",
    { task_id: t7.id },
  );
  // 旧 owner 的旧 epoch 写入应被拒绝
  let oldEpochRejected = "";
  try {
    mcpCall(s7Env, "task_checkpoint", {
      task_id: t7.id,
      run_id: ownerA.run.id,
      claim_epoch: claimedA.claim_epoch,
      summary: "旧 owner 越权写入",
      next_step: "不应成功",
    });
    oldEpochRejected = "accepted";
  } catch (error) {
    oldEpochRejected = errorCode(error);
  }
  result.scenarios.s7_known_stop_takeover = {
    new_claim_epoch: t7AfterTakeover.claim_epoch,
    new_owner: t7AfterTakeover.owner_run_id,
    old_epoch_rejected: oldEpochRejected,
    ok:
      oldEpochRejected !== "accepted" &&
      t7AfterTakeover.owner_run_id === ownerB.run.id &&
      t7AfterTakeover.claim_epoch > claimedA.claim_epoch,
  };
  await stopService(s7Service);

  // ---- 汇总指标（A007-10） ----
  result.metrics = {
    total_json_rpc: rpcCount,
    total_response_chars: rpcChars,
    total_observed_ms: rpcMs,
    s1_recovery_ms: recoveryMs,
    human_interventions: 0,
    paid_model_calls: 0,
    rework: 0,
    unknown_items: [
      "真实厂商模型未执行（本 smoke 只使用受控进程与受控 CLI/stdio MCP）",
      "浏览器像素级人工查看由协调者最终复验完成",
    ],
  };

  result.scenarios.s1_execution_calls = executionCalls;
  writeFileSync(join(outDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  saveLog("console", [
    `run_name=${runName}`,
    `repo=${repo}`,
    `head=${result.head}`,
    `port=${service.port}`,
    `rpc=${rpcCount} chars=${rpcChars} ms=${rpcMs}`,
    JSON.stringify(result.scenarios, null, 2),
  ].join("\n"));
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  writeFileSync(
    join(outDir, "smoke-error.log"),
    `${String(error)}\n${(error as Error).stack ?? ""}`,
  );
  process.exit(1);
});
