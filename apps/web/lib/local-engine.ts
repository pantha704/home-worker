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
  const page = document.addPage([595.28, 841.89]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const size = 12;
  const maxCharacters = 82;
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  for (const word of words) {
    const last = lines.at(-1);
    if (!last || `${last} ${word}`.length > maxCharacters) lines.push(word);
    else lines[lines.length - 1] = `${last} ${word}`;
  }
  lines.slice(0, 52).forEach((line, index) => {
    page.drawText(line, { x: 54, y: 787 - index * 14.5, size, font, color: rgb(0.11, 0.21, 0.34) });
  });
  return document.save({ useObjectStreams: false });
}
