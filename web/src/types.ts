/// <reference types="node" />
import type React from "react";
import type {
  Project,
  Task,
  Snapshot,
  Eligibility,
  ContextPacket,
  CommandResults,
  QueryResults,
  Proposal,
  TaskStatus,
  Artifact,
  Verification,
  Message,
} from "../../server/types.ts";
import type { CommandInput, Runtime } from "../../server/schemas.ts";
export type {
  Project,
  Task,
  Snapshot,
  ContextPacket,
  CommandResults,
  QueryResults,
  Proposal,
  TaskStatus,
  Artifact,
  Verification,
  Runtime,
  Message,
};
export type Run = Snapshot["runs"][number];
export type Eligible = Eligibility & { task: Task };
export interface Skill {
  name: string;
  title: string;
  role: string;
  description: string;
  prompt: string;
  path: string;
  content?: string;
}
export interface SkillSource extends Omit<Skill, "path"> {
  content: string;
}
export interface Integration {
  node: string;
  mcp: string;
  mcp_args?: string[];
  cli_args?: string[];
  base_url: string;
  token_required: boolean;
  skill: string;
}
export interface RuntimeInfo {
  runtime: Runtime;
  available: boolean;
  version: string;
}
export type ModalKind =
  | "project"
  | "task"
  | "agent"
  | "checkpoint"
  | "split"
  | "handoff"
  | "reconcile"
  | "review"
  | "scope"
  | "release"
  | "message"
  | "resolveMessage"
  | "decision"
  | "proposalReview"
  | "launch"
  | "logs"
  | "runEnd"
  | "dispatch"
  | "worktree"
  | "context";
interface ModalFields {
  message?: Message;
  task?: Task;
  parent?: { id: string; runtime?: Runtime; workdir?: string };
  project?: Project;
  run?: Run;
  packet?: ContextPacket;
  proposal?: Proposal | boolean;
  accepted?: boolean;
  approved?: boolean;
  workdir?: string;
  branch?: string;
}
export type ModalState = ModalFields &
  (
    | {
        kind:
          "project" | "task" | "agent" | "message" | "decision" | "worktree";
      }
    | {
        kind:
          | "checkpoint"
          | "split"
          | "handoff"
          | "reconcile"
          | "review"
          | "scope"
          | "release";
        task: Task;
      }
    | { kind: "resolveMessage"; message: Message }
    | { kind: "proposalReview"; proposal: Proposal; approved: boolean }
    | { kind: "launch" | "logs" | "runEnd" | "dispatch"; run: Run }
    | { kind: "context"; task: Task; packet: ContextPacket }
  );
export type SetModal = React.Dispatch<React.SetStateAction<ModalState | null>>;
export type Notify = (message: string, error?: boolean) => unknown;
export type Act = (fn: () => unknown | Promise<unknown>) => Promise<void>;
export type OpenTask = (task: Task | undefined) => void;
export type Command = <K extends keyof CommandResults>(
  name: K,
  args: CommandInput<K>,
  message?: string,
) => Promise<CommandResults[K]>;
export type HandleError = (error: unknown) => void;
export interface ChildDraft {
  title: string;
  scope: string;
  readOnly: boolean;
  acceptance?: string;
  resources?: string;
  deps?: string;
}
