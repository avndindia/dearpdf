"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { announceGeneratedPdf, downloadGeneratedFile } from "../../../lib/browser-download";
import { useIncomingPdfHandoff } from "../../../lib/pdf-tool-handoff";
import {
  createFilesZip,
  inspectPdf,
  keepSmallerPdf,
  optimisePdfStructure,
  rasterizedPagesToPdf,
  rasterizedPagesToSizedPdfParts,
  splitPdfByMaximumBytes,
  type RasterizedPdfPage,
} from "../../../lib/pdf-tools";

type SelectedPdf = {
  file: File;
  bytes: ArrayBuffer;
  pageCount: number;
};

type PdfPart = {
  name: string;
  bytes: Uint8Array;
  pageStart: number;
  pageEnd: number;
};

type Result = {
  bytes: Uint8Array;
  parts?: PdfPart[];
  mode: "safe" | "strong";
  usedOriginal: boolean;
  targetBytes?: number;
  targetAchieved?: boolean;
  dpi?: number;
  quality?: number;
  note?: string;
};

type WorkState =
  | { kind: "idle" }
  | { kind: "reading"; message: string }
  | { kind: "working"; message: string; percent: number }
  | { kind: "error"; message: string };

type Level = "extreme" | "recommended" | "less";
type TargetUnit = "MB" | "KB";

const LEVELS = {
  extreme: { label: "Extreme", hint: "Smallest file", mode: "strong" as const, dpi: 96, quality: 52 },
  recommended: { label: "Balanced", hint: "Good quality", mode: "strong" as const, dpi: 144, quality: 72 },
  less: { label: "Less", hint: "Keeps text", mode: "safe" as const, dpi: 192, quality: 84 },
} as const;

const LARGE_PAGE_COUNT = 80;
const LARGE_FILE_BYTES = 20 * 1024 * 1024;
const MIN_PART_MB = 0.5;
const MAX_PART_MB = 50;

