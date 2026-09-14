"use client";

import { dismissPdfToolCompletion } from "@/lib/browser-download";
import { pdfToolHandoffUrl, savePdfToolHandoff } from "@/lib/pdf-tool-handoff";

export type OpenFilePending =
  | {
      kind: "pdf";
      handoffId: string;
      name: string;
    }
  | {
      kind: "image";
      name: string;
    };

type Listener = (pending: OpenFilePending | null) => void;

let pending: OpenFilePending | null = null;
const listeners = new Set<Listener>();

function notify() {
  for (const listener of listeners) listener(pending);
}

/** Subscribe to pending open-file tool picks (home dropzone + header Open File). */
export function subscribeOpenFilePending(listener: Listener) {
  listeners.add(listener);
  listener(pending);
  return () => {
    listeners.delete(listener);
  };
}

export function getOpenFilePending() {
  return pending;
}

/** Cancel the picker without navigating. Handoff bytes stay in IndexedDB until expiry. */
export function clearOpenFilePending() {
  pending = null;
  notify();
}

function looksLikePdf(bytes: Uint8Array) {
  const header = new TextDecoder("latin1").decode(
    bytes.subarray(0, Math.min(1024, bytes.length)),
  );
  return header.includes("%PDF-");
}

function looksLikeImage(file: File) {
  return (
    file.type.startsWith("image/") ||
    /\.(jpe?g|png|webp)$/i.test(file.name)
  );
}

/** Open a local file: PDFs open a tool picker; images go to Images to PDF. */
export async function openFileIntoDearPdf(file: File) {
  dismissPdfToolCompletion();
  const bytes = new Uint8Array(await file.arrayBuffer());

  if (looksLikePdf(bytes)) {
    const id = await savePdfToolHandoff(bytes, file.name || "document.pdf");
    pending = {
      kind: "pdf",
      handoffId: id,
      name: file.name || "document.pdf",
    };
    notify();
    return;
  }

  if (looksLikeImage(file)) {
    pending = {
      kind: "image",
      name: file.name || "image",
    };
    notify();
    return;
  }

  // Unknown type — still offer PDF tools after a best-effort merge handoff path
  // is unavailable; send the user to the tool directory.
  window.location.assign("/#tools");
}

/** Navigate to a tool with the pending PDF handoff (or images-to-pdf for images). */
export function chooseOpenFileTool(toolPath: string) {
  const current = pending;
  if (!current) return;

  if (current.kind === "image") {
    pending = null;
    notify();
    window.location.assign("/pdf-tools/images-to-pdf");
    return;
  }

  const id = current.handoffId;
  pending = null;
  notify();
  window.location.assign(pdfToolHandoffUrl(toolPath, id));
}
