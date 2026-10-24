import type { Service } from "./domain.js";
import { errorInfo } from "../bin/errors.js";

/** Bounded local dispatcher. Only explicitly enabled Runs may start paid CLI work. */
export interface SchedulerRunner {
  live: ReadonlyMap<string, unknown>;
  start: (args: { run_id: string; task_id: string }) => unknown;
}
export class Scheduler {
  service: Service;
  runner: SchedulerRunner;
  timer: NodeJS.Timeout | undefined;
  running: boolean;
  constructor(service: Service, runner: SchedulerRunner) {
    this.service = service;
    this.runner = runner;
    this.timer = undefined;
    this.running = false;
  }
  start(interval = 5000) {
    if (!this.timer) {
      this.timer = setInterval(() => this.tick(), interval);
      this.timer.unref();
    }
  }
  stop() {
    clearInterval(this.timer);
    this.timer = undefined;
  }
  tick() {
    if (this.running || process.env.RELAYBOARD_RUNNERS === "0") return;
    this.running = true;
    const s = this.service;
    try {
      for (const candidate of s.store.list("run")) {
        if (
          !candidate.dispatch?.enabled ||
          candidate.status !== "active" ||
          ["running", "unknown"].includes(candidate.process?.status || "") ||
          this.runner.live.has(candidate.id)
        )
          continue;
        let run = s.run(candidate.id);
        const dispatch = run.dispatch;
        if (!dispatch) continue;
        if (dispatch.launches >= dispatch.max_launches) {
          s.store.transaction(() => {
            s.update("run", run, {
              dispatch: { ...dispatch, enabled: false },
            });
            s.emit(run.project_id, "dispatch.budget", {
              run_id: run.id,
              summary: "自动执行次数预算已用完，等待人工检查后重新启用",
            });
          });
          continue;
        }
        let task = s
          .tasks(run.project_id)
          .find(
            (t) =>
              t.owner_run_id === run.id &&
              ["doing", "blocked", "reconcile"].includes(t.status) &&
              (t.mode === "execute" || t.mode === "coordinator"),
          );
        if (!task) {
          const eligible = s
            .query("eligible", { project_id: run.project_id, run_id: run.id })
            .filter((e) => e.eligible)
            .sort(
              (a, b) =>
                ({ high: 0, normal: 1, low: 2 })[a.task.priority] -
                { high: 0, normal: 1, low: 2 }[b.task.priority],
            );
          if (!eligible.length) continue;
          const pick = eligible[0].task;
          task = s.execute("task_claim", {
            task_id: pick.id,
            run_id: run.id,
            expected_version: pick.version,
          });
        }
        const inbox = s.query("inbox", {
          run_id: run.id,
          unread_only: false,
          limit: 100,
        });
        // Checkpoint chatter alone never restarts the model. A new claim/epoch, reconciliation or new addressed message can.
        const children = s
          .tasks(run.project_id)
          .filter((t) => t.parent_id === task.id);
        const dependencies = [
          ...task.depends_on,
          ...s.ancestors(task).flatMap((t) => t.depends_on),
        ];
        const readiness = dependencies
          .map((id) => `${id}:${s.task(id).status}`)
          .join(",");
        const completeChildren =
          task.mode === "coordinator" &&
          children.length &&
          children.every((t) => t.status === "done")
            ? children.map((t) => `${t.id}:${t.version}`).join(",")
            : "";
        const signature = `${task.id}:${task.claim_epoch}:${inbox.at(-1)?.id || ""}:${readiness}:${completeChildren}`;
        if (signature === dispatch.last_signature) continue;
        s.store.transaction(() => {
          run = s.run(run.id);
          s.update("run", run, {
            dispatch: {
              ...dispatch,
              launches: dispatch.launches + 1,
              last_signature: signature,
              last_error: null,
            },
          });
          s.emit(run.project_id, "dispatch.started", {
            run_id: run.id,
            task_id: task.id,
            summary: `自动执行 ${task.short_id}（${dispatch.launches + 1}/${dispatch.max_launches}）`,
          });
        });
        try {
          this.runner.start({ run_id: run.id, task_id: task.id });
        } catch (error) {
          s.store.transaction(() => {
            const latest = s.run(run.id);
            s.update("run", latest, {
              dispatch: {
                ...(latest.dispatch || dispatch),
                enabled: false,
                last_error: errorInfo(error).message,
              },
            });
            s.emit(run.project_id, "dispatch.failed", {
              run_id: run.id,
              task_id: task.id,
              summary: errorInfo(error).message,
            });
          });
        }
      }
    } catch (error) {
      console.error("Relayboard dispatcher:", errorInfo(error).message);
    } finally {
      this.running = false;
    }
  }
}
