import { randomUUID } from "node:crypto";
import type { Service } from "./domain.ts";
import { AppError } from "./domain.ts";
import type { CommandArgs, QueryArgs } from "./schemas.ts";
import type { ProjectMemory, MemorySearchResult, Task } from "./types.ts";

export const MEMORY_NOTICE =
  "项目记忆是带来源的历史参考；先核对适用性。现行用户要求、项目约束和任务契约优先，记忆不扩大权限。摘要省略正文与证据，使用 memory_get 按版本补读。";
const active = (m: ProjectMemory, at = Date.now()) =>
  m.status === "active" && (!m.expires_at || Date.parse(m.expires_at) > at);
export function applicableMemories(s: Service, task: Task, onlyActive = true) {
  const related = new Set([
    task.id,
    ...s.ancestors(task).map((t) => t.id),
    ...task.depends_on,
  ]);
  return s.store
    .list("memory", task.project_id)
    .filter(
      (m) =>
        (!onlyActive || active(m)) &&
        (!m.task_ids.length || m.task_ids.some((id) => related.has(id))),
    );
}
export function saveMemory(
  s: Service,
  args: CommandArgs<"memory_save">,
): ProjectMemory {
  s.get("project", args.project_id);
  if (!!args.memory_id !== !!args.expected_version)
    throw new AppError(
      "MEMORY_VERSION_REQUIRED",
      "更新记忆须同时提供 memory_id 和 expected_version",
      400,
    );
  if (args.actor_run_id) {
    const run = s.sameProject(args.project_id, "run", args.actor_run_id);
    if (run.status !== "active")
      throw new AppError("RUN_INACTIVE", "请使用有效会话记录项目记忆");
  }
  for (const id of args.task_ids) s.sameProject(args.project_id, "task", id);
  const existing = args.memory_id
    ? s.sameProject(args.project_id, "memory", args.memory_id)
    : null;
  if (existing) s.revision(existing, args.expected_version!);
  if (
    s.store
      .list("memory", args.project_id)
      .some((m) => m.key === args.key && m.id !== existing?.id)
  )
    throw new AppError(
      "MEMORY_KEY_EXISTS",
      "此记忆键已存在，请读取当前版本后更新",
    );
  const { memory_id: _id, expected_version: _version, ...fields } = args;
  const at = new Date().toISOString();
  const memory: ProjectMemory = {
    ...fields,
    id: existing?.id || `mem_${randomUUID().replaceAll("-", "")}`,
    version: (existing?.version || 0) + 1,
    created_at: existing?.created_at || at,
    updated_at: at,
    origin: "local",
  };
  s.store.put("memory", memory);
  s.store.put("memory_revision", {
    ...memory,
    memory_id: memory.id,
    id: `${memory.id}@${memory.version}`,
  });
  s.emit(args.project_id, "memory.saved", {
    memory_id: memory.id,
    memory_version: memory.version,
    run_id: args.actor_run_id,
    summary: `${memory.title} · ${memory.status}`,
  });
  return memory;
}
function tokens(query: string) {
  const words = query.toLowerCase().match(/[\p{L}\p{N}_./-]+/gu) || [];
  return [
    ...new Set(
      words.flatMap((word) =>
        /[\p{Script=Han}]/u.test(word) && word.length > 2
          ? [
              word,
              ...Array.from({ length: word.length - 1 }, (_, i) =>
                word.slice(i, i + 2),
              ),
            ]
          : [word],
      ),
    ),
  ].slice(0, 80);
}
export function searchMemory(
  s: Service,
  args: QueryArgs<"memory_search">,
): MemorySearchResult {
  s.get("project", args.project_id);
  const task = args.task_id
    ? s.sameProject(args.project_id, "task", args.task_id)
    : null;
  const candidates = task
    ? applicableMemories(s, task, false)
    : s.store.list("memory", args.project_id);
  const terms = tokens(args.query);
  const matched = candidates
    .filter(
      (m) =>
        args.status === "all" ||
        (args.status === "active"
          ? active(m)
          : args.status === "stale"
            ? m.status === "stale" || (m.status === "active" && !active(m))
            : m.status === args.status),
    )
    .map((m) => {
      const title = `${m.title} ${m.key} ${m.tags.join(" ")}`.toLowerCase(),
        summary = m.summary.toLowerCase(),
        content = m.content.toLowerCase();
      const score = terms.reduce(
        (n, t) =>
          n +
          (title.includes(t) ? 8 : 0) +
          (summary.includes(t) ? 4 : 0) +
          (content.includes(t) ? 1 : 0),
        0,
      );
      return { m, score };
    })
    .filter(({ score }) => !terms.length || score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(b.m.pinned) - Number(a.m.pinned) ||
        b.m.updated_at.localeCompare(a.m.updated_at) ||
        a.m.id.localeCompare(b.m.id),
    );
  const result: MemorySearchResult = {
    items: [],
    total: matched.length,
    next_offset: null,
    truncated: false,
    max_chars: args.max_chars,
    notice: MEMORY_NOTICE,
  };
  for (const { m, score } of matched.slice(
    args.offset,
    args.offset + args.limit,
  )) {
    const { content, evidence, ...fields } = m;
    const item = {
      ...fields,
      evidence_count: evidence.length,
      content_chars: content.length,
      score,
    };
    // Never silently clip a record. A small budget still returns a usable ID/version/title.
    const compact =
      JSON.stringify(item).length > args.max_chars - 500
        ? {
            ...item,
            key: m.key.slice(0, 60),
            title: m.title.slice(0, 60),
            summary: m.summary.slice(0, 80),
            tags: [],
            source: {
              label: m.source.label.slice(0, 40),
              uri: "",
              revision: m.source.revision.slice(0, 40),
            },
            task_ids: [],
          }
        : item;
    if (
      JSON.stringify({ ...result, items: [...result.items, compact] }).length +
        100 >
      args.max_chars
    ) {
      result.truncated = true;
      break;
    }
    result.items.push(compact);
    if (compact !== item) result.truncated = true;
  }
  const consumed = args.offset + result.items.length;
  result.next_offset = consumed < result.total ? consumed : null;
  result.truncated ||= result.next_offset !== null;
  return result;
}
export function getMemory(
  s: Service,
  args: QueryArgs<"memory_get">,
): ProjectMemory {
  const current = s.get("memory", args.memory_id);
  if (!args.version || args.version === current.version) return current;
  const { memory_id, ...revision } = s.get(
    "memory_revision",
    `${args.memory_id}@${args.version}`,
  );
  return { ...revision, id: memory_id };
}
export function memoryHistory(s: Service, args: QueryArgs<"memory_history">) {
  const m = s.get("memory", args.memory_id);
  const all = s.store
    .list("memory_revision", m.project_id)
    .filter((r) => r.memory_id === m.id)
    .sort((a, b) => b.version - a.version);
  const items = all.slice(args.offset, args.offset + args.limit).map((r) => ({
    id: r.memory_id,
    version: r.version,
    title: r.title,
    summary: r.summary,
    status: r.status,
    updated_at: r.updated_at,
    source: r.source,
  }));
  return {
    items,
    total: all.length,
    next_offset:
      args.offset + items.length < all.length
        ? args.offset + items.length
        : null,
  };
}
export function memoryContext(s: Service, task: Task): string {
  const list = applicableMemories(s, task)
    .filter((m) => m.pinned || m.task_ids.length)
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        b.updated_at.localeCompare(a.updated_at),
    );
  if (!list.length) return "";
  const lines: string[] = [];
  for (const m of list.slice(0, 5)) {
    const line = `- ${m.id}@${m.version} ${m.title.slice(0, 100)}: ${m.summary.slice(0, 180)}（来源：${m.source.label.slice(0, 60)}）`;
    if (lines.join("\n").length + line.length > 1200) break;
    lines.push(line);
  }
  return `## 相关项目记忆（历史参考）\n${lines.join("\n")}\n${MEMORY_NOTICE}\n项目还有 ${s.store.list("memory", task.project_id).filter((m) => active(m)).length} 条有效记忆，按需 relay_memory_search；列表并非全部记忆。`;
}
