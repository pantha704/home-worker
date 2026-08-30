import { PDFDocument, StandardFonts } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
// @ts-expect-error pdfjs-dist does not publish declarations for its worker entrypoint.
import { WorkerMessageHandler } from "pdfjs-dist/legacy/build/pdf.worker.mjs";
import { beforeAll, describe, expect, it } from "vitest";

import { extractTextPages, renderA4Pdf } from "@/lib/local-engine";

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

async function renderedText(bytes: Uint8Array): Promise<string> {
  const document = await getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const content = await (await document.getPage(pageNumber)).getTextContent();
    pages.push(content.items.flatMap((item) => "str" in item ? [item.str] : []).join(" "));
  }
  return pages.join(" ");
}

describe("browser-local PDF engine", () => {
  it("extracts one text-layer page without network access", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => { throw new Error("network forbidden"); };
    try {
      const result = await extractTextPages(await textPdf("Local only notes"));
      expect(result).toEqual([{ pageNumber: 1, text: "Local only notes" }]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("extracts every text-layer page in source order", async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    for (const text of ["First page marker", "Second page marker", "Third page marker"]) {
      const page = pdf.addPage([400, 600]);
      page.drawText(text, { x: 40, y: 540, size: 16, font });
    }

    await expect(extractTextPages(await pdf.save())).resolves.toEqual([
      { pageNumber: 1, text: "First page marker" },
      { pageNumber: 2, text: "Second page marker" },
      { pageNumber: 3, text: "Third page marker" },
    ]);
  });

  it("rejects oversized page counts before extracting content", async () => {
    const pdf = await PDFDocument.create();
    for (let page = 0; page < 101; page += 1) pdf.addPage();
    await expect(extractTextPages(await pdf.save())).rejects.toThrow("100 pages");
  });

  it("rejects a PDF when any page has no usable text layer", async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const textPage = pdf.addPage();
    textPage.drawText("Usable", { x: 40, y: 700, size: 16, font });
    pdf.addPage();
    await expect(extractTextPages(await pdf.save())).rejects.toThrow("Page 2 has no usable text layer");
  });

  it("renders reviewed text into a real A4 PDF", async () => {
    const bytes = await renderA4Pdf("Reviewed wording");
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getPage(0).getSize()).toMatchObject({ width: 595.28, height: 841.89 });
  });

  it("does not truncate reviewed text that overflows the first A4 page", async () => {
    const finalMarker = "LOSSLESS_FINAL_MARKER";
    const text = `${Array.from({ length: 900 }, (_, index) => `word-${index}`).join(" ")} ${finalMarker}`;
    const bytes = await renderA4Pdf(text);
    const pdf = await PDFDocument.load(bytes);

    expect(pdf.getPageCount()).toBeGreaterThan(1);
    const rendered = (await renderedText(bytes)).replace(/\s+/g, " ").trim();
    expect(rendered).toBe(text);
    expect(rendered).toContain(finalMarker);
  });

  it("splits an over-width token without dropping characters", async () => {
    const token = "X".repeat(240);
    const rendered = await renderedText(await renderA4Pdf(token));
    expect(rendered.replace(/\s+/g, "")).toBe(token);
  });
});
