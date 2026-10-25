# RB-007 · 端到端演练指标与 P0 基线比较

契约版本：`evolution-v1`。本文按 `docs/evolution/baseline.md` §5 的同一统计边界记录
RB-007 受控演练的协议调用数、恢复时间、人工介入、返工、可获得的成本及 unknown 项。
所有数字来自可复跑脚本 `scripts/evolution-smoke.ts` 的 `result.json`（仓库外证据在
`.relayboard/rb007-evidence/`，gitignore，未提交）。

## 1. 测量环境

| 项目 | 本次观察 |
| --- | --- |
| 源码 | `.relayboard/worktrees/rb007`（detached，dev HEAD `23ea86e3e0a8be355ef9195da56078e49962ad47`） |
| 服务 | 编译后的当前 worktree `lib/`；随机回环端口；`RELAYBOARD_RUNNERS=0` |
| 数据 | 每次 smoke 全新空数据目录，`verification-profiles.json` 由脚本生成 |
| 运行时 | Node.js `v24.22.1`，npm `11.19.1`，macOS |
| 客户端 | 受控 CLI（`node lib/bin/relayboard.js call …`，Streamable HTTP MCP）与受控 stdio MCP（`node lib/bin/mcp.js`） |
| 身份 | 全部为受控 QA 身份，0 模型调用、0 人工介入 |

## 2. 协议调用数与字符（同口径）

P0 基线（baseline §5，replay-a/b，full 视图）统计边界固定为：
`preparation` 含成功 readiness tools/list、建项目、3 Run、建任务；
`execution_start_through_submit` 含 work_start、work_next、recover、progress、step、verify、submit；
`acceptance_read_review_read` 含 task 读、独立 review、最终 task 读。

| 口径 | P0 基线 replay-a/b（full） | RB-007 演练（action） |
| --- | --- | --- |
| 准备 JSON-RPC | 6 | 6（场景 1 的 project + 2 Run + task 建任务） |
| 执行到 submit JSON-RPC | 7 | **6**（action 视图去掉 work_next 纯刷新，与 RB-005 after-action 一致） |
| 验收读取/review/终读 | 3 | 3 |
| work_start 到最终读取 | 10 | 9（等价省去 work_next） |
| 执行到 submit 响应字符 | 55129 / 55128 | 见边界说明 |
| work_start 到最终读取字符 | 240225 / 240224 | 见边界说明 |

RB-007 的 `s1_http_mcp` 场景只统计「执行到 submit」的调用数 6（不含准备与验收读取），
与 P0 的 7 相比减少 1 次纯刷新 `work_next`，该减少与 RB-005 交付的
`docs/evolution/daily-workflow.md` §3 `after-action` 一致。RB-007 不在整段脚本中复刻
P0 的字符统计边界：smoke 通过每次独立 CLI 进程发起调用，响应字符包含 CLI 进程自身
输出，不能与 P0 长连接 HTTP 客户端的字符数直接等同，因此这里只比较调用数，不比较字符。

RB-007 整个 smoke（含 7 个场景与多次服务重启）合计 41 次 JSON-RPC、90613 响应字符、
观测耗时约 4857 ms；这个总数是全部场景的总和，不是单链路数字，不能与 P0 单链路数字混用。

## 3. 恢复时间

- P0 定义：脚本从 `work_start` 返回后，执行一次 `work_next` 并提交 `recover` 的墙钟时间
  （不含阅读契约、文件检查或模型推理）。replay-a/b 为 `5.310 / 4.722 ms`。
- RB-007 定义：从开始提交 `work_report(recover)` 到该次受控 CLI 调用返回的墙钟时间
  `118 ms`（本次最终 run）。差异来源是 RB-007 smoke 每次调用都冷启动一个 Node CLI 进程
  （Node 启动 + Streamable HTTP MCP 连接），而 P0 在一个长连接 Python 脚本内调用。
  因此该数值不宣称“更慢”，只记录本机观测；同口径的**调用数**比较见上表。
- 结论：action 视图使执行段调用从 7 降到 6，恢复流程本身仍强制 `recover` 且不得跳过。

## 4. 人工介入、返工与可获得的成本

| 指标 | 本次值 | 说明 |
| --- | --- | --- |
| 人工介入 | 0 | 全程受控脚本 + 受控 QA 身份，无人工步骤 |
| 模型调用 | 0 | `RELAYBOARD_RUNNERS=0`，未启动任何厂商模型 |
| 返工 | 0 | 脚本修复仅发生在**测试夹具**（profile 传参、handle 链、version 刷新），未发现产品缺陷需返工 |
| 可获得的成本 | 仅记录观测字符/耗时，不折算为 token 或价格 | 响应字符不是 token/字节，耗时只是本机观测，不设性能承诺 |

## 5. unknown 项

- 真实厂商模型实测：**未执行**（用户未安排；受控进程不冒充真实模型）。
- 浏览器像素级人工查看：截图与 DOM 文本证据已生成，像素级查看由协调者最终复验完成。
- 服务端内部 PID 与跨重启存活证明：按契约不承诺；smoke 以受控脚本写入 PID 文件后
  `kill` 并 `kill -0` 核实，再做 `confirmed_stopped` reconcile。
- 完整「准备/执行/验收」三段字符统计：RB-007 以每次 CLI 进程冷启动方式测量，字符口径
  与 P0 长连接客户端不可直接等同，故只比较调用数。

## 6. 与 baseline §5 的同口径结论

1. 隔离与边界保持：全新数据目录 + 随机回环端口 + `RELAYBOARD_RUNNERS=0`，不触碰 4317 原库。
2. 完整链路保持：`work_start → recover → progress → step → verify → submit → task → 独立 review → task`，
   执行 Run 与独立 review Run 不同，最终 `done` 且 review accepted。
3. 协议减负生效：action 视图下执行段 6 次调用（比 P0 full 的 7 次少 1 次 work_next 刷新），
   `omissions/references/dependency_page/request_page` 仍强制补读，无旁路。
4. 恢复、失败修复、接手、scope 失效、重启 unknown/held、stdio 同库重开均有原始日志与退出码。
