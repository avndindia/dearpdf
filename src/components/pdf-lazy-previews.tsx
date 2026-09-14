"use client";

import { useCallback, useRef, useState } from "react";
import {
  makePendingPdfPages,
  renderPdfPageThumbnails,
  type PdfVisualPage,
} from "./pdf-page-workspace";

export type PdfPreviewState = "hidden" | "loading" | "ready";

export type LoadPreviewOptions = {
  /** Prefer rendering these 0-based page indexes first (selected / visible). */
  priorityIndexes?: number[];
  /** Known page count — enables immediate skeleton cards before first paint. */
  pageCount?: number;
};

const BATCH_YIELD = 4;

function orderPageIndexes(pageCount: number, priorityIndexes?: number[]) {
  const all = Array.from({ length: pageCount }, (_, index) => index);
  if (!priorityIndexes?.length) return all;
  const seen = new Set<number>();
  const ordered: number[] = [];
  for (const index of priorityIndexes) {
    if (index >= 0 && index < pageCount && !seen.has(index)) {
      seen.add(index);
      ordered.push(index);
    }
  }
  for (const index of all) {
    if (!seen.has(index)) ordered.push(index);
  }
  return ordered;
}

export function usePdfLazyPreviews(idPrefix: string, options?: { maxWidth?: number }) {
  const [pages, setPages] = useState<PdfVisualPage[]>([]);
  const [previewState, setPreviewState] = useState<PdfPreviewState>("hidden");
  const [previewProgress, setPreviewProgress] = useState("");
  const requestRef = useRef(0);
  const pagesRef = useRef<PdfVisualPage[]>([]);
  pagesRef.current = pages;

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

  const loadPreviews = useCallback(async (bytes: ArrayBuffer, loadOptions?: LoadPreviewOptions) => {
    const request = requestRef.current + 1;
    requestRef.current = request;
    setPreviewState("loading");
    setPreviewProgress("Loading page previews…");

    try {
      // Inspect page count quickly via pdf.js for skeletons when not provided.
      let pageCount = loadOptions?.pageCount ?? 0;
      if (!pageCount) {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const task = pdfjs.getDocument({
          data: Uint8Array.from(new Uint8Array(bytes)),
          disableFontFace: true,
          useSystemFonts: true,
        });
        try {
          const pdf = await task.promise;
          pageCount = pdf.numPages;
        } finally {
          await task.destroy();
        }
      }
      if (requestRef.current !== request) return false;

      const skeletons = makePendingPdfPages(pageCount, idPrefix);
      setPages(skeletons);
      pagesRef.current = skeletons;
      // Show workspace immediately so selected pages are never blank forever.
      setPreviewState("ready");
      setPreviewProgress(pageCount > 1 ? `Loading preview 0 of ${pageCount}…` : "Loading page previews…");

      const ordered = orderPageIndexes(pageCount, loadOptions?.priorityIndexes);
      const byIndex = new Map<number, PdfVisualPage>(skeletons.map((page) => [page.pageIndex, page]));

      await renderPdfPageThumbnails(
        bytes,
        idPrefix,
        undefined,
        (done, total) => {
          if (requestRef.current === request) {
            setPreviewProgress(`Loading preview ${done} of ${total}…`);
          }
        },
        options?.maxWidth,
        ordered,
        (page, done, total) => {
          if (requestRef.current !== request) return;
          byIndex.set(page.pageIndex, page);
          // Update in document order so list stays stable.
          const next = Array.from({ length: pageCount }, (_, index) => byIndex.get(index)!);
          pagesRef.current = next;
          // Batch UI updates so Safari is not flooded with 138 setStates.
          if (done === total || done <= 8 || done % BATCH_YIELD === 0) {
            setPages(next);
          }
        },
      );

      if (requestRef.current !== request) return false;
      const finalPages = Array.from({ length: pageCount }, (_, index) => byIndex.get(index)!);
      setPages(finalPages);
      pagesRef.current = finalPages;
      setPreviewState("ready");
      setPreviewProgress("");
      return true;
    } catch (error) {
      if (requestRef.current !== request) return false;
      // Keep any skeletons that already have images; mark the rest failed.
      setPages((current) =>
        current.length
          ? current.map((page) =>
              page.previewStatus === "ready" && page.thumbnail
                ? page
                : { ...page, thumbnail: "", previewStatus: "failed" as const },
            )
          : [],
      );
      setPreviewState("ready");
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
  if (!previewProgress) return null;
  if (previewState !== "loading" && previewState !== "ready") return null;
  return (
    <p className="pdf-work-message reading" role="status">
      {previewProgress || "Loading page previews…"}
    </p>
  );
}
