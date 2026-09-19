import dotenv from "dotenv";
dotenv.config();

import { supabase } from "../db/supabase.js";
import { extractPdf, resolvePdfPath } from "./extractPdf.js";
import { buildDocuments } from "./buildDocuments.js";
import { chunkDocuments } from "./chunker.js";
import { generateBatchEmbeddings } from "./embed.js";

export interface IngestionResult {
  pagesProcessed: number;
  sourceDocumentsCount: number;
  chunksGenerated: number;
  chunksInserted: number;
  chunksSkippedOrUpdated: number;
}

/**
 * Executes the complete RAG ingestion pipeline:
 * PDF -> extraction -> structured source documents -> semantic chunks -> embeddings -> Supabase pgvector
 */
export async function runIngestion(): Promise<IngestionResult> {
  console.log("[RAG Ingest]: Step 1/5 - Validating and locating company profile PDF...");
  const pdfPath = resolvePdfPath();
  console.log(`[RAG Ingest]: Found source PDF at: ${pdfPath}`);

  console.log("[RAG Ingest]: Step 2/5 - Extracting text page-by-page...");
  const pages = await extractPdf(pdfPath);
  console.log(`[RAG Ingest]: Extracted ${pages.length} pages.`);

  console.log("[RAG Ingest]: Step 3/5 - Building structured knowledge documents...");
  const sourceDocs = buildDocuments(pages);
  console.log(
    `[RAG Ingest]: Generated ${sourceDocs.length} structured markdown source documents in data/knowledge/`
  );

  console.log("[RAG Ingest]: Step 4/5 - Chunking documents with semantic boundaries & overlap...");
  const chunks = chunkDocuments(sourceDocs);
  console.log(`[RAG Ingest]: Generated ${chunks.length} self-contained chunks.`);

  console.log("[RAG Ingest]: Checking existing chunks in Supabase for idempotency...");
  const { data: existingRows, error: checkError } = await supabase
    .from("knowledge_chunks")
    .select("id");

  if (checkError) {
    throw new Error(
      `Failed to query existing knowledge_chunks: ${checkError.message}`
    );
  }

  const existingIds = new Set((existingRows || []).map((row) => row.id));
  let chunksInserted = 0;
  let chunksSkippedOrUpdated = 0;

  for (const chunk of chunks) {
    if (existingIds.has(chunk.id)) {
      chunksSkippedOrUpdated++;
    } else {
      chunksInserted++;
    }
  }

  console.log(
    `[RAG Ingest]: Idempotency audit: ${chunksInserted} new chunk(s), ${chunksSkippedOrUpdated} existing chunk(s).`
  );

  console.log("[RAG Ingest]: Step 5/5 - Generating batch embeddings (text-embedding-3-small)...");
  const textsToEmbed = chunks.map((c) => c.content);
  const embeddings = await generateBatchEmbeddings(textsToEmbed);

  if (embeddings.length !== chunks.length) {
    throw new Error(
      `Embedding mismatch: ${embeddings.length} embeddings returned for ${chunks.length} chunks.`
    );
  }

  console.log("[RAG Ingest]: Upserting chunks and embeddings into Supabase knowledge_chunks...");
  const records = chunks.map((chunk, index) => ({
    id: chunk.id,
    content: chunk.content,
    source_page: chunk.source_page,
    source_section: chunk.source_section,
    document_type: chunk.document_type,
    category: chunk.category,
    chunk_index: chunk.chunk_index,
    embedding: embeddings[index],
  }));

  // Upsert in batches to ensure reliable network transfer
  const batchSize = 10;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const { error: upsertError } = await supabase
      .from("knowledge_chunks")
      .upsert(batch, { onConflict: "id" });

    if (upsertError) {
      throw new Error(
        `Failed to upsert knowledge_chunks batch [${i}..${i + batch.length - 1}]: ${upsertError.message}`
      );
    }
  }

  const result: IngestionResult = {
    pagesProcessed: pages.length,
    sourceDocumentsCount: sourceDocs.length,
    chunksGenerated: chunks.length,
    chunksInserted,
    chunksSkippedOrUpdated,
  };

  console.log("\n==================================================");
  console.log("RAG ingestion complete");
  console.log(`Pages processed: ${result.pagesProcessed}`);
  console.log(`Source documents: ${result.sourceDocumentsCount}`);
  console.log(`Chunks generated: ${result.chunksGenerated}`);
  console.log(`Chunks inserted: ${result.chunksInserted}`);
  console.log(`Chunks skipped/updated: ${result.chunksSkippedOrUpdated}`);
  console.log("==================================================\n");

  return result;
}

// Execute directly if run as main script
if (process.argv[1]?.endsWith("ingest.ts") || process.argv[1]?.endsWith("ingest.js")) {
  runIngestion()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error("[RAG Ingest Error]:", err?.message || err);
      process.exit(1);
    });
}
