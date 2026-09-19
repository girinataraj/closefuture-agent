export const RAG_CONFIG = {
  TOP_K: process.env.RAG_TOP_K ? parseInt(process.env.RAG_TOP_K, 10) : 4,
  SIMILARITY_THRESHOLD: process.env.RAG_SIMILARITY_THRESHOLD
    ? parseFloat(process.env.RAG_SIMILARITY_THRESHOLD)
    : 0.58,
  EMBEDDING_MODEL: "text-embedding-3-small",
  EMBEDDING_DIMENSIONS: 1536,
  TARGET_CHUNK_SIZE_TOKENS: 600, // 500–700 tokens target
  CHUNK_OVERLAP_TOKENS: 90, // 80–100 tokens overlap
  AVERAGE_CHARS_PER_TOKEN: 4, // standard rule of thumb for English token estimation
} as const;
