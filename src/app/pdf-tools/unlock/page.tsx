"use client";

import { Eye, EyeOff, LockOpen } from "lucide-react";
import { useRef, useState } from "react";
import PdfNextStepSelector from "../../../components/pdf-next-step-selector";
import { downloadGeneratedFile } from "../../../lib/browser-download";
import { useIncomingPdfHandoff } from "../../../lib/pdf-tool-handoff";
import { rasterizedPagesToPdf, type RasterizedPdfPage } from "../../../lib/pdf-tools";
import StitchToolShell from "../../../components/StitchToolShell";
import { trackToolEvent } from "../../../lib/stats";

type SelectedPdf = { file: File; bytes: ArrayBuffer };
type WorkState =
  | { kind: "idle" }
  | { kind: "working"; message: string; completed: number; total: number }
  | { kind: "error"; message: string };
type Quality = "small" | "balanced" | "clear";

const QUALITY: Record<Quality, { dpi: number; jpeg: number; title: string; note: string }> = {
  small: { dpi: 110, jpeg: 0.8, title: "Smaller copy", note: "Good for screen reading and sharing" },
  balanced: { dpi: 144, jpeg: 0.88, title: "Balanced", note: "Recommended for most office PDFs" },
  clear: { dpi: 180, jpeg: 0.92, title: "Clear print", note: "Sharper pages with a larger file" },
};

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function safeBaseName(name: string) {
  return name.replace(/\.pdf$/i, "").replace(/[^\p{L}\p{N}._-]+/gu, "-") || "document";
}

function unlockDownloadName(name: string, fallback: string) {
  const trimmed = name.trim() || fallback;
  const base = trimmed.replace(/\.pdf$/i, "").replace(/[^\p{L}\p{N}._ -]+/gu, "-").replace(/-+/g, "-").replace(/^[\s.-]+|[\s.-]+$/g, "");
  return `${base || "unlocked"}.pdf`;
}

function downloadPdf(bytes: Uint8Array, name: string) {
  downloadGeneratedFile(bytes as BlobPart, name);
}

async function canvasToJpeg(canvas: HTMLCanvasElement, quality: number) {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob) throw new Error("A page image could not be created.");
  return new Uint8Array(await blob.arrayBuffer());
}

