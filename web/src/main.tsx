import React, { useEffect, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowRight,
  ArrowUpRight,
  ArrowLeftRight,
  Plus,
  X,
  Check,
  CheckCircle2,
  Circle,
  CircleDot,
  Clock3,
  ChevronRight,
  ChevronDown,
  GitBranch,
  LayoutDashboard,
  ListTree,
  Users,
  MessageSquare,
  Activity,
  Settings2,
  Search,
  Layers3,
  LockKeyhole,
  Link2,
  Inbox,
  FileText,
  Copy,
  RefreshCw,
  Play,
  Square,
  AlertCircle,
  Terminal,
  FolderGit2,
  ShieldCheck,
  MoreHorizontal,
  Send,
  Waypoints,
  PanelLeftClose,
  Menu,
  ExternalLink,
  BookOpen,
  Sun,
  Moon,
} from "lucide-react";
import { Button as UiButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox as UiCheckbox } from "@/components/ui/checkbox";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from "@/components/ui/select";
import { useIsMobile } from "@/hooks/use-mobile";
import { NativeSelect } from "@/components/ui/native-select";
import { Badge as UiBadge } from "@/components/ui/badge";
import { Avatar as UiAvatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Empty as UiEmpty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from "@/components/ui/empty";
import {
  Field as UiField,
  FieldLabel,
  FieldDescription,
  FieldGroup,
  FieldSet,
  FieldLegend,
} from "@/components/ui/field";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster, toast as toastManager } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  SidebarProvider,
  Sidebar,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import type { QueryInput } from "../../server/schemas.js";
import type { LucideIcon } from "lucide-react";
import type {
  Project,
  Task,
  Run,
  Snapshot,
  Eligible,
  ContextPacket,
  Skill,
  SkillSource,
  Integration,
  RuntimeInfo,
  ModalState,
  ModalKind,
  SetModal,
  Notify,
  Act,
  OpenTask,
  CommandResults,
  Command,
  HandleError,
  ChildDraft,
  Artifact,
  Verification,
  TaskStatus,
  QueryResults,
} from "./types";
import { AttentionView } from "./components/attention-view";
import { RequestResolution } from "./components/request-resolution";
import { ExecutionGuide } from "./components/execution-guide";
import { ExecutionEditor } from "./components/execution-editor";
import type { ExecutionPlan } from "../../server/types.js";
import "./style.css";
class ApiError extends Error {
  code?: string;
  details?: unknown;
}
const errorInfo = (error: unknown): ApiError =>
  error instanceof Error ? error : new Error(String(error));
type CommonProps = { children?: React.ReactNode };
type ViewProps = { data: Snapshot; openTask: OpenTask };
type Api = typeof api;
const required = <T,>(value: T | null | undefined, message: string): T => {
  if (value == null) throw new Error(message);
  return value;
};
type ApiResult<P extends string> = P extends "/skills"
  ? Skill[]
  : P extends `/skills/${string}`
    ? SkillSource
    : P extends "/integration"
      ? Integration
      : P extends "/runtimes"
        ? RuntimeInfo[]
        : P extends `/runner/logs/${string}`
          ? { text: string; truncated: boolean }
          : P extends "/export"
            ? { path: string }
            : P extends "/worktree"
              ? { workdir: string; branch: string }
              : unknown;

