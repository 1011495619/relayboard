import type { Service } from "./domain.ts";
import { AppError } from "./domain.ts";
import type { CommandArgs, QueryArgs } from "./schemas.ts";
import type {
  Task,
  Run,
  SupervisorIncident,
  SupervisorPolicy,
  SupervisorStatus,
  RuntimeDiagnosis,
} from "./types.ts";
import type { RuntimeInfo } from "./runtimes.ts";
import { supportsLaunch } from "./runtimes.ts";
import { digest } from "./workflow.ts";
import {
  errorInfo,
  classifyRuntimeError,
} from "../bin/errors.ts";

const notice =
  "巡视覆盖所有项目和原生子孙任务。心跳和进程输出不计为任务进展；提醒持久保存，但外部聊天窗口需主动读取。付费执行只按 recover 策略与预算启动，未知旧进程须先核实。";
const seconds = (value: number) => value * 1000;
const id = (task: Task) => `sup_${task.id}`;
const iso = (value: number) => new Date(value).toISOString();
/** Ownership changes and reminders do not reset the actual-progress clock. */
export function progressSignature(task: Task) {
  return digest({
    status: task.status === "reconcile" ? "doing" : task.status,
    checkpoint: task.checkpoint
      ? {
          at: task.checkpoint.at,
          summary: task.checkpoint.summary,
          next_step: task.checkpoint.next_step,
          blocker: task.checkpoint.blocker,
        }
      : null,
    completed_steps: task.workflow?.completed_steps,
    artifacts: task.artifacts,
    verification: task.verification,
  });
}
export function configureSupervisor(
  s: Service,
  args: CommandArgs<"supervisor_configure">,
): SupervisorPolicy {
  s.get("project", args.project_id);
  const old = s.store.get("supervisor_policy", args.project_id);
  if (old) {
    if (!args.expected_version)
      throw new AppError(
        "SUPERVISOR_VERSION_REQUIRED",
        "修改巡视策略前请读取当前版本",
      );
    s.revision(old, args.expected_version);
  } else if (args.expected_version)
    throw new AppError("STALE_VERSION", "巡视策略尚未创建，请刷新");
  if (args.runtimes.some((r) => !supportsLaunch(r)))
    throw new AppError(
      "SUPERVISOR_RUNTIME",
      "恢复工具须选择 CLI 客户端，MCP 窗口在各自客户端中启动",
    );
  const { expected_version: _version, reset_budget, ...fields } = args;
  const at = new Date().toISOString();
  const policy: SupervisorPolicy = {
    ...fields,
    id: args.project_id,
    version: (old?.version || 0) + 1,
    created_at: old?.created_at || at,
    updated_at: at,
    launches: reset_budget ? 0 : old?.launches || 0,
  };
  s.store.put("supervisor_policy", policy);
  if (reset_budget)
    for (const state of s.store.list("supervisor_state", args.project_id))
      s.update("supervisor_state", state, {
        attempts: 0,
        last_attempt_at: null,
      });
  s.emit(args.project_id, "supervisor.configured", {
    summary: `巡视策略 ${args.mode}：${args.note}`,
    policy_version: policy.version,
    reset_budget,
  });
  return policy;
}
export function supervisorStatus(
  s: Service,
  args: QueryArgs<"supervisor_status">,
): SupervisorStatus {
  if (args.project_id) s.get("project", args.project_id);
  const all = s.store
    .list("supervisor_incident", args.project_id)
    .sort(
      (a, b) =>
        Number(a.status === "resolved") - Number(b.status === "resolved") ||
        (b.updated_at || b.created_at).localeCompare(
          a.updated_at || a.created_at,
        ),
    );
  const incidents = all
    .slice(args.offset, args.offset + args.limit)
    .map((incident) => ({
      ...incident,
      task_title: s.task(incident.task_id).title,
      task_short_id: s.task(incident.task_id).short_id,
      project_name: s.get("project", incident.project_id).name,
    }));
  return {
    policies: s.store.list("supervisor_policy", args.project_id),
    incidents,
    total: all.length,
    next_offset:
      args.offset + incidents.length < all.length
        ? args.offset + incidents.length
        : null,
    notice,
  };
}
export function handleIncident(
  s: Service,
  args: CommandArgs<"supervisor_handle">,
) {
  const incident = s.get("supervisor_incident", args.incident_id);
  s.revision(incident, args.expected_version);
  if (incident.status === "recovering")
    throw new AppError(
      "SUPERVISOR_RECOVERING",
      "接手启动结果尚在核实，请先等待当前检查结束",
    );
  if (
    args.action === "snooze" &&
    (!args.until || Date.parse(args.until) <= Date.now())
  )
    throw new AppError("SUPERVISOR_SNOOZE_TIME", "暂缓时间须在未来");
  const result = s.update("supervisor_incident", incident, {
    status: "open",
    snoozed_until: args.action === "snooze" ? args.until : null,
    resolution: args.note,
  });
  s.emit(incident.project_id, "supervisor.handled", {
    task_id: incident.task_id,
    summary: args.note,
    action: args.action,
  });
  return result;
}
export interface SupervisorRunner {
  live: ReadonlyMap<string, unknown>;
  availability: (refresh?: boolean) => Promise<RuntimeInfo[]>;
  preflight: (args: { run_id: string; task_id: string }) => Promise<unknown>;
  start: (args: { run_id: string; task_id: string }) => unknown;
  stop: (runId: string, reason?: string) => unknown;
}
/** A cheap local clock patrols continuously; models are launched only for an actionable recovery. */
export class Supervisor {
  timer: NodeJS.Timeout | undefined;
  running = false;
  private stopped = false;
  constructor(
    readonly service: Service,
    readonly runner: SupervisorRunner,
    readonly clock: () => number = Date.now,
  ) {}
  start(interval = 15000) {
    this.stopped = false;
    if (!this.timer) {
      this.timer = setInterval(() => void this.tick(), interval);
      this.timer.unref();
    }
    void this.tick();
  }
  stop() {
    this.stopped = true;
    clearInterval(this.timer);
    this.timer = undefined;
  }
  async close() {
    this.stop();
    while (this.running)
      await new Promise((resolve) => setTimeout(resolve, 10));
  }
  private patch(
    incident: SupervisorIncident,
    fields: Partial<SupervisorIncident>,
  ) {
    return this.service.update("supervisor_incident", incident, fields);
  }
  private escalate(incident: SupervisorIncident, reason: string) {
    const s = this.service,
      latest = s.get("supervisor_incident", incident.id);
    if (latest.status === "escalated" && latest.resolution === reason)
      return latest;
    const result = this.patch(latest, {
      status: "escalated",
      resolution: reason,
      last_action_at: iso(this.clock()),
    });
    s.emit(result.project_id, "supervisor.escalated", {
      task_id: result.task_id,
      summary: reason,
    });
    return result;
  }
  /** Explainable diagnosis for a detected incident; never mutates task state. */
  private diagnoseIncident(
    task: Task,
    reason: string,
    at: number,
  ): RuntimeDiagnosis {
    const owner = task.owner_run_id ? this.service.run(task.owner_run_id) : null;
    return classifyRuntimeError({
      code:
        owner?.process?.status === "unknown"
          ? "PROCESS_UNCONFIRMED"
          : undefined,
      message: reason,
      phase: "supervisor",
      process_status: owner?.process?.status || owner?.status || undefined,
      observed_at: iso(at),
      source: owner?.process ? "process_observed" : "rule_inferred",
    });
  }
  private inspect(
    task: Task,
    at: number,
  ): { incident: SupervisorIncident; policy: SupervisorPolicy } | null {    const s = this.service,
      signature = progressSignature(task),
      key = id(task);
    let state = s.store.get("supervisor_state", key);
    if (!state) {
      const progressAt =
        task.checkpoint?.at || task.claimed_at || task.created_at;
      state = {
        id: key,
        project_id: task.project_id,
        task_id: task.id,
        signature,
        progress_at: progressAt,
        attempts: 0,
        last_attempt_at: null,
        version: 1,
        created_at: iso(at),
      };
      s.store.put("supervisor_state", state);
    }
    let incident = s.store.get("supervisor_incident", key);
    const changed = state.signature !== signature;
    if (changed) {
      state = s.update("supervisor_state", state, {
        signature,
        progress_at: task.checkpoint?.at || iso(at),
      });
      if (incident && incident.status !== "resolved")
        this.patch(incident, {
          status: "resolved",
          resolution: "观察到新的任务检查点、成果或状态进展。",
          last_action_at: iso(at),
        });
      incident = null;
    }
    if (["done", "review"].includes(task.status)) {
      if (incident && incident.status !== "resolved")
        this.patch(incident, {
          status: "resolved",
          resolution: "任务已提交验收或完成。",
        });
      return null;
    }
    if (
      task.waiting?.run_id === task.owner_run_id &&
      at < Date.parse(task.waiting.until)
    )
      return null;
    // A coordinator waiting for children is not itself a stalled writer. Descendants are scanned independently.
    const waitingChildren =
      task.mode === "coordinator" &&
      s
        .tasks(task.project_id)
        .some((t) => t.parent_id === task.id && t.status !== "done");
    const waitingDependency = [task, ...s.ancestors(task)].some((t) =>
      t.depends_on.some((dep) => s.task(dep).status !== "done"),
    );
    if (waitingChildren || waitingDependency) {
      if (incident && incident.status !== "resolved")
        this.patch(incident, {
          status: "resolved",
          resolution: waitingChildren
            ? "协调任务正在等待子任务，分别巡视子执行者。"
            : "等待前置依赖验收，暂停执行恢复。",
        });
      return null;
    }
    const policy =
      s.store.get("supervisor_policy", task.project_id) ||
      ({
        id: task.project_id,
        project_id: task.project_id,
        mode: "observe",
        stale_after_seconds: 900,
        grace_seconds: 300,
        cooldown_seconds: 300,
        max_launches: 0,
        max_attempts_per_task: 2,
        runtimes: ["codex", "pi"],
        stop_stalled_managed: false,
        note: "默认观察",
        launches: 0,
        version: 0,
        created_at: iso(at),
      } satisfies SupervisorPolicy);
    if (
      at - Date.parse(state.progress_at) <
      seconds(policy.stale_after_seconds)
    )
      return null;
    const owner = task.owner_run_id ? s.run(task.owner_run_id) : null;
    const reason = !owner
      ? "任务尚未领取"
      : owner.process?.status === "unknown"
        ? "旧进程状态待核实"
        : task.status === "blocked"
          ? "阻塞尚未处理"
          : owner.status !== "active"
            ? "负责人会话已经结束或状态未知"
            : owner.process &&
                ["failed", "exited", "stopped"].includes(owner.process.status)
              ? "进程已退出，任务仍未交付"
              : "任务长时间未保存进展";
    if (!incident || incident.status === "resolved") {
      incident = {
        id: key,
        project_id: task.project_id,
        task_id: task.id,
        owner_run_id: task.owner_run_id,
        progress_signature: signature,
        reason,
        status: "open",
        first_seen_at: iso(at),
        notified_at: null,
        last_action_at: null,
        message_id: null,
        attempts: state.attempts,
        replacement_run_id: null,
        resolution: "",
        version: (incident?.version || 0) + 1,
        created_at: incident?.created_at || iso(at),
        updated_at: iso(at),
      };
      s.store.put("supervisor_incident", incident);
      s.emit(task.project_id, "supervisor.detected", {
        task_id: task.id,
        run_id: task.owner_run_id,
        summary: reason,
      });
      s.emit(task.project_id, "supervisor.diagnosis", {
        task_id: task.id,
        run_id: task.owner_run_id,
        diagnosis: this.diagnoseIncident(task, reason, at),
      });
    } else if (
      incident.reason !== reason ||
      incident.owner_run_id !== task.owner_run_id
    ) {
      incident = this.patch(incident, {
        reason,
        owner_run_id: task.owner_run_id,
      });
      s.emit(task.project_id, "supervisor.diagnosis", {
        task_id: task.id,
        run_id: task.owner_run_id,
        diagnosis: this.diagnoseIncident(task, reason, at),
      });
    }
    if (incident.status === "recovering") {
      const replacement = incident.replacement_run_id
        ? s.run(incident.replacement_run_id)
        : null;
      if (!replacement?.process) {
        if (
          at - Date.parse(incident.last_action_at || incident.first_seen_at) <
          60000
        )
          return null;
        this.escalate(
          incident,
          "已保留启动预算但进程结果待核实；可能在启动前服务中断，请人工核验，避免重复启动。",
        );
        return null;
      }
      if (replacement.process.status === "unknown") {
        this.escalate(incident, "新会话进程状态未知；请先核实停止状态。");
        return null;
      }
      if (
        ["failed", "exited", "stopped"].includes(replacement.process.status) ||
        at - Date.parse(incident.last_action_at || incident.first_seen_at) >=
          seconds(policy.stale_after_seconds)
      )
        incident = this.patch(incident, {
          status: "open",
          resolution: "新执行者尚未报告进展，重新核对进程状态和预算。",
        });
      else return null;
    }
    if (policy.mode === "observe" || incident.status === "escalated")
      return null;
    if (incident.snoozed_until && at < Date.parse(incident.snoozed_until))
      return null;
    if (!incident.notified_at) {
      const recipient =
        owner?.status === "active"
          ? owner.id
          : s
              .ancestors(task)
              .map((t) => t.owner_run_id)
              .find((r) => r && s.run(r).status === "active") || undefined;
      const message = s.message_send({
        project_id: task.project_id,
        to_run_id: recipient,
        task_id: task.id,
        kind: "request",
        body: `巡视提醒：${task.short_id} ${reason}。先读取 work_next 核实现场，报告真实进展或具体阻塞；无需重复已经完成的操作。接手包与项目记忆保存在 Relayboard，记忆按需 memory_search/get。`,
        system: true,
      });
      incident = this.patch(incident, {
        notified_at: iso(at),
        last_action_at: iso(at),
        message_id: message.id,
      });
      s.emit(task.project_id, "supervisor.reminded", {
        task_id: task.id,
        run_id: recipient,
        summary: reason,
      });
      return null;
    }
    if (
      policy.mode !== "recover" ||
      at - Date.parse(incident.notified_at) < seconds(policy.grace_seconds)
    )
      return null;
    if (
      state.last_attempt_at &&
      at - Date.parse(state.last_attempt_at) < seconds(policy.cooldown_seconds)
    )
      return null;
    return { incident, policy };
  }
  async tick() {
    if (this.running || this.stopped) return;
    this.running = true;
    const s = this.service;
    try {
      for (const project of s.store.list("project")) {
        if (this.stopped) break;
        for (const item of s.tasks(project.id)) {
          if (this.stopped) break;
          const action = s.store.transaction(() =>
            this.inspect(s.task(item.id), this.clock()),
          );
          if (!action) continue;
          try {
            await this.recover(action.incident, action.policy);
          } catch (error) {
            s.store.transaction(() =>
              this.escalate(
                s.get("supervisor_incident", action.incident.id),
                `巡视恢复检查失败：${errorInfo(error).message.slice(0, 800)}`,
              ),
            );
          }
        }
      }
    } catch (error) {
      console.error("Relayboard supervisor:", errorInfo(error).message);
    } finally {
      this.running = false;
    }
  }
  private async recover(
    incident: SupervisorIncident,
    policy: SupervisorPolicy,
  ) {
    const s = this.service;
    const availability = await this.runner.availability();
    if (this.stopped) return;
    let launch: { run_id: string; task_id: string } | null = null;
    let stopRun: string | null = null;
    s.store.transaction(() => {
      const latest = s.get("supervisor_incident", incident.id),
        currentPolicy = s.store.get("supervisor_policy", policy.id),
        task = s.task(incident.task_id),
        state = s.get("supervisor_state", id(task));
      if (
        !currentPolicy ||
        currentPolicy.version !== policy.version ||
        currentPolicy.mode !== "recover" ||
        latest.version !== incident.version ||
        latest.status !== "open" ||
        progressSignature(task) !== latest.progress_signature
      )
        return;
      if (process.env.RELAYBOARD_RUNNERS === "0") {
        this.escalate(latest, "服务已禁用进程启动；请启用后重新检查。");
        return;
      }
      if (
        currentPolicy.launches >= currentPolicy.max_launches ||
        state.attempts >= currentPolicy.max_attempts_per_task
      ) {
        this.escalate(
          latest,
          "巡视执行预算已用完，请检查失败原因后显式重置预算。",
        );
        return;
      }
      const old = task.owner_run_id ? s.run(task.owner_run_id) : null;
      if (
        old &&
        (this.runner.live.has(old.id) || old.process?.status === "running")
      ) {
        if (
          !currentPolicy.stop_stalled_managed ||
          !this.runner.live.has(old.id)
        ) {
          this.escalate(
            latest,
            "原进程仍在运行；已提醒，等待进度或人工停止后接手。",
          );
          return;
        }
        if (
          latest.resolution.startsWith("按策略请求停止") &&
          latest.last_action_at &&
          this.clock() - Date.parse(latest.last_action_at) <
            seconds(currentPolicy.cooldown_seconds)
        )
          return;
        this.patch(latest, {
          last_action_at: iso(this.clock()),
          resolution: "按策略请求停止本服务托管进程；等待实际退出后再交接。",
        });
        stopRun = old.id;
        return;
      }
      const knownStopped =
        !old ||
        (old.process &&
          ["exited", "failed", "stopped"].includes(old.process.status)) ||
        (!old.process && old.status === "ended");
      if (!knownStopped) {
        this.escalate(
          latest,
          "旧执行者是否停止尚未确认；请核实原会话/进程后再接手。心跳过期不代表退出。",
        );
        return;
      }
      const unresolved = s.store
        .list("message", task.project_id)
        .filter(
          (m) =>
            m.task_id === task.id &&
            !m.system &&
            !m.resolved_at &&
            ["request", "blocker"].includes(m.kind),
        );
      if (task.status === "blocked" && unresolved.length) {
        this.escalate(
          latest,
          "任务仍有明确未处理请求；请处理请求后再恢复，避免无效重试。",
        );
        return;
      }
      const runtimes = [
        ...currentPolicy.runtimes.slice(
          state.attempts % currentPolicy.runtimes.length,
        ),
        ...currentPolicy.runtimes.slice(
          0,
          state.attempts % currentPolicy.runtimes.length,
        ),
      ];
      const runtime = runtimes.find((runtime) =>
        availability.some((a) => a.runtime === runtime && a.launchable),
      );
      if (!runtime) {
        this.escalate(
          latest,
          "策略指定的 CLI 均未就绪，请在 Agent 接入检查安装与配置。",
        );
        return;
      }
      const workdir =
        old?.workdir || s.get("project", task.project_id).root_path;
      if (!workdir) {
        this.escalate(latest, "项目与原会话尚未设置实际工作目录。");
        return;
      }
      // Nested service operations remain inside one SQLite transaction so two patrols cannot reserve the same recovery.
      try {
        const parent =
          old?.parent_run_id ||
          (task.parent_id ? s.task(task.parent_id).owner_run_id : null);
        const replacement = s.agent_register({
          project_id: task.project_id,
          name: `巡视接手 · ${task.short_id} · ${state.attempts + 1}`,
          runtime,
          parent_run_id: parent || undefined,
          capabilities: old?.capabilities || task.required_capabilities,
          workdir,
          branch: old?.branch || "",
          observation: "adapter",
          delegated_scopes: task.scopes,
        }).run;
        const summary = `巡视接手：${latest.reason}。原检查点、已完成步骤、失败尝试、成果与相关项目记忆保留；先用 work_start/work_next 核验现场后继续。`;
        const transferred = old
          ? s.task_handoff({
              task_id: task.id,
              expected_version: task.version,
              from_run_id: old.id,
              to_run_id: replacement.id,
              summary,
              descendants: "continue",
              confirmed_stop: true,
            })
          : s.task_claim({
              task_id: task.id,
              run_id: replacement.id,
              expected_version: task.version,
            });
        if (old?.dispatch?.enabled)
          s.update("run", s.run(old.id), {
            dispatch: { ...old.dispatch, enabled: false },
          });
        s.update("supervisor_policy", currentPolicy, {
          launches: currentPolicy.launches + 1,
        });
        s.update("supervisor_state", state, {
          signature: progressSignature(transferred),
          attempts: state.attempts + 1,
          last_attempt_at: iso(this.clock()),
        });
        this.patch(latest, {
          status: "recovering",
          replacement_run_id: replacement.id,
          owner_run_id: replacement.id,
          progress_signature: progressSignature(transferred),
          attempts: state.attempts + 1,
          last_action_at: iso(this.clock()),
          resolution: "已原子保留执行预算并建立新身份；启动结果须核验。",
        });
        launch = { run_id: replacement.id, task_id: task.id };
        s.emit(task.project_id, "supervisor.recovery_reserved", {
          task_id: task.id,
          run_id: replacement.id,
          summary,
        });
      } catch (error) {
        throw error;
      }
    });
    if (stopRun) {
      this.runner.stop(stopRun, "巡视策略：长期无任务进展");
      return;
    }
    if (!launch) return;
    const reserved: { run_id: string; task_id: string } = launch;
    try {
      await this.runner.preflight(reserved);
      const latestPolicy = s.store.get("supervisor_policy", policy.id);
      const latestIncident = s.get("supervisor_incident", incident.id);
      if (
        this.stopped ||
        latestPolicy?.mode !== "recover" ||
        latestIncident.status !== "recovering" ||
        latestIncident.replacement_run_id !== reserved.run_id
      )
        throw new Error("巡视策略或接手状态已改变，保留交接记录待人工启动。");
      this.runner.start(reserved);
      s.store.transaction(() =>
        s.emit(policy.project_id, "supervisor.recovery_started", {
          task_id: reserved.task_id,
          run_id: reserved.run_id,
          summary: "已启动带接手包的新执行会话；进程退出不等于交付。",
        }),
      );
    } catch (error) {
      s.store.transaction(() => {
        this.escalate(
          s.get("supervisor_incident", incident.id),
          `接手启动失败：${errorInfo(error).message.slice(0, 800)}`,
        );
        s.emit(policy.project_id, "supervisor.diagnosis", {
          task_id: incident.task_id,
          run_id: incident.owner_run_id,
          diagnosis: classifyRuntimeError({
            code: errorInfo(error).code,
            message: errorInfo(error).message,
            phase: "spawn",
            source: "adapter_observed",
          }),
        });
      });
    }
  }
}
