import dotenv from "dotenv";
dotenv.config();

import { v4 as uuidv4 } from "uuid";
import {
  createSession,
  saveMessage,
} from "../db/sessionRepository.js";
import { executeSearchAgent, type SearchAgentOutput } from "./searchAgent.js";

async function runAllTests(): Promise<void> {
  console.log("===============================================================");
  console.log("CLOSEFUTURE SEARCH AGENT VERIFICATION SUITE");
  console.log("===============================================================\n");

  let passedTests = 0;
  let totalTests = 6;

  // -------------------------------------------------------------
  // TEST 1: Service Query
  // -------------------------------------------------------------
  console.log("-------------------------------------------------------------");
  console.log("TEST 1: What services does CloseFuture provide?");
  console.log("-------------------------------------------------------------");
  const session1 = await createSession(`test-visitor-${uuidv4()}`);
  await saveMessage(session1.id, "user", "What services does CloseFuture provide?");
  const res1 = await executeSearchAgent({
    sessionId: session1.id,
    message: "What services does CloseFuture provide?",
  });
  await saveMessage(session1.id, "assistant", res1.answer, "search");

  console.log("Status:", res1.status);
  console.log("Rewritten Query:", res1.rewrittenQuery);
  console.log("Confidence:", res1.confidence);
  console.log("Retrieved Chunks:", res1.retrievedChunks);
  console.log("Sources:", JSON.stringify(res1.sources, null, 2));
  console.log("Answer Excerpt:", res1.answer.slice(0, 300) + "...\n");

  const hasPage5 = res1.sources.some((s) => s.page === 5);
  if (res1.status === "success" && hasPage5 && res1.confidence > 0) {
    console.log("✅ TEST 1 PASSED: Found Page 5 service details with non-zero confidence.");
    passedTests++;
  } else {
    console.error("❌ TEST 1 FAILED: Expected success, Page 5 source, and positive confidence.");
  }

  // -------------------------------------------------------------
  // TEST 2: Out-of-Domain Query (Office rent in Bangalore)
  // -------------------------------------------------------------
  console.log("\n-------------------------------------------------------------");
  console.log("TEST 2: What is CloseFuture's office rent in Bangalore?");
  console.log("-------------------------------------------------------------");
  const session2 = await createSession(`test-visitor-${uuidv4()}`);
  await saveMessage(session2.id, "user", "What is CloseFuture's office rent in Bangalore?");
  const res2 = await executeSearchAgent({
    sessionId: session2.id,
    message: "What is CloseFuture's office rent in Bangalore?",
  });
  await saveMessage(session2.id, "assistant", res2.answer, "search");

  console.log("Status:", res2.status);
  console.log("Rewritten Query:", res2.rewrittenQuery);
  console.log("Confidence:", res2.confidence);
  console.log("Retrieved Chunks:", res2.retrievedChunks);
  console.log("Sources:", JSON.stringify(res2.sources));
  console.log("Answer:", res2.answer, "\n");

  if (res2.status === "no_answer" && res2.retrievedChunks === 0 && res2.sources.length === 0) {
    console.log("✅ TEST 2 PASSED: Properly declined ungrounded query with no_answer status and 0 chunks.");
    passedTests++;
  } else {
    console.error("❌ TEST 2 FAILED: Expected no_answer status and 0 retrieved chunks.");
  }

  // -------------------------------------------------------------
  // TEST 3: Specific Case Study (Dipy)
  // -------------------------------------------------------------
  console.log("\n-------------------------------------------------------------");
  console.log("TEST 3: Tell me about Dipy.");
  console.log("-------------------------------------------------------------");
  const session3 = await createSession(`test-visitor-${uuidv4()}`);
  await saveMessage(session3.id, "user", "Tell me about Dipy.");
  const res3 = await executeSearchAgent({
    sessionId: session3.id,
    message: "Tell me about Dipy.",
  });
  await saveMessage(session3.id, "assistant", res3.answer, "search");

  console.log("Status:", res3.status);
  console.log("Rewritten Query:", res3.rewrittenQuery);
  console.log("Confidence:", res3.confidence);
  console.log("Retrieved Chunks:", res3.retrievedChunks);
  console.log("Sources:", JSON.stringify(res3.sources, null, 2));
  console.log("Answer Excerpt:", res3.answer.slice(0, 300) + "...\n");

  const hasDipySource = res3.sources.some(
    (s) => s.page === 8 || (s.section && s.section.toLowerCase().includes("dipy"))
  );
  if (res3.status === "success" && hasDipySource && res3.answer.toLowerCase().includes("dipy")) {
    console.log("✅ TEST 3 PASSED: Retrieved Dipy case study with Page 8 metadata.");
    passedTests++;
  } else {
    console.error("❌ TEST 3 FAILED: Expected Dipy case study on Page 8.");
  }

  // -------------------------------------------------------------
  // TEST 4: Employee Wellbeing (Liya AI)
  // -------------------------------------------------------------
  console.log("\n-------------------------------------------------------------");
  console.log("TEST 4: What did CloseFuture build for employee wellbeing?");
  console.log("-------------------------------------------------------------");
  const session4 = await createSession(`test-visitor-${uuidv4()}`);
  await saveMessage(session4.id, "user", "What did CloseFuture build for employee wellbeing?");
  const res4 = await executeSearchAgent({
    sessionId: session4.id,
    message: "What did CloseFuture build for employee wellbeing?",
  });
  await saveMessage(session4.id, "assistant", res4.answer, "search");

  console.log("Status:", res4.status);
  console.log("Rewritten Query:", res4.rewrittenQuery);
  console.log("Confidence:", res4.confidence);
  console.log("Retrieved Chunks:", res4.retrievedChunks);
  console.log("Sources:", JSON.stringify(res4.sources, null, 2));
  console.log("Answer Excerpt:", res4.answer.slice(0, 300) + "...\n");

  const hasLiyaSource = res4.sources.some(
    (s) => s.page === 9 || (s.section && s.section.toLowerCase().includes("liya"))
  );
  const mentionsLiya =
    res4.answer.toLowerCase().includes("liya") ||
    res4.answer.toLowerCase().includes("wellbeing") ||
    res4.answer.toLowerCase().includes("mental");

  if (res4.status === "success" && hasLiyaSource && mentionsLiya) {
    console.log("✅ TEST 4 PASSED: Identified Liya AI case study on Page 9 for employee wellbeing.");
    passedTests++;
  } else {
    console.error("❌ TEST 4 FAILED: Expected Liya AI case study on Page 9.");
  }

  // -------------------------------------------------------------
  // TEST 5: Conversation History Follow-Up ("What technology did they use?")
  // -------------------------------------------------------------
  console.log("\n-------------------------------------------------------------");
  console.log("TEST 5: Follow-up resolution using session conversation history");
  console.log("-------------------------------------------------------------");
  const session5 = await createSession(`test-visitor-${uuidv4()}`);

  // Turn 1
  console.log("Turn 1 - User: 'Tell me about Dipy.'");
  await saveMessage(session5.id, "user", "Tell me about Dipy.");
  const res5a = await executeSearchAgent({
    sessionId: session5.id,
    message: "Tell me about Dipy.",
  });
  await saveMessage(session5.id, "assistant", res5a.answer, "search");
  console.log("Turn 1 Assistant completed.\n");

  // Turn 2
  console.log("Turn 2 - User: 'What technology did they use?'");
  await saveMessage(session5.id, "user", "What technology did they use?");
  const res5b = await executeSearchAgent({
    sessionId: session5.id,
    message: "What technology did they use?",
  });
  await saveMessage(session5.id, "assistant", res5b.answer, "search");

  console.log("Turn 2 Status:", res5b.status);
  console.log("Turn 2 Rewritten Query:", res5b.rewrittenQuery);
  console.log("Turn 2 Confidence:", res5b.confidence);
  console.log("Turn 2 Retrieved Chunks:", res5b.retrievedChunks);
  console.log("Turn 2 Sources:", JSON.stringify(res5b.sources, null, 2));
  console.log("Turn 2 Answer Excerpt:", res5b.answer.slice(0, 300) + "...\n");

  const resolvedEntity =
    res5b.rewrittenQuery.toLowerCase().includes("dipy") ||
    res5b.answer.toLowerCase().includes("node") ||
    res5b.answer.toLowerCase().includes("next.js") ||
    res5b.answer.toLowerCase().includes("postgres");

  if (res5b.status === "success" && resolvedEntity) {
    console.log("✅ TEST 5 PASSED: Follow-up reference 'they' successfully resolved to Dipy.");
    passedTests++;
  } else {
    console.error("❌ TEST 5 FAILED: Query rewrite failed to resolve follow-up reference from session history.");
  }

  // -------------------------------------------------------------
  // TEST 6: Multi-Document Query ("What kinds of AI work does CloseFuture do?")
  // -------------------------------------------------------------
  console.log("\n-------------------------------------------------------------");
  console.log("TEST 6: Multi-document Query: What kinds of AI work does CloseFuture do?");
  console.log("-------------------------------------------------------------");
  const session6 = await createSession(`test-visitor-${uuidv4()}`);
  await saveMessage(session6.id, "user", "What kinds of AI work does CloseFuture do?");
  const res6 = await executeSearchAgent({
    sessionId: session6.id,
    message: "What kinds of AI work does CloseFuture do?",
  });
  await saveMessage(session6.id, "assistant", res6.answer, "search");

  console.log("Status:", res6.status);
  console.log("Rewritten Query:", res6.rewrittenQuery);
  console.log("Confidence:", res6.confidence);
  console.log("Retrieved Chunks Count:", res6.retrievedChunks);
  console.log("Sources Count:", res6.sources.length);
  console.log("Sources:", JSON.stringify(res6.sources, null, 2));
  console.log("Answer Excerpt:", res6.answer.slice(0, 300) + "...\n");

  if (res6.status === "success" && res6.retrievedChunks >= 1) {
    console.log(`✅ TEST 6 PASSED: Retrieved ${res6.retrievedChunks} relevant chunk(s) across CloseFuture AI capabilities.`);
    passedTests++;
  } else {
    console.error("❌ TEST 6 FAILED: Multi-document query failed to retrieve relevant AI chunks.");
  }

  // -------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------
  console.log("\n=============================================================");
  console.log(`TEST SUITE SUMMARY: ${passedTests} / ${totalTests} PASSED`);
  console.log("=============================================================");

  if (passedTests !== totalTests) {
    throw new Error(`Test suite failed: ${totalTests - passedTests} test(s) failed.`);
  }
}

runAllTests().catch((err) => {
  console.error("\n[Search Agent Test Suite Fatal Error]:", err?.message || err);
  process.exit(1);
});
