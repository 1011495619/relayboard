/** Shared catalogue: source of truth for validation, runner defaults and UI labels. */
export const runtimeIds = [
  "codex",
  "claude",
  "pi",
  "gemini",
  "opencode",
  "copilot",
  "cursor",
  "qwen",
  "goose",
  "aider",
  "kilo",
  "auggie",
  "amp",
  "cline",
  "roo",
  "windsurf",
  "trae",
  "continue",
  "kiro",
  "antigravity",
  "hermes",
  "other",
  "human",
] as const;
export type RuntimeId = (typeof runtimeIds)[number];
export interface RunnerProfile {
  command: string;
  args: string[];
  /** Codex-compatible stdin transport: append '-' and send the prompt on stdin. */
  stdin?: boolean;
  versionArgs?: string[];
  /** Session-local MCP injection; does not edit client settings or tool permissions. */
  mcp?: "codex" | "claude";
}
export interface RuntimeDefinition {
  runtime: RuntimeId;
  name: string;
  mode: "cli" | "mcp" | "manual";
  docs: string;
  setup: string;
  note: string;
  profile?: RunnerProfile;
}
const cli = (
  runtime: RuntimeId,
  name: string,
  docs: string,
  setup: string,
  profile: RunnerProfile,
  note = "使用客户端已有的登录、模型与工具权限配置；先在终端完成首次配置。",
): RuntimeDefinition => ({
  runtime,
  name,
  mode: "cli",
  docs,
  setup,
  profile,
  note,
});
const mcp = (
  runtime: RuntimeId,
  name: string,
  docs: string,
): RuntimeDefinition => ({
  runtime,
  name,
  mode: "mcp",
  docs,
  setup:
    "在客户端的 MCP 设置中添加 Relayboard；复制下方 stdio 配置，并按客户端格式填写。",
  note: "从客户端开始会话，通过 MCP 领取、交接和报告任务；此目录项没有网页进程启动适配器。",
});
export const runtimeCatalog: RuntimeDefinition[] = [
  cli(
    "codex",
    "Codex",
    "https://developers.openai.com/codex/cli/",
    "npm install -g @openai/codex",
    {
      command: "codex",
      args: ["exec", "--json", "--color", "never", "--skip-git-repo-check"],
      stdin: true,
      mcp: "codex",
    },
  ),
  cli(
    "claude",
    "Claude Code",
    "https://code.claude.com/docs/en/headless",
    "https://code.claude.com/docs/en/setup",
    {
      command: "claude",
      args: ["--print", "--verbose", "--output-format", "stream-json"],
      mcp: "claude",
    },
  ),
  cli(
    "pi",
    "pi agent",
    "https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent",
    "npm install -g @earendil-works/pi-coding-agent",
    {
      command: "pi",
      args: ["--print", "--mode", "json"],
    },
  ),
  cli(
    "gemini",
    "Gemini CLI",
    "https://geminicli.com/docs/cli/headless/",
    "npm install -g @google/gemini-cli",
    {
      command: "gemini",
      args: ["--output-format", "stream-json", "--prompt"],
    },
  ),
  cli(
    "opencode",
    "OpenCode",
    "https://opencode.ai/docs/cli/",
    "npm install -g opencode-ai",
    {
      command: "opencode",
      args: ["run", "--format", "json"],
    },
  ),
  cli(
    "copilot",
    "GitHub Copilot CLI",
    "https://docs.github.com/en/copilot/how-tos/copilot-cli",
    "npm install -g @github/copilot",
    {
      command: "copilot",
      args: ["--prompt"],
    },
  ),
  cli(
    "cursor",
    "Cursor Agent",
    "https://cursor.com/docs/cli/headless",
    "https://cursor.com/docs/cli/installation",
    {
      command: "cursor-agent",
      args: ["--print", "--output-format", "stream-json"],
    },
    "使用 Cursor CLI 的 cursor-agent 命令；若本机只提供 agent，可在 runner-profiles.json 覆盖命令。默认权限可能只允许读取，写入按客户端配置决定。",
  ),
  cli(
    "qwen",
    "Qwen Code",
    "https://qwenlm.github.io/qwen-code-docs/en/users/features/headless/",
    "npm install -g @qwen-code/qwen-code",
    {
      command: "qwen",
      args: ["--output-format", "stream-json", "--prompt"],
    },
  ),
  cli(
    "goose",
    "Goose",
    "https://block.github.io/goose/docs/",
    "https://block.github.io/goose/docs/getting-started/installation/",
    {
      command: "goose",
      args: ["run", "--no-session", "--text"],
    },
  ),
  cli(
    "aider",
    "Aider",
    "https://aider.chat/docs/scripting.html",
    "uv tool install --python python3.12 aider-chat",
    {
      command: "aider",
      args: ["--no-auto-commits", "--message"],
    },
    "需在终端选择模型并配置 API 凭据。保留工具确认设置，关闭 Aider 自动提交，提交仍按项目规范处理。",
  ),
  cli(
    "kilo",
    "Kilo Code CLI",
    "https://kilo.ai/docs/cli",
    "npm install -g @kilocode/cli",
    {
      command: "kilo",
      args: ["run", "--format", "json"],
    },
  ),
  cli(
    "auggie",
    "Auggie",
    "https://docs.augmentcode.com/cli/automation/overview",
    "npm install -g @augmentcode/auggie",
    {
      command: "auggie",
      args: ["--print"],
    },
  ),
  cli(
    "amp",
    "Amp",
    "https://ampcode.com/docs/cli/execute-mode",
    "https://ampcode.com/docs/cli",
    {
      command: "amp",
      args: ["--stream-json", "--execute"],
    },
  ),
  mcp("cline", "Cline", "https://docs.cline.bot/mcp/configuring-mcp-servers"),
  mcp(
    "roo",
    "Roo Code",
    "https://docs.roocode.com/features/mcp/using-mcp-in-roo",
  ),
  mcp("windsurf", "Windsurf", "https://docs.windsurf.com/windsurf/cascade/mcp"),
  mcp("trae", "Trae", "https://docs.trae.ai/ide/model-context-protocol"),
  mcp(
    "continue",
    "Continue",
    "https://docs.continue.dev/customize/deep-dives/mcp",
  ),
  mcp("kiro", "Kiro", "https://kiro.dev/docs/mcp/"),
  mcp("antigravity", "Antigravity", "https://antigravity.google/docs/mcp"),
  mcp("hermes", "Hermes Agent", "https://github.com/NousResearch/hermes-agent"),
  {
    runtime: "other",
    name: "其他工具 / 自定义 CLI",
    mode: "manual",
    docs: "",
    setup:
      "支持 MCP 的客户端可使用下方配置；自定义 CLI 可在 runner-profiles.json 添加 other。",
    note: "使用独立 Run 身份参与同一套任务协议。",
  },
  {
    runtime: "human",
    name: "人工",
    mode: "manual",
    docs: "",
    setup: "在看板中领取、交接和验收任务。",
    note: "人工会话不启动模型进程。",
  },
];
export const runtimeNames = Object.fromEntries(
  runtimeCatalog.map((r) => [r.runtime, r.name]),
) as Record<RuntimeId, string>;
export const defaultRunnerProfiles = Object.fromEntries(
  runtimeCatalog.filter((r) => r.profile).map((r) => [r.runtime, r.profile!]),
) as Record<string, RunnerProfile>;
export const supportsLaunch = (runtime: string) =>
  !!defaultRunnerProfiles[runtime as RuntimeId] || runtime === "other";
export interface RuntimeInfo extends Omit<RuntimeDefinition, "profile"> {
  available: boolean;
  version: string;
  launch_enabled: boolean;
  launchable: boolean;
  command: string;
  args: string[];
  reason: string;
  auth_status: "unchecked" | "not_applicable";
}
export interface RunnerStatus {
  enabled: boolean;
  reason: string;
  config_path: string;
  runtimes: RuntimeInfo[];
}
