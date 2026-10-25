import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  type WriteStream,
} from "node:fs";
import { join, resolve } from "node:path";
import { realpathSync } from "node:fs";
import { AppError } from "./domain.ts";
import type { Service } from "./domain.ts";
import type {
  Run,
  Task,
  VerificationExecution,
  VerificationExecutionStatus,
  VerificationFreshness,
  VerificationHistoryView,
  VerificationLogView,
  VerificationProfilesView,
  VerificationSummary,
} from "./types.ts";
import {
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_TIMEOUT_MS,
  effectiveProfileDigest,
  loadVerificationConfig,
  resolveCommandInPath,
  resolveProfileCwd,
  verificationConfigPath,
} from "./verification-config.ts";
import { observeWorkspace } from "./workspace.ts";
import { artifactRevision, dependencies } from "./workflow.ts";

const STOP_GRACE_MS = 3000;
const FORCE_MS = 3000;

const now = () => new Date().toISOString();
const uid = (prefix: string) =>
  `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 16)}`;

function ensure(
  ok: unknown,
  code: string,
  message: string,
  details?: unknown,
): asserts ok {
  if (!ok) throw new AppError(code, message, 409, details);
}

function realpathOf(p: string): string {
  try {
    return realpathSync.native(resolve(p));
  } catch {
    return resolve(p);
  }
}

function sha256File(path: string): string | null {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch {
    return null;
  }
}

function processGroupAlive(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function signalGroup(pid: number | undefined, signal: NodeJS.Signals) {
  if (!pid) return;
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // 进程已退出
    }
  }
}

class LogCapture {
  private written = 0;
  private streamed = 0;
  truncated = false;
  constructor(
    private stream: WriteStream,
    private maxBytes: number,
  ) {}
  write(chunk: Buffer) {
    this.streamed += chunk.length;
    if (this.written >= this.maxBytes) {
      this.truncated = true;
      return;
    }
    const room = this.maxBytes - this.written;
    const part = chunk.length > room ? chunk.subarray(0, room) : chunk;
    try {
      this.stream.write(part);
    } catch {
      // 日志流关闭后忽略写入
    }
    this.written += part.length;
    if (this.streamed > this.maxBytes) this.truncated = true;
  }
  end() {
    try {
      this.stream.end();
    } catch {
      // 忽略关闭失败
    }
  }
  get persistedBytes() {
    return this.written;
  }
}

interface RunningEntry {
  child: ChildProcess;
  capture: LogCapture;
  exec: VerificationExecution;
  timer: ReturnType<typeof setTimeout> | null;
  stopRequested: boolean;
  stopInitiated: boolean;
  timedOut: boolean;
  finished: boolean;
  startFailed: boolean;
  exitCode: number | null;
  signal: string | null;
}

const TERMINAL: VerificationExecutionStatus[] = [
  "succeeded",
  "failed",
  "timed_out",
  "stopped",
  "start_failed",
];

/** 游标绑定 execution、文件身份（dev/ino）和原始字节位置。 */
function encodeCursor(stat: { dev: number; ino: number }, offset: number): string {
  return Buffer.from(
    JSON.stringify({ v: 1, off: offset, dev: stat.dev, ino: stat.ino }),
    "utf8",
  ).toString("base64url");
}

function decodeCursor(
  cursor: string,
  stat: { dev: number; ino: number },
): number {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new AppError("VERIFICATION_LOG_CURSOR", "日志游标无效", 409);
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as { v?: unknown }).v !== 1 ||
    typeof (parsed as { off?: unknown }).off !== "number" ||
    !Number.isInteger((parsed as { off: number }).off) ||
    (parsed as { off: number }).off < 0 ||
    (parsed as { dev?: unknown }).dev !== stat.dev ||
    (parsed as { ino?: unknown }).ino !== stat.ino
  )
    throw new AppError(
      "VERIFICATION_LOG_CURSOR",
      "日志游标跨执行、文件已重建或身份变化，请从头读取",
      409,
    );
  return (parsed as { off: number }).off;
}

