import { degrees, PDFDocument, rgb, StandardFonts, type PDFFont } from "pdf-lib";
import { zipSync } from "fflate";

export type PdfMergeInput = {
  bytes: ArrayBuffer | Uint8Array;
  name: string;
};

export type PdfPageMergeSource = PdfMergeInput & {
  id: string;
};

export type PdfPageMergeReference = {
  sourceId: string;
  pageIndex: number;
};

export type PdfInspection = {
  pageCount: number;
};

export type PdfPageOperation = {
  pageIndex: number;
  rotation: number;
};

export type PdfImageInput = {
  bytes: ArrayBuffer | Uint8Array;
  mimeType: "image/jpeg" | "image/png";
  width: number;
  height: number;
  rotation: number;
};

export type ImagesToPdfOptions = {
  pageSize: "a4" | "letter" | "fit";
  orientation: "auto" | "portrait" | "landscape";
  margin: number;
};

export type WatermarkPosition =
  | "center"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right"
  | "tile";

export type PdfWatermark =
  | {
      kind: "text";
      text: string;
      color: string;
      size: number;
    }
  | {
      kind: "image";
      bytes: ArrayBuffer | Uint8Array;
      mimeType: "image/jpeg" | "image/png";
      width: number;
      height: number;
      size: number;
    };

export type PdfWatermarkOptions = {
  pageIndices: number[];
  position: WatermarkPosition;
  opacity: number;
  rotation: number;
};

export type RasterizedPdfPage = {
  bytes: ArrayBuffer | Uint8Array;
  width: number;
  height: number;
};

export type SizedPdfPart = {
  bytes: Uint8Array;
  pageCount: number;
};

export type BinaryDownloadFile = {
  name: string;
  bytes: Uint8Array;
};

export type SmallerPdfResult = {
  bytes: Uint8Array;
  usedOriginal: boolean;
};

export type PageNumberPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

export type PageNumberFormat =
  | "number"
  | "roman"
  | "letter"
  | "page-number"
  | "fraction"
  | "number-of-total"
  | "page-number-of-total";

export type PageNumberOptions = {
  pageIndices: number[];
  position: PageNumberPosition;
  format: PageNumberFormat;
  startAt: number;
  fontSize: number;
  margin: number;
  color: string;
  prefix?: string;
  suffix?: string;
  bold?: boolean;
};

