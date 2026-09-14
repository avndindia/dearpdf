"use client";

import { useEffect, useRef, useState } from "react";
import StitchToolShell from "../../../components/StitchToolShell";
import { downloadGeneratedFile } from "../../../lib/browser-download";
import { imagesJpegToPdf, warpQuadToJpeg } from "../../../lib/pdf-extra-tools";
import { trackToolEvent } from "../../../lib/stats";

type Point = { x: number; y: number };
type ScanPage = {
  id: string;
  preview: string;
  bytes: Uint8Array;
  width: number;
  height: number;
};

type WorkState = { kind: "idle" } | { kind: "working" | "error"; message: string };

type CropDraft = {
  id: string;
  imageUrl: string;
  naturalWidth: number;
  naturalHeight: number;
  corners: [Point, Point, Point, Point];
  enhance: boolean;
};

function defaultCorners(w: number, h: number): [Point, Point, Point, Point] {
  const insetX = w * 0.08;
  const insetY = h * 0.08;
  return [
    { x: insetX, y: insetY },
    { x: w - insetX, y: insetY },
    { x: w - insetX, y: h - insetY },
    { x: insetX, y: h - insetY },
  ];
}

async function fileToImage(file: File): Promise<{ url: string; width: number; height: number; element: HTMLImageElement }> {
  const url = URL.createObjectURL(file);
  const element = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image could not be loaded."));
    img.src = url;
  });
  return { url, width: element.naturalWidth, height: element.naturalHeight, element };
}

