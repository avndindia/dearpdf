"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import PdfPageWorkspace from "../../../components/pdf-page-workspace";
import {
  PdfLazyPreviewControls,
  PdfLazyPreviewStatus,
  usePdfLazyPreviews,
} from "../../../components/pdf-lazy-previews";
import PdfNextStepSelector from "../../../components/pdf-next-step-selector";
import { downloadGeneratedFile } from "../../../lib/browser-download";
import { useIncomingPdfHandoff } from "../../../lib/pdf-tool-handoff";
import {
  inspectPdf,
  parsePageSelection,
  formatPageSelection,
  watermarkPdf,
  watermarkPreviewFontSizePx,
  watermarkPreviewInsetPercent,
  type WatermarkPosition,
} from "../../../lib/pdf-tools";
import StitchToolShell from "../../../components/StitchToolShell";

type SelectedPdf = {
  file: File;
  bytes: ArrayBuffer;
  pageCount: number;
};

type WatermarkImage = {
  bytes: Uint8Array;
  mimeType: "image/jpeg" | "image/png";
  width: number;
  height: number;
  preview: string;
  name: string;
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
  return fileName.replace(/\.pdf$/i, "").replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "") || "document";
}

function watermarkDownloadName(name: string, fallback: string) {
  const trimmed = name.trim() || fallback;
  const base = trimmed.replace(/\.pdf$/i, "").replace(/[^\p{L}\p{N}._ -]+/gu, "-").replace(/-+/g, "-").replace(/^[\s.-]+|[\s.-]+$/g, "");
  return `${base || "watermarked"}.pdf`;
}

function downloadPdf(bytes: Uint8Array, fileName: string) {
  downloadGeneratedFile(bytes as BlobPart, fileName);
}

type PreviewRender = {
  url: string;
  width: number;
  height: number;
  pageWidthPt: number;
  pageHeightPt: number;
};

async function renderPdfPage(bytes: ArrayBuffer, pageNumber: number): Promise<PreviewRender> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const task = pdfjs.getDocument({ data: Uint8Array.from(new Uint8Array(bytes)) });
  const document = await task.promise;
  try {
    const page = await document.getPage(pageNumber);
    const original = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(1.5, 720 / original.width) });
    const canvas = window.document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("PDF previews are not supported in this browser.");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    return {
      url: canvas.toDataURL("image/jpeg", 0.82),
      width: canvas.width,
      height: canvas.height,
      pageWidthPt: original.width,
      pageHeightPt: original.height,
    };
  } finally {
    await task.destroy();
  }
}

async function prepareWatermarkImage(file: File): Promise<WatermarkImage> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("Choose a JPG, PNG, or WebP watermark image.");
  }
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image conversion is not supported in this browser.");
    context.drawImage(bitmap, 0, 0);
    let bytes: Uint8Array;
    let mimeType: WatermarkImage["mimeType"];
    if (file.type === "image/webp") {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("The WebP image could not be converted.");
      bytes = new Uint8Array(await blob.arrayBuffer());
      mimeType = "image/png";
    } else {
      bytes = new Uint8Array(await file.arrayBuffer());
      mimeType = file.type as WatermarkImage["mimeType"];
    }
    const previewScale = Math.min(1, 320 / Math.max(bitmap.width, bitmap.height));
    const preview = document.createElement("canvas");
    preview.width = Math.max(1, Math.round(bitmap.width * previewScale));
    preview.height = Math.max(1, Math.round(bitmap.height * previewScale));
    preview.getContext("2d")?.drawImage(bitmap, 0, 0, preview.width, preview.height);
    return { bytes, mimeType, width: bitmap.width, height: bitmap.height, preview: preview.toDataURL("image/png"), name: file.name };
  } finally {
    bitmap.close();
  }
}

