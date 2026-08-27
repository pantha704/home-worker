import type {
  DocumentBlock,
  DocumentPage,
  ProjectDocument,
} from "@homeworker/contracts";

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

export function needsHumanReview(block: DocumentBlock): boolean {
  return !block.reviewed && (block.confidence < 0.9 || block.warnings.length > 0);
}

export function getReviewStats(project: ProjectDocument): {
  reviewed: number;
  total: number;
  percent: number;
  remaining: number;
} {
  const blocks = flattenBlocks(project.pages);
  const reviewable = blocks.filter(
    (block) => block.confidence < 0.9 || block.warnings.length > 0 || block.reviewed,
  );
  const reviewed = reviewable.filter((block) => block.reviewed).length;
  const total = reviewable.length;

  return {
    reviewed,
    total,
    percent: total === 0 ? 100 : Math.round((reviewed / total) * 100),
    remaining: total - reviewed,
  };
}

export function confidenceLabel(confidence: number): "High" | "Check" | "Low" {
  if (confidence >= 0.9) return "High";
  if (confidence >= 0.72) return "Check";
  return "Low";
}

export function safeProjectTitle(filename: string): string {
  return filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Untitled notes";
}
