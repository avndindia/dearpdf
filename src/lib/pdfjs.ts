import type { PDFDocumentProxy } from "pdfjs-dist";

let workerReady = false;

export async function getPdfjs() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!workerReady) {
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    workerReady = true;
  }
  return pdfjs;
}

export async function loadPdfDocument(
  bytes: ArrayBuffer | Uint8Array,
  password?: string,
): Promise<PDFDocumentProxy> {
  const pdfjs = await getPdfjs();
  const data = bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes);
  return pdfjs.getDocument({
    data,
    password,
    wasmUrl: "/pdfjs/wasm/",
    useSystemFonts: true,
  }).promise;
}

export async function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, type, quality),
  );
  if (!blob) throw new Error("Could not encode the page image.");
  return blob;
}

export async function renderPageToCanvas(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  scale: number,
) {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Canvas is not available in this browser.");
  await page.render({ canvasContext: context, viewport, canvas }).promise;
  return { canvas, viewport, page };
}
