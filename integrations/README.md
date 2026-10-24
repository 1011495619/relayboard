# 跨工具接入

先启动共享服务，再配置客户端。所有连接指向同一个 URL，避免每个客户端各建一份状态。

安装包支持 `relayboard mcp` 作为 stdio 入口。发布到 npm 后，可使用下面的配置，省去填写源码安装路径；发布前使用已有服务的 HTTP 地址，或本文后续的本地 stdio 路径。

```json
{
  "mcpServers": {
    "relayboard": {
      "command": "npx",
      "args": ["--yes", "relayboard@0.3.0", "mcp"],
      "env": { "RELAYBOARD_URL": "http://127.0.0.1:4317" }
    }
  }
}
```

`mcp` 仅连接共享服务，不会为每个客户端再启动一套看板；标准输出只传 MCP 协议。

终端也可直接使用真实的 HTTP MCP，而无需先配置其他客户端：

```bash
relayboard tools                         # 精简工具目录
relayboard tools agent_register          # 只读取一个工具的完整 schema
relayboard call projects '{}'
relayboard call context - <<'JSON'
{"task_id":"TASK_ID","run_id":"YOUR_RUN_ID","max_chars":6000}
JSON
```

`tools` / `call` 使用 MCP SDK 的 Streamable HTTP 连接；`query` / `command` 仍提供 REST 入口。工具名接受 `relay_` 前缀或短名称。服务错误和 MCP 校验错误返回非零退出码，保留可读错误；`RELAYBOARD_URL` 可以是服务根地址或以 `/mcp` 结尾的地址。

`agent_register` 返回 `{agent, run}`，领取任务、检查点、收件箱应使用 **`run.id`**。每个子会话都读取自己的值。

以下本地路径均指安装包或 `npm run build` 生成的 `lib/` JavaScript。开发源码使用 `node --import tsx bin/relayboard.ts ...`；安装包用户直接运行 `relayboard`，无需 TypeScript 运行器。

## Codex

在使用中的 MCP 配置中加入以下片段，或在应用的 MCP 设置里添加 Streamable HTTP 服务：

```toml
[mcp_servers.relayboard]
url = "http://127.0.0.1:4317/mcp"
```

启用服务令牌时增加 `bearer_token_env_var = "RELAYBOARD_TOKEN"`，在客户端环境中设置同名变量。不要把实际令牌写进提示、任务记录或日志。

也可使用 stdio 桥接：

```toml
[mcp_servers.relayboard]
command = "node"
args = ["/absolute/path/to/relayboard/lib/bin/mcp.js"]

[mcp_servers.relayboard.env]
RELAYBOARD_URL = "http://127.0.0.1:4317"
```

载入 `skills/task-continuity/SKILL.md`。子 agent 不一定自动继承父会话已读的 Skill，父任务包中必须明确包含登记、领取和报告要求。

参考：[OpenAI MCP 文档](https://developers.openai.com/codex/mcp/)、[Skills 文档](https://developers.openai.com/codex/skills/)。

## Claude Code

通过客户端 MCP 配置添加：

```json
{
  "mcpServers": {
    "relayboard": {
      "command": "node",
      "args": ["/absolute/path/to/relayboard/lib/bin/mcp.js"],
      "env": { "RELAYBOARD_URL": "http://127.0.0.1:4317" }
    }
  }
}
```

也可以使用客户端支持的 HTTP MCP 接入。使用令牌时把它传入桥接进程的 `RELAYBOARD_TOKEN` 环境变量。

将 `task-continuity` 目录置于 Claude Code 支持的 Skill 目录，或在项目指令中指定该 Skill 文件。原生子 agent 必须先登记子 Run，再把独立任务包传进去；原生子 agent 的 `agent_id` 与 Relayboard Run ID 是不同标识。

可选的 `claude-checkpoint-hook.js` 接收标准输入 JSON，在 `PreCompact`/`Stop` 时导出**已经保存到服务的检查点**。按所用 Claude Code 版本的 hook 格式配置命令：

```text
node /absolute/path/to/relayboard/lib/integrations/claude-checkpoint-hook.js
```

运行环境需要 `RELAYBOARD_URL`、`RELAYBOARD_RUN_ID`、`RELAYBOARD_TASK_ID`，以及可选令牌。该 hook 不读取整段聊天，不推断未报告进度，不自动释放任务，也不声称捕获了全部原生子 agent 事件。

## pi agent

本机检查到的 pi 版本支持原生 MCP，项目配置为 `.pi/mcp.json`，用户配置为 `~/.pi/agent/mcp.json`。配置格式同上述 `mcpServers`，也可使用：

```bash
pi mcp add relayboard --url http://127.0.0.1:4317/mcp
# 查看或验证连接前，确认客户端配置指向期望的服务。
pi mcp list
```

这些命令会修改/读取 pi 自己的配置；本项目没有自动执行。旧版 pi 可通过 CLI 调用共享服务。

可选扩展不修改全局配置，按会话显式加载：

```bash
RELAYBOARD_URL=http://127.0.0.1:4317 \
RELAYBOARD_RUN_ID=YOUR_RUN_ID \
RELAYBOARD_TASK_ID=YOUR_TASK_ID \
pi --extension /absolute/path/to/relayboard/lib/integrations/pi-extension.js \
   --skill /absolute/path/to/relayboard/skills/task-continuity
```

扩展按当前 pi API 注册 MCP，报告会话心跳，在任务版本或收件箱变化时注入有长度预算的上下文，并在压缩前/退出时导出现有检查点。压缩后允许重新读取。它不创建额外模型请求，不自动启动子 agent，不根据心跳宣布工作完成。服务端仍要求明确提交和验收。

扩展基于本机安装版本的 `docs/mcp.md`、`docs/extensions.md` 和导出类型核对，另有受控生命周期测试；未发起付费模型会话。

## 所有工具通用的子 agent 派发流程

1. 协调父任务，明确子任务范围、依赖和验收标准。
2. `agent_register` 携带父 Run，取得子 Run ID。
3. 使用子 Run 原子领取子任务，取得自己的 `claim_epoch`。
4. 将接手包、子 Run/任务 ID、实际目录、执行权版本和报告要求交给原生子 agent。
5. 子 agent 保存检查点、读取收件箱、报告阻塞和交付；父 agent 汇总进度。
6. 原生事件不可观察时，由父 agent 转报并标明来源。不要用原生进程还活着代替任务进度。

孙 agent 重复同一流程。对任何子 agent，继承的环境可能仍包含父 Run ID；必须使用明确派发包里的自身身份。

## 自主协作的边界

活动 agent 可以通过 MCP 自行选择任务、提议拆分和交换消息。网页“自动接任务”显式启用有次数预算的本地 CLI 调度；新消息和依赖完成可触发后续执行，相同检查点不会导致反复启动。外部空闲窗口需自行读收件箱或使用相应适配能力。原生生命周期事件因工具、版本和插件而异，服务不假装拥有未接入的事件。
