import type { RuntimeId } from "./runtimes.ts";

export interface IntegrationConfig {
  node: string;
  mcp: string;
  mcp_args?: string[];
  base_url: string;
  token_required: boolean;
}
/** Copyable snippets only: callers merge these into their chosen client config. */
export function clientMcpConfig(
  runtime: RuntimeId,
  config: IntegrationConfig,
): { content: string; hint: string } {
  const env = {
    RELAYBOARD_URL: config.base_url,
    ...(config.token_required ? { RELAYBOARD_TOKEN: "<服务令牌>" } : {}),
  };
  const args = config.mcp_args || [config.mcp];
  const server = { command: config.node, args, env };
  if (runtime === "codex")
    return {
      content: `[mcp_servers.relayboard]\nurl = ${JSON.stringify(config.base_url + "/mcp")}\n${config.token_required ? 'bearer_token_env_var = "RELAYBOARD_TOKEN"\n' : ""}`,
      hint: "合并到 Codex config.toml；启用服务令牌时，在客户端环境中设置 RELAYBOARD_TOKEN。",
    };
  if (runtime === "opencode" || runtime === "kilo")
    return {
      content: JSON.stringify(
        {
          mcp: {
            relayboard: {
              type: "local",
              command: [config.node, ...args],
              environment: env,
              enabled: true,
            },
          },
        },
        null,
        2,
      ),
      hint: "合并到客户端的 JSON 配置 mcp 字段；command 使用参数数组。",
    };
  if (runtime === "amp")
    return {
      content: JSON.stringify(
        { "amp.mcpServers": { relayboard: server } },
        null,
        2,
      ),
      hint: "合并到 .amp/settings.json 或客户端当前使用的 settings.json。",
    };
  if (runtime === "hermes")
    return {
      content: JSON.stringify({ mcp_servers: { relayboard: server } }, null, 2),
      hint: "将 mcp_servers 合并到 ~/.hermes/config.yaml；此 JSON 片段也是合法 YAML。",
    };
  return {
    content: JSON.stringify({ mcpServers: { relayboard: server } }, null, 2),
    hint:
      runtime === "continue"
        ? "保存为 .continue/mcpServers/relayboard.json，在 Agent 模式使用。"
        : runtime === "pi"
          ? "pi 使用 Relayboard 自带的 pi-extension 生命周期扩展，或客户端已有的 MCP 扩展；原生 pi MCP 支持取决于所用版本。此片段用于支持标准 mcpServers 的扩展。"
          : "在客户端 MCP 设置中添加本地 stdio 服务器，合并此片段。保留已有配置，并填入服务令牌占位值。",
  };
}
