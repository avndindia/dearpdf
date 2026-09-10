"use client";

import Link from "next/link";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import type { PdfTool } from "@/lib/catalog";
import DropZone from "./DropZone";
import PrivacyChip from "./PrivacyChip";
import { downloadGeneratedFile, formatBytes, safeBaseName } from "@/lib/download";
import { readableError, readFileBytes } from "@/lib/files";
import {
  addPageNumbersPdf,
  createFilesZip,
  cropPdf,
  extractPdfPages,
  flattenPdfForms,
  imagesToPdf,
  inspectPdf,
  keepSmallerPdf,
  mergePdfDocuments,
  optimisePdfStructure,
  organisePdfPages,
  parsePageSelection,
  splitPdfIntoEqualPartsZip,
  splitPdfIntoZip,
  stampPdfWithImage,
  updatePdfMetadata,
  watermarkPdf,
  type PageNumberFormat,
  type PageNumberPosition,
  type WatermarkPosition,
} from "@/lib/pdf-tools";
import { applyPdfEdits, type PdfEditorAnnotation } from "@/lib/pdf-editor";
import { createEditableDocx } from "@/lib/docx";
import { encryptPdfWithPassword } from "@/lib/qpdf";
import {
  compressByRaster,
  compressSplitBySize,
  grayscalePdf,
  unlockByRaster,
} from "@/lib/raster";
import { canvasToBlob, loadPdfDocument, renderPageToCanvas } from "@/lib/pdfjs";

type Work =
  | { kind: "idle" }
  | { kind: "busy"; message: string }
  | { kind: "error"; message: string }
  | { kind: "done"; message: string };

type Loaded = {
  file: File;
  bytes: ArrayBuffer;
  pageCount?: number;
};

