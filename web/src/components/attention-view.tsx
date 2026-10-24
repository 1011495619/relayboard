import { ArrowRight, AlertCircle, CheckCircle2, Clock3 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import type { Snapshot, Task } from "../types";

interface Props {
  data: Snapshot;
  openTask: (task: Task) => void;
  openBoard: () => void;
  openDiscussions: () => void;
  openJoin: () => void;
}

function attention(task: Task, data: Snapshot) {
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

export function AttentionView({
  data,
  openTask,
  openBoard,
  openDiscussions,
  openJoin,
}: Props) {
  const active = data.tasks.filter((task) => task.status !== "done");
  const needsAttention = active.flatMap((task) => {
    const issue = attention(task, data);
    return issue ? [{ task, ...issue }] : [];
  });
  const progressing = active.filter(
    (task) =>
      task.status === "doing" &&
      task.mode === "execute" &&
      !attention(task, data),
  );
  const proposals = data.proposals.filter(
    (proposal) => proposal.status === "pending",
  );
  const requests = data.messages.filter(
    (message) =>
      !message.system &&
      ["request", "blocker"].includes(message.kind) &&
      !message.resolved_at,
  );
  const requestTotal = data.attention?.requests_total ?? requests.length;
  const omittedRequests = Object.entries(
    data.attention?.request_counts ?? {},
  ).flatMap(([taskId, count]) => {
    const visible = requests.filter(
      (message) => (message.task_id || "project") === taskId,
    ).length;
    return count > visible ? [{ taskId, count: count - visible }] : [];
  });
  const completed = data.tasks.filter(
    (task) => task.mode === "execute" && task.status === "done",
  );
  return (
    <div className="attention-view">
      <section
        className="attention-objective"
        aria-labelledby="attention-objective"
      >
        <h2 id="attention-objective">{data.project.name}</h2>
        <p>{data.project.objective}</p>
        <div className="attention-progress">
          <CheckCircle2 aria-hidden="true" />
          <span>
            {completed.length} /{" "}
            {data.tasks.filter((task) => task.mode === "execute").length}{" "}
            项执行任务已验收
          </span>
          <Button variant="link" onClick={openBoard}>
            打开完整看板
            <ArrowRight data-icon="inline-end" />
          </Button>
        </div>
      </section>
      <section className="attention-section" aria-labelledby="attention-title">
        <div className="attention-section-heading">
          <h2 id="attention-title">现在需要处理</h2>
          <Badge variant="secondary">
            {needsAttention.length + proposals.length + requestTotal}
          </Badge>
        </div>
        {needsAttention.map(({ task, label, reason }) => {
          const owner = data.runs.find((run) => run.id === task.owner_run_id);
          const downstream = data.tasks.filter(
            (other) =>
              other.status !== "done" && other.depends_on.includes(task.id),
          ).length;
          return (
            <button
              className="attention-row"
              key={task.id}
              onClick={() => openTask(task)}
            >
              <AlertCircle className="attention-row-icon" aria-hidden="true" />
              <div className="attention-row-content">
                <div className="attention-row-title">
                  <span className="task-id">{task.short_id}</span>
                  <strong>{task.title}</strong>
                </div>
                <p>{reason}</p>
                <span className="attention-row-meta">
                  {owner?.name || "待分配负责人"}
                  {downstream > 0 ? ` · 影响 ${downstream} 项直接下游任务` : ""}
                </span>
              </div>
              <Badge
                variant={task.status === "blocked" ? "destructive" : "outline"}
              >
                {label}
              </Badge>
              <ArrowRight className="attention-row-arrow" aria-hidden="true" />
            </button>
          );
        })}
        {requests.map((message) => {
          const task = data.tasks.find((item) => item.id === message.task_id);
          const recipient = data.runs.find(
            (run) => run.id === message.to_run_id,
          );
          return (
            <button
              className="attention-row"
              key={message.id}
              onClick={() => (task ? openTask(task) : openDiscussions())}
            >
              <AlertCircle className="attention-row-icon" aria-hidden="true" />
              <div className="attention-row-content">
                <div className="attention-row-title">
                  <span className="task-id">
                    {task?.short_id || "项目请求"}
                  </span>
                  <strong>
                    {message.kind === "blocker"
                      ? "待处理阻塞消息"
                      : "待处理协作请求"}
                  </strong>
                </div>
                <p>{message.body}</p>
                <span className="attention-row-meta">
                  原收件人：
                  {recipient?.name ||
                    message.to_run_id ||
                    "项目协作成员"} ·{" "}
                  {message.acknowledged_at ? "已读，尚未处理" : "尚未确认收到"}
                </span>
              </div>
              <Badge variant="outline">等待处理</Badge>
              <ArrowRight className="attention-row-arrow" aria-hidden="true" />
            </button>
          );
        })}
        {omittedRequests.map(({ taskId, count }) => {
          const task = data.tasks.find((item) => item.id === taskId);
          return (
            <button
              key={`older-${taskId}`}
              className="attention-row"
              onClick={() => (task ? openTask(task) : openDiscussions())}
            >
              <AlertCircle className="attention-row-icon" aria-hidden="true" />
              <div className="attention-row-content">
                <div className="attention-row-title">
                  <strong>
                    {task ? `${task.short_id} ${task.title}` : "项目级请求"}
                  </strong>
                </div>
                <p>
                  还有 {count} 条较早的未处理请求，未包含在最近消息中。
                  {task
                    ? "打开任务执行指引，按分页提示读取完整请求。"
                    : "通过项目事件分页读取较早请求，并由相关执行者核实处理。"}
                </p>
              </div>
              <Badge variant="outline">待处理请求</Badge>
              <ArrowRight className="attention-row-arrow" aria-hidden="true" />
            </button>
          );
        })}
        {proposals.length > 0 && (
          <div className="attention-proposals">
            <p>{proposals.length} 项分工或范围申请等待确认。</p>
            <Button variant="outline" onClick={openDiscussions}>
              查看待处理申请
              <ArrowRight data-icon="inline-end" />
            </Button>
          </div>
        )}
        {needsAttention.length === 0 &&
          proposals.length === 0 &&
          requestTotal === 0 && (
            <Empty className="attention-empty">
              <EmptyHeader>
                <EmptyTitle>当前没有阻塞或待处理事项</EmptyTitle>
                <EmptyDescription>
                  任务进展、交接核验和待验收成果会集中出现在这里。
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
      </section>
      <section
        className="attention-section"
        aria-labelledby="progressing-title"
      >
        <div className="attention-section-heading">
          <h2 id="progressing-title">正在推进</h2>
          <Badge variant="secondary">{progressing.length}</Badge>
        </div>
        {progressing.length ? (
          progressing.map((task) => {
            const owner = data.runs.find((run) => run.id === task.owner_run_id);
            return (
              <button
                className="attention-row"
                key={task.id}
                onClick={() => openTask(task)}
              >
                <Clock3 className="attention-row-icon" aria-hidden="true" />
                <div className="attention-row-content">
                  <div className="attention-row-title">
                    <span className="task-id">{task.short_id}</span>
                    <strong>{task.title}</strong>
                  </div>
                  <p>
                    {task.checkpoint?.next_step ||
                      "先核对任务现场，再按执行指引推进。"}
                  </p>
                  <span className="attention-row-meta">
                    {owner?.name || "待分配负责人"} ·{" "}
                    {task.checkpoint ? "已有检查点" : "尚无检查点"}
                  </span>
                </div>
                <ArrowRight
                  className="attention-row-arrow"
                  aria-hidden="true"
                />
              </button>
            );
          })
        ) : (
          <div className="attention-no-progress">
            <p className="attention-section-empty">
              当前没有进行中的执行任务。先查看依赖和范围，再选择适合加入的工作。
            </p>
            <Button variant="outline" onClick={openJoin}>
              查看可领取工作
              <ArrowRight data-icon="inline-end" />
            </Button>
          </div>
        )}
      </section>
      {data.project.constraints && (
        <section
          className="attention-section"
          aria-labelledby="constraints-title"
        >
          <h2 id="constraints-title">当前项目约束</h2>
          <p className="attention-constraints">{data.project.constraints}</p>
        </section>
      )}
    </div>
  );
}
