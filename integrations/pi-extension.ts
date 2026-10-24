import { createHash } from "node:crypto";
import { ClientError, errorInfo } from "../bin/errors.ts";
export interface ExtensionContext {
  ui?: { notify?: (text: string, level: "warning") => void };
}
export interface Injection {
  message: { customType: string; content: string; display: boolean };
}
export interface PiExtensionApi {
  registerMcpServer?: (
    name: string,
    config: {
      url: string;
      headers: Record<string, string>;
      exposure: string;
      description: string;
    },
  ) => void;
  on: (
    event:
      | "session_start"
      | "before_agent_start"
      | "session_before_compact"
      | "session_compact"
      | "session_shutdown",
    handler: (
      event: unknown,
      context: ExtensionContext,
    ) => Promise<void | Injection>,
  ) => void;
  appendEntry?: (type: string, value: Record<string, unknown>) => void;
}
interface InboxMessage {
  id: string;
  body: string;
}
interface Packet {
  version: number;
  markdown: string;
  truncated?: boolean;
  omissions?: string[];
}
interface Guide {
  stage: string;
  headline: string;
  handle: Record<string, unknown> | null;
  next_action: {
    tool: string;
    reason: string;
    arguments: Record<string, unknown>;
  };
  context: Packet | null;
  checklist: string[];
  current_step: {
    id: string;
    title: string;
    instructions: string;
    done_when: string;
    on_failure: string;
  } | null;
  completed_steps: string[];
  warnings: string[];
  decisions: { id: string; title: string; body: string }[];
  dependencies: {
    id: string;
    title: string;
    status: string;
    received: boolean;
  }[];
}
const MAX_INJECTION_CHARS = 12000;
const workflowRules =
  "Use relay_work_start, relay_work_next and relay_work_report for the guided flow. " +
  "Read the guide and verify actual cwd, branch, changes, processes, contracts and received dependency revisions before reporting recover. " +
  "Copy the CURRENT returned handle; never reuse a parent identity or stale claim. Execute only the next ordered step. " +
  "Report progress/failed attempts/uncertain results before compaction when you still have a model turn; hooks only export existing records. " +
  "Register all native descendants before dispatch; each child needs its own Run and claim. " +
  "This injection reports saved records, not proof that files or tests are current. It does not claim to wake other idle clients.";

