# 第一阶段验收矩阵

通用要求：每项都由非执行 Run 或明确人工身份独立验收；提交不等于验收。实现者提供精确 commit 或可恢复补丁、实际命令与退出码、原始日志和剩余边界。测试服务使用独立数据目录与受控进程，不触碰 4317 原库，不启动付费模型。每项最后运行 `npm run check`；协调者接收后还要在 `dev` 复跑。

证据目录沿用仓库外 `relayboard-evidence/evolution-<任务>/`，数据库用 SQLite 备份或测试临时目录，不把运行数据、凭据和个人日志提交 Git。

## RB-002 · 基线与契约

| ID | 操作 | 通过条件 | 本次证据 |
| --- | --- | --- | --- |
| A002-1 | 读取 `git status`、worktree、HEAD、原 UI 任务与 Run | 来源、归属、未提交状态和写者边界可追溯 | `baseline.md` 1～2 节 |
| A002-2 | 保存 tracked patch、全部修改/未跟踪文件快照并重新读取 | ZIP CRC、60 文件哈希、4 项 SHA256SUMS 全通过 | `20261025T164011Z/manifest.json`、`wip-files.zip`、`SHA256SUMS` |
| A002-3 | 当前工作区运行 `npm run check` | 退出 0；类型/构建通过；114/114 | `20261025T164011Z/npm-run-check.log` |
| A002-4 | 用仓库外持久 v2 脚本在两个全新目录执行 HTTP MCP recover→progress→step→verify→submit→独立 review，并复用已有目录名 | 两次最终 done、review Run 不同、脚本 SHA 一致；旧目录拒绝覆盖且原结果哈希不变；记录调用/字符/人工介入/恢复口径 | `replay/mcp_baseline.py`、`replay/replays/replay-{a,b}/result.json`、`no-overwrite.console.log` |
| A002-5 | 审阅三份文档和契约 decision | 字段、状态/错误、来源/失效、重启/旧库、配置、文件所有者及后续场景无缺口 | 本文、`contracts.md`、契约 decision ID |

## RB-003 · 服务执行验证

前置：RB-002 已验收，契约与基线精确成果已进入执行 worktree。

| ID | 场景与操作 | 通过条件 |
| --- | --- | --- |
| A003-1 | 旧 0.7 数据副本重开；读取旧 task、verification、evidence_history | 原记录不变；新 `service_verification=null`、历史空页；现有测试回归通过 |
| A003-2 | 调用 profile 发现后配置 `check`，通过 MCP 仅传 `profile_id` 启动 | 发现接口返回实际配置路径、可用ID/摘要；实际 spawn 参数为配置的 command/args/cwd，不经过 shell；记录 profile 摘要和来源 |
| A003-3 | 受控命令退出 0 | 终态 succeeded、exit_code=0、起止时间/cwd/日志/前后指纹完整；task 不自动 review/done |
| A003-4 | 受控命令退出非 0 | failed 且保留退出码和日志；任何视图不显示通过 |
| A003-5 | 直接子进程派生后代并超过测试 timeout | 向进程组请求终止并核实可观察后代；未确认全退出则 timed_out/unknown + held，不得释放占用或写成 stopped |
| A003-6 | 长运行中显式 stop，分别覆盖全退出和后代仍存活 | 全退出才 stopped/released；仍有后代或结果不确定则 unknown/held，signal/exit 信息真实 |
| A003-7 | 不存在可执行文件、损坏 JSON、非法 cwd/profile；调用 profile 发现 | start 给对应结构化错误；发现接口仍返回实际路径、valid=false/可用ID及修复信息，不创建假通过证据 |
| A003-8 | 输出超过小上限 | 进程终态准确，log 有界且 `output_truncated=true`，日志 SHA/字节数一致 |
| A003-8a | 用 execution_id 分页读取含中文/emoji及非法UTF-8的日志；覆盖运行中、capture截断和终态 | 只按ID读取；游标不切断码点、非法字节replacement可计数；运行中complete=false，capture缺失持续可见，终态完整EOF才complete=true |
| A003-8b | 跨execution/篡改游标、任意路径输入、日志删除/不可读、无令牌或跨项目读取 | 分别拒绝cursor/path/鉴权；丢失返回VERIFICATION_LOG_UNAVAILABLE而非空成功，执行历史保留 |
| A003-9 | 执行中修改 scope 内文件，退出 0 | freshness=stale，含 `scope_changed_during_run`，不得 current |
| A003-10 | 成功后修改 scope 外文件或仅产生无关 HEAD 变化 | scope 内容未变时证据仍 current；revision 仅作来源 |
| A003-11 | 成功后修改 scope 内文件 | stale + `scope_changed_after_run`，列出变更原因 |
| A003-12 | 成功后变更依赖 receipt、profile 或 owner/epoch | 分别得到 dependency/profile/owner 失效原因；旧执行历史仍可查 |
| A003-13 | 运行中关闭并重开服务/数据库，未reconcile直接start | 记录转unknown + reservation held，不能变succeeded；再次start/同目录交接与冲突写入被阻断 |
| A003-13a | 服务异常退出但保留真实受控旧检查及后代存活，再启动服务 | 核实前旧检查仍只运行一份，无重复执行/冲突写入；历史始终unknown，绝不伪装stopped |
| A003-13b | confirmed_stopped与isolated两种reconcile，含旧version、错误owner、幂等重放 | 确认停止需实际后代证据和confirmed_stop；隔离需不同realpath且旧目录仍held；均留审计，旧历史不变，新执行新ID |
| A003-14 | 同 request_id 同参数重试；同 ID 不同参数；并发启动两个检查 | 首种返回原记录；次种幂等冲突；并发只一个运行，另一个 VERIFICATION_RUNNING |
| A003-15 | 非 owner、旧 epoch、跨项目读取或越权 stop | 既有归属/epoch/项目守卫拒绝；无状态篡改 |
| A003-16 | HTTP MCP 与 REST 各执行profile发现、启动/详情/日志读取，重开库分页历史 | 两入口领域语义和鉴权一致；Agent自报和服务执行来源分别展示/读取，摘要有开始时间/version/profile摘要 |
| A003-17 | `npm run check` | 全绿；新增测试覆盖以上行为而非只测类型 |

