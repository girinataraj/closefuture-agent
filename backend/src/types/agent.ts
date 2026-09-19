export type AgentName =
  | "orchestrator"
  | "search"
  | "scheduler"
  | "lead-summary"
  | "guardrail";

export type Intent =
  | "search"
  | "booking"
  | "reschedule"
  | "cancel"
  | "lead_summary"
  | "unknown";

export interface RoutingDecision {
  intents: Intent[];
  primaryIntent: Intent;
  confidence: number;
  requiresClarification: boolean;
  sequence: Intent[];
  reason: string;
}

export interface PendingAction {
  type: "scheduler" | "lead-summary";
  reason: string;
  details?: Record<string, unknown>;
}

export type GuardrailDirection = "incoming" | "outgoing";

export type GuardrailRiskType =
  | "none"
  | "prompt_injection"
  | "pii"
  | "hallucination"
  | "unauthorized_commitment"
  | "tone"
  | "internal_information"
  | "other";

export interface GuardrailSourceMeta {
  page: number | null;
  section: string | null;
  category: string | null;
  similarity: number;
}

export interface GuardrailInput {
  direction: GuardrailDirection;
  sessionId: string;
  userMessage?: string;
  answer?: string;
  sources?: GuardrailSourceMeta[];
}

export interface GuardrailOutput {
  allowed: boolean;
  riskType: GuardrailRiskType;
  reason: string;
  safeFallback?: string;
}

export interface OrchestratorInput {
  sessionId: string;
  message: string;
}

export interface SanitizedTraceStage {
  name: string;
  status: "success" | "blocked" | "failed" | "skipped";
  details?: string;
}

export interface SanitizedTrace {
  stages: SanitizedTraceStage[];
  intent: Intent;
  confidence: number;
  retrievedChunks?: number;
  sources?: GuardrailSourceMeta[];
  mcpTools?: string[];
}

export interface OrchestratorOutput {
  status: "success" | "clarification" | "blocked" | "error";
  answer: string;
  route: RoutingDecision;
  agent: AgentName;
  pendingAction?: PendingAction;
  guardrail?: {
    allowed: boolean;
    reason?: string;
    riskType?: GuardrailRiskType;
  };
  scheduler?: SchedulerOutput;
  sources?: GuardrailSourceMeta[];
  trace?: SanitizedTrace;
  error?: {
    error_code: string;
    message: string;
    retryable: boolean;
    agent: "orchestrator";
  };
}

export interface SchedulerInput {
  sessionId: string;
  action: "find_slots" | "book" | "reschedule" | "cancel";
  visitorEmail?: string;
  visitorTimezone?: string;
  requestedStart?: string;
  requestedEnd?: string;
  eventId?: string;
}

export interface SchedulerOutput {
  status: "success" | "needs_information" | "slot_unavailable" | "error";
  action: string;
  message: string;
  slots?: Array<{
    start: string;
    end: string;
    display: string;
  }>;
  booking?: {
    eventId: string;
    meetLink?: string;
    htmlLink?: string;
    start: string;
    end: string;
    timezone: string;
    attendeeEmail: string;
  };
  error?: {
    error_code: string;
    message: string;
    retryable: boolean;
    agent: "scheduler";
  };
}

