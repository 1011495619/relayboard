# RB-007 · 端到端交付演练与回归证据（final-validation）

测量时间：2026-10-26（UTC 时间戳见证据文件）。本任务只验证与收集证据，不修改产品源码；
产品缺陷返回实现任务，不在验收任务中顺手修复。本文件记录实际接收、演练执行、证据与剩余边界。

## 1. 接收基线与工作区指纹

- 主目录 dev HEAD：`23ea86e3e0a8be355ef9195da56078e49962ad47`（`23ea86e feat(ui): 补齐交付证据与待决事项界面`，其上为 `08cadb7` 接收原 UI）。
- 工作区未提交改动：仅 `package.json`（用户 `packageManager` 字段，未动）与 `.impeccable/`（原 UI 证据，未动）。
- 本任务 worktree：`.relayboard/worktrees/rb007`（`git worktree add --detach … dev`，HEAD 同 `23ea86e`），`node_modules` 软链主目录；worktree 内只新增 scope 四文件。
- 契约文档 SHA 与决定 `dec_32ee0a1c90ee4038` 一致：
  - `docs/evolution/contracts.md`：`0797309835389a75ab0a3da9f88afee72386ff92834d54b19a43e31179f558e1`
  - `docs/evolution/acceptance-matrix.md`：`21e62191ae4a5e5f1212bac51126ed27207f4fbf2f7cace9d48974d720d779f6`
  - `docs/evolution/baseline.md`：`c5cdfcd980d54df7076f0a6608191a8268a64fe2d5fbab18ad765ed6607f4f26`
- RB-005 交付 `daily-workflow.md` SHA：`6ae11d586341350946f59ed53772237352391d77f485d2cff07db4fa456fe9f5`
- RB-006 交付 `delivery-ui.md` SHA：`5270b8aed5fc33dcf3565d95469e2bbab74a92f1250b4b5dcb6d0d70d0238508`
- 依赖收据（按服务 revision 回填）：RB-002 `d4ed41b5…`、RB-003 `787ba98f…`、RB-004 `1f7ad889…`、
  RB-005 `fb10baf1…`、RB-006 `aed01724…`，全部 status=done。
- 运行时：Node.js `v24.22.1`，npm `11.19.1`，macOS；4317 生产服务未重启、未改原库。

## 2. 交付物与验证命令

新增（scope 内）：

| 文件 | SHA-256 |
| --- | --- |
| `scripts/evolution-smoke.ts` | `2867ec18c0a2512a6c87a1f829d680314b9f4b3b51468a5c2f1f6bae4a42745d` |
| `tests/evolution-e2e.test.ts` | `ba20be9390844f701d6f57ca746773c7145c9427949d442290578b4e61b0abc8` |
| `docs/evolution/metrics.md` | `e891375b0cffff960fd64a724f5775abe692e7bf371ce3646bb79feede9880a6` |
| `docs/evolution/final-validation.md` | 本文件（自指，SHA 随内容变化） |

- `npm run check`（typecheck + build + test）：退出码 `0`，153 pass / 0 fail / 0 cancelled / 0 skipped。
  原始日志 `.relayboard/rb007-evidence/final/npm-run-check.log`。
- `git diff --check`：退出码 `0`，无空白错误。日志 `.relayboard/rb007-evidence/final/git-diff-check.log`。

## 3. 演练场景执行结果（对照验收矩阵）

可复跑命令（worktree 内先 `npm run build`）：

```bash
node --import tsx scripts/evolution-smoke.ts \
  --repo /Users/ansheng/Desktop/project/relayboard/.relayboard/worktrees/rb007 \
  --output-root /Users/ansheng/Desktop/project/relayboard/.relayboard/worktrees/rb007/.relayboard/rb007-evidence
```

| 验收点 | 场景 | 实际结果 |
| --- | --- | --- |
| A007-2 任务领取和执行 | s1 HTTP MCP：work_start(action)→recover→progress→step→verify→submit→task→独立 review→task | 最终 `done`，review accepted，执行段 6 次调用，owner/epoch/reviewer 分离 |
| A007-3 stdio 同库 | s4 stdio MCP 读同一隔离库 `relay_task` | 与 HTTP 同库，63 工具，任务状态一致 `done` |
| A007-4 失败后修复 | s2 fail(exit 3)→pass(exit 0) | 失败历史保留（2 条），最新 succeeded，失败从未改写 |
| A007-5 已知停止接手 | s7 task_handoff + work_takeover | 新 Run 接手（claim_epoch 1→2），旧 epoch 写入 `STALE_CLAIM` 拒绝 |
| A007-5/8 未知进程占用 | s6 running→服务重启→unknown+held | 再次 start `VERIFICATION_UNKNOWN` 阻断；confirmed_stopped reconcile 后 released |
| A007-7 scope 内/外变化 | s3 外变化→current；内变化→stale | 外变化不误失效，内变化 `scope_changed_after_run` |
| A007-8 旧数据重开 | s5 服务重启后读同一 task | 旧数据保留，task 仍 `done` |
| A007-10 同口径测量 | metrics.md | 调用数、恢复时间、人工介入 0、返工 0、unknown 明确 |
| A007-11 npm run check / git diff --check / smoke | 全绿 + 可复跑脚本 | 153/153、diff --check 0、smoke exit 0 |