const API = "/api";
const statusNames: Record<string, string> = {
  pending: "待领取",
  doing: "进行中",
  blocked: "受阻",
  reconcile: "待核验",
  review: "待验收",
  done: "已完成",
};
const runtimeNames: Record<string, string> = {
  codex: "Codex",
  claude: "Claude Code",
  pi: "pi agent",
  other: "其他工具",
  human: "人工",
};
const eventNames: Record<string, string> = {
  "project.created": "创建项目",
  "project.updated": "更新目标",
  "task.created": "创建任务",
  "task.claimed": "领取任务",
  "task.updated": "更新要求",
  "task.checkpoint": "保存检查点",
  "task.split": "拆分任务",
  "task.submitted": "提交验收",
  "task.accepted": "验收通过",
  "task.returned": "退回修改",
  "task.handoff": "交接任务",
  "task.reconciled": "完成现场核验",
  "task.released": "释放任务",
  "agent.registered": "登记执行者",
  "agent.ended": "会话结束",
  "agent.unknown": "状态待核实",
  "proposal.created": "提出分工",
  "proposal.resolved": "确认分工",
  "scope.requested": "申请修改范围",
  "scope.resolved": "处理范围申请",
  "message.sent": "发送消息",
  "decision.recorded": "记录决定",
  "runner.started": "启动执行",
  "runner.exited": "进程退出",
  "runner.unknown": "进程待核实",
  "workspace.created": "创建工作区",
};
const icons: Record<string, LucideIcon> = {
  home: Inbox,
  board: LayoutDashboard,
  join: ArrowUpRight,
  agents: Users,
  scopes: LockKeyhole,
  discussions: MessageSquare,
  activity: Activity,
  settings: Settings2,
  skills: BookOpen,
};
const navItems = [
  ["home", "关注事项"],
  ["board", "任务看板"],
  ["join", "领取工作"],
  ["agents", "执行者树"],
  ["scopes", "修改范围"],
  ["discussions", "消息与决定"],
  ["activity", "活动记录"],
  ["skills", "协作 Skills"],
  ["settings", "项目与接入"],
];
const splitLines = (value: unknown) =>
  String(value || "")
    .split(/[,，\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
const time = (value?: string | null) =>
  value
    ? new Intl.DateTimeFormat("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(value))
    : "尚无记录";
const relative = (value?: string | null) => {
  if (!value) return "尚无进度";
  const seconds = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
  return seconds < 60
    ? "刚刚"
    : seconds < 3600
      ? `${Math.floor(seconds / 60)} 分钟前`
      : `${Math.floor(seconds / 3600)} 小时前`;
};

async function api<P extends string>(
  path: P,
  body?: unknown,
  method = "POST",
): Promise<ApiResult<P>> {
  const token = localStorage.getItem("relayboard-token");
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
  });
  const value = await res.json();
  if (!res.ok) {
    const e = new ApiError(value.error?.message || `HTTP ${res.status}`);
    e.code = value.error?.code;
    e.details = value.error?.details;
    throw e;
  }
  return value.result ?? value;
}

const query = <K extends keyof QueryResults>(name: K, args?: QueryInput<K>) =>
  api("/query", { query: name, args }) as Promise<QueryResults[K]>;
const loadWorkGuide = (task_id: string, run_id: string) =>
  query("work_next", { task_id, run_id, max_chars: 10000 });
const command: Command = (operation, args) =>
  api("/command", {
    operation,
    args,
    request_id: crypto.randomUUID(),
  }) as Promise<CommandResults[typeof operation]>;

function Checkbox({
  onChange,
  ...props
}: Omit<React.ComponentProps<typeof UiCheckbox>, "onChange"> & {
  onChange?: (event: { target: { checked: boolean } }) => void;
}) {
  return (
    <UiCheckbox
      {...props}
      onCheckedChange={(checked) => onChange?.({ target: { checked } })}
    />
  );
}
function ResponsiveSidebar({
  mobileNav,
  close,
  children,
}: CommonProps & { mobileNav: boolean; close: () => void }) {
  const mobile = useIsMobile();
  return mobile ? (
    <Sheet open={mobileNav} onOpenChange={(open) => !open && close()}>
      <SheetContent
        side="left"
        className="mobile-sidebar"
        showCloseButton={false}
      >
        <SheetTitle className="sr-only">工作空间导航</SheetTitle>
        {children}
      </SheetContent>
    </Sheet>
  ) : (
    <Sidebar collapsible="none" className="app-sidebar">
      {children}
    </Sidebar>
  );
}
function Avatar({
  run,
  small = false,
}: {
  run?: Pick<Run, "runtime" | "name">;
  small?: boolean;
}) {
  return (
    <UiAvatar
      className={cn("agent-avatar", small && "size-5")}
      title={run?.name || "待领取"}
    >
      <AvatarFallback>
        {run
          ? run.runtime === "claude"
            ? "✳"
            : run.runtime === "pi"
              ? "π"
              : run.runtime === "codex"
                ? "⌘"
                : run.name.slice(0, 1)
          : "·"}
      </AvatarFallback>
    </UiAvatar>
  );
}
function Badge({ status }: { status: TaskStatus }) {
  return (
    <UiBadge
      variant="outline"
      className={cn("status-badge", `status-${status}`)}
    >
      <span className="status-dot" />
      {statusNames[status] || status}
    </UiBadge>
  );
}
function Empty({
  icon: Icon = Layers3,
  title,
  children,
  action,
}: CommonProps & {
  icon?: LucideIcon;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <UiEmpty className="workspace-empty">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{children}</EmptyDescription>
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </UiEmpty>
  );
}
function Button({
  children,
  icon: Icon,
  variant = "outline",
  className,
  type = "button",
  ...props
}: Omit<React.ComponentProps<typeof UiButton>, "variant"> & {
  icon?: LucideIcon;
  variant?:
    React.ComponentProps<typeof UiButton>["variant"] | "primary" | "danger";
}) {
  return (
    <UiButton
      type={type}
      variant={
        variant === "primary"
          ? "default"
          : variant === "danger"
            ? "destructive"
            : variant || "outline"
      }
      className={className}
      {...props}
    >
      {Icon && <Icon data-icon="inline-start" />}
      {children}
    </UiButton>
  );
}
function Field({
  label,
  hint,
  children,
}: CommonProps & { label: React.ReactNode; hint?: React.ReactNode }) {
  const id = React.useId();
  const child = React.isValidElement<{
    id?: string;
    "aria-describedby"?: string;
  }>(children)
    ? React.cloneElement(children, {
        id: children.props.id || id,
        ...(hint ? { "aria-describedby": `${id}-hint` } : {}),
      })
    : children;
  return (
    <UiField className="field">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {child}
      {hint && <FieldDescription id={`${id}-hint`}>{hint}</FieldDescription>}
    </UiField>
  );
}
function Text({
  label,
  name,
  value,
  required,
  placeholder,
  multiline,
  hint,
  ...props
}: Omit<
  React.InputHTMLAttributes<HTMLInputElement> &
    React.TextareaHTMLAttributes<HTMLTextAreaElement>,
  "value"
> & {
  label: string;
  value?: string | number;
  multiline?: boolean;
  hint?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      {multiline ? (
        <Textarea
          name={name}
          defaultValue={value}
          placeholder={placeholder}
          required={required}
          rows={3}
          {...props}
        />
      ) : (
        <Input
          name={name}
          defaultValue={value}
          placeholder={placeholder}
          required={required}
          {...props}
        />
      )}
    </Field>
  );
}

function App() {
  const [projects, setProjects] = useState<Project[]>([]),
    [projectId, setProjectId] = useState(
      localStorage.getItem("relayboard-project") || "",
    ),
    [data, setData] = useState<Snapshot | null>(null);
  const [view, setView] = useState("home"),
    [runId, setRunId] = useState(localStorage.getItem("relayboard-run") || ""),
    [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState | null>(null),
    [connected, setConnected] = useState(false),
    [auth, setAuth] = useState(false),
    [loading, setLoading] = useState(true),
    [mobileNav, setMobileNav] = useState(false);
  const [theme, setTheme] = useState(
    () =>
      localStorage.getItem("relayboard-theme") ||
      (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"),
  );
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("relayboard-theme", theme);
  }, [theme]);
  const [search, setSearch] = useState(""),
    [treeView, setTreeView] = useState(false),
    [eligible, setEligible] = useState<Eligible[]>([]),
    [filter, setFilter] = useState("all");
  const project = data?.project,
    runs = data?.runs || [],
    tasks = data?.tasks || [],
    currentRun = runs.find((r) => r.id === runId),
    task = tasks.find((t) => t.id === selectedTask);
  const notify = useCallback(
    (message: string, error = false) =>
      toastManager.add({
        title: message,
        type: error ? "error" : "success",
        timeout: 6500,
      }),
    [],
  );
  const handleError = useCallback(
    (input: unknown) => {
      const error = errorInfo(input);
      if (error.code === "AUTH_REQUIRED") setAuth(true);
      else
        notify(
          error.message +
            (error.details && Array.isArray(error.details)
              ? `：${error.details
                  .map((d) => d.message || d.short_id || "")
                  .filter(Boolean)
                  .join("；")}`
              : ""),
          true,
        );
    },
    [notify],
  );
  const refreshSequence = useRef(0);
  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    try {
      const list = await query("projects");
      if (sequence !== refreshSequence.current) return;
      setProjects(list);
      let id = projectId;
      if (!list.some((p) => p.id === id)) {
        id = list[0]?.id || "";
        setProjectId(id);
      }
      if (id) {
        const next = await query("snapshot", { project_id: id });
        if (sequence !== refreshSequence.current) return;
        setData(next);
        setConnected(true);
      } else {
        setData(null);
        setConnected(true);
      }
      setAuth(false);
    } catch (e) {
      if (sequence !== refreshSequence.current) return;
      setConnected(false);
      handleError(e);
    } finally {
      if (sequence === refreshSequence.current) setLoading(false);
    }
  }, [projectId, handleError]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  useEffect(() => {
    localStorage.setItem("relayboard-project", projectId);
    setSelectedTask(null);
    setSearch("");
  }, [projectId]);
  useEffect(() => {
    localStorage.setItem("relayboard-run", runId);
  }, [runId]);
  useEffect(() => {
    if (data && runId && !runs.some((r) => r.id === runId)) setRunId("");
  }, [data, runId]);
  useEffect(() => {
    if (auth) return;
    if (!projectId) {
      const timer = setInterval(refresh, 15000);
      return () => clearInterval(timer);
    }
    // Native EventSource cannot send Authorization. Token-protected mode uses bounded polling.
    if (localStorage.getItem("relayboard-token")) {
      const timer = setInterval(refresh, 5000);
      return () => clearInterval(timer);
    }
    const events = new EventSource(
      `${API}/stream?project_id=${encodeURIComponent(projectId)}`,
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    events.addEventListener("update", () => {
      clearTimeout(timer);
      timer = setTimeout(refresh, 120);
    });
    events.addEventListener("connected", () => setConnected(true));
    events.onerror = () => setConnected(false);
    const poll = setInterval(refresh, 20000);
    return () => {
      events.close();
      clearTimeout(timer);
      clearInterval(poll);
    };
  }, [projectId, auth, refresh]);
  useEffect(() => {
    if (projectId && currentRun)
      query("eligible", { project_id: projectId, run_id: currentRun.id })
        .then(setEligible)
        .catch(handleError);
    else setEligible([]);
  }, [data, runId]);

  const mutate: Command = async (op, args, message) => {
    const result = await command(op, args);
    await refresh();
    if (message) notify(message);
    return result;
  };
  const act: Act = async (fn) => {
    try {
      await fn();
    } catch (e) {
      handleError(e);
    }
  };
  const claim = (t: Task) =>
    act(async () => {
      if (!currentRun) return setModal({ kind: "agent" });
      await mutate(
        "task_claim",
        { task_id: t.id, run_id: currentRun.id, expected_version: t.version },
        "任务已领取，开始前请核对工作范围",
      );
    });
  const openTask: OpenTask = (t) => {
    if (t) setSelectedTask(t.id);
  };
  const matches = (t: Task) =>
    (!search ||
      `${t.title} ${t.short_id} ${t.scopes.join(" ")}`
        .toLowerCase()
        .includes(search.toLowerCase())) &&
    (filter !== "mine" || t.owner_run_id === currentRun?.id) &&
    (filter !== "leaf" || t.mode === "execute");
  const pendingCount =
    data?.proposals.filter((p) => p.status === "pending").length || 0;
  const unread =
    data?.messages.filter((m) => m.to_run_id === runId && !m.acknowledged_at)
      .length || 0;
  const leaves = tasks.filter((t) => t.mode === "execute"),
    done = leaves.filter((t) => t.status === "done").length;
  const context = async (t: Task) => {
    const packet = await query("context", { task_id: t.id, max_chars: 24000 });
    setModal({ kind: "context", packet, task: t });
  };
  const launch = async (run: Run, t: Task) => {
    await api("/runner/start", { run_id: run.id, task_id: t.id });
    await refresh();
    notify(`${runtimeNames[run.runtime]} 已启动，任务结果以检查点和验证为准`);
  };
  const createExample = () =>
    act(async () => {
      const p = await command("project_create", {
        name: "示例 · 会员订阅",
        objective:
          "演示跨工具协作：实现会员订阅，前后端按接口约定并行，最后集成验收。所有示例任务尚未执行。",
        constraints: "这是示例工作区。登记真实执行者并设置代码目录后再执行。",
        max_concurrency: 6,
      });
      const rootTask = await command("task_create", {
        project_id: p.id,
        title: "实现会员订阅",
        description: "协调接口、页面和验证。",
        acceptance: "子任务完成并通过整体验证",
        scopes: ["src"],
        resources: ["contract:subscription"],
      });
      await command("task_split", {
        task_id: rootTask.id,
        expected_version: rootTask.version,
        rationale: "先确认接口，再独立实现，最后集成",
        children: [
          {
            title: "确认订阅接口约定",
            acceptance: "记录字段、状态与错误响应",
            scopes: ["src/contracts"],
            resources: ["contract:subscription"],
          },
          {
            title: "实现订阅接口",
            acceptance: "提供接口与通过的单元测试",
            scopes: ["src/api"],
            depends_on: ["@0"],
          },
          {
            title: "实现订阅页面",
            acceptance: "页面交互与错误状态验证通过",
            scopes: ["src/web"],
            depends_on: ["@0"],
          },
          {
            title: "编写测试用例",
            acceptance: "提供覆盖关键场景的用例文件",
            scopes: ["src/tests"],
          },
          {
            title: "运行集成验证",
            acceptance: "提供整体验证报告",
            scopes: [],
            read_only: true,
            depends_on: ["@1", "@2", "@3"],
          },
        ],
      });
      setProjectId(p.id);
      notify("示例已创建，尚未启动任何执行者");
    });

  if (auth)
    return (
      <div className="auth-page">
        <div className="brand large">
          <Waypoints /> Relayboard
        </div>
        <form
          className="auth-card"
          onSubmit={(e) => {
            e.preventDefault();
            localStorage.setItem(
              "relayboard-token",
              String(new FormData(e.currentTarget).get("token") || ""),
            );
            refresh();
          }}
        >
          <LockKeyhole size={30} />
          <h1>连接你的工作台</h1>
          <p>此服务启用了访问令牌。输入启动服务时配置的 RELAYBOARD_TOKEN。</p>
          <Text label="访问令牌" name="token" type="password" required />
          <Button variant="primary" icon={ArrowRight} type="submit">
            连接
          </Button>
        </form>
      </div>
    );
  return (
    <SidebarProvider className="app-shell">
      <ResponsiveSidebar
        mobileNav={mobileNav}
        close={() => setMobileNav(false)}
      >
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setView("home");
          }}
        >
          <span className="brand-icon">
            <ArrowLeftRight size={21} />
          </span>
          <span>
            Relayboard<small>AI 协作工作台</small>
          </span>
        </a>
        <div className="sidebar-label">
          工作空间 <span>LOCAL</span>
        </div>
        <div className="project-list">
          {projects.map((p) => (
            <button
              key={p.id}
              className={`project-link ${p.id === projectId ? "selected" : ""}`}
              onClick={() => {
                setProjectId(p.id);
                setMobileNav(false);
              }}
            >
              <span className="project-symbol">{p.name.slice(0, 1)}</span>
              <span>{p.name}</span>
              <ChevronDown size={13} />
            </button>
          ))}
        </div>
        <button
          className="new-project"
          onClick={() => setModal({ kind: "project" })}
        >
          <Plus size={15} /> 新建项目
        </button>
        <div className="sidebar-label section-label">项目协作</div>
        <nav aria-label="项目导航">
          <SidebarMenu>
            {navItems.map(([key, label]) => {
              const Icon = icons[key];
              return (
                <SidebarMenuItem key={key}>
                  <SidebarMenuButton
                    isActive={view === key}
                    className="nav-link"
                    onClick={() => {
                      setView(key);
                      setMobileNav(false);
                    }}
                  >
                    <Icon size={18} />
                    <span>{label}</span>
                    {key === "discussions" && unread > 0 && <b>{unread}</b>}
                    {key === "board" && tasks.length > 0 && (
                      <small>{tasks.length}</small>
                    )}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </nav>
        <div className="sidebar-bottom">
          <div className="continuity-mark">
            <GitBranch size={18} />
            <div>
              <strong>会话会结束，任务会继续。</strong>
              <p>检查点与成果持续保存在本机</p>
            </div>
          </div>
          <div className="connection">
            <span className={`connection-dot ${connected ? "" : "offline"}`} />
            <span>{connected ? "本地服务已连接" : "正在重新连接"}</span>
            <button aria-label="刷新工作台" onClick={refresh}>
              <RefreshCw size={13} />
            </button>
          </div>
        </div>
      </ResponsiveSidebar>
      <main className="main">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="打开导航"
            onClick={() => setMobileNav(true)}
          >
            <Menu size={20} />
          </button>
          <div className="breadcrumb">
            <span>工作空间</span>
            <ChevronRight size={13} />
            <strong>{project?.name || "开始协作"}</strong>
          </div>
          <div className="topbar-right">
            <UiButton
              variant="ghost"
              size="icon"
              aria-label={theme === "dark" ? "切换浅色主题" : "切换深色主题"}
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? <Sun /> : <Moon />}
            </UiButton>
            <span className="local-tag">
              <span /> 本地持久化
            </span>
            <a
              href="/api/health"
              target="_blank"
              rel="noreferrer"
              className="icon-button"
              aria-label="服务状态"
            >
              <Activity size={17} />
            </a>
          </div>
        </header>
        <div className="page">
          <div className="page-heading">
            <div>
              <h1>{navItems.find(([key]) => key === view)?.[1]}</h1>
              <p>
                {
                  {
                    home: "先看哪里需要处理，再继续下一步工作。",
                    board: "目标、进度与交接，留在同一个地方。",
                    join: "先检查依赖和修改范围，再领取适合你的工作。",
                    agents: "从主执行者到子 agent，每一份工作都有归属。",
                    scopes: "查看谁正在修改哪里，以及需要共同协调的资源。",
                    discussions: "围绕任务交流，把达成的共识保存为决定。",
                    activity: "每次领取、交接和交付，都有据可查。",
                    settings: "管理项目约束，连接你的 AI 工具。",
                    skills:
                      "按角色加载协作流程，让每个会话和子 agent 知道如何接着做。",
                  }[view]
                }
              </p>
            </div>
            <div className="heading-actions">
              {project && (
                <Button
                  icon={Users}
                  onClick={() => setModal({ kind: "agent" })}
                >
                  登记执行者
                </Button>
              )}
              <Button
                icon={Plus}
                variant="primary"
                onClick={() => setModal({ kind: project ? "task" : "project" })}
              >
                {project ? "新建任务" : "创建项目"}
              </Button>
            </div>
          </div>
          {view === "skills" ? (
            <SkillsView notify={notify} handleError={handleError} />
          ) : !project ? (
            loading ? (
              <div className="loading">
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-64 w-full" />
              </div>
            ) : (
              <div className="welcome">
                <div className="welcome-visual">
                  <div className="orbit-node first">
                    <Avatar run={{ runtime: "codex", name: "Codex" }} />
                    <span>Codex</span>
                  </div>
                  <div className="orbit-core">
                    <ArrowLeftRight size={32} />
                  </div>
                  <div className="orbit-node second">
                    <Avatar run={{ runtime: "claude", name: "Claude" }} />
                    <span>Claude Code</span>
                  </div>
                  <div className="orbit-node third">
                    <Avatar run={{ runtime: "pi", name: "pi" }} />
                    <span>pi agent</span>
                  </div>
                </div>
                <h2>把下一段工作，接起来。</h2>
                <p>
                  创建项目，让不同工具与它们的子 agent
                  <br />
                  共享任务、清楚分工、随时接手。
                </p>
                <div className="welcome-actions">
                  <Button
                    variant="primary"
                    icon={Plus}
                    onClick={() => setModal({ kind: "project" })}
                  >
                    创建第一个项目
                  </Button>
                  <Button icon={Layers3} onClick={createExample}>
                    载入示例
                  </Button>
                </div>
                <div className="welcome-foot">
                  <ShieldCheck size={15} /> 数据保存在本机 · 示例不会启动 AI
                  进程
                </div>
              </div>
            )
          ) : (
            <>
              {view === "home" && (
                <AttentionView
                  data={data}
                  currentRun={currentRun}
                  resolveRequest={(message) =>
                    setModal({ kind: "resolveMessage", message })
                  }
                  openTask={openTask}
                  openBoard={() => setView("board")}
                  openDiscussions={() => setView("discussions")}
                  openJoin={() => setView("join")}
                />
              )}
              {["board", "join"].includes(view) && (
                <>
                  <div className="project-brief">
                    <span className="brief-icon">
                      <FolderGit2 size={20} />
                    </span>
                    <div>
                      <strong>{project.name}</strong>
                      <p title={project.objective}>{project.objective}</p>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => setView("settings")}
                    >
                      项目约定 <ArrowUpRight size={14} />
                    </button>
                  </div>
                  <div className="workspace-summary">
                    <span>
                      <span className="summary-number">{leaves.length}</span>{" "}
                      执行任务
                    </span>
                    <span>
                      <span className="summary-number">
                        {leaves.filter((t) => t.status === "doing").length}
                      </span>{" "}
                      进行中
                    </span>
                    <span>
                      <span className="summary-number">{done}</span> 已验收
                    </span>
                    <Progress
                      value={leaves.length ? (done / leaves.length) * 100 : 0}
                      className="summary-progress"
                      aria-label="执行任务验收进度"
                    />
                    <span className="summary-attention">
                      <AlertCircle size={14} />
                      {tasks.filter((t) =>
                        ["blocked", "reconcile"].includes(t.status),
                      ).length + pendingCount}{" "}
                      项需要关注
                    </span>
                  </div>
                </>
              )}
              {["board", "join"].includes(view) && (
                <div className="workspace-toolbar">
                  <div className="view-toggle">
                    {view === "board" ? (
                      <ToggleGroup
                        value={[treeView ? "tree" : "board"]}
                        onValueChange={(v) =>
                          v.length && setTreeView(v[0] === "tree")
                        }
                        size="sm"
                        variant="outline"
                        spacing={0}
                        aria-label="任务显示方式"
                      >
                        <ToggleGroupItem value="board">
                          <LayoutDashboard data-icon="inline-start" />
                          看板
                        </ToggleGroupItem>
                        <ToggleGroupItem value="tree">
                          <ListTree data-icon="inline-start" />
                          任务树
                        </ToggleGroupItem>
                      </ToggleGroup>
                    ) : (
                      <span className="toolbar-label">
                        <ArrowUpRight size={16} />
                        可参与的工作
                      </span>
                    )}
                  </div>
                  <div className="toolbar-controls">
                    <InputGroup className="search">
                      <InputGroupInput
                        aria-label="搜索任务"
                        placeholder="搜索任务或范围…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                      <InputGroupAddon>
                        <Search />
                      </InputGroupAddon>
                    </InputGroup>
                    <NativeSelect
                      aria-label="执行者视角"
                      className="run-selector"
                      value={currentRun?.id || ""}
                      onChange={(e) => setRunId(e.target.value)}
                    >
                      <option value="">人工管理视角</option>
                      {runs
                        .filter((r) => r.status === "active")
                        .map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name} · {runtimeNames[r.runtime]}
                          </option>
                        ))}
                    </NativeSelect>
                    {view === "board" && (
                      <Select
                        items={[
                          { value: "all", label: "全部任务" },
                          { value: "leaf", label: "执行任务" },
                          { value: "mine", label: "当前执行者" },
                        ]}
                        value={filter}
                        onValueChange={(value) => setFilter(value || "all")}
                      >
                        <SelectTrigger aria-label="筛选任务">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem value="all">全部任务</SelectItem>
                            <SelectItem value="leaf">执行任务</SelectItem>
                            <SelectItem value="mine">当前执行者</SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                </div>
              )}
              {view === "board" &&
                (tasks.length ? (
                  treeView ? (
                    <div className="tree-table">
                      <div className="tree-table-head">
                        <span>任务与层级</span>
                        <span>状态</span>
                        <span>负责人</span>
                        <span>修改范围</span>
                      </div>
                      {tasks
                        .filter((t) => !t.parent_id)
                        .map((t) => (
                          <TaskRow
                            key={t.id}
                            task={t}
                            tasks={tasks}
                            runs={runs}
                            open={openTask}
                            matches={matches}
                          />
                        ))}
                    </div>
                  ) : (
                    <div className="board">
                      {(
                        [
                          ["pending", "待领取", Circle],
                          ["doing", "进行中", CircleDot],
                          ["reconcile", "待核验", ArrowLeftRight],
                          ["review", "待验收", ShieldCheck],
                          ["done", "已完成", CheckCircle2],
                        ] as const
                      ).map(([status, label, Icon]) => {
                        const column = tasks.filter(
                          (t) =>
                            matches(t) &&
                            (status === "doing"
                              ? ["doing", "blocked"].includes(t.status)
                              : t.status === status),
                        );
                        return (
                          <section
                            className={`column column-${status}`}
                            key={status}
                          >
                            <div className="column-title">
                              <Icon size={16} />
                              <h2>{label}</h2>
                              <span>{column.length}</span>
                              <button
                                aria-label={`在${label}列创建任务`}
                                onClick={() => setModal({ kind: "task" })}
                              >
                                <Plus size={15} />
                              </button>
                            </div>
                            <div className="column-cards">
                              {column.map((t) => (
                                <TaskCard
                                  key={t.id}
                                  task={t}
                                  tasks={tasks}
                                  runs={runs}
                                  onClick={() => openTask(t)}
                                />
                              ))}
                              {!column.length && (
                                <div className="column-empty">
                                  {status === "pending"
                                    ? "新的工作从这里开始"
                                    : status === "done"
                                      ? "通过验收的成果留在这里"
                                      : "暂无任务"}
                                </div>
                              )}
                            </div>
                          </section>
                        );
                      })}
                    </div>
                  )
                ) : (
                  <Empty
                    title="把目标拆成第一份工作"
                    action={
                      <Button
                        icon={Plus}
                        variant="primary"
                        onClick={() => setModal({ kind: "task" })}
                      >
                        新建任务
                      </Button>
                    }
                  >
                    写清验收标准和修改范围，其他执行者就能加入。
                  </Empty>
                ))}
              {view === "join" &&
                (!currentRun ? (
                  <Empty
                    icon={Users}
                    title="选择一个执行者，查看可领取的工作"
                    action={
                      <Button
                        icon={Plus}
                        variant="primary"
                        onClick={() => setModal({ kind: "agent" })}
                      >
                        登记执行者
                      </Button>
                    }
                  >
                    在上方选择已有会话，或先登记新会话。登记本身不会启动进程。
                  </Empty>
                ) : (
                  <div className="eligibility-list">
                    {["ready", "negotiate", "waiting"].map((category) => {
                      const items = eligible.filter(
                        (e) => e.category === category && matches(e.task),
                      );
                      return (
                        <section className="eligibility-group" key={category}>
                          <div className="group-heading">
                            <span className={`group-dot ${category}`} />
                            <h2>
                              {
                                {
                                  ready: "可以直接领取",
                                  negotiate: "可以协商拆分",
                                  waiting: "等待条件满足",
                                }[category]
                              }
                            </h2>
                            <span>{items.length}</span>
                          </div>
                          {items.map((item) => (
                            <div
                              className={`eligibility-card ${category}`}
                              key={item.task_id}
                            >
                              <div className="eligibility-main">
                                <span className="task-id">
                                  {item.task.short_id}
                                </span>
                                <button
                                  className="title-button"
                                  onClick={() => openTask(item.task)}
                                >
                                  {item.task.title}
                                </button>
                                <p>
                                  {item.eligible
                                    ? "依赖已满足，当前没有已知的范围冲突。"
                                    : item.reasons.join("；")}
                                </p>
                                {item.warnings.map((w) => (
                                  <small key={w}>
                                    <AlertCircle size={12} />
                                    {w}
                                  </small>
                                ))}
                              </div>
                              <div className="eligibility-scopes">
                                {item.task.scopes.slice(0, 2).map((s) => (
                                  <code key={s}>{s}</code>
                                ))}
                                {item.task.read_only && (
                                  <span className="muted">只读任务</span>
                                )}
                              </div>
                              {item.eligible ? (
                                <Button
                                  icon={ArrowUpRight}
                                  variant="primary"
                                  onClick={() => claim(item.task)}
                                >
                                  领取任务
                                </Button>
                              ) : category === "negotiate" &&
                                item.task.owner_run_id !== currentRun.id ? (
                                <Button
                                  icon={GitBranch}
                                  onClick={() =>
                                    setModal({
                                      kind: "split",
                                      task: item.task,
                                      proposal: true,
                                    })
                                  }
                                >
                                  提出拆分
                                </Button>
                              ) : (
                                <Button onClick={() => openTask(item.task)}>
                                  查看任务
                                </Button>
                              )}
                            </div>
                          ))}
                          {!items.length && (
                            <p className="group-empty">
                              {category === "ready"
                                ? "暂时没有符合条件的任务，可查看其他工作或创建子任务。"
                                : "暂无此类任务"}
                            </p>
                          )}
                        </section>
                      );
                    })}
                  </div>
                ))}
              {view === "agents" && (
                <AgentView
                  data={data}
                  setRunId={setRunId}
                  setView={setView}
                  setModal={setModal}
                  act={act}
                  api={api}
                  refresh={refresh}
                  notify={notify}
                />
              )}
              {view === "scopes" && (
                <ScopeView data={data} openTask={openTask} />
              )}
              {view === "discussions" && (
                <DiscussionView
                  data={data}
                  runId={runId}
                  setRunId={setRunId}
                  setModal={setModal}
                  mutate={mutate}
                  act={act}
                  openTask={openTask}
                />
              )}
              {view === "activity" && (
                <ActivityView data={data} openTask={openTask} />
              )}
              {view === "settings" && (
                <SettingsView
                  project={project}
                  setModal={setModal}
                  act={act}
                  notify={notify}
                />
              )}
              <div className="page-footer">
                <span>
                  <GitBranch size={13} /> 所有层级共享任务状态，按需读取上下文
                </span>
                <span>
                  {tasks.filter((t) => t.mode === "coordinator").length}{" "}
                  个协调任务 · 并发预算 {project.max_concurrency}
                </span>
              </div>
            </>
          )}
        </div>
      </main>
      {task && data && (
        <TaskDrawer
          task={task}
          data={data}
          currentRun={currentRun}
          close={() => setSelectedTask(null)}
          setModal={setModal}
          claim={claim}
          mutate={mutate}
          act={act}
          context={context}
          launch={launch}
          openTask={openTask}
        />
      )}
      {modal && (
        <Modal
          key={`${modal.kind}-${modal.task?.id || ""}`}
          modal={modal}
          close={() => setModal(null)}
          project={project}
          data={data}
          currentRun={currentRun}
          mutate={mutate}
          notify={notify}
          handleError={handleError}
          setProjectId={setProjectId}
          setRunId={setRunId}
          setModal={setModal}
          refresh={refresh}
        />
      )}
    </SidebarProvider>
  );
}

