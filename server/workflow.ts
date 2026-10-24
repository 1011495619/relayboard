import { createHash } from "node:crypto";
import type { Service } from "./domain.js";
import type { Task, Decision, WorkGuide, WorkflowState } from "./types.js";
import { observeWorkspace } from "./workspace.js";

export const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const planSignature = (task: Task) => digest(task.execution || null);

/** Task ancestry, descendants for coordinators and inherited dependency closure. */
export function relatedTasks(service: Service, task: Task): Task[] {
  const found = new Map<string, Task>([[task.id, task]]);
  for (const ancestor of service.ancestors(task))
    found.set(ancestor.id, ancestor);
  if (task.mode === "coordinator")
    for (const child of service.tasks(task.project_id))
      if (service.ancestors(child).some((p) => p.id === task.id))
        found.set(child.id, child);
  const visit = (item: Task) => {
    for (const id of item.depends_on) {
      if (found.has(id)) continue;
      const dependency = service.task(id);
      found.set(id, dependency);
      visit(dependency);
    }
  };
  for (const item of [...found.values()]) visit(item);
  return [...found.values()];
}
export function relevantDecisions(service: Service, task: Task): Decision[] {
  const ids = new Set(relatedTasks(service, task).map((t) => t.id));
  return service.store
    .list("decision", task.project_id)
    .filter((d) => !d.task_ids.length || d.task_ids.some((id) => ids.has(id)));
}
export function dependencies(service: Service, task: Task): Task[] {
  // A coordinator's child prerequisites affect its children, not its ability to coordinate.
  const found = new Map<string, Task>();
  const visit = (item: Task) => {
    for (const id of item.depends_on) {
      if (found.has(id)) continue;
      const dependency = service.task(id);
      found.set(id, dependency);
      visit(dependency);
    }
  };
  for (const item of [task, ...service.ancestors(task)]) visit(item);
  return [...found.values()];
}
export function dependencyItems(
  service: Service,
  task: Task,
  offset = 0,
  limit = 20,
): WorkGuide["dependencies"] {
  return dependencies(service, task)
    .slice(offset, offset + limit)
    .map((d) => ({
      id: d.id,
      short_id: d.short_id,
      title: d.title,
      status: d.status,
      version: d.version,
      revision: artifactRevision(d),
      artifacts: d.artifacts.slice(-3).map((a) => ({
        ...a,
        path: a.path.slice(0, 400),
        note: a.note.slice(0, 160),
      })),
      received: !!task.workflow?.dependency_receipts.some(
        (r) => r.task_id === d.id && r.revision === artifactRevision(d),
      ),
    }));
}
export const artifactRevision = (task: Task) =>
  digest({ artifacts: task.artifacts, completed_at: task.completed_at });
