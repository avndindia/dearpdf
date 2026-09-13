import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Split & Extract PDF Locally",
  description: "Extract selected PDF pages, split after every N pages, or split every page into separate files, entirely in your browser.",
};

export default function SplitPdfLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
