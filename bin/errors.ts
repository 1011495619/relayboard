import type { RuntimeDiagnosis } from "../server/types.ts";

export interface ErrorInfo {
  message: string;
  code?: string;
  details?: unknown;
  type?: string;
  next_action?: unknown;
  retryable?: boolean;
}
export function errorInfo(error: unknown): ErrorInfo {
  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    return {
      message:
        typeof record.message === "string" ? record.message : String(error),
      code: typeof record.code === "string" ? record.code : undefined,
      details: record.details,
      next_action: record.next_action,
      retryable:
        typeof record.retryable === "boolean" ? record.retryable : undefined,
      type: typeof record.type === "string" ? record.type : undefined,
    };
  }
  return { message: String(error) };
}
export class ClientError extends Error {
  constructor(
    message: string,
    public code = "ERROR",
    public details?: unknown,
    public next_action?: unknown,
    public retryable?: boolean,
  ) {
    super(message);
  }
}

/**
 * RB-004 explainable runtime diagnosis. The shape mirrors the frozen
 * evolution-v1 contract; RB-003 owns the shared declaration in server/types.ts,
 * so this file keeps a local contract-conformant copy until that lands.
 */
export type RuntimeDiagnosisCategory =
  | "authentication"
  | "transient"
  | "permission"
  | "configuration"
  | "process_unknown"
  | "unknown";
export type RuntimeDiagnosisConfidence = "high" | "medium" | "low";
export type RuntimeDiagnosisSource =
  | "adapter_observed"
  | "process_observed"
  | "rule_inferred";
export type RuntimeDiagnosisNextActionKind =
  | "authenticate"
  | "configure"
  | "retry"
  | "wait"
  | "confirm_stop"
  | "inspect"
  | "none";
export interface RuntimeDiagnosisNextAction {
  kind: RuntimeDiagnosisNextActionKind;
  label: string;
  tool: string | null;
  arguments: Record<string, unknown> | null;
}
export interface RuntimeErrorSignal {
  /** Structured error code, e.g. AppError.code or a Node child_process code. */
  code?: string | null;
  /** Sanitized message; never include tokens or secrets. */
  message?: string | null;
  /** Provider runtime id when known, e.g. codex / pi. */
  runtime?: string | null;
  /** Launch phase that produced the signal. */
  phase?: "preflight" | "spawn" | "exit" | "model" | "supervisor";
  exit_code?: number | null;
  process_status?: string | null;
  observed_at?: string;
  source?: RuntimeDiagnosisSource;
}

const authCodes = new Set([
  "AUTH_FAILED",
  "AUTHENTICATION_FAILED",
  "AUTHENTICATION_REQUIRED",
  "NOT_AUTHENTICATED",
  "INVALID_TOKEN",
  "UNAUTHORIZED",
  "LOGIN_REQUIRED",
]);
const transientCodes = new Set([
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "ENETUNREACH",
  "EAI_AGAIN",
  "EPIPE",
  "RATE_LIMITED",
  "THROTTLED",
  "TOO_MANY_REQUESTS",
]);
const permissionCodes = new Set(["EACCES", "EPERM", "FORBIDDEN", "PERMISSION_DENIED"]);
const configurationCodes = new Set([
  "ENOENT",
  "CLI_UNAVAILABLE",
  "RUNTIME_UNSUPPORTED",
  "RUNNERS_DISABLED",
  "WORKDIR_REQUIRED",
  "VERIFICATION_PROFILE_INVALID",
  "VERIFICATION_PROFILE_NOT_FOUND",
  "VERIFICATION_WORKDIR_INVALID",
]);
const processUnknownCodes = new Set(["PROCESS_UNCONFIRMED", "PROCESS_RUNNING"]);

const matches = (text: string, patterns: RegExp[]) =>
  patterns.some((pattern) => pattern.test(text));