回归测试 `tests/evolution-e2e.test.ts` 覆盖上述 A007-4/5/7/8/2/3 的确定性版本（node:test），
全部通过并纳入 `npm run check`。

## 4. 浏览器证据

- 服务：`PORT=4318 RELAYBOARD_RUNNERS=0 node lib/bin/relayboard.js start --data-dir <smoke 数据目录> --no-open`（未触碰 4317 原库，日志 `.relayboard/rb007-evidence/browser-service.log`）。
- 浏览器：真实 Chromium `155.0.8059.85`（REA Playwright scenario capture，headless），浅色桌面 1280×720。
- 截图（已保存，SHA-256 记录）：

| 证据文件 | 场景 | SHA-256 |
| --- | --- | --- |
| `.relayboard/rb007-evidence/board-light-desktop-screenshot.png` | 首页关注事项 | `95cdd2537b0f3515971561db0984c5b253258a63fa0175f0a9385700a1a17758` |
| `.relayboard/rb007-evidence/task-detail-light-desktop-screenshot.png` | 任务详情「交付证据与待决事项」 | `93d996fd802ad5c9937c8d490c9906f62274a6f77a7397f2c3b9dbcc74705230` |

任务详情 DOM 已核对包含：`交付证据与待决事项`、`服务执行结果未知`（unknown/held）、
`服务执行通过`/`服务执行失败`（历史）、`证据已过期`/`证据有效性未知`（stale/unknown）、
`打开日志`、`验证配置与可用 profile`、`查看接手包`。本会话模型无图像输入，像素级人工查看
由协调者最终复验完成（与 RB-006 边界一致）。

## 5. 真实厂商模型条目

| 客户端 | 版本 | 实际结果 |
| --- | --- | --- |
| 未执行 | 未执行 | **未执行**：本任务未启动任何真实厂商模型；smoke/测试全部使用受控进程与受控 QA 身份，`RELAYBOARD_RUNNERS=0`，0 模型调用。受控进程结果不冒充真实模型。 |

## 6. 产品缺陷

本次演练未发现需退回实现任务的产品缺陷。脚本修正均属于测试夹具自身
（profile 参数传递、每次 work_report 后刷新 handle、handoff 后刷新 version），不是产品修复。

## 7. 剩余边界

- 真实厂商模型实测：未执行（等用户安排）。
- 浏览器像素级人工查看与 390px 明暗全量核验：RB-006 已覆盖 390px 明暗与桌面；RB-007 按
  任务要求补齐一张关键界面截图 + 任务详情 DOM 证据，像素级复核留待协调者最终复验。
- 仓库外 `relayboard-evidence/` 本次执行环境不可写，证据保存在 worktree 内
  `.relayboard/rb007-evidence/`（gitignore），由 Lead 决定是否归档到仓库外目录。
- 本任务不自审：submit 不等于验收，最终验收由协调者独立完成。
- 字符/耗时口径差异见 `metrics.md` §3：RB-007 以每次 CLI 进程冷启动测量，不与 P0 长连接
  客户端的字符数直接等同；调用数同口径可比较（执行段 6 vs 7）。

## 8. 最终边界声明

实际执行环境：macOS / Node v24.22.1 / npm 11.19.1，worktree detached `23ea86e`。
精确成果 revision：worktree 内四个未提交新文件（SHA 见 §2），未提交、未推送、未改产品源码。
测试命令与退出码：`npm run check`=0（153/153），`git diff --check`=0，smoke=0。
范围外改动：无（未修改任务 scope 外任何文件；未动 `package.json`、`web/`、4317 原库）。
未执行场景：真实厂商模型实测；浏览器像素级人工查看。
仍需凭据/真实客户端的边界：真实厂商模型需用户另行安排并登录对应客户端。