function TaskCard({
  task: t,
  tasks,
  runs,
  onClick,
}: {
  task: Task;
  tasks: Task[];
  runs: Run[];
  onClick: () => void;
}) {
  const owner = runs.find((r) => r.id === t.owner_run_id),
    children = tasks.filter((c) => c.parent_id === t.id),
    parent = tasks.find((p) => p.id === t.parent_id),
    blocked = t.depends_on.filter(
      (id) => tasks.find((d) => d.id === id)?.status !== "done",
    );
  return (
    <button
      className={`task-card ${t.status === "blocked" ? "is-blocked" : ""}`}
      onClick={onClick}
    >
      <div className="card-top">
        <span className="task-id">{t.short_id}</span>
        {t.mode === "coordinator" ? (
          <span className="coordinator-label">
            <GitBranch size={11} />
            协调
          </span>
        ) : t.priority === "high" ? (
          <span className="priority-high">优先</span>
        ) : (
          <MoreHorizontal size={15} className="card-dots" />
        )}
      </div>
      {parent && (
        <div className="parent-label">
          <Corner />
          {parent.title}
        </div>
      )}
      <h3>{t.title}</h3>
      {t.checkpoint ? (
        <p className="card-description">{t.checkpoint.summary}</p>
      ) : (
        t.description && <p className="card-description">{t.description}</p>
      )}
      <div className="card-tags">
        {t.read_only ? (
          <span className="scope-tag">
            <FileText size={11} />
            只读
          </span>
        ) : (
          t.scopes.slice(0, 2).map((s) => (
            <span className="scope-tag" key={s}>
              {s}
            </span>
          ))
        )}
        {t.resources.length > 0 && (
          <span className="resource-tag">
            <LockKeyhole size={11} />
            {t.resources.length}
          </span>
        )}
      </div>
      {children.length > 0 && (
        <div className="child-progress">
          <ListTree size={13} />
          <span>子任务</span>
          <div>
            <i
              style={{
                width: `${(children.filter((c) => c.status === "done").length / children.length) * 100}%`,
              }}
            />
          </div>
          <b>
            {children.filter((c) => c.status === "done").length}/
            {children.length}
          </b>
        </div>
      )}
      {t.status === "blocked" && (
        <div className="card-blocker">
          <AlertCircle size={12} />
          {t.checkpoint?.blocker}
        </div>
      )}
      {blocked.length > 0 && t.status === "pending" && (
        <div className="dependency-label">
          <Link2 size={12} />
          等待 {blocked.length} 项依赖验收
        </div>
      )}
      <div className="card-bottom">
        <span>
          <Avatar run={owner} small />
          {owner?.name || "待领取"}
        </span>
        <small>{t.checkpoint ? relative(t.checkpoint.at) : "尚无检查点"}</small>
      </div>
    </button>
  );
}
const Corner = () => <span className="corner-mark">└</span>;

function TaskRow({
  task,
  tasks,
  runs,
  open,
  matches,
  depth = 0,
}: {
  task: Task;
  tasks: Task[];
  runs: Run[];
  open: OpenTask;
  matches: (task: Task) => boolean;
  depth?: number;
}) {
  const children = tasks.filter((t) => t.parent_id === task.id),
    owner = runs.find((r) => r.id === task.owner_run_id),
    visible = matches(task);
  return (
    <>
      {visible && (
        <button className="tree-row" onClick={() => open(task)}>
          <span className="tree-title" style={{ paddingLeft: depth * 24 }}>
            <span className="task-id">{task.short_id}</span>
            {children.length ? <GitBranch size={15} /> : <Circle size={13} />}
            <strong>{task.title}</strong>
            {task.mode === "coordinator" && <small>协调</small>}
          </span>
          <span>
            <Badge status={task.status} />
          </span>
          <span className="tree-owner">
            <Avatar run={owner} small />
            {owner?.name || "待领取"}
          </span>
          <span>
            <code>{task.scopes.join(", ") || "只读"}</code>
          </span>
        </button>
      )}
      {children.map((t) => (
        <TaskRow
          key={t.id}
          task={t}
          tasks={tasks}
          runs={runs}
          open={open}
          matches={matches}
          depth={depth + 1}
        />
      ))}
    </>
  );
}

