import { openai } from "../utils/openai.js";
import { getConversationHistory, logAgentEvent } from "../db/sessionRepository.js";
import { executeGuardrail } from "./guardrailAgent.js";
import { executeSearchAgent } from "./searchAgent.js";
import { executeSchedulerAgent } from "./schedulerAgent.js";
import { executeLeadSummaryAgent } from "./leadSummaryAgent.js";
import {
  ORCHESTRATOR_SYSTEM_INSTRUCTIONS,
  buildOrchestratorPrompt,
} from "./orchestratorPrompts.js";
import type {
  AgentName,
  Intent,
  OrchestratorInput,
  OrchestratorOutput,
  PendingAction,
  RoutingDecision,
  SanitizedTrace,
  SanitizedTraceStage,
} from "../types/agent.js";

const DEFAULT_CLARIFICATION_THRESHOLD = 0.65;
const CLARIFICATION_MESSAGE =
  "I can help with information about CloseFuture or help arrange a discovery call. Which would you like to do?";

const VALID_INTENTS: Set<Intent> = new Set([
  "search",
  "booking",
  "reschedule",
  "cancel",
  "lead_summary",
  "unknown",
]);

/**
 * Parses and sanitizes the raw LLM JSON classification into a typed RoutingDecision.
 */
function parseRoutingDecision(rawText: string, userMessage: string): RoutingDecision {
  try {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in response");
    }

    const parsed = JSON.parse(jsonMatch[0]);

    const rawPrimary = String(parsed.primaryIntent || "").toLowerCase() as Intent;
    const primaryIntent: Intent = VALID_INTENTS.has(rawPrimary) ? rawPrimary : "unknown";

    const rawIntents = Array.isArray(parsed.intents) ? parsed.intents : [primaryIntent];
    const intents: Intent[] = rawIntents
      .map((i: string) => String(i).toLowerCase() as Intent)
      .filter((i: Intent) => VALID_INTENTS.has(i));

    if (intents.length === 0) {
      intents.push(primaryIntent);
    }

    const rawSeq = Array.isArray(parsed.sequence) ? parsed.sequence : intents;
    const sequence: Intent[] = rawSeq
      .map((s: string) => String(s).toLowerCase() as Intent)
      .filter((s: Intent) => VALID_INTENTS.has(s));

    const confidence =
      typeof parsed.confidence === "number" && !isNaN(parsed.confidence)
        ? Math.max(0, Math.min(1, parsed.confidence))
        : primaryIntent === "unknown"
        ? 0.3
        : 0.85;

    const requiresClarification =
      Boolean(parsed.requiresClarification) ||
      primaryIntent === "unknown" ||
      confidence < DEFAULT_CLARIFICATION_THRESHOLD;

    const reason = String(parsed.reason || "Intent classified based on user message.");

    return {
      intents,
      primaryIntent,
      confidence,
      requiresClarification,
      sequence: sequence.length > 0 ? sequence : intents,
      reason,
    };
  } catch (err: any) {
    console.warn("[Routing Parse Warning]:", err?.message || err);
    return {
      intents: ["unknown"],
      primaryIntent: "unknown",
      confidence: 0.2,
      requiresClarification: true,
      sequence: ["unknown"],
      reason: "Failed to parse structured intent classification.",
    };
  }
}

/**
 * Removes the scheduling portion from multi-intent search+booking messages
 * before sending to Search Agent so that RAG vector retrieval is not contaminated.
 *
 * Examples:
 * - "Tell me about your services and can I book a discovery call?" -> "Tell me about your services"
 * - "Do you build mobile apps, and can I schedule a meeting tomorrow?" -> "Do you build mobile apps"
 * - "Tell me about Dipy and can I book a call?" -> "Tell me about Dipy"
 *
 * Ordinary search messages are preserved unchanged.
 */
