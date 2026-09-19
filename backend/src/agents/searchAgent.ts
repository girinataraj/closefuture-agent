import { getConversationHistory, logAgentEvent } from "../db/sessionRepository.js";
import { rewriteQuery } from "../rag/queryRewrite.js";
import { searchKnowledge } from "../rag/search.js";
import { RAG_CONFIG } from "../rag/config.js";
import { openai } from "../utils/openai.js";
import {
  SEARCH_AGENT_SYSTEM_INSTRUCTIONS,
  buildSearchAnswerPrompt,
} from "./searchPrompts.js";
import type { MatchedKnowledge } from "../types/database.js";

export interface SearchAgentInput {
  sessionId: string;
  message: string;
}

export interface SearchSource {
  page: number | null;
  section: string | null;
  category: string | null;
  documentType: string | null;
  similarity: number;
}

export interface SearchAgentError {
  error_code: string;
  message: string;
  retryable: boolean;
  agent: "search";
}

export interface SearchAgentOutput {
  status: "success" | "no_answer" | "error";
  answer: string;
  rewrittenQuery: string;
  sources: SearchSource[];
  confidence: number;
  retrievedChunks: number;
  error?: SearchAgentError;
}

export const NO_ANSWER_FALLBACK =
  "I don't have reliable information about that in the CloseFuture content available to me.";

/**
 * Calculates a transparent heuristic confidence score (0.0 to 1.0) based on vector similarity
 * and corroborating retrieved chunks.
 *
 * Heuristic Rules:
 * 1. 0 chunks or similarity below threshold (0.70) => confidence = 0.
 * 2. If valid chunks exist, base confidence is the top similarity rounded to 2 decimal places.
 * 3. Additional relevant chunks (+0.02 each, capped at +0.06) provide a corroboration bonus.
 * 4. Bounded strictly between 0.0 and 1.0.
 *
 * NOTE: This is a transparent retrieval heuristic, NOT a calibrated statistical probability.
 */
export function calculateConfidence(chunks: MatchedKnowledge[]): number {
  if (!chunks || chunks.length === 0) {
    return 0;
  }

  const topSimilarity = chunks[0]?.similarity ?? 0;
  if (topSimilarity < RAG_CONFIG.SIMILARITY_THRESHOLD) {
    return 0;
  }

  const corroborationBonus = Math.min((chunks.length - 1) * 0.02, 0.06);
  const score = Math.min(topSimilarity + corroborationBonus, 1.0);
  return Math.round(score * 100) / 100;
}

/**
 * Classifies an error into structured categorization with retryability.
 */
function classifyError(err: unknown): {
  errorCode: string;
  message: string;
  retryable: boolean;
} {
  const rawMessage = err instanceof Error ? err.message : String(err);
  const lower = rawMessage.toLowerCase();

  if (lower.includes("rate limit") || lower.includes("429")) {
    return {
      errorCode: "RATE_LIMIT_EXCEEDED",
      message: "OpenAI rate limit encountered. The operation is retryable.",
      retryable: true,
    };
  }

  if (
    lower.includes("timeout") ||
    lower.includes("econnreset") ||
    lower.includes("etimedout") ||
    lower.includes("fetch failed")
  ) {
    return {
      errorCode: "NETWORK_TIMEOUT",
      message: "Network connection or request timed out.",
      retryable: true,
    };
  }

  if (
    lower.includes("500") ||
    lower.includes("502") ||
    lower.includes("503") ||
    lower.includes("504")
  ) {
    return {
      errorCode: "UPSTREAM_SERVICE_ERROR",
      message: "Upstream service temporarily unavailable.",
      retryable: true,
    };
  }

  if (
    lower.includes("api key") ||
    lower.includes("auth") ||
    lower.includes("unauthorized") ||
    lower.includes("401")
  ) {
    return {
      errorCode: "AUTHENTICATION_ERROR",
      message: "Authentication or credentials error.",
      retryable: false,
    };
  }

  return {
    errorCode: "SEARCH_EXECUTION_FAILED",
    message: "Failed to execute Search Agent retrieval and answer generation.",
    retryable: false,
  };
}

/**
 * Core Search Agent:
 * Coordinates session history retrieval, query rewriting, vector retrieval from Supabase pgvector,
 * confidence scoring, no-answer gating, grounded LLM answer generation, and structured audit logging.
 */
