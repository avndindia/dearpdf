"use client";

import { ArrowDown, ArrowUp, Copy, Eye, FilePlus, FlipHorizontal2, FlipVertical2, Grid2X2, List, RotateCcw, RotateCw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

export type PdfVisualPage = {
  id: string;
  pageIndex: number;
  thumbnail: string;
  width?: number;
  height?: number;
  sourceId?: string;
  sourceLabel?: string;
  rotation?: number;
  flipHorizontal?: boolean;
  flipVertical?: boolean;
};

type PdfPageWorkspaceProps = {
  pages: PdfVisualPage[];
  selectedIds?: string[];
  onSelectedIdsChange?: (ids: string[]) => void;
  onReorder?: (orderedIds: string[]) => void;
  onRotate?: (id: string, amount: number) => void;
  onFlip?: (id: string, axis: "horizontal" | "vertical") => void;
  onRemove?: (id: string) => void;
  onDuplicate?: (id: string) => void;
  onInsertBlankAfter?: (id: string) => void;
  disabled?: boolean;
  title?: string;
  emptyMessage?: string;
};

export async function renderPdfPageThumbnails(
  bytes: ArrayBuffer,
  idPrefix: string,
  sourceLabel?: string,
  onProgress?: (page: number, total: number) => void,
  maxWidth = 320,
  pageIndexes?: number[],
): Promise<PdfVisualPage[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const task = pdfjs.getDocument({ data: Uint8Array.from(new Uint8Array(bytes)) });
  const pdf = await task.promise;
  const pages: PdfVisualPage[] = [];
  const pageNumbers = pageIndexes?.length
    ? pageIndexes.filter((index) => index >= 0 && index < pdf.numPages).map((index) => index + 1)
    : Array.from({ length: pdf.numPages }, (_, index) => index + 1);

  try {
    for (let previewIndex = 0; previewIndex < pageNumbers.length; previewIndex += 1) {
      const pageNumber = pageNumbers[previewIndex];
      onProgress?.(previewIndex + 1, pageNumbers.length);
      const page = await pdf.getPage(pageNumber);
      const original = page.getViewport({ scale: 1 });
      const scale = Math.min(1.75, maxWidth / Math.max(original.width, 1));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("Page previews are not supported in this browser.");
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: context, viewport, background: "#fff" }).promise;
      pages.push({
        id: `${idPrefix}-${pageNumber - 1}`,
        pageIndex: pageNumber - 1,
        sourceId: idPrefix,
        sourceLabel,
        thumbnail: canvas.toDataURL("image/jpeg", 0.76),
        width: original.width,
        height: original.height,
        rotation: 0,
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

export function moveId(ids: string[], fromIndex: number, toIndex: number) {
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return ids;
  const reordered = [...ids];
  const [id] = reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, id);
  return reordered;
}

function autoScrollWhileDragging(event: { clientY: number }, container?: HTMLElement | null) {
  const edge = 72;
  if (event.clientY < edge) window.scrollBy({ top: -22, behavior: "auto" });
  if (event.clientY > window.innerHeight - edge) window.scrollBy({ top: 22, behavior: "auto" });
  if (!container) return;
  const rect = container.getBoundingClientRect();
  if (event.clientY < rect.top + edge) container.scrollTop -= 22;
  if (event.clientY > rect.bottom - edge) container.scrollTop += 22;
}

export default function PdfPageWorkspace({
  pages,
  selectedIds,
  onSelectedIdsChange,
  onReorder,
  onRotate,
  onFlip,
  onRemove,
  onDuplicate,
  onInsertBlankAfter,
  disabled = false,
  title = "Visual page workspace",
  emptyMessage = "No pages to show.",
}: PdfPageWorkspaceProps) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [touchGhost, setTouchGhost] = useState<{ id: string; left: number; top: number; width: number } | null>(null);
  const lastSelectedId = useRef<string | null>(null);
  const gridRef = useRef<HTMLOListElement>(null);
  const touchDragRef = useRef<{ id: string; pointerId: number; offsetX: number; offsetY: number; width: number } | null>(null);
  const touchTargetRef = useRef<string | null>(null);
  const touchCleanupRef = useRef<(() => void) | null>(null);
  const selectable = Boolean(onSelectedIdsChange && selectedIds);
  const selectedSet = useMemo(() => new Set(selectedIds ?? []), [selectedIds]);
  const previewIndex = pages.findIndex((page) => page.id === previewId);
  const previewPage = previewIndex >= 0 ? pages[previewIndex] : null;

  useEffect(() => {
    if (!previewPage) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setPreviewId(null);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [previewPage]);

  useEffect(() => () => touchCleanupRef.current?.(), []);

  function selectPage(id: string, shiftKey: boolean) {
    if (!selectable || !onSelectedIdsChange) {
      setPreviewId(id);
      return;
    }
    if (shiftKey && lastSelectedId.current) {
      const start = pages.findIndex((page) => page.id === lastSelectedId.current);
      const end = pages.findIndex((page) => page.id === id);
      if (start >= 0 && end >= 0) {
        const [from, to] = start <= end ? [start, end] : [end, start];
        const rangeIds = pages.slice(from, to + 1).map((page) => page.id);
        onSelectedIdsChange(Array.from(new Set([...(selectedIds ?? []), ...rangeIds])));
      }
    } else {
      onSelectedIdsChange(
        selectedSet.has(id)
          ? (selectedIds ?? []).filter((selectedId) => selectedId !== id)
          : [...(selectedIds ?? []), id],
      );
    }
    lastSelectedId.current = id;
  }

  function reorder(dragId: string, targetId: string) {
    if (!onReorder || dragId === targetId) return;
    const ids = pages.map((page) => page.id);
    onReorder(moveId(ids, ids.indexOf(dragId), ids.indexOf(targetId)));
  }

  function movePage(id: string, offset: number) {
    if (!onReorder) return;
    const ids = pages.map((page) => page.id);
    const fromIndex = ids.indexOf(id);
    const toIndex = Math.max(0, Math.min(ids.length - 1, fromIndex + offset));
    if (fromIndex >= 0 && fromIndex !== toIndex) onReorder(moveId(ids, fromIndex, toIndex));
  }

  function finishTouchDrag(pointerId: number) {
    const active = touchDragRef.current;
    if (!active || active.pointerId !== pointerId) return;
    touchCleanupRef.current?.();
    touchDragRef.current = null;
    touchTargetRef.current = null;
    setDraggedId(null);
    setTouchGhost(null);
  }

  function beginTouchDrag(event: ReactPointerEvent<HTMLButtonElement>, id: string) {
    if (disabled || !onReorder || event.pointerType === "mouse") return;
    event.preventDefault();
    const card = event.currentTarget.closest<HTMLElement>("[data-pdf-page-id]");
    const rect = card?.getBoundingClientRect();
    touchDragRef.current = {
      id,
      pointerId: event.pointerId,
      offsetX: rect ? event.clientX - rect.left : 20,
      offsetY: rect ? event.clientY - rect.top : 20,
      width: rect?.width ?? 150,
    };
    touchTargetRef.current = id;
    setDraggedId(id);
    setTouchGhost({ id, left: event.clientX - (rect ? event.clientX - rect.left : 20), top: event.clientY - (rect ? event.clientY - rect.top : 20), width: rect?.width ?? 150 });
    event.currentTarget.setPointerCapture(event.pointerId);
    const finish = (finishEvent: PointerEvent) => finishTouchDrag(finishEvent.pointerId);
    window.addEventListener("pointerup", finish, true);
    window.addEventListener("pointercancel", finish, true);
    touchCleanupRef.current = () => {
      window.removeEventListener("pointerup", finish, true);
      window.removeEventListener("pointercancel", finish, true);
      touchCleanupRef.current = null;
    };
  }

  function continueTouchDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const active = touchDragRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    setTouchGhost({ id: active.id, left: event.clientX - active.offsetX, top: event.clientY - active.offsetY, width: active.width });
    autoScrollWhileDragging(event, gridRef.current);
    const cards = Array.from(gridRef.current?.querySelectorAll<HTMLElement>("[data-pdf-page-id]") ?? []);
    const nearest = cards.reduce<{ id: string; distance: number } | null>((best, card) => {
      const rect = card.getBoundingClientRect();
      const distance = Math.hypot(event.clientX - (rect.left + rect.width / 2), event.clientY - (rect.top + rect.height / 2));
      const id = card.dataset.pdfPageId;
      if (!id || (best && best.distance <= distance)) return best;
      return { id, distance };
    }, null);
    if (nearest && nearest.id !== touchTargetRef.current) {
      touchTargetRef.current = nearest.id;
      reorder(active.id, nearest.id);
    }
  }

  return (
    <section className="page-workspace" aria-label={title}>
      <div className="page-workspace-toolbar">
        <div>
          <strong>{title}</strong>
          <span>{pages.length} {pages.length === 1 ? "page" : "pages"}{selectable ? ` · ${selectedSet.size} selected` : ""}</span>
        </div>
        <div className="page-workspace-tools">
          <div className="image-view-toggle page-workspace-view-toggle" role="group" aria-label="Page view">
            <button className={viewMode === "grid" ? "active" : ""} type="button" onClick={() => setViewMode("grid")} aria-pressed={viewMode === "grid"}>
              <Grid2X2 aria-hidden="true" /> Grid
            </button>
            <button className={viewMode === "list" ? "active" : ""} type="button" onClick={() => setViewMode("list")} aria-pressed={viewMode === "list"}>
              <List aria-hidden="true" /> List
            </button>
          </div>
          {selectable ? (
            <>
              <button type="button" onClick={() => onSelectedIdsChange?.(pages.map((page) => page.id))} disabled={disabled || selectedSet.size === pages.length}>Select all</button>
              <button type="button" onClick={() => onSelectedIdsChange?.([])} disabled={disabled || !selectedSet.size}>Select none</button>
            </>
          ) : null}
        </div>
      </div>

      {pages.length ? (
        <ol ref={gridRef} className={`page-workspace-grid ${viewMode}`} aria-label={`PDF pages in ${viewMode} view`}>
          {pages.map((page, index) => {
            const isSelected = selectedSet.has(page.id);
            return (
              <li
                key={page.id}
                data-pdf-page-id={page.id}
                className={`${isSelected ? "selected " : ""}${draggedId === page.id ? "dragging" : ""}`.trim()}
                draggable={Boolean(onReorder) && !disabled}
                onDragStart={() => setDraggedId(page.id)}
                onDragEnd={() => setDraggedId(null)}
                onDragOver={(event) => {
                  if (onReorder) event.preventDefault();
                  autoScrollWhileDragging(event, gridRef.current);
                }}
                onDragEnter={(event) => {
                  if (!onReorder || !draggedId || draggedId === page.id) return;
                  event.preventDefault();
                  reorder(draggedId, page.id);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setDraggedId(null);
                }}
              >
                <div className="page-workspace-preview-wrap">
                  <button
                    className="page-workspace-thumbnail"
                    type="button"
                    onClick={(event) => selectPage(page.id, event.shiftKey)}
                    onDoubleClick={() => setPreviewId(page.id)}
                    aria-pressed={selectable ? isSelected : undefined}
                    disabled={disabled}
                  >
                    {/* Generated locally from the selected PDF. */}
                    {page.thumbnail ? (
                      <img src={page.thumbnail} alt={`Preview of page ${page.pageIndex + 1}`} style={{ transform: `rotate(${page.rotation ?? 0}deg) scaleX(${page.flipHorizontal ? -1 : 1}) scaleY(${page.flipVertical ? -1 : 1})` }} />
                    ) : (
                      <span className="page-workspace-placeholder">Page {page.pageIndex + 1}</span>
                    )}
                    {selectable ? <span className="page-selection-mark" aria-hidden="true">{isSelected ? "✓" : ""}</span> : null}
                  </button>
                  {onReorder ? (
                    <button
                      className="page-workspace-drag-mark"
                      type="button"
                      aria-label={`Hold and drag page ${index + 1} to reorder`}
                      disabled={disabled}
                      onPointerDown={(event) => beginTouchDrag(event, page.id)}
                      onPointerMove={continueTouchDrag}
                      onPointerUp={(event) => finishTouchDrag(event.pointerId)}
                      onPointerCancel={(event) => finishTouchDrag(event.pointerId)}
                    >⠿</button>
                  ) : null}
                  <button className="page-workspace-view-mark" type="button" onClick={() => setPreviewId(page.id)} disabled={disabled} aria-label={`View page ${index + 1}`}>
                    <Eye aria-hidden="true" /> View
                  </button>
                </div>
                <div className="page-workspace-meta">
                  <strong>Page {index + 1}</strong>
                  <span>
                    {page.pageIndex < 0
                      ? `Blank A4${page.rotation ? ` · ${page.rotation}°` : ""}${page.flipHorizontal ? " · flip H" : ""}${page.flipVertical ? " · flip V" : ""}`
                      : `${page.sourceLabel ? `${page.sourceLabel} · ` : ""}Original ${page.pageIndex + 1}${page.rotation ? ` · ${page.rotation}°` : ""}${page.flipHorizontal ? " · flip H" : ""}${page.flipVertical ? " · flip V" : ""}`}
                  </span>
                </div>
                {onRotate || onFlip || onRemove || onDuplicate || onInsertBlankAfter ? (
                  <div className="page-workspace-actions">
                    {onReorder ? <button type="button" title="Move up" aria-label={`Move page ${index + 1} up`} onClick={() => movePage(page.id, -1)} disabled={disabled || index === 0}><ArrowUp aria-hidden="true" /></button> : null}
                    {onReorder ? <button type="button" title="Move down" aria-label={`Move page ${index + 1} down`} onClick={() => movePage(page.id, 1)} disabled={disabled || index === pages.length - 1}><ArrowDown aria-hidden="true" /></button> : null}
                    {onRotate ? <button type="button" title="Rotate left" aria-label={`Rotate page ${index + 1} left`} onClick={() => onRotate(page.id, -90)} disabled={disabled}><RotateCcw aria-hidden="true" /></button> : null}
                    {onRotate ? <button type="button" title="Rotate right" aria-label={`Rotate page ${index + 1} right`} onClick={() => onRotate(page.id, 90)} disabled={disabled}><RotateCw aria-hidden="true" /></button> : null}
                    {onFlip ? <button type="button" title="Flip horizontal" aria-label={`Flip page ${index + 1} horizontally`} onClick={() => onFlip(page.id, "horizontal")} disabled={disabled}><FlipHorizontal2 aria-hidden="true" /></button> : null}
                    {onFlip ? <button type="button" title="Flip vertical" aria-label={`Flip page ${index + 1} vertically`} onClick={() => onFlip(page.id, "vertical")} disabled={disabled}><FlipVertical2 aria-hidden="true" /></button> : null}
                    {onDuplicate ? <button type="button" title="Duplicate page" aria-label={`Duplicate page ${index + 1}`} onClick={() => onDuplicate(page.id)} disabled={disabled}><Copy aria-hidden="true" /></button> : null}
                    {onInsertBlankAfter ? <button type="button" title="Insert blank A4 after this page" aria-label={`Insert blank A4 after page ${index + 1}`} onClick={() => onInsertBlankAfter(page.id)} disabled={disabled}><FilePlus aria-hidden="true" /></button> : null}
                    {onRemove ? <button type="button" title="Delete page" aria-label={`Delete page ${index + 1}`} onClick={() => onRemove(page.id)} disabled={disabled}><Trash2 aria-hidden="true" /></button> : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : <p className="page-workspace-empty">{emptyMessage}</p>}

      {touchGhost ? (() => {
        const page = pages.find((item) => item.id === touchGhost.id);
        if (!page) return null;
        return (
          <div className="page-workspace-touch-ghost" style={{ left: touchGhost.left, top: touchGhost.top, width: touchGhost.width }} aria-hidden="true">
            {/* Generated locally from the selected PDF. */}
            {page.thumbnail ? (
              <img src={page.thumbnail} alt="" draggable={false} />
            ) : (
              <span className="page-workspace-placeholder">Page {pages.indexOf(page) + 1}</span>
            )}
            <strong>Page {pages.indexOf(page) + 1}</strong>
          </div>
        );
      })() : null}

      {previewPage ? (
        <div className="page-preview-modal" role="dialog" aria-modal="true" aria-label={`Preview page ${previewIndex + 1}`} onMouseDown={(event) => {
          if (event.target === event.currentTarget) setPreviewId(null);
        }}>
          <div className="page-preview-dialog no-navigation">
            <div className="page-preview-heading">
              <div><strong>Page {previewIndex + 1}</strong><span>{previewPage.pageIndex < 0 ? "Blank A4" : `${previewPage.sourceLabel ? `${previewPage.sourceLabel} · ` : ""}Original page ${previewPage.pageIndex + 1}`}</span></div>
              <button type="button" onClick={() => setPreviewId(null)}>Close</button>
            </div>
            <div className="page-preview-stage">
              {/* Generated locally from the selected PDF. */}
              <img src={previewPage.thumbnail} alt={`Large preview of page ${previewPage.pageIndex + 1}`} style={{ transform: `rotate(${previewPage.rotation ?? 0}deg) scaleX(${previewPage.flipHorizontal ? -1 : 1}) scaleY(${previewPage.flipVertical ? -1 : 1})` }} />
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
