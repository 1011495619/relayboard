#!/usr/bin/env node
/** Claude PreCompact/Stop hook: exports already persisted task facts. It never invents a task summary. */
import { readFileSync } from "node:fs";
import { errorInfo } from "../bin/errors.js";
import { request } from "../bin/client.js";
try {
  const raw = readFileSync(0, "utf8");
  if (raw.trim()) JSON.parse(raw); // Validate hook input, without loading the conversation transcript.
  if (process.env.RELAYBOARD_TASK_ID)
    await request("/api/export", { task_id: process.env.RELAYBOARD_TASK_ID });
  process.stdout.write("{}\n");
} catch (error) {
  console.error(`Relayboard snapshot hook: ${errorInfo(error).message}`);
  // Preserve normal client behavior; ongoing task ownership is not changed.
  process.stdout.write("{}\n");
}
