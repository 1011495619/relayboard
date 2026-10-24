# Relayboard · AI 协作工作台

一个本机运行的共享任务服务。Codex、Claude Code、pi agent 及其子 agent 通过同一个后台协调任务，人通过网页查看目标、分工、修改范围、消息和成果。

任务持久化在 SQLite，执行会话独立登记。窗口中断后，新会话读取接手包、核对现场并继续执行。

## 启动

需要 Node.js 24+。安装包已包含构建好的网页，首次运行由 npx 安装运行依赖，启动时自动打开看板。

当前尚未发布到 npm。下载 `relayboard-0.2.0.tgz`，在下载目录运行：

```bash
npx --yes --package=./relayboard-0.2.0.tgz relayboard
```

服务启动后保留终端，按 Ctrl+C 停止。再次运行会识别已有 Relayboard 并打开同一看板。

```bash
# 改端口、指定数据目录或关闭自动开浏览器
npx --yes --package=./relayboard-0.2.0.tgz relayboard --port 4320 --no-open
npx --yes --package=./relayboard-0.2.0.tgz relayboard --data-dir /absolute/path/to/data
```

发布到 npm 后，公开安装入口就是以下命令；发布前请使用上面的本地包：

```bash
npx --yes relayboard@latest
```

开发源码时才需要以下步骤：

```bash
npm ci
npm run build
npm start
```

网页：<http://127.0.0.1:4317>。MCP：<http://127.0.0.1:4317/mcp>。

源码目录在 macOS 也可双击 `启动 Relayboard.command`。默认只监听本机回环地址。

```bash
# 可选：自定义端口、数据目录、服务令牌
PORT=4320 RELAYBOARD_DATA_DIR=/absolute/path/to/data RELAYBOARD_TOKEN=YOUR_TOKEN npm start
```

设置令牌后，网页要求输入同一令牌，CLI/MCP 通过 `RELAYBOARD_TOKEN` 环境变量连接。`RELAYBOARD_RUNNERS=0` 关闭从网页启动进程的能力。客户端和服务端使用同一台机器；本版没有实现跨设备文件同步、远程多租户或公共网络部署。

## 网页使用

1. 创建项目，填写目标、用户约束和实际代码目录。也可以显式载入带标记的示例项目，示例不会启动任何 AI。
2. 创建任务，写明验收标准、相对修改路径、独占共享资源和前置依赖。
3. 登记真实执行会话，选择工具、工作目录、分支和父 Run。登记本身不启动进程。
4. 在“领取工作”中选择执行者，查看可直接领取、可协商拆分、等待条件的任务。领取会重新检查条件。
5. 执行过程中保存检查点、成果位置和实际验证结果。提交后进入“待验收”；独立审查通过才完成。
6. 交接给另一工具时，停止旧写入，明确活动子任务继续还是停止。新负责人先核验现场。

页面采用官方 shadcn `base-nova` 组件与 Base UI 交互基础、Tailwind v4，支持保存在本机的明暗主题。任务详情使用 Sheet，操作表单使用 Dialog；任务筛选和视图切换使用 Base UI Select / ToggleGroup。任务看板支持卡片与树形视图。执行者树显示每一层 Run、状态来源、最近进度和工作目录；修改范围显示当前写入占用；消息和决定分别保存讨论与已确认共识。

项目支持“允许范围内自主拆分”和“人工确认拆分”。人工模式仍允许领取已经发布的任务；由 agent 发起的任务创建/拆分须先经人工确认。人使用“人工管理视角”处理管理动作；agent 应始终携带自己的 Run ID。

## 工具接入

网页“项目与接入”提供当前安装路径的配置，可直接复制。完整操作见 [integrations/README.md](integrations/README.md)。配置示例中的路径须替换为实际安装目录。

Codex 的 HTTP MCP 配置片段：

```toml
[mcp_servers.relayboard]
url = "http://127.0.0.1:4317/mcp"
# 启用令牌时添加：
# bearer_token_env_var = "RELAYBOARD_TOKEN"
```

Claude Code / 支持 MCP 的 pi 使用通用 stdio 配置：

```json
{
  "mcpServers": {
    "relayboard": {
      "command": "node",
      "args": ["/absolute/path/to/relayboard/bin/mcp.js"],
      "env": { "RELAYBOARD_URL": "http://127.0.0.1:4317" }
    }
  }
}
```

