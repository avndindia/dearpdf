"use client";

import {
  Download,
  Eraser,
  Highlighter,
  ImagePlus,
  MousePointer2,
  Pencil,
  Redo2,
  Square,
  Trash2,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { renderPdfPageThumbnails, type PdfVisualPage } from "../../../components/pdf-page-workspace";
import PdfNextStepSelector from "../../../components/pdf-next-step-selector";
import { trackToolEvent } from "../../../lib/stats";
import { downloadGeneratedFile } from "../../../lib/browser-download";
import { useIncomingPdfHandoff } from "../../../lib/pdf-tool-handoff";
import {
  applyPdfEdits,
  pageIndexesNeedingRedaction,
  replacePdfPagesWithImages,
  type PdfEditorAnnotation,
  type RedactedPageImage,
} from "../../../lib/pdf-editor";
import { inspectPdf } from "../../../lib/pdf-tools";
import { openPdfLoadingTask } from "../../../lib/pdfjs";
import StitchToolShell from "../../../components/StitchToolShell";

type EditorTool = "select" | "text" | "draw" | "highlight" | "rectangle" | "redact" | "image";
type SelectedPdf = { file: File; bytes: ArrayBuffer; pageCount: number; pages: PdfVisualPage[] };
type WorkState = { kind: "idle" } | { kind: "reading" | "working" | "error"; message: string };
type Interaction = {
  kind: "drag" | "resize" | "draw" | "shape";
  id: string;
  startX: number;
  startY: number;
  shape?: "highlight" | "rectangle" | "redact";
  original?: PdfEditorAnnotation;
  before: PdfEditorAnnotation[];
};

const TOOL_LABELS: Array<{ value: EditorTool; label: string; icon: typeof MousePointer2 }> = [
  { value: "select", label: "Select", icon: MousePointer2 },
  { value: "text", label: "Text", icon: Type },
  { value: "draw", label: "Draw", icon: Pencil },
  { value: "highlight", label: "Highlight", icon: Highlighter },
  { value: "rectangle", label: "Rectangle", icon: Square },
  { value: "redact", label: "Redact", icon: Eraser },
  { value: "image", label: "Image", icon: ImagePlus },
];

function safeBaseName(name: string) {
  return name.replace(/\.pdf$/i, "").replace(/[^\p{L}\p{N}._-]+/gu, "-") || "document";
}

function editDownloadName(name: string, fallback: string) {
  const trimmed = name.trim() || fallback;
  const base = trimmed.replace(/\.pdf$/i, "").replace(/[^\p{L}\p{N}._ -]+/gu, "-").replace(/-+/g, "-").replace(/^[\s.-]+|[\s.-]+$/g, "");
  return `${base || "edited"}.pdf`;
}

function downloadPdf(bytes: Uint8Array, name: string) {
  downloadGeneratedFile(bytes as BlobPart, name);
}

async function canvasToJpeg(canvas: HTMLCanvasElement, quality: number) {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob) throw new Error("A redacted page could not be encoded.");
  return new Uint8Array(await blob.arrayBuffer());
}

