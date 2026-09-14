const DOWNLOAD_MIME_TYPE = "application/octet-stream";
const REVOKE_DELAY_MS = 60_000;
export const GENERATED_FILE_EVENT = "dearpdf:generated-file";
export const DISMISS_COMPLETION_EVENT = "dearpdf:dismiss-completion";

/** Clear sticky "PDF ready" panel (header Open, nav, file picker, popstate). */
export function dismissPdfToolCompletion() {
  if (typeof window === "undefined") return;
  window.__dearPdfGeneratedFile = undefined;
  window.dispatchEvent(new Event(DISMISS_COMPLETION_EVENT));
}

export type GeneratedFileEventDetail = {
  blob: Blob;
  fileName: string;
  nextStep: string;
};


function toBlobParts(contents: Blob | BlobPart | Uint8Array | ArrayBuffer): BlobPart[] {
  if (contents instanceof Blob) return [contents];
  if (contents instanceof ArrayBuffer) return [contents];
  if (contents instanceof Uint8Array) {
    return [contents.slice().buffer as ArrayBuffer];
  }
  return [contents as BlobPart];
}

declare global {
  interface Window {
    __dearPdfGeneratedFile?: GeneratedFileEventDetail;
    __dearPdfNextStep?: string;
  }
}

function generatedFile(contents: Blob | BlobPart, fileName: string) {
  const blob = contents instanceof Blob ? contents : new Blob(toBlobParts(contents as BlobPart | Uint8Array | ArrayBuffer), { type: DOWNLOAD_MIME_TYPE });
  const nextStep = fileName.toLowerCase().endsWith(".pdf")
    ? window.__dearPdfNextStep ?? "download"
    : "download";
  const detail = { blob, fileName, nextStep };
  window.__dearPdfGeneratedFile = detail;
  window.dispatchEvent(new CustomEvent<GeneratedFileEventDetail>(GENERATED_FILE_EVENT, { detail }));
  return detail;
}

/**
 * Saves a file without navigating the current tab. Using a generic binary MIME
 * type prevents iOS Safari from handing PDFs to its inline viewer.
 */
export function downloadBrowserFile(contents: Blob | BlobPart, fileName: string) {
  const blob = contents instanceof Blob ? contents : new Blob(toBlobParts(contents as BlobPart | Uint8Array | ArrayBuffer), { type: DOWNLOAD_MIME_TYPE });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();

  // Safari may finish consuming a Blob URL after the click task has ended.
  window.setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

/**
 * Starts a server-streamed download while the click still has browser user
 * activation. This avoids buffering an entire public PDF into a Blob first,
 * which can stall in iOS in-app browsers on slower mobile connections.
 */
export function downloadBrowserUrl(href: string, fileName: string) {
  const link = document.createElement("a");
  link.href = href;
  link.download = fileName;
  link.target = "_blank";
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/** Announces a generated PDF without forcing a download. */
export function announceGeneratedPdf(contents: Blob | BlobPart, fileName: string) {
  generatedFile(contents, fileName);
}

/**
 * Downloads a browser-generated file without handing PDFs to the browser's
 * inline viewer. The generic binary MIME type is intentional: Safari otherwise
 * opens generated PDFs in a new viewer instead of honouring the filename.
 */
export function downloadGeneratedFile(
  contents: Blob | BlobPart,
  fileName: string,
) {
  const generated = generatedFile(contents, fileName);
  if (generated.nextStep !== "download") return;
  downloadBrowserFile(generated.blob, fileName);
}
