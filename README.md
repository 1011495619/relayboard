# Relayboard · AI 协作工作台

一个本机运行的共享任务服务。Codex、Claude Code、pi agent 及其子 agent 通过同一个后台协调任务，人通过网页查看目标、分工、修改范围、消息和成果。

任务持久化在 SQLite，执行会话独立登记。窗口中断后，新会话读取接手指引、核对现场并从当前步骤继续。执行说明保存输入、输出、每步完成条件和失败动作，减少接手者重新规划的负担。复杂技术判断仍需要具备相应能力的执行者。

## 启动

需要 Node.js 24+。安装包已包含构建好的网页，首次运行由 npx 安装运行依赖，启动时自动打开看板。

当前尚未发布到 npm。下载 `relayboard-0.4.1.tgz`，在下载目录运行：

```bash
npx --yes --package=./relayboard-0.4.1.tgz relayboard
```

服务启动后保留终端，按 Ctrl+C 停止。再次运行会识别已有 Relayboard 并打开同一看板。

```bash
# 改端口、指定数据目录或关闭自动开浏览器
npx --yes --package=./relayboard-0.4.1.tgz relayboard --port 4320 --no-open
npx --yes --package=./relayboard-0.4.1.tgz relayboard --data-dir /absolute/path/to/data
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

1. 创建项目，填写目标、用户约束和实际代码目录；示例项目不会启动 AI。
2. 创建任务，定义验收、范围、资源和依赖。需要按顺序执行的任务可填写输入、输出、步骤、完成条件、失败动作和停止条件。
3. 登记真实会话和正确父 Run。日常执行用 `work_start` 获取指引；它恢复自身工作或原子领取可领取任务，不会转走他人的任务。
4. 按指引先核对文件、分支、进程与成果，读完必要契约，确认依赖成果已在本地，用 `work_report recover` 记录事实。
5. 每次只执行当前步骤，用最新指引的 handle 汇报进展、步骤结果、阻塞和实际验证。提交后由其他执行者或人验收。
6. 换工具或窗口时显式交接，处理旧写入和活动后代；新会话再次恢复核验。关注事项首页汇总需要处理的阻塞、验收和恢复工作。

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
      "args": ["/absolute/path/to/relayboard/lib/bin/mcp.js"],
      "env": { "RELAYBOARD_URL": "http://127.0.0.1:4317" }
    }
  }
}
```

本机验证了三个 CLI 的帮助与启动参数，并用受控进程测试了运行链路；自动化测试不调用付费模型。客户端版本的配置和原生子 agent 事件能力可能不同。提供了 pi 的可选生命周期扩展、Claude 的检查点导出钩子，以及所有工具通用的 MCP/CLI 协作协议。

## 协作 Skill

随附 7 个可单独加载的 Skill，网页“协作 Skills”可阅读完整流程、复制调用提示和文件路径。

| Skill | 用途 |
| --- | --- |
| `task-continuity` | 协作入口、上下文恢复与角色选择 |
| `relay-planning` | 拆分、依赖、范围与分工协商 |
| `relay-execution` | 领取、检查点、证据提交 |
| `relay-subagents` | 每层子 agent 登记、派发与来源明确的报告 |
| `relay-review` | 独立验收和协调任务集成验证 |
| `git-commit-style` | 单一目的提交、中文原因和统一标题格式 |
| `relay-handoff` | 停止旧写入、交接和现场核验 |

将所需 Skill 的整个目录放入客户端支持的技能目录，或让执行者直接读取对应 `SKILL.md`。Codex 常用 `~/.codex/skills/`，Claude Code 常用 `~/.claude/skills/`，pi 常用 `~/.pi/agent/skills/`。`task-continuity` 保留完整流程作为按需引用，单独安装也可使用；其他角色 Skill 的核心规则自包含。

项目未修改全局配置。父 agent 传递每个子 agent 自己的 Run ID、任务 ID、执行权版本、修改范围和报告要求。继承的环境变量可能仍指向父 Run，以当前任务包中的自身身份为准。

## CLI

所有 CLI 请求都访问同一服务，stdio MCP 桥接同样不创建独立数据库。

```bash
node lib/bin/relayboard.js health
node lib/bin/relayboard.js query projects
node lib/bin/relayboard.js query snapshot '{"project_id":"PROJECT_ID"}'
node lib/bin/relayboard.js query eligible '{"project_id":"PROJECT_ID","run_id":"RUN_ID"}'
node lib/bin/relayboard.js context TASK_ID
node lib/bin/relayboard.js export TASK_ID
node lib/bin/relayboard.js operations
```

