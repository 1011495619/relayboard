#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcp } from "../server/mcp.ts";
import { request } from "./client.ts";

const server = createMcp({
  command: (operation, args, request_id) =>
    request("/api/command", { operation, args, request_id }),
  query: (query, args) => request("/api/query", { query, args }),
});
await server.connect(new StdioServerTransport());
