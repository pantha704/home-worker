/** @vitest-environment node */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { browserOcrAssets, extractImageText } from "@/lib/local-ocr";

const langPath = `${resolve("public/tesseract")}/lang`;

describe("browser-local OCR", () => {
  it("reads HOMEWORKER from a generated PNG without contacting a CDN", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL) => {
      throw new Error(`network forbidden: ${String(input)}`);
    }) as typeof fetch;
    try {
      const text = await extractImageText(await readFile("../../fixtures/ocr-homeworker.png"), { langPath });
      expect(text.replace(/\s+/g, "")).toMatch(/HOMEWORKER/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }, 120_000);

  it("rejects an empty raster", async () => {
    await expect(extractImageText(await readFile("../../fixtures/ocr-blank.png"), { langPath })).rejects.toThrow("usable text");
  }, 120_000);

  it("refuses PDF bytes and unconfigured browser assets", async () => {
    await expect(extractImageText(new TextEncoder().encode("%PDF-1.7"), { langPath })).rejects.toThrow("PNG and JPEG");
    expect(() => browserOcrAssets("file://")).toThrow("not configured");
    expect(browserOcrAssets("https://home-worker.pages.dev")).toEqual({
      workerPath: "https://home-worker.pages.dev/tesseract/worker.min.js",
      corePath: "https://home-worker.pages.dev/tesseract/core",
      langPath: "https://home-worker.pages.dev/tesseract/lang",
    });
  });
});
