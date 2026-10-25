# 日常协作协议减负（RB-005）

契约版本：`evolution-v1`。本文记录 `work_start → work_next → work_report` 日常路径的
`view=full|action` 增量、同夹具前后测量与回归证据。实现只改 RB-005 范围内文件，
保留 RB-003/RB-004 已验收成果、原 SQLite 与 dev 未提交 UI 改动。

## 1. 改动目标与边界

小任务经常机械维护同一状态：`work_start` 领取后还要再 `work_next` 刷一次完整指引，
且每次 report 都返回大段重复的 task/接手包/契约正文，占用上下文并增加漏读风险。

本任务在三个入口新增可选 `view: "full" | "action"`（缺省 `full`，与 0.7 客户端兼容）：

- `full`：返回现有 `WorkGuide`，语义不变。
- `action`：返回精简 `ActionGuide`，不重复完整 task、接手包 markdown、契约正文、
  依赖正文、artifacts/verification 历史；保留 `handle`、`next_action`、`current_step`、
  `completed_steps`、`references`、`dependency_page`、`request_page`、`warnings`、
  `choices`、`omissions`、`truncated`。
- `work_report(view:"action")` 直接返回下一 `handle` 与 `next_action`，
  调用方可省掉一次纯刷新 `work_next`。

复用的还是同一状态机、handle/context_version 校验、旧 epoch 栅栏、依赖 receipt、
请求闭环和独立验收，不建旁路；`omissions` 中列出的契约/依赖/请求仍须逐页补读，
服务不因紧凑视图默认已读。

## 2. 保留的已知守卫

- 省略/分页：`omissions`、`references`、`dependency_page`/`request_page` 完整；
  `relay_decisions`、`relay_work_dependencies`、`relay_work_requests` 分页语义不变。
- handle：`WorkHandle` 五字段原样传递，旧 `task_version`/`context_version`/`claim_epoch`
  重放返回 `STALE_VERSION`/`STALE_HANDLE`/`CONTEXT_CHANGED`，提示 `relay_work_next`。
- 契约：`recover` 仍要求 `read_decision_ids` 覆盖全部相关决定，否则 `CONTRACTS_UNREAD`。
- 依赖收据：`recover` 仍要求按服务 revision 回填 `dependency_receipts`，
  未实际接收报 `DEPENDENCIES_NOT_RECEIVED`。
- 有序步骤：`step` 必须匹配当前 `current_step.id`，否则 `STEP_ORDER`；
  未恢复先报 `RECOVERY_REQUIRED`。
- 独立验收：`verify`/`submit`/`task_review` 门槛不变，`action` 不自动通过任何核验。

## 3. 同夹具测量（before/after）

夹具沿用 RB-002 持久 v2 脚本
`/Users/ansheng/Desktop/project/relayboard-evidence/evolution-rb002/replay/mcp_baseline.py`
（SHA-256 `161eb50c4152c015a3d6a1f95688d967db00857140411df4b9dbb31d7e69c540`），
统计边界与 RB-002 一致；action 夹具为
`.relayboard/rb005-evidence/replay/mcp_action.py`
（SHA-256 `87f16241a5d936b15681e5b9cc003761bdeff9324189bdceb51cc33b427e93ed`，
位于仓库内 `.relayboard`（gitignore），未提交）。

两夹具均在 `--repo .relayboard/worktrees/rb005`（dev HEAD `e78a3b2`，未改源码前与改后
各一次）、全新空数据目录、`RELAYBOARD_RUNNERS=0`、随机回环端口下运行；
`human_interventions=0`、`paid_model_calls=0`。原始 `result.json`/`service.log` 保存在
`.relayboard/rb005-evidence/replays/{before-full,after-full,after-action}/`。

| 口径 | before-full | after-full | after-action |
| --- | --- | --- | --- |
| 准备 JSON-RPC | 6 | 6 | 6 |
| 执行到 submit JSON-RPC | 7 | 7 | **6** |
| 验收读取/review/终读 | 3 | 3 | 3 |
| 合计 JSON-RPC | 16 | 16 | **15** |
| 执行到 submit 响应字符 | 56131 | 56124 | **18463** |
| work_start 到最终读取字符 | 146758 | 146745 | **109246** |
| recovery_ms（本机观测） | 6.132 | 5.088 | 2.760 |

结论：

- `after-full` 与 `before-full` 执行段调用数与字符基本一致（56124 vs 56131），
  full 模式与 0.7 返回语义兼容。
- `action` 模式把执行段从 7 次调用降到 6 次（去掉纯刷新 `work_next`），
  执行段响应字符从约 5.6 万降到约 1.8 万。这是真实消除的重复维护动作：
  小任务无需为拿到下一 handle 再拉一次完整指引。
- 响应字符只是本机观测，不承诺 token 节省比例；人工介入与漏读/漏报仍为 0，
  因为 `action` 的 `omissions`/`references` 与分页语义强制补读。

## 4. 最短可运行示例

```bash
# 登记 Run（保留返回的 run.id）
relayboard call relay_agent_register - <<'JSON'
{"project_id":"PROJECT_ID","name":"执行会话","runtime":"other","workdir":"/abs/path","capabilities":["testing"]}
JSON

# action 视图领取：直接返回 handle 与 next_action，无需再 work_next
relayboard call relay_work_start - <<'JSON'
{"run_id":"YOUR_RUN_ID","task_id":"TASK_ID","view":"action"}
JSON

# 按 omissions/references 补读契约与依赖后报告 recover，继续用返回的下一 handle
relayboard call relay_work_report - <<'JSON'
{"handle":{"task_id":"TASK_ID","run_id":"YOUR_RUN_ID","claim_epoch":1,"task_version":1,"context_version":"FROM_GUIDE"},"view":"action","kind":"recover","summary":"已核对现场、契约与依赖成果","observed":"实际目录/分支/进程/成果核验","read_decision_ids":[],"dependency_receipts":[]}
JSON
```

`relayboard tools relay_work_start` / `relay_work_next` / `relay_work_report` 与
`relay_api {name}` 均可发现 `view` 字段；`relayboard doctor` 检查服务与 MCP 连接，
失败时给出 `RELAYBOARD_URL`/服务进程/`RELAYBOARD_TOKEN`/stdio 入口的修复动作。

## 5. 回归证据

- 单元测试新增 5 项（`tests/workflow.test.ts`）：action 压缩日常路径且无需 work_next
  刷新、action 保留 omissions/references/依赖页且不重复契约正文、`relay_api` 暴露
  view、action 不是绕过（恢复与有序步骤仍强制）、full 与 action 语义并存。
- 既有 15 项 workflow 测试全通过；RB-003/RB-004 测试不受影响。
- `npm run check` 在 worktree 内实跑，结果见
  `.relayboard/rb005-evidence/npm-run-check.log`（退出码 0）。

## 6. 剩余边界

- 未改动 `server/workflow.ts` 之外的领域守卫、RB-003/RB-004 实现、web/ 与 package.json。
- 本任务未自行验收；提交后由协调者独立 review 并按序集成 dev。
- 仓库外 `relayboard-evidence/` 目录本次执行环境不可写，证据保存在
  `.relayboard/rb005-evidence/`（gitignore），由 Lead 决定是否归档到仓库外目录。
- 真实厂商模型实测、stdio 全链路与浏览器场景按序列留给 RB-007 复验。
