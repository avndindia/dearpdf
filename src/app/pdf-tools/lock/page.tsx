"use client";

import { Eye, EyeOff, LockKeyhole } from "lucide-react";
import { useRef, useState } from "react";
import PdfNextStepSelector from "../../../components/pdf-next-step-selector";
import { downloadGeneratedFile } from "../../../lib/browser-download";
import { useIncomingPdfHandoff } from "../../../lib/pdf-tool-handoff";
import StitchToolShell from "../../../components/StitchToolShell";
import { trackToolEvent } from "../../../lib/stats";

type SelectedPdf = { file: File; bytes: ArrayBuffer };
type WorkState = { kind: "idle" } | { kind: "working"; message: string } | { kind: "error"; message: string };

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function safeBaseName(name: string) {
  return name.replace(/\.pdf$/i, "").replace(/[^\p{L}\p{N}._-]+/gu, "-") || "document";
}

function lockDownloadName(name: string, fallback: string) {
  const trimmed = name.trim() || fallback;
  const base = trimmed.replace(/\.pdf$/i, "").replace(/[^\p{L}\p{N}._ -]+/gu, "-").replace(/-+/g, "-").replace(/^[\s.-]+|[\s.-]+$/g, "");
  return `${base || "protected"}.pdf`;
}

function downloadPdf(bytes: Uint8Array, name: string) {
  downloadGeneratedFile(bytes as BlobPart, name);
}

function randomOwnerPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export default function LockPdfPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<SelectedPdf | null>(null);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [outputName, setOutputName] = useState("protected.pdf");
  const [savedNotice, setSavedNotice] = useState("");
  const [work, setWork] = useState<WorkState>({ kind: "idle" });
  const busy = work.kind === "working";
  useIncomingPdfHandoff(chooseFile);
  const passwordError = password && password.length < 4
    ? "Use at least 4 characters."
    : confirmation && password !== confirmation
      ? "The passwords do not match."
      : "";
  const ready = Boolean(selected && password.length >= 4 && password === confirmation);

  async function chooseFile(file?: File) {
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setWork({ kind: "error", message: "Choose a PDF file." });
      return;
    }
    setSelected({ file, bytes: await file.arrayBuffer() });
    setPassword("");
    setConfirmation("");
    setOutputName(`${safeBaseName(file.name)}-protected.pdf`);
    setSavedNotice("");
    setWork({ kind: "idle" });
    if (inputRef.current) inputRef.current.value = "";
  }

  async function lockPdf() {
    if (!selected || !ready) return;
    setWork({ kind: "working", message: "Applying 256-bit password protection locally…" });
    trackToolEvent("lock", "start");
    let runner: Awaited<ReturnType<(typeof import("qpdf-run"))["createQpdfRunner"]>> | null = null;
    try {
      const { createQpdfRunner } = await import("qpdf-run");
      runner = await createQpdfRunner({
        workerUrl: new URL("qpdf-run/worker", import.meta.url),
        qpdfJsUrl: new URL("qpdf-run/qpdf.js", import.meta.url),
        wasmUrl: new URL("qpdf-run/qpdf.wasm", import.meta.url),
        timeoutMs: 120_000,
      });
      const output = await runner.runOne({
        input: selected.bytes,
        inputName: "input.pdf",
        outputName: "locked.pdf",
        args: ["--encrypt", password, randomOwnerPassword(), "256", "--", "input.pdf", "locked.pdf"],
      });
      downloadPdf(output, lockDownloadName(outputName, `${safeBaseName(selected.file.name)}-protected.pdf`));
      setSavedNotice("Saved. The original unprotected PDF is still here.");
      trackToolEvent("lock", "success");
      setWork({ kind: "idle" });
    } catch (error) {
      trackToolEvent("lock", "error");
      const detail = error && typeof error === "object" && "stderr" in error && Array.isArray(error.stderr)
        ? error.stderr.join(" ")
        : "";
      setWork({
        kind: "error",
        message: /encrypted|password/i.test(detail)
          ? "This PDF is already protected. Remove its current password first, then apply the new password."
          : "Password protection could not be applied in this browser. Try a current version of Chrome, Safari, Edge, or Firefox.",
      });
    } finally {
      await runner?.destroy();
    }
  }

  return (
    <StitchToolShell
      title="Add Password to PDF"
      subtitle="Add an open password with 256-bit encryption."
      className={`lock-pdf-page${selected ? " has-file" : ""}`}
      note="Store the password securely before sharing or deleting the original PDF."
    >
      <section className="lock-workspace">
        <div className="merge-workspace-heading">
          <div><h2>PDF and password</h2><p>{selected ? `${selected.file.name} · ${formatBytes(selected.file.size)}` : "Choose an unprotected PDF"}</p></div>
          {selected ? <button className="text-button" type="button" onClick={() => { setSelected(null); setPassword(""); setConfirmation(""); setSavedNotice(""); setWork({ kind: "idle" }); }} disabled={busy}>Remove file</button> : null}
        </div>

        {!selected ? (
          <label className="pdf-drop-zone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void chooseFile(event.dataTransfer.files[0]); }}>
            <input ref={inputRef} type="file" accept=".pdf,application/pdf" onChange={(event) => void chooseFile(event.target.files?.[0])} />
            <span className="drop-zone-mark" aria-hidden="true">＋</span><strong>Choose a PDF file</strong><span>or drag and drop it here</span>
          </label>
        ) : (
          <div className="lock-controls">
            <div className="lock-password-grid">
              <label className="unlock-password-field">
                <span>Password to open PDF</span>
                <div><input type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" placeholder="Create password" disabled={busy} />
                  <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}</button>
                </div>
              </label>
              <label className="unlock-password-field">
                <span>Confirm password</span>
                <div>
                  <input type={showPassword ? "text" : "password"} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" placeholder="Repeat password" disabled={busy} />
                  <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}</button>
                </div>
              </label>
            </div>
            {passwordError ? <p className="split-range-error" role="alert">{passwordError}</p> : null}

            <div className="lock-security-note"><LockKeyhole aria-hidden="true" /><div><strong>256-bit encryption</strong><span>The open password protects the entire PDF while normal printing and copying permissions remain available after opening.</span></div></div>
            <p className="unlock-warning"><strong>Keep the password safely.</strong> DearPDF cannot recover it because neither the document nor password is uploaded or stored.</p>
            {work.kind === "working" ? <div className="lock-working" role="status"><span /><strong>{work.message}</strong></div> : null}
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
                  aria-label="Protected PDF file name"
                  onChange={(event) => setOutputName(event.target.value)}
                  onBlur={() => setOutputName(lockDownloadName(outputName, `${safeBaseName(selected.file.name)}-protected.pdf`))}
                />
              </label>
              <span>The original PDF remains unchanged.</span>
              <PdfNextStepSelector />
              <button className="merge-button" type="button" onClick={() => void lockPdf()} disabled={busy || !ready}><LockKeyhole aria-hidden="true" /> {busy ? "Protecting…" : "Add password & download"}</button>
            </div>
            {savedNotice ? <p className="page-numbers-saved" role="status">{savedNotice}</p> : null}
          </div>
        )}
      </section>
    </StitchToolShell>
  );
}
