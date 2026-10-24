import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { Store } from "../server/store.ts";
import { Service } from "../server/domain.ts";
import { createApp } from "../server/app.ts";
import {
  Runner,
  buildRunnerArgs,
  readRunnerProfiles,
  providerSessionId,
} from "../server/runner.ts";
import {
  runtimeCatalog,
  defaultRunnerProfiles,
  runtimeIds,
} from "../server/runtimes.ts";

function env(t: TestContext, value?: string) {
  const previous = process.env.RELAYBOARD_RUNNERS;
  if (value === undefined) delete process.env.RELAYBOARD_RUNNERS;
  else process.env.RELAYBOARD_RUNNERS = value;
  t.after(() => {
    if (previous === undefined) delete process.env.RELAYBOARD_RUNNERS;
    else process.env.RELAYBOARD_RUNNERS = previous;
  });
}
function temporary(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "relayboard-clients-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("every built-in CLI transfers one complete prompt, own identity and cwd without shell expansion or fabricated completion", async (t) => {
  env(t);
  const dir = temporary(t),
    store = new Store(),
    service = new Service(store);
  t.after(() => store.close());
  const project = service.execute("project_create", {
    name: "CLI contracts",
    objective: "$(echo NOT_A_SHELL) `not-a-command` 'quotes'\n中文",
    root_path: dir,
    max_concurrency: 32,
  });
  const script = join(dir, "capture.mjs");
  writeFileSync(
    script,
    `import{writeFileSync}from'node:fs';
const[runtime,...args]=process.argv.slice(2);let input='';for await(const c of process.stdin)input+=c;
writeFileSync(runtime+'.json',JSON.stringify({args,input,cwd:process.cwd(),run:process.env.RELAYBOARD_RUN_ID,task:process.env.RELAYBOARD_TASK_ID,url:process.env.RELAYBOARD_URL}));
console.log(JSON.stringify(runtime==='codex'?{type:'thread.started',thread_id:'session-'+runtime}:runtime==='gemini'?{type:'init',session_id:'session-'+runtime}:['claude','qwen','cursor'].includes(runtime)?{type:'system',subtype:'init',session_id:'session-'+runtime}:['opencode','kilo'].includes(runtime)?{type:'step_finish',sessionID:'session-'+runtime}:{type:'unrecognized',status:'done'}));`,
  );
  const runner = new Runner(service, {
    dataDir: dir,
    baseUrl: "http://127.0.0.1:9999",
    profiles: Object.fromEntries(
      Object.entries(defaultRunnerProfiles).map(([id, p]) => [
        id,
        { ...p, command: process.execPath, args: [script, id, ...p.args] },
      ]),
    ),
  });
  t.after(() => runner.close());
  const expectedFlags: Record<string, string[]> = {
    codex: ["exec", "--json", "--color", "never", "--skip-git-repo-check", "-"],
    claude: ["--print", "--verbose", "--output-format", "stream-json"],
    pi: ["--print", "--mode", "json"],
    gemini: ["--output-format", "stream-json", "--prompt"],
    opencode: ["run", "--format", "json"],
    copilot: ["--prompt"],
    cursor: ["--print", "--output-format", "stream-json"],
    qwen: ["--output-format", "stream-json", "--prompt"],
    goose: ["run", "--no-session", "--text"],
    aider: ["--no-auto-commits", "--message"],
    kilo: ["run", "--format", "json"],
    auggie: ["--print"],
    amp: ["--stream-json", "--execute"],
  };
  assert.deepEqual(
    Object.keys(defaultRunnerProfiles).sort(),
    Object.keys(expectedFlags).sort(),
  );
  for (const { runtime } of runtimeCatalog.filter((r) => r.profile)) {
    const { run } = service.execute("agent_register", {
      project_id: project.id,
      name: runtime,
      runtime,
      workdir: dir,
    });
    const task = service.execute("task_create", {
      project_id: project.id,
      title: runtime,
      acceptance: "independent acceptance",
      scopes: [runtime],
    });
    service.execute("task_claim", {
      task_id: task.id,
      run_id: run.id,
      expected_version: task.version,
    });
    runner.start({ run_id: run.id, task_id: task.id });
    const child = runner.live.get(run.id)!.child;
    await once(child, "close");
    const captured = JSON.parse(
      readFileSync(join(dir, `${runtime}.json`), "utf8"),
    );
    const prompt = runtime === "codex" ? captured.input : captured.args.at(-1);
    const flags =
      runtime === "codex" ? [...captured.args] : captured.args.slice(0, -1);
    if (runtime === "codex") {
      const index = flags.indexOf("-c");
      assert.equal(
        flags[index + 1],
        'mcp_servers.relayboard_session.url="http://127.0.0.1:9999/mcp"',
      );
      flags.splice(index, 2);
    } else if (runtime === "claude") {
      const index = flags.indexOf("--mcp-config");
      assert.deepEqual(JSON.parse(flags[index + 1]), {
        mcpServers: {
          relayboard_session: {
            type: "http",
            url: "http://127.0.0.1:9999/mcp",
          },
        },
      });
      flags.splice(index, 2);
    }
    assert.deepEqual(flags, expectedFlags[runtime], runtime);
    for (const text of [
      project.objective,
      run.id,
      task.id,
      "call work_start",
      "parent_run_id BEFORE dispatch",
      "independent review",
    ])
      assert.ok(prompt.includes(text), `${runtime}: ${text}`);
    assert.equal(captured.cwd, realpathSync(dir));
    assert.equal(captured.run, run.id);
    assert.equal(captured.task, task.id);
    assert.equal(captured.url, "http://127.0.0.1:9999");
    assert.equal(service.run(run.id).process?.status, "exited");
    assert.equal(service.task(task.id).status, "doing");
    assert.equal(service.task(task.id).checkpoint, null);
    if (
      [
        "codex",
        "claude",
        "gemini",
        "qwen",
        "cursor",
        "opencode",
        "kilo",
      ].includes(runtime)
    )
      assert.equal(
        service.run(run.id).provider_session_id,
        "session-" + runtime,
      );
  }
});

