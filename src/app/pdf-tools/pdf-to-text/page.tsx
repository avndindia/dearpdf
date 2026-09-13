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
import { trackToolEvent } from "../../../lib/stats";
import { useIncomingPdfHandoff } from "../../../lib/pdf-tool-handoff";
import {
  extractPdfPages,
  inspectPdf,
  mergePdfDocuments,
  parsePageSelection,
} from "../../../lib/pdf-tools";
import StitchToolShell from "../../../components/StitchToolShell";

type SelectedPdf = { file: File; bytes: ArrayBuffer; pageCount: number };
type ExtractionMode = "auto" | "ocr" | "text";
type OcrLanguage = "eng" | "hin" | "mar" | "eng+hin" | "eng+mar" | "eng+hin+mar";
type WorkState = { kind: "idle" } | { kind: "reading" | "working" | "error"; message: string };
type ProgressState = {
  page: number;
  total: number;
  phase: string;
  percent: number;
};
type ExtractionResult = {
  text: string;
  searchablePdf: Uint8Array | null;
  ocrPages: number;
  textPages: number;
  averageConfidence: number | null;
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
  return name.replace(/\.pdf$/i, "").replace(/[^\p{L}\p{N}._-]+/gu, "-") || "document";
}

function ocrDownloadBase(name: string, fallback: string) {
  const trimmed = name.trim() || fallback;
  const base = trimmed.replace(/\.(pdf|txt)$/i, "").replace(/[^\p{L}\p{N}._ -]+/gu, "-").replace(/-+/g, "-").replace(/^[\s.-]+|[\s.-]+$/g, "");
  return base || "ocr";
}

function downloadBlob(blob: Blob, fileName: string) {
  downloadGeneratedFile(blob, fileName);
}

function extractLines(items: ArrayLike<unknown>) {
  const lines: string[] = [];
  let currentY: number | null = null;
  let line = "";
  for (const item of Array.from(items)) {
    if (!item || typeof item !== "object" || !("str" in item) || !("transform" in item)) continue;
    const textItem = item as { str: string; transform: number[] };
    const y = textItem.transform[5];
    if (currentY !== null && Math.abs(y - currentY) > 3) {
      if (line.trim()) lines.push(line.trim());
      line = "";
    }
    line += `${line ? " " : ""}${textItem.str}`;
    currentY = y;
  }
  if (line.trim()) lines.push(line.trim());
  return lines.join("\n");
}

