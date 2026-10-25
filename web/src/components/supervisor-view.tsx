import { usePageRefresh } from "./page-refresh";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  useEffect,
  useState,
  useCallback,
  useRef,
  type FormEvent,
} from "react";
import {
  Activity,
  CheckCircle2,
  ArrowUpRight,
  Settings2,
  AlertCircle,
  Clock3,
} from "lucide-react";
import type {
  Project,
  Task,
  SupervisorStatus,
  SupervisorPolicy,
  SupervisorIncident,
} from "../../../server/types.ts";
import {
  runtimeIds,
  runtimeNames,
  supportsLaunch,
} from "../../../server/runtimes.ts";
import type { CommandInput } from "../../../server/schemas.ts";
import type { Command, Notify } from "../types";
import type { BoardQuery } from "./project-memory.tsx";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from "@/components/ui/field";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/native-select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { DiagnosisBlock } from "./verification-panel";

const modes = {
  observe: "仅观察",
  remind: "提醒负责人",
  recover: "自动接手续跑",
};
const statuses = {
  open: "待处理",
  recovering: "正在接手",
  escalated: "需要检查",
  resolved: "告警已解除",
};
const text = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const stamp = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString("zh-CN") : "尚无";

export function SupervisorView({
  project,
  projects,
  tasks,
  query,
  command,
  scan,
  notify,
  openTask,
  openProject,
}: {
  project: Project;
  projects: Project[];
  tasks: Task[];
  query: BoardQuery;
  command: Command;
  scan: () => Promise<unknown>;
  notify: Notify;
  openTask: (task: Task) => void;
  openProject: (projectId: string) => void;
}) {
  const [status, setStatus] = useState<SupervisorStatus | null>(null),
    [scope, setScope] = useState("");
  const [projectPolicy, setProjectPolicy] = useState<
    SupervisorPolicy | undefined
  >();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [editing, setEditing] = useState(false);
  const [reading, setReading] = useState(false);
  const requestSequence = useRef(0);
  const loadedCount = useRef(20);
  const inFlight = useRef(false);
  const refresh = useCallback(
    async (offset = 0, append = false, propagate = false) => {
      const sequence = ++requestSequence.current;
      inFlight.current = true;
      setReading(true);
      try {
        let result = await query("supervisor_status", {
          project_id: scope || undefined,
          offset,
          limit: 20,
        });
        if (!append) {
          while (
            result.next_offset !== null &&
            result.incidents.length < loadedCount.current
          ) {
            if (sequence !== requestSequence.current) return;
            const next = await query("supervisor_status", {
              project_id: scope || undefined,
              offset: result.next_offset,
              limit: 20,
            });
            result = {
              ...next,
              incidents: [...result.incidents, ...next.incidents],
            };
          }
        }
        const policies =
          scope && scope !== project.id
            ? (
                await query("supervisor_status", {
                  project_id: project.id,
                  limit: 1,
                })
              ).policies
            : result.policies;
        if (sequence !== requestSequence.current) return;
        setStatus((old) => {
          const next =
            append && old
              ? {
                  ...result,
                  incidents: [...old.incidents, ...result.incidents],
                }
              : result;
          // Refreshing retains the amount of history the reader has opened.
          loadedCount.current = Math.max(20, next.incidents.length);
          return next;
        });
        setProjectPolicy(policies.find((p) => p.project_id === project.id));
        setError("");
      } catch (e) {
        if (sequence === requestSequence.current) setError(text(e));
        if (propagate) throw e;
      } finally {
        if (sequence === requestSequence.current) {
          setReading(false);
          inFlight.current = false;
        }
      }
    },
    [scope, project.id, query],
  );
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (!inFlight.current) void refresh();
    }, 15000);
    return () => {
      requestSequence.current++;
      clearInterval(timer);
    };
  }, [refresh]);
  usePageRefresh(() => refresh(0, false, true));
  const policy = projectPolicy;
  async function handle(
    incident: SupervisorIncident,
    action: "recheck" | "snooze",
  ) {
    setBusy(true);
    try {
      await command("supervisor_handle", {
        incident_id: incident.id,
        expected_version: incident.version,
        action,
        ...(action === "snooze"
          ? { until: new Date(Date.now() + 3600000).toISOString() }
          : {}),
        note:
          action === "snooze"
            ? "人工暂缓一小时，保留原因与预算。"
            : "人工请求重新检查，执行前仍须核实原进程。",
      });
      await refresh();
      notify(action === "snooze" ? "已暂缓一小时" : "已请求重新检查");
    } catch (e) {
      notify(text(e), true);
    } finally {
      setBusy(false);
    }
  }
  const projectNames = new Map(projects.map((p) => [p.id, p.name]));
  const active = status?.incidents.filter((i) => i.status !== "resolved") || [];
  const history =
    status?.incidents.filter((i) => i.status === "resolved") || [];
  const editPolicy = () =>
    query("supervisor_status", { project_id: project.id })
      .then((r) => {
        setProjectPolicy(r.policies[0]);
        setEditing(true);
      })
      .catch((e) => notify(text(e), true));
  const incidentList = (
    items: SupervisorStatus["incidents"],
    historical: boolean,
  ) => (
    <div className="supervisor-incidents">
      {items.map((incident) => {
        const task = tasks.find((t) => t.id === incident.task_id);
        return (
          <Card
            key={incident.id}
            variant="incident"
            className="supervisor-incident"
          >
            <CardHeader>
              <div className="supervisor-incident-meta">
                <Badge
                  variant={
                    incident.status === "escalated"
                      ? "destructive"
                      : incident.status === "resolved"
                        ? "success"
                        : incident.status === "recovering"
                          ? "active"
                          : "warning"
                  }
                  size="status"
                >
                  {incident.status === "resolved" ? (
                    <CheckCircle2 />
                  ) : incident.status === "recovering" ? (
                    <Activity />
                  ) : (
                    <AlertCircle />
                  )}
                  {statuses[incident.status]}
                </Badge>
                <span>
                  {projectNames.get(incident.project_id) ||
                    incident.project_name}
                </span>
                {incident.snoozed_until &&
                  Date.parse(incident.snoozed_until) > Date.now() && (
                    <Badge variant="outline">已暂缓</Badge>
                  )}
              </div>
              <CardTitle>
                <span className="supervisor-task-id">
                  {incident.task_short_id}
                </span>
                {incident.task_title}
              </CardTitle>
              <CardDescription>{incident.reason}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {incident.resolution && (
                <p className="supervisor-resolution">{incident.resolution}</p>
              )}
              {incident.status === "resolved" && (
                <p className="muted">
                  告警解除只说明告警状态变化，不等于恢复、接手或验收成功。
                </p>
              )}
              {incident.diagnosis && (
                <DiagnosisBlock diagnosis={incident.diagnosis} />
              )}
              <details className="supervisor-details">
                <summary>
                  处理记录 · 首次发现 {stamp(incident.first_seen_at)}
                </summary>
                <div>
                  <p>
                    最近提醒：{stamp(incident.notified_at)} · 恢复尝试：
                    {incident.attempts} 次
                  </p>
                  {incident.replacement_run_id && (
                    <p>
                      接手 Run：<code>{incident.replacement_run_id}</code>
                    </p>
                  )}
                  {!incident.resolution && <p>等待项目策略处理。</p>}
                </div>
              </details>
            </CardContent>
            <CardFooter className="flex flex-wrap gap-2">
              {task ? (
                <Button variant="outline" onClick={() => openTask(task)}>
                  查看任务
                  <ArrowUpRight data-icon="inline-end" />
                </Button>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => openProject(incident.project_id)}
                >
                  打开所在项目
                  <ArrowUpRight data-icon="inline-end" />
                </Button>
              )}
              {!["resolved", "recovering"].includes(incident.status) && (
                <>
                  <Button
                    variant="outline"
                    disabled={busy || reading}
                    onClick={() => void handle(incident, "recheck")}
                  >
                    <Activity data-icon="inline-start" />
                    重新检查
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy || reading}
                    onClick={() => void handle(incident, "snooze")}
                  >
                    <Clock3 data-icon="inline-start" />
                    暂缓一小时
                  </Button>
                </>
              )}
            </CardFooter>
          </Card>
        );
      })}
      {!items.length && (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>
              {historical
                ? "暂无已解除记录"
                : status?.next_offset !== null
                  ? "已加载记录中没有待处理项"
                  : "当前范围没有待处理问题"}
            </EmptyTitle>
            <EmptyDescription>
              {status?.next_offset !== null
                ? "还有更多记录，继续加载查看。"
                : historical
                  ? "告警解除后，会保留在这里供你回顾。"
                  : "新的任务停滞会在下一次巡视中记录。"}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  );
  return (
    <section className="supervisor-view">
      <div className="supervisor-main">
        <div className="supervisor-toolbar">
          <Field orientation="horizontal">
            <FieldLabel htmlFor="supervisor-scope">查看范围</FieldLabel>
            <NativeSelect
              id="supervisor-scope"
              value={scope}
              onChange={(e) => {
                loadedCount.current = 20;
                requestSequence.current++;
                setScope(e.target.value);
                setStatus(null);
              }}
            >
              <option value="">所有项目</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Button
            variant="outline"
            disabled={busy || reading}
            onClick={async () => {
              setBusy(true);
              try {
                await scan();
                await refresh(0, false, true);
                notify("巡视完成");
              } catch (e) {
                notify(text(e), true);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Activity data-icon="inline-start" />
            {busy ? "处理中…" : "立即巡视"}
          </Button>
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {!status && !error && <Skeleton className="h-60 w-full" />}
        {status && (
          <Tabs defaultValue="active" className="gap-5">
            <TabsList aria-label="巡视事项分类">
              <TabsTrigger value="active">
                待处理
                <Badge variant={active.length ? "warning" : "secondary"}>
                  {active.length}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="history">
                已解除<Badge variant="secondary">{history.length}</Badge>
              </TabsTrigger>
            </TabsList>
            <p className="supervisor-list-note">
              {status.next_offset !== null
                ? `已加载 ${status.incidents.length} / ${status.total} 条，分类数量仅统计已加载记录。`
                : `当前范围共 ${status.total} 条记录，待处理 ${active.length} 条。`}
            </p>
            <TabsContent value="active">
              {incidentList(active, false)}
            </TabsContent>
            <TabsContent value="history">
              {incidentList(history, true)}
            </TabsContent>
            {status.next_offset !== null && (
              <Button
                variant="outline"
                disabled={reading || busy}
                onClick={() => void refresh(status.next_offset!, true)}
              >
                {reading ? "加载中…" : "加载更多记录"}
              </Button>
            )}
          </Tabs>
        )}
      </div>
      <aside className="supervisor-aside" aria-label="当前项目巡视策略">
        <Card>
          <CardHeader>
            <CardTitle>当前项目策略</CardTitle>
            <CardDescription>{project.name}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <Badge
              variant={policy?.mode === "recover" ? "active" : "secondary"}
            >
              {modes[policy?.mode || "observe"]}
            </Badge>
            <dl className="supervisor-policy-facts">
              <div>
                <dt>执行预算已用</dt>
                <dd>
                  {policy?.launches || 0} / {policy?.max_launches || 0}
                </dd>
              </div>
              {policy && (
                <>
                  <div>
                    <dt>无进展阈值</dt>
                    <dd>{policy.stale_after_seconds / 60} 分钟</dd>
                  </div>
                  <div>
                    <dt>提醒后等待</dt>
                    <dd>{policy.grace_seconds / 60} 分钟</dd>
                  </div>
                </>
              )}
            </dl>
            <p className="supervisor-policy-note">
              {policy
                ? `恢复工具顺序：${policy.runtimes.map((r) => runtimeNames[r]).join(" → ") || "尚未指定"}。`
                : "默认仅观察。可设置提醒，或启用有预算的自动接手。"}
            </p>
          </CardContent>
          <CardFooter>
            <Button variant="outline" onClick={editPolicy}>
              <Settings2 data-icon="inline-start" />
              配置项目策略
            </Button>
          </CardFooter>
        </Card>
        <div className="supervisor-help">
          <h2>
            <Clock3 aria-hidden="true" />
            巡视如何工作
          </h2>
          <p>
            后台每 15
            秒巡视所有项目及子任务，巡视本身不调用模型。发现停滞后，按对应项目策略提醒或接手。
          </p>
          <p>心跳表示会话仍在，检查点和成果才代表任务进展。</p>
          {status && (
            <details className="supervisor-details">
              <summary>查看巡视说明</summary>
              <p>{status.notice}</p>
            </details>
          )}
        </div>
      </aside>
      {editing && (
        <PolicyEditor
          project={project}
          policy={policy}
          close={() => setEditing(false)}
          save={async (args) => {
            const saved = await command("supervisor_configure", args);
            setProjectPolicy(saved);
            setEditing(false);
            await refresh();
            notify("项目巡视策略已保存");
          }}
        />
      )}
    </section>
  );
}
function PolicyEditor({
  project,
  policy,
  close,
  save,
}: {
  project: Project;
  policy?: SupervisorPolicy;
  close: () => void;
  save: (args: CommandInput<"supervisor_configure">) => Promise<void>;
}) {
  const [mode, setMode] = useState(policy?.mode || "observe"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget),
      value = (n: string) => String(form.get(n) || "").trim();
    setBusy(true);
    setError("");
    try {
      const runtimeNames = value("runtimes")
        .split(/[,，\n]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const runtimes = runtimeNames.map((name) => {
        const runtime = runtimeIds.find((r) => r === name && supportsLaunch(r));
        if (!runtime) throw Error(`未知 CLI 类型：${name}`);
        return runtime;
      });
      await save({
        project_id: project.id,
        expected_version: policy?.version,
        mode,
        stale_after_seconds: Number(value("stale")) * 60,
        grace_seconds: Number(value("grace")) * 60,
        cooldown_seconds: Number(value("cooldown")) * 60,
        max_launches: Number(value("max_launches")),
        max_attempts_per_task: Number(value("max_attempts")),
        runtimes,
        stop_stalled_managed: form.has("stop_stalled"),
        reset_budget: form.has("reset_budget"),
        note: value("note"),
      });
    } catch (e) {
      setError(text(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>项目巡视策略</DialogTitle>
          <DialogDescription>
            {project.name} · 其他项目各自保持原策略。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="patrol-mode">处理方式</FieldLabel>
              <NativeSelect
                id="patrol-mode"
                value={mode}
                onChange={(e) => setMode(e.target.value as typeof mode)}
              >
                {Object.entries(modes).map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
              <FieldDescription>
                仅观察记录问题；提醒发送持久消息；自动接手还会启动本机 CLI。
              </FieldDescription>
            </Field>
            {mode === "recover" && (
              <Alert>
                <AlertCircle />
                <AlertDescription>
                  自动接手会消耗所选客户端的账户额度，受总预算与单任务次数限制。原进程已停止后，新
                  Run
                  携带现有检查点与相关记忆核验现场；客户端登录和工具审批仍按原配置处理。
                </AlertDescription>
              </Alert>
            )}
            <FieldGroup className="sm:flex-row">
              <Field>
                <FieldLabel htmlFor="patrol-stale">
                  无进展阈值（分钟）
                </FieldLabel>
                <Input
                  id="patrol-stale"
                  name="stale"
                  type="number"
                  min={1}
                  max={10080}
                  step={0.5}
                  defaultValue={(policy?.stale_after_seconds || 900) / 60}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="patrol-grace">
                  提醒后宽限（分钟）
                </FieldLabel>
                <Input
                  id="patrol-grace"
                  name="grace"
                  type="number"
                  min={0.5}
                  max={1440}
                  step={0.5}
                  defaultValue={(policy?.grace_seconds || 300) / 60}
                  required
                />
              </Field>
            </FieldGroup>
            <Field>
              <FieldLabel htmlFor="patrol-cooldown">
                恢复冷却（分钟）
              </FieldLabel>
              <Input
                id="patrol-cooldown"
                name="cooldown"
                type="number"
                min={0.5}
                max={1440}
                step={0.5}
                defaultValue={(policy?.cooldown_seconds || 300) / 60}
                required
              />
            </Field>
            <FieldGroup className="sm:flex-row">
              <Field>
                <FieldLabel htmlFor="patrol-budget">总执行次数预算</FieldLabel>
                <Input
                  id="patrol-budget"
                  name="max_launches"
                  type="number"
                  min={0}
                  max={100}
                  defaultValue={policy?.max_launches ?? 5}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="patrol-attempts">
                  每任务最多尝试
                </FieldLabel>
                <Input
                  id="patrol-attempts"
                  name="max_attempts"
                  type="number"
                  min={1}
                  max={10}
                  defaultValue={policy?.max_attempts_per_task || 2}
                  required
                />
              </Field>
            </FieldGroup>
            <Field>
              <FieldLabel htmlFor="patrol-runtimes">恢复工具顺序</FieldLabel>
              <Input
                id="patrol-runtimes"
                name="runtimes"
                defaultValue={policy?.runtimes.join(", ") || "codex, pi"}
                required
              />
              <FieldDescription>
                使用 Agent 接入中的 CLI
                标识，逗号分隔。失败后按顺序尝试下一种工具，仅选择本机检测就绪的客户端。
              </FieldDescription>
            </Field>
            <Field orientation="horizontal">
              <Checkbox
                id="patrol-stop"
                name="stop_stalled"
                defaultChecked={policy?.stop_stalled_managed || false}
              />
              <FieldLabel htmlFor="patrol-stop">
                允许停止本服务托管且长期无进展的进程
              </FieldLabel>
            </Field>
            <Field orientation="horizontal">
              <Checkbox id="patrol-reset" name="reset_budget" />
              <FieldLabel htmlFor="patrol-reset">
                显式重置总预算和每任务尝试计数
              </FieldLabel>
            </Field>
            <Field>
              <FieldLabel htmlFor="patrol-note">策略说明</FieldLabel>
              <Textarea
                id="patrol-note"
                name="note"
                required
                maxLength={12000}
                defaultValue={policy?.note}
                placeholder="说明为什么采用这项策略"
              />
            </Field>
            {error && (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={close}
              >
                取消
              </Button>
              <Button type="submit" disabled={busy}>
                保存巡视策略
              </Button>
            </div>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}
