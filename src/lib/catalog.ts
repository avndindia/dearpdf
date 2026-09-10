export type ToolCategoryId =
  | "organise"
  | "shrink"
  | "edit"
  | "convert"
  | "secure";

export type ToolLimit = "full" | "partial";

export type PdfTool = {
  slug: string;
  title: string;
  job: string;
  description: string;
  category: ToolCategoryId;
  accept: string;
  multiple?: boolean;
  limit: ToolLimit;
  limitNote?: string;
  keywords: string[];
};

export const categories: { id: ToolCategoryId; title: string; blurb: string }[] = [
  {
    id: "organise",
    title: "Organise",
    blurb: "Merge, split, reorder, number, and crop pages.",
  },
  {
    id: "shrink",
    title: "Shrink & send",
    blurb: "Compress, split by size, or convert to grayscale.",
  },
  {
    id: "edit",
    title: "Edit & mark",
    blurb: "Annotate, watermark, metadata, flatten, and sign.",
  },
  {
    id: "convert",
    title: "Convert",
    blurb: "Images ↔ PDF, Word export, and OCR.",
  },
  {
    id: "secure",
    title: "Secure & fix",
    blurb: "Passwords and local structure repair.",
  },
];

export const tools: PdfTool[] = [
  {
    slug: "merge",
    title: "Merge PDF",
    job: "Combine PDFs in the order you choose.",
    description: "Drop two or more PDFs and merge them into one file.",
    category: "organise",
    accept: "application/pdf",
    multiple: true,
    limit: "full",
    keywords: ["combine", "join", "append"],
  },
  {
    slug: "split",
    title: "Split PDF",
    job: "Extract pages or split into equal parts.",
    description: "Save selected pages or split every N pages into separate PDFs.",
    category: "organise",
    accept: "application/pdf",
    limit: "full",
    keywords: ["extract", "separate", "pages"],
  },
  {
    slug: "organise",
    title: "Organise pages",
    job: "Reorder, rotate, or remove pages.",
    description: "Rearrange page order, rotate pages, and drop the ones you do not need.",
    category: "organise",
    accept: "application/pdf",
    limit: "full",
    keywords: ["reorder", "rotate", "delete"],
  },
  {
    slug: "page-numbers",
    title: "Page numbers",
    job: "Add page numbers with placement and style.",
    description: "Number selected pages with position, format, colour, and start value.",
    category: "organise",
    accept: "application/pdf",
    limit: "full",
    keywords: ["numbering", "folio"],
  },
  {
    slug: "crop",
    title: "Crop PDF",
    job: "Trim margins without rasterising.",
    description: "Crop selected pages by millimetre margins. Vector content stays sharp.",
    category: "organise",
    accept: "application/pdf",
    limit: "full",
    keywords: ["trim", "margins"],
  },
  {
    slug: "compress",
    title: "Compress PDF",
    job: "Shrink file size with clear quality controls.",
    description: "Safe structural optimisation or stronger scanned-page compression.",
    category: "shrink",
    accept: "application/pdf",
    limit: "full",
    keywords: ["reduce", "size", "optimise"],
  },
  {
    slug: "compress-split",
    title: "Compress & split",
    job: "Compress into numbered parts under an MB limit.",
    description: "Useful when email or portals reject large attachments.",
    category: "shrink",
    accept: "application/pdf",
    limit: "full",
    keywords: ["parts", "email", "limit"],
  },
  {
    slug: "grayscale",
    title: "Grayscale PDF",
    job: "Convert colour pages to print-friendly grayscale.",
    description: "Rasterise pages to grayscale JPEG for smaller mono prints.",
    category: "shrink",
    accept: "application/pdf",
    limit: "full",
    keywords: ["mono", "black", "white"],
  },
  {
    slug: "edit",
    title: "Edit PDF",
    job: "Add text, highlight, shapes, whiteout, and images.",
    description: "Lightweight visual annotations applied locally on each page.",
    category: "edit",
    accept: "application/pdf",
    limit: "partial",
    limitNote: "Best for stamps, highlights, and short notes — not a full desktop editor.",
    keywords: ["annotate", "draw", "text"],
  },
  {
    slug: "watermark",
    title: "Watermark",
    job: "Stamp text or an image across selected pages.",
    description: "Choose position, opacity, rotation, and pages — all in the browser.",
    category: "edit",
    accept: "application/pdf",
    limit: "full",
    keywords: ["stamp", "confidential", "draft"],
  },
  {
    slug: "metadata",
    title: "Edit metadata",
    job: "Update title, author, subject, and keywords.",
    description: "Replace embedded document info without changing page content.",
    category: "edit",
    accept: "application/pdf",
    limit: "full",
    keywords: ["title", "author", "properties"],
  },
  {
    slug: "flatten",
    title: "Flatten forms",
    job: "Turn filled form fields into fixed page content.",
    description: "Lock AcroForm values so they cannot be edited later.",
    category: "edit",
    accept: "application/pdf",
    limit: "full",
    keywords: ["forms", "acroform"],
  },
  {
    slug: "sign",
    title: "Sign PDF",
    job: "Draw a signature and place it on the page.",
    description: "Ink stays on this device. Place on the last page or a custom range.",
    category: "edit",
    accept: "application/pdf",
    limit: "full",
    keywords: ["signature", "ink"],
  },
  {
    slug: "images-to-pdf",
    title: "Images to PDF",
    job: "Turn JPG and PNG images into one PDF.",
    description: "Choose page size, orientation, and margin.",
    category: "convert",
    accept: "image/jpeg,image/png,image/jpg",
    multiple: true,
    limit: "full",
    keywords: ["jpg", "png", "photo"],
  },
  {
    slug: "pdf-to-images",
    title: "PDF to images",
    job: "Export pages as PNG, JPG, or WebP.",
    description: "Download a ZIP of page images at the scale you choose.",
    category: "convert",
    accept: "application/pdf",
    limit: "full",
    keywords: ["png", "jpg", "export"],
  },
  {
    slug: "pdf-to-word",
    title: "PDF to Word",
    job: "Export text into an editable .docx.",
    description: "Extracts embedded text; scanned pages use best-effort OCR.",
    category: "convert",
    accept: "application/pdf",
    limit: "partial",
    limitNote: "Layout is simplified. Complex multi-column pages may need cleanup in Word.",
    keywords: ["docx", "word", "editable"],
  },
  {
    slug: "ocr",
    title: "OCR",
    job: "Extract text from scanned pages (EN / HI / MR).",
    description: "Best-effort client-side OCR with Tesseract.js. Download as .txt.",
    category: "convert",
    accept: "application/pdf",
    limit: "partial",
    limitNote: "Runs fully in-browser; large scans are slower. Accuracy varies with image quality.",
    keywords: ["tesseract", "hindi", "marathi", "text"],
  },
  {
    slug: "add-password",
    title: "Add password",
    job: "Encrypt with an open password (AES-256 via qpdf WASM).",
    description: "Protect the whole PDF so a password is required to open it.",
    category: "secure",
    accept: "application/pdf",
    limit: "full",
    keywords: ["encrypt", "lock", "protect"],
  },
  {
    slug: "remove-password",
    title: "Remove password",
    job: "Rebuild an authorised copy without the open password.",
    description: "Enter the current password; a flattened raster copy is saved unlocked.",
    category: "secure",
    accept: "application/pdf",
    limit: "partial",
    limitNote: "Creates an unlocked rasterised copy after you enter the correct password. Vector text becomes images.",
    keywords: ["unlock", "decrypt"],
  },
  {
    slug: "repair",
    title: "Repair PDF",
    job: "Rewrite with a cleaner internal structure.",
    description: "Helps some malformed files. Cannot recover missing or encrypted content.",
    category: "secure",
    accept: "application/pdf",
    limit: "partial",
    limitNote: "Structural rewrite only — not a guarantee for severely corrupted files.",
    keywords: ["fix", "rebuild"],
  },
];

export function getTool(slug: string) {
  return tools.find((tool) => tool.slug === slug);
}

export function toolsByCategory(id: ToolCategoryId) {
  return tools.filter((tool) => tool.category === id);
}
