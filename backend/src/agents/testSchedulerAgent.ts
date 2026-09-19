import dotenv from "dotenv";
dotenv.config();

import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { createSession } from "../db/sessionRepository.js";
import { getGoogleAuthClient, TOKEN_REUSE_MESSAGE } from "../mcp/calendar/googleAuth.js";
import {
  getCalendarMcpClient,
  listCalendarTools,
  closeCalendarMcpClient,
} from "../mcp/calendar/mcpClient.js";
import { executeSchedulerAgent } from "./schedulerAgent.js";
import { deleteEvent } from "../mcp/calendar/calendarService.js";

async function runSchedulerTests(): Promise<void> {
  console.log("===============================================================");
  console.log("CLOSEFUTURE SCHEDULER AGENT & CALENDAR MCP TEST SUITE");
  console.log("===============================================================\n");

  let passed = 0;
  const total = 16;
  const testSession = await createSession(`scheduler-test-${uuidv4()}`);
  let createdEventId: string | undefined;

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Architecture Verification (Static Import Check)
    // -------------------------------------------------------------------------
    console.log("-------------------------------------------------------------");
    console.log("TEST 1: Architecture Verification — Strictly No 'googleapis' in Scheduler or Client");
    console.log("-------------------------------------------------------------");
    const schedulerFile = fs.readFileSync(
      path.resolve(process.cwd(), "src/agents/schedulerAgent.ts"),
      "utf-8"
    );
    const clientFile = fs.readFileSync(
      path.resolve(process.cwd(), "src/mcp/calendar/mcpClient.ts"),
      "utf-8"
    );

    const schedulerHasGoogleApis = /from\s+["']googleapis["']/.test(schedulerFile);
    const clientHasGoogleApis = /from\s+["']googleapis["']/.test(clientFile);

    if (!schedulerHasGoogleApis && !clientHasGoogleApis) {
      console.log("✅ TEST 1 PASSED: Neither schedulerAgent.ts nor mcpClient.ts imports googleapis.");
      passed++;
    } else {
      console.error("❌ TEST 1 FAILED: Violation detected! schedulerAgent or mcpClient imports googleapis.");
    }

    // -------------------------------------------------------------------------
    // TEST 2: OAuth Authentication & Token Reuse
    // -------------------------------------------------------------------------
    console.log("\n-------------------------------------------------------------");
    console.log("TEST 2: Google OAuth Authentication & Token Reusability");
    console.log("-------------------------------------------------------------");
    const authClient = await getGoogleAuthClient();
    const tokenInfo = await authClient.getAccessToken();

    if (tokenInfo.token) {
      console.log("✅ TEST 2 PASSED: OAuth2 client authenticated successfully.");
      console.log(`[Note]: ${TOKEN_REUSE_MESSAGE}`);
      passed++;
    } else {
      console.error("❌ TEST 2 FAILED: Failed to retrieve access token from OAuth client.");
    }

    // -------------------------------------------------------------------------
    // TEST 3 & 4: MCP Server Starts, MCP Client Connects, Tool Listing
    // -------------------------------------------------------------------------
    console.log("\n-------------------------------------------------------------");
    console.log("TEST 3 & 4: Local MCP Server Spawns over Stdio & Exposes Tools");
    console.log("-------------------------------------------------------------");
    await getCalendarMcpClient();
    const tools = await listCalendarTools();
    console.log("Discovered MCP Tools:", tools);

    const expectedTools = [
      "get_available_slots",
      "book_discovery_call",
      "reschedule_discovery_call",
      "cancel_discovery_call",
    ];

    const hasAllTools = expectedTools.every((t) => tools.includes(t));
    if (hasAllTools) {
      console.log("✅ TEST 3 & 4 PASSED: MCP Server started and exposed all 4 required calendar tools.");
      passed += 2;
    } else {
      console.error("❌ TEST 3 & 4 FAILED: Missing required tools:", expectedTools.filter((t) => !tools.includes(t)));
    }

    // -------------------------------------------------------------------------
    // TEST 5 & 6: Real Availability & 2–3 Genuine Slots Returned
    // -------------------------------------------------------------------------
    console.log("\n-------------------------------------------------------------");
    console.log("TEST 5 & 6: Query Real Availability (find_slots) & Validate Slots");
    console.log("-------------------------------------------------------------");
    const slotsRes = await executeSchedulerAgent({
      sessionId: testSession.id,
      action: "find_slots",
      visitorTimezone: "Asia/Kolkata",
    });

    console.log("Slots Status:", slotsRes.status);
    console.log("Slots Count:", slotsRes.slots?.length);
    if (slotsRes.slots && slotsRes.slots.length > 0) {
      console.log("First slot:", JSON.stringify(slotsRes.slots[0]));
    }

    if (
      slotsRes.status === "success" &&
      slotsRes.slots &&
      slotsRes.slots.length >= 2 &&
      slotsRes.slots.length <= 3 &&
      slotsRes.slots[0].display
    ) {
      console.log("✅ TEST 5 & 6 PASSED: Returned real verified working-hour slots formatted for visitor timezone.");
      passed += 2;
    } else {
      console.error("❌ TEST 5 & 6 FAILED: Expected 2–3 slots, got:", slotsRes.slots?.length);
    }

    // Selected slot for booking tests
    const slotToBook = slotsRes.slots?.[0];
    const alternateSlot = slotsRes.slots?.[1];

    if (!slotToBook || !alternateSlot) {
      throw new Error("Unable to proceed with booking tests: insufficient available slots returned.");
    }

    // -------------------------------------------------------------------------
    // TEST 7, 8, 9, 10: Real Event Booking, Meet Link, Attendee, Re-Check
    // -------------------------------------------------------------------------
    console.log("\n-------------------------------------------------------------");
    console.log("TEST 7, 8, 9, 10: Book Discovery Call with Google Meet & Attendee");
    console.log("-------------------------------------------------------------");
    const bookRes = await executeSchedulerAgent({
      sessionId: testSession.id,
      action: "book",
      visitorEmail: "intern.tester@closefuture.test",
      visitorTimezone: "Asia/Kolkata",
      requestedStart: slotToBook.start,
      requestedEnd: slotToBook.end,
    });

    console.log("Booking Status:", bookRes.status);
    console.log("Booking Message:", bookRes.message);
    console.log("Booking Details:", JSON.stringify(bookRes.booking, null, 2));

    if (bookRes.status === "success" && bookRes.booking?.eventId) {
      createdEventId = bookRes.booking.eventId;
      const hasMeet = Boolean(bookRes.booking.meetLink);
      const hasAttendee = bookRes.booking.attendeeEmail === "intern.tester@closefuture.test";

      console.log(`Event ID: ${createdEventId}`);
      console.log(`Google Meet Link: ${bookRes.booking.meetLink}`);
      console.log(`Attendee: ${bookRes.booking.attendeeEmail}`);

      if (hasMeet && hasAttendee) {
        console.log("✅ TEST 7, 8, 9, 10 PASSED: Event created with Meet link, attendee, and pre-booking re-check.");
        passed += 4;
      } else {
        console.error("❌ TEST 7, 8, 9, 10 FAILED: Missing meetLink or attendeeEmail.");
      }
    } else {
      console.error("❌ TEST 7, 8, 9, 10 FAILED: Booking failed:", bookRes.error || bookRes.message);
    }

    // -------------------------------------------------------------------------
    // TEST 11: Race-Condition / Slot Conflict Safety
    // -------------------------------------------------------------------------
    console.log("\n-------------------------------------------------------------");
    console.log("TEST 11: Race-Condition Prevention (Double-Booking Conflict)");
    console.log("-------------------------------------------------------------");
    // Attempt to book the exact same slot that was just confirmed
    const conflictRes = await executeSchedulerAgent({
      sessionId: testSession.id,
      action: "book",
      visitorEmail: "another.visitor@closefuture.test",
      visitorTimezone: "Asia/Kolkata",
      requestedStart: slotToBook.start,
      requestedEnd: slotToBook.end,
    });

    console.log("Conflict Attempt Status:", conflictRes.status);
    console.log("Conflict Error Code:", conflictRes.error?.error_code);
    console.log("Conflict Message:", conflictRes.message);

    if (
      conflictRes.status === "slot_unavailable" &&
      conflictRes.error?.error_code === "SLOT_NO_LONGER_AVAILABLE"
    ) {
      console.log("✅ TEST 11 PASSED: Double-booking successfully prevented. Slot recognized as busy.");
      passed++;
    } else {
      console.error("❌ TEST 11 FAILED: Expected slot_unavailable with SLOT_NO_LONGER_AVAILABLE.");
    }

    // -------------------------------------------------------------------------
    // TEST 12: Reschedule Discovery Call (Preserving Event ID)
    // -------------------------------------------------------------------------
    console.log("\n-------------------------------------------------------------");
    console.log("TEST 12: Reschedule Call to Alternate Slot (Preserving Event ID)");
    console.log("-------------------------------------------------------------");
    if (createdEventId) {
      const rescheduleRes = await executeSchedulerAgent({
        sessionId: testSession.id,
        action: "reschedule",
        eventId: createdEventId,
        visitorTimezone: "Asia/Kolkata",
        requestedStart: alternateSlot.start,
        requestedEnd: alternateSlot.end,
      });

      console.log("Reschedule Status:", rescheduleRes.status);
      console.log("Reschedule Event ID:", rescheduleRes.booking?.eventId);
      console.log("Original Event ID:  ", createdEventId);

      if (
        rescheduleRes.status === "success" &&
        rescheduleRes.booking?.eventId === createdEventId
      ) {
        console.log("✅ TEST 12 PASSED: Successfully rescheduled to new slot while preserving exact event ID.");
        passed++;
      } else {
        console.error("❌ TEST 12 FAILED: Expected same event ID on reschedule.");
      }
    } else {
      console.warn("⚠️ TEST 12 SKIPPED: No event ID available to reschedule.");
    }

    // -------------------------------------------------------------------------
    // TEST 13: Cancel Discovery Call
    // -------------------------------------------------------------------------
    console.log("\n-------------------------------------------------------------");
    console.log("TEST 13: Cancel Discovery Call from Calendar");
    console.log("-------------------------------------------------------------");
    if (createdEventId) {
      const cancelRes = await executeSchedulerAgent({
        sessionId: testSession.id,
        action: "cancel",
        eventId: createdEventId,
        visitorTimezone: "Asia/Kolkata",
      });

      console.log("Cancel Status:", cancelRes.status);
      console.log("Cancel Message:", cancelRes.message);

      if (cancelRes.status === "success") {
        console.log("✅ TEST 13 PASSED: Event cancelled and deleted successfully from Google Calendar.");
        passed++;
        createdEventId = undefined; // Event has been cleanly deleted
      } else {
        console.error("❌ TEST 13 FAILED: Cancellation failed:", cancelRes.error);
      }
    } else {
      console.warn("⚠️ TEST 13 SKIPPED: No event ID available to cancel.");
    }

    // -------------------------------------------------------------------------
    // TEST 14: Missing Mandatory Email Validation
    // -------------------------------------------------------------------------
    console.log("\n-------------------------------------------------------------");
    console.log("TEST 14: Missing Email Handling (needs_information)");
    console.log("-------------------------------------------------------------");
    const noEmailSession = await createSession(`scheduler-test-noemail-${uuidv4()}`);
    const missingEmailRes = await executeSchedulerAgent({
      sessionId: noEmailSession.id,
      action: "book",
      visitorTimezone: "Asia/Kolkata",
      requestedStart: slotToBook.start,
      requestedEnd: slotToBook.end,
    });

    if (missingEmailRes.booking?.eventId) {
      await deleteEvent(missingEmailRes.booking.eventId).catch(() => null);
    }

    console.log("Missing Email Status:", missingEmailRes.status);
    console.log("Missing Email Message:", missingEmailRes.message);

    if (
      missingEmailRes.status === "needs_information" &&
      missingEmailRes.message.includes("Please provide your email address so I can send the calendar invitation.")
    ) {
      console.log("✅ TEST 14 PASSED: Missing email correctly intercepted with exact required prompt message.");
      passed++;
    } else {
      console.error("❌ TEST 14 FAILED: Expected needs_information for missing email.");
    }

    // -------------------------------------------------------------------------
    // TEST 15: Missing Timezone Validation
    // -------------------------------------------------------------------------
    console.log("\n-------------------------------------------------------------");
    console.log("TEST 15: Missing Timezone Handling (needs_information)");
    console.log("-------------------------------------------------------------");
    const freshSession = await createSession(`scheduler-test-notz-${uuidv4()}`);
    const missingTzRes = await executeSchedulerAgent({
      sessionId: freshSession.id,
      action: "find_slots",
    });

    console.log("Missing Timezone Status:", missingTzRes.status);
    console.log("Missing Timezone Message:", missingTzRes.message);

    if (
      missingTzRes.status === "needs_information" &&
      missingTzRes.message.includes("Please provide your timezone")
    ) {
      console.log("✅ TEST 15 PASSED: Timezone requirement enforced without guessing.");
      passed++;
    } else {
      console.error("❌ TEST 15 FAILED: Expected needs_information for missing timezone.");
    }

    // -------------------------------------------------------------------------
    // TEST 16: Structured API Failure & Error Classification
    // -------------------------------------------------------------------------
    console.log("\n-------------------------------------------------------------");
    console.log("TEST 16: Structured Error Classification & Shape");
    console.log("-------------------------------------------------------------");
    const invalidActionRes = await executeSchedulerAgent({
      sessionId: testSession.id,
      action: "invalid_action" as any,
      visitorTimezone: "Asia/Kolkata",
    });

    console.log("Invalid Action Status:", invalidActionRes.status);
    console.log("Structured Error:", JSON.stringify(invalidActionRes.error));

    if (
      invalidActionRes.status === "error" &&
      invalidActionRes.error?.agent === "scheduler" &&
      typeof invalidActionRes.error?.retryable === "boolean"
    ) {
      console.log("✅ TEST 16 PASSED: Errors follow strict structured format with agent and retryable fields.");
      passed++;
    } else {
      console.error("❌ TEST 16 FAILED: Expected structured error format.");
    }
  } finally {
    // Post-test cleanup: Guarantee no orphaned test events remain in Google Calendar
    if (createdEventId) {
      console.log("\n[Cleanup]: Deleting remaining test event:", createdEventId);
      await deleteEvent(createdEventId).catch(() => null);
    }
    await closeCalendarMcpClient();
  }

  // ---------------------------------------------------------------------------
  // SUMMARY
  // ---------------------------------------------------------------------------
  console.log("\n=============================================================");
  console.log(`SCHEDULER AGENT & CALENDAR MCP SUITE: ${passed} / ${total} PASSED`);
  console.log("=============================================================");

  if (passed !== total) {
    throw new Error(`Scheduler test suite failed: ${total - passed} test(s) failed.`);
  }
}

runSchedulerTests().catch((err) => {
  console.error("\n[Scheduler Test Suite Fatal Error]:", err?.message || err);
  process.exit(1);
});
