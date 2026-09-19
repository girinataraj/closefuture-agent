import crypto from "node:crypto";
import { RAG_CONFIG } from "./config.js";
import type { StructuredDocument } from "./buildDocuments.js";

/**
 * =============================================================================
 * CHUNKING STRATEGY RATIONALE
 * =============================================================================
 * 1. Self-contained units:
 *    CloseFuture's company profile is a dense, high-signal 15-page document.
 *    Each section (Services, Process, Founder, Case Studies) forms a cohesive
 *    semantic block. Keeping sections together ensures that when a vector search
 *    retrieves a chunk, the LLM receives the full problem, solution, tech stack,
 *    and outcome without missing context.
 *
 * 2. Target chunk size: 500–700 tokens (~2,000–2,800 characters)
 *    Moderate chunk sizing fits the nature of the company profile: small enough
 *    for precise relevance scoring, yet large enough to contain complete answers
 *    to buyer questions (e.g., pricing, turnaround, tech stack, case studies).
 *
 * 3. Contextual overlap: 80–100 tokens (~320–400 characters)
 *    When documents exceed the target size and require splitting, overlap
 *    ensures that transitions, criteria, or sub-bullets that span boundaries
 *    maintain their semantic meaning in both neighboring chunks.
 *
 * 4. Semantic boundary preservation:
 *    Splits prioritize markdown headings (##), followed by double newlines
 *    (paragraphs) and sentence boundaries. Splitting never occurs mid-sentence
 *    or mid-bullet point.
 * =============================================================================
 */

export interface KnowledgeChunkItem {
  id: string; // Deterministic UUID derived from SHA-256 for idempotent upserts
  content: string;
  source_page: number;
  source_section: string;
  document_type: string;
  category: string;
  chunk_index: number;
  token_count_est: number;
}

/**
 * Estimates token count using standard English rule-of-thumb (~4 characters per token).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.trim().length / RAG_CONFIG.AVERAGE_CHARS_PER_TOKEN);
}

/**
 * Generates a stable, deterministic UUID for a chunk based on its unique
 * identity and content hash. Guarantees that re-running ingestion is idempotent.
 */
export function generateChunkId(
  documentType: string,
  sourcePage: number,
  sourceSection: string,
  chunkIndex: number,
  content: string
): string {
  const hash = crypto
    .createHash("sha256")
    .update(
      `${documentType}:${sourcePage}:${sourceSection}:${chunkIndex}:${content.trim()}`
    )
    .digest("hex");

  // Format the 64-char SHA256 hex into a standard 36-char UUID (8-4-4-4-12)
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

/**
 * Splits text into chunks respecting semantic boundaries (headings, paragraphs)
 * with overlap between adjacent chunks.
 */
function splitWithOverlap(
  text: string,
  maxChars: number,
  overlapChars: number
): string[] {
  // If the document fits comfortably within maxChars, keep it as a single chunk
  if (text.length <= maxChars) {
    return [text.trim()];
  }

  // Split by markdown headers or double newlines (paragraphs)
  const blocks = text.split(/\n(?=## )|\n\n+/).filter((b) => b.trim().length > 0);
  const chunks: string[] = [];
  let currentChunk = "";

  for (const block of blocks) {
    const candidate = currentChunk ? `${currentChunk}\n\n${block}` : block;

    if (candidate.length <= maxChars) {
      currentChunk = candidate;
    } else {
      if (currentChunk.trim().length > 0) {
        chunks.push(currentChunk.trim());

        // Extract trailing overlap from currentChunk
        const overlapText =
          currentChunk.length > overlapChars
            ? currentChunk.slice(-overlapChars).trim()
            : currentChunk.trim();

        currentChunk = `${overlapText}\n\n${block}`;
      } else {
        // Single block is larger than maxChars, push it directly
        chunks.push(block.trim());
        currentChunk = "";
      }
    }
  }

  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

/**
 * Chunks a collection of structured knowledge documents into indexable chunks.
 */
export function chunkDocuments(
  documents: StructuredDocument[]
): KnowledgeChunkItem[] {
  const maxChars =
    RAG_CONFIG.TARGET_CHUNK_SIZE_TOKENS * RAG_CONFIG.AVERAGE_CHARS_PER_TOKEN; // ~2400 chars
  const overlapChars =
    RAG_CONFIG.CHUNK_OVERLAP_TOKENS * RAG_CONFIG.AVERAGE_CHARS_PER_TOKEN; // ~360 chars

  const allChunks: KnowledgeChunkItem[] = [];

  for (const doc of documents) {
    const textPieces = splitWithOverlap(doc.content, maxChars, overlapChars);

    textPieces.forEach((content, index) => {
      const chunkId = generateChunkId(
        doc.document_type,
        doc.source_page,
        doc.source_section,
        index,
        content
      );

      allChunks.push({
        id: chunkId,
        content,
        source_page: doc.source_page,
        source_section: doc.source_section,
        document_type: doc.document_type,
        category: doc.category,
        chunk_index: index,
        token_count_est: estimateTokens(content),
      });
    });
  }

  return allChunks;
}
