import {
  getAvailableSlots,
  bookDiscoveryCall,
  rescheduleDiscoveryCall,
  cancelDiscoveryCall,
} from "../mcp/calendar/mcpClient.js";
import {
  getSession,
  updateSession,
  logAgentEvent,
} from "../db/sessionRepository.js";
import type {
  SchedulerInput,
  SchedulerOutput,
} from "../types/agent.js";

/**
 * Classifies an error into retryable or non-retryable for the Scheduler Agent.
 */
function classifyError(err: any): { errorCode: string; message: string; retryable: boolean } {
  const message = err?.message || String(err) || "Unknown scheduling error";
  const code = err?.error_code || err?.code || "SCHEDULER_ERROR";

  // Retryable: rate limits, network timeouts, transient 5xx server issues
  const isRetryable =
    code === "RATE_LIMIT_EXCEEDED" ||
    code === "TIMEOUT" ||
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    (typeof code === "number" && code >= 500 && code <= 599) ||
    /timeout|network|econnrefused|503|502|429/i.test(message);

  return {
    errorCode: typeof code === "string" ? code : "CALENDAR_API_ERROR",
    message: isRetryable
      ? "Temporary connectivity issue with calendar service. Please retry in a moment."
      : message,
    retryable: Boolean(isRetryable),
  };
}

/**
 * Executes the Scheduler Agent workflow:
 * Validates inputs -> Interacts with Calendar MCP Server via MCP Client -> Updates Session State.
 *
 * Strictly does NOT import googleapis.
 */
