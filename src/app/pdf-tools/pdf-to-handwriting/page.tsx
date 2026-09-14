"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import StitchToolShell from "../../../components/StitchToolShell";
import { downloadGeneratedFile } from "../../../lib/browser-download";
import { useIncomingPdfHandoff } from "../../../lib/pdf-tool-handoff";
import {
  extractPdfPlainText,
  pdfToHandwritingNotebook,
  type HandwritingPaper,
} from "../../../lib/pdf-extra-tools";
import { trackToolEvent } from "../../../lib/stats";

type WorkState = { kind: "idle" } | { kind: "reading" | "working" | "error"; message: string };

function safeBaseName(fileName: string) {
  return fileName.replace(/\.pdf$/i, "").replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "") || "document";
}

let cachedFont: ArrayBuffer | null = null;
async function loadHandwritingFont() {
  if (cachedFont) return cachedFont;
  const response = await fetch("/fonts/Caveat-Regular.ttf");
  if (!response.ok) throw new Error("Handwriting font could not be loaded.");
  cachedFont = await response.arrayBuffer();
  return cachedFont;
}

export default function PdfToHandwritingPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [extracted, setExtracted] = useState("");
  const [charCount, setCharCount] = useState(0);
  const [thinText, setThinText] = useState(false);
  const [paper, setPaper] = useState<HandwritingPaper>("ruled");
  const [fontSize, setFontSize] = useState(22);
  const [lineHeight, setLineHeight] = useState(28);
  const [inkColor, setInkColor] = useState("#1e3a8a");
  const [messiness, setMessiness] = useState(0.45);
  const [slant, setSlant] = useState(4);
  const [outputName, setOutputName] = useState("handwritten.pdf");
  const [work, setWork] = useState<WorkState>({ kind: "idle" });
  const busy = work.kind === "reading" || work.kind === "working";
  useIncomingPdfHandoff(chooseFile);

  async function chooseFile(file?: File) {
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setWork({ kind: "error", message: "Choose a PDF file." });
      return;
    }
    setWork({ kind: "reading", message: "Extracting text layer on this device…" });
    try {
      const bytes = await file.arrayBuffer();
      const { text, charCount: count } = await extractPdfPlainText(bytes);
      setFileName(file.name);
      setExtracted(text);
      setCharCount(count);
      setThinText(count < 40);
      setOutputName(`${safeBaseName(file.name)}-handwriting.pdf`);
      setWork({ kind: "idle" });
    } catch (error) {
      setExtracted("");
      setWork({ kind: "error", message: error instanceof Error ? error.message : "Could not read the PDF text layer." });
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  async function convert() {
    const text = extracted.trim();
    if (!text) {
      setWork({ kind: "error", message: "No text to convert. Paste text below or run OCR first." });
      return;
    }
    setWork({ kind: "working", message: "Rendering handwritten notebook pages…" });
    trackToolEvent("pdf-to-handwriting", "start");
    try {
      const fontBytes = await loadHandwritingFont();
      const output = await pdfToHandwritingNotebook(text, {
        paper,
        fontBytes,
        fontSize,
        lineHeight,
        inkColor,
        margin: 72,
        messiness,
        slant,
      });
      downloadGeneratedFile(output as BlobPart, outputName.replace(/\.pdf$/i, "") + ".pdf");
      trackToolEvent("pdf-to-handwriting", "success");
      setWork({ kind: "idle" });
    } catch (error) {
      trackToolEvent("pdf-to-handwriting", "error");
      setWork({ kind: "error", message: error instanceof Error ? error.message : "Handwriting conversion failed." });
    }
  }

  return (
    <StitchToolShell
      title="PDF to Handwriting"
      subtitle="Notebook-paper v1 — on-device text → handwriting with natural glyph variation."
      className={`compress-page handwriting-page${extracted || fileName ? " has-file" : ""}`}
      related={[
        { href: "/pdf-tools/pdf-to-text", label: "OCR / PDF to text" },
        { href: "/pdf-tools/ai-summary", label: "AI Summary" },
      ]}
      note="Keep-layout and draw-your-own-alphabet are planned for phase 2. This ships a solid notebook mode."
    >
      <section className="compress-workspace" style={{ display: "grid", gap: 16 }}>
        <label
          className={`pdf-drop-zone${busy ? " disabled" : ""}`}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); if (!busy) void chooseFile(e.dataTransfer.files[0]); }}
        >
          <input ref={inputRef} type="file" accept=".pdf,application/pdf" disabled={busy} onChange={(e) => void chooseFile(e.target.files?.[0])} />
          <span className="drop-zone-mark" aria-hidden="true">＋</span>
          <strong>Choose a PDF</strong>
          <span>Text layer is extracted locally</span>
        </label>

        {thinText ? (
          <div className="organise-tip" role="status">
            Little or no selectable text was found. For scans, run{" "}
            <Link href="/pdf-tools/pdf-to-text">OCR</Link> first, or paste text below.
          </div>
        ) : null}

        <label style={{ display: "grid", gap: 6 }}>
          <span>Text to handwrite{fileName ? ` · from ${fileName} (${charCount} chars)` : ""}</span>
          <textarea
            value={extracted}
            disabled={busy}
            rows={10}
            spellCheck={false}
            onChange={(e) => {
              setExtracted(e.target.value);
              setCharCount(e.target.value.length);
              setThinText(e.target.value.trim().length < 40);
            }}
            placeholder="Paste or edit text here…"
            style={{ width: "100%", minHeight: 180, fontFamily: "inherit", padding: 12 }}
          />
        </label>

        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
          <label>
            <span>Paper</span>
            <select value={paper} disabled={busy} onChange={(e) => setPaper(e.target.value as HandwritingPaper)}>
              <option value="ruled">Ruled notebook</option>
              <option value="plain">Plain</option>
            </select>
          </label>
          <label>
            <span>Ink</span>
            <input type="color" value={inkColor} disabled={busy} onChange={(e) => setInkColor(e.target.value)} />
          </label>
          <label>
            <span>Size</span>
            <input type="range" min={16} max={32} value={fontSize} disabled={busy} onChange={(e) => setFontSize(Number(e.target.value))} />
          </label>
          <label>
            <span>Line height</span>
            <input type="range" min={22} max={40} value={lineHeight} disabled={busy} onChange={(e) => setLineHeight(Number(e.target.value))} />
          </label>
          <label>
            <span>Messiness</span>
            <input type="range" min={0} max={100} value={Math.round(messiness * 100)} disabled={busy} onChange={(e) => setMessiness(Number(e.target.value) / 100)} />
          </label>
          <label>
            <span>Slant</span>
            <input type="range" min={-12} max={14} value={slant} disabled={busy} onChange={(e) => setSlant(Number(e.target.value))} />
          </label>
        </div>

        <div className="organise-action-row">
          <div>
            <strong>Caveat handwriting font</strong>
            <span>Per-glyph baseline / rotation / scale / spacing variation</span>
          </div>
          <div className="merge-action-controls">
            <label className="merge-output-name">
              <span>File name</span>
              <input type="text" value={outputName} spellCheck={false} disabled={busy} onChange={(e) => setOutputName(e.target.value)} />
            </label>
            <button className="merge-button" type="button" onClick={() => void convert()} disabled={busy || !extracted.trim()}>
              {work.kind === "working" ? "Writing…" : "Download handwritten PDF"}
            </button>
          </div>
        </div>

        {work.kind !== "idle" ? <p className={`pdf-work-message ${work.kind}`} role={work.kind === "error" ? "alert" : "status"}>{work.message}</p> : null}
      </section>
    </StitchToolShell>
  );
}
