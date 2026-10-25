# 第一阶段最小接口契约

契约版本：`evolution-v1`
适用任务：RB-003～RB-007。实现必须保持现有数据、原子归属、epoch、独立验收、预算和未知进程守卫。本文件冻结接口；实现中发现冲突应报告协调者，不得各任务自行改变含义。

## 1. 共同原则与兼容

1. 现有 `Verification {command,result,passed}`、`Task.verification`、`WorkspaceEvidence.verification_source="agent_reported"` 的语义不变。它们仍是执行者自报。
2. 服务亲自执行的检查进入新的 `verification_execution` 记录和只读视图，来源固定为 `service_executed`。不得把 Git 观察或服务退出 0 改写成任务已验收。
3. 新字段均可选/可空，新记录类型独立迁移；旧数据库没有这些记录时返回 `null` 或空分页，不重写旧 `verification`、`evidence_snapshot`、事件和任务状态。
4. 新服务证据在 v1 不替代现有 `work_report(verify)` 提交门槛。这样旧客户端和旧任务行为不变；是否在未来放宽须另行契约和独立验收。
5. 时间用 UTC ISO 字符串；ID 由服务生成；所有写命令支持 `request_id` 幂等。响应错误沿用 `{code,message,retryable,details?,next_action?}`，不伪造停止、退出或测试成功。

## 2. RB-003：显式验证配置

配置文件：`<data_dir>/verification-profiles.json`。路径由服务显示；不写入源码仓库，不提交令牌或个人数据。每次启动新检查时读取并校验配置，记录其内容摘要；配置变更不影响已保存记录。

```ts
type VerificationConfig = {
  version: 1;
  profiles: Record<string, {
    command: string;             // 单个可执行文件；不经过 shell
    args: string[];              // 原样逐项传递，不插值、不拼接命令
    cwd?: string;                // 默认 "."；相对 Run.workdir，解析后不得越出
    timeout_ms?: number;         // 默认 900000，范围 1000..3600000
    max_output_bytes?: number;   // 默认 65536，范围 1024..1048576
  }>;
};
```

profile ID 须匹配 `[A-Za-z0-9][A-Za-z0-9._-]{0,119}`。配置不得包含环境变量、凭据或任意 MCP 命令参数。服务继承自身环境，但执行记录不导出环境值。`command` 可为 PATH 中名称或本机绝对路径；实际 resolved command、参数和 cwd 均纳入 profile 摘要。缺失、JSON 损坏、越界 cwd 或非法字段拒绝启动。

示例：

```json
{
  "version": 1,
  "profiles": {
    "check": {
      "command": "npm",
      "args": ["run", "check"],
      "cwd": ".",
      "timeout_ms": 900000,
      "max_output_bytes": 65536
    }
  }
}
```

## 3. RB-003：执行记录与 API

### 3.1 持久记录

```ts
type VerificationExecutionStatus =
  | "queued" | "running"
  | "succeeded" | "failed" | "timed_out"
  | "stopped" | "start_failed" | "unknown";

type VerificationExecution = {
  id: string;
  version: number;
  project_id: string;
  task_id: string;
  run_id: string;
  claim_epoch: number;
  request_id: string | null;
  profile_id: string;
  profile_sha256: string;
  command: string;
  args: string[];
  cwd: string;
  status: VerificationExecutionStatus;
  source: "service_executed";
  requested_at: string;
  started_at: string | null;
  ended_at: string | null;
  exit_code: number | null;
  signal: string | null;
  error_code: string | null;
  error_message: string | null;
  log_path: string;
  log_sha256: string | null;
  log_bytes: number;
  output_truncated: boolean;
  workspace_before: WorkspaceEvidence;
  workspace_after: WorkspaceEvidence | null;
  dependency_revisions: Record<string, string>;
  created_at: string;
  updated_at: string;
};
```

日志在数据目录 `verification/<execution_id>.log`，权限遵循现有本机日志； stdout/stderr 保序写入，达到上限后截断并设 `output_truncated=true`，仍继续等待/终止进程。保存完整终态与日志引用，不承诺无限完整输出。进程 PID 可存在于内部运行表，不作为跨重启存活证明。

### 3.2 MCP/REST 共用领域操作

```ts
verification_start({
  task_id: string;
  run_id: string;
  claim_epoch: number;
  profile_id: string;
  request_id?: string;
}): VerificationExecution

verification_stop({
  execution_id: string;
  run_id: string;
  request_id?: string;
}): VerificationExecution

verification_execution({
  execution_id: string;
}): VerificationExecution & { freshness: VerificationFreshness }

verification_history({
  task_id: string;
  execution_id?: string;   // 提供时读取单条完整记录
  offset?: number;         // 默认 0
  limit?: number;          // 默认 10，最大 50
}): {
  items: (VerificationExecution & { freshness: VerificationFreshness })[];
  total: number;
  next_offset: number | null;
}
```

