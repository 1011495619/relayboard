import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import type { AddressInfo } from "node:net";
import { createApp } from "../server/app.js";
import { unwrapToolResult } from "../bin/mcp-client.js";

const cli = fileURLToPath(new URL("../lib/bin/relayboard.js", import.meta.url));
function execute(args: string[], env: NodeJS.ProcessEnv, input = "") {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve, reject) => {
      const child = spawn(process.execPath, [cli, ...args], {
        env,
        stdio: "pipe",
      });
      let stdout = "",
        stderr = "";
      child.stdout.on("data", (part: Buffer) => {
        stdout += part.toString();
      });
      child.stderr.on("data", (part: Buffer) => {
        stderr += part.toString();
      });
      child.once("error", reject);
      child.once("close", (code) => resolve({ code, stdout, stderr }));
      child.stdin.end(input);
    },
  );
}

test("terminal MCP discovers bounded schemas, registers sessions, claims, checkpoints and preserves readable errors", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "relayboard-cli-mcp-"));
  const instance = createApp({
    dataDir: dir,
    port: 0,
    token: "mcp-cli-fixture",
  });
  const server = instance.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  t.after(async () => {
    await instance.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  });
  const env = {
    ...process.env,
    RELAYBOARD_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    RELAYBOARD_TOKEN: "mcp-cli-fixture",
  };
  const inventory = await execute(["tools"], env);
  assert.equal(inventory.code, 0, inventory.stderr);
  const list: { name: string; description: string; inputSchema?: unknown }[] =
    JSON.parse(inventory.stdout);
  assert.ok(list.some((tool) => tool.name === "relay_task_claim"));
  assert.ok(list.every((tool) => !tool.inputSchema));
  const schema = await execute(["tools", "agent_register"], env);
  assert.equal(schema.code, 0, schema.stderr);
  const tool = JSON.parse(schema.stdout);
  assert.equal(tool.name, "relay_agent_register");
  assert.ok(tool.inputSchema.properties.parent_run_id);
  assert.ok(tool.description.includes("run.id"));
  const call = async (name: string, args: object) => {
    const result = await execute(
      ["call", name, "-"],
      env,
      JSON.stringify(args),
    );
    assert.equal(result.code, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const project = await call("project_create", {
    name: "Real MCP CLI",
    objective: "shared state",
  });
  const { agent, run } = await call("agent_register", {
    project_id: project.id,
    name: "CLI agent",
    runtime: "codex",
  });
  assert.notEqual(agent.id, run.id);
  const task = await call("task_create", {
    project_id: project.id,
    title: "Implement",
    acceptance: "Evidence",
    scopes: ["src"],
  });
  const claimed = await call("task_claim", {
    task_id: task.id,
    run_id: run.id,
    expected_version: task.version,
  });
  await call("task_checkpoint", {
    task_id: task.id,
    run_id: run.id,
    claim_epoch: claimed.claim_epoch,
    summary: "Actual CLI MCP checkpoint",
    next_step: "Review evidence",
  });
  assert.equal(
    instance.service.task(task.id).checkpoint?.summary,
    "Actual CLI MCP checkpoint",
  );
  const invalid = await execute(["call", "task_claim", "{}"], env);
  assert.equal(invalid.code, 1);
  assert.match(
    JSON.parse(invalid.stderr).message,
    /validation|run_id|task_id/i,
  );
  assert.ok(!invalid.stderr.includes("Unexpected token"));
  const missing = await execute(["tools", "missing_tool"], env);
  assert.equal(missing.code, 1);
  assert.equal(JSON.parse(missing.stderr).code, "TOOL_NOT_FOUND");
  const unauthenticated = await execute(["tools"], {
    ...env,
    RELAYBOARD_TOKEN: "wrong",
  });
  assert.equal(unauthenticated.code, 1);
  assert.match(
    JSON.parse(unauthenticated.stderr).message,
    /401|unauthorized|AUTH_REQUIRED/i,
  );
});

test("MCP tool errors retain server messages for JSON and plain text responses", () => {
  assert.deepEqual(
    unwrapToolResult({
      content: [{ type: "text", text: "fallback" }],
      structuredContent: { result: { id: "record" } },
    }),
    { id: "record" },
  );
  assert.throws(
    () =>
      unwrapToolResult({
        isError: true,
        content: [
          { type: "text", text: "MCP error -32602: Invalid arguments" },
        ],
      }),
    /MCP error -32602: Invalid arguments/,
  );
  assert.throws(
    () =>
      unwrapToolResult({
        isError: true,
        content: [
          {
            type: "text",
            text: JSON.stringify({
              code: "STALE_CLAIM",
              message: "Refresh ownership",
            }),
          },
        ],
      }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "STALE_CLAIM" &&
      error.message === "Refresh ownership",
  );
});
