import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { Resend } from "resend";

/**
 * Local Email MCP Server: closefuture-email
 *
 * CRITICAL ARCHITECTURE RULE:
 * This is the ONLY file in the entire project permitted to import and instantiate the Resend SDK.
 * All other components must communicate through MCP.
 */

function classifyResendError(err: any): { errorCode: string; retryable: boolean; message: string } {
  const message = err?.message || String(err) || "Unknown Resend error";
  const name = err?.name || "EMAIL_SEND_ERROR";
  const statusCode = err?.statusCode;

  // 429 rate limits, timeouts, and 5xx server errors are retryable
  const isRetryable =
    statusCode === 429 ||
    (typeof statusCode === "number" && statusCode >= 500 && statusCode <= 599) ||
    /timeout|network|rate\s*limit|econnreset|etimedout/i.test(message);

  return {
    errorCode: name,
    retryable: isRetryable,
    message,
  };
}

export function createEmailServer(): McpServer {
  const server = new McpServer({
    name: "closefuture-email",
    version: "1.0.0",
  });

  const apiKey = process.env.RESEND_API_KEY?.trim();
  const resend = apiKey ? new Resend(apiKey) : null;
  const defaultFrom = process.env.RESEND_FROM_EMAIL?.trim() || "CloseFuture AI <onboarding@resend.dev>";

  server.registerTool(
    "send_lead_summary",
    {
      description:
        "Dispatches an internal sales lead qualification summary email to the sales inbox using Resend with idempotency guarantees.",
      inputSchema: {
        to: z.string().email().describe("Recipient email address (sales team inbox)"),
        subject: z.string().describe("Email subject line"),
        html: z.string().describe("Formatted HTML email content"),
        idempotencyKey: z
          .string()
          .describe("Unique idempotency key to prevent duplicate email dispatches"),
      },
    },
    async ({ to, subject, html, idempotencyKey }) => {
      console.error(
        `[MCP:Email] Tool 'send_lead_summary' called for recipient: ${to} (idempotencyKey: ${idempotencyKey})`
      );

      const activeKey = process.env.RESEND_API_KEY?.trim() || apiKey;
      const activeResend = activeKey ? new Resend(activeKey) : null;
      const activeFrom = process.env.RESEND_FROM_EMAIL?.trim() || defaultFrom;

      if (!activeResend) {
        console.error("[MCP:Email] Error: RESEND_API_KEY is not configured.");
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: false,
                status: "failed",
                errorCode: "MISSING_API_KEY",
                message: "RESEND_API_KEY is not configured in environment.",
                retryable: false,
              }),
            },
          ],
        };
      }

      try {
        // Mandatory Adjustment: Pass idempotencyKey directly to the Resend SDK options
        const response = await activeResend.emails.send(
          {
            from: activeFrom,
            to: [to],
            subject,
            html,
          },
          {
            idempotencyKey,
          }
        );

        if (response.error) {
          console.error("[MCP:Email] Resend API error:", response.error);
          const classified = classifyResendError(response.error);
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  success: false,
                  status: "failed",
                  errorCode: classified.errorCode,
                  message: classified.message,
                  retryable: classified.retryable,
                }),
              },
            ],
          };
        }

        const messageId = response.data?.id || `resend-${Date.now()}`;
        console.error(`[MCP:Email] Email successfully dispatched. Message ID: ${messageId}`);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                status: "sent",
                messageId,
              }),
            },
          ],
        };
      } catch (err: any) {
        console.error("[MCP:Email] Unexpected error during send:", err?.message || err);
        const classified = classifyResendError(err);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: false,
                status: "failed",
                errorCode: classified.errorCode,
                message: classified.message,
                retryable: classified.retryable,
              }),
            },
          ],
        };
      }
    }
  );

  return server;
}