export default function ToolClient({ tool }: { tool: PdfTool }) {
  const [files, setFiles] = useState<Loaded[]>([]);
  const [work, setWork] = useState<Work>({ kind: "idle" });
  const busy = work.kind === "busy";

  // Shared options
  const [pageRange, setPageRange] = useState("");
  const [splitEvery, setSplitEvery] = useState(1);
  const [splitMode, setSplitMode] = useState<"range" | "every" | "each">("range");
  const [rotate, setRotate] = useState(0);
  const [removePages, setRemovePages] = useState("");
  const [pagePos, setPagePos] = useState<PageNumberPosition>("bottom-center");
  const [pageFormat, setPageFormat] = useState<PageNumberFormat>("number");
  const [startAt, setStartAt] = useState(1);
  const [fontSize, setFontSize] = useState(12);
  const [cropTop, setCropTop] = useState(10);
  const [cropRight, setCropRight] = useState(10);
  const [cropBottom, setCropBottom] = useState(10);
  const [cropLeft, setCropLeft] = useState(10);
  const [compressMode, setCompressMode] = useState<"safe" | "strong">("safe");
  const [maxMb, setMaxMb] = useState(5);
  const [wmText, setWmText] = useState("CONFIDENTIAL");
  const [wmPos, setWmPos] = useState<WatermarkPosition>("center");
  const [wmOpacity, setWmOpacity] = useState(0.25);
  const [wmSize, setWmSize] = useState(48);
  const [wmRotation, setWmRotation] = useState(-30);
  const [metaTitle, setMetaTitle] = useState("");
  const [metaAuthor, setMetaAuthor] = useState("");
  const [metaSubject, setMetaSubject] = useState("");
  const [metaKeywords, setMetaKeywords] = useState("");
  const [editText, setEditText] = useState("Note");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [imageFormat, setImageFormat] = useState<"png" | "jpeg" | "webp">("png");
  const [imageScale, setImageScale] = useState(1.5);
  const [pageSize, setPageSize] = useState<"a4" | "letter" | "fit">("a4");
  const [ocrLang, setOcrLang] = useState("eng+hin+mar");
  const [signDataUrl, setSignDataUrl] = useState<string | null>(null);
  const [signWidth, setSignWidth] = useState(24);

  const primary = files[0];

  const onFiles = useCallback(
    async (picked: File[]) => {
      setWork({ kind: "busy", message: "Reading file…" });
      try {
        const loaded: Loaded[] = [];
        for (const file of picked) {
          const bytes = await readFileBytes(file);
          let pageCount: number | undefined;
          if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
            try {
              pageCount = (await inspectPdf(bytes)).pageCount;
            } catch {
              pageCount = undefined;
            }
          }
          loaded.push({ file, bytes, pageCount });
        }
        setFiles(tool.multiple ? [...files, ...loaded] : loaded);
        setWork({ kind: "idle" });
      } catch (error) {
        setWork({ kind: "error", message: readableError(error, "Could not read the file.") });
      }
    },
    [files, tool.multiple],
  );

  function reset() {
    setFiles([]);
    setWork({ kind: "idle" });
    setSignDataUrl(null);
  }

  const fileSummary = useMemo(() => {
    if (!files.length) return null;
    return files
      .map((f) => `${f.file.name} (${formatBytes(f.file.size)}${f.pageCount ? `, ${f.pageCount} pages` : ""})`)
      .join(" · ");
  }, [files]);

  async function run() {
    if (!files.length) return;
    setWork({ kind: "busy", message: "Working in this browser…" });
    try {
      const slug = tool.slug;
      const base = safeBaseName(files[0].file.name);

      if (slug === "merge") {
        if (files.length < 2) throw new Error("Choose at least two PDF files to merge.");
        const out = await mergePdfDocuments(
          files.map((f) => ({ bytes: f.bytes, name: f.file.name })),
        );
        downloadGeneratedFile(out as BlobPart, `${base}-merged.pdf`);
      } else if (slug === "split") {
        const bytes = files[0].bytes;
        const count = files[0].pageCount ?? (await inspectPdf(bytes)).pageCount;
        if (splitMode === "each") {
          const zip = await splitPdfIntoZip(bytes);
          downloadGeneratedFile(zip as BlobPart, `${base}-pages.zip`, "application/zip");
        } else if (splitMode === "every") {
          const every = Math.max(1, splitEvery);
          const partCount = Math.max(2, Math.ceil(count / every));
          const zip = await splitPdfIntoEqualPartsZip(bytes, Math.min(partCount, count), base);
          downloadGeneratedFile(zip as BlobPart, `${base}-parts.zip`, "application/zip");
        } else {
          const indices = parsePageSelection(pageRange || `1-${count}`, count);
          const out = await extractPdfPages(bytes, indices);
          downloadGeneratedFile(out as BlobPart, `${base}-extract.pdf`);
        }
      } else if (slug === "organise") {
        const count = files[0].pageCount ?? (await inspectPdf(files[0].bytes)).pageCount;
        const remove = removePages.trim()
          ? new Set(parsePageSelection(removePages, count))
          : new Set<number>();
        const ops = [];
        for (let i = 0; i < count; i++) {
          if (remove.has(i)) continue;
          ops.push({ pageIndex: i, rotation: ((rotate % 360) + 360) % 360 });
        }
        if (!ops.length) throw new Error("Keep at least one page.");
        const out = await organisePdfPages(files[0].bytes, ops);
        downloadGeneratedFile(out as BlobPart, `${base}-organised.pdf`);
      } else if (slug === "page-numbers") {
        const count = files[0].pageCount ?? (await inspectPdf(files[0].bytes)).pageCount;
        const indices = parsePageSelection(pageRange || `1-${count}`, count);
        const out = await addPageNumbersPdf(files[0].bytes, {
          pageIndices: indices,
          position: pagePos,
          format: pageFormat,
          startAt,
          fontSize,
          margin: 24,
          color: "#111111",
        });
        downloadGeneratedFile(out as BlobPart, `${base}-numbered.pdf`);
      } else if (slug === "crop") {
        const count = files[0].pageCount ?? (await inspectPdf(files[0].bytes)).pageCount;
        const indices = parsePageSelection(pageRange || `1-${count}`, count);
        const mm = 72 / 25.4;
        const out = await cropPdf(files[0].bytes, {
          pageIndices: indices,
          top: cropTop * mm,
          right: cropRight * mm,
          bottom: cropBottom * mm,
          left: cropLeft * mm,
        });
        downloadGeneratedFile(out as BlobPart, `${base}-cropped.pdf`);
      } else if (slug === "compress") {
        if (compressMode === "safe") {
          const optimised = await optimisePdfStructure(files[0].bytes);
          const result = keepSmallerPdf(new Uint8Array(files[0].bytes), optimised);
          downloadGeneratedFile(result.bytes as BlobPart, `${base}-compressed.pdf`);
          setWork({
            kind: "done",
            message: result.usedOriginal
              ? "Already compact — kept the smaller original structure."
              : "Compressed with structural optimisation.",
          });
          return;
        }
        const out = await compressByRaster(files[0].bytes, 120, 0.72, (d, t) =>
          setWork({ kind: "busy", message: `Compressing page ${d}/${t}…` }),
        );
        const result = keepSmallerPdf(new Uint8Array(files[0].bytes), out);
        downloadGeneratedFile(result.bytes as BlobPart, `${base}-compressed.pdf`);
      } else if (slug === "compress-split") {
        const parts = await compressSplitBySize(
          files[0].bytes,
          Math.max(0.5, maxMb) * 1024 * 1024,
          (d, t) => setWork({ kind: "busy", message: `Preparing page ${d}/${t}…` }),
        );
        const zip = createFilesZip(
          parts.map((part, i) => ({
            name: `${base}-part-${String(i + 1).padStart(2, "0")}.pdf`,
            bytes: part.bytes,
          })),
        );
        downloadGeneratedFile(zip as BlobPart, `${base}-parts.zip`, "application/zip");
      } else if (slug === "grayscale") {
        const out = await grayscalePdf(files[0].bytes, (d, t) =>
          setWork({ kind: "busy", message: `Converting page ${d}/${t}…` }),
        );
        downloadGeneratedFile(out as BlobPart, `${base}-grayscale.pdf`);
      } else if (slug === "edit") {
        const annotations: PdfEditorAnnotation[] = [
          {
            id: "note-1",
            kind: "text",
            pageIndex: 0,
            x: 0.12,
            y: 0.12,
            width: 0.4,
            height: 0.06,
            text: editText || "Note",
            fontSize: 16,
            bold: false,
          },
          {
            id: "hl-1",
            kind: "highlight",
            pageIndex: 0,
            x: 0.12,
            y: 0.2,
            width: 0.35,
            height: 0.03,
            thickness: 1,
          },
        ];
        const out = await applyPdfEdits(files[0].bytes, annotations);
        downloadGeneratedFile(out as BlobPart, `${base}-edited.pdf`);
      } else if (slug === "watermark") {
        const count = files[0].pageCount ?? (await inspectPdf(files[0].bytes)).pageCount;
        const indices = parsePageSelection(pageRange || `1-${count}`, count);
        const out = await watermarkPdf(
          files[0].bytes,
          { kind: "text", text: wmText || "WATERMARK", color: "#666666", size: wmSize },
          {
            pageIndices: indices,
            position: wmPos,
            opacity: wmOpacity,
            rotation: wmRotation,
          },
        );
        downloadGeneratedFile(out as BlobPart, `${base}-watermarked.pdf`);
      } else if (slug === "metadata") {
        const out = await updatePdfMetadata(files[0].bytes, {
          title: metaTitle || undefined,
          author: metaAuthor || undefined,
          subject: metaSubject || undefined,
          keywords: metaKeywords
            ? metaKeywords.split(",").map((k) => k.trim()).filter(Boolean)
            : undefined,
          creator: "DearPDF",
        });
        downloadGeneratedFile(out as BlobPart, `${base}-metadata.pdf`);
      } else if (slug === "flatten") {
        const out = await flattenPdfForms(files[0].bytes);
        downloadGeneratedFile(out as BlobPart, `${base}-flattened.pdf`);
      } else if (slug === "sign") {
        if (!signDataUrl) throw new Error("Draw a signature first.");
        const res = await fetch(signDataUrl);
        const imgBytes = new Uint8Array(await res.arrayBuffer());
        const count = files[0].pageCount ?? (await inspectPdf(files[0].bytes)).pageCount;
        const indices = pageRange.trim()
          ? parsePageSelection(pageRange, count)
          : [count - 1];
        const out = await stampPdfWithImage(files[0].bytes, imgBytes, "image/png", {
          pageIndices: indices,
          position: "bottom-right",
          widthPercent: signWidth,
          opacity: 1,
        });
        downloadGeneratedFile(out as BlobPart, `${base}-signed.pdf`);
      } else if (slug === "images-to-pdf") {
        const images = [];
        for (const f of files) {
          const bitmap = await createImageBitmap(f.file);
          const mime =
            f.file.type === "image/png" ? ("image/png" as const) : ("image/jpeg" as const);
          images.push({
            bytes: f.bytes,
            mimeType: mime,
            width: bitmap.width,
            height: bitmap.height,
            rotation: 0,
          });
          bitmap.close();
        }
        const out = await imagesToPdf(images, {
          pageSize,
          orientation: "auto",
          margin: 24,
        });
        downloadGeneratedFile(out as BlobPart, `images.pdf`);
      } else if (slug === "pdf-to-images") {
        const pdf = await loadPdfDocument(files[0].bytes);
        const zipFiles = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          setWork({ kind: "busy", message: `Rendering page ${i}/${pdf.numPages}…` });
          const { canvas } = await renderPageToCanvas(pdf, i, imageScale);
          const mime =
            imageFormat === "png"
              ? "image/png"
              : imageFormat === "webp"
                ? "image/webp"
                : "image/jpeg";
          const blob = await canvasToBlob(canvas, mime, 0.92);
          const ext = imageFormat === "jpeg" ? "jpg" : imageFormat;
          zipFiles.push({
            name: `${base}-p${String(i).padStart(3, "0")}.${ext}`,
            bytes: new Uint8Array(await blob.arrayBuffer()),
          });
        }
        pdf.cleanup();
        const zip = createFilesZip(zipFiles);
        downloadGeneratedFile(zip as BlobPart, `${base}-images.zip`, "application/zip");
      } else if (slug === "pdf-to-word") {
        const pdf = await loadPdfDocument(files[0].bytes);
        const pages = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          setWork({ kind: "busy", message: `Reading page ${i}/${pdf.numPages}…` });
          const page = await pdf.getPage(i);
          const text = await page.getTextContent();
          const lines = text.items
            .map((item) => ("str" in item ? item.str : ""))
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
          pages.push({
            pageNumber: i,
            lines: lines ? [lines] : ["[No extractable text on this page]"],
          });
        }
        pdf.cleanup();
        const docx = createEditableDocx(pages, { title: base, creator: "DearPDF", includePageLabels: true });
        downloadGeneratedFile(docx as BlobPart, `${base}.docx`, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      } else if (slug === "ocr") {
        const pdf = await loadPdfDocument(files[0].bytes);
        const { createWorker } = await import("tesseract.js");
        const worker = await createWorker(ocrLang);
        const chunks: string[] = [];
        try {
          for (let i = 1; i <= pdf.numPages; i++) {
            setWork({ kind: "busy", message: `OCR page ${i}/${pdf.numPages}…` });
            const page = await pdf.getPage(i);
            const embedded = await page.getTextContent();
            const embeddedText = embedded.items
              .map((item) => ("str" in item ? item.str : ""))
              .join(" ")
              .replace(/\s+/g, " ")
              .trim();
            if (embeddedText.length > 40) {
              chunks.push(`--- Page ${i} ---\n${embeddedText}`);
              continue;
            }
            const { canvas } = await renderPageToCanvas(pdf, i, 2);
            const { data } = await worker.recognize(canvas);
            chunks.push(`--- Page ${i} ---\n${data.text.trim() || "[No text recognised]"}`);
          }
        } finally {
          await worker.terminate();
          pdf.cleanup();
        }
        const text = chunks.join("\n\n");
        downloadGeneratedFile(text, `${base}-ocr.txt`, "text/plain;charset=utf-8");
      } else if (slug === "add-password") {
        if (password.length < 4) throw new Error("Use at least 4 characters.");
        if (password !== password2) throw new Error("Passwords do not match.");
        const out = await encryptPdfWithPassword(files[0].bytes, password);
        downloadGeneratedFile(out as BlobPart, `${base}-locked.pdf`);
      } else if (slug === "remove-password") {
        if (!password) throw new Error("Enter the current open password.");
        const out = await unlockByRaster(files[0].bytes, password, (d, t) =>
          setWork({ kind: "busy", message: `Unlocking page ${d}/${t}…` }),
        );
        downloadGeneratedFile(out as BlobPart, `${base}-unlocked.pdf`);
      } else if (slug === "repair") {
        const out = await optimisePdfStructure(files[0].bytes);
        downloadGeneratedFile(out as BlobPart, `${base}-repaired.pdf`);
      } else {
        throw new Error("Unknown tool.");
      }

      setWork({ kind: "done", message: "Done — your download should start automatically." });
    } catch (error) {
      setWork({ kind: "error", message: readableError(error) });
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/" className="text-sm text-[var(--muted)] hover:text-[var(--ink)]">
          ← All tools
        </Link>
        <PrivacyChip />
      </div>

      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">
          DearPDF
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-[var(--ink)] sm:text-4xl">
          {tool.title}
        </h1>
        <p className="text-lg text-[var(--muted)]">{tool.job}</p>
        {tool.limit === "partial" && tool.limitNote ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Honest limit: {tool.limitNote}
          </p>
        ) : null}
      </header>

      {!files.length ? (
        <DropZone
          accept={tool.accept}
          multiple={tool.multiple}
          disabled={busy}
          onFiles={onFiles}
          label={
            tool.multiple
              ? "Drop files here, or browse"
              : "Drop a file here, or browse"
          }
        />
      ) : (
        <section className="space-y-5 rounded-2xl border border-[var(--line)] bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-medium text-[var(--ink)]">{fileSummary}</p>
              <p className="text-sm text-[var(--muted)]">Still only on this device.</p>
            </div>
            <button
              type="button"
              className="text-sm text-[var(--accent)] hover:underline"
              onClick={reset}
              disabled={busy}
            >
              Start over
            </button>
          </div>

          {tool.multiple ? (
            <DropZone
              accept={tool.accept}
              multiple
              disabled={busy}
              onFiles={onFiles}
              label="Add more files"
            />
          ) : null}

          <Options
            tool={tool}
            busy={busy}
            pageRange={pageRange}
            setPageRange={setPageRange}
            splitEvery={splitEvery}
            setSplitEvery={setSplitEvery}
            splitMode={splitMode}
            setSplitMode={setSplitMode}
            rotate={rotate}
            setRotate={setRotate}
            removePages={removePages}
            setRemovePages={setRemovePages}
            pagePos={pagePos}
            setPagePos={setPagePos}
            pageFormat={pageFormat}
            setPageFormat={setPageFormat}
            startAt={startAt}
            setStartAt={setStartAt}
            fontSize={fontSize}
            setFontSize={setFontSize}
            cropTop={cropTop}
            setCropTop={setCropTop}
            cropRight={cropRight}
            setCropRight={setCropRight}
            cropBottom={cropBottom}
            setCropBottom={setCropBottom}
            cropLeft={cropLeft}
            setCropLeft={setCropLeft}
            compressMode={compressMode}
            setCompressMode={setCompressMode}
            maxMb={maxMb}
            setMaxMb={setMaxMb}
            wmText={wmText}
            setWmText={setWmText}
            wmPos={wmPos}
            setWmPos={setWmPos}
            wmOpacity={wmOpacity}
            setWmOpacity={setWmOpacity}
            wmSize={wmSize}
            setWmSize={setWmSize}
            wmRotation={wmRotation}
            setWmRotation={setWmRotation}
            metaTitle={metaTitle}
            setMetaTitle={setMetaTitle}
            metaAuthor={metaAuthor}
            setMetaAuthor={setMetaAuthor}
            metaSubject={metaSubject}
            setMetaSubject={setMetaSubject}
            metaKeywords={metaKeywords}
            setMetaKeywords={setMetaKeywords}
            editText={editText}
            setEditText={setEditText}
            password={password}
            setPassword={setPassword}
            password2={password2}
            setPassword2={setPassword2}
            imageFormat={imageFormat}
            setImageFormat={setImageFormat}
            imageScale={imageScale}
            setImageScale={setImageScale}
            pageSize={pageSize}
            setPageSize={setPageSize}
            ocrLang={ocrLang}
            setOcrLang={setOcrLang}
            signDataUrl={signDataUrl}
            setSignDataUrl={setSignDataUrl}
            signWidth={signWidth}
            setSignWidth={setSignWidth}
            pageCount={primary?.pageCount}
          />

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={run}
              disabled={busy}
              className="rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[var(--accent-hover)] disabled:opacity-60"
            >
              {busy ? "Working…" : `Run ${tool.title}`}
            </button>
            {work.kind === "busy" ? (
              <p className="text-sm text-[var(--muted)]">{work.message}</p>
            ) : null}
            {work.kind === "error" ? (
              <p className="text-sm text-red-600">{work.message}</p>
            ) : null}
            {work.kind === "done" ? (
              <p className="text-sm text-emerald-700">{work.message}</p>
            ) : null}
          </div>
        </section>
      )}
    </div>
  );
}

