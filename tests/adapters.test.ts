import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import piExtension, {
  type PiExtensionApi,
  type Injection,
  type ExtensionContext,
} from "../integrations/pi-extension.js";
import { Store } from "../server/store.js";
import { Service } from "../server/domain.js";
import { Runner } from "../server/runner.js";

test("pi lifecycle adapter registers MCP, injects bounded context, reinjects after compaction and cleans resources", async (t) => {
  const originalFetch = globalThis.fetch,
    env = { ...process.env };
  process.env.RELAYBOARD_URL = "http://127.0.0.1:9999";
  process.env.RELAYBOARD_RUN_ID = "run_fixture";
  process.env.RELAYBOARD_TASK_ID = "task_fixture";
  process.env.RELAYBOARD_TOKEN = "fixture-token";
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const k of [
      "RELAYBOARD_URL",
      "RELAYBOARD_RUN_ID",
      "RELAYBOARD_TASK_ID",
      "RELAYBOARD_TOKEN",
    ]) {
      if (env[k] === undefined) delete process.env[k];
      else process.env[k] = env[k];
    }
  });
  const calls: {
      url: string;
      body: { query?: string; operation?: string };
      headers: Headers;
    }[] = [],
    handlers = new Map<
      string,
      (event: unknown, ctx: ExtensionContext) => Promise<Injection | void>
    >(),
    entries = [],
    servers: {
      name: string;
      opts: Parameters<NonNullable<PiExtensionApi["registerMcpServer"]>>[1];
    }[] = [];
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(String(opts?.body));
    url = String(url);
    calls.push({ url, body, headers: new Headers(opts?.headers) });
    const result = url.endsWith("/api/export")
      ? { path: "/fixture/HANDOFF.md" }
      : body.query === "context"
        ? { version: 1, markdown: "# Existing facts" }
        : body.query === "inbox"
          ? [{ id: "msg_fixture", body: "Check interface" }]
          : {};
    return Response.json({ result });
  };
  piExtension({
    on: (name, fn) => handlers.set(name, fn),
    registerMcpServer: (name, opts) => servers.push({ name, opts }),
    appendEntry: (type, value) => entries.push({ type, value }),
  });
  assert.equal(
    calls.length,
    0,
    "loading the factory does not start timers/network",
  );
  assert.equal(servers[0].opts.url, "http://127.0.0.1:9999/mcp");
  const ctx = { ui: { notify: () => {} } };
  await handlers.get("session_start")!({}, ctx);
  const injected = await handlers.get("before_agent_start")!({}, ctx);
  assert.ok(injected!.message.content.includes("Existing facts"));
  assert.ok(injected!.message.content.includes("msg_fixture"));
  assert.equal(
    await handlers.get("before_agent_start")!({}, ctx),
    undefined,
    "unchanged context is not repeatedly appended",
  );
  await handlers.get("session_before_compact")!({}, ctx);
  assert.equal(entries.length, 1);
  await handlers.get("session_compact")!({}, ctx);
  assert.ok(
    (await handlers.get("before_agent_start")!({}, ctx))!.message,
    "fresh context is restored after compaction",
  );
  await handlers.get("session_shutdown")!({}, ctx);
  await handlers.get("session_shutdown")!({}, ctx);
  assert.ok(
    calls.every(
      (c) => c.headers.get("Authorization") === "Bearer fixture-token",
    ),
  );
  assert.ok(
    !calls.some(
      (c) =>
        c.body.operation === "task_release" ||
        c.body.operation === "task_review",
    ),
    "hooks never invent acceptance or release",
  );
});

test("recovery marks old managed processes unknown, retains claims and blocks unsafe restart until reconciled", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "relayboard-recovery-")),
    store = new Store(join(dir, "test.sqlite")),
    s = new Service(store);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const p = s.execute("project_create", {
      name: "Recovery",
      objective: "preserve",
    }),
    { run } = s.execute("agent_register", {
      project_id: p.id,
      name: "A",
      runtime: "codex",
      workdir: dir,
    });
  const task = s.execute("task_create", {
    project_id: p.id,
    title: "A",
    acceptance: "evidence",
    scopes: ["src"],
  });
  s.execute("task_claim", {
    task_id: task.id,
    run_id: run.id,
    expected_version: 1,
  });
  store.transaction(() =>
    s.update("run", run, {
      process: { status: "running", pid: 999999, task_id: task.id },
    }),
  );
  const runner = new Runner(s, {
    dataDir: dir,
    baseUrl: "http://127.0.0.1:9999",
  });
  assert.equal(
    s.run(run.id).process!.status,
    "running",
    "constructing another server does not mutate active records before it binds",
  );
  runner.recover();
  assert.equal(s.run(run.id).status, "unknown");
  assert.equal(s.task(task.id).owner_run_id, run.id);
  assert.throws(
    () => runner.start({ run_id: run.id, task_id: task.id }),
    (e: unknown) =>
      e instanceof Error && "code" in e && e.code === "PROCESS_UNCONFIRMED",
  );
  const updated = s.execute("run_process_reconcile", {
    run_id: run.id,
    confirmed_stopped: true,
    observed:
      "Checked process handle and task workspace; no old writer remains.",
  });
  assert.equal(updated.process!.status, "stopped");
  assert.equal(updated.status, "active");
});

