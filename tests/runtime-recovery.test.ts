import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.ts";
import { Service } from "../server/domain.ts";
import { Runner, providerModelError } from "../server/runner.ts";
import {
  classifyRuntimeError,
  diagnoseThrown,
} from "../bin/errors.ts";
import type { RuntimeDiagnosis } from "../server/types.ts";

test("classification maps structured codes to the six contract categories", () => {
  const cases: Array<{
    input: Parameters<typeof classifyRuntimeError>[0];
    category: RuntimeDiagnosis["category"];
    confidence: RuntimeDiagnosis["confidence"];
    next: RuntimeDiagnosis["next_action"]["kind"];
  }> = [
    {
      input: { code: "AUTH_FAILED", message: "invalid token" },
      category: "authentication",
      confidence: "high",
      next: "authenticate",
    },
    {
      input: { code: "ECONNRESET", message: "connection reset" },
      category: "transient",
      confidence: "high",
      next: "wait",
    },
    {
      input: { code: "EACCES", message: "permission denied" },
      category: "permission",
      confidence: "high",
      next: "inspect",
    },
    {
      input: { code: "ENOENT", message: "command not found" },
      category: "configuration",
      confidence: "high",
      next: "configure",
    },
    {
      input: { code: "PROCESS_UNCONFIRMED", message: "旧进程状态未知" },
      category: "process_unknown",
      confidence: "high",
      next: "confirm_stop",
    },
    {
      input: { code: "SOMETHING_NEW", message: "no structured signal" },
      category: "unknown",
      confidence: "low",
      next: "inspect",
    },
  ];
  for (const c of cases) {
    const d = classifyRuntimeError(c.input);
    assert.equal(d.category, c.category, c.input.code ?? undefined);
    assert.equal(d.confidence, c.confidence, c.input.code ?? undefined);
    assert.equal(d.next_action.kind, c.next, c.input.code ?? undefined);
  }
});

test("classification uses sanitized message text when codes are absent", () => {
  const auth = classifyRuntimeError({ message: "401 unauthorized: api key invalid" });
  assert.equal(auth.category, "authentication");
  assert.equal(auth.next_action.kind, "authenticate");

  const conn = classifyRuntimeError({ message: "Connection error while calling model" });
  assert.equal(conn.category, "transient");

  const rate = classifyRuntimeError({ message: "rate limit exceeded, retry later" });
  assert.equal(rate.category, "transient");
  assert.equal(rate.next_action.kind, "retry");

  const denied = classifyRuntimeError({ message: "403 permission denied by client" });
  assert.equal(denied.category, "permission");

  const missing = classifyRuntimeError({ message: "command not found in PATH" });
  assert.equal(missing.category, "configuration");
});

test("process_unknown is emitted conservatively and never guesses success", () => {
  const d = classifyRuntimeError({
    process_status: "unknown",
    phase: "supervisor",
    message: "重启遗留运行记录",
  });
  assert.equal(d.category, "process_unknown");
  assert.equal(d.source, "process_observed");
  assert.equal(d.next_action.kind, "confirm_stop");
  assert.ok(d.summary.includes("不自动交接"));
});

test("diagnoseThrown preserves AppError codes and evidence", () => {
  const d = diagnoseThrown(
    Object.assign(new Error("CLI 未安装"), { code: "CLI_UNAVAILABLE" }),
    { phase: "preflight" },
  );
  assert.equal(d.category, "configuration");
  assert.ok(d.evidence.some((e) => e.startsWith("code=CLI_UNAVAILABLE")));
});

test("runner emits a structured runner.diagnosis event for model authentication errors", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "relayboard-diagnosis-")),
    store = new Store(),
    s = new Service(store);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const project = s.execute("project_create", {
    name: "Diagnosis",
    objective: "classify",
    root_path: dir,
  });
  const { run } = s.execute("agent_register", {
    project_id: project.id,
    name: "A",
    runtime: "codex",
    workdir: dir,
  });
  const task = s.execute("task_create", {
    project_id: project.id,
    title: "T",
    acceptance: "evidence",
    scopes: ["src"],
  });
  s.execute("task_claim", {
    task_id: task.id,
    run_id: run.id,
    expected_version: 1,
  });
  const script = join(dir, "auth-error.mjs");
  writeFileSync(
    script,
    [
      `process.stdout.write(JSON.stringify({type:"turn.failed",error:{message:"401 unauthorized"}})+"\\n");`,
      `setTimeout(()=>process.exit(0),50);`,
    ].join("\n"),
  );
  const runner = new Runner(s, {
    dataDir: dir,
    baseUrl: "http://127.0.0.1:9999",
    profiles: {
      codex: { command: process.execPath, args: [script], stdin: false },
    },
  });
  runner.start({ run_id: run.id, task_id: task.id });
  for (let i = 0; i < 100 && runner.live.size; i++)
    await new Promise((r) => setTimeout(r, 10));
  t.after(() => {
    if (runner.live.size) runner.stop(run.id);
  });
  const events = s.store
    .events(project.id)
    .filter((e) => e.type === "runner.diagnosis");
  assert.ok(events.length >= 1, "runner.diagnosis event exists");
  const d = events[0].diagnosis as RuntimeDiagnosis;
  assert.equal(d.category, "authentication");
  assert.equal(d.next_action.kind, "authenticate");
});

test("runner classifies non-zero exit stderr as transient and keeps unknown exits conservative", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "relayboard-exit-")),
    store = new Store(),
    s = new Service(store);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const project = s.execute("project_create", {
    name: "Exit",
    objective: "classify",
    root_path: dir,
  });
  const { run } = s.execute("agent_register", {
    project_id: project.id,
    name: "A",
    runtime: "pi",
    workdir: dir,
  });
  const task = s.execute("task_create", {
    project_id: project.id,
    title: "T",
    acceptance: "evidence",
    scopes: ["src"],
  });
  s.execute("task_claim", {
    task_id: task.id,
    run_id: run.id,
    expected_version: 1,
  });
  const script = join(dir, "transient.mjs");
  writeFileSync(
    script,
    [
      `process.stderr.write("Connection error while contacting server");`,
      `setTimeout(()=>process.exit(3),50);`,
    ].join("\n"),
  );
  const runner = new Runner(s, {
    dataDir: dir,
    baseUrl: "http://127.0.0.1:9999",
    profiles: {
      pi: { command: process.execPath, args: [script], stdin: false },
    },
  });
  runner.start({ run_id: run.id, task_id: task.id });
  for (let i = 0; i < 100 && runner.live.size; i++)
    await new Promise((r) => setTimeout(r, 10));
  const d = s.store
    .events(project.id)
    .filter((e) => e.type === "runner.diagnosis")
    .at(-1)?.diagnosis as RuntimeDiagnosis | undefined;
  assert.ok(d);
  assert.equal(d.category, "transient");
  assert.equal(s.run(run.id).process?.status, "failed");
  assert.equal(s.task(task.id).status, "doing");
});

test("model error recovery and provider observation stay separated from task progress", () => {
  assert.equal(
    providerModelError("codex", { type: "turn.failed", error: { message: "401" } }),
    "401",
  );
  assert.equal(providerModelError("codex", { type: "turn.completed" }), "");
  const d = classifyRuntimeError({
    message: providerModelError("pi", {
      type: "message_end",
      message: { role: "assistant", stopReason: "error", errorMessage: "Connection error" },
    })!,
    phase: "model",
    source: "adapter_observed",
  });
  assert.equal(d.category, "transient");
  assert.equal(d.source, "adapter_observed");
});
