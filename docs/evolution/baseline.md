# 第一阶段交付基线

测量时间：2026-10-25（UTC 时间戳见各证据文件）。本文件只记录本次实际观察，不把历史验证当作当前结果。

## 1. 源码与运行现场

| 项目 | 本次观察 |
| --- | --- |
| 源码目录 | `/Users/ansheng/Desktop/project/relayboard` |
| 分支 / HEAD | `dev` / `aab41b43fd62e1a34d4063981c7d67b34f0c5d56` |
| 包版本 | `0.7.0` |
| 运行时 | Node.js `v24.22.1`，npm `11.19.1`，macOS |
| 4317 服务 | `node lib/bin/relayboard.js start` 正在监听 `127.0.0.1:4317`；本次未重启、未修改原 SQLite |
| Git worktree | 仅当前主 checkout；没有另建命名分支或临时 worktree |
| 当前写入 | 12 个已跟踪文件有修改，另有 UI 测试、组件、库和 `.impeccable/` 未跟踪内容；均保留 |

本次执行 Run 为 `run_0b0d87c476e54cb0`，只写 RB-002 指定的三份 `docs/evolution/` 文档。`npm run check` 会重建已被 Git 忽略的 `lib/`、`dist/`，不改动既有源码。

## 2. 未提交成果来源与归属

归属依据是 Relayboard 当前任务、Run 和提交记录，不是把未提交内容猜成 Git 提交。

- 原 UI 任务 `tsk_530a8ebb8d4c44db` 当前为 `review`，版本 39，负责人 `run_8d82055c32f3451d`；该 Run 已 `ended`，任务验证快照为 `evd_6943bc28683746df`。
- 当前 UI 任务说明保留了旧 `RB-003`，没有接管或改写旧任务。其交付记录声明：源码留在 `dev` 未提交工作区，未推送或发布。
- 同一 UI 任务的前序 Run `run_c50b349c1b814216`、`run_ddfe07212e674cbb`、`run_f4c6f50e49cf44dc` 以及最终 Run 均已结束。本次没有据此推断其他未知进程停止，只确认这些登记会话的状态和当前观察到的 4317 服务进程。
- `package.json` 相对 HEAD 只增加用户的 `packageManager: pnpm@10.12.4+sha512...` 字段；必须保留。
- Web 修改和未跟踪测试/组件对应当前 UI 待验收成果。`.impeccable/implementation/` 保存其浏览器截图、检查日志、验证说明与哈希。历史 114/114 仅是原任务自报；本次独立复跑结果见下节。
- RB-002 没有提交、移动或覆盖上述任何成果，也没有把运行数据库、凭据或个人日志加入 Git。

## 3. 仓库外可恢复副本

证据根目录：

`/Users/ansheng/Desktop/project/relayboard-evidence/evolution-rb002/20261025T164011Z`

包含：

- `manifest.json`：HEAD、分支、20 个 porcelain 状态条目、60 个实际文件的大小和 SHA-256。
- `worktree-tracked.patch`：`git diff --binary HEAD` 的已跟踪改动补丁。
- `wip-files.zip`：全部已修改/未跟踪实际文件（含未跟踪目录）及 manifest。
- `git-status.porcelain.z`：原始 NUL 分隔状态。
- `SHA256SUMS`：上述四个文件的 SHA-256。

恢复前必须先审查新版本，不可盲目覆盖。ZIP 已实际重新打开，`testzip()` CRC 检查通过；压缩包内 60 个文件逐一与备份前 SHA-256 比对一致。`shasum -a 256 -c SHA256SUMS` 四项均为 `OK`。

## 4. 当前完整检查

命令：`npm run check`
退出码：`0`
日志：`npm-run-check.log`（位于上述证据根目录）

实际结果：服务端、网页和测试严格 TypeScript 检查通过；server 编译和 Vite 生产构建通过；`114` 项测试，`114 pass / 0 fail / 0 cancelled / 0 skipped`，测试耗时约 `2933 ms`。这是对当前 HEAD 加未提交 UI/package 改动的本次复跑，不是转述原 UI 任务报告。

