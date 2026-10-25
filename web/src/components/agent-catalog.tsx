import { usePageRefresh } from "./page-refresh";
import { useEffect, useState } from "react";
import { Search, ExternalLink, Plus, AlertCircle, Copy } from "lucide-react";
import type { RunnerStatus, RuntimeId } from "../../../server/runtimes.ts";
import {
  clientMcpConfig,
  type IntegrationConfig,
} from "../../../server/client-configs.ts";
import { AgentIcon } from "./agent-icon";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  InputGroup,
  InputGroupInput,
  InputGroupAddon,
} from "@/components/ui/input-group";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";

export function AgentCatalog({
  load,
  register,
  integration,
  notify,
}: {
  load: (refresh: boolean) => Promise<RunnerStatus>;
  integration: () => Promise<IntegrationConfig>;
  notify: (message: string, error?: boolean) => unknown;
  register: (runtime: RuntimeId) => void;
}) {
  const [status, setStatus] = useState<RunnerStatus | null>(null);
  const [busy, setBusy] = useState(true),
    [error, setError] = useState("");
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all");
  async function refresh(propagate = false) {
    setBusy(true);
    setError("");
    try {
      setStatus(await load(true));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      if (propagate) throw e;
    } finally {
      setBusy(false);
    }
  }
  usePageRefresh(() => refresh(true));
  const copyConfig = async (runtime: RuntimeId) => {
    try {
      const snippet = clientMcpConfig(runtime, await integration());
      await navigator.clipboard.writeText(snippet.content);
      notify(`MCP 配置已复制。${snippet.hint}`);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), true);
    }
  };
  useEffect(() => {
    let live = true;
    load(false)
      .then((s) => {
        if (live) setStatus(s);
      })
      .catch((e) => {
        if (live) setError(String(e.message || e));
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [load]);
  const runtimes = (status?.runtimes || []).filter(
    (r) => r.runtime !== "human",
  );
  const visible = runtimes.filter(
    (r) =>
      (!search ||
        `${r.name} ${r.runtime}`
          .toLowerCase()
          .includes(search.toLowerCase())) &&
      (filter === "all" ||
        (filter === "ready"
          ? r.launchable
          : filter === "mcp"
            ? r.mode === "mcp"
            : r.mode === "cli")),
  );
  return (
    <section className="agent-catalog flex flex-col gap-5">
      <p className="catalog-summary">
        {busy
          ? "正在检测本机工具…"
          : `支持 ${runtimes.length} 种客户端 · 本机就绪 ${runtimes.filter((r) => r.launchable).length} 种`}{" "}
        · CLI 可直接启动，MCP 通过配置接入
      </p>
      {error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {status && !status.enabled && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{status.reason}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ToggleGroup
          value={[filter]}
          onValueChange={(values) => values.length && setFilter(values[0])}
        >
          <ToggleGroupItem value="all">全部 {runtimes.length}</ToggleGroupItem>
          <ToggleGroupItem value="cli">CLI 启动</ToggleGroupItem>
          <ToggleGroupItem value="mcp">MCP 接入</ToggleGroupItem>
          <ToggleGroupItem value="ready">
            本机就绪 {runtimes.filter((r) => r.launchable).length}
          </ToggleGroupItem>
        </ToggleGroup>
        <InputGroup className="max-w-xs">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="搜索 Agent"
            placeholder="搜索 Agent…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </InputGroup>
      </div>
      {!status && busy ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <div className="agent-catalog-grid">
          {visible.map((r) => (
            <Card key={r.runtime} size="sm">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <span className="agent-catalog-logo">
                    <AgentIcon runtime={r.runtime} name={r.name} />
                  </span>
                  <div className="flex min-w-0 flex-col gap-1">
                    <CardTitle>{r.name}</CardTitle>
                    <Badge
                      variant={
                        r.launchable
                          ? "success"
                          : r.mode === "cli"
                            ? "warning"
                            : "secondary"
                      }
                      size="status"
                    >
                      {r.mode === "cli"
                        ? r.available
                          ? r.launch_enabled
                            ? "CLI 已就绪"
                            : "服务禁用启动"
                          : "CLI 未就绪"
                        : r.mode === "mcp"
                          ? "通过 MCP 接入"
                          : "自定义接入"}
                    </Badge>
                  </div>
                </div>
                <CardDescription>{r.note}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {r.command && (
                  <code className="agent-command">
                    {r.command} {r.args.join(" ")}
                    {r.args.includes("{prompt}") ? "" : " <任务接手包>"}
                  </code>
                )}
                {r.mode === "cli" && (
                  <p className="text-xs text-muted-foreground">
                    {r.available ? `${r.version} · 登录待客户端确认` : r.reason}
                  </p>
                )}
                <p className="text-xs text-muted-foreground break-words">
                  {r.setup}
                </p>
              </CardContent>
              <CardFooter className="flex flex-wrap justify-between gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => register(r.runtime)}
                >
                  <Plus data-icon="inline-start" />
                  登记执行者
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyConfig(r.runtime)}
                >
                  <Copy data-icon="inline-start" />
                  复制 MCP 配置
                </Button>
                {r.docs && (
                  <Button
                    variant="ghost"
                    size="sm"
                    render={
                      <a href={r.docs} target="_blank" rel="noreferrer" />
                    }
                  >
                    <ExternalLink data-icon="inline-end" />
                    官方文档
                  </Button>
                )}
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
      {status && !visible.length && (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>没有匹配的 Agent</EmptyTitle>
            <EmptyDescription>
              调整搜索条件，或使用自定义 CLI 接入其他客户端。
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      <p className="text-xs text-muted-foreground">
        CLI
        就绪表示版本检测通过；实际执行依赖客户端账户、模型与权限。启动会消耗对应账户额度。MCP
        客户端需在各自界面开始会话。
      </p>
      {status && (
        <p className="text-xs text-muted-foreground">
          自定义命令配置：
          <code className="break-all">{status.config_path}</code>
          。修改后重启服务；支持 command、args、stdin、versionArgs，参数中的{" "}
          {"{prompt}"} 会替换为任务接手包。配置示例见 README。
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        品牌图标来自{" "}
        <a
          href="https://github.com/lobehub/lobe-icons"
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          LobeHub Icons
        </a>
        ，随应用离线打包；库中暂无的品牌使用名称首字。
      </p>
    </section>
  );
}
