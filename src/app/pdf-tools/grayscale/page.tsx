"use client";

import { useRef, useState } from "react";
import PdfPageWorkspace from "../../../components/pdf-page-workspace";
import {
  PdfLazyPreviewControls,
  PdfLazyPreviewStatus,
  usePdfLazyPreviews,
} from "../../../components/pdf-lazy-previews";
import PdfNextStepSelector from "../../../components/pdf-next-step-selector";
import { downloadGeneratedFile } from "../../../lib/browser-download";
import { useIncomingPdfHandoff } from "../../../lib/pdf-tool-handoff";
import { inspectPdf, rasterizedPagesToPdf, type RasterizedPdfPage } from "../../../lib/pdf-tools";
import StitchToolShell from "../../../components/StitchToolShell";
import { trackToolEvent } from "../../../lib/stats";

type SelectedPdf = { file: File; bytes: ArrayBuffer; pageCount: number };
type WorkState = { kind: "idle" } | { kind: "reading" | "working" | "error"; message: string };

function safeBaseName(name: string) {
  return name.replace(/\.pdf$/i, "").replace(/[^\p{L}\p{N}._-]+/gu, "-") || "document";
}

function grayscaleDownloadName(name: string, fallback: string) {
  const trimmed = name.trim() || fallback;
  const base = trimmed.replace(/\.pdf$/i, "").replace(/[^\p{L}\p{N}._ -]+/gu, "-").replace(/-+/g, "-").replace(/^[\s.-]+|[\s.-]+$/g, "");
  return `${base || "grayscale"}.pdf`;
}

function formatBytes(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function applyGrayscale(context: CanvasRenderingContext2D, width: number, height: number) {
  const pixels = context.getImageData(0, 0, width, height);
  for (let offset = 0; offset < pixels.data.length; offset += 4) {
    const gray = Math.round(pixels.data[offset] * 0.299 + pixels.data[offset + 1] * 0.587 + pixels.data[offset + 2] * 0.114);
    pixels.data[offset] = gray;
    pixels.data[offset + 1] = gray;
    pixels.data[offset + 2] = gray;
  }
  context.putImageData(pixels, 0, 0);
}

async function canvasToJpeg(canvas: HTMLCanvasElement, quality: number) {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob) throw new Error("A grayscale page could not be encoded.");
  return new Uint8Array(await blob.arrayBuffer());
}

async function renderGrayPreview(bytes: ArrayBuffer, pageNumber: number) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const task = pdfjs.getDocument({ data: Uint8Array.from(new Uint8Array(bytes)) });
  const document = await task.promise;
  try {
    const page = await document.getPage(pageNumber);
    const original = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(1.2, 660 / original.width) });
    const canvas = window.document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
    if (!context) throw new Error("Page previews are not supported in this browser.");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, canvasContext: context, viewport, background: "#ffffff" }).promise;
    applyGrayscale(context, canvas.width, canvas.height);
    return { url: canvas.toDataURL("image/jpeg", 0.82), width: canvas.width, height: canvas.height };
  } finally {
    await task.destroy();
  }
}

