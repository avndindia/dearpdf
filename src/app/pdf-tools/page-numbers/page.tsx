"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { downloadGeneratedFile } from "../../../lib/browser-download";
import { useIncomingPdfHandoff } from "../../../lib/pdf-tool-handoff";
import {
  addPageNumbersPdf,
  formatPageNumberLabel,
  inspectPdf,
  type PageNumberFormat,
  type PageNumberPosition,
} from "../../../lib/pdf-tools";
import { renderPdfPageThumbnails } from "../../../components/pdf-page-workspace";
import StitchToolShell from "../../../components/StitchToolShell";
import { trackToolEvent } from "../../../lib/stats";

type SelectedPdf = {
  file: File;
  bytes: ArrayBuffer;
  pageCount: number;
};

type WorkState =
  | { kind: "idle" }
  | { kind: "reading"; message: string }
  | { kind: "working"; message: string; percent?: number }
  | { kind: "error"; message: string };

const FORMATS: Array<{ value: PageNumberFormat; label: string }> = [
  { value: "number", label: "1, 2, 3" },
  { value: "roman", label: "i, ii, iii" },
  { value: "letter", label: "A, B, C" },
  { value: "page-number", label: "Page 1" },
  { value: "fraction", label: "1 / 10" },
  { value: "number-of-total", label: "1 of 10" },
  { value: "page-number-of-total", label: "Page 1 of 10" },
];

const POSITIONS: Array<{ value: PageNumberPosition; label: string }> = [
  { value: "top-left", label: "Top left" },
  { value: "top-center", label: "Top centre" },
  { value: "top-right", label: "Top right" },
  { value: "bottom-left", label: "Bottom left" },
  { value: "bottom-center", label: "Bottom centre" },
  { value: "bottom-right", label: "Bottom right" },
];

const COLOURS = ["#4b4b4b", "#111111", "#c0392b", "#2980b9", "#27ae60", "#8e44ad", "#d35400"];

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function safeBaseName(fileName: string) {
  return fileName.replace(/\.pdf$/i, "").replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "") || "document";
}

function numberedDownloadName(name: string, fallback: string) {
  const trimmed = name.trim() || fallback;
  const base = trimmed.replace(/\.pdf$/i, "").replace(/[^\p{L}\p{N}._ -]+/gu, "-").replace(/-+/g, "-").replace(/^[\s.-]+|[\s.-]+$/g, "");
  return `${base || "numbered"}.pdf`;
}

