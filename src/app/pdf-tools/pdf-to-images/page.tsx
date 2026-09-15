"use client";

import { useMemo, useRef, useState } from "react";
import PdfPageWorkspace from "../../../components/pdf-page-workspace";
import {
  PdfLazyPreviewControls,
  PdfLazyPreviewStatus,
  usePdfLazyPreviews,
} from "../../../components/pdf-lazy-previews";
import { downloadGeneratedFile } from "../../../lib/browser-download";
import { useIncomingPdfHandoff } from "../../../lib/pdf-tool-handoff";
import {
  createFilesZip,
  inspectPdf,
  parsePageSelection,
  type BinaryDownloadFile,
} from "../../../lib/pdf-tools";
import { openPdfLoadingTask } from "../../../lib/pdfjs";
import StitchToolShell from "../../../components/StitchToolShell";
import { trackToolEvent } from "../../../lib/stats";

type SelectedPdf = {
  file: File;
  bytes: ArrayBuffer;
  pageCount: number;
};

type ExportFormat = "png" | "jpg" | "webp";

type Result = {
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
  pageCount: number;
};

type WorkState =
  | { kind: "idle" }
  | { kind: "reading" | "working"; message: string }
  | { kind: "error"; message: string };

const PRESETS = {
  screen: { dpi: 96, quality: 72 },
  balanced: { dpi: 144, quality: 82 },
  print: { dpi: 216, quality: 90 },
} as const;

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 1 : 2)} MB`;
}

function safeBaseName(fileName: string) {
  return fileName.replace(/\.pdf$/i, "").replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "") || "document";
}

function imagesDownloadBase(name: string, fallback: string) {
  const trimmed = name.trim() || fallback;
  const base = trimmed.replace(/\.(pdf|zip|png|jpe?g|webp)$/i, "").replace(/[^\p{L}\p{N}._ -]+/gu, "-").replace(/-+/g, "-").replace(/^[\s.-]+|[\s.-]+$/g, "");
  return base || "pages";
}

function canvasToBlob(canvas: HTMLCanvasElement, format: ExportFormat, quality: number) {
  const mimeType = format === "jpg" ? "image/jpeg" : `image/${format}`;
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error(`This browser could not create a ${format.toUpperCase()} image.`));
        return;
      }
      if (format === "webp" && blob.type !== "image/webp") {
        reject(new Error("WebP export is not supported in this browser."));
        return;
      }
      resolve(blob);
    }, mimeType, quality);
  });
}

async function renderPdfPagePreview(bytes: ArrayBuffer, pageNumber: number) {
  const task = await openPdfLoadingTask(bytes);
  const document = await task.promise;
  try {
    const page = await document.getPage(pageNumber);
    const original = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(1.2, 660 / original.width) });
    const canvas = window.document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Page previews are not supported in this browser.");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, canvasContext: context, viewport, background: "#fff" }).promise;
    return {
      url: canvas.toDataURL("image/jpeg", 0.8),
      pageWidth: original.width,
      pageHeight: original.height,
      previewWidth: canvas.width,
      previewHeight: canvas.height,
    };
  } finally {
    await task.destroy();
  }
}

async function exportPdfPages(
  bytes: ArrayBuffer,
  pageIndices: number[],
  format: ExportFormat,
  dpi: number,
  quality: number,
  baseName: string,
  onProgress: (current: number, total: number) => void,
) {
  const task = await openPdfLoadingTask(bytes);
  const document = await task.promise;
  const files: BinaryDownloadFile[] = [];

  try {
    for (let outputIndex = 0; outputIndex < pageIndices.length; outputIndex += 1) {
      onProgress(outputIndex + 1, pageIndices.length);
      const pageNumber = pageIndices[outputIndex] + 1;
      const page = await document.getPage(pageNumber);
      const pageSize = page.getViewport({ scale: 1 });
      const desiredScale = dpi / 72;
      const desiredWidth = pageSize.width * desiredScale;
      const desiredHeight = pageSize.height * desiredScale;
      const safetyScale = Math.min(
        1,
        6000 / desiredWidth,
        6000 / desiredHeight,
        Math.sqrt(24_000_000 / (desiredWidth * desiredHeight)),
      );
      const viewport = page.getViewport({ scale: desiredScale * safetyScale });
      const canvas = window.document.createElement("canvas");
      const context = canvas.getContext("2d", { alpha: format === "png" });
      if (!context) throw new Error("PDF image export is not supported in this browser.");
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));
      if (format !== "png") {
        context.fillStyle = "#fff";
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
      await page.render({ canvas, canvasContext: context, viewport, background: format === "png" ? undefined : "#fff" }).promise;
      const blob = await canvasToBlob(canvas, format, quality);
      files.push({
        name: `${baseName}-p${pageNumber}.${format}`,
        bytes: new Uint8Array(await blob.arrayBuffer()),
      });
      canvas.width = 1;
      canvas.height = 1;
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }

  return files;
}

export default function PdfToImagesPage() {
  const [selected, setSelected] = useState<SelectedPdf | null>(null);
  const { pages: visualPages, setPages: setVisualPages, previewState, previewProgress, loadPreviews, hidePreviews, resetPreviews } = usePdfLazyPreviews("images");
  const [applyTo, setApplyTo] = useState<"all" | "range">("all");
  const [range, setRange] = useState("");
  const [format, setFormat] = useState<ExportFormat>("jpg");
  const [dpi, setDpi] = useState(144);
  const [quality, setQuality] = useState(82);
  const [previewPage, setPreviewPage] = useState(1);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof renderPdfPagePreview>> | null>(null);
  const [outputName, setOutputName] = useState("pages");
  const [savedNotice, setSavedNotice] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [work, setWork] = useState<WorkState>({ kind: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = work.kind === "reading" || work.kind === "working";
  useIncomingPdfHandoff(chooseFile);

  const selection = useMemo(() => {
    if (!selected) return { pages: [] as number[], error: "" };
    if (applyTo === "all") return { pages: Array.from({ length: selected.pageCount }, (_, index) => index), error: "" };
    try {
      return { pages: parsePageSelection(range, selected.pageCount), error: "" };
    } catch (error) {
      return { pages: [] as number[], error: error instanceof Error ? error.message : "Invalid page range." };
    }
  }, [applyTo, range, selected]);
  const orderedSelection = visualPages.length
    ? visualPages.filter((page) => selection.pages.includes(page.pageIndex)).map((page) => page.pageIndex)
    : selection.pages;

  async function chooseFile(file?: File) {
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setWork({ kind: "error", message: "Choose a PDF file." });
      return;
    }
    setWork({ kind: "reading", message: "Reading the PDF and creating a local preview…" });
    resetPreviews();
    try {
      const bytes = await file.arrayBuffer();
      const { pageCount } = await inspectPdf(bytes);
      setSelected({ file, bytes, pageCount });
      setRange(`1-${pageCount}`);
      setPreviewPage(1);
      setPreview(await renderPdfPagePreview(bytes, 1));
      setOutputName(safeBaseName(file.name));
      setSavedNotice("");
      setResult(null);
      setWork({ kind: "idle" });
    } catch (error) {
      const message = error instanceof Error && /encrypted/i.test(error.message)
        ? `${file.name} is password-protected. Remove its password before converting pages.`
        : `${file.name} could not be read as a valid PDF.`;
      setWork({ kind: "error", message });
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  async function changePreviewPage(pageNumber: number) {
    if (!selected || pageNumber === previewPage) return;
    setPreviewPage(pageNumber);
    setWork({ kind: "reading", message: `Rendering page ${pageNumber} locally…` });
    try {
      setPreview(await renderPdfPagePreview(selected.bytes, pageNumber));
      setWork({ kind: "idle" });
    } catch (error) {
      setWork({ kind: "error", message: error instanceof Error ? error.message : "The preview could not be rendered." });
    }
  }

  function setPreset(preset: keyof typeof PRESETS) {
    setDpi(PRESETS[preset].dpi);
    setQuality(PRESETS[preset].quality);
    setResult(null);
  }

  async function convertPages(pageIndices = orderedSelection) {
    if (!selected || !pageIndices.length || selection.error) return;
    setResult(null);
    setWork({ kind: "working", message: "Preparing PDF pages on this device…" });
    trackToolEvent("pdf-to-images", "start");
    try {
      const baseName = imagesDownloadBase(outputName, safeBaseName(selected.file.name));
      const files = await exportPdfPages(
        selected.bytes,
        pageIndices,
        format,
        dpi,
        quality / 100,
        baseName,
        (current, total) => setWork({ kind: "working", message: `Converting page ${current} of ${total} on this device…` }),
      );
      const output = files.length === 1
        ? {
            bytes: files[0].bytes,
            fileName: files[0].name,
            mimeType: format === "jpg" ? "image/jpeg" : `image/${format}`,
            pageCount: 1,
          }
        : {
            bytes: createFilesZip(files),
            fileName: `${baseName}-${format}.zip`,
            mimeType: "application/zip",
            pageCount: files.length,
          };
      downloadGeneratedFile(output.bytes as BlobPart, output.fileName);
      setResult(output);
      setSavedNotice("Saved. The original PDF is still here — change format or pages and export again.");
      trackToolEvent("pdf-to-images", "success");
      setWork({ kind: "idle" });
    } catch (error) {
      trackToolEvent("pdf-to-images", "error");
      setWork({ kind: "error", message: error instanceof Error ? error.message : "The PDF pages could not be converted." });
    }
  }

  const estimatedWidth = preview ? Math.round(preview.pageWidth * dpi / 72) : 0;
  const estimatedHeight = preview ? Math.round(preview.pageHeight * dpi / 72) : 0;

  return (
    <StitchToolShell
      title="PDF to Images"
      subtitle="Export PDF pages as PNG, JPG, or WebP images."
      className={`pdf-images-page${selected ? " has-file" : ""}`}
    >
      <section className="pdf-images-workspace" aria-labelledby="pdf-images-title">
        <div className="merge-workspace-heading">
          <div>
            <h2 id="pdf-images-title">Source PDF</h2>
            <p>{selected ? `${selected.file.name} · ${selected.pageCount} pages · ${formatBytes(selected.file.size)}` : "Choose one PDF file"}</p>
          </div>
          {selected ? (
            <div className="organise-heading-actions">
              <PdfLazyPreviewControls
                previewState={previewState}
                onShow={() => { if (selected) void loadPreviews(selected.bytes).catch(() => setWork({ kind: "error", message: "Page previews could not be created for this PDF." })); }}
                onHide={hidePreviews}
                disabled={busy}
              />
              <button className="text-button" type="button" onClick={() => { resetPreviews(); setSelected(null); setPreview(null); setResult(null); setSavedNotice(""); setWork({ kind: "idle" }); }} disabled={busy}>Remove file</button>
            </div>
          ) : null}
        </div>

        {!selected ? (
          <label className={`pdf-drop-zone${busy ? " disabled" : ""}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (!busy) void chooseFile(event.dataTransfer.files[0]); }}>
            <input ref={inputRef} type="file" accept=".pdf,application/pdf" disabled={busy} onChange={(event) => void chooseFile(event.target.files?.[0])} />
            <span className="drop-zone-mark" aria-hidden="true">＋</span>
            <strong>Choose a PDF file</strong>
            <span>or drag and drop it here</span>
          </label>
        ) : (
          <>
            <PdfLazyPreviewStatus previewState={previewState} previewProgress={previewProgress} />
            {previewState === "ready" ? (
            <PdfPageWorkspace
              pages={visualPages}
              selectedIds={visualPages.filter((page) => selection.pages.includes(page.pageIndex)).map((page) => page.id)}
              onSelectedIdsChange={(ids) => {
                const idSet = new Set(ids);
                const pageNumbers = visualPages.filter((page) => idSet.has(page.id)).map((page) => page.pageIndex + 1);
                setApplyTo("range");
                setRange(pageNumbers.join(", "));
                setResult(null);
                if (pageNumbers[0]) void changePreviewPage(pageNumbers[0]);
              }}
              onReorder={(orderedIds) => {
                setVisualPages(orderedIds.map((id) => visualPages.find((page) => page.id === id)!).filter(Boolean));
                setResult(null);
              }}
              disabled={busy}
              title="Select, preview, and order pages for image export"
            />
            ) : null}
            <div className="pdf-images-content">
            <aside className="pdf-images-settings">
              <p className="pdf-tool-status">EXPORT SETTINGS</p>
              <div className="watermark-form-row">
                <label><span>Pages</span><select value={applyTo} onChange={(event) => { setApplyTo(event.target.value as "all" | "range"); setResult(null); }} disabled={busy}><option value="all">All pages</option><option value="range">Page range</option></select></label>
                <label><span>Format</span><select value={format} onChange={(event) => { setFormat(event.target.value as ExportFormat); setResult(null); }} disabled={busy}><option value="jpg">JPG</option><option value="png">PNG</option><option value="webp">WebP</option></select></label>
              </div>
              {applyTo === "range" ? <label><span>Page range</span><input value={range} onChange={(event) => { setRange(event.target.value); setResult(null); }} placeholder="1-3, 6, 9-12" aria-invalid={Boolean(selection.error)} disabled={busy} /><small>{selection.error || `${selection.pages.length} pages selected`}</small></label> : null}

              <div className="pdf-image-presets">
                <button type="button" className={dpi === 96 && quality === 72 ? "active" : ""} onClick={() => setPreset("screen")} disabled={busy}><strong>Screen</strong><span>96 DPI</span></button>
                <button type="button" className={dpi === 144 && quality === 82 ? "active" : ""} onClick={() => setPreset("balanced")} disabled={busy}><strong>Balanced</strong><span>144 DPI</span></button>
                <button type="button" className={dpi === 216 && quality === 90 ? "active" : ""} onClick={() => setPreset("print")} disabled={busy}><strong>Print</strong><span>216 DPI</span></button>
              </div>
              <label className="watermark-slider"><span>Resolution <b>{dpi} DPI</b></span><input type="range" min="72" max="300" step="12" value={dpi} onChange={(event) => { setDpi(Number(event.target.value)); setResult(null); }} disabled={busy} /></label>
              {format !== "png" ? <label className="watermark-slider"><span>{format.toUpperCase()} quality <b>{quality}%</b></span><input type="range" min="35" max="95" step="1" value={quality} onChange={(event) => { setQuality(Number(event.target.value)); setResult(null); }} disabled={busy} /></label> : <p className="pdf-images-format-note">PNG uses lossless image output, so no quality setting is needed.</p>}
              <div className="pdf-images-summary"><strong>{orderedSelection.length} {orderedSelection.length === 1 ? "image" : "images"}</strong><span>{orderedSelection.length === 1 ? "Direct image download" : "Numbered images inside one ZIP"}</span></div>
              <label className="merge-output-name">
                <span>File name</span>
                <input
                  type="text"
                  value={outputName}
                  spellCheck={false}
                  autoComplete="off"
                  disabled={busy}
                  aria-label="Image or ZIP file name"
                  onChange={(event) => setOutputName(event.target.value)}
                  onBlur={() => setOutputName(imagesDownloadBase(outputName, safeBaseName(selected.file.name)))}
                />
              </label>
              <button className="merge-button" type="button" onClick={() => void convertPages()} disabled={busy || !orderedSelection.length || Boolean(selection.error)}>
                {work.kind === "working" ? "Converting…" : orderedSelection.length === 1 ? `Download page as ${format.toUpperCase()}` : `Download ${orderedSelection.length} ${format.toUpperCase()} images`}
              </button>
              {savedNotice ? <p className="page-numbers-saved" role="status">{savedNotice}</p> : null}
            </aside>

            <section className="pdf-images-preview" aria-label="PDF page preview">
              <div className="watermark-preview-heading">
                <strong>Preview</strong>
                <label>Page <select value={previewPage} onChange={(event) => void changePreviewPage(Number(event.target.value))} disabled={busy}>{Array.from({ length: selected.pageCount }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select></label>
                <button
                  className="text-button"
                  type="button"
                  disabled={busy}
                  onClick={() => void convertPages([previewPage - 1])}
                >
                  Download this page
                </button>
              </div>
              <div className="pdf-images-preview-stage">
                {preview ? (
                  <div className="pdf-images-preview-page" style={{ aspectRatio: `${preview.previewWidth} / ${preview.previewHeight}` }}>
                    {/* PDF preview is generated locally. */}
                    <img src={preview.url} alt={`Preview of PDF page ${previewPage}`} />
                  </div>
                ) : null}
              </div>
              <div className="pdf-images-dimensions"><span>Estimated output for this page</span><strong>{estimatedWidth.toLocaleString()} × {estimatedHeight.toLocaleString()} px</strong><small>Very large pages are automatically capped to protect browser memory.</small></div>
            </section>
            </div>
          </>
        )}

        {result ? (
          <section className="pdf-images-result" aria-live="polite">
            <div><span>Ready to download</span><strong>{result.pageCount === 1 ? result.fileName : `${result.pageCount} images in a ZIP`}</strong><small>{formatBytes(result.bytes.length)}</small></div>
            <button className="merge-button" type="button" onClick={() => downloadGeneratedFile(result.bytes as BlobPart, result.fileName)}>{result.pageCount === 1 ? "Download image" : "Download ZIP"}</button>
          </section>
        ) : null}
        {work.kind !== "idle" ? <p className={`pdf-work-message ${work.kind}`} role={work.kind === "error" ? "alert" : "status"}>{work.message}</p> : null}
      </section>
    </StitchToolShell>
  );
}