export function classifyRuntimeError(
  signal: RuntimeErrorSignal,
): RuntimeDiagnosis {
  const code = signal.code?.toUpperCase() || "";
  const message = (signal.message || "").toLowerCase();
  const text = `${code} ${message}`;
  const observed_at = signal.observed_at || new Date().toISOString();
  const source = signal.source || "rule_inferred";
  const evidence = [
    signal.code ? `code=${signal.code}` : "",
    signal.message ? `message=${signal.message.slice(0, 400)}` : "",
    signal.exit_code !== undefined && signal.exit_code !== null
      ? `exit_code=${signal.exit_code}`
      : "",
    signal.process_status ? `process_status=${signal.process_status}` : "",
  ].filter(Boolean);

  // A known process that exited non-zero is still a process observation first;
  // the reason behind the exit may remain unclassified.
  if (
    processUnknownCodes.has(code) ||
    signal.process_status === "unknown" ||
    (signal.phase === "supervisor" && message.includes("待核实"))
  ) {
    return {
      category: "process_unknown",
      confidence: "high",
      summary: "旧进程或启动/退出结果待核实，保留占用且不自动交接或重复启动。",
      evidence,
      observed_at,
      source: signal.process_status || signal.phase === "supervisor"
        ? "process_observed"
        : source,
      next_action: {
        kind: "confirm_stop",
        label: "先核实原进程及可观察后代是否停止，再交接或迁移到独立 worktree",
        tool: "relay_run_process_reconcile",
        arguments: null,
      },
    };
  }
  if (authCodes.has(code) || matches(message, [
    /(^|\s)401(\s|$)/,
    /unauthori[sz]ed/,
    /not logged in/,
    /login required/,
    /invalid api key/,
    /api key invalid/,
    /token (is )?(invalid|expired|missing|revoked)/,
    /credential(s)? (invalid|expired|missing|denied)/,
    /authentication failed/,
    /sign ?in required/,
  ])) {
    return {
      category: "authentication",
      confidence: authCodes.has(code) ? "high" : "medium",
      summary: "客户端登录或凭据失效，停止自动重试并引导用户在客户端完成登录。",
      evidence,
      observed_at,
      source: signal.phase === "model" ? "adapter_observed" : source,
      next_action: {
        kind: "authenticate",
        label: "在客户端重新登录并确认令牌/账号有效后，再报告恢复",
        tool: null,
        arguments: null,
      },
    };
  }
  if (transientCodes.has(code) || matches(message, [
    /(^|\s)429(\s|$)/,
    /rate ?limit/,
    /too many requests/,
    /throttl/,
    /connection (error|refused|reset|closed|timed out)/,
    /(timed? ?out|timeout)/,
    /econnreset/,
    /econnrefused/,
    /etimedout/,
    /temporar(il)?y (error|failure|unavailable)/,
    /service unavailable/,
    /限流/,
  ])) {
    return {
      category: "transient",
      confidence: transientCodes.has(code) ? "high" : "medium",
      summary: "连接、超时或限流类暂态错误；只按原预算与冷却有界重试。",
      evidence,
      observed_at,
      source: signal.phase === "model" ? "adapter_observed" : source,
      next_action: {
        kind: /rate ?limit|429|too many|throttl|限流/.test(message)
          ? "retry"
          : "wait",
        label: "等待后按项目总预算与每任务冷却有界重试，不无限重启",
        tool: null,
        arguments: null,
      },
    };
  }
  if (permissionCodes.has(code) || matches(message, [
    /(^|\s)403(\s|$)/,
    /permission denied/,
    /forbidden/,
    /approval (required|denied)/,
    /tool (call )?(rejected|denied)/,
    /not permitted/,
    /eacces/,
    /eperm/,
  ])) {
    return {
      category: "permission",
      confidence: permissionCodes.has(code) ? "high" : "medium",
      summary: "工具审批或文件/终端权限被拒绝；需用户在客户端调整权限，服务不修改全局设置。",
      evidence,
      observed_at,
      source: signal.phase === "model" ? "adapter_observed" : source,
      next_action: {
        kind: "inspect",
        label: "在客户端调整工具审批与文件/终端权限，服务不代改全局设置",
        tool: null,
        arguments: null,
      },
    };
  }
  if (configurationCodes.has(code) || matches(message, [
    /command not found/,
    /no such file or directory/,
    /unsupported runtime/,
    /invalid (profile|cwd|config)/,
    /workdir (missing|invalid)/,
    /请在终端安装/,
    /启动配置/,
    /配置入口/,
  ])) {
    return {
      category: "configuration",
      confidence: configurationCodes.has(code) ? "high" : "medium",
      summary: "命令缺失、cwd/profile 非法或不支持该 runtime；修正后重新 preflight。",
      evidence,
      observed_at,
      source,
      next_action: {
        kind: "configure",
        label: "修正 runner-profiles.json 或安装命令，然后重新 preflight",
        tool: "relay_runner_status",
        arguments: null,
      },
    };
  }
  return {
    category: "unknown",
    confidence: "low",
    summary: "证据不足或多种解释冲突；不得猜测成功或自动恢复。",
    evidence,
    observed_at,
    source,
    next_action: {
      kind: "inspect",
      label: "人工检查原始日志、进程与配置后再决定下一步",
      tool: null,
      arguments: null,
    },
  };
}

/** Convenience: classify any thrown value together with optional process context. */
export function diagnoseThrown(
  error: unknown,
  context: Pick<
    RuntimeErrorSignal,
    "phase" | "runtime" | "exit_code" | "process_status" | "source" | "observed_at"
  > = {},
): RuntimeDiagnosis {
  const info = errorInfo(error);
  return classifyRuntimeError({
    code: info.code,
    message: info.message,
    phase: context.phase,
    runtime: context.runtime,
    exit_code: context.exit_code,
    process_status: context.process_status,
    source: context.source,
    observed_at: context.observed_at,
  });
}
