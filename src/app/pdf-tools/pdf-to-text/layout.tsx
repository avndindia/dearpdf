import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "PDF OCR",
  description: "Extract text or save a searchable PDF from scanned English, Hindi, and Marathi pages, privately in your browser.",
};

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
