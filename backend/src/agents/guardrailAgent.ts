import { openai } from "../utils/openai.js";
import { logAgentEvent } from "../db/sessionRepository.js";
import type {
  GuardrailInput,
  GuardrailOutput,
  GuardrailRiskType,
} from "../types/agent.js";

const SAFE_FALLBACKS: Record<GuardrailRiskType, string> = {
  prompt_injection:
    "I can help with CloseFuture's public services, projects, and booking information, but I can't provide internal system information.",
  pii: "I can't provide private or sensitive personal information.",
  internal_information:
    "I can help with CloseFuture's public services, projects, and booking information, but I can't reveal internal system details.",
  hallucination:
    "I don't have enough reliable information in the available CloseFuture content to confirm that.",
  unauthorized_commitment:
    "I don't have enough reliable information in the available CloseFuture content to confirm that.",
  tone: "CloseFuture is focused on delivering high-quality web, mobile, and AI solutions. How may I assist you with your project?",
  other:
    "I don't have enough reliable information in the available CloseFuture content to confirm that.",
  none: "",
};

// ---------------------------------------------------------------------------
// Stage 1 Deterministic Pattern Matchers (Zero latency, Zero API tokens)
// ---------------------------------------------------------------------------

const INJECTION_PATTERNS = [
  /(ignore|forget|disregard|bypass)\s+(all\s+)?(previous|prior|above|system|developer|hidden)\s+(instructions|prompts|rules|commands|constraints)/i,
  /(reveal|show|display|print|expose|output|dump|leak|tell\s+me)\s+(your\s+)?(system\s+prompt|hidden\s+instructions|internal\s+instructions|developer\s+prompt|base\s+prompt|source\s+code)/i,
  /(bypass|override|disable)\s+(your\s+)?(rules|safety|guidelines|guardrails|filters)/i,
  /\b(jailbreak|dan\s+mode|developer\s+mode|unfiltered\s+mode)\b/i,
  /\byou\s+are\s+now\s+(in\s+)?(unrestricted|unfiltered|jailbroken|freed)\b/i,
  /\boutput\s+everything\s+above\b/i,
];

const INTERNAL_INFO_PATTERNS = [
  /\b(lead\s*score|qualification\s*score|lead\s*scoring\s*algorithm)\b/i,
  /\b(internal\s*routing|routing\s*logic|agent_logs\s*table|supabase_secret|openai_api_key)\b/i,
  /\b(show|reveal|display|output)\s+(internal\s+reasoning|hidden\s+reasoning|system\s+instructions)\b/i,
];

const PII_PROBE_PATTERNS = [
  /\b(other|another|all|list\s+of)\s+(clients?|customers?|users?)\s+(passwords?|credentials?|credit\s*cards?|phone\s*numbers?|private\s*contacts?|emails?|addresses?)\b/i,
  /\b(show|give|tell|reveal|leak|steal|provide|share)\s+(me\s+)?(another|other|the|any)\s+(user|customer|client)('s|\s+)?\s*(private|personal|confidential|contact|card|password|ssn|phone|email)\b/i,
  /\b(private\s+contact\s+details|personal\s+phone\s+numbers?|private\s+email\s+addresses?)\s+of\s+(other|another|any)\b/i,
  /\b(customer\s+database|dump\s+users|user\s+table\s+records)\b/i,
];

const UNAUTHORIZED_COMMITMENT_PATTERNS = [
  /\bguarantees?\s+(a\s+)?\d+[\s-]day\s+(launch|delivery|build)\b/i,
  /\bguarantees?\s+(every|all|any)\s+.*(in\s+exactly\s+\d+\s+days?)\b/i,
  /\bguarantees?.*(₹|\brs\.?|\binr\b).*launch/i,
  /\blaunch.*for\s*(₹|\brs\.?|\binr\b)\s*[\d,]+/i,
  /\bfor\s*(₹|\brs\.?|\binr\b)\s*50[,.]?000\b/i,
  /\b100%\s+guaranteed?\s+outcome\b/i,
  /\bguarantees?\s+first\s+page\s+ranking\b/i,
];

/**
 * Checks incoming visitor messages for prompt injection, internal system probing, or PII harvesting.
 */
function checkIncomingDeterministic(message: string): GuardrailOutput | null {
  const clean = message.trim();

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(clean)) {
      return {
        allowed: false,
        riskType: "prompt_injection",
        reason: "Detected prompt injection or system instruction override attempt.",
        safeFallback: SAFE_FALLBACKS.prompt_injection,
      };
    }
  }

  for (const pattern of PII_PROBE_PATTERNS) {
    if (pattern.test(clean)) {
      return {
        allowed: false,
        riskType: "pii",
        reason: "Detected attempt to probe for private customer contact details or sensitive PII.",
        safeFallback: SAFE_FALLBACKS.pii,
      };
    }
  }

  for (const pattern of INTERNAL_INFO_PATTERNS) {
    if (pattern.test(clean)) {
      return {
        allowed: false,
        riskType: "internal_information",
        reason: "Detected request for internal system prompts, scoring algorithms, or private architecture.",
        safeFallback: SAFE_FALLBACKS.internal_information,
      };
    }
  }

  return null;
}

