import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { commands, queries, type QueryArgs } from "./schemas.ts";
import { AppError } from "./domain.ts";
import { MEMORY_NOTICE } from "./memory.ts";

const sourceSchema = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9_-]{0,60}$/),
    label: z.string().trim().min(1).max(240),
    url: z.url().refine((value) => {
      const url = new URL(value);
      return (
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        (url.protocol === "https:" ||
          (url.protocol === "http:" &&
            ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
      );
    }, "远程来源须使用 HTTPS 或本机隧道 HTTP，令牌请使用环境变量"),
    project_id: z.string().min(1).max(120),
    token_env: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{0,100}$/)
      .optional(),
  })
  .strict();
const memorySchema = commands.memory_save.schema
  .omit({ memory_id: true, expected_version: true })
  .extend({
    id: z.string().min(1).max(120),
    version: z.number().int().positive(),
    created_at: z.iso.datetime(),
    updated_at: z.iso.datetime(),
    origin: z.literal("local"),
  });
const resultSchema = z
  .object({
    items: z
      .array(
        memorySchema.omit({ content: true, evidence: true }).extend({
          evidence_count: z.number().int().min(0),
          content_chars: z.number().int().min(0),
          score: z.number().min(0),
        }),
      )
      .max(10),
    total: z.number().int().min(0),
    next_offset: z.number().int().min(0).nullable(),
    truncated: z.boolean(),
    max_chars: z.number().int().positive(),
    notice: z.string().max(1000),
  })
  .strict();

/** Each call is explicit, read-only and bounded. No background upload or shared local credential. */
export class MemoryRemotes {
  constructor(readonly path: string) {}
  private config() {
    const sources = existsSync(this.path)
      ? z
          .array(sourceSchema)
          .max(20)
          .parse(JSON.parse(readFileSync(this.path, "utf8")))
      : [];
    if (new Set(sources.map((s) => s.name)).size !== sources.length)
      throw new AppError("MEMORY_SOURCE_CONFIG", "远程记忆来源名称须唯一", 400);
    return sources;
  }
  list() {
    return this.config().map((s) => ({
      name: s.name,
      label: s.label,
      project_id: s.project_id,
      token_configured: !s.token_env || !!process.env[s.token_env],
    }));
  }
  private async fetch(
    name: string,
    query: string,
    args: Record<string, unknown>,
  ) {
    const source = this.config().find((s) => s.name === name);
    if (!source)
      throw new AppError(
        "MEMORY_SOURCE_UNKNOWN",
        "请先在 memory-remotes.json 配置命名来源",
        404,
      );
    if (source.token_env && !process.env[source.token_env])
      throw new AppError(
        "MEMORY_SOURCE_TOKEN",
        "来源的认证环境变量尚未配置",
        409,
      );
    try {
      const response = await fetch(
        source.url.replace(/\/$/, "") + "/api/query",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(source.token_env
              ? { Authorization: `Bearer ${process.env[source.token_env]}` }
              : {}),
          },
          body: JSON.stringify({
            query,
            args:
              query === "memory_search"
                ? { ...args, project_id: source.project_id }
                : args,
          }),
          signal: AbortSignal.timeout(5000),
          redirect: "error",
        },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const reader = response.body?.getReader();
      if (!reader) throw Error("EMPTY_RESPONSE");
      let bytes = 0,
        body = "";
      const decoder = new TextDecoder();
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 128000) throw Error("RESPONSE_TOO_LARGE");
          body += decoder.decode(value, { stream: true });
        }
      } finally {
        await reader.cancel();
      }
      body += decoder.decode();
      const envelope = z
        .object({ result: z.unknown() })
        .parse(JSON.parse(body));
      return { source, value: envelope.result, error: null };
    } catch (error) {
      // Keep the remote response, URL, token and arbitrary exception text out of reports.
      const code =
        error instanceof Error &&
        /^HTTP \d+$|^RESPONSE_TOO_LARGE$|^EMPTY_RESPONSE$/.test(error.message)
          ? error.message
          : "连接超时或响应格式错误";
      return {
        source,
        value: null,
        error: `远程记忆查询失败：${code}。本地记忆仍可使用。`,
      };
    }
  }
  async search(input: QueryArgs<"memory_remote_search">) {
    const { source: sourceName, ...args } =
      queries.memory_remote_search.parse(input);
    const response = await this.fetch(sourceName, "memory_search", args);
    let result = null,
      error = response.error;
    if (!error) {
      const parsed = resultSchema.safeParse(response.value);
      if (
        !parsed.success ||
        parsed.data.items.some(
          (m) => m.project_id !== response.source.project_id,
        ) ||
        JSON.stringify(parsed.data).length > args.max_chars + 100
      )
        error = "远程记忆响应超出约定格式或预算；请检查来源。";
      else result = parsed.data;
    }
    return {
      source: response.source.name,
      label: response.source.label,
      result,
      error,
      notice: MEMORY_NOTICE,
    };
  }
  async get(input: QueryArgs<"memory_remote_get">) {
    const { source: sourceName, ...args } =
      queries.memory_remote_get.parse(input);
    const response = await this.fetch(sourceName, "memory_get", args);
    let memory = null,
      error = response.error;
    if (!error) {
      const parsed = memorySchema.safeParse(response.value);
      if (
        !parsed.success ||
        parsed.data.project_id !== response.source.project_id ||
        parsed.data.id !== args.memory_id ||
        (args.version && parsed.data.version !== args.version)
      )
        error = "远程记忆响应与请求的项目、ID 或版本不一致。";
      else memory = parsed.data;
    }
    return {
      source: response.source.name,
      label: response.source.label,
      memory,
      error,
      notice: MEMORY_NOTICE,
    };
  }
}
