import { describe, expect, it } from "vitest";

import { clampSeed, formatFileSize, MAX_UPLOAD_BYTES, validateUpload } from "@/lib/validation";

describe("validateUpload", () => {
  it("accepts a non-empty supported PDF", () => {
    const file = new File(["%PDF-1.7"], "lecture.pdf", { type: "application/pdf" });
    expect(validateUpload(file)).toEqual({ valid: true, message: null });
  });

  it("rejects a misleading extension", () => {
    const file = new File(["image"], "lecture.exe", { type: "image/png" });
    expect(validateUpload(file).valid).toBe(false);
  });

  it("rejects empty and oversized files", () => {
    expect(validateUpload(new File([], "empty.pdf", { type: "application/pdf" })).message).toMatch(/empty/i);
    const bytes = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    expect(validateUpload(new File([bytes], "large.pdf", { type: "application/pdf" })).message).toMatch(/25 MB/i);
  });
});

describe("formatting helpers", () => {
  it("formats sizes and clamps deterministic seeds", () => {
    expect(formatFileSize(1_572_864)).toBe("1.5 MB");
    expect(clampSeed(-5)).toBe(0);
    expect(clampSeed(3_000_000_000)).toBe(2_147_483_647);
  });
});