export function requirementsSignature(service: Service, task: Task): string {
  const project = service.get("project", task.project_id);
  return digest({
    execution: task.execution,
    acceptance: task.acceptance,
    description: task.description,
    scopes: task.scopes,
    resources: task.resources,
    objective: project.objective,
    constraints: project.constraints,
    root_path: project.root_path,
    ancestors: service.ancestors(task).map((t) => ({
      id: t.id,
      acceptance: t.acceptance,
      execution: t.execution,
      description: t.description,
    })),
    decisions: relevantDecisions(service, task).map((d) => ({
      id: d.id,
      version: d.version,
    })),
    dependencies: dependencies(service, task).map((t) => ({
      id: t.id,
      status: t.status,
      revision: artifactRevision(t),
    })),
  });
}
export function recoverySignature(service: Service, task: Task): string {
  return digest({
    epoch: task.claim_epoch,
    owner: task.owner_run_id,
    workdir: task.owner_run_id ? service.run(task.owner_run_id).workdir : "",
    requirements: requirementsSignature(service, task),
  });
}
export function needsRecovery(service: Service, task: Task): boolean {
  return (
    task.status === "reconcile" ||
    task.workflow?.recovered_epoch !== task.claim_epoch ||
    task.workflow.recovered_signature !== recoverySignature(service, task)
  );
}
export function evidenceStale(service: Service, task: Task): boolean {
  if (!task.evidence?.fingerprint || !task.owner_run_id) return false;
  const actual = observeWorkspace(
    service.run(task.owner_run_id).workdir,
    task.scopes,
  );
  return (
    actual.fingerprint !== task.evidence.fingerprint ||
    actual.workdir !== task.evidence.workdir
  );
}
export function pendingRequests(service: Service, task: Task) {
  const ids = new Set([task.id, ...service.ancestors(task).map((t) => t.id)]);
  return service.store
    .list("message", task.project_id)
    .filter(
      (m) =>
        m.task_id &&
        ids.has(m.task_id) &&
        ["request", "blocker"].includes(m.kind) &&
        !m.resolved_at &&
        !m.system,
    );
}
export function emptyWorkflow(task: Task): WorkflowState {
  return {
    recovered_epoch: 0,
    recovered_signature: "",
    recovered_at: "",
    observed: "",
    plan_signature: planSignature(task),
    completed_steps: [],
    facts: [],
    failed_attempts: [],
    uncertain_actions: [],
    ready_for_verification: false,
    dependency_receipts: [],
  };
}
export function workGuide(
  service: Service,
  runId: string,
  task: Task | null,
  maxChars = 10000,
): WorkGuide {
  const run = service.run(runId);
  const guide: WorkGuide = {
    truncated: false,
    omissions: [],
    char_budget: Math.max(6000, maxChars),
    run_id: runId,
    task,
    stage: "unavailable",
    headline: "暂时没有可执行的工作",
    handle: null,
    next_action: {
      tool: "relay_eligible",
      reason: "查看等待条件或可协商的任务",
      arguments: { project_id: run.project_id, run_id: runId },
    },
    checklist: [],
    current_step: null,
    completed_steps: [],
    context: null,
    decisions: [],
    dependencies: [],
    dependency_page: { total: 0, next_offset: null },
    request_page: { total: 0, next_offset: null },
    messages: [],
    warnings: [],
    choices: [],
  };
  if (!task) {
    guide.choices = service
      .query("eligible", { project_id: run.project_id, run_id: runId })
      .slice(0, 20)
      .map((e) => ({
        task_id: e.task.id,
        title: e.task.title,
        eligible: e.eligible,
        reasons: e.reasons,
      }));
    return boundGuide(guide);
  }
  service.sameProject(run.project_id, "task", task.id);
  guide.context = service.context({
    task_id: task.id,
    run_id: runId,
    max_chars: maxChars,
  });
  // Avoid repeating full artifacts and verification histories already present in the bounded context.
  guide.task = {
    ...task,
    description: task.description.slice(0, 1200),
    acceptance: task.acceptance.slice(0, 1200),
    artifacts: [],
    verification: [],
    execution: undefined,
    workflow: undefined,
    handoff: task.handoff
      ? { ...task.handoff, summary: task.handoff.summary.slice(0, 700) }
      : undefined,
    reconciliation: undefined,
    review: undefined,
    submission: task.submission?.slice(0, 700),
    checkpoint: task.checkpoint
      ? {
          ...task.checkpoint,
          summary: task.checkpoint.summary.slice(0, 1200),
          next_step: task.checkpoint.next_step.slice(0, 1200),
          blocker: task.checkpoint.blocker.slice(0, 1200),
        }
      : null,
  };
  if (task.description.length > 1200 || task.acceptance.length > 1200)
    guide.warnings.push(
      "任务长字段有省略，请使用 relay_task 读取完整说明与验收标准",
    );
  const allDecisions = relevantDecisions(service, task);
  guide.decisions = allDecisions
    .slice(-8)
    .map((d) => ({ ...d, body: d.body.slice(0, 900) }));
  if (allDecisions.length > 8 || allDecisions.some((d) => d.body.length > 900))
    guide.warnings.push(
      "契约有省略：使用 relay_decisions 按 task_id 分页读取完整内容后再确认 read_decision_ids",
    );
  guide.dependencies = dependencyItems(service, task, 0, 10);
  const dependencyTotal = dependencies(service, task).length;
  guide.dependency_page = {
    total: dependencyTotal,
    next_offset: dependencyTotal > 10 ? 10 : null,
  };
  if (dependencyTotal > 10)
    guide.warnings.push(
      "依赖有省略；使用 relay_work_dependencies {task_id,offset:10,limit:20} 分页读取所有 revision，按 next_offset 继续",
    );
  const requests = pendingRequests(service, task);
  guide.request_page = {
    total: requests.length,
    next_offset: requests.length > 8 ? 8 : null,
  };
  const ownMessages = service
    .query("inbox", { run_id: runId, unread_only: true, limit: 100 })
    .filter((m) => m.task_id === task.id || !m.task_id);
  guide.messages = [
    ...new Map(
      [...requests.slice(0, 8), ...ownMessages.slice(-4)].map((m) => [m.id, m]),
    ).values(),
  ]
    .slice(0, 12)
    .map((m) => ({
      ...m,
      body: m.body.slice(0, 900),
      resolution: m.resolution?.slice(0, 300),
    }));
  if (requests.length)
    guide.warnings.push(
      `有 ${requests.length} 项任务请求尚未处理（可能来自旧负责人）；已读不等于已处理。使用 relay_work_requests 分页读全，处理后 relay_message_resolve 记录结论`,
    );
  if (
    guide.messages.some(
      (m) => ownMessages.find((x) => x.id === m.id)?.body.length! > 900,
    ) ||
    requests.some((m) => m.body.length > 900)
  )
    guide.warnings.push(
      "消息正文有省略，请读取 relay_work_requests 或 relay_task 完整消息后处理",
    );
  if (guide.context.truncated)
    guide.warnings.push(
      "接手包包含省略；按 references 读取完整目标、约束和契约再执行",
    );
  guide.warnings.push(
    "验证结果来自执行者报告；Git 观察只证明对应文件版本，不证明测试实际执行",
  );
  if (task.evidence?.source === "unavailable")
    guide.warnings.push(task.evidence.reason || "现场版本未被服务观察");
  const stale = evidenceStale(service, task);
  if (stale)
    guide.warnings.push(
      "文件版本已变化或暂时未能完整观察，已有验证已过期，请重新验证",
    );
  if (
    task.status !== "done" &&
    (run.status !== "active" || task.owner_run_id !== runId)
  ) {
    guide.headline = "此会话没有当前任务执行权";
    guide.warnings.push(
      "先登记有效 Run；任务归其他执行者时由负责人明确交接，读取指南不会转移归属",
    );
    return boundGuide(guide);
  }
  guide.handle = {
    task_id: task.id,
    run_id: runId,
    claim_epoch: task.claim_epoch,
    task_version: task.version,
    context_version: recoverySignature(service, task),
  };
  const completed =
    task.workflow?.plan_signature === requirementsSignature(service, task)
      ? task.workflow.completed_steps
      : [];
  guide.completed_steps = completed;
  const fullStep = task.execution?.steps.find((s) => !completed.includes(s.id));
  guide.current_step = fullStep
    ? {
        ...fullStep,
        instructions: fullStep.instructions.slice(0, 1200),
        done_when: fullStep.done_when.slice(0, 900),
        on_failure: fullStep.on_failure.slice(0, 900),
      }
    : null;
  if (
    fullStep &&
    (fullStep.instructions.length > 1200 ||
      fullStep.done_when.length > 900 ||
      fullStep.on_failure.length > 900)
  )
    guide.warnings.push("当前步骤有省略，请使用 relay_task 读取完整执行说明");
  const report = (
    kind: string,
    reason: string,
    extra: Record<string, unknown> = {},
  ) => ({
    tool: "relay_work_report",
    reason,
    arguments: { handle: guide.handle, kind, ...extra },
    required_fields:
      kind === "recover"
        ? ["summary", "observed", "read_decision_ids", "dependency_receipts"]
        : kind === "verify"
          ? ["summary", "verification", "artifacts"]
          : ["summary"],
  });
  if (task.status === "done") {
    guide.stage = "done";
    guide.headline = "任务已完成，无需重复执行";
    guide.next_action = {
      tool: "relay_work_start",
      reason: "如需继续，寻找新任务",
      arguments: { run_id: runId },
    };
  } else if (task.status === "review") {
    guide.stage = "review";
    guide.headline = "成果已提交，等待独立验收";
    guide.next_action = {
      tool: "relay_inbox",
      reason: "读取评审反馈；评审由其他执行者完成",
      arguments: { run_id: runId },
    };
  } else if (needsRecovery(service, task)) {
    guide.stage = "recover";
    guide.headline = task.checkpoint?.blocker
      ? `恢复遇阻：${task.checkpoint.blocker}`
      : "先核对现场，再继续执行";
    guide.checklist = [
      "核对遇到缺失输入或旧写入待核实时，可先 work_report kind:blocked 求助；这不会解锁执行",
      `检查实际目录：${run.workdir || "尚未登记，先核对任务目录"}`,
      "检查分支、提交、未提交改动和仍在写入的进程",
      "读取完整目标、用户约束、执行说明及相关契约",
      "核对前置成果已实际进入当前工作区，填入依赖 revision 与接收说明",
      "保留失败尝试和结果待核实的操作；先核实再重试",
    ];
    guide.next_action = report(
      "recover",
      "核实事实后填写 observed、read_decision_ids 和 dependency_receipts",
      { read_decision_ids: [], dependency_receipts: [] },
    );
  } else if (
    task.status === "blocked" ||
    task.workflow?.uncertain_actions.length
  ) {
    guide.stage = "blocked";
    guide.headline = task.checkpoint?.blocker || "存在结果待核实的操作";
    guide.checklist = [
      ...(task.workflow?.uncertain_actions || []),
      "先核实或请求协助；用 progress 报告解决依据，并显式填写剩余 uncertain_actions",
    ];
    guide.next_action = report(
      "progress",
      "报告阻塞解决情况；尚未解决则用 blocked 请求协助",
    );
  } else if (
    task.mode === "coordinator" &&
    service
      .tasks(task.project_id)
      .some((c) => c.parent_id === task.id && c.status !== "done")
  ) {
    guide.stage = "wait_children";
    guide.headline = "等待子任务交付与验收";
    guide.next_action = {
      tool: "relay_task",
      reason: "检查子任务与交付，按证据独立评审",
      arguments: { task_id: task.id },
    };
  } else if (
    guide.current_step ||
    (!task.execution && !task.workflow?.ready_for_verification)
  ) {
    guide.stage = "execute";
    guide.headline =
      guide.current_step?.title ||
      task.checkpoint?.next_step ||
      "按验收标准执行并报告进度";
    guide.checklist = guide.current_step
      ? [
          guide.current_step.instructions,
          `完成条件：${guide.current_step.done_when}`,
          `失败处理：${guide.current_step.on_failure}`,
        ]
      : [
          task.acceptance,
          "完成实现后用 progress 设置 ready_for_verification: true",
        ];
    guide.next_action = report(
      guide.current_step ? "step" : "progress",
      "完成当前工作后报告实际结果；未完成时使用 progress",
      guide.current_step
        ? { step_id: guide.current_step.id }
        : { ready_for_verification: true },
    );
  } else if (
    !task.artifacts.length ||
    !task.checkpoint?.verification_current ||
    !task.verification.length ||
    task.verification.some((v) => !v.passed) ||
    stale ||
    service
      .tasks(task.project_id)
      .filter((t) => t.parent_id === task.id)
      .some(
        (t) =>
          !task.checkpoint?.required_children_at_checkpoint?.some(
            (c) =>
              c.id === t.id && c.status === "done" && c.version === t.version,
          ),
      )
  ) {
    guide.stage = "verify";
    guide.headline = "执行验证，并保存对应成果和实际结果";
    guide.next_action = report(
      "verify",
      "运行验收要求的全部当前检查后填 verification 与 artifacts；本次列表替换当前验证快照，历史保留在事件",
      { verification: [], artifacts: [] },
    );
  } else {
    guide.stage = "submit";
    guide.headline = "验证已记录，可以提交独立验收";
    guide.next_action = report("submit", "提交当前成果，等待其他执行者验收");
  }
  return boundGuide(guide);
}

