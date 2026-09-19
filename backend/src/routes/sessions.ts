import { Router, type Request, type Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { getSession, createSession, getConversationHistory } from "../db/sessionRepository.js";

const router = Router();

/**
 * POST /api/sessions
 * Initializes a new active session or recovers existing by client UUID.
 */
router.post("/", async (req: Request, res: Response): Promise<void> => {
  const customId = req.body?.sessionId;
  const targetId =
    typeof customId === "string" && customId.trim().length > 0
      ? customId.trim()
      : uuidv4();

  try {
    const existing = await getSession(targetId).catch(() => null);
    if (existing) {
      res.status(200).json({
        success: true,
        session: {
          id: existing.id,
          status: existing.status,
          hasBooking: Boolean(
            existing.booked_event_id && existing.booked_event_id.trim().length > 0
          ),
          created_at: existing.created_at,
        },
        messages: await getConversationHistory(existing.id).catch(() => []),
      });
      return;
    }

    const created = await createSession(`visitor-${targetId}`, targetId);
    res.status(201).json({
      success: true,
      session: {
        id: created.id,
        status: created.status,
        hasBooking: false,
        created_at: created.created_at,
      },
      messages: [],
    });
  } catch (error: any) {
    console.error("[Create Session Route Error]:", error?.message || error);
    res.status(500).json({
      success: false,
      error: "Failed to initialize session",
    });
  }
});

/**
 * GET /api/sessions/:sessionId
 *
 * Safe, sanitized session recovery endpoint for browser reloads.
 *
 * CRITICAL SECURITY RULES:
 * - booked_event_id is strictly kept server-side (only hasBooking boolean is exposed).
 * - lead_score, qualification tier, summary_status, summary_email_id, and summary_version are NEVER exposed.
 * - Internal audit logs, system prompts, routing reasons, and OAuth credentials are NEVER exposed.
 */
router.get("/:sessionId", async (req: Request, res: Response): Promise<void> => {
  const { sessionId } = req.params;

  if (!sessionId || typeof sessionId !== "string") {
    res.status(400).json({
      success: false,
      error: "Invalid session ID",
    });
    return;
  }

  try {
    const session = await getSession(sessionId.trim());
    if (!session) {
      res.status(404).json({
        success: false,
        error: "Session not found",
      });
      return;
    }

    const messages = await getConversationHistory(session.id).catch(() => []);

    const sanitizedMessages = messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      agent: m.agent,
      created_at: m.created_at,
    }));

    res.status(200).json({
      success: true,
      session: {
        id: session.id,
        status: session.status,
        hasBooking: Boolean(session.booked_event_id && session.booked_event_id.trim().length > 0),
        created_at: session.created_at,
      },
      messages: sanitizedMessages,
    });
  } catch (error: any) {
    console.error("[Sessions Route Error]:", error?.message || error);
    res.status(500).json({
      success: false,
      error: "Failed to retrieve session",
    });
  }
});

export default router;
