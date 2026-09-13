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
  extractPdfPages,
  formatPageSelection,
  inspectPdf,
  parsePageSelection,
  splitPdfEveryNPagesZip,
  splitPdfIntoEqualPartsZip,
  splitPdfIntoZip,
} from "../../../lib/pdf-tools";
import StitchToolShell from "../../../components/StitchToolShell";

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

function suggestedExtractName(fileName: string, pageIndices: number[]) {
  const base = safeBaseName(fileName);
  if (!pageIndices.length) return `${base}-pages.pdf`;
  const pages = formatPageSelection(pageIndices).replace(/,\s*/g, "_");
  return `${base}-pp-${pages}.pdf`;
}

function splitDownloadName(name: string, fallback: string) {
  const trimmed = name.trim() || fallback;
  const base = trimmed.replace(/\.pdf$/i, "").replace(/[^\p{L}\p{N}._ -]+/gu, "-").replace(/-+/g, "-").replace(/^[\s.-]+|[\s.-]+$/g, "");
  return `${base || "pages"}.pdf`;
}

function downloadBytes(bytes: Uint8Array, type: string, fileName: string) {
  void type;
  downloadGeneratedFile(bytes as BlobPart, fileName);
}

function readablePdfError(error: unknown, fileName?: string) {
  const message = error instanceof Error ? error.message : "";
  if (/encrypted/i.test(message)) {
    return `${fileName ?? "This PDF"} is password-protected. Remove its password before splitting.`;
  }
  return fileName ? `${fileName} could not be read as a valid PDF.` : message || "The PDF could not be processed.";
}