type OptProps = {
  tool: PdfTool;
  busy: boolean;
  pageRange: string;
  setPageRange: (v: string) => void;
  splitEvery: number;
  setSplitEvery: (v: number) => void;
  splitMode: "range" | "every" | "each";
  setSplitMode: (v: "range" | "every" | "each") => void;
  rotate: number;
  setRotate: (v: number) => void;
  removePages: string;
  setRemovePages: (v: string) => void;
  pagePos: PageNumberPosition;
  setPagePos: (v: PageNumberPosition) => void;
  pageFormat: PageNumberFormat;
  setPageFormat: (v: PageNumberFormat) => void;
  startAt: number;
  setStartAt: (v: number) => void;
  fontSize: number;
  setFontSize: (v: number) => void;
  cropTop: number;
  setCropTop: (v: number) => void;
  cropRight: number;
  setCropRight: (v: number) => void;
  cropBottom: number;
  setCropBottom: (v: number) => void;
  cropLeft: number;
  setCropLeft: (v: number) => void;
  compressMode: "safe" | "strong";
  setCompressMode: (v: "safe" | "strong") => void;
  maxMb: number;
  setMaxMb: (v: number) => void;
  wmText: string;
  setWmText: (v: string) => void;
  wmPos: WatermarkPosition;
  setWmPos: (v: WatermarkPosition) => void;
  wmOpacity: number;
  setWmOpacity: (v: number) => void;
  wmSize: number;
  setWmSize: (v: number) => void;
  wmRotation: number;
  setWmRotation: (v: number) => void;
  metaTitle: string;
  setMetaTitle: (v: string) => void;
  metaAuthor: string;
  setMetaAuthor: (v: string) => void;
  metaSubject: string;
  setMetaSubject: (v: string) => void;
  metaKeywords: string;
  setMetaKeywords: (v: string) => void;
  editText: string;
  setEditText: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  password2: string;
  setPassword2: (v: string) => void;
  imageFormat: "png" | "jpeg" | "webp";
  setImageFormat: (v: "png" | "jpeg" | "webp") => void;
  imageScale: number;
  setImageScale: (v: number) => void;
  pageSize: "a4" | "letter" | "fit";
  setPageSize: (v: "a4" | "letter" | "fit") => void;
  ocrLang: string;
  setOcrLang: (v: string) => void;
  signDataUrl: string | null;
  setSignDataUrl: (v: string | null) => void;
  signWidth: number;
  setSignWidth: (v: number) => void;
  pageCount?: number;
};

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1.5 text-sm">
      <span className="font-medium text-[var(--ink)]">{label}</span>
      {children}
    </label>
  );
}

