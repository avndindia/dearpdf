"use client";

import { Grid2X2, List, RotateCcw, RotateCw, Trash2 } from "lucide-react";
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import PdfNextStepSelector from "../../../components/pdf-next-step-selector";
import { downloadGeneratedFile } from "../../../lib/browser-download";
import { imagesToPdf, type ImagesToPdfOptions } from "../../../lib/pdf-tools";
import StitchToolShell from "../../../components/StitchToolShell";
import { trackToolEvent } from "../../../lib/stats";

type ImageItem = {
  id: string;
  name: string;
  bytes: Uint8Array;
  mimeType: "image/jpeg" | "image/png";
  width: number;
  height: number;
  rotation: number;
  preview: string;
  originalSize: number;
  lastModified: number;
};

type WorkState =
  | { kind: "idle" }
  | { kind: "reading" | "working"; message: string }
  | { kind: "error"; message: string };

type ImageSortMode =
  | "manual"
  | "name-asc"
  | "name-desc"
  | "date-newest"
  | "date-oldest"
  | "size-largest"
  | "size-smallest";

type TouchDragState = {
  id: string;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  moved: boolean;
  openPreviewOnTap: boolean;
};

type TouchDragGhost = Pick<TouchDragState, "id" | "offsetX" | "offsetY" | "width" | "height"> & {
  x: number;
  y: number;
};

const MARGINS = {
  none: 0,
  small: 22.68,
  normal: 42.52,
  large: 70.87,
} as const;

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(timestamp));
}

function sortImages(images: ImageItem[], mode: ImageSortMode) {
  if (mode === "manual") return images;
  return [...images].sort((a, b) => {
    if (mode === "name-asc") return a.name.localeCompare(b.name, undefined, { numeric: true });
    if (mode === "name-desc") return b.name.localeCompare(a.name, undefined, { numeric: true });
    if (mode === "date-newest") return b.lastModified - a.lastModified;
    if (mode === "date-oldest") return a.lastModified - b.lastModified;
    if (mode === "size-largest") return b.originalSize - a.originalSize;
    return a.originalSize - b.originalSize;
  });
}

function imagesPdfDownloadName(name: string, fallback: string) {
  const trimmed = name.trim() || fallback;
  const base = trimmed.replace(/\.pdf$/i, "").replace(/[^\p{L}\p{N}._ -]+/gu, "-").replace(/-+/g, "-").replace(/^[\s.-]+|[\s.-]+$/g, "");
  return `${base || "images"}.pdf`;
}

function suggestedImagesPdfName(images: ImageItem[]) {
  const first = images[0]?.name.replace(/\.(jpe?g|png|webp)$/i, "") ?? "images";
  return imagesPdfDownloadName(first, "images.pdf");
}

function downloadPdf(bytes: Uint8Array, fileName: string) {
  downloadGeneratedFile(bytes as BlobPart, fileName);
}

async function canvasToPng(canvas: HTMLCanvasElement) {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("This image could not be converted.");
  return new Uint8Array(await blob.arrayBuffer());
}

async function prepareImage(file: File): Promise<ImageItem> {
  const accepted = ["image/jpeg", "image/png", "image/webp"];
  if (!accepted.includes(file.type)) throw new Error(`${file.name} is not a JPG, PNG, or WebP image.`);

  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const previewScale = Math.min(1, 280 / Math.max(bitmap.width, bitmap.height));
    const previewCanvas = document.createElement("canvas");
    previewCanvas.width = Math.max(1, Math.round(bitmap.width * previewScale));
    previewCanvas.height = Math.max(1, Math.round(bitmap.height * previewScale));
    const previewContext = previewCanvas.getContext("2d", { alpha: false });
    if (!previewContext) throw new Error("Image previews are not supported in this browser.");
    previewContext.fillStyle = "#fff";
    previewContext.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
    previewContext.drawImage(bitmap, 0, 0, previewCanvas.width, previewCanvas.height);

    let bytes: Uint8Array;
    let mimeType: ImageItem["mimeType"];
    if (file.type === "image/webp") {
      const conversionCanvas = document.createElement("canvas");
      conversionCanvas.width = bitmap.width;
      conversionCanvas.height = bitmap.height;
      const context = conversionCanvas.getContext("2d");
      if (!context) throw new Error("WebP conversion is not supported in this browser.");
      context.drawImage(bitmap, 0, 0);
      bytes = await canvasToPng(conversionCanvas);
      mimeType = "image/png";
    } else {
      bytes = new Uint8Array(await file.arrayBuffer());
      mimeType = file.type as ImageItem["mimeType"];
    }

    return {
      id: crypto.randomUUID(),
      name: file.name,
      bytes,
      mimeType,
      width: bitmap.width,
      height: bitmap.height,
      rotation: 0,
      preview: previewCanvas.toDataURL("image/jpeg", 0.8),
      originalSize: file.size,
      lastModified: file.lastModified,
    };
  } finally {
    bitmap.close();
  }
}