本机验证了三个 CLI 的帮助与启动参数，并用受控进程测试了运行链路；自动化测试不调用付费模型。客户端版本的配置和原生子 agent 事件能力可能不同。提供了 pi 的可选生命周期扩展、Claude 的检查点导出钩子，以及所有工具通用的 MCP/CLI 协作协议。

## 协作 Skill

随附 6 个可单独加载的 Skill，网页“协作 Skills”可阅读完整流程、复制调用提示和文件路径。

| Skill | 用途 |
| --- | --- |
| `task-continuity` | 协作入口、上下文恢复与角色选择 |
| `relay-planning` | 拆分、依赖、范围与分工协商 |
| `relay-execution` | 领取、检查点、证据提交 |
| `relay-subagents` | 每层子 agent 登记、派发与来源明确的报告 |
| `relay-review` | 独立验收和协调任务集成验证 |
| `relay-handoff` | 停止旧写入、交接和现场核验 |

将所需 Skill 的整个目录放入客户端支持的技能目录，或让执行者直接读取对应 `SKILL.md`。Codex 常用 `~/.codex/skills/`，Claude Code 常用 `~/.claude/skills/`，pi 常用 `~/.pi/agent/skills/`。`task-continuity` 保留完整流程作为按需引用，单独安装也可使用；其他角色 Skill 的核心规则自包含。

项目未修改全局配置。父 agent 传递每个子 agent 自己的 Run ID、任务 ID、执行权版本、修改范围和报告要求。继承的环境变量可能仍指向父 Run，以当前任务包中的自身身份为准。

## CLI

所有 CLI 请求都访问同一服务，stdio MCP 桥接同样不创建独立数据库。

```bash
node bin/relayboard.js health
node bin/relayboard.js query projects
node bin/relayboard.js query snapshot '{"project_id":"PROJECT_ID"}'
node bin/relayboard.js query eligible '{"project_id":"PROJECT_ID","run_id":"RUN_ID"}'
node bin/relayboard.js context TASK_ID
node bin/relayboard.js export TASK_ID
node bin/relayboard.js operations
```

写操作使用 `command OPERATION JSON`。JSON 可通过 `-` 从标准输入读取，避免 shell 引号问题；第四参数可提供稳定请求 ID，用于重试同一个请求。

```bash
node bin/relayboard.js command task_checkpoint - checkpoint-request-001 <<'JSON'
{
  "task_id": "TASK_ID",
  "run_id": "RUN_ID",
  "claim_epoch": 1,
  "summary": "已经核对的具体进度",
  "next_step": "接下来可直接执行的动作",
  "artifacts": [{"path":"src/api/login.js","kind":"file"}],
  "verification": [{"command":"npm test","passed":true,"result":"实际观察到的测试结果"}]
}
JSON
```

## 任务与并发约定

- **任务与 Run 分离**：任务长期存在；新的窗口登记新 Run，通过明确交接接手旧任务。
- **协调与执行分离**：拆分后父任务协调，子任务独立领取。父负责人不会锁住整个子树的代码。
- **原子领取**：SQLite `BEGIN IMMEDIATE` 事务重新检查版本、依赖、能力、全项目并发预算和范围冲突。多个进程竞争只产生一个负责人。
- **执行权版本**：拆分、交接和释放更新 `claim_epoch`，旧负责人和旧版本的检查点会被拒绝。接手后必须核验现场。
- **依赖验收**：任务提交不释放依赖，验收通过后下游任务才变为就绪；上层依赖会作用于子任务。
- **范围与资源**：同一物理目录中的重叠写入会冲突；不同 worktree 可并行修改同名逻辑路径。命名独占资源在不同 worktree 之间仍串行。
- **独立 worktree**：网页可创建真实 Git worktree 与新分支，不重置原 checkout。创建后登记执行者；集成由协调任务负责，不自动合并代码。
- **消息与决定**：持久消息支持定向收件箱与确认收到；讨论达成的共识另存为决定，供接手包引用。
- **失联不等于停止**：心跳只提供状态报告。服务重启把原托管进程标记为待核实，保留任务占用，不自动重派。