test("readiness inherits parent dependencies and manual planning requires human confirmation", (t) => {
  const store = new Store(),
    s = new Service(store);
  t.after(() => store.close());
  const p = s.execute("project_create", {
      name: "Manual",
      objective: "plan",
      autonomy: "manual",
    }),
    { run } = s.execute("agent_register", {
      project_id: p.id,
      name: "A",
      runtime: "codex",
    });
  const fields = {
    project_id: p.id,
    title: "Task",
    acceptance: "evidence",
    scopes: ["src"],
  };
  assert.throws(
    () => s.execute("task_create", { ...fields, actor_run_id: run.id }),
    (e: unknown) =>
      e instanceof Error && "code" in e && e.code === "HUMAN_PLANNING",
  );
  const dep = s.execute("task_create", {
    ...fields,
    title: "Dependency",
    scopes: ["contract"],
  });
  const task = s.execute("task_create", { ...fields, depends_on: [dep.id] });
  const children = [
    { title: "A", acceptance: "pass", scopes: ["src/a"] },
    { title: "B", acceptance: "pass", scopes: ["src/b"] },
  ];
  assert.throws(
    () =>
      s.execute("task_split", {
        task_id: task.id,
        expected_version: 1,
        actor_run_id: run.id,
        rationale: "split",
        children,
      }),
    (e: unknown) =>
      e instanceof Error && "code" in e && e.code === "HUMAN_PLANNING",
  );
  const split = s.execute("task_split", {
    task_id: task.id,
    expected_version: 1,
    rationale: "human split",
    children,
  });
  assert.ok(
    s
      .eligibility(split.children[0], run)
      .reasons.some((r) => r.includes("上层")),
  );
});

test("event cursor pages all records without gaps and snapshots return the latest page", (t) => {
  const store = new Store(),
    s = new Service(store);
  t.after(() => store.close());
  const p = s.execute("project_create", { name: "Events", objective: "page" });
  for (let i = 0; i < 90; i++)
    store.transaction(() => s.emit(p.id, "fixture", { summary: String(i) }));
  const first = s.query("events", { project_id: p.id, after: 0, limit: 40 });
  const second = s.query("events", {
    project_id: p.id,
    after: first.at(-1)!.seq,
    limit: 40,
  });
  const third = s.query("events", {
    project_id: p.id,
    after: second.at(-1)!.seq,
    limit: 40,
  });
  assert.equal(first.length + second.length + third.length, 91);
  const ids = [...first, ...second, ...third].map((e) => e.seq);
  assert.equal(new Set(ids).size, 91);
  assert.equal(ids[0], 1);
  assert.equal(ids.at(-1), 91);
  const latest = s.query("snapshot", { project_id: p.id }).events;
  assert.equal(latest.length, 80);
  assert.equal(latest.at(-1)!.seq, 91);
});

test("handoff packets explicitly flag internal omissions and complete constraints remain queryable", (t) => {
  const store = new Store(),
    s = new Service(store);
  t.after(() => store.close());
  const constraints = "重要约束。".repeat(1000),
    p = s.execute("project_create", {
      name: "Context",
      objective: "resume",
      constraints,
    });
  const task = s.execute("task_create", {
    project_id: p.id,
    title: "Work",
    acceptance: "pass",
    scopes: ["src"],
  });
  const packet = s.query("context", { task_id: task.id, max_chars: 24000 });
  assert.equal(packet.truncated, true);
  assert.ok(packet.omissions.length > 0);
  assert.ok(packet.markdown.includes("relay_project"));
  assert.equal(
    s.query("project", { project_id: p.id }).constraints,
    constraints,
  );
  assert.throws(
    () => s.execute("project_create", { name: "   ", objective: "work" }),
    (e: unknown) => e instanceof Error && e.name === "ZodError",
  );
});
