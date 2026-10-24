import type {
  Artifact,
  CommandArgs,
  Runtime,
  TaskFields,
  Verification,
  DependencyReceipt,
  ExecutionStep,
  WorkHandle,
} from "./schemas.ts";
export type {
  Artifact,
  Verification,
  Runtime,
  ExecutionPlan,
  ExecutionStep,
  WorkHandle,
  DependencyReceipt,
} from "./schemas.ts";

export interface VersionedRecord {
  id: string;
  version: number;
  created_at: string;
  updated_at?: string;
}
export interface Project
  extends VersionedRecord, CommandArgs<"project_create"> {
  project_id?: never;
}
export interface Agent extends VersionedRecord {
  project_id: string;
  name: string;
  runtime: Runtime;
  parent_agent_id: string | null;
}
export interface ProcessInfo {
  status: "running" | "unknown" | "stopped" | "failed" | "exited";
  pid?: number | null;
  started_at?: string;
  ended_at?: string;
  log_path?: string;
  task_id?: string;
  source?: string;
  note?: string;
  exit_code?: number | null;
  signal?: NodeJS.Signals | null;
  error?: string;
  reconciled_at?: string;
  reconciliation?: string;
}
export interface DispatchInfo {
  enabled: boolean;
  max_launches: number;
  launches: number;
  last_signature: string | null;
  note: string;
  configured_at: string;
  last_error?: string | null;
}
export interface Run extends VersionedRecord {
  project_id: string;
  agent_id: string;
  name: string;
  runtime: Runtime;
  parent_run_id: string | null;
  depth: number;
  delegated_scopes: string[];
  capabilities: string[];
  workdir: string;
  branch: string;
  observation: "self" | "parent" | "manual" | "adapter";
  status: "active" | "ended" | "unknown";
  last_seen_at: string;
  last_progress_at: string | null;
  process: ProcessInfo | null;
  observation_note?: string;
  status_note?: string;
  dispatch?: DispatchInfo;
  provider_session_id?: string;
}
export type TaskStatus =
  "pending" | "doing" | "blocked" | "review" | "reconcile" | "done";
export interface WorkspaceEvidence {
  source: "service_observed_git" | "unavailable";
  workdir: string;
  revision: string | null;
  fingerprint: string | null;
  observed_at: string;
  reason?: string;
  verification_source: "agent_reported";
}
export interface WorkflowState {
  recovered_epoch: number;
  recovered_signature: string;
  recovered_at: string;
  observed: string;
  plan_signature: string;
  completed_steps: string[];
  facts: string[];
  failed_attempts: string[];
  uncertain_actions: string[];
  ready_for_verification: boolean;
  dependency_receipts: DependencyReceipt[];
}
export interface Checkpoint {
  summary: string;
  next_step: string;
  blocker: string;
  at: string;
  run_id: string;
  verification_current?: boolean;
  required_children_at_checkpoint?: {
    id: string;
    status: TaskStatus;
    version: number;
  }[];
}
export interface Handoff {
  from_run_id: string;
  to_run_id: string;
  at: string;
  summary: string;
  confirmed_stop: boolean;
  descendants: "continue" | "require_stopped";
  descendant_task_ids: string[];
  checkpoint_at: string | null;
}
export interface Task extends VersionedRecord, TaskFields {
  project_id: string;
  short_id: string;
  parent_id: string | null;
  status: TaskStatus;
  mode: "execute" | "coordinator";
  owner_run_id: string | null;
  claim_epoch: number;
  checkpoint: Checkpoint | null;
  workflow?: WorkflowState;
  evidence?: WorkspaceEvidence;
  artifacts: Artifact[];
  verification: Verification[];
  claimed_at?: string;
  submitted_at?: string;
  submission?: string;
  completed_at?: string | null;
  split_rationale?: string;
  handoff?: Handoff;
  reconciliation?: { observed: string; at: string; run_id: string };
  release_note?: string;
  review?: CommandArgs<"task_review"> & { at: string };
}
export interface Message extends VersionedRecord, CommandArgs<"message_send"> {
  acknowledged_at: string | null;
  resolved_at?: string;
  resolved_by?: string;
  resolution?: string;
  system?: boolean;
}
export interface Decision
  extends VersionedRecord, CommandArgs<"decision_record"> {}
