import { describe, expect, it } from "vitest";

import { flattenBlocks, getReviewStats, needsHumanReview, safeProjectTitle } from "@/lib/project";
import { makeProject } from "@/tests/fixtures";

describe("project review helpers", () => {
  it("keeps page provenance when flattening blocks", () => {
    const project = makeProject();
    expect(flattenBlocks(project.pages)[0]).toMatchObject({ id: "block-1", documentPage: 1 });
  });

  it("requires review for uncertain or warned extraction", () => {
    const block = makeProject().pages[0]!.blocks[0]!;
    expect(needsHumanReview(block)).toBe(true);
    expect(getReviewStats(makeProject())).toEqual({ reviewed: 0, total: 1, percent: 0, remaining: 1 });
  });

  it("creates a readable title without mutating the source filename", () => {
    expect(safeProjectTitle("cell_division-notes.pdf")).toBe("cell division notes");
  });
});