export default function PageNumbersPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<SelectedPdf | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewIndex, setPreviewIndex] = useState(0);
  const [work, setWork] = useState<WorkState>({ kind: "idle" });
  const [format, setFormat] = useState<PageNumberFormat>("page-number-of-total");
  const [position, setPosition] = useState<PageNumberPosition>("bottom-center");
  const [startAt, setStartAt] = useState(1);
  const [fontSize, setFontSize] = useState(15);
  const [skipFirst, setSkipFirst] = useState(false);
  const [color, setColor] = useState("#c0392b");
  const [bold, setBold] = useState(true);
  const [prefix, setPrefix] = useState("");
  const [suffix, setSuffix] = useState("");
  const [outputName, setOutputName] = useState("numbered.pdf");
  const [savedNotice, setSavedNotice] = useState("");
  const busy = work.kind === "reading" || work.kind === "working";
  useIncomingPdfHandoff(chooseFile);

  const numberedPages = useMemo(() => {
    if (!selected) return [] as number[];
    return Array.from(
      { length: selected.pageCount },
      (_, index) => index,
    ).filter((index) => !skipFirst || index > 0);
  }, [selected, skipFirst]);

  const previewLabel = useMemo(() => {
    const selectionIndex = numberedPages.indexOf(previewIndex);
    if (selectionIndex < 0) return "";
    return formatPageNumberLabel(
      format,
      startAt + selectionIndex,
      startAt + numberedPages.length - 1,
      prefix,
      suffix,
    );
  }, [format, numberedPages, prefix, previewIndex, startAt, suffix]);

  const positionLabel = POSITIONS.find((item) => item.value === position)?.label ?? "Bottom centre";

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
      setPreviewIndex(0);
      setOutputName(`${safeBaseName(file.name)}-numbered.pdf`);
      setSavedNotice("");
      setWork({ kind: "idle" });
    } catch {
      setSelected(null);
      setWork({ kind: "error", message: "This file could not be read. Password-protected PDFs must be unlocked first." });
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  function clearFile() {
    setSelected(null);
    setPreviewUrl("");
    setOutputName("numbered.pdf");
    setSavedNotice("");
    setWork({ kind: "idle" });
  }

  useEffect(() => {
    if (!selected) {
      setPreviewUrl("");
      return;
    }
    let cancelled = false;
    void (async () => {
      const pages = await renderPdfPageThumbnails(
        selected.bytes,
        "page-numbers",
        undefined,
        undefined,
        720,
        [previewIndex],
      );
      if (!cancelled) setPreviewUrl(pages[0]?.thumbnail ?? "");
    })();
    return () => {
      cancelled = true;
    };
  }, [previewIndex, selected]);

  async function addNumbers() {
    if (!selected || !numberedPages.length) return;
    setWork({ kind: "working", message: "Adding page numbers…", percent: 20 });
    trackToolEvent("page-numbers", "start");
    try {
      const processingBytes = await selected.file.arrayBuffer();
      const output = await addPageNumbersPdf(processingBytes, {
        pageIndices: numberedPages,
        position,
        format,
        startAt: Math.max(format === "roman" || format === "letter" ? 1 : 0, Math.floor(startAt) || 1),
        fontSize,
        margin: 28,
        color,
        bold,
        prefix,
        suffix,
      });
      const name = numberedDownloadName(outputName, `${safeBaseName(selected.file.name)}-numbered.pdf`);
      downloadGeneratedFile(output as BlobPart, name);
      setSavedNotice(`Saved ${name}. The original PDF is still here — change the format and number again if you need to.`);
      trackToolEvent("page-numbers", "success");
      setWork({ kind: "idle" });
    } catch (error) {
      trackToolEvent("page-numbers", "error");
      setWork({
        kind: "error",
        message: error instanceof Error ? error.message : "Page numbers could not be added.",
      });
    }
  }

  return (
    <StitchToolShell
      title="Add Page Numbers"
      subtitle="Choose a format and position for selected pages."
      className={`compress-page page-numbers-page${selected ? " has-file" : ""}`}
    >
      <section className="compress-workspace">
        {!selected ? (
          <label className={`pdf-drop-zone${busy ? " disabled" : ""}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
            event.preventDefault();
            if (!busy) void chooseFile(event.dataTransfer.files[0]);
          }}>
            <input ref={inputRef} type="file" accept=".pdf,application/pdf" disabled={busy} onChange={(event) => void chooseFile(event.target.files?.[0])} />
            <span className="drop-zone-mark" aria-hidden="true">＋</span>
            <strong>Choose a PDF file</strong>
            <span>or drag and drop it here</span>
          </label>
        ) : (
          <div className="page-numbers-shell">
            <section className="page-numbers-preview" aria-label="Live preview">
              <div className="page-numbers-preview-meta">
                <span>Live preview</span>
                <span>Showing {previewIndex + 1} of {selected.pageCount} · {numberedPages.length} will be numbered</span>
              </div>
              <div className="page-number-live">
                {previewUrl ? <img src={previewUrl} alt={`Page ${previewIndex + 1}`} /> : <div className="page-number-live-empty">Preparing preview…</div>}
                {previewLabel ? (
                  <b className={`page-number-live-mark ${position}`} style={{ color, fontSize: `${Math.max(11, fontSize)}px`, fontWeight: bold ? 700 : 500 }}>
                    {previewLabel}
                  </b>
                ) : (
                  <span className="page-number-live-skip">Cover page · not numbered</span>
                )}
              </div>
              <div className="page-numbers-pager">
                <button type="button" disabled={busy || previewIndex === 0} onClick={() => setPreviewIndex((index) => Math.max(0, index - 1))}>Previous</button>
                <span>{previewIndex + 1} / {selected.pageCount}</span>
                <button type="button" disabled={busy || previewIndex >= selected.pageCount - 1} onClick={() => setPreviewIndex((index) => Math.min(selected.pageCount - 1, index + 1))}>Next</button>
              </div>
            </section>

            <aside className="page-numbers-panel">
              <div className="selected-document-card" aria-label={`Uploaded document: ${selected.file.name}`}>
                <div className="selected-document-details">
                  <strong title={selected.file.name}>{selected.file.name}</strong>
                  <small>{selected.pageCount} pages · {formatBytes(selected.file.size)}</small>
                </div>
                <button type="button" onClick={clearFile} disabled={busy}>Remove</button>
              </div>

              <label className="merge-output-name">
                <span>File name</span>
                <input
                  type="text"
                  value={outputName}
                  spellCheck={false}
                  autoComplete="off"
                  disabled={busy}
                  aria-label="Numbered PDF file name"
                  onChange={(event) => setOutputName(event.target.value)}
                  onBlur={() => setOutputName(numberedDownloadName(outputName, `${safeBaseName(selected.file.name)}-numbered.pdf`))}
                />
              </label>
              <button className="merge-button" type="button" disabled={busy || !numberedPages.length} onClick={() => void addNumbers()}>
                {work.kind === "working"
                  ? "Adding…"
                  : `Number ${numberedPages.length} ${numberedPages.length === 1 ? "page" : "pages"}`}
              </button>
              {savedNotice ? <p className="page-numbers-saved" role="status">{savedNotice}</p> : null}

              <section>
                <span>Number format</span>
                <div className="page-number-formats" role="radiogroup" aria-label="Number format">
                  {FORMATS.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      className={format === item.value ? "active" : ""}
                      aria-pressed={format === item.value}
                      disabled={busy}
                      onClick={() => setFormat(item.value)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </section>

              <section className="page-number-custom-text">
                <span>Custom text</span>
                <label>
                  <span>Before</span>
                  <input
                    value={prefix}
                    disabled={busy}
                    placeholder="Annexure · "
                    onChange={(event) => setPrefix(event.target.value)}
                  />
                </label>
                <label>
                  <span>After</span>
                  <input
                    value={suffix}
                    disabled={busy}
                    placeholder=" · Confidential"
                    onChange={(event) => setSuffix(event.target.value)}
                  />
                </label>
              </section>

              <section>
                <span>Position</span>
                <div className="page-number-position" role="radiogroup" aria-label="Number position">
                  {POSITIONS.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      className={`${item.value}${position === item.value ? " active" : ""}`}
                      aria-pressed={position === item.value}
                      aria-label={item.label}
                      disabled={busy}
                      onClick={() => setPosition(item.value)}
                    />
                  ))}
                </div>
                <small>{positionLabel}</small>
              </section>

              <div className="page-number-pair">
                <label>
                  <span>Start at</span>
                  <input
                    type="number"
                    min={format === "roman" || format === "letter" ? 1 : 0}
                    step="1"
                    value={startAt}
                    disabled={busy}
                    onChange={(event) => setStartAt(Number(event.target.value))}
                  />
                </label>
                <label>
                  <span>Font size (pt)</span>
                  <input
                    type="number"
                    min="6"
                    max="72"
                    value={fontSize}
                    disabled={busy}
                    onChange={(event) => setFontSize(Math.min(72, Math.max(6, Number(event.target.value) || 10)))}
                  />
                </label>
              </div>
              <input
                type="range"
                min="6"
                max="36"
                step="1"
                value={Math.min(36, fontSize)}
                disabled={busy}
                aria-label="Font size"
                onChange={(event) => setFontSize(Number(event.target.value))}
              />

              <label className="page-number-check">
                <input type="checkbox" checked={skipFirst} disabled={busy} onChange={(event) => setSkipFirst(event.target.checked)} />
                Skip first page (cover)
              </label>

              <section>
                <span>Colour</span>
                <div className="page-number-colours">
                  {COLOURS.map((swatch) => (
                    <button
                      key={swatch}
                      type="button"
                      className={color.toLowerCase() === swatch ? "active" : ""}
                      style={{ background: swatch }}
                      aria-label={swatch}
                      disabled={busy}
                      onClick={() => setColor(swatch)}
                    />
                  ))}
                  <label className="page-number-custom-colour">
                    <input type="color" value={color} disabled={busy} onChange={(event) => setColor(event.target.value)} aria-label="Custom colour" />
                  </label>
                </div>
              </section>

              <section>
                <span>Font weight</span>
                <div className="page-number-weight" role="radiogroup" aria-label="Font weight">
                  <button type="button" className={bold ? "" : "active"} aria-pressed={!bold} disabled={busy} onClick={() => setBold(false)}>Regular</button>
                  <button type="button" className={bold ? "active" : ""} aria-pressed={bold} disabled={busy} onClick={() => setBold(true)}>Bold</button>
                </div>
              </section>
            </aside>
          </div>
        )}

        {work.kind === "reading" || work.kind === "error" ? (
          <p className={`pdf-work-message ${work.kind}`} role={work.kind === "error" ? "alert" : "status"}>{work.message}</p>
        ) : null}
      </section>
    </StitchToolShell>
  );
}
