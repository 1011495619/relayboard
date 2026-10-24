import { z } from "zod";

const id = z.string().trim().min(1).max(120);
const text = z.string().trim().max(12000);
const short = z.string().trim().min(1).max(240);
const paths = z.array(z.string().trim().min(1).max(500)).max(80);
const ids = z.array(id).max(100);
const version = z.number().int().positive();
const runtime = z.enum(["codex", "claude", "pi", "other", "human"]);
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
export const taskFields = {
  title: short,
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
  run_id: id.describe("Your execution session ID: agent_register returns {agent, run}; use run.id, not agent.id."),
  claim_epoch: version.describe("Current task ownership epoch returned by claim, split or handoff; distinct from task.version."),
};

export const commands = {
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
export type CommandArgs<K extends CommandName> = z.output<(typeof commands)[K]["schema"]>;
export type CommandInput<K extends CommandName> = z.input<(typeof commands)[K]["schema"]>;
export type QueryName = keyof typeof queries;
export type QueryArgs<K extends QueryName> = z.output<(typeof queries)[K]>;
export type QueryInput<K extends QueryName> = z.input<(typeof queries)[K]>;
export type TaskFields = z.output<typeof childTask> & { parent_id?: string | null };
export type Artifact = z.output<typeof artifact>;
export type Verification = z.output<typeof verification>;
export type Runtime = z.output<typeof runtime>;
