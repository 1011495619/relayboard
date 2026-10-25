import { ZodError } from "zod";
import { errorInfo } from "../bin/errors.ts";

/** Advice never retries a mutation or silently supplies versions/stop confirmations. */
export function problem(error: unknown) {
  const parsed = errorInfo(error);
  const code =
    error instanceof ZodError ? "VALIDATION" : parsed.code || "ERROR";
  const hints: Record<string, { tool: string; instruction: string }> = {
    VALIDATION: {
      tool: "relay_api",
      instruction: "按工具名读取完整schema；保留枚举和必填字段。",
    },
    UNKNOWN_COMMAND: {
      tool: "relay_api",
      instruction: "查询可用命令名称，消息发送为message_send。",
    },
    UNKNOWN_QUERY: {
      tool: "relay_api",
      instruction: "查询可用查询名称及输入schema。",
    },
    STALE_VERSION: {
      tool: "relay_task",
      instruction:
        "先读当前任务，核对变化，再使用新expected_version；不要直接重放旧写入。",
    },
    STALE_CLAIM: {
      tool: "relay_work_next",
      instruction: "执行权已变化；以自身Run读取新指引，保留当前handle。",
    },
    STALE_HANDLE: {
      tool: "relay_work_next",
      instruction: "重新读取当前handle并核对任务变化。",
    },
    CONTEXT_CHANGED: {
      tool: "relay_work_next",
      instruction: "读取变化的契约与依赖，重新核验现场。",
    },
    EVIDENCE_REQUIRED: {
      tool: "relay_work_next",
      instruction:
        "检查具体失败项；提供实际运行的完整当前验证集合，替代原因写入summary；旧快照通过evidence_history查询。",
    },
    EVIDENCE_STALE: {
      tool: "relay_work_next",
      instruction:
        "查看changed_files和reason；review中的任务先退回，再以当前负责人重新核验和验证。",
    },
    RUN_INACTIVE: {
      tool: "relay_agent_register",
      instruction:
        "登记自己的新Run，再用work_recovery检查接管路径；不要冒用旧身份。",
    },
    OLD_WRITER_UNCONFIRMED: {
      tool: "relay_work_recovery",
      instruction:
        "先实际核实旧进程停止，或使用独立worktree。心跳过期不足以证明停止。",
    },
    PROCESS_RUNNING: {
      tool: "relay_work_recovery",
      instruction: "旧托管进程仍在运行，先等待或明确停止，并确认实际退出。",
    },
    DELEGATION_SCOPE: {
      tool: "relay_work_recovery",
      instruction:
        "对照required scopes与target_scopes；由上层调整分工或登记合法范围的新Run。",
    },
    CAPABILITY_MISMATCH: {
      tool: "relay_work_recovery",
      instruction:
        "对照required_capabilities和target_capabilities；登记实际具备能力的新Run。",
    },
    NOT_ELIGIBLE: {
      tool: "relay_task",
      instruction:
        "检查owner_run_id和等待原因；已是自身负责人时用work_start，其他负责人须显式交接。",
    },
    NOT_SUBMITTED: {
      tool: "relay_work_next",
      instruction: "由负责人完成恢复、步骤和验证后提交，再独立验收。",
    },
    REVIEW_IDENTITY_REQUIRED: {
      tool: "relay_agent_register",
      instruction:
        "Agent登记自己的独立验收Run；人工管理入口须显式声明human_review=true。该标记是审计声明，不是身份认证。",
    },
    SELF_REVIEW: {
      tool: "relay_agent_register",
      instruction:
        "由另一执行会话或人类核验，保留真实身份；勿用新Run伪装另一模型审查。",
    },
  };
  const hint = hints[code];
  return {
    code,
    message: error instanceof ZodError ? "输入格式需要调整" : parsed.message,
    details: error instanceof ZodError ? error.issues : parsed.details,
    retryable: false,
    ...(hint ? { next_action: hint } : {}),
  };
}
