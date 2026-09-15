"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import PdfPageWorkspace, {
  moveId,
  renderPdfPageThumbnails,
  type PdfVisualPage,
} from "../../../components/pdf-page-workspace";
import { announceGeneratedPdf } from "../../../lib/browser-download";
import { useIncomingPdfHandoff } from "../../../lib/pdf-tool-handoff";
import { inspectPdf, imageToSinglePagePdf, mergePdfPageOrder } from "../../../lib/pdf-tools";
import { decodeImageBitmap } from "../../../lib/decode-image-bitmap";
import { pdfToolHandoffUrl, savePdfToolHandoff } from "../../../lib/pdf-tool-handoff";
import StitchToolShell from "../../../components/StitchToolShell";
import { trackToolEvent } from "../../../lib/stats";

type PdfFile = {
  id: string;
  file: File;
  bytes: ArrayBuffer;
  pageCount: number;
  coverThumbnail: string | null;
};

type SkippedFile = {
  id: string;
  name: string;
  file: File;
  reason: "password" | "unreadable";
};

type WorkState =
  | { kind: "idle" }
  | { kind: "reading"; message: string }
  | { kind: "merging"; message: string }
  | { kind: "error"; message: string };

type DragGhost = {
  fileId: string;
  left: number;
  top: number;
  width: number;
};

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readablePdfError(error: unknown, fileName?: string) {
  const message = error instanceof Error ? error.message : "";
  if (/encrypted/i.test(message)) {
    return `${fileName ?? "This PDF"} is password-protected. Remove its password before merging.`;
  }
  return `${fileName ?? "The file"} could not be read.`;
}

function compareFileNamesNaturally(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function mergeDownloadName(name: string) {
  const trimmed = name.trim() || `merged-${new Date().toISOString().slice(0, 10)}`;
  const base = trimmed.replace(/\.pdf$/i, "").replace(/[^\p{L}\p{N}._ -]+/gu, "-").replace(/-+/g, "-").replace(/^[\s.-]+|[\s.-]+$/g, "");
  return `${base || "merged"}.pdf`;
}

function defaultMergeName() {
  return `merged-${new Date().toISOString().slice(0, 10)}.pdf`;
}

const IMAGE_ACCEPT = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];
const FILE_ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp";

function isPdfFile(file: File) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function isImageFile(file: File) {
  const name = file.name.toLowerCase();
  return IMAGE_ACCEPT.includes(file.type) || IMAGE_EXTENSIONS.some((extension) => name.endsWith(extension));
}

function toArrayBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function canvasToPng(canvas: HTMLCanvasElement) {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("This image could not be converted.");
  return new Uint8Array(await blob.arrayBuffer());
}

async function imageFileToPdf(file: File): Promise<{ bytes: ArrayBuffer; coverThumbnail: string }> {
  const bitmap = await decodeImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const previewScale = Math.min(1, 150 / Math.max(bitmap.width, bitmap.height));
    const previewCanvas = document.createElement("canvas");
    previewCanvas.width = Math.max(1, Math.round(bitmap.width * previewScale));
    previewCanvas.height = Math.max(1, Math.round(bitmap.height * previewScale));
    const previewContext = previewCanvas.getContext("2d", { alpha: false });
    if (!previewContext) throw new Error("Image previews are not supported in this browser.");
    previewContext.fillStyle = "#fff";
    previewContext.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
    previewContext.drawImage(bitmap, 0, 0, previewCanvas.width, previewCanvas.height);

    const name = file.name.toLowerCase();
    const webp = file.type === "image/webp" || name.endsWith(".webp");
    const png = file.type === "image/png" || name.endsWith(".png");
    let bytes: Uint8Array;
    let mimeType: "image/jpeg" | "image/png";
    if (webp) {
      const conversionCanvas = document.createElement("canvas");
      conversionCanvas.width = bitmap.width;
      conversionCanvas.height = bitmap.height;
      const context = conversionCanvas.getContext("2d");
      if (!context) throw new Error(`${file.name} could not be converted.`);
      context.drawImage(bitmap, 0, 0);
      bytes = await canvasToPng(conversionCanvas);
      mimeType = "image/png";
    } else {
      bytes = new Uint8Array(await file.arrayBuffer());
      mimeType = png ? "image/png" : "image/jpeg";
    }

    return {
      bytes: toArrayBuffer(await imageToSinglePagePdf(bytes, mimeType)),
      coverThumbnail: previewCanvas.toDataURL("image/jpeg", 0.76),
    };
  } finally {
    bitmap.close();
  }
}

