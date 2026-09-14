"use client";

import { useRef, useState } from "react";
import PdfPageWorkspace from "../../../components/pdf-page-workspace";
import PdfNextStepSelector from "../../../components/pdf-next-step-selector";
import { downloadGeneratedFile } from "../../../lib/browser-download";
import { useIncomingPdfHandoff } from "../../../lib/pdf-tool-handoff";
import { inspectPdf, organisePdfPages } from "../../../lib/pdf-tools";
import StitchToolShell from "../../../components/StitchToolShell";
import { trackToolEvent } from "../../../lib/stats";

type PageItem = { id: number; originalIndex: number; rotation: number; thumbnail: string };
type SelectedPdf = { file: File; bytes: ArrayBuffer; pageCount: number };
type WorkState = { kind: "idle" } | { kind: "reading" | "working" | "error"; message: string };

function safeBaseName(fileName: string) {
  return fileName.replace(/\.pdf$/i, "").replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "") || "document";
}

async function renderThumbs(bytes: ArrayBuffer, onPage?: (page: PageItem, index: number, total: number) => boolean | void) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const loadingTask = pdfjs.getDocument({ data: Uint8Array.from(new Uint8Array(bytes)) });
  const document = await loadingTask.promise;
  const thumbnails: PageItem[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const originalViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(1.5, 170 / originalViewport.width);
      const viewport = page.getViewport({ scale });
      const canvas = window.document.createElement("canvas");
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("Page previews are not supported in this browser.");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      const item: PageItem = {
        id: pageNumber - 1,
        originalIndex: pageNumber - 1,
        rotation: 0,
        thumbnail: canvas.toDataURL("image/jpeg", 0.78),
      };
      thumbnails.push(item);
      page.cleanup();
      if (onPage?.(item, pageNumber, document.numPages) === false) break;
    }
  } finally {
    await loadingTask.destroy();
  }
  return thumbnails;
}

