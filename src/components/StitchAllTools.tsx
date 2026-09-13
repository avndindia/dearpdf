"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import MaterialIcon from "@/components/MaterialIcon";
import {
  STITCH_TOOL_COUNT,
  stitchCategories,
  stitchTools,
  type StitchBadgeTone,
  type StitchCategoryId,
} from "@/lib/stitch-tools";

type CategoryFilter = "all" | StitchCategoryId;

const FILTERS: { id: CategoryFilter; label: string; count: number }[] = [
  { id: "all", label: "All", count: STITCH_TOOL_COUNT },
  { id: "assemble", label: "Assemble", count: 6 },
  { id: "edit", label: "Edit & Sign", count: 5 },
  { id: "convert", label: "Convert", count: 5 },
  { id: "secure", label: "Security & Repair", count: 3 },
];

function badgeClass(tone: StitchBadgeTone) {
  switch (tone) {
    case "popular":
    case "secondary":
    case "emerald":
      return "bg-secondary-container text-on-secondary-fixed font-semibold";
    case "tertiary":
      return "bg-tertiary-fixed text-on-tertiary-fixed font-medium";
    case "primaryFixed":
    case "brand":
      return "bg-primary-fixed text-on-primary-fixed-variant font-semibold";
    case "amber":
      return "bg-secondary-container text-on-secondary-fixed font-semibold";
    default:
      return "bg-surface-container text-on-surface-variant";
  }
}