写操作使用 `command OPERATION JSON`。JSON 可通过 `-` 从标准输入读取，避免 shell 引号问题；第四参数可提供稳定请求 ID，用于重试同一个请求。

```bash
node lib/bin/relayboard.js command task_checkpoint - checkpoint-request-001 <<'JSON'
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

## 按指引恢复与执行

0.4.0 增加三个日常入口，底层协调工具继续保留：

| MCP 工具 | 用途 |
| --- | --- |
| `relay_work_start` | 用自己的 Run 开始或恢复指定任务，也可选择合适的可领取工作。 |
| `relay_work_next` | 只读获取当前阶段、下一步、核对清单、契约、依赖和警告。 |
| `relay_work_report` | 使用最新 handle 报告恢复、进展、步骤、阻塞、验证或提交。 |

```bash
relayboard call relay_work_start - <<'JSON'
{"run_id":"YOUR_RUN_ID","task_id":"TASK_ID"}
JSON
```

先通过 `relay_agent_register` 取得 `run.id`。每次报告复制最新指引返回的 `handle`（任务、Run、执行权、任务版本及上下文摘要），不手工猜版本。`next_action.arguments` 故意不填写 summary/observed，按 `required_fields` 添加实际观察后再报告；原样照抄参数会校验失败。`recover` 阶段检查实际工作区、分支、未提交改动、相关进程与成果；读完所需决定后填 `read_decision_ids`，依赖成果实际进入本地后才填写 `dependency_receipts`：revision 复制指引中的服务成果摘要（并非 Git hash），note 说明实际接收和核验过程。依赖有省略时，用 `relay_work_dependencies {task_id, offset, limit}` 逐页读到 next_offset 为 null；每项含 receipt 所需的 revision。契约省略时用 `relay_decisions` 按 task_id 分页读全，再填全部必要的已读 ID。旧聊天中的“测试通过”只证明当时的版本。恢复核验与契约确认属于执行者报告，服务观察到 Git 状态也不等于服务亲自运行过测试。

任务创建、更新和拆分可以提供 `execution`，例如：

```json
{
  "inputs": ["契约 C-03 的完整内容", "已接收的接口提交"],
  "outputs": ["src/session.ts 实现", "对应验证结果"],
  "steps": [{
    "id": "session-write",
    "title": "实现会话写入",
    "instructions": "遵循既有存储接口，在指定范围实现会话写入。",
    "done_when": "成功和失败路径的行为验证通过，成果已保存。",
    "on_failure": "记录失败命令和结果；若接口契约冲突，向协调者报告阻塞。"
  }],
  "stop_when": ["需要改动任务范围外路径", "契约与实际类型冲突"]
}
```

步骤 ID 保持唯一、稳定。没有执行说明的旧任务仍可按验收标准和检查点继续。指引给出 `recover`、`execute`、`blocked`、`verify`、`submit`、`review`、`wait_children`、`done` 或 `unavailable` 阶段；读取实际 `next_action`，报告中填真实结果，不把模板占位文字当作证据。契约、计划或依赖变化后按新指引重新核验；需求或契约变化会保守重置受影响任务的步骤，纯交接且需求未变则保留已完成步骤。所有步骤完成仍需实际验证与独立验收。没有步骤计划时，执行就绪后用 `progress` 和 `ready_for_verification: true` 进入验证；`verify` 必须包含实际执行的非空 verification 记录，失败后可修正再试。guided verify 的列表是本次完整的当前检查快照，替换旧当前列表，必须包含全部必要检查和失败项；旧失败保留在事件历史，原低层 task_checkpoint 仍按原有规则合并。

接手包优先保留目标、约束和当前行动。整个指引 JSON 用顶层 `truncated`、`omissions` 和 `char_budget` 标明预算与省略（有效下限 6000 字符），其中 context 也有自己的 truncated。任一层有省略时，先按引用读取完整任务、决定或依赖，再确认已读。记录已存在不等于它已在当前工作区被接收；不同 worktree 的成果需要明确集成。

未处理请求通过 `relay_work_requests {task_id, offset, limit}` 分页恢复，包含当前任务、祖先任务以及发给旧负责人的 request/blocker。返回 items/total/next_offset，继续到 next_offset 为 null。`message_ack` 只记已读；实际处理后用 `message_resolve {message_id, run_id, note}` 记录结论，任务现负责人可以处理继承请求。网页关注事项、任务讨论和执行指引提供“标记已处理”，填写实际处理结论后提醒消失，原消息及结论继续保留。原收件会话结束后，可切换人工管理视角处理；人工调用可省略 run_id，agent 始终提供自己的有效 run_id。任务已完成也可能有真正的新请求，因此不会按任务状态直接隐藏它们。

保存事实要发生在失去上下文之前。定期报告失败尝试、结果未知的操作和下一步；支持的钩子导出已经保存的状态，不会凭空恢复未汇报进度。对于上游直接拒绝超限请求的情况，应依靠之前的持续检查点恢复。新执行者遇到模糊步骤、缺少能力、范围不足或契约冲突时报告阻塞，不自行扩张任务。

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
node lib/bin/relayboard.js run RUN_ID TASK_ID
node lib/bin/relayboard.js stop RUN_ID
node lib/bin/relayboard.js worktree PROJECT_ID '{"name":"login-api","base_ref":"HEAD"}'
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

`npm pack` 会先构建服务端和网页，再按 `files` 白名单生成安装包；包内包含服务、CLI、网页、Skill 和适配器，排除源码开发依赖、数据库、日志和测试数据。用户安装阶段没有构建或下载浏览器的脚本。

```bash
npm pack --pack-destination /absolute/path/to/releases
# 核对包内容和发布身份后，发布已经验证过的同一个包：
npm publish /absolute/path/to/releases/relayboard-0.4.1.tgz --access public --registry=https://registry.npmjs.org
```

本项目尚未公开发布到 npm。安装包验证结果以对应版本的 `VALIDATION.md` 为准；发布者需使用有包名发布权限的 npm 账号。

## TypeScript 开发与终端 MCP

服务端、CLI、客户端适配器、网页组件和测试源码均使用 TypeScript；服务端以 `strict` + NodeNext 检查，网页单独检查 TSX，测试也参与严格类型检查。Zod 校验定义推导输入，持久化记录和命令结果通过实体契约关联。发布包只包含预编译 `lib/` 和 `dist/`，运行环境仍只需 Node.js 24+。

```bash
npm ci
npm run check       # 严格类型检查、构建、行为测试
npm run dev         # tsx 启动源码后台
npm run web:dev     # Vite 网页开发
npm run build       # 生成 lib/ 与 dist/
npm start           # 运行编译后的版本
```

终端也能直接使用真实 MCP，不需要临时编写 SDK 客户端；以下命令连接同一共享服务：

```bash
node lib/bin/relayboard.js tools
node lib/bin/relayboard.js tools relay_agent_register
node lib/bin/relayboard.js call relay_projects '{}'
node lib/bin/relayboard.js call relay_agent_register - <<'JSON'
{"project_id":"PROJECT_ID","name":"Codex 当前会话","runtime":"codex","workdir":"/absolute/path/to/worktree"}
JSON
```

`tools` 默认输出简短工具目录，指定名称时仅显示该工具的输入 schema，按需获取以节省上下文。`call` 使用官方 MCP SDK 的 Streamable HTTP 传输；已有 `query` / `command` 保留 REST 接入。`RELAYBOARD_URL` 默认 `http://127.0.0.1:4317`；两种方式共享同一令牌与数据库。

`agent_register` 返回 `{ agent, run }`；任务操作使用 `run.id`。`task_split` 返回 `{ parent, children }`，拆分会更新父任务执行权，继续报告要用返回的 `parent.claim_epoch`。每个子 agent 使用自己的身份与工作树，并向父 Run 发送检查点、阻塞和交付报告。

## 提交规范

`git-commit-style` 随包分发，网页 Skills 可查看和复制；执行、子 agent、验收和交接 Skill 均在相应提交步骤引用它。源码项目的 `AGENTS.md` 同步声明规则。

```text
refactor(protocol): 关联命令输入和返回类型

让调用方在编译期发现错误的执行者身份或缺失字段，减少多执行者集成时的协议误用。
```

标题格式 `类型(范围): 简述`，不超过 50 字符；空行后用中文解释为什么，避免列举文件。类型仅用 `feat`、`fix`、`refactor`、`docs`；每个 commit 只做一件事。执行者在看板记录提交哈希和实际验证，独立验收者检查差异与证据。
