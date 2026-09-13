import { PDFDocument, PDFFont, rgb, StandardFonts } from "pdf-lib";

type EditBase = {
  id: string;
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PdfEditorText = EditBase & {
  kind: "text";
  text: string;
  fontSize: number;
  bold: boolean;
};

export type PdfEditorShape = EditBase & {
  kind: "highlight" | "rectangle" | "redact";
  thickness: number;
};

export type PdfEditorDrawing = EditBase & {
  kind: "draw";
  points: Array<{ x: number; y: number }>;
  thickness: number;
};

export type PdfEditorImage = EditBase & {
  kind: "image";
  bytes: Uint8Array;
  mimeType: "image/jpeg" | "image/png";
  preview: string;
};

export type PdfEditorAnnotation =
  | PdfEditorText
  | PdfEditorShape
  | PdfEditorDrawing
  | PdfEditorImage;

function safeText(text: string, font: PDFFont) {
  return Array.from(text, (character) => {
    try {
      font.encodeText(character);
      return character;
    } catch {
      return "?";
    }
  }).join("");
}

export async function applyPdfEdits(
  bytes: ArrayBuffer | Uint8Array,
  annotations: PdfEditorAnnotation[],
): Promise<Uint8Array> {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const embeddedImages = new Map<string, Awaited<ReturnType<PDFDocument["embedPng"]>>>();

  for (const annotation of annotations) {
    const page = document.getPage(annotation.pageIndex);
    if (!page) continue;
    const pageWidth = page.getWidth();
    const pageHeight = page.getHeight();
    const x = annotation.x * pageWidth;
    const width = Math.max(1, annotation.width * pageWidth);
    const height = Math.max(1, annotation.height * pageHeight);
    const y = pageHeight - annotation.y * pageHeight - height;

    if (annotation.kind === "text") {
      const font = annotation.bold ? bold : regular;
      const lineHeight = annotation.fontSize * 1.2;
      safeText(annotation.text, font).split(/\r?\n/).forEach((line, lineIndex) => {
        page.drawText(line, {
          x,
          y: pageHeight - annotation.y * pageHeight - annotation.fontSize - lineIndex * lineHeight,
          size: annotation.fontSize,
          font,
          color: rgb(0.07, 0.07, 0.07),
          maxWidth: width,
        });
      });
      continue;
    }

    if (annotation.kind === "highlight") {
      page.drawRectangle({ x, y, width, height, color: rgb(0.3, 0.3, 0.3), opacity: 0.24 });
      continue;
    }

    if (annotation.kind === "rectangle") {
      page.drawRectangle({
        x,
        y,
        width,
        height,
        borderColor: rgb(0.07, 0.07, 0.07),
        borderWidth: annotation.thickness,
      });
      continue;
    }

    if (annotation.kind === "redact") {
      page.drawRectangle({ x, y, width, height, color: rgb(0, 0, 0) });
      continue;
    }

    if (annotation.kind === "draw") {
      for (let index = 1; index < annotation.points.length; index += 1) {
        const previous = annotation.points[index - 1];
        const current = annotation.points[index];
        page.drawLine({
          start: { x: previous.x * pageWidth, y: pageHeight - previous.y * pageHeight },
          end: { x: current.x * pageWidth, y: pageHeight - current.y * pageHeight },
          thickness: annotation.thickness,
          color: rgb(0.07, 0.07, 0.07),
        });
      }
      continue;
    }

    if (annotation.kind !== "image") continue;

    let embedded = embeddedImages.get(annotation.id);
    if (!embedded) {
      embedded = annotation.mimeType === "image/png"
        ? await document.embedPng(annotation.bytes)
        : await document.embedJpg(annotation.bytes);
      embeddedImages.set(annotation.id, embedded);
    }
    page.drawImage(embedded, { x, y, width, height });
  }

  return document.save({
    addDefaultPage: false,
    updateFieldAppearances: false,
    useObjectStreams: true,
  });
}

export function pageIndexesNeedingRedaction(annotations: PdfEditorAnnotation[]) {
  return [...new Set(
    annotations
      .filter((annotation) => annotation.kind === "redact" && annotation.width > 0.002 && annotation.height > 0.002)
      .map((annotation) => annotation.pageIndex),
  )];
}

export type RedactedPageImage = {
  pageIndex: number;
  bytes: Uint8Array;
  width: number;
  height: number;
  mimeType: "image/jpeg" | "image/png";
};

export async function replacePdfPagesWithImages(
  bytes: ArrayBuffer | Uint8Array,
  replacements: RedactedPageImage[],
): Promise<Uint8Array> {
  if (!replacements.length) {
    return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  }

  const source = await PDFDocument.load(bytes, { updateMetadata: false });
  const output = await PDFDocument.create();
  const byIndex = new Map(replacements.map((replacement) => [replacement.pageIndex, replacement]));

  for (let pageIndex = 0; pageIndex < source.getPageCount(); pageIndex += 1) {
    const replacement = byIndex.get(pageIndex);
    if (!replacement) {
      const [copied] = await output.copyPages(source, [pageIndex]);
      output.addPage(copied);
      continue;
    }
    const image = replacement.mimeType === "image/png"
      ? await output.embedPng(replacement.bytes)
      : await output.embedJpg(replacement.bytes);
    const page = output.addPage([replacement.width, replacement.height]);
    page.drawImage(image, {
      x: 0,
      y: 0,
      width: replacement.width,
      height: replacement.height,
    });
  }

  return output.save({
    addDefaultPage: false,
    updateFieldAppearances: false,
    useObjectStreams: true,
  });
}