export type CropPdfOptions = {
  pageIndices: number[];
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type PdfMetadataInput = {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string[];
  creator?: string;
};

export type PdfImageStampOptions = {
  pageIndices: number[];
  position: Exclude<WatermarkPosition, "tile">;
  widthPercent: number;
  opacity?: number;
};

export async function inspectPdf(bytes: ArrayBuffer | Uint8Array): Promise<PdfInspection> {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  return { pageCount: document.getPageCount() };
}

export async function mergePdfDocuments(inputs: PdfMergeInput[]): Promise<Uint8Array> {
  if (inputs.length < 2) {
    throw new Error("Choose at least two PDF files to merge.");
  }

  const output = await PDFDocument.create();

  for (const input of inputs) {
    const source = await PDFDocument.load(input.bytes, { updateMetadata: false });
    const pages = await output.copyPages(source, source.getPageIndices());
    pages.forEach((page) => output.addPage(page));
  }

  return output.save({
    addDefaultPage: false,
    updateFieldAppearances: false,
    useObjectStreams: true,
  });
}

export async function mergePdfPageOrder(
  sources: PdfPageMergeSource[],
  pageOrder: PdfPageMergeReference[],
): Promise<Uint8Array> {
  if (sources.length < 2) throw new Error("Choose at least two PDF files to merge.");
  if (!pageOrder.length) throw new Error("Keep at least one page in the merged PDF.");

  const documents = new Map<string, PDFDocument>();
  for (const source of sources) {
    if (documents.has(source.id)) throw new Error("Every source PDF needs a unique identifier.");
    documents.set(source.id, await PDFDocument.load(source.bytes, { updateMetadata: false }));
  }

  const output = await PDFDocument.create();
  for (const reference of pageOrder) {
    const source = documents.get(reference.sourceId);
    if (!source || reference.pageIndex < 0 || reference.pageIndex >= source.getPageCount()) {
      throw new Error("The visual page order contains an invalid page.");
    }
    const [page] = await output.copyPages(source, [reference.pageIndex]);
    output.addPage(page);
  }

  return output.save({ addDefaultPage: false, useObjectStreams: true });
}

export function parsePageSelection(value: string, pageCount: number): number[] {
  const selection = value.trim();
  if (!selection) throw new Error("Enter at least one page or page range.");
  if (pageCount < 1) throw new Error("This PDF has no pages.");

  const pages: number[] = [];
  const seen = new Set<number>();

  for (const part of selection.split(",")) {
    const token = part.trim();
    const range = token.match(/^(\d+)\s*-\s*(\d+)$/);
    const single = token.match(/^\d+$/);

    if (!range && !single) {
      throw new Error(`“${token || part}” is not a valid page or range.`);
    }

    const start = Number(range?.[1] ?? token);
    const end = Number(range?.[2] ?? token);
    if (start < 1 || end < 1 || start > pageCount || end > pageCount) {
      throw new Error(`Choose pages between 1 and ${pageCount}.`);
    }
    if (start > end) {
      throw new Error(`Range ${start}-${end} must run from a lower page to a higher page.`);
    }

    for (let page = start; page <= end; page += 1) {
      if (!seen.has(page)) {
        pages.push(page - 1);
        seen.add(page);
      }
    }
  }

  return pages;
}

export async function extractPdfPages(
  bytes: ArrayBuffer | Uint8Array,
  pageIndices: number[],
): Promise<Uint8Array> {
  if (!pageIndices.length) throw new Error("Choose at least one page.");
  const source = await PDFDocument.load(bytes, { updateMetadata: false });
  if (pageIndices.some((index) => index < 0 || index >= source.getPageCount())) {
    throw new Error("One or more selected pages are outside this PDF.");
  }

  const output = await PDFDocument.create();
  const pages = await output.copyPages(source, pageIndices);
  pages.forEach((page) => output.addPage(page));
  return output.save({ addDefaultPage: false, useObjectStreams: true });
}

export async function splitPdfIntoZip(
  bytes: ArrayBuffer | Uint8Array,
  baseName = "document",
): Promise<Uint8Array> {
  const source = await PDFDocument.load(bytes, { updateMetadata: false });
  const pageCount = source.getPageCount();
  const width = Math.max(2, String(pageCount).length);
  const files: Record<string, Uint8Array> = {};

  for (let index = 0; index < pageCount; index += 1) {
    const output = await PDFDocument.create();
    const [page] = await output.copyPages(source, [index]);
    output.addPage(page);
    files[`${baseName}-page-${String(index + 1).padStart(width, "0")}.pdf`] =
      await output.save({ addDefaultPage: false, useObjectStreams: true });
  }

  return zipSync(files, { level: 6 });
}

export async function splitPdfIntoEqualPartsZip(
  bytes: ArrayBuffer | Uint8Array,
  partCount: number,
  baseName = "document",
): Promise<Uint8Array> {
  const source = await PDFDocument.load(bytes, { updateMetadata: false });
  const pageCount = source.getPageCount();
  if (!Number.isInteger(partCount) || partCount < 2) {
    throw new Error("Choose at least 2 parts.");
  }
  if (partCount > pageCount) {
    throw new Error(`Choose no more than ${pageCount} parts for this PDF.`);
  }

  const files: Record<string, Uint8Array> = {};
  const pagesPerPart = Math.floor(pageCount / partCount);
  const extraPages = pageCount % partCount;
  const partNumberWidth = Math.max(2, String(partCount).length);
  let firstPageIndex = 0;

  for (let partIndex = 0; partIndex < partCount; partIndex += 1) {
    const pagesInPart = pagesPerPart + (partIndex < extraPages ? 1 : 0);
    const pageIndices = Array.from(
      { length: pagesInPart },
      (_, offset) => firstPageIndex + offset,
    );
    const output = await PDFDocument.create();
    const copiedPages = await output.copyPages(source, pageIndices);
    copiedPages.forEach((page) => output.addPage(page));
    files[`${baseName}-part-${String(partIndex + 1).padStart(partNumberWidth, "0")}.pdf`] =
      await output.save({ addDefaultPage: false, useObjectStreams: true });
    firstPageIndex += pagesInPart;
  }

  return zipSync(files, { level: 6 });
}

export async function organisePdfPages(
  bytes: ArrayBuffer | Uint8Array,
  operations: PdfPageOperation[],
): Promise<Uint8Array> {
  if (!operations.length) throw new Error("Keep at least one page in the PDF.");
  const source = await PDFDocument.load(bytes, { updateMetadata: false });
  const pageCount = source.getPageCount();

  if (operations.some(({ pageIndex }) => pageIndex < 0 || pageIndex >= pageCount)) {
    throw new Error("One or more selected pages are outside this PDF.");
  }

  const output = await PDFDocument.create();
  const pages = await output.copyPages(source, operations.map(({ pageIndex }) => pageIndex));
  pages.forEach((page, index) => {
    const currentRotation = page.getRotation().angle;
    const addedRotation = operations[index].rotation;
    page.setRotation(degrees(((currentRotation + addedRotation) % 360 + 360) % 360));
    output.addPage(page);
  });

  return output.save({ addDefaultPage: false, useObjectStreams: true });
}

const STANDARD_PAGE_SIZES = {
  a4: { width: 595.28, height: 841.89 },
  letter: { width: 612, height: 792 },
} as const;

function orientedPageSize(
  size: { width: number; height: number },
  orientation: ImagesToPdfOptions["orientation"],
  imageLandscape: boolean,
) {
  const landscape = orientation === "landscape" || (orientation === "auto" && imageLandscape);
  return landscape
    ? { width: Math.max(size.width, size.height), height: Math.min(size.width, size.height) }
    : { width: Math.min(size.width, size.height), height: Math.max(size.width, size.height) };
}

export async function imagesToPdf(
  images: PdfImageInput[],
  options: ImagesToPdfOptions,
): Promise<Uint8Array> {
  if (!images.length) throw new Error("Choose at least one image.");
  if (options.margin < 0) throw new Error("The page margin cannot be negative.");
  const output = await PDFDocument.create();

  for (const imageInput of images) {
    const rotation = ((imageInput.rotation % 360) + 360) % 360;
    if (![0, 90, 180, 270].includes(rotation)) {
      throw new Error("Image rotation must use 90-degree steps.");
    }

    const image = imageInput.mimeType === "image/jpeg"
      ? await output.embedJpg(imageInput.bytes)
      : await output.embedPng(imageInput.bytes);
    const sideways = rotation === 90 || rotation === 270;
    const rotatedWidth = sideways ? imageInput.height : imageInput.width;
    const rotatedHeight = sideways ? imageInput.width : imageInput.height;
    let pageWidth: number;
    let pageHeight: number;

    if (options.pageSize === "fit") {
      const naturalWidth = rotatedWidth * 0.75;
      const naturalHeight = rotatedHeight * 0.75;
      const naturalScale = Math.min(1, 841.89 / naturalWidth, 841.89 / naturalHeight);
      pageWidth = naturalWidth * naturalScale + options.margin * 2;
      pageHeight = naturalHeight * naturalScale + options.margin * 2;
    } else {
      const standard = orientedPageSize(
        STANDARD_PAGE_SIZES[options.pageSize],
        options.orientation,
        rotatedWidth > rotatedHeight,
      );
      pageWidth = standard.width;
      pageHeight = standard.height;
    }

    const availableWidth = Math.max(1, pageWidth - options.margin * 2);
    const availableHeight = Math.max(1, pageHeight - options.margin * 2);
    const scale = Math.min(
      availableWidth / rotatedWidth,
      availableHeight / rotatedHeight,
    );
    const drawnWidth = imageInput.width * scale;
    const drawnHeight = imageInput.height * scale;
    const boxWidth = sideways ? drawnHeight : drawnWidth;
    const boxHeight = sideways ? drawnWidth : drawnHeight;
    const left = (pageWidth - boxWidth) / 2;
    const bottom = (pageHeight - boxHeight) / 2;
    const page = output.addPage([pageWidth, pageHeight]);

    const placement = rotation === 90
      ? { x: left + boxWidth, y: bottom }
      : rotation === 180
        ? { x: left + boxWidth, y: bottom + boxHeight }
        : rotation === 270
          ? { x: left, y: bottom + boxHeight }
          : { x: left, y: bottom };

    page.drawImage(image, {
      ...placement,
      width: drawnWidth,
      height: drawnHeight,
      rotate: degrees(rotation),
    });
  }

  return output.save({ addDefaultPage: false, useObjectStreams: true });
}

function parseHexColor(value: string) {
  const match = value.match(/^#([0-9a-f]{6})$/i);
  if (!match) throw new Error("Choose a valid six-digit watermark colour.");
  const number = Number.parseInt(match[1], 16);
  return rgb(
    ((number >> 16) & 255) / 255,
    ((number >> 8) & 255) / 255,
    (number & 255) / 255,
  );
}

/** Scale PDF point sizes onto the on-screen preview page width. */
export function watermarkPreviewScale(previewWidthPx: number, pageWidthPt: number) {
  if (previewWidthPx <= 0 || pageWidthPt <= 0) return 1;
  return previewWidthPx / pageWidthPt;
}

/** Convert a watermark text size in PDF points to CSS pixels for the live preview. */
export function watermarkPreviewFontSizePx(
  textSizePt: number,
  previewWidthPx: number,
  pageWidthPt: number,
) {
  return Math.max(1, textSizePt * watermarkPreviewScale(previewWidthPx, pageWidthPt));
}

/** Match the PDF watermark inset (28pt) as a percentage of a page edge. */
export function watermarkPreviewInsetPercent(pageDimensionPt: number, insetPt = 28) {
  if (pageDimensionPt <= 0) return 0;
  return (insetPt / pageDimensionPt) * 100;
}

/**
 * Map the UI/CSS rotation (clockwise-positive on screen) to PDF degrees
 * (counter-clockwise-positive) so the stamped page matches the live preview.
 */
export function watermarkPdfRotationDegrees(previewRotationDegrees: number) {
  return previewRotationDegrees === 0 ? 0 : -previewRotationDegrees;
}

function watermarkOrigin(
  pageWidth: number,
  pageHeight: number,
  width: number,
  height: number,
  rotation: number,
  position: Exclude<WatermarkPosition, "tile">,
) {
  const radians = Math.abs(rotation) * Math.PI / 180;
  const boxWidth = Math.abs(width * Math.cos(radians)) + Math.abs(height * Math.sin(radians));
  const boxHeight = Math.abs(width * Math.sin(radians)) + Math.abs(height * Math.cos(radians));
  const inset = 28;
  const left = position.endsWith("left")
    ? inset
    : position.endsWith("right")
      ? pageWidth - boxWidth - inset
      : (pageWidth - boxWidth) / 2;
  const bottom = position.startsWith("top")
    ? pageHeight - boxHeight - inset
    : position.startsWith("bottom")
      ? inset
      : (pageHeight - boxHeight) / 2;
  const positive = ((rotation % 360) + 360) % 360;

  if (positive > 0 && positive <= 90) return { x: left + height * Math.sin(radians), y: bottom };
  if (positive > 90 && positive <= 180) return { x: left + boxWidth, y: bottom + height * Math.abs(Math.cos(radians)) };
  if (positive > 180 && positive <= 270) return { x: left + width * Math.abs(Math.cos(radians)), y: bottom + boxHeight };
  if (positive > 270) return { x: left, y: bottom + width * Math.sin(radians) };
  return { x: left, y: bottom };
}

export async function watermarkPdf(
  bytes: ArrayBuffer | Uint8Array,
  watermark: PdfWatermark,
  options: PdfWatermarkOptions,
): Promise<Uint8Array> {
  if (!options.pageIndices.length) throw new Error("Choose at least one page to watermark.");
  if (options.opacity < 0.05 || options.opacity > 1) throw new Error("Watermark opacity must be between 5% and 100%.");
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  const pageCount = document.getPageCount();
  if (options.pageIndices.some((index) => index < 0 || index >= pageCount)) {
    throw new Error("One or more selected pages are outside this PDF.");
  }
  const selected = new Set(options.pageIndices);
  const pdfRotationDegrees = watermarkPdfRotationDegrees(options.rotation);
  const rotation = degrees(pdfRotationDegrees);
  const font = watermark.kind === "text"
    ? await document.embedFont(StandardFonts.HelveticaBold)
    : null;
  const image = watermark.kind === "image"
    ? watermark.mimeType === "image/jpeg"
      ? await document.embedJpg(watermark.bytes)
      : await document.embedPng(watermark.bytes)
    : null;

  if (watermark.kind === "text" && !watermark.text.trim()) {
    throw new Error("Enter watermark text.");
  }

  document.getPages().forEach((page, pageIndex) => {
    if (!selected.has(pageIndex)) return;
    const { width: pageWidth, height: pageHeight } = page.getSize();
    const contentWidth = watermark.kind === "text"
      ? font!.widthOfTextAtSize(watermark.text, watermark.size)
      : pageWidth * watermark.size / 100;
    const contentHeight = watermark.kind === "text"
      ? watermark.size
      : contentWidth * watermark.height / watermark.width;

    const draw = (x: number, y: number) => {
      if (watermark.kind === "text") {
        page.drawText(watermark.text, {
          x,
          y,
          size: watermark.size,
          font: font!,
          color: parseHexColor(watermark.color),
          opacity: options.opacity,
          rotate: rotation,
        });
      } else {
        page.drawImage(image!, {
          x,
          y,
          width: contentWidth,
          height: contentHeight,
          opacity: options.opacity,
          rotate: rotation,
        });
      }
    };

    if (options.position === "tile") {
      const horizontalStep = Math.max(145, contentWidth * 1.55);
      const verticalStep = Math.max(110, contentHeight * 2.1);
      for (let y = 24; y < pageHeight; y += verticalStep) {
        for (let x = 18; x < pageWidth; x += horizontalStep) draw(x, y);
      }
    } else {
      const origin = watermarkOrigin(
        pageWidth,
        pageHeight,
        contentWidth,
        contentHeight,
        pdfRotationDegrees,
        options.position,
      );
      draw(origin.x, origin.y);
    }
  });

  return document.save({ useObjectStreams: true });
}

export async function optimisePdfStructure(
  bytes: ArrayBuffer | Uint8Array,
): Promise<Uint8Array> {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  return document.save({
    addDefaultPage: false,
    updateFieldAppearances: false,
    useObjectStreams: true,
  });
}

export function keepSmallerPdf(
  original: ArrayBuffer | Uint8Array,
  candidate: Uint8Array,
): SmallerPdfResult {
  const originalBytes = original instanceof Uint8Array
    ? original
    : new Uint8Array(original);

  if (candidate.length < originalBytes.length) {
    return { bytes: candidate, usedOriginal: false };
  }

  return {
    bytes: new Uint8Array(originalBytes),
    usedOriginal: true,
  };
}

export async function rasterizedPagesToPdf(
  pages: RasterizedPdfPage[],
): Promise<Uint8Array> {
  if (!pages.length) throw new Error("The PDF has no pages to compress.");
  const output = await PDFDocument.create();

  for (const pageInput of pages) {
    if (pageInput.width <= 0 || pageInput.height <= 0) {
      throw new Error("A compressed page has invalid dimensions.");
    }
    const image = await output.embedJpg(pageInput.bytes);
    const page = output.addPage([pageInput.width, pageInput.height]);
    page.drawImage(image, {
      x: 0,
      y: 0,
      width: pageInput.width,
      height: pageInput.height,
    });
  }

  return output.save({ addDefaultPage: false, useObjectStreams: true });
}

export async function rasterizedPagesToSizedPdfParts(
  pages: RasterizedPdfPage[],
  maximumBytes: number,
): Promise<SizedPdfPart[]> {
  if (!pages.length) throw new Error("The PDF has no pages to split.");
  if (!Number.isFinite(maximumBytes) || maximumBytes < 1024) {
    throw new Error("Choose a valid maximum part size.");
  }

  const parts: SizedPdfPart[] = [];
  let remaining = pages;

  while (remaining.length) {
    const complete = await rasterizedPagesToPdf(remaining);
    if (complete.length <= maximumBytes) {
      parts.push({ bytes: complete, pageCount: remaining.length });
      break;
    }
    if (remaining.length === 1) {
      throw new Error("One compressed page is larger than the maximum part size.");
    }

    let low = 1;
    let high = remaining.length - 1;
    let bestCount = 0;
    let bestBytes: Uint8Array | null = null;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const candidate = await rasterizedPagesToPdf(remaining.slice(0, middle));
      if (candidate.length <= maximumBytes) {
        bestCount = middle;
        bestBytes = candidate;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }

    if (!bestCount || !bestBytes) {
      throw new Error("One compressed page is larger than the maximum part size.");
    }
    parts.push({ bytes: bestBytes, pageCount: bestCount });
    remaining = remaining.slice(bestCount);
  }

  return parts;
}

export function createFilesZip(files: BinaryDownloadFile[]): Uint8Array {
  if (!files.length) throw new Error("There are no files to add to the ZIP.");
  const entries: Record<string, Uint8Array> = {};
  files.forEach((file) => {
    if (!file.name.trim()) throw new Error("Every ZIP entry needs a filename.");
    entries[file.name] = file.bytes;
  });
  return zipSync(entries, { level: 6 });
}

function validatePageIndices(pageIndices: number[], pageCount: number) {
  if (!pageIndices.length) throw new Error("Choose at least one page.");
  if (pageIndices.some((index) => index < 0 || index >= pageCount)) {
    throw new Error("One or more selected pages are outside this PDF.");
  }
}

function toRoman(value: number) {
  const numerals: Array<[number, string]> = [
    [1000, "m"], [900, "cm"], [500, "d"], [400, "cd"],
    [100, "c"], [90, "xc"], [50, "l"], [40, "xl"],
    [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"],
  ];
  let remaining = Math.max(1, Math.floor(value));
  let text = "";
  for (const [amount, numeral] of numerals) {
    while (remaining >= amount) {
      text += numeral;
      remaining -= amount;
    }
  }
  return text;
}

function toLetter(value: number) {
  let remaining = Math.max(1, Math.floor(value));
  let text = "";
  while (remaining > 0) {
    remaining -= 1;
    text = String.fromCharCode(65 + (remaining % 26)) + text;
    remaining = Math.floor(remaining / 26);
  }
  return text;
}

export function formatPageNumberLabel(
  format: PageNumberFormat,
  pageNumber: number,
  lastNumber: number,
  prefix = "",
  suffix = "",
) {
  const core = format === "roman"
    ? toRoman(pageNumber)
    : format === "letter"
      ? toLetter(pageNumber)
      : format === "page-number"
        ? `Page ${pageNumber}`
        : format === "fraction"
          ? `${pageNumber}/${lastNumber}`
          : format === "number-of-total"
            ? `${pageNumber} of ${lastNumber}`
            : format === "page-number-of-total"
              ? `Page ${pageNumber} of ${lastNumber}`
              : String(pageNumber);
  return `${prefix}${core}${suffix}`;
}

function safeStandardFontText(font: PDFFont, text: string) {
  return Array.from(text, (character) => {
    try {
      font.encodeText(character);
      return character;
    } catch {
      return "?";
    }
  }).join("");
}

export async function addPageNumbersPdf(
  bytes: ArrayBuffer | Uint8Array,
  options: PageNumberOptions,
): Promise<Uint8Array> {
  if (options.startAt < 0 || !Number.isInteger(options.startAt)) {
    throw new Error("The starting page number must be a whole number.");
  }
  if (options.fontSize < 6 || options.fontSize > 72) {
    throw new Error("Choose a page-number size between 6 and 72 points.");
  }
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  validatePageIndices(options.pageIndices, document.getPageCount());
  const font = await document.embedFont(
    options.bold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica,
  );
  const color = parseHexColor(options.color);
  const total = options.pageIndices.length;
  const lastNumber = options.startAt + total - 1;

  options.pageIndices.forEach((pageIndex, selectionIndex) => {
    const page = document.getPage(pageIndex);
    const pageNumber = options.startAt + selectionIndex;
    const label = safeStandardFontText(
      font,
      formatPageNumberLabel(
        options.format,
        pageNumber,
        lastNumber,
        options.prefix ?? "",
        options.suffix ?? "",
      ),
    );
    const textWidth = font.widthOfTextAtSize(label, options.fontSize);
    const { width, height } = page.getSize();
    const x = options.position.endsWith("left")
      ? options.margin
      : options.position.endsWith("right")
        ? width - options.margin - textWidth
        : (width - textWidth) / 2;
    const y = options.position.startsWith("top")
      ? height - options.margin - options.fontSize
      : options.margin;
    page.drawText(label, { x, y, size: options.fontSize, font, color });
  });

  return document.save({ useObjectStreams: true });
}

export async function cropPdf(
  bytes: ArrayBuffer | Uint8Array,
  options: CropPdfOptions,
): Promise<Uint8Array> {
  const margins = [options.top, options.right, options.bottom, options.left];
  if (margins.some((margin) => !Number.isFinite(margin) || margin < 0)) {
    throw new Error("Crop margins cannot be negative.");
  }
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  validatePageIndices(options.pageIndices, document.getPageCount());

  options.pageIndices.forEach((pageIndex) => {
    const page = document.getPage(pageIndex);
    const box = page.getCropBox();
    const width = box.width - options.left - options.right;
    const height = box.height - options.top - options.bottom;
    if (width < 36 || height < 36) {
      throw new Error("The crop margins leave too little of one or more pages.");
    }
    page.setCropBox(box.x + options.left, box.y + options.bottom, width, height);
  });

  return document.save({ useObjectStreams: true });
}

export async function updatePdfMetadata(
  bytes: ArrayBuffer | Uint8Array,
  metadata: PdfMetadataInput,
): Promise<Uint8Array> {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  document.setTitle(metadata.title?.trim() ?? "");
  document.setAuthor(metadata.author?.trim() ?? "");
  document.setSubject(metadata.subject?.trim() ?? "");
  document.setKeywords(metadata.keywords?.filter(Boolean) ?? []);
  document.setCreator(metadata.creator?.trim() || "DearPDF");
  document.setProducer("DearPDF");
  document.setModificationDate(new Date());
  return document.save({ useObjectStreams: true });
}

export async function flattenPdfForms(
  bytes: ArrayBuffer | Uint8Array,
): Promise<Uint8Array> {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  const form = document.getForm();
  if (!form.getFields().length) {
    throw new Error("This PDF does not contain any form fields to flatten.");
  }
  form.flatten();
  return document.save({ useObjectStreams: true });
}

export async function stampPdfWithImage(
  bytes: ArrayBuffer | Uint8Array,
  imageBytes: ArrayBuffer | Uint8Array,
  mimeType: "image/png" | "image/jpeg",
  options: PdfImageStampOptions,
): Promise<Uint8Array> {
  if (options.widthPercent < 5 || options.widthPercent > 80) {
    throw new Error("Signature width must be between 5% and 80%.");
  }
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  validatePageIndices(options.pageIndices, document.getPageCount());
  const image = mimeType === "image/jpeg"
    ? await document.embedJpg(imageBytes)
    : await document.embedPng(imageBytes);

  options.pageIndices.forEach((pageIndex) => {
    const page = document.getPage(pageIndex);
    const { width: pageWidth, height: pageHeight } = page.getSize();
    const width = pageWidth * options.widthPercent / 100;
    const height = width * image.height / image.width;
    const origin = watermarkOrigin(
      pageWidth,
      pageHeight,
      width,
      height,
      0,
      options.position,
    );
    page.drawImage(image, {
      x: origin.x,
      y: origin.y,
      width,
      height,
      opacity: options.opacity ?? 1,
    });
  });

  return document.save({ useObjectStreams: true });
}
