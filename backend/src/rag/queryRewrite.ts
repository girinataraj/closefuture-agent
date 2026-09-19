import { openai } from "../utils/openai.js";
import type { Message } from "../types/database.js";

const QUERY_REWRITE_SYSTEM_INSTRUCTIONS = `You are an expert search query rewriter for CloseFuture's RAG knowledge retrieval system.
Your job is to rewrite the user's latest message into an optimal standalone search query to retrieve the exact relevant page from the CloseFuture company profile.

CloseFuture Known Project Context:
- Dipy: UGC (User-Generated Content) two-sided marketplace built on Bubble
- Liya AI: Employee wellbeing and stress management platform
- Webiz: Smart office on demand and PropTech IoT access control
- Vigo: Women's fitness app with AI meal tracking via WhatsApp
- Randevmeste: Speed-dating and event matching platform
- Galaxy Move: Samsung creator community platform

Rewriting Rules:
1. Return ONLY the rewritten search query string. Do NOT add quotes, markdown, "Rewritten:", or explanatory text.
2. Resolve pronouns (such as "they", "it", "their stack", "that project") using the conversation history context.
3. For project or case study queries (e.g. asking about Dipy or employee wellbeing), include the project domain keywords (e.g. "Dipy UGC marketplace case study", "Liya AI employee wellbeing platform case study").
4. For technical questions about a project (e.g. "What technology did they use?" following Dipy), formulate a targeted search like: "What technology and tools did CloseFuture use to build the Dipy UGC marketplace on Bubble?"
5. Do NOT answer the question.
6. Do NOT add generic filler like "overview, features, use cases, and technical details".
7. If the user query is already a clear standalone query (e.g. "What services does CloseFuture provide?" or "What is CloseFuture's office rent in Bangalore?"), keep it direct and faithful to the user's intent.
8. Maximum length: about 25 words.`;

/**
 * Rewrites a user query taking into account recent conversation history to resolve
 * follow-up references and pronouns for optimal vector retrieval.
 *
 * @param message The raw user message.
 * @param history Recent conversation messages from the session.
 * @param maxHistoryMessages Maximum number of recent messages to consider (default 6).
 * @returns Rewritten standalone search query.
 */
export async function rewriteQuery(
  message: string,
  history: Message[] = [],
  maxHistoryMessages: number = 6
): Promise<string> {
  const cleanMessage = message.trim();
  if (!cleanMessage) {
    return "";
  }

  // Filter and take the most recent history entries
  const recentHistory = history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-maxHistoryMessages);

  let contextPrompt = "";
  if (recentHistory.length > 0) {
    const formattedHistory = recentHistory
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content.trim()}`)
      .join("\n");
    contextPrompt = `Recent Conversation Context:\n${formattedHistory}\n\n`;
  }

  const promptInput = `${contextPrompt}Latest User Message to Rewrite:\n${cleanMessage}`;

  try {
    const modelName = process.env.OPENAI_MODEL?.trim() || "gpt-5.6-luna";

    const response = await openai.responses.create({
      model: modelName,
      instructions: QUERY_REWRITE_SYSTEM_INSTRUCTIONS,
      input: promptInput,
    });

    let rewritten = response.output_text?.trim() || cleanMessage;

    // Clean up any extraneous quotes or prefixes the model might have added
    rewritten = rewritten.replace(/^["'`]+|["'`]+$/g, "").trim();
    if (rewritten.toLowerCase().startsWith("rewritten query:")) {
      rewritten = rewritten.slice("rewritten query:".length).trim();
    }
    if (rewritten.toLowerCase().startsWith("rewritten:")) {
      rewritten = rewritten.slice("rewritten:".length).trim();
    }

    return rewritten || cleanMessage;
  } catch (error: any) {
    console.warn(
      "[Query Rewrite Warning]: Failed to rewrite query using LLM. Falling back to raw query.",
      error?.message || error
    );
    return cleanMessage;
  }
}
