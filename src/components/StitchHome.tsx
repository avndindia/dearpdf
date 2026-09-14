"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MaterialIcon from "@/components/MaterialIcon";
import { openFileIntoDearPdf } from "@/lib/open-file-handoff";
import {
  STITCH_TOOL_COUNT,
  stitchCategories,
  stitchTools,
  type StitchBadgeTone,
  type StitchCategoryId,
} from "@/lib/stitch-tools";

type CategoryFilter = "all" | StitchCategoryId;

const FAST_ACTIONS: {
  label: string;
  icon: string;
  href?: string;
  filter?: CategoryFilter;
}[] = [
  { label: "Merge", icon: "call_merge", href: "/pdf-tools/merge" },
  { label: "Compress", icon: "compress", href: "/pdf-tools/compress" },
  { label: "Split", icon: "content_cut", href: "/pdf-tools/split" },
  { label: "Convert", icon: "sync_alt", filter: "convert" },
  { label: "Sign", icon: "draw", href: "/pdf-tools/sign" },
  { label: "OCR", icon: "document_scanner", href: "/pdf-tools/pdf-to-text" },
  { label: "Summary", icon: "auto_awesome", href: "/pdf-tools/ai-summary" },
];

function badgeClass(tone: StitchBadgeTone) {
  switch (tone) {
    case "brand":
    case "primaryFixed":
    case "popular":
      return "bg-sky-50 text-primary-container border border-brand-300";
    case "secondary":
    case "emerald":
      return "text-emerald-700 bg-emerald-50 border border-emerald-200";
    case "amber":
    case "tertiary":
      return "text-amber-800 bg-amber-50 border border-amber-200";
    default:
      return "text-slate-600 bg-slate-100 border border-slate-200";
  }
}

