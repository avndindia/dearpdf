"use client";

import { useMemo, useRef, useState } from "react";
import type Tesseract from "tesseract.js";
import PdfPageWorkspace from "../../../components/pdf-page-workspace";
import {
  PdfLazyPreviewControls,
  PdfLazyPreviewStatus,
  usePdfLazyPreviews,
} from "../../../components/pdf-lazy-previews";
import { downloadGeneratedFile } from "../../../lib/browser-download";
import { useIncomingPdfHandoff } from "../../../lib/pdf-tool-handoff";
import {
  createEditableDocx,
  type EditableDocxPage,
} from "../../../lib/docx";
import { inspectPdf, parsePageSelection } from "../../../lib/pdf-tools";
import {
  blocksFromPlainLines,
  extractFormattedPage,
  extractTaggedPage,
  type PdfStructNode,
} from "../../../lib/pdf-to-word-layout";
import StitchToolShell from "../../../components/StitchToolShell";

type SelectedPdf = { file: File; bytes: ArrayBuffer; pageCount: number };
type ConversionMode = "auto" | "text" | "ocr";
type OcrLanguage = "eng" | "hin" | "mar" | "eng+hin" | "eng+mar" | "eng+hin+mar";
type WorkState = { kind: "idle" } | { kind: "reading" | "working" | "error"; message: string };
type ProgressState = { page: number; total: number; phase: string; percent: number };
type ConversionResult = {
  bytes: Uint8Array;
  pages: EditableDocxPage[];
  ocrPages: number;
  textPages: number;
  tableCount: number;
  styledRunCount: number;
};

const OCR_LANGUAGES: Array<{ value: OcrLanguage; label: string }> = [
  { value: "eng", label: "English" },
  { value: "hin", label: "Hindi" },
  { value: "mar", label: "Marathi" },
  { value: "eng+hin", label: "English + Hindi" },
  { value: "eng+mar", label: "English + Marathi" },
  { value: "eng+hin+mar", label: "English + Hindi + Marathi" },
];

function safeBaseName(name: string) {
  return name.replace(/\.pdf$/i, "").replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "") || "document";
}

function wordDownloadName(name: string, fallback: string) {
  const trimmed = name.trim() || fallback;
  const base = trimmed.replace(/\.(pdf|docx)$/i, "").replace(/[^\p{L}\p{N}._ -]+/gu, "-").replace(/-+/g, "-").replace(/^[\s.-]+|[\s.-]+$/g, "");
  return `${base || "converted"}.docx`;
}

function downloadDocx(bytes: Uint8Array, fileName: string) {
  downloadGeneratedFile(bytes as BlobPart, fileName);
}

function inspectDrawnLines(
  fnArray: number[],
  argsArray: unknown[],
  operations: Record<string, number>,
) {
  const strokeOperations = new Set([
    operations.stroke,
    operations.closeStroke,
    operations.fillStroke,
    operations.eoFillStroke,
    operations.closeFillStroke,
    operations.closeEOFillStroke,
  ]);
  const horizontalRules: Array<{ x1: number; x2: number; y: number }> = [];
  const verticalRules: Array<{ x: number; y1: number; y2: number }> = [];

  fnArray.forEach((operation, index) => {
    if (operation !== operations.constructPath) return;
    const args = argsArray[index];
    if (!Array.isArray(args) || !strokeOperations.has(args[0] as number)) return;
    const bounds = args[2] as ArrayLike<number> | undefined;
    if (!bounds || bounds.length < 4) return;
    const x1 = Number(bounds[0]);
    const y1 = Number(bounds[1]);
    const x2 = Number(bounds[2]);
    const y2 = Number(bounds[3]);
    if (![x1, y1, x2, y2].every(Number.isFinite)) return;
    if (Math.abs(y2 - y1) <= 1.5 && Math.abs(x2 - x1) >= 10) {
      horizontalRules.push({ x1: Math.min(x1, x2), x2: Math.max(x1, x2), y: (y1 + y2) / 2 });
    } else if (Math.abs(x2 - x1) <= 1.5 && Math.abs(y2 - y1) >= 10) {
      verticalRules.push({ x: (x1 + x2) / 2, y1: Math.min(y1, y2), y2: Math.max(y1, y2) });
    }
  });

  return {
    horizontalRules,
    hasRulingLines: horizontalRules.length >= 2 && verticalRules.length >= 2,
    verticalRules,
  };
}