export default function RotatePdfPage() {
  const [selected, setSelected] = useState<SelectedPdf | null>(null);
  const [pages, setPages] = useState<PageItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [work, setWork] = useState<WorkState>({ kind: "idle" });
  const [outputName, setOutputName] = useState("rotated.pdf");
  const inputRef = useRef<HTMLInputElement>(null);
  const previewRequest = useRef(0);
  const busy = work.kind === "reading" || work.kind === "working";
  useIncomingPdfHandoff(chooseFile);

  async function chooseFile(file?: File) {
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setWork({ kind: "error", message: "Choose a PDF file." });
      return;
    }
    setWork({ kind: "reading", message: "Checking the PDF on this device…" });
    const request = previewRequest.current + 1;
    previewRequest.current = request;
    try {
      const bytes = await file.arrayBuffer();
      const { pageCount } = await inspectPdf(bytes);
      const placeholders: PageItem[] = Array.from({ length: pageCount }, (_, index) => ({
        id: index, originalIndex: index, rotation: 0, thumbnail: "",
      }));
      setSelected({ file, bytes, pageCount });
      setPages(placeholders);
      setSelectedIds(placeholders.map((p) => String(p.id)));
      setOutputName(`${safeBaseName(file.name)}-rotated.pdf`);
      setWork({ kind: "idle" });
      void renderThumbs(bytes, (page) => {
        if (previewRequest.current !== request) return false;
        setPages((current) => current.map((item) =>
          item.originalIndex === page.originalIndex ? { ...page, rotation: item.rotation } : item,
        ));
      });
    } catch {
      setSelected(null);
      setPages([]);
      setWork({ kind: "error", message: "This file could not be read. Password-protected PDFs must be unlocked first." });
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  function rotateSelected(amount: number) {
    const set = new Set(selectedIds);
    setPages((current) => current.map((page) =>
      set.has(String(page.id)) ? { ...page, rotation: (page.rotation + amount + 360) % 360 } : page,
    ));
  }

  function rotateAll(amount: number) {
    setPages((current) => current.map((page) => ({ ...page, rotation: (page.rotation + amount + 360) % 360 })));
  }

  async function downloadRotated() {
    if (!selected || !pages.length) return;
    setWork({ kind: "working", message: "Rotating pages on this device…" });
    trackToolEvent("rotate", "start");
    try {
      const output = await organisePdfPages(
        selected.bytes,
        pages.map((page) => ({ pageIndex: page.originalIndex, rotation: page.rotation })),
      );
      downloadGeneratedFile(output as BlobPart, outputName.replace(/\.pdf$/i, "") + ".pdf");
      trackToolEvent("rotate", "success");
      setWork({ kind: "idle" });
    } catch (error) {
      trackToolEvent("rotate", "error");
      setWork({ kind: "error", message: error instanceof Error ? error.message : "Could not rotate the PDF." });
    }
  }

  return (
    <StitchToolShell
      title="Rotate PDF"
      subtitle="Rotate all or selected pages by 90° steps — same engine as Organise."
      className={`organise-page${selected ? " has-file" : ""}`}
      related={[
        { href: "/pdf-tools/flip", label: "Flip PDF" },
        { href: "/pdf-tools/organise", label: "Organise pages" },
      ]}
    >
      <section className="organise-workspace" aria-labelledby="rotate-workspace-title">
        <div className="merge-workspace-heading">
          <div>
            <h2 id="rotate-workspace-title">Pages</h2>
            <p>{selected ? `${selected.pageCount} pages` : "Choose one PDF file"}</p>
          </div>
          {selected ? (
            <div className="organise-heading-actions">
              <button className="text-button" type="button" onClick={() => rotateAll(-90)} disabled={busy}>All −90°</button>
              <button className="text-button" type="button" onClick={() => rotateAll(90)} disabled={busy}>All +90°</button>
              <button className="text-button" type="button" onClick={() => rotateSelected(-90)} disabled={busy || !selectedIds.length}>Selected −90°</button>
              <button className="text-button" type="button" onClick={() => rotateSelected(90)} disabled={busy || !selectedIds.length}>Selected +90°</button>
              <button className="text-button" type="button" onClick={() => { previewRequest.current += 1; setSelected(null); setPages([]); setSelectedIds([]); setWork({ kind: "idle" }); }} disabled={busy}>Remove file</button>
            </div>
          ) : null}
        </div>

        {!selected ? (
          <label className={`pdf-drop-zone${busy ? " disabled" : ""}`} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (!busy) void chooseFile(e.dataTransfer.files[0]); }}>
            <input ref={inputRef} type="file" accept=".pdf,application/pdf" disabled={busy} onChange={(e) => void chooseFile(e.target.files?.[0])} />
            <span className="drop-zone-mark" aria-hidden="true">＋</span>
            <strong>Choose a PDF file</strong>
            <span>or drag and drop it here</span>
          </label>
        ) : (
          <>
            <div className="organise-tip">Select pages (shift-click for a range), then rotate selected or all pages. Downloads use the same vector rotate engine as Organise.</div>
            <PdfPageWorkspace
              pages={pages.map((page) => ({
                id: String(page.id),
                pageIndex: page.originalIndex,
                thumbnail: page.thumbnail,
                rotation: page.rotation,
              }))}
              selectedIds={selectedIds}
              onSelectedIdsChange={setSelectedIds}
              onRotate={(id, amount) => setPages((current) => current.map((page) =>
                String(page.id) === id ? { ...page, rotation: (page.rotation + amount + 360) % 360 } : page,
              ))}
              disabled={busy}
              title="Select and rotate pages"
            />
            <div className="organise-action-row">
              <div>
                <strong>{selectedIds.length} selected · {pages.filter((p) => p.rotation).length} rotated</strong>
                <span>Vector rotation — text stays sharp</span>
              </div>
              <div className="merge-action-controls">
                <label className="merge-output-name">
                  <span>File name</span>
                  <input type="text" value={outputName} spellCheck={false} disabled={busy} onChange={(e) => setOutputName(e.target.value)} />
                </label>
                <PdfNextStepSelector />
                <button className="merge-button" type="button" onClick={() => void downloadRotated()} disabled={busy}>
                  {work.kind === "working" ? "Working…" : "Download rotated PDF"}
                </button>
              </div>
            </div>
          </>
        )}
        {work.kind !== "idle" ? <p className={`pdf-work-message ${work.kind}`} role={work.kind === "error" ? "alert" : "status"}>{work.message}</p> : null}
      </section>
    </StitchToolShell>
  );
}
