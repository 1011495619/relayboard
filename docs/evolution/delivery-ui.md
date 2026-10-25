# RB-006 · 交付证据与待决事项界面

测量时间：2026-10-25/26（UTC 时间戳见证据文件）。本文件记录 RB-006 对 `dev` 工作区未提交 UI 的实际接收与交付界面增量，不把历史验证当作当前结果。

## 1. 接收基线：旧 UI 成果与差异来源

按 `docs/evolution/baseline.md` §2/§3 和接手包要求，RB-006 未创建 worktree，直接在主目录 `dev` 工作区继续，原样保留以下未提交成果（归属旧 UI 任务 `tsk_530a8ebb8d4c44db`，状态 review，负责人 Run 已 ended）：

- 已跟踪修改（相对 HEAD `9122bff`）：`package.json`（仅 `packageManager` 字段）、`web/src/components/{agent-catalog,agent-icon,attention-view,project-memory,supervisor-view,ui/badge,ui/button,ui/card,ui/dialog}.tsx`、`web/src/main.tsx`、`web/src/style.css`。
- 未跟踪：`.impeccable/implementation/`（旧 UI 浏览器截图/检查日志/验证说明与哈希，四个子目录 2026-10-25-{ui,radius,pages,ai-color}）、`tests/ui-workspace.test.ts`、`web/src/components/{long-text,page-refresh,project-switcher,task-status}.tsx`、`web/src/lib/{project-preferences,task-attention}.ts`。

RB-006 只在 scope 文件上叠加，未改动上述任何无关组件、未改 `package.json`、未提交 `.relayboard` 运行时数据。`attention-view.tsx`、`execution-guide.tsx`、`task-reliability.tsx` 保持接收时状态；项目切换、圆角、品牌与布局优化全部保留，未做整站重排。

## 2. 最终服务契约与状态语义

契约：`evolution-v1`，当前权威决定 `dec_32ee0a1c90ee4038`（取代 `dec_f624903eab5c4c6a`）。三份文档 SHA-256 与决定一致：

- `docs/evolution/contracts.md`：`0797309835389a75ab0a3da9f88afee72386ff92834d54b19a43e31179f558e1`
- `docs/evolution/acceptance-matrix.md`：`21e62191ae4a5e5f1212bac51126ed27207f4fbf2f7cace9d48974d720d779f6`
- `docs/evolution/baseline.md`：`c5cdfcd980d54df7076f0a6608191a8268a64fe2d5fbab18ad765ed6607f4f26`

UI 只消费已验收接口，不推断进程退出或证据有效：

| 页面状态 | 数据来源 | 显示/动作 |
| --- | --- | --- |
| 自报通过/失败 | `task.verification` | 明确「Agent 自报」、命令、结果；不冒充服务验证 |
| 服务执行中/排队 | `service_verification.status=running/queued` | profile、requested_at/started_at、日志入口；不显示通过 |
| 服务失败/超时/停止/启动失败 | 对应终态摘要 | 退出码/信号或错误、日志、重新验证入口；不等于任务失败或已验收 |
| unknown | 执行或进程 unknown | 原因与核实动作；非绿色成功语义 |
| stale | `freshness.reasons` | 逐项显示 scope/dependency/profile/owner 等过期原因及重新验证 |
| current | 服务 succeeded 且 current | 标明「服务执行」+「仍待独立验收」，显示 profile/version/时间与日志 |
| 待验收/已验收 | `task.status`/`task.review` | 提交与验收分开，显示 reviewer Run 或 human_review |
| 恢复诊断 | `Run.diagnosis`/incident | 分类、置信度、证据、next_action；告警解除不写成接手成功 |

字段映射与状态文案集中实现在 `web/src/types.ts` 的纯运行时函数（供组件与测试共用）：`serviceStatusLabel/serviceStatusTone`、`freshnessStateLabel/freshnessStateTone/freshnessReasonLabel`、`diagnosisCategoryLabel/diagnosisConfidenceLabel`、`deliveryPhase`。

## 3. 实现增量

只写 scope 内文件：

