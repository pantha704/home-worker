import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";

GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/legacy/build/pdf.worker.mjs",
  import.meta.url,
).toString();

export interface ExtractedTextPage {
  pageNumber: 1;
  text: string;
}

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const HORIZONTAL_MARGIN = 54;
const FIRST_BASELINE = 787;
const BOTTOM_MARGIN = 40;
const LINE_HEIGHT = 14.5;

export async function extractTextPage(source: Uint8Array): Promise<ExtractedTextPage> {
  const document = await getDocument({
    data: source.slice(),
    isEvalSupported: false,
    useWorkerFetch: false,
  }).promise;
  if (document.numPages !== 1) throw new Error("The local preview supports one-page PDFs for now.");
  const content = await (await document.getPage(1)).getTextContent();
  const text = content.items
    .filter((item): item is typeof item & { str: string } => "str" in item)
    .map((item) => item.str.trim())
    .filter(Boolean)
    .join(" ");
  if (!text) throw new Error("This PDF has no usable text layer; browser OCR is not enabled yet.");
  return { pageNumber: 1, text };
}

export async function renderA4Pdf(text: string): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const size = 12;
  const maxWidth = A4_WIDTH - HORIZONTAL_MARGIN * 2;
  const linesPerPage = Math.floor((FIRST_BASELINE - BOTTOM_MARGIN) / LINE_HEIGHT) + 1;
  const words = (text.match(/\S+/g) ?? []).flatMap((word) => {
    const chunks: string[] = [];
    let chunk = "";
    for (const character of word) {
      if (chunk && font.widthOfTextAtSize(chunk + character, size) > maxWidth) {
        chunks.push(chunk);
        chunk = character;
      } else {
        chunk += character;
      }
    }
    if (chunk) chunks.push(chunk);
    return chunks;
  });
  const lines: string[] = [];
  for (const word of words) {
    const last = lines.at(-1);
    if (!last || font.widthOfTextAtSize(`${last} ${word}`, size) > maxWidth) lines.push(word);
    else lines[lines.length - 1] = `${last} ${word}`;
  }

  const pageCount = Math.max(1, Math.ceil(lines.length / linesPerPage));
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const page = document.addPage([A4_WIDTH, A4_HEIGHT]);
    lines.slice(pageIndex * linesPerPage, (pageIndex + 1) * linesPerPage).forEach((line, lineIndex) => {
      page.drawText(line, {
        x: HORIZONTAL_MARGIN,
        y: FIRST_BASELINE - lineIndex * LINE_HEIGHT,
        size,
        font,
        color: rgb(0.11, 0.21, 0.34),
      });
    });
  }
  return document.save({ useObjectStreams: false });
}
