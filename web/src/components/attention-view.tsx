import { LongText } from "./long-text";
import { ArrowRight, AlertCircle, CheckCircle2, Clock3 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import type { Snapshot, Task, Run, Message } from "../types";
import { RequestResolution } from "./request-resolution";
import { taskStatus } from "./task-status";
import { taskAttention, attentionCount } from "@/lib/task-attention";

interface Props {
  data: Snapshot;
  currentRun?: Run;
  resolveRequest: (message: Message) => void;
  openTask: (task: Task) => void;
  openBoard: () => void;
  openDiscussions: () => void;
  openJoin: () => void;
}

export function AttentionView({
  data,
  currentRun,
  resolveRequest,
  openTask,
  openBoard,
  openDiscussions,
  openJoin,
}: Props) {
  const active = data.tasks.filter((task) => task.status !== "done");
  const needsAttention = active.flatMap((task) => {
    const issue = taskAttention(task, data);
    return issue ? [{ task, ...issue }] : [];
  });
  const progressing = active.filter(
    (task) =>
      task.status === "doing" &&
      task.mode === "execute" &&
      !taskAttention(task, data),
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
        <LongText text={data.project.objective} />
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
          <Badge variant="secondary">{attentionCount(data)}</Badge>
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
              <Badge variant={taskStatus[task.status].variant} size="status">
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
            <div key={message.id} className="flex flex-col gap-2">
              <button
                className="attention-row"
                onClick={() => (task ? openTask(task) : openDiscussions())}
              >
                <AlertCircle
                  className="attention-row-icon"
                  aria-hidden="true"
                />
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
                    {message.acknowledged_at
                      ? "已读，尚未处理"
                      : "尚未确认收到"}
                  </span>
                </div>
                <Badge variant="warning" size="status">
                  等待处理
                </Badge>
                <ArrowRight
                  className="attention-row-arrow"
                  aria-hidden="true"
                />
              </button>
              <RequestResolution
                message={message}
                currentRun={currentRun}
                tasks={data.tasks}
                onResolve={resolveRequest}
              />
            </div>
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
              <Badge variant="warning" size="status">
                待处理请求
              </Badge>
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
          <div className="attention-constraints">
            <LongText text={data.project.constraints} />
          </div>
        </section>
      )}
    </div>
  );
}
