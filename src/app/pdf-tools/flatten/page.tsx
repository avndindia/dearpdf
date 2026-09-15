"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import StitchToolShell from "../../../components/StitchToolShell";
import PdfNextStepSelector from "../../../components/pdf-next-step-selector";
import { downloadGeneratedFile } from "../../../lib/browser-download";
import { createFilesZip, inspectPdf, type BinaryDownloadFile } from "../../../lib/pdf-tools";
import { useIncomingPdfHandoff } from "../../../lib/pdf-tool-handoff";
import { flattenPdf } from "../../../lib/raster";
import { trackToolEvent } from "../../../lib/stats";

type FileItem = {
  id: string;
  file: File;
  bytes: ArrayBuffer;
  pageCount: number;
};

type FlattenResult = BinaryDownloadFile & {
  sourceId: string;
  pageCount: number;
};

type WorkState =
  | { kind: "idle" }
  | { kind: "reading" | "working"; message: string }
  | { kind: "error"; message: string };

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

function safeBaseName(fileName: string) {
  return fileName.replace(/\.pdf$/i, "").replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "") || "document";
}

function uniqueOutputName(baseName: string, used: Set<string>) {
  let candidate = `${baseName}-flattened.pdf`;
  let counter = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = `${baseName}-flattened-${counter}.pdf`;
    counter += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

export default function FlattenPdfPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [results, setResults] = useState<FlattenResult[] | null>(null);
  const [work, setWork] = useState<WorkState>({ kind: "idle" });
  const [savedNotice, setSavedNotice] = useState("");
  const busy = work.kind === "reading" || work.kind === "working";

  const totalPages = useMemo(() => files.reduce((sum, item) => sum + item.pageCount, 0), [files]);
  const totalBytes = useMemo(() => files.reduce((sum, item) => sum + item.file.size, 0), [files]);

  const addFiles = useCallback(async (list: FileList | File[] | null | undefined) => {
    if (!list?.length) return;
    setWork({ kind: "reading", message: "Reading PDFs on this device…" });
    const next: FileItem[] = [];
    try {
      for (const file of Array.from(list)) {
        if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) continue;
        const bytes = await file.arrayBuffer();
        const { pageCount } = await inspectPdf(bytes);
        next.push({
          id: `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`,
          file,
          bytes,
          pageCount,
        });
      }
      if (!next.length) {
        setWork({ kind: "error", message: "Choose one or more PDF files." });
        return;
      }
      setFiles((current) => [...current, ...next]);
      setResults(null);
      setSavedNotice("");
      setWork({ kind: "idle" });
    } catch {
      setWork({
        kind: "error",
        message: "One of the files could not be read. Unlock password-protected PDFs first.",
      });
    }
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  useIncomingPdfHandoff((file) => addFiles([file]), addFiles);

  function removeFile(id: string) {
    setFiles((current) => current.filter((item) => item.id !== id));
    setResults(null);
    setSavedNotice("");
  }

  function clearFiles() {
    setFiles([]);
    setResults(null);
    setSavedNotice("");
    setWork({ kind: "idle" });
  }

  async function flattenAll() {
    if (!files.length) return;
    setWork({
      kind: "working",
      message: files.length === 1 ? "Flattening 1 of 1…" : `Flattening 1 of ${files.length}…`,
    });
    trackToolEvent("flatten", "start");
    try {
      const usedNames = new Set<string>();
      const nextResults: FlattenResult[] = [];

      for (let index = 0; index < files.length; index += 1) {
        const item = files[index]!;
        setWork({
          kind: "working",
          message: `Flattening ${index + 1} of ${files.length}…`,
        });
        // Re-read the local file so PDF.js workers never leave a detached buffer.
        const processingBytes = await item.file.arrayBuffer();
        const output = await flattenPdf(processingBytes, (done, total) => {
          setWork({
            kind: "working",
            message: `Flattening ${index + 1} of ${files.length}… page ${done} of ${total}`,
          });
        });
        nextResults.push({
          sourceId: item.id,
          name: uniqueOutputName(safeBaseName(item.file.name), usedNames),
          bytes: output,
          pageCount: item.pageCount,
        });
      }

      setResults(nextResults);

      if (nextResults.length === 1) {
        downloadGeneratedFile(nextResults[0]!.bytes as BlobPart, nextResults[0]!.name);
        setSavedNotice("Saved. Each original PDF is still here.");
      } else {
        const zip = createFilesZip(nextResults.map(({ name, bytes }) => ({ name, bytes })));
        downloadGeneratedFile(zip as BlobPart, "flattened-pdfs.zip");
        setSavedNotice(`Saved ZIP with ${nextResults.length} flattened PDFs. Originals stay here.`);
      }

      trackToolEvent("flatten", "success");
      setWork({ kind: "idle" });
    } catch (error) {
      trackToolEvent("flatten", "error");
      setWork({
        kind: "error",
        message: error instanceof Error ? error.message : "Flatten PDF could not finish.",
      });
    }
  }

  return (
    <StitchToolShell
      title="Flatten PDF"
      subtitle="Bake forms, annotations, and edits into fixed page images — one PDF or many at once."
      className={`utility-pdf-page flatten-multi-page${files.length ? " has-file" : ""}`}
      related={[
        { href: "/pdf-tools/lock", label: "Lock PDF" },
        { href: "/pdf-tools/compress", label: "Compress PDF" },
        { href: "/pdf-tools/merge", label: "Merge PDF" },
      ]}
      note="Each file is flattened separately. Text may no longer be selectable — keep the originals if you still need editable copies."
    >
      <section className="merge-workspace utility-workspace">
        <div className="merge-workspace-heading">
          <div>
            <h2>Source PDFs</h2>
            <p>
              {files.length
                ? `${files.length} ${files.length === 1 ? "file" : "files"} · ${totalPages} ${totalPages === 1 ? "page" : "pages"} · ${formatBytes(totalBytes)}`
                : "Choose one or more PDF files"}
            </p>
          </div>
          {files.length ? (
            <div className="organise-heading-actions">
              <button className="text-button" type="button" onClick={clearFiles} disabled={busy}>
                Clear all
              </button>
            </div>
          ) : null}
        </div>

        {!files.length ? (
          <label
            className={`pdf-drop-zone${busy ? " disabled" : ""}`}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (!busy) void addFiles(event.dataTransfer.files);
            }}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,application/pdf"
              multiple
              disabled={busy}
              onChange={(event) => void addFiles(event.target.files)}
            />
            <span className="drop-zone-mark" aria-hidden="true">＋</span>
            <strong>Choose PDF files</strong>
            <span>or drag and drop several here — each stays its own file</span>
          </label>
        ) : (
          <div className="utility-controls">
            <ol className="bates-file-list" aria-label="PDFs to flatten">
              {files.map((item, index) => (
                <li key={item.id}>
                  <div className="bates-file-pick">
                    <strong>
                      {index + 1}. {item.file.name}
                    </strong>
                    <small>
                      {item.pageCount} {item.pageCount === 1 ? "page" : "pages"} · {formatBytes(item.file.size)}
                    </small>
                  </div>
                  <div className="bates-file-actions">
                    <button
                      type="button"
                      className="text-button"
                      disabled={busy || index === 0}
                      aria-label={`Move ${item.file.name} earlier`}
                      onClick={() => setFiles((current) => moveItem(current, index, index - 1))}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      disabled={busy || index === files.length - 1}
                      aria-label={`Move ${item.file.name} later`}
                      onClick={() => setFiles((current) => moveItem(current, index, index + 1))}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      disabled={busy}
                      onClick={() => removeFile(item.id)}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ol>

            <label
              className={`pdf-drop-zone compact${busy ? " disabled" : ""}`}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (!busy) void addFiles(event.dataTransfer.files);
              }}
            >
              <input
                ref={inputRef}
                type="file"
                accept=".pdf,application/pdf"
                multiple
                disabled={busy}
                onChange={(event) => void addFiles(event.target.files)}
              />
              <strong>Add more PDFs</strong>
            </label>

            <p className="utility-callout">
              Every page becomes an image in the download, so forms and annotations stay fixed.
              Files are flattened separately — they are not merged. Text may no longer be selectable.
            </p>

            <div className="utility-action-row">
              <span>
                {files.length === 1
                  ? `${totalPages} ${totalPages === 1 ? "page" : "pages"} ready`
                  : `${files.length} files · ${totalPages} pages ready`}
              </span>
              <PdfNextStepSelector />
              <button
                className="merge-button"
                type="button"
                disabled={busy || !files.length}
                onClick={() => void flattenAll()}
              >
                {work.kind === "working"
                  ? "Working…"
                  : files.length === 1
                    ? `Flatten ${totalPages} ${totalPages === 1 ? "page" : "pages"}`
                    : `Flatten ${files.length} PDFs`}
              </button>
            </div>

            {results?.length ? (
              <div className="bates-results">
                <h3>Flattened files</h3>
                <ul>
                  {results.map((result) => (
                    <li key={result.name}>
                      <strong>{result.name}</strong>
                      <span>
                        {result.pageCount} {result.pageCount === 1 ? "page" : "pages"}
                      </span>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => downloadGeneratedFile(result.bytes as BlobPart, result.name)}
                      >
                        Download
                      </button>
                    </li>
                  ))}
                </ul>
                {results.length > 1 ? (
                  <div className="bates-result-actions">
                    <button
                      type="button"
                      className="merge-button"
                      onClick={() => {
                        const zip = createFilesZip(results.map(({ name, bytes }) => ({ name, bytes })));
                        downloadGeneratedFile(zip as BlobPart, "flattened-pdfs.zip");
                      }}
                    >
                      Download all as ZIP
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {savedNotice ? (
              <p className="page-numbers-saved" role="status">
                {savedNotice}
              </p>
            ) : null}
          </div>
        )}

        {work.kind !== "idle" ? (
          <p
            className={`pdf-work-message ${work.kind}`}
            role={work.kind === "error" ? "alert" : "status"}
          >
            {work.message}
          </p>
        ) : null}
      </section>
    </StitchToolShell>
  );
}
