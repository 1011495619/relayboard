import express, { type ErrorRequestHandler } from "express";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z, ZodError } from "zod";
import { Store } from "./store.ts";
import { Service, AppError } from "./domain.ts";
import { createMcp } from "./mcp.ts";
import { Runner, createWorktree, type RunnerProfile } from "./runner.ts";
import { Scheduler } from "./scheduler.ts";
import {
  packageRoot,
  runtimeRoot,
  runtimeExtension,
  runtimeNodeArgs,
  defaultDataDir,
  version,
} from "./config.ts";

import { errorInfo } from "../bin/errors.ts";
const root = packageRoot;
const secureEqual = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export interface AppOptions {
  dataDir?: string;
  token?: string;
  port?: number;
  runnerProfiles?: Record<string, RunnerProfile>;
  runnerTimeoutMs?: number;
}
export function createApp({
  dataDir = defaultDataDir(),
  token = process.env.RELAYBOARD_TOKEN || "",
  port = 4317,
  runnerProfiles,
  runnerTimeoutMs,
}: AppOptions = {}) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const store = new Store(join(dataDir, "relayboard.sqlite")),
    service = new Service(store);
  const runner = new Runner(service, {
    dataDir,
    baseUrl: `http://127.0.0.1:${port}`,
    token,
    profiles: runnerProfiles,
    timeoutMs: runnerTimeoutMs,
  });
  const app = express();
  const scheduler = new Scheduler(service, runner);
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    const host = (req.headers.host || "").split(":")[0];
    if (!["127.0.0.1", "localhost", "["].includes(host))
      return res.status(403).json({
        error: {
          code: "HOST_REJECTED",
          message: "本地服务仅接受 localhost 请求",
        },
      });
    if (req.headers.origin) {
      try {
        const url = new URL(req.headers.origin);
        if (
          !["127.0.0.1", "localhost"].includes(url.hostname) ||
          ![String(port), "5173"].includes(url.port)
        )
          throw Error();
      } catch {
        return res.status(403).json({
          error: {
            code: "ORIGIN_REJECTED",
            message: "请求来源与本地工作台不匹配",
          },
        });
      }
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
    );
    next();
  });
  app.use(express.json({ limit: "512kb" }));
  app.get("/api/health", (req, res) =>
    res.json({
      ok: true,
      service: "relayboard",
      version,
      authentication: !!token,
      runners_enabled: runner.enabled,
      data_dir: dataDir,
    }),
  );
  app.use(["/api", "/mcp"], (req, res, next) => {
    if (!token) return next();
    const supplied = (req.headers.authorization || "").replace(/^Bearer /, "");
    if (!secureEqual(supplied, token))
      return res.status(401).json({
        error: { code: "AUTH_REQUIRED", message: "请输入服务访问令牌" },
      });
    next();
  });
  app.post("/api/command", (req, res) => {
    const body = z
      .object({
        operation: z.string(),
        args: z.record(z.string(), z.unknown()).default({}),
        request_id: z.string().max(160).optional(),
      })
      .strict()
      .parse(req.body);
    const result = service.execute(body.operation, body.args, body.request_id);
    res.json({ result });
  });
  app.post("/api/query", (req, res) => {
    const body = z
      .object({
        query: z.string(),
        args: z.record(z.string(), z.unknown()).default({}),
      })
      .strict()
      .parse(req.body);
    res.json({ result: service.query(body.query, body.args) });
  });
  app.get("/api/stream", (req, res) => {
    const project = String(req.query.project_id || "");
    service.get("project", project);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    res.write("event: connected\ndata: {}\n\n");
    const listener: Parameters<typeof service.listeners.add>[0] = (event) => {
      if (event.project_id === project)
        res.write(
          `id: ${event.seq}\nevent: update\ndata: ${JSON.stringify(event)}\n\n`,
        );
    };
    service.listeners.add(listener);
    const timer = setInterval(() => res.write(": heartbeat\n\n"), 20000);
    req.on("close", () => {
      service.listeners.delete(listener);
      clearInterval(timer);
    });
  });
  app.get("/api/runtimes", async (req, res) =>
    res.json({ result: await runner.availability(req.query.refresh === "1") }),
  );
  app.get("/api/runner/status", async (req, res) =>
    res.json({ result: await runner.status(req.query.refresh === "1") }),
  );
  app.post("/api/runner/preflight", async (req, res) => {
    const args = z
      .object({ run_id: z.string(), task_id: z.string() })
      .strict()
      .parse(req.body);
    res.json({ result: await runner.preflight(args) });
  });
  const skillCatalog: {
    name: string;
    title: string;
    role: string;
    description: string;
    prompt: string;
  }[] = JSON.parse(readFileSync(join(root, "skills/catalog.json"), "utf8"));
  app.get("/api/skills", (req, res) =>
    res.json({
      result: skillCatalog.map((skill) => ({
        ...skill,
        path: join(root, "skills", skill.name, "SKILL.md"),
      })),
    }),
  );
  app.get("/api/skills/:name", (req, res) => {
    const skill = skillCatalog.find((item) => item.name === req.params.name);
    if (!skill)
      return res.status(404).json({
        error: { code: "SKILL_NOT_FOUND", message: "没有找到此 Skill" },
      });
    res.json({
      result: {
        ...skill,
        content: readFileSync(
          join(root, "skills", skill.name, "SKILL.md"),
          "utf8",
        ),
      },
    });
  });
  app.get("/api/integration", (req, res) =>
    res.json({
      result: {
        base_url: `http://127.0.0.1:${req.socket.localPort || port}`,
        cli: join(runtimeRoot, `bin/relayboard.${runtimeExtension}`),
        mcp: join(runtimeRoot, `bin/mcp.${runtimeExtension}`),
        cli_args: [
          ...runtimeNodeArgs,
          join(runtimeRoot, `bin/relayboard.${runtimeExtension}`),
        ],
        mcp_args: [
          ...runtimeNodeArgs,
          join(runtimeRoot, `bin/mcp.${runtimeExtension}`),
        ],
        skill: join(root, "skills/task-continuity"),
        node: process.execPath,
        token_required: !!token,
      },
    }),
  );
  app.post("/api/runner/start", async (req, res) => {
    const args = z
      .object({ run_id: z.string(), task_id: z.string() })
      .strict()
      .parse(req.body);
    await runner.preflight(args);
    res.json({ result: runner.start(args) });
  });
  app.post("/api/runner/stop", (req, res) =>
    res.json({
      result: runner.stop(
        z.object({ run_id: z.string() }).strict().parse(req.body).run_id,
      ),
    }),
  );
  app.get("/api/runner/logs/:run", (req, res) =>
    res.json({ result: runner.logs(String(req.params.run)) }),
  );
  app.post("/api/worktree", async (req, res) => {
    const args = z
      .object({
        project_id: z.string(),
        name: z.string(),
        base_ref: z.string().default("HEAD"),
      })
      .strict()
      .parse(req.body);
    res.json({ result: await createWorktree(service, dataDir, args) });
  });
  app.post("/api/export", (req, res) => {
    const { task_id } = z
      .object({ task_id: z.string() })
      .strict()
      .parse(req.body);
    const packet = service.query("context", { task_id, max_chars: 24000 });
    const dir = join(dataDir, "spaces", packet.project_id, task_id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "HANDOFF.md"), packet.markdown);
    writeFileSync(
      join(dir, "TASK.json"),
      JSON.stringify(service.query("task", { task_id }), null, 2),
    );
    res.json({
      result: {
        path: dir,
        markdown: packet.markdown,
        truncated: packet.truncated,
      },
    });
  });
  app.all("/mcp", async (req, res, next) => {
    if (req.method !== "POST")
      return res
        .status(405)
        .set("Allow", "POST")
        .json({ error: "Stateless MCP endpoint; use POST" });
    const server = createMcp({
      command: (op, args, id) => service.execute(op, args, id),
      query: (q, args) => service.query(q, args),
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      next(error);
    }
  });
  const dist = join(root, "dist");
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get("/{*path}", (req, res) => res.sendFile(join(dist, "index.html")));
  } else
    app.get("/", (req, res) =>
      res
        .status(503)
        .type("text")
        .send("运行 npm run build 后启动网页，或使用 npm run web:dev。"),
    );
  const handleError: ErrorRequestHandler = (error: unknown, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof ZodError)
      return res.status(400).json({
        error: {
          code: "VALIDATION",
          message: "输入格式需要调整",
          details: error.issues,
        },
      });
    if (error instanceof AppError)
      return res.status(error.status).json({
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      });
    if (errorInfo(error).type === "entity.parse.failed")
      return res.status(400).json({
        error: { code: "INVALID_JSON", message: "请求须为有效 JSON" },
      });
    console.error(error);
    res.status(500).json({
      error: {
        code: "INTERNAL",
        message: "服务发生错误，详情已记录在服务日志",
      },
    });
  };
  app.use(handleError);
  return {
    app,
    store,
    service,
    runner,
    scheduler,
    close: async () => {
      scheduler.stop();
      await runner.close();
      store.close();
    },
  };
}