范围检查和身份归属面向可信协作客户端，属于协作约束；它们不是操作系统文件沙箱或独立 agent 的权限认证。独立 worktree 隔离文件修改，公共接口的一致性依赖明确约定与集成验证。

## 托管执行

登记并领取任务后，可显式启动本机的 Codex、Claude Code 或 pi CLI。运行器传入有长度预算的接手包、环境中的项目服务地址和任务身份；保留 JSONL/文本日志，记录进程句柄与退出结果。默认每次最多运行 20 分钟，到时请求终止。

```bash
node bin/relayboard.js run RUN_ID TASK_ID
node bin/relayboard.js stop RUN_ID
node bin/relayboard.js worktree PROJECT_ID '{"name":"login-api","base_ref":"HEAD"}'
```

使用各工具现有的登录、默认模型和权限配置，不加入跳过权限或沙箱的参数。进程退出不自动宣布任务完成。AI 需要通过 MCP 或 CLI 报告实际检查点和证据。

在“执行者树”中可为每个本地执行者显式启用“自动接任务”，设置本次最多启动次数。调度器每 5 秒检查可领取工作，按范围、依赖、能力与预算领取任务并启动 CLI；新的定向消息和依赖完成可以触发后续执行。同一任务没有新消息或新执行权时不会因检查点更新反复重启。次数用完或启动失败会关闭自动执行；关闭策略不停止已有进程。

活动执行者可以查询工作、提出拆分、读写消息、委派已登记的后代。外部空闲窗口仍需主动接入，持久消息不会自动唤醒所有外部窗口。原生子 agent 的自动发现不是通用能力，跨工具的可靠基线是派发前登记与父子双方报告。

## 数据与恢复

通过 npx 运行时，默认数据目录独立于包版本、npm 缓存和启动目录：

- macOS：`~/Library/Application Support/Relayboard`
- Linux：`$XDG_DATA_HOME/relayboard`，未设置时为 `~/.local/share/relayboard`
- Windows：`%LOCALAPPDATA%\\Relayboard`

源码目录若已有 `.relayboard/relayboard.sqlite`，继续使用原数据。显式的 `--data-dir` 或 `RELAYBOARD_DATA_DIR` 优先。启动日志会显示实际数据位置；改端口不自动隔离数据，需要独立看板时同时指定独立数据目录。

数据目录内容：

```text
relayboard.sqlite            任务、Run、消息、决定、事件和幂等请求记录
relayboard.sqlite-wal        SQLite 运行期间的 WAL（存在时需一并保留）
logs/                       托管进程输出
spaces/PROJECT_ID/TASK_ID/   导出的 TASK.json 与 HANDOFF.md
worktrees/                  从网页创建的实际独立 checkout
```

数据库是共享状态的唯一来源，Markdown 是接手导出。停止服务后备份完整数据目录；运行中的数据库用 SQLite 备份方式，不单独复制主文件后丢弃 WAL。Git worktree 与原仓库有关联，长期迁移代码请通过正常 Git 分支/提交管理。

## 开发和验证

```bash
npm test
npm run build
npm run check
npm run web:dev     # 另一个终端保留 npm start；Vite 在 5173 代理本机 4317 API
```

测试涵盖独立 SQLite 连接抢任务、过期执行权、范围冲突、层级和预算、原子拆分、依赖验收、消息、交接、持久化、HTTP/stdio MCP、CLI、真实受控进程启停和 Git worktree。浏览器操作验证记录见 `VALIDATION.md`。

技术栈：Node.js 24 原生 SQLite、Express、MCP SDK、Zod、React、Vite。`npm ci` 使用锁定的依赖版本。源代码与必要配置已包含；依赖、个人运行数据和浏览器临时文件不属于可分发包。

## npm 打包与发布

`npm pack` 会先构建网页，再按 `files` 白名单生成安装包；包内包含服务、CLI、网页、Skill 和适配器，排除源码开发依赖、数据库、日志和测试数据。用户安装阶段没有构建或下载浏览器的脚本。

```bash
npm pack --pack-destination /absolute/path/to/releases
# 核对包内容和发布身份后，发布已经验证过的同一个包：
npm publish /absolute/path/to/releases/relayboard-0.2.0.tgz --access public --registry=https://registry.npmjs.org
```

本次只生成、安装并验证了本地包，没有执行 npm 发布。发布者需使用有包名发布权限的 npm 账号。
