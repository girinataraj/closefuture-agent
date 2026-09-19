import dotenv from "dotenv";
dotenv.config();

import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createEmailServer } from "./server.js";

/**
 * Entry point for running the local CloseFuture Email MCP Server over stdio.
 *
 * CRITICAL RULE:
 * stdout is strictly reserved for the MCP JSON-RPC protocol frames.
 * Any diagnostic, operational, or error messages MUST be written to stderr via console.error.
 */
async function main() {
  console.error("[MCP:Email Server] Initializing CloseFuture Email MCP Server...");

  const server = createEmailServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);
  console.error("[MCP:Email Server] Connected via StdioServerTransport. Ready for requests.");
}

main().catch((error) => {
  console.error("[MCP:Email Server] Fatal server error:", error?.message || error);
  process.exit(1);
});