export default function GrayscalePdfPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<SelectedPdf | null>(null);
  const { pages: visualPages, previewState, previewProgress, loadPreviews, hidePreviews, resetPreviews } = usePdfLazyPreviews("grayscale");
  const [dpi, setDpi] = useState(144);
  const [quality, setQuality] = useState(86);
  const [previewPage, setPreviewPage] = useState(1);
  const [preview, setPreview] = useState<{ url: string; width: number; height: number } | null>(null);
  const [outputName, setOutputName] = useState("grayscale.pdf");
  const [savedNotice, setSavedNotice] = useState("");
  const [work, setWork] = useState<WorkState>({ kind: "idle" });
  const busy = work.kind === "reading" || work.kind === "working";
  useIncomingPdfHandoff(chooseFile);

  async function chooseFile(file?: File) {
    if (!file) return;
    setWork({ kind: "reading", message: "Reading the PDF locally…" });
    resetPreviews();
    try {
      const bytes = await file.arrayBuffer();
      const { pageCount } = await inspectPdf(bytes);
      setSelected({ file, bytes, pageCount });
      setPreviewPage(1);
      setOutputName(`${safeBaseName(file.name)}-grayscale.pdf`);
      setSavedNotice("");
      setPreview(await renderGrayPreview(bytes, 1));
      setWork({ kind: "idle" });
    } catch {
      resetPreviews();
      setSelected(null);
      setWork({ kind: "error", message: "Choose a valid, unlocked PDF file." });
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  async function changePreviewPage(pageNumber: number) {
    if (!selected || pageNumber === previewPage) return;
    setPreviewPage(pageNumber);
    setWork({ kind: "reading", message: `Rendering page ${pageNumber} in grayscale…` });
    try {
      setPreview(await renderGrayPreview(selected.bytes, pageNumber));
      setWork({ kind: "idle" });
    } catch (error) {
      setWork({ kind: "error", message: error instanceof Error ? error.message : "The grayscale preview could not be rendered." });
    }
  }

  async function convert() {
    if (!selected) return;
    setWork({ kind: "working", message: `Converting ${selected.pageCount} pages to grayscale locally…` });
    trackToolEvent("grayscale", "start");
    try {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      const task = pdfjs.getDocument({ data: Uint8Array.from(new Uint8Array(selected.bytes)) });
      const pdf = await task.promise;
      const pages: RasterizedPdfPage[] = [];
      try {
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          setWork({ kind: "working", message: `Converting page ${pageNumber} of ${pdf.numPages} locally…` });
          const page = await pdf.getPage(pageNumber);
          const original = page.getViewport({ scale: 1 });
          let scale = dpi / 72;
          const maxScale = Math.min(6000 / original.width, 6000 / original.height, Math.sqrt(24_000_000 / (original.width * original.height)));
          scale = Math.min(scale, maxScale);
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
          if (!context) throw new Error("Canvas processing is not supported in this browser.");
          await page.render({ canvas, canvasContext: context, viewport, background: "#ffffff" }).promise;
          applyGrayscale(context, canvas.width, canvas.height);
          pages.push({ bytes: await canvasToJpeg(canvas, quality / 100), width: original.width, height: original.height });
          canvas.width = 1;
          canvas.height = 1;
        }
      } finally {
        await task.destroy();
      }
      const output = await rasterizedPagesToPdf(pages);
      downloadGeneratedFile(
        output as BlobPart,
        grayscaleDownloadName(outputName, `${safeBaseName(selected.file.name)}-grayscale.pdf`),
      );
      setSavedNotice("Saved. The original colour PDF is still here.");
      trackToolEvent("grayscale", "success");
      setWork({ kind: "idle" });
    } catch (error) {
      trackToolEvent("grayscale", "error");
      setWork({ kind: "error", message: error instanceof Error ? error.message : "The PDF could not be converted." });
    }
  }

  return (
    <StitchToolShell
      title="Grayscale PDF"
      subtitle="Convert every page to neutral grayscale."
      className={`utility-pdf-page${selected ? " has-file" : ""}`}
      note="For text-based PDFs, keep the original as an accessible copy."
    >
      <section className="merge-workspace utility-workspace">
        <div className="merge-workspace-heading"><div><h2>Source PDF</h2><p>{selected ? `${selected.pageCount} pages · ${formatBytes(selected.file.size)}` : "Choose one PDF file"}</p></div>{selected ? <div className="organise-heading-actions"><PdfLazyPreviewControls previewState={previewState} onShow={() => { if (selected) void loadPreviews(selected.bytes).catch(() => setWork({ kind: "error", message: "Page previews could not be created for this PDF." })); }} onHide={hidePreviews} disabled={busy} /><button className="text-button" type="button" onClick={() => { resetPreviews(); setSelected(null); setPreview(null); setSavedNotice(""); }}>Remove file</button></div> : null}</div>
        {!selected ? (
          <label className="pdf-drop-zone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void chooseFile(event.dataTransfer.files[0]); }}>
            <input ref={inputRef} type="file" accept=".pdf,application/pdf" onChange={(event) => void chooseFile(event.target.files?.[0])} /><span className="drop-zone-mark" aria-hidden="true">＋</span><strong>Choose a PDF file</strong><span>or drag and drop it here</span>
          </label>
        ) : (
          <div className="utility-controls">
            <PdfLazyPreviewStatus previewState={previewState} previewProgress={previewProgress} />
            {previewState === "ready" ? <PdfPageWorkspace pages={visualPages} disabled={busy} title="Preview pages before grayscale conversion" /> : null}
            <div className="compression-presets">
              <button type="button" className={dpi === 96 ? "active" : ""} onClick={() => { setDpi(96); setQuality(76); }}><strong>Compact</strong><span>96 DPI · smaller file</span></button>
              <button type="button" className={dpi === 144 ? "active" : ""} onClick={() => { setDpi(144); setQuality(86); }}><strong>Balanced</strong><span>144 DPI · recommended</span></button>
              <button type="button" className={dpi === 216 ? "active" : ""} onClick={() => { setDpi(216); setQuality(92); }}><strong>Print</strong><span>216 DPI · clearer output</span></button>
            </div>
            <div className="utility-form-grid">
              <label className="utility-field"><span>Resolution: {dpi} DPI</span><input type="range" min="72" max="240" step="12" value={dpi} onChange={(event) => setDpi(Number(event.target.value))} /></label>
              <label className="utility-field"><span>Image quality: {quality}%</span><input type="range" min="55" max="96" value={quality} onChange={(event) => setQuality(Number(event.target.value))} /></label>
            </div>
            <p className="utility-callout">This tool rasterises pages. Selectable text, links, forms, and existing digital signatures will not remain interactive.</p>
            <section className="pdf-images-preview" aria-label="Grayscale page preview">
              <div className="watermark-preview-heading">
                <strong>Grey preview</strong>
                <label>Page <select value={previewPage} onChange={(event) => void changePreviewPage(Number(event.target.value))} disabled={busy}>{Array.from({ length: selected.pageCount }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select></label>
              </div>
              <div className="pdf-images-preview-stage">
                {preview ? (
                  <div className="pdf-images-preview-page" style={{ aspectRatio: `${preview.width} / ${preview.height}` }}>
                    <img src={preview.url} alt={`Grayscale preview of page ${previewPage}`} />
                  </div>
                ) : null}
              </div>
            </section>
            <div className="utility-action-row">
              <label className="merge-output-name">
                <span>File name</span>
                <input
                  type="text"
                  value={outputName}
                  spellCheck={false}
                  autoComplete="off"
                  disabled={busy}
                  aria-label="Grayscale PDF file name"
                  onChange={(event) => setOutputName(event.target.value)}
                  onBlur={() => setOutputName(grayscaleDownloadName(outputName, `${safeBaseName(selected.file.name)}-grayscale.pdf`))}
                />
              </label>
              <span>The colour original stays here.</span>
              <PdfNextStepSelector />
              <button className="merge-button" type="button" disabled={busy} onClick={() => void convert()}>{work.kind === "working" ? "Converting…" : `Convert ${selected.pageCount} ${selected.pageCount === 1 ? "page" : "pages"}`}</button>
            </div>
            {savedNotice ? <p className="page-numbers-saved" role="status">{savedNotice}</p> : null}
          </div>
        )}
        {work.kind !== "idle" ? <p className={`pdf-work-message ${work.kind}`} role={work.kind === "error" ? "alert" : "status"}>{work.message}</p> : null}
      </section>
    </StitchToolShell>
  );
}