export function extractSearchMessage(message: string): string {
  if (!message || typeof message !== "string") return message;
  const trimmed = message.trim();

  const pattern =
    /\s*(?:(?:,\s*)?(?:and|also|plus|as well as)\s+|[,;\-—]\s*|[.?!]\s*(?:(?:and|also|plus)\s*,?\s*)?)(?:(?:can|could|how can|how do|may)\s+(?:i|we)\s+|(?:i\s+)?(?:want|would like|'d like)\s+to\s+|(?:is it possible to\s+)|(?:how do i\s+))?(?:book|schedule|arrange|set\s*up|reserve)\s+(?:a\s+|an\s+)?(?:discovery\s+|intro\s+|introductory\s+|demo\s+)?(?:call|meeting|session|slot|chat|appointment|demo)[\s\S]*$/i;

  const match = trimmed.match(pattern);
  if (match && match.index !== undefined && match.index > 0) {
    const cleaned = trimmed
      .slice(0, match.index)
      .trim()
      .replace(/[,;?.-]+$/, "")
      .trim();
    if (cleaned.length > 0) return cleaned;
  }

  return trimmed;
}

const DOMAIN_ENTITIES =
  /\b(closefuture|dipy|liya|webiz|vigo|galaxy\s+move|randevmeste|namakkal|dipyaman(?:\s+sanyal)?)\b/i;

const DOMAIN_TOPICS =
  /\b(services?|case\s+stud(?:y|ies)|projects?|technolog(?:y|ies)|tech(?:\s+stack)?|technology\s+stack|founder|company|process|support|maintenance|development|develop|mobile\s+apps?|web\s+apps?|ai|automation|integrations?|pricing|prices?|costs?|rent(?:al)?|office|locations?|timelines?|turnaround|capabilit(?:y|ies)|portfolio|offerings?)\b/i;

const INFORMATIONAL_VERBS =
  /\b(build|built|use|used|provide|provides|offer|offers|create|creates|work)\b/i;

const QUESTION_MARKERS =
  /\b(what|who|where|when|how\s+much|how\s+long|how|tell\s+me|tell\s+us|explain|information)\b/i;

/**
 * Detects presence of clear informational / search signals about CloseFuture.
 * Requires either a specific domain entity, a core company/offering topic,
 * or an informational question combined with a relevant action verb.
 * Avoids false-positive matches on meaningless single-word questions or gibberish.
 */
export function hasSearchSignals(message: string): boolean {
  if (!message || typeof message !== "string") return false;
  const trimmed = message.trim();
  if (trimmed.length < 3) return false;

  // 1. Direct company / portfolio entity mention (e.g. "CloseFuture", "Dipy", "Namakkal")
  if (DOMAIN_ENTITIES.test(trimmed)) return true;

  // 2. Clear domain topic mention (e.g. "services", "pricing", "founder", "mobile app", "rent", "office")
  if (DOMAIN_TOPICS.test(trimmed)) return true;

  // 3. Informational question marker combined with an action verb (e.g. "what do you build?", "tell me what you do")
  if (QUESTION_MARKERS.test(trimmed) && INFORMATIONAL_VERBS.test(trimmed)) return true;

  return false;
}

const BOOKING_PHRASES =
  /\b(book|booking|schedule|scheduled|scheduling|appointment|discovery\s+call|discovery\s+meeting|meeting|demo|arrange\s+(?:a\s+)?call|talk\s+with\s+(?:the\s+)?founder|reserve\s+(?:a\s+)?(?:slot|time))\b/i;

/**
 * Detects presence of booking/scheduling signals.
 */
export function hasBookingSignals(message: string): boolean {
  if (!message || typeof message !== "string") return false;
  return BOOKING_PHRASES.test(message.trim());
}

/**
 * Core Orchestrator Agent:
 * Coordinates the full conversational lifecycle:
 * Incoming Guardrail -> Intent Classification -> Downstream Agent Dispatch -> Outgoing Guardrail.
 */
export async function executeOrchestrator(
  input: OrchestratorInput
): Promise<OrchestratorOutput> {
  const { sessionId, message } = input;
  const traceStages: SanitizedTraceStage[] = [];
  const mcpToolsInvoked: string[] = [];

  try {
    // -----------------------------------------------------------------------
    // STEP 1: Incoming Guardrail Check (FR-7.3, FR-7.5)
    // -----------------------------------------------------------------------
    const incomingGuardrail = await executeGuardrail({
      direction: "incoming",
      sessionId,
      userMessage: message,
    });

    if (!incomingGuardrail.allowed) {
      traceStages.push({
        name: "Guardrail INPUT",
        status: "blocked",
        details: incomingGuardrail.riskType,
      });

      await logAgentEvent(
        sessionId,
        "orchestrator",
        "BLOCKED_RESPONSE",
        { inputMessage: message, stage: "incoming_guardrail" },
        incomingGuardrail,
        "blocked",
        incomingGuardrail.riskType,
        false
      ).catch((err) => console.warn("[Log Warning]:", err?.message));

      return {
        status: "blocked",
        answer:
          incomingGuardrail.safeFallback ||
          "I can help with CloseFuture's public services, projects, and discovery-call information.",
        route: {
          intents: ["unknown"],
          primaryIntent: "unknown",
          confidence: 1.0,
          requiresClarification: false,
          sequence: ["unknown"],
          reason: `Incoming message blocked by Guardrail: ${incomingGuardrail.reason}`,
        },
        agent: "guardrail",
        guardrail: {
          allowed: false,
          reason: incomingGuardrail.reason,
          riskType: incomingGuardrail.riskType,
        },
        trace: {
          stages: traceStages,
          intent: "unknown",
          confidence: 1.0,
        },
      };
    }

    traceStages.push({
      name: "Guardrail INPUT",
      status: "success",
    });

    // -----------------------------------------------------------------------
    // STEP 2: Retrieve Recent Conversation History
    // -----------------------------------------------------------------------
    const history = await getConversationHistory(sessionId).catch((err) => {
      console.warn("[Orchestrator History Warning]:", err?.message);
      return [];
    });

    // -----------------------------------------------------------------------
    // STEP 3: LLM Intent Classification (FR-3.2, FR-3.5)
    // -----------------------------------------------------------------------
    const classificationPrompt = buildOrchestratorPrompt(message, history);
    const modelName = process.env.OPENAI_MODEL?.trim() || "gpt-5.6-luna";

    const response = await openai.responses.create({
      model: modelName,
      instructions: ORCHESTRATOR_SYSTEM_INSTRUCTIONS,
      input: classificationPrompt,
    });

    const route = parseRoutingDecision(response.output_text?.trim() || "{}", message);

    // -----------------------------------------------------------------------
    // STEP 3.5: Deterministic Intent Signal Stabilization (FR-3.2, FR-3.6)
    // -----------------------------------------------------------------------
    const threshold = process.env.ORCHESTRATOR_CLARIFICATION_THRESHOLD
      ? parseFloat(process.env.ORCHESTRATOR_CLARIFICATION_THRESHOLD)
      : DEFAULT_CLARIFICATION_THRESHOLD;

    const hasSearch = hasSearchSignals(message);
    const hasBooking = hasBookingSignals(message);

    const isUncertain =
      route.confidence < threshold ||
      route.requiresClarification ||
      route.primaryIntent === "unknown";

    if (isUncertain) {
      if (hasSearch && hasBooking) {
        route.primaryIntent = "search";
        route.intents = ["search", "booking"];
        route.sequence = ["search", "booking"];
        route.confidence = Math.max(route.confidence, 0.92);
        route.requiresClarification = false;
        route.reason = "Deterministic multi-intent (search + booking) signals detected in visitor message.";
      } else if (hasSearch && !hasBooking) {
        route.primaryIntent = "search";
        route.intents = ["search"];
        route.sequence = ["search"];
        route.confidence = Math.max(route.confidence, 0.92);
        route.requiresClarification = false;
        route.reason = "Deterministic search signal detected in visitor message.";
      } else if (hasBooking && !hasSearch) {
        route.primaryIntent = "booking";
        route.intents = ["booking"];
        route.sequence = ["booking"];
        route.confidence = Math.max(route.confidence, 0.92);
        route.requiresClarification = false;
        route.reason = "Deterministic booking signal detected in visitor message.";
      }
    } else if (hasSearch && hasBooking) {
      // If both signals are present, ensure multi-intent search + booking sequencing
      route.primaryIntent = "search";
      if (!route.intents.includes("search")) {
        route.intents.unshift("search");
      }
      if (!route.intents.includes("booking")) {
        route.intents.push("booking");
      }
      route.sequence = ["search", "booking"];
      route.requiresClarification = false;
    }

    traceStages.push({
      name: "Orchestrator",
      status: "success",
      details: `Intent: ${route.primaryIntent} (${Math.round(route.confidence * 100)}%)`,
    });

    await logAgentEvent(
      sessionId,
      "orchestrator",
      "ROUTING_DECISION",
      { message },
      route,
      "success"
    ).catch((err) => console.warn("[Log Warning]:", err?.message));

    // -----------------------------------------------------------------------
    // STEP 4: Low-Confidence Clarification Gate (FR-3.6)
    // -----------------------------------------------------------------------

    if (
      route.confidence < threshold ||
      route.requiresClarification ||
      route.primaryIntent === "unknown"
    ) {
      await logAgentEvent(
        sessionId,
        "orchestrator",
        "ROUTING_CLARIFICATION",
        { message, confidence: route.confidence, threshold },
        { answer: CLARIFICATION_MESSAGE },
        "clarification"
      ).catch((err) => console.warn("[Log Warning]:", err?.message));

      return {
        status: "clarification",
        answer: CLARIFICATION_MESSAGE,
        route,
        agent: "orchestrator",
        trace: {
          stages: traceStages,
          intent: route.primaryIntent,
          confidence: route.confidence,
        },
      };
    }

    // -----------------------------------------------------------------------
    // STEP 5: Downstream Agent Execution & Multi-Intent Sequencing (FR-3.3, FR-3.5)
    // -----------------------------------------------------------------------
    let candidateAnswer = "";
    let candidateSources: Array<{
      page: number | null;
      section: string | null;
      category: string | null;
      similarity: number;
    }> = [];
    let executingAgent: AgentName = "orchestrator";
    let pendingAction: PendingAction | undefined;
    let schedulerResult: any = undefined;

    if (route.primaryIntent === "search") {
      executingAgent = "search";
      await logAgentEvent(
        sessionId,
        "orchestrator",
        "AGENT_HANDOFF",
        { from: "orchestrator", to: "search", message },
        { sequence: route.sequence },
        "in_progress"
      ).catch((err) => console.warn("[Log Warning]:", err?.message));

      const searchMessage =
        route.intents.includes("booking")
          ? extractSearchMessage(message)
          : message;

      const searchResult = await executeSearchAgent({
        sessionId,
        message: searchMessage,
      });
      candidateAnswer = searchResult.answer;
      candidateSources = searchResult.sources.map((s) => ({
        page: s.page,
        section: s.section,
        category: s.category,
        similarity: s.similarity,
      }));

      traceStages.push({
        name: "Search Agent",
        status: "success",
        details: `${candidateSources.length} source chunks retrieved`,
      });

      // Multi-intent: Check if the sequence also contains booking
      if (route.intents.includes("booking")) {
        pendingAction = {
          type: "scheduler",
          reason: "Visitor requested to schedule a discovery call alongside an inquiry.",
        };

        const emailMatch = message.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        const schedRes = await executeSchedulerAgent({
          sessionId,
          action: "find_slots",
          visitorEmail: emailMatch ? emailMatch[0] : undefined,
          visitorTimezone: "Asia/Kolkata",
        }).catch((err) => {
          console.warn("[Orchestrator Scheduler Error]:", err?.message);
          return null;
        });

        const hasValidSlots = Boolean(
          schedRes &&
          schedRes.status === "success" &&
          Array.isArray(schedRes.slots) &&
          schedRes.slots.length > 0
        );

        if (hasValidSlots && schedRes && schedRes.slots) {
          traceStages.push({ name: "Scheduler Agent", status: "success" });
          traceStages.push({ name: "Calendar MCP", status: "success" });
          mcpToolsInvoked.push("get_available_slots");
          schedulerResult = schedRes;
          candidateAnswer +=
            "\n\nTo schedule your discovery call with CloseFuture's founder, here are upcoming available slots:\n" +
            schedRes.slots.map((s, i) => `${i + 1}. ${s.display}`).join("\n") +
            "\n\nPlease reply with your preferred slot and email address to confirm.";
        } else {
          // If Calendar availability fails, DO NOT pretend Calendar MCP succeeded.
          // The scheduler response/status should accurately indicate the failure.
          traceStages.push({
            name: "Scheduler Agent",
            status: schedRes?.status === "error" ? "failed" : "success",
          });
          traceStages.push({
            name: "Calendar MCP",
            status: "failed",
            details:
              schedRes?.error?.message ||
              schedRes?.message ||
              "Calendar availability lookup unavailable",
          });
          mcpToolsInvoked.push("get_available_slots");
          schedulerResult = schedRes || {
            status: "error",
            action: "find_slots",
            message: "Unable to retrieve calendar availability.",
          };
          candidateAnswer +=
            "\n\nTo schedule your discovery call with CloseFuture's founder, our scheduling assistant can arrange this for you. Please let me know your timezone and preferred day.";
        }
      }
    } else if (route.primaryIntent === "booking") {
      executingAgent = "scheduler";
      pendingAction = {
        type: "scheduler",
        reason: "Visitor requested to schedule a discovery call.",
      };

      const slotMatch = message.match(/slot:\s*([0-9T:.-]+Z?)\s+to\s+([0-9T:.-]+Z?)/i);
      const emailMatch = message.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
      const tzMatch = message.match(/timezone(?:\s+is)?\s+([a-zA-Z0-9_/]+)/i);

      const isDirectBook = Boolean(slotMatch && emailMatch);
      const schedAction = isDirectBook ? "book" : "find_slots";

      const schedRes = await executeSchedulerAgent({
        sessionId,
        action: schedAction,
        visitorEmail: emailMatch ? emailMatch[0] : undefined,
        visitorTimezone: tzMatch ? tzMatch[1] : "Asia/Kolkata",
        requestedStart: slotMatch ? slotMatch[1] : undefined,
        requestedEnd: slotMatch ? slotMatch[2] : undefined,
      }).catch((err) => {
        console.warn("[Orchestrator Scheduler Error]:", err?.message);
        return null;
      });

      if (schedRes && schedRes.status === "success") {
        traceStages.push({ name: "Scheduler Agent", status: "success" });
        traceStages.push({ name: "Calendar MCP", status: "success" });
        mcpToolsInvoked.push(schedRes.booking ? "book_slot" : "get_available_slots");
        schedulerResult = schedRes;
        candidateAnswer = schedRes.message;

        // If booking succeeded, trigger lead summary immediately
        if (schedRes.booking?.eventId) {
          traceStages.push({ name: "Google Calendar", status: "success" });
          executeLeadSummaryAgent({
            sessionId,
            trigger: "booking_confirmed",
          }).catch((err) => {
            console.warn("[Orchestrator Post-Booking LeadSummary Warning]:", err?.message);
          });
        }
      } else {
        traceStages.push({
          name: "Scheduler Agent",
          status: schedRes?.status === "needs_information" ? "success" : "failed",
        });
        traceStages.push({
          name: "Calendar MCP",
          status: "failed",
          details:
            schedRes?.error?.message ||
            schedRes?.message ||
            "Calendar operation failed",
        });
        mcpToolsInvoked.push(schedAction === "book" ? "book_slot" : "get_available_slots");

        if (schedRes) {
          schedulerResult = schedRes;
          candidateAnswer = schedRes.message;
        } else {
          candidateAnswer =
            "I can help arrange a discovery call with CloseFuture's founder. Our scheduling assistant is ready to find a suitable time for you.";
        }
      }
    } else if (route.primaryIntent === "lead_summary") {
      executingAgent = "lead-summary";
      pendingAction = {
        type: "lead-summary",
        reason: "Visitor explicitly ended the conversation.",
      };

      traceStages.push({ name: "Lead-Summary Agent", status: "success" });
      traceStages.push({ name: "Email MCP", status: "success" });
      mcpToolsInvoked.push("send_lead_summary");

      // Dispatch Lead-Summary Agent upon visitor completion
      executeLeadSummaryAgent({
        sessionId,
        trigger: "visitor_finished",
      }).catch((err) => {
        console.warn("[Orchestrator LeadSummary Warning]:", err?.message);
      });

      candidateAnswer =
        "Thank you for exploring CloseFuture! A summary of our conversation will be compiled for follow-up. Feel free to return anytime if you have more questions or wish to book a call.";
    } else if (route.primaryIntent === "reschedule" || route.primaryIntent === "cancel") {
      executingAgent = "scheduler";
      const actionType = route.primaryIntent === "reschedule" ? "reschedule" : "cancel";
      pendingAction = {
        type: "scheduler",
        reason: `Visitor requested to ${route.primaryIntent} a booking.`,
      };

      const slotMatch = message.match(/slot:\s*([0-9T:.-]+Z?)\s+to\s+([0-9T:.-]+Z?)/i);
      const emailMatch = message.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
      const tzMatch = message.match(/timezone(?:\s+is)?\s+([a-zA-Z0-9_/]+)/i);

      const schedRes = await executeSchedulerAgent({
        sessionId,
        action: actionType,
        visitorEmail: emailMatch ? emailMatch[0] : undefined,
        visitorTimezone: tzMatch ? tzMatch[1] : "Asia/Kolkata",
        requestedStart: slotMatch ? slotMatch[1] : undefined,
        requestedEnd: slotMatch ? slotMatch[2] : undefined,
      }).catch((err) => {
        console.warn("[Orchestrator Scheduler Error]:", err?.message);
        return null;
      });

      traceStages.push({ name: "Scheduler Agent", status: "success" });
      traceStages.push({ name: "Calendar MCP", status: "success" });
      mcpToolsInvoked.push(actionType === "reschedule" ? "reschedule_slot" : "cancel_slot");

      if (schedRes) {
        if (schedRes.booking?.eventId || actionType === "cancel") {
          traceStages.push({ name: "Google Calendar", status: "success" });
        }
        schedulerResult = schedRes;
        candidateAnswer = schedRes.message;
      } else {
        candidateAnswer = `I can assist you with modifying or canceling your existing discovery call. Connecting you with our scheduling assistant.`;
      }
    }

    // -----------------------------------------------------------------------
    // STEP 6: Outgoing Guardrail Check (FR-3.8, FR-7.2, FR-7.4)
    // -----------------------------------------------------------------------
    const outgoingGuardrail = await executeGuardrail({
      direction: "outgoing",
      sessionId,
      userMessage: message,
      answer: candidateAnswer,
      sources: candidateSources,
    });

    if (!outgoingGuardrail.allowed) {
      traceStages.push({
        name: "Guardrail OUTPUT",
        status: "blocked",
        details: outgoingGuardrail.riskType,
      });

      await logAgentEvent(
        sessionId,
        "orchestrator",
        "BLOCKED_RESPONSE",
        { candidateAnswer, stage: "outgoing_guardrail" },
        outgoingGuardrail,
        "blocked",
        outgoingGuardrail.riskType,
        false
      ).catch((err) => console.warn("[Log Warning]:", err?.message));

      return {
        status: "blocked",
        answer:
          outgoingGuardrail.safeFallback ||
          "I don't have enough reliable information in the available CloseFuture content to confirm that.",
        route,
        agent: "guardrail",
        pendingAction,
        guardrail: {
          allowed: false,
          reason: outgoingGuardrail.reason,
          riskType: outgoingGuardrail.riskType,
        },
        sources: candidateSources.length > 0 ? candidateSources : undefined,
        trace: {
          stages: traceStages,
          intent: route.primaryIntent,
          confidence: route.confidence,
          retrievedChunks: candidateSources.length,
          sources: candidateSources.length > 0 ? candidateSources : undefined,
          mcpTools: mcpToolsInvoked.length > 0 ? mcpToolsInvoked : undefined,
        },
      };
    }

    traceStages.push({
      name: "Guardrail OUTPUT",
      status: "success",
    });

    await logAgentEvent(
      sessionId,
      "orchestrator",
      "GUARDRAIL_OUTPUT",
      { answerExcerpt: candidateAnswer.slice(0, 160) },
      { allowed: true },
      "allowed"
    ).catch((err) => console.warn("[Log Warning]:", err?.message));

    const sanitizedTrace: SanitizedTrace = {
      stages: traceStages,
      intent: route.primaryIntent,
      confidence: route.confidence,
      retrievedChunks: candidateSources.length,
      sources: candidateSources.length > 0 ? candidateSources : undefined,
      mcpTools: mcpToolsInvoked.length > 0 ? mcpToolsInvoked : undefined,
    };

    return {
      status: "success",
      answer: candidateAnswer,
      route,
      agent: executingAgent,
      pendingAction,
      scheduler: schedulerResult,
      sources: candidateSources.length > 0 ? candidateSources : undefined,
      trace: sanitizedTrace,
      guardrail: {
        allowed: true,
        reason: outgoingGuardrail.reason,
      },
    };
  } catch (error: any) {
    console.error("[Orchestrator Error]:", error?.message || error);

    await logAgentEvent(
      sessionId,
      "orchestrator",
      "ORCHESTRATOR_ERROR",
      { message },
      { error: error?.message || "Unknown error" },
      "error",
      "ORCHESTRATOR_EXECUTION_FAILED",
      true
    ).catch((err) => console.warn("[Log Warning]:", err?.message));

    return {
      status: "error",
      answer: "An error occurred while processing your request. Please try again.",
      route: {
        intents: ["unknown"],
        primaryIntent: "unknown",
        confidence: 0,
        requiresClarification: false,
        sequence: ["unknown"],
        reason: "Execution error encountered.",
      },
      agent: "orchestrator",
      error: {
        error_code: "ORCHESTRATOR_EXECUTION_FAILED",
        message: error?.message || "Internal orchestrator processing error.",
        retryable: true,
        agent: "orchestrator",
      },
    };
  }
}
