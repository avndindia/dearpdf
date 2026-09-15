"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import StitchToolShell from "../../../components/StitchToolShell";
import { renderPdfPageThumbnails } from "../../../components/pdf-page-workspace";
import { downloadGeneratedFile } from "../../../lib/browser-download";
import { inspectPdf, type PageNumberPosition } from "../../../lib/pdf-tools";
import {
  applyBatesNumbering,
  formatBatesLabel,
  zipBatesResults,
  type BatesFileResult,
} from "../../../lib/pdf-extra-tools";
import { useIncomingPdfHandoff } from "../../../lib/pdf-tool-handoff";
import { trackToolEvent } from "../../../lib/stats";

type FileItem = { id: string; file: File; bytes: ArrayBuffer; pageCount: number };
type WorkState = { kind: "idle" } | { kind: "reading" | "working" | "error"; message: string };

const POSITIONS: Array<{ value: PageNumberPosition; label: string }> = [
  { value: "top-left", label: "Top left" },
  { value: "top-center", label: "Top centre" },
  { value: "top-right", label: "Top right" },
  { value: "bottom-left", label: "Bottom left" },
  { value: "bottom-center", label: "Bottom centre" },
  { value: "bottom-right", label: "Bottom right" },
];

const COLOURS = ["#4b4b4b", "#111111", "#c0392b", "#2980b9", "#27ae60", "#8e44ad", "#d35400"];

