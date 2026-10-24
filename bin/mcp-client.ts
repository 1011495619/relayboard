import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { baseUrl } from "./client.ts";
import { ClientError, errorInfo } from "./errors.ts";

export function unwrapToolResult(result: CallToolResult): unknown {
  const texts = result.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
  let value: unknown = result.structuredContent?.result;
  if (value === undefined && texts) {
    try {
      value = JSON.parse(texts) as unknown;
    } catch {
      value = texts;
    }
  }
  if (result.isError) {
    const error = errorInfo(value);
    throw new ClientError(
      error.message || "MCP tool failed",
      error.code || "MCP_TOOL_ERROR",
      error.details,
    );
  }
  return value;
}
export async function withMcp<T>(
  run: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ name: "relayboard-cli", version: "1.0.0" });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${baseUrl()}/mcp`), {
        requestInit: {
          headers: process.env.RELAYBOARD_TOKEN
            ? { Authorization: `Bearer ${process.env.RELAYBOARD_TOKEN}` }
            : {},
        },
      }),
    );
    return await run(client);
  } finally {
    await client.close();
  }
}
export async function listTools(name?: string) {
  return withMcp(async (client) => {
    const all = [];
    let cursor: string | undefined;
    do {
      const page = await client.listTools({ cursor });
      all.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor);
    if (!name)
      return all.map(({ name, description }) => ({ name, description }));
    const full = name.startsWith("relay_") ? name : `relay_${name}`;
    const tool = all.find((tool) => tool.name === full);
    if (!tool)
      throw new ClientError(`未知 MCP 工具：${name}`, "TOOL_NOT_FOUND");
    return tool;
  });
}
export async function callTool(name: string, args: Record<string, unknown>) {
  return withMcp(async (client) =>
    unwrapToolResult(
      (await client.callTool({
        name: name.startsWith("relay_") ? name : `relay_${name}`,
        arguments: args,
      })) as CallToolResult,
    ),
  );
}