export default function StitchHome() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [dragging, setDragging] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const toolsRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/") return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) {
        return;
      }
      e.preventDefault();
      searchRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash === "#tools") {
      toolsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return stitchTools.filter((tool) => {
      if (category !== "all" && tool.category !== category) return false;
      if (!q) return true;
      return (
        tool.searchText.toLowerCase().includes(q) ||
        tool.name.toLowerCase().includes(q) ||
        tool.description.toLowerCase().includes(q)
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

  const handleFiles = useCallback((files: FileList | File[] | null) => {
    const file = files && (files instanceof FileList ? files[0] : files[0]);
    if (file) void openFileIntoDearPdf(file);
  }, []);

  const applyConvertFilter = () => {
    setCategory("convert");
    setQuery("");
    toolsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="relative w-full overflow-hidden bg-canvas-bg">
      <div className="pointer-events-none absolute -top-32 left-1/2 -z-10 h-[360px] w-[820px] -translate-x-1/2 bg-gradient-to-b from-sky-100/50 via-sky-50/30 to-transparent blur-3xl" />
      <div className="pointer-events-none absolute top-20 right-10 -z-10 h-96 w-96 rounded-full bg-sky-50/70 blur-3xl" />

      <div className="mx-auto max-w-7xl px-4 pb-16 sm:px-6">
        {/* Hero + dropzone */}
        <section className="mx-auto flex max-w-4xl flex-col items-center pb-10 pt-8 text-center">
          <div className="mb-6 inline-flex flex-wrap items-center justify-center gap-2 rounded-full border border-brand-300 bg-white px-3.5 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider shadow-sm">
            <span className="h-2 w-2 animate-pulse rounded-full bg-primary-container" />
            <span className="font-bold text-on-surface">Private PDF Tools</span>
            <span className="h-1 w-1 rounded-full bg-brand-300" />
            <span className="font-medium text-secondary">Zero Cloud Uploads</span>
            <span className="hidden h-1 w-1 rounded-full bg-brand-300 sm:inline" />
            <span className="hidden font-bold text-primary-container sm:inline">
              No Limits · No Subscriptions
            </span>
          </div>

          <h1 className="mb-4 text-[2rem] font-extrabold leading-10 tracking-tight text-on-surface sm:text-[2.75rem] sm:leading-[3.25rem]">
            Drop a file.{" "}
            <br className="sm:hidden" />
            <span className="bg-gradient-to-r from-sky-600 via-blue-600 to-cyan-500 bg-clip-text text-transparent">
              Get it back fixed.
            </span>
          </h1>
          <p className="mx-auto mb-8 max-w-2xl text-base leading-relaxed text-slate-500">
            Fast tools for everyday PDF fixes — merge, compress, OCR, convert, and more.
            Processed in your browser. Free forever, no subscriptions, no file limits.
          </p>

          <div
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                fileRef.current?.click();
              }
            }}
            onClick={() => fileRef.current?.click()}
            onDragEnter={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragging(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragging(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragging(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragging(false);
              handleFiles(e.dataTransfer.files);
            }}
            className={`group relative w-full max-w-4xl cursor-pointer rounded-3xl border-2 border-dashed p-6 shadow-lg transition-all duration-300 hover:shadow-2xl sm:p-8 ${
              dragging
                ? "border-sky-500 bg-sky-50 shadow-[0_0_0_4px_rgba(2,132,199,0.12)]"
                : "border-brand-300 bg-white"
            }`}
            style={dragging ? undefined : { borderColor: "#0284c7" }}
          >
            <div className="pointer-events-none absolute inset-0 rounded-3xl bg-gradient-to-b from-sky-50/60 via-white to-white" />
            <input
              ref={fileRef}
              type="file"
              className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
              accept="application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp"
              aria-label="Drop or upload file"
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => {
                handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <div className="relative z-10 flex flex-col items-center text-center">
              <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-2xl border border-sky-100 bg-sky-50 text-primary-container shadow-sm transition-all duration-300 group-hover:border-primary-container group-hover:bg-primary-container group-hover:text-white">
                <MaterialIcon name="cloud_sync" className="text-[32px] transition-transform group-hover:scale-110" />
              </div>
              <div className="mb-1 flex flex-wrap items-center justify-center gap-1.5 text-base font-semibold text-on-surface">
                <span>Drop your PDF here, or</span>
                <span className="font-bold text-primary-container underline underline-offset-4 hover:text-sky-700">
                  browse files
                </span>
              </div>
              <p className="mb-6 font-mono text-[12px] text-slate-500">
                PDF, JPG, or PNG · up to 500MB · stays on this device
              </p>

              <div className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl border border-slate-200/70 bg-slate-50/90 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-3.5">
                <span className="hidden whitespace-nowrap pl-1 text-left font-mono text-[11px] font-semibold uppercase text-secondary sm:inline">
                  Fast Actions:
                </span>
                <div className="flex w-full flex-wrap items-center justify-center gap-1.5 sm:w-auto sm:flex-1 sm:justify-end">
                  {FAST_ACTIONS.map((action) =>
                    action.href ? (
                      <Link
                        key={action.label}
                        href={action.href}
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex min-h-[44px] flex-col items-center justify-center gap-1 rounded-xl border border-slate-200/80 bg-white px-2 py-2 text-[13px] font-medium text-on-surface shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand-300 hover:bg-sky-50 hover:text-primary-container sm:min-h-0 sm:flex-row sm:gap-2 sm:px-3 sm:py-1.5"
                      >
                        <MaterialIcon name={action.icon} className="shrink-0 text-[18px] text-primary-container sm:text-[16px]" />
                        <span className="whitespace-nowrap leading-tight">{action.label}</span>
                      </Link>
                    ) : (
                      <button
                        key={action.label}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          applyConvertFilter();
                        }}
                        className="inline-flex min-h-[44px] flex-col items-center justify-center gap-1 rounded-xl border border-slate-200/80 bg-white px-2 py-2 text-[13px] font-medium text-on-surface shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand-300 hover:bg-sky-50 hover:text-primary-container sm:min-h-0 sm:flex-row sm:gap-2 sm:px-3 sm:py-1.5"
                      >
                        <MaterialIcon name={action.icon} className="shrink-0 text-[18px] text-primary-container sm:text-[16px]" />
                        <span className="whitespace-nowrap leading-tight">{action.label}</span>
                      </button>
                    ),
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Trust strip — once */}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3 text-slate-500">
            {[
              { icon: "verified", color: "text-security-emerald", label: (<><span className="font-medium text-on-surface">Nothing</span> uploaded</>) },
              { icon: "shield", color: "text-primary-container", label: (<><span className="font-medium text-on-surface">Runs</span> in your browser</>) },
              { icon: "wifi_off", color: "text-secondary", label: (<><span className="font-medium text-on-surface">Works offline</span> after first visit</>) },
              { icon: "lock_open", color: "text-security-emerald", label: (<><span className="font-medium text-on-surface">No subscriptions</span> · 100% free</>) },
              { icon: "all_inclusive", color: "text-primary-container", label: (<><span className="font-medium text-on-surface">No limits</span> on files or size</>) },
            ].map((item) => (
              <div
                key={item.icon}
                className="inline-flex items-center gap-2 rounded-full border border-border-subtle bg-white px-3.5 py-1.5 text-[13px] shadow-sm"
              >
                <MaterialIcon name={item.icon} className={`text-[18px] ${item.color}`} />
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Sticky search + filters */}
        <section
          id="tools"
          ref={toolsRef}
          className="sticky top-16 z-40 mb-10 bg-canvas-bg/90 py-3 backdrop-blur-md scroll-mt-16 sm:top-20 sm:scroll-mt-20"
        >
          <div className="flex flex-col items-center justify-between gap-3 rounded-2xl border border-border-subtle bg-white p-2 shadow-md md:flex-row">
            <div className="relative flex w-full items-center md:w-80">
              <MaterialIcon
                name="search"
                className="pointer-events-none absolute left-3 text-[18px] text-slate-400"
              />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Filter ${STITCH_TOOL_COUNT} tools (e.g., merge, compress...)`}
                className="w-full rounded-xl bg-slate-100 py-2 pl-9 pr-8 text-base text-on-surface outline-none transition-all placeholder:text-slate-400 focus:bg-sky-50/50 focus:ring-1 focus:ring-primary-container"
              />
              <kbd className="absolute right-2.5 rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[12px] text-slate-400 shadow-sm">
                /
              </kbd>
            </div>
            <div className="no-scrollbar flex w-full items-center gap-1.5 overflow-x-auto rounded-xl bg-slate-100 p-1 md:w-auto">
              {(
                [
                  { id: "all" as const, label: "All", count: STITCH_TOOL_COUNT },
                  ...stitchCategories.map((c) => ({
                    id: c.id as CategoryFilter,
                    label: c.id === "edit" ? "Edit & Sign" : c.id === "secure" ? "Security" : c.title,
                    count: c.count,
                  })),
                ] as { id: CategoryFilter; label: string; count: number }[]
              ).map((btn) => {
                const active = category === btn.id;
                return (
                  <button
                    key={btn.id}
                    type="button"
                    onClick={() => setCategory(btn.id)}
                    className={
                      active
                        ? "flex items-center gap-2 whitespace-nowrap rounded-lg bg-tech-black px-4 py-1.5 text-[13px] font-semibold text-white shadow-sm transition-all"
                        : "flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 py-1.5 text-[13px] text-slate-500 transition-all hover:text-on-surface"
                    }
                  >
                    <span>{btn.label}</span>
                    <span
                      className={
                        active
                          ? "rounded-full bg-primary-container px-1.5 font-mono text-[12px] font-bold text-white"
                          : "rounded-full border border-slate-200 bg-white px-1.5 font-mono text-[12px] text-slate-500"
                      }
                    >
                      {btn.count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {/* Tool directory */}
        <div className="space-y-12" aria-label="Tool directory">
          {grouped.length === 0 ? (
            <p className="rounded-2xl border border-border-subtle bg-white p-6 text-center text-sm text-slate-500">
              No tools match “{query}”. Try merge, compress, or OCR.
            </p>
          ) : (
            grouped.map((group) => (
              <section key={group.id} className="space-y-4">
                <div className="flex items-center justify-between pb-1">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-sky-100 bg-sky-50 text-primary-container">
                      <MaterialIcon name={group.icon} className="text-[18px]" />
                    </div>
                    <h2 className="text-xl font-bold tracking-tight text-on-surface sm:text-2xl">
                      {group.title}
                    </h2>
                    <span className="hidden text-[13px] text-slate-500 sm:inline">
                      — {group.blurb}
                    </span>
                  </div>
                  <span className="rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 font-mono text-[12px] uppercase text-secondary">
                    {group.tools.length} utilit{group.tools.length === 1 ? "y" : "ies"}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
                  {group.tools.map((tool) => (
                    <Link
                      key={tool.id}
                      href={tool.href}
                      className="group flex flex-col justify-between rounded-2xl border border-border-subtle bg-white p-3.5 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-brand-300 hover:bg-white hover:shadow-xl sm:p-5"
                    >
                      <div>
                        <div className="mb-3 flex items-center justify-between sm:mb-4">
                          <div
                            className={
                              tool.iconTone === "amber"
                                ? "flex h-11 w-11 items-center justify-center rounded-xl border border-amber-200 bg-amber-50 text-amber-600 transition-all group-hover:bg-amber-600 group-hover:text-white"
                                : "flex h-11 w-11 items-center justify-center rounded-xl border border-sky-100 bg-sky-50 text-primary-container transition-all group-hover:bg-primary-container group-hover:text-white"
                            }
                          >
                            <MaterialIcon name={tool.icon} className="text-[22px]" />
                          </div>
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${badgeClass(
                              tool.badgeTone,
                            )}`}
                          >
                            {tool.badge}
                          </span>
                        </div>
                        <h3 className="mb-1 text-[15px] font-semibold leading-snug text-on-surface transition-colors group-hover:text-primary-container sm:text-base">
                          {tool.name}
                        </h3>
                        <p className="line-clamp-2 text-[12px] text-slate-500 sm:text-[13px]">
                          {tool.description}
                        </p>
                      </div>
                      <div className="mt-2 flex items-center justify-between border-t border-transparent pt-4 font-mono text-[12px] text-secondary">
                        <span>{tool.footer}</span>
                        <MaterialIcon
                          name="arrow_forward"
                          className="text-[16px] text-primary-container transition-transform group-hover:translate-x-1"
                        />
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            ))
          )}
        </div>

        {/* How-it-works strip */}
        <section className="mt-12 rounded-2xl border border-border-subtle bg-white p-5 shadow-sm sm:p-6">
          <div className="grid grid-cols-1 items-center gap-5 lg:grid-cols-12">
            <div className="flex flex-col gap-2.5 lg:col-span-6">
              <div className="inline-flex w-fit items-center gap-1.5 rounded-md border border-brand-200 bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-primary-container">
                <MaterialIcon name="verified_user" className="text-[15px]" />
                Why &quot;Nothing uploaded&quot; matters
              </div>
              <h3 className="text-lg font-bold tracking-tight text-on-surface sm:text-xl">
                Your PDFs are edited on this device — not on our servers.
              </h3>
              <p className="text-sm leading-relaxed text-slate-600">
                Most online converters upload your documents. DearPDF does the work in your
                browser instead. Open a file, get the result back, and download it — without
                sending the document anywhere.
              </p>
              <div className="grid grid-cols-3 gap-2 pt-1 text-center">
                {[
                  { title: "1. Open", sub: "File stays on this device" },
                  { title: "2. Edit", sub: "Tools run in your browser" },
                  { title: "3. Download", sub: "Nothing sent to a server" },
                ].map((step) => (
                  <div
                    key={step.title}
                    className="rounded-lg border border-border-subtle bg-surface-slate p-2"
                  >
                    <div className="text-xs font-bold text-on-surface">{step.title}</div>
                    <div className="text-[10px] text-slate-500">{step.sub}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-tech-black p-3.5 font-mono text-slate-100 shadow-md lg:col-span-6">
              <div className="mb-2 flex items-center justify-between border-b border-slate-800 pb-2 text-[11px]">
                <div className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-sky-500" />
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                  <span className="ml-1 text-slate-400">What happens to your file</span>
                </div>
                <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-400">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> Private
                </span>
              </div>
              <div className="space-y-2 font-sans text-[11px]">
                <div className="flex items-start justify-between gap-3 text-slate-300">
                  <span className="flex items-center gap-1 text-emerald-400">
                    <MaterialIcon name="check" className="text-[13px]" /> Your document
                  </span>
                  <span className="text-right text-emerald-400">Stays on this device</span>
                </div>
                <div className="flex items-start justify-between gap-3 text-slate-300">
                  <span className="flex items-center gap-1 text-emerald-400">
                    <MaterialIcon name="check" className="text-[13px]" /> Processing
                  </span>
                  <span className="text-right text-slate-400">In your browser only</span>
                </div>
                <div className="flex items-start justify-between gap-3 text-slate-300">
                  <span className="flex items-center gap-1 text-emerald-400">
                    <MaterialIcon name="check" className="text-[13px]" /> Upload to DearPDF
                  </span>
                  <span className="text-right font-bold text-emerald-400">Never</span>
                </div>
              </div>
              <div className="mt-2.5 flex items-center justify-between border-t border-slate-800 pt-2 font-sans text-[11px]">
                <span className="text-slate-400">Want the technical details?</span>
                <Link
                  href="/privacy-architecture"
                  className="inline-flex items-center gap-0.5 font-medium text-brand-400 hover:text-brand-300"
                >
                  Privacy architecture <MaterialIcon name="arrow_forward" className="text-[13px]" />
                </Link>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