export default function UnlockPdfPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<SelectedPdf | null>(null);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [quality, setQuality] = useState<Quality>("balanced");
  const [outputName, setOutputName] = useState("unlocked.pdf");
  const [savedNotice, setSavedNotice] = useState("");
  const [work, setWork] = useState<WorkState>({ kind: "idle" });
  const busy = work.kind === "working";
  useIncomingPdfHandoff(chooseFile);

  async function chooseFile(file?: File) {
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setWork({ kind: "error", message: "Choose a PDF file." });
      return;
    }
    setSelected({ file, bytes: await file.arrayBuffer() });
    setPassword("");
    setOutputName(`${safeBaseName(file.name)}-unlocked.pdf`);
    setSavedNotice("");
    setWork({ kind: "idle" });
    if (inputRef.current) inputRef.current.value = "";
  }

  async function unlockPdf() {
    if (!selected) return;
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    const task = pdfjs.getDocument({
      data: Uint8Array.from(new Uint8Array(selected.bytes)),
      password: password || undefined,
    });
    const pages: RasterizedPdfPage[] = [];

    try {
      trackToolEvent("unlock", "start");
      setWork({ kind: "working", message: "Opening the protected PDF locally…", completed: 0, total: 0 });
      const pdfDocument = await task.promise;
      const preset = QUALITY[quality];
      for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
        setWork({ kind: "working", message: `Rebuilding page ${pageNumber} of ${pdfDocument.numPages}…`, completed: pageNumber - 1, total: pdfDocument.numPages });
        const page = await pdfDocument.getPage(pageNumber);
        const original = page.getViewport({ scale: 1 });
        const requestedScale = preset.dpi / 72;
        const scale = Math.min(requestedScale, 3200 / Math.max(original.width, original.height));
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) throw new Error("Page rendering is not supported in this browser.");
        canvas.width = Math.max(1, Math.ceil(viewport.width));
        canvas.height = Math.max(1, Math.ceil(viewport.height));
        context.fillStyle = "#fff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvas, canvasContext: context, viewport, background: "#fff" }).promise;
        pages.push({
          bytes: await canvasToJpeg(canvas, preset.jpeg),
          width: original.width,
          height: original.height,
        });
        canvas.width = 1;
        canvas.height = 1;
        page.cleanup();
      }
      setWork({ kind: "working", message: "Creating the password-free PDF…", completed: pdfDocument.numPages, total: pdfDocument.numPages });
      downloadPdf(await rasterizedPagesToPdf(pages), unlockDownloadName(outputName, `${safeBaseName(selected.file.name)}-unlocked.pdf`));
      setSavedNotice("Saved. The original protected PDF is still here if you need another copy.");
      trackToolEvent("unlock", "success");
      setWork({ kind: "idle" });
    } catch (error) {
      trackToolEvent("unlock", "error");
      const message = error instanceof Error && (error.name === "PasswordException" || /password/i.test(error.message))
        ? "The password is missing or incorrect. Enter the PDF’s open password and try again."
        : error instanceof Error
          ? error.message
          : "The password could not be removed from this PDF.";
      setWork({ kind: "error", message });
    } finally {
      await task.destroy().catch(() => undefined);
    }
  }

  return (
    <StitchToolShell
      title="Remove Password from PDF"
      subtitle="Remove an open password by rebuilding a local, unprotected copy."
      className={`unlock-pdf-page${selected ? " has-file" : ""}`}
      note="Do not remove protection from a document without authorisation."
    >
      <section className="unlock-workspace">
        <div className="merge-workspace-heading">
          <div><h2>Protected PDF</h2><p>{selected ? `${selected.file.name} · ${formatBytes(selected.file.size)}` : "Choose one password-protected PDF"}</p></div>
          {selected ? <button className="text-button" type="button" onClick={() => { setSelected(null); setPassword(""); setSavedNotice(""); setWork({ kind: "idle" }); }} disabled={busy}>Remove file</button> : null}
        </div>

        {!selected ? (
          <label className="pdf-drop-zone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void chooseFile(event.dataTransfer.files[0]); }}>
            <input ref={inputRef} type="file" accept=".pdf,application/pdf" onChange={(event) => void chooseFile(event.target.files?.[0])} />
            <span className="drop-zone-mark" aria-hidden="true">＋</span><strong>Choose a protected PDF</strong><span>or drag and drop it here</span>
          </label>
        ) : (
          <div className="unlock-controls">
            <label className="unlock-password-field">
              <span>PDF open password</span>
              <div><input type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="off" placeholder="Enter password" disabled={busy} />
                <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}</button>
              </div>
              <small>Leave blank only if the PDF opens without asking for a password.</small>
            </label>

            <fieldset className="unlock-quality"><legend>Output quality</legend>
              {Object.entries(QUALITY).map(([value, preset]) => (
                <label key={value} className={quality === value ? "active" : ""}>
                  <input type="radio" name="unlock-quality" value={value} checked={quality === value} onChange={() => setQuality(value as Quality)} disabled={busy} />
                  <strong>{preset.title}</strong><span>{preset.note}</span>
                </label>
              ))}
            </fieldset>

            <p className="unlock-warning"><strong>Important:</strong> The password-free copy is rebuilt from page images. It keeps the visible appearance, but selectable text, links, form fields, bookmarks, and existing digital signatures are not preserved.</p>

            {work.kind === "working" ? (
              <div className="unlock-progress" role="status">
                <div><span>{work.message}</span><strong>{work.total ? `${work.completed} / ${work.total}` : "Opening"}</strong></div>
                <span><b style={{ width: `${work.total ? (work.completed / work.total) * 100 : 5}%` }} /></span>
              </div>
            ) : null}
            {work.kind === "error" ? <p className="pdf-work-message error" role="alert">{work.message}</p> : null}

            <div className="utility-action-row unlock-action-row">
              <label className="merge-output-name">
                <span>File name</span>
                <input
                  type="text"
                  value={outputName}
                  spellCheck={false}
                  autoComplete="off"
                  disabled={busy}
                  aria-label="Unlocked PDF file name"
                  onChange={(event) => setOutputName(event.target.value)}
                  onBlur={() => setOutputName(unlockDownloadName(outputName, `${safeBaseName(selected.file.name)}-unlocked.pdf`))}
                />
              </label>
              <span>The original PDF stays if the password is wrong.</span>
              <PdfNextStepSelector />
              <button className="merge-button" type="button" onClick={() => void unlockPdf()} disabled={busy}><LockOpen aria-hidden="true" /> {busy ? "Removing password…" : "Remove password & download"}</button>
            </div>
            {savedNotice ? <p className="page-numbers-saved" role="status">{savedNotice}</p> : null}
          </div>
        )}
      </section>
    </StitchToolShell>
  );
}
