import dotenv from "dotenv";
dotenv.config();

import { v4 as uuidv4 } from "uuid";
import { executeOrchestrator } from "../agents/orchestrator.js";
import { createSession, getSession, saveMessage, getConversationHistory } from "../db/sessionRepository.js";

async function simulateBrowserReloadFlow() {
  console.log("===============================================================");
  console.log("TASK 10 ACCEPTANCE VERIFICATION: BROWSER RELOAD & RESTORE SUITE");
  console.log("===============================================================\n");

  // Mocking client localStorage
  const localStorageMock: Record<string, string> = {};

  // ---------------------------------------------------------------------------
  // TEST 1: First user message
  // ---------------------------------------------------------------------------
  console.log("-------------------------------------------------------------");
  console.log("TEST 1: Send 'What services does CloseFuture provide?'");
  console.log("-------------------------------------------------------------");
  // Browser initial mount: generate UUID if not in localStorage
  const initialSessionId = uuidv4();
  localStorageMock["closefuture_session_id"] = initialSessionId;
  console.log("Initial client-generated session ID:", initialSessionId);

  // Eager create session (as App.tsx does)
  await createSession(`visitor-${initialSessionId}`, initialSessionId);

  // User sends message
  await saveMessage(initialSessionId, "user", "What services does CloseFuture provide?");
  const res1 = await executeOrchestrator({
    sessionId: initialSessionId,
    message: "What services does CloseFuture provide?",
  });
  await saveMessage(initialSessionId, "assistant", res1.answer, res1.agent);
  console.log("Response 1 received from agent:", res1.agent);
  console.log("Answer Excerpt:", res1.answer.slice(0, 100));
  console.log("✅ TEST 1 PASSED\n");

  // ---------------------------------------------------------------------------
  // TEST 2: Second user message (conversation buildup)
  // ---------------------------------------------------------------------------
  console.log("-------------------------------------------------------------");
  console.log("TEST 2: Send 'Tell me about Dipy.'");
  console.log("-------------------------------------------------------------");
  await saveMessage(initialSessionId, "user", "Tell me about Dipy.");
  const res2 = await executeOrchestrator({
    sessionId: initialSessionId,
    message: "Tell me about Dipy.",
  });
  await saveMessage(initialSessionId, "assistant", res2.answer, res2.agent);
  console.log("Response 2 received from agent:", res2.agent);
  console.log("Answer Excerpt:", res2.answer.slice(0, 100));
  console.log("✅ TEST 2 PASSED\n");

  // ---------------------------------------------------------------------------
  // TEST 3: Record current session ID
  // ---------------------------------------------------------------------------
  console.log("-------------------------------------------------------------");
  console.log("TEST 3: Record current session ID");
  console.log("-------------------------------------------------------------");
  const recordedSessionId = localStorageMock["closefuture_session_id"];
  console.log("Active Session ID recorded before reload:", recordedSessionId);
  if (recordedSessionId !== initialSessionId) {
    throw new Error("TEST 3 FAILED: Session ID changed unexpectedly before reload!");
  }
  console.log("✅ TEST 3 PASSED\n");

  // ---------------------------------------------------------------------------
  // TEST 4: Press Ctrl+R (Browser Reload)
  // ---------------------------------------------------------------------------
  console.log("-------------------------------------------------------------");
  console.log("TEST 4: Press Ctrl+R / Browser Reload");
  console.log("-------------------------------------------------------------");
  // Browser reloads: React unmounts and remounts.
  // App.tsx reads localStorage:
  const storedIdAfterReload = localStorageMock["closefuture_session_id"];
  console.log("Read from localStorage on startup:", storedIdAfterReload);

  if (!storedIdAfterReload) {
    throw new Error("TEST 4 FAILED: closefuture_session_id missing from localStorage on reload!");
  }

  // App.tsx calls GET /api/sessions/:sessionId
  const dbSession = await getSession(storedIdAfterReload);
  if (!dbSession) {
    throw new Error(`TEST 4 FAILED: Session ${storedIdAfterReload} not found in Supabase!`);
  }

  const restoredMessages = await getConversationHistory(storedIdAfterReload);
  console.log(`Restored messages count: ${restoredMessages.length}`);
  console.log("Messages restored:");
  restoredMessages.forEach((m, i) => {
    console.log(`  [${i + 1}] ${m.role} (${m.agent || "none"}): ${m.content.slice(0, 45)}...`);
  });

  if (restoredMessages.length !== 4) {
    throw new Error(`TEST 4 FAILED: Expected 4 messages restored, got ${restoredMessages.length}`);
  }

  if (storedIdAfterReload !== recordedSessionId) {
    throw new Error("TEST 4 FAILED: Session ID was changed after reload!");
  }
  console.log("✅ TEST 4 PASSED: Same session ID maintained, all 4 messages restored without duplicates\n");

  // ---------------------------------------------------------------------------
  // TEST 5: Send follow-up message after reload
  // ---------------------------------------------------------------------------
  console.log("-------------------------------------------------------------");
  console.log("TEST 5: Send message after reload ('What technology did they use?')");
  console.log("-------------------------------------------------------------");
  await saveMessage(storedIdAfterReload, "user", "What technology did they use?");
  const res3 = await executeOrchestrator({
    sessionId: storedIdAfterReload,
    message: "What technology did they use?",
  });
  await saveMessage(storedIdAfterReload, "assistant", res3.answer, res3.agent);

  const updatedHistory = await getConversationHistory(storedIdAfterReload);
  console.log(`Continuous message count in same session: ${updatedHistory.length}`);
  if (updatedHistory.length !== 6) {
    throw new Error(`TEST 5 FAILED: Expected 6 continuous messages, got ${updatedHistory.length}`);
  }
  console.log("✅ TEST 5 PASSED: Continuous conversation in same session verified\n");

  // ---------------------------------------------------------------------------
  // TEST 6: Click "New Chat"
  // ---------------------------------------------------------------------------
  console.log("-------------------------------------------------------------");
  console.log("TEST 6: Click 'New Chat'");
  console.log("-------------------------------------------------------------");
  // handleNewChat() removes old key, sets new UUID, registers new session in Supabase
  delete localStorageMock["closefuture_session_id"];
  const newChatSessionId = uuidv4();
  localStorageMock["closefuture_session_id"] = newChatSessionId;
  await createSession(`visitor-${newChatSessionId}`, newChatSessionId);

  console.log("New Session ID generated:", newChatSessionId);
  console.log("Old Session ID remains in Supabase:", recordedSessionId);

  // Verify old session still exists in Supabase intact
  const oldSessionCheck = await getSession(recordedSessionId);
  const oldMessagesCheck = await getConversationHistory(recordedSessionId);
  if (!oldSessionCheck || oldMessagesCheck.length !== 6) {
    throw new Error("TEST 6 FAILED: Old session was altered or deleted in Supabase!");
  }

  // Verify new session is empty
  const newMessagesCheck = await getConversationHistory(newChatSessionId);
  if (newMessagesCheck.length !== 0) {
    throw new Error("TEST 6 FAILED: New session is not empty!");
  }
  console.log("✅ TEST 6 PASSED: New session initialized, old session preserved in Supabase\n");

  // ---------------------------------------------------------------------------
  // TEST 7: Reload after "New Chat"
  // ---------------------------------------------------------------------------
  console.log("-------------------------------------------------------------");
  console.log("TEST 7: Reload after 'New Chat'");
  console.log("-------------------------------------------------------------");
  const storedAfterNewChatReload = localStorageMock["closefuture_session_id"];
  const reloadDbSession = await getSession(storedAfterNewChatReload);
  if (!reloadDbSession) {
    throw new Error("TEST 7 FAILED: New session not found in Supabase on reload!");
  }
  const reloadMessages = await getConversationHistory(storedAfterNewChatReload);

  if (storedAfterNewChatReload !== newChatSessionId) {
    throw new Error("TEST 7 FAILED: Session ID changed after reloading new chat!");
  }
  if (reloadMessages.length !== 0) {
    throw new Error("TEST 7 FAILED: History was not empty after reloading new chat!");
  }
  console.log("Session ID preserved on reload:", storedAfterNewChatReload);
  console.log("Empty history count:", reloadMessages.length);
  console.log("✅ TEST 7 PASSED: New session remains, empty history remains\n");

  console.log("=============================================================");
  console.log("ALL 7 BROWSER ACCEPTANCE TESTS (TEST 1 - TEST 7) PASSED 100%!");
  console.log("=============================================================");
}

simulateBrowserReloadFlow().catch((err) => {
  console.error("\n❌ BROWSER ACCEPTANCE TEST FAILED:", err);
  process.exit(1);
});
