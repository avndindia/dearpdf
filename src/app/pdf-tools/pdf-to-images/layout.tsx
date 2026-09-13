import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "PDF to Images Locally",
  description: "Convert selected PDF pages to PNG, JPG, or WebP images locally in your browser.",
};

export default function PdfToImagesLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