function positionStyle(
  position: Exclude<WatermarkPosition, "tile">,
  pageWidthPt: number,
  pageHeightPt: number,
) {
  const insetX = `${watermarkPreviewInsetPercent(pageWidthPt)}%`;
  const insetY = `${watermarkPreviewInsetPercent(pageHeightPt)}%`;
  if (position === "top-left") return { top: insetY, left: insetX };
  if (position === "top-right") return { top: insetY, right: insetX };
  if (position === "bottom-left") return { bottom: insetY, left: insetX };
  if (position === "bottom-right") return { bottom: insetY, right: insetX };
  return { top: "50%", left: "50%", translate: "-50% -50%" };
}

export default function WatermarkPdfPage() {
  const [selected, setSelected] = useState<SelectedPdf | null>(null);
  const { pages: visualPages, previewState, previewProgress, loadPreviews, hidePreviews, resetPreviews } = usePdfLazyPreviews("watermark");
  const [previewPage, setPreviewPage] = useState(1);
  const [preview, setPreview] = useState<PreviewRender | null>(null);
  const [previewWidthPx, setPreviewWidthPx] = useState(0);
  const [kind, setKind] = useState<"text" | "image">("text");
  const [text, setText] = useState("CONFIDENTIAL");
  const [watermarkImage, setWatermarkImage] = useState<WatermarkImage | null>(null);
  const [applyTo, setApplyTo] = useState<"all" | "range">("all");
  const [range, setRange] = useState("");
  const [position, setPosition] = useState<WatermarkPosition>("center");
  const [opacity, setOpacity] = useState(25);
  const [textSize, setTextSize] = useState(48);
  const [imageSize, setImageSize] = useState(35);
  const [rotation, setRotation] = useState(-30);
  const [color, setColor] = useState("#b00000");
  const [outputName, setOutputName] = useState("watermarked.pdf");
  const [savedNotice, setSavedNotice] = useState("");
  const [work, setWork] = useState<WorkState>({ kind: "idle" });
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const previewPageRef = useRef<HTMLDivElement>(null);
  const busy = work.kind === "reading" || work.kind === "working";
  useIncomingPdfHandoff(choosePdf);

  useEffect(() => {
    const node = previewPageRef.current;
    if (!node) {
      setPreviewWidthPx(0);
      return;
    }
    const update = () => setPreviewWidthPx(node.getBoundingClientRect().width);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [preview?.url]);

  const pageSelection = useMemo(() => {
    if (!selected) return { pages: [] as number[], error: "" };
    if (applyTo === "all") return { pages: Array.from({ length: selected.pageCount }, (_, index) => index), error: "" };
    try {
      return { pages: parsePageSelection(range, selected.pageCount), error: "" };
    } catch (error) {
      return { pages: [] as number[], error: error instanceof Error ? error.message : "Invalid page range." };
    }
  }, [applyTo, range, selected]);

  function toggleWatermarkPage(pageNumber: number) {
    if (!selected) return;
    const current = applyTo === "all"
      ? Array.from({ length: selected.pageCount }, (_, index) => index)
      : pageSelection.pages;
    const exists = current.includes(pageNumber - 1);
    const next = exists
      ? current.filter((index) => index !== pageNumber - 1)
      : [...current, pageNumber - 1].sort((a, b) => a - b);
    setApplyTo("range");
    setRange(formatPageSelection(next));
    void changePreviewPage(pageNumber);
  }

  async function choosePdf(file?: File) {
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
      const firstPreview = await renderPdfPage(bytes, 1);
      setSelected({ file, bytes, pageCount });
      setPreviewPage(1);
      setPreview(firstPreview);
      setRange(`1-${pageCount}`);
      setOutputName(`${safeBaseName(file.name)}-watermarked.pdf`);
      setSavedNotice("");
      setWork({ kind: "idle" });
    } catch (error) {
      const message = error instanceof Error && /encrypted/i.test(error.message)
        ? `${file.name} is password-protected. Remove its password before adding a watermark.`
        : `${file.name} could not be read as a valid PDF.`;
      setWork({ kind: "error", message });
    }
    if (pdfInputRef.current) pdfInputRef.current.value = "";
  }

  async function changePreviewPage(pageNumber: number) {
    if (!selected || pageNumber === previewPage) return;
    setPreviewPage(pageNumber);
    setWork({ kind: "reading", message: `Rendering page ${pageNumber} locally…` });
    try {
      setPreview(await renderPdfPage(selected.bytes, pageNumber));
      setWork({ kind: "idle" });
    } catch (error) {
      setWork({ kind: "error", message: error instanceof Error ? error.message : "The preview could not be rendered." });
    }
  }

  async function chooseWatermarkImage(file?: File) {
    if (!file) return;
    setWork({ kind: "reading", message: "Preparing the watermark image locally…" });
    try {
      setWatermarkImage(await prepareWatermarkImage(file));
      setWork({ kind: "idle" });
    } catch (error) {
      setWork({ kind: "error", message: error instanceof Error ? error.message : "The watermark image could not be read." });
    }
    if (imageInputRef.current) imageInputRef.current.value = "";
  }

  async function createWatermarkedPdf() {
    if (!selected || !pageSelection.pages.length || pageSelection.error) return;
    setWork({ kind: "working", message: "Adding the watermark on this device…" });
    try {
      const watermark = kind === "text"
        ? { kind: "text" as const, text, color, size: textSize }
        : watermarkImage
          ? {
              kind: "image" as const,
              bytes: watermarkImage.bytes,
              mimeType: watermarkImage.mimeType,
              width: watermarkImage.width,
              height: watermarkImage.height,
              size: imageSize,
            }
          : null;
      if (!watermark) throw new Error("Choose a watermark image.");
      const output = await watermarkPdf(selected.bytes, watermark, {
        pageIndices: pageSelection.pages,
        position,
        opacity: opacity / 100,
        rotation,
      });
      downloadPdf(output, watermarkDownloadName(outputName, `${safeBaseName(selected.file.name)}-watermarked.pdf`));
      setSavedNotice("Saved. The original PDF is still here — change the stamp and apply again if you need to.");
      setWork({ kind: "idle" });
    } catch (error) {
      setWork({ kind: "error", message: error instanceof Error ? error.message : "The watermark could not be added." });
    }
  }

  const previewContent = kind === "text" ? text : watermarkImage?.preview;
  const canDownload = Boolean(
    selected &&
    pageSelection.pages.length &&
    !pageSelection.error &&
    (kind === "text" ? text.trim() : watermarkImage),
  );
  const pageDisplayWidthPx = preview
    ? (previewWidthPx > 0 ? previewWidthPx : Math.min(580, preview.width))
    : 0;
  const previewFontSizePx = preview
    ? watermarkPreviewFontSizePx(textSize, pageDisplayWidthPx, preview.pageWidthPt)
    : textSize;
  const previewImageWidthPx = pageDisplayWidthPx * imageSize / 100;
  const placedPositionStyle = preview && position !== "tile"
    ? positionStyle(position, preview.pageWidthPt, preview.pageHeightPt)
    : null;

  return (
    <StitchToolShell
      title="Watermark PDF"
      subtitle="Add text or an image to selected PDF pages."
      className={`watermark-page${selected ? " has-file" : ""}`}
    >
      <section className="watermark-workspace" aria-labelledby="watermark-workspace-title">
        <div className="merge-workspace-heading">
          <div>
            <h2 id="watermark-workspace-title">Source PDF</h2>
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
              <button className="text-button" type="button" onClick={() => { resetPreviews(); setSelected(null); setPreview(null); setSavedNotice(""); setWork({ kind: "idle" }); }} disabled={busy}>Remove file</button>
            </div>
          ) : null}
        </div>

        {!selected ? (
          <label className={`pdf-drop-zone${busy ? " disabled" : ""}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (!busy) void choosePdf(event.dataTransfer.files[0]); }}>
            <input ref={pdfInputRef} type="file" accept=".pdf,application/pdf" disabled={busy} onChange={(event) => void choosePdf(event.target.files?.[0])} />
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
              selectedIds={visualPages.filter((page) => pageSelection.pages.includes(page.pageIndex)).map((page) => page.id)}
              onSelectedIdsChange={(ids) => {
                const idSet = new Set(ids);
                const selectedPageNumbers = visualPages.filter((page) => idSet.has(page.id)).map((page) => page.pageIndex + 1);
                setApplyTo("range");
                setRange(selectedPageNumbers.join(", "));
                const firstSelected = selectedPageNumbers[0];
                if (firstSelected) void changePreviewPage(firstSelected);
              }}
              disabled={busy}
              title="Select and preview pages to watermark"
            />
            ) : selected.pageCount > 1 ? (
              <div className="split-page-picks" role="group" aria-label="Pages to watermark">
                {Array.from({ length: selected.pageCount }, (_, index) => {
                  const on = pageSelection.pages.includes(index);
                  return (
                    <button
                      key={index}
                      type="button"
                      className={on ? "is-on" : ""}
                      aria-pressed={on}
                      disabled={busy}
                      onClick={() => toggleWatermarkPage(index + 1)}
                    >
                      {index + 1}
                    </button>
                  );
                })}
              </div>
            ) : null}
            <div className="watermark-content">
            <aside className="watermark-settings">
              <div className="watermark-kind-tabs" role="group" aria-label="Watermark type">
                <button type="button" className={kind === "text" ? "active" : ""} onClick={() => setKind("text")}>Text</button>
                <button type="button" className={kind === "image" ? "active" : ""} onClick={() => setKind("image")}>Image</button>
              </div>

              {kind === "text" ? (
                <label><span>Watermark text</span><input value={text} maxLength={80} onChange={(event) => setText(event.target.value)} disabled={busy} /></label>
              ) : (
                <label className="watermark-image-field">
                  <span>Watermark image</span>
                  <input ref={imageInputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void chooseWatermarkImage(event.target.files?.[0])} disabled={busy} />
                  <strong>{watermarkImage?.name ?? "Choose JPG, PNG, or WebP"}</strong>
                </label>
              )}

              <div className="watermark-form-row">
                <label><span>Apply to</span><select value={applyTo} onChange={(event) => setApplyTo(event.target.value as "all" | "range")} disabled={busy}><option value="all">All pages</option><option value="range">Page range</option></select></label>
                <label><span>Position</span><select value={position} onChange={(event) => setPosition(event.target.value as WatermarkPosition)} disabled={busy}><option value="center">Centre</option><option value="top-left">Top left</option><option value="top-right">Top right</option><option value="bottom-left">Bottom left</option><option value="bottom-right">Bottom right</option><option value="tile">Tile across page</option></select></label>
              </div>

              {applyTo === "range" ? (
                <label><span>Pages</span><input value={range} onChange={(event) => setRange(event.target.value)} placeholder="1-3, 6, 9-12" aria-invalid={Boolean(pageSelection.error)} disabled={busy} /><small>{pageSelection.error || `${pageSelection.pages.length} pages selected`}</small></label>
              ) : null}

              <div className="watermark-form-row">
                {kind === "text" ? <label><span>Colour</span><input type="color" value={color} onChange={(event) => setColor(event.target.value)} disabled={busy} /></label> : null}
                <label><span>Rotation</span><select value={rotation} onChange={(event) => setRotation(Number(event.target.value))} disabled={busy}><option value={-45}>−45°</option><option value={-30}>−30°</option><option value={0}>0°</option><option value={30}>30°</option><option value={45}>45°</option></select></label>
              </div>

              <label className="watermark-slider"><span>Opacity <b>{opacity}%</b></span><input type="range" min="5" max="100" step="5" value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} disabled={busy} /></label>
              {kind === "text" ? (
                <label className="watermark-slider"><span>Text size <b>{textSize} pt</b></span><input type="range" min="14" max="96" step="2" value={textSize} onChange={(event) => setTextSize(Number(event.target.value))} disabled={busy} /></label>
              ) : (
                <label className="watermark-slider"><span>Image size <b>{imageSize}%</b></span><input type="range" min="10" max="70" step="5" value={imageSize} onChange={(event) => setImageSize(Number(event.target.value))} disabled={busy} /></label>
              )}

              <PdfNextStepSelector />
              <label className="merge-output-name">
                <span>File name</span>
                <input
                  type="text"
                  value={outputName}
                  spellCheck={false}
                  autoComplete="off"
                  disabled={busy}
                  aria-label="Watermarked PDF file name"
                  onChange={(event) => setOutputName(event.target.value)}
                  onBlur={() => setOutputName(watermarkDownloadName(outputName, `${safeBaseName(selected.file.name)}-watermarked.pdf`))}
                />
              </label>
              <button className="merge-button" type="button" onClick={() => void createWatermarkedPdf()} disabled={busy || !canDownload}>
                {work.kind === "working"
                  ? "Adding watermark…"
                  : `Watermark ${pageSelection.pages.length} ${pageSelection.pages.length === 1 ? "page" : "pages"}`}
              </button>
              {savedNotice ? <p className="page-numbers-saved" role="status">{savedNotice}</p> : null}
            </aside>

            <section className="watermark-preview-panel" aria-label="Watermark preview">
              <div className="watermark-preview-heading">
                <strong>Preview</strong>
                <label>Page <select value={previewPage} onChange={(event) => void changePreviewPage(Number(event.target.value))} disabled={busy}>{Array.from({ length: selected.pageCount }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select></label>
              </div>
              <div className="watermark-preview-stage">
                {preview ? (
                  <div
                    ref={previewPageRef}
                    className="watermark-preview-page"
                    style={{ aspectRatio: `${preview.width} / ${preview.height}` }}
                  >
                    {/* PDF preview is generated locally as a data URL. */}
                    <img className="watermark-preview-document" src={preview.url} alt={`Preview of PDF page ${previewPage}`} />
                    {previewContent ? position === "tile" ? (
                      <div className="watermark-preview-tiles" style={{ opacity: opacity / 100 }}>
                        {Array.from({ length: 12 }, (_, index) => kind === "text"
                          ? <span key={index} style={{ color, transform: `rotate(${rotation}deg)`, fontSize: `${previewFontSizePx}px` }}>{text}</span>
                          : (
                            <span key={index} style={{ transform: `rotate(${rotation}deg)` }}>
                              {/* Preview data is generated locally. */}
                              <img src={watermarkImage!.preview} alt="" style={{ width: `${previewImageWidthPx}px` }} />
                            </span>
                          ))}
                      </div>
                    ) : kind === "text" ? (
                      <span
                        className="watermark-preview-single text"
                        style={{
                          ...placedPositionStyle!,
                          color,
                          opacity: opacity / 100,
                          transform: `rotate(${rotation}deg)`,
                          fontSize: `${previewFontSizePx}px`,
                        }}
                      >
                        {text}
                      </span>
                    ) : (
                      <img
                        className="watermark-preview-single image"
                        src={watermarkImage!.preview}
                        alt=""
                        style={{
                          ...placedPositionStyle!,
                          width: `${imageSize}%`,
                          opacity: opacity / 100,
                          transform: `rotate(${rotation}deg)`,
                        }}
                      />
                    ) : null}
                  </div>
                ) : null}
              </div>
              <p>Preview size and placement follow the PDF page. Large or rotated watermarks may clip at the page edge.</p>
            </section>
            </div>
          </>
        )}

        {work.kind !== "idle" ? <p className={`pdf-work-message ${work.kind}`} role={work.kind === "error" ? "alert" : "status"}>{work.message}</p> : null}
      </section>
    </StitchToolShell>
  );
}
