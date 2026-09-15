"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import MaterialIcon from "@/components/MaterialIcon";
import { dismissPdfToolCompletion } from "@/lib/browser-download";
import {
  stitchCategories,
  stitchTools,
  type StitchTool,
} from "@/lib/stitch-tools";

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
  "ai-summary": "Summary",
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

/** Everyday tools — first glance, like DearColleague quicklinks. */
const PRIMARY_IDS = ["merge", "compress", "split", "sign", "pdf-to-text", "pdf-to-word"] as const;

/** Next-most-used batch after the first Show more. */
const SECONDARY_IDS = [
  "organise",
  "edit",
  "scan-to-pdf",
  "images-to-pdf",
  "unlock",
  "watermark",
  "rotate",
  "crop",
] as const;

function toolById(id: string) {
  return stitchTools.find((tool) => tool.id === id);
}

function shortLabel(tool: StitchTool) {
  return SHORT_LABEL[tool.id] ?? tool.name.replace(/\s*PDF\s*/gi, " ").trim();
}

function chipClass(active: boolean) {
  return active
    ? "inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-sky-600/30 bg-sky-700 px-2.5 text-[12px] font-semibold text-white shadow-sm dark:border-sky-400/40 dark:bg-sky-500 dark:text-slate-950"
    : "inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-border-subtle bg-surface-slate px-2.5 text-[12px] font-semibold text-slate-600 transition-colors hover:border-sky-300 hover:bg-sky-50 hover:text-sky-800 dark:border-[#1f2a3f] dark:bg-[#151c2d] dark:text-slate-300 dark:hover:border-sky-500/40 dark:hover:bg-[#1f2a3f] dark:hover:text-sky-300";
}

function ToolChip({
  tool,
  pathname,
}: {
  tool: StitchTool;
  pathname: string;
}) {
  const active = pathname === tool.href || pathname.startsWith(`${tool.href}/`);
  return (
    <Link
      href={tool.href}
      onClick={() => dismissPdfToolCompletion()}
      aria-current={active ? "page" : undefined}
      title={tool.name}
      className={chipClass(active)}
    >
      <MaterialIcon name={tool.icon} className="text-[16px] leading-none" />
      <span className="whitespace-nowrap">{shortLabel(tool)}</span>
    </Link>
  );
}

/**
 * Floating tool chips on inner pages (DearColleague-style pills, docked at the bottom).
 * Hidden on home (the directory already lists every tool) and /admin.
 * Sets --tool-chip-bar-offset so PDF-ready + sticky CTAs stack above it.
 */
export default function ToolChipBar() {
  const pathname = usePathname() || "/";
  const hide = pathname === "/" || pathname.startsWith("/admin");
  const [level, setLevel] = useState<0 | 1 | 2>(0);
  const barRef = useRef<HTMLElement>(null);

  const primary = useMemo(
    () => PRIMARY_IDS.map(toolById).filter((tool): tool is StitchTool => Boolean(tool)),
    [],
  );
  const secondary = useMemo(
    () => SECONDARY_IDS.map(toolById).filter((tool): tool is StitchTool => Boolean(tool)),
    [],
  );
  const shownIds = useMemo(() => {
    const ids = new Set<string>(PRIMARY_IDS);
    if (level >= 1) for (const id of SECONDARY_IDS) ids.add(id);
    return ids;
  }, [level]);
  const groupedRest = useMemo(
    () =>
      stitchCategories
        .map((group) => ({
          ...group,
          tools: stitchTools.filter((tool) => tool.category === group.id && !shownIds.has(tool.id)),
        }))
        .filter((group) => group.tools.length > 0),
    [shownIds],
  );

  useEffect(() => {
    setLevel(0);
  }, [pathname]);

  useEffect(() => {
    if (hide) {
      document.documentElement.classList.remove("has-tool-chip-bar");
      document.documentElement.style.removeProperty("--tool-chip-bar-offset");
      return;
    }
    document.documentElement.classList.add("has-tool-chip-bar");
    const el = barRef.current;
    const apply = () => {
      const height = el?.getBoundingClientRect().height ?? 56;
      document.documentElement.style.setProperty("--tool-chip-bar-offset", `${Math.ceil(height)}px`);
    };
    apply();
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => {
      observer.disconnect();
      document.documentElement.classList.remove("has-tool-chip-bar");
      document.documentElement.style.removeProperty("--tool-chip-bar-offset");
    };
  }, [hide, level]);

  useEffect(() => {
    if (level === 0) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLevel(0);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [level]);

  if (hide) return null;

  const moreLabel = level === 0 ? "Show more" : level === 1 ? "Show more" : "Show less";

  return (
    <nav
      ref={barRef}
      aria-label="Quick PDF tools"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex justify-center px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-1"
    >
      <div className="pointer-events-auto w-full max-w-xl rounded-2xl border border-border-subtle bg-white/95 shadow-[0_8px_28px_rgba(15,23,42,0.12)] backdrop-blur-md dark:border-[#1f2a3f]/80 dark:bg-[#0a0e17]/92 dark:shadow-[0_8px_32px_rgba(0,0,0,0.45)]">
        <div className="flex flex-wrap items-center gap-1.5 px-2.5 py-2">
          {primary.map((tool) => (
            <ToolChip key={tool.id} tool={tool} pathname={pathname} />
          ))}
          {level >= 1
            ? secondary.map((tool) => <ToolChip key={tool.id} tool={tool} pathname={pathname} />)
            : null}
          <button
            type="button"
            aria-expanded={level > 0}
            aria-controls="tool-chip-more"
            onClick={() => setLevel((current) => (current === 0 ? 1 : current === 1 ? 2 : 0))}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2.5 text-[12px] font-semibold text-sky-800 transition-colors hover:border-sky-300 hover:bg-sky-100 dark:border-sky-500/30 dark:bg-sky-950/70 dark:text-sky-300 dark:hover:border-sky-400/50 dark:hover:bg-sky-950"
          >
            <MaterialIcon
              name={level === 2 ? "expand_less" : "expand_more"}
              className="text-[16px] leading-none"
            />
            <span className="whitespace-nowrap">{moreLabel}</span>
          </button>
        </div>

        {level === 2 && groupedRest.length > 0 ? (
          <div
            id="tool-chip-more"
            className="max-h-[min(32vh,260px)] space-y-2.5 overflow-y-auto border-t border-border-subtle px-2.5 py-2.5 dark:border-[#1f2a3f]/80"
          >
            {groupedRest.map((group) => (
              <section key={group.id} aria-label={group.title}>
                <h2 className="mb-1.5 px-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  {group.title}
                </h2>
                <div className="flex flex-wrap items-center gap-1.5">
                  {group.tools.map((tool) => (
                    <ToolChip key={tool.id} tool={tool} pathname={pathname} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : null}
      </div>
    </nav>
  );
}
