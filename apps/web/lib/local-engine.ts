import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb } from "pdf-lib";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";

GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/legacy/build/pdf.worker.mjs",
  import.meta.url,
).toString();

export type LocalSourceType = "application/pdf" | "image/png" | "image/jpeg";

export function sniffSource(bytes: Uint8Array): LocalSourceType {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  const header = new TextDecoder("ascii").decode(bytes.subarray(0, Math.min(bytes.length, 1024)));
  if (/^\s*%PDF-\d\.\d/.test(header)) return "application/pdf";
  throw new Error("This file is not a supported source. Use a PDF, PNG, or JPEG.");
}

export interface ExtractedTextPage {
  pageNumber: number;
  text: string;
}

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const HORIZONTAL_MARGIN = 54;
const FIRST_BASELINE = 770;
const BOTTOM_MARGIN = 56;
const LINE_HEIGHT = 26;
const FONT_SIZE = 18;
export const MAX_SOURCE_PAGES = 100;
export const MAX_BROWSER_OCR_PAGES = 10;

export async function extractTextPages(
  source: Uint8Array,
  onPage?: (pageNumber: number, totalPages: number, text: string) => void,
  startPage = 1,
  allowEmpty = false,
): Promise<ExtractedTextPage[]> {
  const document = await getDocument({
    data: source.slice(),
    isEvalSupported: false,
    useWorkerFetch: false,
  }).promise;
  if (document.numPages > MAX_SOURCE_PAGES) {
    throw new Error(`PDFs with more than ${MAX_SOURCE_PAGES} pages are not supported.`);
  }
  if (startPage < 1 || startPage > document.numPages) {
    throw new Error("Processing checkpoint does not match this document.");
  }
  const pages: ExtractedTextPage[] = [];
  for (let pageNumber = startPage; pageNumber <= document.numPages; pageNumber += 1) {
    const sourcePage = await document.getPage(pageNumber);
    const content = await sourcePage.getTextContent();
    const pageWidth = sourcePage.getViewport({ scale: 1 }).width;
    const items = content.items
      .filter((item): item is typeof item & { str: string; transform: number[]; width: number; height: number } => "str" in item && Boolean(item.str.trim()))
      .map((item) => ({ text: item.str.trim(), x: item.transform[4], y: item.transform[5], width: item.width, height: item.height }))
      .sort((left, right) => right.y - left.y || left.x - right.x);
    const lines: Array<{ y: number; items: typeof items }> = [];
    for (const item of items) {
      const line = lines.find((candidate) => candidate.items.some((member) => {
        const overlap = Math.min(member.y + member.height, item.y + item.height) - Math.max(member.y, item.y);
        return Math.abs(candidate.y - item.y) <= 3 || overlap >= Math.min(member.height, item.height) * 0.4;
      }));
      if (line) line.items.push(item);
      else lines.push({ y: item.y, items: [item] });
    }
    const orderedLines = lines
      .sort((left, right) => right.y - left.y)
      .map((line) => line.items.sort((left, right) => left.x - right.x));
    const splitRows = orderedLines.filter((line) => line.some((item, index) => {
      const next = line[index + 1];
      return next && next.x - (item.x + item.width) > pageWidth * 0.18 && item.x < pageWidth * 0.45 && next.x > pageWidth * 0.45;
    })).length;
    if (splitRows >= 2) {
      throw new Error(`Page ${pageNumber} appears to use multiple columns; browser layout analysis is not enabled yet.`);
    }
    const text = orderedLines
      .map((line) => line.map((item) => item.text).join(" "))
      .join("\n");
    if (!text && !allowEmpty) throw new Error(`Page ${pageNumber} has no usable text layer.`);
    pages.push({ pageNumber, text });
    onPage?.(pageNumber, document.numPages, text);
  }
  return pages;
}