/** Bound the entire MCP result, including metadata outside the Markdown packet. */
function boundGuide(guide: WorkGuide): WorkGuide {
  const omitted: string[] = [];
  const clip = (text: string, max: number, label: string) => {
    if (text.length <= max) return text;
    omitted.push(label);
    return text.slice(0, max) + " [省略]";
  };
  const take = <T>(items: T[], max: number, label: string) => {
    if (items.length > max) omitted.push(label);
    return items.slice(0, max);
  };
  guide.checklist = take(guide.checklist, 8, "执行检查清单").map((x) =>
    clip(x, 500, "执行检查清单正文"),
  );
  guide.warnings = take(guide.warnings, 12, "警告").map((x) =>
    clip(x, 400, "警告正文"),
  );
  guide.headline = clip(guide.headline, 500, "当前状态说明");
  guide.decisions = take(
    guide.decisions,
    4,
    "契约列表（relay_decisions分页）",
  ).map((d) => ({
    ...d,
    body: clip(d.body, 500, "契约正文"),
    task_ids: take(d.task_ids, 10, "契约任务关联"),
  }));
  guide.dependencies = take(
    guide.dependencies,
    5,
    "依赖列表（relay_work_dependencies分页）",
  ).map((d) => ({ ...d, artifacts: take(d.artifacts, 1, "依赖成果位置") }));
  if (guide.dependencies.length < guide.dependency_page.total)
    guide.dependency_page.next_offset = guide.dependencies.length;
  guide.messages = take(
    guide.messages,
    5,
    "任务请求（relay_work_requests分页）",
  ).map((m) => ({ ...m, body: clip(m.body, 500, "请求正文") }));
  if (guide.request_page.total > guide.messages.length)
    guide.request_page.next_offset = guide.messages.length;
  guide.choices = take(guide.choices, 5, "可领取工作（relay_eligible）").map(
    (c) => ({
      ...c,
      reasons: take(c.reasons, 3, "等待原因").map((r) =>
        clip(r, 200, "等待原因正文"),
      ),
    }),
  );
  if (guide.task) {
    guide.task.scopes = take(
      guide.task.scopes,
      10,
      "任务范围（relay_task全文）",
    ).map((s) => clip(s, 180, "任务路径"));
    guide.task.resources = take(
      guide.task.resources,
      5,
      "任务资源（relay_task全文）",
    );
    guide.task.depends_on = take(
      guide.task.depends_on,
      10,
      "任务依赖（relay_task全文）",
    );
    guide.task.required_capabilities = take(
      guide.task.required_capabilities,
      5,
      "任务能力（relay_task全文）",
    );
    guide.task.split_rationale = undefined;
    guide.task.release_note = undefined;
    if (guide.task.checkpoint)
      guide.task.checkpoint.required_children_at_checkpoint = undefined;
  }
  const size = () => JSON.stringify(guide).length;
  // Metadata is supplementary to the constraint-bearing context. Drop it before clipping that context.
  if (size() > guide.char_budget) {
    omitted.push("附加契约/依赖/请求详情（按对应分页工具补读）");
    guide.decisions = [];
    guide.dependencies = [];
    guide.messages = [];
    guide.choices = [];
    if (guide.dependency_page.total) guide.dependency_page.next_offset = 0;
    if (guide.request_page.total) guide.request_page.next_offset = 0;
  }
  if (guide.context && size() > guide.char_budget - 500) {
    const packet = guide.context,
      body = packet.markdown;
    packet.markdown = "";
    const available = Math.max(0, guide.char_budget - size() - 700);
    packet.markdown =
      body.slice(0, available) +
      "\n[指引预算有省略：先 relay_project 读取完整约束、relay_task 读取执行说明，relay_decisions/work_dependencies/work_requests 按需分页。]";
    packet.truncated = true;
    packet.omissions = [...new Set([...packet.omissions, "指引整体预算"])];
    omitted.push("接手包正文");
  }
  guide.omissions = [...new Set(omitted)];
  guide.truncated = !!omitted.length || !!guide.context?.truncated;
  if (size() > guide.char_budget) {
    // Small budgets still retain complete identity, handle and one valid action template.
    omitted.push("详细步骤/历史（relay_task全文）");
    guide.context = null;
    guide.current_step = null;
    guide.completed_steps = [];
    guide.checklist = [];
    guide.warnings = [
      "指引有省略：先 relay_project/relay_task 读取完整约束和步骤，再查询分页契约/依赖/请求。",
    ];
    if (guide.task) {
      guide.task.description = "";
      guide.task.acceptance = "";
      guide.task.checkpoint = null;
      guide.task.scopes = [];
      guide.task.resources = [];
      guide.task.depends_on = [];
      guide.task.required_capabilities = [];
      guide.task.handoff = undefined;
      guide.task.evidence = undefined;
      guide.task.submission = undefined;
    }
    guide.omissions = [...new Set(omitted)];
    guide.truncated = true;
  }
  return guide;
}