function isLargePdf(pageCount: number, fileSize: number) {
  return pageCount > LARGE_PAGE_COUNT || fileSize > LARGE_FILE_BYTES;
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 1 : 2)} MB`;
}

function formatMb(value: number) {
  return `${value.toFixed(2)} MB`;
}

function targetValueInUnit(valueMb: number, unit: TargetUnit) {
  return unit === "MB" ? valueMb : valueMb * 1024;
}

function targetMbFromInput(value: string, unit: TargetUnit) {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return unit === "MB" ? parsed : parsed / 1024;
}

function formatTargetInput(valueMb: number, unit: TargetUnit) {
  const value = targetValueInUnit(valueMb, unit);
  return unit === "MB"
    ? Number(value.toFixed(2)).toString()
    : Math.max(1, Math.round(value)).toString();
}

function formatTargetSize(valueMb: number, unit: TargetUnit) {
  if (unit === "MB") return formatMb(valueMb);
  return `${Math.max(1, Math.round(valueMb * 1024)).toLocaleString()} KB`;
}

function targetBounds(fileSize: number, pageCount: number) {
  const sourceMb = fileSize / (1024 * 1024);
  const maximumMb = Math.max(0.01, Math.floor((sourceMb - 0.01) * 100) / 100);
  const estimatedStructuralMinimumMb = Math.ceil(
    ((32 * 1024 + pageCount * 6 * 1024) / (1024 * 1024)) * 100,
  ) / 100;
  const minimumMb = Math.min(
    maximumMb,
    Math.max(0.01, estimatedStructuralMinimumMb),
  );
  return {
    minimumMb,
    maximumMb,
    defaultMb: Math.min(
      maximumMb,
      Math.max(minimumMb, Math.round(sourceMb * 50) / 100),
    ),
  };
}

function targetForLevel(level: Level, bounds: { minimumMb: number; maximumMb: number }) {
  const span = Math.max(0, bounds.maximumMb - bounds.minimumMb);
  if (level === "extreme") return Math.round((bounds.minimumMb + span * 0.18) * 100) / 100;
  if (level === "recommended") return Math.round((bounds.minimumMb + span * 0.5) * 100) / 100;
  return bounds.maximumMb;
}

function safeBaseName(fileName: string) {
  return fileName.replace(/\.pdf$/i, "").replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "") || "document";
}

function compressDownloadName(name: string, fallback: string) {
  const trimmed = name.trim() || fallback;
  const base = trimmed.replace(/\.pdf$/i, "").replace(/[^\p{L}\p{N}._ -]+/gu, "-").replace(/-+/g, "-").replace(/^[\s.-]+|[\s.-]+$/g, "");
  return `${base || "compressed"}.pdf`;
}

function downloadPdf(bytes: Uint8Array, fileName: string) {
  downloadGeneratedFile(bytes as BlobPart, fileName);
}

function compressedPdfName(fileName: string, usedOriginal: boolean) {
  return usedOriginal ? fileName : `${safeBaseName(fileName)}-compressed.pdf`;
}

function namePdfParts(
  fileName: string,
  parts: Array<{ bytes: Uint8Array; pageStart: number; pageEnd: number }>,
): PdfPart[] {
  const baseName = safeBaseName(fileName);
  const width = Math.max(2, String(parts.length).length);
  return parts.map((part, index) => ({
    ...part,
    name: `${baseName}-part-${String(index + 1).padStart(width, "0")}.pdf`,
  }));
}

async function canvasToJpeg(canvas: HTMLCanvasElement, quality: number) {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality),
  );
  if (!blob) throw new Error("A PDF page could not be compressed.");
  return new Uint8Array(await blob.arrayBuffer());
}

async function rasterizePdf(
  bytes: ArrayBuffer,
  dpi: number,
  quality: number,
  onProgress: (page: number, total: number) => void,
) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const task = pdfjs.getDocument({ data: Uint8Array.from(new Uint8Array(bytes)) });
  const document = await task.promise;
  const pages: RasterizedPdfPage[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      onProgress(pageNumber, document.numPages);
      const page = await document.getPage(pageNumber);
      const pageSize = page.getViewport({ scale: 1 });
      const desiredScale = dpi / 72;
      const desiredWidth = pageSize.width * desiredScale;
      const desiredHeight = pageSize.height * desiredScale;
      const safetyScale = Math.min(
        1,
        5000 / desiredWidth,
        5000 / desiredHeight,
        Math.sqrt(20_000_000 / (desiredWidth * desiredHeight)),
      );
      const viewport = page.getViewport({ scale: desiredScale * safetyScale });
      const canvas = window.document.createElement("canvas");
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("PDF compression is not supported in this browser.");
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: context, viewport, background: "#fff" }).promise;
      pages.push({
        bytes: await canvasToJpeg(canvas, quality),
        width: pageSize.width,
        height: pageSize.height,
      });
      canvas.width = 1;
      canvas.height = 1;
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }

  return pages;
}

async function decodeJpeg(bytes: ArrayBuffer | Uint8Array) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const url = URL.createObjectURL(new Blob([view as BlobPart], { type: "image/jpeg" }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("A compressed page could not be resized."));
      image.src = url;
    });
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function resamplePages(
  pages: RasterizedPdfPage[],
  scale: number,
  quality: number,
  onProgress?: (page: number, total: number) => void,
) {
  const next: RasterizedPdfPage[] = [];
  for (let index = 0; index < pages.length; index += 1) {
    onProgress?.(index + 1, pages.length);
    const page = pages[index];
    const image = await decodeJpeg(page.bytes);
    const canvas = window.document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("PDF compression is not supported in this browser.");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    next.push({
      bytes: await canvasToJpeg(canvas, quality),
      width: page.width,
      height: page.height,
    });
    canvas.width = 1;
    canvas.height = 1;
  }
  return next;
}

export default function CompressPdfPage() {
  const [selected, setSelected] = useState<SelectedPdf | null>(null);
  const [level, setLevel] = useState<Level>("recommended");
  const [dpi, setDpi] = useState<number>(LEVELS.recommended.dpi);
  const [quality, setQuality] = useState<number>(LEVELS.recommended.quality);
  const [targetMb, setTargetMb] = useState(0.5);
  const [targetInput, setTargetInput] = useState("0.5");
  const [targetUnit, setTargetUnit] = useState<TargetUnit>("MB");
  const [splitIntoParts, setSplitIntoParts] = useState(false);
  const [partMb, setPartMb] = useState(10);
  const [result, setResult] = useState<Result | null>(null);
  const [outputName, setOutputName] = useState("compressed.pdf");
  const [work, setWork] = useState<WorkState>({ kind: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = work.kind === "reading" || work.kind === "working";
  const mode = LEVELS[level].mode;
  useIncomingPdfHandoff(chooseFile);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("split") === "1") setSplitIntoParts(true);
  }, []);

  async function chooseFile(file?: File) {
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setWork({ kind: "error", message: "Choose a PDF file." });
      return;
    }
    setWork({ kind: "reading", message: "Checking the PDF on this device…" });
    try {
      const bytes = await file.arrayBuffer();
      const { pageCount } = await inspectPdf(bytes);
      const boundsForFile = targetBounds(file.size, pageCount);
      const nextLevel = file.size > LARGE_FILE_BYTES ? "less" : "recommended";
      const defaultTarget = targetForLevel(nextLevel, boundsForFile);
      setSelected({ file, bytes, pageCount });
      setLevel(nextLevel);
      setDpi(LEVELS[nextLevel].dpi);
      setQuality(LEVELS[nextLevel].quality);
      setTargetMb(defaultTarget);
      setTargetInput(formatTargetInput(defaultTarget, "MB"));
      setTargetUnit("MB");
      setResult(null);
      setOutputName(`${safeBaseName(file.name)}-compressed.pdf`);
      setWork({ kind: "idle" });
    } catch (error) {
      const message = error instanceof Error && /encrypted/i.test(error.message)
        ? `${file.name} is password-protected. Remove its password before compression.`
        : `${file.name} could not be read as a valid PDF.`;
      setWork({ kind: "error", message });
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  function clearFile() {
    setSelected(null);
    setResult(null);
    setOutputName("compressed.pdf");
    setWork({ kind: "idle" });
  }

  function applySize(nextMb: number, fromSlider = false) {
    setTargetMb(nextMb);
    setTargetInput(formatTargetInput(nextMb, targetUnit));
    if (fromSlider && level === "less") {
      setLevel("recommended");
      setDpi(LEVELS.recommended.dpi);
      setQuality(LEVELS.recommended.quality);
    }
    setResult(null);
  }

  function chooseLevel(next: Level) {
    setLevel(next);
    setDpi(LEVELS[next].dpi);
    setQuality(LEVELS[next].quality);
    if (bounds) {
      const nextMb = targetForLevel(next, bounds);
      setTargetMb(nextMb);
      setTargetInput(formatTargetInput(nextMb, targetUnit));
    }
    setResult(null);
  }

  function normaliseTargetSize() {
    if (!bounds) return targetMb;
    const enteredMb = targetMbFromInput(targetInput, targetUnit);
    const nextMb = Math.min(
      bounds.maximumMb,
      Math.max(bounds.minimumMb, enteredMb ?? targetMb),
    );
    setTargetMb(nextMb);
    setTargetInput(formatTargetInput(nextMb, targetUnit));
    return nextMb;
  }

  async function splitRasterizedPages(pages: RasterizedPdfPage[], maximumBytes: number) {
    let current = pages;
    let scale = 1;
    for (let attempt = 0; attempt < 7; attempt += 1) {
      try {
        const sized = await rasterizedPagesToSizedPdfParts(current, maximumBytes);
        let pageStart = 1;
        return sized.map((part) => {
          const named = { bytes: part.bytes, pageStart, pageEnd: pageStart + part.pageCount - 1 };
          pageStart += part.pageCount;
          return named;
        });
      } catch (error) {
        if (scale <= 0.16) throw error;
        scale = Math.max(0.16, scale * 0.7);
        setWork({ kind: "working", message: "Fitting pages into the part size", percent: 72 + attempt * 4 });
        current = await resamplePages(current, 0.7, Math.max(0.16, (quality / 100) * scale));
      }
    }
    throw new Error("One compressed page is larger than the maximum part size.");
  }

  async function finishWithParts(
    sourceBytes: Uint8Array,
    usedOriginal: boolean,
    resultMode: "safe" | "strong",
    extras: Partial<Result> = {},
  ) {
    if (!selected) return;
    const partBytes = Math.round(partMb * 1024 * 1024);
    if (!splitIntoParts || sourceBytes.length <= partBytes) {
      setResult({
        bytes: sourceBytes,
        usedOriginal,
        mode: resultMode,
        ...extras,
      });
      return;
    }
    setWork({ kind: "working", message: "Splitting into parts under the size you set", percent: 92 });
    const parts = namePdfParts(selected.file.name, await splitPdfByMaximumBytes(sourceBytes, partBytes));
    setResult({
      bytes: sourceBytes,
      parts,
      usedOriginal,
      mode: resultMode,
      targetBytes: partBytes,
      targetAchieved: parts.every((part) => part.bytes.length <= partBytes),
      ...extras,
    });
  }

  function changeTargetUnit(nextUnit: TargetUnit) {
    const enteredMb = targetMbFromInput(targetInput, targetUnit) ?? targetMb;
    setTargetMb(enteredMb);
    setTargetUnit(nextUnit);
    setTargetInput(formatTargetInput(enteredMb, nextUnit));
    setResult(null);
  }

  async function compressPdf() {
    if (!selected) return;
    setResult(null);
    setWork({
      kind: "working",
      message: mode === "safe"
        ? "Keeping text and reducing structure…"
        : "Preparing pages…",
      percent: 4,
    });

    try {
      const partBytes = Math.round(partMb * 1024 * 1024);
      if (splitIntoParts && partBytes < 128 * 1024) {
        setWork({ kind: "error", message: "Choose a part size of at least 0.13 MB." });
        return;
      }

      if (splitIntoParts && mode === "strong") {
        const pages = await rasterizePdf(selected.bytes, dpi, quality / 100, (page, total) => {
          setWork({
            kind: "working",
            message: "Rendering pages",
            percent: 8 + (page / total) * 70,
          });
        });
        const rawParts = await splitRasterizedPages(pages, partBytes);
        const parts = namePdfParts(selected.file.name, rawParts);
        setResult({
          bytes: parts.length === 1 ? parts[0].bytes : createFilesZip(parts),
          parts,
          usedOriginal: false,
          mode,
          targetBytes: partBytes,
          targetAchieved: parts.every((part) => part.bytes.length <= partBytes),
          dpi,
          quality,
          note: parts.length === 1
            ? undefined
            : `${parts.length} parts, each under ${formatBytes(partBytes)}.`,
        });
      } else if (mode === "safe") {
        const candidate = await optimisePdfStructure(selected.bytes);
        const output = keepSmallerPdf(selected.bytes, candidate);
        await finishWithParts(output.bytes, output.usedOriginal, mode);
      } else {
        const normalisedTargetMb = normaliseTargetSize();
        const targetBytes = Math.round(normalisedTargetMb * 1024 * 1024);

        setWork({
          kind: "working",
          message: "Shrinking the file structure…",
          percent: 6,
        });
        const structuredBytes = await optimisePdfStructure(selected.bytes);
        if (structuredBytes.length <= targetBytes) {
          await finishWithParts(structuredBytes, false, "safe", {
            targetBytes,
            targetAchieved: true,
            note: "Reached the size without turning pages into images.",
          });
        } else {
          let workingPages = await rasterizePdf(selected.bytes, dpi, quality / 100, (page, total) => {
            setWork({
              kind: "working",
              message: "Rendering pages",
              percent: 8 + (page / total) * 52,
            });
          });
          let outputBytes = await rasterizedPagesToPdf(workingPages);
          let outputDpi = dpi;
          let outputQuality = quality;

          if (outputBytes.length > targetBytes) {
            let low = 0.16;
            let high = 1;
            let bestUnder: { bytes: Uint8Array; pages: RasterizedPdfPage[]; scale: number; jpeg: number } | null = null;
            const attempts = 6;
            for (let attempt = 1; attempt <= attempts; attempt += 1) {
              const scale = (low + high) / 2;
              const jpeg = Math.max(0.16, (quality / 100) * (0.5 + 0.5 * scale));
              const resampled = await resamplePages(workingPages, scale, jpeg, (page, total) => {
                setWork({
                  kind: "working",
                  message: "Fitting to the size you set",
                  percent: 60 + ((attempt - 1 + page / total) / attempts) * 38,
                });
              });
              const fitted = await rasterizedPagesToPdf(resampled);
              if (fitted.length <= targetBytes) {
                bestUnder = { bytes: fitted, pages: resampled, scale, jpeg };
                low = scale;
              } else {
                high = scale;
              }
              if (!bestUnder && fitted.length < outputBytes.length) {
                outputBytes = fitted;
                workingPages = resampled;
                outputDpi = Math.round(dpi * scale);
                outputQuality = Math.round(jpeg * 100);
              }
            }
            if (bestUnder) {
              outputBytes = bestUnder.bytes;
              workingPages = bestUnder.pages;
              outputDpi = Math.round(dpi * bestUnder.scale);
              outputQuality = Math.round(bestUnder.jpeg * 100);
            } else {
              const jpeg = 0.14;
              const resampled = await resamplePages(workingPages, 0.16, jpeg, (page, total) => {
                setWork({
                  kind: "working",
                  message: "Fitting to the size you set",
                  percent: 92 + (page / total) * 6,
                });
              });
              const fitted = await rasterizedPagesToPdf(resampled);
              if (fitted.length < outputBytes.length || fitted.length <= targetBytes) {
                outputBytes = fitted;
                workingPages = resampled;
                outputDpi = Math.round(dpi * 0.16);
                outputQuality = 14;
              }
            }
          }

          const usedOriginal = outputBytes.length >= selected.file.size;
          setDpi(outputDpi);
          setQuality(outputQuality);
          if (!usedOriginal && splitIntoParts && outputBytes.length > partBytes) {
            const rawParts = await splitRasterizedPages(workingPages, partBytes);
            const parts = namePdfParts(selected.file.name, rawParts);
            setResult({
              bytes: parts.length === 1 ? parts[0].bytes : createFilesZip(parts),
              parts,
              usedOriginal: false,
              mode,
              targetBytes: partBytes,
              targetAchieved: parts.every((part) => part.bytes.length <= partBytes),
              dpi: outputDpi,
              quality: outputQuality,
            });
          } else {
            await finishWithParts(
              usedOriginal ? new Uint8Array(selected.bytes) : outputBytes,
              usedOriginal,
              mode,
              {
                targetBytes,
                targetAchieved: !usedOriginal && outputBytes.length <= targetBytes,
                dpi: outputDpi,
                quality: outputQuality,
                note: !usedOriginal && outputBytes.length <= targetBytes
                  ? undefined
                  : `Could not get under ${formatBytes(targetBytes)} from this file.`,
              },
            );
          }
        }
      }
      setWork({ kind: "idle" });
    } catch (error) {
      setWork({ kind: "error", message: error instanceof Error ? error.message : "The PDF could not be compressed." });
    }
  }

  const difference = selected && result ? selected.file.size - result.bytes.length : 0;
  const reduction = selected && result ? difference / selected.file.size * 100 : 0;
  const bounds = selected ? targetBounds(selected.file.size, selected.pageCount) : null;
  const targetDifference = result?.targetBytes
    ? result.targetBytes - result.bytes.length
    : 0;

  useEffect(() => {
    if (!selected || !result || (result.parts && result.parts.length > 1)) return;
    announceGeneratedPdf(
      result.bytes as BlobPart,
      compressDownloadName(outputName, compressedPdfName(selected.file.name, result.usedOriginal)),
    );
  }, [result, selected, outputName]);

  return (
    <div className={`pdf-page compress-page${selected ? " has-file" : ""}${splitIntoParts ? " size-split-page" : ""}`}>
      <header className="site-header pdf-site-header">
        <div>
          <Link className="pdf-tools-back" href="/pdf-tools">← All PDF tools</Link>
          <h1>Compress PDF</h1>
          <p>Reduce size, or split into parts under a limit. Files stay on this device.</p>
        </div>
        <div className="local-processing-badge"><span aria-hidden="true">●</span>Files stay on this device</div>
      </header>
<section className="merge-intro">
        <div>
          <p className="pdf-eyebrow">PROCESSED IN THIS BROWSER</p>
          <h2>Make PDFs easier to share.</h2>
        </div>
        <p>
          Keep the text when you can. Use Balanced or Extreme when the file
          must be smaller. Turn on split if each piece must stay under an
          email or upload limit.
        </p>
      </section>

      <section className="compress-workspace">
        {!selected ? (
          <label className={`pdf-drop-zone${busy ? " disabled" : ""}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (!busy) void chooseFile(event.dataTransfer.files[0]); }}>
            <input ref={inputRef} type="file" accept=".pdf,application/pdf" disabled={busy} onChange={(event) => void chooseFile(event.target.files?.[0])} />
            <span className="drop-zone-mark" aria-hidden="true">＋</span>
            <strong>Choose a PDF file</strong>
            <span>or drag and drop it here</span>
          </label>
        ) : (
          <>
            <div className="selected-document-card" aria-label={`Uploaded document: ${selected.file.name}`}>
              <div className="selected-document-details">
                <strong title={selected.file.name}>{selected.file.name}</strong>
                <small>{selected.pageCount} {selected.pageCount === 1 ? "page" : "pages"} · {formatBytes(selected.file.size)}</small>
              </div>
              <button type="button" onClick={clearFile} disabled={busy}>Remove</button>
            </div>
            <div className="compression-levels" role="radiogroup" aria-label="Compression level">
              {(["extreme", "recommended", "less"] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  className={level === key ? "active" : ""}
                  onClick={() => chooseLevel(key)}
                  disabled={busy}
                  aria-pressed={level === key}
                >
                  <strong>{LEVELS[key].label}</strong>
                  <span>{LEVELS[key].hint}</span>
                </button>
              ))}
            </div>
            <p className="compression-safe-note">
              {splitIntoParts
                ? (level === "less"
                  ? "Keeps text and splits the original pages into parts under this size."
                  : "Pages become images. Each part stays under the size you set.")
                : (level === "less"
                  ? "Keeps text. Drag the size if the file must be smaller."
                  : isLargePdf(selected.pageCount, selected.file.size)
                    ? `${selected.pageCount} pages · ${formatBytes(selected.file.size)}. One pass only — this can still take several minutes.`
                    : "Pages become images.")}
            </p>
            <label className="compression-split-option">
              <input
                type="checkbox"
                checked={splitIntoParts}
                onChange={(event) => {
                  setSplitIntoParts(event.target.checked);
                  setResult(null);
                }}
                disabled={busy}
              />
              <span>
                <strong>Split into parts</strong>
                <small>Each finished PDF stays under a size you set</small>
              </span>
            </label>
            {splitIntoParts ? (
              <div className="compression-size-row">
                <div className="compression-size-heading">
                  <span>Maximum size per part</span>
                  <span className="compression-size-fields">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={String(partMb)}
                      onChange={(event) => {
                        const nextInput = event.target.value;
                        if (!/^\d*(?:\.\d*)?$/.test(nextInput)) return;
                        const next = Number(nextInput);
                        if (Number.isFinite(next)) {
                          setPartMb(Math.min(MAX_PART_MB, Math.max(0.13, Math.round(next * 100) / 100)));
                          setResult(null);
                        }
                      }}
                      disabled={busy}
                      aria-label="Maximum size per part in MB"
                    />
                    <span className="compression-size-unit">MB</span>
                  </span>
                </div>
                <input
                  type="range"
                  min={MIN_PART_MB}
                  max={MAX_PART_MB}
                  step="0.1"
                  value={Math.min(MAX_PART_MB, Math.max(MIN_PART_MB, partMb))}
                  onChange={(event) => {
                    setPartMb(Number(event.target.value));
                    setResult(null);
                  }}
                  disabled={busy}
                  aria-label="Maximum size per part"
                />
                <div className="compression-size-scale">
                  <span>{MIN_PART_MB} MB</span>
                  <span>{MAX_PART_MB} MB</span>
                </div>
              </div>
            ) : bounds ? (
              <div className="compression-size-row">
                <div className="compression-size-heading">
                  <span>Maximum size</span>
                  <span className="compression-size-fields">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={targetInput}
                      onChange={(event) => {
                        const nextInput = event.target.value;
                        if (!/^\d*(?:\.\d*)?$/.test(nextInput)) return;
                        setTargetInput(nextInput);
                        const nextMb = targetMbFromInput(nextInput, targetUnit);
                        if (nextMb !== null) setTargetMb(nextMb);
                        setResult(null);
                      }}
                      onBlur={normaliseTargetSize}
                      disabled={busy}
                      aria-label={`Maximum size in ${targetUnit}`}
                    />
                    <select
                      aria-label="Size unit"
                      value={targetUnit}
                      onChange={(event) => changeTargetUnit(event.target.value as TargetUnit)}
                      disabled={busy}
                    >
                      <option value="MB">MB</option>
                      <option value="KB">KB</option>
                    </select>
                  </span>
                </div>
                <input
                  type="range"
                  min={bounds.minimumMb}
                  max={bounds.maximumMb}
                  step="0.01"
                  value={Math.min(bounds.maximumMb, Math.max(bounds.minimumMb, targetMb))}
                  onChange={(event) => applySize(Number(event.target.value), true)}
                  disabled={busy}
                  aria-label="Maximum PDF size"
                />
                <div className="compression-size-scale">
                  <span>{formatTargetSize(bounds.minimumMb, targetUnit)}</span>
                  <span>{formatTargetSize(bounds.maximumMb, targetUnit)}</span>
                </div>
              </div>
            ) : null}
            <div className="compression-action-row">
              <label className="merge-output-name">
                <span>File name</span>
                <input
                  type="text"
                  value={outputName}
                  spellCheck={false}
                  autoComplete="off"
                  disabled={busy}
                  aria-label="Compressed PDF file name"
                  onChange={(event) => setOutputName(event.target.value)}
                  onBlur={() => setOutputName(compressDownloadName(outputName, compressedPdfName(selected.file.name, false)))}
                />
              </label>
              <button className="merge-button" type="button" onClick={() => void compressPdf()} disabled={busy}>
                {work.kind === "working" ? "Compressing…" : splitIntoParts ? "Compress and split" : "Compress PDF"}
              </button>
            </div>
            {work.kind === "working" ? (
              <div className="compression-progress" role="status" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(work.percent)}>
                <div className="compression-progress-heading">
                  <strong>{Math.round(work.percent)}%</strong>
                  <span>{work.message}</span>
                </div>
                <div className="compression-progress-track">
                  <span style={{ width: `${Math.max(2, Math.min(100, work.percent))}%` }} />
                </div>
              </div>
            ) : null}

            {result?.parts && result.parts.length > 1 ? (
              <section className="size-split-result" aria-live="polite">
                <div className="size-split-result-heading">
                  <div>
                    <span>{result.parts.length} parts</span>
                    <strong>
                      {formatBytes(result.parts.reduce((sum, part) => sum + part.bytes.length, 0))} total
                      {result.targetBytes ? ` · each under ${formatBytes(result.targetBytes)}` : ""}
                    </strong>
                  </div>
                  <button
                    className="merge-button"
                    type="button"
                    onClick={() => downloadGeneratedFile(
                      createFilesZip(result.parts ?? []) as BlobPart,
                      `${safeBaseName(selected.file.name)}-compressed-parts.zip`,
                    )}
                  >
                    Download ZIP
                  </button>
                </div>
                <ol>
                  {result.parts.map((part) => (
                    <li key={part.name}>
                      <span>{part.pageStart}–{part.pageEnd}</span>
                      <div><strong>{part.name}</strong><small>Pages {part.pageStart}–{part.pageEnd}</small></div>
                      <b>{formatBytes(part.bytes.length)}</b>
                      <button type="button" onClick={() => downloadGeneratedFile(part.bytes as BlobPart, part.name)}>Download</button>
                    </li>
                  ))}
                </ol>
              </section>
            ) : result ? (
              <section className={`compression-result${result.usedOriginal ? " no-saving" : ""}`} aria-live="polite">
                <div><span>Original</span><strong>{formatBytes(selected.file.size)}</strong></div>
                <span className="compression-result-arrow" aria-hidden="true">→</span>
                <div><span>{result.usedOriginal ? "Final file" : "Compressed"}</span><strong>{formatBytes(result.bytes.length)}</strong></div>
                <div className="compression-saving">
                  <span>{result.usedOriginal ? "Original kept" : result.targetAchieved ? "Target reached" : "Compressed"}</span>
                  <strong>
                    {result.usedOriginal
                      ? (result.note ? "Size not possible" : "No size increase")
                      : result.targetAchieved
                        ? `${formatBytes(Math.max(0, targetDifference))} under target`
                        : `${reduction.toFixed(1)}% smaller`}
                  </strong>
                  <small>
                    {result.note
                      || (result.usedOriginal
                        ? "Compression did not produce a smaller file"
                        : `${formatBytes(difference)} saved${result.dpi ? ` · ${result.dpi} DPI` : ""}`)}
                  </small>
                </div>
                <button className="merge-button" type="button" onClick={() => downloadPdf(result.bytes, compressDownloadName(outputName, compressedPdfName(selected.file.name, result.usedOriginal)))}>
                  {result.usedOriginal
                    ? `Download original · ${formatBytes(result.bytes.length)}`
                    : `Download ${formatBytes(result.bytes.length)} · ${Math.max(1, Math.round(result.bytes.length / selected.file.size * 100))}% of original`}
                </button>
                <p className="compression-keep-note">The original file is still loaded. Try another level if you want a different size.</p>
              </section>
            ) : null}
          </>
        )}

        {work.kind === "reading" || work.kind === "error" ? (
          <p className={`pdf-work-message ${work.kind}`} role={work.kind === "error" ? "alert" : "status"}>{work.message}</p>
        ) : null}
      </section>

      {selected && isLargePdf(selected.pageCount, selected.file.size) && level !== "less" ? (
        <p className="large-file-note">This file is large. Extreme and Balanced turn every page into an image in this browser.</p>
      ) : null}

      <section className="merge-assurance">
        <div><strong>Local compression</strong><span>Source pages and output stay in this browser tab.</span></div>
        <div><strong>No file tracking</strong><span>Analytics never receive filenames, contents, or quality choices.</span></div>
        <div><strong>Never larger</strong><span>The original is retained whenever compression cannot reduce its size.</span></div>
        <div><strong>Split if needed</strong><span>Optional parts stay under an email or upload limit, in page order.</span></div>
      </section>

      <footer className="site-footer">
        <p><Link href="/">DearPDF</Link> · Government rules and everyday office tools.</p>
      </footer>
    </div>
  );
}
