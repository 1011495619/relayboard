import { randomUUID, createHash } from "node:crypto";
import { resolve, posix, isAbsolute, dirname, basename } from "node:path";
import { realpathSync } from "node:fs";
import {
  workGuide,
  relevantDecisions,
  relatedTasks,
  dependencies,
  dependencyItems,
  requirementsSignature,
  recoverySignature,
  needsRecovery,
  emptyWorkflow,
  planSignature,
  artifactRevision,
  evidenceStale,
  pendingRequests,
} from "./workflow.ts";
import { observeWorkspace } from "./workspace.ts";
import { commands, queries } from "./schemas.ts";
import type {
  CommandName,
  CommandArgs,
  CommandInput,
  QueryName,
  QueryArgs,
  QueryInput,
  TaskFields,
} from "./schemas.ts";
import type { Store } from "./store.ts";
import type {
  RecordKind,
  RecordMap,
  VersionedRecord,
  Task,
  Run,
  RelayEvent,
  ScopeConflict,
  Eligibility,
  CommandResults,
  QueryResults,
  ContextPacket,
  Project,
  Agent,
  SplitProposal,
  ScopeProposal,
} from "./types.ts";

const ACTIVE = new Set(["doing", "blocked", "review", "reconcile"]);
const now = () => new Date().toISOString();
const uid = (prefix: string) =>
  `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
const subset = (child: string, parent: string) =>
  parent === "." || child === parent || child.startsWith(`${parent}/`);
export const overlaps = (a: string, b: string) => subset(a, b) || subset(b, a);
const canonical = (p: string): string => {
  try {
    return realpathSync.native(resolve(p));
  } catch {
    const absolute = resolve(p),
      parent = dirname(absolute);
    return parent === absolute
      ? absolute
      : resolve(canonical(parent), basename(absolute));
  }
};
const cap = (s: unknown, n = 2000) => String(s || "").slice(0, n);

export class AppError extends Error {
  code: string;
  status: number;
  details: unknown;
  constructor(
    code: string,
    message: string,
    status = 409,
    details: unknown = undefined,
  ) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
function ensure(
  ok: unknown,
  code: string,
  message: string,
  details?: unknown,
): asserts ok {
  if (!ok) throw new AppError(code, message, 409, details);
}
function runIdPresent(id: string | null): id is string {
  return id !== null;
}
function scopePath(s: string) {
  ensure(
    !s.includes("\\") &&
      !isAbsolute(s) &&
      !s.split("/").includes("..") &&
      !s.includes("\0"),
    "INVALID_SCOPE",
    "修改范围须使用项目内的相对路径，且不含 ..",
  );
  return posix.normalize(s).replace(/\/$/, "") || ".";
}

export class Service {
  readonly store: Store;
  readonly listeners: Set<(event: RelayEvent) => void>;
  constructor(store: Store) {
    this.store = store;
    this.listeners = new Set();
  }
  get<K extends RecordKind>(kind: K, id: string): RecordMap[K] {
    const item = this.store.get(kind, id);
    if (!item) throw new AppError("NOT_FOUND", `${kind} ${id} 不存在`, 404);
    return item;
  }
  sameProject<K extends RecordKind>(
    project: string,
    kind: K,
    id: string,
  ): RecordMap[K] {
    const item = this.get(kind, id);
    ensure(
      (item.project_id || item.id) === project,
      "PROJECT_MISMATCH",
      "相关记录须属于同一项目",
    );
    return item;
  }
  update<K extends RecordKind>(
    kind: K,
    item: RecordMap[K],
    fields: Partial<RecordMap[K]>,
  ): RecordMap[K] {
    return this.store.put(kind, {
      ...item,
      ...fields,
      version: item.version + 1,
      updated_at: now(),
    });
  }
  revision(item: VersionedRecord, version: number) {
    ensure(
      item.version === version,
      "STALE_VERSION",
      "任务已更新，请刷新后重试",
      { current_version: item.version },
    );
  }
  emit(project: string, type: string, fields: Record<string, unknown> = {}) {
    const event = this.store.event({
      id: uid("evt"),
      project_id: project,
      type,
      at: now(),
      ...fields,
    });
    this.store.afterCommit(() => {
      for (const listener of this.listeners) listener(event);
    });
    return event;
  }
  task(id: string) {
    return this.get("task", id);
  }
  tasks(project: string) {
    return this.store.list("task", project);
  }
  run(id: string | null) {
    ensure(runIdPresent(id), "NOT_FOUND", "执行会话不存在");
    return this.get("run", id);
  }
  actor(task: Task, runId?: string) {
    if (runId) {
      this.sameProject(task.project_id, "run", runId);
      ensure(
        !task.owner_run_id || task.owner_run_id === runId,
        "NOT_OWNER",
        "此操作须由任务负责人处理；其他执行者可以提出协作请求",
      );
    }
  }
  currentClaim(
    task: Task,
    args: { run_id: string; claim_epoch: number },
    allowReconcile = false,
  ) {
    ensure(
      task.owner_run_id === args.run_id &&
        task.claim_epoch === args.claim_epoch,
      "STALE_CLAIM",
      "执行权已经变化，请重新读取交接包",
      { owner_run_id: task.owner_run_id, claim_epoch: task.claim_epoch },
    );
    const run = this.run(args.run_id);
    ensure(
      run.status === "active",
      "RUN_INACTIVE",
      "请先恢复或登记有效执行会话",
    );
    ensure(ACTIVE.has(task.status), "NOT_ACTIVE", "任务当前未处于执行状态");
    if (!allowReconcile)
      ensure(
        task.status !== "reconcile",
        "RECONCILE_REQUIRED",
        "接手后请先核对文件、进程和成果，再继续执行",
      );
    return run;
  }
  ancestors(task: Task) {
    const result = [];
    let p = task;
    while (p.parent_id) {
      p = this.task(p.parent_id);
      result.push(p);
    }
    return result;
  }
  runDescendants(runId: string) {
    const root = this.run(runId),
      runs = this.store.list("run", root.project_id),
      ids = new Set([runId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const r of runs)
        if (
          r.parent_run_id !== null &&
          ids.has(r.parent_run_id) &&
          !ids.has(r.id)
        ) {
          ids.add(r.id);
          changed = true;
        }
    }
    return runs.filter((r) => r.id !== runId && ids.has(r.id));
  }
  activeDescendants(task: Task) {
    return this.tasks(task.project_id).filter(
      (t) =>
        t.id !== task.id &&
        this.ancestors(t).some((p) => p.id === task.id) &&
        ACTIVE.has(t.status),
    );
  }
  normalizeTask<T extends TaskFields>(fields: T): T {
    const task = {
      ...fields,
      scopes: [...new Set(fields.scopes.map(scopePath))],
      resources: [...new Set(fields.resources)],
      depends_on: [...new Set(fields.depends_on)],
    };
    ensure(
      task.read_only || task.scopes.length > 0 || task.resources.length > 0,
      "SCOPE_REQUIRED",
      "写入任务需要明确修改范围；纯研究任务可标记为只读",
    );
    ensure(
      !task.read_only || (!task.scopes.length && !task.resources.length),
      "READ_ONLY_SCOPE",
      "只读任务不应申请写入范围或独占资源",
    );
    return task;
  }
  validateTask(task: Task) {
    const project = task.project_id;
    for (const dep of task.depends_on) {
      ensure(dep !== task.id, "DEPENDENCY_CYCLE", "任务不能依赖自身");
      this.sameProject(project, "task", dep);
    }
    if (task.parent_id) {
      const parent = this.sameProject(project, "task", task.parent_id);
      ensure(
        parent.id !== task.id &&
          !this.ancestors(parent).some((p) => p.id === task.id),
        "TASK_CYCLE",
        "任务层级出现循环",
      );
      ensure(
        !["done", "review"].includes(parent.status),
        "PARENT_CLOSED",
        "父任务已交付，请先调整父任务状态",
      );
      ensure(
        parent.mode === "coordinator",
        "PARENT_EXECUTING",
        "请先拆分父任务，明确协调与执行范围",
      );
      ensure(
        task.scopes.every((c) => parent.scopes.some((p) => subset(c, p))),
        "OUTSIDE_PARENT_SCOPE",
        "子任务的修改范围超出父任务，请先协调父任务范围",
      );
      ensure(
        task.resources.every((r) => parent.resources.includes(r)),
        "OUTSIDE_PARENT_RESOURCE",
        "子任务的共享资源超出父任务约定",
      );
    }
    const graph = new Map(this.tasks(project).map((t) => [t.id, t]));
    graph.set(task.id, task);
    const visit = (
      id: string,
      stack = new Set<string>(),
      done = new Set<string>(),
    ): void => {
      ensure(!stack.has(id), "DEPENDENCY_CYCLE", "依赖关系形成循环");
      if (done.has(id)) return;
      stack.add(id);
      const t = graph.get(id);
      const deps = [
        ...(t?.depends_on || []),
        ...[...graph.values()]
          .filter((c) => c.parent_id === id)
          .map((c) => c.id),
      ];
      for (const d of deps) visit(d, stack, done);
      stack.delete(id);
      done.add(id);
    };
    const done = new Set<string>();
    for (const id of graph.keys()) visit(id, new Set(), done);
  }
  conflicts(task: Task, run: Run, ignoreId = task.id): ScopeConflict[] {
    if (task.mode === "coordinator" || task.read_only) return [];
    const result = [];
    for (const other of this.tasks(task.project_id)) {
      if (
        other.id === ignoreId ||
        !ACTIVE.has(other.status) ||
        other.mode === "coordinator" ||
        other.read_only
      )
        continue;
      const otherRun = this.run(other.owner_run_id);
      const resource = task.resources.find((r) => other.resources.includes(r));
      // Missing workspace metadata is conservative: compare logical ranges. Different actual worktrees isolate file writes.
      const logical = !run.workdir || !otherRun.workdir;
      const scopes = task.scopes.flatMap((a) =>
        other.scopes
          .filter((b) =>
            logical
              ? overlaps(a, b)
              : overlaps(
                  canonical(resolve(run.workdir, a)),
                  canonical(resolve(otherRun.workdir, b)),
                ),
          )
          .map((b) => `${a} ↔ ${b}`),
      );
      if (resource || scopes.length)
        result.push({
          task_id: other.id,
          short_id: other.short_id,
          run_id: other.owner_run_id,
          resource,
          scopes,
        });
    }
    return result;
  }
  eligibility(task: Task, run: Run): Eligibility {
    const reasons = [],
      warnings = [];
    if (run.project_id !== task.project_id) reasons.push("执行者属于其他项目");
    if (run.status !== "active") reasons.push("执行会话尚未恢复");
    if (task.status !== "pending")
      reasons.push(task.owner_run_id ? "已有执行者负责" : "任务当前不可领取");
    for (const dep of task.depends_on)
      if (this.task(dep).status !== "done")
        reasons.push(`等待 ${this.task(dep).short_id} 完成验收`);
    for (const parent of this.ancestors(task)) {
      if (parent.status === "reconcile")
        reasons.push(`父任务 ${parent.short_id} 正在交接核验`);
      if (parent.status === "done") reasons.push("父任务已关闭");
      for (const dep of parent.depends_on)
        if (this.task(dep).status !== "done")
          reasons.push(
            `上层 ${parent.short_id} 等待 ${this.task(dep).short_id} 验收`,
          );
    }
    const missing = task.required_capabilities.filter(
      (c) => !run.capabilities.includes(c),
    );
    if (missing.length) reasons.push(`缺少能力：${missing.join("、")}`);
    if (
      !task.read_only &&
      !task.scopes.every((c) => run.delegated_scopes.some((p) => subset(c, p)))
    )
      reasons.push("超出此执行者获委派的修改范围");
    const conflicts = this.conflicts(task, run);
    for (const c of conflicts)
      reasons.push(
        `与 ${c.short_id} 冲突：${c.resource || c.scopes.join("、")}`,
      );
    const project = this.get("project", task.project_id);
    const activeRuns = new Set(
      this.tasks(task.project_id)
        .filter((t) => ACTIVE.has(t.status))
        .map((t) => t.owner_run_id),
    );
    for (const r of this.store.list("run", task.project_id))
      if (r.process?.status === "running") activeRuns.add(r.id);
    if (!activeRuns.has(run.id) && activeRuns.size >= project.max_concurrency)
      reasons.push("项目并发预算已满");
    if (task.mode === "coordinator")
      warnings.push("此任务负责协调；具体修改请建立或领取子任务");
    if (!run.workdir && !task.read_only)
      warnings.push("未登记工作目录，按共享工作区保守检查冲突");
    if (Date.now() - Date.parse(run.last_seen_at) > 120000)
      warnings.push("执行者最近心跳较早，请确认当前会话仍然有效");
    const category =
      reasons.length === 0
        ? "ready"
        : task.status === "doing" && task.mode === "execute"
          ? "negotiate"
          : "waiting";
    return {
      task_id: task.id,
      eligible: !reasons.length,
      category,
      reasons,
      warnings,
      conflicts,
    };
  }
  execute<K extends string>(
    op: K,
    input: K extends CommandName ? NoInfer<CommandInput<K>> : unknown,
    requestId?: string,
  ): K extends CommandName ? CommandResults[K] : CommandResults[CommandName];
  execute(
    op: string,
    input: unknown = {},
    requestId?: string,
  ): CommandResults[CommandName] {
    const command = commands[op as CommandName];
    if (!command) throw new AppError("UNKNOWN_COMMAND", `未知操作 ${op}`, 400);
    const args = command.schema.parse(input);
    const digest = createHash("sha256")
      .update(JSON.stringify({ op, args }))
      .digest("hex");
    const result = this.store.transaction(() => {
      if (requestId) {
        ensure(requestId.length <= 160, "INVALID_REQUEST_ID", "请求标识过长");
        const cached = this.store.receipt(requestId);
        if (cached) {
          ensure(
            cached.digest === digest,
            "IDEMPOTENCY_MISMATCH",
            "相同请求标识对应了不同内容",
          );
          return JSON.parse(cached.body);
        }
      }
      // The schema and handler are selected by the same checked operation key.
      const handler = this[op as CommandName] as (
        value: typeof args,
      ) => CommandResults[CommandName];
      const result = handler.call(this, args);
      if (requestId) this.store.saveReceipt(requestId, digest, result);
      return result;
    });
    return result;
  }
  query<K extends string>(
    name: K,
    ...args: K extends QueryName
      ? {} extends QueryInput<K>
        ? [input?: NoInfer<QueryInput<K>>]
        : [input: NoInfer<QueryInput<K>>]
      : [input?: unknown]
  ): K extends QueryName ? QueryResults[K] : QueryResults[QueryName];
  query(name: string, input: unknown = {}): QueryResults[QueryName] {
    const schema = queries[name as QueryName];
    if (!schema) throw new AppError("UNKNOWN_QUERY", `未知查询 ${name}`, 400);
    if (name === "work_requests") {
      const args = queries.work_requests.parse(input),
        task = this.task(args.task_id),
        all = pendingRequests(this, task);
      const items = all.slice(args.offset, args.offset + args.limit);
      return {
        items,
        total: all.length,
        next_offset:
          args.offset + items.length < all.length
            ? args.offset + items.length
            : null,
      };
    }
    if (name === "work_dependencies") {
      const args = queries.work_dependencies.parse(input),
        task = this.task(args.task_id);
      const items = dependencyItems(this, task, args.offset, args.limit),
        total = dependencies(this, task).length;
      return {
        items,
        total,
        next_offset:
          args.offset + items.length < total
            ? args.offset + items.length
            : null,
      };
    }
    if (name === "work_next") {
      const args = queries.work_next.parse(input);
      return workGuide(
        this,
        args.run_id,
        this.task(args.task_id),
        args.max_chars,
      );
    }
    if (name === "project")
      return this.get("project", queries.project.parse(input).project_id);
    if (name === "decisions") {
      const args = queries.decisions.parse(input);
      this.get("project", args.project_id);
      const task = args.task_id
        ? this.sameProject(args.project_id, "task", args.task_id)
        : null;
      const all = task
        ? relevantDecisions(this, task)
        : this.store.list("decision", args.project_id);
      const items = all.slice(args.offset, args.offset + args.limit);
      return {
        items,
        total: all.length,
        next_offset:
          args.offset + items.length < all.length
            ? args.offset + items.length
            : null,
      };
    }
    if (name === "projects") {
      queries.projects.parse(input);
      return this.store.list("project").map((p) => ({
        ...p,
        task_count: this.tasks(p.id).length,
        done_count: this.tasks(p.id).filter((t) => t.status === "done").length,
      }));
    }
    if (name === "snapshot") {
      const args = queries.snapshot.parse(input);
      const project = this.get("project", args.project_id);
      const pendingRequests = this.store
        .list("message", project.id)
        .filter(
          (m) =>
            ["request", "blocker"].includes(m.kind) &&
            !m.resolved_at &&
            !m.system,
        );
      const request_counts: Record<string, number> = {};
      for (const message of pendingRequests)
        request_counts[message.task_id || "project"] =
          (request_counts[message.task_id || "project"] || 0) + 1;
      return {
        attention: {
          requests_total: pendingRequests.length,
          request_counts,
          recovery_task_ids: this.tasks(project.id)
            .filter(
              (t) =>
                ACTIVE.has(t.status) &&
                t.status !== "review" &&
                needsRecovery(this, t),
            )
            .map((t) => t.id),
        },
        project,
        tasks: this.tasks(project.id),
        agents: this.store.list("agent", project.id),
        runs: this.store.list("run", project.id).map((r) => ({
          ...r,
          liveness:
            r.status !== "active"
              ? r.status
              : Date.now() - Date.parse(r.last_seen_at) > 120000
                ? "unconfirmed"
                : "reported",
        })),
        messages: this.store.list("message", project.id).slice(-100),
        decisions: this.store.list("decision", project.id),
        proposals: this.store.list("proposal", project.id),
        events: this.store.events(project.id, 0, 80, true),
      };
    }
    if (name === "task") {
      const args = queries.task.parse(input);
      const task = this.task(args.task_id);
      return {
        ...task,
        children: this.tasks(task.project_id).filter(
          (t) => t.parent_id === task.id,
        ),
        ancestors: this.ancestors(task).map((p) => ({
          id: p.id,
          title: p.title,
          owner_run_id: p.owner_run_id,
        })),
        messages: this.store
          .list("message", task.project_id)
          .filter((m) => m.task_id === task.id)
          .slice(-30),
        proposals: this.store
          .list("proposal", task.project_id)
          .filter((p) => p.task_id === task.id),
      };
    }
    if (name === "eligible") {
      const args = queries.eligible.parse(input);
      const run = this.sameProject(args.project_id, "run", args.run_id);
      return this.tasks(args.project_id)
        .filter((t) => t.status !== "done")
        .map((t) => ({ task: t, ...this.eligibility(t, run) }))
        .sort((a, b) => Number(b.eligible) - Number(a.eligible));
    }
    if (name === "events") {
      const args = queries.events.parse(input);
      this.get("project", args.project_id);
      return this.store.events(args.project_id, args.after, args.limit);
    }
    if (name === "inbox") {
      const args = queries.inbox.parse(input);
      const run = this.run(args.run_id);
      return this.store
        .list("message", run.project_id)
        .filter(
          (m) =>
            m.to_run_id === run.id && (!args.unread_only || !m.acknowledged_at),
        )
        .slice(-args.limit);
    }
    if (name === "context") return this.context(queries.context.parse(input));
    throw new AppError("UNKNOWN_QUERY", `未知查询 ${name}`, 400);
  }
  assertGuidedReady(task: Task) {
    if (!task.workflow && !task.execution) return;
    ensure(
      !needsRecovery(this, task),
      "RECOVERY_REQUIRED",
      "当前任务需要重新核对现场与契约，请读取 relay_work_next",
    );
    ensure(
      !task.workflow?.uncertain_actions.length,
      "UNCERTAIN_ACTIONS",
      "先核实待定操作再提交",
    );
    ensure(
      !task.execution ||
        task.execution.steps.every((step) =>
          task.workflow?.completed_steps.includes(step.id),
        ),
      "STEPS_INCOMPLETE",
      "先完成有序执行步骤",
    );
    ensure(
      !!task.execution || task.workflow?.ready_for_verification,
      "NOT_READY_FOR_VERIFICATION",
      "请明确记录实现已准备验证",
    );
  }
  message_resolve(
    args: CommandArgs<"message_resolve">,
  ): CommandResults["message_resolve"] {
    const message = this.get("message", args.message_id),
      run = args.run_id
        ? this.sameProject(message.project_id, "run", args.run_id)
        : null;
    ensure(
      !run || run.status === "active",
      "RUN_INACTIVE",
      "请使用有效执行会话处理请求",
    );
    const task = message.task_id ? this.task(message.task_id) : null;
    ensure(
      !run ||
        message.to_run_id === run.id ||
        task?.owner_run_id === run.id ||
        (!!task && this.ancestors(task).some((p) => p.owner_run_id === run.id)),
      "NOT_RECIPIENT",
      "仅收件人、当前任务负责人或上层协调者处理请求",
    );
    ensure(
      ["request", "blocker"].includes(message.kind),
      "NOT_REQUEST",
      "此消息不是待处理请求",
    );
    if (message.resolved_at) return message;
    const result = this.update("message", message, {
      resolved_at: now(),
      resolved_by: run?.id || "human",
      resolution: args.note,
    });
    this.emit(message.project_id, "message.resolved", {
      task_id: message.task_id,
      run_id: run?.id,
      message_id: message.id,
      summary: args.note,
    });
    return result;
  }
  work_start(args: CommandArgs<"work_start">): CommandResults["work_start"] {
    const run = this.run(args.run_id);
    ensure(run.status === "active", "RUN_INACTIVE", "请登记新的有效执行会话");
    let task = args.task_id
      ? this.sameProject(run.project_id, "task", args.task_id)
      : this.tasks(run.project_id).find(
          (t) => t.owner_run_id === run.id && ACTIVE.has(t.status),
        );
    if (!task && !args.task_id)
      task = this.query("eligible", {
        project_id: run.project_id,
        run_id: run.id,
      }).find((e) => e.eligible && e.task.mode === "execute")?.task;
    if (task?.status === "pending")
      task = this.task_claim({
        task_id: task.id,
        run_id: run.id,
        expected_version: task.version,
      });
    return workGuide(this, run.id, task || null);
  }
  work_report(args: CommandArgs<"work_report">): CommandResults["work_report"] {
    let task = this.task(args.handle.task_id);
    const run = this.currentClaim(task, args.handle, true);
    this.revision(task, args.handle.task_version);
    ensure(
      args.handle.context_version === recoverySignature(this, task),
      "CONTEXT_CHANGED",
      "契约或依赖已变化；请先 relay_work_next 读取当前指引",
      {
        next_action: {
          tool: "relay_work_next",
          arguments: { task_id: task.id, run_id: run.id },
        },
      },
    );
    ensure(
      task.status !== "review",
      "ALREADY_SUBMITTED",
      "成果已提交，请等待独立验收",
    );
    const old = task.workflow || emptyWorkflow(task);
    let workflow = { ...old };
    if (args.kind === "recover") {
      ensure(
        args.observed,
        "OBSERVATION_REQUIRED",
        "先核对实际目录、分支、改动、进程和接收成果，再填写 observed",
      );
      const decisions = relevantDecisions(this, task);
      const missing = decisions.filter(
        (d) => !args.read_decision_ids?.includes(d.id),
      );
      ensure(
        !missing.length,
        "CONTRACTS_UNREAD",
        "请完整读取相关契约并提供 read_decision_ids",
        {
          decision_ids: missing.map((d) => d.id),
          query: {
            tool: "relay_decisions",
            arguments: {
              project_id: task.project_id,
              task_id: task.id,
              offset: 0,
            },
          },
        },
      );
      const receipts = args.dependency_receipts || [];
      const unreceived = dependencies(this, task).filter(
        (d) =>
          d.status !== "done" ||
          !receipts.some(
            (r) => r.task_id === d.id && r.revision === artifactRevision(d),
          ),
      );
      ensure(
        !unreceived.length,
        "DEPENDENCIES_NOT_RECEIVED",
        "请先核实前置成果已进入当前工作区，再按当前 revision 报告 dependency_receipts",
        {
          task_ids: unreceived.map((d) => d.id),
          query: {
            tool: "relay_work_dependencies",
            arguments: { task_id: task.id, offset: 0, limit: 20 },
          },
        },
      );
      if (task.status === "reconcile")
        task = this.task_reconcile({
          task_id: task.id,
          run_id: run.id,
          claim_epoch: task.claim_epoch,
          observed: args.observed,
          next_step: args.next_step || "按执行指引继续",
        });
      workflow = {
        ...old,
        recovered_epoch: task.claim_epoch,
        recovered_signature: recoverySignature(this, task),
        recovered_at: now(),
        observed: args.observed,
        plan_signature: requirementsSignature(this, task),
        completed_steps:
          old.plan_signature === requirementsSignature(this, task)
            ? old.completed_steps
            : [],
        dependency_receipts: receipts,
        ready_for_verification:
          old.plan_signature === requirementsSignature(this, task) &&
          old.ready_for_verification,
      };
    } else {
      ensure(
        args.kind === "blocked" || !needsRecovery(this, task),
        "RECOVERY_REQUIRED",
        "先使用 relay_work_next 读取并完成 recover 核验",
        {
          next_action: {
            tool: "relay_work_next",
            arguments: { task_id: task.id, run_id: run.id },
          },
        },
      );
      ensure(
        task.status !== "blocked" ||
          ["progress", "blocked"].includes(args.kind),
        "BLOCKER_UNRESOLVED",
        "请先通过 progress 报告阻塞解决依据",
      );
      ensure(
        !old.uncertain_actions.length ||
          ["progress", "blocked"].includes(args.kind),
        "UNCERTAIN_ACTIONS",
        "先核实结果待定操作，progress 中显式报告剩余 uncertain_actions",
      );
      if (args.kind === "step") {
        const next = task.execution?.steps.find(
          (step) => !old.completed_steps.includes(step.id),
        );
        ensure(
          next && next.id === args.step_id,
          "STEP_ORDER",
          "只完成当前有序步骤；先读取 relay_work_next",
          { step_id: next?.id },
        );
        workflow.completed_steps = [...old.completed_steps, next.id];
        workflow.ready_for_verification =
          workflow.completed_steps.length === task.execution?.steps.length;
      }
      if (args.kind === "verify" || args.kind === "submit") {
        ensure(
          !task.execution ||
            task.execution.steps.every((step) =>
              old.completed_steps.includes(step.id),
            ),
          "STEPS_INCOMPLETE",
          "先完成当前有序步骤",
        );
        ensure(
          !!task.execution || old.ready_for_verification,
          "NOT_READY_FOR_VERIFICATION",
          "完成实现后通过 progress 设置 ready_for_verification: true",
        );
        ensure(
          this.tasks(task.project_id)
            .filter((t) => t.parent_id === task.id)
            .every((t) => t.status === "done"),
          "CHILDREN_INCOMPLETE",
          "先完成所有子任务验收再验证集成",
        );
      }
      if (args.kind === "verify")
        ensure(
          args.verification?.length,
          "VERIFICATION_REQUIRED",
          "运行检查后报告 verification 的命令、实际结果与 passed；此工具不执行命令",
        );
      if (args.kind === "submit") {
        // Do not replace a successful verification checkpoint with a summary-only checkpoint.
        task = this.task_submit({
          task_id: task.id,
          run_id: run.id,
          claim_epoch: task.claim_epoch,
          summary: args.summary,
        });
        return workGuide(this, run.id, task);
      }
      if (args.ready_for_verification !== undefined)
        workflow.ready_for_verification = args.ready_for_verification;
    }
    // Explicitly supplied arrays replace working memory so resolved uncertainties can be cleared.
    for (const key of [
      "facts",
      "failed_attempts",
      "uncertain_actions",
    ] as const)
      if (args[key] !== undefined) workflow[key] = args[key];
    const blocker = args.kind === "blocked" ? args.summary : "";
    task = this.task_checkpoint(
      {
        task_id: task.id,
        run_id: run.id,
        claim_epoch: task.claim_epoch,
        summary: args.summary,
        next_step:
          args.next_step ||
          task.execution?.steps.find(
            (step) => !workflow.completed_steps.includes(step.id),
          )?.title ||
          "按 relay_work_next 继续",
        artifacts: args.artifacts || [],
        verification: args.kind === "verify" ? args.verification || [] : [],
        blocker,
      },
      args.kind === "blocked",
    );
    task = this.update("task", task, {
      workflow,
      ...(args.kind === "verify"
        ? { verification: args.verification || [] }
        : {}),
    });
    this.emit(task.project_id, "work.reported", {
      task_id: task.id,
      run_id: run.id,
      kind: args.kind,
      summary: args.summary,
    });
    return workGuide(this, run.id, task);
  }
  project_create(
    args: CommandArgs<"project_create">,
  ): CommandResults["project_create"] {
    const project = {
      ...args,
      id: uid("prj"),
      version: 1,
      created_at: now(),
      updated_at: now(),
    };
    if (project.root_path) project.root_path = canonical(project.root_path);
    this.store.put("project", project);
    this.emit(project.id, "project.created", { summary: project.name });
    return project;
  }
  project_update(
    args: CommandArgs<"project_update">,
  ): CommandResults["project_update"] {
    const p = this.get("project", args.project_id);
    this.revision(p, args.expected_version);
    const { project_id, expected_version, ...fields } = args;
    if (fields.root_path !== undefined && fields.root_path)
      fields.root_path = canonical(fields.root_path);
    const result = this.update("project", p, fields);
    this.emit(p.id, "project.updated", {
      summary: "项目目标或约束已更新",
      fields,
    });
    return result;
  }
  agent_register(
    args: CommandArgs<"agent_register">,
  ): CommandResults["agent_register"] {
    const project = this.get("project", args.project_id);
    let depth = 0,
      delegated = args.delegated_scopes?.map(scopePath) || ["."],
      parent: Run | undefined;
    if (args.parent_run_id) {
      const parentRun = this.sameProject(project.id, "run", args.parent_run_id);
      parent = parentRun;
      ensure(
        parentRun.status === "active",
        "PARENT_INACTIVE",
        "父执行会话当前未激活",
      );
      depth = parentRun.depth + 1;
      ensure(
        depth <= project.max_depth,
        "DEPTH_BUDGET",
        "超过项目子执行者层级预算",
      );
      const assigned = this.tasks(project.id).filter(
        (t) => t.owner_run_id === parentRun.id && ACTIVE.has(t.status),
      );
      const envelope = assigned.length
        ? assigned.flatMap((t) => t.scopes)
        : parentRun.delegated_scopes;
      delegated = args.delegated_scopes?.map(scopePath) || envelope;
      ensure(
        delegated.every(
          (c) =>
            envelope.some((p) => subset(c, p)) &&
            parentRun.delegated_scopes.some((p) => subset(c, p)),
        ),
        "DELEGATION_SCOPE",
        "子执行者的范围超出父执行者当前的委派范围",
      );
    }
    let agent: Agent;
    if (args.agent_id) {
      agent = this.sameProject(project.id, "agent", args.agent_id);
      ensure(
        agent.runtime === args.runtime,
        "AGENT_RUNTIME",
        "同一执行者身份的工具类型应保持一致",
      );
    } else {
      agent = {
        id: uid("agt"),
        project_id: project.id,
        name: args.name,
        runtime: args.runtime,
        parent_agent_id: parent?.agent_id || null,
        version: 1,
        created_at: now(),
      };
      this.store.put("agent", agent);
    }
    const run: Run = {
      id: uid("run"),
      project_id: project.id,
      agent_id: agent.id,
      name: args.name,
      runtime: args.runtime,
      parent_run_id: parent?.id || null,
      depth,
      delegated_scopes: [...new Set(delegated)],
      capabilities: args.capabilities,
      workdir: args.workdir ? canonical(args.workdir) : "",
      branch: args.branch,
      observation: args.observation,
      status: "active",
      last_seen_at: now(),
      last_progress_at: null,
      version: 1,
      created_at: now(),
      process: null,
    };
    this.store.put("run", run);
    this.emit(project.id, "agent.registered", {
      run_id: run.id,
      parent_run_id: run.parent_run_id,
      summary: `${run.name} 已登记（${args.observation}）`,
    });
    return { agent, run };
  }
  run_heartbeat(
    args: CommandArgs<"run_heartbeat">,
  ): CommandResults["run_heartbeat"] {
    const run = this.run(args.run_id);
    ensure(
      run.status !== "ended",
      "SESSION_ENDED",
      "已结束的会话请登记新 Run，保留原身份即可",
    );
    return this.update("run", run, {
      status: "active",
      last_seen_at: now(),
      observation: args.observation,
      observation_note: args.note,
    });
  }
  run_end(args: CommandArgs<"run_end">): CommandResults["run_end"] {
    const run = this.run(args.run_id);
    ensure(
      run.process?.status !== "running",
      "PROCESS_RUNNING",
      "托管进程仍在运行，请先停止进程",
    );
    const result = this.update("run", run, {
      status: args.status,
      status_note: args.note,
    });
    this.emit(run.project_id, `agent.${args.status}`, {
      run_id: run.id,
      summary: args.note,
    });
    if (run.parent_run_id)
      this.systemMessage(
        run.project_id,
        run.parent_run_id,
        undefined,
        `子执行者 ${run.name} 的会话状态为 ${args.status}：${args.note}。原任务归属保留，请核实后处理。`,
      );
    return result;
  }
  run_process_reconcile(
    args: CommandArgs<"run_process_reconcile">,
  ): CommandResults["run_process_reconcile"] {
    const run = this.run(args.run_id);
    ensure(
      run.process?.status === "unknown",
      "PROCESS_STATE",
      "仅对状态未知的原托管进程记录停止核验；仍在托管的进程请使用停止操作",
    );
    const result = this.update("run", run, {
      status: "active",
      observation: "manual",
      last_seen_at: now(),
      process: {
        ...run.process,
        status: "stopped",
        reconciled_at: now(),
        reconciliation: args.observed,
      },
    });
    this.emit(run.project_id, "runner.reconciled", {
      run_id: run.id,
      summary: args.observed,
    });
    return result;
  }
  run_dispatch(
    args: CommandArgs<"run_dispatch">,
  ): CommandResults["run_dispatch"] {
    const run = this.run(args.run_id);
    ensure(
      ["codex", "claude", "pi"].includes(run.runtime) && !!run.workdir,
      "DISPATCH_RUNTIME",
      "自动执行需要可启动的 CLI 工具和实际工作目录",
    );
    ensure(
      !args.enabled ||
        (run.status === "active" && run.process?.status !== "unknown"),
      "PROCESS_UNCONFIRMED",
      "请先核实会话与旧进程状态，再启用自动执行",
    );
    const dispatch = {
      enabled: args.enabled,
      max_launches: args.max_launches,
      launches: 0,
      last_signature: null,
      note: args.note,
      configured_at: now(),
    };
    const result = this.update("run", run, { dispatch });
    this.emit(run.project_id, "dispatch.configured", {
      run_id: run.id,
      summary: `${args.enabled ? "启用" : "关闭"}自动领取与执行：${args.note}`,
    });
    return result;
  }
  newTask(project: string, fields: TaskFields): Task {
    const n = this.tasks(project).length + 1;
    const task = this.normalizeTask<Task>({
      ...fields,
      id: uid("tsk"),
      short_id: `RB-${String(n).padStart(3, "0")}`,
      project_id: project,
      parent_id: fields.parent_id || null,
      status: "pending",
      mode: "execute",
      owner_run_id: null,
      claim_epoch: 0,
      checkpoint: null,
      artifacts: [],
      verification: [],
      version: 1,
      created_at: now(),
      updated_at: now(),
    });
    this.validateTask(task);
    this.store.put("task", task);
    return task;
  }
  task_create(args: CommandArgs<"task_create">): CommandResults["task_create"] {
    const project = this.get("project", args.project_id);
    ensure(
      !args.actor_run_id || project.autonomy !== "manual",
      "HUMAN_PLANNING",
      "此项目采用人工确认分工，请先向负责人提出建议",
    );
    if (args.actor_run_id)
      this.sameProject(args.project_id, "run", args.actor_run_id);
    if (args.parent_id) {
      const p = this.task(args.parent_id);
      this.actor(p, args.actor_run_id);
    }
    const { actor_run_id, ...fields } = args;
    const task = this.newTask(args.project_id, fields);
    this.emit(task.project_id, "task.created", {
      task_id: task.id,
      run_id: actor_run_id,
      summary: task.title,
    });
    return task;
  }
  task_update(args: CommandArgs<"task_update">): CommandResults["task_update"] {
    const task = this.task(args.task_id);
    this.revision(task, args.expected_version);
    ensure(
      !["done", "review", "reconcile"].includes(task.status),
      "TASK_CLOSED",
      "任务当前状态不接受直接修改",
    );
    if (task.owner_run_id) this.actor(task, args.actor_run_id);
    const { task_id, expected_version, actor_run_id, ...fields } = args;
    if (ACTIVE.has(task.status)) {
      ensure(
        !fields.scopes &&
          !fields.resources &&
          !fields.depends_on &&
          !fields.required_capabilities,
        "SCOPE_APPROVAL_REQUIRED",
        "执行中的范围变更请使用范围申请；依赖或能力变更请先交接或释放任务",
      );
    }
    const updated = this.normalizeTask({ ...task, ...fields });
    this.validateTask(updated);
    const result = this.update("task", task, updated);
    if (task.mode === "coordinator")
      for (const child of this.tasks(task.project_id).filter((t) =>
        this.ancestors(t).some((p) => p.id === task.id),
      ))
        this.validateTask(child);
    this.emit(task.project_id, "task.updated", {
      task_id: task.id,
      run_id: actor_run_id,
      summary: "任务要求已更新",
      fields,
    });
    return result;
  }
  task_claim(args: CommandArgs<"task_claim">): CommandResults["task_claim"] {
    const task = this.task(args.task_id);
    this.revision(task, args.expected_version);
    const run = this.sameProject(task.project_id, "run", args.run_id);
    const eligibility = this.eligibility(task, run);
    ensure(
      eligibility.eligible,
      "NOT_ELIGIBLE",
      eligibility.reasons.join("；"),
      eligibility,
    );
    const result = this.update("task", task, {
      status: "doing",
      owner_run_id: run.id,
      claim_epoch: task.claim_epoch + 1,
      claimed_at: now(),
    });
    this.emit(task.project_id, "task.claimed", {
      task_id: task.id,
      run_id: run.id,
      summary: `${run.name} 领取 ${task.short_id}`,
    });
    return result;
  }
  task_checkpoint(
    args: CommandArgs<"task_checkpoint">,
    allowReconcile = false,
  ): CommandResults["task_checkpoint"] {
    const task = this.task(args.task_id),
      run = this.currentClaim(task, args, allowReconcile);
    ensure(
      task.status !== "review",
      "ALREADY_SUBMITTED",
      "已提交的任务请先退回再继续修改",
    );
    const merge = <T, K extends keyof T>(old: T[], added: T[], key: K): T[] => [
      ...new Map([...old, ...added].map((a) => [a[key], a])).values(),
    ];
    const checkpoint = {
      summary: args.summary,
      next_step: args.next_step,
      blocker: args.blocker,
      at: now(),
      run_id: run.id,
      verification_current:
        args.verification.length > 0 &&
        args.verification.every((v) => v.passed),
      required_children_at_checkpoint: this.tasks(task.project_id)
        .filter((t) => t.parent_id === task.id)
        .map((t) => ({ id: t.id, status: t.status, version: t.version })),
    };
    const result = this.update("task", task, {
      checkpoint,
      artifacts: merge(task.artifacts, args.artifacts, "path"),
      verification: merge(task.verification, args.verification, "command"),
      ...(args.verification.length
        ? { evidence: observeWorkspace(run.workdir, task.scopes) }
        : {}),
      status:
        task.status === "reconcile" && allowReconcile
          ? "reconcile"
          : args.blocker
            ? "blocked"
            : "doing",
    });
    this.update("run", run, { last_progress_at: now(), last_seen_at: now() });
    this.emit(task.project_id, "task.checkpoint", {
      task_id: task.id,
      run_id: run.id,
      summary: args.summary,
      next_step: args.next_step,
      blocker: args.blocker,
      artifacts: args.artifacts,
      verification: args.verification,
    });
    const reporting =
      (task.parent_id ? this.task(task.parent_id).owner_run_id : null) ||
      run.parent_run_id;
    if (
      reporting &&
      reporting !== run.id &&
      args.blocker &&
      args.blocker !== task.checkpoint?.blocker
    )
      this.systemMessage(
        task.project_id,
        reporting,
        task.id,
        `${task.short_id} 报告阻塞：${args.blocker}`,
      );
    return result;
  }
  task_submit(args: CommandArgs<"task_submit">): CommandResults["task_submit"] {
    const task = this.task(args.task_id);
    this.assertGuidedReady(task);
    this.currentClaim(task, args);
    ensure(
      ["doing", "blocked"].includes(task.status),
      "SUBMIT_STATE",
      "此任务当前不接受交付",
    );
    ensure(
      task.checkpoint && !task.checkpoint.blocker,
      "CHECKPOINT_REQUIRED",
      "请先保存无阻塞的检查点",
    );
    ensure(
      task.artifacts.length &&
        task.checkpoint.verification_current &&
        task.verification.length &&
        task.verification.every((v) => v.passed),
      "EVIDENCE_REQUIRED",
      "交付需要成果位置和通过的验证记录",
    );
    ensure(
      !evidenceStale(this, task),
      "EVIDENCE_STALE",
      "验证后代码已变化或现场未能完整观察，请重新验证并记录结果",
    );
    const children = this.tasks(task.project_id).filter(
      (t) => t.parent_id === task.id,
    );
    ensure(
      children.every((t) => t.status === "done"),
      "CHILDREN_INCOMPLETE",
      "请先完成所有子任务的验收",
    );
    ensure(
      children.every((t) =>
        task.checkpoint?.required_children_at_checkpoint?.some(
          (c) =>
            c.id === t.id && c.status === "done" && c.version === t.version,
        ),
      ),
      "INTEGRATION_EVIDENCE_REQUIRED",
      "请在子任务全部验收后保存一次通过整体验证的检查点",
    );
    const result = this.update("task", task, {
      status: "review",
      submitted_at: now(),
      submission: args.summary,
    });
    this.emit(task.project_id, "task.submitted", {
      task_id: task.id,
      run_id: args.run_id,
      summary: args.summary,
    });
    const parent = task.parent_id ? this.task(task.parent_id) : null;
    if (parent?.owner_run_id)
      this.systemMessage(
        task.project_id,
        parent.owner_run_id,
        task.id,
        `${task.short_id} 已交付，请核验成果并验收。`,
      );
    return result;
  }
  task_review(args: CommandArgs<"task_review">): CommandResults["task_review"] {
    const task = this.task(args.task_id);
    this.revision(task, args.expected_version);
    ensure(task.status === "review", "NOT_SUBMITTED", "任务尚未提交验收");
    if (args.reviewer_run_id) {
      this.sameProject(task.project_id, "run", args.reviewer_run_id);
      ensure(
        args.reviewer_run_id !== task.owner_run_id,
        "SELF_REVIEW",
        "请由其他执行者或人确认验收",
      );
    }
    if (args.accepted) {
      this.assertGuidedReady(task);
      ensure(
        !evidenceStale(this, task),
        "EVIDENCE_STALE",
        "评审时文件版本已变化，请退回后重新验证",
      );
      const process = this.run(task.owner_run_id).process;
      ensure(
        process?.task_id !== task.id || process.status !== "running",
        "PROCESS_RUNNING",
        "对应的托管执行仍在运行，请等进程退出后确认验收",
      );
      ensure(
        task.verification.length && task.verification.every((v) => v.passed),
        "EVIDENCE_REQUIRED",
        "请核验通过的验证记录",
      );
      ensure(
        this.tasks(task.project_id)
          .filter((t) => t.parent_id === task.id)
          .every((t) => t.status === "done"),
        "CHILDREN_INCOMPLETE",
        "子任务尚未全部完成",
      );
    }
    const result = this.update("task", task, {
      status: args.accepted ? "done" : "doing",
      review: { ...args, at: now() },
      completed_at: args.accepted ? now() : null,
    });
    this.emit(
      task.project_id,
      args.accepted ? "task.accepted" : "task.returned",
      { task_id: task.id, run_id: args.reviewer_run_id, summary: args.note },
    );
    if (args.accepted) {
      const targets = new Set<string>(
        this.tasks(task.project_id)
          .filter((t) => t.depends_on.includes(task.id) && t.owner_run_id)
          .flatMap((t) => (t.owner_run_id ? [t.owner_run_id] : [])),
      );
      const parent = task.parent_id ? this.task(task.parent_id) : null;
      if (parent?.owner_run_id) targets.add(parent.owner_run_id);
      for (const target of targets)
        this.systemMessage(
          task.project_id,
          target,
          task.id,
          `${task.short_id} 已通过验收，请重新检查相关任务的依赖和集成条件。`,
        );
    }
    return result;
  }
  task_split(args: CommandArgs<"task_split">): CommandResults["task_split"] {
    const task = this.task(args.task_id);
    this.revision(task, args.expected_version);
    this.actor(task, args.actor_run_id);
    ensure(
      !args.actor_run_id ||
        this.get("project", task.project_id).autonomy !== "manual",
      "HUMAN_PLANNING",
      "此项目的拆分由人工确认，请提交拆分提议",
    );
    ensure(
      ["pending", "doing", "blocked"].includes(task.status),
      "SPLIT_STATE",
      "当前状态不适合拆分",
    );
    ensure(
      task.mode === "execute",
      "ALREADY_SPLIT",
      "任务已是协调任务，请添加独立子任务",
    );
    ensure(
      !task.owner_run_id ||
        this.run(task.owner_run_id).process?.status !== "running" ||
        args.actor_run_id === task.owner_run_id,
      "PROCESS_RUNNING",
      "托管执行中的任务应由当前执行者保存检查点后拆分",
    );
    const parent = this.update("task", task, {
      mode: "coordinator",
      claim_epoch: task.owner_run_id ? task.claim_epoch + 1 : task.claim_epoch,
      split_rationale: args.rationale,
    });
    const children = args.children.map((fields) =>
      this.newTask(task.project_id, {
        ...fields,
        depends_on: [],
        parent_id: task.id,
      }),
    );
    for (let i = 0; i < children.length; i++) {
      const depends_on = args.children[i].depends_on.map((dep) =>
        dep.startsWith("@") ? children[Number(dep.slice(1))]?.id : dep,
      );
      ensure(
        depends_on.every(Boolean),
        "INVALID_DEPENDENCY",
        "子任务依赖索引不存在",
      );
      children[i] = { ...children[i], depends_on };
      this.validateTask(children[i]);
      this.store.put("task", children[i]);
    }
    this.emit(task.project_id, "task.split", {
      task_id: task.id,
      run_id: args.actor_run_id,
      summary: args.rationale,
      child_ids: children.map((t) => t.id),
    });
    return { parent, children };
  }
  proposal_create(
    args: CommandArgs<"proposal_create">,
  ): CommandResults["proposal_create"] {
    const task = this.task(args.task_id);
    this.revision(task, args.expected_version);
    this.sameProject(task.project_id, "run", args.author_run_id);
    ensure(
      task.mode === "execute" &&
        ["doing", "pending", "blocked"].includes(task.status),
      "SPLIT_STATE",
      "此任务当前不适合提出拆分",
    );
    const proposal: SplitProposal = {
      ...args,
      id: uid("prop"),
      project_id: task.project_id,
      type: "split",
      status: "pending",
      version: 1,
      created_at: now(),
    };
    this.store.put("proposal", proposal);
    this.emit(task.project_id, "proposal.created", {
      task_id: task.id,
      run_id: args.author_run_id,
      summary: args.rationale,
    });
    if (task.owner_run_id)
      this.systemMessage(
        task.project_id,
        task.owner_run_id,
        task.id,
        `收到拆分提议：${args.rationale}`,
      );
    return proposal;
  }
  proposal_resolve(
    args: CommandArgs<"proposal_resolve">,
  ): CommandResults["proposal_resolve"] {
    const proposal = this.get("proposal", args.proposal_id);
    ensure(
      proposal.type === "split" && proposal.status === "pending",
      "PROPOSAL_CLOSED",
      "提议已经处理或类型不匹配",
    );
    const task = this.task(proposal.task_id);
    this.actor(task, args.actor_run_id);
    let split = null;
    if (args.approved)
      split = this.task_split({
        task_id: task.id,
        expected_version: proposal.expected_version,
        actor_run_id: args.actor_run_id,
        children: proposal.children,
        rationale: proposal.rationale,
      });
    const result = this.update("proposal", proposal, {
      status: args.approved ? "approved" : "declined",
      resolution: args.note,
      resolved_at: now(),
    });
    this.emit(task.project_id, "proposal.resolved", {
      task_id: task.id,
      summary: args.note,
    });
    return { proposal: result, split };
  }
  scope_request(
    args: CommandArgs<"scope_request">,
  ): CommandResults["scope_request"] {
    const task = this.task(args.task_id);
    this.currentClaim(task, args);
    const proposal: ScopeProposal = {
      ...args,
      scopes: args.scopes.map(scopePath),
      id: uid("prop"),
      project_id: task.project_id,
      type: "scope",
      status: "pending",
      version: 1,
      created_at: now(),
      expected_version: task.version,
    };
    this.store.put("proposal", proposal);
    this.emit(task.project_id, "scope.requested", {
      task_id: task.id,
      run_id: args.run_id,
      summary: args.rationale,
    });
    return proposal;
  }
  scope_resolve(
    args: CommandArgs<"scope_resolve">,
  ): CommandResults["scope_resolve"] {
    const proposal = this.get("proposal", args.proposal_id),
      task = this.task(proposal.task_id);
    ensure(
      proposal.type === "scope" && proposal.status === "pending",
      "PROPOSAL_CLOSED",
      "范围申请已处理或类型不匹配",
    );
    if (args.actor_run_id) {
      const parent = task.parent_id ? this.task(task.parent_id) : null;
      ensure(
        parent?.owner_run_id === args.actor_run_id &&
          args.actor_run_id !== task.owner_run_id,
        "SCOPE_REVIEWER",
        "范围扩展需要父任务负责人或人确认",
      );
    }
    let updated = task;
    if (args.approved) {
      ensure(
        ["doing", "blocked"].includes(task.status),
        "SCOPE_STATE",
        "任务已交付或正在交接，请先核对当前状态再申请范围",
      );
      ensure(
        task.owner_run_id === proposal.run_id &&
          task.claim_epoch === proposal.claim_epoch,
        "STALE_CLAIM",
        "任务执行权已经变化，请重新申请范围",
      );
      const candidate = this.normalizeTask({
        ...task,
        scopes: [...task.scopes, ...proposal.scopes],
        resources: [...task.resources, ...proposal.resources],
      });
      this.validateTask(candidate);
      const run = this.run(task.owner_run_id);
      ensure(
        candidate.scopes.every((c) =>
          run.delegated_scopes.some((p) => subset(c, p)),
        ),
        "DELEGATION_SCOPE",
        "范围超出此执行者的委派边界，需要先调整上层分工",
      );
      const conflicts = this.conflicts(candidate, run);
      ensure(
        !conflicts.length,
        "SCOPE_CONFLICT",
        "申请范围仍被其他任务占用",
        conflicts,
      );
      updated = this.update("task", task, candidate);
    }
    const result = this.update("proposal", proposal, {
      status: args.approved ? "approved" : "declined",
      resolution: args.note,
      resolved_at: now(),
    });
    this.emit(task.project_id, "scope.resolved", {
      task_id: task.id,
      summary: args.note,
    });
    return { proposal: result, task: updated };
  }
  task_handoff(
    args: CommandArgs<"task_handoff">,
  ): CommandResults["task_handoff"] {
    const task = this.task(args.task_id);
    this.revision(task, args.expected_version);
    this.actor(task, args.from_run_id);
    ensure(
      ACTIVE.has(task.status) && task.owner_run_id,
      "HANDOFF_STATE",
      "只有已领取的活动任务需要交接",
    );
    const oldRun = this.run(task.owner_run_id),
      target = this.sameProject(task.project_id, "run", args.to_run_id);
    ensure(
      target.id !== oldRun.id && target.status === "active",
      "HANDOFF_TARGET",
      "请选择另一个有效执行会话",
    );
    ensure(
      oldRun.process?.status !== "running",
      "PROCESS_RUNNING",
      "请先停止此任务的托管进程，再转移执行权",
    );
    const descendants = this.activeDescendants(task);
    if (args.descendants === "require_stopped")
      ensure(
        !descendants.length,
        "DESCENDANTS_ACTIVE",
        "仍有活动子任务，请先处理或选择继续保留子任务",
      );
    const oldDescendants = this.runDescendants(oldRun.id);
    const unrelated = this.tasks(task.project_id).filter(
      (t) =>
        ACTIVE.has(t.status) &&
        oldDescendants.some((r) => r.id === t.owner_run_id) &&
        !descendants.some((d) => d.id === t.id),
    );
    ensure(
      !unrelated.length,
      "DESCENDANT_OTHER_WORK",
      "旧会话的子执行者还有其他活动任务，请先明确其归属",
      unrelated.map((t) => t.id),
    );
    ensure(
      args.confirmed_stop ||
        (oldRun.workdir &&
          target.workdir &&
          !overlaps(oldRun.workdir, target.workdir)),
      "OLD_WRITER_UNCONFIRMED",
      "共享目录交接需要确认旧执行者已停止；未知会话可先接入独立 worktree 核验",
    );
    ensure(
      task.required_capabilities.every((c) => target.capabilities.includes(c)),
      "CAPABILITY_MISMATCH",
      "接手者缺少任务要求的能力",
    );
    ensure(
      task.scopes.every((c) =>
        target.delegated_scopes.some((p) => subset(c, p)),
      ),
      "DELEGATION_SCOPE",
      "任务超出接手者的委派范围",
    );
    ensure(
      !oldDescendants.some((r) => r.id === target.id),
      "RUN_CYCLE",
      "接手者不能是原负责人的后代会话，请登记独立会话",
    );
    const conflicts = this.conflicts(task, target);
    ensure(
      !conflicts.length,
      "SCOPE_CONFLICT",
      "接手目标的工作区存在修改冲突",
      conflicts,
    );
    const activeRuns = new Set(
      this.tasks(task.project_id)
        .filter((t) => ACTIVE.has(t.status) && t.id !== task.id)
        .map((t) => t.owner_run_id),
    );
    activeRuns.add(target.id);
    ensure(
      activeRuns.size <= this.get("project", task.project_id).max_concurrency,
      "CONCURRENCY_BUDGET",
      "交接后超出项目并发预算",
    );
    const handoff = {
      from_run_id: oldRun.id,
      to_run_id: target.id,
      at: now(),
      summary: args.summary,
      confirmed_stop: args.confirmed_stop,
      descendants: args.descendants,
      descendant_task_ids: descendants.map((t) => t.id),
      checkpoint_at: task.checkpoint?.at || null,
    };
    const result = this.update("task", task, {
      status: "reconcile",
      owner_run_id: target.id,
      claim_epoch: task.claim_epoch + 1,
      handoff,
    });
    if (args.descendants === "continue") {
      for (const run of oldDescendants.filter(
        (r) => r.parent_run_id === oldRun.id,
      )) {
        const depthShift = target.depth + 1 - run.depth;
        const subtree = [
          run,
          ...oldDescendants.filter((r) =>
            this.runDescendants(run.id).some((child) => child.id === r.id),
          ),
        ];
        ensure(
          subtree.every(
            (r) =>
              r.depth + depthShift <=
              this.get("project", task.project_id).max_depth,
          ),
          "DEPTH_BUDGET",
          "交接后的子执行者层级超出预算",
        );
        for (const r of subtree)
          this.update("run", r, {
            depth: r.depth + depthShift,
            ...(r.id === run.id ? { parent_run_id: target.id } : {}),
          });
        this.systemMessage(
          task.project_id,
          run.id,
          task.id,
          `上层任务已交给 ${target.name}，继续当前子任务并向新负责人报告。`,
        );
      }
    }
    this.systemMessage(
      task.project_id,
      target.id,
      task.id,
      `收到交接：${args.summary}。请读取接手包并核验现场。`,
    );
    this.emit(task.project_id, "task.handoff", {
      task_id: task.id,
      run_id: target.id,
      summary: args.summary,
      handoff,
    });
    return result;
  }
  task_reconcile(
    args: CommandArgs<"task_reconcile">,
  ): CommandResults["task_reconcile"] {
    const task = this.task(args.task_id);
    this.currentClaim(task, args, true);
    ensure(
      task.status === "reconcile",
      "NOT_RECONCILING",
      "任务当前无需交接核验",
    );
    const conflicts = this.conflicts(task, this.run(args.run_id));
    ensure(
      !conflicts.length,
      "SCOPE_CONFLICT",
      "核验时发现新的工作范围冲突",
      conflicts,
    );
    const result = this.update("task", task, {
      status: "doing",
      reconciliation: {
        observed: args.observed,
        at: now(),
        run_id: args.run_id,
      },
      checkpoint: {
        summary: args.observed,
        next_step: args.next_step,
        blocker: "",
        at: now(),
        run_id: args.run_id,
      },
    });
    this.emit(task.project_id, "task.reconciled", {
      task_id: task.id,
      run_id: args.run_id,
      summary: args.observed,
    });
    return result;
  }
  task_release(
    args: CommandArgs<"task_release">,
  ): CommandResults["task_release"] {
    const task = this.task(args.task_id),
      run = this.currentClaim(task, args, true);
    ensure(
      args.confirmed_stop && run.process?.status !== "running",
      "PROCESS_RUNNING",
      "释放前需要确认相关执行已停止",
    );
    ensure(
      !this.activeDescendants(task).length,
      "DESCENDANTS_ACTIVE",
      "请先处理活动子任务",
    );
    const result = this.update("task", task, {
      owner_run_id: null,
      status: "pending",
      claim_epoch: task.claim_epoch + 1,
      release_note: args.note,
    });
    this.emit(task.project_id, "task.released", {
      task_id: task.id,
      run_id: run.id,
      summary: args.note,
    });
    return result;
  }
  systemMessage(
    project: string,
    to: string,
    task: string | undefined,
    body: string,
  ) {
    return this.message_send({
      project_id: project,
      to_run_id: to,
      task_id: task,
      kind: "request",
      body,
      system: true,
    });
  }
  message_send(
    args: CommandArgs<"message_send"> & { system?: boolean },
  ): CommandResults["message_send"] {
    this.get("project", args.project_id);
    if (args.from_run_id)
      this.sameProject(args.project_id, "run", args.from_run_id);
    if (args.to_run_id)
      this.sameProject(args.project_id, "run", args.to_run_id);
    if (args.task_id) this.sameProject(args.project_id, "task", args.task_id);
    const recent = this.store
      .list("message", args.project_id)
      .filter(
        (m) =>
          m.from_run_id === args.from_run_id &&
          Date.now() - Date.parse(m.created_at) < 60000,
      );
    ensure(
      args.system || recent.length < 30,
      "MESSAGE_BUDGET",
      "消息频率已达上限，请汇总结论或提交待决问题",
    );
    const message = {
      ...args,
      id: uid("msg"),
      version: 1,
      created_at: now(),
      acknowledged_at: null,
    };
    this.store.put("message", message);
    this.emit(args.project_id, "message.sent", {
      task_id: args.task_id,
      run_id: args.from_run_id,
      to_run_id: args.to_run_id,
      message_id: message.id,
      summary: cap(args.body, 240),
    });
    return message;
  }
  message_ack(args: CommandArgs<"message_ack">): CommandResults["message_ack"] {
    const message = this.get("message", args.message_id);
    ensure(
      message.to_run_id === args.run_id,
      "NOT_RECIPIENT",
      "只有接收者可以确认消息",
    );
    return this.update("message", message, {
      acknowledged_at: message.acknowledged_at || now(),
    });
  }
  decision_record(
    args: CommandArgs<"decision_record">,
  ): CommandResults["decision_record"] {
    this.get("project", args.project_id);
    if (args.actor_run_id)
      this.sameProject(args.project_id, "run", args.actor_run_id);
    for (const id of args.task_ids)
      this.sameProject(args.project_id, "task", id);
    const decision = { ...args, id: uid("dec"), version: 1, created_at: now() };
    this.store.put("decision", decision);
    this.emit(args.project_id, "decision.recorded", {
      run_id: args.actor_run_id,
      summary: args.title,
      decision_id: decision.id,
    });
    return decision;
  }
  context(args: QueryArgs<"context">): ContextPacket {
    const task = this.task(args.task_id),
      project = this.get("project", task.project_id);
    if (args.run_id) this.sameProject(project.id, "run", args.run_id);
    const parents = this.ancestors(task),
      children = this.tasks(project.id).filter((t) => t.parent_id === task.id);
    const allDecisions = relevantDecisions(this, task);
    const decisions = allDecisions.slice(-8),
      omissions = [];
    const bounded = (value: unknown, count: number) => {
      const text = String(value || "");
      if (text.length > count)
        omissions.push("部分长字段已摘要，请读取完整任务、项目约束或相关决定");
      return text.length > count
        ? text.slice(0, count) + " [字段有省略]"
        : text;
    };
    if (allDecisions.length > decisions.length)
      omissions.push("更早的相关决定未包含，使用 relay_decisions 分页读取");
    if (task.artifacts.length > 20 || task.verification.length > 15)
      omissions.push("较早的成果或验证未包含，使用 relay_task 读取");
    const parts = [
      `# 接手包 · ${task.short_id} ${task.title}`,
      `项目：${project.name}\n项目 ID：${project.id}\n任务 ID：${task.id}\n任务版本：${task.version}\n执行权版本 claim_epoch：${task.claim_epoch}\n状态：${task.status} / ${task.mode}\n负责人 Run：${task.owner_run_id || "待领取"}`,
      `## 目标\n${bounded(project.objective, 1800)}\n任务：${bounded(task.description, 1800)}\n验收标准：${bounded(task.acceptance, 1800)}`,
      `## 用户约束\n${bounded(project.constraints, 2400) || "未另行记录。遵循当前用户的有效指令。"}\n任务交接不扩大行动权限。`,
      `## 工作范围\n项目目录：${project.root_path || "未登记"}\n写入范围：${task.scopes.join(", ") || "只读"}\n独占资源：${task.resources.join(", ") || "无"}\n执行目录：${task.owner_run_id ? this.run(task.owner_run_id).workdir || "未登记" : "未登记"}`,
      `## 执行说明\n${task.execution ? `输入：${task.execution.inputs.join("; ")}\n产出：${task.execution.outputs.join("; ")}\n${task.execution.steps.map((step) => `- ${step.id} ${step.title}: ${bounded(step.instructions, 500)}；完成：${bounded(step.done_when, 300)}；失败：${bounded(step.on_failure, 300)}`).join("\n")}\n停止并求助：${task.execution.stop_when.join("; ")}` : "未配置有序步骤；按验收标准和当前下一步执行，完成实现后报告准备验证。"}`,
      `## 已知事实、失败尝试与待核实操作\n${bounded(JSON.stringify({ facts: task.workflow?.facts || [], failed_attempts: task.workflow?.failed_attempts || [], uncertain_actions: task.workflow?.uncertain_actions || [], completed_steps: task.workflow?.completed_steps || [] }), 2000)}`,
      `## 当前事实与下一步\n${task.checkpoint ? `${bounded(task.checkpoint.summary, 2000)}\n检查点：${task.checkpoint.at}\n阻塞：${bounded(task.checkpoint.blocker, 1000) || "无"}\n下一步：${bounded(task.checkpoint.next_step, 1600) || "按验收标准继续"}` : "尚无检查点。先核对现场再计划。"}`,
      `## 交接核验\n${task.handoff ? `${bounded(task.handoff.summary, 1500)}\n旧执行停止确认：${task.handoff.confirmed_stop}\n后代任务处理：${task.handoff.descendants}` : "无历史交接。"}\n先检查实际文件、分支、未提交改动、运行进程和成果。已记录的验证只证明对应时间点。`,
      `## 成果\n${
        task.artifacts
          .slice(-20)
          .map((a) => `- ${a.kind}: ${a.path} ${bounded(a.note, 200)}`)
          .join("\n") || "尚未提交"
      }`,
      `## 验证\n${
        task.verification
          .slice(-15)
          .map(
            (v) =>
              `- ${v.passed ? "通过" : "失败"} ${v.command}: ${bounded(v.result, 400)}`,
          )
          .join("\n") || "尚未验证"
      }`,
      `## 层级与依赖\n上层：${parents.map((p) => `${p.short_id} ${p.title}`).join(" → ") || "根任务"}\n子任务：${children.map((t) => `${t.short_id} ${t.status} ${t.title}`).join("; ") || "无"}\n前置：${
        task.depends_on
          .map((id) => {
            const t = this.task(id);
            return `${t.short_id} ${t.status} ${t.title}`;
          })
          .join("; ") || "无"
      }`,
      `## 相关决定\n${decisions.map((d) => `- ${d.id} ${d.title}: ${bounded(d.body, 900)}`).join("\n") || "尚无记录"}`,
      "## 协作规则\n先登记子执行者再派发；领取和更新时使用服务返回的版本。子执行者必须报告检查点、阻塞和交付。范围扩展先申请；共享目录交接先停止旧写入；独立 worktree 的成果仍需集成验证。会话重启先核验，别重复执行结果未知的外部操作。按需查询讨论和历史，避免加载全项目日志。",
    ];
    // Keep constraints and recovery instructions ahead of potentially lengthy plans/history.
    const priority = [
      parts[0],
      parts[1],
      parts[3],
      parts[4],
      parts[7],
      parts[8],
      parts[2],
      parts[5],
      parts[6],
      ...parts.slice(9),
    ];
    const requests = pendingRequests(this, task);
    if (requests.length) {
      if (requests.length > 5)
        omissions.push("待处理请求有省略，使用 relay_work_requests 分页读取");
      priority.splice(
        5,
        0,
        `## 继承的待处理请求（已读不等于已处理）\n${requests
          .slice(0, 5)
          .map(
            (m) =>
              `- ${m.id} 原收件人 ${m.to_run_id || "项目"}: ${bounded(m.body, 500)}`,
          )
          .join(
            "\n",
          )}\n使用 relay_work_requests 读取全文；处理后 relay_message_resolve 记录结论。`,
      );
    }
    let body = priority.join("\n\n");
    const total = body.length;
    // Bound output without silently suggesting the full record has been loaded.
    if (body.length > args.max_chars) omissions.push("接手包达到长度预算");
    if (omissions.length) {
      const footer =
        "\n\n[此包包含省略。行动前使用 relay_project 读取完整目标与用户约束，relay_task 读取当前任务，relay_decisions 按需读取相关决定。]";
      body = body.slice(0, args.max_chars - footer.length) + footer;
    }
    return {
      task_id: task.id,
      project_id: project.id,
      version: task.version,
      claim_epoch: task.claim_epoch,
      markdown: body,
      truncated: omissions.length > 0,
      omissions: [...new Set(omissions)],
      references: { project_id: project.id, task_id: task.id },
      total_chars: total,
    };
  }
}
