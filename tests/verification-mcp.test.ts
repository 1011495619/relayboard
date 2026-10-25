import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import type { AddressInfo } from "node:net";
import { createApp } from "../server/app.ts";

const cli = fileURLToPath(new URL("../lib/bin/relayboard.js", import.meta.url));

function execute(args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve, reject) => {
      const child = spawn(process.execPath, [cli, ...args], {
        env,
        stdio: "pipe",
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (part: Buffer) => {
        stdout += part.toString();
      });
      child.stderr.on("data", (part: Buffer) => {
        stderr += part.toString();
      });
      child.once("error", reject);
      child.once("close", (code) => resolve({ code, stdout, stderr }));
    },
  );
}

async function waitFor<T>(
  fn: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 20000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let value = await fn();
  while (!predicate(value)) {
    if (Date.now() > deadline)
      throw new Error(`waitFor 超时：${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    value = await fn();
  }
  return value;
}

test("A003-16：HTTP MCP 与 REST 执行 profile 发现/启动/详情/日志，来源分离", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "rb003-mcp-"));
  const instance = createApp({ dataDir: dir, port: 0, token: "mcp-verify" });
  const server = instance.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  t.after(async () => {
    await instance.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  });

  const fixture = join(dir, "check.mjs");
  writeFileSync(fixture, 'process.stdout.write("mcp-ok\\n");process.exit(0);\n');
  writeFileSync(
    join(dir, "verification-profiles.json"),
    JSON.stringify({
      version: 1,
      profiles: { check: { command: process.execPath, args: [fixture], cwd: "." } },
    }),
  );

  const env = {
    ...process.env,
    RELAYBOARD_URL: `http://127.0.0.1:${port}`,
    RELAYBOARD_TOKEN: "mcp-verify",
  };
  const call = async (name: string, args: object) => {
    const result = await execute(
      ["call", name, JSON.stringify(args)],
      env,
    );
    assert.equal(result.code, 0, result.stderr || result.stdout);
    return JSON.parse(result.stdout);
  };

  const project = await call("project_create", {
    name: "mcp-verify",
    objective: "verify",
  });
  const { run } = await call("agent_register", {
    project_id: project.id,
    name: "executor",
    runtime: "other",
    workdir: dir,
    observation: "self",
  });
  const created = await call("task_create", {
    project_id: project.id,
    title: "MCP V",
    acceptance: "pass",
    scopes: ["src"],
  });
  const task = await call("task_claim", {
    task_id: created.id,
    run_id: run.id,
    expected_version: created.version,
  });

  // 通过 MCP 发现 profile
  const discovery = await call("verification_profiles", {});
  assert.equal(discovery.valid, true);
  assert.ok(discovery.items.some((i: { id: string }) => i.id === "check"));

  // 通过 MCP 启动
  const execution = await call("verification_start", {
    task_id: task.id,
    run_id: run.id,
    claim_epoch: task.claim_epoch,
    profile_id: "check",
  });
  assert.equal(execution.source, "service_executed");

  // 通过 REST 读取详情与日志
  const restGet = async (path: string, body: object) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer mcp-verify",
      },
      body: JSON.stringify(body),
    });
    const json = (await response.json()) as {
      result?: unknown;
      error?: { code: string; message: string };
    };
    assert.equal(response.status, 200, JSON.stringify(json));
    return json.result;
  };
  const restExecution = await waitFor(
    async () =>
      (await restGet("/api/query", {
        query: "verification_execution",
        args: { execution_id: execution.id },
      })) as { status: string },
    (e) => e.status === "succeeded",
  );
  assert.equal(restExecution.status, "succeeded");
  const restLog = (await restGet("/api/query", {
    query: "verification_log",
    args: { execution_id: execution.id },
  })) as { text: string; complete: boolean };
  assert.ok(restLog.text.includes("mcp-ok"));
  assert.equal(restLog.complete, true);

  // 通过 MCP 读取详情与历史；Agent 自报与服务执行来源分开展示
  const mcpExecution = await call("verification_execution", {
    execution_id: execution.id,
  });
  assert.equal(mcpExecution.source, "service_executed");
  assert.equal(mcpExecution.status, "succeeded");
  const history = await call("verification_history", { task_id: task.id });
  assert.equal(history.total, 1);
  assert.equal(history.items[0].source, "service_executed");

  const taskDetail = await call("task", { task_id: task.id });
  assert.deepEqual(taskDetail.verification, []);
  assert.equal(taskDetail.service_verification.source, "service_executed");
  assert.equal(taskDetail.service_verification.status, "succeeded");
  assert.equal(taskDetail.service_verification.passed, true);
  assert.equal(taskDetail.status, "doing");
});
