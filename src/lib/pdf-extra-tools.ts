import { PDFDocument, StandardFonts, rgb, degrees, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { zipSync } from "fflate";

export type PageNumberPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

function parseHexColor(value: string) {
  const hex = value.replace("#", "").trim();
  const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return rgb(0.2, 0.2, 0.2);
  const n = Number.parseInt(full, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
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

export type NUpPagesPerSheet = 2 | 4 | 6 | 9 | 16;
export type NUpPaperSize = "a4" | "letter" | "legal";
export type NUpOrientation = "portrait" | "landscape";
export type NUpFillOrder = "across" | "down";

export type NUpOptions = {
  pagesPerSheet: NUpPagesPerSheet;
  paperSize: NUpPaperSize;
  orientation: NUpOrientation;
  margin: number;
  gap: number;
  cellBorder: boolean;
  fillOrder?: NUpFillOrder;
};

const PAPER_SIZES: Record<NUpPaperSize, { width: number; height: number }> = {
  a4: { width: 595.28, height: 841.89 },
  letter: { width: 612, height: 792 },
  legal: { width: 612, height: 1008 },
};

export function nUpGrid(pagesPerSheet: NUpPagesPerSheet): { cols: number; rows: number } {
  switch (pagesPerSheet) {
    case 2:
      return { cols: 2, rows: 1 };
    case 4:
      return { cols: 2, rows: 2 };
    case 6:
      return { cols: 3, rows: 2 };
    case 9:
      return { cols: 3, rows: 3 };
    case 16:
      return { cols: 4, rows: 4 };
  }
}

export function sheetSizeForNUp(paperSize: NUpPaperSize, orientation: NUpOrientation) {
  const base = PAPER_SIZES[paperSize];
  return orientation === "landscape"
    ? { width: Math.max(base.width, base.height), height: Math.min(base.width, base.height) }
    : { width: Math.min(base.width, base.height), height: Math.max(base.width, base.height) };
}

export async function nUpPdf(
  bytes: ArrayBuffer | Uint8Array,
  options: NUpOptions,
): Promise<Uint8Array> {
  const margin = Math.max(0, options.margin);
  const gap = Math.max(0, options.gap);
  const { cols, rows } = nUpGrid(options.pagesPerSheet);
  const sheet = sheetSizeForNUp(options.paperSize, options.orientation);
  const usableW = sheet.width - margin * 2 - gap * (cols - 1);
  const usableH = sheet.height - margin * 2 - gap * (rows - 1);
  if (usableW < 20 || usableH < 20) {
    throw new Error("Margins and gaps leave no room for pages. Reduce them and try again.");
  }
  const cellW = usableW / cols;
  const cellH = usableH / rows;
  const fillOrder = options.fillOrder ?? "across";

  const source = await PDFDocument.load(bytes, { updateMetadata: false });
  const pageCount = source.getPageCount();
  if (!pageCount) throw new Error("This PDF has no pages.");

  const output = await PDFDocument.create();
  const totalSlots = cols * rows;
  const sheetCount = Math.ceil(pageCount / totalSlots);

  for (let sheetIndex = 0; sheetIndex < sheetCount; sheetIndex += 1) {
    const sheetPage = output.addPage([sheet.width, sheet.height]);
    for (let slot = 0; slot < totalSlots; slot += 1) {
      const pageIndex = sheetIndex * totalSlots + slot;
      if (pageIndex >= pageCount) break;

      const col = fillOrder === "across" ? slot % cols : Math.floor(slot / rows);
      const row = fillOrder === "across" ? Math.floor(slot / cols) : slot % rows;
      const cellX = margin + col * (cellW + gap);
      const cellYTop = sheet.height - margin - row * (cellH + gap);
      const cellY = cellYTop - cellH;

      const sourcePage = source.getPage(pageIndex);
      const [embedded] = await output.embedPages([sourcePage]);
      const { width: srcW, height: srcH } = embedded;
      const scale = Math.min(cellW / srcW, cellH / srcH);
      const drawW = srcW * scale;
      const drawH = srcH * scale;
      const drawX = cellX + (cellW - drawW) / 2;
      const drawY = cellY + (cellH - drawH) / 2;

      sheetPage.drawPage(embedded, {
        x: drawX,
        y: drawY,
        xScale: scale,
        yScale: scale,
      });

      if (options.cellBorder) {
        sheetPage.drawRectangle({
          x: cellX,
          y: cellY,
          width: cellW,
          height: cellH,
          borderColor: rgb(0.72, 0.72, 0.72),
          borderWidth: 0.6,
        });
      }
    }
  }

  return output.save({ addDefaultPage: false, useObjectStreams: true });
}

export type BatesOptions = {
  prefix: string;
  suffix: string;
  startNumber: number;
  digits: number;
  position: PageNumberPosition;
  margin: number;
  fontSize: number;
  color: string;
  whitePlate: boolean;
};

export type BatesFileInput = {
  name: string;
  bytes: ArrayBuffer | Uint8Array;
};

export type BatesFileResult = {
  name: string;
  bytes: Uint8Array;
  pageCount: number;
  startLabel: string;
  endLabel: string;
  startNumber: number;
  endNumber: number;
};

export function formatBatesLabel(prefix: string, number: number, digits: number, suffix: string) {
  const pad = Math.max(1, Math.min(12, Math.floor(digits) || 6));
  const core = String(Math.max(0, Math.floor(number))).padStart(pad, "0");
  return `${prefix}${core}${suffix}`;
}

function drawBatesOnPage(
  page: PDFPage,
  font: PDFFont,
  label: string,
  options: BatesOptions,
) {
  const text = safeStandardFontText(font, label);
  const size = options.fontSize;
  const textWidth = font.widthOfTextAtSize(text, size);
  const textHeight = size;
  const { width, height } = page.getSize();
  const margin = options.margin;
  const x = options.position.endsWith("left")
    ? margin
    : options.position.endsWith("right")
      ? width - margin - textWidth
      : (width - textWidth) / 2;
  const y = options.position.startsWith("top")
    ? height - margin - textHeight
    : margin;
  const color = parseHexColor(options.color);

  if (options.whitePlate) {
    const padX = 4;
    const padY = 2;
    page.drawRectangle({
      x: x - padX,
      y: y - padY,
      width: textWidth + padX * 2,
      height: textHeight + padY * 2,
      color: rgb(1, 1, 1),
      opacity: 0.92,
    });
  }
  page.drawText(text, { x, y, size, font, color });
}

export async function applyBatesNumbering(
  files: BatesFileInput[],
  options: BatesOptions,
): Promise<{ results: BatesFileResult[]; csv: string }> {
  if (!files.length) throw new Error("Add at least one PDF.");
  if (!Number.isInteger(options.startNumber) || options.startNumber < 0) {
    throw new Error("Start number must be a whole number ≥ 0.");
  }
  if (options.digits < 1 || options.digits > 12) {
    throw new Error("Choose between 1 and 12 zero-pad digits.");
  }
  if (options.fontSize < 6 || options.fontSize > 72) {
    throw new Error("Font size must be between 6 and 72.");
  }

  let next = options.startNumber;
  const results: BatesFileResult[] = [];

  for (const input of files) {
    const document = await PDFDocument.load(input.bytes, { updateMetadata: false });
    const pageCount = document.getPageCount();
    if (!pageCount) throw new Error(`${input.name} has no pages.`);
    const font = await document.embedFont(StandardFonts.Helvetica);
    const startNumber = next;
    for (let i = 0; i < pageCount; i += 1) {
      const label = formatBatesLabel(options.prefix, next, options.digits, options.suffix);
      drawBatesOnPage(document.getPage(i), font, label, options);
      next += 1;
    }
    const endNumber = next - 1;
    const outName = input.name.replace(/\.pdf$/i, "") + "-bates.pdf";
    results.push({
      name: outName,
      bytes: await document.save({ useObjectStreams: true }),
      pageCount,
      startNumber,
      endNumber,
      startLabel: formatBatesLabel(options.prefix, startNumber, options.digits, options.suffix),
      endLabel: formatBatesLabel(options.prefix, endNumber, options.digits, options.suffix),
    });
  }

  const csvLines = [
    "source_file,output_file,page_count,bates_start,bates_end,start_number,end_number",
    ...results.map((r, i) => {
      const src = files[i].name.replace(/"/g, '""');
      const out = r.name.replace(/"/g, '""');
      return `"${src}","${out}",${r.pageCount},"${r.startLabel}","${r.endLabel}",${r.startNumber},${r.endNumber}`;
    }),
  ];

  return { results, csv: csvLines.join("\n") + "\n" };
}

export async function zipBatesResults(results: BatesFileResult[]): Promise<Uint8Array> {
  const archive: Record<string, Uint8Array> = {};
  for (const r of results) archive[r.name] = r.bytes;
  return zipSync(archive, { level: 6 });
}

export type HandwritingPaper = "ruled" | "plain";
export type HandwritingOptions = {
  paper: HandwritingPaper;
  fontBytes: ArrayBuffer | Uint8Array;
  fontSize: number;
  lineHeight: number;
  inkColor: string;
  margin: number;
  messiness: number;
  slant: number;
};

function seededNoise(seed: number) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function drawNotebookBackground(page: PDFPage, paper: HandwritingPaper, width: number, height: number) {
  page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(0.99, 0.98, 0.94) });
  if (paper === "ruled") {
    const lineGap = 28;
    const top = height - 54;
    for (let y = top; y > 40; y -= lineGap) {
      page.drawLine({
        start: { x: 48, y },
        end: { x: width - 36, y },
        thickness: 0.5,
        color: rgb(0.72, 0.82, 0.92),
      });
    }
    page.drawLine({
      start: { x: 64, y: 36 },
      end: { x: 64, y: height - 36 },
      thickness: 0.8,
      color: rgb(0.92, 0.55, 0.55),
    });
  }
}

export async function extractPdfPlainText(bytes: ArrayBuffer | Uint8Array): Promise<{
  text: string;
  pageTexts: string[];
  charCount: number;
}> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // Worker is configured by callers in the browser; Node tests can skip worker.
  try {
    if (typeof window !== "undefined" && !(pdfjs as { GlobalWorkerOptions?: { workerSrc?: string } }).GlobalWorkerOptions?.workerSrc) {
      (pdfjs as { GlobalWorkerOptions: { workerSrc: string } }).GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    }
  } catch {
    // ignore
  }
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const task = pdfjs.getDocument({ data: Uint8Array.from(data) });
  const doc = await task.promise;
  const pageTexts: string[] = [];
  try {
    for (let i = 1; i <= doc.numPages; i += 1) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const parts: string[] = [];
      for (const item of content.items) {
        if (item && typeof item === "object" && "str" in item) {
          const str = String((item as { str: string }).str);
          if (str) parts.push(str);
        }
      }
      pageTexts.push(parts.join(" ").replace(/\s+/g, " ").trim());
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  const text = pageTexts.filter(Boolean).join("\n\n").trim();
  return { text, pageTexts, charCount: text.length };
}

function wrapLines(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  const paragraphs = text.replace(/\r\n?/g, "\n").split(/\n+/);
  const lines: string[] = [];
  for (const para of paragraphs) {
    const words = para.trim().split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const word of words) {
      const trial = current ? `${current} ${word}` : word;
      const width = font.widthOfTextAtSize(safeStandardFontText(font, trial), fontSize);
      if (width <= maxWidth || !current) {
        current = trial;
      } else {
        lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

export async function pdfToHandwritingNotebook(
  sourceText: string,
  options: HandwritingOptions,
): Promise<Uint8Array> {
  const cleaned = sourceText.replace(/\u00a0/g, " ").trim();
  if (!cleaned) throw new Error("No selectable text found. Use OCR first for scanned PDFs.");

  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = Math.max(48, options.margin);
  const fontSize = Math.max(14, Math.min(36, options.fontSize));
  const lineHeight = Math.max(fontSize * 1.15, options.lineHeight);
  const messiness = Math.max(0, Math.min(1, options.messiness));
  const slantDeg = Math.max(-18, Math.min(18, options.slant));
  const ink = parseHexColor(options.inkColor);

  const output = await PDFDocument.create();
  output.registerFontkit(fontkit);
  const font = await output.embedFont(options.fontBytes);
  const maxWidth = pageWidth - margin - 40;
  const lines = wrapLines(cleaned, font, fontSize, maxWidth);
  const usableTop = pageHeight - 54;
  const usableBottom = 48;
  const linesPerPage = Math.max(1, Math.floor((usableTop - usableBottom) / lineHeight));

  let lineIndex = 0;
  let glyphSeed = 1;
  while (lineIndex < lines.length) {
    const page = output.addPage([pageWidth, pageHeight]);
    drawNotebookBackground(page, options.paper, pageWidth, pageHeight);
    const pageLines = lines.slice(lineIndex, lineIndex + linesPerPage);
    pageLines.forEach((line, row) => {
      if (!line) return;
      let x = margin + 8;
      const baseY = usableTop - row * lineHeight - fontSize * 0.35;
      for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        glyphSeed += 1;
        const n1 = seededNoise(glyphSeed);
        const n2 = seededNoise(glyphSeed + 17);
        const n3 = seededNoise(glyphSeed + 41);
        const dx = (n1 - 0.5) * messiness * 1.8;
        const dy = (n2 - 0.5) * messiness * 2.4;
        const rot = slantDeg + (n3 - 0.5) * messiness * 6;
        const scale = 1 + (seededNoise(glyphSeed + 7) - 0.5) * messiness * 0.12;
        const size = fontSize * scale;
        const safe = safeStandardFontText(font, ch);
        try {
          page.drawText(safe, {
            x: x + dx,
            y: baseY + dy,
            size,
            font,
            color: ink,
            rotate: degrees(rot),
          });
        } catch {
          // skip unencodable glyph
        }
        x += font.widthOfTextAtSize(safe === "?" && ch !== "?" ? "?" : safe, size) + 0.4 + messiness * 0.6;
      }
    });
    lineIndex += linesPerPage;
  }

  if (!output.getPageCount()) {
    const page = output.addPage([pageWidth, pageHeight]);
    drawNotebookBackground(page, options.paper, pageWidth, pageHeight);
  }

  return output.save({ addDefaultPage: false, useObjectStreams: true });
}

/** Perspective-ish quad crop via canvas (manual corners). Returns JPEG bytes. */
export async function warpQuadToJpeg(
  image: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  corners: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }],
  outputWidth: number,
  enhanceContrast = false,
  quality = 0.86,
): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const [tl, tr, br, bl] = corners;
  const topW = Math.hypot(tr.x - tl.x, tr.y - tl.y);
  const bottomW = Math.hypot(br.x - bl.x, br.y - bl.y);
  const leftH = Math.hypot(bl.x - tl.x, bl.y - tl.y);
  const rightH = Math.hypot(br.x - tr.x, br.y - tr.y);
  const width = Math.max(32, Math.round(outputWidth || Math.max(topW, bottomW)));
  const height = Math.max(32, Math.round(width * (Math.max(leftH, rightH) / Math.max(topW, bottomW, 1))));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas is not available in this browser.");

  // Sample destination pixels from the source quad (bilinear inverse mapping).
  const srcCanvas = document.createElement("canvas");
  srcCanvas.width = sourceWidth;
  srcCanvas.height = sourceHeight;
  const srcCtx = srcCanvas.getContext("2d", { willReadFrequently: true });
  if (!srcCtx) throw new Error("Canvas is not available in this browser.");
  srcCtx.drawImage(image, 0, 0, sourceWidth, sourceHeight);
  const srcData = srcCtx.getImageData(0, 0, sourceWidth, sourceHeight);
  const out = ctx.createImageData(width, height);

  for (let y = 0; y < height; y += 1) {
    const v = height <= 1 ? 0 : y / (height - 1);
    for (let x = 0; x < width; x += 1) {
      const u = width <= 1 ? 0 : x / (width - 1);
      const topX = tl.x + (tr.x - tl.x) * u;
      const topY = tl.y + (tr.y - tl.y) * u;
      const botX = bl.x + (br.x - bl.x) * u;
      const botY = bl.y + (br.y - bl.y) * u;
      const sx = topX + (botX - topX) * v;
      const sy = topY + (botY - topY) * v;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(sourceWidth - 1, x0 + 1);
      const y1 = Math.min(sourceHeight - 1, y0 + 1);
      const fx = sx - x0;
      const fy = sy - y0;
      const idx = (y * width + x) * 4;
      if (x0 < 0 || y0 < 0 || x0 >= sourceWidth || y0 >= sourceHeight) {
        out.data[idx] = 255;
        out.data[idx + 1] = 255;
        out.data[idx + 2] = 255;
        out.data[idx + 3] = 255;
        continue;
      }
      const i00 = (y0 * sourceWidth + x0) * 4;
      const i10 = (y0 * sourceWidth + x1) * 4;
      const i01 = (y1 * sourceWidth + x0) * 4;
      const i11 = (y1 * sourceWidth + x1) * 4;
      for (let c = 0; c < 3; c += 1) {
        const v00 = srcData.data[i00 + c];
        const v10 = srcData.data[i10 + c];
        const v01 = srcData.data[i01 + c];
        const v11 = srcData.data[i11 + c];
        out.data[idx + c] = Math.round(
          v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) + v01 * (1 - fx) * fy + v11 * fx * fy,
        );
      }
      out.data[idx + 3] = 255;
    }
  }

  if (enhanceContrast) {
    // Simple auto-levels + mild contrast stretch.
    let min = 255;
    let max = 0;
    for (let i = 0; i < out.data.length; i += 4) {
      const g = out.data[i] * 0.299 + out.data[i + 1] * 0.587 + out.data[i + 2] * 0.114;
      if (g < min) min = g;
      if (g > max) max = g;
    }
    const range = Math.max(1, max - min);
    for (let i = 0; i < out.data.length; i += 4) {
      for (let c = 0; c < 3; c += 1) {
        let v = ((out.data[i + c] - min) / range) * 255;
        v = (v - 128) * 1.18 + 128;
        out.data[i + c] = Math.max(0, Math.min(255, Math.round(v)));
      }
    }
  }

  ctx.putImageData(out, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob) throw new Error("Could not encode the cropped page.");
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height };
}

export async function imagesJpegToPdf(
  pages: Array<{ bytes: Uint8Array; width: number; height: number }>,
  margin = 0,
): Promise<Uint8Array> {
  if (!pages.length) throw new Error("Add at least one scanned page.");
  const output = await PDFDocument.create();
  for (const pageImage of pages) {
    const image = await output.embedJpg(pageImage.bytes);
    const width = pageImage.width * 0.75;
    const height = pageImage.height * 0.75;
    const page = output.addPage([width + margin * 2, height + margin * 2]);
    page.drawImage(image, { x: margin, y: margin, width, height });
  }
  return output.save({ addDefaultPage: false, useObjectStreams: true });
}
