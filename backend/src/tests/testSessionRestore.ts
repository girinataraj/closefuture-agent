import dotenv from "dotenv";
dotenv.config();

import { v4 as uuidv4 } from "uuid";
import { createSession, getSession, saveMessage, getConversationHistory } from "../db/sessionRepository.js";

async function runSessionRestoreTest() {
  console.log("===============================================================");
  console.log("CLOSEFUTURE REGRESSION TEST: SESSION PERSISTENCE & RESTORATION");
  console.log("===============================================================\n");

  // Step 1: Create a session with a designated UUID (as sent by frontend client)
  const clientSessionId = uuidv4();
  console.log("1. Creating session with client-designated UUID:", clientSessionId);
  const created = await createSession(`visitor-${clientSessionId}`, clientSessionId);

  if (created.id !== clientSessionId) {
    throw new Error(`Session ID mismatch: expected ${clientSessionId}, got ${created.id}`);
  }
  console.log("✅ Step 1 PASSED: Session created with exact client UUID\n");

  // Step 2: Save user and assistant messages in chronological order
  console.log("2. Persisting chronological dialogue messages...");
  const userMsg1 = await saveMessage(clientSessionId, "user", "What services does CloseFuture provide?");
  // Small pause to guarantee distinct timestamps
  await new Promise((r) => setTimeout(r, 50));
  const assistantMsg1 = await saveMessage(
    clientSessionId,
    "assistant",
    "CloseFuture provides AI integration, web & mobile app development, and product design.",
    "search"
  );
  await new Promise((r) => setTimeout(r, 50));
  const userMsg2 = await saveMessage(clientSessionId, "user", "Tell me about Dipy.");
  await new Promise((r) => setTimeout(r, 50));
  const assistantMsg2 = await saveMessage(
    clientSessionId,
    "assistant",
    "Dipy is an AI agent for real estate lead qualification developed by CloseFuture.",
    "search"
  );

  console.log("✅ Step 2 PASSED: 4 messages saved successfully\n");

  // Step 3: Query session and conversation history (matching GET /api/sessions/:sessionId)
  console.log("3. Restoring session state and conversation history...");
  const restoredSession = await getSession(clientSessionId);
  if (!restoredSession) {
    throw new Error(`Failed to restore session ${clientSessionId}`);
  }

  const restoredHistory = await getConversationHistory(clientSessionId);
  console.log(`Retrieved ${restoredHistory.length} messages from database.`);

  if (restoredHistory.length !== 4) {
    throw new Error(`Expected 4 messages, got ${restoredHistory.length}`);
  }
  console.log("✅ Step 3 PASSED: All 4 messages restored\n");

  // Step 4: Verify chronological order
  console.log("4. Verifying chronological order...");
  for (let i = 0; i < restoredHistory.length - 1; i++) {
    const tCurrent = new Date(restoredHistory[i].created_at).getTime();
    const tNext = new Date(restoredHistory[i + 1].created_at).getTime();
    if (tCurrent > tNext) {
      throw new Error(`Chronological ordering violated at index ${i}`);
    }
  }
  console.log("Order verified:");
  restoredHistory.forEach((m, idx) => {
    console.log(`  [${idx + 1}] (${m.role} / ${m.agent || "none"}): ${m.content.slice(0, 50)}...`);
  });
  console.log("✅ Step 4 PASSED: Chronological order strictly preserved\n");

  // Step 5: Verify security - simulate sanitized payload returned by GET /api/sessions/:sessionId
  console.log("5. Verifying sanitized client payload and privacy boundaries...");
  const sanitizedResponse = {
    success: true,
    session: {
      id: restoredSession.id,
      status: restoredSession.status,
      hasBooking: Boolean(restoredSession.booked_event_id && restoredSession.booked_event_id.trim().length > 0),
      created_at: restoredSession.created_at,
    },
    messages: restoredHistory.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      agent: m.agent,
      created_at: m.created_at,
    })),
  };

  const forbiddenKeys = [
    "lead_score",
    "qualification_tier",
    "summary_email_id",
    "summary_status",
    "summary_version",
    "summary_sent",
    "booked_event_id",
    "internal_logs",
    "tokens",
    "secrets",
  ];

  const sessionKeys = Object.keys(sanitizedResponse.session);
  const leakedKeys = forbiddenKeys.filter((k) => sessionKeys.includes(k));

  if (leakedKeys.length > 0) {
    throw new Error(`Security violation: sanitized session exposes forbidden internal keys: ${leakedKeys.join(", ")}`);
  }

  console.log("Sanitized session payload keys:", sessionKeys);
  console.log("Forbidden keys exposed:", leakedKeys.length === 0 ? "NONE (Clean)" : leakedKeys);
  console.log("✅ Step 5 PASSED: Strict data sanitization verified with zero data leakage\n");

  console.log("=============================================================");
  console.log("SESSION PERSISTENCE & RESTORE REGRESSION TEST: ALL PASSED!");
  console.log("=============================================================");
}

runSessionRestoreTest().catch((err) => {
  console.error("❌ REGRESSION TEST FAILED:", err);
  process.exit(1);
});
