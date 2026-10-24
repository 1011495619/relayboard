import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { commands, queries } from "./schemas.js";
import { version } from "./config.js";

export const SERVER_INSTRUCTIONS =
  "Relayboard is the shared source of task state. Register EVERY execution session and native subagent before dispatch, with parent_run_id. Query eligible work, then atomically claim using expected_version. Preserve returned claim_epoch for checkpoints. Do not edit outside assigned ranges. Save checkpoints before compaction and delegation. Request approval for scope expansion. Read your inbox and record agreed decisions. Handoffs require stopping old writers and reconciling actual files. A heartbeat is not progress. Scope checks are cooperative; use separate worktrees for parallel code changes. Use context packets, not full logs.";
const queryDescriptions = {
  project:
    "Read the complete project objective, user constraints and execution budget without loading the full task history.",
  decisions:
    "Read a bounded page of confirmed decisions relevant to a task and its ancestors, or all project decisions. Follow next_offset when present.",
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

export function createMcp({ command, query }) {
  const server = new McpServer(
    { name: "relayboard", version },
    { instructions: SERVER_INSTRUCTIONS },
  );
  const wrap = (fn) => async (input) => {
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
              code: error.code || "ERROR",
              message: error.message,
              details: error.details,
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
      wrap(({ request_id, ...args }) => command(name, args, request_id)),
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
