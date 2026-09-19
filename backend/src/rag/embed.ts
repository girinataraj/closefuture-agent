import { openai } from "../utils/openai.js";
import { RAG_CONFIG } from "./config.js";

/**
 * Generates a 1536-dimensional embedding vector for a single search query text
 * using OpenAI's text-embedding-3-small model.
 */
export async function generateQueryEmbedding(query: string): Promise<number[]> {
  const cleanQuery = query.trim();
  if (!cleanQuery) {
    throw new Error("Cannot generate embedding for an empty query string.");
  }

  try {
    const response = await openai.embeddings.create({
      model: RAG_CONFIG.EMBEDDING_MODEL,
      input: cleanQuery,
      dimensions: RAG_CONFIG.EMBEDDING_DIMENSIONS,
    });

    const embedding = response.data?.[0]?.embedding;
    if (!embedding || embedding.length !== RAG_CONFIG.EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Invalid embedding response from OpenAI. Expected ${RAG_CONFIG.EMBEDDING_DIMENSIONS} dimensions.`
      );
    }

    return embedding;
  } catch (error: any) {
    console.error(
      "[Embedding API Error]:",
      error?.message || "Failed to generate query embedding"
    );
    throw new Error("Embedding generation failed. Check API configuration.");
  }
}

/**
 * Generates embeddings in batches for an array of text chunks.
 * Avoids single-fragment API calls, reducing network round-trips and optimizing throughput.
 */
export async function generateBatchEmbeddings(
  texts: string[],
  batchSize = 25
): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }

  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);

    try {
      const response = await openai.embeddings.create({
        model: RAG_CONFIG.EMBEDDING_MODEL,
        input: batch,
        dimensions: RAG_CONFIG.EMBEDDING_DIMENSIONS,
      });

      // Sort by index to ensure exact alignment with input texts
      const ordered = response.data.sort((a, b) => a.index - b.index);
      for (const item of ordered) {
        results.push(item.embedding);
      }
    } catch (error: any) {
      console.error(
        `[Embedding Batch Error]: Batch [${i}..${i + batch.length - 1}] failed:`,
        error?.message || "Unknown error"
      );
      throw new Error("Failed to generate batch embeddings.");
    }
  }

  return results;
}
