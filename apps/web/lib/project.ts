import type { DocumentBlock, DocumentPage } from "@homeworker/contracts";

export interface FlatBlock extends DocumentBlock {
  documentPage: number;
}

export function pagePlainText(page: DocumentPage): string {
  return page.blocks.map((block) => block.text).join("\n\n");
}

export function flattenBlocks(pages: DocumentPage[]): FlatBlock[] {
  return pages.flatMap((page) =>
    page.blocks.map((block) => ({ ...block, documentPage: page.number })),
  );
}

export function safeProjectTitle(filename: string): string {
  return filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Untitled notes";
}
