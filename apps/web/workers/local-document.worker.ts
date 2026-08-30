/// <reference lib="webworker" />

import { extractTextPages, renderA4Pdf } from "@/lib/local-engine";

type Request =
  | { action: "process"; requestId: string; source: Uint8Array }
  | { action: "render"; requestId: string; text: string };

self.onmessage = async (event: MessageEvent<Request>) => {
  try {
    if (event.data.action === "process") {
      const pages = await extractTextPages(event.data.source, (completed, total) => {
        self.postMessage({ kind: "progress", requestId: event.data.requestId, completed, total });
      });
      const text = pages.map((page) => page.text).join("\n\n");
      const pdf = await renderA4Pdf(text);
      self.postMessage({ kind: "result", requestId: event.data.requestId, text, pdf }, { transfer: [pdf.buffer] });
    } else {
      const pdf = await renderA4Pdf(event.data.text);
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