export default function StitchAllTools() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/") return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return stitchTools.filter((tool) => {
      if (category !== "all" && tool.category !== category) return false;
      if (!q) return true;
      return (
        tool.searchText.toLowerCase().includes(q) ||
        tool.name.toLowerCase().includes(q) ||
        tool.description.toLowerCase().includes(q) ||
        tool.footer.toLowerCase().includes(q) ||
        tool.tag.toLowerCase().includes(q) ||
        tool.badge.toLowerCase().includes(q)
      );
    });
  }, [query, category]);

  const grouped = useMemo(
    () =>
      stitchCategories
        .map((group) => ({
          ...group,
          tools: filtered.filter((t) => t.category === group.id),
        }))
        .filter((g) => g.tools.length > 0),
    [filtered],
  );

  const resetSearch = () => {
    setQuery("");
    setCategory("all");
    searchRef.current?.focus();
  };

  return (
    <div className="flex w-full flex-col bg-surface text-on-surface">
      {/* Command Header & Search Strip */}
      <div className="w-full border-b border-outline-variant/30 bg-surface-container-lowest px-space-xl py-space-xl md:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-space-lg">
          <div className="flex items-center justify-between">
            <Link
              href="/"
              className="group inline-flex items-center gap-1.5 font-label-md text-label-md text-on-surface-variant transition-colors hover:text-primary"
            >
              <MaterialIcon
                name="arrow_back"
                className="text-[14px] transition-transform group-hover:-translate-x-0.5"
              />
              <span>Back to DearPDF home</span>
            </Link>
            <div className="flex items-center gap-space-sm font-label-sm text-label-sm text-on-surface-variant">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
              <span>Nothing uploaded</span>
            </div>
          </div>

          <div className="flex flex-col justify-between gap-space-md pt-space-xs md:flex-row md:items-end">
            <div className="flex max-w-3xl flex-col gap-1">
              <div className="flex flex-wrap items-center gap-space-md">
                <h1 className="font-headline-lg text-headline-lg tracking-tight text-on-surface">
                  All PDF Tools
                </h1>
                <span className="rounded-full bg-secondary-container px-space-md py-0.5 font-label-sm text-label-sm text-on-secondary-fixed">
                  {STITCH_TOOL_COUNT} Utilities Available
                </span>
                <span className="rounded-full bg-surface-container px-space-md py-0.5 font-label-sm text-label-sm text-on-surface-variant">
                  Nothing uploaded
                </span>
              </div>
              <p className="font-body-md text-body-md leading-relaxed text-on-surface-variant">
                Every tool runs in your browser. Your documents stay on this device
                and are never sent to our servers. Works offline after the first visit.
              </p>
            </div>

            <div className="hidden shrink-0 items-center gap-3 rounded border border-outline-variant/30 bg-surface-container-low px-space-lg py-space-sm font-label-sm text-label-sm lg:flex">
              <div className="flex flex-col items-start">
                <span className="text-[10px] font-semibold uppercase text-on-surface-variant">
                  Privacy
                </span>
                <span className="font-semibold text-primary">On this device</span>
              </div>
              <div className="h-6 w-px bg-outline-variant/40" />
              <div className="flex flex-col items-start">
                <span className="text-[10px] font-semibold uppercase text-on-surface-variant">
                  Uploads
                </span>
                <span className="font-semibold text-emerald-600">None</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col items-stretch justify-between gap-space-md pt-space-xs md:flex-row md:items-center">
            <div className="relative max-w-xl flex-1">
              <MaterialIcon
                name="search"
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant"
              />
              <input
                ref={searchRef}
                id="tool-search"
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Filter ${STITCH_TOOL_COUNT} tools (e.g. merge, compress, ocr, split)...`}
                className="h-9 w-full rounded border border-outline-variant/60 bg-surface pl-9 pr-12 font-body-sm text-body-sm text-on-surface shadow-sm transition-all placeholder:text-on-surface-variant/60 focus:border-primary focus:bg-surface-container-lowest focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <div className="pointer-events-none absolute right-2.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
                <kbd className="rounded border border-outline-variant/40 bg-surface-container-high px-1.5 py-0.5 font-mono text-[10px] text-on-surface-variant">
                  /
                </kbd>
              </div>
            </div>

            <div className="no-scrollbar flex shrink-0 items-center gap-1 overflow-x-auto pb-1 md:pb-0">
              {FILTERS.map((btn) => {
                const active = category === btn.id;
                return (
                  <button
                    key={btn.id}
                    type="button"
                    onClick={() => setCategory(btn.id)}
                    className={
                      active
                        ? "rounded bg-primary-container px-space-md py-1 font-label-md text-label-md text-on-primary transition-all"
                        : "rounded bg-surface-container px-space-md py-1 font-label-md text-label-md text-on-surface-variant transition-all hover:bg-surface-container-high hover:text-on-surface"
                    }
                  >
                    {btn.label} ({btn.count})
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Main Tools Grid */}
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-space-xl py-space-xl md:px-8">
        {grouped.map((group) => (
          <section key={group.id} className="flex flex-col gap-space-md" data-category={group.id}>
            <div className="flex items-center justify-between border-b border-outline-variant/30 pb-2">
              <div className="flex items-baseline gap-2">
                <span className="font-label-sm text-label-sm font-bold uppercase tracking-wider text-primary">
                  {group.index}
                </span>
                <h2 className="font-headline-sm text-headline-sm uppercase tracking-tight text-on-surface">
                  {group.title}
                </h2>
                <span className="font-body-sm text-body-sm text-outline-variant">·</span>
                <span className="font-body-sm text-body-sm text-on-surface-variant">
                  {group.blurb}
                </span>
              </div>
              <span className="rounded bg-surface-container-low px-2 py-0.5 font-mono font-label-sm text-label-sm text-on-surface-variant">
                {group.tools.length} tools
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.tools.map((tool) => (
                <Link
                  key={tool.id}
                  href={tool.href}
                  prefetch={false}
                  className="group flex flex-col justify-between gap-3 rounded border border-outline-variant/40 bg-surface-container-lowest p-3.5 transition-all hover:border-primary/60 hover:shadow-md"
                >
                  <div className="flex flex-col gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded bg-primary-fixed/30 text-primary transition-colors group-hover:bg-primary group-hover:text-on-primary">
                        <MaterialIcon name={tool.icon} className="text-[20px]" />
                      </div>
                      <span
                        className={`rounded px-1.5 py-0.5 font-label-sm text-[10px] ${badgeClass(
                          tool.badgeTone,
                        )}`}
                      >
                        {tool.badge}
                      </span>
                    </div>
                    <div>
                      <div className="flex items-center justify-between">
                        <h3 className="font-headline-sm text-headline-sm text-on-surface transition-colors group-hover:text-primary">
                          {tool.name}
                        </h3>
                        <MaterialIcon
                          name="arrow_forward"
                          className="text-[16px] text-on-surface-variant transition-all group-hover:translate-x-0.5 group-hover:text-primary"
                        />
                      </div>
                      <p className="mt-1 line-clamp-2 font-body-sm text-body-sm text-on-surface-variant">
                        {tool.description}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between border-t border-outline-variant/20 pt-2 font-label-sm text-[11px] text-on-surface-variant">
                    <span className="font-mono text-[10px] text-tertiary">{tool.footer}</span>
                    <span className="rounded bg-surface-container px-1.5 py-0.5 font-mono text-[10px]">
                      {tool.tag}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ))}

        {grouped.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-space-md rounded border border-outline-variant/30 bg-surface-container-lowest py-16 text-center">
            <MaterialIcon name="search_off" className="text-4xl text-on-surface-variant" />
            <div className="flex flex-col gap-1">
              <h3 className="font-headline-sm text-headline-sm text-on-surface">
                No matching PDF utilities
              </h3>
              <p className="font-body-sm text-body-sm text-on-surface-variant">
                Try searching for alternative keywords like &quot;watermark&quot;,
                &quot;split&quot;, &quot;word&quot;, or &quot;sign&quot;.
              </p>
            </div>
            <button
              type="button"
              onClick={resetSearch}
              className="rounded bg-surface-container px-space-md py-1 font-label-md text-label-md text-on-surface transition-colors hover:bg-surface-container-high"
            >
              Reset Search Filter
            </button>
          </div>
        ) : null}

        {/* Official Document Notice */}
        <div className="mt-2 flex w-full flex-col items-start justify-between gap-4 rounded border border-outline-variant/40 bg-surface-container-low p-4 md:flex-row md:items-center md:p-5">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded bg-surface-container-highest">
              <MaterialIcon name="verified_user" className="text-[18px] text-tertiary" />
            </div>
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <span className="font-label-sm text-label-sm font-semibold uppercase tracking-wider text-on-surface">
                  Official Document Notice
                </span>
                <span className="h-1.5 w-1.5 rounded-full bg-outline-variant" />
                <span className="font-label-sm text-label-sm text-on-surface-variant">
                  Files stay here
                </span>
              </div>
              <p className="max-w-3xl font-body-sm text-body-sm leading-normal text-on-surface-variant">
                For important documents, always open the downloaded result before
                sharing. Editing, OCR, and password tools all run on this device —
                your file is not uploaded.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center justify-end gap-2 self-stretch border-t border-outline-variant/30 pt-2 md:self-auto md:border-t-0 md:pt-0">
            <div className="flex items-center gap-1.5 rounded border border-outline-variant/30 bg-surface-container-lowest px-2.5 py-1 font-label-sm text-label-sm text-on-surface-variant">
              <MaterialIcon name="dns" className="text-[14px] text-emerald-600" />
              <span className="font-medium">Nothing uploaded</span>
            </div>
            <div className="flex items-center gap-1.5 rounded border border-outline-variant/30 bg-surface-container-lowest px-2.5 py-1 font-label-sm text-label-sm text-on-surface-variant">
              <MaterialIcon name="offline_bolt" className="text-[14px] text-primary" />
              <span className="font-medium">Works offline</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
