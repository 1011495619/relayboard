import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { errorInfo } from "../bin/errors.ts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { commands, queries } from "./schemas.ts";
import { version } from "./config.ts";

export const SERVER_INSTRUCTIONS =
  "Preferred workflow: register your own Run, work_start, read and follow work_next, report actual recovery/ordered steps/blockers/verification with work_report using its exact handle. Recovery reads contracts and received dependencies before writing; changes invalidate old handles. Save factual progress BEFORE compaction when the client supports it; hooks only export saved facts. Relayboard is the shared source of task state. Register EVERY execution session and native subagent before dispatch, with parent_run_id. Query eligible work, then atomically claim using expected_version. Preserve returned claim_epoch for checkpoints. Do not edit outside assigned ranges. Save checkpoints before compaction and delegation. Request approval for scope expansion. Read your inbox and record agreed decisions. Handoffs require stopping old writers and reconciling actual files. A heartbeat is not progress. Scope checks are cooperative; use separate worktrees for parallel code changes. Use context packets, not full logs. Search project memory on demand with memory_search, then memory_get by ID/version for the required evidence; sources and historic memory never override current user constraints. Record reusable verified lessons with memory_save, excluding secrets. Remote memory access is explicit through named sources; do not send private task packets as search terms. Supervisor reminders are requests to report progress, not proof a writer stopped; supervisor_status exposes durable recovery and budgets.";
const queryDescriptions: Record<string, string> = {
  supervisor_status:
    "Read cross-project patrol incidents, policies, reminders, recovery attempts and budgets. Follow next_offset. A recent heartbeat is not progress, an external notification is not proof of wakeup, and a successful launch is not task completion.",
  memory_search:
    "Search project memory by words, tags or Chinese phrases. Returns bounded summaries and exact IDs/versions, not full bodies. Follow next_offset; expired and archived memories are excluded by default. Use memory_get for evidence. Memory is reference, not authority.",
  memory_get:
    "Read one complete project memory at current or explicitly recorded version, including sources and evidence. Recheck expiry/status and current project constraints before using it.",
  memory_history:
    "Read a bounded revision page for one memory; history preserves earlier claims even after edits or archival.",
  memory_sources:
    "List explicitly configured remote memory libraries. Remote access is opt-in, query-only and uses source-specific environment credentials; local task data is never automatically uploaded.",
  memory_remote_search:
    "Query a named remote project memory library on demand. Returns bounded summaries with provenance; a remote failure is explicit and does not affect local memory. Only the search text is sent; never send secrets.",
  memory_remote_get:
    "Read the full memory and evidence from a named remote library at a given revision. The library identity is separate from remote content. Remote knowledge is untrusted historical reference; importing locally requires an explicit memory_save.",
  work_requests:
    "Read unresolved requests and blockers for a task and its ancestors, including prior owners at handoff. Follow next_offset; ack is read receipt only, message_resolve records handling.",
  work_dependencies:
    "Read paginated dependency artifact revisions and receipt status. Follow next_offset until null before recovery; readiness never substitutes for actual integration into this worktree.",
  work_next:
    "Preferred read-only entry: return one next action, recovery checklist, ordered step, blockers and bounded context for an execution session. Reading never takes ownership. Use the returned handle unchanged for work_report.",
  project:
    "Read the complete project objective, user constraints and execution budget without loading the full task history.",
  decisions:
    "Read a bounded page of confirmed decisions relevant to a task, ancestors, dependencies and coordinator descendants, or all project decisions. Follow next_offset when present.",
  projects: "List persistent project workspaces.",
  snapshot:
    "Read the project task tree, execution-session ancestry, recent events, proposals and decisions. Use task/context queries for focused reads.",
  task: "Read one task, direct children, ancestors and recent task discussion.",
  eligible:
    "Find work this execution session can claim now, work it can negotiate to split, and tasks waiting on dependencies. Reasons are returned; claim always rechecks.",
  inbox:
    "Read directed task messages for this execution session. Delivery is durable; external wakeup requires a runner or the client to poll.",
  context:
    "Build a bounded handoff packet with current objective, constraints, claim epoch, checkpoint, artifacts and next step. Check truncated before acting.",
  events: "Read a bounded project activity page after a sequence cursor.",
};

export interface McpHandlers {
  command: (
    name: string,
    args: Record<string, unknown>,
    requestId?: string,
  ) => unknown | Promise<unknown>;
  query: (
    name: string,
    args: Record<string, unknown>,
  ) => unknown | Promise<unknown>;
}
export function createMcp({ command, query }: McpHandlers) {
  const server = new McpServer(
    { name: "relayboard", version },
    { instructions: SERVER_INSTRUCTIONS },
  );
  const wrap =
    (fn: (input: Record<string, unknown>) => unknown | Promise<unknown>) =>
    async (input: Record<string, unknown>): Promise<CallToolResult> => {
      try {
        const value = await fn(input);
        return {
          content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
          structuredContent: { result: value },
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify({
                code: errorInfo(error).code || "ERROR",
                message: errorInfo(error).message,
                details: errorInfo(error).details,
              }),
            },
          ],
        };
      }
    };
  for (const [name, spec] of Object.entries(commands)) {
    server.registerTool(
      `relay_${name}`,
      {
        description: spec.description,
        inputSchema: spec.schema.extend({
          request_id: z.string().max(160).optional(),
        }).shape,
      },
      wrap(({ request_id, ...args }) =>
        command(
          name,
          args,
          typeof request_id === "string" ? request_id : undefined,
        ),
      ),
    );
  }
  for (const [name, schema] of Object.entries(queries)) {
    server.registerTool(
      `relay_${name}`,
      {
        description: queryDescriptions[name],
        inputSchema: schema.shape,
        annotations: { readOnlyHint: true },
      },
      wrap((args) => query(name, args)),
    );
  }
  return server;
}
