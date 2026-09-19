import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface AvailableSlotItem {
  start: string;
  end: string;
  display: string;
}

export interface GetSlotsResponse {
  success: boolean;
  count?: number;
  slots?: AvailableSlotItem[];
  error_code?: string;
  message?: string;
  retryable?: boolean;
}

export interface BookingResponse {
  success: boolean;
  eventId?: string;
  htmlLink?: string;
  meetLink?: string;
  start?: string;
  end?: string;
  timezone?: string;
  attendeeEmail?: string;
  error_code?: string;
  message?: string;
  retryable?: boolean;
}

export interface CancelResponse {
  success: boolean;
  eventId: string;
  message?: string;
}

let mcpClientInstance: Client | null = null;
let mcpTransportInstance: StdioClientTransport | null = null;

/**
 * Resolves paths to tsx CLI and runServer.ts regardless of execution directory.
 */
function resolveServerPaths() {
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
  const serverScript = path.join(backendDir, "src", "mcp", "calendar", "runServer.ts");

  if (!fs.existsSync(tsxCli)) {
    throw new Error(`tsx CLI not found at ${tsxCli}`);
  }
  if (!fs.existsSync(serverScript)) {
    throw new Error(`Calendar MCP server script not found at ${serverScript}`);
  }

  return { backendDir, tsxCli, serverScript };
}

/**
 * Obtains or establishes an active connection to the local Calendar MCP Server.
 */
export async function getCalendarMcpClient(): Promise<Client> {
  if (mcpClientInstance) {
    return mcpClientInstance;
  }

  const { backendDir, tsxCli, serverScript } = resolveServerPaths();

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [tsxCli, serverScript],
    cwd: backendDir,
  });

  const client = new Client({
    name: "closefuture-scheduler-client",
    version: "1.0.0",
  });

  await client.connect(transport);

  mcpClientInstance = client;
  mcpTransportInstance = transport;

  return client;
}

/**
 * Gracefully shuts down the MCP client connection.
 */
export async function closeCalendarMcpClient(): Promise<void> {
  if (mcpClientInstance) {
    try {
      await mcpClientInstance.close();
    } catch (err: any) {
      console.error("[MCP Client] Error closing client:", err?.message);
    }
    mcpClientInstance = null;
  }
  if (mcpTransportInstance) {
    try {
      await mcpTransportInstance.close();
    } catch (err: any) {
      console.error("[MCP Client] Error closing transport:", err?.message);
    }
    mcpTransportInstance = null;
  }
}

/**
 * Lists the registered tools on the Calendar MCP Server.
 */
export async function listCalendarTools(): Promise<string[]> {
  const client = await getCalendarMcpClient();
  const res = await client.listTools();
  return (res.tools || []).map((t) => t.name);
}

/**
 * Invokes the 'get_available_slots' MCP tool.
 */
export async function getAvailableSlots(params: {
  startDate?: string;
  endDate?: string;
  visitorTimezone: string;
  durationMinutes?: number;
}): Promise<GetSlotsResponse> {
  const client = await getCalendarMcpClient();

  const result = await client.callTool({
    name: "get_available_slots",
    arguments: params,
  });

  const content = (result.content as Array<{ type: string; text?: string }>) || [];
  const textContent = content.find((c) => c.type === "text")?.text || "{}";
  return JSON.parse(textContent);
}

/**
 * Invokes the 'book_discovery_call' MCP tool.
 */
export async function bookDiscoveryCall(params: {
  slotStart: string;
  slotEnd: string;
  visitorEmail: string;
  visitorTimezone: string;
  summary?: string;
  description?: string;
}): Promise<BookingResponse> {
  const client = await getCalendarMcpClient();

  const result = await client.callTool({
    name: "book_discovery_call",
    arguments: params,
  });

  const content = (result.content as Array<{ type: string; text?: string }>) || [];
  const textContent = content.find((c) => c.type === "text")?.text || "{}";
  return JSON.parse(textContent);
}

/**
 * Invokes the 'reschedule_discovery_call' MCP tool.
 */
export async function rescheduleDiscoveryCall(params: {
  eventId: string;
  newSlotStart: string;
  newSlotEnd: string;
  visitorTimezone: string;
  visitorEmail?: string;
}): Promise<BookingResponse> {
  const client = await getCalendarMcpClient();

  const result = await client.callTool({
    name: "reschedule_discovery_call",
    arguments: params,
  });

  const content = (result.content as Array<{ type: string; text?: string }>) || [];
  const textContent = content.find((c) => c.type === "text")?.text || "{}";
  return JSON.parse(textContent);
}

/**
 * Invokes the 'cancel_discovery_call' MCP tool.
 */
export async function cancelDiscoveryCall(params: {
  eventId: string;
}): Promise<CancelResponse> {
  const client = await getCalendarMcpClient();

  const result = await client.callTool({
    name: "cancel_discovery_call",
    arguments: params,
  });

  const content = (result.content as Array<{ type: string; text?: string }>) || [];
  const textContent = content.find((c) => c.type === "text")?.text || "{}";
  return JSON.parse(textContent);
}
