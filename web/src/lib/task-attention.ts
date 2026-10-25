import type { Snapshot, Task } from "../types";

export function taskAttention(task: Task, data: Snapshot) {
  const owner = data.runs.find((run) => run.id === task.owner_run_id);
  if (task.status === "blocked")
    return {
      label: "处理阻塞",
      reason: task.checkpoint?.blocker || "执行者已报告阻塞，请核对所需支持。",
    };
  if (task.status === "reconcile")
    return {
      label: "核验现场",
      reason: "新负责人需要确认文件、进程和已收到的成果，再继续执行。",
    };
  if (task.status === "review")
    return {
      label: "安排验收",
      reason: "核对交付版本和验证证据，由独立执行者或人完成评审。",
    };
  if (
    task.owner_run_id &&
    task.status !== "done" &&
    (owner?.status !== "active" || owner.process?.status === "unknown")
  )
    return {
      label: "核实执行状态",
      reason:
        "原执行会话已结束或状态待核实。先确认旧写入情况，再决定恢复或交接。",
    };
  if (task.workflow?.uncertain_actions.length)
    return {
      label: "核实未知结果",
      reason: task.workflow.uncertain_actions[0],
    };
  if (
    task.owner_run_id &&
    ["doing", "blocked"].includes(task.status) &&
    (data.attention
      ? data.attention.recovery_task_ids.includes(task.id)
      : !task.workflow || task.workflow.recovered_epoch !== task.claim_epoch)
  )
    return {
      label: "恢复工作现场",
      reason:
        "当前执行权尚未完成恢复核验。先读取契约并确认文件、进程与前置成果。",
    };
  return null;
}

export function attentionCount(data: Snapshot): number {
  const requests =
    data.attention?.requests_total ??
    data.messages.filter(
      (message) =>
        !message.system &&
        ["request", "blocker"].includes(message.kind) &&
        !message.resolved_at,
    ).length;
  return (
    data.tasks.filter(
      (task) => task.status !== "done" && taskAttention(task, data),
    ).length +
    data.proposals.filter((proposal) => proposal.status === "pending").length +
    requests
  );
}
