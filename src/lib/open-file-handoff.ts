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
      kind: "pdfs";
      handoffIds: string[];
      names: string[];
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

/** Open local files: one PDF opens the tool picker; several PDFs go to Merge/Flatten/Bates. */
export async function openFileIntoDearPdf(file: File) {
  return openFilesIntoDearPdf([file]);
}

export async function openFilesIntoDearPdf(files: File[]) {
  const list = Array.from(files).filter(Boolean);
  if (!list.length) return;
  dismissPdfToolCompletion();

  if (list.length === 1) {
    await openSingleFileIntoDearPdf(list[0]!);
    return;
  }

  const pdfs: { file: File; bytes: Uint8Array }[] = [];
  let imageCount = 0;
  for (const file of list) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (looksLikePdf(bytes)) pdfs.push({ file, bytes });
    else if (looksLikeImage(file)) imageCount += 1;
  }

  if (pdfs.length >= 2) {
    const handoffIds: string[] = [];
    const names: string[] = [];
    for (const pdf of pdfs) {
      const name = pdf.file.name || "document.pdf";
      handoffIds.push(await savePdfToolHandoff(pdf.bytes, name));
      names.push(name);
    }
    pending = { kind: "pdfs", handoffIds, names };
    notify();
    return;
  }

  if (pdfs.length === 1) {
    await openSingleFileIntoDearPdf(pdfs[0]!.file, pdfs[0]!.bytes);
    return;
  }

  if (imageCount > 0) {
    pending = {
      kind: "image",
      name: list.find((file) => looksLikeImage(file))?.name || "image",
    };
    notify();
    return;
  }

  window.location.assign("/#tools");
}

async function openSingleFileIntoDearPdf(file: File, knownBytes?: Uint8Array) {
  const bytes = knownBytes ?? new Uint8Array(await file.arrayBuffer());

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

  const ids = current.kind === "pdfs" ? current.handoffIds : [current.handoffId];
  pending = null;
  notify();
  window.location.assign(pdfToolHandoffUrl(toolPath, ids.join(",")));
}