export default function ImagesToPdfPage() {
  const [images, setImages] = useState<ImageItem[]>([]);
  const [pageSize, setPageSize] = useState<ImagesToPdfOptions["pageSize"]>("a4");
  const [orientation, setOrientation] = useState<ImagesToPdfOptions["orientation"]>("auto");
  const [margin, setMargin] = useState<keyof typeof MARGINS>("normal");
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<ImageSortMode>("name-asc");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [touchDragGhost, setTouchDragGhost] = useState<TouchDragGhost | null>(null);
  const [outputName, setOutputName] = useState("images.pdf");
  const [outputNameCustom, setOutputNameCustom] = useState(false);
  const [savedNotice, setSavedNotice] = useState("");
  const [work, setWork] = useState<WorkState>({ kind: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);
  const touchDragRef = useRef<TouchDragState | null>(null);
  const busy = work.kind === "reading" || work.kind === "working";
  const totalBytes = images.reduce((total, image) => total + image.originalSize, 0);
  const previewImage = images.find((image) => image.id === previewId) ?? null;
  const draggedImage = images.find((image) => image.id === touchDragGhost?.id) ?? null;

  async function addImages(files: File[]) {
    if (!files.length) return;
    setWork({ kind: "reading", message: `Preparing ${files.length} ${files.length === 1 ? "image" : "images"} on this device…` });
    const additions: ImageItem[] = [];
    const skipped: string[] = [];
    try {
      for (const file of files) {
        try {
          additions.push(await prepareImage(file));
        } catch {
          skipped.push(file.name);
        }
      }
      if (!additions.length) {
        setWork({ kind: "error", message: skipped.length ? "Those files could not be read as JPG, PNG, or WebP images." : "Choose image files." });
        return;
      }
      setImages((current) => {
        const next = sortImages([...current, ...additions], sortMode);
        if (!outputNameCustom) setOutputName(suggestedImagesPdfName(next));
        return next;
      });
      setSavedNotice("");
      setWork(skipped.length
        ? { kind: "error", message: `${skipped.length === 1 ? skipped[0] : `${skipped.length} files`} could not be added. The rest are ready.` }
        : { kind: "idle" });
    } catch (error) {
      setWork({ kind: "error", message: error instanceof Error ? error.message : "The images could not be read." });
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  function reorderImage(dragId: string, targetId: string) {
    if (dragId === targetId) return;
    setImages((current) => {
      const fromIndex = current.findIndex((image) => image.id === dragId);
      const toIndex = current.findIndex((image) => image.id === targetId);
      if (fromIndex < 0 || toIndex < 0) return current;
      const reordered = [...current];
      const [image] = reordered.splice(fromIndex, 1);
      reordered.splice(toIndex, 0, image);
      return reordered;
    });
    setSortMode("manual");
  }

  function dropOnImage(targetId: string) {
    if (!draggedId || draggedId === targetId) return;
    reorderImage(draggedId, targetId);
    setDraggedId(null);
  }

  function rotateImage(id: string, amount: number) {
    setImages((current) => current.map((image) =>
      image.id === id ? { ...image, rotation: (image.rotation + amount + 360) % 360 } : image,
    ));
  }

  function beginTouchDrag(id: string, event: ReactPointerEvent<HTMLButtonElement>, openPreviewOnTap = false) {
    if (busy) return;
    event.preventDefault();
    const card = event.currentTarget.closest<HTMLElement>("[data-image-id]");
    if (!card) return;
    const rect = card.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    touchDragRef.current = {
      id,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
      moved: false,
      openPreviewOnTap,
    };
  }

  function continueTouchDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = touchDragRef.current;
    if (!drag) return;
    const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    if (!drag.moved && distance < 8) return;
    event.preventDefault();
    if (!drag.moved) {
      drag.moved = true;
      setDraggedId(drag.id);
    }
    setTouchDragGhost({
      id: drag.id,
      x: event.clientX,
      y: event.clientY,
      offsetX: drag.offsetX,
      offsetY: drag.offsetY,
      width: drag.width,
      height: drag.height,
    });
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-image-id]");
    const targetId = target?.dataset.imageId;
    if (targetId && targetId !== drag.id) reorderImage(drag.id, targetId);
    if (event.clientY < 72) window.scrollBy({ top: -14, behavior: "auto" });
    if (event.clientY > window.innerHeight - 72) window.scrollBy({ top: 14, behavior: "auto" });
  }

  function finishTouchDrag(cancelled = false) {
    const drag = touchDragRef.current;
    if (drag && !cancelled && !drag.moved && drag.openPreviewOnTap) setPreviewId(drag.id);
    touchDragRef.current = null;
    setTouchDragGhost(null);
    setDraggedId(null);
  }

  function changeSort(nextMode: ImageSortMode) {
    setSortMode(nextMode);
    setImages((current) => sortImages(current, nextMode));
  }

  async function createPdf() {
    if (!images.length) return;
    setWork({ kind: "working", message: "Creating the PDF on this device…" });
    trackToolEvent("images-to-pdf", "start");
    try {
      const bytes = await imagesToPdf(
        images.map(({ bytes: imageBytes, mimeType, width, height, rotation }) => ({
          bytes: imageBytes,
          mimeType,
          width,
          height,
          rotation,
        })),
        { pageSize, orientation, margin: MARGINS[margin] },
      );
      downloadPdf(bytes, imagesPdfDownloadName(outputName, suggestedImagesPdfName(images)));
      setSavedNotice("Saved. The images are still here — drop another photo and rebuild.");
      trackToolEvent("images-to-pdf", "success");
      setWork({ kind: "idle" });
    } catch (error) {
      trackToolEvent("images-to-pdf", "error");
      setWork({ kind: "error", message: error instanceof Error ? error.message : "The PDF could not be created." });
    }
  }

  return (
    <StitchToolShell
      title="Images to PDF"
      subtitle="Combine JPG, PNG, and WebP images into one PDF."
      className={`images-pdf-page${images.length ? " has-file" : ""}`}
    >
      <section className="images-pdf-workspace" aria-labelledby="images-workspace-title">
        <div className="merge-workspace-heading">
          <div>
            <h2 id="images-workspace-title">Images</h2>
            <p>{images.length ? `${images.length} ${images.length === 1 ? "page" : "pages"} · ${formatBytes(totalBytes)}` : "JPG, PNG, and WebP"}</p>
          </div>
          {images.length ? <button className="text-button" type="button" onClick={() => { setImages([]); setSavedNotice(""); setOutputName("images.pdf"); setOutputNameCustom(false); setWork({ kind: "idle" }); }} disabled={busy}>Clear all</button> : null}
        </div>

        {!images.length ? (
          <label
            className={`pdf-drop-zone images-drop-zone${busy ? " disabled" : ""}`}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (!busy) void addImages(Array.from(event.dataTransfer.files));
            }}
          >
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
              multiple
              disabled={busy}
              onChange={(event) => void addImages(Array.from(event.target.files ?? []))}
            />
            <span className="drop-zone-mark" aria-hidden="true">＋</span>
            <strong>Choose images</strong>
            <span>or drag and drop them here</span>
          </label>
        ) : null}

        {images.length ? (
          <div
            className="images-pdf-content"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (!busy) void addImages(Array.from(event.dataTransfer.files));
            }}
          >
            <div>
              <div className="image-order-toolbar">
                <p>Drag image cards to set the PDF page order.</p>
                <div className="image-order-toolbar-actions">
                  <div className="image-view-toggle" role="group" aria-label="Image view">
                    <button
                      className={viewMode === "grid" ? "active" : ""}
                      type="button"
                      onClick={() => setViewMode("grid")}
                      aria-pressed={viewMode === "grid"}
                    >
                      <Grid2X2 aria-hidden="true" /> Grid
                    </button>
                    <button
                      className={viewMode === "list" ? "active" : ""}
                      type="button"
                      onClick={() => setViewMode("list")}
                      aria-pressed={viewMode === "list"}
                    >
                      <List aria-hidden="true" /> List
                    </button>
                  </div>
                  <label className="image-order-add">
                    <input type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" multiple disabled={busy} onChange={(event) => {
                      const files = Array.from(event.target.files ?? []);
                      event.currentTarget.value = "";
                      void addImages(files);
                    }} />
                    <span aria-hidden="true">＋</span> Add images
                  </label>
                  <label>
                    <span>Sort by</span>
                    <select value={sortMode} onChange={(event) => changeSort(event.target.value as ImageSortMode)} disabled={busy}>
                      <option value="manual">Manual order</option>
                      <option value="name-asc">File name (2 before 10)</option>
                      <option value="name-desc">File name Z–A</option>
                      <option value="date-newest">Date: newest first</option>
                      <option value="date-oldest">Date: oldest first</option>
                      <option value="size-largest">Size: largest first</option>
                      <option value="size-smallest">Size: smallest first</option>
                    </select>
                  </label>
                </div>
              </div>
              <ol className={`image-page-grid ${viewMode}`} aria-label={`Image page order in ${viewMode} view`}>
                {images.map((image, index) => (
                  <li
                    key={image.id}
                    data-image-id={image.id}
                    draggable={!busy}
                    className={draggedId === image.id ? "dragging" : ""}
                    onDragStart={() => setDraggedId(image.id)}
                    onDragEnd={() => setDraggedId(null)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      dropOnImage(image.id);
                    }}
                  >
                    <div className="image-card-toolbar" aria-label={`Actions for ${image.name}`}>
                      <button type="button" title="Rotate left" onClick={() => rotateImage(image.id, -90)} disabled={busy} aria-label={`Rotate ${image.name} left`}>
                        <RotateCcw aria-hidden="true" />
                      </button>
                      <button type="button" title="Rotate right" onClick={() => rotateImage(image.id, 90)} disabled={busy} aria-label={`Rotate ${image.name} right`}>
                        <RotateCw aria-hidden="true" />
                      </button>
                      <button type="button" title="Delete image" onClick={() => setImages((current) => current.filter((item) => item.id !== image.id))} disabled={busy} aria-label={`Delete ${image.name}`}>
                        <Trash2 aria-hidden="true" />
                      </button>
                    </div>
                    <button
                      className="image-page-preview"
                      type="button"
                      disabled={busy}
                      onPointerDown={(event) => beginTouchDrag(image.id, event, true)}
                      onPointerMove={continueTouchDrag}
                      onPointerUp={() => finishTouchDrag()}
                      onPointerCancel={() => finishTouchDrag(true)}
                    >
                      {/* Locally generated preview data does not use a server image loader. */}
                      <img src={image.preview} alt={`Preview of ${image.name}`} style={{ transform: `rotate(${image.rotation}deg)` }} />
                      <span className="image-preview-drag-mark" aria-hidden="true">⠿</span>
                      <span className="image-preview-view-mark">View</span>
                    </button>
                    <div className="organise-page-meta">
                      <strong>Page {index + 1}</strong>
                      <span title={image.name}>{image.name}{image.rotation ? ` · ${image.rotation}°` : ""}</span>
                      <small>{formatBytes(image.originalSize)} · {formatDate(image.lastModified)}</small>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            <aside className="images-pdf-settings" aria-label="PDF layout settings">
              <p className="pdf-tool-status">DOCUMENT LAYOUT</p>
              <label>
                <span>Page size</span>
                <select value={pageSize} onChange={(event) => setPageSize(event.target.value as ImagesToPdfOptions["pageSize"])} disabled={busy}>
                  <option value="a4">A4</option>
                  <option value="letter">US Letter</option>
                  <option value="fit">Fit each image</option>
                </select>
              </label>
              <label>
                <span>Orientation</span>
                <select value={orientation} onChange={(event) => setOrientation(event.target.value as ImagesToPdfOptions["orientation"])} disabled={busy || pageSize === "fit"}>
                  <option value="auto">Automatic</option>
                  <option value="portrait">Portrait</option>
                  <option value="landscape">Landscape</option>
                </select>
                <small>{pageSize === "fit" ? "Determined by each image" : "Automatic follows each image"}</small>
              </label>
              <label>
                <span>Margin</span>
                <select value={margin} onChange={(event) => setMargin(event.target.value as keyof typeof MARGINS)} disabled={busy}>
                  <option value="none">None</option>
                  <option value="small">Small · 8 mm</option>
                  <option value="normal">Normal · 15 mm</option>
                  <option value="large">Large · 25 mm</option>
                </select>
              </label>
              <div className="images-layout-summary">
                <strong>{images.length} PDF {images.length === 1 ? "page" : "pages"}</strong>
                <span>{pageSize === "fit" ? "Fit to image" : pageSize.toUpperCase()} · {margin} margin · one image per page</span>
              </div>
              <label className="merge-output-name">
                <span>File name</span>
                <input
                  type="text"
                  value={outputName}
                  spellCheck={false}
                  autoComplete="off"
                  disabled={busy}
                  aria-label="PDF file name"
                  onChange={(event) => {
                    setOutputNameCustom(true);
                    setOutputName(event.target.value);
                  }}
                  onBlur={() => setOutputName(imagesPdfDownloadName(outputName, suggestedImagesPdfName(images)))}
                />
              </label>
              <PdfNextStepSelector />
              <button className="merge-button" type="button" onClick={() => void createPdf()} disabled={busy || !images.length}>
                {work.kind === "working" ? "Creating PDF…" : `Create ${images.length} ${images.length === 1 ? "page" : "pages"}`}
              </button>
              {savedNotice ? <p className="page-numbers-saved" role="status">{savedNotice}</p> : null}
            </aside>
          </div>
        ) : null}

        {work.kind !== "idle" ? (
          <p className={`pdf-work-message ${work.kind}`} role={work.kind === "error" ? "alert" : "status"}>{work.message}</p>
        ) : null}
      </section>

      {totalBytes > 100 * 1024 * 1024 ? <p className="large-file-note">These images total more than 100 MB. Processing may be slow on a device with limited memory.</p> : null}
{touchDragGhost && draggedImage ? (
        <div
          className="image-drag-ghost"
          aria-hidden="true"
          style={{
            left: touchDragGhost.x - touchDragGhost.offsetX,
            top: touchDragGhost.y - touchDragGhost.offsetY,
            width: touchDragGhost.width,
            minHeight: touchDragGhost.height,
          }}
        >
          <div>
            {/* Locally generated preview data does not use a server image loader. */}
            <img src={draggedImage.preview} alt="" style={{ transform: `rotate(${draggedImage.rotation}deg)` }} />
          </div>
          <strong>{draggedImage.name}</strong>
        </div>
      ) : null}

      {previewImage ? (
        <div className="page-preview-modal" role="dialog" aria-modal="true" aria-label={`Preview ${previewImage.name}`} onMouseDown={(event) => {
          if (event.target === event.currentTarget) setPreviewId(null);
        }}>
          <div className="page-preview-dialog image-preview-dialog">
            <div className="page-preview-heading">
              <div><strong>{previewImage.name}</strong><span>{formatBytes(previewImage.originalSize)} · Modified {formatDate(previewImage.lastModified)}</span></div>
              <button type="button" onClick={() => setPreviewId(null)}>Close</button>
            </div>
            <div className="page-preview-stage">
              {/* Locally generated preview data does not use a server image loader. */}
              <img src={previewImage.preview} alt={`Large preview of ${previewImage.name}`} style={{ transform: `rotate(${previewImage.rotation}deg)` }} />
            </div>
          </div>
        </div>
      ) : null}
    </StitchToolShell>
  );
}