export default function PdfToWordPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const ocrWorkerRef = useRef<Tesseract.Worker | null>(null);
  const cancelledRef = useRef(false);
  const activePageRef = useRef(1);
  const [selected, setSelected] = useState<SelectedPdf | null>(null);
  const { pages: visualPages, previewState, previewProgress, loadPreviews, hidePreviews, resetPreviews } = usePdfLazyPreviews("pdf-to-word");
  const [applyTo, setApplyTo] = useState<"all" | "range">("all");
  const [range, setRange] = useState("");
  const [mode, setMode] = useState<ConversionMode>("auto");
  const [language, setLanguage] = useState<OcrLanguage>("eng");
  const [dpi, setDpi] = useState(180);
  const [includePageLabels, setIncludePageLabels] = useState(false);
  const [outputName, setOutputName] = useState("converted.docx");
  const [savedNotice, setSavedNotice] = useState("");
  const [result, setResult] = useState<ConversionResult | null>(null);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [work, setWork] = useState<WorkState>({ kind: "idle" });
  const busy = work.kind === "reading" || work.kind === "working";
  useIncomingPdfHandoff(chooseFile);

  const selection = useMemo(() => {
    if (!selected) return { pages: [] as number[], error: "" };
    if (applyTo === "all") {
      return { pages: Array.from({ length: selected.pageCount }, (_, index) => index), error: "" };
    }
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
    setWork({ kind: "reading", message: "Reading the PDF locally…" });
    resetPreviews();
    try {
      const bytes = await file.arrayBuffer();
      const { pageCount } = await inspectPdf(bytes);
      setSelected({ file, bytes, pageCount });
      setRange(`1-${pageCount}`);
      setOutputName(`${safeBaseName(file.name)}.docx`);
      setSavedNotice("");
      setResult(null);
      setProgress(null);
      setWork({ kind: "idle" });
    } catch {
      resetPreviews();
      setSelected(null);
      setWork({ kind: "error", message: "Choose a valid, unlocked PDF file." });
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  function clearFile() {
    resetPreviews();
    setSelected(null);
    setResult(null);
    setProgress(null);
    setSavedNotice("");
    setWork({ kind: "idle" });
  }

  function cancelConversion() {
    cancelledRef.current = true;
    setWork({ kind: "working", message: "Stopping conversion safely…" });
    const worker = ocrWorkerRef.current;
    ocrWorkerRef.current = null;
    if (worker) void worker.terminate();
  }

  async function convertToWord() {
    if (!selected || !orderedSelection.length || selection.error) return;
    cancelledRef.current = false;
    setResult(null);
    setProgress({ page: 1, total: orderedSelection.length, phase: "Inspecting text layer", percent: 0 });
    setWork({ kind: "working", message: `Preparing ${orderedSelection.length} pages on this device…` });

    let worker: Tesseract.Worker | null = null;
    let task: ReturnType<(typeof import("pdfjs-dist/legacy/build/pdf.mjs"))["getDocument"]> | null = null;
    try {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      const processingBytes = await selected.file.arrayBuffer();
      task = pdfjs.getDocument({ data: Uint8Array.from(new Uint8Array(processingBytes)) });
      const pdf = await task.promise;
      const pages: EditableDocxPage[] = [];
      let ocrPages = 0;
      let textPages = 0;

      async function getWorker() {
        if (worker) return worker;
        setWork({ kind: "working", message: "Loading the private OCR engine and language model…" });
        const { createWorker } = await import("tesseract.js");
        worker = await createWorker(language, undefined, {
          logger(message) {
            setProgress({
              page: activePageRef.current,
              total: orderedSelection.length,
              phase: message.status.replace(/_/g, " "),
              percent: Math.round((message.progress || 0) * 100),
            });
          },
        });
        ocrWorkerRef.current = worker;
        if (cancelledRef.current) throw new Error("CONVERSION_CANCELLED");
        await worker.setParameters({
          preserve_interword_spaces: "1",
          user_defined_dpi: String(dpi),
        });
        return worker;
      }

      for (let index = 0; index < orderedSelection.length; index += 1) {
        if (cancelledRef.current) throw new Error("CONVERSION_CANCELLED");
        const pageIndex = orderedSelection[index];
        activePageRef.current = index + 1;
        setProgress({ page: index + 1, total: orderedSelection.length, phase: "Inspecting text layer", percent: 0 });
        setWork({ kind: "working", message: `Reading PDF page ${pageIndex + 1}…` });

        const page = await pdf.getPage(pageIndex + 1);
        const original = page.getViewport({ scale: 1 });
        const content = await page.getTextContent({ includeMarkedContent: true });
        let horizontalRules: Array<{ x1: number; x2: number; y: number }> = [];
        let verticalRules: Array<{ x: number; y1: number; y2: number }> = [];
        try {
          const operatorList = await page.getOperatorList();
          const drawingInfo = inspectDrawnLines(
            operatorList.fnArray,
            operatorList.argsArray,
            pdfjs.OPS,
          );
          horizontalRules = drawingInfo.horizontalRules;
          verticalRules = drawingInfo.verticalRules;
        } catch {
          // Formatting reconstruction can continue without drawn-line detection.
        }
        const heuristicFormatting = extractFormattedPage(
          content.items,
          content.styles as Record<string, { fontFamily?: string }>,
          original.width,
          horizontalRules,
          verticalRules,
        );
        let structure: PdfStructNode | null = null;
        try {
          structure = await page.getStructTree() as PdfStructNode | null;
        } catch {
          // Untagged PDFs use the positioned-text fallback below.
        }
        const taggedFormatting = extractTaggedPage(
          structure,
          content.items,
          content.styles as Record<string, { fontFamily?: string }>,
          original.width,
          horizontalRules,
          verticalRules,
        );
        const formatted = taggedFormatting || heuristicFormatting;
        let lines = formatted.lines;
        let blocks = formatted.blocks;
        const hasUsefulText = lines.join("").replace(/\s/g, "").length >= 20;
        const shouldOcr = mode === "ocr" || (mode === "auto" && !hasUsefulText);

        if (shouldOcr) {
          const ocrWorker = await getWorker();
          if (cancelledRef.current) throw new Error("CONVERSION_CANCELLED");
          setWork({ kind: "working", message: `Recognising scanned page ${pageIndex + 1}…` });
          const requestedScale = dpi / 72;
          const safeScale = Math.min(
            requestedScale,
            5000 / original.width,
            5000 / original.height,
            Math.sqrt(20_000_000 / (original.width * original.height)),
          );
          const viewport = page.getViewport({ scale: safeScale });
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.ceil(viewport.width));
          canvas.height = Math.max(1, Math.ceil(viewport.height));
          const context = canvas.getContext("2d", { alpha: false });
          if (!context) throw new Error("Canvas processing is not supported in this browser.");
          await page.render({ canvas, canvasContext: context, viewport, background: "#ffffff" }).promise;
          const recognition = await ocrWorker.recognize(canvas);
          lines = recognition.data.text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
          blocks = blocksFromPlainLines(lines);
          canvas.width = 1;
          canvas.height = 1;
          ocrPages += 1;
        } else {
          textPages += 1;
        }
        pages.push({
          pageNumber: pageIndex + 1,
          lines,
          blocks,
          widthPoints: original.width,
          heightPoints: original.height,
        });
        page.cleanup();
      }

      const bytes = createEditableDocx(pages, {
        title: safeBaseName(selected.file.name),
        includePageLabels,
      });
      const blocks = pages.flatMap((page) => page.blocks ?? []);
      const tableCount = blocks.filter((block) => block.kind === "table").length;
      const runs = blocks.flatMap((block) =>
        block.kind === "paragraph"
          ? block.runs
          : block.rows.flatMap((row) => row.flatMap((cell) => cell.runs))
      );
      const styledRunCount = runs.filter((run) =>
        run.bold || run.italic || run.underline || run.fontSize || run.fontFamily
      ).length;
      setResult({ bytes, pages, ocrPages, textPages, tableCount, styledRunCount });
      downloadDocx(bytes, wordDownloadName(outputName, `${safeBaseName(selected.file.name)}.docx`));
      setSavedNotice(`Converted ${pages.length} ${pages.length === 1 ? "page" : "pages"}. The original PDF is still here.`);
      setProgress(null);
      setWork({ kind: "idle" });
    } catch (error) {
      setProgress(null);
      if (cancelledRef.current || (error instanceof Error && error.message === "CONVERSION_CANCELLED")) {
        setWork({ kind: "idle" });
      } else {
        setWork({
          kind: "error",
          message: error instanceof Error ? error.message : "The Word document could not be created.",
        });
      }
    } finally {
      const activeWorker = ocrWorkerRef.current;
      ocrWorkerRef.current = null;
      if (activeWorker) {
        try {
          await activeWorker.terminate();
        } catch {
          // A cancelled worker may already be terminated.
        }
      }
      if (task) await task.destroy();
    }
  }

  const previewText = result?.pages
    .flatMap((page) => [`Page ${page.pageNumber}`, ...(page.lines ?? [])])
    .slice(0, 24)
    .join("\n");

  return (
    <StitchToolShell
      title="PDF to Word"
      subtitle="Reconstruct PDF text, formatting, and tables in an editable Word document."
      className={`utility-pdf-page${selected ? " has-file" : ""}`}
      note="Always review names, figures, tables, and official wording after conversion."
    >
      <section className="merge-workspace utility-workspace">
        <div className="merge-workspace-heading">
          <div><h2>Source PDF</h2><p>{selected ? `${selected.pageCount} ${selected.pageCount === 1 ? "page" : "pages"} · ${orderedSelection.length} selected` : "Choose one PDF file"}</p></div>
          {selected && !busy ? (
            <div className="organise-heading-actions">
              <PdfLazyPreviewControls
                previewState={previewState}
                onShow={() => { if (selected) void loadPreviews(selected.bytes).catch(() => setWork({ kind: "error", message: "Page previews could not be created for this PDF." })); }}
                onHide={hidePreviews}
              />
              <button className="text-button" type="button" onClick={clearFile}>Remove file</button>
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
            <input ref={inputRef} type="file" accept=".pdf,application/pdf" disabled={busy} onChange={(event) => void chooseFile(event.target.files?.[0])} />
            <span className="drop-zone-mark" aria-hidden="true">＋</span>
            <strong>Choose a PDF file</strong>
            <span>or drag and drop it here</span>
          </label>
        ) : (
          <>
            <div className="selected-document-card">
              <span className="pdf-file-icon" aria-hidden="true">PDF</span>
              <span className="pdf-file-name"><strong>{selected.file.name}</strong><small>{selected.pageCount} {selected.pageCount === 1 ? "page" : "pages"} · {(selected.file.size / (1024 * 1024)).toFixed(2)} MB</small></span>
              <span className="word-output-badge">→ DOCX</span>
            </div>

            <div className="utility-controls">
              <fieldset className="utility-fieldset">
                <legend>Pages to convert</legend>
                <div className="utility-choice-row">
                  <label><input type="radio" checked={applyTo === "all"} onChange={() => setApplyTo("all")} /> All pages</label>
                  <label><input type="radio" checked={applyTo === "range"} onChange={() => setApplyTo("range")} /> Selected pages</label>
                </div>
                {applyTo === "range" ? (
                  <label className="utility-field"><span>Page range</span><input value={range} onChange={(event) => setRange(event.target.value)} placeholder="1-3, 5, 8" /></label>
                ) : null}
                {selection.error ? <p className="field-error" role="alert">{selection.error}</p> : null}
              </fieldset>

              <PdfLazyPreviewStatus previewState={previewState} previewProgress={previewProgress} />
              {previewState === "ready" ? (
              <PdfPageWorkspace
                pages={visualPages}
                selectedIds={visualPages.filter((page) => selection.pages.includes(page.pageIndex)).map((page) => page.id)}
                onSelectedIdsChange={(ids) => {
                  const selectedIds = new Set(ids);
                  setApplyTo("range");
                  setRange(visualPages.filter((page) => selectedIds.has(page.id)).map((page) => page.pageIndex + 1).join(", "));
                }}
              />
              ) : null}

              <fieldset className="utility-fieldset">
                <legend>Reading method</legend>
                <div className="ocr-mode-grid">
                  {([
                    ["auto", "Reconstruct format", "Keep detectable fonts, alignment, spacing, and tables; OCR scans.", "Recommended"],
                    ["text", "Formatted text layer", "Reconstruct editable formatting without OCR.", "Digital PDFs"],
                    ["ocr", "OCR every page", "Recognise scans and photographed documents.", "Slower"],
                  ] as const).map(([value, label, description, note]) => (
                    <label className={mode === value ? "active" : ""} key={value}>
                      <input type="radio" checked={mode === value} onChange={() => setMode(value)} />
                      <strong>{label}</strong><span>{description}</span><em>{note}</em>
                    </label>
                  ))}
                </div>
                {mode !== "text" ? (
                  <div className="ocr-settings-grid">
                    <label className="utility-field"><span>Document language</span><select value={language} onChange={(event) => setLanguage(event.target.value as OcrLanguage)}>{OCR_LANGUAGES.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>
                    <label className="utility-field"><span>OCR resolution</span><select value={dpi} onChange={(event) => setDpi(Number(event.target.value))}><option value={144}>144 DPI · faster</option><option value={180}>180 DPI · balanced</option><option value={240}>240 DPI · clearer small text</option></select></label>
                  </div>
                ) : null}
                <label className="utility-check"><input type="checkbox" checked={includePageLabels} onChange={(event) => setIncludePageLabels(event.target.checked)} /> Add a “Page 1” label before each converted page</label>
              </fieldset>

              <p className="utility-callout">The result contains editable Word text—not page screenshots. Bold, italic, font sizes, alignment, indentation, page sizes, lists, and detectable tables are reconstructed. Underlines and table borders are retained when the PDF exposes enough font or drawing information. Complex forms, floating elements, and unusual embedded fonts may still need adjustment because PDF files do not contain native Word structure.</p>

              {progress ? (
                <div className="ocr-progress" role="status">
                  <div><strong>Page {progress.page} of {progress.total}</strong><span>{progress.phase} · {progress.percent}%</span></div>
                  <span className="ocr-progress-track"><span style={{ width: `${progress.percent}%` }} /></span>
                </div>
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
                    aria-label="Word file name"
                    onChange={(event) => setOutputName(event.target.value)}
                    onBlur={() => setOutputName(wordDownloadName(outputName, `${safeBaseName(selected.file.name)}.docx`))}
                  />
                </label>
                <span>{orderedSelection.length ? `${orderedSelection.length} page${orderedSelection.length === 1 ? "" : "s"} ready` : "Select at least one page"}</span>
                <div className="ocr-action-buttons">
                  {busy ? <button className="text-button ocr-cancel" type="button" onClick={cancelConversion}>Cancel</button> : null}
                  <button className="merge-button" type="button" disabled={busy || !orderedSelection.length || Boolean(selection.error)} onClick={() => void convertToWord()}>
                    {work.kind === "working" ? "Converting…" : `Convert ${orderedSelection.length} ${orderedSelection.length === 1 ? "page" : "pages"}`}
                  </button>
                </div>
              </div>
              {savedNotice ? <p className="page-numbers-saved" role="status">{savedNotice}</p> : null}

              {work.kind !== "idle" ? <p className={`pdf-work-message ${work.kind}`} role={work.kind === "error" ? "alert" : "status"}>{work.message}</p> : null}

              {result ? (
                <div className="ocr-results">
                  <div><span className="pdf-tool-status">FORMATTED WORD DOCUMENT READY</span><h3>{result.pages.length} pages converted</h3><p>{result.styledRunCount} styled text runs · {result.tableCount} {result.tableCount === 1 ? "table" : "tables"} · {result.ocrPages} OCR · {result.textPages} text</p></div>
                  {result.ocrPages ? (
                    <p className="utility-callout">This PDF contains scanned page images rather than embedded text or table structure. OCR keeps the output editable, but exact fonts, bold/underline styling, and table cells cannot be recovered reliably from pixels alone.</p>
                  ) : null}
                  <div className="ocr-result-actions"><button type="button" onClick={() => downloadDocx(result.bytes, wordDownloadName(outputName, `${safeBaseName(selected.file.name)}.docx`))}>Download .docx</button></div>
                  <div className="text-preview"><strong>Reconstructed text preview</strong><pre>{previewText}{result.pages.flatMap((page) => page.lines ?? []).length > 24 ? "\n…" : ""}</pre></div>
                </div>
              ) : null}
            </div>
          </>
        )}
      </section>
    </StitchToolShell>
  );
}