const inputClass =
  "w-full rounded-xl border border-[var(--line)] bg-[var(--wash)] px-3 py-2 text-[var(--ink)] outline-none focus:border-[var(--accent)]";

function Options(props: OptProps) {
  const { tool } = props;
  const slug = tool.slug;

  if (slug === "merge" || slug === "flatten" || slug === "repair" || slug === "grayscale") {
    return (
      <p className="text-sm text-[var(--muted)]">
        {slug === "merge"
          ? "Files will be merged in the order listed above."
          : "No extra options — run when ready."}
      </p>
    );
  }

  if (slug === "split") {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Mode">
          <select
            className={inputClass}
            value={props.splitMode}
            disabled={props.busy}
            onChange={(e) => props.setSplitMode(e.target.value as typeof props.splitMode)}
          >
            <option value="range">Extract page range</option>
            <option value="every">Split into equal parts (N pages each, approx)</option>
            <option value="each">One PDF per page (ZIP)</option>
          </select>
        </Field>
        {props.splitMode === "range" ? (
          <Field label={`Pages (1-${props.pageCount ?? "?"})`}>
            <input
              className={inputClass}
              placeholder="e.g. 1-3, 5, 8-10"
              value={props.pageRange}
              disabled={props.busy}
              onChange={(e) => props.setPageRange(e.target.value)}
            />
          </Field>
        ) : null}
        {props.splitMode === "every" ? (
          <Field label="Pages per part">
            <input
              type="number"
              min={1}
              className={inputClass}
              value={props.splitEvery}
              disabled={props.busy}
              onChange={(e) => props.setSplitEvery(Number(e.target.value) || 1)}
            />
          </Field>
        ) : null}
      </div>
    );
  }

  if (slug === "organise") {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Rotate all kept pages">
          <select
            className={inputClass}
            value={props.rotate}
            disabled={props.busy}
            onChange={(e) => props.setRotate(Number(e.target.value))}
          >
            <option value={0}>0°</option>
            <option value={90}>90°</option>
            <option value={180}>180°</option>
            <option value={270}>270°</option>
          </select>
        </Field>
        <Field label="Remove pages (optional)">
          <input
            className={inputClass}
            placeholder="e.g. 2, 5-6"
            value={props.removePages}
            disabled={props.busy}
            onChange={(e) => props.setRemovePages(e.target.value)}
          />
        </Field>
      </div>
    );
  }

  if (slug === "page-numbers") {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Pages">
          <input
            className={inputClass}
            placeholder="all, or 1-3, 5"
            value={props.pageRange}
            disabled={props.busy}
            onChange={(e) => props.setPageRange(e.target.value)}
          />
        </Field>
        <Field label="Position">
          <select
            className={inputClass}
            value={props.pagePos}
            disabled={props.busy}
            onChange={(e) => props.setPagePos(e.target.value as PageNumberPosition)}
          >
            <option value="bottom-center">Bottom centre</option>
            <option value="bottom-left">Bottom left</option>
            <option value="bottom-right">Bottom right</option>
            <option value="top-center">Top centre</option>
            <option value="top-left">Top left</option>
            <option value="top-right">Top right</option>
          </select>
        </Field>
        <Field label="Format">
          <select
            className={inputClass}
            value={props.pageFormat}
            disabled={props.busy}
            onChange={(e) => props.setPageFormat(e.target.value as PageNumberFormat)}
          >
            <option value="number">1, 2, 3</option>
            <option value="page-number">Page 1</option>
            <option value="fraction">1/10</option>
            <option value="page-number-of-total">Page 1 of 10</option>
            <option value="roman">i, ii, iii</option>
            <option value="letter">a, b, c</option>
          </select>
        </Field>
        <Field label="Start at">
          <input
            type="number"
            min={1}
            className={inputClass}
            value={props.startAt}
            disabled={props.busy}
            onChange={(e) => props.setStartAt(Number(e.target.value) || 1)}
          />
        </Field>
        <Field label="Font size">
          <input
            type="number"
            min={8}
            max={48}
            className={inputClass}
            value={props.fontSize}
            disabled={props.busy}
            onChange={(e) => props.setFontSize(Number(e.target.value) || 12)}
          />
        </Field>
      </div>
    );
  }

  if (slug === "crop") {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Pages">
          <input
            className={inputClass}
            placeholder="all, or 1-3"
            value={props.pageRange}
            disabled={props.busy}
            onChange={(e) => props.setPageRange(e.target.value)}
          />
        </Field>
        {(["Top", "Right", "Bottom", "Left"] as const).map((side) => {
          const key = side.toLowerCase() as "top" | "right" | "bottom" | "left";
          const value =
            key === "top"
              ? props.cropTop
              : key === "right"
                ? props.cropRight
                : key === "bottom"
                  ? props.cropBottom
                  : props.cropLeft;
          const set =
            key === "top"
              ? props.setCropTop
              : key === "right"
                ? props.setCropRight
                : key === "bottom"
                  ? props.setCropBottom
                  : props.setCropLeft;
          return (
            <Field key={side} label={`${side} margin (mm)`}>
              <input
                type="number"
                min={0}
                step={0.5}
                className={inputClass}
                value={value}
                disabled={props.busy}
                onChange={(e) => set(Number(e.target.value) || 0)}
              />
            </Field>
          );
        })}
      </div>
    );
  }

  if (slug === "compress") {
    return (
      <Field label="Compression">
        <select
          className={inputClass}
          value={props.compressMode}
          disabled={props.busy}
          onChange={(e) => props.setCompressMode(e.target.value as "safe" | "strong")}
        >
          <option value="safe">Safe (structure only, keeps text selectable)</option>
          <option value="strong">Strong (rasterise pages — smaller, lossy)</option>
        </select>
      </Field>
    );
  }

  if (slug === "compress-split") {
    return (
      <Field label="Max size per part (MB)">
        <input
          type="number"
          min={0.5}
          step={0.5}
          className={inputClass}
          value={props.maxMb}
          disabled={props.busy}
          onChange={(e) => props.setMaxMb(Number(e.target.value) || 5)}
        />
      </Field>
    );
  }

  if (slug === "watermark") {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Text">
          <input
            className={inputClass}
            value={props.wmText}
            disabled={props.busy}
            onChange={(e) => props.setWmText(e.target.value)}
          />
        </Field>
        <Field label="Pages">
          <input
            className={inputClass}
            placeholder="all"
            value={props.pageRange}
            disabled={props.busy}
            onChange={(e) => props.setPageRange(e.target.value)}
          />
        </Field>
        <Field label="Position">
          <select
            className={inputClass}
            value={props.wmPos}
            disabled={props.busy}
            onChange={(e) => props.setWmPos(e.target.value as WatermarkPosition)}
          >
            <option value="center">Centre</option>
            <option value="tile">Tile</option>
            <option value="top-left">Top left</option>
            <option value="top-right">Top right</option>
            <option value="bottom-left">Bottom left</option>
            <option value="bottom-right">Bottom right</option>
          </select>
        </Field>
        <Field label={`Opacity (${Math.round(props.wmOpacity * 100)}%)`}>
          <input
            type="range"
            min={0.05}
            max={0.8}
            step={0.05}
            value={props.wmOpacity}
            disabled={props.busy}
            onChange={(e) => props.setWmOpacity(Number(e.target.value))}
          />
        </Field>
        <Field label="Size">
          <input
            type="number"
            min={12}
            max={120}
            className={inputClass}
            value={props.wmSize}
            disabled={props.busy}
            onChange={(e) => props.setWmSize(Number(e.target.value) || 48)}
          />
        </Field>
        <Field label="Rotation">
          <input
            type="number"
            className={inputClass}
            value={props.wmRotation}
            disabled={props.busy}
            onChange={(e) => props.setWmRotation(Number(e.target.value) || 0)}
          />
        </Field>
      </div>
    );
  }

  if (slug === "metadata") {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title">
          <input className={inputClass} value={props.metaTitle} disabled={props.busy} onChange={(e) => props.setMetaTitle(e.target.value)} />
        </Field>
        <Field label="Author">
          <input className={inputClass} value={props.metaAuthor} disabled={props.busy} onChange={(e) => props.setMetaAuthor(e.target.value)} />
        </Field>
        <Field label="Subject">
          <input className={inputClass} value={props.metaSubject} disabled={props.busy} onChange={(e) => props.setMetaSubject(e.target.value)} />
        </Field>
        <Field label="Keywords (comma-separated)">
          <input className={inputClass} value={props.metaKeywords} disabled={props.busy} onChange={(e) => props.setMetaKeywords(e.target.value)} />
        </Field>
      </div>
    );
  }

  if (slug === "edit") {
    return (
      <Field label="Text note on first page">
        <input
          className={inputClass}
          value={props.editText}
          disabled={props.busy}
          onChange={(e) => props.setEditText(e.target.value)}
        />
      </Field>
    );
  }

  if (slug === "sign") {
    return (
      <div className="space-y-3">
        <SignaturePad
          disabled={props.busy}
          onChange={props.setSignDataUrl}
          hasInk={Boolean(props.signDataUrl)}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Pages (blank = last page)">
            <input
              className={inputClass}
              placeholder="e.g. 1 or 3-4"
              value={props.pageRange}
              disabled={props.busy}
              onChange={(e) => props.setPageRange(e.target.value)}
            />
          </Field>
          <Field label={`Width (${props.signWidth}% of page)`}>
            <input
              type="range"
              min={10}
              max={50}
              value={props.signWidth}
              disabled={props.busy}
              onChange={(e) => props.setSignWidth(Number(e.target.value))}
            />
          </Field>
        </div>
      </div>
    );
  }

  if (slug === "images-to-pdf") {
    return (
      <Field label="Page size">
        <select
          className={inputClass}
          value={props.pageSize}
          disabled={props.busy}
          onChange={(e) => props.setPageSize(e.target.value as typeof props.pageSize)}
        >
          <option value="a4">A4</option>
          <option value="letter">Letter</option>
          <option value="fit">Fit to image</option>
        </select>
      </Field>
    );
  }

  if (slug === "pdf-to-images") {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Format">
          <select
            className={inputClass}
            value={props.imageFormat}
            disabled={props.busy}
            onChange={(e) => props.setImageFormat(e.target.value as typeof props.imageFormat)}
          >
            <option value="png">PNG</option>
            <option value="jpeg">JPG</option>
            <option value="webp">WebP</option>
          </select>
        </Field>
        <Field label="Scale">
          <select
            className={inputClass}
            value={props.imageScale}
            disabled={props.busy}
            onChange={(e) => props.setImageScale(Number(e.target.value))}
          >
            <option value={1}>1× (~72 dpi)</option>
            <option value={1.5}>1.5×</option>
            <option value={2}>2× (~144 dpi)</option>
            <option value={3}>3× (~216 dpi)</option>
          </select>
        </Field>
      </div>
    );
  }

  if (slug === "ocr") {
    return (
      <Field label="Languages">
        <select
          className={inputClass}
          value={props.ocrLang}
          disabled={props.busy}
          onChange={(e) => props.setOcrLang(e.target.value)}
        >
          <option value="eng">English</option>
          <option value="hin">Hindi</option>
          <option value="mar">Marathi</option>
          <option value="eng+hin">English + Hindi</option>
          <option value="eng+hin+mar">English + Hindi + Marathi</option>
        </select>
      </Field>
    );
  }

  if (slug === "add-password") {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Password">
          <input
            type="password"
            className={inputClass}
            value={props.password}
            disabled={props.busy}
            onChange={(e) => props.setPassword(e.target.value)}
          />
        </Field>
        <Field label="Confirm">
          <input
            type="password"
            className={inputClass}
            value={props.password2}
            disabled={props.busy}
            onChange={(e) => props.setPassword2(e.target.value)}
          />
        </Field>
      </div>
    );
  }

  if (slug === "remove-password") {
    return (
      <Field label="Current open password">
        <input
          type="password"
          className={inputClass}
          value={props.password}
          disabled={props.busy}
          onChange={(e) => props.setPassword(e.target.value)}
        />
      </Field>
    );
  }

  if (slug === "pdf-to-word") {
    return (
      <p className="text-sm text-[var(--muted)]">
        Embedded text is exported to a simple .docx. Scanned pages without text will need the OCR tool first.
      </p>
    );
  }

  return null;
}