export default function SplitPdfPage() {
  const [selected, setSelected] = useState<SelectedPdf | null>(null);
  const { pages, setPages, previewState, previewProgress, loadPreviews, hidePreviews, resetPreviews } = usePdfLazyPreviews("split");
  const [pageOrderDirty, setPageOrderDirty] = useState(false);
  const [range, setRange] = useState("");
  const [outputName, setOutputName] = useState("pages.pdf");
  const [outputNameCustom, setOutputNameCustom] = useState(false);
  const [extractNotice, setExtractNotice] = useState("");
  const [partCountInput, setPartCountInput] = useState("2");
  const [pagesPerFileInput, setPagesPerFileInput] = useState("2");
  const [work, setWork] = useState<WorkState>({ kind: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = work.kind === "reading" || work.kind === "working";
  useIncomingPdfHandoff(chooseFile);

  const rangeResult = useMemo(() => {
    if (!selected || !range.trim()) return { pages: [] as number[], error: "" };
    try {
      return { pages: parsePageSelection(range, selected.pageCount), error: "" };
    } catch (error) {
      return { pages: [] as number[], error: error instanceof Error ? error.message : "Invalid page range." };
    }
  }, [range, selected]);

  const equalPartsResult = useMemo(() => {
    const partCount = Number(partCountInput);
    if (!selected) return { partCount: 0, sizes: [] as number[], error: "" };
    if (!partCountInput.trim()) return { partCount: 0, sizes: [] as number[], error: "Enter the number of parts." };
    if (!Number.isInteger(partCount) || partCount < 2) {
      return { partCount: 0, sizes: [] as number[], error: "Enter a whole number of at least 2." };
    }
    if (partCount > selected.pageCount) {
      return { partCount: 0, sizes: [] as number[], error: `Choose no more than ${selected.pageCount} parts.` };
    }
    const pagesPerPart = Math.floor(selected.pageCount / partCount);
    const extraPages = selected.pageCount % partCount;
    return {
      partCount,
      sizes: Array.from({ length: partCount }, (_, index) => pagesPerPart + (index < extraPages ? 1 : 0)),
      error: "",
    };
  }, [partCountInput, selected]);

  const everyNResult = useMemo(() => {
    const pagesPerFile = Number(pagesPerFileInput);
    if (!selected) return { pagesPerFile: 0, sizes: [] as number[], error: "" };
    if (!pagesPerFileInput.trim()) return { pagesPerFile: 0, sizes: [] as number[], error: "Enter pages per file." };
    if (!Number.isInteger(pagesPerFile) || pagesPerFile < 1) {
      return { pagesPerFile: 0, sizes: [] as number[], error: "Enter a whole number of at least 1." };
    }
    if (selected.pageCount < 2) {
      return { pagesPerFile: 0, sizes: [] as number[], error: "This PDF has only one page." };
    }
    if (pagesPerFile >= selected.pageCount) {
      return { pagesPerFile: 0, sizes: [] as number[], error: `Choose fewer than ${selected.pageCount} pages per file.` };
    }
    const sizes: number[] = [];
    for (let remaining = selected.pageCount; remaining > 0; remaining -= pagesPerFile) {
      sizes.push(Math.min(pagesPerFile, remaining));
    }
    return { pagesPerFile, sizes, error: "" };
  }, [pagesPerFileInput, selected]);

  const maxPartCount = selected?.pageCount ?? 2;
  const parsedPartCount = Number(partCountInput);
  const canDecreaseParts = Number.isInteger(parsedPartCount) && parsedPartCount > 2;
  const canIncreaseParts = Number.isInteger(parsedPartCount) && parsedPartCount < maxPartCount;

  const maxPagesPerFile = selected ? Math.max(1, selected.pageCount - 1) : 1;
  const parsedPagesPerFile = Number(pagesPerFileInput);
  const canDecreasePagesPerFile = Number.isInteger(parsedPagesPerFile) && parsedPagesPerFile > 1;
  const canIncreasePagesPerFile = Number.isInteger(parsedPagesPerFile) && parsedPagesPerFile < maxPagesPerFile;

  function adjustPartCount(delta: number) {
    if (!selected) return;
    const current = Number(partCountInput);
    const base = Number.isInteger(current) ? current : delta > 0 ? 1 : 2;
    const next = Math.min(selected.pageCount, Math.max(2, base + delta));
    setPartCountInput(String(next));
  }

  function adjustPagesPerFile(delta: number) {
    if (!selected) return;
    const current = Number(pagesPerFileInput);
    const base = Number.isInteger(current) ? current : delta > 0 ? 0 : 2;
    const next = Math.min(Math.max(1, selected.pageCount - 1), Math.max(1, base + delta));
    setPagesPerFileInput(String(next));
  }

  async function chooseFile(file?: File) {
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setWork({ kind: "error", message: "Choose a PDF file." });
      return;
    }

    setWork({ kind: "reading", message: "Checking the PDF on this device…" });
    resetPreviews();
    try {
      const bytes = await file.arrayBuffer();
      const { pageCount } = await inspectPdf(bytes);
      setSelected({ file, bytes, pageCount });
      setPageOrderDirty(false);
      setRange("");
      setOutputName(suggestedExtractName(file.name, []));
      setOutputNameCustom(false);
      setExtractNotice("");
      setPartCountInput("2");
      setPagesPerFileInput("2");
      setWork({ kind: "idle" });
    } catch (error) {
      resetPreviews();
      setSelected(null);
      setWork({ kind: "error", message: readablePdfError(error, file.name) });
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  function clearFile() {
    resetPreviews();
    setSelected(null);
    setPageOrderDirty(false);
    setRange("");
    setOutputName("pages.pdf");
    setOutputNameCustom(false);
    setExtractNotice("");
    setPartCountInput("2");
    setPagesPerFileInput("2");
    setWork({ kind: "idle" });
  }

  async function showPreviews() {
    if (!selected) return;
    try {
      await loadPreviews(selected.bytes);
      setPageOrderDirty(false);
    } catch (error) {
      setWork({ kind: "error", message: readablePdfError(error, selected.file.name) });
    }
  }

  function hideVisualPreviews() {
    hidePreviews();
    setPageOrderDirty(false);
  }

  function applyRange(next: string) {
    setRange(next);
    setPageOrderDirty(false);
    if (outputNameCustom || !selected) return;
    try {
      const pages = next.trim() ? parsePageSelection(next, selected.pageCount) : [];
      setOutputName(suggestedExtractName(selected.file.name, pages));
    } catch {
      setOutputName(suggestedExtractName(selected.file.name, []));
    }
  }

  function toggleExtractPage(pageNumber: number) {
    if (!selected) return;
    const current = new Set(rangeResult.pages);
    const index = pageNumber - 1;
    if (current.has(index)) current.delete(index);
    else current.add(index);
    applyRange(formatPageSelection([...current]));
  }

  async function extractPages() {
    if (!selected || rangeResult.error || !rangeResult.pages.length) return;
    setWork({ kind: "working", message: "Creating the extracted PDF on this device…" });
    try {
      const selectedSet = new Set(rangeResult.pages);
      const pageIndices = pageOrderDirty
        ? pages.filter((page) => selectedSet.has(page.pageIndex)).map((page) => page.pageIndex)
        : rangeResult.pages;
      const bytes = await extractPdfPages(selected.bytes, pageIndices);
      const name = splitDownloadName(outputName, suggestedExtractName(selected.file.name, pageIndices));
      downloadBytes(bytes, "application/pdf", name);
      setExtractNotice(`Saved ${name}. The original PDF is still here — pick another range if you need it.`);
      setWork({ kind: "idle" });
    } catch (error) {
      setWork({ kind: "error", message: readablePdfError(error) });
    }
  }

  async function splitEveryPage() {
    if (!selected) return;
    setWork({ kind: "working", message: `Creating ${selected.pageCount} separate PDFs and packing them into a ZIP…` });
    try {
      const baseName = safeBaseName(selected.file.name);
      const bytes = await splitPdfIntoZip(selected.bytes, baseName);
      downloadBytes(bytes, "application/zip", `${baseName}-split-pages.zip`);
      setWork({ kind: "idle" });
    } catch (error) {
      setWork({ kind: "error", message: readablePdfError(error) });
    }
  }

  async function splitEveryNPages() {
    if (!selected || everyNResult.error || !everyNResult.pagesPerFile) return;
    setWork({
      kind: "working",
      message: `Creating ${everyNResult.sizes.length} PDFs of up to ${everyNResult.pagesPerFile} pages and packing them into a ZIP…`,
    });
    try {
      const baseName = safeBaseName(selected.file.name);
      const bytes = await splitPdfEveryNPagesZip(selected.bytes, everyNResult.pagesPerFile, baseName);
      downloadBytes(bytes, "application/zip", `${baseName}-every-${everyNResult.pagesPerFile}-pages.zip`);
      setWork({ kind: "idle" });
    } catch (error) {
      setWork({ kind: "error", message: readablePdfError(error) });
    }
  }

  async function splitIntoEqualParts() {
    if (!selected || equalPartsResult.error || !equalPartsResult.partCount) return;
    setWork({
      kind: "working",
      message: `Creating ${equalPartsResult.partCount} nearly equal PDFs and packing them into a ZIP…`,
    });
    try {
      const baseName = safeBaseName(selected.file.name);
      const bytes = await splitPdfIntoEqualPartsZip(
        selected.bytes,
        equalPartsResult.partCount,
        baseName,
      );
      downloadBytes(bytes, "application/zip", `${baseName}-${equalPartsResult.partCount}-parts.zip`);
      setWork({ kind: "idle" });
    } catch (error) {
      setWork({ kind: "error", message: readablePdfError(error) });
    }
  }

  return (
    <StitchToolShell
      title="Split & Extract PDF"
      subtitle="Keep selected pages together or save every page separately."
      className={`split-page${selected ? " has-file" : ""}`}
    >
      <section className="merge-workspace" aria-labelledby="split-workspace-title">
        <div className="merge-workspace-heading">
          <div>
            <h2 id="split-workspace-title">Source PDF</h2>
            <p>{selected ? `${selected.pageCount} pages · ${formatBytes(selected.file.size)}` : "Choose one PDF file"}</p>
          </div>
          {selected ? (
            <div className="organise-heading-actions">
              <PdfLazyPreviewControls
                previewState={previewState}
                onShow={() => void showPreviews()}
                onHide={hideVisualPreviews}
                disabled={busy}
              />
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
            <div className="split-source-file">
              <span className="pdf-file-icon" aria-hidden="true">PDF</span>
              <span className="pdf-file-name">
                <strong>{selected.file.name}</strong>
                <small>{selected.pageCount} pages · {formatBytes(selected.file.size)}</small>
              </span>
            </div>

            <PdfLazyPreviewStatus previewState={previewState} previewProgress={previewProgress} />
            {previewState === "ready" ? (
            <PdfPageWorkspace
              pages={pages}
              selectedIds={pages.filter((page) => rangeResult.pages.includes(page.pageIndex)).map((page) => page.id)}
              onSelectedIdsChange={(ids) => {
                const selectedIdSet = new Set(ids);
                applyRange(
                  formatPageSelection(
                    pages.filter((page) => selectedIdSet.has(page.id)).map((page) => page.pageIndex),
                  ),
                );
                setPageOrderDirty(true);
              }}
              onReorder={(orderedIds) => {
                setPages(orderedIds.map((id) => pages.find((page) => page.id === id)!).filter(Boolean));
                setPageOrderDirty(true);
              }}
              disabled={busy}
              title="Select, preview, and drag extracted pages into order"
            />
            ) : null}

            <div className="split-option-grid">
              <section className="split-option">
                <span className="pdf-tool-status">OPTION 1</span>
                <h2>Extract selected pages</h2>
                <p>Tap page numbers or type a range. They stay together in one new PDF. The original file remains after download.</p>
                <div className="split-page-picks" role="group" aria-label="Pages to extract">
                  {Array.from({ length: selected.pageCount }, (_, index) => {
                    const pageNumber = index + 1;
                    const on = rangeResult.pages.includes(index);
                    return (
                      <button
                        key={pageNumber}
                        type="button"
                        className={on ? "is-on" : undefined}
                        aria-pressed={on}
                        disabled={busy}
                        onClick={() => toggleExtractPage(pageNumber)}
                      >
                        {pageNumber}
                      </button>
                    );
                  })}
                </div>
                <div className="split-page-pick-actions">
                  <button type="button" className="text-button" disabled={busy} onClick={() => applyRange(`1-${selected.pageCount}`)}>Select all</button>
                  <button type="button" className="text-button" disabled={busy || !range} onClick={() => applyRange("")}>Clear</button>
                </div>
                <label className="split-range-field">
                  <span>Pages to extract</span>
                  <input
                    value={range}
                    onChange={(event) => applyRange(event.target.value)}
                    placeholder="1-3, 6, 9-12"
                    aria-invalid={Boolean(rangeResult.error)}
                    disabled={busy}
                  />
                  <small>Example: 1-3, 6, 9-12</small>
                </label>
                <label className="split-range-field merge-output-name">
                  <span>File name</span>
                  <input
                    type="text"
                    value={outputName}
                    spellCheck={false}
                    autoComplete="off"
                    disabled={busy}
                    aria-label="Extracted PDF file name"
                    onChange={(event) => {
                      setOutputNameCustom(true);
                      setOutputName(event.target.value);
                    }}
                    onBlur={() => setOutputName(splitDownloadName(outputName, suggestedExtractName(selected.file.name, rangeResult.pages)))}
                  />
                </label>
                {rangeResult.error ? <p className="split-range-error" role="alert">{rangeResult.error}</p> : null}
                {extractNotice ? <p className="split-extract-notice" role="status">{extractNotice}</p> : null}
                <div className="split-option-action">
                  <span>{rangeResult.pages.length ? `${rangeResult.pages.length} ${rangeResult.pages.length === 1 ? "page" : "pages"} selected` : "Tap pages or enter a range"}</span>
                  <button type="button" className="merge-button" onClick={() => void extractPages()} disabled={busy || !rangeResult.pages.length || Boolean(rangeResult.error)}>
                    {work.kind === "working" ? "Working…" : "Extract pages"}
                  </button>
                </div>
              </section>

              <section className="split-option">
                <span className="pdf-tool-status">OPTION 2</span>
                <h2>Split after every N pages</h2>
                <p>Cut the file after every chosen number of pages. The last file keeps any leftover pages.</p>
                <div className="split-range-field">
                  <span id="split-every-n-label">Pages per file</span>
                  <div className="split-parts-stepper" role="group" aria-labelledby="split-every-n-label">
                    <button
                      type="button"
                      aria-label="Decrease pages per file"
                      disabled={busy || !canDecreasePagesPerFile}
                      onClick={() => adjustPagesPerFile(-1)}
                    >
                      −
                    </button>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={pagesPerFileInput}
                      onChange={(event) => {
                        const next = event.target.value;
                        if (/^\d*$/.test(next)) setPagesPerFileInput(next);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "ArrowUp") {
                          event.preventDefault();
                          adjustPagesPerFile(1);
                        } else if (event.key === "ArrowDown") {
                          event.preventDefault();
                          adjustPagesPerFile(-1);
                        }
                      }}
                      aria-labelledby="split-every-n-label"
                      aria-invalid={Boolean(everyNResult.error)}
                      disabled={busy}
                    />
                    <button
                      type="button"
                      aria-label="Increase pages per file"
                      disabled={busy || !canIncreasePagesPerFile}
                      onClick={() => adjustPagesPerFile(1)}
                    >
                      +
                    </button>
                  </div>
                  <small>Minimum 1 · Maximum {maxPagesPerFile}</small>
                </div>
                {everyNResult.error ? <p className="split-range-error" role="alert">{everyNResult.error}</p> : null}
                {!everyNResult.error && everyNResult.sizes.length ? (
                  <div className="split-parts-preview" aria-label="Pages in each PDF file">
                    {everyNResult.sizes.map((size, index) => (
                      <span key={index}>File {index + 1}: {size} {size === 1 ? "page" : "pages"}</span>
                    ))}
                  </div>
                ) : null}
                <div className="split-option-action">
                  <span>{everyNResult.sizes.length ? `${everyNResult.sizes.length} PDFs in one ZIP` : "Enter a valid number"}</span>
                  <button type="button" className="merge-button" onClick={() => void splitEveryNPages()} disabled={busy || Boolean(everyNResult.error) || !everyNResult.pagesPerFile}>
                    {work.kind === "working" ? "Working…" : "Split after every N"}
                  </button>
                </div>
              </section>

              <section className="split-option">
                <span className="pdf-tool-status">OPTION 3</span>
                <h2>Split into equal parts</h2>
                <p>Divide consecutive pages into 2, 3, or more PDFs. Any extra pages are placed in the first parts.</p>
                <div className="split-range-field">
                  <span id="split-parts-count-label">Number of parts</span>
                  <div className="split-parts-stepper" role="group" aria-labelledby="split-parts-count-label">
                    <button
                      type="button"
                      aria-label="Decrease number of parts"
                      disabled={busy || !canDecreaseParts}
                      onClick={() => adjustPartCount(-1)}
                    >
                      −
                    </button>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={partCountInput}
                      onChange={(event) => {
                        const next = event.target.value;
                        if (/^\d*$/.test(next)) setPartCountInput(next);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "ArrowUp") {
                          event.preventDefault();
                          adjustPartCount(1);
                        } else if (event.key === "ArrowDown") {
                          event.preventDefault();
                          adjustPartCount(-1);
                        }
                      }}
                      aria-labelledby="split-parts-count-label"
                      aria-invalid={Boolean(equalPartsResult.error)}
                      disabled={busy}
                    />
                    <button
                      type="button"
                      aria-label="Increase number of parts"
                      disabled={busy || !canIncreaseParts}
                      onClick={() => adjustPartCount(1)}
                    >
                      +
                    </button>
                  </div>
                  <small>Minimum 2 · Maximum {selected.pageCount}</small>
                </div>
                {equalPartsResult.error ? <p className="split-range-error" role="alert">{equalPartsResult.error}</p> : null}
                {!equalPartsResult.error && equalPartsResult.sizes.length ? (
                  <div className="split-parts-preview" aria-label="Pages in each PDF part">
                    {equalPartsResult.sizes.map((size, index) => (
                      <span key={index}>Part {index + 1}: {size} {size === 1 ? "page" : "pages"}</span>
                    ))}
                  </div>
                ) : null}
                <div className="split-option-action">
                  <span>{equalPartsResult.partCount ? `${equalPartsResult.partCount} PDFs in one ZIP` : "Enter a valid number"}</span>
                  <button type="button" className="merge-button" onClick={() => void splitIntoEqualParts()} disabled={busy || Boolean(equalPartsResult.error) || !equalPartsResult.partCount}>
                    {work.kind === "working" ? "Working…" : "Split into parts"}
                  </button>
                </div>
              </section>

              <section className="split-option">
                <span className="pdf-tool-status">OPTION 4</span>
                <h2>Split every page</h2>
                <p>Turn all {selected.pageCount} pages into individual one-page PDFs, neatly numbered in a ZIP file.</p>
                <div className="split-file-example">
                  <span>{safeBaseName(selected.file.name)}-page-01.pdf</span>
                  <span>{safeBaseName(selected.file.name)}-page-02.pdf</span>
                  <span>…</span>
                </div>
                <div className="split-option-action">
                  <span>{selected.pageCount} PDFs in one ZIP</span>
                  <button type="button" className="merge-button" onClick={() => void splitEveryPage()} disabled={busy}>
                    {work.kind === "working" ? "Working…" : "Split & download ZIP"}
                  </button>
                </div>
              </section>
            </div>
          </>
        )}

        {work.kind !== "idle" ? (
          <p className={`pdf-work-message ${work.kind}`} role={work.kind === "error" ? "alert" : "status"}>
            {work.message}
          </p>
        ) : null}
      </section>

      {selected && selected.file.size > 100 * 1024 * 1024 ? (
        <p className="large-file-note">This file is larger than 100 MB. Processing may be slow or fail on a device with limited memory.</p>
      ) : null}
    </StitchToolShell>
  );
}
