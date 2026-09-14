export type PdfToolCategory = "Assemble" | "Edit" | "Convert" | "Secure";

export type PdfToolCatalogItem = {
  title: string;
  description: string;
  href: string;
  category: PdfToolCategory;
  popular?: boolean;
};

export const pdfToolCategories: PdfToolCategory[] = [
  "Assemble",
  "Edit",
  "Convert",
  "Secure",
];

export const pdfTools: PdfToolCatalogItem[] = [
  {
    title: "Merge PDF",
    description: "Combine PDFs and images in the exact order you choose.",
    href: "/pdf-tools/merge",
    category: "Assemble",
    popular: true,
  },
  {
    title: "Split & extract",
    description: "Save selected pages or page ranges as a new PDF.",
    href: "/pdf-tools/split",
    category: "Assemble",
    popular: true,
  },
  {
    title: "Organise pages",
    description: "Reorder, rotate, or remove pages with a visual preview.",
    href: "/pdf-tools/organise",
    category: "Assemble",
  },
  {
    title: "Images to PDF",
    description: "Turn JPG and PNG images into one clean PDF document.",
    href: "/pdf-tools/images-to-pdf",
    category: "Convert",
    popular: true,
  },
  {
    title: "Watermark PDF",
    description: "Add text or an image watermark without uploading the document.",
    href: "/pdf-tools/watermark",
    category: "Edit",
  },
  {
    title: "Edit PDF",
    description: "Add text, drawings, highlights, shapes, redaction, and images visually.",
    href: "/pdf-tools/edit",
    category: "Edit",
  },
  {
    title: "Compress PDF",
    description: "Reduce PDF size, or split it into parts under a limit.",
    href: "/pdf-tools/compress",
    category: "Assemble",
    popular: true,
  },
  {
    title: "PDF to Images",
    description: "Export selected pages as PNG, JPG, or WebP images.",
    href: "/pdf-tools/pdf-to-images",
    category: "Convert",
  },
  {
    title: "PDF to Word",
    description: "Turn PDF text and scanned pages into an editable Word document.",
    href: "/pdf-tools/pdf-to-word",
    category: "Convert",
    popular: true,
  },
  {
    title: "Add Page Numbers",
    description: "Number selected pages with custom placement and formatting.",
    href: "/pdf-tools/page-numbers",
    category: "Assemble",
  },
  {
    title: "Crop PDF",
    description: "Trim unwanted margins from selected pages without rasterising.",
    href: "/pdf-tools/crop",
    category: "Assemble",
  },
  {
    title: "Edit Metadata",
    description: "Update the PDF title, author, subject, and keywords.",
    href: "/pdf-tools/metadata",
    category: "Edit",
  },
  {
    title: "PDF OCR",
    description: "Extract text or save a searchable PDF from scanned English, Hindi, and Marathi pages.",
    href: "/pdf-tools/pdf-to-text",
    category: "Convert",
  },
  {
    title: "Grayscale PDF",
    description: "Convert colour pages to print-friendly grayscale.",
    href: "/pdf-tools/grayscale",
    category: "Convert",
  },
  {
    title: "Flatten PDF",
    description: "Bake forms, annotations, and edits into fixed page images.",
    href: "/pdf-tools/flatten",
    category: "Edit",
  },
  {
    title: "Sign PDF",
    description: "Draw and place a visible signature without uploading.",
    href: "/pdf-tools/sign",
    category: "Edit",
    popular: true,
  },
  {
    title: "Repair PDF",
    description: "Rebuild a PDF with a fresh, cleaner internal structure.",
    href: "/pdf-tools/repair",
    category: "Secure",
  },
  {
    title: "Remove Password from PDF",
    description: "Remove an open password by rebuilding an authorised local copy.",
    href: "/pdf-tools/unlock",
    category: "Secure",
  },
  {
    title: "Add Password to PDF",
    description: "Add an open password with local 256-bit PDF encryption.",
    href: "/pdf-tools/lock",
    category: "Secure",
  },
];

export const popularPdfTools = pdfTools.filter((tool) => tool.popular);