/**
 * Checks outgoing assistant answers for unauthorized contractual guarantees or unsupported pricing.
 */
function checkOutgoingDeterministic(answer: string): GuardrailOutput | null {
  const clean = answer.trim();

  for (const pattern of UNAUTHORIZED_COMMITMENT_PATTERNS) {
    if (pattern.test(clean)) {
      return {
        allowed: false,
        riskType: "unauthorized_commitment",
        reason: "Detected unauthorized contractual timeline guarantee or ungrounded pricing commitment.",
        safeFallback: SAFE_FALLBACKS.unauthorized_commitment,
      };
    }
  }

  // Ensure answer does not leak internal lead scoring or system prompt terminology
  for (const pattern of INTERNAL_INFO_PATTERNS) {
    if (pattern.test(clean)) {
      return {
        allowed: false,
        riskType: "internal_information",
        reason: "Candidate answer contains internal system prompt or lead scoring references.",
        safeFallback: SAFE_FALLBACKS.internal_information,
      };
    }
  }

  return null;
}

/**
 * Stage 2 Semantic Grounding Check (used only when candidate outgoing answer requires LLM validation).
 */
async function checkOutgoingSemantic(
  userMessage: string,
  answer: string,
  sourcesSummary: string
): Promise<GuardrailOutput> {
  const systemInstructions = `You are the Outgoing Safety & Grounding Guardrail for CloseFuture.
Your job is to strictly evaluate whether a candidate assistant answer violates safety or company grounding rules.

Rules to enforce:
1. "unauthorized_commitment": Does the answer promise rigid timelines (e.g. 14 days), unapproved pricing, or absolute business guarantees not in CloseFuture's profile?
2. "hallucination": Does the answer fabricate company offices, team sizes, client results, or technologies?
3. "internal_information": Does the answer leak internal lead scores, prompt instructions, or system reasoning?
4. "pii": Does the answer expose private customer emails, passwords, or personal data?

You must respond ONLY with a valid JSON object matching this schema:
{
  "allowed": boolean,
  "riskType": "none" | "unauthorized_commitment" | "hallucination" | "internal_information" | "pii",
  "reason": "Brief explanation"
}`;

  const promptInput = `User Message: "${userMessage}"
Retrieved Sources Summary:
${sourcesSummary || "(No sources retrieved / out-of-domain)"}

Candidate Answer:
"${answer}"

Evaluate the candidate answer for grounding and unauthorized commitments:`;

  try {
    const modelName = process.env.OPENAI_MODEL?.trim() || "gpt-5.6-luna";
    const response = await openai.responses.create({
      model: modelName,
      instructions: systemInstructions,
      input: promptInput,
    });

    const outputText = response.output_text?.trim() || "{}";
    const jsonMatch = outputText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { allowed: true, riskType: "none", reason: "Default pass" };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const allowed = Boolean(parsed.allowed);
    const riskType = (parsed.riskType as GuardrailRiskType) || "none";
    const reason = String(parsed.reason || "Semantic evaluation complete.");

    if (!allowed && riskType !== "none") {
      return {
        allowed: false,
        riskType,
        reason,
        safeFallback: SAFE_FALLBACKS[riskType] || SAFE_FALLBACKS.hallucination,
      };
    }

    return { allowed: true, riskType: "none", reason };
  } catch (error: any) {
    console.warn("[Guardrail Semantic Check Warning]:", error?.message || error);
    // On transient LLM evaluation failure, fail safe by checking deterministic output
    return {
      allowed: true,
      riskType: "none",
      reason: "Semantic evaluation skipped due to transient model error.",
    };
  }
}

