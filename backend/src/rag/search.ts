import { supabase } from "../db/supabase.js";
import { generateQueryEmbedding } from "./embed.js";
import { RAG_CONFIG } from "./config.js";
import type { MatchedKnowledge } from "../types/database.js";

/**
 * Executes a semantic vector search against the match_knowledge PostgreSQL RPC in Supabase.
 *
 * @param query The search query string.
 * @param category Optional category filter (e.g., 'services', 'case_study').
 * @param topK Maximum number of chunks to return (defaults to RAG_CONFIG.TOP_K = 4).
 * @param threshold Minimum cosine similarity threshold (defaults to RAG_CONFIG.SIMILARITY_THRESHOLD = 0.70).
 * @returns Array of MatchedKnowledge records meeting the threshold.
 */
export async function searchKnowledge(
  query: string,
  category: string | null = null,
  topK: number = RAG_CONFIG.TOP_K,
  threshold: number = RAG_CONFIG.SIMILARITY_THRESHOLD
): Promise<MatchedKnowledge[]> {
  const cleanQuery = query.trim();
  if (!cleanQuery) {
    return [];
  }

  const queryEmbedding = await generateQueryEmbedding(cleanQuery);

  const { data, error } = await supabase.rpc("match_knowledge", {
    query_embedding: queryEmbedding,
    match_count: topK,
    match_threshold: threshold,
    filter_category: category || null,
  });

  if (error) {
    throw new Error(`Supabase match_knowledge RPC error: ${error.message}`);
  }

  return (data as MatchedKnowledge[]) || [];
}
