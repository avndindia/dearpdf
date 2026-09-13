"use client";

import Link from "next/link";
import {
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import PdfPageWorkspace, {
  type PdfVisualPage,
} from "./pdf-page-workspace";
import {
  PdfLazyPreviewControls,
  PdfLazyPreviewStatus,
  usePdfLazyPreviews,
} from "./pdf-lazy-previews";
import PdfNextStepSelector from "./pdf-next-step-selector";
import { downloadGeneratedFile } from "../lib/browser-download";
import { useIncomingPdfHandoff } from "../lib/pdf-tool-handoff";
import {
  addPageNumbersPdf,
  cropPdf,
  flattenPdfForms,
  countPdfFormFields,
  inspectPdf,
  optimisePdfStructure,
  parsePageSelection,
  updatePdfMetadata,
  type PageNumberPosition,
} from "../lib/pdf-tools";

export type SimplePdfToolMode = "page-numbers" | "crop" | "metadata" | "flatten" | "repair";

type SelectedPdf = {
  file: File;
  bytes: ArrayBuffer;
  pageCount: number;
};

type CropMargins = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

type WorkState =
  | { kind: "idle" }
  | { kind: "reading" | "working"; message: string }
  | { kind: "error"; message: string };

const COPY: Record<SimplePdfToolMode, {
  title: string;
  subtitle: string;
  headline: string;
  intro: string;
  action: string;
  suffix: string;
}> = {
  "page-numbers": {
    title: "Add Page Numbers",
    subtitle: "Number selected pages with flexible placement and formatting.",
    headline: "Make every page easy to reference.",
    intro: "Choose pages from visual previews, then set the numbering style, position, colour, and starting number. The original document never leaves this device.",
    action: "Add page numbers",
    suffix: "numbered",
  },
  crop: {
    title: "Crop PDF",
    subtitle: "Trim unwanted space from selected pages.",
    headline: "Keep the page area that matters.",
    intro: "Previews load automatically so you can see the full page, then drag the crop frame. Margins stay in millimetres and the PDF is not rasterised.",
    action: "Crop PDF",
    suffix: "cropped",
  },
  metadata: {
    title: "Edit PDF Metadata",
    subtitle: "Update a document’s title, author, subject, and keywords.",
    headline: "Give the document clean, useful details.",
    intro: "Replace embedded metadata locally. This does not change visible page content or upload the document.",
    action: "Save metadata",
    suffix: "metadata",
  },
  flatten: {
    title: "Flatten PDF Forms",
    subtitle: "Turn completed form fields into fixed page content.",
    headline: "Lock form entries into the pages.",
    intro: "Preview every page before flattening filled values into fixed, non-editable content. Keep the original if you may need to edit fields again.",
    action: "Flatten form",
    suffix: "flattened",
  },
  repair: {
    title: "Repair PDF",
    subtitle: "Rebuild a readable PDF structure locally.",
    headline: "Rewrite the document cleanly.",
    intro: "The tool loads and resaves the PDF with a fresh internal structure. It can help with some malformed files, but cannot recover missing or encrypted content. The original stays here so you can compare page counts.",
    action: "Repair PDF",
    suffix: "repaired",
  },
};

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function safeBaseName(fileName: string) {
  return fileName.replace(/\.pdf$/i, "").replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "") || "document";
}

function simpleDownloadName(name: string, fallback: string) {
  const trimmed = name.trim() || fallback;
  const base = trimmed.replace(/\.pdf$/i, "").replace(/[^\p{L}\p{N}._ -]+/gu, "-").replace(/-+/g, "-").replace(/^[\s.-]+|[\s.-]+$/g, "");
  return `${base || "document"}.pdf`;
}

function downloadPdf(bytes: Uint8Array, fileName: string) {
  downloadGeneratedFile(bytes as BlobPart, fileName);
}

const POINTS_TO_MM = 25.4 / 72;
const MIN_CROP_SIZE_MM = 12.7;

