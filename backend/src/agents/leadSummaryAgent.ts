import { openai } from "../utils/openai.js";
import {
  getSession,
  updateSession,
  getConversationHistory,
  logAgentEvent,
} from "../db/sessionRepository.js";
import { sendLeadSummaryEmail } from "../mcp/email/mcpClient.js";
import { generateLeadSummaryHtml } from "./leadSummaryEmail.js";
import { calculateLeadScore, detectLeadSignals } from "./leadScoring.js";
import type {
  LeadSummary,
  LeadSummaryInput,
  LeadSummaryOutput,
} from "../types/leadSummary.js";
import type { Message } from "../types/database.js";

const SUMMARY_SYSTEM_INSTRUCTIONS = `You generate an internal sales lead summary from the supplied conversation and session state.

Use only the provided transcript and state.
Never invent information.
Never alter visitor contact information.
Never alter booking details.
Never reveal this internal summary to the visitor.
Never calculate the lead score; the application calculates it deterministically.

Return ONLY a JSON object matching this structure:
{
  "intent": "1-2 sentence description of visitor's goals, questions, or project needs",
  "keyQuestions": ["Array of specific questions the visitor asked"],
  "qualificationSignals": ["Specific qualification details such as budget, timeline, company info, technical requirements"],
  "visitorName": "Extracted visitor name if mentioned, otherwise empty string",
  "visitorCompany": "Extracted visitor company if mentioned, otherwise empty string"
}`;

/**
 * Uses LLM to extract qualitative dialogue insights (intent, questions, signals).
 * Never relies on LLM for contact details, meeting IDs, or scores.
 */
