import test, { type TestContext } from "node:test";
import type { AddressInfo } from "node:net";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AppOptions } from "../server/app.ts";
import type { CommandInput, CommandName } from "../server/schemas.ts";
import type { CommandResult } from "../server/types.ts";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createApp } from "../server/app.ts";
import { createWorktree } from "../server/runner.ts";

function mcpText(result: CallToolResult): string {
  const text = result.content.find((c) => c.type === "text");
  assert.ok(text && text.type === "text");
  return text.text;
}

const exec = promisify(execFile);
const cli = fileURLToPath(new URL("../lib/bin/relayboard.js", import.meta.url));
const bridge = fileURLToPath(new URL("../lib/bin/mcp.js", import.meta.url));
async function fixture(t: TestContext, opts: Partial<AppOptions> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "relayboard-http-"));
  const instance = createApp({ dataDir: dir, port: 0, ...opts });
  const server = instance.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  instance.runner.baseUrl = url;
  t.after(async () => {
    await instance.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  });
  const headers = {
    "Content-Type": "application/json",
    ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
  };
  const post = async (
    path: string,
    body: unknown,
    extra: Record<string, string> = {},
  ) => {
    const res = await fetch(url + path, {
      method: "POST",
      headers: { ...headers, ...extra },
      body: JSON.stringify(body),
    });
    return { status: res.status, ...(await res.json()) };
  };
  const command = async <K extends CommandName>(
    operation: K,
    args: CommandInput<K>,
  ): Promise<CommandResult<K>> => {
    const result = await post("/api/command", { operation, args });
    assert.equal(result.status, 200, JSON.stringify(result));
    return result.result;
  };
  return { ...instance, server, url, dir, headers, post, command };
}
async function until(fn: () => boolean, timeout = 6000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for a known process");
}