export async function executeSearchAgent(
  input: SearchAgentInput
): Promise<SearchAgentOutput> {
  const { sessionId, message } = input;

  try {
    // 1. Retrieve conversation history for context-aware follow-up resolution
    const history = await getConversationHistory(sessionId).catch((err) => {
      console.warn(
        `[Search Agent Warning]: Could not fetch history for session ${sessionId}:`,
        err?.message || err
      );
      return [];
    });

    // 2. Query Rewriting: Resolve follow-up pronouns/references
    const rewrittenQuery = await rewriteQuery(message, history);

    await logAgentEvent(
      sessionId,
      "search",
      "QUERY_REWRITE",
      { originalMessage: message, historyCount: history.length },
      { rewrittenQuery },
      "success"
    ).catch((err) => console.warn("[Log Event Error]:", err?.message));

    // 3. Vector Retrieval: Query pgvector via match_knowledge RPC
    const chunks = await searchKnowledge(
      rewrittenQuery,
      null,
      RAG_CONFIG.TOP_K,
      RAG_CONFIG.SIMILARITY_THRESHOLD
    );

    const sourceMetadata: SearchSource[] = chunks.map((chunk) => ({
      page: chunk.source_page,
      section: chunk.source_section,
      category: chunk.category,
      documentType: chunk.document_type,
      similarity: Number(chunk.similarity.toFixed(4)),
    }));

    await logAgentEvent(
      sessionId,
      "search",
      "VECTOR_RETRIEVAL",
      {
        query: rewrittenQuery,
        topK: RAG_CONFIG.TOP_K,
        threshold: RAG_CONFIG.SIMILARITY_THRESHOLD,
      },
      {
        retrievedChunks: chunks.length,
        sources: sourceMetadata,
      },
      chunks.length > 0 ? "success" : "no_results"
    ).catch((err) => console.warn("[Log Event Error]:", err?.message));

    // 4. No-Answer Gating: If no relevant chunks above threshold exist, do NOT call LLM
    if (chunks.length === 0) {
      await logAgentEvent(
        sessionId,
        "search",
        "ANSWER_GENERATION",
        { rewrittenQuery, chunksUsed: 0 },
        { answer: NO_ANSWER_FALLBACK, status: "no_answer" },
        "no_answer"
      ).catch((err) => console.warn("[Log Event Error]:", err?.message));

      return {
        status: "no_answer",
        answer: NO_ANSWER_FALLBACK,
        rewrittenQuery,
        sources: [],
        confidence: 0,
        retrievedChunks: 0,
      };
    }

    // 5. Grounded Answer Generation
    const prompt = buildSearchAnswerPrompt(rewrittenQuery, chunks, message);
    const modelName = process.env.OPENAI_MODEL?.trim() || "gpt-5.6-luna";

    const response = await openai.responses.create({
      model: modelName,
      instructions: SEARCH_AGENT_SYSTEM_INSTRUCTIONS,
      input: prompt,
    });

    const generatedAnswer = response.output_text?.trim() || "";

    // Check if generated answer indicates lack of information
    const isModelNoAnswer =
      !generatedAnswer ||
      generatedAnswer.toLowerCase().includes("don't have reliable information") ||
      generatedAnswer.toLowerCase().includes("do not have reliable information") ||
      generatedAnswer.toLowerCase().includes("not enough information from the available closefuture content");

    if (isModelNoAnswer) {
      await logAgentEvent(
        sessionId,
        "search",
        "ANSWER_GENERATION",
        { rewrittenQuery, chunksUsed: chunks.length },
        { answer: generatedAnswer || NO_ANSWER_FALLBACK, status: "no_answer" },
        "no_answer"
      ).catch((err) => console.warn("[Log Event Error]:", err?.message));

      return {
        status: "no_answer",
        answer: generatedAnswer || NO_ANSWER_FALLBACK,
        rewrittenQuery,
        sources: [],
        confidence: 0,
        retrievedChunks: chunks.length,
      };
    }

    const confidence = calculateConfidence(chunks);

    await logAgentEvent(
      sessionId,
      "search",
      "ANSWER_GENERATION",
      { rewrittenQuery, chunksUsed: chunks.length },
      { answerLength: generatedAnswer.length, status: "success", confidence },
      "success"
    ).catch((err) => console.warn("[Log Event Error]:", err?.message));

    return {
      status: "success",
      answer: generatedAnswer,
      rewrittenQuery,
      sources: sourceMetadata,
      confidence,
      retrievedChunks: chunks.length,
    };
  } catch (error: unknown) {
    const classification = classifyError(error);

    await logAgentEvent(
      sessionId,
      "search",
      "SEARCH_ERROR",
      { message },
      { error: classification },
      "error",
      classification.errorCode,
      classification.retryable
    ).catch((err) => console.warn("[Log Event Error]:", err?.message));

    return {
      status: "error",
      answer: "An error occurred while searching CloseFuture knowledge. Please try again.",
      rewrittenQuery: message,
      sources: [],
      confidence: 0,
      retrievedChunks: 0,
      error: {
        error_code: classification.errorCode,
        message: classification.message,
        retryable: classification.retryable,
        agent: "search",
      },
    };
  }
}
