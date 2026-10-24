#!/usr/bin/env node
import { listTools, callTool } from "./mcp-client.ts";
import { errorInfo } from "./errors.ts";
import { readFileSync } from "node:fs";
import { request } from "./client.ts";
import { commands } from "../server/schemas.ts";
import { version } from "../server/config.ts";

const [mode, name, raw, requestId] = process.argv.slice(2);
const help = `Relayboard ${version}
  relayboard                         启动服务并打开看板
  relayboard start [--port PORT] [--data-dir PATH] [--no-open]
  relayboard mcp                     stdio MCP（连接已启动的共享服务）
  relayboard tools [tool-name]       通过 MCP 列工具或读取完整输入结构
  relayboard call <tool> [JSON or -]  通过 MCP 调用工具（支持 relay_ 前缀）
  relayboard query <projects|project|snapshot|task|eligible|inbox|context|events|decisions> [JSON or -]
  relayboard command <operation> [JSON or -] [request-id]
  relayboard context <task-id>
  relayboard run <run-id> <task-id>
  relayboard stop <run-id>
  relayboard worktree <project-id> <JSON>
  relayboard export <task-id>
  relayboard operations
  relayboard health
  relayboard --version
Environment: PORT, RELAYBOARD_DATA_DIR, RELAYBOARD_URL, RELAYBOARD_TOKEN.
Use - to read JSON from stdin. Node.js 24+ required. Ctrl+C stops the service.`;

async function main() {
  if (
    ["--help", "-h", "help"].includes(mode) ||
    (mode === "start" && ["--help", "-h"].includes(name))
  ) {
    console.log(help);
    return;
  }
  if (["--version", "-v"].includes(mode)) {
    console.log(version);
    return;
  }
  if (!mode || mode === "start" || mode.startsWith("--")) {
    if (Number(process.versions.node.split(".")[0]) < 24)
      throw Error(
        "Relayboard 需要 Node.js 24 或更高版本，请升级 Node.js 后重试。",
      );
    const options: { open: boolean; port?: number; dataDir?: string } = {
      open: process.env.RELAYBOARD_OPEN !== "0",
    };
    const flags = process.argv.slice(mode === "start" ? 3 : 2);
    for (let i = 0; i < flags.length; i++) {
      const flag = flags[i];
      if (flag === "--no-open") options.open = false;
      else if (flag === "--port" || flag === "--data-dir") {
        const value = flags[++i];
        if (!value || value.startsWith("--")) throw Error(`${flag} 需要参数值`);
        if (flag === "--port") {
          const port = Number(value);
          if (
            !/^\d+$/.test(value) ||
            !Number.isInteger(port) ||
            port < 1 ||
            port > 65535
          )
            throw Error("端口须为 1–65535 的整数");
          options.port = port;
        } else options.dataDir = value;
      } else throw Error(`未知启动参数：${flag}。使用 --help 查看用法。`);
    }
    const { startServer } = await import("../server/start.ts");
    await startServer(options);
    return;
  }
  if (mode === "mcp") {
    if (name)
      throw Error(
        "mcp 子命令使用 RELAYBOARD_URL 和 RELAYBOARD_TOKEN 环境变量配置连接。",
      );
    await import("./mcp.ts");
    return;
  }
  let result: unknown;
  const args = ["query", "command", "worktree", "call"].includes(mode)
    ? raw === "-"
      ? JSON.parse(readFileSync(0, "utf8"))
      : JSON.parse(raw || "{}")
    : {};
  if (mode === "tools") result = await listTools(name);
  else if (mode === "call") {
    if (!name) throw Error("call 需要工具名称。使用 tools 查看工具。 ");
    if (typeof args !== "object" || args === null || Array.isArray(args))
      throw Error("MCP 参数须为 JSON 对象");
    result = await callTool(name, args as Record<string, unknown>);
  } else if (mode === "operations")
    result = Object.fromEntries(
      Object.entries(commands).map(([name, value]) => [
        name,
        {
          description: value.description,
          fields: Object.keys(value.schema.shape),
        },
      ]),
    );
  else if (mode === "query")
    result = await request("/api/query", { query: name, args });
  else if (mode === "command")
    result = await request("/api/command", {
      operation: name,
      args,
      request_id: requestId,
    });
  else if (mode === "context")
    result = await request("/api/query", {
      query: "context",
      args: { task_id: name },
    });
  else if (mode === "run")
    result = await request("/api/runner/start", { run_id: name, task_id: raw });
  else if (mode === "stop")
    result = await request("/api/runner/stop", { run_id: name });
  else if (mode === "worktree")
    result = await request("/api/worktree", { project_id: name, ...args });
  else if (mode === "export")
    result = await request("/api/export", { task_id: name });
  else if (mode === "health")
    result = await request("/api/health", null, "GET");
  else {
    throw Error(`未知命令：${mode}。使用 --help 查看用法。`);
  }
  console.log(
    mode === "context"
      ? (result as { markdown: string }).markdown
      : JSON.stringify(result, null, 2),
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      code: errorInfo(error).code || "ERROR",
      message: errorInfo(error).message,
      details: errorInfo(error).details,
    }),
  );
  process.exitCode = 1;
});
