import { PDFDocument, StandardFonts } from "pdf-lib";
// @ts-expect-error pdfjs-dist does not publish declarations for its worker entrypoint.
import { WorkerMessageHandler } from "pdfjs-dist/legacy/build/pdf.worker.mjs";
import { beforeAll, describe, expect, it } from "vitest";

import { extractTextPage, renderA4Pdf } from "@/lib/local-engine";

beforeAll(() => {
  Object.assign(globalThis, { pdfjsWorker: { WorkerMessageHandler } });
});

async function textPdf(text: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([400, 600]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText(text, { x: 40, y: 540, size: 16, font });
  return pdf.save();
}

describe("browser-local PDF engine", () => {
  it("extracts one text-layer page without network access", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => { throw new Error("network forbidden"); };
    try {
      const result = await extractTextPage(await textPdf("Local only notes"));
      expect(result).toMatchObject({ pageNumber: 1, text: "Local only notes" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects scanned or multi-page PDFs instead of pretending OCR succeeded", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    await expect(extractTextPage(await pdf.save())).rejects.toThrow("text layer");
    pdf.addPage();
    await expect(extractTextPage(await pdf.save())).rejects.toThrow("one-page");
  });

  it("renders reviewed text into a real A4 PDF", async () => {
    const bytes = await renderA4Pdf("Reviewed wording");
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getPage(0).getSize()).toMatchObject({ width: 595.28, height: 841.89 });
  });
});
