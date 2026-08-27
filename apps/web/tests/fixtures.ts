import type { ProjectDocument } from "@homeworker/contracts";

export function makeProject(overrides: Partial<ProjectDocument> = {}): ProjectDocument {
  return {
    id: "project-42",
    filename: "biology-notes.pdf",
    mimeType: "application/pdf",
    sha256: "a".repeat(64),
    status: "needs_review",
    revision: 2,
    createdAt: "2026-07-15T10:00:00.000Z",
    updatedAt: "2026-07-15T10:01:00.000Z",
    pages: [
      {
        number: 1,
        widthPoints: 595.28,
        heightPoints: 841.89,
        blocks: [
          {
            id: "block-1",
            kind: "paragraph",
            text: "Mitochondria produce usable energy for the cell.",
            confidence: 0.68,
            reviewed: false,
            source: {
              pageNumber: 1,
              bbox: { x: 42, y: 80, width: 410, height: 28 },
              extractor: "tesseract",
            },
            warnings: [
              { code: "low_confidence", message: "Check the highlighted OCR wording.", severity: "warning" },
            ],
          },
        ],
      },
    ],
    settings: {
      personaId: "scholar",
      seed: 42,
      inkColor: "#183B73",
      paperStyle: "ruled",
      marginMm: 15,
      lineSpacing: 1.2,
      fontSizePt: 0,
    },
    error: null,
    ...overrides,
  };
}