function SignaturePad({
  disabled,
  onChange,
  hasInk,
}: {
  disabled?: boolean;
  onChange: (dataUrl: string | null) => void;
  hasInk: boolean;
}) {
  const [drawing, setDrawing] = useState(false);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-[var(--ink)]">Draw signature</p>
        <button
          type="button"
          className="text-sm text-[var(--accent)] hover:underline"
          disabled={disabled}
          onClick={() => {
            const canvas = document.getElementById("sign-pad") as HTMLCanvasElement | null;
            if (!canvas) return;
            const ctx = canvas.getContext("2d");
            if (!ctx) return;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            onChange(null);
          }}
        >
          Clear
        </button>
      </div>
      <canvas
        id="sign-pad"
        width={480}
        height={160}
        className="w-full touch-none rounded-xl border border-[var(--line)] bg-white"
        onPointerDown={(e) => {
          if (disabled) return;
          const canvas = e.currentTarget;
          const ctx = canvas.getContext("2d");
          if (!ctx) return;
          canvas.setPointerCapture(e.pointerId);
          setDrawing(true);
          const rect = canvas.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
          const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
          ctx.strokeStyle = "#111";
          ctx.lineWidth = 2.5;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(x, y);
        }}
        onPointerMove={(e) => {
          if (!drawing || disabled) return;
          const canvas = e.currentTarget;
          const ctx = canvas.getContext("2d");
          if (!ctx) return;
          const rect = canvas.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
          const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
          ctx.lineTo(x, y);
          ctx.stroke();
        }}
        onPointerUp={(e) => {
          setDrawing(false);
          onChange(e.currentTarget.toDataURL("image/png"));
        }}
      />
      {!hasInk ? (
        <p className="text-xs text-[var(--muted)]">Sign with mouse or finger, then run.</p>
      ) : null}
    </div>
  );
}
