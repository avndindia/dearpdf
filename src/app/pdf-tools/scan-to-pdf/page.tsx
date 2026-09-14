"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import StitchToolShell from "../../../components/StitchToolShell";
import { downloadGeneratedFile } from "../../../lib/browser-download";
import {
  defaultCorners,
  detectDocumentQuad,
  mildCurveFlattenJpeg,
  quadDrift,
  splitQuadVertical,
  type Quad,
} from "../../../lib/document-edge-detect";
import { imagesJpegToPdf, warpQuadToJpeg } from "../../../lib/pdf-extra-tools";
import { trackToolEvent } from "../../../lib/stats";

type ScanMode = "document" | "book";
type PageOrder = "ltr" | "rtl";

type ScanPage = {
  id: string;
  preview: string;
  bytes: Uint8Array;
  width: number;
  height: number;
  /** Original capture (pre-warp) for retake / edge adjust */
  sourceBytes?: Uint8Array;
  sourceWidth?: number;
  sourceHeight?: number;
  corners?: Quad;
};

type WorkState = { kind: "idle" } | { kind: "working" | "error"; message: string };

type AdjustDraft = {
  pageId: string | null;
  imageUrl: string;
  naturalWidth: number;
  naturalHeight: number;
  corners: Quad;
  enhance: boolean;
};

