import type { Session, Message } from "../types/database.js";

export interface LeadScoringSignals {
  hasProjectNeed: boolean;
  hasDevRequirement: boolean;
  hasCompanyInfo: boolean;
  hasTimeline: boolean;
  hasBudget: boolean;
  hasMeetingBooked: boolean;
}

export interface LeadScoreResult {
  score: number;
  tier: "high" | "medium" | "early";
  breakdown: {
    projectNeed: number;
    devRequirement: number;
    companyInfo: number;
    timeline: number;
    budget: number;
    meetingBooked: number;
  };
}

/**
 * Deterministic Scoring Rule Weights:
 * - project/business need: +20
 * - development requirement: +20
 * - company/business provided: +15
 * - timeline provided: +15
 * - budget provided: +15
 * - meeting booked: +15
 * Maximum Score: 100
 *
 * Tiers:
 * - 80–100: "high"
 * - 50–79: "medium"
 * - 0–49: "early"
 *
 * CRITICAL RULE:
 * This score is strictly internal for sales triage. It is NEVER shown to the visitor.
 */
export const SCORING_WEIGHTS = {
  PROJECT_NEED: 20,
  DEV_REQUIREMENT: 20,
  COMPANY_INFO: 15,
  TIMELINE: 15,
  BUDGET: 15,
  MEETING_BOOKED: 15,
} as const;

/**
 * Calculates deterministic lead score and qualification tier.
 */
export function calculateLeadScore(signals: LeadScoringSignals): LeadScoreResult {
  const breakdown = {
    projectNeed: signals.hasProjectNeed ? SCORING_WEIGHTS.PROJECT_NEED : 0,
    devRequirement: signals.hasDevRequirement ? SCORING_WEIGHTS.DEV_REQUIREMENT : 0,
    companyInfo: signals.hasCompanyInfo ? SCORING_WEIGHTS.COMPANY_INFO : 0,
    timeline: signals.hasTimeline ? SCORING_WEIGHTS.TIMELINE : 0,
    budget: signals.hasBudget ? SCORING_WEIGHTS.BUDGET : 0,
    meetingBooked: signals.hasMeetingBooked ? SCORING_WEIGHTS.MEETING_BOOKED : 0,
  };

  const rawScore =
    breakdown.projectNeed +
    breakdown.devRequirement +
    breakdown.companyInfo +
    breakdown.timeline +
    breakdown.budget +
    breakdown.meetingBooked;

  const score = Math.min(100, Math.max(0, rawScore));

  let tier: "high" | "medium" | "early";
  if (score >= 80) {
    tier = "high";
  } else if (score >= 50) {
    tier = "medium";
  } else {
    tier = "early";
  }

  return { score, tier, breakdown };
}

/**
 * Inspects conversation history and session attributes to determine which signals are present.
 */
export function detectLeadSignals(
  session: Session | null,
  messages: Message[] = [],
  extractedSignals: string[] = []
): LeadScoringSignals {
  const combinedText = [
    ...messages.filter((m) => m.role === "user").map((m) => m.content),
    ...extractedSignals,
  ]
    .join(" ")
    .toLowerCase();

  // 1. Project / business need (+20)
  const projectKeywords = [
    "build", "app", "mobile", "web", "platform", "mvp", "product", "saas",
    "portal", "dashboard", "redesign", "website", "project", "system", "tool", "need"
  ];
  const hasProjectNeed =
    projectKeywords.some((kw) => combinedText.includes(kw)) ||
    extractedSignals.some((s) => /need|project|app|build|mvp|platform/i.test(s));

  // 2. Development requirement (+20)
  const devKeywords = [
    "tech", "technology", "stack", "react", "node", "ai", "llm", "bubble",
    "database", "api", "feature", "backend", "frontend", "vector", "postgres",
    "cloud", "integration", "ui/ux", "prototype", "development"
  ];
  const hasDevRequirement =
    devKeywords.some((kw) => combinedText.includes(kw)) ||
    extractedSignals.some((s) => /tech|stack|react|ai|feature|api|develop/i.test(s));

  // 3. Company / business provided (+15)
  const hasCompanyInSession = Boolean(session?.company && session.company.trim().length > 0);
  const companyRegex = /\b(at|with|company|startup|firm|agency|corp|inc|ltd)\s+([A-Z][a-zA-Z0-9]+)/;
  const hasCompanyInfo =
    hasCompanyInSession ||
    companyRegex.test(combinedText) ||
    extractedSignals.some((s) => /company|organization|startup|firm/i.test(s));

  // 4. Timeline provided (+15)
  const timelineRegex = /\b(timeline|deadline|asap|urgent|weeks?|months?|q[1-4]|launch|by\s+[a-z]+|next\s+month|immediately)\b/i;
  const hasTimeline =
    timelineRegex.test(combinedText) ||
    extractedSignals.some((s) => /timeline|launch|schedule|deadline|week|month/i.test(s));

  // 5. Budget provided (+15)
  const budgetRegex = /(\$|₹|€|£|\b(usd|inr|eur|budget|dollars|k|lac|lakh|grand)\b|\d+k)/i;
  const hasBudget =
    budgetRegex.test(combinedText) ||
    extractedSignals.some((s) => /budget|pricing|cost|quote|\$|₹/i.test(s));

  // 6. Meeting booked (+15)
  const hasMeetingBooked = Boolean(
    session?.booked_event_id && session.booked_event_id.trim().length > 0
  );

  return {
    hasProjectNeed,
    hasDevRequirement,
    hasCompanyInfo,
    hasTimeline,
    hasBudget,
    hasMeetingBooked,
  };
}