export default function ScanToPdfPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [draft, setDraft] = useState<CropDraft | null>(null);
  const [dragCorner, setDragCorner] = useState<number | null>(null);
  const [autoEnhance, setAutoEnhance] = useState(true);
  const [outputName, setOutputName] = useState("scan.pdf");
  const [work, setWork] = useState<WorkState>({ kind: "idle" });
  const busy = work.kind === "working";

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  async function startCamera() {
    setWork({ kind: "idle" });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1440 },
        },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraOn(true);
    } catch {
      setWork({
        kind: "error",
        message: "Camera access was blocked or unavailable. You can still pick photos from your gallery.",
      });
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
  }

  async function captureFrame() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    if (!blob) return;
    const file = new File([blob], `capture-${Date.now()}.jpg`, { type: "image/jpeg" });
    await openCropForFile(file);
  }

  async function openCropForFile(file: File) {
    try {
      const loaded = await fileToImage(file);
      setDraft({
        id: `${Date.now()}-${Math.random()}`,
        imageUrl: loaded.url,
        naturalWidth: loaded.width,
        naturalHeight: loaded.height,
        corners: defaultCorners(loaded.width, loaded.height),
        enhance: autoEnhance,
      });
    } catch (error) {
      setWork({ kind: "error", message: error instanceof Error ? error.message : "Could not open that image." });
    }
  }

  async function acceptCrop() {
    if (!draft) return;
    setWork({ kind: "working", message: "Cropping page on this device…" });
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("Crop source missing."));
        el.src = draft.imageUrl;
      });
      const warped = await warpQuadToJpeg(
        img,
        draft.naturalWidth,
        draft.naturalHeight,
        draft.corners,
        Math.min(1600, draft.naturalWidth),
        draft.enhance,
        0.88,
      );
      const previewCanvas = document.createElement("canvas");
      previewCanvas.width = warped.width;
      previewCanvas.height = warped.height;
      const previewCtx = previewCanvas.getContext("2d");
      if (!previewCtx) throw new Error("Preview failed.");
      const jpegCopy = Uint8Array.from(warped.bytes);
      const bmp = await createImageBitmap(new Blob([jpegCopy.buffer], { type: "image/jpeg" }));
      previewCtx.drawImage(bmp, 0, 0);
      bmp.close();
      setPages((current) => [
        ...current,
        {
          id: draft.id,
          preview: previewCanvas.toDataURL("image/jpeg", 0.75),
          bytes: jpegCopy,
          width: warped.width,
          height: warped.height,
        },
      ]);
      URL.revokeObjectURL(draft.imageUrl);
      setDraft(null);
      setWork({ kind: "idle" });
    } catch (error) {
      setWork({ kind: "error", message: error instanceof Error ? error.message : "Crop failed." });
    }
  }

  async function buildPdf() {
    if (!pages.length) return;
    setWork({ kind: "working", message: "Building PDF on this device…" });
    trackToolEvent("scan-to-pdf", "start");
    try {
      const output = await imagesJpegToPdf(pages.map((p) => ({ bytes: p.bytes, width: p.width, height: p.height })));
      downloadGeneratedFile(output as BlobPart, outputName.replace(/\.pdf$/i, "") + ".pdf");
      trackToolEvent("scan-to-pdf", "success");
      setWork({ kind: "idle" });
    } catch (error) {
      trackToolEvent("scan-to-pdf", "error");
      setWork({ kind: "error", message: error instanceof Error ? error.message : "Could not build the PDF." });
    }
  }

  function updateCornerFromEvent(index: number, clientX: number, clientY: number, rect: DOMRect) {
    if (!draft) return;
    const x = ((clientX - rect.left) / rect.width) * draft.naturalWidth;
    const y = ((clientY - rect.top) / rect.height) * draft.naturalHeight;
    setDraft((current) => {
      if (!current) return current;
      const corners = [...current.corners] as [Point, Point, Point, Point];
      corners[index] = {
        x: Math.max(0, Math.min(current.naturalWidth, x)),
        y: Math.max(0, Math.min(current.naturalHeight, y)),
      };
      return { ...current, corners };
    });
  }

  return (
    <StitchToolShell
      title="Scan to PDF"
      subtitle="Camera or gallery → crop → optional enhance → multi-page PDF. Nothing uploaded."
      className={`compress-page scan-to-pdf-page${pages.length ? " has-file" : ""}`}
      related={[
        { href: "/pdf-tools/images-to-pdf", label: "Images to PDF" },
        { href: "/pdf-tools/grayscale", label: "Grayscale PDF" },
      ]}
      note="Works best on a phone. Allow camera access, or pick existing photos."
    >
      <section className="compress-workspace" style={{ display: "grid", gap: 16 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {!cameraOn ? (
            <button className="merge-button" type="button" onClick={() => void startCamera()} disabled={busy}>Start camera</button>
          ) : (
            <>
              <button className="merge-button" type="button" onClick={() => void captureFrame()} disabled={busy}>Capture page</button>
              <button className="secondary-button" type="button" onClick={stopCamera} disabled={busy}>Stop camera</button>
            </>
          )}
          <button className="secondary-button" type="button" onClick={() => galleryRef.current?.click()} disabled={busy}>Pick from gallery</button>
          <input
            ref={galleryRef}
            type="file"
            accept="image/*"
            multiple
            capture="environment"
            hidden
            onChange={(e) => {
              const list = e.target.files;
              if (!list?.length) return;
              void (async () => {
                for (const file of Array.from(list)) await openCropForFile(file);
              })();
              e.target.value = "";
            }}
          />
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
            <input type="checkbox" checked={autoEnhance} onChange={(e) => setAutoEnhance(e.target.checked)} />
            <span>Auto-enhance new pages</span>
          </label>
        </div>

        {cameraOn ? (
          <div style={{ position: "relative", borderRadius: 12, overflow: "hidden", background: "#111", aspectRatio: "3 / 4", maxHeight: 520 }}>
            <video ref={videoRef} playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </div>
        ) : null}

        {draft ? (
          <div className="page-preview-modal" role="dialog" aria-modal="true" aria-label="Crop scanned page" style={{ position: "fixed", inset: 0, zIndex: 80, background: "rgba(0,0,0,.55)", display: "grid", placeItems: "center", padding: 16 }}>
            <div style={{ background: "#fff", borderRadius: 12, padding: 16, width: "min(920px, 100%)", display: "grid", gap: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <strong>Drag the four corners to the document edges</strong>
                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input type="checkbox" checked={draft.enhance} onChange={(e) => setDraft({ ...draft, enhance: e.target.checked })} />
                  Enhance contrast
                </label>
              </div>
              <div
                style={{ position: "relative", touchAction: "none", userSelect: "none" }}
                onPointerMove={(e) => {
                  if (dragCorner === null) return;
                  const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                  updateCornerFromEvent(dragCorner, e.clientX, e.clientY, rect);
                }}
                onPointerUp={() => setDragCorner(null)}
                onPointerLeave={() => setDragCorner(null)}
              >
                <img src={draft.imageUrl} alt="Page to crop" style={{ width: "100%", display: "block", borderRadius: 8 }} draggable={false} />
                <svg viewBox={`0 0 ${draft.naturalWidth} ${draft.naturalHeight}`} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
                  <polygon
                    points={draft.corners.map((c) => `${c.x},${c.y}`).join(" ")}
                    fill="rgba(185,28,28,0.18)"
                    stroke="#b91c1c"
                    strokeWidth={Math.max(2, draft.naturalWidth / 400)}
                  />
                  {draft.corners.map((c, index) => (
                    <circle
                      key={index}
                      cx={c.x}
                      cy={c.y}
                      r={Math.max(14, draft.naturalWidth / 60)}
                      fill="#b91c1c"
                      style={{ cursor: "grab" }}
                      onPointerDown={(e) => {
                        e.currentTarget.setPointerCapture(e.pointerId);
                        setDragCorner(index);
                      }}
                    />
                  ))}
                </svg>
              </div>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                <button type="button" className="text-button" onClick={() => { URL.revokeObjectURL(draft.imageUrl); setDraft(null); }}>Cancel</button>
                <button type="button" className="secondary-button" onClick={() => setDraft({ ...draft, corners: defaultCorners(draft.naturalWidth, draft.naturalHeight) })}>Reset corners</button>
                <button type="button" className="merge-button" onClick={() => void acceptCrop()} disabled={busy}>
                  {busy ? "Cropping…" : "Add page"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {pages.length ? (
          <>
            <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 12 }}>
              {pages.map((page, index) => (
                <li key={page.id} style={{ border: "1px solid var(--line)", background: "#fff", padding: 8, display: "grid", gap: 8 }}>
                  <img src={page.preview} alt={`Scanned page ${index + 1}`} style={{ width: "100%", display: "block" }} />
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <strong>Page {index + 1}</strong>
                    <button type="button" className="text-button" onClick={() => setPages((c) => c.filter((p) => p.id !== page.id))}>Remove</button>
                  </div>
                </li>
              ))}
            </ol>
            <div className="organise-action-row">
              <div>
                <strong>{pages.length} scanned {pages.length === 1 ? "page" : "pages"}</strong>
                <span>Bundled with pdf-lib — stays on this device</span>
              </div>
              <div className="merge-action-controls">
                <label className="merge-output-name">
                  <span>File name</span>
                  <input type="text" value={outputName} spellCheck={false} disabled={busy} onChange={(e) => setOutputName(e.target.value)} />
                </label>
                <button className="merge-button" type="button" onClick={() => void buildPdf()} disabled={busy}>
                  {busy ? "Building…" : "Download PDF"}
                </button>
              </div>
            </div>
          </>
        ) : (
          <p className="organise-tip">Capture with the camera or pick photos, then drag the four corners to the page edges. Optional contrast enhance cleans desk photos.</p>
        )}

        {work.kind !== "idle" ? <p className={`pdf-work-message ${work.kind}`} role={work.kind === "error" ? "alert" : "status"}>{work.message}</p> : null}
      </section>
    </StitchToolShell>
  );
}
