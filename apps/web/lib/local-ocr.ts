import { createWorker } from "tesseract.js";

import { sniffSource } from "@/lib/local-engine";
import { MAX_UPLOAD_BYTES } from "@/lib/validation";

export interface OcrAssets {
  workerPath?: string;
  corePath?: string;
  langPath: string;
}

export function browserOcrAssets(origin = typeof location !== "undefined" ? location.origin : ""): OcrAssets {
  if (!/^https?:/.test(origin)) throw new Error("Browser OCR assets are not configured.");
  return {
    workerPath: `${origin}/tesseract/worker.min.js`,
    corePath: `${origin}/tesseract/core`,
    langPath: `${origin}/tesseract/lang`,
  };
}

export async function extractImageText(bytes: Uint8Array, assets: OcrAssets): Promise<string> {
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error("This image is larger than the 25 MB local limit.");
  }
  const mime = sniffSource(bytes);
  if (mime !== "image/png" && mime !== "image/jpeg") {
    throw new Error("Browser OCR currently supports PNG and JPEG images.");
  }
  const options: {
    workerPath?: string;
    corePath?: string;
    langPath: string;
    gzip: true;
    cacheMethod: "none";
  } = {
    langPath: assets.langPath,
    gzip: true,
    cacheMethod: "none",
  };
  if (assets.workerPath) options.workerPath = assets.workerPath;
  if (assets.corePath) options.corePath = assets.corePath;
  const worker = await createWorker("eng", 1, options);
  try {
    const image = typeof Buffer === "undefined"
      ? new Blob([bytes.slice()], { type: mime })
      : Buffer.from(bytes);
    const result = await worker.recognize(image);
    const text = result.data.text.replace(/[ \t]+\n/g, "\n").trim();
    if (!text) throw new Error("This image has no usable text.");
    return text;
  } finally {
    await worker.terminate();
  }
}
