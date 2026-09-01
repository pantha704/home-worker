import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = join(fileURLToPath(new URL("..", import.meta.url)), "public", "tesseract");
const workerDir = join(dirname(require.resolve("tesseract.js/package.json")), "dist");
const coreDir = dirname(require.resolve("tesseract.js-core/package.json"));
const langUrl = "https://cdn.jsdelivr.net/gh/naptha/tessdata@gh-pages/4.0.0/eng.traineddata.gz";
const langSha256 = "ed350f3752f81ee8f38769edc14d92d997dababe23b565c59879372cc46a2468";

const coreFiles = [
  "tesseract-core.wasm.js",
  "tesseract-core.wasm",
  "tesseract-core-simd.wasm.js",
  "tesseract-core-simd.wasm",
  "tesseract-core-lstm.wasm.js",
  "tesseract-core-lstm.wasm",
  "tesseract-core-simd-lstm.wasm.js",
  "tesseract-core-simd-lstm.wasm",
];

await mkdir(join(root, "core"), { recursive: true });
await mkdir(join(root, "lang"), { recursive: true });
await copyFile(join(workerDir, "worker.min.js"), join(root, "worker.min.js"));
for (const file of coreFiles) {
  await copyFile(join(coreDir, file), join(root, "core", file));
}

const langPath = join(root, "lang", "eng.traineddata.gz");
let digest;
try {
  const existing = await readFile(langPath);
  digest = createHash("sha256").update(existing).digest("hex");
  if (digest !== langSha256) throw new Error("stale");
} catch {
  const response = await fetch(langUrl);
  if (!response.ok) throw new Error(`Could not vendor English OCR data (${response.status}).`);
  const bytes = Buffer.from(await response.arrayBuffer());
  digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== langSha256) throw new Error(`English OCR data digest mismatch: ${digest}`);
  await writeFile(langPath, bytes);
}
await writeFile(join(root, "lang", "SHA256"), `${digest}  eng.traineddata.gz\n`);
console.log(`vendored tesseract assets → ${root}`);
console.log(`eng.traineddata.gz sha256 ${digest}`);
