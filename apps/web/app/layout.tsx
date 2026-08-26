import type { Metadata, Viewport } from "next";

import { AuthProvider } from "@/components/auth-provider";

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
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#f4f2ec",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body><AuthProvider>{children}</AuthProvider></body>
    </html>
  );
}
