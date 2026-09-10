import {
  rasterizedPagesToPdf,
  rasterizedPagesToSizedPdfParts,
  type RasterizedPdfPage,
} from "./pdf-tools";
import { canvasToBlob, loadPdfDocument, renderPageToCanvas } from "./pdfjs";

export async function rasterizePdfPages(
  bytes: ArrayBuffer | Uint8Array,
  options: {
    dpi: number;
    mime?: "image/jpeg" | "image/png" | "image/webp";
    quality?: number;
    grayscale?: boolean;
    password?: string;
    onProgress?: (done: number, total: number) => void;
  },
): Promise<RasterizedPdfPage[]> {
  const pdf = await loadPdfDocument(bytes, options.password);
  const scale = options.dpi / 72;
  const mime = options.mime ?? "image/jpeg";
  const pages: RasterizedPdfPage[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const { canvas } = await renderPageToCanvas(pdf, i, scale);
    if (options.grayscale) {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = image.data;
        for (let p = 0; p < data.length; p += 4) {
          const gray = data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114;
          data[p] = data[p + 1] = data[p + 2] = gray;
        }
        ctx.putImageData(image, 0, 0);
      }
    }
    const blob = await canvasToBlob(canvas, mime, options.quality ?? 0.82);
    const buffer = await blob.arrayBuffer();
    pages.push({
      bytes: new Uint8Array(buffer),
      width: canvas.width,
      height: canvas.height,
    });
    options.onProgress?.(i, pdf.numPages);
  }
  pdf.cleanup();
  return pages;
}

export async function compressByRaster(
  bytes: ArrayBuffer | Uint8Array,
  dpi: number,
  quality: number,
  onProgress?: (done: number, total: number) => void,
) {
  const pages = await rasterizePdfPages(bytes, {
    dpi,
    quality,
    mime: "image/jpeg",
    onProgress,
  });
  return rasterizedPagesToPdf(pages);
}

export async function grayscalePdf(
  bytes: ArrayBuffer | Uint8Array,
  onProgress?: (done: number, total: number) => void,
) {
  const pages = await rasterizePdfPages(bytes, {
    dpi: 144,
    quality: 0.85,
    mime: "image/jpeg",
    grayscale: true,
    onProgress,
  });
  return rasterizedPagesToPdf(pages);
}

export async function unlockByRaster(
  bytes: ArrayBuffer | Uint8Array,
  password: string,
  onProgress?: (done: number, total: number) => void,
) {
  const pages = await rasterizePdfPages(bytes, {
    dpi: 144,
    quality: 0.88,
    mime: "image/jpeg",
    password,
    onProgress,
  });
  return rasterizedPagesToPdf(pages);
}

export async function compressSplitBySize(
  bytes: ArrayBuffer | Uint8Array,
  maxBytes: number,
  onProgress?: (done: number, total: number) => void,
) {
  const pages = await rasterizePdfPages(bytes, {
    dpi: 130,
    quality: 0.8,
    mime: "image/jpeg",
    onProgress,
  });
  return rasterizedPagesToSizedPdfParts(pages, maxBytes);
}

export { rasterizedPagesToPdf };