interface ProposalState extends VersionedRecord {
  project_id: string;
  status: "pending" | "approved" | "declined";
  resolution?: string;
  resolved_at?: string;
}
export interface SplitProposal
  extends ProposalState, CommandArgs<"proposal_create"> {
  type: "split";
}
export interface ScopeProposal
  extends ProposalState, CommandArgs<"scope_request"> {
  type: "scope";
  expected_version: number;
}
export type Proposal = SplitProposal | ScopeProposal;
export interface RelayEvent {
  id: string;
  project_id: string;
  type: string;
  at: string;
  seq: number;
  task_id?: string;
  run_id?: string | null;
  summary?: string;
  [field: string]: unknown;
}
export interface RecordMap {
  project: Project;
  agent: Agent;
  run: Run;
  task: Task;
  message: Message;
  decision: Decision;
  proposal: Proposal;
}
export type RecordKind = keyof RecordMap;
export interface ScopeConflict {
  task_id: string;
  short_id: string;
  run_id: string | null;
  resource: string | undefined;
  scopes: string[];
}
export interface Eligibility {
  task_id: string;
  eligible: boolean;
  category: "ready" | "negotiate" | "waiting";
  reasons: string[];
  warnings: string[];
  conflicts: ScopeConflict[];
}
export interface ContextPacket {
  task_id: string;
  project_id: string;
  version: number;
  claim_epoch: number;
  markdown: string;
  truncated: boolean;
  omissions: string[];
  references: { project_id: string; task_id: string };
  total_chars: number;
}
export interface TaskDetail extends Task {
  children: Task[];
  ancestors: Pick<Task, "id" | "title" | "owner_run_id">[];
  messages: Message[];
  proposals: Proposal[];
}
export interface Snapshot {
  attention?: {
    requests_total: number;
    request_counts: Record<string, number>;
    recovery_task_ids: string[];
  };
  project: Project;
  tasks: Task[];
  agents: Agent[];
  runs: (Run & {
    liveness: "reported" | "unconfirmed" | "ended" | "unknown";
  })[];
  messages: Message[];
  decisions: Decision[];
  proposals: Proposal[];
  events: RelayEvent[];
}
export type WorkStage =
  | "recover"
  | "execute"
  | "blocked"
  | "verify"
  | "submit"
  | "review"
  | "wait_children"
  | "done"
  | "unavailable";
export interface WorkGuide {
  truncated: boolean;
  omissions: string[];
  char_budget: number;
  run_id: string;
  task: Task | null;
  stage: WorkStage;
  headline: string;
  handle: WorkHandle | null;
  next_action: {
    tool: string;
    reason: string;
    arguments: Record<string, unknown>;
    required_fields?: string[];
  };
  checklist: string[];
  current_step: ExecutionStep | null;
  completed_steps: string[];
  context: ContextPacket | null;
  decisions: Decision[];
  dependencies: {
    id: string;
    short_id: string;
    title: string;
    status: TaskStatus;
    version: number;
    revision: string;
    artifacts: Artifact[];
    received: boolean;
  }[];
  dependency_page: { total: number; next_offset: number | null };
  request_page: { total: number; next_offset: number | null };
  messages: Message[];
  warnings: string[];
  choices: {
    task_id: string;
    title: string;
    eligible: boolean;
    reasons: string[];
  }[];
}
export interface QueryResults {
  work_next: WorkGuide;
  work_requests: {
    items: Message[];
    total: number;
    next_offset: number | null;
  };
  work_dependencies: {
    items: WorkGuide["dependencies"];
    total: number;
    next_offset: number | null;
  };
  project: Project;
  projects: (Project & { task_count: number; done_count: number })[];
  decisions: { items: Decision[]; total: number; next_offset: number | null };
  snapshot: Snapshot;
  task: TaskDetail;
  eligible: (Eligibility & { task: Task })[];
  events: RelayEvent[];
  inbox: Message[];
  context: ContextPacket;
}
export interface CommandResults {
  work_start: WorkGuide;
  work_report: WorkGuide;
  project_create: Project;
  project_update: Project;
  agent_register: { agent: Agent; run: Run };
  run_heartbeat: Run;
  run_end: Run;
  run_process_reconcile: Run;
  run_dispatch: Run;
  task_create: Task;
  task_update: Task;
  task_claim: Task;
  task_checkpoint: Task;
  task_submit: Task;
  task_review: Task;
  task_split: { parent: Task; children: Task[] };
  proposal_create: SplitProposal;
  proposal_resolve: {
    proposal: Proposal;
    split: { parent: Task; children: Task[] } | null;
  };
  scope_request: ScopeProposal;
  scope_resolve: { proposal: Proposal; task: Task };
  task_handoff: Task;
  task_reconcile: Task;
  task_release: Task;
  message_send: Message;
  message_ack: Message;
  message_resolve: Message;
  decision_record: Decision;
}

export type CommandResult<K extends keyof CommandResults> = CommandResults[K];
export type QueryResult<K extends keyof QueryResults> = QueryResults[K];
