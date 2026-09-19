import { supabase } from "./supabase.js";
import type {
  Session,
  SessionUpdates,
  Message,
  AgentLog,
} from "../types/database.js";

export class ConcurrencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConcurrencyError";
  }
}

export class SessionNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionNotFoundError";
  }
}

/**
 * Creates a new active chat session for a visitor.
 * If customSessionId is provided, it is used as the primary key ID.
 */
export async function createSession(
  visitorId: string,
  customSessionId?: string
): Promise<Session> {
  const now = new Date().toISOString();

  const insertPayload: Record<string, any> = {
    visitor_id: visitorId,
    status: "active",
    version: 1,
    created_at: now,
    updated_at: now,
  };

  if (customSessionId && customSessionId.trim().length > 0) {
    insertPayload.id = customSessionId.trim();
  }

  const { data, error } = await supabase
    .from("sessions")
    .insert(insertPayload)
    .select()
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to create session for visitor ${visitorId}: ${error?.message || "Unknown error"}`
    );
  }

  return data as Session;
}

/**
 * Retrieves a session by its unique ID.
 */
export async function getSession(sessionId: string): Promise<Session | null> {
  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to retrieve session ${sessionId}: ${error.message}`
    );
  }

  return (data as Session) || null;
}

/**
 * Updates a session using optimistic concurrency control.
 *
 * Atomically updates the record ONLY if the current database version matches
 * expectedVersion. If another process has modified the session concurrently,
 * a ConcurrencyError is thrown to prevent silent overwriting of state.
 */
export async function updateSession(
  sessionId: string,
  expectedVersion: number,
  updates: SessionUpdates
): Promise<Session> {
  const now = new Date().toISOString();
  const nextVersion = expectedVersion + 1;

  const { data, error } = await supabase
    .from("sessions")
    .update({
      ...updates,
      version: nextVersion,
      updated_at: now,
    })
    .eq("id", sessionId)
    .eq("version", expectedVersion)
    .select()
    .maybeSingle();

  if (error) {
    throw new Error(
      `Database error updating session ${sessionId}: ${error.message}`
    );
  }

  // If no row was updated, detect whether session is missing or version conflicted
  if (!data) {
    const existing = await getSession(sessionId);
    if (!existing) {
      throw new SessionNotFoundError(
        `Session with ID ${sessionId} does not exist.`
      );
    }
    throw new ConcurrencyError(
      `Session ${sessionId} concurrency conflict: Expected version ${expectedVersion}, but current database version is ${existing.version}.`
    );
  }

  return data as Session;
}

/**
 * Saves a chat message associated with a session.
 */
export async function saveMessage(
  sessionId: string,
  role: string,
  content: string,
  agent?: string | null
): Promise<Message> {
  const { data, error } = await supabase
    .from("messages")
    .insert({
      session_id: sessionId,
      role,
      content,
      agent: agent || null,
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to save message for session ${sessionId}: ${error?.message || "Unknown error"}`
    );
  }

  return data as Message;
}

/**
 * Retrieves the full chronological conversation history for a session.
 */
export async function getConversationHistory(
  sessionId: string
): Promise<Message[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(
      `Failed to retrieve conversation history for session ${sessionId}: ${error.message}`
    );
  }

  return (data as Message[]) || [];
}

/**
 * Records an observability/audit log entry for an agent execution or action.
 */
export async function logAgentEvent(
  sessionId: string | null,
  agent: string,
  action: string,
  input?: unknown,
  output?: unknown,
  status?: string | null,
  errorCode?: string | null,
  retryable?: boolean | null
): Promise<AgentLog> {
  const { data, error } = await supabase
    .from("agent_logs")
    .insert({
      session_id: sessionId || null,
      agent,
      action,
      input: input !== undefined ? input : null,
      output: output !== undefined ? output : null,
      status: status || null,
      error_code: errorCode || null,
      retryable: retryable !== undefined ? retryable : null,
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to log agent event for agent ${agent} (${action}): ${error?.message || "Unknown error"}`
    );
  }

  return data as AgentLog;
}

/**
 * Retrieves active sessions that have passed their expiration timestamp.
 * Note: These records are returned for cleanup processing without automatic deletion.
 */
export async function getExpiredSessions(): Promise<Session[]> {
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .eq("status", "active")
    .not("expires_at", "is", null)
    .lt("expires_at", now);

  if (error) {
    throw new Error(
      `Failed to retrieve expired sessions: ${error.message}`
    );
  }

  return (data as Session[]) || [];
}