function CropVisualEditor({
  pages,
  selectedIds,
  onSelectedIdsChange,
  margins,
  onMarginsChange,
  disabled,
}: {
  pages: PdfVisualPage[];
  selectedIds: string[];
  onSelectedIdsChange: (ids: string[]) => void;
  margins: CropMargins;
  onMarginsChange: (margins: CropMargins) => void;
  disabled: boolean;
}) {
  const [activeId, setActiveId] = useState(pages[0]?.id ?? "");
  const [dragSide, setDragSide] = useState<keyof CropMargins | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const activePage = pages.find((page) => page.id === activeId) ?? pages[0];

  if (!activePage) return null;

  const pageWidthMm = (activePage.width ?? 612) * POINTS_TO_MM;
  const pageHeightMm = (activePage.height ?? 792) * POINTS_TO_MM;
  const topPercent = Math.min(49, (margins.top / pageHeightMm) * 100);
  const rightPercent = Math.min(49, (margins.right / pageWidthMm) * 100);
  const bottomPercent = Math.min(49, (margins.bottom / pageHeightMm) * 100);
  const leftPercent = Math.min(49, (margins.left / pageWidthMm) * 100);

  function updateMargin(side: keyof CropMargins, value: number) {
    const dimension = side === "left" || side === "right" ? pageWidthMm : pageHeightMm;
    const opposite: keyof CropMargins = side === "left" ? "right" : side === "right" ? "left" : side === "top" ? "bottom" : "top";
    const maximum = Math.max(0, dimension - margins[opposite] - MIN_CROP_SIZE_MM);
    onMarginsChange({ ...margins, [side]: Math.round(Math.max(0, Math.min(maximum, value)) * 10) / 10 });
  }

  function moveCropEdge(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragSide || !previewRef.current) return;
    const rect = previewRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
    const value = dragSide === "left"
      ? (x / rect.width) * pageWidthMm
      : dragSide === "right"
        ? ((rect.width - x) / rect.width) * pageWidthMm
        : dragSide === "top"
          ? (y / rect.height) * pageHeightMm
          : ((rect.height - y) / rect.height) * pageHeightMm;
    updateMargin(dragSide, value);
  }

  function beginDrag(side: keyof CropMargins, event: ReactPointerEvent<HTMLButtonElement>) {
    if (disabled) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragSide(side);
  }

  function adjustWithKeyboard(side: keyof CropMargins, event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft"].includes(event.key)) return;
    event.preventDefault();
    const increase = event.key === "ArrowUp" || event.key === "ArrowRight";
    updateMargin(side, margins[side] + (increase ? 1 : -1));
  }

  function togglePage(id: string) {
    const next = selectedSet.has(id)
      ? selectedIds.filter((selectedId) => selectedId !== id)
      : pages.filter((page) => selectedSet.has(page.id) || page.id === id).map((page) => page.id);
    onSelectedIdsChange(next);
  }

  return (
    <section className="crop-visual-editor" aria-label="Visual crop editor">
      <div className="crop-editor-heading">
        <div><strong>Visual crop editor</strong><span>Drag any edge of the black frame to set the crop area.</span></div>
        <button type="button" onClick={() => onMarginsChange({ top: 0, right: 0, bottom: 0, left: 0 })} disabled={disabled}>Reset crop</button>
      </div>
      <div className="crop-editor-layout">
        <ol className="crop-page-rail" aria-label="PDF pages">
          {pages.map((page, index) => {
            const isActive = page.id === activePage.id;
            const isSelected = selectedSet.has(page.id);
            return (
              <li className={isActive ? "active" : ""} key={page.id}>
                <button className="crop-page-preview" type="button" onClick={() => setActiveId(page.id)} disabled={disabled} aria-label={`Preview page ${index + 1}`}>
                  {/* Generated locally from the selected PDF. */}
                  <img src={page.thumbnail} alt="" />
                </button>
                <button className="crop-page-selection" type="button" onClick={() => togglePage(page.id)} disabled={disabled} aria-pressed={isSelected}>
                  <span aria-hidden="true">{isSelected ? "✓" : ""}</span> Page {index + 1}
                </button>
              </li>
            );
          })}
        </ol>
        <div className="crop-preview-panel">
          <div className="crop-preview-meta"><strong>Page {activePage.pageIndex + 1}</strong><span>{Math.round(pageWidthMm)} × {Math.round(pageHeightMm)} mm · {selectedSet.has(activePage.id) ? "Crop enabled" : "Not selected"}</span></div>
          <div className="crop-preview-stage">
            <div
              className={`crop-preview-page${dragSide ? " dragging" : ""}`}
              ref={previewRef}
              style={{
                aspectRatio: `${activePage.width ?? 612} / ${activePage.height ?? 792}`,
                ["--page-w" as string]: String(activePage.width ?? 612),
                ["--page-h" as string]: String(activePage.height ?? 792),
              }}
              onPointerMove={moveCropEdge}
              onPointerUp={() => setDragSide(null)}
              onPointerCancel={() => setDragSide(null)}
            >
              {/* Generated locally from the selected PDF. */}
              <img src={activePage.thumbnail} alt={`Crop preview of page ${activePage.pageIndex + 1}`} draggable={false} />
              <span className="crop-shade crop-shade-top" style={{ height: `${topPercent}%` }} />
              <span className="crop-shade crop-shade-right" style={{ top: `${topPercent}%`, bottom: `${bottomPercent}%`, width: `${rightPercent}%` }} />
              <span className="crop-shade crop-shade-bottom" style={{ height: `${bottomPercent}%` }} />
              <span className="crop-shade crop-shade-left" style={{ top: `${topPercent}%`, bottom: `${bottomPercent}%`, width: `${leftPercent}%` }} />
              <div className="crop-frame" style={{ top: `${topPercent}%`, right: `${rightPercent}%`, bottom: `${bottomPercent}%`, left: `${leftPercent}%` }}>
                {(Object.keys(margins) as Array<keyof CropMargins>).map((side) => (
                  <button
                    className={`crop-handle crop-handle-${side}`}
                    type="button"
                    key={side}
                    aria-label={`Adjust ${side} crop margin`}
                    aria-valuemin={0}
                    aria-valuenow={margins[side]}
                    aria-valuetext={`${margins[side]} millimetres`}
                    role="slider"
                    disabled={disabled}
                    onPointerDown={(event) => beginDrag(side, event)}
                    onKeyDown={(event) => adjustWithKeyboard(side, event)}
                  />
                ))}
              </div>
            </div>
          </div>
          <p>Black frame = downloaded page area. Grey area will be hidden.</p>
        </div>
      </div>
    </section>
  );
}

