import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Merge PDF Locally",
  description: "Combine PDF files and images privately in your browser. Your documents are never uploaded.",
};

export default function MergePdfLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
