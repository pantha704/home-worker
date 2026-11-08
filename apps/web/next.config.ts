import type { NextConfig } from "next";

const hosted = process.env.NEXT_PUBLIC_RUNTIME_MODE === "hosted";
const staticExport = hosted || process.env.NEXT_PUBLIC_STATIC_EXPORT === "1";
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").trim().replace(/\/+$/, "");

const nextConfig: NextConfig = {
  distDir: process.env.HOMEWORKER_NEXT_DIST_DIR ?? ".next",
  output: staticExport ? "export" : "standalone",
  trailingSlash: staticExport,
  // Project-site hosts (for example GitHub Pages at /repo-name) need a path prefix.
  // Cloudflare Pages and local development stay at the origin root.
  basePath: basePath || undefined,
  assetPrefix: basePath || undefined,
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ["@homeworker/contracts"],
  experimental: {
    optimizePackageImports: ["@homeworker/contracts"],
  },
};

export default nextConfig;