export async function renderA4Pdf(text: string, fontBytes: Uint8Array): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  const font = await document.embedFont(new Uint8Array(fontBytes), { subset: true });
  const maxWidth = A4_WIDTH - HORIZONTAL_MARGIN * 2;
  const linesPerPage = Math.floor((FIRST_BASELINE - BOTTOM_MARGIN) / LINE_HEIGHT) + 1;
  const lines: string[] = [];
  for (const sourceLine of text.split("\n")) {
    if (!sourceLine.trim()) {
      if (lines.at(-1) !== "") lines.push("");
      continue;
    }
    const wrapped: string[] = [];
    const words = sourceLine.match(/\S+/g) ?? [];
    for (const originalWord of words) {
      const chunks: string[] = [];
      let chunk = "";
      for (const character of originalWord) {
        if (chunk && font.widthOfTextAtSize(chunk + character, FONT_SIZE) > maxWidth) {
          chunks.push(chunk);
          chunk = character;
        } else {
          chunk += character;
        }
      }
      if (chunk) chunks.push(chunk);
      for (const word of chunks) {
        const last = wrapped.at(-1);
        if (!last || font.widthOfTextAtSize(`${last} ${word}`, FONT_SIZE) > maxWidth) wrapped.push(word);
        else wrapped[wrapped.length - 1] = `${last} ${word}`;
      }
    }
    lines.push(...wrapped);
  }

  const pageCount = Math.max(1, Math.ceil(lines.length / linesPerPage));
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const page = document.addPage([A4_WIDTH, A4_HEIGHT]);
    for (let lineIndex = 0; lineIndex < linesPerPage; lineIndex += 1) {
      const y = FIRST_BASELINE - lineIndex * LINE_HEIGHT - 5;
      page.drawLine({
        start: { x: HORIZONTAL_MARGIN - 8, y },
        end: { x: A4_WIDTH - HORIZONTAL_MARGIN + 8, y },
        thickness: 0.45,
        color: rgb(0.78, 0.85, 0.94),
      });
    }
    lines.slice(pageIndex * linesPerPage, (pageIndex + 1) * linesPerPage).forEach((line, lineIndex) => {
      if (!line) return;
      page.drawText(line, {
        x: HORIZONTAL_MARGIN,
        y: FIRST_BASELINE - lineIndex * LINE_HEIGHT,
        size: FONT_SIZE,
        font,
        color: rgb(0.11, 0.21, 0.34),
      });
    });
  }
  return document.save({ useObjectStreams: false });
}

export async function rasterizePdfPage(source: Uint8Array, pageNumber: number): Promise<Uint8Array> {
  const document = await getDocument({
    data: source.slice(),
    isEvalSupported: false,
    useWorkerFetch: false,
  }).promise;
  if (pageNumber < 1 || pageNumber > document.numPages) {
    throw new Error("That page is not in the source document.");
  }
  if (typeof OffscreenCanvas === "undefined") {
    throw new Error("This browser cannot rasterize scanned PDFs.");
  }
  const page = await document.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 2 });
  const canvas = new OffscreenCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot rasterize scanned PDFs.");
  await page.render({ canvas: canvas as unknown as HTMLCanvasElement, viewport }).promise;
  const blob = await canvas.convertToBlob({ type: "image/png" });
  return new Uint8Array(await blob.arrayBuffer());
}

export async function ocrEmptyPdfPages(
  pages: ExtractedTextPage[],
  ocrPage: (pageNumber: number) => Promise<string>,
): Promise<ExtractedTextPage[]> {
  const missing = pages.filter((page) => page.text.trim() === "");
  if (missing.length > MAX_BROWSER_OCR_PAGES) {
    throw new Error(`Browser OCR supports at most ${MAX_BROWSER_OCR_PAGES} scanned pages. Use the full local application for longer scans.`);
  }
  const filled: ExtractedTextPage[] = [];
  for (const page of pages) {
    if (page.text.trim()) {
      filled.push(page);
      continue;
    }
    filled.push({ pageNumber: page.pageNumber, text: await ocrPage(page.pageNumber) });
  }
  return filled;
}
