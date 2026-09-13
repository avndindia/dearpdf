import type { Metadata } from "next";
import StitchAllTools from "@/components/StitchAllTools";

export const metadata: Metadata = {
  title: "All PDF Tools",
  description:
    "Browse all 18 private, in-browser PDF utilities. Assemble, edit, convert, and secure documents with zero server I/O.",
};

export default function PdfToolsPage() {
  return <StitchAllTools />;
}
