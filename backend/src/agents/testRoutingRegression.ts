import dotenv from "dotenv";
dotenv.config();

import { v4 as uuidv4 } from "uuid";
import { createSession } from "../db/sessionRepository.js";
import {
  executeOrchestrator,
  hasSearchSignals,
  hasBookingSignals,
} from "./orchestrator.js";
import { closeCalendarMcpClient } from "../mcp/calendar/mcpClient.js";

interface TestCase {
  id: string;
  query: string;
  expectedPrimary: string;
  expectedIntents: string[];
  expectedStatus: string;
  expectedAnswerSubstring?: string;
  verify: (res: any) => boolean;
}

async function runRoutingRegression(): Promise<void> {
  console.log("===============================================================");
  console.log("CLOSEFUTURE DETERMINISTIC INTENT ROUTING REGRESSION TEST");
  console.log("===============================================================\n");

  // 1. Unit assertions on signal detectors
  console.log("--- SIGNAL DETECTOR UNIT CHECKS ---");
  console.assert(hasSearchSignals("What services does CloseFuture provide?"), "Signal A failed");
  console.assert(hasSearchSignals("Tell me about Dipy"), "Signal B failed");
  console.assert(hasSearchSignals("What is the monthly cost to rent CloseFuture's Namakkal office?"), "Signal C failed");
  console.assert(hasSearchSignals("Who is the founder of CloseFuture?"), "Signal D failed");
  console.assert(hasBookingSignals("Can I book a discovery call?"), "Signal E failed");
  console.assert(hasSearchSignals("Tell me about your services and can I book a discovery call?"), "Signal F search failed");
  console.assert(hasBookingSignals("Tell me about your services and can I book a discovery call?"), "Signal F booking failed");
  console.assert(!hasSearchSignals("asdfghjkl"), "Signal G false positive on search");
  console.assert(!hasBookingSignals("asdfghjkl"), "Signal G false positive on booking");
  console.assert(!hasSearchSignals("what?"), "Signal 'what?' false positive");
  console.assert(!hasSearchSignals("how?"), "Signal 'how?' false positive");
  console.assert(!hasSearchSignals("hello"), "Signal 'hello' false positive");
  console.log("✅ All signal detector unit checks passed.\n");

  // 2. Full Orchestrator execution on the exact required test suite
  const testCases: TestCase[] = [
    {
      id: "A",
      query: "What services does CloseFuture provide?",
      expectedPrimary: "search",
      expectedIntents: ["search"],
      expectedStatus: "success",
      expectedAnswerSubstring: "services",
      verify: (res) =>
        res.status === "success" &&
        res.route.primaryIntent === "search" &&
        res.agent === "search" &&
        res.sources &&
        res.sources.length > 0,
    },
    {
      id: "B",
      query: "Tell me about Dipy",
      expectedPrimary: "search",
      expectedIntents: ["search"],
      expectedStatus: "success",
      expectedAnswerSubstring: "Dipy",
      verify: (res) =>
        res.status === "success" &&
        res.route.primaryIntent === "search" &&
        res.agent === "search" &&
        res.answer.toLowerCase().includes("dipy"),
    },
    {
      id: "C",
      query: "What is the monthly cost to rent CloseFuture's Namakkal office?",
      expectedPrimary: "search",
      expectedIntents: ["search"],
      expectedStatus: "success",
      expectedAnswerSubstring: "reliable information",
      verify: (res) =>
        res.status === "success" &&
        res.route.primaryIntent === "search" &&
        res.agent === "search" &&
        res.answer.toLowerCase().includes("reliable information"),
    },
    {
      id: "D",
      query: "Who is the founder of CloseFuture?",
      expectedPrimary: "search",
      expectedIntents: ["search"],
      expectedStatus: "success",
      verify: (res) =>
        res.status === "success" &&
        res.route.primaryIntent === "search" &&
        res.agent === "search",
    },
    {
      id: "E",
      query: "Can I book a discovery call?",
      expectedPrimary: "booking",
      expectedIntents: ["booking"],
      expectedStatus: "success",
      verify: (res) =>
        res.status === "success" &&
        res.route.primaryIntent === "booking" &&
        res.agent === "scheduler",
    },
    {
      id: "F",
      query: "Tell me about your services and can I book a discovery call?",
      expectedPrimary: "search",
      expectedIntents: ["search", "booking"],
      expectedStatus: "success",
      verify: (res) =>
        res.status === "success" &&
        res.route.primaryIntent === "search" &&
        res.route.intents.includes("booking") &&
        res.agent === "search" &&
        res.pendingAction?.type === "scheduler",
    },
    {
      id: "G",
      query: "asdfghjkl",
      expectedPrimary: "unknown",
      expectedIntents: ["unknown"],
      expectedStatus: "clarification",
      verify: (res) =>
        res.status === "clarification" &&
        (res.route.primaryIntent === "unknown" || res.route.requiresClarification === true) &&
        res.answer.includes("Which would you like to do?"),
    },
  ];

  let passed = 0;

  for (const tc of testCases) {
    console.log(`-------------------------------------------------------------`);
    console.log(`TEST ${tc.id}: "${tc.query}"`);
    console.log(`Expected: ${tc.expectedPrimary} | status: ${tc.expectedStatus}`);
    console.log(`-------------------------------------------------------------`);

    const session = await createSession(`reg-test-${tc.id}-${uuidv4().slice(0, 8)}`);
    const res = await executeOrchestrator({
      sessionId: session.id,
      message: tc.query,
    });

    console.log(`Status: ${res.status}`);
    console.log(`Agent: ${res.agent}`);
    console.log(`Primary Intent: ${res.route.primaryIntent}`);
    console.log(`Intents: ${JSON.stringify(res.route.intents)}`);
    console.log(`Confidence: ${res.route.confidence}`);
    console.log(`Requires Clarification: ${res.route.requiresClarification}`);
    console.log(`Answer Excerpt: ${res.answer.slice(0, 180)}...\n`);

    const ok = tc.verify(res);
    if (ok) {
      console.log(`✅ TEST ${tc.id} PASSED\n`);
      passed++;
    } else {
      console.error(`❌ TEST ${tc.id} FAILED\n`);
    }
  }

  console.log("=============================================================");
  console.log(`ROUTING REGRESSION SUITE: ${passed} / ${testCases.length} PASSED`);
  console.log("=============================================================");

  await closeCalendarMcpClient().catch(() => {});

  if (passed !== testCases.length) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runRoutingRegression().catch((err) => {
  console.error("Regression test fatal error:", err);
  process.exit(1);
});
