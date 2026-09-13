"use client";

import { pdfToolHandoffUrl, savePdfToolHandoff } from "@/lib/pdf-tool-handoff";

function looksLikePdf(bytes: Uint8Array) {
  const header = new TextDecoder("latin1").decode(
    bytes.subarray(0, Math.min(1024, bytes.length)),
  );
  return header.includes("%PDF-");
}

/** Open a local file and hand it to the best matching tool (merge for PDFs). */
export async function openFileIntoDearPdf(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());

  if (looksLikePdf(bytes)) {
    const id = await savePdfToolHandoff(bytes, file.name || "document.pdf");
    window.location.assign(pdfToolHandoffUrl("/pdf-tools/merge", id));
    return;
  }

  if (file.type.startsWith("image/") || /\.(jpe?g|png|webp)$/i.test(file.name)) {
    window.location.assign("/pdf-tools/images-to-pdf");
    return;
  }

  window.location.assign("/pdf-tools/merge");
}