MCP 名称加 `relay_` 前缀。只有任务当前 owner、匹配 epoch 且任务处于可执行状态才能 start/stop；REST 与 MCP 使用同一领域守卫。每任务同时最多一个执行；项目运行数仍受 `max_concurrency` 限制。同一 `request_id` 同参数返回原记录，不同参数报 `IDEMPOTENCY_CONFLICT`；同任务另一运行中报 `VERIFICATION_RUNNING`。

`verification_stop` 只请求停止该执行，观察终态后才写 `stopped`；停止结果不确定写 `unknown`，不得声称成功。`succeeded` 只用于已知退出且 `exit_code=0`；非零为 `failed`，超时为 `timed_out`，spawn/配置失败为 `start_failed`。重启遇到 `queued/running` 一律转 `unknown` 并保留原记录，需要重新执行；v1 不收养旧进程。

### 3.3 新鲜度与任务读取

```ts
type VerificationFreshness = {
  state: "current" | "stale" | "unknown";
  reasons: (
    | "not_passed" | "execution_unknown" | "owner_changed"
    | "scope_changed_during_run" | "scope_changed_after_run"
    | "workspace_unobservable" | "dependency_changed"
    | "profile_changed"
  )[];
  observed_at: string;
};

type VerificationSummary = {
  execution_id: string;
  profile_id: string;
  status: VerificationExecutionStatus;
  source: "service_executed";
  passed: boolean;          // 仅 status=succeeded 且当时退出0
  freshness: VerificationFreshness;
  ended_at: string | null;
  log_path: string;
};

Task.service_verification?: VerificationSummary | null;
Run.diagnosis?: RuntimeDiagnosis | null;
SupervisorIncident.diagnosis?: RuntimeDiagnosis | null;
```

`Task.service_verification` 是该任务最新服务执行摘要，历史由 `verification_history` 分页读取。`freshness=current` 必须同时满足：已知 `succeeded`；任务 owner/epoch 未变；执行前后 scope 指纹相同且当前仍相同；工作区可完整观察；依赖 revision 与当前已接收收据一致；当前 profile 摘要一致。范围内容在执行中变化，即使退出 0 也为 `stale:scope_changed_during_run`。无关 HEAD 变化不影响内容证据。依赖变化、owner/epoch 变化、profile 变化分别给出原因，不能合并成笼统“过期”。

## 4. RB-004：可解释诊断

```ts
type RuntimeDiagnosis = {
  category:
    | "authentication" | "transient" | "permission"
    | "configuration" | "process_unknown" | "unknown";
  confidence: "high" | "medium" | "low";
  summary: string;
  evidence: string[];        // 脱敏事实或日志引用，不含令牌
  observed_at: string;
  source: "adapter_observed" | "process_observed" | "rule_inferred";
  next_action: {
    kind: "authenticate" | "configure" | "retry" | "wait"
      | "confirm_stop" | "inspect" | "none";
    label: string;
    tool: string | null;
    arguments: Record<string, unknown> | null;
  };
};
```

分类和动作规则：

| 类别 | 最低证据 | 下一步与自动行为 |
| --- | --- | --- |
| `authentication` | 明确未登录、令牌/账户失效的客户端结构化错误 | 引导用户在客户端登录；停止自动重试，任务归属不变 |
| `transient` | 明确连接、超时、限流或服务端暂态错误 | 提示等待/有界重试；只按原预算和冷却，不能无限重启 |
| `permission` | 明确工具审批、文件/终端权限拒绝 | 显示需要用户调整的客户端权限；服务不修改全局设置 |
| `configuration` | 命令缺失、cwd/profile 非法、不支持 runtime、参数配置错误 | 指向实际配置入口；修正后重新 preflight |
| `process_unknown` | 重启遗留运行记录、启动/退出结果不确定 | `confirm_stop` 或独立 worktree；绝不自动交接/重启同一写入者 |
| `unknown` | 证据不足或多种解释冲突 | `inspect`，低置信度；不得猜测成功或自动恢复 |

原始模型错误、进程状态、任务进度继续分别保存。诊断是附加解释，不改变任务状态；模型恢复或 incident resolved 只说明告警解除，不表示交接、恢复或任务验收成功。重复巡视、重启、每任务次数、项目总预算和冷却仍使用现有持久状态。RB-004 不得为分类绕开现有 `PROCESS_UNCONFIRMED`、`PROCESS_RUNNING`、scope、后代和依赖守卫。

## 5. RB-005：低负担日常协议

保留 `work_start → work_next → work_report`、有序步骤、完整 handle、契约/依赖分页和未处理请求。优化以 `baseline.md` 同夹具测量，不跳过 recover 或独立验收。

三个入口新增可选参数：

```ts
view?: "full" | "action"   // 缺省 full，保持 0.7 客户端兼容
```

`full` 返回现有 `WorkGuide`。`action` 返回：

