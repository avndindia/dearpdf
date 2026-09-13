"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import PdfPageWorkspace from "../../../components/pdf-page-workspace";
import PdfNextStepSelector from "../../../components/pdf-next-step-selector";
import { downloadGeneratedFile } from "../../../lib/browser-download";
import { useIncomingPdfHandoff } from "../../../lib/pdf-tool-handoff";
import { inspectPdf, organisePdfPages, BLANK_PDF_PAGE_INDEX } from "../../../lib/pdf-tools";

type PageItem = {
  id: number;
  originalIndex: number;
  rotation: number;
  thumbnail: string;
};

type SelectedPdf = {
  file: File;
  bytes: ArrayBuffer;
  pageCount: number;
};

type WorkState =
  | { kind: "idle" }
  | { kind: "reading" | "working"; message: string }
  | { kind: "error"; message: string };

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function safeBaseName(fileName: string) {
  return fileName
    .replace(/\.pdf$/i, "")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^-+|-+$/g, "") || "document";
}

function organiseDownloadName(name: string, fallback: string) {
  const trimmed = name.trim() || fallback;
  const base = trimmed.replace(/\.pdf$/i, "").replace(/[^\p{L}\p{N}._ -]+/gu, "-").replace(/-+/g, "-").replace(/^[\s.-]+|[\s.-]+$/g, "");
  return `${base || "organised"}.pdf`;
}

function blankPageThumbnail() {
  const canvas = window.document.createElement("canvas");
  canvas.width = 120;
  canvas.height = 170;
  const context = canvas.getContext("2d");
  if (!context) return "";
  context.fillStyle = "#fff";
  context.fillRect(0, 0, 120, 170);
  context.strokeStyle = "#d8d4c8";
  context.strokeRect(0.5, 0.5, 119, 169);
  context.fillStyle = "#8a867c";
  context.font = "12px sans-serif";
  context.textAlign = "center";
  context.fillText("Blank A4", 60, 88);
  return canvas.toDataURL("image/png");
}

function downloadPdf(bytes: Uint8Array, fileName: string) {
  downloadGeneratedFile(bytes as BlobPart, fileName);
}

function readablePdfError(error: unknown, fileName?: string) {
  const message = error instanceof Error ? error.message : "";
  if (/encrypted/i.test(message)) {
    return `${fileName ?? "This PDF"} is password-protected. Remove its password before organising pages.`;
  }
  return fileName ? `${fileName} could not be read as a valid PDF.` : message || "The PDF could not be processed.";
}

