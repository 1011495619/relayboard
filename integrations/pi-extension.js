/** Optional pi extension. No provider calls, no automatic agent spawning. */
export default function relayboardExtension(pi) {
  const url = process.env.RELAYBOARD_URL || "http://127.0.0.1:4317";
  const runId = process.env.RELAYBOARD_RUN_ID;
  const taskId = process.env.RELAYBOARD_TASK_ID;
  const headers = {
    "Content-Type": "application/json",
    ...(process.env.RELAYBOARD_TOKEN
      ? { Authorization: `Bearer ${process.env.RELAYBOARD_TOKEN}` }
      : {}),
  };
  let timer,
    signature = "",
    warned = false;
  const request = async (path, body) => {
    const response = await fetch(url + path, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    const value = await response.json();
    if (!response.ok)
      throw new Error(value.error?.message || `HTTP ${response.status}`);
    return value.result;
  };
  const query = (name, args) => request("/api/query", { query: name, args });
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
  const reportError = (error, ctx) => {
    if (!warned) {
      warned = true;
      ctx?.ui?.notify?.(`Relayboard: ${error.message}`, "warning");
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
      const inbox = await query("inbox", { run_id: runId, limit: 12 });
      const packet = taskId
        ? await query("context", { task_id: taskId, max_chars: 9000 })
        : null;
      const next = `${packet?.version || ""}:${inbox.map((m) => m.id).join(",")}`;
      if (signature === next) return;
      signature = next;
      const content = `${packet?.markdown || `Relayboard Run: ${runId}. Query eligible work before editing.`}\n\nDirected inbox (acknowledge after receiving):\n${inbox.map((m) => `${m.id}: ${m.body.slice(0, 1200)}`).join("\n") || "No unread messages."}\n\nRegister all native descendants before dispatch; each child needs its own Run ID and claim. Save real progress through task_checkpoint. This injected packet contains prior records, not verification of current files.`;
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
      const result = await request("/api/export", { task_id: taskId });
      pi.appendEntry?.("relayboard-snapshot", {
        task_id: taskId,
        path: result.path,
        at: new Date().toISOString(),
      });
      // Exports the last real task checkpoint; it does not invent progress or replace pi's compaction.
    } catch (e) {
      reportError(e, ctx);
    }
  });
  pi.on("session_compact", async () => {
    signature = "";
  });
  pi.on("session_shutdown", async () => {
    clearInterval(timer);
    timer = undefined;
    if (taskId)
      try {
        await request("/api/export", { task_id: taskId });
      } catch {
        /* Last persisted checkpoints remain available. */
      }
    // No auto-release: native descendants may still be active, and shutdown is not proof they stopped.
  });
}