async function rasterizePdfPages(bytes: Uint8Array, pageIndexes: number[]): Promise<RedactedPageImage[]> {
  const task = await openPdfLoadingTask(bytes);
  const pdf = await task.promise;
  const pages: RedactedPageImage[] = [];
  try {
    for (const pageIndex of pageIndexes) {
      const page = await pdf.getPage(pageIndex + 1);
      const original = page.getViewport({ scale: 1 });
      const requestedScale = 180 / 72;
      const scale = Math.min(
        requestedScale,
        5000 / original.width,
        5000 / original.height,
        Math.sqrt(20_000_000 / (original.width * original.height)),
      );
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("Page rendering is not supported in this browser.");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: context, viewport, background: "#fff" }).promise;
      pages.push({
        pageIndex,
        bytes: await canvasToJpeg(canvas, 0.86),
        width: original.width,
        height: original.height,
        mimeType: "image/jpeg",
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

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function isInteractiveTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest(
    'input, textarea, select, button, a, [contenteditable="true"], [role="textbox"]',
  ));
}

function insertPlainTextAtSelection(element: HTMLElement, text: string) {
  const selection = window.getSelection();
  if (!selection?.rangeCount) {
    element.append(document.createTextNode(text));
    return;
  }
  const range = selection.getRangeAt(0);
  if (!element.contains(range.commonAncestorContainer)) {
    element.append(document.createTextNode(text));
    return;
  }
  range.deleteContents();
  const textNode = document.createTextNode(text);
  range.insertNode(textNode);
  range.setStartAfter(textNode);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

export default function EditPdfPage() {
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const interactionRef = useRef<Interaction | null>(null);
  const textDraftsRef = useRef(new Map<string, string>());
  const [selected, setSelected] = useState<SelectedPdf | null>(null);
  const [activePageIndex, setActivePageIndex] = useState(0);
  const [tool, setTool] = useState<EditorTool>("select");
  const [zoom, setZoom] = useState(100);
  const [annotations, setAnnotations] = useState<PdfEditorAnnotation[]>([]);
  const [past, setPast] = useState<PdfEditorAnnotation[][]>([]);
  const [future, setFuture] = useState<PdfEditorAnnotation[][]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [outputName, setOutputName] = useState("edited.pdf");
  const [savedNotice, setSavedNotice] = useState("");
  const [work, setWork] = useState<WorkState>({ kind: "idle" });
  const activePage = selected?.pages[activePageIndex] ?? null;
  const selectedAnnotation = annotations.find((annotation) => annotation.id === selectedId) ?? null;
  const pageAnnotations = useMemo(
    () => annotations.filter((annotation) => annotation.pageIndex === activePageIndex),
    [activePageIndex, annotations],
  );
  const busy = work.kind === "reading" || work.kind === "working";
  useIncomingPdfHandoff(choosePdf);

  function commit(transform: (current: PdfEditorAnnotation[]) => PdfEditorAnnotation[]) {
    setAnnotations((current) => {
      setPast((history) => [...history, current]);
      setFuture([]);
      return transform(current);
    });
  }

  function undo() {
    if (!past.length) return;
    textDraftsRef.current.clear();
    const previous = past[past.length - 1];
    setPast((history) => history.slice(0, -1));
    setFuture((history) => [annotations, ...history]);
    setAnnotations(previous);
    setSelectedId(null);
  }

  function redo() {
    if (!future.length) return;
    textDraftsRef.current.clear();
    const next = future[0];
    setFuture((history) => history.slice(1));
    setPast((history) => [...history, annotations]);
    setAnnotations(next);
    setSelectedId(null);
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isInteractiveTarget(event.target)) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
      } else if ((event.key === "Delete" || event.key === "Backspace") && selectedId) {
        event.preventDefault();
        textDraftsRef.current.delete(selectedId);
        commit((current) => current.filter((annotation) => annotation.id !== selectedId));
        setSelectedId(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  async function choosePdf(file?: File) {
    if (!file) return;
    setWork({ kind: "reading", message: "Reading the PDF…" });
    try {
      const bytes = await file.arrayBuffer();
      const { pageCount } = await inspectPdf(bytes);
      const placeholders: PdfVisualPage[] = Array.from({ length: pageCount }, (_, index) => ({
        id: `edit-${index}`,
        pageIndex: index,
        thumbnail: "",
      }));
      setSelected({ file, bytes, pageCount, pages: placeholders });
      setActivePageIndex(0);
      setAnnotations([]);
      textDraftsRef.current.clear();
      setPast([]);
      setFuture([]);
      setSelectedId(null);
      setOutputName(`${safeBaseName(file.name)}-edited.pdf`);
      setSavedNotice("");
      setWork({ kind: "idle" });
      void (async () => {
        for (let index = 0; index < pageCount; index += 1) {
          const [page] = await renderPdfPageThumbnails(bytes, "edit", undefined, undefined, 720, [index]);
          if (!page) continue;
          setSelected((current) => current && current.file === file ? {
            ...current,
            pages: current.pages.map((item, pageIndex) => pageIndex === index ? page : item),
          } : current);
        }
      })().catch(() => {
        setWork({ kind: "error", message: "Page previews could not be created for this PDF." });
      });
    } catch {
      setSelected(null);
      setWork({ kind: "error", message: "Choose a valid, unlocked PDF file." });
    }
    if (pdfInputRef.current) pdfInputRef.current.value = "";
  }

  function stagePoint(event: ReactPointerEvent<HTMLElement>) {
    const bounds = stageRef.current?.getBoundingClientRect();
    if (!bounds) return { x: 0, y: 0 };
    return {
      x: clamp((event.clientX - bounds.left) / bounds.width),
      y: clamp((event.clientY - bounds.top) / bounds.height),
    };
  }

  function addTextAtPoint(x: number, y: number) {
    const id = crypto.randomUUID();
    const annotation: PdfEditorAnnotation = {
      id,
      pageIndex: activePageIndex,
      x: clamp(x - 0.02, 0, 0.76),
      y: clamp(y - 0.02, 0, 0.9),
      width: 0.28,
      height: 0.07,
      kind: "text",
      text: "",
      fontSize: 16,
      bold: false,
    };
    commit((current) => [...current, annotation]);
    setSelectedId(id);
    setTool("select");
    window.requestAnimationFrame(() => {
      const editable = document.querySelector<HTMLElement>(`[data-edit-id="${id}"] [contenteditable="true"]`);
      editable?.focus();
    });
  }

  function startStageInteraction(event: ReactPointerEvent<HTMLDivElement>) {
    if (busy || !activePage || event.target !== event.currentTarget) return;
    const point = stagePoint(event);
    if (tool === "image") {
      imageInputRef.current?.click();
      return;
    }
    if (tool === "draw") {
      const id = crypto.randomUUID();
      const before = annotations;
      const annotation: PdfEditorAnnotation = {
        id,
        pageIndex: activePageIndex,
        kind: "draw",
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        points: [point],
        thickness: 2,
      };
      interactionRef.current = { kind: "draw", id, startX: point.x, startY: point.y, before };
      setAnnotations([...before, annotation]);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (tool === "text") {
      addTextAtPoint(point.x, point.y);
      return;
    }
    if (tool === "highlight" || tool === "rectangle" || tool === "redact") {
      const id = crypto.randomUUID();
      const before = annotations;
      const annotation: PdfEditorAnnotation = {
        id,
        pageIndex: activePageIndex,
        kind: tool,
        x: point.x,
        y: point.y,
        width: 0.002,
        height: 0.002,
        thickness: 2,
      };
      interactionRef.current = { kind: "shape", id, startX: point.x, startY: point.y, shape: tool, before };
      setAnnotations([...before, annotation]);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (tool === "select") setSelectedId(null);
  }

  function continueInteraction(event: ReactPointerEvent<HTMLElement>) {
    const interaction = interactionRef.current;
    if (!interaction) return;
    const point = stagePoint(event);
    if (interaction.kind === "draw") {
      setAnnotations((current) => current.map((annotation) =>
        annotation.id === interaction.id && annotation.kind === "draw"
          ? { ...annotation, points: [...annotation.points, point] }
          : annotation,
      ));
      return;
    }
    if (interaction.kind === "shape") {
      setAnnotations((current) => current.map((annotation) =>
        annotation.id === interaction.id
          ? {
              ...annotation,
              x: Math.min(interaction.startX, point.x),
              y: Math.min(interaction.startY, point.y),
              width: Math.max(0.002, Math.abs(point.x - interaction.startX)),
              height: Math.max(0.002, Math.abs(point.y - interaction.startY)),
            }
          : annotation,
      ));
      return;
    }
    if (!interaction.original) return;
    const dx = point.x - interaction.startX;
    const dy = point.y - interaction.startY;
    setAnnotations((current) => current.map((annotation) => {
      if (annotation.id !== interaction.id) return annotation;
      if (interaction.kind === "drag") {
        return {
          ...annotation,
          x: clamp(interaction.original!.x + dx, 0, 1 - annotation.width),
          y: clamp(interaction.original!.y + dy, 0, 1 - annotation.height),
        };
      }
      return {
        ...annotation,
        width: clamp(interaction.original!.width + dx, 0.04, 1 - annotation.x),
        height: clamp(interaction.original!.height + dy, 0.025, 1 - annotation.y),
      };
    }));
  }

  function finishInteraction() {
    const interaction = interactionRef.current;
    if (!interaction) return;
    interactionRef.current = null;
    if (interaction.kind === "shape") {
      setAnnotations((current) => current.map((annotation) =>
        annotation.id === interaction.id && (annotation.width < 0.01 || annotation.height < 0.01)
          ? { ...annotation, width: Math.max(annotation.width, 0.22), height: Math.max(annotation.height, 0.06) }
          : annotation,
      ));
    }
    setPast((history) => [...history, interaction.before]);
    setFuture([]);
  }

  function startAnnotationInteraction(event: ReactPointerEvent<HTMLElement>, annotation: PdfEditorAnnotation, kind: "drag" | "resize") {
    if (busy || tool !== "select") return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = stagePoint(event);
    setSelectedId(annotation.id);
    interactionRef.current = {
      kind,
      id: annotation.id,
      startX: point.x,
      startY: point.y,
      original: annotation,
      before: annotations,
    };
  }

  async function addImage(file?: File) {
    if (!file || !selected) return;
    if (!["image/png", "image/jpeg"].includes(file.type)) {
      setWork({ kind: "error", message: "Choose a PNG or JPG image." });
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const preview = URL.createObjectURL(file);
    const id = crypto.randomUUID();
    const annotation: PdfEditorAnnotation = {
      id,
      pageIndex: activePageIndex,
      kind: "image",
      x: 0.34,
      y: 0.35,
      width: 0.32,
      height: 0.2,
      bytes,
      mimeType: file.type as "image/jpeg" | "image/png",
      preview,
    };
    commit((current) => [...current, annotation]);
    setSelectedId(id);
    setTool("select");
    if (imageInputRef.current) imageInputRef.current.value = "";
  }

  function updateSelected(changes: Partial<PdfEditorAnnotation>) {
    if (!selectedId) return;
    setAnnotations((current) => current.map((annotation) =>
      annotation.id === selectedId ? { ...annotation, ...changes } as PdfEditorAnnotation : annotation,
    ));
  }

  function updateTextDraft(id: string, element: HTMLElement) {
    textDraftsRef.current.set(id, element.textContent ?? "");
  }

  function commitTextDraft(id: string, element: HTMLElement) {
    const text = element.textContent ?? "";
    textDraftsRef.current.set(id, text);
    setAnnotations((current) => {
      const annotation = current.find((item) => item.id === id);
      if (!annotation || annotation.kind !== "text" || annotation.text === text) return current;
      setPast((history) => [...history, current]);
      setFuture([]);
      return current.map((item) => item.id === id && item.kind === "text" ? { ...item, text } : item);
    });
  }

  function annotationsWithTextDrafts() {
    return annotations.map((annotation) => {
      if (annotation.kind !== "text" || !textDraftsRef.current.has(annotation.id)) return annotation;
      return { ...annotation, text: textDraftsRef.current.get(annotation.id) ?? "" };
    });
  }

  async function savePdf() {
    if (!selected) return;
    setWork({ kind: "working", message: "Applying edits locally…" });
    trackToolEvent("edit", "start");
    try {
      const drafts = annotationsWithTextDrafts();
      let output = await applyPdfEdits(selected.bytes, drafts);
      const redactedPages = pageIndexesNeedingRedaction(drafts);
      if (redactedPages.length) {
        setWork({
          kind: "working",
          message: `Removing the words under ${redactedPages.length === 1 ? "the redaction mark" : `${redactedPages.length} redacted pages`}…`,
        });
        output = await replacePdfPagesWithImages(output, await rasterizePdfPages(output, redactedPages));
      }
      downloadPdf(output, editDownloadName(outputName, `${safeBaseName(selected.file.name)}-edited.pdf`));
      setSavedNotice("Saved. The original PDF is still here — undo a mark or keep editing.");
      trackToolEvent("edit", "success");
      setWork({ kind: "idle" });
    } catch (error) {
      trackToolEvent("edit", "error");
      setWork({ kind: "error", message: error instanceof Error ? error.message : "The edited PDF could not be created." });
    }
  }

  return (
    <StitchToolShell
      title="Edit PDF"
      subtitle="Add text, drawings, highlights, shapes, redaction, and images."
      className={`pdf-editor-page${selected ? " has-file" : ""}`}
      note="Verify the downloaded document before relying on it as an official record."
    >
      <section className="pdf-editor-workspace">
        <div className="merge-workspace-heading">
          <div><h2>Document editor</h2><p>{selected ? `${selected.file.name} · ${selected.pageCount} pages · ${annotations.length} edits` : "Choose a PDF to begin"}</p></div>
          {selected ? <button className="text-button" type="button" onClick={() => { setSelected(null); setAnnotations([]); textDraftsRef.current.clear(); setSavedNotice(""); setWork({ kind: "idle" }); }}>Remove file</button> : null}
        </div>

        {!selected ? (
          <label className="pdf-drop-zone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void choosePdf(event.dataTransfer.files[0]); }}>
            <input ref={pdfInputRef} type="file" accept=".pdf,application/pdf" onChange={(event) => void choosePdf(event.target.files?.[0])} />
            <span className="drop-zone-mark" aria-hidden="true">＋</span><strong>Choose a PDF file</strong><span>or drag and drop it here</span>
          </label>
        ) : (
          <>
            <div className="pdf-editor-toolbar" aria-label="PDF editing tools">
              <div className="pdf-editor-toolset">
                {TOOL_LABELS.map(({ value, label, icon: Icon }) => (
                  <button key={value} className={tool === value ? "active" : ""} type="button" onClick={() => value === "image" ? imageInputRef.current?.click() : setTool(value)} aria-pressed={tool === value} title={label}>
                    <Icon aria-hidden="true" /><span>{label}</span>
                  </button>
                ))}
              </div>
              <div className="pdf-editor-history">
                <button type="button" onClick={undo} disabled={!past.length} title="Undo last mark">
                  <Undo2 aria-hidden="true" /> Undo last mark
                </button>
                <button type="button" onClick={redo} disabled={!future.length} title="Redo">
                  <Redo2 aria-hidden="true" /> Redo
                </button>
                <button type="button" onClick={() => setZoom((value) => Math.max(50, value - 10))} disabled={zoom <= 50} title="Zoom out"><ZoomOut aria-hidden="true" /></button>
                <span>{zoom}%</span>
                <button type="button" onClick={() => setZoom((value) => Math.min(170, value + 10))} disabled={zoom >= 170} title="Zoom in"><ZoomIn aria-hidden="true" /></button>
                <label className="merge-output-name pdf-editor-filename">
                  <span>File name</span>
                  <input
                    type="text"
                    value={outputName}
                    spellCheck={false}
                    autoComplete="off"
                    disabled={busy}
                    aria-label="Edited PDF file name"
                    onChange={(event) => setOutputName(event.target.value)}
                    onBlur={() => setOutputName(editDownloadName(outputName, `${safeBaseName(selected.file.name)}-edited.pdf`))}
                  />
                </label>
                <button className="pdf-editor-download" type="button" onClick={() => void savePdf()} disabled={busy}><Download aria-hidden="true" /> Download</button>
              </div>
              <input ref={imageInputRef} className="visually-hidden-input" type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" onChange={(event) => void addImage(event.target.files?.[0])} />
            </div>
            {savedNotice ? <p className="page-numbers-saved" role="status">{savedNotice}</p> : null}
            <PdfNextStepSelector />

            <div className="pdf-editor-layout">
              <aside className="pdf-editor-pages" aria-label="Document pages">
                <ol>{selected.pages.map((page, index) => (
                  <li key={page.id}>
                    <button className={activePageIndex === index ? "active" : ""} type="button" onClick={() => { setActivePageIndex(index); setSelectedId(null); }}>
                      {/* Locally generated preview. */}
                      {page.thumbnail ? (
                      <img src={page.thumbnail} alt={`Page ${index + 1}`} />
                      ) : (
                        <span className="page-workspace-placeholder">Page {index + 1}</span>
                      )}
                      <span>Page {index + 1}{annotations.some((annotation) => annotation.pageIndex === index) ? " · Edited" : ""}</span>
                    </button>
                  </li>
                ))}</ol>
              </aside>

              <div className="pdf-editor-canvas-scroll">
                {activePage ? (
                  <div
                    ref={stageRef}
                    className={`pdf-editor-stage tool-${tool}`}
                    style={{
                      width: `${Math.round((activePage.width ?? 595) * zoom / 100)}px`,
                      aspectRatio: `${activePage.width ?? 595} / ${activePage.height ?? 842}`,
                    }}
                    onPointerDown={startStageInteraction}
                    onPointerMove={continueInteraction}
                    onPointerUp={finishInteraction}
                    onPointerCancel={finishInteraction}
                  >
                    {/* Locally generated preview. */}
                    {activePage.thumbnail ? (
                    <img className="pdf-editor-page-image" src={activePage.thumbnail} alt={`Editable page ${activePageIndex + 1}`} draggable={false} />
                    ) : (
                      <span className="page-workspace-placeholder">Loading page {activePageIndex + 1}…</span>
                    )}
                    {pageAnnotations.map((annotation) => {
                      if (annotation.kind === "draw") {
                        return (
                          <svg className="pdf-editor-drawing" key={annotation.id} viewBox="0 0 1000 1000" preserveAspectRatio="none">
                            <polyline points={annotation.points.map((point) => `${point.x * 1000},${point.y * 1000}`).join(" ")} fill="none" stroke="#111" strokeWidth={annotation.thickness * 1.5} vectorEffect="non-scaling-stroke" />
                          </svg>
                        );
                      }
                      return (
                        <div
                          key={annotation.id}
                          data-edit-id={annotation.id}
                          className={`pdf-editor-annotation ${annotation.kind}${selectedId === annotation.id ? " selected" : ""}`}
                          style={{
                            left: `${annotation.x * 100}%`,
                            top: `${annotation.y * 100}%`,
                            width: `${annotation.width * 100}%`,
                            height: `${annotation.height * 100}%`,
                          }}
                          onPointerDown={(event) => {
                            if (annotation.kind === "text") {
                              event.stopPropagation();
                              setSelectedId(annotation.id);
                            } else {
                              startAnnotationInteraction(event, annotation, "drag");
                            }
                          }}
                          onPointerMove={continueInteraction}
                          onPointerUp={finishInteraction}
                          onPointerCancel={finishInteraction}
                        >
                          {annotation.kind === "text" ? (
                            <span
                              contentEditable
                              suppressContentEditableWarning
                              role="textbox"
                              aria-multiline="true"
                              dir="auto"
                              data-pdf-text-editor="true"
                              data-placeholder="Type here"
                              style={{ fontSize: `${annotation.fontSize * zoom / 100}px`, fontWeight: annotation.bold ? 700 : 400 }}
                              onPointerDown={(event) => { event.stopPropagation(); setSelectedId(annotation.id); }}
                              onFocus={(event) => updateTextDraft(annotation.id, event.currentTarget)}
                              onInput={(event) => updateTextDraft(annotation.id, event.currentTarget)}
                              onBlur={(event) => commitTextDraft(annotation.id, event.currentTarget)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  insertPlainTextAtSelection(event.currentTarget, "\n");
                                  updateTextDraft(annotation.id, event.currentTarget);
                                } else if (event.key === "Escape") {
                                  event.currentTarget.blur();
                                }
                              }}
                              onPaste={(event) => {
                                event.preventDefault();
                                insertPlainTextAtSelection(event.currentTarget, event.clipboardData.getData("text/plain").replace(/\r\n?/g, "\n"));
                                updateTextDraft(annotation.id, event.currentTarget);
                              }}
                            >
                              {annotation.text}
                            </span>
                          ) : null}
                          {annotation.kind === "image" ? (
                            <img src={annotation.preview} alt="Placed image" draggable={false} />
                          ) : null}
                          {annotation.kind === "text" && selectedId === annotation.id ? (
                            <button className="pdf-editor-move-handle" type="button" aria-label="Move text" onPointerDown={(event) => startAnnotationInteraction(event, annotation, "drag")} onPointerMove={continueInteraction} onPointerUp={finishInteraction} onPointerCancel={finishInteraction}>⠿</button>
                          ) : null}
                          <button className="pdf-editor-resize-handle" type="button" aria-label="Resize edit" onPointerDown={(event) => startAnnotationInteraction(event, annotation, "resize")} onPointerMove={continueInteraction} onPointerUp={finishInteraction} onPointerCancel={finishInteraction} />
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>

              <aside className="pdf-editor-inspector">
                <p className="pdf-tool-status">EDIT PROPERTIES</p>
                {selectedAnnotation ? (
                  <>
                    <strong>{selectedAnnotation.kind[0].toUpperCase() + selectedAnnotation.kind.slice(1)}</strong>
                    {selectedAnnotation.kind === "redact" ? (
                      <p className="pdf-editor-direct-note">On download, the words under this mark are destroyed. This page is saved as an image so they cannot be copied back out.</p>
                    ) : null}
                    {selectedAnnotation.kind === "text" ? (
                      <>
                        <p className="pdf-editor-direct-note">Type directly inside the text box on the page.</p>
                        <label><span>Font size: {selectedAnnotation.fontSize} pt</span><input type="range" min="8" max="72" value={selectedAnnotation.fontSize} onChange={(event) => updateSelected({ fontSize: Number(event.target.value) })} /></label>
                        <label className="pdf-editor-check"><input type="checkbox" checked={selectedAnnotation.bold} onChange={(event) => updateSelected({ bold: event.target.checked })} /> Bold</label>
                      </>
                    ) : null}
                    {"thickness" in selectedAnnotation && selectedAnnotation.kind !== "redact" && selectedAnnotation.kind !== "highlight" ? <label><span>Stroke width: {selectedAnnotation.thickness} pt</span><input type="range" min="1" max="12" value={selectedAnnotation.thickness} onChange={(event) => updateSelected({ thickness: Number(event.target.value) })} /></label> : null}
                    <button className="pdf-editor-delete" type="button" onClick={() => { textDraftsRef.current.delete(selectedAnnotation.id); commit((current) => current.filter((annotation) => annotation.id !== selectedAnnotation.id)); setSelectedId(null); }}><Trash2 aria-hidden="true" /> Delete edit</button>
                  </>
                ) : (
                  <div className="pdf-editor-empty-inspector"><strong>Choose a tool</strong><span>Click the page to add an edit, or select an existing edit to move, resize, or change it.</span></div>
                )}
                <div className="pdf-editor-page-summary"><span>Current page</span><strong>{activePageIndex + 1} of {selected.pageCount}</strong><small>{pageAnnotations.length} {pageAnnotations.length === 1 ? "edit" : "edits"} on this page</small></div>
              </aside>
            </div>
          </>
        )}
        {work.kind !== "idle" ? <p className={`pdf-work-message ${work.kind}`} role={work.kind === "error" ? "alert" : "status"}>{work.message}</p> : null}
      </section>
    </StitchToolShell>
  );
}
