export interface Session {
  id: string;
  visitor_id: string;
  status: string;
  email: string | null;
  name: string | null;
  company: string | null;
  timezone: string | null;
  lead_score: number | null;
  booked_event_id: string | null;
  summary_sent: boolean;
  summary_email_id?: string | null;
  summary_version?: number;
  summary_status?: "not_sent" | "pending" | "sent" | "failed";
  version: number;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
}

export type SessionUpdates = Partial<
  Omit<Session, "id" | "version" | "created_at" | "updated_at">
>;

export interface Message {
  id: string;
  session_id: string;
  role: string;
  content: string;
  agent: string | null;
  created_at: string;
}

export interface AgentLog {
  id: string;
  session_id: string | null;
  agent: string;
  action: string;
  input: unknown;
  output: unknown;
  status: string | null;
  error_code: string | null;
  retryable: boolean | null;
  created_at: string;
}

export interface KnowledgeChunk {
  id: string;
  content: string;
  source_page: number | null;
  source_section: string | null;
  document_type: string | null;
  category: string | null;
  chunk_index: number | null;
  embedding: number[];
  created_at: string;
}

export interface MatchedKnowledge {
  id: string;
  content: string;
  source_page: number | null;
  source_section: string | null;
  document_type: string | null;
  category: string | null;
  similarity: number;
}