## 5. 隔离 HTTP MCP 流程基线

### 隔离与边界

- 使用编译后的当前工作区服务、随机空闲回环端口和独立空数据目录；`RELAYBOARD_RUNNERS=0`。
- 没有使用 4317 原数据库，没有启动厂商模型，没有人工介入；QA Run 均为受控测试身份。
- 原始结果：`mcp-baseline/result.json`；服务日志：`mcp-baseline/service-attempt2.log`；脚本控制台：`mcp-baseline/run-attempt2.log`。
- 隔离数据：`mcp-baseline/data-attempt2/`。任务最终实际为 `done`，执行 Run 与独立 review Run 不同。

### 完整链路

真实 Streamable HTTP MCP 调用完成：

`work_start → work_next → report(recover) → report(progress) → report(step) → report(verify) → report(submit) → task → 独立身份 task_review → task`

从 `work_start` 到最终确认共 10 次工具调用，响应合计 `175326` 字符，观测到的请求耗时合计约 `370 ms`。其中从 `work_start` 到 `submit` 为 7 次调用、`55101` 响应字符。整个测量含建项目、3 个 Run、建任务和一次 `tools/list`，总计 16 次 JSON-RPC（15 次工具调用）、`238232` 响应字符；这些总数包含准备开销，不能与后续只测执行路径的数字混用。

恢复耗时定义为脚本从 `work_start` 返回后，执行一次 `work_next` 并提交 `recover` 的墙钟时间：`20.155 ms`。它不包含人阅读契约、检查文件或模型推理时间，不代表真实 Agent 恢复耗时。后续对比必须复用相同夹具、调用序列和统计边界，分别报告准备/执行/验收开销。

### 失败尝试

第一次在只读任务上同时申请 `scopes:["README.md"]`，服务正确返回 `READ_ONLY_SCOPE`，流程在建任务处停止；该数据目录保留为 `mcp-baseline/data/`，没有重放写入。第二次改为只读且不申请写入 scope，并使用新的 `data-attempt2` 后通过。这是测试夹具修正，不是产品缺陷修复。

## 6. 已有能力与真实模型证据边界

- 当前已有：原子领取与 epoch、依赖独立验收、scope 内容指纹、完整当前验证集合及不可变历史、显式 review 身份、恢复步骤和契约分页、进程 unknown 保守处理、持久预算/冷却、关联通知闭环。
- 当前 `WorkspaceEvidence.verification_source` 仍为 `agent_reported`；服务观察 Git 内容不等于服务运行测试。第一阶段的 RB-003 应增加独立的服务执行记录，而不是篡改这个字段的含义。
- `VALIDATION.md` 的 0.6.1 后续记录表明真实 Codex 曾完成完整接手续跑；早期 `session_state_unsupported` 和 pi `Connection error` 保留为历史边界。0.7.0 的 111 项记录属于当时实现者自检，本次 114 项才是当前基线。
- 本次没有新增 Codex、Claude、pi 或其他厂商模型调用，也没有扩大真实客户端覆盖。受控 MCP 成功不得写成真实模型成功。

## 7. 后续实施基线约束

1. RB-003/RB-004 在 RB-002 验收后接收本基线与契约的精确成果；共享类型和 schema 按契约单写者交付。
2. 保留现有验证提交门槛、独立 review、epoch、预算、unknown 进程和范围守卫。服务退出 0 不自动提交或验收任务。
3. 所有新测试使用独立数据目录；不重启 4317、不启用自动付费派发、不发布。
4. RB-005 用第 5 节同夹具比较，至少减少一个真实重复维护动作，同时保留补读、依赖接收和陈旧 handle 检查。
5. RB-006 接收当前未提交 UI，不重做整站；RB-007 最后复验 HTTP 与 stdio MCP、旧数据重开和最终独立验收。
