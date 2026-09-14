"use client";

import { useMemo, useRef, useState } from "react";
import PdfPageWorkspace from "../../../components/pdf-page-workspace";
import {
  PdfLazyPreviewControls,
  PdfLazyPreviewStatus,
  usePdfLazyPreviews,
} from "../../../components/pdf-lazy-previews";
import StitchToolShell from "../../../components/StitchToolShell";
import { downloadGeneratedFile } from "../../../lib/browser-download";
import {
  extractLinesFromTextItems,
  summarizeExtractive,
  type ExtractiveSummary,
  type SummaryLength,
} from "../../../lib/on-device-summary";
import { useIncomingPdfHandoff } from "../../../lib/pdf-tool-handoff";
import { inspectPdf, parsePageSelection } from "../../../lib/pdf-tools";
import { getPageTextContent, loadPdfDocument } from "../../../lib/pdfjs";
import { trackToolEvent } from "../../../lib/stats";

type SelectedPdf = { file: File; bytes: ArrayBuffer; pageCount: number };
type WorkState = { kind: "idle" } | { kind: "reading" | "working" | "error"; message: string };

const LENGTH_OPTIONS: Array<{ value: SummaryLength; label: string; hint: string }> = [
  { value: "short", label: "Short", hint: "A few key points" },
  { value: "medium", label: "Medium", hint: "Balanced overview" },
  { value: "long", label: "Long", hint: "More detail" },
];

function safeBaseName(name: string) {
  return name.replace(/\.pdf$/i, "").replace(/[^\p{L}\p{N}._-]+/gu, "-") || "document";
}

function summaryDownloadBase(name: string, fallback: string) {
  const trimmed = name.trim() || fallback;
  const base = trimmed
    .replace(/\.(pdf|txt)$/i, "")
    .replace(/[^\p{L}\p{N}._ -]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^[\s.-]+|[\s.-]+$/g, "");
  return base || "summary";
}

function readableSummaryError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/undefined is not a function/i.test(message) || /near '\.\.\.[te] of [te]/i.test(message)) {
    return "This browser could not read the PDF text layer. Try the latest Safari or Chrome.";
  }
  if (message) return message;
  return "This PDF could not be summarised.";
}

