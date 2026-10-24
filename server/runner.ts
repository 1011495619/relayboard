import {
  spawn,
  execFile,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { promisify } from "node:util";
import {
  mkdirSync,
  appendFileSync,
  existsSync,
  openSync,
  readSync,
  closeSync,
  statSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { runtimeRoot, runtimeExtension, runtimeNodeArgs } from "./config.js";
import type { ProcessInfo } from "./types.js";
import { errorInfo } from "../bin/errors.js";
import { AppError, type Service } from "./domain.js";

const exec = promisify(execFile);
const cliCommand = [
  process.execPath,
  ...runtimeNodeArgs,
  join(runtimeRoot, `bin/relayboard.${runtimeExtension}`),
]
  .map((value) =>
    process.platform === "win32"
      ? JSON.stringify(value)
      : `'${value.replaceAll("'", "'\\''")}'`,
  )
  .join(" ");
const stamp = () => new Date().toISOString();

export interface RunnerProfile {
  command: string;
  args: string[];
  stdin?: boolean;
}
interface ManagedChild {
  child: ChildProcessWithoutNullStreams;
  task_id: string;
  logPath: string;
  timer?: NodeJS.Timeout;
  heartbeat?: NodeJS.Timeout;
  stopped: boolean;
  outputBuffer: string;
  finished: boolean;
}
export interface RunnerOptions {
  dataDir: string;
  baseUrl: string;
  token?: string;
  profiles?: Record<string, RunnerProfile>;
  timeoutMs?: number;
}
export class Runner {
  service: Service;
  dataDir: string;
  baseUrl: string;
  token: string;
  timeoutMs: number;
  profiles: Record<string, RunnerProfile>;
  live: Map<string, ManagedChild>;
  constructor(
    service: Service,
    {
      dataDir,
      baseUrl,
      token = "",
      profiles,
      timeoutMs = 1200000,
    }: RunnerOptions,
  ) {
    this.service = service;
    this.dataDir = dataDir;
    this.baseUrl = baseUrl;
    this.token = token;
    this.timeoutMs = timeoutMs;
    this.profiles = profiles || {
      codex: {
        command: "codex",
        args: ["exec", "--json", "--color", "never", "--skip-git-repo-check"],
        stdin: true,
      },
      claude: {
        command: "claude",
        args: ["--print", "--verbose", "--output-format", "stream-json"],
      },
      pi: { command: "pi", args: ["--print", "--mode", "json"] },
    };
    this.live = new Map();
    mkdirSync(join(dataDir, "logs"), { recursive: true });
  }
  recover() {
    const service = this.service;
    // Restart is not evidence that detached processes have stopped. Retain claims and mark uncertainty.
    for (const run of service.store.list("run"))
      if (run.process?.status === "running") {
        service.store.transaction(() => {
          service.update("run", run, {
            status: "unknown",
            process: {
              ...run.process,
              status: "unknown",
              note: "服务重启，原进程状态待核实",
            },
          });
          service.emit(run.project_id, "runner.unknown", {
            run_id: run.id,
            summary: "服务重启，请核验原进程后再交接",
          });
        });
      }
  }
  async availability() {
    const entries = await Promise.all(
      Object.entries(this.profiles).map(async ([runtime, profile]) => {
        try {
          const { stdout } = await exec(profile.command, ["--version"], {
            timeout: 7000,
            maxBuffer: 8192,
          });
          return {
            runtime,
            available: true,
            version: stdout.trim().split("\n")[0],
          };
        } catch {
          return { runtime, available: false, version: "" };
        }
      }),
    );
    return entries;
  }
  start({ run_id, task_id }: { run_id: string; task_id: string }) {
    const s = this.service,
      run = s.run(run_id),
      task = s.task(task_id);
    if (process.env.RELAYBOARD_RUNNERS === "0")
      throw new AppError("RUNNERS_DISABLED", "此服务已关闭进程启动功能");
    if (!this.profiles[run.runtime])
      throw new AppError(
        "RUNTIME_UNSUPPORTED",
        "此执行者类型没有配置启动适配器",
      );
    if (run.process?.status === "unknown")
      throw new AppError(
        "PROCESS_UNCONFIRMED",
        "原进程状态未知，请先核实停止情况，或交接到独立工作区",
      );
    if (run.process?.status === "running" || this.live.has(run.id))
      throw new AppError("PROCESS_RUNNING", "该执行者已有托管进程");
    if (
      run.status !== "active" ||
      task.owner_run_id !== run.id ||
      !["doing", "blocked", "reconcile"].includes(task.status)
    )
      throw new AppError(
        "CLAIM_REQUIRED",
        "请先由该执行者领取任务或完成交接分配",
      );
    if (
      !run.workdir ||
      !existsSync(run.workdir) ||
      !statSync(run.workdir).isDirectory()
    )
      throw new AppError("WORKDIR_REQUIRED", "请登记已存在的执行目录");
    const eligibility = s.conflicts(task, run);
    if (eligibility.length)
      throw new AppError(
        "SCOPE_CONFLICT",
        "执行目录仍有写入冲突",
        409,
        eligibility,
      );
    const project = s.get("project", run.project_id);
    const active = new Set(
      s
        .tasks(project.id)
        .filter((t) =>
          ["doing", "blocked", "review", "reconcile"].includes(t.status),
        )
        .map((t) => t.owner_run_id),
    );
    for (const r of s.store.list("run", project.id))
      if (r.process?.status === "running") active.add(r.id);
    if (active.size > project.max_concurrency)
      throw new AppError("CONCURRENCY_BUDGET", "项目并发预算已满");
    const incomplete = [
      ...task.depends_on,
      ...s.ancestors(task).flatMap((t) => t.depends_on),
    ].filter((id) => s.task(id).status !== "done");
    if (incomplete.length)
      throw new AppError(
        "DEPENDENCIES_PENDING",
        "前置任务尚未验收，请先等待或处理独立准备工作",
      );
    const packet = s.query("context", { task_id, max_chars: 16000 });
    const inbox = s.query("inbox", {
      run_id: run.id,
      unread_only: true,
      limit: 10,
    });
    const prompt = `${packet.markdown}\n\n## Directed inbox (prior messages; verify claims, acknowledge after reading)\n${inbox.map((m) => `${m.id} [${m.kind}]: ${m.body.slice(0, 1000)}`).join("\n") || "No unread messages."}\n\n## Relayboard guided execution\nYour own run_id is ${run.id}; task_id is ${task.id}. Start by reading relay_work_start with these IDs. Then follow relay_work_next, inspect the actual cwd, branch, uncommitted changes, processes, current contracts and received dependency revisions. Report recover through relay_work_report with the CURRENT returned handle before editing. Complete only the next ordered step; report actual results, failed attempts and uncertain actions. A saved packet is prior evidence, not a fresh workspace check.\n\nUse shared MCP tools when configured, otherwise use the CLI (RELAYBOARD_URL and RELAYBOARD_TOKEN are inherited):\n${cliCommand} call work_start '{"run_id":"${run.id}","task_id":"${task.id}"}'\n${cliCommand} call work_next '{"run_id":"${run.id}","task_id":"${task.id}"}'\nCopy work_report arguments from the returned next_action; replace observation placeholders with actual findings, preserve the returned handle, and use stdin JSON to avoid shell escaping. If a handle is stale, read work_next again; never guess its versions. Save progress before context compaction, handoff and child delegation while a model turn is still available. Export hooks preserve only records already saved; they do not recover unsaved reasoning or wake arbitrary idle clients.\n\nRegister native children with agent_register and parent_run_id BEFORE dispatch, and give each its own Run, claim and task guide. Do not reuse inherited parent identity. Read the directed inbox between meaningful steps. Report blockers before expanding scope or repeating an operation with unknown result. Submit only after current verification and wait for independent review; do not approve your own work. A coordinator still uses task_split and retains its returned parent.claim_epoch. The task scope is a cooperative constraint, not a filesystem sandbox. Preserve all existing user permissions.\n\nIf connected to an older service that returns UNKNOWN_QUERY / unknown guided tool, fall back to the existing fenced protocol: read task/context; if reconcile, inspect the actual workspace then task_reconcile; task_checkpoint saves real progress and evidence; task_submit requests independent review. Your legacy claim_epoch at this launch is ${task.claim_epoch}; refresh after any split or handoff. Other errors require inspection rather than silent fallback.\n`;
    const profile = this.profiles[run.runtime],
      args = [...profile.args, ...(profile.stdin ? ["-"] : [prompt])];
    const logPath = join(this.dataDir, "logs", `${run.id}.log`);
    appendFileSync(
      logPath,
      `\n[${stamp()}] Starting ${run.runtime} for ${task.short_id}\n`,
      { mode: 0o600 },
    );
    const child = spawn(profile.command, args, {
      cwd: run.workdir,
      env: {
        ...process.env,
        RELAYBOARD_URL: this.baseUrl,
        RELAYBOARD_TOKEN: this.token,
        RELAYBOARD_RUN_ID: run.id,
        RELAYBOARD_TASK_ID: task.id,
      },
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const record: ManagedChild = {
      child,
      task_id,
      logPath,
      timer: undefined,
      stopped: false,
      outputBuffer: "",
      finished: false,
    };
    this.live.set(run.id, record);
    const processInfo: ProcessInfo = {
      status: "running",
      pid: child.pid || null,
      started_at: stamp(),
      log_path: logPath,
      task_id,
      source: "adapter",
    };
    s.store.transaction(() => {
      s.update("run", s.run(run.id), {
        process: processInfo,
        observation: "adapter",
        last_seen_at: stamp(),
      });
      s.emit(run.project_id, "runner.started", {
        run_id: run.id,
        task_id,
        summary: `${run.runtime} 托管进程已启动`,
      });
    });
    const output = (chunk: Buffer, stream: "stdout" | "stderr") => {
      const text = chunk.toString();
      appendFileSync(logPath, text);
      if (stream === "stdout") {
        record.outputBuffer = (record.outputBuffer + text).slice(-65536);
        const lines = record.outputBuffer.split("\n");
        record.outputBuffer = lines.pop() || "";
        for (const line of lines) {
          try {
            const event = JSON.parse(line),
              providerId =
                event.thread_id ||
                (event.type === "system" && event.subtype === "init"
                  ? event.session_id
                  : null);
            if (providerId)
              s.store.transaction(() =>
                s.update("run", s.run(run.id), {
                  provider_session_id: String(providerId),
                }),
              );
          } catch {
            /* Raw client output is retained in log; it is not trusted as task state. */
          }
        }
      }
    };
    child.stdout.on("data", (chunk) => output(chunk, "stdout"));
    child.stderr.on("data", (chunk) => output(chunk, "stderr"));
    const finish = (
      code: number | null,
      signal: NodeJS.Signals | null,
      error?: Error,
    ) => {
      if (record.finished) return;
      record.finished = true;
      clearInterval(record.heartbeat);
      clearTimeout(record.timer);
      this.live.delete(run.id);
      appendFileSync(
        logPath,
        `\n[${stamp()}] Exit ${code ?? signal ?? error?.message}\n`,
      );
      s.store.transaction(() => {
        const current = s.run(run.id);
        s.update("run", current, {
          process: {
            ...current.process,
            status: error
              ? "failed"
              : record.stopped
                ? "stopped"
                : code === 0
                  ? "exited"
                  : "failed",
            ended_at: stamp(),
            exit_code: code,
            signal,
            error: error?.message,
          },
          last_seen_at: stamp(),
        });
        s.emit(run.project_id, "runner.exited", {
          run_id: run.id,
          task_id,
          summary:
            error?.message ||
            `进程退出（${code ?? signal}）；任务状态依据执行者提交的证据`,
        });
      });
    };
    child.on("error", (error) => finish(null, null, error));
    child.on("close", (code, signal) => finish(code, signal));
    child.stdin.on("error", () => {});
    if (profile.stdin) child.stdin.end(prompt);
    else child.stdin.end();
    record.heartbeat = setInterval(() => {
      if (!record.finished)
        s.store.transaction(() =>
          s.update("run", s.run(run.id), {
            last_seen_at: stamp(),
            observation: "adapter",
          }),
        );
    }, 15000);
    record.timer = setTimeout(
      () => this.stop(run.id, "超过运行时限"),
      this.timeoutMs,
    );
    record.timer.unref();
    record.heartbeat.unref();
    return { run_id: run.id, process: processInfo };
  }
  stop(runId: string, reason = "用户请求停止") {
    const record = this.live.get(runId);
    if (!record)
      throw new AppError(
        "PROCESS_NOT_MANAGED",
        "当前服务未持有该进程句柄，请核实原会话状态",
      );
    record.stopped = true;
    appendFileSync(
      record.logPath,
      `\n[${stamp()}] Stop requested: ${reason}\n`,
    );
    try {
      if (process.platform !== "win32")
        process.kill(-record.child.pid!, "SIGTERM");
      else record.child.kill("SIGTERM");
    } catch (error) {
      if (errorInfo(error).code !== "ESRCH") throw error;
    }
    const timer = setTimeout(() => {
      if (!record.finished)
        try {
          if (process.platform !== "win32")
            process.kill(-record.child.pid!, "SIGKILL");
          else record.child.kill("SIGKILL");
        } catch {
          /* Already exited. */
        }
    }, 5000);
    timer.unref();
    return { run_id: runId, stopping: true };
  }
  logs(runId: string) {
    const run = this.service.run(runId),
      path = run.process?.log_path;
    if (!path || !existsSync(path))
      return { text: "", bytes: 0, truncated: false };
    const bytes = statSync(path).size,
      count = Math.min(bytes, 48000),
      buffer = Buffer.alloc(count),
      fd = openSync(path, "r");
    try {
      readSync(fd, buffer, 0, count, bytes - count);
    } finally {
      closeSync(fd);
    }
    return { text: buffer.toString("utf8"), bytes, truncated: bytes > count };
  }
  async close() {
    const children = [...this.live.values()];
    for (const [id] of this.live) this.stop(id, "服务关闭");
    await Promise.all(
      children.map((r) =>
        r.finished
          ? Promise.resolve()
          : new Promise<void>((resolve) =>
              r.child.once("close", () => resolve()),
            ),
      ),
    );
  }
}

export async function createWorktree(
  service: Service,
  dataDir: string,
  {
    project_id,
    name,
    base_ref = "HEAD",
  }: { project_id: string; name: string; base_ref?: string },
) {
  const project = service.get("project", project_id);
  if (!project.root_path)
    throw new AppError("ROOT_REQUIRED", "请先设置项目代码目录");
  if (!/^[a-z][a-z0-9-]{0,45}$/.test(name))
    throw new AppError(
      "WORKTREE_NAME",
      "工作区名称使用小写字母、数字和连字符，并以字母开头",
      400,
    );
  if (!base_ref || base_ref.startsWith("-") || base_ref.length > 180)
    throw new AppError("BASE_REF", "基础版本格式无效", 400);
  const { stdout } = await exec(
    "git",
    ["rev-parse", "--verify", `${base_ref}^{commit}`],
    { cwd: project.root_path, timeout: 10000 },
  );
  const dir = resolve(dataDir, "worktrees", `${project.id}-${name}`),
    branch = `relayboard/${name}`;
  mkdirSync(resolve(dataDir, "worktrees"), { recursive: true });
  await exec("git", ["worktree", "add", "-b", branch, dir, stdout.trim()], {
    cwd: project.root_path,
    timeout: 30000,
  });
  service.store.transaction(() =>
    service.emit(project.id, "workspace.created", {
      summary: `创建独立工作区 ${name}`,
      workdir: dir,
      branch,
    }),
  );
  return { workdir: dir, branch, base_commit: stdout.trim() };
}