/** 按原始字节切片，但只保留完整 UTF-8 码点（不切断多字节字符）。 */
function trimToCompleteUtf8(buffer: Buffer): Buffer {
  let end = buffer.length;
  if (end === 0) return buffer;
  let last = end - 1;
  let continuation = 0;
  while (last >= 0 && (buffer[last]! & 0xc0) === 0x80) {
    continuation++;
    last--;
  }
  if (last < 0) return buffer.subarray(0, 0);
  const lead = buffer[last]!;
  let expected = 1;
  if ((lead & 0x80) === 0) expected = 1;
  else if ((lead & 0xe0) === 0xc0) expected = 2;
  else if ((lead & 0xf0) === 0xe0) expected = 3;
  else if ((lead & 0xf8) === 0xf0) expected = 4;
  else expected = 1;
  if (expected >= 2 && continuation + 1 < expected) end = last;
  return buffer.subarray(0, end);
}

function countReplacements(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) if (text[i] === "\uFFFD") count++;
  return count;
}

/**
 * evolution-v1 服务执行验证：按配置 profile 直接执行子进程，持久保存完整终态、
 * 有界日志、内容指纹、依赖与 profile 摘要，并处理中断、并发、重启与未知占用。
 * 来源固定 service_executed，绝不改写 Agent 自报或把退出 0 当任务验收。
 */
export class VerificationService {
  private running = new Map<string, RunningEntry>();
  constructor(
    private service: Service,
    private dataDir: string,
  ) {}

  profiles(): VerificationProfilesView {
    const loaded = loadVerificationConfig(this.dataDir);
    return {
      config_path: verificationConfigPath(this.dataDir),
      config_version: loaded.configVersion,
      config_sha256: loaded.configSha256,
      valid: loaded.error === null,
      error: loaded.error,
      items: loaded.items,
      notice: loaded.error
        ? "配置不可用；start 将拒绝启动，请修正配置文件。"
        : "可用 profile；start 仅传 profile_id，禁止传命令或环境。",
    };
  }

  start(
    args: { task_id: string; run_id: string; claim_epoch: number; profile_id: string },
    requestId: string | null = null,
  ): VerificationExecution {
    const task = this.service.task(args.task_id);
    const run = this.service.currentClaim(task, {
      run_id: args.run_id,
      claim_epoch: args.claim_epoch,
    });
    const all = this.service.store
      .list("verification_execution", task.project_id)
      .filter((e) => e.task_id === task.id);
    const active = all.find((e) => e.status === "queued" || e.status === "running");
    ensure(
      !active,
      "VERIFICATION_RUNNING",
      "同任务已有运行中的验证执行",
      { execution_id: active?.id },
    );
    const heldUnknown = all.find(
      (e) => e.status === "unknown" && e.reservation.state === "held",
    );
    if (heldUnknown) {
      const isolatedOk = heldUnknown.reservation.observed.includes(
        `isolated_workdir=${realpathOf(run.workdir)}`,
      );
      ensure(
        isolatedOk,
        "VERIFICATION_UNKNOWN",
        "该任务存在结果未知且仍占用 workdir 的旧执行，请先 reconcile（confirmed_stopped 或 isolated）",
        { execution_id: heldUnknown.id },
      );
    }
    const profile = this.resolveEffectiveProfile(args.profile_id, run);
    const before = observeWorkspace(run.workdir, task.scopes);
    const id = uid("vex");
    const requestedAt = now();
    const logPath = join(this.dataDir, "verification", `${id}.log`);
    const execution: VerificationExecution = {
      id,
      version: 1,
      project_id: task.project_id,
      task_id: task.id,
      run_id: run.id,
      claim_epoch: task.claim_epoch,
      request_id: requestId,
      profile_id: args.profile_id,
      profile_sha256: profile.profile_sha256,
      command: profile.command,
      args: [...profile.args],
      cwd: profile.cwd,
      status: "queued",
      source: "service_executed",
      requested_at: requestedAt,
      started_at: null,
      ended_at: null,
      exit_code: null,
      signal: null,
      error_code: null,
      error_message: null,
      log_path: logPath,
      log_sha256: null,
      log_bytes: 0,
      output_truncated: false,
      workspace_before: before,
      workspace_after: null,
      dependency_revisions: this.dependencyRevisions(task),
      reservation: {
        state: "held",
        workdir: run.workdir,
        released_at: null,
        released_by_run_id: null,
        outcome: null,
        observed: `spawn requested at ${requestedAt}`,
      },
      created_at: requestedAt,
      updated_at: requestedAt,
    };
    this.putExec(execution);

    if (!profile.found) {
      const failed = this.finishStartFailed(
        execution,
        "ENOENT",
        `命令不存在或不可执行：${profile.command}`,
        before,
      );
      this.service.emit(task.project_id, "verification.started", {
        task_id: task.id,
        run_id: run.id,
        execution_id: id,
        profile_id: args.profile_id,
      });
      return failed;
    }

    mkdirSync(join(this.dataDir, "verification"), { recursive: true });
    const stream = createWriteStream(logPath, { flags: "a" });
    const capture = new LogCapture(stream, profile.max_output_bytes);
    let child: ChildProcess;
    try {
      child = spawn(profile.command, profile.args, {
        cwd: profile.cwd,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      });
    } catch (error) {
      capture.end();
      return this.finishStartFailed(
        execution,
        (error as NodeJS.ErrnoException).code || "SPAWN_FAILED",
        error instanceof Error ? error.message : String(error),
        before,
      );
    }
    const entry: RunningEntry = {
      child,
      capture,
      exec: {
        ...execution,
        status: "running",
        started_at: now(),
        updated_at: now(),
      },
      timer: null,
      stopRequested: false,
      stopInitiated: false,
      timedOut: false,
      finished: false,
      startFailed: false,
      exitCode: null,
      signal: null,
    };
    this.running.set(id, entry);
    child.stdout?.on("data", (chunk: Buffer) => capture.write(chunk));
    child.stderr?.on("data", (chunk: Buffer) => capture.write(chunk));
    child.once("error", (error) => {
      entry.startFailed = true;
      entry.exitCode = null;
      entry.signal = null;
      this.finalize(
        entry,
        (error as NodeJS.ErrnoException).code || "SPAWN_FAILED",
        error instanceof Error ? error.message : String(error),
      );
    });
    child.once("close", (code, signal) => {
      entry.exitCode = code ?? null;
      entry.signal = signal ?? null;
      this.finalize(entry);
    });
    const timer = setTimeout(() => {
      if (!entry.finished) {
        entry.timedOut = true;
        this.initiateStop(entry);
      }
    }, profile.timeout_ms);
    timer.unref?.();
    entry.timer = timer;
    this.putExec(entry.exec);
    this.setTaskServiceVerification(entry.exec);
    this.service.emit(task.project_id, "verification.started", {
      task_id: task.id,
      run_id: run.id,
      execution_id: id,
      profile_id: args.profile_id,
    });
    return entry.exec;
  }