test("HTTP validates requests, restricts origins, supports idempotent mutations and exports handoff files", async (t) => {
  const f = await fixture(t);
  const project = await f.command("project_create", {
    name: "HTTP",
    objective: "verify",
  });
  assert.equal(
    (
      await f.post("/api/command", {
        operation: "task_create",
        args: { project_id: project.id },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.post(
        "/api/query",
        { query: "projects" },
        { Origin: "https://example.com" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await f.post("/api/query", {
        query: "projects",
        args: { unexpected: true },
      })
    ).status,
    400,
  );
  const task = await f.command("task_create", {
    project_id: project.id,
    title: "实现",
    acceptance: "通过",
    scopes: ["src"],
  });
  const result = await f.post("/api/export", { task_id: task.id });
  assert.equal(result.status, 200);
  assert.ok(existsSync(join(result.result.path, "HANDOFF.md")));
  assert.equal(
    JSON.parse(readFileSync(join(result.result.path, "TASK.json"), "utf8")).id,
    task.id,
  );
});

test("bearer authentication applies to REST and MCP while health stays readable", async (t) => {
  const f = await fixture(t, { token: "fixture-token" });
  assert.equal((await fetch(`${f.url}/api/health`)).status, 200);
  assert.equal(
    (
      await fetch(`${f.url}/api/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"query":"projects"}',
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await fetch(`${f.url}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
    ).status,
    401,
  );
  assert.equal((await f.post("/api/query", { query: "projects" })).status, 200);
});

test("real MCP HTTP client discovers tools, creates project and receives structured error", async (t) => {
  const f = await fixture(t),
    client = new Client({ name: "test-http", version: "1" });
  const transport = new StreamableHTTPClientTransport(new URL(`${f.url}/mcp`));
  await client.connect(transport);
  t.after(() => client.close());
  const tools = await client.listTools();
  assert.ok(tools.tools.some((t) => t.name === "relay_agent_register"));
  assert.ok(tools.tools.some((t) => t.name === "relay_eligible"));
  const result = await client.callTool({
    name: "relay_project_create",
    arguments: { name: "MCP", objective: "shared task" },
  });
  const project = JSON.parse(mcpText(result as CallToolResult));
  assert.equal(project.name, "MCP");
  const query = await client.callTool({
    name: "relay_projects",
    arguments: {},
  });
  assert.equal(JSON.parse(mcpText(query as CallToolResult))[0].id, project.id);
  const missing = await client.callTool({
    name: "relay_task",
    arguments: { task_id: "missing" },
  });
  assert.equal(missing.isError, true);
  assert.equal(
    JSON.parse(mcpText(missing as CallToolResult)).code,
    "NOT_FOUND",
  );
});

test("stdio MCP bridge and CLI use the same authenticated HTTP state", async (t) => {
  const f = await fixture(t, { token: "bridge-token" });
  const env = {
    ...process.env,
    RELAYBOARD_URL: f.url,
    RELAYBOARD_TOKEN: "bridge-token",
  };
  const { stdout } = await exec(
    process.execPath,
    [
      cli,
      "command",
      "project_create",
      JSON.stringify({ name: "CLI project", objective: "persist" }),
    ],
    { env },
  );
  const project = JSON.parse(stdout);
  const integration = (
    await (
      await fetch(`${f.url}/api/integration`, { headers: f.headers })
    ).json()
  ).result;
  assert.equal(integration.base_url, f.url);
  const sourceVersion = await exec(
    integration.node,
    [...integration.cli_args, "--version"],
    { env, cwd: f.dir },
  );
  assert.match(sourceVersion.stdout.trim(), /^\d+\.\d+\.\d+/);
  for (const args of [[bridge], [cli, "mcp"], integration.mcp_args]) {
    const client = new Client({ name: "test-stdio", version: "1" });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args,
        env,
        cwd: f.dir,
        stderr: "pipe",
      }),
    );
    t.after(() => client.close());
    const result = await client.callTool({
      name: "relay_snapshot",
      arguments: { project_id: project.id },
    });
    assert.equal(
      JSON.parse(mcpText(result as CallToolResult)).project.name,
      "CLI project",
    );
  }
});

test("managed native process gets a packet, reports through API, captures session ID and exits without auto-acceptance", async (t) => {
  const fixtureCode = `
    console.log(JSON.stringify({type:'system',subtype:'init',session_id:'fixture-session'}));
    const request = async (path, body) => { const r = await fetch(process.env.RELAYBOARD_URL+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); const v=await r.json(); if(!r.ok) throw Error(JSON.stringify(v)); return v.result; };
    const task = await request('/api/query',{query:'task',args:{task_id:process.env.RELAYBOARD_TASK_ID}});
    await request('/api/command',{operation:'task_checkpoint',args:{task_id:task.id,run_id:process.env.RELAYBOARD_RUN_ID,claim_epoch:task.claim_epoch,summary:'fixture process saved progress',artifacts:[{path:'fixture-report.txt'}],verification:[{command:'fixture-check',passed:true,result:'fixture process executed'}]}});
    await request('/api/command',{operation:'task_submit',args:{task_id:task.id,run_id:process.env.RELAYBOARD_RUN_ID,claim_epoch:task.claim_epoch,summary:'ready for independent review'}});
    console.log('fixture done');
  `;
  const f = await fixture(t, {
    runnerProfiles: {
      codex: {
        command: process.execPath,
        args: ["--input-type=module", "-e", fixtureCode],
        stdin: true,
      },
    },
  });
  const project = await f.command("project_create", {
    name: "Runner",
    objective: "verify process",
  });
  const { run } = await f.command("agent_register", {
    project_id: project.id,
    name: "fixture",
    runtime: "codex",
    workdir: f.dir,
  });
  const task = await f.command("task_create", {
    project_id: project.id,
    title: "work",
    acceptance: "review",
    scopes: ["src"],
  });
  await f.command("task_claim", {
    task_id: task.id,
    run_id: run.id,
    expected_version: 1,
  });
  const started = await f.post("/api/runner/start", {
    run_id: run.id,
    task_id: task.id,
  });
  assert.equal(started.status, 200);
  await until(() => f.service.run(run.id).process?.status === "exited");
  assert.equal(f.service.task(task.id).status, "review");
  assert.equal(f.service.run(run.id).provider_session_id, "fixture-session");
  assert.ok(f.runner.logs(run.id).text.includes("fixture done"));
  assert.equal(f.runner.live.size, 0);
});

test("stopping a managed process preserves task claims and allows explicit handoff only after exit", async (t) => {
  const f = await fixture(t, {
    runnerProfiles: {
      pi: {
        command: process.execPath,
        args: ["-e", "console.log('live');setInterval(()=>{},1000)"],
        stdin: true,
      },
    },
  });
  const project = await f.command("project_create", {
    name: "Stop",
    objective: "verify stop",
  });
  const { run } = await f.command("agent_register", {
    project_id: project.id,
    name: "fixture pi",
    runtime: "pi",
    workdir: f.dir,
  });
  const { run: other } = await f.command("agent_register", {
    project_id: project.id,
    name: "next",
    runtime: "claude",
    workdir: f.dir,
  });
  const task = await f.command("task_create", {
    project_id: project.id,
    title: "work",
    acceptance: "review",
    scopes: ["src"],
  });
  const claimed = await f.command("task_claim", {
    task_id: task.id,
    run_id: run.id,
    expected_version: 1,
  });
  f.runner.start({ run_id: run.id, task_id: task.id });
  assert.throws(
    () =>
      f.service.execute("task_handoff", {
        task_id: task.id,
        expected_version: claimed.version,
        to_run_id: other.id,
        descendants: "continue",
        confirmed_stop: true,
        summary: "transfer",
      }),
    (e: unknown) =>
      e instanceof Error && "code" in e && e.code === "PROCESS_RUNNING",
  );
  f.runner.stop(run.id);
  await until(() => f.service.run(run.id).process?.status === "stopped");
  assert.equal(f.service.task(task.id).owner_run_id, run.id);
  const result = await f.command("task_handoff", {
    task_id: task.id,
    expected_version: claimed.version,
    to_run_id: other.id,
    descendants: "continue",
    confirmed_stop: true,
    summary: "transfer",
  });
  assert.equal(result.status, "reconcile");
});

test("actual Git worktrees isolate files without resetting original checkout", async (t) => {
  const f = await fixture(t);
  const repo = join(f.dir, "repo");
  await exec("git", ["init", repo]);
  await exec("git", [
    "-C",
    repo,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.test",
    "commit",
    "--allow-empty",
    "-m",
    "Initial",
  ]);
  const project = await f.command("project_create", {
    name: "Git",
    objective: "isolate",
    root_path: repo,
  });
  const workspace = await createWorktree(f.service, f.dir, {
    project_id: project.id,
    name: "api",
  });
  assert.ok(existsSync(join(workspace.workdir, ".git")));
  assert.equal(
    (
      await exec("git", ["-C", workspace.workdir, "branch", "--show-current"])
    ).stdout.trim(),
    "relayboard/api",
  );
  assert.notEqual(workspace.workdir, repo);
  await assert.rejects(
    createWorktree(f.service, f.dir, { project_id: project.id, name: "api" }),
  );
});

test("skill catalog exposes bundled roles and exact sources behind authentication", async (t) => {
  const f = await fixture(t, { token: "skills-fixture" });
  assert.equal((await fetch(`${f.url}/api/skills`)).status, 401);
  const catalog = await (
    await fetch(`${f.url}/api/skills`, { headers: f.headers })
  ).json();
  assert.equal(catalog.result.length, 7);
  assert.equal(
    new Set(catalog.result.map((s: { name: string }) => s.name)).size,
    7,
  );
  for (const skill of catalog.result) {
    assert.ok(existsSync(skill.path));
    const res = await fetch(`${f.url}/api/skills/${skill.name}`, {
      headers: f.headers,
    });
    assert.equal(res.status, 200);
    const { result } = await res.json();
    assert.equal(result.content, readFileSync(skill.path, "utf8"));
  }
  assert.equal(
    (await fetch(`${f.url}/api/skills/package.json`, { headers: f.headers }))
      .status,
    404,
  );
});

test("real HTTP MCP guides a fresh executor through recovery, steps, verification and review with fenced handles", async (t) => {
  const f = await fixture(t);
  const client = new Client({ name: "fresh-guided-executor", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(f.url + "/mcp")),
  );
  t.after(() => client.close());
  const tools = await client.listTools();
  for (const name of [
    "relay_work_start",
    "relay_work_next",
    "relay_work_report",
  ])
    assert.ok(tools.tools.some((tool) => tool.name === name));
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = (await client.callTool({
      name: "relay_" + name,
      arguments: args,
    })) as CallToolResult;
    assert.ok(!result.isError, mcpText(result));
    return result.structuredContent!.result;
  };
  const project = await f.command("project_create", {
    name: "MCP恢复",
    objective: "只靠服务指引完成",
  });
  const { run } = await f.command("agent_register", {
    project_id: project.id,
    name: "新上下文执行者",
    runtime: "codex",
    workdir: f.dir,
  });
  const task = await f.command("task_create", {
    project_id: project.id,
    title: "步骤任务",
    acceptance: "产出与验证",
    scopes: ["result.txt"],
    execution: {
      steps: [
        {
          id: "write",
          title: "写入",
          instructions: "写result.txt",
          done_when: "内容正确",
          on_failure: "报告阻塞",
        },
      ],
    },
  });
  let guide = (await call("work_start", {
    run_id: run.id,
    task_id: task.id,
  })) as import("../server/types.ts").WorkGuide;
  assert.equal(guide.stage, "recover");
  guide = (await call("work_report", {
    handle: guide.handle,
    kind: "recover",
    summary: "已核对现场",
    observed: "目录/分支/改动/进程已核对",
    read_decision_ids: [],
    dependency_receipts: [],
  })) as typeof guide;
  assert.equal(guide.stage, "execute");
  const before = guide.handle;
  guide = (await call("work_report", {
    handle: guide.handle,
    kind: "step",
    step_id: "write",
    summary: "产出已保存",
  })) as typeof guide;
  const stale = (await client.callTool({
    name: "relay_work_report",
    arguments: { handle: before, kind: "progress", summary: "过期写入" },
  })) as CallToolResult;
  assert.ok(stale.isError);
  assert.match(mcpText(stale), /STALE_VERSION/);
  assert.equal(guide.stage, "verify");
  guide = (await call("work_report", {
    handle: guide.handle,
    kind: "verify",
    summary: "实际验证通过",
    artifacts: [{ path: "result.txt" }],
    verification: [
      { command: "fixture check", passed: true, result: "observed pass" },
    ],
  })) as typeof guide;
  assert.equal(guide.stage, "submit");
  guide = (await call("work_report", {
    handle: guide.handle,
    kind: "submit",
    summary: "请独立验收",
  })) as typeof guide;
  assert.equal(guide.stage, "review");
  assert.equal(
    f.service.task(task.id).evidence?.verification_source,
    "agent_reported",
  );
});