test("disabled, missing and broken CLIs remain distinct from readiness, and preflight makes no process or task changes", async (t) => {
  env(t, "0");
  const dir = temporary(t),
    store = new Store(),
    service = new Service(store);
  t.after(() => store.close());
  const runner = new Runner(service, {
    dataDir: dir,
    baseUrl: "http://127.0.0.1:9999",
    profiles: {
      codex: { command: process.execPath, args: [] },
      gemini: { command: join(dir, "missing-cli"), args: [] },
      claude: {
        command: process.execPath,
        args: [],
        versionArgs: ["--invalid-version-argument"],
      },
    },
  });
  const project = service.execute("project_create", {
    name: "Readiness",
    objective: "distinguish capability",
  });
  const { run } = service.execute("agent_register", {
    project_id: project.id,
    name: "Codex",
    runtime: "codex",
    workdir: dir,
  });
  const task = service.execute("task_create", {
    project_id: project.id,
    title: "Readiness",
    acceptance: "no spawn",
    scopes: ["src"],
  });
  service.execute("task_claim", {
    task_id: task.id,
    run_id: run.id,
    expected_version: task.version,
  });
  let status = await runner.status();
  assert.equal(status.enabled, false);
  assert.match(status.reason, /RELAYBOARD_RUNNERS=0/);
  assert.equal(
    status.runtimes.find((r) => r.runtime === "codex")!.available,
    true,
  );
  assert.equal(
    status.runtimes.find((r) => r.runtime === "codex")!.launchable,
    false,
  );
  assert.match(
    status.runtimes.find((r) => r.runtime === "gemini")!.reason,
    /PATH/,
  );
  assert.match(
    status.runtimes.find((r) => r.runtime === "claude")!.reason,
    /版本检测失败/,
  );
  assert.equal(status.runtimes.find((r) => r.runtime === "cline")!.mode, "mcp");
  await assert.rejects(
    runner.preflight({ run_id: run.id, task_id: task.id }),
    /RELAYBOARD_RUNNERS=0/,
  );
  delete process.env.RELAYBOARD_RUNNERS;
  status = await runner.status(); // cached probe results must respect current service switch
  assert.equal(
    status.runtimes.find((r) => r.runtime === "codex")!.launchable,
    true,
  );
  assert.ok(
    !status.runtimes
      .find((r) => r.runtime === "codex")!
      .reason.includes("RUNNERS=0"),
  );
  assert.equal(
    (await runner.preflight({ run_id: run.id, task_id: task.id })).auth_status,
    "unchecked",
  );
  assert.equal(runner.live.size, 0);
  assert.equal(service.run(run.id).process, null);
  assert.equal(service.task(task.id).status, "doing");
});

