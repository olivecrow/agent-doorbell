#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createDoorbellServer } from "./mcp-server.js";

const server = createDoorbellServer();
const shutdown = () => {
  void server.close();
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
process.stdin.once("end", shutdown);
server.connect(new StdioServerTransport()).catch(() => {
  console.error("[doorbell] Could not start the MCP server.");
  process.exitCode = 1;
});