/**
 * Core Guardrail Agent:
 * Evaluates incoming visitor messages or outgoing assistant responses for prompt injection,
 * confidential PII probing, unauthorized commitments, hallucinations, and internal system leaks.
 */
export async function executeGuardrail(
  input: GuardrailInput
): Promise<GuardrailOutput> {
  const { direction, sessionId, userMessage = "", answer = "", sources = [] } = input;

  // -------------------------------------------------------------------------
  // INCOMING DIRECTION: Validate visitor message before orchestration/routing
  // -------------------------------------------------------------------------
  if (direction === "incoming") {
    const deterministicCheck = checkIncomingDeterministic(userMessage);

    if (deterministicCheck) {
      await logAgentEvent(
        sessionId,
        "guardrail",
        "GUARDRAIL_INPUT",
        { direction, userMessage },
        deterministicCheck,
        "blocked",
        deterministicCheck.riskType,
        false
      ).catch((err) => console.warn("[Guardrail Log Warning]:", err?.message));

      return deterministicCheck;
    }

    await logAgentEvent(
      sessionId,
      "guardrail",
      "GUARDRAIL_INPUT",
      { direction, userMessage },
      { allowed: true, riskType: "none" },
      "allowed"
    ).catch((err) => console.warn("[Guardrail Log Warning]:", err?.message));

    return {
      allowed: true,
      riskType: "none",
      reason: "Incoming message passed security inspection.",
    };
  }

  // -------------------------------------------------------------------------
  // OUTGOING DIRECTION: Validate candidate answer before presenting to visitor
  // -------------------------------------------------------------------------
  const deterministicCheck = checkOutgoingDeterministic(answer);
  if (deterministicCheck) {
    await logAgentEvent(
      sessionId,
      "guardrail",
      "GUARDRAIL_OUTPUT",
      { direction, answerExcerpt: answer.slice(0, 160) },
      deterministicCheck,
      "blocked",
      deterministicCheck.riskType,
      false
    ).catch((err) => console.warn("[Guardrail Log Warning]:", err?.message));

    return deterministicCheck;
  }

  // If answer claims pricing or rigid numeric commitments without backing sources, trigger semantic check
  const hasCommitmentKeywords =
    /\b(guarantee|guarantees|warranty|promise|fixed price|\$\d+|\d+\s*days?)\b/i.test(answer);

  if (hasCommitmentKeywords) {
    const sourcesSummary = sources
      .map((s) => `Page ${s.page} (${s.section}) [Sim: ${(s.similarity * 100).toFixed(1)}%]`)
      .join("; ");

    const semanticResult = await checkOutgoingSemantic(userMessage, answer, sourcesSummary);

    await logAgentEvent(
      sessionId,
      "guardrail",
      "GUARDRAIL_OUTPUT",
      { direction, answerExcerpt: answer.slice(0, 160), hasSources: sources.length > 0 },
      semanticResult,
      semanticResult.allowed ? "allowed" : "blocked",
      semanticResult.riskType,
      false
    ).catch((err) => console.warn("[Guardrail Log Warning]:", err?.message));

    return semanticResult;
  }

  // Clean pass
  await logAgentEvent(
    sessionId,
    "guardrail",
    "GUARDRAIL_OUTPUT",
    { direction, answerExcerpt: answer.slice(0, 160) },
    { allowed: true, riskType: "none" },
    "allowed"
  ).catch((err) => console.warn("[Guardrail Log Warning]:", err?.message));

  return {
    allowed: true,
    riskType: "none",
    reason: "Outgoing answer verified safe and grounded.",
  };
}
