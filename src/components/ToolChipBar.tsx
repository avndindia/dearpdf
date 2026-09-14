"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo } from "react";
import MaterialIcon from "@/components/MaterialIcon";
import { dismissPdfToolCompletion } from "@/lib/browser-download";
import { stitchTools, type StitchTool } from "@/lib/stitch-tools";

/** Compact chip labels — icons carry recognition. */
const SHORT_LABEL: Record<string, string> = {
  merge: "Merge",
  split: "Split",
  organise: "Organise",
  rotate: "Rotate",
  flip: "Flip",
  "n-up": "N-up",
  bates: "Bates",
  compress: "Compress",
  "page-numbers": "Numbers",
  crop: "Crop",
  edit: "Edit",
  sign: "Sign",
  watermark: "Watermark",
  metadata: "Metadata",
  flatten: "Flatten",
  "pdf-to-text": "OCR",
  "ai-summary": "AI Summary",
  "pdf-to-word": "Word",
  "images-to-pdf": "Img→PDF",
  "pdf-to-images": "PDF→Img",
  "scan-to-pdf": "Scan",
  "pdf-to-handwriting": "Handwrite",
  grayscale: "Grayscale",
  repair: "Repair",
  unlock: "Unlock",
  lock: "Lock",
};

/** Chip row content height (excludes safe-area inset). */
const CHIP_ROW_PX = 48;

function orderedTools(): StitchTool[] {
  const popular: StitchTool[] = [];
  const rest: StitchTool[] = [];
  for (const tool of stitchTools) {
    if (tool.badgeTone === "popular") popular.push(tool);
    else rest.push(tool);
  }
  return [...popular, ...rest];
}

function shortLabel(tool: StitchTool) {
  return SHORT_LABEL[tool.id] ?? tool.name.replace(/\s*PDF\s*/gi, " ").trim();
}

/**
 * Site-wide floating tool chips. Hidden on /admin.
 * Sets --tool-chip-bar-offset so PDF-ready + sticky CTAs stack above it.
 */
export default function ToolChipBar() {
  const pathname = usePathname() || "/";
  const tools = useMemo(() => orderedTools(), []);
  const hide = pathname.startsWith("/admin");

  useEffect(() => {
    if (hide) {
      document.documentElement.classList.remove("has-tool-chip-bar");
      document.documentElement.style.removeProperty("--tool-chip-bar-offset");
      return;
    }
    document.documentElement.classList.add("has-tool-chip-bar");
    document.documentElement.style.setProperty(
      "--tool-chip-bar-offset",
      `calc(${CHIP_ROW_PX}px + env(safe-area-inset-bottom, 0px))`,
    );
    return () => {
      document.documentElement.classList.remove("has-tool-chip-bar");
      document.documentElement.style.removeProperty("--tool-chip-bar-offset");
    };
  }, [hide]);

  if (hide) return null;

  return (
    <nav
      aria-label="PDF tools"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[40] pb-[env(safe-area-inset-bottom,0px)]"
    >
      <div className="pointer-events-auto border-t border-border-subtle bg-white/95 shadow-[0_-4px_20px_rgba(15,23,42,0.08)] backdrop-blur-md dark:border-[#1f2a3f]/80 dark:bg-[#0a0e17]/92 dark:shadow-[0_-4px_24px_rgba(0,0,0,0.45)]">
        <div
          className="mx-auto flex max-w-7xl items-center gap-1.5 overflow-x-auto px-3 [scrollbar-width:none] sm:px-4 [&::-webkit-scrollbar]:hidden"
          style={{ height: CHIP_ROW_PX }}
        >
          {tools.map((tool) => {
            const active =
              pathname === tool.href || pathname.startsWith(`${tool.href}/`);
            return (
              <Link
                key={tool.id}
                href={tool.href}
                onClick={() => dismissPdfToolCompletion()}
                aria-current={active ? "page" : undefined}
                title={tool.name}
                className={
                  active
                    ? "inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-sky-600/30 bg-sky-700 px-2.5 text-[12px] font-semibold text-white shadow-sm dark:border-sky-400/40 dark:bg-sky-500 dark:text-slate-950"
                    : "inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-border-subtle bg-surface-slate px-2.5 text-[12px] font-semibold text-slate-600 transition-colors hover:border-sky-300 hover:bg-sky-50 hover:text-sky-800 dark:border-[#1f2a3f] dark:bg-[#151c2d] dark:text-slate-300 dark:hover:border-sky-500/40 dark:hover:bg-[#1f2a3f] dark:hover:text-sky-300"
                }
              >
                <MaterialIcon name={tool.icon} className="text-[16px] leading-none" />
                <span className="whitespace-nowrap">{shortLabel(tool)}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
