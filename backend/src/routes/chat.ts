import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import {
  createSession,
  getSession,
  saveMessage,
} from "../db/sessionRepository.js";
import { executeOrchestrator } from "../agents/orchestrator.js";

const router = Router();

const chatRequestSchema = z.object({
  sessionId: z.string().trim().optional(),
  message: z
    .string()
    .trim()
    .min(1, "Message cannot be empty")
    .max(4000, "Message cannot exceed 4000 characters"),
});

router.post("/", async (req: Request, res: Response): Promise<void> => {
  const parseResult = chatRequestSchema.safeParse(req.body);

  if (!parseResult.success) {
    const errorDetails = parseResult.error.issues
      .map((issue) => issue.message)
      .join(", ");
    res.status(400).json({
      success: false,
      error: errorDetails || "Invalid request payload",
    });
    return;
  }

  const { sessionId, message } = parseResult.data;

  try {
    // Resolve existing session or initialize a new active session
    let activeSessionId = sessionId;
    if (activeSessionId) {
      const existing = await getSession(activeSessionId).catch(() => null);
      if (!existing) {
        const created = await createSession(`visitor-${activeSessionId}`, activeSessionId);
        activeSessionId = created.id;
      }
    } else {
      const created = await createSession(`visitor-${uuidv4()}`);
      activeSessionId = created.id;
    }

    // Persist incoming user message to session history
    await saveMessage(activeSessionId, "user", message);

    // Execute full Orchestrator pipeline:
    // Incoming Guardrail -> Intent Classification -> Downstream Dispatch (Search/etc.) -> Outgoing Guardrail
    const agentResult = await executeOrchestrator({
      sessionId: activeSessionId,
      message,
    });

    // Persist assistant response with agent attribution (e.g. "search", "orchestrator", "guardrail")
    await saveMessage(
      activeSessionId,
      "assistant",
      agentResult.answer,
      agentResult.agent
    );

    if (agentResult.status === "error") {
      res.status(500).json({
        success: false,
        data: agentResult,
        sessionId: activeSessionId,
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: agentResult,
      sessionId: activeSessionId,
    });
  } catch (error: any) {
    console.error("[Chat Route Error]:", error?.message || "Unknown error");
    res.status(500).json({
      success: false,
      error: "Failed to process chat message.",
    });
  }
});

export default router;
