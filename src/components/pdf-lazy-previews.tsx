"use client";

import { useCallback, useRef, useState } from "react";
import { renderPdfPageThumbnails, type PdfVisualPage } from "./pdf-page-workspace";

export type PdfPreviewState = "hidden" | "loading" | "ready";

export function usePdfLazyPreviews(idPrefix: string, options?: { maxWidth?: number }) {
  const [pages, setPages] = useState<PdfVisualPage[]>([]);
  const [previewState, setPreviewState] = useState<PdfPreviewState>("hidden");
  const [previewProgress, setPreviewProgress] = useState("");
  const requestRef = useRef(0);

  const resetPreviews = useCallback(() => {
    requestRef.current += 1;
    setPages([]);
    setPreviewState("hidden");
    setPreviewProgress("");
  }, []);

  const hidePreviews = useCallback(() => {
    requestRef.current += 1;
    setPages([]);
    setPreviewState("hidden");
    setPreviewProgress("");
  }, []);

  const loadPreviews = useCallback(async (bytes: ArrayBuffer) => {
    const request = requestRef.current + 1;
    requestRef.current = request;
    setPreviewState("loading");
    setPreviewProgress("Loading page previews…");
    try {
      const thumbnails = await renderPdfPageThumbnails(
        bytes,
        idPrefix,
        undefined,
        (page, total) => {
          if (requestRef.current === request) {
            setPreviewProgress(`Loading preview ${page} of ${total}…`);
          }
        },
        options?.maxWidth,
      );
      if (requestRef.current !== request) return false;
      setPages(thumbnails);
      setPreviewState("ready");
      setPreviewProgress("");
      return true;
    } catch (error) {
      if (requestRef.current !== request) return false;
      setPages([]);
      setPreviewState("hidden");
      setPreviewProgress("");
      throw error;
    }
  }, [idPrefix, options?.maxWidth]);

  return { pages, setPages, previewState, previewProgress, loadPreviews, hidePreviews, resetPreviews };
}

export function PdfLazyPreviewControls({
  previewState,
  onShow,
  onHide,
  disabled,
}: {
  previewState: PdfPreviewState;
  onShow: () => void;
  onHide: () => void;
  disabled?: boolean;
}) {
  if (previewState === "ready") {
    return (
      <button className="text-button" type="button" onClick={onHide} disabled={disabled}>
        Hide page previews
      </button>
    );
  }
  return (
    <button
      className="text-button"
      type="button"
      onClick={onShow}
      disabled={disabled || previewState === "loading"}
    >
      {previewState === "loading" ? "Loading previews…" : "Show page previews"}
    </button>
  );
}

export function PdfLazyPreviewStatus({
  previewState,
  previewProgress,
}: {
  previewState: PdfPreviewState;
  previewProgress: string;
}) {
  if (previewState !== "loading") return null;
  return (
    <p className="pdf-work-message reading" role="status">
      {previewProgress || "Loading page previews…"}
    </p>
  );
}