  stop(args: { execution_id: string; run_id: string }): VerificationExecution {
    const execution = this.getExec(args.execution_id);
    const task = this.service.task(execution.task_id);
    ensure(
      task.owner_run_id === args.run_id &&
        execution.claim_epoch === task.claim_epoch,
      "STALE_CLAIM",
      "执行权已变化，无法停止该执行",
    );
    const run = this.service.run(args.run_id);
    ensure(run.status === "active", "RUN_INACTIVE", "执行会话尚未恢复");
    ensure(
      !TERMINAL.includes(execution.status),
      "VERIFICATION_STATE",
      "该执行已处于终态，不能停止",
    );
    ensure(
      execution.status !== "unknown",
      "VERIFICATION_UNKNOWN",
      "该执行结果未知，请先 reconcile",
    );
    const entry = this.running.get(execution.id);
    ensure(
      entry,
      "VERIFICATION_UNKNOWN",
      "服务端没有该执行的存活句柄，不能冒充停止；请按契约 reconcile",
    );
    this.initiateStop(entry);
    return this.getExec(execution.id);
  }

  reconcile(args: {
    execution_id: string;
    run_id: string;
    expected_version: number;
    outcome: "confirmed_stopped" | "isolated";
    observed: string;
    confirmed_stop: boolean;
  }): VerificationExecution & { freshness: VerificationFreshness } {
    const execution = this.getExec(args.execution_id);
    const task = this.service.task(execution.task_id);
    ensure(
      task.owner_run_id === args.run_id,
      "NOT_OWNER",
      "仅任务当前负责人可 reconcile",
    );
    const run = this.service.run(args.run_id);
    ensure(run.status === "active", "RUN_INACTIVE", "执行会话尚未恢复");
    ensure(
      execution.version === args.expected_version,
      "STALE_VERSION",
      "执行记录已更新，请刷新后重试",
      { current_version: execution.version },
    );
    ensure(
      execution.status === "unknown" && execution.reservation.state === "held",
      "VERIFICATION_STATE",
      "当前执行不处于未知占用状态",
      { status: execution.status, reservation: execution.reservation.state },
    );
    if (args.outcome === "confirmed_stopped") {
      ensure(
        args.confirmed_stop === true,
        "VERIFICATION_UNKNOWN",
        "confirmed_stopped 需要 confirmed_stop=true 与真实后代停止证据",
      );
      const updated: VerificationExecution = {
        ...execution,
        reservation: {
          ...execution.reservation,
          state: "released",
          released_at: now(),
          released_by_run_id: args.run_id,
          outcome: "confirmed_stopped",
          observed: args.observed,
        },
        updated_at: now(),
      };
      this.putExec(updated);
      this.setTaskServiceVerification(updated);
      this.service.emit(task.project_id, "verification.reconciled", {
        task_id: task.id,
        run_id: args.run_id,
        execution_id: execution.id,
        outcome: "confirmed_stopped",
        observed: args.observed,
      });
      return { ...updated, freshness: this.computeFreshness(task, updated) };
    }
    ensure(
      args.confirmed_stop === false,
      "VERIFICATION_UNKNOWN",
      "isolated 需要 confirmed_stop=false；旧进程仍可能存活",
    );
    const oldReal = realpathOf(execution.reservation.workdir);
    const newReal = realpathOf(run.workdir);
    ensure(
      oldReal !== newReal,
      "VERIFICATION_STATE",
      "isolated 需要任务当前 Run 处于不同真实 worktree",
      { old_realpath: oldReal, new_realpath: newReal },
    );
    const conflicts = this.service.conflicts(task, run);
    ensure(
      !conflicts.length,
      "SCOPE_CONFLICT",
      "新 worktree 仍存在同目录范围冲突，不能隔离生成新执行",
      { conflicts },
    );
    // 只追加隔离审计；旧 status 与原 workdir held 保留，不宣称旧进程停止。
    const audited: VerificationExecution = {
      ...execution,
      reservation: {
        ...execution.reservation,
        observed: `${execution.reservation.observed}\nisolated_workdir=${newReal} by ${args.run_id} at ${now()}: ${args.observed}`,
      },
      updated_at: now(),
    };
    this.putExec(audited);
    this.setTaskServiceVerification(audited);
    this.service.emit(task.project_id, "verification.isolated", {
      task_id: task.id,
      run_id: args.run_id,
      execution_id: execution.id,
      old_workdir: oldReal,
      new_workdir: newReal,
      observed: args.observed,
    });
    return { ...audited, freshness: this.computeFreshness(task, audited) };
  }

