import { useEffect, useState, useCallback } from "react";
import {
  RefreshCw,
  FileText,
  AlertCircle,
  Copy,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import type { WorkGuide, ExecutionPlan } from "../../../server/types.ts";
import type { Task, Run, Message } from "../types";
import { RequestResolution } from "./request-resolution";

const stageLabels: Record<WorkGuide["stage"], string> = {
  recover: "先恢复现场",
  execute: "执行当前步骤",
  blocked: "等待解除阻塞",
  verify: "验证成果",
  submit: "准备提交",
  review: "等待独立验收",
  wait_children: "等待子任务",
  done: "已完成",
  unavailable: "等待可执行工作",
};

function Instructions({ plan }: { plan: ExecutionPlan }) {
  return (
    <details className="execution-instructions">
      <summary>查看完整执行说明 · {plan.steps.length} 个步骤</summary>
      <div className="execution-instructions-body">
        {plan.inputs.length > 0 && (
          <div>
            <h4>开始前需要读取</h4>
            <ul>
              {plan.inputs.map((input, index) => (
                <li key={index}>{input}</li>
              ))}
            </ul>
          </div>
        )}
        {plan.outputs.length > 0 && (
          <div>
            <h4>需要交付</h4>
            <ul>
              {plan.outputs.map((output, index) => (
                <li key={index}>{output}</li>
              ))}
            </ul>
          </div>
        )}
        {plan.steps.length > 0 && (
          <ol className="execution-plan-steps">
            {plan.steps.map((step) => (
              <li key={step.id}>
                <strong>{step.title}</strong>
                <p>{step.instructions}</p>
                <dl>
                  <dt>完成条件</dt>
                  <dd>{step.done_when}</dd>
                  <dt>失败处理</dt>
                  <dd>{step.on_failure}</dd>
                </dl>
              </li>
            ))}
          </ol>
        )}
        {plan.stop_when.length > 0 && (
          <div>
            <h4>遇到这些情况先报告</h4>
            <ul>
              {plan.stop_when.map((condition, index) => (
                <li key={index}>{condition}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  );
}

export function ExecutionGuide({
  task,
  loadGuide,
  onContext,
  onCopied,
  runNames,
  currentRun,
  tasks,
  requestRevision,
  onResolveRequest,
}: {
  task: Task;
  loadGuide: (taskId: string, runId: string) => Promise<WorkGuide>;
  onContext: () => void;
  onCopied: () => void;
  runNames: Record<string, string>;
  currentRun?: Run;
  tasks: Task[];
  requestRevision: string;
  onResolveRequest: (message: Message) => void;
}) {
  const [guide, setGuide] = useState<WorkGuide | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [request, setRequest] = useState(0);
  const refresh = useCallback(() => setRequest((value) => value + 1), []);
  useEffect(() => {
    let live = true;
    setGuide(null);
    setError("");
    setLoading(false);
    if (!task.owner_run_id) return;
    setLoading(true);
    loadGuide(task.id, task.owner_run_id)
      .then((value) => {
        if (live) setGuide(value);
      })
      .catch((input: unknown) => {
        if (!live) return;
        const message = input instanceof Error ? input.message : String(input);
        const code =
          input && typeof input === "object" && "code" in input
            ? input.code
            : "";
        setError(
          code === "UNKNOWN_QUERY" || message.includes("work_next")
            ? "当前服务尚未提供执行指引，请启动 0.4.0 或更新版本；已保存的任务接手包仍可查看。"
            : `执行指引暂未载入：${message}`,
        );
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [
    task.id,
    task.version,
    task.owner_run_id,
    loadGuide,
    request,
    requestRevision,
  ]);
  const copyAction = async () => {
    if (!guide) return;
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(guide.next_action, null, 2),
      );
      onCopied();
    } catch {
      setError("复制未完成，请展开下一步调用并手动复制。 ");
    }
  };
  return (
    <section
      className="detail-section execution-guide"
      aria-labelledby="execution-guide-title"
    >
      <div className="execution-guide-heading">
        <h3 id="execution-guide-title">执行指引</h3>
        <div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="刷新执行指引"
            disabled={loading || !task.owner_run_id}
            onClick={refresh}
          >
            <RefreshCw />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="查看任务接手包"
            onClick={onContext}
          >
            <FileText />
          </Button>
        </div>
      </div>
      <p className="muted execution-readonly">
        这里仅查看当前指引。执行者核对自己的身份和现场后，通过 MCP 汇报结果。
      </p>
      {!task.owner_run_id && (
        <p className="execution-no-owner">
          任务领取后，会显示负责人当前应该执行的步骤。现在可以先查看验收标准和完整执行说明。
        </p>
      )}
      {loading && (
        <div className="execution-guide-loading" aria-label="正在读取执行指引">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-16 w-full" />
        </div>
      )}
      {error && (
        <Alert>
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {guide && (
        <>
          <div className="execution-stage">
            <Badge
              variant={guide.stage === "blocked" ? "destructive" : "secondary"}
            >
              {stageLabels[guide.stage]}
            </Badge>
            {guide.completed_steps.length > 0 && (
              <span>{guide.completed_steps.length} 个步骤已报告完成</span>
            )}
          </div>
          <h4 className="execution-headline">{guide.headline}</h4>
          {guide.current_step && (
            <div className="execution-current-step">
              <strong>{guide.current_step.title}</strong>
              <p>{guide.current_step.instructions}</p>
              <dl>
                <dt>完成条件</dt>
                <dd>{guide.current_step.done_when}</dd>
                <dt>失败处理</dt>
                <dd>{guide.current_step.on_failure}</dd>
              </dl>
            </div>
          )}
          {guide.checklist.length > 0 && (
            <ul className="execution-checklist">
              {guide.checklist.map((item, index) => (
                <li key={index}>
                  <CheckCircle2 aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          )}
          {guide.warnings.length > 0 && (
            <Alert>
              <AlertCircle />
              <AlertDescription>
                <ul>
                  {guide.warnings.map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
          {guide.truncated && (
            <Alert>
              <AlertCircle />
              <AlertDescription>
                当前指引包含省略（字符预算 {guide.char_budget}）：
                {guide.omissions.join("；")}。按引用补读完整记录后再执行。
              </AlertDescription>
            </Alert>
          )}
          {guide.context?.truncated && (
            <Alert>
              <AlertCircle />
              <AlertDescription>
                接手包包含省略：{guide.context.omissions.join("；")}
                。执行前按包内引用补读相关记录。
              </AlertDescription>
            </Alert>
          )}
          {(guide.messages.length > 0 || guide.request_page.total > 0) && (
            <details className="execution-instructions">
              <summary>待处理请求与阻塞 · {guide.request_page.total}</summary>
              <div className="execution-instructions-body">
                <p>
                  确认收到只表示已读。核对处理结果后，填写处理结论；执行者也可通过
                  MCP relay_message_resolve 汇报。原收件人可能属于旧会话。
                </p>
                {guide.messages.map((message) => (
                  <div className="execution-request" key={message.id}>
                    <Badge
                      variant={
                        message.kind === "blocker" ? "destructive" : "outline"
                      }
                    >
                      {message.kind === "blocker" ? "阻塞" : "协作请求"}
                    </Badge>
                    <p>{message.body}</p>
                    <p className="muted">
                      原收件人：
                      {message.to_run_id
                        ? runNames[message.to_run_id] || message.to_run_id
                        : "项目协作成员"}{" "}
                      ·{" "}
                      {message.acknowledged_at
                        ? "已读，尚未处理"
                        : "尚未确认收到"}
                    </p>
                    <code>{message.id}</code>
                    <RequestResolution
                      message={message}
                      currentRun={currentRun}
                      tasks={tasks}
                      onResolve={onResolveRequest}
                    />
                  </div>
                ))}
                {guide.request_page.next_offset !== null && (
                  <p>
                    还有请求未显示。调用 relay_work_requests，task_id 为{" "}
                    {task.id}，offset 为 {guide.request_page.next_offset}
                    ，分页读取完整消息。
                  </p>
                )}
              </div>
            </details>
          )}
          {(guide.dependencies.length > 0 ||
            guide.dependency_page.total > 0) && (
            <details className="execution-instructions">
              <summary>
                前置成果接收情况 · 共 {guide.dependency_page.total}{" "}
                项（本页已接收{" "}
                {
                  guide.dependencies.filter((dependency) => dependency.received)
                    .length
                }{" "}
                项）
              </summary>
              <ul className="execution-dependencies">
                {guide.dependencies.map((dependency) => (
                  <li key={dependency.id}>
                    <div>
                      <strong>
                        {dependency.short_id} {dependency.title}
                      </strong>
                      <Badge
                        variant={dependency.received ? "secondary" : "outline"}
                      >
                        {dependency.received ? "已报告接收" : "待核对接收"}
                      </Badge>
                    </div>
                    <p>
                      前置任务
                      {dependency.status === "done" ? "已验收" : "尚未验收"}
                      ；接收结果由执行者核实汇报，服务不会自动合并代码。
                    </p>
                  </li>
                ))}
              </ul>
              {guide.dependency_page.next_offset !== null && (
                <p className="execution-evidence-note">
                  还有前置成果未显示。调用 relay_work_dependencies，task_id 为{" "}
                  {task.id}，offset 为 {guide.dependency_page.next_offset}
                  ，读取完整 revision 后核对接收。
                </p>
              )}
            </details>
          )}
          {guide.decisions.length > 0 && (
            <details className="execution-instructions">
              <summary>需要遵循的决定与契约 · {guide.decisions.length}</summary>
              <div className="execution-decisions">
                {guide.decisions.map((decision) => (
                  <div key={decision.id}>
                    <h4>{decision.title}</h4>
                    <p>{decision.body}</p>
                  </div>
                ))}
              </div>
            </details>
          )}
          <details className="execution-instructions">
            <summary>给执行者的下一步调用</summary>
            <div className="execution-instructions-body">
              <p>{guide.next_action.reason}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={copyAction}
              >
                <Copy data-icon="inline-start" />
                复制调用信息
              </Button>
              <pre className="execution-action">
                {JSON.stringify(guide.next_action, null, 2)}
              </pre>
            </div>
          </details>
          <p className="execution-evidence-note">
            测试结果由执行者报告，独立验收仍需核对实际成果版本和证据。
          </p>
        </>
      )}
      {task.workflow &&
        (task.workflow.facts.length > 0 ||
          task.workflow.failed_attempts.length > 0 ||
          task.workflow.uncertain_actions.length > 0) && (
          <details className="execution-instructions">
            <summary>恢复时保留的事实与待核实事项</summary>
            <div className="execution-instructions-body">
              {task.workflow.facts.length > 0 && (
                <div>
                  <h4>已记录事实</h4>
                  <ul>
                    {task.workflow.facts.map((fact, index) => (
                      <li key={index}>{fact}</li>
                    ))}
                  </ul>
                </div>
              )}
              {task.workflow.failed_attempts.length > 0 && (
                <div>
                  <h4>已尝试但未解决</h4>
                  <ul>
                    {task.workflow.failed_attempts.map((attempt, index) => (
                      <li key={index}>{attempt}</li>
                    ))}
                  </ul>
                </div>
              )}
              {task.workflow.uncertain_actions.length > 0 && (
                <div>
                  <h4>结果待核实，先查证再重试</h4>
                  <ul>
                    {task.workflow.uncertain_actions.map((action, index) => (
                      <li key={index}>{action}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </details>
        )}
      {task.evidence && (
        <details className="execution-instructions">
          <summary>成果版本与证据来源</summary>
          <div className="execution-instructions-body">
            <p>
              {task.evidence.source === "service_observed_git"
                ? "服务已观察工作区 Git 状态。测试通过结果仍由执行者报告。"
                : `服务尚未取得工作区 Git 证据：${task.evidence.reason || "待执行者核实"}`}
            </p>
            <dl className="detail-dl">
              <dt>观察时的提交</dt>
              <dd>
                <code>{task.evidence.revision || "未取得"}</code>
              </dd>
              <dt>观察时间</dt>
              <dd>
                {new Date(task.evidence.observed_at).toLocaleString("zh-CN")}
              </dd>
              <dt>执行目录</dt>
              <dd>
                <code>{task.evidence.workdir}</code>
              </dd>
            </dl>
          </div>
        </details>
      )}
      {task.execution && <Instructions plan={task.execution} />}
    </section>
  );
}
