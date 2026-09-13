import { rasterizedPagesToPdf, type RasterizedPdfPage } from "./pdf-tools";

async function canvasToJpeg(canvas: HTMLCanvasElement, quality: number) {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob) throw new Error("A PDF page could not be compressed.");
  return new Uint8Array(await blob.arrayBuffer());
}

async function rasterizePdf(bytes: ArrayBuffer, dpi: number, quality: number) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes) });
  const document = await task.promise;
  const pages: RasterizedPdfPage[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const pageSize = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: dpi / 72 });
      const canvas = window.document.createElement("canvas");
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("PDF compression is not supported in this browser.");
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: context, viewport, background: "#fff" }).promise;
      pages.push({ bytes: await canvasToJpeg(canvas, quality), width: pageSize.width, height: pageSize.height });
      canvas.width = 1;
      canvas.height = 1;
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  return rasterizedPagesToPdf(pages);
}

export async function compressPdfForUploadLimit(file: File, maximumBytes: number) {
  if (file.size <= maximumBytes) return { file, compressed: false, flattened: false };
  const sourceBytes = await file.arrayBuffer();
  const { PDFDocument } = await import("pdf-lib");
  const source = await PDFDocument.load(sourceBytes, { updateMetadata: false });
  const optimised = await source.save({ addDefaultPage: false, updateFieldAppearances: false, useObjectStreams: true });
  if (optimised.byteLength <= maximumBytes) {
    return {
      file: new File([optimised as BlobPart], file.name.replace(/\.pdf$/i, "-compressed.pdf"), { type: "application/pdf", lastModified: Date.now() }),
      compressed: true,
      flattened: false,
    };
  }

  const attempts = [
    { dpi: 120, quality: 0.7 },
    { dpi: 96, quality: 0.58 },
    { dpi: 78, quality: 0.48 },
    { dpi: 64, quality: 0.4 },
    { dpi: 52, quality: 0.32 },
    { dpi: 42, quality: 0.26 },
  ];
  let smallest = optimised;
  for (const attempt of attempts) {
    const candidate = await rasterizePdf(sourceBytes, attempt.dpi, attempt.quality);
    if (candidate.byteLength < smallest.byteLength) smallest = candidate;
    if (candidate.byteLength <= maximumBytes) {
      return {
        file: new File([candidate as BlobPart], file.name.replace(/\.pdf$/i, "-compressed.pdf"), { type: "application/pdf", lastModified: Date.now() }),
        compressed: true,
        flattened: true,
      };
    }
  }
  return {
    file: new File([smallest as BlobPart], file.name.replace(/\.pdf$/i, "-compressed.pdf"), { type: "application/pdf", lastModified: Date.now() }),
    compressed: smallest.byteLength < file.size,
    flattened: smallest !== optimised,
  };
}