export async function executeSchedulerAgent(
  input: SchedulerInput
): Promise<SchedulerOutput> {
  const {
    sessionId,
    action,
    visitorEmail: inputEmail,
    visitorTimezone: inputTz,
    requestedStart,
    requestedEnd,
    eventId: inputEventId,
  } = input;

  await logAgentEvent(
    sessionId,
    "scheduler",
    "SCHEDULER_REQUEST",
    { action, requestedStart, requestedEnd },
    null,
    "received"
  ).catch((err) => console.warn("[Log Warning]:", err?.message));

  try {
    // 1. Load session context
    const session = await getSession(sessionId).catch(() => null);
    const email = inputEmail || session?.email || undefined;
    const timezone = inputTz || session?.timezone || undefined;
    const activeEventId = inputEventId || session?.booked_event_id || undefined;

    // -------------------------------------------------------------------------
    // ACTION: find_slots
    // -------------------------------------------------------------------------
    if (action === "find_slots") {
      if (!timezone) {
        return {
          status: "needs_information",
          action,
          message:
            "Please provide your timezone so I can show available times in your local time.",
        };
      }

      await logAgentEvent(
        sessionId,
        "scheduler",
        "AVAILABILITY_CHECK",
        { timezone },
        null,
        "in_progress"
      ).catch((err) => console.warn("[Log Warning]:", err?.message));

      await logAgentEvent(
        sessionId,
        "scheduler",
        "MCP_CALL",
        { tool: "get_available_slots", arguments: { visitorTimezone: timezone } },
        null,
        "calling"
      ).catch((err) => console.warn("[Log Warning]:", err?.message));

      const res = await getAvailableSlots({ visitorTimezone: timezone });

      await logAgentEvent(
        sessionId,
        "scheduler",
        "MCP_RESULT",
        { tool: "get_available_slots" },
        { success: res.success, count: res.count },
        res.success ? "success" : "failed"
      ).catch((err) => console.warn("[Log Warning]:", err?.message));

      if (!res.success || !res.slots || res.slots.length === 0) {
        return {
          status: "error",
          action,
          message:
            res.message ||
            "Unable to find open slots in the upcoming days. Please suggest a preferred date or contact us directly.",
          error: {
            error_code: res.error_code || "NO_SLOTS_AVAILABLE",
            message: res.message || "No open slots found.",
            retryable: true,
            agent: "scheduler",
          },
        };
      }

      const slotListText = res.slots
        .map((s, idx) => `${idx + 1}. ${s.display}`)
        .join("\n");

      return {
        status: "success",
        action,
        message: `Here are upcoming available times for a 30-minute discovery call:\n\n${slotListText}\n\nWhich slot works best for you? Please reply with your chosen slot and email address.`,
        slots: res.slots,
      };
    }

    // -------------------------------------------------------------------------
    // ACTION: book
    // -------------------------------------------------------------------------
    if (action === "book") {
      // Validate mandatory details
      if (!timezone) {
        return {
          status: "needs_information",
          action,
          message:
            "Please provide your timezone so I can show available times in your local time.",
        };
      }

      if (!email) {
        return {
          status: "needs_information",
          action,
          message:
            "Please provide your email address so I can send the calendar invitation.",
        };
      }

      if (!requestedStart || !requestedEnd) {
        // Needs a confirmed slot selection
        const slotLookup = await getAvailableSlots({ visitorTimezone: timezone });
        const slotText = slotLookup.slots
          ? "\n\n" + slotLookup.slots.map((s, i) => `${i + 1}. ${s.display}`).join("\n")
          : "";

        return {
          status: "needs_information",
          action,
          message: `Please select one of the available times below to confirm your booking:${slotText}`,
          slots: slotLookup.slots,
        };
      }

      await logAgentEvent(
        sessionId,
        "scheduler",
        "BOOKING_RECHECK",
        { requestedStart, requestedEnd, email, timezone },
        null,
        "in_progress"
      ).catch((err) => console.warn("[Log Warning]:", err?.message));

      await logAgentEvent(
        sessionId,
        "scheduler",
        "MCP_CALL",
        {
          tool: "book_discovery_call",
          arguments: {
            slotStart: requestedStart,
            slotEnd: requestedEnd,
            visitorEmail: email,
            visitorTimezone: timezone,
          },
        },
        null,
        "calling"
      ).catch((err) => console.warn("[Log Warning]:", err?.message));

      const bookingRes = await bookDiscoveryCall({
        slotStart: requestedStart,
        slotEnd: requestedEnd,
        visitorEmail: email,
        visitorTimezone: timezone,
      });

      await logAgentEvent(
        sessionId,
        "scheduler",
        "MCP_RESULT",
        { tool: "book_discovery_call" },
        { success: bookingRes.success, eventId: bookingRes.eventId },
        bookingRes.success ? "success" : "failed"
      ).catch((err) => console.warn("[Log Warning]:", err?.message));

      // Check slot conflict or unavailability
      if (!bookingRes.success) {
        if (bookingRes.error_code === "SLOT_NO_LONGER_AVAILABLE") {
          return {
            status: "slot_unavailable",
            action,
            message:
              "That time slot was just booked or is no longer available. Let me find fresh available slots for you.",
            error: {
              error_code: "SLOT_NO_LONGER_AVAILABLE",
              message: "Requested slot is no longer available.",
              retryable: false,
              agent: "scheduler",
            },
          };
        }

        return {
          status: "error",
          action,
          message:
            bookingRes.message ||
            "We were unable to complete the booking. Please try again.",
          error: {
            error_code: bookingRes.error_code || "BOOKING_FAILED",
            message: bookingRes.message || "Failed to create booking.",
            retryable: Boolean(bookingRes.retryable),
            agent: "scheduler",
          },
        };
      }

      // Update session with booking metadata using optimistic concurrency
      if (session && bookingRes.eventId) {
        try {
          await updateSession(session.id, session.version, {
            email,
            timezone,
            booked_event_id: bookingRes.eventId,
          });
        } catch (updateErr: any) {
          console.warn(
            "[Scheduler] Concurrency update warning when saving booking to session:",
            updateErr?.message
          );
        }
      }

      await logAgentEvent(
        sessionId,
        "scheduler",
        "BOOKING_CREATED",
        { eventId: bookingRes.eventId, start: bookingRes.start, email },
        { meetLink: bookingRes.meetLink },
        "success"
      ).catch((err) => console.warn("[Log Warning]:", err?.message));

      const meetInfo = bookingRes.meetLink
        ? `\n\nGoogle Meet: ${bookingRes.meetLink}`
        : "";

      return {
        status: "success",
        action,
        message: `Your CloseFuture Discovery Call has been confirmed! An invitation has been sent to ${email}.${meetInfo}`,
        booking: {
          eventId: bookingRes.eventId!,
          meetLink: bookingRes.meetLink,
          htmlLink: bookingRes.htmlLink,
          start: bookingRes.start!,
          end: bookingRes.end!,
          timezone: bookingRes.timezone!,
          attendeeEmail: email,
        },
      };
    }

    // -------------------------------------------------------------------------
    // ACTION: reschedule
    // -------------------------------------------------------------------------
    if (action === "reschedule") {
      if (!activeEventId) {
        return {
          status: "needs_information",
          action,
          message:
            "I couldn't find an existing booked call for this session to reschedule. Please provide your booking details or request a new booking.",
        };
      }

      if (!timezone) {
        return {
          status: "needs_information",
          action,
          message:
            "Please provide your timezone so I can show available times for rescheduling.",
        };
      }

      if (!requestedStart || !requestedEnd) {
        const slotsRes = await getAvailableSlots({ visitorTimezone: timezone });
        const slotText = slotsRes.slots
          ? "\n\n" + slotsRes.slots.map((s, i) => `${i + 1}. ${s.display}`).join("\n")
          : "";

        return {
          status: "needs_information",
          action,
          message: `Please choose a new time slot to reschedule your call:${slotText}`,
          slots: slotsRes.slots,
        };
      }

      await logAgentEvent(
        sessionId,
        "scheduler",
        "MCP_CALL",
        {
          tool: "reschedule_discovery_call",
          arguments: {
            eventId: activeEventId,
            newSlotStart: requestedStart,
            newSlotEnd: requestedEnd,
            visitorTimezone: timezone,
          },
        },
        null,
        "calling"
      ).catch((err) => console.warn("[Log Warning]:", err?.message));

      const res = await rescheduleDiscoveryCall({
        eventId: activeEventId,
        newSlotStart: requestedStart,
        newSlotEnd: requestedEnd,
        visitorTimezone: timezone,
        visitorEmail: email,
      });

      await logAgentEvent(
        sessionId,
        "scheduler",
        "MCP_RESULT",
        { tool: "reschedule_discovery_call" },
        { success: res.success },
        res.success ? "success" : "failed"
      ).catch((err) => console.warn("[Log Warning]:", err?.message));

      if (!res.success) {
        if (res.error_code === "SLOT_NO_LONGER_AVAILABLE") {
          return {
            status: "slot_unavailable",
            action,
            message:
              "The requested new time slot is not available. Please choose a different slot.",
            error: {
              error_code: "SLOT_NO_LONGER_AVAILABLE",
              message: "Slot unavailable for reschedule.",
              retryable: false,
              agent: "scheduler",
            },
          };
        }

        return {
          status: "error",
          action,
          message: res.message || "Failed to reschedule your discovery call.",
          error: {
            error_code: res.error_code || "RESCHEDULE_FAILED",
            message: res.message || "Reschedule operation failed.",
            retryable: Boolean(res.retryable),
            agent: "scheduler",
          },
        };
      }

      await logAgentEvent(
        sessionId,
        "scheduler",
        "RESCHEDULE",
        { eventId: activeEventId, newStart: requestedStart },
        { meetLink: res.meetLink },
        "success"
      ).catch((err) => console.warn("[Log Warning]:", err?.message));

      return {
        status: "success",
        action,
        message: `Your discovery call has been successfully rescheduled to the new time. Updated details have been sent to ${email || "your email"}.`,
        booking: {
          eventId: res.eventId!,
          meetLink: res.meetLink,
          htmlLink: res.htmlLink,
          start: res.start!,
          end: res.end!,
          timezone: res.timezone!,
          attendeeEmail: email || "",
        },
      };
    }

    // -------------------------------------------------------------------------
    // ACTION: cancel
    // -------------------------------------------------------------------------
    if (action === "cancel") {
      if (!activeEventId) {
        return {
          status: "needs_information",
          action,
          message:
            "I couldn't find an active booking associated with this session to cancel.",
        };
      }

      await logAgentEvent(
        sessionId,
        "scheduler",
        "MCP_CALL",
        { tool: "cancel_discovery_call", arguments: { eventId: activeEventId } },
        null,
        "calling"
      ).catch((err) => console.warn("[Log Warning]:", err?.message));

      const res = await cancelDiscoveryCall({ eventId: activeEventId });

      await logAgentEvent(
        sessionId,
        "scheduler",
        "MCP_RESULT",
        { tool: "cancel_discovery_call" },
        { success: res.success },
        res.success ? "success" : "failed"
      ).catch((err) => console.warn("[Log Warning]:", err?.message));

      if (!res.success) {
        return {
          status: "error",
          action,
          message: res.message || "Failed to cancel your booking. Please contact support.",
          error: {
            error_code: "CANCELLATION_FAILED",
            message: res.message || "Failed to cancel booking.",
            retryable: true,
            agent: "scheduler",
          },
        };
      }

      // Clear booked_event_id in session
      if (session) {
        try {
          await updateSession(session.id, session.version, {
            booked_event_id: null,
          });
        } catch (updateErr: any) {
          console.warn(
            "[Scheduler] Warning updating session on cancel:",
            updateErr?.message
          );
        }
      }

      await logAgentEvent(
        sessionId,
        "scheduler",
        "CANCELLATION",
        { eventId: activeEventId },
        null,
        "success"
      ).catch((err) => console.warn("[Log Warning]:", err?.message));

      return {
        status: "success",
        action,
        message: "Your discovery call has been successfully cancelled.",
      };
    }

    // Unknown action
    return {
      status: "error",
      action: String(action),
      message: "Unsupported scheduler action.",
      error: {
        error_code: "INVALID_ACTION",
        message: `Action '${action}' is not recognized.`,
        retryable: false,
        agent: "scheduler",
      },
    };
  } catch (error: any) {
    console.error("[SchedulerAgent Error]:", error?.message || error);
    const classified = classifyError(error);

    await logAgentEvent(
      sessionId,
      "scheduler",
      "SCHEDULER_ERROR",
      { action, requestedStart },
      { error: classified.message },
      "error",
      classified.errorCode,
      classified.retryable
    ).catch((err) => console.warn("[Log Warning]:", err?.message));

    return {
      status: "error",
      action,
      message: classified.message,
      error: {
        error_code: classified.errorCode,
        message: classified.message,
        retryable: classified.retryable,
        agent: "scheduler",
      },
    };
  }
}
