import type { Metadata, Viewport } from "next";

import { AuthProvider } from "@/components/auth-provider";
import { getBasePath } from "@/lib/config";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Homeworker — Notes that feel written",
    template: "%s · Homeworker",
  },
  description:
    "Turn PDFs and document images into reviewable, printable notes using licensed handwriting personas.",
  applicationName: "Homeworker",
  robots: { index: false, follow: false },
  // Provenance marker: every exported page carries the commit it was built from,
  // so a deploy can be verified against the source that produced it.
  other: { "homeworker-build": process.env.NEXT_PUBLIC_BUILD_ID ?? "dev" },
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#f4f2ec",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const basePath = getBasePath();
  const fontFaces = `
  @font-face {
    font-family: "Ink Scholar";
    font-display: swap;
    src: url("${basePath}/fonts/Kalam-Regular.woff2") format("woff2");
  }
  @font-face {
    font-family: "Ink Casual";
    font-display: swap;
    src: url("${basePath}/fonts/Caveat-Regular.woff2") format("woff2");
  }
  @font-face {
    font-family: "Ink Compact";
    font-display: swap;
    src: url("${basePath}/fonts/PatrickHand-Regular.woff2") format("woff2");
  }`;

  return (
    <html data-scroll-behavior="smooth" lang="en">
      <head>
        {/* Font URLs must carry the host path prefix, which static CSS cannot know. */}
        <style dangerouslySetInnerHTML={{ __html: fontFaces }} />
      </head>
      <body><AuthProvider>{children}</AuthProvider></body>
    </html>
  );
}