function AgentView({
  data,
  setRunId,
  setView,
  setModal,
  act,
  api,
  refresh,
  notify,
}: {
  data: Snapshot;
  setRunId: (id: string) => void;
  setView: (view: string) => void;
  setModal: SetModal;
  act: Act;
  api: Api;
  refresh: () => Promise<void>;
  notify: Notify;
}) {
  const { runs, tasks, project } = data;
  const node = (run: Run, depth = 0): React.ReactNode => {
    const owned = tasks.filter(
        (t) => t.owner_run_id === run.id && t.status !== "done",
      ),
      children = runs.filter((r) => r.parent_run_id === run.id);
    return (
      <React.Fragment key={run.id}>
        <div
          className="agent-node"
          style={{ "--depth": depth } as React.CSSProperties}
        >
          <div className="agent-identity">
            <Avatar run={run} />
            <div>
              <strong>{run.name}</strong>
              <span>
                {runtimeNames[run.runtime]} ·{" "}
                {run.parent_run_id ? "子执行者" : "主执行者"}
              </span>
            </div>
            <span
              className={`liveness ${run.liveness === "reported" ? "reported" : ""}`}
            >
              <span />
              {run.process?.status === "running"
                ? "托管进程运行中"
                : run.process?.status === "failed"
                  ? "进程执行失败"
                  : ["exited", "stopped"].includes(run.process?.status || "")
                    ? "托管进程已退出"
                    : run.status === "ended"
                      ? "会话结束"
                      : run.status === "unknown" ||
                          run.liveness === "unconfirmed"
                        ? "状态待核实"
                        : "已登记"}
            </span>
          </div>
          <div className="agent-details">
            <div>
              <span>活动任务</span>
              <strong>{owned.length} 个</strong>
            </div>
            <div>
              <span>最近进度</span>
              <strong>{relative(run.last_progress_at)}</strong>
            </div>
            <div>
              <span>状态来源</span>
              <strong>
                {
                  {
                    self: "执行者自报",
                    parent: "父执行者转报",
                    adapter: "运行适配器",
                    manual: "人工登记",
                  }[run.observation]
                }
              </strong>
            </div>
          </div>
          {run.workdir && (
            <div className="agent-workdir">
              <FolderGit2 size={13} />
              <code>{run.workdir}</code>
              {run.branch && <span>{run.branch}</span>}
            </div>
          )}
          <div className="agent-actions">
            <Button
              icon={ArrowUpRight}
              onClick={() => {
                setRunId(run.id);
                setView("join");
              }}
            >
              查看可领取工作
            </Button>
            <Button
              icon={Plus}
              disabled={run.status !== "active"}
              onClick={() => setModal({ kind: "agent", parent: run })}
            >
              登记子 agent
            </Button>
            {owned.length > 0 &&
              ["codex", "claude", "pi"].includes(run.runtime) && (
                <Button
                  icon={Play}
                  disabled={
                    run.status !== "active" || run.process?.status === "running"
                  }
                  onClick={() => setModal({ kind: "launch", run })}
                >
                  启动执行
                </Button>
              )}
            {run.process?.status === "running" && (
              <Button
                icon={Square}
                onClick={() =>
                  act(async () => {
                    await api("/runner/stop", { run_id: run.id });
                    await refresh();
                    notify("已请求停止，等待进程退出后再交接");
                  })
                }
              >
                停止
              </Button>
            )}
            {run.process && (
              <Button
                icon={Terminal}
                onClick={() => setModal({ kind: "logs", run })}
              >
                运行日志
              </Button>
            )}
            <Button onClick={() => setModal({ kind: "runEnd", run })}>
              更新状态
            </Button>
            {["codex", "claude", "pi"].includes(run.runtime) && (
              <Button
                icon={Waypoints}
                onClick={() => setModal({ kind: "dispatch", run })}
              >
                {run.dispatch?.enabled ? "管理自动执行" : "自动接任务"}
              </Button>
            )}
          </div>
          <div className="agent-run-id">
            {run.id}
            <span>委派范围：{run.delegated_scopes.join(", ") || "只读"}</span>
          </div>
          {run.dispatch && (
            <p className="dispatch-state">
              自动执行：{run.dispatch.enabled ? "已启用" : "已关闭"} · 已启动{" "}
              {run.dispatch.launches}/{run.dispatch.max_launches} 次
              {run.dispatch.last_error && ` · ${run.dispatch.last_error}`}
            </p>
          )}
        </div>
        {children.map((r) => node(r, depth + 1))}
      </React.Fragment>
    );
  };
  return (
    <>
      <div className="info-banner">
        <ListTree size={19} />
        <p>
          <strong>先登记，再派发。</strong> 原生子 agent 也需要独立 Run
          和任务归属。心跳代表最近的状态报告，任务进度以检查点为准。
        </p>
        <span>最多 {project.max_depth} 层</span>
      </div>
      {runs.length ? (
        <div className="agent-tree">
          {runs.filter((r) => !r.parent_run_id).map((r) => node(r))}
        </div>
      ) : (
        <Empty
          icon={Users}
          title="让第一个执行者加入"
          action={
            <Button
              variant="primary"
              icon={Plus}
              onClick={() => setModal({ kind: "agent" })}
            >
              登记执行者
            </Button>
          }
        >
          可以登记 Codex、Claude Code、pi agent，以及它们的原生子 agent。
        </Empty>
      )}
    </>
  );
}

