import { useEffect, useState, useRef, type FormEvent } from "react";
import {
  Plus,
  Search,
  RefreshCw,
  BookOpen,
  History,
  Pencil,
  AlertCircle,
} from "lucide-react";
import type {
  ProjectMemory,
  MemorySearchResult,
  MemorySourceInfo,
  QueryResults,
  Task,
} from "../../../server/types.ts";
import type { QueryInput, CommandInput } from "../../../server/schemas.ts";
import type { Command, Notify } from "../types";
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
  FieldLabel,
  FieldDescription,
  FieldGroup,
} from "@/components/ui/field";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";

export type BoardQuery = <K extends keyof QueryResults>(
  name: K,
  args?: QueryInput<K>,
) => Promise<QueryResults[K]>;
const kinds = {
  fact: "项目事实",
  decision: "决定背景",
  runbook: "操作手册",
  pitfall: "失败经验",
  reference: "参考资料",
};
const states = {
  active: "有效",
  stale: "待核实",
  archived: "已归档",
  all: "全部",
};
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const split = (value: string) =>
  value
    .split(/[,，\n]/)
    .map((v) => v.trim())
    .filter(Boolean);

export function ProjectMemoryView({
  projectId,
  tasks,
  query,
  command,
  notify,
}: {
  projectId: string;
  tasks: Task[];
  query: BoardQuery;
  command: Command;
  notify: Notify;
}) {
  const requestSequence = useRef(0);
  const [resultSource, setResultSource] = useState("local");
  const [sources, setSources] = useState<MemorySourceInfo[]>([]),
    [source, setSource] = useState("local");
  const [search, setSearch] = useState(""),
    [status, setStatus] = useState<"active" | "stale" | "archived" | "all">(
      "active",
    );
  const [result, setResult] = useState<MemorySearchResult | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [selected, setSelected] = useState<ProjectMemory | null>(null),
    [selectedSource, setSelectedSource] = useState("local");
  const [history, setHistory] = useState<QueryResults["memory_history"] | null>(
      null,
    ),
    [editor, setEditor] = useState<ProjectMemory | "new" | null>(null);
  async function load(offset = 0, append = false) {
    const sequence = ++requestSequence.current;
    const from = source;
    setBusy(true);
    setError("");
    try {
      let page: MemorySearchResult;
      if (source === "local")
        page = await query("memory_search", {
          project_id: projectId,
          query: search,
          status,
          offset,
          limit: 10,
          max_chars: 8000,
        });
      else {
        const remote = await query("memory_remote_search", {
          source,
          query: search,
          offset,
          limit: 5,
          max_chars: 8000,
        });
        if (remote.error || !remote.result)
          throw Error(remote.error || "远程来源没有返回结果");
        page = remote.result;
      }
      if (sequence !== requestSequence.current) return;
      setResultSource(from);
      setResult((old) =>
        append && old
          ? { ...page, items: [...old.items, ...page.items] }
          : page,
      );
    } catch (e) {
      if (sequence === requestSequence.current) setError(message(e));
    } finally {
      if (sequence === requestSequence.current) setBusy(false);
    }
  }
  useEffect(() => {
    void load();
    query("memory_sources", {})
      .then(setSources)
      .catch((e) => setError(message(e)));
  }, []);
  async function open(memoryId: string, version?: number, from = source) {
    try {
      const memory =
        from === "local"
          ? await query("memory_get", { memory_id: memoryId, version })
          : await query("memory_remote_get", {
              source: from,
              memory_id: memoryId,
              version,
            }).then((r) => {
              if (r.error || !r.memory) throw Error(r.error || "远程记忆为空");
              return r.memory;
            });
      setSelected(memory);
      setSelectedSource(from);
      setHistory(null);
    } catch (e) {
      notify(message(e), true);
    }
  }
  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          把项目事实、操作手册和失败经验留给下一位执行者。接手包只携带相关摘要，正文按需读取。
        </p>
        <Button onClick={() => setEditor("new")}>
          <Plus data-icon="inline-start" />
          记录记忆
        </Button>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
      >
        <FieldGroup className="sm:flex-row sm:items-end">
          <Field>
            <FieldLabel htmlFor="memory-query">检索记忆</FieldLabel>
            <Input
              id="memory-query"
              value={search}
              onChange={(e) => {
                requestSequence.current++;
                setBusy(false);
                setResult(null);
                setSearch(e.target.value);
              }}
              placeholder="例如：数据库备份、提交规范"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="memory-source">记忆库</FieldLabel>
            <NativeSelect
              id="memory-source"
              value={source}
              onChange={(e) => {
                requestSequence.current++;
                setBusy(false);
                setSource(e.target.value);
                setResult(null);
              }}
            >
              <option value="local">当前项目 · 本地</option>
              {sources.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.label}
                  {s.token_configured ? "" : " · 认证待配置"}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {source === "local" && (
            <Field>
              <FieldLabel htmlFor="memory-status">状态</FieldLabel>
              <NativeSelect
                id="memory-status"
                value={status}
                onChange={(e) => {
                  requestSequence.current++;
                  setBusy(false);
                  setResult(null);
                  setStatus(e.target.value as typeof status);
                }}
              >
                {Object.entries(states).map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
          <Button type="submit" disabled={busy}>
            <Search data-icon="inline-start" />
            {busy ? "检索中…" : "检索"}
          </Button>
        </FieldGroup>
      </form>
      {error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {busy && !result && <Skeleton className="h-40 w-full" />}
      {result && (
        <>
          <p className="text-sm text-muted-foreground">
            找到 {result.total} 条 · 当前展示 {result.items.length} 条 · 来源：
            {resultSource === "local"
              ? "本地项目"
              : sources.find((s) => s.name === resultSource)?.label ||
                resultSource}
          </p>
          <div className="grid gap-4 lg:grid-cols-2">
            {result.items.map((m) => (
              <Card key={`${m.id}@${m.version}`} size="sm">
                <CardHeader>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary">{kinds[m.kind]}</Badge>
                    <Badge variant="outline">v{m.version}</Badge>
                    {m.pinned && <Badge variant="outline">接手摘要</Badge>}
                    {m.expires_at && Date.parse(m.expires_at) <= Date.now() && (
                      <Badge variant="outline">已过期</Badge>
                    )}
                  </div>
                  <CardTitle>{m.title}</CardTitle>
                  <CardDescription>{m.summary}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  <p className="text-xs text-muted-foreground break-words">
                    来源：{m.source.label} · {m.evidence_count} 项证据 · 正文{" "}
                    {m.content_chars} 字符
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {m.tags.map((tag) => (
                      <Badge key={tag} variant="outline">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
                <CardFooter>
                  <Button
                    variant="outline"
                    onClick={() => void open(m.id, m.version, resultSource)}
                  >
                    <BookOpen data-icon="inline-start" />
                    读取正文与证据
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
          {!result.items.length && (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>还没有匹配的记忆</EmptyTitle>
                <EmptyDescription>
                  记录一次有效经验，或调整检索词。任务检查点和项目决定仍保存在原来的位置。
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          {result.next_offset !== null && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void load(result.next_offset!, true)}
            >
              继续加载
            </Button>
          )}
          <p className="text-xs text-muted-foreground">{result.notice}</p>
        </>
      )}
      <Alert>
        <BookOpen />
        <AlertDescription>
          远程记忆库按需检索，搜索词会发送给所选来源。来源配置位于数据目录
          memory-remotes.json；认证从环境变量读取。配置方法见
          README。远程内容经显式保存后才会进入本地项目。
        </AlertDescription>
      </Alert>
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selected?.title || "记忆详情"}</DialogTitle>
            <DialogDescription>
              {selectedSource === "local"
                ? "本地项目记忆"
                : `远程来源：${sources.find((s) => s.name === selectedSource)?.label || selectedSource}`}{" "}
              · v{selected?.version} · 历史参考，使用前核实适用性。
            </DialogDescription>
          </DialogHeader>
          {selected && (
            <>
              <p>{selected.summary}</p>
              <pre className="whitespace-pre-wrap break-words text-sm">
                {selected.content}
              </pre>
              <p className="text-xs text-muted-foreground break-all">
                来源：{selected.source.label} {selected.source.uri}{" "}
                {selected.source.revision} · 状态 {states[selected.status]}
                {selected.expires_at
                  ? ` · 有效期至 ${selected.expires_at}`
                  : ""}
              </p>
              {selected.evidence.map((a, i) => (
                <p key={i} className="text-xs break-all">
                  {a.kind}：{a.path} — {a.note}
                </p>
              ))}
              <div className="flex flex-wrap gap-2">
                {selectedSource === "local" ? (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setEditor(selected);
                        setSelected(null);
                      }}
                    >
                      <Pencil data-icon="inline-start" />
                      编辑记忆
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() =>
                        query("memory_history", { memory_id: selected.id })
                          .then(setHistory)
                          .catch((e) => notify(message(e), true))
                      }
                    >
                      <History data-icon="inline-start" />
                      版本历史
                    </Button>
                  </>
                ) : (
                  <Button
                    onClick={() => {
                      setEditor({
                        ...selected,
                        id: "",
                        key: `${selectedSource}:${selected.key}`,
                        project_id: projectId,
                        task_ids: [],
                        pinned: false,
                        source: {
                          ...selected.source,
                          label: `${selectedSource} / ${selected.source.label}`,
                        },
                      });
                      setSelected(null);
                    }}
                  >
                    保存到当前项目
                  </Button>
                )}
              </div>
              {history && (
                <div className="flex flex-col gap-2">
                  {history.items.map((v) => (
                    <Button
                      key={v.version}
                      variant="outline"
                      onClick={() => void open(v.id, v.version, "local")}
                    >
                      v{v.version} · {v.updated_at} · {states[v.status]}
                    </Button>
                  ))}
                  {history.next_offset !== null && (
                    <Button
                      variant="ghost"
                      onClick={() =>
                        query("memory_history", {
                          memory_id: selected.id,
                          offset: history.next_offset!,
                        })
                          .then((page) =>
                            setHistory({
                              ...page,
                              items: [...history.items, ...page.items],
                            }),
                          )
                          .catch((e) => notify(message(e), true))
                      }
                    >
                      更多历史
                    </Button>
                  )}
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
      {editor && (
        <MemoryEditor
          memory={editor === "new" ? null : editor}
          projectId={projectId}
          tasks={tasks}
          save={async (args) => {
            await command("memory_save", args);
            setEditor(null);
            notify("项目记忆已保存，原版本保留在历史中");
            await load();
          }}
          close={() => setEditor(null)}
        />
      )}
    </section>
  );
}

function MemoryEditor({
  memory,
  projectId,
  tasks,
  save,
  close,
}: {
  memory: ProjectMemory | null;
  projectId: string;
  tasks: Task[];
  save: (args: CommandInput<"memory_save">) => Promise<void>;
  close: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget),
      value = (name: string) => String(form.get(name) || "").trim();
    setBusy(true);
    setError("");
    try {
      await save({
        project_id: projectId,
        ...(memory?.id
          ? { memory_id: memory.id, expected_version: memory.version }
          : {}),
        key: value("key"),
        title: value("title"),
        summary: value("summary"),
        content: value("content"),
        kind: value("kind") as ProjectMemory["kind"],
        status: value("status") as ProjectMemory["status"],
        tags: split(value("tags")),
        task_ids: form.getAll("task_ids").map(String),
        pinned: form.has("pinned"),
        expires_at: value("expires_at")
          ? new Date(value("expires_at")).toISOString()
          : null,
        source: {
          label: value("source_label"),
          uri: value("source_uri"),
          revision: value("source_revision"),
        },
        evidence: value("evidence")
          .split("\n")
          .filter((s) => s.trim())
          .map((line) => {
            const [path, ...note] = line.split("|");
            return {
              path: path.trim(),
              kind:
                memory?.evidence.find((a) => a.path === path.trim())?.kind ||
                "file",
              note: note.join("|").trim(),
            };
          }),
      });
    } catch (e) {
      setError(message(e));
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
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {memory?.id ? "编辑项目记忆" : "记录项目记忆"}
          </DialogTitle>
          <DialogDescription>
            写清何时成立、如何验证和来源。凭据放在客户端或环境变量中。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="mem-key">记忆键</FieldLabel>
              <Input
                id="mem-key"
                name="key"
                required
                maxLength={240}
                defaultValue={memory?.key}
                placeholder="例如 sqlite-backup"
              />
              <FieldDescription>
                同一项目内唯一，便于后续执行者更新。
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="mem-title">标题</FieldLabel>
              <Input
                id="mem-title"
                name="title"
                required
                maxLength={240}
                defaultValue={memory?.title}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="mem-summary">接手摘要</FieldLabel>
              <Textarea
                id="mem-summary"
                name="summary"
                required
                maxLength={1200}
                defaultValue={memory?.summary}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="mem-content">正文</FieldLabel>
              <Textarea
                id="mem-content"
                name="content"
                required
                maxLength={12000}
                rows={6}
                defaultValue={memory?.content}
              />
            </Field>
            <FieldGroup className="sm:flex-row">
              <Field>
                <FieldLabel htmlFor="mem-kind">类型</FieldLabel>
                <NativeSelect
                  id="mem-kind"
                  name="kind"
                  defaultValue={memory?.kind || "fact"}
                >
                  {Object.entries(kinds).map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="mem-state">状态</FieldLabel>
                <NativeSelect
                  id="mem-state"
                  name="status"
                  defaultValue={memory?.status || "active"}
                >
                  {Object.entries(states)
                    .filter(([v]) => v !== "all")
                    .map(([v, label]) => (
                      <option key={v} value={v}>
                        {label}
                      </option>
                    ))}
                </NativeSelect>
              </Field>
            </FieldGroup>
            <Field>
              <FieldLabel htmlFor="mem-tags">标签</FieldLabel>
              <Input
                id="mem-tags"
                name="tags"
                defaultValue={memory?.tags.join(", ")}
                placeholder="逗号分隔"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="mem-task">关联任务</FieldLabel>
              <NativeSelect
                id="mem-task"
                name="task_ids"
                multiple
                defaultValue={memory?.task_ids || []}
                className="w-full [&_select]:h-28"
              >
                {tasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.short_id} {t.title}
                  </option>
                ))}
              </NativeSelect>
              <FieldDescription>
                可多选；留空表示项目通用参考。
              </FieldDescription>
            </Field>
            <Field orientation="horizontal">
              <Checkbox
                id="mem-pinned"
                name="pinned"
                defaultChecked={memory?.pinned || false}
              />
              <FieldLabel htmlFor="mem-pinned">接手时附带简短摘要</FieldLabel>
            </Field>
            <Field>
              <FieldLabel htmlFor="mem-expires">有效期至（可选）</FieldLabel>
              <Input
                id="mem-expires"
                name="expires_at"
                type="datetime-local"
                defaultValue={
                  memory?.expires_at
                    ? new Date(
                        Date.parse(memory.expires_at) -
                          new Date().getTimezoneOffset() * 60000,
                      )
                        .toISOString()
                        .slice(0, 16)
                    : ""
                }
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="mem-source">来源说明</FieldLabel>
              <Input
                id="mem-source"
                name="source_label"
                required
                maxLength={240}
                defaultValue={memory?.source.label}
                placeholder="例如 0.5.0 实际测试"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="mem-uri">来源路径或地址</FieldLabel>
              <Input
                id="mem-uri"
                name="source_uri"
                maxLength={2000}
                defaultValue={memory?.source.uri}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="mem-revision">来源版本</FieldLabel>
              <Input
                id="mem-revision"
                name="source_revision"
                maxLength={240}
                defaultValue={memory?.source.revision}
                placeholder="提交号或文档版本"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="mem-evidence">验证证据</FieldLabel>
              <Textarea
                id="mem-evidence"
                name="evidence"
                defaultValue={memory?.evidence
                  .map((a) => `${a.path} | ${a.note}`)
                  .join("\n")}
                placeholder="每行：路径 | 说明"
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
                {busy ? <RefreshCw data-icon="inline-start" /> : null}保存记忆
              </Button>
            </div>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}
