import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  FileText,
  Play,
  Settings2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  Task,
  Run,
  Notify,
  VerificationSummary,
  VerificationFreshness,
  VerificationProfilesView,
  VerificationHistoryView,
  VerificationLogView,
  VerificationExecution,
  RuntimeDiagnosis,
  ServiceStatusTone,
} from "../types";
import {
  serviceStatusLabel,
  serviceStatusTone,
  freshnessStateLabel,
  freshnessStateTone,
  freshnessReasonLabel,
  diagnosisCategoryLabel,
  diagnosisConfidenceLabel,
  deliveryPhase,
} from "../types";

const toneVariant: Record<
  ServiceStatusTone,
  | "active"
  | "success"
  | "warning"
  | "destructive"
  | "secondary"
  | "outline"
  | "review"
> = {
  active: "active",
  success: "success",
  warning: "warning",
  destructive: "destructive",
  secondary: "secondary",
  outline: "outline",
  review: "review",
};

const stamp = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString("zh-CN") : "尚无";
const text = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export function DiagnosisBlock({
  diagnosis,
}: {
  diagnosis: RuntimeDiagnosis | null | undefined;
}) {
  if (!diagnosis) return null;
  return (
    <div className="diagnosis-block">
      <div className="diagnosis-badges">
        <Badge variant="outline">
          {diagnosisCategoryLabel[diagnosis.category]}
        </Badge>
        <Badge variant="secondary">
          {diagnosisConfidenceLabel[diagnosis.confidence]}
        </Badge>
        {diagnosis.source && <span className="muted">{diagnosis.source}</span>}
      </div>
      <p className="diagnosis-summary">{diagnosis.summary}</p>
      {diagnosis.evidence.length > 0 && (
        <ul className="diagnosis-evidence">
          {diagnosis.evidence.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      )}
      <p className="diagnosis-next-action">
        建议下一步：
        {diagnosis.next_action.label}
        {diagnosis.next_action.tool
          ? `（工具：${diagnosis.next_action.tool}）`
          : ""}
      </p>
      <small className="muted">诊断时间 {stamp(diagnosis.observed_at)}</small>
    </div>
  );
}

function FreshnessReasons({
  freshness,
}: {
  freshness: VerificationFreshness;
}) {
  return (
    <div className="freshness-block">
      <Badge variant={toneVariant[freshnessStateTone(freshness.state)]}>
        {freshnessStateLabel[freshness.state]}
      </Badge>
      {freshness.reasons.length > 0 && (
        <ul className="freshness-reasons">
          {freshness.reasons.map((reason) => (
            <li key={reason}>{freshnessReasonLabel[reason]}</li>
          ))}
        </ul>
      )}
      <small className="muted">判定时间 {stamp(freshness.observed_at)}</small>
    </div>
  );
}

function LogViewer({
  executionId,
  loadLog,
}: {
  executionId: string;
  loadLog: (executionId: string, cursor?: string) => Promise<VerificationLogView>;
}) {
  const [view, setView] = useState<VerificationLogView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const cursorRef = useRef<string | undefined>(undefined);
  const load = useCallback(
    async (nextCursor?: string) => {
      setBusy(true);
      setError("");
      try {
        const result = await loadLog(executionId, nextCursor);
        cursorRef.current = result.next_cursor ?? undefined;
        setView((previous) =>
          previous && nextCursor
            ? { ...result, text: previous.text + result.text }
            : result,
        );
      } catch (e) {
        setError(text(e));
      } finally {
        setBusy(false);
      }
    },
    [executionId, loadLog],
  );
  useEffect(() => {
    cursorRef.current = undefined;
    setView(null);
    void load(undefined);
  }, [executionId, load]);
  return (
    <div className="log-viewer">
      {error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {!view && !error && <Skeleton className="h-16 w-full" />}
      {view && (
        <>
          <div className="log-meta">
            <Badge variant={toneVariant[serviceStatusTone(view.status)]}>
              {serviceStatusLabel[view.status]}
            </Badge>
            <span className="muted">
              {view.returned_bytes} / {view.total_bytes} 字节
            </span>
            {view.capture_truncated && (
              <Badge variant="warning">日志曾截断</Badge>
            )}
            {view.capture_complete && (
              <Badge variant="secondary">日志已完整</Badge>
            )}
            {view.complete && <Badge variant="success">已读至末尾</Badge>}
            {view.replacement_count > 0 && (
              <span className="muted">
                非法字节已替换 {view.replacement_count} 处
              </span>
            )}
          </div>
          <pre className="log-text">{view.text}</pre>
          {view.notice && <p className="muted">{view.notice}</p>}
          <div className="log-actions">
            <Button
              variant="outline"
              size="sm"
              disabled={busy || !view.next_cursor}
              onClick={() => void load(view.next_cursor ?? undefined)}
            >
              <FileText data-icon="inline-start" />
              {busy ? "读取中…" : "加载更多日志"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => void load(undefined)}
            >
              <RefreshCw data-icon="inline-start" />
              重新读取
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function Profiles({
  loadProfiles,
}: {
  loadProfiles: () => Promise<VerificationProfilesView>;
}) {
  const [profiles, setProfiles] = useState<VerificationProfilesView | null>(
      null,
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      setProfiles(await loadProfiles());
    } catch (e) {
      setError(text(e));
    } finally {
      setBusy(false);
    }
  }, [loadProfiles]);
  return (
    <div className="profiles-block">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void load()}
        >
          <Settings2 data-icon="inline-start" />
          {busy ? "读取中…" : "读取验证配置"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => {
            setProfiles(null);
            setError("");
          }}
        >
          收起
        </Button>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {profiles && (
        <>
          <dl className="detail-dl">
            <dt>配置文件</dt>
            <dd>
              <code>{profiles.config_path}</code>
            </dd>
            <dt>配置状态</dt>
            <dd>
              <Badge variant={profiles.valid ? "success" : "destructive"}>
                {profiles.valid ? "有效" : "不可用"}
              </Badge>
              {profiles.error && (
                <span className="muted">
                  {profiles.error.code}：{profiles.error.message}
                </span>
              )}
            </dd>
          </dl>
          {profiles.items.map((profile) => (
            <div className="artifact-item" key={profile.id}>
              <div>
                <code>
                  {profile.id} · {profile.command} {profile.args.join(" ")}
                </code>
                <p className="muted">
                  cwd {profile.cwd} · 超时 {profile.timeout_ms}ms · 输出上限{" "}
                  {profile.max_output_bytes} 字节
                </p>
                <small className="muted">
                  配置摘要 {profile.profile_sha256}
                </small>
              </div>
            </div>
          ))}
          {!profiles.items.length && (
            <p className="muted">
              当前没有可用的验证 profile。请在数据目录的
              verification-profiles.json 中配置，然后由服务校验。
            </p>
          )}
          {profiles.notice && <p className="muted">{profiles.notice}</p>}
        </>
      )}
    </div>
  );
}

function History({
  taskId,
  loadHistory,
  loadExecution,
  loadLog,
}: {
  taskId: string;
  loadHistory: (offset: number) => Promise<VerificationHistoryView>;
  loadExecution: (
    executionId: string,
  ) => Promise<VerificationExecution & { freshness: VerificationFreshness }>;
  loadLog: (executionId: string, cursor?: string) => Promise<VerificationLogView>;
}) {
  const [page, setPage] = useState<VerificationHistoryView | null>(null);
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<VerificationExecution & {
    freshness: VerificationFreshness;
  } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setBusy(true);
    setError("");
    setPage(null);
    loadHistory(offset)
      .then((result) => {
        if (live) setPage(result);
      })
      .catch((e) => {
        if (live) setError(text(e));
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [taskId, offset, loadHistory]);
  return (
    <div className="history-block">
      {error && <p role="alert">{error}</p>}
      {busy && !page && <Skeleton className="h-12 w-full" />}
      {page?.items.map((item) => (
        <div className="artifact-item" key={item.id}>
          <div className="flex w-full flex-wrap items-start gap-2">
            <Badge variant={toneVariant[serviceStatusTone(item.status)]}>
              {serviceStatusLabel[item.status]}
            </Badge>
            <Badge variant={toneVariant[freshnessStateTone(item.freshness.state)]}>
              {freshnessStateLabel[item.freshness.state]}
            </Badge>
            <span className="muted">
              {item.profile_id} · v{item.version} · {stamp(item.started_at)}
            </span>
            {item.reservation.state === "held" && (
              <Badge variant="warning">占用未释放</Badge>
            )}
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    const next = await loadExecution(item.id);
                    setDetail(next);
                    setDetailId(item.id);
                  } catch (e) {
                    setError(text(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                查看审计
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDetail(null);
                  setDetailId(item.id);
                }}
              >
                日志
              </Button>
            </div>
          </div>
          {detail && detailId === item.id && (
            <div className="history-detail">
              <dl className="detail-dl">
                <dt>完整命令</dt>
                <dd>
                  <code>
                    {detail.command} {detail.args.join(" ")}
                  </code>
                </dd>
                <dt>退出码</dt>
                <dd>
                  {detail.exit_code === null ? "尚无" : detail.exit_code}
                  {detail.signal ? ` · signal ${detail.signal}` : ""}
                </dd>
                {detail.error_code && (
                  <>
                    <dt>错误</dt>
                    <dd>
                      {detail.error_code}
                      {detail.error_message
                        ? `：${detail.error_message}`
                        : ""}
                    </dd>
                  </>
                )}
                <dt>预留状态</dt>
                <dd>
                  {detail.reservation.state === "released"
                    ? "已释放"
                    : "占用中（旧进程或结果未确认）"}
                  {detail.reservation.observed
                    ? ` · ${detail.reservation.observed}`
                    : ""}
                </dd>
                <dt>日志路径</dt>
                <dd>
                  <code>{detail.log_path}</code>
                </dd>
              </dl>
            </div>
          )}
        </div>
      ))}
      {page?.total === 0 && (
        <p className="muted">
          该任务还没有服务执行记录。服务证据由 verification_start
          按 profile 产生，不替代 Agent 自报。
        </p>
      )}
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!offset || busy}
          onClick={() => setOffset(Math.max(0, offset - 10))}
        >
          上一页
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page?.next_offset == null || busy}
          onClick={() => setOffset(page!.next_offset!)}
        >
          下一页
        </Button>
      </div>
      {detail && detailId && (
        <details className="execution-instructions" open>
          <summary>执行日志 · {detailId}</summary>
          <LogViewer executionId={detailId} loadLog={loadLog} />
        </details>
      )}
    </div>
  );
}

export function VerificationPanel({
  task,
  currentRun,
  loadProfiles,
  loadHistory,
  loadExecution,
  loadLog,
  startVerification,
  notify,
}: {
  task: Task;
  currentRun?: Run;
  loadProfiles: () => Promise<VerificationProfilesView>;
  loadHistory: (offset: number) => Promise<VerificationHistoryView>;
  loadExecution: (
    executionId: string,
  ) => Promise<VerificationExecution & { freshness: VerificationFreshness }>;
  loadLog: (
    executionId: string,
    cursor?: string,
  ) => Promise<VerificationLogView>;
  startVerification: (profileId: string) => Promise<unknown>;
  notify: Notify;
}) {
  const summary = task.service_verification ?? null;
  const phase = deliveryPhase(task);
  const mine = !!currentRun && currentRun.id === task.owner_run_id;
  const owner = task.owner_run_id;
  const canRerun = mine && owner;
  const [activeLog, setActiveLog] = useState<string | null>(null);
  const rerun = (profileId: string) =>
    startVerification(profileId)
      .then(() => notify("已请求服务验证，刷新查看最新状态"))
      .catch((e) => notify(text(e), true));
  const review = task.review;
  return (
    <section
      className="detail-section delivery-panel"
      aria-labelledby="delivery-panel-title"
    >
      <div className="execution-guide-heading">
        <h3 id="delivery-panel-title">交付证据与待决事项</h3>
      </div>
      <p className="muted">
        来源分别读取：Agent 自报、服务亲自执行与独立验收。提交不等于验收，告警解除不等于恢复成功。
      </p>
      <div className="delivery-phase">
        <Badge variant={toneVariant[phase.tone]}>{phase.label}</Badge>
        {task.submitted_at && (
          <span className="muted">提交于 {stamp(task.submitted_at)}</span>
        )}
        {review && (
          <span className="muted">
            验收人：
            {review.human_review
              ? "人工验收"
              : review.reviewer_run_id || "待安排独立验收 Run"}
            {" · "}
            {review.accepted ? "已通过" : "未通过"} · {stamp(review.at)}
          </span>
        )}
        {review?.note && (
          <p className="delivery-review-note">{review.note}</p>
        )}
        {!review && task.status === "review" && (
          <p className="muted">
            已提交，等待协调者安排独立验收 Run 或人工验收。
          </p>
        )}
      </div>
      <details className="execution-instructions">
        <summary>Agent 自报验证 · {task.verification.length} 项</summary>
        <div className="execution-instructions-body">
          <p className="muted">
            以下结果由执行者自报，不代表服务亲自运行，也不代表独立验收。
          </p>
          {task.verification.map((v) => (
            <div
              className={`verification-item ${v.passed ? "passed" : "failed"}`}
              key={v.command}
            >
              {v.passed ? (
                <CheckCircle2 size={15} />
              ) : (
                <AlertCircle size={15} />
              )}
              <div>
                <code>{v.command}</code>
                <p>{v.result}</p>
              </div>
            </div>
          ))}
          {!task.verification.length && (
            <p className="muted">执行者尚未报告验证结果。</p>
          )}
        </div>
      </details>
      <details className="execution-instructions" open={!!summary}>
        <summary>
          服务执行验证{" "}
          {summary
            ? `· ${serviceStatusLabel[summary.status]} · v${summary.version}`
            : "· 尚无记录"}
        </summary>
        <div className="execution-instructions-body">
          {!summary && (
            <p className="muted">
              服务尚未为该任务运行验证。只有当前负责人请求
              verification_start 后才会产生记录。
            </p>
          )}
          {summary && (
            <>
              <div className="service-summary">
                <Badge variant={toneVariant[serviceStatusTone(summary.status)]}>
                  {serviceStatusLabel[summary.status]}
                </Badge>
                {summary.passed && (
                  <Badge variant="outline">仍待独立验收</Badge>
                )}
                {summary.reservation_state === "held" && (
                  <Badge variant="warning">占用未释放</Badge>
                )}
                <dl className="detail-dl">
                  <dt>来源</dt>
                  <dd>{summary.source === "service_executed" ? "服务亲自执行" : summary.source}</dd>
                  <dt>profile</dt>
                  <dd>
                    <code>{summary.profile_id}</code>
                  </dd>
                  <dt>配置摘要</dt>
                  <dd>
                    <code>{summary.profile_sha256}</code>
                  </dd>
                  <dt>执行版本</dt>
                  <dd>v{summary.version}</dd>
                  <dt>请求时间</dt>
                  <dd>{stamp(summary.requested_at)}</dd>
                  <dt>开始时间</dt>
                  <dd>{stamp(summary.started_at)}</dd>
                  <dt>结束时间</dt>
                  <dd>{stamp(summary.ended_at)}</dd>
                  <dt>日志入口</dt>
                  <dd>
                    <code>{summary.log_path}</code>
                  </dd>
                </dl>
                {summary.status === "failed" && (
                  <p className="muted">
                    服务执行失败不等于任务失败或已验收。请查看日志后处理，再重新验证。
                  </p>
                )}
                {summary.status === "unknown" && (
                  <p className="muted">
                    结果或旧进程树无法确认。保留占用并核实进程（确认停止或改用独立
                    worktree），核实前不要重复启动。
                  </p>
                )}
                <FreshnessReasons freshness={summary.freshness} />
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setActiveLog(summary.execution_id);
                    }}
                  >
                    <FileText data-icon="inline-start" />
                    打开日志
                  </Button>
                  {canRerun &&
                    !["running", "queued", "unknown"].includes(
                      summary.status,
                    ) && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void rerun(summary.profile_id)}
                      >
                        <Play data-icon="inline-start" />
                        重新验证
                      </Button>
                    )}
                </div>
                {activeLog === summary.execution_id && (
                  <LogViewer
                    executionId={summary.execution_id}
                    loadLog={loadLog}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </details>
      <details className="execution-instructions">
        <summary>验证配置与可用 profile</summary>
        <Profiles loadProfiles={loadProfiles} />
      </details>
      <details className="execution-instructions">
        <summary>服务执行历史</summary>
        <History
          taskId={task.id}
          loadHistory={loadHistory}
          loadExecution={loadExecution}
          loadLog={loadLog}
        />
      </details>
      {currentRun?.diagnosis && (
        <details className="execution-instructions" open>
          <summary>当前执行者恢复诊断</summary>
          <DiagnosisBlock diagnosis={currentRun.diagnosis} />
        </details>
      )}
      {task.workflow &&
        (task.workflow.failed_attempts.length > 0 ||
          task.workflow.uncertain_actions.length > 0) && (
          <details className="execution-instructions">
            <summary>失败尝试与待核实操作</summary>
            <div className="execution-instructions-body">
              {task.workflow.failed_attempts.length > 0 && (
                <>
                  <h4>已尝试但未解决</h4>
                  <ul>
                    {task.workflow.failed_attempts.map((attempt, index) => (
                      <li key={index}>{attempt}</li>
                    ))}
                  </ul>
                </>
              )}
              {task.workflow.uncertain_actions.length > 0 && (
                <>
                  <h4>结果待核实，先查证再重试</h4>
                  <ul>
                    {task.workflow.uncertain_actions.map((action, index) => (
                      <li key={index}>{action}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </details>
        )}
    </section>
  );
}