export default function MergePdfPage() {
  const [files, setFiles] = useState<PdfFile[]>([]);
  const [pageOrders, setPageOrders] = useState<Record<string, number[]>>({});
  const [previewPages, setPreviewPages] = useState<Record<string, PdfVisualPage[]>>({});
  const [previewFileId, setPreviewFileId] = useState<string | null>(null);
  const [work, setWork] = useState<WorkState>({ kind: "idle" });
  const [skipped, setSkipped] = useState<SkippedFile[]>([]);
  const [outputName, setOutputName] = useState(defaultMergeName);
  const [sortKey, setSortKey] = useState<"name" | "size" | "pages" | null>(null);
  const [sortAsc, setSortAsc] = useState(true);
  const [draggedFileId, setDraggedFileId] = useState<string | null>(null);
  const dragTargetIdRef = useRef<string | null>(null);
  const pointerDragRef = useRef<{
    fileId: string;
    pointerId: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    offsetX: number;
    offsetY: number;
    cardWidth: number;
    active: boolean;
  } | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const globalPointerCleanupRef = useRef<(() => void) | null>(null);
  const suppressPreviewClickRef = useRef(false);
  const [dragGhost, setDragGhost] = useState<DragGhost | null>(null);
  const [dragTargetId, setDragTargetId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const totalPages = files.reduce(
    (total, item) => total + (pageOrders[item.id]?.length ?? item.pageCount),
    0,
  );
  const totalBytes = useMemo(
    () => files.reduce((total, item) => total + item.file.size, 0),
    [files],
  );
  const busy = work.kind === "reading" || work.kind === "merging";
  useIncomingPdfHandoff((file) => addFiles([file]));

  useEffect(() => () => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    globalPointerCleanupRef.current?.();
  }, []);

  async function addFiles(selected: File[]) {
    const supported = selected.filter((file) => isPdfFile(file) || isImageFile(file));
    if (!supported.length) {
      setWork({ kind: "error", message: "Choose PDF, JPG, PNG, or WebP files." });
      return;
    }

    setWork({ kind: "reading", message: `Checking ${supported.length} ${supported.length === 1 ? "file" : "files"}…` });
    const additions: PdfFile[] = [];
    const orderAdditions: Record<string, number[]> = {};
    const skippedAdditions: SkippedFile[] = [];

    for (const file of supported) {
      try {
        const id = crypto.randomUUID();
        if (isImageFile(file) && !isPdfFile(file)) {
          const converted = await imageFileToPdf(file);
          additions.push({ id, file, bytes: converted.bytes, pageCount: 1, coverThumbnail: converted.coverThumbnail });
          orderAdditions[id] = [0];
          continue;
        }
        const bytes = await file.arrayBuffer();
        const { pageCount } = await inspectPdf(bytes);
        additions.push({ id, file, bytes, pageCount, coverThumbnail: null });
        orderAdditions[id] = Array.from({ length: pageCount }, (_, index) => index);
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        skippedAdditions.push({
          id: crypto.randomUUID(),
          name: file.name,
          file,
          reason: /encrypted/i.test(message) ? "password" : "unreadable",
        });
      }
    }

    if (additions.length) {
      setFiles((current) => [...current, ...additions]);
      setPageOrders((current) => ({ ...current, ...orderAdditions }));
    }
    if (skippedAdditions.length) setSkipped((current) => [...current, ...skippedAdditions]);
    if (additions.length) {
      setWork({ kind: "idle" });
    } else if (skippedAdditions.length) {
      const first = skippedAdditions[0];
      setWork({
        kind: "error",
        message: first.reason === "password"
          ? readablePdfError(new Error("encrypted"), first.name)
          : readablePdfError(new Error("unreadable"), first.name),
      });
    } else {
      setWork({ kind: "idle" });
    }
    if (inputRef.current) inputRef.current.value = "";

    void (async () => {
      for (const item of additions) {
        if (item.coverThumbnail) continue;
        try {
          const [cover] = await renderPdfPageThumbnails(item.bytes, item.id, item.file.name, undefined, 150, [0]);
          if (cover) setFiles((current) => current.map((file) => file.id === item.id ? { ...file, coverThumbnail: cover.thumbnail } : file));
        } catch {
          // A cover is optional; the PDF remains ready to merge.
        }
      }
    })();
  }

  function removeFile(id: string) {
    setFiles((current) => current.filter((file) => file.id !== id));
    setPageOrders((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setPreviewPages((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setPreviewFileId((current) => current === id ? null : current);
  }

  function sortFiles(key: "name" | "size" | "pages") {
    const nextAsc = sortKey === key ? !sortAsc : true;
    setSortKey(key);
    setSortAsc(nextAsc);
    setFiles((current) => {
      const sorted = [...current].sort((left, right) => {
        let cmp = 0;
        if (key === "name") {
          cmp = compareFileNamesNaturally(left.file.name, right.file.name);
        } else if (key === "size") {
          cmp = left.file.size - right.file.size;
        } else {
          const leftPages = pageOrders[left.id]?.length ?? left.pageCount;
          const rightPages = pageOrders[right.id]?.length ?? right.pageCount;
          cmp = leftPages - rightPages;
        }
        return nextAsc ? cmp : -cmp;
      });
      return sorted;
    });
  }

  async function sendSkippedToUnlock(item: SkippedFile) {
    try {
      const bytes = new Uint8Array(await item.file.arrayBuffer());
      const id = await savePdfToolHandoff(bytes, item.name);
      window.location.assign(pdfToolHandoffUrl("/pdf-tools/unlock", id));
    } catch {
      setWork({ kind: "error", message: `${item.name} could not be opened for password removal.` });
    }
  }

  function dismissSkipped(id: string) {
    setSkipped((current) => current.filter((item) => item.id !== id));
  }

  function reorderFiles(fromId: string, toId: string) {
    if (fromId === toId) return;
    setFiles((current) => {
      const ids = current.map((file) => file.id);
      const nextIds = moveId(ids, ids.indexOf(fromId), ids.indexOf(toId));
      return nextIds.map((id) => current.find((file) => file.id === id)!).filter(Boolean);
    });
  }

  function moveFileBy(id: string, offset: number) {
    setFiles((current) => {
      const fromIndex = current.findIndex((file) => file.id === id);
      const toIndex = Math.max(0, Math.min(current.length - 1, fromIndex + offset));
      if (fromIndex < 0 || fromIndex === toIndex) return current;
      const ids = moveId(current.map((file) => file.id), fromIndex, toIndex);
      return ids.map((fileId) => current.find((file) => file.id === fileId)!).filter(Boolean);
    });
  }

  function beginPointerDrag(event: ReactPointerEvent<HTMLButtonElement>, fileId: string) {
    if (busy || (event.pointerType === "mouse" && event.button !== 0)) return;
    const card = event.currentTarget.closest<HTMLElement>("[data-merge-file-id]");
    const rect = card?.getBoundingClientRect();
    pointerDragRef.current = {
      fileId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      offsetX: rect ? event.clientX - rect.left : 20,
      offsetY: rect ? event.clientY - rect.top : 20,
      cardWidth: rect?.width ?? 180,
      active: false,
    };
    suppressPreviewClickRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
    globalPointerCleanupRef.current?.();
    const finishFromWindow = (finishEvent: PointerEvent) => {
      if (finishEvent.pointerId === event.pointerId) finishPointerDrag(finishEvent.pointerId);
    };
    window.addEventListener("pointerup", finishFromWindow, true);
    window.addEventListener("pointercancel", finishFromWindow, true);
    globalPointerCleanupRef.current = () => {
      window.removeEventListener("pointerup", finishFromWindow, true);
      window.removeEventListener("pointercancel", finishFromWindow, true);
      globalPointerCleanupRef.current = null;
    };
    longPressTimerRef.current = setTimeout(() => {
      const active = pointerDragRef.current;
      if (!active || active.pointerId !== event.pointerId || active.active) return;
      active.active = true;
      suppressPreviewClickRef.current = true;
      dragTargetIdRef.current = active.fileId;
      setDraggedFileId(active.fileId);
      setDragTargetId(active.fileId);
      setDragGhost({
        fileId: active.fileId,
        left: active.lastX - active.offsetX,
        top: active.lastY - active.offsetY,
        width: active.cardWidth,
      });
    }, 260);
  }

  function continuePointerDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const active = pointerDragRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    active.lastX = event.clientX;
    active.lastY = event.clientY;
    if (!active.active) {
      const distance = Math.hypot(event.clientX - active.startX, event.clientY - active.startY);
      if (distance < 7) return;
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
      active.active = true;
      suppressPreviewClickRef.current = true;
      dragTargetIdRef.current = active.fileId;
      setDraggedFileId(active.fileId);
      setDragTargetId(active.fileId);
    }
    event.preventDefault();
    setDragGhost({
      fileId: active.fileId,
      left: event.clientX - active.offsetX,
      top: event.clientY - active.offsetY,
      width: active.cardWidth,
    });
    const cards = Array.from(document.querySelectorAll<HTMLElement>("[data-merge-file-id]"));
    const gridRect = cards[0]?.parentElement?.getBoundingClientRect();
    const insideGrid = gridRect
      ? event.clientX >= gridRect.left - 30 && event.clientX <= gridRect.right + 30
        && event.clientY >= gridRect.top - 30 && event.clientY <= gridRect.bottom + 30
      : false;
    const nearestCard = insideGrid
      ? cards.reduce<{ card: HTMLElement; distance: number } | null>((nearest, card) => {
          const rect = card.getBoundingClientRect();
          const distance = Math.hypot(
            event.clientX - (rect.left + rect.width / 2),
            event.clientY - (rect.top + rect.height / 2),
          );
          return !nearest || distance < nearest.distance ? { card, distance } : nearest;
        }, null)?.card
      : null;
    const targetId = nearestCard?.dataset.mergeFileId ?? null;
    if (targetId === active.fileId) {
      if (dragTargetIdRef.current !== active.fileId) {
        dragTargetIdRef.current = active.fileId;
        setDragTargetId(active.fileId);
      }
    } else if (targetId && targetId !== dragTargetIdRef.current) {
      dragTargetIdRef.current = targetId;
      setDragTargetId(targetId);
      reorderFiles(active.fileId, targetId);
    }
    if (event.clientY < 72) window.scrollBy({ top: -22, behavior: "auto" });
    if (event.clientY > window.innerHeight - 72) window.scrollBy({ top: 22, behavior: "auto" });
  }

  function finishPointerDrag(pointerId: number) {
    const active = pointerDragRef.current;
    if (!active || active.pointerId !== pointerId) return;
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
    globalPointerCleanupRef.current?.();
    pointerDragRef.current = null;
    dragTargetIdRef.current = null;
    setDraggedFileId(null);
    setDragTargetId(null);
    setDragGhost(null);
  }

  function endPointerDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    finishPointerDrag(event.pointerId);
  }

  async function togglePreview(item: PdfFile) {
    if (previewFileId === item.id) {
      setPreviewFileId(null);
      return;
    }
    if (previewPages[item.id]) {
      setPreviewFileId(item.id);
      return;
    }

    setWork({ kind: "reading", message: `Creating full preview for ${item.file.name}…` });
    try {
      const rendered = await renderPdfPageThumbnails(
        item.bytes,
        item.id,
        item.file.name,
        (page, total) => setWork({ kind: "reading", message: `${item.file.name} · preview ${page} of ${total}…` }),
      );
      const byIndex = new Map(rendered.map((page) => [page.pageIndex, page]));
      const ordered = (pageOrders[item.id] ?? []).map((index) => byIndex.get(index)!).filter(Boolean);
      setPreviewPages((current) => ({ ...current, [item.id]: ordered }));
      setFiles((current) => current.map((file) => file.id === item.id && rendered[0] ? { ...file, coverThumbnail: rendered[0].thumbnail } : file));
      setPreviewFileId(item.id);
      setWork({ kind: "idle" });
    } catch (error) {
      setWork({ kind: "error", message: readablePdfError(error, item.file.name) });
    }
  }

  function updatePreviewOrder(fileId: string, orderedIds: string[]) {
    const pages = previewPages[fileId] ?? [];
    const ordered = orderedIds.map((id) => pages.find((page) => page.id === id)!).filter(Boolean);
    setPreviewPages((current) => ({ ...current, [fileId]: ordered }));
    setPageOrders((current) => ({ ...current, [fileId]: ordered.map((page) => page.pageIndex) }));
  }

  function removePreviewPage(fileId: string, pageId: string) {
    const remaining = (previewPages[fileId] ?? []).filter((page) => page.id !== pageId);
    setPreviewPages((current) => ({ ...current, [fileId]: remaining }));
    setPageOrders((current) => ({ ...current, [fileId]: remaining.map((page) => page.pageIndex) }));
  }

  async function mergeFiles() {
    if (files.length < 2 || !totalPages) return;
    setWork({ kind: "merging", message: "Combining your files on this device…" });
    trackToolEvent("merge", "start");

    try {
      const bytes = await mergePdfPageOrder(
        files.map((item) => ({ id: item.id, name: item.file.name, bytes: item.bytes })),
        files.flatMap((item) => (pageOrders[item.id] ?? []).map((pageIndex) => ({ sourceId: item.id, pageIndex }))),
      );
      const name = mergeDownloadName(outputName);
      window.__dearPdfNextStep = "download";
      announceGeneratedPdf(bytes as BlobPart, name);
      trackToolEvent("merge", "success");
      setWork({ kind: "idle" });
    } catch (error) {
      trackToolEvent("merge", "error");
      setWork({ kind: "error", message: readablePdfError(error) });
    }
  }

  function clearAll() {
    setFiles([]);
    setPageOrders({});
    setPreviewPages({});
    setPreviewFileId(null);
    setSkipped([]);
    setOutputName(defaultMergeName());
    setSortKey(null);
    setSortAsc(true);
    setWork({ kind: "idle" });
  }

  return (
    <StitchToolShell
      title="Merge PDF"
      subtitle="Combine PDFs and images in the order you choose."
      className={`merge-page${files.length ? " has-files" : ""}`}
      note="Password-protected PDFs are skipped. Always open the merged file before sending it."
    >
      <section className="merge-workspace" aria-labelledby="merge-workspace-title">
        <div className="merge-workspace-heading">
          <div>
            <h2 id="merge-workspace-title">Files to merge</h2>
            <p>{files.length ? `${files.length} files · ${totalPages} pages · ${formatBytes(totalBytes)}` : "PDFs and images"}</p>
          </div>
          {files.length > 0 ? (
            <div className="merge-workspace-heading-actions">
              <label className={`compact-pdf-add${busy ? " disabled" : ""}`}>
                <input
                  ref={inputRef}
                  type="file"
                  accept={FILE_ACCEPT}
                  multiple
                  disabled={busy}
                  onChange={(event) => void addFiles(Array.from(event.target.files ?? []))}
                />
                <span aria-hidden="true">＋</span> Add files
              </label>
              {files.length > 1 ? (
                <div className="merge-sort-controls" role="group" aria-label="Sort files">
                  <span className="merge-sort-label">Sort</span>
                  {(
                    [
                      { key: "name" as const, label: "Name" },
                      { key: "size" as const, label: "Size" },
                      { key: "pages" as const, label: "Pages" },
                    ]
                  ).map((option, index) => (
                    <span key={option.key} className="merge-sort-item">
                      {index > 0 ? <span className="merge-sort-sep" aria-hidden="true">·</span> : null}
                      <button
                        className={`text-button merge-sort-button${sortKey === option.key ? " is-active" : ""}`}
                        type="button"
                        onClick={() => sortFiles(option.key)}
                        disabled={busy}
                        aria-pressed={sortKey === option.key}
                        title={
                          sortKey === option.key
                            ? `Sorted by ${option.label}${sortAsc ? "" : " (reversed)"} — click to reverse`
                            : `Sort by ${option.label}`
                        }
                      >
                        {option.label}
                        {sortKey === option.key ? (sortAsc ? " ↑" : " ↓") : ""}
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
              <button className="text-button" type="button" onClick={clearAll} disabled={busy}>Clear</button>
            </div>
          ) : null}
        </div>

        {!files.length ? (
          <label
            className={`pdf-drop-zone${busy ? " disabled" : ""}`}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (!busy) void addFiles(Array.from(event.dataTransfer.files));
            }}
          >
            <input
              ref={inputRef}
              type="file"
              accept={FILE_ACCEPT}
              multiple
              disabled={busy}
              onChange={(event) => void addFiles(Array.from(event.target.files ?? []))}
            />
            <span className="drop-zone-mark" aria-hidden="true">＋</span>
            <strong>Choose PDFs or images</strong>
            <span>JPG, PNG, WebP, or PDF</span>
          </label>
        ) : null}

        {skipped.length ? (
          <div className="merge-skipped" role="status">
            <p>
              {skipped.length === 1 ? "1 file was skipped." : `${skipped.length} files were skipped.`}
              {files.length ? " The rest are ready to merge." : ""}
            </p>
            <ul>
              {skipped.map((item) => (
                <li key={item.id}>
                  <span>
                    <strong>{item.name}</strong>
                    {item.reason === "password" ? " is password-protected." : " could not be read."}
                  </span>
                  <span className="merge-skipped-actions">
                    {item.reason === "password" ? (
                      <button type="button" className="text-button" onClick={() => void sendSkippedToUnlock(item)} disabled={busy}>
                        Remove password
                      </button>
                    ) : null}
                    <button type="button" className="text-button" onClick={() => dismissSkipped(item.id)} disabled={busy}>Dismiss</button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {files.length > 0 ? (
          <>
          <p className="merge-reorder-help">Hold and drag a thumbnail to reorder · Tap it to preview</p>
          <ol className="pdf-file-list" aria-label="Added files">
            {files.map((item, index) => (
              <li
                key={item.id}
                data-merge-file-id={item.id}
                className={`${draggedFileId === item.id ? "dragging " : ""}${dragTargetId === item.id && draggedFileId !== item.id ? "drag-target" : ""}`.trim() || undefined}
              >
                <div className="merge-file-card-toolbar">
                  <span className="pdf-order">{String(index + 1).padStart(2, "0")}</span>
                  <button
                    className="merge-file-remove"
                    type="button"
                    aria-label={`Remove ${item.file.name}`}
                    title="Remove file"
                    disabled={busy}
                    onClick={() => removeFile(item.id)}
                  >×</button>
                </div>
                <button
                  className={`pdf-file-cover merge-file-cover-drag${item.coverThumbnail ? " has-thumbnail" : ""}`}
                  type="button"
                  aria-label={`Preview ${item.file.name}. Hold and drag to reorder.`}
                  disabled={busy}
                  onPointerDown={(event) => beginPointerDrag(event, item.id)}
                  onPointerMove={continuePointerDrag}
                  onPointerUp={endPointerDrag}
                  onPointerCancel={endPointerDrag}
                  onContextMenu={(event) => event.preventDefault()}
                  onClick={() => {
                    if (suppressPreviewClickRef.current) {
                      suppressPreviewClickRef.current = false;
                      return;
                    }
                    void togglePreview(item);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                      event.preventDefault();
                      moveFileBy(item.id, -1);
                    }
                    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                      event.preventDefault();
                      moveFileBy(item.id, 1);
                    }
                  }}
                >
                  {item.coverThumbnail ? (
                    // Generated locally from the first page only.
                    <img src={item.coverThumbnail} alt="" draggable={false} />
                  ) : "PDF"}
                  <span className="merge-file-drag-cue" aria-hidden="true">⠿ Hold &amp; drag</span>
                </button>
                <span className="pdf-file-name">
                  <strong>{item.file.name}</strong>
                  <small>{pageOrders[item.id]?.length ?? item.pageCount} {(pageOrders[item.id]?.length ?? item.pageCount) === 1 ? "page" : "pages"} · {formatBytes(item.file.size)}</small>
                </span>
                <span className="pdf-file-actions">
                  <button type="button" aria-label={`Move ${item.file.name} earlier`} onClick={() => moveFileBy(item.id, -1)} disabled={busy || index === 0}>←</button>
                  <button type="button" aria-label={`Move ${item.file.name} later`} onClick={() => moveFileBy(item.id, 1)} disabled={busy || index === files.length - 1}>→</button>
                  <button type="button" onClick={() => void togglePreview(item)} disabled={busy}>{previewFileId === item.id ? "Hide preview" : "Preview"}</button>
                </span>
              </li>
            ))}
          </ol>
          {dragGhost ? (() => {
            const ghostFile = files.find((file) => file.id === dragGhost.fileId);
            if (!ghostFile) return null;
            return (
              <div
                className="merge-file-drag-ghost"
                style={{ left: dragGhost.left, top: dragGhost.top, width: dragGhost.width }}
                aria-hidden="true"
              >
                <span className={`pdf-file-cover${ghostFile.coverThumbnail ? " has-thumbnail" : ""}`}>
                  {ghostFile.coverThumbnail ? (
                    <img src={ghostFile.coverThumbnail} alt="" draggable={false} />
                  ) : "PDF"}
                </span>
                <strong>{ghostFile.file.name}</strong>
              </div>
            );
          })() : null}
          </>
        ) : null}

        {previewFileId && previewPages[previewFileId] ? (
          <div className="merge-lazy-preview">
            <button type="button" onClick={() => setPreviewFileId(null)}>Close preview</button>
            <PdfPageWorkspace
              pages={previewPages[previewFileId]}
              onReorder={(orderedIds) => updatePreviewOrder(previewFileId, orderedIds)}
              onRemove={(id) => removePreviewPage(previewFileId, id)}
              disabled={busy}
              title={`Preview and arrange pages in ${files.find((file) => file.id === previewFileId)?.file.name ?? "PDF"}`}
            />
          </div>
        ) : null}

        {work.kind !== "idle" ? (
          <p className={`pdf-work-message ${work.kind}`} role={work.kind === "error" ? "alert" : "status"}>
            {work.message}
          </p>
        ) : null}

        <div className="merge-action-row">
          <div>
            <strong>{files.length >= 2 ? `${totalPages} pages ready` : "Add at least two files"}</strong>
            <span>The downloaded PDF follows the file order above and any page changes made in Preview. Images become A4 pages.</span>
          </div>
          <div className="merge-action-controls">
            {files.length >= 2 ? (
              <label className="merge-output-name">
                <span>File name</span>
                <input
                  type="text"
                  value={outputName}
                  spellCheck={false}
                  autoComplete="off"
                  disabled={busy}
                  onChange={(event) => setOutputName(event.target.value)}
                  onBlur={() => setOutputName(mergeDownloadName(outputName))}
                  aria-label="Merged PDF file name"
                />
              </label>
            ) : null}
            <button className="merge-button" type="button" onClick={() => void mergeFiles()} disabled={files.length < 2 || !totalPages || busy}>
              {work.kind === "merging" ? "Merging…" : "Merge files"}
            </button>
          </div>
        </div>

      </section>

      {totalBytes > 100 * 1024 * 1024 ? (
        <p className="large-file-note">
          These files total more than 100 MB. Processing may be slow or fail on a device with limited memory.
        </p>
      ) : null}
    </StitchToolShell>
  );
}
