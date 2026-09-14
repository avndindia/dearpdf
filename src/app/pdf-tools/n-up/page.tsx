"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import PdfNextStepSelector from "../../../components/pdf-next-step-selector";
import StitchToolShell from "../../../components/StitchToolShell";
import { renderPdfPageThumbnails } from "../../../components/pdf-page-workspace";
import { downloadGeneratedFile } from "../../../lib/browser-download";
import { useIncomingPdfHandoff } from "../../../lib/pdf-tool-handoff";
import { inspectPdf } from "../../../lib/pdf-tools";
import {
  nUpGrid,
  nUpPdf,
  sheetSizeForNUp,
  type NUpOrientation,
  type NUpPagesPerSheet,
  type NUpPaperSize,
} from "../../../lib/pdf-extra-tools";
import { trackToolEvent } from "../../../lib/stats";

type SelectedPdf = { file: File; bytes: ArrayBuffer; pageCount: number };
type WorkState = { kind: "idle" } | { kind: "reading" | "working" | "error"; message: string };

const LAYOUTS: NUpPagesPerSheet[] = [2, 4, 6, 9, 16];

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function safeBaseName(fileName: string) {
  return fileName.replace(/\.pdf$/i, "").replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "") || "document";
}

export default function NUpPdfPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<SelectedPdf | null>(null);
  const [pagesPerSheet, setPagesPerSheet] = useState<NUpPagesPerSheet>(4);
  const [paperSize, setPaperSize] = useState<NUpPaperSize>("a4");
  const [orientation, setOrientation] = useState<NUpOrientation>("portrait");
  const [margin, setMargin] = useState(36);
  const [gap, setGap] = useState(12);
  const [cellBorder, setCellBorder] = useState(true);
  const [outputName, setOutputName] = useState("n-up.pdf");
  const [work, setWork] = useState<WorkState>({ kind: "idle" });
  const [previewThumbs, setPreviewThumbs] = useState<string[]>([]);
  const [previewError, setPreviewError] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [sheetIndex, setSheetIndex] = useState(0);
  const busy = work.kind === "reading" || work.kind === "working";
  useIncomingPdfHandoff(chooseFile);

  const grid = nUpGrid(pagesPerSheet);
  const sheet = sheetSizeForNUp(paperSize, orientation);
  const cellsPerSheet = grid.cols * grid.rows;

  const sheetCount = useMemo(() => {
    if (!selected) return 0;
    return Math.ceil(selected.pageCount / cellsPerSheet);
  }, [cellsPerSheet, selected]);

  const safeSheetIndex = Math.min(sheetIndex, Math.max(0, sheetCount - 1));

  const sheetPageIndexes = useMemo(() => {
    if (!selected) return [] as number[];
    const start = safeSheetIndex * cellsPerSheet;
    return Array.from({ length: cellsPerSheet }, (_, slot) => start + slot).filter(
      (index) => index < selected.pageCount,
    );
  }, [cellsPerSheet, safeSheetIndex, selected]);

  async function chooseFile(file?: File) {
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setWork({ kind: "error", message: "Choose a PDF file." });
      return;
    }
    setWork({ kind: "reading", message: "Reading the PDF…" });
    try {
      const bytes = await file.arrayBuffer();
      const { pageCount } = await inspectPdf(bytes);
      setSelected({ file, bytes, pageCount });
      setSheetIndex(0);
      setOutputName(`${safeBaseName(file.name)}-${pagesPerSheet}up.pdf`);
      setWork({ kind: "idle" });
    } catch {
      setSelected(null);
      setWork({ kind: "error", message: "This file could not be read. Unlock password-protected PDFs first." });
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  function clearFile() {
    setSelected(null);
    setPreviewThumbs([]);
    setPreviewError("");
    setPreviewLoading(false);
    setSheetIndex(0);
    setOutputName("n-up.pdf");
    setWork({ kind: "idle" });
  }

  useEffect(() => {
    if (!selected) {
      setPreviewThumbs([]);
      setPreviewError("");
      setPreviewLoading(false);
      return;
    }
    let cancelled = false;
    setPreviewThumbs([]);
    setPreviewError("");
    setPreviewLoading(true);
    void (async () => {
      try {
        const pages = await renderPdfPageThumbnails(
          selected.bytes,
          "n-up",
          undefined,
          undefined,
          280,
          sheetPageIndexes,
        );
        if (cancelled) return;
        const urls = pages.map((page) => page.thumbnail).filter(Boolean);
        if (!urls.length && sheetPageIndexes.length) {
          setPreviewError("Could not render sheet preview thumbnails.");
          setPreviewThumbs([]);
          return;
        }
        setPreviewThumbs(urls);
      } catch (error) {
        if (!cancelled) {
          setPreviewError(error instanceof Error ? error.message : "Preview failed.");
          setPreviewThumbs([]);
        }
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected, sheetPageIndexes]);

  useEffect(() => {
    setSheetIndex((current) => Math.min(current, Math.max(0, sheetCount - 1)));
  }, [sheetCount]);

  async function createNUp() {
    if (!selected) return;
    setWork({ kind: "working", message: "Building N-up sheets on this device…" });
    trackToolEvent("n-up", "start");
    try {
      const output = await nUpPdf(await selected.file.arrayBuffer(), {
        pagesPerSheet,
        paperSize,
        orientation,
        margin,
        gap,
        cellBorder,
        fillOrder: "across",
      });
      downloadGeneratedFile(output as BlobPart, outputName.replace(/\.pdf$/i, "") + ".pdf");
      trackToolEvent("n-up", "success");
      setWork({ kind: "idle" });
    } catch (error) {
      trackToolEvent("n-up", "error");
      setWork({ kind: "error", message: error instanceof Error ? error.message : "Could not build the N-up PDF." });
    }
  }

  const marginPct = Math.min(18, Math.max(0, (margin / Math.max(sheet.width, sheet.height)) * 100));
  const gapPct = Math.min(8, Math.max(0, (gap / Math.max(sheet.width, sheet.height)) * 100));
  const aspectRatio = `${sheet.width} / ${sheet.height}`;

  return (
    <StitchToolShell
      title="Multiple Pages Per Sheet"
      subtitle="2 / 4 / 6 / 9 / 16-up handouts — vector embed, not raster."
      className={`compress-page n-up-page${selected ? " has-file" : ""}`}
      related={[
        { href: "/pdf-tools/organise", label: "Organise pages" },
        { href: "/pdf-tools/pdf-to-images", label: "PDF to images" },
      ]}
    >
      <section className="compress-workspace">
        {!selected ? (
          <label className={`pdf-drop-zone${busy ? " disabled" : ""}`} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (!busy) void chooseFile(e.dataTransfer.files[0]); }}>
            <input ref={inputRef} type="file" accept=".pdf,application/pdf" disabled={busy} onChange={(e) => void chooseFile(e.target.files?.[0])} />
            <span className="drop-zone-mark" aria-hidden="true">＋</span>
            <strong>Choose a PDF file</strong>
            <span>or drag and drop it here</span>
          </label>
        ) : (
          <div className="page-numbers-shell">
            <section className="page-numbers-preview" aria-label="N-up sheet preview">
              <div className="page-numbers-preview-meta">
                <span>Sheet preview</span>
                <span>
                  {pagesPerSheet}-up · {safeSheetIndex + 1} of {sheetCount} sheet{sheetCount === 1 ? "" : "s"}
                </span>
              </div>

              <div
                className={`n-up-sheet-live${previewError ? " has-error" : ""}`}
                style={{ aspectRatio }}
              >
                {previewError ? (
                  <div className="page-number-live-empty">{previewError}</div>
                ) : (
                  <div
                    className="n-up-sheet-grid"
                    style={{
                      gridTemplateColumns: `repeat(${grid.cols}, minmax(0, 1fr))`,
                      gridTemplateRows: `repeat(${grid.rows}, minmax(0, 1fr))`,
                      padding: `${marginPct}%`,
                      gap: `${gapPct}%`,
                    }}
                  >
                    {Array.from({ length: cellsPerSheet }, (_, slot) => {
                      const pageIndex = safeSheetIndex * cellsPerSheet + slot;
                      const thumb = pageIndex < selected.pageCount ? previewThumbs[slot] : "";
                      const hasPage = pageIndex < selected.pageCount;
                      return (
                        <div
                          key={slot}
                          className={`n-up-sheet-cell${cellBorder ? " bordered" : ""}${hasPage ? "" : " empty"}`}
                        >
                          {thumb ? (
                            <img src={thumb} alt={`Page ${pageIndex + 1}`} />
                          ) : hasPage ? (
                            <span className="n-up-sheet-cell-placeholder">
                              {previewLoading ? "…" : `p${pageIndex + 1}`}
                            </span>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {sheetCount > 1 ? (
                <div className="page-numbers-pager">
                  <button
                    type="button"
                    disabled={busy || safeSheetIndex === 0}
                    onClick={() => setSheetIndex((index) => Math.max(0, index - 1))}
                  >
                    Previous
                  </button>
                  <span>
                    Sheet {safeSheetIndex + 1} / {sheetCount}
                  </span>
                  <button
                    type="button"
                    disabled={busy || safeSheetIndex >= sheetCount - 1}
                    onClick={() => setSheetIndex((index) => Math.min(sheetCount - 1, index + 1))}
                  >
                    Next
                  </button>
                </div>
              ) : (
                <div className="page-numbers-pager">
                  <span>1 sheet · {grid.cols}×{grid.rows} grid</span>
                </div>
              )}
            </section>

            <aside className="page-numbers-panel">
              <div className="selected-document-card" aria-label={`Uploaded document: ${selected.file.name}`}>
                <div className="selected-document-details">
                  <strong title={selected.file.name}>{selected.file.name}</strong>
                  <small>
                    {selected.pageCount} pages → {sheetCount} sheet{sheetCount === 1 ? "" : "s"} · {formatBytes(selected.file.size)}
                  </small>
                </div>
                <button type="button" onClick={clearFile} disabled={busy}>Remove</button>
              </div>

              <fieldset className="compression-presets" style={{ border: 0, margin: 0, padding: 0 }}>
                <legend className="sr-only">Pages per sheet</legend>
                <div className="tool-layout-pills">
                  {LAYOUTS.map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={pagesPerSheet === n ? "merge-button" : "secondary-button"}
                      onClick={() => {
                        setPagesPerSheet(n);
                        setSheetIndex(0);
                        setOutputName(`${safeBaseName(selected.file.name)}-${n}up.pdf`);
                      }}
                      disabled={busy}
                    >
                      {n}-up
                    </button>
                  ))}
                </div>
              </fieldset>

              <div className="tool-options-grid">
                <label>
                  <span>Paper</span>
                  <select value={paperSize} disabled={busy} onChange={(e) => setPaperSize(e.target.value as NUpPaperSize)}>
                    <option value="a4">A4</option>
                    <option value="letter">Letter</option>
                    <option value="legal">Legal</option>
                  </select>
                </label>
                <label>
                  <span>Orientation</span>
                  <select value={orientation} disabled={busy} onChange={(e) => setOrientation(e.target.value as NUpOrientation)}>
                    <option value="portrait">Portrait</option>
                    <option value="landscape">Landscape</option>
                  </select>
                </label>
                <label>
                  <span>Margin (pt)</span>
                  <input type="number" min={0} max={72} value={margin} disabled={busy} onChange={(e) => setMargin(Number(e.target.value) || 0)} />
                </label>
                <label>
                  <span>Gap (pt)</span>
                  <input type="number" min={0} max={48} value={gap} disabled={busy} onChange={(e) => setGap(Number(e.target.value) || 0)} />
                </label>
              </div>

              <label className="tool-check-row">
                <input type="checkbox" checked={cellBorder} disabled={busy} onChange={(e) => setCellBorder(e.target.checked)} />
                <span>Draw light border around each cell</span>
              </label>

              <p className="organise-tip">
                Fill order is across-then-down (page 1 top-left). Sheet ≈ {Math.round(sheet.width)}×{Math.round(sheet.height)} pt.
                Pages are embedded and scaled as vectors — text stays sharp when you zoom.
              </p>

              <label className="merge-output-name">
                <span>File name</span>
                <input type="text" value={outputName} spellCheck={false} disabled={busy} onChange={(e) => setOutputName(e.target.value)} />
              </label>

              <PdfNextStepSelector />

              <button className="merge-button" type="button" onClick={() => void createNUp()} disabled={busy}>
                {work.kind === "working" ? "Working…" : "Download N-up PDF"}
              </button>

              <div className="organise-action-row n-up-panel-summary">
                <div>
                  <strong>{sheetCount} output {sheetCount === 1 ? "sheet" : "sheets"}</strong>
                  <span>{pagesPerSheet} pages per sheet · {grid.cols}×{grid.rows}</span>
                </div>
              </div>
            </aside>
          </div>
        )}
        {work.kind !== "idle" ? <p className={`pdf-work-message ${work.kind}`} role={work.kind === "error" ? "alert" : "status"}>{work.message}</p> : null}
      </section>
    </StitchToolShell>
  );
}
