import type { NextConfig } from "next";

const hosted = process.env.NEXT_PUBLIC_RUNTIME_MODE === "hosted";
const staticExport = hosted || process.env.NEXT_PUBLIC_STATIC_EXPORT === "1";

const nextConfig: NextConfig = {
  distDir: process.env.HOMEWORKER_NEXT_DIST_DIR ?? ".next",
  output: staticExport ? "export" : "standalone",
  trailingSlash: staticExport,
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ["@homeworker/contracts"],
  experimental: {
    optimizePackageImports: ["@homeworker/contracts"],
  },
};

export default nextConfig;