export default function SimplePdfToolPage({ mode }: { mode: SimplePdfToolMode }) {
  const copy = COPY[mode];
  const inputRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<SelectedPdf | null>(null);
  const { pages: visualPages, previewState, previewProgress, loadPreviews, hidePreviews, resetPreviews } = usePdfLazyPreviews(mode, mode === "crop" ? { maxWidth: 900 } : undefined);
  const [work, setWork] = useState<WorkState>({ kind: "idle" });
  const [applyTo, setApplyTo] = useState<"all" | "range">("all");
  const [range, setRange] = useState("");
  const [position, setPosition] = useState<PageNumberPosition>("bottom-center");
  const [numberFormat, setNumberFormat] = useState<"number" | "page-number" | "number-of-total" | "page-number-of-total">("page-number-of-total");
  const [startAt, setStartAt] = useState(1);
  const [fontSize, setFontSize] = useState(11);
  const [numberColor, setNumberColor] = useState("#222222");
  const [numberPrefix, setNumberPrefix] = useState("");
  const [numberSuffix, setNumberSuffix] = useState("");
  const [cropMargins, setCropMargins] = useState<CropMargins>({ top: 0, right: 0, bottom: 0, left: 0 });
  const [metadata, setMetadata] = useState({ title: "", author: "", subject: "", keywords: "" });
  const [outputName, setOutputName] = useState("document.pdf");
  const [savedNotice, setSavedNotice] = useState("");
  const [fieldCount, setFieldCount] = useState(0);
  const busy = work.kind === "reading" || work.kind === "working";
  useIncomingPdfHandoff(chooseFile);

  const selection = useMemo(() => {
    if (!selected) return { pages: [] as number[], error: "" };
    if (applyTo === "all") return {
      pages: Array.from({ length: selected.pageCount }, (_, index) => index),
      error: "",
    };
    try {
      return { pages: parsePageSelection(range, selected.pageCount), error: "" };
    } catch (error) {
      return { pages: [] as number[], error: error instanceof Error ? error.message : "Invalid page range." };
    }
  }, [applyTo, range, selected]);

  async function chooseFile(file?: File) {
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setWork({ kind: "error", message: "Choose a PDF file." });
      return;
    }
    setWork({ kind: "reading", message: "Reading the PDF on this device…" });
    resetPreviews();
    try {
      const bytes = await file.arrayBuffer();
      const { pageCount } = await inspectPdf(bytes);
      setSelected({ file, bytes, pageCount });
      setRange(`1-${pageCount}`);
      setOutputName(`${safeBaseName(file.name)}-${copy.suffix}.pdf`);
      setSavedNotice("");
      setFieldCount(mode === "flatten" ? await countPdfFormFields(bytes) : 0);
      setWork({ kind: "idle" });
      if (mode === "crop") {
        void loadPreviews(bytes).catch(() => {
          setWork({ kind: "error", message: "Page previews could not be created for this PDF." });
        });
      }
    } catch {
      resetPreviews();
      setSelected(null);
      setWork({ kind: "error", message: "This file could not be read. Password-protected PDFs must be unlocked first." });
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  async function processPdf() {
    if (!selected) return;
    setWork({ kind: "working", message: `${copy.action} locally…` });
    try {
      // Re-read the local file so PDF.js preview workers can never leave the
      // processing buffer detached in browsers that transfer typed arrays.
      const processingBytes = await selected.file.arrayBuffer();
      let output: Uint8Array;
      if (mode === "page-numbers") {
        output = await addPageNumbersPdf(processingBytes, {
          pageIndices: selection.pages,
          position,
          format: numberFormat,
          startAt,
          fontSize,
          margin: 28,
          color: numberColor,
          prefix: numberPrefix,
          suffix: numberSuffix,
        });
      } else if (mode === "crop") {
        const pointsPerMillimetre = 72 / 25.4;
        output = await cropPdf(processingBytes, {
          pageIndices: selection.pages,
          top: cropMargins.top * pointsPerMillimetre,
          right: cropMargins.right * pointsPerMillimetre,
          bottom: cropMargins.bottom * pointsPerMillimetre,
          left: cropMargins.left * pointsPerMillimetre,
        });
      } else if (mode === "metadata") {
        output = await updatePdfMetadata(processingBytes, {
          ...metadata,
          keywords: metadata.keywords.split(",").map((keyword) => keyword.trim()).filter(Boolean),
        });
      } else if (mode === "flatten") {
        output = await flattenPdfForms(processingBytes);
      } else {
        output = await optimisePdfStructure(processingBytes);
      }
      let repairNotice = "";
      if (mode === "repair") {
        const repairedPages = (await inspectPdf(output)).pageCount;
        repairNotice = repairedPages === selected.pageCount
          ? `Saved ${repairedPages} ${repairedPages === 1 ? "page" : "pages"}. Same as the original, which is still here.`
          : `Saved ${repairedPages} ${repairedPages === 1 ? "page" : "pages"}. The original had ${selected.pageCount}. Compare both copies.`;
      }
      downloadPdf(output, simpleDownloadName(outputName, `${safeBaseName(selected.file.name)}-${copy.suffix}.pdf`));
      setSavedNotice(repairNotice || "Saved. The original PDF is still here.");
      setWork({ kind: "idle" });
    } catch (error) {
      setWork({ kind: "error", message: error instanceof Error ? error.message : `${copy.title} could not finish.` });
    }
  }

  const usesSelection = mode === "page-numbers" || mode === "crop";
  const showsVisualPages = mode !== "metadata" && mode !== "repair";
  const canProcess = Boolean(
    selected
    && (!usesSelection || (selection.pages.length && !selection.error))
    && (mode !== "flatten" || fieldCount > 0),
  );

  async function showPreviews() {
    if (!selected) return;
    try {
      await loadPreviews(selected.bytes);
    } catch {
      setWork({ kind: "error", message: "Page previews could not be created for this PDF." });
    }
  }

  return (
    <div className={`pdf-page utility-pdf-page${selected ? " has-file" : ""}`}>
      <header className="site-header pdf-site-header">
        <div>
          <Link className="pdf-tools-back" href="/pdf-tools">← All PDF tools</Link>
          <Link className="suite-name" href="/">DearPDF</Link>
          <h1>{copy.title}</h1>
          <p>{copy.subtitle}</p>
        </div>
        <div className="local-processing-badge"><span aria-hidden="true">●</span> Files stay on this device</div>
      </header>

      <section className="merge-intro">
        <div><p className="pdf-eyebrow">LOCAL PDF UTILITY</p><h2>{copy.headline}</h2></div>
        <p>{copy.intro}</p>
      </section>

      <section className="merge-workspace utility-workspace">
        <div className="merge-workspace-heading">
          <div>
            <h2>Source PDF</h2>
            <p>{selected ? `${selected.pageCount} pages · ${formatBytes(selected.file.size)}` : "Choose one PDF file"}</p>
          </div>
          {selected ? (
            <div className="organise-heading-actions">
              {showsVisualPages && mode !== "crop" ? (
                <PdfLazyPreviewControls
                  previewState={previewState}
                  onShow={() => void showPreviews()}
                  onHide={hidePreviews}
                  disabled={busy}
                />
              ) : null}
              <button className="text-button" type="button" onClick={() => { resetPreviews(); setSelected(null); setSavedNotice(""); setFieldCount(0); }} disabled={busy}>Remove file</button>
            </div>
          ) : null}
        </div>

        {!selected ? (
          <label className={`pdf-drop-zone${busy ? " disabled" : ""}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
            event.preventDefault();
            if (!busy) void chooseFile(event.dataTransfer.files[0]);
          }}>
            <input ref={inputRef} type="file" accept=".pdf,application/pdf" disabled={busy} onChange={(event) => void chooseFile(event.target.files?.[0])} />
            <span className="drop-zone-mark" aria-hidden="true">＋</span>
            <strong>Choose a PDF file</strong><span>or drag and drop it here</span>
          </label>
        ) : (
          <div className="utility-controls">
            <PdfLazyPreviewStatus previewState={previewState} previewProgress={previewProgress} />
            {showsVisualPages && mode !== "crop" && previewState === "ready" ? (
              <PdfPageWorkspace
                pages={visualPages}
                selectedIds={usesSelection ? visualPages.filter((page) => selection.pages.includes(page.pageIndex)).map((page) => page.id) : undefined}
                onSelectedIdsChange={usesSelection ? (ids) => {
                  const idSet = new Set(ids);
                  const pageNumbers = visualPages
                    .filter((page) => idSet.has(page.id))
                    .map((page) => page.pageIndex + 1);
                  setApplyTo("range");
                  setRange(pageNumbers.join(", "));
                } : undefined}
                disabled={busy}
                title={usesSelection ? "Select and preview pages to change" : "Preview pages before processing"}
              />
            ) : null}

            {mode === "crop" && previewState === "ready" ? (
              <CropVisualEditor
                pages={visualPages}
                selectedIds={visualPages.filter((page) => selection.pages.includes(page.pageIndex)).map((page) => page.id)}
                onSelectedIdsChange={(ids) => {
                  const idSet = new Set(ids);
                  const pageNumbers = visualPages
                    .filter((page) => idSet.has(page.id))
                    .map((page) => page.pageIndex + 1);
                  setApplyTo("range");
                  setRange(pageNumbers.join(", "));
                }}
                margins={cropMargins}
                onMarginsChange={setCropMargins}
                disabled={busy}
              />
            ) : null}

            {usesSelection ? (
              <fieldset className="utility-fieldset">
                <legend>Pages to change</legend>
                <div className="utility-choice-row">
                  <label><input type="radio" checked={applyTo === "all"} onChange={() => setApplyTo("all")} /> All {selected.pageCount} pages</label>
                  <label><input type="radio" checked={applyTo === "range"} onChange={() => setApplyTo("range")} /> Selected pages</label>
                </div>
                {applyTo === "range" ? (
                  <label className="utility-field"><span>Page range</span><input value={range} onChange={(event) => setRange(event.target.value)} placeholder="1-3, 6, 9" /></label>
                ) : null}
                {selection.error ? <p className="split-range-error" role="alert">{selection.error}</p> : null}
              </fieldset>
            ) : null}

            {mode === "page-numbers" ? (
              <div className="utility-form-grid">
                <label className="utility-field"><span>Position</span><select value={position} onChange={(event) => setPosition(event.target.value as PageNumberPosition)}>
                  <option value="bottom-left">Bottom left</option><option value="bottom-center">Bottom centre</option><option value="bottom-right">Bottom right</option>
                  <option value="top-left">Top left</option><option value="top-center">Top centre</option><option value="top-right">Top right</option>
                </select></label>
                <label className="utility-field"><span>Format</span><select value={numberFormat} onChange={(event) => setNumberFormat(event.target.value as typeof numberFormat)}>
                  <option value="number">1</option><option value="page-number">Page 1</option><option value="number-of-total">1 of 10</option><option value="page-number-of-total">Page 1 of 10</option>
                </select></label>
                <label className="utility-field"><span>Start at</span><input type="number" min="0" step="1" value={startAt} onChange={(event) => setStartAt(Number(event.target.value))} /></label>
                <label className="utility-field"><span>Text size</span><input type="number" min="6" max="72" value={fontSize} onChange={(event) => setFontSize(Number(event.target.value))} /></label>
                <label className="utility-field"><span>Colour</span><input type="color" value={numberColor} onChange={(event) => setNumberColor(event.target.value)} /></label>
                <label className="utility-field"><span>Text before numbering</span><input value={numberPrefix} onChange={(event) => setNumberPrefix(event.target.value)} placeholder="Example: Annexure · " /></label>
                <label className="utility-field"><span>Text after numbering</span><input value={numberSuffix} onChange={(event) => setNumberSuffix(event.target.value)} placeholder="Example: · Confidential" /></label>
                <div className="page-number-preview">
                  <span>Preview</span>
                  <strong>{numberPrefix}{numberFormat === "number" ? startAt : numberFormat === "page-number" ? `Page ${startAt}` : numberFormat === "number-of-total" ? `${startAt} of ${startAt + Math.max(0, selection.pages.length - 1)}` : `Page ${startAt} of ${startAt + Math.max(0, selection.pages.length - 1)}`}{numberSuffix}</strong>
                </div>
              </div>
            ) : null}

            {mode === "crop" ? (
              <div className="utility-form-grid crop-fields">
                {(Object.keys(cropMargins) as Array<keyof typeof cropMargins>).map((side) => (
                  <label className="utility-field" key={side}><span>{side[0].toUpperCase() + side.slice(1)} margin (mm)</span>
                    <input type="number" min="0" max="150" step="1" value={cropMargins[side]} onChange={(event) => setCropMargins((current) => ({ ...current, [side]: Number(event.target.value) }))} />
                  </label>
                ))}
              </div>
            ) : null}

            {mode === "metadata" ? (
              <div className="utility-form-grid metadata-fields">
                <label className="utility-field"><span>Document title</span><input value={metadata.title} onChange={(event) => setMetadata({ ...metadata, title: event.target.value })} /></label>
                <label className="utility-field"><span>Author</span><input value={metadata.author} onChange={(event) => setMetadata({ ...metadata, author: event.target.value })} /></label>
                <label className="utility-field wide"><span>Subject</span><input value={metadata.subject} onChange={(event) => setMetadata({ ...metadata, subject: event.target.value })} /></label>
                <label className="utility-field wide"><span>Keywords, separated by commas</span><input value={metadata.keywords} onChange={(event) => setMetadata({ ...metadata, keywords: event.target.value })} /></label>
              </div>
            ) : null}

            {mode === "flatten" ? (
              <p className="utility-callout">
                {fieldCount
                  ? `${fieldCount} form ${fieldCount === 1 ? "field" : "fields"} will be frozen in the download. The original stays editable.`
                  : "This PDF has no form fields to flatten."}
              </p>
            ) : null}
            {mode === "repair" ? (
              <p className="utility-callout">
                Original: {selected.pageCount} {selected.pageCount === 1 ? "page" : "pages"}. After repair you will see whether that count stayed the same. The original file is not overwritten.
              </p>
            ) : null}

            <div className="utility-action-row">
              <label className="merge-output-name">
                <span>File name</span>
                <input
                  type="text"
                  value={outputName}
                  spellCheck={false}
                  autoComplete="off"
                  disabled={busy}
                  aria-label="Download file name"
                  onChange={(event) => setOutputName(event.target.value)}
                  onBlur={() => setOutputName(simpleDownloadName(outputName, `${safeBaseName(selected.file.name)}-${copy.suffix}.pdf`))}
                />
              </label>
              <span>
                {mode === "flatten"
                  ? (fieldCount ? `${fieldCount} ${fieldCount === 1 ? "field" : "fields"} to freeze` : "No form fields")
                  : usesSelection ? `${selection.pages.length} pages selected` : `${selected.pageCount} pages ready`}
              </span>
              <PdfNextStepSelector />
              <button className="merge-button" type="button" disabled={busy || !canProcess} onClick={() => void processPdf()}>
                {work.kind === "working"
                  ? "Working…"
                  : mode === "flatten"
                    ? `Flatten ${fieldCount} ${fieldCount === 1 ? "field" : "fields"}`
                    : mode === "repair"
                      ? `Repair ${selected.pageCount} ${selected.pageCount === 1 ? "page" : "pages"}`
                      : copy.action}
              </button>
            </div>
            {savedNotice ? <p className="page-numbers-saved" role="status">{savedNotice}</p> : null}
          </div>
        )}

        {work.kind !== "idle" ? <p className={`pdf-work-message ${work.kind}`} role={work.kind === "error" ? "alert" : "status"}>{work.message}</p> : null}
      </section>

      <section className="merge-assurance">
        <div><strong>No uploads</strong><span>The source PDF stays in this browser tab.</span></div>
        <div><strong>No file analytics</strong><span>Names, contents, and choices are never collected.</span></div>
        <div><strong>Fresh download</strong><span>The original file is never overwritten.</span></div>
      </section>

      <footer className="site-footer"><p><Link href="/pdf-tools">← All PDF tools</Link></p><p>Open and verify the downloaded PDF before relying on it.</p></footer>
    </div>
  );
}
