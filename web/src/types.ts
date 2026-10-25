/// <reference types="node" />
import type React from "react";
import type {
  Project,
  Task,
  Snapshot,
  Eligibility,
  ContextPacket,
  CommandResults,
  QueryResults,
  Proposal,
  TaskStatus,
  Artifact,
  Verification,
  Message,
  VerificationExecutionStatus,
  VerificationExecution,
  VerificationFreshness,
  VerificationSummary,
  VerificationProfilesView,
  VerificationHistoryView,
  VerificationLogView,
  RuntimeDiagnosis,
} from "../../server/types.ts";
import type { CommandInput, Runtime } from "../../server/schemas.ts";
export type {
  Project,
  Task,
  Snapshot,
  ContextPacket,
  CommandResults,
  QueryResults,
  Proposal,
  TaskStatus,
  Artifact,
  Verification,
  Runtime,
  Message,
  VerificationExecutionStatus,
  VerificationExecution,
  VerificationFreshness,
  VerificationSummary,
  VerificationProfilesView,
  VerificationHistoryView,
  VerificationLogView,
  RuntimeDiagnosis,
};
export type Run = Snapshot["runs"][number];
export type Eligible = Eligibility & { task: Task };
export interface Skill {
  name: string;
  title: string;
  role: string;
  description: string;
  prompt: string;
  path: string;
  content?: string;
}
export interface SkillSource extends Omit<Skill, "path"> {
  content: string;
}
export interface Integration {
  node: string;
  mcp: string;
  mcp_args?: string[];
  cli_args?: string[];
  base_url: string;
  token_required: boolean;
  skill: string;
}
export type { RuntimeInfo } from "../../server/runtimes.ts";
export type ModalKind =
  | "project"
  | "task"
  | "agent"
  | "checkpoint"
  | "split"
  | "handoff"
  | "reconcile"
  | "review"
  | "scope"
  | "release"
  | "message"
  | "resolveMessage"
  | "decision"
  | "proposalReview"
  | "launch"
  | "logs"
  | "runEnd"
  | "dispatch"
  | "worktree"
  | "context";
interface ModalFields {
  runtime?: Runtime;
  message?: Message;
  task?: Task;
  parent?: { id: string; runtime?: Runtime; workdir?: string };
  project?: Project;
  run?: Run;
  packet?: ContextPacket;
  proposal?: Proposal | boolean;
  accepted?: boolean;
  approved?: boolean;
  workdir?: string;
  branch?: string;
}
export type ModalState = ModalFields &
  (
    | {
        kind:
          "project" | "task" | "agent" | "message" | "decision" | "worktree";
      }
    | {
        kind:
          | "checkpoint"
          | "split"
          | "handoff"
          | "reconcile"
          | "review"
          | "scope"
          | "release";
        task: Task;
      }
    | { kind: "resolveMessage"; message: Message }
    | { kind: "proposalReview"; proposal: Proposal; approved: boolean }
    | { kind: "launch" | "logs" | "runEnd" | "dispatch"; run: Run }
    | { kind: "context"; task: Task; packet: ContextPacket }
  );
export type SetModal = React.Dispatch<React.SetStateAction<ModalState | null>>;
export type Notify = (message: string, error?: boolean) => unknown;
export type Act = (fn: () => unknown | Promise<unknown>) => Promise<void>;
export type OpenTask = (task: Task | undefined) => void;
export type Command = <K extends keyof CommandResults>(
  name: K,
  args: CommandInput<K>,
  message?: string,
) => Promise<CommandResults[K]>;
export type HandleError = (error: unknown) => void;
export interface ChildDraft {
  title: string;
  scope: string;
  readOnly: boolean;
  acceptance?: string;
  resources?: string;
  deps?: string;
}

// ── RB-006 交付界面状态文案（运行时，供 UI 组件与 tests/ui-delivery.test.ts 共用） ──

export type ServiceStatusTone =
  | "active"
  | "success"
  | "warning"
  | "destructive"
  | "secondary"
  | "outline"
  | "review";

export const serviceStatusLabel: Record<VerificationExecutionStatus, string> = {
  queued: "服务排队中",
  running: "服务执行中",
  succeeded: "服务执行通过",
  failed: "服务执行失败",
  timed_out: "服务执行超时",
  stopped: "服务执行已停止",
  start_failed: "服务启动失败",
  unknown: "服务执行结果未知",
};

export function serviceStatusTone(
  status: VerificationExecutionStatus,
): ServiceStatusTone {
  switch (status) {
    case "queued":
    case "running":
      return "active";
    case "succeeded":
      return "success";
    case "unknown":
      return "warning";
    case "failed":
    case "timed_out":
    case "start_failed":
      return "destructive";
    case "stopped":
      return "secondary";
  }
}

export const freshnessStateLabel: Record<VerificationFreshness["state"], string> =
  {
    current: "证据当前有效",
    stale: "证据已过期",
    unknown: "证据有效性未知",
  };

export function freshnessStateTone(
  state: VerificationFreshness["state"],
): ServiceStatusTone {
  switch (state) {
    case "current":
      return "outline";
    case "stale":
    case "unknown":
      return "warning";
  }
}

export const freshnessReasonLabel: Record<
  VerificationFreshness["reasons"][number],
  string
> = {
  not_passed: "本次执行未通过",
  execution_unknown: "执行结果未知",
  owner_changed: "负责人或执行权已变化",
  scope_changed_during_run: "执行期间修改了范围内容",
  scope_changed_after_run: "执行后修改了范围内容",
  workspace_unobservable: "工作区无法完整观察",
  dependency_changed: "依赖成果已变化",
  profile_changed: "验证配置已变化",
  process_unconfirmed: "进程树退出未确认",
};

export const diagnosisCategoryLabel: Record<RuntimeDiagnosis["category"], string> =
  {
    authentication: "登录/凭据",
    transient: "暂态错误",
    permission: "权限/审批",
    configuration: "配置错误",
    process_unknown: "进程状态未知",
    unknown: "无法分类",
  };

export const diagnosisConfidenceLabel: Record<
  RuntimeDiagnosis["confidence"],
  string
> = {
  high: "高置信",
  medium: "中置信",
  low: "低置信",
};

export function deliveryPhase(task: {
  status: TaskStatus;
  submitted_at?: string | null;
  review?: Task["review"];
}): { label: string; tone: ServiceStatusTone } {
  if (task.status === "done") return { label: "已验收", tone: "success" };
  if (task.status === "review") return { label: "待验收", tone: "review" };
  if (task.submitted_at)
    return { label: "已提交，等待独立验收", tone: "secondary" };
  if (task.status === "doing") return { label: "执行中", tone: "active" };
  if (task.status === "blocked") return { label: "已阻塞", tone: "warning" };
  if (task.status === "reconcile")
    return { label: "执行权已转移，待核验", tone: "warning" };
  return { label: "尚未领取", tone: "outline" };
}