## RB-004 · 恢复诊断

前置：RB-002 验收；共享诊断类型已由 RB-003 按契约提供。所有付费启动位置用受控 runner 替身，测试不调用模型。

| ID | 场景与操作 | 通过条件 |
| --- | --- | --- |
| A004-1 | 注入明确未登录/凭据失效结构化错误 | authentication、有证据和登录动作；不自动重试、不改变任务归属 |
| A004-2 | 注入连接/超时/限流暂态错误 | transient；重试只按原冷却和预算，成功恢复不清空任务事实 |
| A004-3 | 工具审批、文件/终端权限拒绝 | permission；提示客户端权限，服务不修改全局配置 |
| A004-4 | 命令缺失、非法 cwd/profile、不支持 runtime | configuration；指向真实配置，修正后 preflight 才通过 |
| A004-5 | 服务重启留下 running 记录、启动结果未知 | process_unknown/unknown；旧占用保留，禁止自动交接或重复启动 |
| A004-6 | 无法分类的原始退出/矛盾证据 | unknown + low confidence + inspect；不得猜测 |
| A004-7 | 重复巡视与多次重启 | 不重复消费预算；项目总次数、每任务次数、冷却持久化 |
| A004-8 | 已结束旧 Run 显式接管，随后旧 epoch 写入 | 新 Run recover 后可继续；旧 epoch 拒绝；诊断不代替接管核验 |
| A004-9 | 活跃子任务、同 workdir 未确认停止、scope 冲突 | 原守卫全部阻断；诊断 next_action 不绕过守卫 |
| A004-10 | 协调者等待子任务、任务等待依赖、声明 wait | 不误判停滞；告警解除不显示接手成功 |
| A004-11 | 模型恢复、进程退出0、任务无报告 | 仅相应告警/进程状态变化；任务不自动进展、提交或验收 |
| A004-12 | `npm run check` 及既有 runner/supervisor/scheduler 回归 | 全绿；原错误正文和日志仍可追溯 |

## RB-005 · 日常协议减负

前置：RB-003/004 已验收并接收精确成果。使用 RB-002 的仓库外持久 v2 隔离夹具、脚本哈希和相同统计边界。

| ID | 场景与操作 | 通过条件 |
| --- | --- | --- |
| A005-1 | 以 full 模式重跑基线流程 | 与 0.7 返回语义兼容；记录准备/执行/验收调用和字符 |
| A005-2 | 以 action 模式执行同流程，report 后直接采用下一 handle | 不额外纯刷新 work_next；至少减少一个重复维护动作；返回字段足够继续 |
| A005-3 | 比较同夹具 full/action | 报告调用数、响应字符、人工介入、漏读/漏报；不把字符当 token |
| A005-4 | action 响应含省略契约、分页依赖和请求 | omissions/references/page 完整；调用方仍须补读，服务不伪报已读 |
| A005-5 | 旧 task_version/context/epoch handle 重放 | 拒绝并给出 work_next 修复动作；不能静默成功 |
| A005-6 | 依赖在另一 worktree 仅声明未接收 | recover 不得伪造 receipt；实际接收后才通过 |
| A005-7 | 旧负责人未处理请求跨交接 | 新指南仍返回；ack 与 resolve 分离，处理后保留结论 |
| A005-8 | 复杂有序任务、blocked/wait/verify/submit/review | 原状态机和独立验收不变；action 不成为旁路 |
| A005-9 | `relay_api`、doctor、CLI、HTTP guided/stdio 示例 | schema 可发现、提示准确、最短示例真实可运行 |
| A005-10 | `npm run check` | 全绿，Skills/CLI/README 无旧协议教学 |