/** Render a bounded brief, never a truncated executable command. Full records remain available through MCP. */
function renderInjection(
  runId: string,
  packet: Packet | null,
  guide: Guide | null,
  inbox: InboxMessage[],
) {
  const omitted: string[] = [];
  const lines = [
    `Relayboard Run: ${runId}. Use this identity only.`,
    workflowRules,
    ...(guide
      ? [
          `Current stage: ${guide.stage}. ${guide.headline}`,
          `Current handle: ${JSON.stringify(guide.handle)}`,
        ]
      : [
          "Guided tools are unavailable on this older service. Read context, then use legacy task_reconcile/task_checkpoint/task_submit with the current claim_epoch.",
        ]),
  ];
  let remaining = MAX_INJECTION_CHARS - lines.join("\n\n").length - 650;
  const add = (label: string, value: string, limit: number) => {
    const allowed = Math.max(0, Math.min(limit, remaining - label.length - 5));
    const clipped = value.length > allowed;
    if (allowed)
      lines.push(
        `${label}\n${value.slice(0, allowed)}${clipped ? "\n[omitted; fetch full record before acting]" : ""}`,
      );
    if (clipped) omitted.push(label);
    remaining -= label.length + Math.min(value.length, allowed) + 60;
  };
  if (guide) {
    const action = JSON.stringify(guide.next_action);
    if (action.length <= 2000)
      add("Next action (copy arguments, fill observed facts)", action, 2000);
    else {
      add(
        "Next action",
        `${guide.next_action.tool}: ${guide.next_action.reason}. Fetch relay_work_next to obtain complete arguments.`,
        500,
      );
      omitted.push("complete next_action arguments");
    }
    add("Recovery / execution checklist", guide.checklist.join("\n"), 1400);
    if (guide.current_step)
      add(
        "Current step",
        `${guide.current_step.id}: ${guide.current_step.title}\n${guide.current_step.instructions}\nDone when: ${guide.current_step.done_when}\nOn failure: ${guide.current_step.on_failure}`,
        1200,
      );
    if (guide.warnings.length) add("Warnings", guide.warnings.join("\n"), 900);
    if (guide.dependencies.length)
      add(
        "Dependency receipts",
        guide.dependencies
          .map(
            (d) => `${d.id}: ${d.title}; ${d.status}; received=${d.received}`,
          )
          .join("\n"),
        700,
      );
    if (guide.decisions.length)
      add(
        "Contracts (IDs and titles only; read full bodies via relay_work_next / relay_decisions before acknowledging)",
        guide.decisions.map((d) => `${d.id}: ${d.title}`).join("\n"),
        650,
      );
  }
  if (packet) {
    add("Saved task context", packet.markdown, 5300);
    if (packet.truncated)
      omitted.push(...(packet.omissions || ["saved context"]));
  }
  add(
    "Directed inbox (acknowledge after reading)",
    inbox.map((m) => `${m.id}: ${m.body}`).join("\n") || "No unread messages.",
    1200,
  );
  if (omitted.length)
    lines.push(
      `Brief contains omissions: ${[...new Set(omitted)].join(", ").slice(0, 350)}. Read relay_work_next, relay_project, relay_task, relay_decisions or relay_inbox for complete applicable records before acting. Acknowledgement means you actually read them.`,
    );
  return lines.join("\n\n").slice(0, MAX_INJECTION_CHARS);
}
/** Optional pi extension. No provider calls, no automatic agent spawning. */
export default function relayboardExtension(pi: PiExtensionApi) {
  const url = process.env.RELAYBOARD_URL || "http://127.0.0.1:4317";
  const runId = process.env.RELAYBOARD_RUN_ID;
  const taskId = process.env.RELAYBOARD_TASK_ID;
  const headers = {
    "Content-Type": "application/json",
    ...(process.env.RELAYBOARD_TOKEN
      ? { Authorization: `Bearer ${process.env.RELAYBOARD_TOKEN}` }
      : {}),
  };
  let timer: NodeJS.Timeout | undefined;
  let signature = "",
    warned = false;
  let guidedSupported: boolean | undefined;
  const request = async <T = unknown>(
    path: string,
    body: unknown,
  ): Promise<T> => {
    const response = await fetch(url + path, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    const value = (await response.json()) as {
      result: T;
      error?: { message?: string; code?: string; details?: unknown };
    };
    if (!response.ok)
      throw new ClientError(
        value.error?.message || `HTTP ${response.status}`,
        value.error?.code || "HTTP_ERROR",
        value.error?.details,
      );
    return value.result;
  };
  const query = <T>(name: string, args: Record<string, unknown>) =>
    request<T>("/api/query", { query: name, args });
  const heartbeat = () =>
    runId
      ? request("/api/command", {
          operation: "run_heartbeat",
          args: {
            run_id: runId,
            observation: "adapter",
            note: "pi extension lifecycle",
          },
        })
      : Promise.resolve();
  const reportError = (error: unknown, ctx?: ExtensionContext) => {
    if (!warned) {
      warned = true;
      ctx?.ui?.notify?.(`Relayboard: ${errorInfo(error).message}`, "warning");
    }
  };
  if (typeof pi.registerMcpServer === "function")
    pi.registerMcpServer("relayboard", {
      url: `${url}/mcp`,
      headers: process.env.RELAYBOARD_TOKEN
        ? { Authorization: `Bearer ${process.env.RELAYBOARD_TOKEN}` }
        : {},
      exposure: "codemode",
      description:
        "Shared persistent tasks, nested subagent coordination, atomic claims and context handoff.",
    });

  pi.on("session_start", async (_event, ctx) => {
    clearInterval(timer);
    guidedSupported = undefined;
    try {
      await heartbeat();
    } catch (e) {
      reportError(e, ctx);
    }
    if (runId) {
      timer = setInterval(
        () => heartbeat().catch((e) => reportError(e, ctx)),
        30000,
      );
      timer.unref?.();
    }
  });
  pi.on("before_agent_start", async (_event, ctx) => {
    if (!runId) return;
    try {
      const inbox = await query<InboxMessage[]>("inbox", {
        run_id: runId,
        limit: 12,
      });
      let guide: Guide | null = null;
      if (taskId && guidedSupported !== false) {
        try {
          guide = await query<Guide>("work_next", {
            run_id: runId,
            task_id: taskId,
            max_chars: 6000,
          });
          if (!guide || typeof guide.stage !== "string" || !guide.next_action)
            throw new ClientError(
              "The service returned an invalid work guide; inspect Relayboard before editing.",
              "GUIDE_INVALID",
            );
          guidedSupported = true;
        } catch (error) {
          if (errorInfo(error).code !== "UNKNOWN_QUERY") throw error;
          guidedSupported = false;
        }
      }
      const packet =
        guide?.context ||
        (taskId && !guide
          ? await query<Packet>("context", { task_id: taskId, max_chars: 6000 })
          : null);
      // Task version alone misses contract updates, dependency receipts and changed message bodies.
      const content = taskId
        ? renderInjection(runId, packet, guide, inbox)
        : `Relayboard Run: ${runId}. Call relay_work_start with this run_id to find eligible work before editing.\n\n${workflowRules}\n\nDirected inbox (bounded; read relay_inbox for full bodies):\n${
            inbox
              .map((m) => `${m.id}: ${m.body.slice(0, 500)}`)
              .join("\n")
              .slice(0, 1800) || "No unread messages."
          }`;
      const next = createHash("sha256")
        .update(
          JSON.stringify({
            packet,
            inbox,
            guide: guide && {
              stage: guide.stage,
              handle: guide.handle,
              next_action: guide.next_action,
              checklist: guide.checklist,
              current_step: guide.current_step,
              completed_steps: guide.completed_steps,
              warnings: guide.warnings,
              decisions: guide.decisions,
              dependencies: guide.dependencies,
            },
          }),
        )
        .digest("hex");
      if (signature === next) return;
      signature = next;
      return {
        message: { customType: "relayboard-context", content, display: false },
      };
    } catch (e) {
      reportError(e, ctx);
    }
  });
  pi.on("session_before_compact", async (_event, ctx) => {
    if (!taskId) return;
    try {
      const result = await request<{ path: string }>("/api/export", {
        task_id: taskId,
      });
      pi.appendEntry?.("relayboard-snapshot", {
        task_id: taskId,
        path: result.path,
        at: new Date().toISOString(),
        source: "persisted-task-records",
        captures_unsaved_progress: false,
      });
      // Exports the last real task checkpoint; it does not invent progress or replace pi's compaction.
    } catch (e) {
      reportError(e, ctx);
    }
  });
  pi.on("session_compact", async () => {
    signature = "";
    guidedSupported = undefined;
  });
  pi.on("session_shutdown", async () => {
    clearInterval(timer);
    timer = undefined;
    if (taskId)
      try {
        await request<{ path: string }>("/api/export", { task_id: taskId });
      } catch {
        /* Last persisted checkpoints remain available. */
      }
    // No auto-release: native descendants may still be active, and shutdown is not proof they stopped.
  });
}
