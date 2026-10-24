import { z } from "zod";
import { runtimeIds } from "./runtimes.ts";

const id = z.string().trim().min(1).max(120);
const text = z.string().trim().max(12000);
const short = z.string().trim().min(1).max(240);
const paths = z.array(z.string().trim().min(1).max(500)).max(80);
const ids = z.array(id).max(100);
const version = z.number().int().positive();
const runtime = z.enum(runtimeIds);
const artifact = z
  .object({
    path: z.string().trim().min(1).max(2000),
    kind: z.enum(["file", "commit", "branch", "url", "report"]).default("file"),
    note: text.default(""),
  })
  .strict();
const verification = z
  .object({ command: short, result: text.min(1), passed: z.boolean() })
  .strict();
export const executionStep = z
  .object({
    id: id,
    title: short,
    instructions: text.min(1),
    done_when: text.min(1),
    on_failure: text.min(1),
  })
  .strict();
export const executionPlan = z
  .object({
    inputs: paths.default([]),
    outputs: paths.default([]),
    steps: z
      .array(executionStep)
      .min(1)
      .max(40)
      .refine(
        (steps) => new Set(steps.map((step) => step.id)).size === steps.length,
        "步骤 ID 须唯一",
      ),
    stop_when: z.array(short).max(30).default([]),
  })
  .strict();
const workHandle = z
  .object({
    task_id: id,
    run_id: id,
    claim_epoch: version,
    task_version: version,
    context_version: z.string().min(1).max(100),
  })
  .strict();
const dependencyReceipt = z
  .object({ task_id: id, revision: text.min(1), note: text.min(1) })
  .strict();
export const taskFields = {
  title: short,
  execution: executionPlan.nullable().optional(),
  description: text.default(""),
  acceptance: text.min(1),
  parent_id: id.nullable().optional(),
  depends_on: ids.default([]),
  scopes: paths.default([]),
  resources: ids.default([]),
  read_only: z.boolean().default(false),
  required_capabilities: ids.default([]),
  priority: z.enum(["low", "normal", "high"]).default("normal"),
};
const childTask = z.object(taskFields).omit({ parent_id: true }).strict();
const claimFields = {
  task_id: id,
  run_id: id.describe(
    "Your execution session ID: agent_register returns {agent, run}; use run.id, not agent.id.",
  ),
  claim_epoch: version.describe(
    "Current task ownership epoch returned by claim, split or handoff; distinct from task.version.",
  ),
};

