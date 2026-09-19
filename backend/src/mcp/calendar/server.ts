import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import * as calendarService from "./calendarService.js";

/**
 * Factory that creates and configures the local CloseFuture Calendar MCP Server.
 */
export function createCalendarServer(): McpServer {
  const server = new McpServer({
    name: "closefuture-calendar",
    version: "1.0.0",
  });

  // TOOL 1: get_available_slots
  server.registerTool(
    "get_available_slots",
    {
      description:
        "Finds 2-3 genuine available meeting slots on CloseFuture calendar within business hours, checked against real Google Calendar free/busy.",
      inputSchema: {
        startDate: z
          .string()
          .optional()
          .describe("ISO 8601 start date for search window (defaults to tomorrow if after business hours)"),
        endDate: z
          .string()
          .optional()
          .describe("ISO 8601 end date for search window (defaults to 7 days ahead)"),
        visitorTimezone: z
          .string()
          .describe("Visitor timezone identifier, e.g. Asia/Kolkata, America/New_York, UTC"),
        durationMinutes: z
          .number()
          .optional()
          .describe("Meeting duration in minutes, default is 30"),
      },
    },
    async ({ startDate, endDate, visitorTimezone, durationMinutes }) => {
      try {
        console.error(
          `[MCP:Calendar] Tool 'get_available_slots' called for timezone: ${visitorTimezone}`
        );
        const slots = await calendarService.findAvailableSlots({
          startDate,
          endDate,
          visitorTimezone,
          durationMinutes,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                count: slots.length,
                slots,
              }),
            },
          ],
        };
      } catch (err: any) {
        console.error("[MCP:Calendar] Error in get_available_slots:", err?.message || err);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: false,
                error_code: "SLOTS_LOOKUP_FAILED",
                message: err?.message || "Failed to retrieve available slots.",
                retryable: true,
              }),
            },
          ],
        };
      }
    }
  );

  // TOOL 2: book_discovery_call
  server.registerTool(
    "book_discovery_call",
    {
      description:
        "Books a discovery call on CloseFuture's primary calendar. Performs race-condition safety re-check, generates a Google Meet conference, and invites the visitor.",
      inputSchema: {
        slotStart: z.string().describe("ISO 8601 start timestamp for booking"),
        slotEnd: z.string().describe("ISO 8601 end timestamp for booking"),
        visitorEmail: z
          .string()
          .email()
          .describe("Visitor's email address to receive calendar invitation"),
        visitorTimezone: z.string().describe("Visitor's timezone"),
        summary: z.string().optional().describe("Optional meeting summary"),
        description: z.string().optional().describe("Optional meeting description"),
      },
    },
    async ({ slotStart, slotEnd, visitorEmail, visitorTimezone, summary, description }) => {
      try {
        console.error(
          `[MCP:Calendar] Tool 'book_discovery_call' called for ${visitorEmail} at ${slotStart}`
        );

        const result = await calendarService.createEvent({
          start: slotStart,
          end: slotEnd,
          visitorEmail,
          timezone: visitorTimezone,
          summary,
          description,
        });

        if (!result.success) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: JSON.stringify(result),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result),
            },
          ],
        };
      } catch (err: any) {
        console.error("[MCP:Calendar] Error in book_discovery_call:", err?.message || err);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: false,
                error_code: "BOOKING_FAILED",
                message: err?.message || "Failed to book discovery call.",
                retryable: false,
              }),
            },
          ],
        };
      }
    }
  );

  // TOOL 3: reschedule_discovery_call
  server.registerTool(
    "reschedule_discovery_call",
    {
      description:
        "Reschedules an existing discovery call to a new verified time slot while preserving the existing event ID.",
      inputSchema: {
        eventId: z.string().describe("Google Calendar event ID of the call to reschedule"),
        newSlotStart: z.string().describe("ISO 8601 start timestamp of new slot"),
        newSlotEnd: z.string().describe("ISO 8601 end timestamp of new slot"),
        visitorTimezone: z.string().describe("Visitor's timezone"),
        visitorEmail: z.string().optional().describe("Visitor email"),
      },
    },
    async ({ eventId, newSlotStart, newSlotEnd, visitorTimezone, visitorEmail }) => {
      try {
        console.error(
          `[MCP:Calendar] Tool 'reschedule_discovery_call' called for event ${eventId} to ${newSlotStart}`
        );

        const result = await calendarService.updateEvent({
          eventId,
          newStart: newSlotStart,
          newEnd: newSlotEnd,
          timezone: visitorTimezone,
          visitorEmail,
        });

        if (!result.success) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: JSON.stringify(result),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result),
            },
          ],
        };
      } catch (err: any) {
        console.error("[MCP:Calendar] Error in reschedule_discovery_call:", err?.message || err);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: false,
                error_code: "RESCHEDULE_FAILED",
                message: err?.message || "Failed to reschedule discovery call.",
                retryable: false,
              }),
            },
          ],
        };
      }
    }
  );

  // TOOL 4: cancel_discovery_call
  server.registerTool(
    "cancel_discovery_call",
    {
      description:
        "Cancels and deletes an existing discovery call from CloseFuture's Google Calendar.",
      inputSchema: {
        eventId: z.string().describe("Google Calendar event ID to cancel and remove"),
      },
    },
    async ({ eventId }) => {
      try {
        console.error(`[MCP:Calendar] Tool 'cancel_discovery_call' called for event ${eventId}`);
        const result = await calendarService.deleteEvent(eventId);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result),
            },
          ],
        };
      } catch (err: any) {
        console.error("[MCP:Calendar] Error in cancel_discovery_call:", err?.message || err);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: false,
                eventId,
                message: err?.message || "Failed to cancel discovery call.",
              }),
            },
          ],
        };
      }
    }
  );

  return server;
}
