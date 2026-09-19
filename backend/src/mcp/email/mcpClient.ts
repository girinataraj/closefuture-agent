import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface SendEmailParams {
  [key: string]: unknown;
  to: string;
  subject: string;
  html: string;
  idempotencyKey: string;
}

export interface SendEmailResult {
  success: boolean;
  status: "sent" | "failed";
  messageId?: string;
  errorCode?: string;
  message?: string;
  retryable?: boolean;
}

let mcpEmailClientInstance: Client | null = null;
let mcpEmailTransportInstance: StdioClientTransport | null = null;

function resolveEmailServerPaths() {
  const possibleRoots = [
    process.cwd(),
    path.resolve(process.cwd(), "backend"),
    path.resolve(__dirname, "../../.."),
  ];

  let backendDir = possibleRoots[0];
  for (const root of possibleRoots) {
    if (fs.existsSync(path.join(root, "node_modules", "tsx", "dist", "cli.mjs"))) {
      backendDir = root;
      break;
    }
  }

  const tsxCli = path.join(backendDir, "node_modules", "tsx", "dist", "cli.mjs");
  const serverScript = path.join(backendDir, "src", "mcp", "email", "runServer.ts");

  if (!fs.existsSync(tsxCli)) {
    throw new Error(`tsx CLI not found at ${tsxCli}`);
  }
  if (!fs.existsSync(serverScript)) {
    throw new Error(`Email MCP server script not found at ${serverScript}`);
  }

  return { backendDir, tsxCli, serverScript };
}

/**
 * Obtains or establishes an active connection to the local Email MCP Server.
 */
export async function getEmailMcpClient(): Promise<Client> {
  if (mcpEmailClientInstance) {
    return mcpEmailClientInstance;
  }

  const { backendDir, tsxCli, serverScript } = resolveEmailServerPaths();

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [tsxCli, serverScript],
    cwd: backendDir,
    env: {
      ...(process.env as Record<string, string>),
    },
  });

  const client = new Client({
    name: "closefuture-email-client",
    version: "1.0.0",
  });

  await client.connect(transport);

  mcpEmailClientInstance = client;
  mcpEmailTransportInstance = transport;

  return client;
}

/**
 * Gracefully shuts down the Email MCP client connection.
 */
export async function closeEmailMcpClient(): Promise<void> {
  if (mcpEmailClientInstance) {
    try {
      await mcpEmailClientInstance.close();
    } catch (err: any) {
      console.error("[Email MCP Client] Error closing client:", err?.message);
    }
    mcpEmailClientInstance = null;
  }
  if (mcpEmailTransportInstance) {
    try {
      await mcpEmailTransportInstance.close();
    } catch (err: any) {
      console.error("[Email MCP Client] Error closing transport:", err?.message);
    }
    mcpEmailTransportInstance = null;
  }
}

/**
 * Lists the registered tools on the Email MCP Server.
 */
export async function listEmailTools(): Promise<string[]> {
  const client = await getEmailMcpClient();
  const res = await client.listTools();
  return (res.tools || []).map((t) => t.name);
}

/**
 * Invokes the 'send_lead_summary' tool on the Email MCP Server.
 */
export async function sendLeadSummaryEmail(
  params: SendEmailParams
): Promise<SendEmailResult> {
  const client = await getEmailMcpClient();

  const result = await client.callTool({
    name: "send_lead_summary",
    arguments: params,
  });

  const content = (result.content as Array<{ type: string; text?: string }>) || [];
  const textContent = content.find((c) => c.type === "text")?.text || "{}";
  return JSON.parse(textContent);
}
