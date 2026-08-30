import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

function origin(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the hosted build`);
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error(`${name} must be an HTTPS origin without a path`);
  }
  return parsed.origin;
}

const localOnly = process.env.NEXT_PUBLIC_STATIC_EXPORT === "1";
const api = localOnly ? null : origin("NEXT_PUBLIC_API_BASE_URL");
const supabase = localOnly ? null : origin("NEXT_PUBLIC_SUPABASE_URL");

async function htmlFiles(directory) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await htmlFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".html")) paths.push(path);
  }
  return paths;
}

const scriptHashes = new Set();
for (const file of await htmlFiles(resolve("out"))) {
  const html = await readFile(file, "utf8");
  const scripts = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(scripts)) {
    if (/\bsrc\s*=/i.test(match[1]) || match[2].length === 0) continue;
    const digest = createHash("sha256").update(match[2], "utf8").digest("base64");
    scriptHashes.add(`'sha256-${digest}'`);
  }
}
if (scriptHashes.size === 0) throw new Error("The hosted export has no inline scripts to hash");

const policy = [
  "default-src 'self'",
  "base-uri 'self'",
  `connect-src 'self'${localOnly ? "" : ` ${api} ${supabase}`}`,
  "font-src 'self'",
  "form-action 'self'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "img-src 'self' data: blob:",
  "manifest-src 'self'",
  "media-src 'none'",
  "object-src 'self' blob:",
  `script-src 'self' ${[...scriptHashes].sort().join(" ")}`,
  "script-src-attr 'none'",
  "style-src 'self' 'unsafe-inline'",
  "worker-src 'self' blob:",
  "upgrade-insecure-requests",
].join("; ");
const headers = `/*
  Content-Security-Policy: ${policy}
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Resource-Policy: same-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Referrer-Policy: no-referrer
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
`;

await writeFile(resolve("out/_headers"), headers, { encoding: "utf8", flag: "wx" });