- `web/src/types.ts`：新增 `VerificationExecutionStatus/VerificationExecution/VerificationFreshness/VerificationSummary/VerificationProfilesView/VerificationHistoryView/VerificationLogView/RuntimeDiagnosis` 类型转发，及上述纯映射函数。
- `web/src/components/verification-panel.tsx`（新增）：`VerificationPanel`（交付阶段、Agent 自报、服务执行摘要与日志、profile 发现、执行历史、恢复诊断、失败尝试/待核实操作）、`DiagnosisBlock`、内部 `LogViewer/Profiles/History`。日志只通过 `verification_log(execution_id,cursor,limit)` 读取，配置只通过 `verification_profiles`，不读任意本机路径。
- `web/src/main.tsx`：任务详情抽屉接入 `VerificationPanel`（loader 全部走 `query("verification_*")`，重新验证走 `command("verification_start")` 且仅当前 owner 可见），原「成果与当前验证集合」改为「交付成果」避免重复展示。
- `web/src/components/supervisor-view.tsx`：incident 卡片渲染 `DiagnosisBlock`；`resolved` 状态追加「告警解除只说明告警状态变化，不等于恢复、接手或验收成功」。
- `tests/ui-delivery.test.ts`（新增）：对上述纯映射做行为测试。
- `docs/evolution/delivery-ui.md`：本文件。

`attention-view.tsx`、`execution-guide.tsx`、`task-reliability.tsx` 未改动。

## 4. 验证

### 4.1 npm run check

命令：`npm run check`（typecheck + build + test）
退出码：`0`
原始日志：`.relayboard/rb006-evidence/npm-run-check.log`

实际结果：服务端、网页和测试严格 TypeScript 检查通过；server 编译与 Vite 生产构建通过；`148` 项测试 `148 pass / 0 fail / 0 cancelled / 0 skipped`（含本次新增 4 项 `tests/ui-delivery.test.ts`）。

### 4.2 隔离数据目录浏览器实测

- 独立服务：`PORT=4318 RELAYBOARD_DATA_DIR=.relayboard/rb006-evidence/data RELAYBOARD_RUNNERS=0 node lib/bin/relayboard.js start`（未触碰 4317 原库，服务日志 `.relayboard/rb006-evidence/isolated-service.log`）。
- 构造数据：`prj_ab88c4aa842649b0`、Run `run_fa4e65abe8fc4138`、任务 `tsk_8efdcb50a3394682`（scope `scope.txt`）；`verification-profiles.json` 配置 `pass`（exit 0）与 `fail`（exit 3）两个 profile。
- 服务执行：`fail` 执行 `vex_8cb5e145000e4041` 终态 `failed`/exit 3、freshness `stale:not_passed`；`pass` 执行 `vex_fccb057130b947b9` 终态 `succeeded`/exit 0、freshness `current`。历史中同时可见成功与失败两条记录。
- 浏览器：真实 Chromium `155.0.8059.85`（Playwright launch，headless），操作序列 `goto → 点击任务行打开详情 → 截图`。

| 证据文件 | 场景 | 尺寸 |
| --- | --- | --- |
| `task-detail-light-desktop-4-screenshot.png` | 桌面 1280×720 浅色，任务详情「交付证据与待决事项」 | 1280×720 |
| `task-detail-light-mobile-4-screenshot.png` | 390px 浅色，任务详情 | 390×844 |
| `task-detail-dark-mobile-4-screenshot.png` | 390px 深色，任务详情 | 390×844 |
| `home-light-desktop-0/1/2-screenshot.png` | 桌面浅色首页（关注事项） | 1280×720 |

桌面浅色详情 DOM 已核对包含：`交付证据与待决事项`、`执行中`、`Agent 自报验证 · 0 项`、`服务执行验证 · 服务执行通过 · v1`、`服务亲自执行`、`仍待独立验收`、`证据当前有效`、`服务执行历史`（`服务执行通过`+`服务执行失败`/`证据已过期`）、`验证配置与可用 profile`。DOM 文本核对由 RB-006 执行者完成。

## 5. 剩余边界

- 本会话模型无图像输入，截图已生成并保存为 PNG（尺寸/哈希如上），像素级人工查看由独立验收完成；DOM 文本证据见 §4.2。
- `unknown`/`held` 与六类诊断的分类、文案由 `tests/ui-delivery.test.ts` 覆盖纯映射；浏览器端未逐一构造真实 running/unknown 进程场景（构造需要中途重启服务/派生存活后代，受 `ps` 沙箱限制未复现），属剩余边界。
- `main.tsx`、`supervisor-view.tsx` 相对 HEAD 的 diff 还包含旧 UI 未提交改动；RB-006 增量以本文件 §3 说明为准，完整上下文 diff 与新增文件内容见工作区与 `.relayboard/rb006-evidence/rb006-changes.patch`、`rb006-file-sha256.txt`。
- 未执行：真实厂商模型实测、发布、4317 重启；提交不等于验收，最终验收由协调者独立完成。
