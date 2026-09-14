"use client";

import { useEffect, useId, useRef, useState } from "react";
import MaterialIcon from "@/components/MaterialIcon";
import {
  chooseOpenFileTool,
  clearOpenFilePending,
  subscribeOpenFilePending,
  type OpenFilePending,
} from "@/lib/open-file-handoff";

type ToolChoice = {
  label: string;
  icon: string;
  path: string;
  group: "fast" | "more";
};

const PDF_TOOLS: ToolChoice[] = [
  { label: "Merge", icon: "call_merge", path: "/pdf-tools/merge", group: "fast" },
  { label: "Compress", icon: "compress", path: "/pdf-tools/compress", group: "fast" },
  { label: "Split", icon: "content_cut", path: "/pdf-tools/split", group: "fast" },
  { label: "PDF to Images", icon: "image", path: "/pdf-tools/pdf-to-images", group: "fast" },
  { label: "PDF to Word", icon: "description", path: "/pdf-tools/pdf-to-word", group: "fast" },
  { label: "Sign", icon: "draw", path: "/pdf-tools/sign", group: "fast" },
  { label: "OCR", icon: "document_scanner", path: "/pdf-tools/pdf-to-text", group: "fast" },
  { label: "Edit", icon: "edit_note", path: "/pdf-tools/edit", group: "more" },
  { label: "Organise", icon: "grid_view", path: "/pdf-tools/organise", group: "more" },
  { label: "Scan to PDF", icon: "photo_camera", path: "/pdf-tools/scan-to-pdf", group: "more" },
  { label: "Bates", icon: "pin", path: "/pdf-tools/bates", group: "more" },
  { label: "N-up", icon: "dashboard", path: "/pdf-tools/n-up", group: "more" },
  { label: "Flatten", icon: "layers_clear", path: "/pdf-tools/flatten", group: "more" },
  { label: "Unlock", icon: "lock_open", path: "/pdf-tools/unlock", group: "more" },
  { label: "AI Summary", icon: "auto_awesome", path: "/pdf-tools/ai-summary", group: "more" },
];

/**
 * Global open-file tool picker. Listens to openFileIntoDearPdf() pending state
 * so home dropzone and header Open File share one calm Ruby-styled sheet.
 */
export default function OpenFilePicker() {
  const [pending, setPending] = useState<OpenFilePending | null>(null);
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => subscribeOpenFilePending(setPending), []);

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        clearOpenFilePending();
      }
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [pending]);

  if (!pending) return null;

  const isImage = pending.kind === "image";
  const fast = PDF_TOOLS.filter((t) => t.group === "fast");
  const more = PDF_TOOLS.filter((t) => t.group === "more");

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center"
      role="presentation"
    >
      <button
        type="button"
        aria-label="Dismiss tool picker"
        className="absolute inset-0 bg-tech-black/40 backdrop-blur-[2px]"
        onClick={() => clearOpenFilePending()}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 flex max-h-[min(92vh,720px)] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-brand-200 bg-white shadow-2xl sm:mx-4 sm:rounded-3xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border-subtle px-5 py-4">
          <div className="min-w-0">
            <p className="mb-1 font-mono text-[11px] font-semibold uppercase tracking-wider text-primary-container">
              File stays on this device
            </p>
            <h2 id={titleId} className="text-lg font-bold tracking-tight text-on-surface">
              What do you want to do?
            </h2>
            <p className="mt-1 truncate text-sm text-slate-500" title={pending.name}>
              {pending.name}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={() => clearOpenFilePending()}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-500 transition hover:border-brand-300 hover:bg-rose-subtle hover:text-primary-container"
            aria-label="Cancel"
          >
            <MaterialIcon name="close" className="text-[20px]" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          {isImage ? (
            <div className="space-y-3">
              <p className="text-sm text-slate-600">
                This looks like an image. Convert it into a PDF locally.
              </p>
              <button
                type="button"
                onClick={() => chooseOpenFileTool("/pdf-tools/images-to-pdf")}
                className="flex w-full items-center gap-3 rounded-2xl border border-brand-300 bg-rose-subtle px-4 py-3.5 text-left transition hover:border-primary-container hover:bg-primary-container hover:text-white group"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-brand-200 bg-white text-primary-container group-hover:border-white/30 group-hover:bg-white/15 group-hover:text-white">
                  <MaterialIcon name="photo_library" className="text-[22px]" />
                </span>
                <span>
                  <span className="block text-sm font-semibold">Images to PDF</span>
                  <span className="block text-[12px] opacity-80">JPG, PNG, or WebP → one PDF</span>
                </span>
              </button>
            </div>
          ) : (
            <div className="space-y-5">
              <div>
                <p className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-secondary">
                  Fast Actions
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {fast.map((tool) => (
                    <button
                      key={tool.path}
                      type="button"
                      onClick={() => chooseOpenFileTool(tool.path)}
                      className="flex flex-col items-center justify-center gap-1.5 rounded-2xl border border-slate-200 bg-slate-50/80 px-2 py-3 text-center transition hover:-translate-y-0.5 hover:border-brand-300 hover:bg-rose-subtle hover:shadow-sm sm:flex-row sm:justify-start sm:gap-2 sm:px-3 sm:text-left"
                    >
                      <MaterialIcon
                        name={tool.icon}
                        className="shrink-0 text-[22px] text-primary-container sm:text-[18px]"
                      />
                      <span className="text-[13px] font-medium text-on-surface">{tool.label}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-secondary">
                  More tools
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {more.map((tool) => (
                    <button
                      key={tool.path}
                      type="button"
                      onClick={() => chooseOpenFileTool(tool.path)}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200/80 bg-white px-3 py-2.5 text-left text-[13px] font-medium text-on-surface transition hover:border-brand-300 hover:bg-rose-subtle hover:text-primary-container"
                    >
                      <MaterialIcon name={tool.icon} className="shrink-0 text-[18px] text-primary-container" />
                      {tool.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-border-subtle px-5 py-3">
          <button
            type="button"
            onClick={() => clearOpenFilePending()}
            className="w-full rounded-xl px-3 py-2.5 text-sm font-medium text-slate-500 transition hover:bg-slate-50 hover:text-on-surface"
          >
            Cancel — keep file for later
          </button>
        </div>
      </div>
    </div>
  );
}