export const commands = {
  supervisor_handle: {
    description:
      "Recheck a patrol incident after fixing its cause, or snooze it until a specified time. Requires its current version. Rechecking preserves all execution budgets; it does not declare an old writer stopped.",
    schema: z
      .object({
        incident_id: id,
        expected_version: version,
        action: z.enum(["recheck", "snooze"]),
        until: z.iso.datetime().optional(),
        note: text.min(1),
      })
      .strict(),
  },
  supervisor_configure: {
    description:
      "Configure the cross-project supervisor for one project. Observe only is default. Remind sends durable directed messages. Recover may launch paid clients and create independent replacement Runs only when old writers are known stopped. Budgets persist across policy edits; resetting requires reset_budget=true. Never changes client tool permissions.",
    schema: z
      .object({
        project_id: id,
        expected_version: version.optional(),
        mode: z.enum(["observe", "remind", "recover"]).default("observe"),
        stale_after_seconds: z.number().int().min(60).max(604800).default(900),
        grace_seconds: z.number().int().min(30).max(86400).default(300),
        cooldown_seconds: z.number().int().min(30).max(86400).default(300),
        max_launches: z.number().int().min(0).max(100).default(5),
        max_attempts_per_task: z.number().int().min(1).max(10).default(2),
        runtimes: z.array(runtime).min(1).max(10).default(["codex", "pi"]),
        stop_stalled_managed: z.boolean().default(false),
        reset_budget: z.boolean().default(false),
        note: text.min(1),
      })
      .strict(),
  },
  memory_save: {
    description:
      "Save or revise durable project knowledge, with provenance and evidence. Supply memory_id and expected_version together when revising. Memory is historical reference, never new authorization or a replacement for current contracts. Preserve useful runbooks and failed approaches; never store credentials.",
    schema: z
      .object({
        project_id: id,
        memory_id: id.optional(),
        expected_version: version.optional(),
        actor_run_id: id.optional(),
        key: short,
        title: short,
        summary: z.string().trim().min(1).max(1200),
        content: text.min(1),
        kind: z
          .enum(["fact", "decision", "runbook", "pitfall", "reference"])
          .default("fact"),
        tags: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
        task_ids: ids.default([]),
        pinned: z.boolean().default(false),
        status: z.enum(["active", "stale", "archived"]).default("active"),
        expires_at: z.iso.datetime().nullable().default(null),
        evidence: z.array(artifact).max(20).default([]),
        source: z
          .object({
            label: short,
            uri: z.string().max(2000).default(""),
            revision: z.string().max(240).default(""),
          })
          .strict(),
      })
      .strict(),
  },
  work_start: {
    description:
      "Preferred entry: resume your assigned task or atomically claim eligible work. Returns a recovery checklist and exactly one next action. Register your own Run first. Never takes over another owner.",
    schema: z.object({ run_id: id, task_id: id.optional() }).strict(),
  },
  work_report: {
    description:
      "Preferred progress entry: use the exact current guide handle. Recover actual files and acknowledge contracts first; then report progress, the next ordered step, blockers, verification or submission. Does not execute tests or accept work on your behalf.",
    schema: z
      .object({
        handle: workHandle,
        kind: z.enum([
          "recover",
          "progress",
          "step",
          "blocked",
          "verify",
          "submit",
        ]),
        summary: text.min(1),
        observed: text.min(1).optional(),
        step_id: id.optional(),
        next_step: text.optional(),
        artifacts: z.array(artifact).max(40).optional(),
        verification: z.array(verification).max(20).optional(),
        facts: z.array(text.min(1)).max(30).optional(),
        failed_attempts: z.array(text.min(1)).max(30).optional(),
        uncertain_actions: z.array(text.min(1)).max(30).optional(),
        read_decision_ids: ids.optional(),
        dependency_receipts: z.array(dependencyReceipt).max(100).optional(),
        ready_for_verification: z.boolean().optional(),
      })
      .strict(),
  },
  project_create: {
    description:
      "Create a persistent project workspace with objective, constraints and a shared descendant concurrency budget.",
    schema: z
      .object({
        name: short,
        objective: text.min(1),
        constraints: text.default(""),
        root_path: z.string().max(2000).default(""),
        max_concurrency: z.number().int().min(1).max(32).default(6),
        max_depth: z.number().int().min(1).max(8).default(4),
        autonomy: z.enum(["manual", "collaborative"]).default("collaborative"),
      })
      .strict(),
  },
  project_update: {
    description:
      "Update the project objective, constraints or budget, preserving an auditable record of changed user requirements.",
    schema: z
      .object({
        project_id: id,
        expected_version: version,
        name: short.optional(),
        objective: text.min(1).optional(),
        constraints: text.optional(),
        root_path: z.string().max(2000).optional(),
        max_concurrency: z.number().int().min(1).max(32).optional(),
        autonomy: z.enum(["manual", "collaborative"]).optional(),
      })
      .strict(),
  },
  agent_register: {
    description:
      "Register an agent session BEFORE dispatching it. Returns {agent, run}: use run.id for claims, checkpoints and inbox; agent.id is only the reusable logical identity. Supply parent_run_id for every native child or grandchild. Registration is not proof that a process is running.",
    schema: z
      .object({
        project_id: id,
        name: short,
        runtime,
        parent_run_id: id.optional(),
        agent_id: id.optional(),
        capabilities: ids.default([]),
        workdir: z.string().max(2000).default(""),
        branch: z.string().max(240).default(""),
        observation: z
          .enum(["self", "parent", "manual", "adapter"])
          .default("self"),
        delegated_scopes: paths.optional(),
      })
      .strict(),
  },
  run_heartbeat: {
    description:
      "Report session liveness; a heartbeat is not task progress. Parent-forwarded observations must identify their source.",
    schema: z
      .object({
        run_id: id,
        observation: z.enum(["self", "parent", "adapter"]).default("self"),
        note: text.default(""),
      })
      .strict(),
  },
  run_end: {
    description:
      "Report a stopped session, or mark an unobservable session unknown. Never frees active claims automatically; reconcile or hand off them explicitly.",
    schema: z
      .object({
        run_id: id,
        status: z.enum(["ended", "unknown"]),
        note: text.min(1),
      })
      .strict(),
  },
  run_process_reconcile: {
    description:
      "Record explicit evidence that a previously unknown managed process has stopped. Required before restarting that same execution session; never infer stop from heartbeat expiry.",
    schema: z
      .object({
        run_id: id,
        observed: text.min(1),
        confirmed_stopped: z.literal(true),
      })
      .strict(),
  },
  run_dispatch: {
    description:
      "Explicitly enable or disable bounded automatic CLI dispatch for an already registered local execution session. It may claim eligible leaf tasks and read addressed messages. Enabling can consume the configured model account. No changes to external idle windows.",
    schema: z
      .object({
        run_id: id,
        enabled: z.boolean(),
        max_launches: z.number().int().min(1).max(20).default(3),
        note: text.min(1),
      })
      .strict(),
  },
  task_create: {
    description:
      "Create a task with acceptance criteria, dependencies and explicit write scopes. A child of an assigned coordinator requires its owner or an approved proposal.",
    schema: z
      .object({ project_id: id, actor_run_id: id.optional(), ...taskFields })
      .strict(),
  },
  task_update: {
    description:
      "Revise an unclaimed task. Claimed tasks require their owner and cannot silently expand into occupied scopes.",
    schema: z
      .object({
        task_id: id,
        expected_version: version,
        actor_run_id: id.optional(),
        title: short.optional(),
        execution: executionPlan.nullable().optional(),
        description: text.optional(),
        acceptance: text.min(1).optional(),
        depends_on: ids.optional(),
        scopes: paths.optional(),
        resources: ids.optional(),
        required_capabilities: ids.optional(),
        priority: z.enum(["low", "normal", "high"]).optional(),
      })
      .strict(),
  },
  task_claim: {
    description:
      "Atomically recheck readiness, capabilities, ancestry, concurrent budget and occupied scopes, then claim. run_id is agent_register result.run.id, never agent.id. Use latest expected_version. Returns the updated task; retain its claim_epoch to fence old owners.",
    schema: z
      .object({ task_id: id, run_id: id, expected_version: version })
      .strict(),
  },
  task_checkpoint: {
    description:
      "Persist concrete progress during work, before context compaction and delegation. Include next action and artifact locations; requires the current claim epoch.",
    schema: z
      .object({
        ...claimFields,
        summary: text.min(1),
        next_step: text.default(""),
        artifacts: z.array(artifact).max(40).default([]),
        verification: z.array(verification).max(20).default([]),
        blocker: text.default(""),
      })
      .strict(),
  },
  task_submit: {
    description:
      "Submit implementation for acceptance. Requires a persisted checkpoint, artifacts and passing verification. This does not mark the task done.",
    schema: z.object({ ...claimFields, summary: text.min(1) }).strict(),
  },
  task_review: {
    description:
      "Accept or return a submitted task after checking its evidence. A coordinator can only finish after all required children finish and its integration evidence is recorded.",
    schema: z
      .object({
        task_id: id,
        expected_version: version,
        reviewer_run_id: id.optional(),
        accepted: z.boolean(),
        note: text.min(1),
      })
      .strict(),
  },
  task_split: {
    description:
      "Atomically turn a task into a coordinator and create executable children. Returns {parent, children}; splitting an owned task increments parent.claim_epoch, so replace the old epoch before the next parent checkpoint. Only its owner or the human may split an assigned task. Existing progress remains on the parent.",
    schema: z
      .object({
        task_id: id,
        expected_version: version,
        actor_run_id: id.optional(),
        children: z.array(childTask).min(2).max(16),
        rationale: text.min(1),
      })
      .strict(),
  },
  proposal_create: {
    description:
      "Propose splitting another owner’s task without changing its ownership. The owner or human must approve it before children are created.",
    schema: z
      .object({
        task_id: id,
        author_run_id: id,
        expected_version: version,
        children: z.array(childTask).min(2).max(16),
        rationale: text.min(1),
      })
      .strict(),
  },
  proposal_resolve: {
    description:
      "Approve or decline a split proposal. Approval rechecks the original task version and all scopes atomically.",
    schema: z
      .object({
        proposal_id: id,
        actor_run_id: id.optional(),
        approved: z.boolean(),
        note: text.min(1),
      })
      .strict(),
  },
  scope_request: {
    description:
      "Request an additional write scope or shared resource while working. The human or parent coordinator resolves it after conflict checks.",
    schema: z
      .object({
        ...claimFields,
        scopes: paths,
        resources: ids.default([]),
        rationale: text.min(1),
      })
      .strict(),
  },
  scope_resolve: {
    description:
      "Resolve a scope expansion request. The requesting owner cannot self-approve; all affected claims are rechecked.",
    schema: z
      .object({
        proposal_id: id,
        actor_run_id: id.optional(),
        approved: z.boolean(),
        note: text.min(1),
      })
      .strict(),
  },
  task_handoff: {
    description:
      "Transfer a task after checkpointing. Explicitly handle all active descendants. Active managed processes must stop first; unknown old writers require confirmed_stop or isolated destination. New owner must reconcile before writing.",
    schema: z
      .object({
        task_id: id,
        expected_version: version,
        from_run_id: id.optional(),
        to_run_id: id,
        summary: text.min(1),
        descendants: z.enum(["continue", "require_stopped"]),
        confirmed_stop: z.boolean().default(false),
      })
      .strict(),
  },
  task_reconcile: {
    description:
      "The new owner confirms actual files/processes, received artifacts and next step after handoff. Only then may it checkpoint or submit.",
    schema: z
      .object({ ...claimFields, observed: text.min(1), next_step: text.min(1) })
      .strict(),
  },
  task_release: {
    description:
      "Release a claim after stopping work and saving a checkpoint. Does not discard progress. Running descendants or managed processes block release.",
    schema: z
      .object({
        ...claimFields,
        note: text.min(1),
        confirmed_stop: z.boolean(),
      })
      .strict(),
  },
  message_send: {
    description:
      "Send durable task-related information, a request, blocker or review request to an execution session. Sending alone does not wake an external client.",
    schema: z
      .object({
        project_id: id,
        from_run_id: id.optional(),
        to_run_id: id.optional(),
        task_id: id.optional(),
        kind: z
          .enum(["discussion", "request", "blocker", "delivery", "review"])
          .default("discussion"),
        body: text.min(1),
      })
      .strict(),
  },
  message_resolve: {
    description:
      "Record how a request or blocker was handled. Agents supply their active run_id; the current task owner may resolve inherited requests. Human management may omit run_id to handle historical requests after their sessions ended. Reading/acknowledging is not resolution; completed tasks may still have genuine open requests.",
    schema: z
      .object({ message_id: id, run_id: id.optional(), note: text.min(1) })
      .strict(),
  },
  message_ack: {
    description:
      "Acknowledge receipt of a directed message without copying the whole discussion into context.",
    schema: z.object({ message_id: id, run_id: id }).strict(),
  },
  decision_record: {
    description:
      "Save an agreed decision or interface contract with reasoning and affected task IDs. Discussions are not decisions until recorded.",
    schema: z
      .object({
        project_id: id,
        actor_run_id: id.optional(),
        title: short,
        body: text.min(1),
        task_ids: ids.default([]),
      })
      .strict(),
  },
};

