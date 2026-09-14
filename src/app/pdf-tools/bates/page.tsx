"use client";

import { useMemo, useRef, useState } from "react";
import StitchToolShell from "../../../components/StitchToolShell";
import { downloadGeneratedFile } from "../../../lib/browser-download";
import { inspectPdf, type PageNumberPosition } from "../../../lib/pdf-tools";
import {
  applyBatesNumbering,
  formatBatesLabel,
  zipBatesResults,
  type BatesFileResult,
} from "../../../lib/pdf-extra-tools";
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

function moveItem<T>(list: T[], from: number, to: number) {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
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
  const [whitePlate, setWhitePlate] = useState(true);
  const [results, setResults] = useState<BatesFileResult[] | null>(null);
  const [csv, setCsv] = useState("");
  const [work, setWork] = useState<WorkState>({ kind: "idle" });
  const busy = work.kind === "reading" || work.kind === "working";

  const totalPages = useMemo(() => files.reduce((sum, f) => sum + f.pageCount, 0), [files]);
  const endNumber = totalPages ? startNumber + totalPages - 1 : startNumber - 1;
  const previewStart = formatBatesLabel(prefix, startNumber, digits, suffix);
  const previewEnd = totalPages ? formatBatesLabel(prefix, endNumber, digits, suffix) : "—";

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
      setFiles((current) => [...current, ...next]);
      setResults(null);
      setCsv("");
      setWork({ kind: "idle" });
    } catch {
      setWork({ kind: "error", message: "One of the files could not be read. Unlock password-protected PDFs first." });
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  async function apply() {
    if (!files.length) return;
    setWork({ kind: "working", message: "Stamping Bates numbers across the set…" });
    trackToolEvent("bates", "start");
    try {
      const { results: stamped, csv: log } = await applyBatesNumbering(
        files.map((f) => ({ name: f.file.name, bytes: f.bytes })),
        { prefix, suffix, startNumber, digits, position, margin, fontSize, color, whitePlate },
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
      <section className="compress-workspace" style={{ display: "grid", gap: 16 }}>
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

        {files.length ? (
          <ol className="page-workspace-grid list" style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
            {files.map((item, index) => (
              <li key={item.id} style={{ display: "flex", gap: 8, alignItems: "center", border: "1px solid var(--line)", background: "#fff", padding: "10px 12px" }}>
                <strong style={{ minWidth: 28 }}>{index + 1}.</strong>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis" }}>{item.file.name}</strong>
                  <span style={{ color: "var(--muted)", fontSize: 12 }}>{item.pageCount} pages</span>
                </div>
                <button type="button" className="text-button" disabled={busy || index === 0} onClick={() => setFiles((c) => moveItem(c, index, index - 1))}>↑</button>
                <button type="button" className="text-button" disabled={busy || index === files.length - 1} onClick={() => setFiles((c) => moveItem(c, index, index + 1))}>↓</button>
                <button type="button" className="text-button" disabled={busy} onClick={() => { setFiles((c) => c.filter((f) => f.id !== item.id)); setResults(null); }}>Remove</button>
              </li>
            ))}
          </ol>
        ) : null}

        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
          <label><span>Prefix</span><input value={prefix} disabled={busy} onChange={(e) => setPrefix(e.target.value)} /></label>
          <label><span>Suffix</span><input value={suffix} disabled={busy} onChange={(e) => setSuffix(e.target.value)} /></label>
          <label><span>Start number</span><input type="number" min={0} value={startNumber} disabled={busy} onChange={(e) => setStartNumber(Math.max(0, Number(e.target.value) || 0))} /></label>
          <label><span>Digits</span><input type="number" min={1} max={12} value={digits} disabled={busy} onChange={(e) => setDigits(Math.min(12, Math.max(1, Number(e.target.value) || 6)))} /></label>
          <label>
            <span>Position</span>
            <select value={position} disabled={busy} onChange={(e) => setPosition(e.target.value as PageNumberPosition)}>
              {POSITIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </label>
          <label><span>Margin</span><input type="number" min={8} max={72} value={margin} disabled={busy} onChange={(e) => setMargin(Number(e.target.value) || 28)} /></label>
          <label><span>Font size</span><input type="number" min={6} max={72} value={fontSize} disabled={busy} onChange={(e) => setFontSize(Number(e.target.value) || 12)} /></label>
          <label><span>Colour</span><input type="color" value={color} disabled={busy} onChange={(e) => setColor(e.target.value)} /></label>
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={whitePlate} disabled={busy} onChange={(e) => setWhitePlate(e.target.checked)} />
          <span>White plate behind number (keeps stamp readable on dark scans)</span>
        </label>

        <div className="organise-tip">
          Preview range: <strong>{previewStart}</strong> → <strong>{previewEnd}</strong>
          {totalPages ? ` · ${files.length} file${files.length === 1 ? "" : "s"} · ${totalPages} pages` : ""}
        </div>

        <div className="organise-action-row">
          <div>
            <strong>Continuous across the set</strong>
            <span>Separate from single-doc page numbers</span>
          </div>
          <button className="merge-button" type="button" onClick={() => void apply()} disabled={busy || !files.length}>
            {work.kind === "working" ? "Stamping…" : "Apply Bates numbering"}
          </button>
        </div>

        {results ? (
          <div style={{ display: "grid", gap: 10 }}>
            <h3 style={{ margin: 0 }}>Per-file ranges</h3>
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 6 }}>
              {results.map((r) => (
                <li key={r.name} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", border: "1px solid var(--line)", padding: "8px 10px", background: "#fff" }}>
                  <strong style={{ flex: 1 }}>{r.name}</strong>
                  <span>{r.startLabel} – {r.endLabel}</span>
                  <button type="button" className="secondary-button" onClick={() => downloadGeneratedFile(r.bytes as BlobPart, r.name)}>Download</button>
                </li>
              ))}
            </ul>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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

        {work.kind !== "idle" ? <p className={`pdf-work-message ${work.kind}`} role={work.kind === "error" ? "alert" : "status"}>{work.message}</p> : null}
      </section>
    </StitchToolShell>
  );
}
