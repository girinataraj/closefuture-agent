export interface LeadSummaryInput {
  sessionId: string;
  trigger: "booking_confirmed" | "visitor_finished" | "session_abandoned";
}

export interface LeadSummary {
  sessionId: string;

  completionStatus: "completed" | "incomplete";

  visitor: {
    name?: string;
    email?: string;
    company?: string;
    timezone?: string;
  };

  intent: string;

  keyQuestions: string[];

  qualificationSignals: string[];

  leadScore: number;

  qualificationTier: "high" | "medium" | "early";

  meeting?: {
    booked: boolean;
    eventId?: string;
    start?: string;
    end?: string;
    timezone?: string;
    meetLink?: string;
  };

  conversationLink: string;

  generatedAt: string;
}

export interface LeadSummaryOutput {
  status: "success" | "already_sent" | "error";

  summary?: LeadSummary;

  email?: {
    messageId: string;
    status: "sent";
  };

  error?: {
    error_code: string;
    message: string;
    retryable: boolean;
    agent: "lead-summary";
  };
}