function moveItem<T>(list: T[], from: number, to: number) {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function BatesNumberingPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [prefix, setPrefix] = useState("ABC");
  const [suffix, setSuffix] = useState("");
  const [startNumber, setStartNumber] = useState(1);
  const [digits, setDigits] = useState(6);
  const [position, setPosition] = useState<PageNumberPosition>("bottom-right");
  const [margin, setMargin] = useState(28);
  const [fontSize, setFontSize] = useState(12);
  const [color, setColor] = useState("#c0392b");
  const [bold, setBold] = useState(true);
  const [whitePlate, setWhitePlate] = useState(true);
  const [results, setResults] = useState<BatesFileResult[] | null>(null);
  const [csv, setCsv] = useState("");
  const [work, setWork] = useState<WorkState>({ kind: "idle" });
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [previewFileIndex, setPreviewFileIndex] = useState(0);
  const [previewPageIndex, setPreviewPageIndex] = useState(0);
  const busy = work.kind === "reading" || work.kind === "working";
  useIncomingPdfHandoff((file) => addFiles([file]), addFiles);

  const totalPages = useMemo(() => files.reduce((sum, f) => sum + f.pageCount, 0), [files]);
  const endNumber = totalPages ? startNumber + totalPages - 1 : startNumber - 1;
  const previewStart = formatBatesLabel(prefix, startNumber, digits, suffix);
  const previewEnd = totalPages ? formatBatesLabel(prefix, endNumber, digits, suffix) : "—";

  const safeFileIndex = Math.min(previewFileIndex, Math.max(0, files.length - 1));
  const previewFile = files[safeFileIndex] ?? null;
  const safePageIndex = previewFile
    ? Math.min(previewPageIndex, Math.max(0, previewFile.pageCount - 1))
    : 0;

  const globalPageOffset = useMemo(() => {
    let offset = 0;
    for (let i = 0; i < safeFileIndex; i += 1) offset += files[i]!.pageCount;
    return offset;
  }, [files, safeFileIndex]);

  const previewLabel = formatBatesLabel(
    prefix,
    startNumber + globalPageOffset + safePageIndex,
    digits,
    suffix,
  );

  const positionLabel = POSITIONS.find((item) => item.value === position)?.label ?? "Bottom right";

  async function addFiles(list: FileList | File[] | null) {
    if (!list?.length) return;
    setWork({ kind: "reading", message: "Reading PDFs on this device…" });
    const next: FileItem[] = [];
    try {
      for (const file of Array.from(list)) {
        if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) continue;
        const bytes = await file.arrayBuffer();
        const { pageCount } = await inspectPdf(bytes);
        next.push({ id: `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`, file, bytes, pageCount });
      }
      if (!next.length) {
        setWork({ kind: "error", message: "Choose one or more PDF files." });
        return;
      }
      setFiles((current) => {
        const merged = [...current, ...next];
        if (!current.length) {
          setPreviewFileIndex(0);
          setPreviewPageIndex(0);
        }
        return merged;
      });
      setResults(null);
      setCsv("");
      setWork({ kind: "idle" });
    } catch {
      setWork({ kind: "error", message: "One of the files could not be read. Unlock password-protected PDFs first." });
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  useEffect(() => {
    if (!previewFile) {
      setPreviewUrl("");
      setPreviewError("");
      return;
    }
    let cancelled = false;
    setPreviewUrl("");
    setPreviewError("");
    void (async () => {
      try {
        const pages = await renderPdfPageThumbnails(
          previewFile.bytes,
          "bates",
          undefined,
          undefined,
          900,
          [safePageIndex],
        );
        const url = pages[0]?.thumbnail ?? "";
        if (cancelled) return;
        if (!url) {
          setPreviewError("Could not render this page preview.");
          setPreviewUrl("");
          return;
        }
        setPreviewUrl(url);
      } catch (error) {
        if (!cancelled) {
          setPreviewError(error instanceof Error ? error.message : "Preview failed.");
          setPreviewUrl("");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [previewFile, safePageIndex]);

  useEffect(() => {
    setPreviewFileIndex((current) => Math.min(current, Math.max(0, files.length - 1)));
  }, [files.length]);

  useEffect(() => {
    if (!previewFile) return;
    setPreviewPageIndex((current) => Math.min(current, Math.max(0, previewFile.pageCount - 1)));
  }, [previewFile]);

  async function apply() {
    if (!files.length) return;
    setWork({ kind: "working", message: "Stamping Bates numbers across the set…" });
    trackToolEvent("bates", "start");
    try {
      const { results: stamped, csv: log } = await applyBatesNumbering(
        files.map((f) => ({ name: f.file.name, bytes: f.bytes })),
        { prefix, suffix, startNumber, digits, position, margin, fontSize, color, whitePlate, bold },
      );
      setResults(stamped);
      setCsv(log);
      trackToolEvent("bates", "success");
      setWork({ kind: "idle" });
    } catch (error) {
      trackToolEvent("bates", "error");
      setWork({ kind: "error", message: error instanceof Error ? error.message : "Bates numbering failed." });
    }
  }

  return (
    <StitchToolShell
      title="Bates Numbering"
      subtitle="Continuous sequence across multiple files — with a CSV production log."
      className={`compress-page bates-page${files.length ? " has-file" : ""}`}
      related={[
        { href: "/pdf-tools/page-numbers", label: "Page numbers (single doc)" },
        { href: "/pdf-tools/merge", label: "Merge PDF" },
      ]}
      note="Privileged productions stay on this device. Bates never restarts per file."
    >
      <section className="compress-workspace">
        {!files.length ? (
          <label
            className={`pdf-drop-zone${busy ? " disabled" : ""}`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); if (!busy) void addFiles(e.dataTransfer.files); }}
          >
            <input ref={inputRef} type="file" accept=".pdf,application/pdf" multiple disabled={busy} onChange={(e) => void addFiles(e.target.files)} />
            <span className="drop-zone-mark" aria-hidden="true">＋</span>
            <strong>Add production PDFs</strong>
            <span>Order matters — use arrows after adding</span>
          </label>
        ) : (
          <div className="page-numbers-shell">
            <section className="page-numbers-preview" aria-label="Bates live preview">
              <div className="page-numbers-preview-meta">
                <span>Live preview</span>
                <span>
                  File {safeFileIndex + 1}/{files.length} · page {safePageIndex + 1}/{previewFile?.pageCount ?? 0}
                </span>
              </div>
              <div className="page-number-live">
                {previewUrl ? (
                  <img src={previewUrl} alt={`Preview page ${safePageIndex + 1}`} />
                ) : (
                  <div className="page-number-live-empty">{previewError || "Preparing preview…"}</div>
                )}
                <b
                  className={`page-number-live-mark ${position}${whitePlate ? " bates-plate" : ""}`}
                  style={{ color, fontSize: `${Math.max(11, fontSize)}px`, fontWeight: bold ? 700 : 500 }}
                >
                  {previewLabel}
                </b>
              </div>
              <div className="page-numbers-pager">
                <button
                  type="button"
                  disabled={busy || (safeFileIndex === 0 && safePageIndex === 0)}
                  onClick={() => {
                    if (safePageIndex > 0) setPreviewPageIndex((i) => i - 1);
                    else if (safeFileIndex > 0) {
                      const prev = files[safeFileIndex - 1]!;
                      setPreviewFileIndex(safeFileIndex - 1);
                      setPreviewPageIndex(prev.pageCount - 1);
                    }
                  }}
                >
                  Previous
                </button>
                <span>
                  {previewLabel} · {positionLabel}
                </span>
                <button
                  type="button"
                  disabled={
                    busy ||
                    (safeFileIndex >= files.length - 1 &&
                      safePageIndex >= (previewFile?.pageCount ?? 1) - 1)
                  }
                  onClick={() => {
                    if (previewFile && safePageIndex < previewFile.pageCount - 1) {
                      setPreviewPageIndex((i) => i + 1);
                    } else if (safeFileIndex < files.length - 1) {
                      setPreviewFileIndex(safeFileIndex + 1);
                      setPreviewPageIndex(0);
                    }
                  }}
                >
                  Next
                </button>
              </div>
            </section>

            <aside className="page-numbers-panel">
              <div className="selected-document-card">
                <div className="selected-document-details">
                  <strong>{files.length} file{files.length === 1 ? "" : "s"}</strong>
                  <small>
                    {totalPages} pages · {previewStart} → {previewEnd}
                  </small>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setFiles([]);
                    setResults(null);
                    setCsv("");
                    setPreviewUrl("");
                    setWork({ kind: "idle" });
                  }}
                >
                  Clear
                </button>
              </div>

              <ol className="bates-file-list">
                {files.map((item, index) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={`bates-file-pick${index === safeFileIndex ? " active" : ""}`}
                      disabled={busy}
                      onClick={() => {
                        setPreviewFileIndex(index);
                        setPreviewPageIndex(0);
                      }}
                    >
                      <strong>{index + 1}. {item.file.name}</strong>
                      <small>{item.pageCount} pages · {formatBytes(item.file.size)}</small>
                    </button>
                    <div className="bates-file-actions">
                      <button type="button" className="text-button" disabled={busy || index === 0} onClick={() => setFiles((c) => moveItem(c, index, index - 1))}>↑</button>
                      <button type="button" className="text-button" disabled={busy || index === files.length - 1} onClick={() => setFiles((c) => moveItem(c, index, index + 1))}>↓</button>
                      <button
                        type="button"
                        className="text-button"
                        disabled={busy}
                        onClick={() => {
                          setFiles((c) => c.filter((f) => f.id !== item.id));
                          setResults(null);
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ol>

              <label className={`pdf-drop-zone compact${busy ? " disabled" : ""}`} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (!busy) void addFiles(e.dataTransfer.files); }}>
                <input ref={inputRef} type="file" accept=".pdf,application/pdf" multiple disabled={busy} onChange={(e) => void addFiles(e.target.files)} />
                <strong>Add more PDFs</strong>
              </label>

              <section className="page-number-custom-text">
                <span>Custom text</span>
                <label>
                  <span>Before</span>
                  <input
                    value={prefix}
                    disabled={busy}
                    placeholder="ABC"
                    aria-label="Bates prefix"
                    onChange={(event) => setPrefix(event.target.value)}
                  />
                </label>
                <label>
                  <span>After</span>
                  <input
                    value={suffix}
                    disabled={busy}
                    placeholder=""
                    aria-label="Bates suffix"
                    onChange={(event) => setSuffix(event.target.value)}
                  />
                </label>
              </section>

              <section>
                <span>Position</span>
                <div className="page-number-position" role="radiogroup" aria-label="Bates position">
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
                  <span>Start number</span>
                  <input
                    type="number"
                    min={0}
                    step="1"
                    value={startNumber}
                    disabled={busy}
                    onChange={(event) => setStartNumber(Math.max(0, Number(event.target.value) || 0))}
                  />
                </label>
                <label>
                  <span>Digits</span>
                  <input
                    type="number"
                    min={1}
                    max={12}
                    step="1"
                    value={digits}
                    disabled={busy}
                    onChange={(event) => setDigits(Math.min(12, Math.max(1, Number(event.target.value) || 6)))}
                  />
                </label>
              </div>

              <div className="page-number-pair">
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
                <label>
                  <span>Margin</span>
                  <input
                    type="number"
                    min={8}
                    max={72}
                    value={margin}
                    disabled={busy}
                    onChange={(event) => setMargin(Math.min(72, Math.max(8, Number(event.target.value) || 28)))}
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
                <input type="checkbox" checked={whitePlate} disabled={busy} onChange={(event) => setWhitePlate(event.target.checked)} />
                White plate behind number
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

              <button className="merge-button" type="button" onClick={() => void apply()} disabled={busy || !files.length}>
                {work.kind === "working" ? "Stamping…" : "Apply Bates numbering"}
              </button>

              {results ? (
                <div className="bates-results">
                  <h3>Per-file ranges</h3>
                  <ul>
                    {results.map((r) => (
                      <li key={r.name}>
                        <strong>{r.name}</strong>
                        <span>{r.startLabel} – {r.endLabel}</span>
                        <button type="button" className="secondary-button" onClick={() => downloadGeneratedFile(r.bytes as BlobPart, r.name)}>Download</button>
                      </li>
                    ))}
                  </ul>
                  <div className="bates-result-actions">
                    <button
                      type="button"
                      className="merge-button"
                      onClick={async () => {
                        const zip = await zipBatesResults(results);
                        downloadGeneratedFile(zip as BlobPart, "bates-production.zip");
                      }}
                    >
                      Download all as ZIP
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => downloadGeneratedFile(new TextEncoder().encode(csv), "bates-production-log.csv")}
                    >
                      Download CSV log
                    </button>
                  </div>
                </div>
              ) : null}
            </aside>
          </div>
        )}

        {work.kind !== "idle" ? <p className={`pdf-work-message ${work.kind}`} role={work.kind === "error" ? "alert" : "status"}>{work.message}</p> : null}
      </section>
    </StitchToolShell>
  );
}
