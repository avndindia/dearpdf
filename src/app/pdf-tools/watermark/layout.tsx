import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Watermark PDF Locally",
  description: "Add a text or image watermark to selected PDF pages locally in your browser.",
};

export default function WatermarkPdfLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