export default function AiSummaryPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelledRef = useRef(false);
  const [selected, setSelected] = useState<SelectedPdf | null>(null);
  const {
    pages: visualPages,
    setPages: setVisualPages,
    previewState,
    previewProgress,
    loadPreviews,
    hidePreviews,
    resetPreviews,
  } = usePdfLazyPreviews("ai-summary");
  const [applyTo, setApplyTo] = useState<"all" | "range">("all");
  const [range, setRange] = useState("");
  const [length, setLength] = useState<SummaryLength>("medium");
  const [outputName, setOutputName] = useState("summary");
  const [savedNotice, setSavedNotice] = useState("");
  const [result, setResult] = useState<ExtractiveSummary | null>(null);
  const [pagesRead, setPagesRead] = useState(0);
  const [copied, setCopied] = useState(false);
  const [work, setWork] = useState<WorkState>({ kind: "idle" });
  const busy = work.kind === "reading" || work.kind === "working";
  useIncomingPdfHandoff(chooseFile);

  const selection = useMemo(() => {
    if (!selected) return { pages: [] as number[], error: "" };
    if (applyTo === "all") {
      return {
        pages: Array.from({ length: selected.pageCount }, (_, index) => index),
        error: "",
      };
    }
    try {
      return { pages: parsePageSelection(range, selected.pageCount), error: "" };
    } catch (error) {
      return {
        pages: [] as number[],
        error: error instanceof Error ? error.message : "Invalid page range.",
      };
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
      setOutputName(`${safeBaseName(file.name)}-summary`);
      setSavedNotice("");
      setResult(null);
      setPagesRead(0);
      setCopied(false);
      setWork({ kind: "idle" });
    } catch {
      resetPreviews();
      setSelected(null);
      setWork({ kind: "error", message: "Choose a valid, unlocked PDF file." });
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  function cancelSummary() {
    cancelledRef.current = true;
    setWork({ kind: "working", message: "Stopping…" });
  }

  async function runSummary() {
    if (!selected || !orderedSelection.length) return;
    cancelledRef.current = false;
    setResult(null);
    setCopied(false);
    setSavedNotice("");
    setWork({
      kind: "working",
      message: `Reading text from ${orderedSelection.length} ${orderedSelection.length === 1 ? "page" : "pages"}…`,
    });
    trackToolEvent("ai-summary", "start");

    let pdf: Awaited<ReturnType<typeof loadPdfDocument>> | null = null;

    try {
      pdf = await loadPdfDocument(selected.bytes);
      const sections: string[] = [];

      for (let selectionIndex = 0; selectionIndex < orderedSelection.length; selectionIndex += 1) {
        if (cancelledRef.current) throw new Error("SUMMARY_CANCELLED");
        const pageIndex = orderedSelection[selectionIndex];
        setWork({
          kind: "working",
          message: `Reading page ${pageIndex + 1} (${selectionIndex + 1} of ${orderedSelection.length})…`,
        });
        const page = await pdf.getPage(pageIndex + 1);
        const content = await getPageTextContent(page);
        const pageText = extractLinesFromTextItems(content.items).trim();
        if (pageText) sections.push(pageText);
      }

      if (cancelledRef.current) throw new Error("SUMMARY_CANCELLED");

      const combined = sections.join("\n\n").trim();
      if (!combined || combined.replace(/\s/g, "").length < 40) {
        throw new Error(
          "No usable text was found. Scanned or image-only PDFs need OCR first — try PDF OCR, then summarise.",
        );
      }

      setWork({ kind: "working", message: "Building a private summary on this device…" });
      // Yield so the status line paints before CPU-heavy scoring on large docs.
      await new Promise((resolve) => window.setTimeout(resolve, 16));
      if (cancelledRef.current) throw new Error("SUMMARY_CANCELLED");

      const summary = summarizeExtractive(combined, length);
      if (!summary.bullets.length) {
        throw new Error("Not enough sentences to summarise. Try more pages or a different PDF.");
      }

      setResult(summary);
      setPagesRead(orderedSelection.length);
      setSavedNotice(
        `Summarised ${orderedSelection.length} ${orderedSelection.length === 1 ? "page" : "pages"} · ${summary.selectedCount} key points from ${summary.sentenceCount} sentences. Nothing left this device.`,
      );
      trackToolEvent("ai-summary", "success");
      setWork({ kind: "idle" });
    } catch (error) {
      if (cancelledRef.current || (error instanceof Error && error.message === "SUMMARY_CANCELLED")) {
        trackToolEvent("ai-summary", "cancel");
        setWork({ kind: "idle" });
      } else {
        trackToolEvent("ai-summary", "error");
        setWork({ kind: "error", message: readableSummaryError(error) });
      }
    } finally {
      if (pdf) {
        try {
          pdf.cleanup();
        } catch {
          // ignore
        }
      }
    }
  }

  function downloadText() {
    if (!selected || !result) return;
    const base = summaryDownloadBase(outputName, `${safeBaseName(selected.file.name)}-summary`);
    downloadGeneratedFile(
      new Blob([result.fullText], { type: "text/plain;charset=utf-8" }),
      `${base}.txt`,
    );
  }

  async function copyText() {
    if (!result?.fullText) return;
    try {
      await navigator.clipboard.writeText(result.fullText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setWork({ kind: "error", message: "Could not copy. Download the TXT file instead." });
    }
  }

  return (
    <StitchToolShell
      title="AI Summary of PDF"
      subtitle="Private summary that runs in your browser — nothing leaves this device."
      className={`utility-pdf-page${selected ? " has-file" : ""}`}
      note="On-device summary picks the most important sentences from your PDF text. Scanned PDFs need OCR first."
      related={[
        { href: "/pdf-tools/pdf-to-text", label: "PDF OCR" },
        { href: "/pdf-tools/pdf-to-word", label: "PDF to Word" },
      ]}
    >
      <section className="merge-workspace utility-workspace">
        <div className="merge-workspace-heading">
          <div>
            <h2>Source PDF</h2>
            <p>
              {selected
                ? `${selected.pageCount} pages · ${orderedSelection.length} selected`
                : "Choose one PDF file"}
            </p>
          </div>
          {selected && !busy ? (
            <div className="organise-heading-actions">
              <PdfLazyPreviewControls
                previewState={previewState}
                onShow={() => {
                  if (selected) {
                    void loadPreviews(selected.bytes).catch(() =>
                      setWork({ kind: "error", message: "Page previews could not be created for this PDF." }),
                    );
                  }
                }}
                onHide={hidePreviews}
              />
              <button
                className="text-button"
                onClick={() => {
                  resetPreviews();
                  setSelected(null);
                  setResult(null);
                  setSavedNotice("");
                }}
                type="button"
              >
                Remove file
              </button>
            </div>
          ) : null}
        </div>

        {!selected ? (
          <label
            className="pdf-drop-zone"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              void chooseFile(event.dataTransfer.files[0]);
            }}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,application/pdf"
              onChange={(event) => void chooseFile(event.target.files?.[0])}
            />
            <span className="drop-zone-mark" aria-hidden="true">
              ＋
            </span>
            <strong>Choose a PDF file</strong>
            <span>or drag and drop it here</span>
          </label>
        ) : (
          <div className="utility-controls">
            <PdfLazyPreviewStatus previewState={previewState} previewProgress={previewProgress} />
            {previewState === "ready" ? (
              <PdfPageWorkspace
                pages={visualPages}
                selectedIds={visualPages
                  .filter((page) => selection.pages.includes(page.pageIndex))
                  .map((page) => page.id)}
                onSelectedIdsChange={(ids) => {
                  const idSet = new Set(ids);
                  setApplyTo("range");
                  setRange(
                    visualPages
                      .filter((page) => idSet.has(page.id))
                      .map((page) => page.pageIndex + 1)
                      .join(", "),
                  );
                }}
                onReorder={(orderedIds) =>
                  setVisualPages(orderedIds.map((id) => visualPages.find((page) => page.id === id)!).filter(Boolean))
                }
                disabled={busy}
                title="Select pages to include in the summary"
              />
            ) : null}

            <fieldset className="utility-fieldset">
              <legend>Pages to include</legend>
              <div className="utility-choice-row">
                <label>
                  <input
                    type="radio"
                    checked={applyTo === "all"}
                    onChange={() => setApplyTo("all")}
                    disabled={busy}
                  />{" "}
                  All pages
                </label>
                <label>
                  <input
                    type="radio"
                    checked={applyTo === "range"}
                    onChange={() => setApplyTo("range")}
                    disabled={busy}
                  />{" "}
                  Selected pages
                </label>
              </div>
              {applyTo === "range" ? (
                <label className="utility-field">
                  <span>Page range</span>
                  <input
                    value={range}
                    onChange={(event) => setRange(event.target.value)}
                    placeholder="1-3, 6, 9"
                    disabled={busy}
                  />
                </label>
              ) : null}
              {selection.error ? <p className="split-range-error">{selection.error}</p> : null}
            </fieldset>

            <fieldset className="utility-fieldset">
              <legend>Summary length</legend>
              <div className="ocr-mode-grid">
                {LENGTH_OPTIONS.map((option) => (
                  <label key={option.value} className={length === option.value ? "active" : ""}>
                    <input
                      type="radio"
                      name="summary-length"
                      checked={length === option.value}
                      onChange={() => setLength(option.value)}
                      disabled={busy}
                    />
                    <strong>{option.label}</strong>
                    <span>{option.hint}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <p className="ocr-language-note">
              On-device summary — private summary that runs in your browser. Uses the PDF’s own text
              layer; no cloud AI and no model download.
            </p>

            <div className="utility-action-row">
              <label className="merge-output-name">
                <span>File name</span>
                <input
                  type="text"
                  value={outputName}
                  spellCheck={false}
                  autoComplete="off"
                  disabled={busy}
                  aria-label="Summary file name"
                  onChange={(event) => setOutputName(event.target.value)}
                  onBlur={() =>
                    setOutputName(
                      summaryDownloadBase(outputName, `${safeBaseName(selected.file.name)}-summary`),
                    )
                  }
                />
              </label>
              <span>
                {orderedSelection.length} {orderedSelection.length === 1 ? "page" : "pages"} selected
              </span>
              <div className="ocr-action-buttons">
                {busy && work.kind === "working" ? (
                  <button className="text-button ocr-cancel" type="button" onClick={cancelSummary}>
                    Cancel
                  </button>
                ) : null}
                <button
                  className="merge-button"
                  type="button"
                  disabled={busy || !orderedSelection.length || Boolean(selection.error)}
                  onClick={() => void runSummary()}
                >
                  {work.kind === "working" ? "Summarising…" : "Summarise on this device"}
                </button>
              </div>
            </div>

            {savedNotice ? (
              <p className="page-numbers-saved" role="status">
                {savedNotice}
              </p>
            ) : null}

            {result ? (
              <div className="ocr-results">
                <div>
                  <span className="pdf-tool-status">On-device summary</span>
                  <h3>
                    {result.selectedCount} key points · {pagesRead}{" "}
                    {pagesRead === 1 ? "page" : "pages"}
                  </h3>
                  <p>
                    Private summary (runs in your browser) · {result.wordCount.toLocaleString()} words
                    read · {result.sentenceCount} sentences scored
                  </p>
                </div>
                <div className="ocr-result-actions">
                  <button type="button" onClick={() => void copyText()}>
                    {copied ? "Copied" : "Copy summary"}
                  </button>
                  <button type="button" onClick={downloadText}>
                    Download TXT
                  </button>
                </div>
                <div className="text-preview">
                  <strong>Key points</strong>
                  <ul className="ai-summary-bullets">
                    {result.bullets.map((bullet, index) => (
                      <li key={`${index}-${bullet.slice(0, 24)}`}>{bullet}</li>
                    ))}
                  </ul>
                  <strong>Summary</strong>
                  <pre>{result.paragraph}</pre>
                </div>
              </div>
            ) : null}
          </div>
        )}

        {work.kind !== "idle" ? (
          <p className={`pdf-work-message ${work.kind}`} role={work.kind === "error" ? "alert" : "status"}>
            {work.message}
          </p>
        ) : null}
      </section>
    </StitchToolShell>
  );
}