  execution(
    executionId: string,
  ): VerificationExecution & { freshness: VerificationFreshness } {
    const execution = this.getExec(executionId);
    const task = this.service.task(execution.task_id);
    return {
      ...execution,
      freshness: this.computeFreshness(task, execution),
    };
  }

  history(
    taskId: string,
    opts: { execution_id?: string; offset: number; limit: number },
  ): VerificationHistoryView {
    const task = this.service.task(taskId);
    const all = this.service.store
      .list("verification_execution", task.project_id)
      .filter((e) => e.task_id === task.id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (opts.execution_id) {
      const execution = this.getExec(opts.execution_id);
      ensure(
        execution.task_id === task.id,
        "VERIFICATION_NOT_FOUND",
        "该执行不属于当前任务",
      );
      return {
        items: [{ ...execution, freshness: this.computeFreshness(task, execution) }],
        total: 1,
        next_offset: null,
      };
    }
    const items = all
      .slice(opts.offset, opts.offset + opts.limit)
      .map((e) => ({ ...e, freshness: this.computeFreshness(task, e) }));
    return {
      items,
      total: all.length,
      next_offset:
        opts.offset + items.length < all.length
          ? opts.offset + items.length
          : null,
    };
  }

  log(
    executionId: string,
    cursor?: string,
    limit = 16384,
  ): VerificationLogView {
    const execution = this.getExec(executionId);
    let stat: { size: number; dev: number; ino: number; isFile: boolean };
    try {
      const s = statSync(execution.log_path);
      stat = {
        size: s.size,
        dev: s.dev,
        ino: s.ino,
        isFile: s.isFile(),
      };
    } catch {
      throw new AppError(
        "VERIFICATION_LOG_UNAVAILABLE",
        "日志丢失或不可读，请检查数据目录；执行记录保留",
        404,
      );
    }
    if (!stat.isFile)
      throw new AppError("VERIFICATION_LOG_UNAVAILABLE", "日志不是普通文件", 404);
    let offset = 0;
    if (cursor !== undefined && cursor !== null) offset = decodeCursor(cursor, stat);
    if (offset > stat.size)
      throw new AppError(
        "VERIFICATION_LOG_CURSOR",
        "日志游标超出当前文件，请从头读取",
        409,
      );
    const full = readFileSync(execution.log_path);
    let slice = trimToCompleteUtf8(
      full.subarray(offset, Math.min(offset + limit, full.length)),
    );
    // 保证前进：limit 小于一个码点时至少返回一个完整码点（最多扩展 8 字节）。
    if (slice.length === 0 && offset < full.length) {
      slice = trimToCompleteUtf8(
        full.subarray(offset, Math.min(offset + 8, full.length)),
      );
    }
    const text = slice.toString("utf8");
    const nextOffset = offset + slice.length;
    const complete =
      TERMINAL.includes(execution.status) &&
      !execution.output_truncated &&
      nextOffset >= stat.size;
    return {
      execution_id: execution.id,
      status: execution.status,
      cursor: cursor ?? null,
      next_cursor: encodeCursor(stat, nextOffset),
      returned_bytes: slice.length,
      total_bytes: stat.size,
      text,
      encoding: "utf-8",
      decode_errors: "replace",
      replacement_count: countReplacements(text),
      complete,
      capture_truncated: execution.output_truncated,
      capture_complete: TERMINAL.includes(execution.status) && !execution.output_truncated,
      log_sha256: sha256File(execution.log_path),
      notice: execution.output_truncated
        ? "输出超过上限，已截断；持久化文件较短不代表完整日志。"
        : "",
    };
  }

  /** 服务重启后调用：queued/running 一律转 unknown 且 held，历史永不改写为 stopped/succeeded。 */
  reconcileRunningAtStartup() {
    for (const execution of this.service.store.list("verification_execution")) {
      if (execution.status === "queued" || execution.status === "running") {
        const updated: VerificationExecution = {
          ...execution,
          status: "unknown",
          reservation: {
            ...execution.reservation,
            state: "held",
            observed: `${execution.reservation.observed}；服务重启，执行结果未知`,
          },
          updated_at: now(),
        };
        this.putExec(updated);
        this.setTaskServiceVerification(updated);
      }
    }
  }

  private resolveEffectiveProfile(profileId: string, run: Run) {
    const loaded = loadVerificationConfig(this.dataDir);
    if (loaded.error || !loaded.raw)
      throw new AppError(
        loaded.error?.code || "VERIFICATION_PROFILE_INVALID",
        loaded.error?.message || "验证配置不可用",
        409,
      );
    const profile = loaded.raw.profiles[profileId];
    if (!profile)
      throw new AppError(
        "VERIFICATION_PROFILE_NOT_FOUND",
        `profile ${profileId} 不存在；调用 verification_profiles 读取可用ID`,
        404,
        { profile_id: profileId },
      );
    const timeoutMs = profile.timeout_ms ?? DEFAULT_TIMEOUT_MS;
    const maxOutputBytes = profile.max_output_bytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    const cwdRaw = profile.cwd ?? ".";
    const cwd = resolveProfileCwd(run.workdir, cwdRaw);
    const { resolved: command, found } = resolveCommandInPath(profile.command, cwd);
    const args = [...profile.args];
    return {
      command,
      args,
      cwd,
      found,
      timeout_ms: timeoutMs,
      max_output_bytes: maxOutputBytes,
      profile_sha256: effectiveProfileDigest({
        command,
        args,
        cwd,
        timeout_ms: timeoutMs,
        max_output_bytes: maxOutputBytes,
      }),
    };
  }

  private finishStartFailed(
    execution: VerificationExecution,
    errorCode: string,
    errorMessage: string,
    before: VerificationExecution["workspace_before"],
  ): VerificationExecution {
    const failed: VerificationExecution = {
      ...execution,
      status: "start_failed",
      ended_at: now(),
      error_code: errorCode,
      error_message: errorMessage,
      workspace_after: before,
      reservation: {
        ...execution.reservation,
        state: "released",
        released_at: now(),
        released_by_run_id: execution.run_id,
        outcome: "start_failed",
        observed: `start_failed：${errorCode} ${errorMessage}`,
      },
      updated_at: now(),
    };
    this.putExec(failed);
    this.setTaskServiceVerification(failed);
    return failed;
  }

  private initiateStop(entry: RunningEntry) {
    if (entry.stopInitiated) return;
    entry.stopInitiated = true;
    entry.stopRequested = true;
    signalGroup(entry.child.pid, "SIGTERM");
    const killTimer = setTimeout(() => {
      if (!entry.finished) signalGroup(entry.child.pid, "SIGKILL");
    }, STOP_GRACE_MS);
    const forceTimer = setTimeout(() => {
      if (!entry.finished) this.forceUnknown(entry, "停止请求后进程仍未退出，结果未知");
    }, STOP_GRACE_MS + FORCE_MS);
    killTimer.unref?.();
    forceTimer.unref?.();
  }

  private finalize(
    entry: RunningEntry,
    errorCode: string | null = null,
    errorMessage: string | null = null,
  ) {
    if (entry.finished) return;
    entry.finished = true;
    if (entry.timer) clearTimeout(entry.timer);
    let status: VerificationExecutionStatus;
    if (entry.startFailed) status = "start_failed";
    else if (entry.timedOut) status = "timed_out";
    else if (entry.stopRequested) status = "stopped";
    else status = entry.exitCode === 0 ? "succeeded" : "failed";
    const execution = { ...entry.exec };
    execution.status = status;
    execution.ended_at = now();
    execution.exit_code = entry.startFailed ? null : entry.exitCode;
    execution.signal = entry.signal ?? null;
    execution.error_code = errorCode;
    execution.error_message = errorMessage;
    execution.output_truncated = entry.capture.truncated;
    execution.log_bytes = entry.capture.persistedBytes;
    entry.capture.end();
    execution.log_sha256 = sha256File(execution.log_path);
    execution.workspace_after = observeWorkspace(
      execution.reservation.workdir,
      this.taskScopesSafe(execution.task_id),
    );
    const groupAlive = entry.startFailed
      ? false
      : processGroupAlive(entry.child.pid);
    if (entry.startFailed) {
      execution.reservation = {
        ...execution.reservation,
        state: "released",
        released_at: now(),
        released_by_run_id: execution.run_id,
        outcome: "start_failed",
        observed: `start_failed：${errorCode || "SPAWN_FAILED"} ${
          errorMessage || ""
        }`,
      };
    } else if (
      !groupAlive &&
      ["succeeded", "failed", "timed_out", "stopped"].includes(status)
    ) {
      execution.reservation = {
        ...execution.reservation,
        state: "released",
        released_at: now(),
        released_by_run_id: execution.run_id,
        outcome: "known_exit",
        observed: `${status}；已知进程树完全退出`,
      };
    } else {
      execution.status = "unknown";
      execution.reservation = {
        ...execution.reservation,
        state: "held",
        observed: `${status} 后进程树仍有可观察后代存活或结果不确定，保留占用`,
      };
    }
    execution.updated_at = now();
    this.putExec(execution);
    this.setTaskServiceVerification(execution);
    this.running.delete(execution.id);
    this.service.emit(execution.project_id, "verification.finished", {
      task_id: execution.task_id,
      run_id: execution.run_id,
      execution_id: execution.id,
      status: execution.status,
    });
  }

  private forceUnknown(entry: RunningEntry, message: string) {
    if (entry.finished) return;
    entry.finished = true;
    if (entry.timer) clearTimeout(entry.timer);
    const execution = { ...entry.exec };
    execution.status = "unknown";
    execution.ended_at = now();
    execution.exit_code = entry.exitCode;
    execution.signal = entry.signal ?? null;
    execution.output_truncated = entry.capture.truncated;
    execution.log_bytes = entry.capture.persistedBytes;
    entry.capture.end();
    execution.log_sha256 = sha256File(execution.log_path);
    execution.workspace_after = observeWorkspace(
      execution.reservation.workdir,
      this.taskScopesSafe(execution.task_id),
    );
    execution.reservation = {
      ...execution.reservation,
      state: "held",
      observed: message,
    };
    execution.updated_at = now();
    this.putExec(execution);
    this.setTaskServiceVerification(execution);
    this.running.delete(execution.id);
    this.service.emit(execution.project_id, "verification.finished", {
      task_id: execution.task_id,
      run_id: execution.run_id,
      execution_id: execution.id,
      status: "unknown",
    });
  }

  private taskScopesSafe(taskId: string): string[] {
    try {
      return this.service.task(taskId).scopes;
    } catch {
      return [];
    }
  }

  private getExec(id: string): VerificationExecution {
    const execution = this.service.store.get("verification_execution", id);
    if (!execution)
      throw new AppError("VERIFICATION_NOT_FOUND", `验证执行 ${id} 不存在`, 404);
    return execution;
  }

  private putExec(execution: VerificationExecution): VerificationExecution {
    this.service.store.put("verification_execution", execution);
    return execution;
  }

  private setTaskServiceVerification(execution: VerificationExecution) {
    const task = this.service.store.get("task", execution.task_id);
    if (!task) return;
    const summary = this.summary(execution, task);
    this.service.store.put("task", {
      ...task,
      service_verification: summary,
      updated_at: now(),
    });
  }

  private summary(
    execution: VerificationExecution,
    task: Task,
  ): VerificationSummary {
    return {
      execution_id: execution.id,
      profile_id: execution.profile_id,
      profile_sha256: execution.profile_sha256,
      version: execution.version,
      status: execution.status,
      source: "service_executed",
      passed: execution.status === "succeeded" && execution.exit_code === 0,
      freshness: this.computeFreshness(task, execution),
      requested_at: execution.requested_at,
      started_at: execution.started_at,
      ended_at: execution.ended_at,
      reservation_state: execution.reservation.state,
      log_path: execution.log_path,
    };
  }

  private dependencyRevisions(task: Task): Record<string, string> {
    const out: Record<string, string> = Object.create(null);
    for (const dependency of dependencies(this.service, task))
      out[dependency.id] = artifactRevision(dependency);
    return out;
  }

  private currentProfileMatches(execution: VerificationExecution): boolean {
    const loaded = loadVerificationConfig(this.dataDir);
    if (loaded.error || !loaded.raw) return false;
    const profile = loaded.raw.profiles[execution.profile_id];
    if (!profile) return false;
    const timeoutMs = profile.timeout_ms ?? DEFAULT_TIMEOUT_MS;
    const maxOutputBytes = profile.max_output_bytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    let cwd: string;
    try {
      cwd = resolveProfileCwd(execution.reservation.workdir, profile.cwd ?? ".");
    } catch {
      return false;
    }
    const { resolved: command } = resolveCommandInPath(profile.command, cwd);
    return (
      effectiveProfileDigest({
        command,
        args: [...profile.args],
        cwd,
        timeout_ms: timeoutMs,
        max_output_bytes: maxOutputBytes,
      }) === execution.profile_sha256
    );
  }

  private computeFreshness(
    task: Task,
    execution: VerificationExecution,
  ): VerificationFreshness {
    const reasons: VerificationFreshness["reasons"] = [];
    if (execution.status !== "succeeded") {
      if (["queued", "running", "unknown"].includes(execution.status))
        reasons.push("execution_unknown");
      else reasons.push("not_passed");
    }
    if (
      task.owner_run_id !== execution.run_id ||
      task.claim_epoch !== execution.claim_epoch
    )
      reasons.push("owner_changed");
    if (
      execution.reservation.state === "held" &&
      execution.status !== "queued" &&
      execution.status !== "running"
    )
      reasons.push("process_unconfirmed");
    if (execution.status === "succeeded") {
      const before = execution.workspace_before;
      const after = execution.workspace_after;
      if (!before.fingerprint || !after?.fingerprint) {
        reasons.push("workspace_unobservable");
      } else if (after.fingerprint !== before.fingerprint) {
        reasons.push("scope_changed_during_run");
      } else {
        const current = observeWorkspace(
          execution.reservation.workdir,
          task.scopes,
        );
        if (!current.fingerprint) reasons.push("workspace_unobservable");
        else if (current.fingerprint !== after.fingerprint)
          reasons.push("scope_changed_after_run");
      }
      const currentDeps = this.dependencyRevisions(task);
      if (
        JSON.stringify(currentDeps) !==
        JSON.stringify(execution.dependency_revisions)
      )
        reasons.push("dependency_changed");
      if (!this.currentProfileMatches(execution)) reasons.push("profile_changed");
    }
    const unique = [...new Set(reasons)];
    const unknown = new Set<VerificationFreshness["reasons"][number]>([
      "execution_unknown",
      "workspace_unobservable",
      "process_unconfirmed",
    ]);
    const state = unique.some((reason) => unknown.has(reason))
      ? "unknown"
      : unique.length
        ? "stale"
        : "current";
    return { state, reasons: unique, observed_at: now() };
  }
}
