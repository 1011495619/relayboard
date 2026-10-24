# 跨工具接入

先启动共享服务，再配置客户端。所有连接指向同一个 URL，避免每个客户端各建一份状态。

安装包支持 `relayboard mcp` 作为 stdio 入口。发布到 npm 后，可使用下面的配置，省去填写源码安装路径；发布前使用已有服务的 HTTP 地址，或本文后续的本地 stdio 路径。

```json
{
  "mcpServers": {
    "relayboard": {
      "command": "npx",
      "args": ["--yes", "relayboard@0.6.0", "mcp"],
      "env": { "RELAYBOARD_URL": "http://127.0.0.1:4317" }
    }
  }
}
```

`mcp` 仅连接共享服务，不会为每个客户端再启动一套看板；标准输出只传 MCP 协议。

终端也可直接使用真实的 HTTP MCP，而无需先配置其他客户端：

```bash
relayboard tools                         # 精简工具目录
relayboard tools work_start              # 只读取一个工具的完整 schema
relayboard call work_start - <<'JSON'
{"task_id":"TASK_ID","run_id":"YOUR_RUN_ID"}
JSON
relayboard call work_next - <<'JSON'
{"task_id":"TASK_ID","run_id":"YOUR_RUN_ID","max_chars":6000}
JSON
```

`tools` / `call` 使用 MCP SDK 的 Streamable HTTP 连接；`query` / `command` 仍提供 REST 入口。工具名接受 `relay_` 前缀或短名称。服务错误和 MCP 校验错误返回非零退出码，保留可读错误；`RELAYBOARD_URL` 可以是服务根地址或以 `/mcp` 结尾的地址。

`agent_register` 返回 `{agent, run}`，领取任务、检查点、收件箱应使用 **`run.id`**。每个子会话都读取自己的值。

## 统一恢复入口

登记后用 `work_start` 取得阶段和下一步。检查顶层 truncated/omissions/char_budget（整个指引 JSON 有效预算至少 6000 字符）及 context.truncated，任一层省略都要补读。先读目标、约束、警告、契约与依赖；核对实际 cwd、分支、改动、进程和成果。使用返回的最新 `handle` 调用 `work_report`，`kind: "recover"` 填实际观察、完整读过的 `read_decision_ids` 和依赖成果实际进入本地后的 `dependency_receipts`。receipt 的 revision 使用 guide.dependencies 中的服务成果摘要（并非 Git hash），note 说明实际如何接收并确认本地已有成果。指引省略决定时，按 task_id 分页读取全部相关决定再确认。依赖省略时用 work_dependencies {task_id, offset, limit} 读全每项 revision，未处理请求用 work_requests 同参数读全（含祖先和旧 owner 请求）；两者返回 items/total/next_offset，翻页到 null。message_ack 仅已读，处理后 message_resolve {message_id, run_id, note} 记结论，现 owner 可处理继承请求。确认恢复后只做当前步骤，报告其观察结果，再读下一步。

报告种类为 `recover`、`progress`、`step`、`blocked`、`verify`、`submit`。next_action.arguments 故意省略 summary/observed，按 required_fields 填真实观察后再提交；完整照抄模板会校验失败。不要重用过期 handle；归属、契约、计划或依赖变化时重新获取指引。`work_start` 只恢复自身工作或领取合适任务，转交其他 Run 的任务仍需显式 handoff。guided verify 提交本次完整当前检查快照（包含失败），替换旧当前列表；历史失败仍在事件中。需求/契约变化后 recover 并重走保守重置的任务步骤，纯交接且契约不变保留步骤。旧服务缺少新工具时，使用 `eligible`/`task_claim`/`task_checkpoint`/`task_submit`，交接后先 `task_reconcile`。

### 客户端能力边界

| 接入方式 | 能提供什么 | 仍需执行者处理 |
| --- | --- | --- |
| 通用 HTTP/stdio MCP | 持久任务、步骤指引、检查点、消息与明确交接 | 主动登记、核验现场、汇报事实、读收件箱；MCP连接本身不观察全部原生子 agent。 |
| 托管 CLI runner | 注入身份/任务入口、记录托管进程和日志；显式启用后可派发 | 模型仍按指引报告实际工作；退出不等于验收完成。 |
| Claude PreCompact/Stop 钩子 | 导出服务中已经保存的任务状态 | 在仍可调用工具时先保存事实；钩子不从聊天推断尚未汇报进度。 |
| pi 生命周期扩展 | 在支持事件处报告心跳、注入有界任务指引/消息、压缩前导出 | 真实成果、契约已读和依赖已接收仍需报告；事件取决于客户端版本。 |

原生子 agent 自动发现与外部空闲窗口唤醒并非所有客户端共有。只在适配器实际支持并有观察证据时显示相应能力。较弱模型的恢复能力需以实际试验验证；项目不因存在步骤指引就声称它能解决所有复杂任务。


以下本地路径均指安装包或 `npm run build` 生成的 `lib/` JavaScript。开发源码使用 `node --import tsx bin/relayboard.ts ...`；安装包用户直接运行 `relayboard`，无需 TypeScript 运行器。

## 统一客户端目录