export default function PdfToTextPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const ocrWorkerRef = useRef<Tesseract.Worker | null>(null);
  const cancelledRef = useRef(false);
  const activePageRef = useRef(1);
  const [selected, setSelected] = useState<SelectedPdf | null>(null);
  const { pages: visualPages, setPages: setVisualPages, previewState, previewProgress, loadPreviews, hidePreviews, resetPreviews } = usePdfLazyPreviews("ocr");
  const [applyTo, setApplyTo] = useState<"all" | "range">("all");
  const [range, setRange] = useState("");
  const [mode, setMode] = useState<ExtractionMode>("auto");
  const [language, setLanguage] = useState<OcrLanguage>("eng");
  const [dpi, setDpi] = useState(180);
  const [includePageHeadings, setIncludePageHeadings] = useState(true);
  const [outputName, setOutputName] = useState("ocr");
  const [savedNotice, setSavedNotice] = useState("");
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [work, setWork] = useState<WorkState>({ kind: "idle" });
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
  const orderedSelection = visualPages.length
    ? visualPages.filter((page) => selection.pages.includes(page.pageIndex)).map((page) => page.pageIndex)
    : selection.pages;

  async function chooseFile(file?: File) {
    if (!file) return;
    setWork({ kind: "reading", message: "Reading the PDF locally…" });
    resetPreviews();
    try {
      const bytes = await file.arrayBuffer();
      const { pageCount } = await inspectPdf(bytes);
      setSelected({ file, bytes, pageCount });
      setRange(`1-${pageCount}`);
      setOutputName(safeBaseName(file.name));
      setSavedNotice("");
      setResult(null);
      setCopied(false);
      setProgress(null);
      setWork({ kind: "idle" });
    } catch {
      resetPreviews();
      setSelected(null);
      setWork({ kind: "error", message: "Choose a valid, unlocked PDF file." });
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  function cancelExtraction() {
    cancelledRef.current = true;
    setWork({ kind: "working", message: "Stopping OCR safely…" });
    const worker = ocrWorkerRef.current;
    ocrWorkerRef.current = null;
    if (worker) void worker.terminate();
  }

  async function extractText() {
    if (!selected || !orderedSelection.length) return;
    cancelledRef.current = false;
    setResult(null);
    setCopied(false);
    setProgress({ page: 1, total: orderedSelection.length, phase: "Inspecting text layer", percent: 0 });
    setWork({ kind: "working", message: `Preparing ${orderedSelection.length} pages on this device…` });
    trackToolEvent("pdf-to-text", "start");

    let worker: Tesseract.Worker | null = null;
    let task: ReturnType<(typeof import("pdfjs-dist/legacy/build/pdf.mjs"))["getDocument"]> | null = null;

    try {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      task = pdfjs.getDocument({ data: Uint8Array.from(new Uint8Array(selected.bytes)) });
      const pdf = await task.promise;
      const sections: string[] = [];
      const searchablePages: Array<{ name: string; bytes: Uint8Array }> = [];
      const confidences: number[] = [];
      let ocrPages = 0;
      let textPages = 0;

      async function getWorker() {
        if (worker) return worker;
        setWork({ kind: "working", message: "Downloading the private OCR engine and language model…" });
        const { createWorker } = await import("tesseract.js");
        worker = await createWorker(language, undefined, {
          logger(message) {
            const percent = Math.round((message.progress || 0) * 100);
            setProgress({
              page: activePageRef.current,
              total: orderedSelection.length,
              phase: message.status.replace(/_/g, " "),
              percent,
            });
          },
        });
        ocrWorkerRef.current = worker;
        if (cancelledRef.current) {
          await worker.terminate();
          ocrWorkerRef.current = null;
          throw new Error("OCR_CANCELLED");
        }
        await worker.setParameters({
          preserve_interword_spaces: "1",
          user_defined_dpi: String(dpi),
        });
        return worker;
      }

      for (let selectionIndex = 0; selectionIndex < orderedSelection.length; selectionIndex += 1) {
        if (cancelledRef.current) throw new Error("OCR_CANCELLED");
        const pageIndex = orderedSelection[selectionIndex];
        activePageRef.current = selectionIndex + 1;
        setProgress({
          page: selectionIndex + 1,
          total: orderedSelection.length,
          phase: "Inspecting text layer",
          percent: 0,
        });
        setWork({ kind: "working", message: `Reading page ${pageIndex + 1} of the PDF…` });

        const page = await pdf.getPage(pageIndex + 1);
        const content = await page.getTextContent();
        const selectableText = extractLines(content.items);
        const hasUsefulText = selectableText.replace(/\s/g, "").length >= 20;
        const shouldOcr = mode === "ocr" || (mode === "auto" && !hasUsefulText);
        let pageText = selectableText;

        if (shouldOcr) {
          const ocrWorker = await getWorker();
          if (cancelledRef.current) throw new Error("OCR_CANCELLED");
          setWork({ kind: "working", message: `Running OCR on page ${pageIndex + 1}…` });
          const original = page.getViewport({ scale: 1 });
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
          const recognition = await ocrWorker.recognize(
            canvas,
            {
              pdfTitle: `${safeBaseName(selected.file.name)} page ${pageIndex + 1}`,
              pdfTextOnly: false,
            },
            { text: true, pdf: true },
          );
          pageText = recognition.data.text.trim();
          confidences.push(recognition.data.confidence);
          ocrPages += 1;

          if (recognition.data.pdf?.length) {
            searchablePages.push({
              name: `page-${pageIndex + 1}.pdf`,
              bytes: Uint8Array.from(recognition.data.pdf),
            });
          }
          canvas.width = 1;
          canvas.height = 1;
        } else {
          textPages += 1;
          searchablePages.push({
            name: `page-${pageIndex + 1}.pdf`,
            bytes: await extractPdfPages(selected.bytes, [pageIndex]),
          });
        }

        const heading = includePageHeadings ? `--- Page ${pageIndex + 1} ---\n\n` : "";
        sections.push(`${heading}${pageText}`.trim());
      }

      const text = sections.join("\n\n");
      if (!text.replace(/--- Page \d+ ---/g, "").trim()) {
        throw new Error("No text could be recognised. Try OCR mode, a different language, or a higher resolution.");
      }

      let searchablePdf: Uint8Array | null = null;
      if (searchablePages.length === orderedSelection.length) {
        searchablePdf = searchablePages.length === 1
          ? searchablePages[0].bytes
          : await mergePdfDocuments(searchablePages);
      }

      setResult({
        text,
        searchablePdf,
        ocrPages,
        textPages,
        averageConfidence: confidences.length
          ? Math.round(confidences.reduce((total, confidence) => total + confidence, 0) / confidences.length)
          : null,
      });
      setSavedNotice(`Read ${orderedSelection.length} ${orderedSelection.length === 1 ? "page" : "pages"} (${ocrPages} OCR, ${textPages} text). The original scan is still here.`);
      setProgress(null);
      trackToolEvent("pdf-to-text", "success");
      setWork({ kind: "idle" });
    } catch (error) {
      setProgress(null);
      if (cancelledRef.current || (error instanceof Error && error.message === "OCR_CANCELLED")) {
        trackToolEvent("pdf-to-text", "cancel");
        setWork({ kind: "idle" });
      } else {
        trackToolEvent("pdf-to-text", "error");
        setWork({
          kind: "error",
          message: error instanceof Error ? error.message : "Text could not be extracted.",
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

  function downloadText() {
    if (!selected || !result) return;
    const base = ocrDownloadBase(outputName, safeBaseName(selected.file.name));
    downloadBlob(
      new Blob([result.text], { type: "text/plain;charset=utf-8" }),
      `${base}.txt`,
    );
  }

  function downloadSearchablePdf() {
    if (!selected || !result?.searchablePdf) return;
    const base = ocrDownloadBase(outputName, safeBaseName(selected.file.name));
    downloadBlob(
      new Blob([result.searchablePdf as BlobPart], { type: "application/pdf" }),
      `${base}-searchable.pdf`,
    );
  }

  async function copyText() {
    if (!result?.text) return;
    try {
      await navigator.clipboard.writeText(result.text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setWork({ kind: "error", message: "The text could not be copied. Download the TXT file instead." });
    }
  }

  return (
    <StitchToolShell
      title="PDF OCR"
      subtitle="Copy the text, or save a searchable PDF."
      className={`utility-pdf-page${selected ? " has-file" : ""}`}
      note="OCR accuracy depends on scan clarity and layout. Always verify official text."
    >
      <section className="merge-workspace utility-workspace">
        <div className="merge-workspace-heading">
          <div><h2>Source PDF</h2><p>{selected ? `${selected.pageCount} pages · ${orderedSelection.length} selected` : "Choose one PDF file"}</p></div>
          {selected && !busy ? (
            <div className="organise-heading-actions">
              <PdfLazyPreviewControls
                previewState={previewState}
                onShow={() => { if (selected) void loadPreviews(selected.bytes).catch(() => setWork({ kind: "error", message: "Page previews could not be created for this PDF." })); }}
                onHide={hidePreviews}
              />
              <button className="text-button" onClick={() => { resetPreviews(); setSelected(null); setResult(null); setSavedNotice(""); }} type="button">Remove file</button>
            </div>
          ) : null}
        </div>

        {!selected ? (
          <label className="pdf-drop-zone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
            event.preventDefault();
            void chooseFile(event.dataTransfer.files[0]);
          }}>
            <input ref={inputRef} type="file" accept=".pdf,application/pdf" onChange={(event) => void chooseFile(event.target.files?.[0])} />
            <span className="drop-zone-mark" aria-hidden="true">＋</span>
            <strong>Choose a PDF file</strong>
            <span>or drag and drop it here</span>
          </label>
        ) : (
          <div className="utility-controls">
            <PdfLazyPreviewStatus previewState={previewState} previewProgress={previewProgress} />
            {previewState === "ready" ? (
            <PdfPageWorkspace
              pages={visualPages}
              selectedIds={visualPages.filter((page) => selection.pages.includes(page.pageIndex)).map((page) => page.id)}
              onSelectedIdsChange={(ids) => {
                const idSet = new Set(ids);
                setApplyTo("range");
                setRange(visualPages.filter((page) => idSet.has(page.id)).map((page) => page.pageIndex + 1).join(", "));
              }}
              onReorder={(orderedIds) => setVisualPages(orderedIds.map((id) => visualPages.find((page) => page.id === id)!).filter(Boolean))}
              disabled={busy}
              title="Select, preview, and order pages for text or searchable PDF output"
            />
            ) : null}
            <fieldset className="utility-fieldset">
              <legend>Recognition mode</legend>
              <div className="ocr-mode-grid">
                <label className={mode === "auto" ? "active" : ""}>
                  <input type="radio" name="ocr-mode" checked={mode === "auto"} onChange={() => setMode("auto")} disabled={busy} />
                  <strong>Automatic</strong><span>Use embedded text, OCR scanned pages</span><em>Recommended</em>
                </label>
                <label className={mode === "ocr" ? "active" : ""}>
                  <input type="radio" name="ocr-mode" checked={mode === "ocr"} onChange={() => setMode("ocr")} disabled={busy} />
                  <strong>OCR every page</strong><span>Best for scans and image-only PDFs</span>
                </label>
                <label className={mode === "text" ? "active" : ""}>
                  <input type="radio" name="ocr-mode" checked={mode === "text"} onChange={() => setMode("text")} disabled={busy} />
                  <strong>Text layer only</strong><span>Fastest; skips image recognition</span>
                </label>
              </div>
            </fieldset>

            <fieldset className="utility-fieldset">
              <legend>Pages to process</legend>
              <div className="utility-choice-row">
                <label><input type="radio" checked={applyTo === "all"} onChange={() => setApplyTo("all")} disabled={busy} /> All pages</label>
                <label><input type="radio" checked={applyTo === "range"} onChange={() => setApplyTo("range")} disabled={busy} /> Selected pages</label>
              </div>
              {applyTo === "range" ? <label className="utility-field"><span>Page range</span><input value={range} onChange={(event) => setRange(event.target.value)} placeholder="1-3, 6, 9" disabled={busy} /></label> : null}
              {selection.error ? <p className="split-range-error">{selection.error}</p> : null}
            </fieldset>

            <div className="ocr-settings-grid">
              <label className="utility-field">
                <span>OCR language</span>
                <select value={language} onChange={(event) => setLanguage(event.target.value as OcrLanguage)} disabled={busy || mode === "text"}>
                  {OCR_LANGUAGES.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}
                </select>
              </label>
              <label className="utility-field">
                <span>OCR resolution: {dpi} DPI</span>
                <input type="range" min="144" max="300" step="12" value={dpi} onChange={(event) => setDpi(Number(event.target.value))} disabled={busy || mode === "text"} />
              </label>
            </div>

            <div className="ocr-output-options">
              <label className="utility-check"><input type="checkbox" checked={includePageHeadings} onChange={(event) => setIncludePageHeadings(event.target.checked)} disabled={busy} /> Add page headings to TXT output</label>
            </div>

            {mode !== "text" ? (
              <p className="ocr-language-note">The OCR engine and selected language model are downloaded when first needed. PDF pages and recognised text are never sent to that provider or to DearPDF.</p>
            ) : null}

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
                  aria-label="OCR file name"
                  onChange={(event) => setOutputName(event.target.value)}
                  onBlur={() => setOutputName(ocrDownloadBase(outputName, safeBaseName(selected.file.name)))}
                />
              </label>
              <span>{orderedSelection.length} pages selected</span>
              <div className="ocr-action-buttons">
                {busy && work.kind === "working" ? <button className="text-button ocr-cancel" type="button" onClick={cancelExtraction}>Cancel</button> : null}
                <button className="merge-button" type="button" disabled={busy || !orderedSelection.length || Boolean(selection.error)} onClick={() => void extractText()}>
                  {work.kind === "working" ? "Processing…" : `Read ${orderedSelection.length} ${orderedSelection.length === 1 ? "page" : "pages"}`}
                </button>
              </div>
            </div>
            {savedNotice ? <p className="page-numbers-saved" role="status">{savedNotice}</p> : null}

            {result ? (
              <div className="ocr-results">
                <div>
                  <span className="pdf-tool-status">Complete</span>
                  <h3>{result.ocrPages + result.textPages} pages read</h3>
                  <p>{result.ocrPages} OCR · {result.textPages} text layer{result.averageConfidence !== null ? ` · ${result.averageConfidence}% average OCR confidence` : ""}</p>
                </div>
                <div className="ocr-result-actions">
                  <button type="button" onClick={() => void copyText()}>{copied ? "Copied" : "Copy text"}</button>
                  <button type="button" onClick={downloadText}>Download TXT</button>
                  {result.searchablePdf ? <button type="button" onClick={downloadSearchablePdf}>Save searchable PDF</button> : null}
                </div>
                <div className="text-preview"><strong>Extracted text preview</strong><pre>{result.text.slice(0, 6_000)}</pre></div>
              </div>
            ) : null}
          </div>
        )}

        {work.kind !== "idle" ? <p className={`pdf-work-message ${work.kind}`} role={work.kind === "error" ? "alert" : "status"}>{work.message}</p> : null}
      </section>
    </StitchToolShell>
  );
}
