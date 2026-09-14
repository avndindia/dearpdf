import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AI Summary of PDF",
  description:
    "Private on-device PDF summary in your browser. Uses the text layer by default; scanned pages are OCR’d automatically with Tesseract on this device.",
};

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
