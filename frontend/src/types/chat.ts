export type Role = "user" | "assistant";

export interface SourceCitation {
  page: number | null;
  section: string | null;
  category: string | null;
  similarity: number;
}

export interface SlotOption {
  start: string;
  end: string;
  display: string;
}

export interface BookingConfirmation {
  eventId?: string;
  meetLink?: string;
  htmlLink?: string;
  start?: string;
  end?: string;
  timezone?: string;
  attendeeEmail?: string;
}

export interface SanitizedTraceStage {
  name: string;
  status: "success" | "blocked" | "failed" | "skipped";
  details?: string;
}

export interface SanitizedTrace {
  stages: SanitizedTraceStage[];
  intent: string;
  confidence: number;
  retrievedChunks?: number;
  sources?: SourceCitation[];
  mcpTools?: string[];
}

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  agent?: string;
  timestamp: string;
  sources?: SourceCitation[];
  slots?: SlotOption[];
  booking?: BookingConfirmation;
  trace?: SanitizedTrace;
  isBlocked?: boolean;
  /** True when backend has scheduling intent but needs timezone/day before fetching slots */
  awaitingSchedule?: boolean;
}

export interface ChatApiResponse {
  success: boolean;
  data?: {
    status: "success" | "clarification" | "blocked" | "error";
    answer: string;
    route: {
      intents: string[];
      primaryIntent: string;
      confidence: number;
      requiresClarification: boolean;
      sequence: string[];
      reason: string;
    };
    agent: string;
    scheduler?: {
      status: string;
      action: string;
      message: string;
      slots?: SlotOption[];
      booking?: BookingConfirmation;
    };
    sources?: SourceCitation[];
    trace?: SanitizedTrace;
    guardrail?: {
      allowed: boolean;
      reason?: string;
      riskType?: string;
    };
  };
  sessionId?: string;
  error?: string;
}

export interface SessionApiResponse {
  success: boolean;
  status?: number;
  session?: {
    id: string;
    status: string;
    hasBooking: boolean;
    created_at: string;
  };
  messages?: Array<{
    id: string;
    role: string;
    content: string;
    agent?: string;
    created_at: string;
  }>;
  error?: string;
}

export interface SessionIndexItem {
  id: string;
  title: string;
  lastActive: string;
}