function ScopeView({ data, openTask }: ViewProps) {
  const active = data.tasks.filter(
    (t) =>
      t.mode === "execute" &&
      !t.read_only &&
      ["doing", "blocked", "review", "reconcile"].includes(t.status),
  );
  return (
    <>
      <div className="info-banner">
        <ShieldCheck size={19} />
        <p>
          领取时检查重叠范围与共享资源。独立 worktree
          隔离文件修改；公共接口和数据库迁移仍需协调。
        </p>
      </div>
      {active.length ? (
        <div className="scope-table">
          <div className="scope-head">
            <span>任务</span>
            <span>执行者 / 目录</span>
            <span>修改范围</span>
            <span>独占资源</span>
          </div>
          {active.map((t) => {
            const r = data.runs.find((r) => r.id === t.owner_run_id);
            return (
              <button
                className="scope-row"
                key={t.id}
                onClick={() => openTask(t)}
              >
                <span>
                  <small className="task-id">{t.short_id}</small>
                  <strong>{t.title}</strong>
                  <Badge status={t.status} />
                </span>
                <span>
                  <strong>{r?.name}</strong>
                  <code>{r?.workdir || "未登记目录，按共享工作区检查"}</code>
                </span>
                <span>
                  {t.scopes.map((s) => (
                    <code key={s}>{s}</code>
                  ))}
                </span>
                <span>
                  {t.resources.map((s) => (
                    <code className="resource-code" key={s}>
                      <LockKeyhole size={11} />
                      {s}
                    </code>
                  ))}
                  {!t.resources.length && "—"}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <Empty icon={LockKeyhole} title="当前没有占用中的写入范围">
          任务被领取后，对应的修改范围和共享资源会显示在这里。
        </Empty>
      )}
      <p className="fine-print">
        范围登记属于协作约束，不是文件系统沙箱。执行者需要遵守工作约定；实际写入隔离使用独立
        worktree。
      </p>
    </>
  );
}

function DiscussionView({
  data,
  runId,
  setRunId,
  setModal,
  mutate,
  act,
  openTask,
}: ViewProps & {
  runId: string;
  setRunId: (id: string) => void;
  setModal: SetModal;
  mutate: Command;
  act: Act;
}) {
  const [tab, setTab] = useState("messages");
  const messages = data.messages.filter(
    (m) =>
      !runId ||
      m.to_run_id === runId ||
      m.from_run_id === runId ||
      !m.to_run_id,
  );
  return (
    <>
      <div className="discussion-toolbar">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList variant="line">
            <TabsTrigger value="messages">
              任务消息 <UiBadge variant="secondary">{messages.length}</UiBadge>
            </TabsTrigger>
            <TabsTrigger value="decisions">
              已确认决定{" "}
              <UiBadge variant="secondary">{data.decisions.length}</UiBadge>
            </TabsTrigger>
            <TabsTrigger value="proposals">
              分工提议{" "}
              <UiBadge variant="secondary">
                {data.proposals.filter((p) => p.status === "pending").length}
              </UiBadge>
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Button
          icon={tab === "decisions" ? Plus : Send}
          onClick={() =>
            setModal({ kind: tab === "decisions" ? "decision" : "message" })
          }
        >
          {tab === "decisions" ? "记录决定" : "发送消息"}
        </Button>
      </div>
      <div className="info-banner subtle">
        <Inbox size={17} />
        <p>
          消息持久保存。外部会话需要主动读取收件箱；仅发送消息不会自动唤醒一个窗口。
        </p>
        <NativeSelect
          aria-label="消息执行者筛选"
          value={runId}
          onChange={(e) => setRunId(e.target.value)}
        >
          <option value="">全部消息</option>
          {data.runs.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      {tab === "messages" ? (
        <div className="message-list">
          {messages
            .slice()
            .reverse()
            .map((m) => {
              const from = data.runs.find((r) => r.id === m.from_run_id),
                to = data.runs.find((r) => r.id === m.to_run_id),
                t = data.tasks.find((t) => t.id === m.task_id);
              return (
                <article className="message-card" key={m.id}>
                  <Avatar run={from} />
                  <div className="message-content">
                    <div className="message-heading">
                      <strong>
                        {from?.name || (m.system ? "Relayboard" : "人工管理")}
                      </strong>
                      <ArrowRight size={12} />
                      <span>{to?.name || "项目讨论"}</span>
                      <small>{time(m.created_at)}</small>
                    </div>
                    <span className={`message-kind ${m.kind}`}>
                      {
                        {
                          discussion: "讨论",
                          request: "协作请求",
                          blocker: "阻塞",
                          delivery: "交付",
                          review: "请求审查",
                        }[m.kind]
                      }
                    </span>
                    <p>{m.body}</p>
                    <RequestResolution
                      message={m}
                      currentRun={data.runs.find((run) => run.id === runId)}
                      tasks={data.tasks}
                      onResolve={(message) =>
                        setModal({ kind: "resolveMessage", message })
                      }
                    />
                    <div className="message-bottom">
                      {t && (
                        <button
                          className="text-button"
                          onClick={() => openTask(t)}
                        >
                          {t.short_id} {t.title}
                          <ArrowUpRight size={12} />
                        </button>
                      )}
                      {m.to_run_id === runId && !m.acknowledged_at ? (
                        <Button
                          icon={Check}
                          onClick={() =>
                            act(() =>
                              mutate(
                                "message_ack",
                                { message_id: m.id, run_id: runId },
                                "已确认收到消息",
                              ),
                            )
                          }
                        >
                          确认收到
                        </Button>
                      ) : (
                        m.acknowledged_at && (
                          <span className="ack">
                            <Check size={12} />
                            已收到
                          </span>
                        )
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          {!messages.length && (
            <Empty icon={MessageSquare} title="从任务里的第一个问题开始">
              交流接口、提出分工、报告阻塞。达成共识后，把结论保存为决定。
            </Empty>
          )}
        </div>
      ) : tab === "decisions" ? (
        <div className="decision-list">
          {data.decisions
            .slice()
            .reverse()
            .map((d) => (
              <article className="decision-card" key={d.id}>
                <span className="decision-icon">
                  <CheckCircle2 size={19} />
                </span>
                <div>
                  <span className="eyebrow">
                    DECISION · {time(d.created_at)}
                  </span>
                  <h3>{d.title}</h3>
                  <p>{d.body}</p>
                  <div className="decision-tasks">
                    {d.task_ids.map((id) => {
                      const t = data.tasks.find((t) => t.id === id);
                      return (
                        t && (
                          <button
                            className="scope-tag"
                            key={id}
                            onClick={() => openTask(t)}
                          >
                            {t.short_id} {t.title}
                          </button>
                        )
                      );
                    })}
                  </div>
                </div>
              </article>
            ))}
          {!data.decisions.length && (
            <Empty
              icon={FileText}
              title="把共识留给下一个接手者"
              action={
                <Button
                  icon={Plus}
                  onClick={() => setModal({ kind: "decision" })}
                >
                  记录决定
                </Button>
              }
            >
              保存方案理由、接口约定和已排除的路线。
            </Empty>
          )}
        </div>
      ) : (
        <div className="proposal-list">
          {data.proposals
            .slice()
            .reverse()
            .map((p) => (
              <article className="proposal-card" key={p.id}>
                <div>
                  <span className={`proposal-status ${p.status}`}>
                    {
                      {
                        pending: "待处理",
                        approved: "已通过",
                        declined: "已拒绝",
                      }[p.status]
                    }
                  </span>
                  <h3>
                    {p.type === "split" ? "任务拆分提议" : "修改范围申请"}
                  </h3>
                  <p>{p.rationale}</p>
                  <code>
                    {p.type === "scope"
                      ? p.scopes.join(", ")
                      : p.children.map((c) => c.title).join(" / ")}
                  </code>
                  {p.resolution && (
                    <p className="muted">处理意见：{p.resolution}</p>
                  )}
                </div>
                <Button
                  onClick={() =>
                    openTask(data.tasks.find((t) => t.id === p.task_id))
                  }
                >
                  查看任务
                </Button>
              </article>
            ))}
          {!data.proposals.length && (
            <Empty icon={GitBranch} title="暂无协作申请">
              执行者可以提出拆分，或申请扩大当前修改范围。
            </Empty>
          )}
        </div>
      )}
    </>
  );
}

function ActivityView({ data, openTask }: ViewProps) {
  return (
    <div className="timeline">
      {data.events
        .slice()
        .reverse()
        .map((e) => {
          const t = data.tasks.find((t) => t.id === e.task_id),
            run = data.runs.find((r) => r.id === e.run_id);
          return (
            <div className="timeline-event" key={e.id}>
              <div
                className={`timeline-marker ${e.type.includes("accepted") ? "success" : ""}`}
              >
                {e.type === "message.sent" ? (
                  <MessageSquare size={14} />
                ) : e.type.includes("handoff") ? (
                  <ArrowLeftRight size={14} />
                ) : (
                  <CircleDot size={14} />
                )}
              </div>
              <div className="timeline-content">
                <div>
                  <strong>{eventNames[e.type] || e.type}</strong>
                  {run && <span>{run.name}</span>}
                  <time>{time(e.at)}</time>
                </div>
                <p>{e.summary}</p>
                {t && (
                  <button className="text-button" onClick={() => openTask(t)}>
                    {t.short_id} {t.title}
                    <ArrowUpRight size={12} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      <p className="fine-print">
        显示最近 80 条活动。更早记录保存在数据库，可通过 events 查询按序列读取。
      </p>
    </div>
  );
}

function SkillsView({
  notify,
  handleError,
}: {
  notify: Notify;
  handleError: HandleError;
}) {
  const [skills, setSkills] = useState<Skill[] | null>(null),
    [selected, setSelected] = useState<SkillSource | null>(null),
    [skillOpen, setSkillOpen] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    api("/skills", null, "GET")
      .then(setSkills)
      .catch((e) => setError(e.message));
  }, []);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify("已复制");
    } catch (e) {
      handleError(e);
    }
  };
  const inspect = async (skill: Skill) => {
    try {
      setSelected(await api(`/skills/${skill.name}`, null, "GET"));
      setSkillOpen(true);
    } catch (e) {
      handleError(e);
    }
  };
  return (
    <div className="skills-view">
      <Alert>
        <BookOpen />
        <AlertDescription>
          共享任务状态由 MCP 服务保存；Skill
          告诉每个执行者如何使用它。按当前角色加载所需流程，减少重复上下文。
        </AlertDescription>
      </Alert>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="skills-grid">
        {skills
          ? skills.map((skill) => (
              <Card key={skill.name}>
                <CardHeader>
                  <div className="skill-meta">
                    <BookOpen />
                    <UiBadge variant="secondary">{skill.role}</UiBadge>
                  </div>
                  <CardTitle>{skill.title}</CardTitle>
                  <CardDescription>{skill.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <code className="skill-name">{skill.name}</code>
                </CardContent>
                <CardFooter className="gap-2">
                  <Button onClick={() => inspect(skill)} icon={FileText}>
                    阅读流程
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => copy(`使用 $${skill.name}：${skill.prompt}`)}
                    icon={Copy}
                  >
                    复制调用
                  </Button>
                </CardFooter>
              </Card>
            ))
          : Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-52 w-full" />
            ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>接入你的工具</CardTitle>
          <CardDescription>
            把需要的 Skill 目录放进工具的技能目录，并连接同一个 Relayboard
            服务。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="skill-install">
            <span>Codex</span>
            <code>~/.codex/skills/&lt;skill-name&gt;/SKILL.md</code>
            <span>Claude Code</span>
            <code>~/.claude/skills/&lt;skill-name&gt;/SKILL.md</code>
            <span>pi agent</span>
            <code>~/.pi/agent/skills/&lt;skill-name&gt;/SKILL.md</code>
          </div>
          <p className="fine-print">
            也可以让执行者直接读取下方流程文件。子 agent 使用自己的 Run
            和任务身份，父执行者转报时保留消息来源。
          </p>
        </CardContent>
      </Card>
      <Dialog open={skillOpen} onOpenChange={setSkillOpen}>
        <DialogContent className="skill-dialog">
          <DialogTitle>{selected?.title}</DialogTitle>
          <DialogDescription>{selected?.description}</DialogDescription>
          <pre className="skill-source">{selected?.content}</pre>
          <div className="skill-dialog-actions">
            <Button
              icon={Copy}
              onClick={() =>
                copy(skills?.find((s) => s.name === selected?.name)?.path || "")
              }
            >
              复制文件路径
            </Button>
            <Button
              variant="primary"
              icon={Copy}
              onClick={() => copy(selected?.content || "")}
            >
              复制完整 Skill
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SettingsView({
  project,
  setModal,
  act,
  notify,
}: {
  project: Project;
  setModal: SetModal;
  act: Act;
  notify: Notify;
}) {
  const [integration, setIntegration] = useState<Integration | null>(null),
    [runtimes, setRuntimes] = useState<RuntimeInfo[]>([]),
    [tab, setTab] = useState("http");
  useEffect(() => {
    api("/integration", null, "GET")
      .then(setIntegration)
      .catch((e) => notify(e.message, true));
    api("/runtimes", null, "GET")
      .then(setRuntimes)
      .catch((e) => notify(e.message, true));
  }, []);
  const stdio =
    integration &&
    JSON.stringify(
      {
        mcpServers: {
          relayboard: {
            command: integration.node,
            args: integration.mcp_args || [integration.mcp],
            env: {
              RELAYBOARD_URL: integration.base_url,
              ...(integration.token_required
                ? { RELAYBOARD_TOKEN: "<服务令牌>" }
                : {}),
            },
          },
        },
      },
      null,
      2,
    );
  const http =
    integration &&
    `[mcp_servers.relayboard]\nurl = "${integration.base_url}/mcp"${integration.token_required ? '\nbearer_token_env_var = "RELAYBOARD_TOKEN"' : ""}`;
  const snippet = tab === "http" ? http : stdio;
  return (
    <div className="settings-grid">
      <section className="settings-card">
        <div className="section-heading">
          <h2>项目约定</h2>
          <Button
            icon={Settings2}
            onClick={() => setModal({ kind: "project", project })}
          >
            编辑
          </Button>
        </div>
        <dl>
          <dt>项目目标</dt>
          <dd>{project.objective}</dd>
          <dt>用户约束</dt>
          <dd>{project.constraints || "尚未添加"}</dd>
          <dt>代码目录</dt>
          <dd>
            <code>
              {project.root_path || "未设置；启动执行前需要设置实际目录"}
            </code>
          </dd>
          <dt>执行预算</dt>
          <dd>
            同时 {project.max_concurrency} 个执行会话 · 子执行者最多{" "}
            {project.max_depth} 层
          </dd>
        </dl>
        <Button
          icon={FolderGit2}
          onClick={() => setModal({ kind: "worktree" })}
        >
          创建独立 worktree
        </Button>
      </section>
      <section className="settings-card">
        <div className="section-heading">
          <h2>本机运行工具</h2>
          <Terminal size={18} />
        </div>
        {runtimes.length ? (
          runtimes.map((r) => (
            <div className="runtime-row" key={r.runtime}>
              <Avatar run={{ runtime: r.runtime, name: r.runtime }} />
              <div>
                <strong>{runtimeNames[r.runtime]}</strong>
                <small>
                  {r.available ? r.version : "未在服务的 PATH 中找到"}
                </small>
              </div>
              <span className={r.available ? "available" : "muted"}>
                {r.available ? "可启动" : "未安装"}
              </span>
            </div>
          ))
        ) : (
          <p className="muted">正在检查 CLI…</p>
        )}
        <p className="fine-print">
          使用各工具已有的登录与权限配置。登记会话不启动进程；启动按钮才会发起实际执行。
        </p>
      </section>
      <section className="settings-card integration-card">
        <div className="section-heading">
          <div>
            <h2>连接 MCP</h2>
            <p>所有工具连接同一个后台，共享任务与消息。</p>
          </div>
          <Button
            icon={Copy}
            disabled={!snippet}
            onClick={() =>
              act(async () => {
                await navigator.clipboard.writeText(snippet || "");
                notify("接入配置已复制");
              })
            }
          >
            复制配置
          </Button>
        </div>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="http">Codex · HTTP</TabsTrigger>
            <TabsTrigger value="stdio">通用 · stdio</TabsTrigger>
          </TabsList>
          <TabsContent value={tab}>
            <pre>{snippet || "读取配置中…"}</pre>
          </TabsContent>
        </Tabs>
        <div className="integration-notes">
          <p>
            <strong>Claude Code：</strong>使用 stdio 配置中的命令和参数添加 MCP
            服务，或参考项目 integrations 文档。
          </p>
          <p>
            <strong>pi agent：</strong>版本支持 MCP
            时直接接入；也可通过随附扩展或 CLI 连接。
          </p>
          <p>
            <strong>协作规范：</strong>为各工具加载{" "}
            <code>{integration?.skill || "skills/task-continuity"}</code>，子
            agent 同样遵守登记、领取和报告约定。
          </p>
        </div>
      </section>
    </div>
  );
}

function TaskDrawer({
  task: t,
  data,
  currentRun,
  close,
  setModal,
  claim,
  mutate,
  act,
  context,
  launch,
  openTask,
}: ViewProps & {
  task: Task;
  currentRun?: Run;
  close: () => void;
  setModal: SetModal;
  claim: (task: Task) => Promise<void>;
  mutate: Command;
  act: Act;
  context: (task: Task) => Promise<void>;
  launch: (run: Run, task: Task) => Promise<void>;
}) {
  const owner = data.runs.find((r) => r.id === t.owner_run_id),
    children = data.tasks.filter((c) => c.parent_id === t.id),
    parent = data.tasks.find((p) => p.id === t.parent_id),
    mine = owner && currentRun?.id === owner.id;
  const messages = data.messages.filter((m) => m.task_id === t.id).slice(-4),
    proposals = data.proposals.filter(
      (p) => p.task_id === t.id && p.status === "pending",
    );
  return (
    <Sheet open onOpenChange={(open) => !open && close()}>
      <SheetContent className="task-drawer" showCloseButton={false}>
        <SheetTitle className="sr-only">任务详情 {t.title}</SheetTitle>
        <div className="drawer-top">
          <span className="task-id">
            {t.short_id} <span>· v{t.version}</span>
          </span>
          <div>
            <button
              className="icon-button"
              aria-label="查看接手包"
              onClick={() => act(() => context(t))}
            >
              <FileText size={17} />
            </button>
            <button
              className="icon-button"
              aria-label="关闭任务详情"
              onClick={close}
            >
              <X size={21} />
            </button>
          </div>
        </div>
        <div className="drawer-body">
          {parent && (
            <button className="parent-link" onClick={() => openTask(parent)}>
              <GitBranch size={14} />
              {parent.short_id} {parent.title}
              <ChevronRight size={13} />
            </button>
          )}
          <h2>{t.title}</h2>
          <div className="drawer-badges">
            <Badge status={t.status} />
            {t.mode === "coordinator" && (
              <span className="coordinator-label">
                <GitBranch size={12} />
                协调任务
              </span>
            )}
            <span className="muted">
              {t.priority === "high"
                ? "优先处理"
                : t.priority === "low"
                  ? "低优先级"
                  : "常规优先级"}
            </span>
          </div>
          <div className="owner-line">
            <span>负责人</span>
            <Avatar run={owner} small />
            <strong>{owner?.name || "待领取"}</strong>
            {owner && <small>{runtimeNames[owner.runtime]}</small>}
          </div>
          <div className="task-actions">
            {t.status === "pending" && (
              <Button
                variant="primary"
                icon={ArrowUpRight}
                onClick={() => claim(t)}
              >
                {currentRun ? `${currentRun.name} 领取` : "先登记执行者"}
              </Button>
            )}
            {["doing", "blocked"].includes(t.status) && mine && (
              <>
                <Button
                  variant="primary"
                  icon={CheckCircle2}
                  onClick={() => setModal({ kind: "checkpoint", task: t })}
                >
                  保存检查点
                </Button>
                <Button
                  icon={ShieldCheck}
                  onClick={() =>
                    act(() =>
                      mutate(
                        "task_submit",
                        {
                          task_id: t.id,
                          run_id: currentRun.id,
                          claim_epoch: t.claim_epoch,
                          summary: t.checkpoint?.summary || "提交任务成果",
                        },
                        "已提交，等待独立验收",
                      ),
                    )
                  }
                >
                  提交验收
                </Button>
                {["codex", "claude", "pi"].includes(owner.runtime) &&
                  owner.process?.status !== "running" && (
                    <Button
                      icon={Play}
                      onClick={() =>
                        setModal({ kind: "launch", run: owner, task: t })
                      }
                    >
                      启动执行
                    </Button>
                  )}
              </>
            )}
            {t.status === "reconcile" && mine && (
              <Button
                variant="primary"
                icon={ShieldCheck}
                onClick={() => setModal({ kind: "reconcile", task: t })}
              >
                核验现场
              </Button>
            )}
            {t.status === "review" && (
              <>
                <Button
                  variant="primary"
                  icon={Check}
                  onClick={() =>
                    setModal({ kind: "review", task: t, accepted: true })
                  }
                >
                  验收通过
                </Button>
                <Button
                  onClick={() =>
                    setModal({ kind: "review", task: t, accepted: false })
                  }
                >
                  退回修改
                </Button>
              </>
            )}
            {["pending", "doing", "blocked"].includes(t.status) &&
              t.mode === "execute" && (
                <Button
                  icon={GitBranch}
                  onClick={() =>
                    setModal({
                      kind: "split",
                      task: t,
                      proposal: !!currentRun && !!owner && !mine,
                    })
                  }
                >
                  {owner && currentRun && !mine ? "提出拆分" : "拆分任务"}
                </Button>
              )}
            {t.mode === "coordinator" &&
              !["done", "review", "reconcile"].includes(t.status) && (
                <Button
                  icon={Plus}
                  onClick={() => setModal({ kind: "task", parent: t })}
                >
                  添加子任务
                </Button>
              )}
            {["doing", "blocked", "review", "reconcile"].includes(t.status) && (
              <Button
                icon={ArrowLeftRight}
                onClick={() => setModal({ kind: "handoff", task: t })}
              >
                交接
              </Button>
            )}
            {["doing", "blocked"].includes(t.status) && mine && (
              <>
                <Button
                  icon={LockKeyhole}
                  onClick={() => setModal({ kind: "scope", task: t })}
                >
                  申请范围
                </Button>
                <Button onClick={() => setModal({ kind: "release", task: t })}>
                  释放任务
                </Button>
              </>
            )}
            {t.status === "pending" && (
              <Button
                icon={Settings2}
                onClick={() => setModal({ kind: "task", task: t })}
              >
                编辑
              </Button>
            )}
          </div>
          {t.status === "reconcile" && (
            <div className="inline-notice">
              <AlertCircle size={17} />
              <p>
                执行权已转移。新负责人先核对实际文件、进程和成果，再继续写入。旧执行权版本已失效。
              </p>
            </div>
          )}
          {proposals.map((p) => (
            <div className="pending-proposal" key={p.id}>
              <span className="eyebrow">
                {p.type === "split" ? "待确认分工" : "待确认范围"}
              </span>
              <p>{p.rationale}</p>
              <code>
                {p.type === "split"
                  ? p.children.map((c) => c.title).join(" / ")
                  : p.scopes.join(", ")}
              </code>
              <div>
                <Button
                  onClick={() =>
                    setModal({
                      kind: "proposalReview",
                      proposal: p,
                      task: t,
                      approved: true,
                    })
                  }
                >
                  通过
                </Button>
                <Button
                  onClick={() =>
                    setModal({
                      kind: "proposalReview",
                      proposal: p,
                      task: t,
                      approved: false,
                    })
                  }
                >
                  拒绝
                </Button>
              </div>
            </div>
          ))}
          <ExecutionGuide
            task={t}
            currentRun={currentRun}
            tasks={data.tasks}
            requestRevision={
              JSON.stringify(data.attention?.request_counts ?? {}) +
              data.messages
                .filter((message) => !message.system)
                .map((message) => `${message.id}:${message.version}`)
                .join(",")
            }
            onResolveRequest={(message) =>
              setModal({ kind: "resolveMessage", message })
            }
            loadGuide={loadWorkGuide}
            runNames={Object.fromEntries(
              data.runs.map((run) => [run.id, run.name]),
            )}
            onContext={() => {
              void act(() => context(t));
            }}
            onCopied={() => {
              toastManager.add({ title: "下一步调用已复制", type: "success" });
            }}
          />
          <section className="detail-section">
            <h3>目标与验收</h3>
            {t.description && <p>{t.description}</p>}
            <div className="acceptance">
              <CheckCircle2 size={16} />
              <p>{t.acceptance}</p>
            </div>
          </section>
          <section className="detail-section">
            <h3>工作约定</h3>
            <dl className="detail-dl">
              <dt>修改范围</dt>
              <dd>
                {t.read_only ? (
                  <span>只读任务</span>
                ) : (
                  t.scopes.map((s) => <code key={s}>{s}</code>)
                )}
              </dd>
              <dt>共享资源</dt>
              <dd>
                {t.resources.length
                  ? t.resources.map((r) => <code key={r}>{r}</code>)
                  : "无独占资源"}
              </dd>
              <dt>前置依赖</dt>
              <dd>
                {t.depends_on.length
                  ? t.depends_on.map((id) => {
                      const d = data.tasks.find((d) => d.id === id);
                      return (
                        d && (
                          <button
                            className="dependency-link"
                            key={id}
                            onClick={() => openTask(d)}
                          >
                            <span
                              className={
                                d.status === "done" ? "dependency-done" : ""
                              }
                            >
                              {d.status === "done" ? (
                                <CheckCircle2 size={13} />
                              ) : (
                                <Clock3 size={13} />
                              )}
                            </span>
                            {d.short_id} {d.title}
                          </button>
                        )
                      );
                    })
                  : "无前置依赖"}
              </dd>
              {owner?.workdir && (
                <>
                  <dt>执行目录</dt>
                  <dd>
                    <code>{owner.workdir}</code>
                    {owner.branch && <small>{owner.branch}</small>}
                  </dd>
                </>
              )}
            </dl>
          </section>
          {children.length > 0 && (
            <section className="detail-section">
              <h3>
                子任务{" "}
                <span>
                  {children.filter((c) => c.status === "done").length}/
                  {children.length}
                </span>
              </h3>
              <div className="child-list">
                {children.map((c) => (
                  <button key={c.id} onClick={() => openTask(c)}>
                    <span className="task-id">{c.short_id}</span>
                    <strong>{c.title}</strong>
                    <Badge status={c.status} />
                    <ChevronRight size={14} />
                  </button>
                ))}
              </div>
            </section>
          )}
          <section className="detail-section">
            <h3>
              最近检查点 <small>{t.checkpoint && time(t.checkpoint.at)}</small>
            </h3>
            {t.checkpoint ? (
              <div className="checkpoint-box">
                <p>{t.checkpoint.summary}</p>
                {t.checkpoint.blocker && (
                  <div className="checkpoint-blocker">
                    <AlertCircle size={14} />
                    {t.checkpoint.blocker}
                  </div>
                )}
                <span>下一步</span>
                <p>{t.checkpoint.next_step || "尚未记录"}</p>
              </div>
            ) : (
              <p className="muted">
                尚无检查点。执行过程中及时保存，让下一个会话能接着做。
              </p>
            )}
          </section>
          <section className="detail-section">
            <h3>成果与验证</h3>
            {t.artifacts.map((a) => (
              <div className="artifact-item" key={a.path}>
                <FileText size={15} />
                <div>
                  <code>{a.path}</code>
                  {a.note && <small>{a.note}</small>}
                </div>
                <span>{a.kind}</span>
              </div>
            ))}
            {t.verification.map((v) => (
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
            {!t.artifacts.length && !t.verification.length && (
              <p className="muted">尚未提交成果和验证证据。</p>
            )}
          </section>
          <section className="detail-section">
            <div className="section-heading">
              <h3>任务讨论</h3>
              <button
                className="text-button"
                onClick={() => setModal({ kind: "message", task: t })}
              >
                发送消息 <Send size={12} />
              </button>
            </div>
            {messages.map((m) => (
              <div className="task-message" key={m.id}>
                <strong>
                  {data.runs.find((r) => r.id === m.from_run_id)?.name ||
                    (m.system ? "Relayboard" : "人工管理")}
                </strong>
                <small>{time(m.created_at)}</small>
                <p>{m.body}</p>
                <RequestResolution
                  message={m}
                  currentRun={currentRun}
                  tasks={data.tasks}
                  onResolve={(message) =>
                    setModal({ kind: "resolveMessage", message })
                  }
                />
              </div>
            ))}
            {!messages.length && (
              <p className="muted">围绕接口、分工和阻塞，在这里留下消息。</p>
            )}
          </section>
          <div className="drawer-footer">
            <Button icon={FileText} onClick={() => act(() => context(t))}>
              查看接手包
            </Button>
            <span>
              执行权版本 {t.claim_epoch} · {t.id}
            </span>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Modal({
  modal,
  close,
  project,
  data,
  currentRun,
  mutate,
  notify,
  handleError,
  setProjectId,
  setRunId,
  setModal,
  refresh,
}: {
  modal: ModalState;
  close: () => void;
  project?: Project;
  data: Snapshot | null;
  currentRun?: Run;
  mutate: Command;
  notify: Notify;
  handleError: HandleError;
  setProjectId: (id: string) => void;
  setRunId: (id: string) => void;
  setModal: SetModal;
  refresh: () => Promise<void>;
}) {
  const { kind } = modal;
  const task = modal.task!;
  const runs = data?.runs || [],
    tasks = data?.tasks || [];

  const [execution, setExecution] = useState<ExecutionPlan | undefined>(
    task?.execution ?? undefined,
  );
  const [busy, setBusy] = useState(false),
    [formError, setFormError] = useState(""),
    [children, setChildren] = useState<ChildDraft[]>([
      { title: "", scope: "", readOnly: false },
      { title: "", scope: "", readOnly: false },
    ]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([
      { path: "", kind: "file", note: "" },
    ]),
    [verifications, setVerifications] = useState<Verification[]>([
      { command: "", result: "", passed: true },
    ]),
    [logs, setLogs] = useState("读取运行日志…");
  const titles = {
    project: modal.project ? "编辑项目约定" : "创建项目空间",
    task: task ? "编辑任务" : modal.parent ? "添加子任务" : "创建任务",
    agent: modal.parent ? "登记子 agent" : "登记执行者",
    checkpoint: "保存检查点",
    split: modal.proposal ? "提出拆分方案" : "拆分任务",
    handoff: "交接任务",
    reconcile: "核验现场",
    review: modal.accepted ? "确认验收通过" : "退回修改",
    scope: "申请扩大修改范围",
    release: "释放任务",
    message: "发送任务消息",
    resolveMessage: "标记请求已处理",
    decision: "记录项目决定",
    proposalReview: modal.approved ? "确认通过申请" : "拒绝申请",
    launch: "启动实际执行",
    logs: "运行日志",
    runEnd: "更新执行会话状态",
    dispatch: "自动领取与执行",
    worktree: "创建独立 worktree",
    context: "任务接手包",
  };
  useEffect(() => {
    if (kind !== "logs") return;
    let live = true;
    const load = () =>
      api(`/runner/logs/${modal.run.id}`, null, "GET")
        .then((v) => {
          if (live)
            setLogs(
              (v.truncated ? "[仅显示最后 48 KB]\n" : "") +
                (v.text || "尚无运行输出"),
            );
        })
        .catch((e) => {
          if (live) setLogs(e.message);
        });
    load();
    const timer = setInterval(load, 3000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [kind]);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFormError("");
    const f = new FormData(event.currentTarget),
      value = (key: string) => String(f.get(key) || ""),
      optionalActor = currentRun
        ? { actor_run_id: required(currentRun, "请先选择执行会话").id }
        : {};
    const choice = <const T extends readonly string[]>(
      key: string,
      choices: T,
    ): T[number] => {
      const selected = value(key);
      if (!choices.includes(selected)) throw new Error(`请选择有效的 ${key}`);
      return selected;
    };
    try {
      let result;
      if (kind === "project") {
        const fields = {
          name: value("name"),
          objective: value("objective"),
          constraints: value("constraints"),
          root_path: value("root_path"),
          max_concurrency: Number(value("max_concurrency")),
          autonomy: choice("autonomy", ["manual", "collaborative"]),
        };
        if (modal.project)
          result = await mutate(
            "project_update",
            {
              project_id: modal.project.id,
              expected_version: modal.project.version,
              ...fields,
            },
            "项目约定已更新",
          );
        else {
          result = await mutate(
            "project_create",
            { ...fields, root_path: value("root_path") },
            "项目空间已创建",
          );
          setProjectId(result.id);
        }
      } else if (kind === "task") {
        const fields = {
          title: value("title"),
          description: value("description"),
          acceptance: value("acceptance"),
          scopes: splitLines(value("scopes")),
          resources: splitLines(value("resources")),
          depends_on: f.getAll("depends_on").map(String),
          priority: choice("priority", ["low", "normal", "high"]),
          required_capabilities: splitLines(value("required_capabilities")),
          execution: execution ?? (task?.execution ? null : undefined),
        };
        if (task)
          result = await mutate(
            "task_update",
            {
              task_id: task.id,
              expected_version: task.version,
              ...optionalActor,
              ...fields,
            },
            "任务已更新",
          );
        else
          result = await mutate(
            "task_create",
            {
              project_id: required(project, "请先选择项目").id,
              ...optionalActor,
              ...fields,
              read_only: f.has("read_only"),
              parent_id: value("parent_id") || null,
            },
            "任务已创建",
          );
      } else if (kind === "agent") {
        const delegated = splitLines(value("delegated_scopes"));
        result = await mutate(
          "agent_register",
          {
            project_id: required(project, "请先选择项目").id,
            name: value("name"),
            runtime: choice("runtime", [
              "codex",
              "claude",
              "pi",
              "other",
              "human",
            ]),
            parent_run_id: value("parent_run_id") || undefined,
            workdir: value("workdir"),
            branch: value("branch"),
            capabilities: splitLines(value("capabilities")),
            observation: "manual",
            ...(delegated.length ? { delegated_scopes: delegated } : {}),
          },
          "执行会话已登记，尚未启动进程",
        );
        setRunId(result.run.id);
      } else if (kind === "checkpoint") {
        result = await mutate(
          "task_checkpoint",
          {
            task_id: task.id,
            run_id: required(currentRun, "请先选择执行会话").id,
            claim_epoch: task.claim_epoch,
            summary: value("summary"),
            next_step: value("next_step"),
            blocker: value("blocker"),
            artifacts: artifacts.filter((a) => a.path.trim()),
            verification: verifications.filter((v) => v.command.trim()),
          },
          "检查点已保存",
        );
      } else if (kind === "split") {
        const childDefs = children.map((c) => ({
          title: c.title,
          description: "",
          acceptance: c.acceptance || "提供成果位置和通过的验证记录",
          scopes: c.readOnly ? [] : splitLines(c.scope),
          read_only: c.readOnly,
          resources: splitLines(c.resources),
          depends_on: splitLines(c.deps),
        }));
        const args = {
          task_id: task.id,
          expected_version: task.version,
          children: childDefs,
          rationale: value("rationale"),
        };
        result = await mutate(
          modal.proposal ? "proposal_create" : "task_split",
          {
            ...args,
            ...(modal.proposal
              ? { author_run_id: required(currentRun, "请先选择执行会话").id }
              : optionalActor),
          },
          modal.proposal
            ? "拆分提议已发送给负责人"
            : "任务已拆分，父任务转为协调任务",
        );
      } else if (kind === "handoff") {
        result = await mutate(
          "task_handoff",
          {
            task_id: task.id,
            expected_version: task.version,
            ...(currentRun
              ? { from_run_id: required(currentRun, "请先选择执行会话").id }
              : {}),
            to_run_id: value("to_run_id"),
            summary: value("summary"),
            descendants: choice("descendants", ["continue", "require_stopped"]),
            confirmed_stop: f.has("confirmed_stop"),
          },
          "执行权已转移，接手者需要先核验现场",
        );
      } else if (kind === "reconcile") {
        result = await mutate(
          "task_reconcile",
          {
            task_id: task.id,
            run_id: required(currentRun, "请先选择执行会话").id,
            claim_epoch: task.claim_epoch,
            observed: value("observed"),
            next_step: value("next_step"),
          },
          "现场核验已记录，可以继续执行",
        );
      } else if (kind === "review") {
        result = await mutate(
          "task_review",
          {
            task_id: task.id,
            expected_version: task.version,
            reviewer_run_id: currentRun?.id,
            accepted: modal.accepted ?? false,
            note: value("note"),
          },
          modal.accepted
            ? "验收通过，依赖此成果的任务已重新评估"
            : "任务已退回修改",
        );
      } else if (kind === "scope") {
        result = await mutate(
          "scope_request",
          {
            task_id: task.id,
            run_id: required(currentRun, "请先选择执行会话").id,
            claim_epoch: task.claim_epoch,
            scopes: splitLines(value("scopes")),
            resources: splitLines(value("resources")),
            rationale: value("rationale"),
          },
          "范围申请已保存",
        );
      } else if (kind === "release") {
        result = await mutate(
          "task_release",
          {
            task_id: task.id,
            run_id: required(currentRun, "请先选择执行会话").id,
            claim_epoch: task.claim_epoch,
            note: value("note"),
            confirmed_stop: f.has("confirmed_stop"),
          },
          "任务已释放，已有成果继续保留",
        );
      } else if (kind === "resolveMessage") {
        result = await mutate(
          "message_resolve",
          {
            message_id: modal.message.id,
            run_id: currentRun?.id,
            note: value("note"),
          },
          "已记录处理结论，关注事项已更新",
        );
      } else if (kind === "message") {
        result = await mutate(
          "message_send",
          {
            project_id: required(project, "请先选择项目").id,
            from_run_id: currentRun?.id,
            to_run_id: value("to_run_id") || undefined,
            task_id: value("task_id") || undefined,
            kind: choice("message_kind", [
              "discussion",
              "request",
              "blocker",
              "delivery",
              "review",
            ]),
            body: value("body"),
          },
          "消息已保存并投递到收件箱",
        );
      } else if (kind === "decision") {
        result = await mutate(
          "decision_record",
          {
            project_id: required(project, "请先选择项目").id,
            ...optionalActor,
            title: value("title"),
            body: value("body"),
            task_ids: f.getAll("task_ids").map(String),
          },
          "决定已记录，相关接手包会包含此结论",
        );
      } else if (kind === "proposalReview") {
        result = await mutate(
          modal.proposal.type === "scope"
            ? "scope_resolve"
            : "proposal_resolve",
          {
            proposal_id: modal.proposal.id,
            ...optionalActor,
            approved: modal.approved,
            note: value("note"),
          },
          "申请已处理",
        );
      } else if (kind === "launch") {
        await api("/runner/start", {
          run_id: modal.run.id,
          task_id: value("task_id"),
        });
        await refresh();
        notify("已启动真实 CLI 进程，运行输出会保存在日志中");
      } else if (kind === "runEnd") {
        await mutate(
          value("status") === "reconciled"
            ? "run_process_reconcile"
            : "run_end",
          value("status") === "reconciled"
            ? {
                run_id: modal.run.id,
                observed: value("note"),
                confirmed_stopped: true,
              }
            : {
                run_id: modal.run.id,
                status: choice("status", ["ended", "unknown"]),
                note: value("note"),
              },
          "会话状态已更新，任务归属仍然保留",
        );
      } else if (kind === "dispatch") {
        await mutate(
          "run_dispatch",
          {
            run_id: modal.run.id,
            enabled: f.has("enabled"),
            max_launches: Number(value("max_launches")),
            note: value("note"),
          },
          "自动执行策略已保存；已运行的进程需要单独停止",
        );
      } else if (kind === "worktree") {
        result = await api("/worktree", {
          project_id: required(project, "请先选择项目").id,
          name: value("name"),
          base_ref: value("base_ref") || "HEAD",
        });
        await refresh();
        notify(`独立工作区已创建：${result.workdir}`);
        setModal({
          kind: "agent",
          workdir: result.workdir,
          branch: result.branch,
        });
        return;
      }
      close();
    } catch (e) {
      setFormError(errorInfo(e).message);
      if (errorInfo(e).code === "AUTH_REQUIRED") handleError(e);
    } finally {
      setBusy(false);
    }
  };
  const updateChild = (i: number, fields: Partial<ChildDraft>) =>
    setChildren(children.map((c, n) => (n === i ? { ...c, ...fields } : c)));
  const projectFields: Partial<Project> = modal.project || {};
  const readOnly = ["context", "logs"].includes(kind);
  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          "modal",
          ["split", "checkpoint", "context", "logs"].includes(kind) && "wide",
        )}
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">
              {task ? task.short_id : "RELAYBOARD"}
            </span>
            <DialogTitle>{titles[kind]}</DialogTitle>
          </div>
          <button
            className="icon-button"
            aria-label="关闭对话框"
            onClick={close}
          >
            <X size={21} />
          </button>
        </div>
        {readOnly ? (
          <>
            <pre className="packet">
              {kind === "context" ? modal.packet.markdown : logs}
            </pre>
            <div className="modal-footer">
              <Button onClick={close}>关闭</Button>
              {kind === "context" && (
                <>
                  <Button
                    icon={FolderGit2}
                    onClick={async () => {
                      try {
                        const r = await api("/export", { task_id: task.id });
                        notify(`接手文件已保存至 ${r.path}`);
                      } catch (e) {
                        handleError(e);
                      }
                    }}
                  >
                    保存接手文件
                  </Button>
                  <Button
                    variant="primary"
                    icon={Copy}
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(
                          modal.packet.markdown,
                        );
                        notify("接手包已复制");
                      } catch (e) {
                        handleError(e);
                      }
                    }}
                  >
                    复制接手包
                  </Button>
                </>
              )}
            </div>
          </>
        ) : (
          <form onSubmit={submit}>
            <FieldGroup className="modal-fields">
              {kind === "project" && (
                <>
                  <Text
                    label="项目名称"
                    name="name"
                    value={projectFields.name}
                    required
                    placeholder="例如：会员订阅系统"
                  />
                  <Text
                    label="项目目标"
                    name="objective"
                    value={projectFields.objective}
                    required
                    multiline
                    placeholder="最终要完成什么？"
                  />
                  <Text
                    label="用户约束与待确认事项"
                    name="constraints"
                    value={projectFields.constraints}
                    multiline
                    placeholder="需要保留的要求、已批准的行动范围、尚待确认的事项…"
                  />
                  <Text
                    label="代码目录"
                    name="root_path"
                    value={projectFields.root_path}
                    placeholder="/absolute/path/to/project"
                    hint="可先留空；启动执行和创建 worktree 前需要设置实际路径。"
                  />
                  <div className="form-row">
                    <Text
                      label="项目并发预算"
                      name="max_concurrency"
                      type="number"
                      min={1}
                      max={32}
                      value={projectFields.max_concurrency || 6}
                      required
                    />
                    <Field label="分工方式">
                      <NativeSelect
                        name="autonomy"
                        defaultValue={projectFields.autonomy || "collaborative"}
                      >
                        <option value="collaborative">
                          允许范围内自主拆分
                        </option>
                        <option value="manual">人工确认拆分</option>
                      </NativeSelect>
                    </Field>
                  </div>
                </>
              )}
              {kind === "task" && (
                <>
                  <Text
                    label="任务名称"
                    name="title"
                    value={task?.title}
                    required
                    placeholder="一句话说明要交付什么"
                  />
                  <Text
                    label="任务背景"
                    name="description"
                    value={task?.description}
                    multiline
                  />
                  <Text
                    label="验收标准"
                    name="acceptance"
                    value={task?.acceptance}
                    multiline
                    required
                    placeholder="什么证据能证明任务已经完成？"
                  />
                  <ExecutionEditor value={execution} onChange={setExecution} />
                  {!task && (
                    <Field label="父协调任务">
                      <NativeSelect
                        name="parent_id"
                        defaultValue={modal.parent?.id || ""}
                      >
                        <option value="">独立任务</option>
                        {tasks
                          .filter(
                            (t) =>
                              t.mode === "coordinator" &&
                              !["done", "review"].includes(t.status),
                          )
                          .map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.short_id} {t.title}
                            </option>
                          ))}
                      </NativeSelect>
                    </Field>
                  )}
                  <Text
                    label="允许修改的范围"
                    name="scopes"
                    value={task?.scopes.join("\n")}
                    multiline
                    placeholder="src/api/&#10;tests/api/"
                    hint="每行一个相对路径，或以逗号分隔。范围尽量具体。"
                  />
                  {!task && (
                    <label className="check-field">
                      <Checkbox name="read_only" />
                      只读任务，无文件写入或独占资源
                    </label>
                  )}
                  <Text
                    label="独占共享资源"
                    name="resources"
                    value={task?.resources.join("\n")}
                    placeholder="例如 database:schema，contract:auth"
                    hint="即使使用不同 worktree，同一个独占资源也需要串行处理。"
                  />
                  <div className="form-row">
                    <Field label="优先级">
                      <NativeSelect
                        name="priority"
                        defaultValue={task?.priority || "normal"}
                      >
                        <option value="normal">常规</option>
                        <option value="high">优先</option>
                        <option value="low">低</option>
                      </NativeSelect>
                    </Field>
                    <Text
                      label="所需能力标签"
                      name="required_capabilities"
                      value={task?.required_capabilities.join(", ")}
                      placeholder="可选，例如 browser"
                    />
                  </div>
                  {tasks.length > 0 && (
                    <FieldSet>
                      <FieldLegend variant="label">前置依赖</FieldLegend>
                      <div className="checkbox-list">
                        {tasks
                          .filter(
                            (t) =>
                              t.id !== task?.id && t.id !== modal.parent?.id,
                          )
                          .map((t) => (
                            <label key={t.id}>
                              <Checkbox
                                name="depends_on"
                                value={t.id}
                                defaultChecked={task?.depends_on.includes(t.id)}
                              />
                              <span>
                                {t.short_id} {t.title}
                              </span>
                              <small>{statusNames[t.status]}</small>
                            </label>
                          ))}
                      </div>
                    </FieldSet>
                  )}
                </>
              )}
              {kind === "agent" && (
                <>
                  <p className="form-intro">
                    登记会话用于追踪归属，不代表进程已经运行。派发原生子 agent
                    前，先在这里登记并领取子任务。
                  </p>
                  <div className="form-row">
                    <Text
                      label="执行者名称"
                      name="name"
                      required
                      placeholder={
                        modal.parent
                          ? "例如：认证接口子 agent"
                          : "例如：Codex · 后端"
                      }
                    />
                    <Field label="工具">
                      <NativeSelect
                        name="runtime"
                        defaultValue={modal.parent?.runtime || "codex"}
                      >
                        {Object.entries(runtimeNames).map(([k, v]) => (
                          <option value={k} key={k}>
                            {v}
                          </option>
                        ))}
                      </NativeSelect>
                    </Field>
                  </div>
                  <Field label="父执行会话">
                    <NativeSelect
                      name="parent_run_id"
                      defaultValue={modal.parent?.id || ""}
                    >
                      <option value="">独立主执行者</option>
                      {runs
                        .filter((r) => r.status === "active")
                        .map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name} · {r.id}
                          </option>
                        ))}
                    </NativeSelect>
                  </Field>
                  <Text
                    label="实际工作目录"
                    name="workdir"
                    value={
                      modal.workdir ||
                      modal.parent?.workdir ||
                      project?.root_path
                    }
                    placeholder="/absolute/path/to/worktree"
                    hint="并行修改代码推荐每个执行单元使用独立 worktree。"
                  />
                  <Text
                    label="代码分支"
                    name="branch"
                    value={modal.branch}
                    placeholder="可选，例如 relayboard/login-api"
                  />
                  <Text
                    label="获委派的修改范围"
                    name="delegated_scopes"
                    value=""
                    placeholder="主执行者默认 .；子执行者默认继承父任务范围"
                  />
                  <Text
                    label="能力标签"
                    name="capabilities"
                    placeholder="可选，例如 node, browser, python"
                  />
                </>
              )}
              {kind === "checkpoint" && (
                <>
                  <Text
                    label="已经完成的事实"
                    name="summary"
                    value={task.checkpoint?.summary}
                    required
                    multiline
                    placeholder="具体完成了什么？与计划和猜测分开。"
                  />
                  <Text
                    label="下一步"
                    name="next_step"
                    value={task.checkpoint?.next_step}
                    multiline
                    placeholder="接手者可以直接执行的动作"
                  />
                  <Text
                    label="当前阻塞"
                    name="blocker"
                    value={task.checkpoint?.blocker}
                    placeholder="没有阻塞可留空"
                  />
                  <div className="section-heading">
                    <h3>新增成果</h3>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() =>
                        setArtifacts([
                          ...artifacts,
                          { path: "", kind: "file", note: "" },
                        ])
                      }
                    >
                      <Plus size={13} />
                      添加成果
                    </button>
                  </div>
                  {artifacts.map((a, i) => (
                    <div className="artifact-form" key={i}>
                      <NativeSelect
                        aria-label={`成果类型 ${i + 1}`}
                        value={a.kind}
                        onChange={(e) =>
                          setArtifacts(
                            artifacts.map((x, n) =>
                              n === i
                                ? {
                                    ...x,
                                    kind: e.target.value as Artifact["kind"],
                                  }
                                : x,
                            ),
                          )
                        }
                      >
                        {["file", "commit", "branch", "url", "report"].map(
                          (k) => (
                            <option key={k} value={k}>
                              {k}
                            </option>
                          ),
                        )}
                      </NativeSelect>
                      <Input
                        aria-label={`成果位置 ${i + 1}`}
                        placeholder="文件路径、提交 ID 或报告位置"
                        value={a.path}
                        onChange={(e) =>
                          setArtifacts(
                            artifacts.map((x, n) =>
                              n === i ? { ...x, path: e.target.value } : x,
                            ),
                          )
                        }
                      />
                    </div>
                  ))}
                  <div className="section-heading">
                    <h3>新增验证记录</h3>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() =>
                        setVerifications([
                          ...verifications,
                          { command: "", result: "", passed: true },
                        ])
                      }
                    >
                      <Plus size={13} />
                      添加验证
                    </button>
                  </div>
                  {verifications.map((v, i) => (
                    <div className="verification-form" key={i}>
                      <Input
                        aria-label={`验证命令 ${i + 1}`}
                        placeholder="运行的命令或检查名称"
                        value={v.command}
                        onChange={(e) =>
                          setVerifications(
                            verifications.map((x, n) =>
                              n === i ? { ...x, command: e.target.value } : x,
                            ),
                          )
                        }
                      />
                      <Textarea
                        aria-label={`验证结果 ${i + 1}`}
                        placeholder="实际观察到的结果"
                        value={v.result}
                        onChange={(e) =>
                          setVerifications(
                            verifications.map((x, n) =>
                              n === i ? { ...x, result: e.target.value } : x,
                            ),
                          )
                        }
                      />
                      <label className="check-field">
                        <Checkbox
                          checked={v.passed}
                          onChange={(e) =>
                            setVerifications(
                              verifications.map((x, n) =>
                                n === i
                                  ? { ...x, passed: e.target.checked }
                                  : x,
                              ),
                            )
                          }
                        />
                        验证通过
                      </label>
                    </div>
                  ))}
                </>
              )}
              {kind === "split" && (
                <>
                  <p className="form-intro">
                    {modal.proposal
                      ? "提议会交给现有负责人确认，确认前保持原有分工。"
                      : "父任务转为协调任务，具体执行落到下面的子任务。已有检查点继续保留。"}
                  </p>
                  <Text
                    label="拆分理由与分工约定"
                    name="rationale"
                    required
                    multiline
                    placeholder="为什么这样拆？公共接口由谁负责？"
                  />
                  {children.map((c, i) => (
                    <div className="split-child" key={i}>
                      <div className="split-child-title">
                        <strong>子任务 {i + 1}</strong>
                        {children.length > 2 && (
                          <button
                            type="button"
                            className="icon-button"
                            aria-label={`删除子任务 ${i + 1}`}
                            onClick={() =>
                              setChildren(children.filter((_, n) => n !== i))
                            }
                          >
                            <X size={14} />
                          </button>
                        )}
                      </div>
                      <Input
                        aria-label={`子任务 ${i + 1} 名称`}
                        placeholder="要交付什么"
                        value={c.title}
                        onChange={(e) =>
                          updateChild(i, { title: e.target.value })
                        }
                        required
                      />
                      <Input
                        aria-label={`子任务 ${i + 1} 验收标准`}
                        placeholder="验收标准"
                        value={c.acceptance || ""}
                        onChange={(e) =>
                          updateChild(i, { acceptance: e.target.value })
                        }
                        required
                      />
                      <Input
                        aria-label={`子任务 ${i + 1} 修改范围`}
                        placeholder="修改范围，例如 src/api"
                        value={c.scope}
                        onChange={(e) =>
                          updateChild(i, { scope: e.target.value })
                        }
                        disabled={c.readOnly}
                        required={!c.readOnly}
                      />
                      <div className="form-row">
                        <Input
                          aria-label={`子任务 ${i + 1} 独占资源`}
                          placeholder="独占资源（可选）"
                          value={c.resources || ""}
                          onChange={(e) =>
                            updateChild(i, { resources: e.target.value })
                          }
                          disabled={c.readOnly}
                        />
                        <Input
                          aria-label={`子任务 ${i + 1} 依赖`}
                          placeholder="依赖：@0 表示第一个子任务"
                          value={c.deps || ""}
                          onChange={(e) =>
                            updateChild(i, { deps: e.target.value })
                          }
                        />
                      </div>
                      <label className="check-field">
                        <Checkbox
                          checked={c.readOnly}
                          onChange={(e) =>
                            updateChild(i, {
                              readOnly: e.target.checked,
                              resources: "",
                            })
                          }
                        />
                        只读任务
                      </label>
                    </div>
                  ))}
                  <Button
                    type="button"
                    icon={Plus}
                    onClick={() =>
                      setChildren([
                        ...children,
                        { title: "", scope: "", readOnly: false },
                      ])
                    }
                    disabled={children.length >= 16}
                  >
                    添加子任务
                  </Button>
                </>
              )}
              {kind === "handoff" && (
                <>
                  <p className="form-intro">
                    转移执行权后，旧执行权版本失效。新负责人先核验现场，再继续写入。
                  </p>
                  <Field label="交给哪个执行者">
                    <NativeSelect name="to_run_id" required defaultValue="">
                      <option value="" disabled>
                        选择接手会话
                      </option>
                      {runs
                        .filter(
                          (r) =>
                            r.id !== task.owner_run_id && r.status === "active",
                        )
                        .map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name} · {runtimeNames[r.runtime]}
                          </option>
                        ))}
                    </NativeSelect>
                  </Field>
                  <Text
                    label="交接说明"
                    name="summary"
                    required
                    multiline
                    placeholder="已完成什么、剩余什么、结果未知的操作有哪些？"
                  />
                  <Field label="活动子任务的处理">
                    <NativeSelect name="descendants">
                      <option value="continue">
                        继续执行，并向新负责人报告
                      </option>
                      <option value="require_stopped">
                        要求子任务先停止并释放
                      </option>
                    </NativeSelect>
                  </Field>
                  <label className="check-field">
                    <Checkbox name="confirmed_stop" />
                    已确认旧负责人停止对该任务的写入
                  </label>
                  <small className="muted">
                    共享目录交接需要停止确认。独立目录也需要核验旧执行状态；系统不会把失联当成已经停止。
                  </small>
                </>
              )}
              {kind === "reconcile" && (
                <>
                  <Text
                    label="实际核对到的情况"
                    name="observed"
                    required
                    multiline
                    placeholder="文件、分支、未提交改动、旧进程和成果是否与交接记录一致？"
                  />
                  <Text
                    label="接下来的具体动作"
                    name="next_step"
                    required
                    multiline
                  />
                </>
              )}
              {["review", "proposalReview"].includes(kind) && (
                <>
                  <p className="form-intro">
                    {kind === "review"
                      ? modal.accepted
                        ? "确认你已检查成果、验证证据和验收标准。执行者本人不能独立验收自己的任务。"
                        : "说明尚未满足的标准，让负责人能继续处理。"
                      : "通过时会重新检查任务版本、归属和范围冲突。"}
                  </p>
                  <Text label="处理意见" name="note" multiline required />
                </>
              )}
              {kind === "scope" && (
                <>
                  <Text
                    label="新增修改范围"
                    name="scopes"
                    multiline
                    placeholder="每行一个相对路径"
                  />
                  <Text
                    label="新增独占资源"
                    name="resources"
                    placeholder="例如 database:schema"
                  />
                  <Text
                    label="需要扩展的原因"
                    name="rationale"
                    required
                    multiline
                  />
                </>
              )}
              {kind === "release" && (
                <>
                  <Text
                    label="当前成果与释放原因"
                    name="note"
                    multiline
                    required
                  />
                  <label className="check-field">
                    <Checkbox name="confirmed_stop" required />
                    已停止相关写入，并保存必要检查点
                  </label>
                </>
              )}
              {kind === "resolveMessage" && (
                <>
                  <p className="form-intro">{modal.message.body}</p>
                  <Text
                    label="处理结论"
                    name="note"
                    required
                    multiline
                    placeholder="说明已完成的处理、核对的成果或不再需要处理的原因"
                  />
                  <p className="fine-print">
                    提交后从关注事项移除，原消息和处理结论继续保留在讨论中。
                  </p>
                </>
              )}
              {kind === "message" && (
                <>
                  <Field label="接收者">
                    <NativeSelect
                      name="to_run_id"
                      defaultValue={task?.owner_run_id || ""}
                    >
                      <option value="">项目公开讨论</option>
                      {runs.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field label="关联任务">
                    <NativeSelect name="task_id" defaultValue={task?.id || ""}>
                      <option value="">项目级消息</option>
                      {tasks.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.short_id} {t.title}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field label="消息类型">
                    <NativeSelect name="message_kind">
                      {Object.entries({
                        discussion: "讨论",
                        request: "协作请求",
                        blocker: "报告阻塞",
                        delivery: "交付",
                        review: "请求审查",
                      }).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Text
                    label="消息内容"
                    name="body"
                    required
                    multiline
                    placeholder="写清问题、证据和希望对方采取的动作"
                  />
                </>
              )}
              {kind === "decision" && (
                <>
                  <Text
                    label="决定标题"
                    name="title"
                    required
                    placeholder="例如：登录接口约定 v2"
                  />
                  <Text
                    label="结论与理由"
                    name="body"
                    required
                    multiline
                    placeholder="确定了什么、为什么这样选、排除了哪些方案？"
                  />
                  <Field label="关联任务（留空表示项目通用）">
                    <div className="checkbox-list">
                      {tasks.map((t) => (
                        <label key={t.id}>
                          <Checkbox name="task_ids" value={t.id} />
                          {t.short_id} {t.title}
                        </label>
                      ))}
                    </div>
                  </Field>
                </>
              )}
              {kind === "launch" && (
                <>
                  <div className="inline-notice">
                    <Terminal size={18} />
                    <p>
                      将启动本机的 {runtimeNames[modal.run.runtime]}{" "}
                      CLI，使用它已有的登录与权限配置。真实执行会消耗相应账户额度。
                    </p>
                  </div>
                  <Field label="执行已归属的任务">
                    <NativeSelect
                      name="task_id"
                      required
                      defaultValue={task?.id || ""}
                    >
                      <option value="" disabled>
                        选择任务
                      </option>
                      {tasks
                        .filter(
                          (t) =>
                            t.owner_run_id === modal.run.id &&
                            ["doing", "blocked", "reconcile"].includes(
                              t.status,
                            ),
                        )
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.short_id} {t.title}
                          </option>
                        ))}
                    </NativeSelect>
                  </Field>
                  <p className="muted">
                    工作目录：
                    <code>
                      {modal.run.workdir || "尚未登记，需要先登记实际目录"}
                    </code>
                  </p>
                  <p className="fine-print">
                    系统注入接手包与协作协议，原生子 agent
                    仍需显式登记和上报。进程退出本身不代表任务完成。
                  </p>
                </>
              )}
              {kind === "runEnd" && (
                <>
                  <Field label="会话状态">
                    <NativeSelect name="status">
                      <option value="unknown">状态待核实</option>
                      <option value="ended">已确认会话结束</option>
                      {modal.run.process?.status === "unknown" && (
                        <option value="reconciled">
                          已核验原托管进程停止，恢复此会话
                        </option>
                      )}
                    </NativeSelect>
                  </Field>
                  <Text label="事实与原因" name="note" required multiline />
                  <p className="fine-print">
                    状态更新不会自动释放任务。仍有执行权的任务需要核验后明确交接或释放。
                  </p>
                </>
              )}
              {kind === "dispatch" && (
                <>
                  <div className="inline-notice">
                    <Waypoints size={18} />
                    <p>
                      启用后，服务会为这个执行者领取合适的执行任务，并启动真实
                      CLI。新的定向消息可触发后续执行。会消耗相应账户额度；达到次数预算后自动关闭。
                    </p>
                  </div>
                  <label className="check-field">
                    <Checkbox
                      name="enabled"
                      defaultChecked={modal.run.dispatch?.enabled || false}
                    />
                    启用自动领取与执行
                  </label>
                  <Text
                    label="本次最多启动次数"
                    name="max_launches"
                    type="number"
                    min={1}
                    max={20}
                    value={modal.run.dispatch?.max_launches || 3}
                    required
                  />
                  <Text
                    label="执行范围说明"
                    name="note"
                    required
                    multiline
                    value={modal.run.dispatch?.note}
                    placeholder="例如：在当前前端范围内领取任务，最多启动 3 次；提交后等待验收。"
                  />
                  <p className="fine-print">
                    每次保存会重置次数预算。关闭自动执行不停止已有进程。相同任务没有新消息或新执行权时不会反复重启。外部窗口仍通过
                    MCP/CLI 主动接入。
                  </p>
                </>
              )}
              {kind === "worktree" && (
                <>
                  <p className="form-intro">
                    在项目 Git
                    仓库中创建新分支与独立工作区，不覆盖已有目录。完成后可以直接登记执行者。
                  </p>
                  <Text
                    label="工作区名称"
                    name="name"
                    required
                    placeholder="例如 login-api"
                    pattern="[a-z][a-z0-9-]{0,45}"
                  />
                  <Text
                    label="基础版本"
                    name="base_ref"
                    value="HEAD"
                    required
                  />
                  <p className="muted">
                    源代码目录：<code>{project?.root_path || "未设置"}</code>
                  </p>
                </>
              )}
              {formError && (
                <Alert variant="destructive">
                  <AlertCircle />
                  <AlertDescription>{formError}</AlertDescription>
                </Alert>
              )}
            </FieldGroup>
            <div className="modal-footer">
              <Button type="button" onClick={close}>
                取消
              </Button>
              <Button
                variant="primary"
                type="submit"
                disabled={busy}
                icon={
                  kind === "launch"
                    ? Play
                    : kind === "handoff"
                      ? ArrowLeftRight
                      : Check
                }
              >
                {busy
                  ? "处理中…"
                  : kind === "launch"
                    ? "启动执行"
                    : kind === "split" && modal.proposal
                      ? "提交提议"
                      : "确认保存"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

createRoot(document.getElementById("root")!).render(
  <TooltipProvider>
    <Toaster>
      <App />
    </Toaster>
  </TooltipProvider>,
);
