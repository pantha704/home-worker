import { readFile } from "node:fs/promises";

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

  it("preserves visual lines and horizontal reading order", async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage([400, 600]);
    page.drawText("Second", { x: 130, y: 500, size: 16, font });
    page.drawText("First", { x: 40, y: 500, size: 16, font });
    page.drawText("Next line", { x: 40, y: 470, size: 16, font });

    await expect(extractTextPages(await pdf.save())).resolves.toEqual([
      { pageNumber: 1, text: "First Second\nNext line" },
    ]);
  });

  it("keeps a shifted superscript on its visual line", async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage([400, 600]);
    page.drawText("E = mc", { x: 40, y: 500, size: 16, font });
    page.drawText("2", { x: 95, y: 507, size: 10, font });

    await expect(extractTextPages(await pdf.save())).resolves.toEqual([
      { pageNumber: 1, text: "E = mc 2" },
    ]);
  });

  it("rejects repeated multi-column rows instead of scrambling reading order", async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage([400, 600]);
    page.drawText("Left one", { x: 40, y: 500, size: 16, font });
    page.drawText("Right one", { x: 250, y: 500, size: 16, font });
    page.drawText("Left two", { x: 40, y: 470, size: 16, font });
    page.drawText("Right two", { x: 250, y: 470, size: 16, font });

    await expect(extractTextPages(await pdf.save())).rejects.toThrow("multiple columns");
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
    const fontBytes = await readFile("../../assets/fonts/Kalam-Regular.ttf");
    const bytes = await renderA4Pdf("Reviewed wording", fontBytes);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getPage(0).getSize()).toMatchObject({ width: 595.28, height: 841.89 });
  });

  it("renders readable handwritten lines instead of a tiny top-row paragraph", async () => {
    const fontBytes = await readFile("../../assets/fonts/Kalam-Regular.ttf");
    const text = "A meaningful handwritten note should wrap into readable lines with comfortable spacing and useful page coverage. ".repeat(3);
    const bytes = await renderA4Pdf(text, fontBytes);
    const document = await getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
    const content = await (await document.getPage(1)).getTextContent();
    const items = content.items.filter((item): item is typeof item & { str: string; transform: number[]; height: number } => "str" in item && Boolean(item.str.trim()));
    const baselines = new Set(items.map((item) => Math.round(item.transform[5])));

    expect(baselines.size).toBeGreaterThanOrEqual(5);
    expect(Math.max(...items.map((item) => item.height))).toBeGreaterThanOrEqual(16);
  });

  it("uses one ruled line per explicit text line without adding blank rows", async () => {
    const fontBytes = await readFile("../../assets/fonts/Kalam-Regular.ttf");
    const bytes = await renderA4Pdf("First line\nSecond line", fontBytes);
    const document = await getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
    const content = await (await document.getPage(1)).getTextContent();
    const baselines = content.items
      .filter((item): item is typeof item & { str: string; transform: number[] } => "str" in item && Boolean(item.str.trim()))
      .map((item) => item.transform[5])
      .sort((left, right) => right - left);

    expect(baselines).toHaveLength(2);
    expect(baselines[0] - baselines[1]).toBeCloseTo(26, 0);
  });

  it("does not truncate reviewed text that overflows the first A4 page", async () => {
    const fontBytes = await readFile("../../assets/fonts/Kalam-Regular.ttf");
    const finalMarker = "LOSSLESS_FINAL_MARKER";
    const text = `${Array.from({ length: 900 }, (_, index) => `word-${index}`).join(" ")} ${finalMarker}`;
    const bytes = await renderA4Pdf(text, fontBytes);
    const pdf = await PDFDocument.load(bytes);

    expect(pdf.getPageCount()).toBeGreaterThan(1);
    const rendered = (await renderedText(bytes)).replace(/\s+/g, " ").trim();
    expect(rendered).toBe(text);
    expect(rendered).toContain(finalMarker);
  });

  it("splits an over-width token without dropping characters", async () => {
    const fontBytes = await readFile("../../assets/fonts/Kalam-Regular.ttf");
    const token = "X".repeat(240);
    const rendered = await renderedText(await renderA4Pdf(token, fontBytes));
    expect(rendered.replace(/\s+/g, "")).toBe(token);
  });
});