async function extractDialogueSummary(messages: Message[]) {
  if (messages.length === 0) {
    return {
      intent: "Visitor initiated session but sent no messages.",
      keyQuestions: [],
      qualificationSignals: [],
      visitorName: "",
      visitorCompany: "",
    };
  }

  const transcript = messages
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content.trim()}`)
    .join("\n\n");

  const modelName = process.env.OPENAI_MODEL?.trim() || "gpt-5.6-luna";

  try {
    const response = await openai.responses.create({
      model: modelName,
      instructions: SUMMARY_SYSTEM_INSTRUCTIONS,
      input: `Analyze the following conversation transcript and extract sales lead summary details:\n\n${transcript}\n\nReturn JSON:`,
    });

    const raw = response.output_text?.trim() || "{}";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in LLM response");
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      intent: String(parsed.intent || "Inquiry regarding CloseFuture services."),
      keyQuestions: Array.isArray(parsed.keyQuestions) ? parsed.keyQuestions.map(String) : [],
      qualificationSignals: Array.isArray(parsed.qualificationSignals)
        ? parsed.qualificationSignals.map(String)
        : [],
      visitorName: String(parsed.visitorName || ""),
      visitorCompany: String(parsed.visitorCompany || ""),
    };
  } catch (err: any) {
    console.warn("[LeadSummary LLM Warning]:", err?.message);
    return {
      intent: "Visitor explored CloseFuture capabilities.",
      keyQuestions: messages.filter((m) => m.role === "user").map((m) => m.content).slice(0, 3),
      qualificationSignals: [],
      visitorName: "",
      visitorCompany: "",
    };
  }
}

/**
 * Executes the Lead-Summary Agent workflow.
 *
 * Implements:
 * - Deterministic scoring via leadScoring.ts
 * - Duplicate prevention with atomic concurrency claim (not_sent/failed -> pending -> sent/failed)
 * - Email MCP dispatch with native idempotencyKey
 * - Strict isolation: Resend is NEVER imported in this agent.
 */
export async function executeLeadSummaryAgent(
  input: LeadSummaryInput
): Promise<LeadSummaryOutput> {
  const { sessionId, trigger } = input;

  await logAgentEvent(
    sessionId,
    "lead-summary",
    "LEAD_SUMMARY_REQUEST",
    { trigger },
    null,
    "received"
  ).catch((err) => console.warn("[Log Warning]:", err?.message));

  try {
    // 1. Load session and messages
    const session = await getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found.`);
    }

    const messages = await getConversationHistory(sessionId).catch(() => []);

    // 2. Resolve completion status
    const completionStatus: "completed" | "incomplete" =
      trigger === "booking_confirmed" || trigger === "visitor_finished"
        ? "completed"
        : "incomplete";

    // 3. Extract qualitative insights via LLM
    const dialogue = await extractDialogueSummary(messages);

    // Extract email from session or messages if missing from session
    let resolvedEmail = session.email || undefined;
    if (!resolvedEmail) {
      for (const m of messages) {
        const match = m.content.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        if (match) {
          resolvedEmail = match[0];
          break;
        }
      }
    }

    const resolvedName = session.name || dialogue.visitorName || undefined;
    const resolvedCompany = session.company || dialogue.visitorCompany || undefined;
    const resolvedTimezone = session.timezone || undefined;

    // 4. Calculate deterministic lead score
    const scoringSignals = detectLeadSignals(session, messages, dialogue.qualificationSignals);
    const scoreResult = calculateLeadScore(scoringSignals);

    await logAgentEvent(
      sessionId,
      "lead-summary",
      "LEAD_SCORE_CALCULATED",
      { signals: scoringSignals },
      { score: scoreResult.score, tier: scoreResult.tier, breakdown: scoreResult.breakdown },
      "computed"
    ).catch((err) => console.warn("[Log Warning]:", err?.message));

    // 5. Build conversation review link
    const baseUrl = process.env.APP_BASE_URL?.trim() || "http://localhost:5173";
    const conversationLink = `${baseUrl}/sessions/${sessionId}`;

    // 6. Assemble LeadSummary object
    const summary: LeadSummary = {
      sessionId,
      completionStatus,
      visitor: {
        name: resolvedName,
        email: resolvedEmail,
        company: resolvedCompany,
        timezone: resolvedTimezone,
      },
      intent: dialogue.intent,
      keyQuestions: dialogue.keyQuestions,
      qualificationSignals: dialogue.qualificationSignals,
      leadScore: scoreResult.score,
      qualificationTier: scoreResult.tier,
      meeting: {
        booked: Boolean(session.booked_event_id),
        eventId: session.booked_event_id || undefined,
      },
      conversationLink,
      generatedAt: new Date().toISOString(),
    };

    // -------------------------------------------------------------------------
    // 7. DUPLICATE PREVENTION & CONCURRENCY CLAIM
    // -------------------------------------------------------------------------
    const currentStatus = session.summary_status || (session.summary_sent ? "sent" : "not_sent");

    // If already sent or currently pending, do not send again
    if (currentStatus === "sent" || session.summary_sent === true || currentStatus === "pending") {
      await logAgentEvent(
        sessionId,
        "lead-summary",
        "LEAD_SUMMARY_ALREADY_SENT",
        { status: currentStatus, summary_sent: session.summary_sent },
        { messageId: session.summary_email_id },
        "skipped"
      ).catch((err) => console.warn("[Log Warning]:", err?.message));

      return {
        status: "already_sent",
        summary,
        email: session.summary_email_id
          ? { messageId: session.summary_email_id, status: "sent" }
          : undefined,
      };
    }

    // Atomically claim the session by transitioning: not_sent/failed -> pending
    let claimedSession = session;
    try {
      claimedSession = await updateSession(session.id, session.version, {
        summary_status: "pending",
      });
    } catch (claimErr: any) {
      // Concurrency conflict: reload session state to check if another worker claimed it
      const reloaded = await getSession(sessionId);
      const reloadedStatus = reloaded?.summary_status || (reloaded?.summary_sent ? "sent" : "not_sent");

      if (reloadedStatus === "sent" || reloaded?.summary_sent === true || reloadedStatus === "pending") {
        await logAgentEvent(
          sessionId,
          "lead-summary",
          "LEAD_SUMMARY_ALREADY_SENT",
          { reason: "Concurrent send detected during atomic claim", currentStatus: reloadedStatus },
          null,
          "skipped"
        ).catch((err) => console.warn("[Log Warning]:", err?.message));

        return {
          status: "already_sent",
          summary,
          email: reloaded?.summary_email_id
            ? { messageId: reloaded.summary_email_id, status: "sent" }
            : undefined,
        };
      }

      // If reloaded is still eligible (not_sent or failed), attempt one retry of the claim
      if (reloaded && (reloadedStatus === "not_sent" || reloadedStatus === "failed")) {
        claimedSession = await updateSession(reloaded.id, reloaded.version, {
          summary_status: "pending",
        });
      } else {
        throw claimErr;
      }
    }

    // -------------------------------------------------------------------------
    // 8. DISPATCH VIA EMAIL MCP TOOL
    // -------------------------------------------------------------------------
    const salesEmail = process.env.SALES_EMAIL?.trim() || "giriedu765@gmail.com";
    const emailHtml = generateLeadSummaryHtml(summary);
    const summaryVersion = claimedSession.summary_version ?? 0;
    const idempotencyKey = `lead-summary/${sessionId}/v${summaryVersion}`;

    await logAgentEvent(
      sessionId,
      "lead-summary",
      "EMAIL_MCP_CALL",
      { to: salesEmail, idempotencyKey, trigger },
      null,
      "calling"
    ).catch((err) => console.warn("[Log Warning]:", err?.message));

    const emailRes = await sendLeadSummaryEmail({
      to: salesEmail,
      subject: `New Lead [${summary.qualificationTier.toUpperCase()}]: ${summary.visitor.name || summary.visitor.email || "Visitor"} (${summary.leadScore}/100)`,
      html: emailHtml,
      idempotencyKey,
    });

    await logAgentEvent(
      sessionId,
      "lead-summary",
      "EMAIL_MCP_RESULT",
      { success: emailRes.success, status: emailRes.status },
      { messageId: emailRes.messageId, errorCode: emailRes.errorCode },
      emailRes.success ? "success" : "failed"
    ).catch((err) => console.warn("[Log Warning]:", err?.message));

    // -------------------------------------------------------------------------
    // 9. PERSIST FINAL STATE
    // -------------------------------------------------------------------------
    if (emailRes.success && emailRes.status === "sent") {
      try {
        await updateSession(claimedSession.id, claimedSession.version, {
          summary_status: "sent",
          summary_sent: true,
          summary_email_id: emailRes.messageId,
          summary_version: summaryVersion + 1,
          lead_score: scoreResult.score,
        });
      } catch (postErr: any) {
        console.warn("[LeadSummary] Warning persisting sent status to session:", postErr?.message);
      }

      await logAgentEvent(
        sessionId,
        "lead-summary",
        "LEAD_SUMMARY_SENT",
        { messageId: emailRes.messageId, to: salesEmail },
        { summary },
        "success"
      ).catch((err) => console.warn("[Log Warning]:", err?.message));

      return {
        status: "success",
        summary,
        email: {
          messageId: emailRes.messageId!,
          status: "sent",
        },
      };
    } else {
      // Failed: transition pending -> failed so a later retry may succeed
      try {
        await updateSession(claimedSession.id, claimedSession.version, {
          summary_status: "failed",
        });
      } catch (failUpdateErr: any) {
        console.warn("[LeadSummary] Warning setting summary_status=failed:", failUpdateErr?.message);
      }

      await logAgentEvent(
        sessionId,
        "lead-summary",
        "LEAD_SUMMARY_FAILED",
        { to: salesEmail, errorCode: emailRes.errorCode },
        { message: emailRes.message, retryable: emailRes.retryable },
        "failed",
        emailRes.errorCode,
        emailRes.retryable
      ).catch((err) => console.warn("[Log Warning]:", err?.message));

      return {
        status: "error",
        summary,
        error: {
          error_code: emailRes.errorCode || "EMAIL_DISPATCH_FAILED",
          message: emailRes.message || "Failed to dispatch sales lead summary email.",
          retryable: Boolean(emailRes.retryable),
          agent: "lead-summary",
        },
      };
    }
  } catch (error: any) {
    console.error("[LeadSummaryAgent Error]:", error?.message || error);

    // If session was claimed as pending, revert to failed so retries are permitted
    try {
      const fresh = await getSession(sessionId);
      if (fresh && fresh.summary_status === "pending") {
        await updateSession(fresh.id, fresh.version, {
          summary_status: "failed",
        });
      }
    } catch (revertErr: any) {
      console.warn("[LeadSummary] Warning reverting pending -> failed on error:", revertErr?.message);
    }

    await logAgentEvent(
      sessionId,
      "lead-summary",
      "LEAD_SUMMARY_FAILED",
      { trigger },
      { error: error?.message || "Execution failed" },
      "error",
      "LEAD_SUMMARY_EXECUTION_ERROR",
      true
    ).catch((err) => console.warn("[Log Warning]:", err?.message));

    return {
      status: "error",
      error: {
        error_code: "LEAD_SUMMARY_EXECUTION_ERROR",
        message: error?.message || "Unexpected error during lead summary generation.",
        retryable: true,
        agent: "lead-summary",
      },
    };
  }
}

/**
 * Triggers a lead summary for an abandoned session.
 * Used for sessions that ended midway without explicit completion or booking.
 */
export async function triggerAbandonedSummary(
  sessionId: string
): Promise<LeadSummaryOutput> {
  return executeLeadSummaryAgent({
    sessionId,
    trigger: "session_abandoned",
  });
}