```ts
type ActionGuide = {
  truncated: boolean;
  omissions: string[];
  char_budget: number;
  run_id: string;
  task_id: string | null;
  stage: WorkStage;
  headline: string;
  handle: WorkHandle | null;
  next_action: WorkGuide["next_action"];
  current_step: ExecutionStep | null;
  completed_steps: string[];
  references: { project_id: string; task_id: string } | null;
  dependency_page: { total: number; next_offset: number | null };
  request_page: { total: number; next_offset: number | null };
  warnings: string[];
  choices: WorkGuide["choices"];
};
```

`action` 不重复返回完整 task、context markdown、decision body、依赖正文和 artifacts/verification 历史；调用方仍须按 omissions/references 补读，不能因紧凑而默认已读契约。`work_report(view="action")` 必须返回下一 handle 和 next_action，允许调用方不额外执行一次纯刷新 `work_next`。服务端 handle 校验、context_version、旧 epoch、依赖 revision 和请求闭环逻辑完全复用，不建立第二套状态机。

`doctor`/`relay_api` 增加上述参数和新验证工具的准确 schema/修复提示。CLI、随包 Skills 与 README 同步最短可运行示例。不得把响应字符数宣传为固定 token 节省比例。

## 6. RB-006：UI 读取与状态语义

UI 只消费已验收接口，不在前端推断进程退出或证据有效。任务详情读取 `task.verification`（Agent 自报）、`task.service_verification`（服务执行摘要）及 `verification_history`；执行者/大总管读取 `Run.diagnosis` 和 incident 诊断。

| 页面状态 | 数据来源 | 必须显示/动作 |
| --- | --- | --- |
| 自报通过/失败 | `task.verification` | 标明“Agent 自报”、命令、结果和快照时间 |
| 服务执行中 | `service_verification.status=running/queued` | profile、开始时间、日志入口；不显示通过 |
| 服务失败/超时/停止/启动失败 | 对应终态 | 退出码/信号或错误、日志、重新执行入口；不等于任务失败或已验收 |
| unknown | 执行或进程 unknown | 原因和核实动作；禁止绿色成功语义 |
| stale | `freshness.reasons` | 逐项显示 scope/dependency/profile/owner 等原因及重新验证 |
| current | 服务 succeeded 且 current | 标明“服务执行”，profile/版本/日志；仍显示“待独立验收” |
| 待验收/已验收 | `task.status/review` | 提交与验收分开，显示 reviewer Run 或 human_review 意图 |
| 恢复诊断 | `Run.diagnosis`/incident | 分类、置信度、证据和 next_action；告警解除不写成接手成功 |

保留当前项目切换、页面刷新、筛选/编辑状态、长文阅读和 shadcn Base UI。桌面与 390px 明暗主题均不得产生页面横向溢出；日志和错误长文可换行/局部滚动。

## 7. 写入所有权与串行接收

| 任务 | 写入所有权 |
| --- | --- |
| RB-003 | 新验证执行/配置、Store 记录、`server/types.ts` 与 `server/schemas.ts` 的共享类型、服务/API/MCP及验证测试 |
| RB-004 | runner/runtimes/supervisor/scheduler、`bin/errors.ts` 和恢复测试；只导入 RB-003 已交付共享类型，缺字段先报协调者 |
| RB-005 | workflow/domain/MCP/schema/types 的日常协议增量、CLI/integrations/skills 和工作流测试；必须接收 RB-003/004 精确成果 |
| RB-006 | 指定 Web 组件、`web/src/types.ts`、UI 测试和 `delivery-ui.md`；不重写服务端接口 |
| RB-007 | 端到端脚本、测试和最终报告；不在验收任务中顺手修产品 |

RB-003 与 RB-004 可在独立 detached worktree 并行，但共享 `types/schemas` 只有 RB-003 写。协调者按契约串行接收并复跑检查。并行不代表同物理 checkout 双写。

## 8. 新错误码

| 错误码 | 含义与下一步 |
| --- | --- |
| `VERIFICATION_PROFILE_INVALID` | 配置缺失/损坏/字段非法；修正显示的配置文件 |
| `VERIFICATION_PROFILE_NOT_FOUND` | profile ID 不存在；读取可用 ID，不传命令代替 |
| `VERIFICATION_WORKDIR_INVALID` | cwd 不存在或越出 workdir；修正配置/Run 目录 |
| `VERIFICATION_RUNNING` | 同任务已有执行；查询原 execution 或明确停止 |
| `VERIFICATION_NOT_FOUND` | execution 不存在或跨项目读取；核对 ID |
| `VERIFICATION_STATE` | 当前终态不允许所求操作；刷新记录，不重放 |
| `VERIFICATION_UNKNOWN` | 终态无法确认；保留 unknown 并人工核实 |

既有 `STALE_VERSION`、epoch/handle、scope、并发、依赖和自审错误继续优先生效。不得为“让流程继续”把新错误自动转成通过。