const AUTO_STABLE_MS = 800;
const AUTO_COOLDOWN_MS = 2200;
const DETECT_MIN_CONFIDENCE = 0.34;
const STABLE_DRIFT = 0.028;

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function jpegBytesToBlob(bytes: Uint8Array) {
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

async function encodeSourceJpeg(source: CanvasImageSource, w: number, h: number, maxSide = 1600) {
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const width = Math.max(32, Math.round(w * scale));
  const height = Math.max(32, Math.round(h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable.");
  ctx.drawImage(source, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  if (!blob) throw new Error("Could not encode frame.");
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height, scale };
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

function scaleCorners(corners: Quad, scale: number): Quad {
  return corners.map((c) => ({ x: c.x * scale, y: c.y * scale })) as Quad;
}

export default function ScanToPdfPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<SVGSVGElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processingRef = useRef(false);
  const liveCornersRef = useRef<Quad | null>(null);
  const liveConfRef = useRef(0);
  const stableSinceRef = useRef<number | null>(null);
  const lastAutoAtRef = useRef(0);
  const detectBusyRef = useRef(false);
  const rafRef = useRef(0);

  const [cameraOn, setCameraOn] = useState(false);
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [mode, setMode] = useState<ScanMode>("document");
  const [pageOrder, setPageOrder] = useState<PageOrder>("ltr");
  const [autoEnhance, setAutoEnhance] = useState(true);
  const [colorBoost, setColorBoost] = useState(false);
  const [autoScan, setAutoScan] = useState(false);
  const [mildFlatten, setMildFlatten] = useState(false);
  const [liveCorners, setLiveCorners] = useState<Quad | null>(null);
  const [liveConfidence, setLiveConfidence] = useState(0);
  const [videoSize, setVideoSize] = useState({ w: 1, h: 1 });
  const [outputName, setOutputName] = useState("scan.pdf");
  const [work, setWork] = useState<WorkState>({ kind: "idle" });
  const [flash, setFlash] = useState(false);
  const [adjust, setAdjust] = useState<AdjustDraft | null>(null);
  const [dragCorner, setDragCorner] = useState<number | null>(null);
  const [secureOk] = useState(() => isSecureCameraContext());

  const busy = work.kind === "working";
  const modeRef = useRef(mode);
  const autoScanRef = useRef(autoScan);
  const autoEnhanceRef = useRef(autoEnhance);
  const colorBoostRef = useRef(colorBoost);
  const mildFlattenRef = useRef(mildFlatten);
  const pageOrderRef = useRef(pageOrder);
  modeRef.current = mode;
  autoScanRef.current = autoScan;
  autoEnhanceRef.current = autoEnhance;
  colorBoostRef.current = colorBoost;
  mildFlattenRef.current = mildFlatten;
  pageOrderRef.current = pageOrder;

  useEffect(() => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!cameraOn || !video || !stream) return;
    if (video.srcObject !== stream) video.srcObject = stream;
    const play = () => {
      void video.play().catch(() => {});
    };
    play();
    video.addEventListener("loadedmetadata", play);
    return () => video.removeEventListener("loadedmetadata", play);
  }, [cameraOn]);

  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  // Camera-first landing: open the viewfinder immediately on secure pages.
  useEffect(() => {
    let cancelled = false;
    async function boot() {
      if (!secureOk || !navigator.mediaDevices?.getUserMedia) return;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1440 },
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        setCameraOn(true);
      } catch {
        // Permission denied — user can still Add photos / tap Start scanning.
      }
    }
    void boot();
    return () => {
      cancelled = true;
    };
  }, [secureOk]);

  const processQuadPage = useCallback(
    async (
      source: CanvasImageSource,
      srcW: number,
      srcH: number,
      corners: Quad,
      sourceMeta?: { bytes: Uint8Array; width: number; height: number; corners: Quad },
    ) => {
      const enhance = autoEnhanceRef.current;
      // Color boost = slightly higher contrast stretch via enhance path + wider output.
      const maxW = colorBoostRef.current ? 1700 : 1600;
      let warped = await warpQuadToJpeg(source, srcW, srcH, corners, Math.min(maxW, srcW), enhance, 0.88);
      if (mildFlattenRef.current && modeRef.current === "book") {
        warped = await mildCurveFlattenJpeg(warped.bytes, warped.width, warped.height, 0.14, 0.88);
      }
      const preview = await previewFromJpeg(warped.bytes, warped.width, warped.height);
      const page: ScanPage = {
        id: uid(),
        preview,
        bytes: warped.bytes,
        width: warped.width,
        height: warped.height,
        sourceBytes: sourceMeta?.bytes,
        sourceWidth: sourceMeta?.width,
        sourceHeight: sourceMeta?.height,
        corners: sourceMeta?.corners,
      };
      setPages((current) => [...current, page]);
      return page;
    },
    [],
  );

  const captureFromSource = useCallback(
    async (source: CanvasImageSource, w: number, h: number, forcedCorners?: Quad | null) => {
      let corners: Quad;
      if (forcedCorners) {
        corners = forcedCorners;
      } else {
        const detected = detectDocumentQuad(source, w, h);
        corners = detected?.corners ?? defaultCorners(w, h);
      }
      const encoded = await encodeSourceJpeg(source, w, h, 1600);
      const scaledCorners = scaleCorners(corners, encoded.scale);

      // Build a canvas of the encoded size for warp.
      const bmp = await createImageBitmap(jpegBytesToBlob(encoded.bytes));
      const canvas = document.createElement("canvas");
      canvas.width = encoded.width;
      canvas.height = encoded.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        bmp.close();
        throw new Error("Canvas unavailable.");
      }
      ctx.drawImage(bmp, 0, 0);
      bmp.close();

      if (modeRef.current === "book") {
        const { left, right } = splitQuadVertical(scaledCorners);
        const first = pageOrderRef.current === "ltr" ? left : right;
        const second = pageOrderRef.current === "ltr" ? right : left;
        await processQuadPage(canvas, encoded.width, encoded.height, first, {
          bytes: encoded.bytes,
          width: encoded.width,
          height: encoded.height,
          corners: first,
        });
        await processQuadPage(canvas, encoded.width, encoded.height, second, {
          bytes: encoded.bytes,
          width: encoded.width,
          height: encoded.height,
          corners: second,
        });
      } else {
        await processQuadPage(canvas, encoded.width, encoded.height, scaledCorners, {
          bytes: encoded.bytes,
          width: encoded.width,
          height: encoded.height,
          corners: scaledCorners,
        });
      }
    },
    [processQuadPage],
  );

  // Live edge detection loop while camera is on.
  useEffect(() => {
    if (!cameraOn) {
      setLiveCorners(null);
      setLiveConfidence(0);
      liveCornersRef.current = null;
      stableSinceRef.current = null;
      return;
    }

    let lastDetect = 0;
    const tick = (now: number) => {
      rafRef.current = requestAnimationFrame(tick);
      const video = videoRef.current;
      if (!video || !video.videoWidth || detectBusyRef.current) return;
      if (now - lastDetect < 110) return; // ~9 fps detect
      lastDetect = now;
      detectBusyRef.current = true;
      try {
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        setVideoSize((s) => (s.w === vw && s.h === vh ? s : { w: vw, h: vh }));
        const result = detectDocumentQuad(video, vw, vh);
        if (result) {
          setLiveCorners(result.corners);
          setLiveConfidence(result.confidence);
          const prev = liveCornersRef.current;
          liveCornersRef.current = result.corners;
          liveConfRef.current = result.confidence;

          if (
            autoScanRef.current &&
            !processingRef.current &&
            result.confidence >= DETECT_MIN_CONFIDENCE &&
            prev &&
            quadDrift(prev, result.corners, vw, vh) < STABLE_DRIFT
          ) {
            if (stableSinceRef.current == null) stableSinceRef.current = now;
            else if (
              now - stableSinceRef.current >= AUTO_STABLE_MS &&
              now - lastAutoAtRef.current >= AUTO_COOLDOWN_MS
            ) {
              lastAutoAtRef.current = now;
              stableSinceRef.current = null;
              void captureFrameRef.current?.();
            }
          } else {
            stableSinceRef.current = null;
          }
        }
      } finally {
        detectBusyRef.current = false;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [cameraOn]);

  const captureFrameRef = useRef<(() => Promise<void>) | null>(null);

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
      setCameraOn(true);
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
      const corners =
        liveConfRef.current >= DETECT_MIN_CONFIDENCE ? liveCornersRef.current : null;
      await captureFromSource(video, video.videoWidth, video.videoHeight, corners);
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
  captureFrameRef.current = captureFrame;

  async function addGalleryFiles(files: FileList | File[]) {
    const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!list.length) {
      setWork({ kind: "error", message: "Pick one or more photos (JPEG or PNG)." });
      return;
    }
    setWork({ kind: "working", message: `Scanning ${list.length} photo${list.length === 1 ? "" : "s"}…` });
    try {
      for (const file of list) {
        const loaded = await loadImageFromFile(file);
        try {
          await captureFromSource(loaded.element, loaded.width, loaded.height, null);
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
      const bytes = page.sourceBytes ?? page.bytes;
      const blob = jpegBytesToBlob(bytes);
      const url = URL.createObjectURL(blob);
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("Could not open page for adjust."));
        el.src = url;
      });
      const nw = page.sourceWidth ?? img.naturalWidth;
      const nh = page.sourceHeight ?? img.naturalHeight;
      const corners =
        page.corners ??
        detectDocumentQuad(img, img.naturalWidth, img.naturalHeight)?.corners ??
        defaultCorners(nw, nh);
      setAdjust({
        pageId: page.id,
        imageUrl: url,
        naturalWidth: nw,
        naturalHeight: nh,
        corners,
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
      })) as Quad;
      let warped = await warpQuadToJpeg(
        scaled,
        srcW,
        srcH,
        corners,
        Math.min(1400, srcW),
        adjust.enhance,
        0.88,
      );
      if (mildFlatten && mode === "book") {
        warped = await mildCurveFlattenJpeg(warped.bytes, warped.width, warped.height, 0.14, 0.88);
      }
      const preview = await previewFromJpeg(warped.bytes, warped.width, warped.height);
      setPages((current) =>
        current.map((p) =>
          p.id === adjust.pageId
            ? {
                ...p,
                bytes: warped.bytes,
                width: warped.width,
                height: warped.height,
                preview,
                corners: adjust.corners,
              }
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
      const corners = [...current.corners] as Quad;
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

  const outlinePoints = liveCorners
    ? liveCorners.map((c) => `${c.x},${c.y}`).join(" ")
    : "";
  const edgeLocked = liveConfidence >= DETECT_MIN_CONFIDENCE;

  return (
    <StitchToolShell
      title="Scan to PDF"
      subtitle="Live edge detect, auto-crop, and continuous pages — like a phone document scanner. Everything stays on this device."
      className={`compress-page scan-to-pdf-page${pages.length ? " has-file" : ""}`}
      related={[
        { href: "/pdf-tools/images-to-pdf", label: "Images to PDF" },
        { href: "/pdf-tools/pdf-to-text", label: "PDF to Text (OCR)" },
        { href: "/pdf-tools/ai-summary", label: "AI Summary" },
      ]}
      note="Document or Book (2 pages). Auto Scan when edges are steady. OCR later via PDF to Text / AI Summary — not rebuilt here."
    >
      <section className="scan-range-workspace">
        <div className="scan-mode-row" role="group" aria-label="Scan mode">
          <button
            type="button"
            className={`scan-mode-btn${mode === "document" ? " is-active" : ""}`}
            onClick={() => setMode("document")}
          >
            Document
          </button>
          <button
            type="button"
            className={`scan-mode-btn${mode === "book" ? " is-active" : ""}`}
            onClick={() => setMode("book")}
          >
            Book (2 pages)
          </button>
          <button
            type="button"
            className={`scan-mode-btn scan-autoscan-btn${autoScan ? " is-active" : ""}`}
            aria-pressed={autoScan}
            onClick={() => setAutoScan((v) => !v)}
          >
            Auto Scan{autoScan ? " · On" : ""}
          </button>
        </div>

        <div className="scan-range-toolbar">
          <label className="scan-toggle">
            <input type="checkbox" checked={autoEnhance} onChange={(e) => setAutoEnhance(e.target.checked)} />
            <span>Enhance</span>
          </label>
          <label className="scan-toggle">
            <input type="checkbox" checked={colorBoost} onChange={(e) => setColorBoost(e.target.checked)} />
            <span>Color boost</span>
          </label>
          {mode === "book" ? (
            <>
              <label className="scan-toggle">
                <span>Order</span>
                <select
                  value={pageOrder}
                  onChange={(e) => setPageOrder(e.target.value as PageOrder)}
                  aria-label="Book page order"
                >
                  <option value="ltr">LTR (left → right)</option>
                  <option value="rtl">RTL (right → left)</option>
                </select>
              </label>
              <label className="scan-toggle">
                <input
                  type="checkbox"
                  checked={mildFlatten}
                  onChange={(e) => setMildFlatten(e.target.checked)}
                />
                <span>Mild curve flatten</span>
              </label>
            </>
          ) : null}
        </div>

        {cameraOn ? (
          <div className="scan-camera-stage">
            <div className="scan-video-wrap">
              <video ref={videoRef} playsInline muted autoPlay className="scan-video" />
              <svg
                ref={overlayRef}
                className="scan-edge-overlay"
                viewBox={`0 0 ${videoSize.w} ${videoSize.h}`}
                preserveAspectRatio="none"
                aria-hidden
              >
                {outlinePoints ? (
                  <>
                    <polygon
                      points={outlinePoints}
                      className={edgeLocked ? "scan-edge-poly is-locked" : "scan-edge-poly"}
                    />
                    {liveCorners
                      ? liveCorners.map((corner, index) => (
                          <circle
                            key={index}
                            cx={corner.x}
                            cy={corner.y}
                            r={Math.max(videoSize.w, videoSize.h) * 0.012}
                            className={edgeLocked ? "scan-edge-corner is-locked" : "scan-edge-corner"}
                          />
                        ))
                      : null}
                    {mode === "book" && liveCorners ? (
                      <line
                        x1={(liveCorners[0].x + liveCorners[1].x) / 2}
                        y1={(liveCorners[0].y + liveCorners[1].y) / 2}
                        x2={(liveCorners[3].x + liveCorners[2].x) / 2}
                        y2={(liveCorners[3].y + liveCorners[2].y) / 2}
                        className="scan-spine-line"
                      />
                    ) : null}
                  </>
                ) : (
                  <rect
                    x={videoSize.w * 0.1}
                    y={videoSize.h * 0.12}
                    width={videoSize.w * 0.8}
                    height={videoSize.h * 0.76}
                    className="scan-edge-guide"
                  />
                )}
              </svg>
              {flash ? <div className="scan-flash" aria-hidden /> : null}
              <div className="scan-camera-hint">
                {mode === "book" ? "Book" : "Document"} · Page {pages.length + 1}
                {autoScan ? (edgeLocked ? " · Auto ready" : " · Hold steady…") : " · Align edges"}
              </div>
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
                Pause
              </button>
            </div>
          </div>
        ) : (
          <div className="scan-start-panel scan-resume-panel">
            <button
              className="merge-button scan-primary-cta"
              type="button"
              onClick={() => void startCamera()}
              disabled={busy}
            >
              {pages.length ? "Continue scanning" : "Start camera"}
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
              Camera-first scan: live edge outline, shutter, then a compact page strip. Auto Scan captures when
              edges stay steady.
              {!secureOk ? " Camera needs HTTPS; gallery still works." : null}
            </p>
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
              <span>Compact strip · tap to adjust edges · camera stays above</span>
            </div>
            <ol className="scan-page-strip is-compact">
              {pages.map((page, index) => (
                <li key={page.id} className="scan-page-card is-compact">
                  <button
                    type="button"
                    className="scan-page-thumb"
                    onClick={() => void openAdjust(page)}
                    aria-label={`Adjust page ${index + 1}`}
                  >
                    <img src={page.preview} alt={`Page ${index + 1}`} />
                    <span className="scan-page-num">{index + 1}</span>
                  </button>
                  <div className="scan-page-actions is-compact">
                    <button type="button" className="text-button" onClick={() => movePage(page.id, -1)} disabled={index === 0} aria-label="Move left">
                      ←
                    </button>
                    <button type="button" className="text-button" onClick={() => removePage(page.id)} aria-label={`Delete page ${index + 1}`}>
                      ✕
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => movePage(page.id, 1)}
                      disabled={index === pages.length - 1}
                      aria-label="Move right"
                    >
                      →
                    </button>
                  </div>
                </li>
              ))}
            </ol>

            <div className="organise-action-row scan-save-row">
              <div>
                <strong>Ready to save</strong>
                <span>Multi-page PDF on this device — then open OCR / AI Summary if you need text</span>
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
            Point the camera at a page — yellow/green outline shows edges. Tap the shutter (or Auto Scan).
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
              <strong>Drag corners to the document edges</strong>
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
