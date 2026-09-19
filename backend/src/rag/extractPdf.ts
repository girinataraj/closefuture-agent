import fs from "node:fs";
import path from "node:path";
import { PDFParse } from "pdf-parse";

export interface ExtractedPage {
  page: number;
  text: string;
}

export function resolvePdfPath(customPath?: string): string {
  if (customPath && fs.existsSync(customPath)) {
    return path.resolve(customPath);
  }

  const searchLocations = [
    path.resolve(process.cwd(), "data/closefuture-company-profile.pdf"),
    path.resolve(process.cwd(), "../data/closefuture-company-profile.pdf"),
    path.resolve(process.cwd(), "docs/closefuture-company-profile.pdf"),
    path.resolve(process.cwd(), "../docs/closefuture-company-profile.pdf"),
  ];

  for (const candidate of searchLocations) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    "Could not locate closefuture-company-profile.pdf. Looked in: " +
      searchLocations.join(", ")
  );
}

/**
 * Extracts text from the CloseFuture company profile PDF page by page.
 * Preserves exact page numbers (1-indexed) and returns structured page records.
 */
export async function extractPdf(customPath?: string): Promise<ExtractedPage[]> {
  const filePath = resolvePdfPath(customPath);
  const fileBuffer = fs.readFileSync(filePath);

  const parser = new PDFParse(new Uint8Array(fileBuffer));
  const parsed = await parser.getText();

  if (!parsed.pages || parsed.pages.length === 0) {
    throw new Error(`Failed to extract pages from PDF: ${filePath}`);
  }

  return parsed.pages.map((p) => ({
    page: p.num,
    text: p.text.trim(),
  }));
}
