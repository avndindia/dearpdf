"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import PdfPageWorkspace from "../../../components/pdf-page-workspace";
import {
  PdfLazyPreviewControls,
  PdfLazyPreviewStatus,
  usePdfLazyPreviews,
} from "../../../components/pdf-lazy-previews";
import PdfNextStepSelector from "../../../components/pdf-next-step-selector";
import { downloadGeneratedFile } from "../../../lib/browser-download";
import { useIncomingPdfHandoff } from "../../../lib/pdf-tool-handoff";
import {
  inspectPdf,
  parsePageSelection,
  stampPdfWithImage,
  type WatermarkPosition,
} from "../../../lib/pdf-tools";
import StitchToolShell from "../../../components/StitchToolShell";

type SelectedPdf = { file: File; bytes: ArrayBuffer; pageCount: number };
type WorkState = { kind: "idle" } | { kind: "reading" | "working" | "error"; message: string };
type SignaturePosition = Exclude<WatermarkPosition, "tile">;

function safeBaseName(name: string) {
  return name.replace(/\.pdf$/i, "").replace(/[^\p{L}\p{N}._-]+/gu, "-") || "document";
}

function signDownloadName(name: string, fallback: string) {
  const trimmed = name.trim() || fallback;
  const base = trimmed.replace(/\.pdf$/i, "").replace(/[^\p{L}\p{N}._ -]+/gu, "-").replace(/-+/g, "-").replace(/^[\s.-]+|[\s.-]+$/g, "");
  return `${base || "signed"}.pdf`;
}

const SIGNATURE_STORAGE_KEY = "dc-pdf-last-signature";

function saveSignatureToDevice(canvas: HTMLCanvasElement) {
  try {
    const dataUrl = canvas.toDataURL("image/png");
    if (dataUrl && dataUrl.length > 64) window.localStorage.setItem(SIGNATURE_STORAGE_KEY, dataUrl);
  } catch {
    /* Private mode may block storage. */
  }
}

