import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb } from "pdf-lib";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";

GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/legacy/build/pdf.worker.mjs",
  import.meta.url,
).toString();

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
const MAX_SOURCE_PAGES = 100;

export async function extractTextPages(
  source: Uint8Array,
  onPage?: (pageNumber: number, totalPages: number) => void,
): Promise<ExtractedTextPage[]> {
  const document = await getDocument({
    data: source.slice(),
    isEvalSupported: false,
    useWorkerFetch: false,
  }).promise;
  if (document.numPages > MAX_SOURCE_PAGES) {
    throw new Error(`PDFs with more than ${MAX_SOURCE_PAGES} pages are not supported.`);
  }
  const pages: ExtractedTextPage[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
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
    if (!text) throw new Error(`Page ${pageNumber} has no usable text layer; browser OCR is not enabled yet.`);
    pages.push({ pageNumber, text });
    onPage?.(pageNumber, document.numPages);
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