test("profile overrides survive a new Runner and arbitrary extra clients use other with literal prompt substitution", (t) => {
  const dir = temporary(t),
    store = new Store(),
    service = new Service(store);
  t.after(() => store.close());
  const path = join(dir, "runner-profiles.json");
  writeFileSync(
    path,
    JSON.stringify({
      cursor: {
        command: "/path with spaces/agent",
        args: ["--print", "{prompt}", "--tail"],
      },
      other: { command: "custom-agent", args: ["-p", "{prompt}"] },
    }),
  );
  const profiles = readRunnerProfiles(path);
  const prompt = "$(touch /tmp/SHOULD_NOT_RUN) `exit` '中文'\nnew line";
  assert.deepEqual(buildRunnerArgs(profiles.cursor, prompt), [
    "--print",
    prompt,
    "--tail",
  ]);
  for (let i = 0; i < 2; i++) {
    const runner = new Runner(service, {
      dataDir: dir,
      baseUrl: "http://127.0.0.1:9999",
    });
    assert.equal(runner.profiles.cursor.command, "/path with spaces/agent");
    assert.ok(runner.profiles.codex);
    assert.equal(runner.profiles.other.command, "custom-agent");
  }
  writeFileSync(
    path,
    JSON.stringify({ codex: { command: "codex", args: [], shell: true } }),
  );
  assert.throws(() => readRunnerProfiles(path));
  writeFileSync(
    path,
    JSON.stringify({ not_a_runtime: { command: "unknown", args: [] } }),
  );
  assert.throws(() => readRunnerProfiles(path));
  writeFileSync(path, JSON.stringify({ human: { command: "node", args: [] } }));
  assert.throws(() => readRunnerProfiles(path));
});

test("runtime directory, diagnostics and launch preflight remain behind API authentication", async (t) => {
  env(t, "0");
  const dir = temporary(t),
    instance = createApp({
      dataDir: dir,
      token: "fixture-token",
      port: 0,
      runnerProfiles: {},
    });
  const server = instance.app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    await instance.close();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  });
  assert.equal(
    (await (await fetch(url + "/api/health")).json()).runners_enabled,
    false,
  );
  assert.equal((await fetch(url + "/api/runner/status")).status, 401);
  assert.equal(
    (
      await fetch(url + "/api/runner/preflight", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      })
    ).status,
    401,
  );
  const status = (
    await (
      await fetch(url + "/api/runner/status", {
        headers: { Authorization: "Bearer fixture-token" },
      })
    ).json()
  ).result;
  assert.equal(status.enabled, false);
  assert.equal(status.runtimes.length, runtimeIds.length);
  assert.equal(
    new Set(runtimeCatalog.map((r) => r.runtime)).size,
    runtimeIds.length,
  );
  for (const runtime of runtimeIds)
    assert.ok(
      status.runtimes.some((r: { runtime: string }) => r.runtime === runtime),
    );
});

test("raw provider events never supply task outcomes or arbitrary structured session identities", () => {
  assert.equal(
    providerSessionId("codex", {
      type: "thread.started",
      thread_id: { bad: "object" },
    }),
    null,
  );
  assert.equal(
    providerSessionId("codex", {
      type: "result",
      thread_id: "invented",
      status: "done",
    }),
    null,
  );
  assert.equal(
    providerSessionId("gemini", { type: "init", session_id: "gemini-session" }),
    "gemini-session",
  );
  assert.equal(
    providerSessionId("other", { type: "init", session_id: "unrecognized" }),
    null,
  );
});

test("client-specific MCP snippets preserve transport shapes and never copy a real credential", async () => {
  const { clientMcpConfig } = await import("../server/client-configs.ts");
  const config = {
    node: "/node with spaces/node",
    mcp: "/package/lib/bin/mcp.js",
    mcp_args: ["--import", "/absolute/tsx.mjs", "/source/bin/mcp.ts"],
    base_url: "http://127.0.0.1:4321",
    token_required: true,
  };
  const codex = clientMcpConfig("codex", config);
  assert.match(codex.content, /mcp_servers.relayboard/);
  assert.match(codex.content, /bearer_token_env_var = "RELAYBOARD_TOKEN"/);
  const opencode = JSON.parse(clientMcpConfig("opencode", config).content);
  assert.deepEqual(opencode.mcp.relayboard.command, [
    config.node,
    ...config.mcp_args,
  ]);
  assert.equal(
    opencode.mcp.relayboard.environment.RELAYBOARD_TOKEN,
    "<服务令牌>",
  );
  assert.equal(opencode.mcp.relayboard.enabled, true);
  assert.deepEqual(
    JSON.parse(clientMcpConfig("kilo", config).content),
    opencode,
  );
  const amp = JSON.parse(clientMcpConfig("amp", config).content);
  assert.equal(amp["amp.mcpServers"].relayboard.command, config.node);
  const hermes = JSON.parse(clientMcpConfig("hermes", config).content);
  assert.equal(
    hermes.mcp_servers.relayboard.env.RELAYBOARD_URL,
    config.base_url,
  );
  const continuation = clientMcpConfig("continue", config);
  assert.match(continuation.hint, /\.continue\/mcpServers\/relayboard.json/);
  for (const r of runtimeCatalog.filter(
    (r) => !["codex", "opencode", "kilo", "amp", "hermes"].includes(r.runtime),
  )) {
    const value = JSON.parse(clientMcpConfig(r.runtime, config).content);
    assert.deepEqual(value.mcpServers.relayboard.args, config.mcp_args);
    assert.equal(
      value.mcpServers.relayboard.env.RELAYBOARD_TOKEN,
      "<服务令牌>",
    );
  }
  const unauthenticated = JSON.parse(
    clientMcpConfig("claude", { ...config, token_required: false }).content,
  );
  assert.equal(
    unauthenticated.mcpServers.relayboard.env.RELAYBOARD_TOKEN,
    undefined,
  );
});

