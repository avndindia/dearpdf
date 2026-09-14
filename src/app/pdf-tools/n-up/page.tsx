"use client";

import { useMemo, useRef, useState } from "react";
import PdfNextStepSelector from "../../../components/pdf-next-step-selector";
import StitchToolShell from "../../../components/StitchToolShell";
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

function safeBaseName(fileName: string) {
  return fileName.replace(/\.pdf$/i, "").replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "") || "document";
}

const LAYOUTS: NUpPagesPerSheet[] = [2, 4, 6, 9, 16];

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
  const busy = work.kind === "reading" || work.kind === "working";
  useIncomingPdfHandoff(chooseFile);

  const sheetCount = useMemo(() => {
    if (!selected) return 0;
    const { cols, rows } = nUpGrid(pagesPerSheet);
    return Math.ceil(selected.pageCount / (cols * rows));
  }, [pagesPerSheet, selected]);

  const grid = nUpGrid(pagesPerSheet);
  const sheet = sheetSizeForNUp(paperSize, orientation);

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
      setOutputName(`${safeBaseName(file.name)}-${pagesPerSheet}up.pdf`);
      setWork({ kind: "idle" });
    } catch {
      setSelected(null);
      setWork({ kind: "error", message: "This file could not be read. Unlock password-protected PDFs first." });
    }
    if (inputRef.current) inputRef.current.value = "";
  }

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
          <div className="compression-controls" style={{ display: "grid", gap: 16 }}>
            <div className="merge-workspace-heading">
              <div>
                <h2>{selected.file.name}</h2>
                <p>{selected.pageCount} pages → {sheetCount} sheet{sheetCount === 1 ? "" : "s"} · {grid.cols}×{grid.rows} grid</p>
              </div>
              <button className="text-button" type="button" onClick={() => { setSelected(null); setWork({ kind: "idle" }); }} disabled={busy}>Remove file</button>
            </div>

            <fieldset className="compression-presets" style={{ border: 0, margin: 0, padding: 0 }}>
              <legend className="sr-only">Pages per sheet</legend>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {LAYOUTS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={pagesPerSheet === n ? "merge-button" : "secondary-button"}
                    onClick={() => {
                      setPagesPerSheet(n);
                      setOutputName(`${safeBaseName(selected.file.name)}-${n}up.pdf`);
                    }}
                    disabled={busy}
                  >
                    {n}-up
                  </button>
                ))}
              </div>
            </fieldset>

            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
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

            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={cellBorder} disabled={busy} onChange={(e) => setCellBorder(e.target.checked)} />
              <span>Draw light border around each cell</span>
            </label>

            <p className="organise-tip">
              Fill order is across-then-down (page 1 top-left). Sheet ≈ {Math.round(sheet.width)}×{Math.round(sheet.height)} pt.
              Pages are embedded and scaled as vectors — text stays sharp when you zoom.
            </p>

            <div className="organise-action-row">
              <div>
                <strong>{sheetCount} output {sheetCount === 1 ? "sheet" : "sheets"}</strong>
                <span>{pagesPerSheet} pages per sheet</span>
              </div>
              <div className="merge-action-controls">
                <label className="merge-output-name">
                  <span>File name</span>
                  <input type="text" value={outputName} spellCheck={false} disabled={busy} onChange={(e) => setOutputName(e.target.value)} />
                </label>
                <PdfNextStepSelector />
                <button className="merge-button" type="button" onClick={() => void createNUp()} disabled={busy}>
                  {work.kind === "working" ? "Working…" : "Download N-up PDF"}
                </button>
              </div>
            </div>
          </div>
        )}
        {work.kind !== "idle" ? <p className={`pdf-work-message ${work.kind}`} role={work.kind === "error" ? "alert" : "status"}>{work.message}</p> : null}
      </section>
    </StitchToolShell>
  );
}