function readSavedSignature() {
  try {
    return window.localStorage.getItem(SIGNATURE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export default function SignPdfPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef({ x: 0, y: 0 });
  const [selected, setSelected] = useState<SelectedPdf | null>(null);
  const { pages: visualPages, previewState, previewProgress, loadPreviews, hidePreviews, resetPreviews } = usePdfLazyPreviews("sign");
  const [applyTo, setApplyTo] = useState<"last" | "range">("last");
  const [range, setRange] = useState("");
  const [position, setPosition] = useState<SignaturePosition>("bottom-right");
  const [widthPercent, setWidthPercent] = useState(24);
  const [penWidth, setPenWidth] = useState(3);
  const [hasInk, setHasInk] = useState(false);
  const [outputName, setOutputName] = useState("signed.pdf");
  const [savedNotice, setSavedNotice] = useState("");
  const [work, setWork] = useState<WorkState>({ kind: "idle" });
  const busy = work.kind === "reading" || work.kind === "working";
  useIncomingPdfHandoff(chooseFile);

  const selection = useMemo(() => {
    if (!selected) return { pages: [] as number[], error: "" };
    if (applyTo === "last") return { pages: [selected.pageCount - 1], error: "" };
    try {
      return { pages: parsePageSelection(range, selected.pageCount), error: "" };
    } catch (error) {
      return { pages: [] as number[], error: error instanceof Error ? error.message : "Invalid page range." };
    }
  }, [applyTo, range, selected]);

  function canvasPoint(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = event.currentTarget;
    const box = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - box.left) * canvas.width / box.width,
      y: (event.clientY - box.top) * canvas.height / box.height,
    };
  }

  function startDrawing(event: React.PointerEvent<HTMLCanvasElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    lastPointRef.current = canvasPoint(event);
  }

  function draw(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const context = event.currentTarget.getContext("2d");
    if (!context) return;
    const next = canvasPoint(event);
    context.strokeStyle = "#111111";
    context.lineWidth = penWidth;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo(lastPointRef.current.x, lastPointRef.current.y);
    context.lineTo(next.x, next.y);
    context.stroke();
    lastPointRef.current = next;
    setHasInk(true);
  }

  function finishDrawing() {
    const wasDrawing = drawingRef.current;
    drawingRef.current = false;
    const canvas = canvasRef.current;
    if (canvas && (hasInk || wasDrawing)) saveSignatureToDevice(canvas);
  }

  function clearSignature() {
    const canvas = canvasRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
    try {
      window.localStorage.removeItem(SIGNATURE_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    if (!selected) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const saved = readSavedSignature();
    if (!saved) return;
    const image = new Image();
    image.onload = () => {
      const context = canvas.getContext("2d");
      if (!context) return;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      setHasInk(true);
    };
    image.src = saved;
  }, [selected]);

  async function chooseFile(file?: File) {
    if (!file) return;
    setWork({ kind: "reading", message: "Reading the PDF locally…" });
    resetPreviews();
    try {
      const bytes = await file.arrayBuffer();
      const { pageCount } = await inspectPdf(bytes);
      setSelected({ file, bytes, pageCount });
      setRange(String(pageCount));
      setOutputName(`${safeBaseName(file.name)}-signed.pdf`);
      setSavedNotice("");
      setWork({ kind: "idle" });
    } catch {
      resetPreviews();
      setSelected(null);
      setWork({ kind: "error", message: "Choose a valid, unlocked PDF file." });
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function signPdf() {
    const canvas = canvasRef.current;
    if (!selected || !canvas || !hasInk || !selection.pages.length) return;
    setWork({ kind: "working", message: "Placing the signature on this device…" });
    try {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("The signature could not be prepared.");
      saveSignatureToDevice(canvas);
      const output = await stampPdfWithImage(
        selected.bytes,
        await blob.arrayBuffer(),
        "image/png",
        { pageIndices: selection.pages, position, widthPercent },
      );
      downloadGeneratedFile(
        output as BlobPart,
        signDownloadName(outputName, `${safeBaseName(selected.file.name)}-signed.pdf`),
      );
      setSavedNotice("Saved. The original PDF and this signature stay here for the next document.");
      setWork({ kind: "idle" });
    } catch (error) {
      setWork({ kind: "error", message: error instanceof Error ? error.message : "The signature could not be added." });
    }
  }

  return (
    <StitchToolShell
      title="Sign PDF"
      subtitle="Draw a signature and place it on selected pages."
      className={`utility-pdf-page${selected ? " has-file" : ""}`}
      note="Use an approved digital-signature system when a certificate-backed signature is legally required."
    >
      <section className="merge-workspace utility-workspace">
        <div className="merge-workspace-heading"><div><h2>Document and signature</h2><p>{selected ? `${selected.pageCount} pages ready` : "Start with a PDF"}</p></div>{selected ? <div className="organise-heading-actions"><PdfLazyPreviewControls previewState={previewState} onShow={() => { if (selected) void loadPreviews(selected.bytes).catch(() => setWork({ kind: "error", message: "Page previews could not be created for this PDF." })); }} onHide={hidePreviews} disabled={busy} /><button className="text-button" type="button" onClick={() => { resetPreviews(); setSelected(null); }}>Remove file</button></div> : null}</div>
        {!selected ? (
          <label className="pdf-drop-zone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void chooseFile(event.dataTransfer.files[0]); }}>
            <input ref={fileInputRef} type="file" accept=".pdf,application/pdf" onChange={(event) => void chooseFile(event.target.files?.[0])} /><span className="drop-zone-mark" aria-hidden="true">＋</span><strong>Choose a PDF file</strong><span>or drag and drop it here</span>
          </label>
        ) : (
          <div className="utility-controls signature-controls">
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
              disabled={busy}
              title="Select and preview pages to sign"
            />
            ) : null}
            <div className="signature-pad-wrap">
              <div className="signature-pad-heading"><span>Draw your signature</span><button className="text-button" type="button" onClick={clearSignature}>Clear</button></div>
              <canvas ref={canvasRef} className="signature-pad" width="720" height="220" aria-label="Signature drawing area"
                onPointerDown={startDrawing} onPointerMove={draw} onPointerUp={finishDrawing} onPointerCancel={finishDrawing} />
              <label className="utility-field"><span>Pen width: {penWidth}px</span><input type="range" min="1" max="8" value={penWidth} onChange={(event) => setPenWidth(Number(event.target.value))} /></label>
              <p className="signature-reuse-note">This signature is kept on this device so the next order can use it without redrawing.</p>
            </div>
            <fieldset className="utility-fieldset"><legend>Pages</legend><div className="utility-choice-row">
              <label><input type="radio" checked={applyTo === "last"} onChange={() => setApplyTo("last")} /> Last page only</label>
              <label><input type="radio" checked={applyTo === "range"} onChange={() => setApplyTo("range")} /> Selected pages</label>
            </div>{applyTo === "range" ? <label className="utility-field"><span>Page range</span><input value={range} onChange={(event) => setRange(event.target.value)} /></label> : null}{selection.error ? <p className="split-range-error">{selection.error}</p> : null}</fieldset>
            <div className="utility-form-grid">
              <label className="utility-field"><span>Position</span><select value={position} onChange={(event) => setPosition(event.target.value as SignaturePosition)}>
                <option value="bottom-left">Bottom left</option><option value="bottom-right">Bottom right</option><option value="center">Centre</option><option value="top-left">Top left</option><option value="top-right">Top right</option>
              </select></label>
              <label className="utility-field"><span>Signature width: {widthPercent}%</span><input type="range" min="8" max="50" value={widthPercent} onChange={(event) => setWidthPercent(Number(event.target.value))} /></label>
            </div>
            <p className="utility-callout">This adds the drawing as a visible signature image. It is not a certificate-based cryptographic digital signature.</p>
            <div className="utility-action-row">
              <label className="merge-output-name">
                <span>File name</span>
                <input
                  type="text"
                  value={outputName}
                  spellCheck={false}
                  autoComplete="off"
                  disabled={busy}
                  aria-label="Signed PDF file name"
                  onChange={(event) => setOutputName(event.target.value)}
                  onBlur={() => setOutputName(signDownloadName(outputName, `${safeBaseName(selected.file.name)}-signed.pdf`))}
                />
              </label>
              <span>{hasInk ? `${selection.pages.length} pages selected` : "Draw a signature first"}</span>
              <PdfNextStepSelector />
              <button className="merge-button" type="button" disabled={busy || !hasInk || !selection.pages.length || Boolean(selection.error)} onClick={() => void signPdf()}>
                {work.kind === "working" ? "Signing…" : `Sign ${selection.pages.length} ${selection.pages.length === 1 ? "page" : "pages"}`}
              </button>
            </div>
            {savedNotice ? <p className="page-numbers-saved" role="status">{savedNotice}</p> : null}
          </div>
        )}
        {work.kind !== "idle" ? <p className={`pdf-work-message ${work.kind}`} role={work.kind === "error" ? "alert" : "status"}>{work.message}</p> : null}
      </section>
    </StitchToolShell>
  );
}