侧栏「Agent 接入」提供 13 种本机 CLI 适配器、8 种 MCP 客户端接入指引及 `other` 自定义适配器。完整列表、启动排障与 `runner-profiles.json` 示例见 [README](../README.md#从看板启动-agent)。每个目录项可复制对应客户端格式的 MCP 配置；复制不写入全局设置，按提示合并并保留已有配置。

- Codex：HTTP TOML，令牌通过 `bearer_token_env_var` 指定环境变量。
- Claude/Cursor/Gemini/Qwen/Cline/Roo/Windsurf/Trae/Kiro/Antigravity 等：标准 `mcpServers` stdio 配置；以客户端所用版本的设置界面为准。
- OpenCode/Kilo：`mcp`，`type: local`，`command` 参数数组，`environment` 保存环境设置。
- Amp：`amp.mcpServers`。
- Continue：可将标准 JSON 保存为 `.continue/mcpServers/relayboard.json`，在 Agent 模式使用。
- Hermes：将 `mcp_servers` 合并到 `~/.hermes/config.yaml`；生成的 JSON 同样符合 YAML 语法。
- pi：原生 MCP 能力依版本而定，优先使用下方随包生命周期扩展；标准配置供已有 MCP 扩展使用。托管 CLI 可通过接手包内的 Relayboard CLI 操作共享服务。

Codex/Claude 默认托管配置为本次进程注入 `relayboard_session` HTTP MCP。它与 shell 沙箱内的网络分开，避免只读终端访问不到本地服务时报告中断；不会改写客户端全局配置或沙箱/审批策略。账户、客户端启动和 MCP 工具审批仍按客户端实际配置决定。其他客户端使用已有 MCP 设置或接手包内 CLI；CLI 需要对应会话可访问本地服务。

所有客户端仍遵循同一身份、任务归属、并发范围、原生子 Agent 登记和独立验收规则。品牌图标来自 LobeHub 静态 SVG；当前库缺失的品牌使用首字标识。

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

1. 父协调者定义子任务输入、输出、步骤/完成条件/失败动作、范围、依赖和验收，记录受影响任务的接口契约。
2. 派发前 `agent_register` 携带父 Run，取得每个子 agent 自己的 `run.id`；为并行写入准备真实独立 Git worktree。
3. 子 agent 通过 `work_start` 原子领取明确任务，或父代派发前进行明确原子领取；不会静默接走其他负责人的任务。
4. 给子 agent 服务连接、自己的 Run/任务 ID、实际目录/分支和报告目的地，让它读取当前指引；继承环境可能仍指向父身份。
5. 子 agent 核验实际现场，读取完整契约并确认依赖成果，使用最新 handle 报告 `recover` 后执行当前步骤。
6. 每个子 agent 报告部分进展、步骤结果、阻塞、验证和交付，父代读取并汇总。缺少直接服务访问时，转报真实来源，不把转报当作亲自观察。
7. 子任务独立验收后，父代接收确切成果并运行新的集成验证，再提交协调任务。

孙 agent 重复同一流程。父会话中断时，仍在运行的后代需要明确保留及重定向报告，或观察停止后再释放；心跳失联不等于停止。

## 自主协作的边界

活动 agent 可以通过 MCP 自行选择任务、提议拆分和交换消息。网页“自动接任务”显式启用有次数预算的本地 CLI 调度；新消息和依赖完成可触发后续执行，相同检查点不会导致反复启动。外部空闲窗口需自行读收件箱或使用相应适配能力。原生生命周期事件因工具、版本和插件而异，服务不假装拥有未接入的事件。


## 项目记忆与大总管

先用 `memory_search {project_id, query, max_chars}` 检索短摘要，再按返回的 `memory_id/version` 用 `memory_get` 补读来源和证据；翻页遵循 `next_offset`。任务包只附带少量相关或置顶摘要。`memory_save` 保存可复用的已核实经验，更新必须带当前版本；历史版本由 `memory_history` 读取。过期和归档内容默认不参与搜索，记忆不替代现行任务契约。

远程查询通过 `memory_sources`、`memory_remote_search`、`memory_remote_get`，仅连接数据目录 `memory-remotes.json` 中显式配置的 Relayboard/兼容记忆 API。来源认证通过环境变量；不会自动同步本地任务或上传文件。远程结果需显式 `memory_save` 才成为本地记忆。配置示例见 [README](../README.md)。

服务启动后每15秒巡视全部项目及子孙任务，默认只观察。`supervisor_status` 查看原因、提醒、尝试次数及新Run；`supervisor_configure` 按项目选择提醒或恢复模式，并设置宽限、冷却、客户端顺序与执行预算。更改策略保留已用预算，`reset_budget` 才显式重置。`supervisor_handle` 可暂缓或重新检查，均不宣告旧进程已停止。

提醒写入收件箱；已启用的Run调度可响应新消息，外部闲置会话需要轮询或客户端适配。恢复建立独立新Run并保留检查点、层级和相关记忆；旧写入者状态未知时升级问题。停止本服务持有的托管进程需策略明确启用，并等待实际退出。服务须持续运行；机器休眠或关闭服务期间不巡视。真实模型能否继续仍依赖客户端登录、工具权限与任务本身，进程退出并不代表交付完成。
