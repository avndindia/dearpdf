import type { Metadata } from "next";
import PdfToolsHubRedirect from "@/components/PdfToolsHubRedirect";

export const metadata: Metadata = {
  title: "All PDF Tools",
  description:
    "Browse all private, in-browser PDF utilities. Assemble, edit, convert, and secure documents with zero server I/O.",
};

/** Catalog index redirects to home #tools — individual tools stay under /pdf-tools/*. */
export default function PdfToolsPage() {
  return <PdfToolsHubRedirect />;
}
