import type { ChatApiResponse, SessionApiResponse } from "../types/chat.js";

const BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

/**
 * Dispatches a chat message to the CloseFuture multi-agent Orchestrator.
 */
export async function sendChatMessage(
  sessionId: string,
  message: string
): Promise<ChatApiResponse> {
  try {
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId,
        message,
      }),
    });

    if (!response.ok) {
      const errorJson = await response.json().catch(() => null);
      const friendlyMessage =
        response.status === 400
          ? errorJson?.error || "Invalid message format."
          : response.status === 503 || response.status === 502
          ? "The assistant service is temporarily unavailable. Please try again in a few moments."
          : "I encountered an issue processing your request. Please try again.";

      return {
        success: false,
        error: friendlyMessage,
        data: errorJson?.data,
      };
    }

    const json: ChatApiResponse = await response.json();
    return json;
  } catch (err: any) {
    console.error("[chatApi Network Error]:", err?.message);
    return {
      success: false,
      error: "I'm unable to reach the assistant right now. Please verify that the backend server is running and try again.",
    };
  }
}

/**
 * Restores sanitized session information and conversation history for browser reloads.
 */
export async function fetchSessionHistory(
  sessionId: string
): Promise<SessionApiResponse> {
  try {
    const response = await fetch(`${BASE_URL}/api/sessions/${encodeURIComponent(sessionId)}`, {
      method: "GET",
      headers: {
        "Accept": "application/json",
      },
    });

    if (!response.ok) {
      return {
        success: false,
        status: response.status,
        error: `Session not found (${response.status})`,
      };
    }

    const json: SessionApiResponse = await response.json();
    return { ...json, status: response.status };
  } catch (err: any) {
    console.warn("[chatApi Session Recovery Warning]:", err?.message);
    return {
      success: false,
      status: 0,
      error: "Could not retrieve previous session history.",
    };
  }
}

/**
 * Initializes a new active session on the backend for eager persistence.
 */
export async function createNewSession(
  sessionId?: string
): Promise<SessionApiResponse> {
  try {
    const response = await fetch(`${BASE_URL}/api/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sessionId }),
    });

    const json: SessionApiResponse = await response.json();
    return { ...json, status: response.status };
  } catch (err: any) {
    console.warn("[chatApi Create Session Warning]:", err?.message);
    return {
      success: false,
      status: 0,
      error: "Failed to initialize session.",
    };
  }
}