async function renderPageThumbnails(
  bytes: ArrayBuffer,
  onPage?: (page: PageItem, index: number, total: number) => boolean | void,
) {
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

export default function OrganisePdfPage() {
  const [selected, setSelected] = useState<SelectedPdf | null>(null);
  const [pages, setPages] = useState<PageItem[]>([]);
  const [originalPages, setOriginalPages] = useState<PageItem[]>([]);
  const [work, setWork] = useState<WorkState>({ kind: "idle" });
  const [previewProgress, setPreviewProgress] = useState("");
  const [outputName, setOutputName] = useState("organised.pdf");
  const inputRef = useRef<HTMLInputElement>(null);
  const previewRequest = useRef(0);
  const nextPageId = useRef(0);
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
        id: index,
        originalIndex: index,
        rotation: 0,
        thumbnail: "",
      }));
      setSelected({ file, bytes, pageCount });
      setPages(placeholders);
      setOriginalPages(placeholders);
      nextPageId.current = pageCount;
      setOutputName(`${safeBaseName(file.name)}-organised.pdf`);
      setPreviewProgress(pageCount > 1 ? `Loading preview 1 of ${pageCount}…` : "");
      setWork({ kind: "idle" });
      void renderPageThumbnails(bytes, (page, index, total) => {
        if (previewRequest.current !== request) return false;
        setPages((current) => current.map((item) => item.originalIndex === page.originalIndex ? { ...page, rotation: item.rotation } : item));
        setOriginalPages((current) => current.map((item) => item.originalIndex === page.originalIndex ? page : item));
        setPreviewProgress(index < total ? `Loading preview ${index + 1} of ${total}…` : "");
      }).then(() => {
        if (previewRequest.current === request) setPreviewProgress("");
      }).catch((error) => {
        if (previewRequest.current === request) {
          setPreviewProgress("");
          setWork({ kind: "error", message: readablePdfError(error, file.name) });
        }
      });
    } catch (error) {
      setSelected(null);
      setPages([]);
      setOriginalPages([]);
      setPreviewProgress("");
      setWork({ kind: "error", message: readablePdfError(error, file.name) });
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  function clearFile() {
    previewRequest.current += 1;
    setSelected(null);
    setPages([]);
    setOriginalPages([]);
    setPreviewProgress("");
    setOutputName("organised.pdf");
    setWork({ kind: "idle" });
  }

  function rotatePage(id: number, amount: number) {
    setPages((current) => current.map((page) =>
      page.id === id ? { ...page, rotation: (page.rotation + amount + 360) % 360 } : page,
    ));
  }

  function duplicatePage(id: number) {
    setPages((current) => {
      const index = current.findIndex((page) => page.id === id);
      if (index < 0) return current;
      const copy = { ...current[index], id: nextPageId.current };
      nextPageId.current += 1;
      const next = [...current];
      next.splice(index + 1, 0, copy);
      return next;
    });
  }

  function insertBlankAfter(id: number | null) {
    const blank: PageItem = {
      id: nextPageId.current,
      originalIndex: BLANK_PDF_PAGE_INDEX,
      rotation: 0,
      thumbnail: blankPageThumbnail(),
    };
    nextPageId.current += 1;
    setPages((current) => {
      if (id === null) return [...current, blank];
      const index = current.findIndex((page) => page.id === id);
      if (index < 0) return [...current, blank];
      const next = [...current];
      next.splice(index + 1, 0, blank);
      return next;
    });
  }

  function resetPages() {
    setPages(originalPages.map((page) => ({ ...page, rotation: 0 })));
  }

  async function downloadOrganisedPdf() {
    if (!selected || !pages.length) return;
    setWork({ kind: "working", message: "Building the organised PDF on this device…" });
    try {
      const output = await organisePdfPages(
        selected.bytes,
        pages.map((page) => ({ pageIndex: page.originalIndex, rotation: page.rotation })),
      );
      downloadPdf(output, organiseDownloadName(outputName, `${safeBaseName(selected.file.name)}-organised.pdf`));
      setWork({ kind: "idle" });
    } catch (error) {
      setWork({ kind: "error", message: readablePdfError(error) });
    }
  }

  const originalKept = pages.filter((page) => page.originalIndex >= 0);
  const uniqueOriginals = new Set(originalKept.map((page) => page.originalIndex)).size;
  const removedCount = selected ? selected.pageCount - uniqueOriginals : 0;
  const blankCount = pages.filter((page) => page.originalIndex < 0).length;
  const duplicateCount = originalKept.length - uniqueOriginals;
  const changeNotes = [
    removedCount ? `${removedCount} ${removedCount === 1 ? "page" : "pages"} removed` : "",
    blankCount ? `${blankCount} blank ${blankCount === 1 ? "page" : "pages"}` : "",
    duplicateCount ? `${duplicateCount} ${duplicateCount === 1 ? "copy" : "copies"} added` : "",
  ].filter(Boolean);
  const changed = Boolean(selected) && (
    pages.length !== (selected?.pageCount ?? 0) ||
    pages.some((page, index) => page.originalIndex !== index || page.rotation !== 0)
  );

  return (
    <div className={`pdf-page organise-page${selected ? " has-file" : ""}`}>
      <header className="site-header pdf-site-header">
        <div>
          <Link className="pdf-tools-back" href="/pdf-tools">← All PDF tools</Link><Link className="suite-name" href="/">DearPDF</Link>
          <h1>Organise PDF</h1>
          <p>Reorder, rotate, and remove pages visually.</p>
        </div>
        <div className="local-processing-badge"><span aria-hidden="true">●</span>Files stay on this device</div>
      </header>

      <section className="merge-intro">
        <div>
          <p className="pdf-eyebrow">PROCESSED IN THIS BROWSER · VISUAL PAGE PREVIEWS</p>
          <h2>Put every page in its place.</h2>
        </div>
        <p>
          Choose one PDF, then drag pages into order, rotate them, duplicate a
          page, insert a blank A4, or remove pages you do not need. Name the
          download before you save.
        </p>
      </section>

      <section className="organise-workspace" aria-labelledby="organise-workspace-title">
        <div className="merge-workspace-heading">
          <div>
            <h2 id="organise-workspace-title">Pages</h2>
            <p>{selected ? `${pages.length} pages · original ${selected.pageCount} · ${formatBytes(selected.file.size)}` : "Choose one PDF file"}</p>
          </div>
          {selected ? (
            <div className="organise-heading-actions">
              <button className="text-button" type="button" onClick={() => insertBlankAfter(null)} disabled={busy}>Insert blank A4</button>
              <button className="text-button" type="button" onClick={resetPages} disabled={busy || !changed}>Reset changes</button>
              <button className="text-button" type="button" onClick={clearFile} disabled={busy}>Remove file</button>
            </div>
          ) : null}
        </div>

        {!selected ? (
          <label
            className={`pdf-drop-zone${busy ? " disabled" : ""}`}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (!busy) void chooseFile(event.dataTransfer.files[0]);
            }}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,application/pdf"
              disabled={busy}
              onChange={(event) => void chooseFile(event.target.files?.[0])}
            />
            <span className="drop-zone-mark" aria-hidden="true">＋</span>
            <strong>Choose a PDF file</strong>
            <span>or drag and drop it here</span>
          </label>
        ) : (
          <>
            <div className="organise-tip">Drag page cards to reorder them. Duplicate a page or insert a blank A4 after it from the card buttons.</div>
            {previewProgress ? <p className="pdf-work-message reading" role="status">{previewProgress}</p> : null}
            {pages.length ? (
              <PdfPageWorkspace
                pages={pages.map((page) => ({
                  id: String(page.id),
                  pageIndex: page.originalIndex,
                  thumbnail: page.thumbnail,
                  rotation: page.rotation,
                }))}
                onReorder={(orderedIds) => setPages(orderedIds.map((id) => pages.find((page) => page.id === Number(id))!).filter(Boolean))}
                onRotate={(id, amount) => rotatePage(Number(id), amount)}
                onDuplicate={(id) => duplicatePage(Number(id))}
                onInsertBlankAfter={(id) => insertBlankAfter(Number(id))}
                onRemove={(id) => setPages((current) => current.filter((page) => page.id !== Number(id)))}
                disabled={busy}
                title="Drag, preview, rotate, duplicate, or remove pages"
              />
            ) : (
              <div className="organise-empty">
                <strong>All pages have been removed.</strong>
                <span>Reset the document to bring them back.</span>
                <button className="secondary-button" type="button" onClick={resetPages}>Reset pages</button>
              </div>
            )}
            <div className="organise-action-row">
              <div>
                <strong>{pages.length} {pages.length === 1 ? "page" : "pages"} in the output</strong>
                <span>{changeNotes.length ? changeNotes.join(" · ") : "No pages removed"}</span>
              </div>
              <div className="merge-action-controls">
                <label className="merge-output-name">
                  <span>File name</span>
                  <input
                    type="text"
                    value={outputName}
                    spellCheck={false}
                    autoComplete="off"
                    disabled={busy}
                    aria-label="Organised PDF file name"
                    onChange={(event) => setOutputName(event.target.value)}
                    onBlur={() => setOutputName(organiseDownloadName(outputName, `${safeBaseName(selected.file.name)}-organised.pdf`))}
                  />
                </label>
                <PdfNextStepSelector />
                <button className="merge-button" type="button" onClick={() => void downloadOrganisedPdf()} disabled={busy || !pages.length}>
                  {work.kind === "working" ? "Working…" : "Download organised PDF"}
                </button>
              </div>
            </div>
          </>
        )}

        {work.kind !== "idle" ? (
          <p className={`pdf-work-message ${work.kind}`} role={work.kind === "error" ? "alert" : "status"}>{work.message}</p>
        ) : null}
      </section>

      <section className="merge-assurance">
        <div><strong>Local previews</strong><span>Thumbnails are rendered in this browser tab.</span></div>
        <div><strong>No file tracking</strong><span>Analytics never receive filenames or document contents.</span></div>
        <div><strong>Temporary session</strong><span>Refreshing or closing this page removes the selected file.</span></div>
      </section>

      <section className="merge-notes">
        <h2>Before you organise</h2>
        <ul>
          <li>Password-protected PDFs must be unlocked first.</li>
          <li>Existing digital signatures will normally become invalid after pages are changed.</li>
          <li>Open and check the downloaded result before sending or filing it.</li>
        </ul>
      </section>

      <footer className="site-footer">
        <p><Link href="/pdf-tools">← All PDF tools</Link></p>
        <p><Link href="/">DearPDF</Link> · Government rules and everyday office tools.</p>
      </footer>
    </div>
  );
}
