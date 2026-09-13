"use client";

import { useEffect, useRef, useState } from "react";
import { GENERATED_FILE_EVENT, type GeneratedFileEventDetail } from "../lib/browser-download";
import { pdfToolHandoffUrl, savePdfToolHandoff } from "../lib/pdf-tool-handoff";
import { PDF_NEXT_STEPS } from "./pdf-next-step-selector";

type CompletedPdf = { bytes: Uint8Array; name: string };

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function downloadAgain(result: CompletedPdf) {
  const blob = new Blob([result.bytes.slice().buffer], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = result.name;
  link.rel = "noopener";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export default function PdfToolCompletion() {
  const [result, setResult] = useState<CompletedPdf | null>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  const seenBlob = useRef<Blob | null>(null);

  async function passToTool(pdf: CompletedPdf, path: string) {
    setOpening(true);
    setError("");
    try {
      const id = await savePdfToolHandoff(pdf.bytes, pdf.name);
      window.__dearPdfGeneratedFile = undefined;
      window.__dearPdfNextStep = "download";
      window.location.assign(pdfToolHandoffUrl(path, id));
    } catch {
      setOpening(false);
      setResult(pdf);
      setError("Could not pass the PDF in this browser. Download it and choose it in the next tool.");
    }
  }

  useEffect(() => {
    const receive = (event?: Event) => {
      const detail = event
        ? (event as CustomEvent<GeneratedFileEventDetail>).detail
        : window.__dearPdfGeneratedFile;
      if (!detail || seenBlob.current === detail.blob) return;
      const { blob, fileName, nextStep = "download" } = detail;
      if (!fileName.toLowerCase().endsWith(".pdf")) return;
      seenBlob.current = blob;
      void blob.arrayBuffer().then((buffer) => {
        const pdf = { bytes: new Uint8Array(buffer), name: fileName };
        if (nextStep !== "download") {
          void passToTool(pdf, nextStep);
          return;
        }
        setResult(pdf);
        setOpening(false);
        setError("");
      });
    };
    window.addEventListener(GENERATED_FILE_EVENT, receive);
    window.addEventListener("focus", receive);
    window.addEventListener("pageshow", receive);
    receive();
    return () => {
      window.removeEventListener(GENERATED_FILE_EVENT, receive);
      window.removeEventListener("focus", receive);
      window.removeEventListener("pageshow", receive);
    };
  }, []);

  const tools = typeof window === "undefined"
    ? PDF_NEXT_STEPS
    : PDF_NEXT_STEPS.filter((tool) => tool.href !== window.location.pathname);

  if (!result) return null;

  return (
    <aside className="pdf-suite-result" aria-label="Completed PDF actions" aria-live="polite">
      <div className="pdf-suite-result-heading">
        <span aria-hidden="true">✓</span>
        <div><strong>PDF ready</strong><small>{result.name} · {formatBytes(result.bytes.byteLength)}</small></div>
        <button type="button" aria-label="Close completed PDF actions" onClick={() => { window.__dearPdfGeneratedFile = undefined; setResult(null); }}>×</button>
      </div>
      <div className="pdf-suite-result-actions">
        <button className="pdf-suite-download" type="button" onClick={() => downloadAgain(result)}>Download PDF</button>
        <details className="pdf-suite-continue">
          <summary>{opening ? "Opening next tool…" : "Continue with another tool"}<span aria-hidden="true">⌄</span></summary>
          <div className="pdf-suite-tool-choices">
            {tools.map((tool) => (
              <button key={tool.href} type="button" disabled={opening} onClick={() => void passToTool(result, tool.href)}>{tool.label}<span aria-hidden="true">→</span></button>
            ))}
          </div>
        </details>
      </div>
      {error ? <small className="pdf-suite-result-error" role="alert">{error}</small> : null}
    </aside>
  );
}
