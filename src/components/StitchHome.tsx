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
  highlight?: boolean;
}[] = [
  { label: "Merge", icon: "call_merge", href: "/pdf-tools/merge" },
  { label: "Compress", icon: "compress", href: "/pdf-tools/compress" },
  { label: "Split", icon: "content_cut", href: "/pdf-tools/split" },
  { label: "Convert", icon: "sync_alt", filter: "convert" },
  { label: "Sign", icon: "draw", href: "/pdf-tools/sign" },
  {
    label: "OCR",
    icon: "document_scanner",
    href: "/pdf-tools/pdf-to-text",
    highlight: true,
  },
];

function badgeClass(tone: StitchBadgeTone) {
  switch (tone) {
    case "brand":
      return "text-brand-700 bg-brand-50 border border-brand-200";
    case "emerald":
      return "text-emerald-700 bg-emerald-50 border border-emerald-200";
    case "amber":
      return "text-amber-800 bg-amber-50 border border-amber-200";
    default:
      return "text-slate-600 bg-slate-100";
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
    <div className="mx-auto flex max-w-[1240px] flex-col gap-6 px-4 py-6 sm:px-6">
      {/* Hero + dropzone */}
      <section className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm sm:p-6">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-700">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
            Zero server roundtrips · Client-side WebAssembly · 100% offline
          </div>
          <h1 className="mb-1.5 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            Drop a file. Get it back fixed.{" "}
            <span className="text-brand-600">Nothing uploaded.</span>
          </h1>
          <p className="mx-auto mb-4 max-w-xl text-xs text-slate-500 sm:text-sm">
            Fast, private PDF tools that execute natively inside browser memory.
            Your contracts, invoices, and sensitive scans never leave this device.
          </p>
        </div>

        <div className="mx-auto max-w-3xl">
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
            className={`relative flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-4 text-center shadow-sm shadow-blue-100 transition-all sm:p-5 ${
              dragging
                ? "border-brand-600 bg-brand-50/80 ring-2 ring-brand-500"
                : "border-blue-500 bg-blue-50/60 ring-4 ring-blue-500/10 hover:border-blue-600 hover:bg-blue-100/60"
            }`}
          >
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
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 text-blue-600 shadow-sm ring-2 ring-blue-200 transition-all group-hover:scale-105">
                <MaterialIcon name="cloud_sync" className="text-[22px]" />
              </div>
              <div className="text-left">
                <div className="text-sm font-semibold text-slate-900">
                  Drop your PDF here, or{" "}
                  <span className="text-brand-600 underline underline-offset-2">
                    browse files
                  </span>
                </div>
                <div className="text-[11px] text-slate-500">
                  Supports PDF, JPG, PNG up to 500MB · Isolated memory execution
                </div>
              </div>
            </div>

            <div className="relative z-20 flex flex-wrap items-center justify-center gap-1.5 pt-1">
              <span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Fast Actions:
              </span>
              {FAST_ACTIONS.map((action) =>
                action.href ? (
                  <Link
                    key={action.label}
                    href={action.href}
                    onClick={(e) => e.stopPropagation()}
                    className={
                      action.highlight
                        ? "inline-flex items-center gap-1 rounded-md border border-brand-200/80 bg-brand-50 px-2.5 py-1 text-[11px] font-medium text-brand-700 shadow-sm transition-colors hover:bg-brand-600 hover:text-white"
                        : "inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 shadow-sm transition-colors hover:bg-brand-50 hover:text-brand-600"
                    }
                  >
                    <MaterialIcon name={action.icon} className="text-[13px]" />
                    {action.label}
                  </Link>
                ) : (
                  <button
                    key={action.label}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      applyConvertFilter();
                    }}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 shadow-sm transition-colors hover:bg-brand-50 hover:text-brand-600"
                  >
                    <MaterialIcon name={action.icon} className="text-[13px]" />
                    {action.label}
                  </button>
                ),
              )}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2 text-center sm:grid-cols-3">
            {[
              { icon: "verified", label: (<><strong>0 Bytes</strong> Transferred</>) },
              { icon: "shield", label: (<><strong>100%</strong> In-Browser WebAssembly</>) },
              { icon: "wifi_off", label: (<><strong>Works Offline</strong> in Cache</>) },
            ].map((item) => (
              <div
                key={item.icon}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-200/70 bg-slate-50 px-3 py-1.5 text-[11px] font-medium text-slate-600"
              >
                <MaterialIcon name={item.icon} className="text-[15px] text-emerald-600" />
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Sticky search + filters */}
      <section
        id="tools"
        ref={toolsRef}
        className="sticky top-14 z-30 bg-[#F8FAFC]/90 py-2 backdrop-blur scroll-mt-14"
      >
        <div className="flex flex-col items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-2 shadow-sm sm:flex-row">
          <div className="relative w-full sm:w-80">
            <MaterialIcon
              name="search"
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[17px] text-slate-400"
            />
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Filter ${STITCH_TOOL_COUNT} tools (e.g., merge, compress)...`}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-8 text-xs text-slate-800 outline-none transition-all placeholder:text-slate-400 hover:bg-white focus:border-brand-500 focus:bg-white focus:ring-1 focus:ring-brand-500"
            />
            <kbd className="absolute right-2 top-1/2 -translate-y-1/2 rounded border border-slate-200 bg-white px-1 font-mono text-[10px] text-slate-400 shadow-sm">
              /
            </kbd>
          </div>
          <div className="flex w-full items-center gap-1 overflow-x-auto pb-1 sm:w-auto sm:pb-0">
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
                      ? "whitespace-nowrap rounded-lg bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white shadow-sm transition-all"
                      : "whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-medium text-slate-600 transition-all hover:bg-slate-100 hover:text-slate-900"
                  }
                >
                  {btn.label}{" "}
                  <span
                    className={`ml-0.5 font-mono text-[10px] ${
                      active ? "opacity-75" : "text-slate-400"
                    }`}
                  >
                    {btn.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Tool grid */}
      <section className="flex flex-col gap-6" aria-label="Tool directory">
        {grouped.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
            No tools match “{query}”. Try merge, compress, or OCR.
          </p>
        ) : (
          grouped.map((group) => (
            <div key={group.id}>
              <div className="mb-3 flex items-center justify-between border-b border-slate-200 pb-2">
                <div className="flex items-center gap-2">
                  <MaterialIcon name={group.icon} className="text-[18px] text-brand-600" />
                  <h2 className="text-sm font-bold uppercase tracking-wider text-slate-900">
                    {group.title}
                  </h2>
                  <span className="hidden text-xs text-slate-500 sm:inline">{group.blurb}</span>
                </div>
                <span className="font-mono text-[11px] uppercase text-slate-400">
                  {group.tools.length} utilit{group.tools.length === 1 ? "y" : "ies"}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {group.tools.map((tool) => (
                  <Link
                    key={tool.id}
                    href={tool.href}
                    className="group flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm transition-all hover:border-brand-500 hover:shadow-sm"
                  >
                    <div>
                      <div className="mb-2.5 flex items-center justify-between">
                        <div
                          className={
                            tool.iconTone === "amber"
                              ? "flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-600 transition-colors group-hover:bg-amber-600 group-hover:text-white"
                              : "flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-brand-600 transition-colors group-hover:bg-brand-600 group-hover:text-white"
                          }
                        >
                          <MaterialIcon name={tool.icon} className="text-[18px]" />
                        </div>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${badgeClass(
                            tool.badgeTone,
                          )}`}
                        >
                          {tool.badge}
                        </span>
                      </div>
                      <h3 className="text-[13px] font-bold text-slate-900 transition-colors group-hover:text-brand-600">
                        {tool.name}
                      </h3>
                      <p className="mt-0.5 line-clamp-1 text-[12px] text-slate-500">
                        {tool.description}
                      </p>
                    </div>
                    <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 text-[11px] font-medium text-slate-400 transition-colors group-hover:text-brand-600">
                      <span>{tool.footer}</span>
                      <MaterialIcon
                        name="arrow_forward"
                        className="text-[15px] transition-transform group-hover:translate-x-0.5"
                      />
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ))
        )}
      </section>

      {/* Architecture strip */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid grid-cols-1 items-center gap-5 lg:grid-cols-12">
          <div className="flex flex-col gap-2.5 lg:col-span-6">
            <div className="inline-flex w-fit items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700">
              <MaterialIcon name="memory" className="text-[15px]" />
              Why &quot;Nothing Uploaded&quot; Matters
            </div>
            <h3 className="text-lg font-bold tracking-tight text-slate-900">
              Pure client-side execution in your browser&apos;s V8 sandbox.
            </h3>
            <p className="text-xs leading-relaxed text-slate-600">
              Standard web converters beam confidential documents to cloud queues.
              DearPDF loads the PDF engine into local WebAssembly memory threads.
              Files are manipulated on your device’s CPU and exported directly to
              your Downloads folder via{" "}
              <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px] text-slate-800">
                Blob URLs
              </code>
              .
            </p>
            <div className="grid grid-cols-3 gap-2 pt-1 text-center">
              {[
                { title: "01. Memory Buffers", sub: "Direct ArrayBuffer RAM" },
                { title: "02. Native CPU", sub: "Local WebAssembly" },
                { title: "03. Zero Network", sub: "Blob URL instant output" },
              ].map((step) => (
                <div
                  key={step.title}
                  className="rounded-lg border border-slate-200 bg-slate-50 p-2"
                >
                  <div className="text-xs font-bold text-slate-900">{step.title}</div>
                  <div className="text-[10px] text-slate-500">{step.sub}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900 p-3.5 font-mono text-slate-100 shadow-md lg:col-span-6">
            <div className="mb-2 flex items-center justify-between border-b border-slate-800 pb-2 text-[11px]">
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-rose-500" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                <span className="ml-1 text-slate-400">DevTools Network Monitor (F12)</span>
              </div>
              <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-400">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />{" "}
                Verified 0B
              </span>
            </div>
            <div className="space-y-1.5 text-[11px]">
              <div className="flex justify-between border-b border-slate-800/80 pb-1 text-[10px] text-slate-400">
                <span>Request</span>
                <span>Type</span>
                <span>Initiator</span>
                <span>Transferred</span>
              </div>
              <div className="flex items-center justify-between text-slate-300">
                <span className="flex items-center gap-1 text-emerald-400">
                  <MaterialIcon name="check" className="text-[13px]" /> pdfengine.wasm
                </span>
                <span className="text-slate-500">wasm</span>
                <span className="text-slate-500">worker.js</span>
                <span className="text-emerald-400">0 B (cache)</span>
              </div>
              <div className="flex items-center justify-between text-slate-300">
                <span className="flex items-center gap-1 text-emerald-400">
                  <MaterialIcon name="check" className="text-[13px]" />{" "}
                  confidential_contract.pdf
                </span>
                <span className="text-slate-500">MEM_BLOB</span>
                <span className="text-slate-500">FileReader</span>
                <span className="font-bold text-emerald-400">0 B (0 packets)</span>
              </div>
            </div>
            <div className="mt-2.5 flex items-center justify-between border-t border-slate-800 pt-2 font-sans text-[11px]">
              <span className="text-[11px] text-slate-400">
                Inspect real-time network traffic anytime
              </span>
              <Link
                href="/privacy-architecture"
                className="inline-flex items-center gap-0.5 text-[11px] font-medium text-brand-400 hover:text-brand-300"
              >
                Audit Details <MaterialIcon name="arrow_forward" className="text-[13px]" />
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