test("a failing client retains its stderr and task claim for diagnosis rather than reporting success", async (t) => {
  env(t);
  const dir = temporary(t),
    store = new Store(),
    service = new Service(store);
  t.after(() => store.close());
  const project = service.execute("project_create", {
    name: "Failed client",
    objective: "retain evidence",
  });
  const { run } = service.execute("agent_register", {
    project_id: project.id,
    name: "fixture",
    runtime: "other",
    workdir: dir,
  });
  const task = service.execute("task_create", {
    project_id: project.id,
    title: "Failed client",
    acceptance: "retain claim",
    scopes: ["src"],
  });
  service.execute("task_claim", {
    task_id: task.id,
    run_id: run.id,
    expected_version: task.version,
  });
  const runner = new Runner(service, {
    dataDir: dir,
    baseUrl: "http://127.0.0.1:9999",
    profiles: {
      other: {
        command: process.execPath,
        args: [
          "-e",
          "console.error('fixture account needs login');process.exit(3)",
          "--",
        ],
      },
    },
  });
  runner.start({ run_id: run.id, task_id: task.id });
  await once(runner.live.get(run.id)!.child, "close");
  assert.equal(service.run(run.id).process?.status, "failed");
  assert.match(
    service.run(run.id).process!.error!,
    /fixture account needs login/,
  );
  assert.match(runner.logs(run.id).text, /fixture account needs login/);
  assert.equal(service.task(task.id).owner_run_id, run.id);
  assert.equal(service.task(task.id).status, "doing");
});

test("session MCP injection references credentials through the environment and preserves existing approval and sandbox choices", () => {
  const conn = { baseUrl: "http://127.0.0.1:4317", tokenRequired: true };
  const codex = buildRunnerArgs(defaultRunnerProfiles.codex, "prompt", conn);
  assert.ok(
    codex.includes(
      'mcp_servers.relayboard_session.bearer_token_env_var="RELAYBOARD_TOKEN"',
    ),
  );
  assert.equal(codex.at(-1), "-");
  const claude = buildRunnerArgs(defaultRunnerProfiles.claude, "prompt", conn);
  const config = JSON.parse(claude[claude.indexOf("--mcp-config") + 1]);
  assert.equal(
    config.mcpServers.relayboard_session.headers.Authorization,
    "Bearer ${RELAYBOARD_TOKEN}",
  );
  for (const args of [codex, claude]) {
    assert.ok(
      !args.some(
        (a) =>
          a.includes("dangerously") ||
          a.includes("--yolo") ||
          a.includes("sandbox_mode=") ||
          a.includes("approval_policy="),
      ),
    );
    assert.ok(
      !args.some(
        (a) => a.includes(".codex/config.toml") || a.includes(".claude.json"),
      ),
    );
  }
});

test("a client tool rejection is surfaced even when its CLI exits zero, without inventing task progress", async (t) => {
  env(t);
  const dir = temporary(t),
    store = new Store(),
    service = new Service(store);
  t.after(() => store.close());
  const project = service.execute("project_create", {
    name: "Tool rejection",
    objective: "show actual client policy",
  });
  const { run } = service.execute("agent_register", {
    project_id: project.id,
    name: "fixture",
    runtime: "codex",
    workdir: dir,
  });
  const task = service.execute("task_create", {
    project_id: project.id,
    title: "Tool rejection",
    acceptance: "show rejection",
    scopes: ["src"],
  });
  service.execute("task_claim", {
    task_id: task.id,
    run_id: run.id,
    expected_version: task.version,
  });
  const runner = new Runner(service, {
    dataDir: dir,
    baseUrl: "http://127.0.0.1:9999",
    profiles: {
      codex: {
        command: process.execPath,
        args: [
          "-e",
          `console.log(JSON.stringify({type:'item.completed',item:{type:'mcp_tool_call',error:{message:'fixture requires approval'}}}))`,
        ],
        stdin: true,
      },
    },
  });
  runner.start({ run_id: run.id, task_id: task.id });
  await once(runner.live.get(run.id)!.child, "close");
  assert.equal(service.run(run.id).process?.status, "exited");
  assert.equal(service.run(run.id).process?.exit_code, 0);
  assert.match(service.run(run.id).process!.note!, /fixture requires approval/);
  assert.equal(service.task(task.id).checkpoint, null);
  assert.equal(service.task(task.id).status, "doing");
});
