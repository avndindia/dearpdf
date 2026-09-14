"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import StitchToolShell from "../../../components/StitchToolShell";
import { downloadGeneratedFile } from "../../../lib/browser-download";
import {
  documentFrameToJpeg,
  imagesJpegToPdf,
  warpQuadToJpeg,
} from "../../../lib/pdf-extra-tools";
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

type AdjustDraft = {
  pageId: string | null;
  imageUrl: string;
  naturalWidth: number;
  naturalHeight: number;
  corners: [Point, Point, Point, Point];
  enhance: boolean;
};

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function defaultCorners(w: number, h: number): [Point, Point, Point, Point] {
  const insetX = w * 0.06;
  const insetY = h * 0.06;
  return [
    { x: insetX, y: insetY },
    { x: w - insetX, y: insetY },
    { x: w - insetX, y: h - insetY },
    { x: insetX, y: h - insetY },
  ];
}

function jpegBytesToBlob(bytes: Uint8Array) {
  // Copy so Blob gets a clean ArrayBuffer (views into larger buffers break some browsers).
  const copy = Uint8Array.from(bytes);
  return new Blob([copy], { type: "image/jpeg" });
}

async function previewFromJpeg(bytes: Uint8Array, width: number, height: number) {
  const canvas = document.createElement("canvas");
  const maxSide = 280;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const bmp = await createImageBitmap(jpegBytesToBlob(bytes));
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return canvas.toDataURL("image/jpeg", 0.72);
}

async function loadImageFromFile(file: File) {
  const url = URL.createObjectURL(file);
  try {
    const element = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Image could not be loaded."));
      img.src = url;
    });
    return { url, element, width: element.naturalWidth, height: element.naturalHeight };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function isSecureCameraContext() {
  if (typeof window === "undefined") return true;
  return window.isSecureContext || location.hostname === "localhost" || location.hostname === "127.0.0.1";
}