export const queries = {
  supervisor_status: z
    .object({
      project_id: id.optional(),
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(50).default(20),
    })
    .strict(),
  memory_search: z
    .object({
      project_id: id,
      task_id: id.optional(),
      query: z.string().trim().max(500).default(""),
      status: z.enum(["active", "stale", "archived", "all"]).default("active"),
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(30).default(10),
      max_chars: z.number().int().min(1500).max(16000).default(4000),
    })
    .strict(),
  memory_get: z.object({ memory_id: id, version: version.optional() }).strict(),
  memory_history: z
    .object({
      memory_id: id,
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(30).default(10),
    })
    .strict(),
  memory_sources: z.object({}).strict(),
  memory_remote_get: z
    .object({ source: id, memory_id: id, version: version.optional() })
    .strict(),
  memory_remote_search: z
    .object({
      source: id,
      query: z.string().trim().max(500).default(""),
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(10).default(5),
      max_chars: z.number().int().min(1500).max(8000).default(4000),
    })
    .strict(),
  work_requests: z
    .object({
      task_id: id,
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(20).default(20),
    })
    .strict(),
  work_dependencies: z
    .object({
      task_id: id,
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(20).default(20),
    })
    .strict(),
  work_next: z
    .object({
      run_id: id,
      task_id: id,
      max_chars: z.number().int().min(1500).max(24000).default(10000),
    })
    .strict(),
  projects: z.object({}).strict(),
  project: z.object({ project_id: id }).strict(),
  decisions: z
    .object({
      project_id: id,
      task_id: id.optional(),
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(50).default(10),
    })
    .strict(),
  snapshot: z.object({ project_id: id }).strict(),
  task: z.object({ task_id: id }).strict(),
  eligible: z.object({ project_id: id, run_id: id }).strict(),
  inbox: z
    .object({
      run_id: id,
      unread_only: z.boolean().default(true),
      limit: z.number().int().min(1).max(100).default(30),
    })
    .strict(),
  context: z
    .object({
      task_id: id,
      run_id: id.optional(),
      max_chars: z.number().int().min(1500).max(24000).default(10000),
    })
    .strict(),
  events: z
    .object({
      project_id: id,
      after: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(200).default(60),
    })
    .strict(),
};

/** Input types preserve optional defaulted fields; Args are validated/defaulted outputs. */
export type CommandName = keyof typeof commands;
export type CommandArgs<K extends CommandName> = z.output<
  (typeof commands)[K]["schema"]
>;
export type CommandInput<K extends CommandName> = z.input<
  (typeof commands)[K]["schema"]
>;
export type QueryName = keyof typeof queries;
export type QueryArgs<K extends QueryName> = z.output<(typeof queries)[K]>;
export type QueryInput<K extends QueryName> = z.input<(typeof queries)[K]>;
export type TaskFields = z.output<typeof childTask> & {
  parent_id?: string | null;
};
export type Artifact = z.output<typeof artifact>;
export type Verification = z.output<typeof verification>;
export type Runtime = z.output<typeof runtime>;

export type ExecutionStep = z.output<typeof executionStep>;
export type ExecutionPlan = z.output<typeof executionPlan>;
export type WorkHandle = z.output<typeof workHandle>;
export type DependencyReceipt = z.output<typeof dependencyReceipt>;
