import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

type TextContent = Awaited<ReturnType<PDFPageProxy["getTextContent"]>>;

let workerReady = false;
let asyncIteratorPolyfilled = false;

/**
 * Safari (through current stable) ships ReadableStream but not
 * ReadableStream.prototype[Symbol.asyncIterator]. pdf.js getTextContent()
 * uses `for await...of` on that stream and throws:
 *   undefined is not a function (near '...t of e...')
 */
export function ensureReadableStreamAsyncIterator() {
  if (asyncIteratorPolyfilled || typeof ReadableStream === "undefined") return;
  const proto = ReadableStream.prototype as ReadableStream<unknown> & {
    [Symbol.asyncIterator]?: () => AsyncIterator<unknown>;
  };
  if (typeof proto[Symbol.asyncIterator] === "function") {
    asyncIteratorPolyfilled = true;
    return;
  }
  proto[Symbol.asyncIterator] = function asyncIterator(this: ReadableStream<unknown>) {
    const reader = this.getReader();
    return {
      async next() {
        try {
          const result = await reader.read();
          if (result.done) {
            reader.releaseLock();
            return { done: true as const, value: undefined };
          }
          return { done: false as const, value: result.value };
        } catch (error) {
          reader.releaseLock();
          throw error;
        }
      },
      async return() {
        try {
          await reader.cancel();
        } catch {
          // ignore cancel errors during cleanup
        }
        try {
          reader.releaseLock();
        } catch {
          // already released
        }
        return { done: true as const, value: undefined };
      },
    };
  };
  asyncIteratorPolyfilled = true;
}

export async function getPdfjs() {
  ensureReadableStreamAsyncIterator();
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!workerReady) {
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    workerReady = true;
  }
  return pdfjs;
}

export async function openPdfLoadingTask(
  bytes: ArrayBuffer | Uint8Array,
  options?: {
    password?: string;
    disableFontFace?: boolean;
    useSystemFonts?: boolean;
  },
) {
  const pdfjs = await getPdfjs();
  const data = bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes);
  return pdfjs.getDocument({
    data,
    password: options?.password,
    wasmUrl: "/pdfjs/wasm/",
    useSystemFonts: options?.useSystemFonts ?? true,
    disableFontFace: options?.disableFontFace,
  });
}

export async function loadPdfDocument(
  bytes: ArrayBuffer | Uint8Array,
  password?: string,
): Promise<PDFDocumentProxy> {
  const task = await openPdfLoadingTask(bytes, { password });
  return task.promise;
}

/** Safe page text extraction that works when Safari lacks stream async iteration. */
export async function getPageTextContent(
  page: PDFPageProxy,
  params?: { includeMarkedContent?: boolean; disableNormalization?: boolean },
): Promise<TextContent> {
  ensureReadableStreamAsyncIterator();
  try {
    return await page.getTextContent(params);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const looksLikeAsyncIter =
      /undefined is not a function/i.test(message) ||
      /not (a function|iterable)/i.test(message) ||
      /asyncIterator|of e|of t/i.test(message);
    if (!looksLikeAsyncIter) throw error;

    const reader = page.streamTextContent(params).getReader();
    const items: TextContent["items"] = [];
    const styles: TextContent["styles"] = Object.create(null);
    let lang: string | null = null;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = value as Partial<TextContent> | undefined;
        if (!chunk) continue;
        if (chunk.lang && !lang) lang = chunk.lang;
        if (chunk.styles) Object.assign(styles, chunk.styles);
        if (Array.isArray(chunk.items)) items.push(...chunk.items);
      }
    } finally {
      reader.releaseLock();
    }
    return { items, styles, lang };
  }
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

export function bytesFromUnknown(data: unknown): Uint8Array | null {
  if (!data) return null;
  if (data instanceof Uint8Array) return data.slice();
  if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView;
    return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
  }
  if (Array.isArray(data)) return Uint8Array.from(data as number[]);
  return null;
}
