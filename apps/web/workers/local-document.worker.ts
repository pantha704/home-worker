/// <reference lib="webworker" />

import { extractTextPages, rasterizeFirstPdfPage, renderA4Pdf, sniffSource } from "@/lib/local-engine";
import { browserOcrAssets, extractImageText } from "@/lib/local-ocr";

let handwritingFont: Promise<Uint8Array> | undefined;

function loadHandwritingFont(): Promise<Uint8Array> {
  handwritingFont ??= fetch("/fonts/Kalam-Regular.ttf")
    .then((response) => {
      if (!response.ok) throw new Error("The handwriting font could not be loaded.");
      return response.arrayBuffer();
    })
    .then((buffer) => new Uint8Array(buffer))
    .catch((error) => {
      handwritingFont = undefined;
      throw error;
    });
  return handwritingFont;
}

type Request =
  | { action: "process"; requestId: string; source: Uint8Array; resumeFrom?: number; priorPages?: string[] }
  | { action: "render"; requestId: string; text: string };

async function extractSource(request: Extract<Request, { action: "process" }>): Promise<string> {
  const mime = sniffSource(request.source);
  const assets = browserOcrAssets(self.location.origin);
  const prior = Array.isArray(request.priorPages) ? request.priorPages.filter((page) => typeof page === "string") : [];
  if (mime !== "application/pdf") {
    if (prior.length > 0) return prior.join("\n\n");
    self.postMessage({ kind: "progress", requestId: request.requestId, completed: 0, total: 1 });
    const text = await extractImageText(request.source, assets);
    self.postMessage({ kind: "progress", requestId: request.requestId, completed: 1, total: 1, text });
    return text;
  }
  try {
    const pages = await extractTextPages(request.source, (completed, total, text) => {
      self.postMessage({ kind: "progress", requestId: request.requestId, completed, total, text });
    }, request.resumeFrom ?? 1);
    return [...prior, ...pages.map((page) => page.text)].join("\n\n");
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("no usable text layer")) throw error;
    if (prior.length > 0) return prior.join("\n\n");
    self.postMessage({ kind: "progress", requestId: request.requestId, completed: 0, total: 1 });
    const text = await extractImageText(await rasterizeFirstPdfPage(request.source), assets);
    self.postMessage({ kind: "progress", requestId: request.requestId, completed: 1, total: 1, text });
    return text;
  }
}

self.onmessage = async (event: MessageEvent<Request>) => {
  try {
    if (event.data.action === "process") {
      const text = await extractSource(event.data);
      const pdf = await renderA4Pdf(text, await loadHandwritingFont());
      self.postMessage({ kind: "result", requestId: event.data.requestId, text, pdf }, { transfer: [pdf.buffer] });
    } else {
      const pdf = await renderA4Pdf(event.data.text, await loadHandwritingFont());
      self.postMessage({ kind: "result", requestId: event.data.requestId, pdf }, { transfer: [pdf.buffer] });
    }
  } catch (error) {
    self.postMessage({
      kind: "error",
      requestId: event.data.requestId,
      error: error instanceof Error ? error.message : "Local processing failed.",
    });
  }
};
