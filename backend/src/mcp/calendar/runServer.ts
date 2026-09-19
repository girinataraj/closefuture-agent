import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createCalendarServer } from "./server.js";

/**
 * Entry point for running the local CloseFuture Calendar MCP Server over stdio.
 *
 * CRITICAL RULE:
 * stdout is strictly reserved for the MCP JSON-RPC protocol communication.
 * Any diagnostic, warning, or error messages MUST be written to stderr via console.error.
 */
async function main() {
  console.error("[MCP:Calendar Server] Initializing CloseFuture Calendar MCP Server...");

  const server = createCalendarServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);
  console.error("[MCP:Calendar Server] Connected via StdioServerTransport. Ready for requests.");
}

main().catch((error) => {
  console.error("[MCP:Calendar Server] Fatal server error:", error?.message || error);
  process.exit(1);
});
