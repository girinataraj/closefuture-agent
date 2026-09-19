import dotenv from "dotenv";
dotenv.config();

import { searchKnowledge } from "./search.js";
import { RAG_CONFIG } from "./config.js";


async function runTests(): Promise<void> {
  console.log("==================================================");
  console.log("RAG Vector Search Verification");
  console.log(
    `Configuration: top_k=${RAG_CONFIG.TOP_K}, threshold=${RAG_CONFIG.SIMILARITY_THRESHOLD}`
  );
  console.log("==================================================\n");

  // TEST 1: Relevant service query from company profile
  const query1 = "What services does CloseFuture provide?";
  console.log(`[TEST 1] Grounded Query: "${query1}"`);
  const results1 = await searchKnowledge(query1);
  console.log(`Retrieved chunks count: ${results1.length}`);

  if (results1.length === 0) {
    console.warn("WARNING: No chunks retrieved for relevant query!");
  } else {
    results1.forEach((chunk, idx) => {
      console.log(`\n--- Result ${idx + 1} ---`);
      console.log(`Similarity: ${(chunk.similarity * 100).toFixed(2)}%`);
      console.log(`Source Page: ${chunk.source_page}`);
      console.log(`Source Section: ${chunk.source_section}`);
      console.log(`Category: ${chunk.category}`);
      console.log(`Document Type: ${chunk.document_type}`);
      console.log(`Content Excerpt:\n${chunk.content.slice(0, 280)}...`);
    });
  }

  console.log("\n--------------------------------------------------\n");

  // TEST 2: Out-of-domain / ungrounded query (must decline / return 0 or low-confidence)
  const query2 = "What is CloseFuture's office rent in Bangalore?";
  console.log(`[TEST 2] Out-of-Domain Query: "${query2}"`);
  const results2 = await searchKnowledge(query2);
  console.log(`Retrieved chunks count: ${results2.length}`);

  if (results2.length === 0) {
    console.log(
      `Outcome: 0 chunks met the similarity threshold (${RAG_CONFIG.SIMILARITY_THRESHOLD}).`
    );
    console.log(
      "Result: Successfully declined ungrounded query. No fabricated information retrieved."
    );
  } else {
    console.log(
      `Retrieved ${results2.length} borderline chunk(s) (highest similarity: ${(results2[0]!.similarity * 100).toFixed(2)}%).`
    );
  }

  console.log("\n==================================================");
}

if (
  process.argv[1]?.endsWith("testSearch.ts") ||
  process.argv[1]?.endsWith("testSearch.js")
) {
  runTests().catch((err) => {
    console.error("[Test Search Error]:", err?.message || err);
    process.exit(1);
  });
}
