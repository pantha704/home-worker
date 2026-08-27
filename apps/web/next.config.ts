import type { NextConfig } from "next";

const hosted = process.env.NEXT_PUBLIC_RUNTIME_MODE === "hosted";

const nextConfig: NextConfig = {
  distDir: process.env.HOMEWORKER_NEXT_DIST_DIR ?? ".next",
  output: hosted ? "export" : "standalone",
  trailingSlash: hosted,
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ["@homeworker/contracts"],
  experimental: {
    optimizePackageImports: ["@homeworker/contracts"],
  },
};

export default nextConfig;
