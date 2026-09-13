import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Private PDF Tools",
  description: "Merge and organise PDF files privately in your browser. Files are processed locally and never uploaded.",
  manifest: "/pdf-tools.webmanifest",
  appleWebApp: {
    capable: true,
    title: "PDF Tools",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icons/pdf-tools-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/pdf-tools-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/pdf-tools-192.png" }],
  },
};

export default function PdfToolsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