## RB-006 · 交付界面

前置：RB-005 验收；原 UI 成果由协调者确认接收，最终服务契约可读取。

| ID | 场景与操作 | 通过条件 |
| --- | --- | --- |
| A006-1 | 构造 Agent 自报通过但无服务执行 | 明确“Agent 自报”，不冒充服务验证 |
| A006-2 | 构造服务 running/succeeded/failed/timed_out/stopped/start_failed/unknown | 每种状态文案、颜色、日志和动作符合契约；unknown/held非成功，开始时间/version/profile摘要直接来自summary |
| A006-2a | 打开profile配置/错误和日志分页；覆盖运行中、截断、多字节、丢失与刷新 | 使用verification_profiles和verification_log，不读任意路径；配置错误可操作，日志完整性与加载状态准确 |
| A006-3 | 构造 scope/dependency/profile/owner 失效 | 显示具体 stale 原因和重新验证；current 仍待独立验收 |
| A006-4 | 提交后未 review 与独立 review 后 | 明确待验收/已验收及 reviewer；提交不冒充验收 |
| A006-5 | 六类诊断和告警解除 | 分类、置信度、证据、next_action 可见；不显示虚假接手成功 |
| A006-6 | 12 个既有页面手动刷新并编辑/筛选 | 筛选、tab、展开和编辑状态保留；失败可重试 |
| A006-7 | 1440px 桌面及 390px，明暗主题 | 实际浏览器操作，无页面横向溢出；长日志/错误可读；截图已查看 |
| A006-8 | 对比原 UI 备份和当前差异 | 项目切换、圆角、品牌、布局成果均保留，无重复整站改版 |
| A006-9 | `npm run check` 与 UI 行为测试 | 全绿，保存浏览器网络/布局/截图证据 |

## RB-007 · 端到端交付演练

前置：全部实现任务独立验收，精确成果串行进入本 worktree；本任务只验证和报告，产品缺陷退回实现任务。

| ID | 场景与操作 | 通过条件 |
| --- | --- | --- |
| A007-1 | 记录 HEAD、工作区指纹、Node/客户端、隔离数据与依赖 receipts | 全部交付精确可复现，无未声明源码差异 |
| A007-2 | HTTP MCP 从领取到独立验收 | 实际状态、owner、epoch、reviewer 和证据正确 |
| A007-3 | stdio MCP 重开同一隔离库执行只读/报告链路 | 与 HTTP 共享同一数据，协议兼容，无第二数据库 |
| A007-4 | 服务验证失败后修复再运行 | 失败历史保留，新执行真实通过；失败从未被改写 |
| A007-5 | 已知停止后新 Run 接手；未知旧进程场景 | 前者 recover 后继续且旧 epoch 失效；后者保留占用 |
| A007-6 | 子任务验收后精确集成 | 依赖 receipt 指向实际接收 revision，协调者复跑集成检查 |
| A007-7 | scope 内/外内容分别变化 | 内变化失效、外变化不误失效；依赖和 profile 规则同时成立 |
| A007-8 | 旧 0.7 数据重开、服务重启、执行中重启 | 旧数据保留；执行中记录 unknown；无假通过/重复模型启动 |
| A007-9 | 完整浏览器桌面/390明暗、刷新与日志操作 | 证据和诊断可判断，截图已查看，无横向溢出 |
| A007-10 | 复用 RB-002 同夹具测量 | 调用、恢复、人工介入、返工、可获得成本及 unknown 按同口径比较 |
| A007-11 | `npm run check`、`git diff --check`、可复跑 smoke 脚本 | 全绿；脚本可重复执行且只使用隔离数据 |
| A007-12 | 独立最终审查 | 所有原始日志、版本和剩余边界齐全；真实厂商模型结果单列，未执行项明确 |

## 最终边界声明模板

每项报告必须分别列出：实际执行环境、精确成果 revision、测试命令与退出码、范围外改动（无则写无）、未执行场景、仍需凭据/真实客户端的边界。禁止用“全链路通过”概括未执行的 stdio、真实模型、浏览器或旧数据场景。