export default function ScanToPdfPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processingRef = useRef(false);

  const [cameraOn, setCameraOn] = useState(false);
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [autoEnhance, setAutoEnhance] = useState(true);
  const [mildInset, setMildInset] = useState(false);
  const [outputName, setOutputName] = useState("scan.pdf");
  const [work, setWork] = useState<WorkState>({ kind: "idle" });
  const [flash, setFlash] = useState(false);
  const [adjust, setAdjust] = useState<AdjustDraft | null>(null);
  const [dragCorner, setDragCorner] = useState<number | null>(null);
  const [secureOk] = useState(() => isSecureCameraContext());

  const busy = work.kind === "working";

  // Bind stream after <video> mounts (fixes cameraOn race).
  useEffect(() => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!cameraOn || !video || !stream) return;
    if (video.srcObject !== stream) {
      video.srcObject = stream;
    }
    const play = () => {
      void video.play().catch(() => {
        /* autoplay policies — muted + playsInline usually enough */
      });
    };
    play();
    video.addEventListener("loadedmetadata", play);
    return () => video.removeEventListener("loadedmetadata", play);
  }, [cameraOn]);

  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    },
    [],
  );

  const addProcessedPage = useCallback(async (source: CanvasImageSource, w: number, h: number) => {
    const encoded = await documentFrameToJpeg(source, w, h, {
      maxWidth: 1600,
      enhance: autoEnhance,
      inset: mildInset ? 0.04 : 0,
      quality: 0.88,
    });
    const preview = await previewFromJpeg(encoded.bytes, encoded.width, encoded.height);
    const page: ScanPage = {
      id: uid(),
      preview,
      bytes: encoded.bytes,
      width: encoded.width,
      height: encoded.height,
    };
    setPages((current) => [...current, page]);
    return page;
  }, [autoEnhance, mildInset]);

  async function startCamera() {
    setWork({ kind: "idle" });
    if (!secureOk) {
      setWork({
        kind: "error",
        message: "Camera needs a secure page (HTTPS). Open dearpdf.in, or add photos from your gallery instead.",
      });
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setWork({
        kind: "error",
        message: "This browser cannot open the camera. Use Add photos from your gallery instead.",
      });
      return;
    }
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
      setCameraOn(true); // video mounts; effect attaches stream
    } catch {
      setWork({
        kind: "error",
        message: "Camera permission was denied or unavailable. You can still add photos from your gallery.",
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
    if (!video || !video.videoWidth || processingRef.current) return;
    processingRef.current = true;
    setFlash(true);
    window.setTimeout(() => setFlash(false), 120);
    try {
      await addProcessedPage(video, video.videoWidth, video.videoHeight);
      setWork({ kind: "idle" });
    } catch (error) {
      setWork({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not capture that page.",
      });
    } finally {
      processingRef.current = false;
    }
  }

  async function addGalleryFiles(files: FileList | File[]) {
    const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!list.length) {
      setWork({ kind: "error", message: "Pick one or more photos (JPEG or PNG)." });
      return;
    }
    setWork({ kind: "working", message: `Adding ${list.length} photo${list.length === 1 ? "" : "s"}…` });
    try {
      for (const file of list) {
        const loaded = await loadImageFromFile(file);
        try {
          await addProcessedPage(loaded.element, loaded.width, loaded.height);
        } finally {
          URL.revokeObjectURL(loaded.url);
        }
      }
      setWork({ kind: "idle" });
    } catch (error) {
      setWork({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not add those photos.",
      });
    }
  }

  function movePage(id: string, dir: -1 | 1) {
    setPages((current) => {
      const index = current.findIndex((p) => p.id === id);
      if (index < 0) return current;
      const next = index + dir;
      if (next < 0 || next >= current.length) return current;
      const copy = [...current];
      const [item] = copy.splice(index, 1);
      copy.splice(next, 0, item);
      return copy;
    });
  }

  function removePage(id: string) {
    setPages((current) => current.filter((p) => p.id !== id));
  }

  async function openAdjust(page: ScanPage) {
    try {
      const blob = jpegBytesToBlob(page.bytes);
      const url = URL.createObjectURL(blob);
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("Could not open page for adjust."));
        el.src = url;
      });
      setAdjust({
        pageId: page.id,
        imageUrl: url,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        corners: defaultCorners(img.naturalWidth, img.naturalHeight),
        enhance: autoEnhance,
      });
    } catch (error) {
      setWork({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not open adjust.",
      });
    }
  }

  function closeAdjust() {
    if (adjust?.imageUrl) URL.revokeObjectURL(adjust.imageUrl);
    setAdjust(null);
    setDragCorner(null);
  }

  async function applyAdjust() {
    if (!adjust) return;
    setWork({ kind: "working", message: "Adjusting page…" });
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("Adjust source missing."));
        el.src = adjust.imageUrl;
      });
      // Downsample before warp so phones stay responsive.
      const maxSrc = 1200;
      const scale = Math.min(1, maxSrc / Math.max(adjust.naturalWidth, adjust.naturalHeight));
      const srcW = Math.max(32, Math.round(adjust.naturalWidth * scale));
      const srcH = Math.max(32, Math.round(adjust.naturalHeight * scale));
      const scaled = document.createElement("canvas");
      scaled.width = srcW;
      scaled.height = srcH;
      const sctx = scaled.getContext("2d");
      if (!sctx) throw new Error("Canvas unavailable.");
      sctx.drawImage(img, 0, 0, srcW, srcH);
      const corners = adjust.corners.map((c) => ({
        x: c.x * scale,
        y: c.y * scale,
      })) as [Point, Point, Point, Point];
      const warped = await warpQuadToJpeg(
        scaled,
        srcW,
        srcH,
        corners,
        Math.min(1400, srcW),
        adjust.enhance,
        0.88,
      );
      const preview = await previewFromJpeg(warped.bytes, warped.width, warped.height);
      setPages((current) =>
        current.map((p) =>
          p.id === adjust.pageId
            ? { ...p, bytes: warped.bytes, width: warped.width, height: warped.height, preview }
            : p,
        ),
      );
      closeAdjust();
      setWork({ kind: "idle" });
    } catch (error) {
      setWork({
        kind: "error",
        message: error instanceof Error ? error.message : "Adjust failed.",
      });
    }
  }

  function updateCornerFromEvent(index: number, clientX: number, clientY: number, rect: DOMRect) {
    if (!adjust) return;
    const x = ((clientX - rect.left) / rect.width) * adjust.naturalWidth;
    const y = ((clientY - rect.top) / rect.height) * adjust.naturalHeight;
    setAdjust((current) => {
      if (!current) return current;
      const corners = [...current.corners] as [Point, Point, Point, Point];
      corners[index] = {
        x: Math.max(0, Math.min(current.naturalWidth, x)),
        y: Math.max(0, Math.min(current.naturalHeight, y)),
      };
      return { ...current, corners };
    });
  }

  async function buildPdf() {
    if (!pages.length) return;
    setWork({ kind: "working", message: "Building PDF on this device…" });
    trackToolEvent("scan-to-pdf", "start");
    try {
      const output = await imagesJpegToPdf(
        pages.map((p) => ({ bytes: p.bytes, width: p.width, height: p.height })),
      );
      downloadGeneratedFile(output as BlobPart, outputName.replace(/\.pdf$/i, "") + ".pdf");
      trackToolEvent("scan-to-pdf", "success");
      setWork({ kind: "idle" });
    } catch (error) {
      trackToolEvent("scan-to-pdf", "error");
      setWork({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not build the PDF.",
      });
    }
  }

  return (
    <StitchToolShell
      title="Scan to PDF"
      subtitle="Scan pages with your camera, then download a PDF. Everything stays on this device."
      className={`compress-page scan-to-pdf-page${pages.length ? " has-file" : ""}`}
      related={[
        { href: "/pdf-tools/images-to-pdf", label: "Images to PDF" },
        { href: "/pdf-tools/grayscale", label: "Grayscale PDF" },
      ]}
      note="Range scan: capture page after page, then Save PDF. Works best on a phone over HTTPS."
    >
      <section className="scan-range-workspace">
        <div className="scan-range-toolbar">
          <label className="scan-toggle">
            <input
              type="checkbox"
              checked={autoEnhance}
              onChange={(e) => setAutoEnhance(e.target.checked)}
            />
            <span>Enhance all (document look)</span>
          </label>
          <label className="scan-toggle">
            <input
              type="checkbox"
              checked={mildInset}
              onChange={(e) => setMildInset(e.target.checked)}
            />
            <span>Slight edge trim</span>
          </label>
        </div>

        {!cameraOn ? (
          <div className="scan-start-panel">
            <button
              className="merge-button scan-primary-cta"
              type="button"
              onClick={() => void startCamera()}
              disabled={busy}
            >
              Start scanning
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => galleryRef.current?.click()}
              disabled={busy}
            >
              Add photos
            </button>
            <p className="organise-tip">
              Point at a page, tap Capture, flip to the next page, keep going — then Save PDF.
              {!secureOk ? " Camera needs HTTPS; gallery still works." : null}
            </p>
          </div>
        ) : (
          <div className="scan-camera-stage">
            <div className="scan-video-wrap">
              <video ref={videoRef} playsInline muted autoPlay className="scan-video" />
              {flash ? <div className="scan-flash" aria-hidden /> : null}
              <div className="scan-camera-hint">Page {pages.length + 1}</div>
            </div>
            <div className="scan-shutter-row">
              <button
                type="button"
                className="secondary-button"
                onClick={() => galleryRef.current?.click()}
                disabled={busy}
              >
                Add photos
              </button>
              <button
                type="button"
                className="scan-shutter"
                aria-label="Capture page"
                onClick={() => void captureFrame()}
                disabled={busy}
              />
              <button type="button" className="secondary-button" onClick={stopCamera} disabled={busy}>
                Done
              </button>
            </div>
          </div>
        )}

        <input
          ref={galleryRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            const list = e.target.files;
            if (!list?.length) return;
            void addGalleryFiles(list);
            e.target.value = "";
          }}
        />

        {pages.length ? (
          <>
            <div className="scan-strip-header">
              <strong>
                {pages.length} page{pages.length === 1 ? "" : "s"}
              </strong>
              <span>Tap a page to adjust edges · reorder or delete below</span>
            </div>
            <ol className="scan-page-strip">
              {pages.map((page, index) => (
                <li key={page.id} className="scan-page-card">
                  <button
                    type="button"
                    className="scan-page-thumb"
                    onClick={() => void openAdjust(page)}
                    aria-label={`Adjust page ${index + 1}`}
                  >
                    <img src={page.preview} alt={`Page ${index + 1}`} />
                    <span className="scan-page-num">{index + 1}</span>
                  </button>
                  <div className="scan-page-actions">
                    <button type="button" className="text-button" onClick={() => movePage(page.id, -1)} disabled={index === 0}>
                      ←
                    </button>
                    <button type="button" className="text-button" onClick={() => void openAdjust(page)}>
                      Edges
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => movePage(page.id, 1)}
                      disabled={index === pages.length - 1}
                    >
                      →
                    </button>
                    <button type="button" className="text-button" onClick={() => removePage(page.id)}>
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ol>

            <div className="organise-action-row scan-save-row">
              <div>
                <strong>Ready to save</strong>
                <span>One PDF from this range scan — built here, not uploaded</span>
              </div>
              <div className="merge-action-controls">
                <label className="merge-output-name">
                  <span>File name</span>
                  <input
                    type="text"
                    value={outputName}
                    spellCheck={false}
                    disabled={busy}
                    onChange={(e) => setOutputName(e.target.value)}
                  />
                </label>
                <button className="merge-button" type="button" onClick={() => void buildPdf()} disabled={busy}>
                  {busy ? "Building…" : "Save PDF"}
                </button>
              </div>
            </div>
          </>
        ) : (
          <p className="organise-tip scan-empty-tip">
            No pages yet. Start scanning or add photos — each shot becomes a page right away.
          </p>
        )}

        {work.kind !== "idle" ? (
          <p className={`pdf-work-message ${work.kind}`} role={work.kind === "error" ? "alert" : "status"}>
            {work.message}
          </p>
        ) : null}
      </section>

      {adjust ? (
        <div
          className="page-preview-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Adjust page edges"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 80,
            background: "rgba(0,0,0,.55)",
            display: "grid",
            placeItems: "center",
            padding: 16,
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 12,
              padding: 16,
              width: "min(920px, 100%)",
              display: "grid",
              gap: 12,
              maxHeight: "92vh",
              overflow: "auto",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <strong>Drag corners to the document edges (optional)</strong>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={adjust.enhance}
                  onChange={(e) => setAdjust({ ...adjust, enhance: e.target.checked })}
                />
                Enhance
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
              <img
                src={adjust.imageUrl}
                alt="Page to adjust"
                style={{ width: "100%", display: "block", borderRadius: 8 }}
                draggable={false}
              />
              <svg
                viewBox={`0 0 ${adjust.naturalWidth} ${adjust.naturalHeight}`}
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
              >
                <polygon
                  points={adjust.corners.map((c) => `${c.x},${c.y}`).join(" ")}
                  fill="rgba(185,28,28,0.18)"
                  stroke="#b91c1c"
                  strokeWidth={Math.max(2, adjust.naturalWidth / 400)}
                />
                {adjust.corners.map((c, index) => (
                  <circle
                    key={index}
                    cx={c.x}
                    cy={c.y}
                    r={Math.max(14, adjust.naturalWidth / 60)}
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
              <button type="button" className="text-button" onClick={closeAdjust}>
                Cancel
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  setAdjust({
                    ...adjust,
                    corners: defaultCorners(adjust.naturalWidth, adjust.naturalHeight),
                  })
                }
              >
                Reset
              </button>
              <button type="button" className="merge-button" onClick={() => void applyAdjust()} disabled={busy}>
                {busy ? "Applying…" : "Apply"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </StitchToolShell>
  );
}
