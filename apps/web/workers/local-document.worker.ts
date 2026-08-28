/// <reference lib="webworker" />

import { extractTextPage, renderA4Pdf } from "@/lib/local-engine";

type Request =
  | { action: "process"; source: Uint8Array }
  | { action: "render"; text: string };

self.onmessage = async (event: MessageEvent<Request>) => {
  try {
    if (event.data.action === "process") {
      const page = await extractTextPage(event.data.source);
      const pdf = await renderA4Pdf(page.text);
      self.postMessage({ kind: "result", text: page.text, pdf }, { transfer: [pdf.buffer] });
    } else {
      const pdf = await renderA4Pdf(event.data.text);
      self.postMessage({ kind: "result", pdf }, { transfer: [pdf.buffer] });
    }
  } catch (error) {
    self.postMessage({ kind: "error", error: error instanceof Error ? error.message : "Local processing failed." });
  }
};
