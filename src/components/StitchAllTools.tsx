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
  { id: "convert", label: "Convert", count: 6 },
  { id: "secure", label: "Security", count: 3 },
];

function badgeClass(tone: StitchBadgeTone) {
  switch (tone) {
    case "popular":
    case "brand":
    case "primaryFixed":
      return "bg-rose-subtle text-primary-container border border-brand-300 font-semibold";
    case "secondary":
    case "emerald":
      return "bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold";
    case "tertiary":
    case "amber":
      return "bg-amber-50 text-amber-800 border border-amber-200 font-medium";
    default:
      return "bg-slate-100 text-slate-600 border border-slate-200";
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
    <div className="flex w-full flex-col bg-canvas-bg text-on-surface">
      <div className="w-full border-b border-border-subtle bg-white px-4 py-8 sm:px-6 md:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-6">
          <Link
            href="/"
            className="group inline-flex items-center gap-1.5 text-[13px] text-slate-500 transition-colors hover:text-primary-container"
          >
            <MaterialIcon
              name="arrow_back"
              className="text-[14px] transition-transform group-hover:-translate-x-0.5"
            />
            <span>Back to DearPDF home</span>
          </Link>

          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div className="flex max-w-3xl flex-col gap-1">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-2xl font-bold tracking-tight text-on-surface sm:text-3xl">
                  All PDF Tools
                </h1>
                <span className="rounded-full border border-brand-200 bg-rose-subtle px-3 py-0.5 text-[11px] font-semibold text-primary-container">
                  {STITCH_TOOL_COUNT} Utilities Available
                </span>
              </div>
              <p className="text-sm leading-relaxed text-slate-500">
                Merge, compress, OCR, convert, and more — every tool runs in your browser.
                Works offline after the first visit.
              </p>
            </div>
          </div>

          <div className="flex flex-col items-stretch justify-between gap-3 md:flex-row md:items-center">
            <div className="relative max-w-xl flex-1">
              <MaterialIcon
                name="search"
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[18px] text-slate-400"
              />
              <input
                ref={searchRef}
                id="tool-search"
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Filter ${STITCH_TOOL_COUNT} tools (e.g. merge, compress, ocr, split)...`}
                className="h-10 w-full rounded-xl border border-border-subtle bg-surface-slate py-2 pl-9 pr-12 text-base text-on-surface shadow-sm transition-all placeholder:text-slate-400 focus:border-primary-container focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary-container"
              />
              <div className="pointer-events-none absolute right-2.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
                <kbd className="rounded border border-border-subtle bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
                  /
                </kbd>
              </div>
            </div>

            <div className="no-scrollbar flex shrink-0 items-center gap-1.5 overflow-x-auto rounded-xl bg-slate-100 p-1">
              {FILTERS.map((btn) => {
                const active = category === btn.id;
                return (
                  <button
                    key={btn.id}
                    type="button"
                    onClick={() => setCategory(btn.id)}
                    className={
                      active
                        ? "whitespace-nowrap rounded-lg bg-tech-black px-3.5 py-1.5 text-[13px] font-semibold text-white shadow-sm transition-all"
                        : "whitespace-nowrap rounded-lg px-3.5 py-1.5 text-[13px] text-slate-500 transition-all hover:bg-white hover:text-on-surface"
                    }
                  >
                    {btn.label}{" "}
                    <span
                      className={
                        active
                          ? "ml-1 rounded-full bg-primary-container px-1.5 font-mono text-[11px] font-bold"
                          : "ml-1 font-mono text-[11px] text-slate-400"
                      }
                    >
                      {btn.count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-8 sm:px-6 md:px-8">
        {grouped.map((group) => (
          <section key={group.id} className="flex flex-col gap-4" data-category={group.id}>
            <div className="flex items-center justify-between border-b border-border-subtle pb-2">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-rose-tint bg-rose-subtle text-primary-container">
                  <MaterialIcon name={group.icon} className="text-[18px]" />
                </div>
                <h2 className="text-lg font-bold tracking-tight text-on-surface">
                  {group.title}
                </h2>
                <span className="hidden text-[13px] text-slate-500 sm:inline">— {group.blurb}</span>
              </div>
              <span className="rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 font-mono text-[12px] text-secondary">
                {group.tools.length} tools
              </span>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {group.tools.map((tool) => (
                <Link
                  key={tool.id}
                  href={tool.href}
                  prefetch={false}
                  className="group flex flex-col justify-between gap-3 rounded-2xl border border-border-subtle bg-white p-5 shadow-sm transition-all hover:-translate-y-1 hover:border-brand-300 hover:shadow-xl"
                >
                  <div className="flex flex-col gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-rose-tint bg-rose-subtle text-primary-container transition-colors group-hover:bg-primary-container group-hover:text-white">
                        <MaterialIcon name={tool.icon} className="text-[22px]" />
                      </div>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[11px] ${badgeClass(
                          tool.badgeTone,
                        )}`}
                      >
                        {tool.badge}
                      </span>
                    </div>
                    <div>
                      <div className="flex items-center justify-between">
                        <h3 className="text-base font-semibold text-on-surface transition-colors group-hover:text-primary-container">
                          {tool.name}
                        </h3>
                        <MaterialIcon
                          name="arrow_forward"
                          className="text-[16px] text-primary-container transition-all group-hover:translate-x-1"
                        />
                      </div>
                      <p className="mt-1 line-clamp-2 text-[13px] text-slate-500">
                        {tool.description}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between border-t border-slate-100 pt-3 font-mono text-[12px] text-secondary">
                    <span>{tool.footer}</span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px]">{tool.tag}</span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ))}

        {grouped.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-border-subtle bg-white py-16 text-center">
            <MaterialIcon name="search_off" className="text-4xl text-slate-400" />
            <div className="flex flex-col gap-1">
              <h3 className="text-base font-semibold text-on-surface">No matching PDF utilities</h3>
              <p className="text-[13px] text-slate-500">
                Try searching for &quot;watermark&quot;, &quot;split&quot;, &quot;word&quot;, or
                &quot;sign&quot;.
              </p>
            </div>
            <button
              type="button"
              onClick={resetSearch}
              className="rounded-lg bg-slate-100 px-4 py-1.5 text-[13px] font-medium text-on-surface transition-colors hover:bg-rose-subtle hover:text-primary-container"
            >
              Reset Search Filter
            </button>
          </div>
        ) : null}

        <div className="mt-2 flex w-full flex-col items-start justify-between gap-4 rounded-2xl border border-border-subtle bg-surface-slate p-4 md:flex-row md:items-center md:p-5">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-rose-tint bg-rose-subtle">
              <MaterialIcon name="verified_user" className="text-[18px] text-primary-container" />
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-on-surface">
                Official Document Notice
              </span>
              <p className="max-w-3xl text-[13px] leading-normal text-slate-500">
                For important documents, always open the downloaded result before sharing or filing.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center justify-end gap-2 self-stretch border-t border-border-subtle pt-2 md:self-auto md:border-t-0 md:pt-0">
            <div className="flex items-center gap-1.5 rounded-lg border border-border-subtle bg-white px-2.5 py-1 text-[11px] text-slate-500">
              <MaterialIcon name="offline_bolt" className="text-[14px] text-primary-container" />
              <span className="font-medium">Works offline</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
