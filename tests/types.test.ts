import test from "node:test";
import assert from "node:assert/strict";
import { Service } from "../server/domain.ts";
import { Store } from "../server/store.ts";
import type { Project, Task } from "../server/types.ts";

// Compile-time contracts: defaults stay optional, known operations reject invalid inputs.
function typedContracts(service: Service) {
  const project: Project = service.execute("project_create", {
    name: "Typed",
    objective: "Check",
  });
  const task: Task = service.execute("task_create", {
    project_id: project.id,
    title: "Work",
    acceptance: "Pass",
  });
  // @ts-expect-error task_create requires acceptance.
  service.execute("task_create", { project_id: project.id, title: "Missing" });
  service.execute("task_claim", {
    task_id: task.id,
    // @ts-expect-error a claim uses a Run identity, never an agent_id field.
    agent_id: "agent",
    expected_version: 1,
  });
  // @ts-expect-error project query requires project_id.
  service.query("project", { task_id: task.id });
  // @ts-expect-error project query requires its input object.
  service.query("project");
  service.query("verification_profiles", {});
  service.query("verification_execution", { execution_id: "vex_x" });
  service.query("verification_history", { task_id: task.id });
  service.query("verification_log", { execution_id: "vex_x" });
  service.execute("verification_start", {
    task_id: task.id,
    run_id: "run_x",
    claim_epoch: 1,
    profile_id: "check",
  });
  service.execute("verification_stop", {
    execution_id: "vex_x",
    run_id: "run_x",
  });
  service.execute("verification_reconcile", {
    execution_id: "vex_x",
    run_id: "run_x",
    expected_version: 1,
    outcome: "confirmed_stopped",
    observed: "实际核实",
    confirmed_stop: true,
  });
  // @ts-expect-error verification_start requires claim_epoch.
  service.execute("verification_start", {
    task_id: task.id,
    run_id: "run_x",
    profile_id: "check",
  });
  // @ts-expect-error verification_reconcile requires confirmed_stop.
  service.execute("verification_reconcile", {
    execution_id: "vex_x",
    run_id: "run_x",
    expected_version: 1,
    outcome: "confirmed_stopped",
    observed: "x",
  });
  return task;
}
void typedContracts;

test("dynamic protocol names still validate inputs at runtime", () => {
  const store = new Store();
  try {
    const service = new Service(store);
    const operation: string = "task_claim";
    assert.throws(
      () =>
        service.execute(operation, { task_id: "fixture", agent_id: "wrong" }),
      { name: "ZodError" },
    );
    const queryName: string = "projects";
    assert.throws(() => service.query(queryName, { unexpected: true }), {
      name: "ZodError",
    });
    assert.deepEqual(service.query("projects"), []);
    assert.throws(
      () => service.execute("unknown_operation", {}),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "UNKNOWN_COMMAND",
    );
  } finally {
    store.close();
  }
});
