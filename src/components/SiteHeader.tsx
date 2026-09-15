"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";
import DearPdfLogo from "@/components/DearPdfLogo";
import MaterialIcon from "@/components/MaterialIcon";
import ThemeToggle from "@/components/ThemeToggle";
import { dismissPdfToolCompletion } from "@/lib/browser-download";
import { openFilesIntoDearPdf } from "@/lib/open-file-handoff";

const NAV = [
  { href: "/", label: "Home", match: (p: string) => p === "/" },
  {
    href: "/#tools",
    label: "All Tools",
    // Home hosts the tool directory at #tools — highlight on home, not on individual tools.
    match: (p: string) => p === "/",
  },
  {
    href: "/how-it-works",
    label: "How it Works",
    match: (p: string) => p.startsWith("/how-it-works"),
  },
  {
    href: "/privacy-architecture",
    label: "Privacy Architecture",
    match: (p: string) => p.startsWith("/privacy-architecture") || p.startsWith("/privacy"),
  },
  { href: "/about", label: "About", match: (p: string) => p.startsWith("/about") },
];

function LogoLink() {
  return (
    <Link
      href="/"
      onClick={() => dismissPdfToolCompletion()}
      className="flex min-w-0 shrink select-none items-center py-0.5 transition-transform hover:scale-[1.02]"
      aria-label="DearPDF.in home"
    >
      <DearPdfLogo />
    </Link>
  );
}

const headerChrome =
  "fixed top-0 left-0 right-0 z-50 border-b border-border-subtle bg-white/95 shadow-[0_1px_8px_rgba(0,0,0,0.03)] backdrop-blur-md dark:border-[#1f2a3f]/70 dark:bg-[#0a0e17]/90 dark:shadow-none";

export default function SiteHeader() {
  const pathname = usePathname() || "/";
  const inputRef = useRef<HTMLInputElement>(null);

  if (pathname.startsWith("/admin")) {
    return (
      <header className={headerChrome}>
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:h-20 sm:px-6">
          <LogoLink />
          <div className="flex shrink-0 items-center gap-2">
            <ThemeToggle />
            <span className="rounded-full border border-border-subtle bg-surface-slate px-3 py-1 font-mono text-[11px] text-secondary dark:bg-slate-800">
              /admin
            </span>
          </div>
        </div>
      </header>
    );
  }

  return (
    <header className={headerChrome}>
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-3 px-4 sm:h-20 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <LogoLink />
          <div className="hidden items-center gap-1.5 rounded-full border border-emerald-200/60 bg-security-bg px-2.5 py-1 text-[11px] font-semibold text-security-emerald sm:inline-flex dark:border-emerald-800/60 dark:bg-emerald-950/80 dark:text-emerald-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-security-emerald dark:bg-emerald-400" />
            Client-Side Only
          </div>
        </div>

        <nav className="hidden items-center gap-6 text-sm font-medium text-slate-500 md:flex dark:text-slate-300">
          {NAV.filter((item) => item.href !== "/").map((item) => {
            const active = item.match(pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => dismissPdfToolCompletion()}
                aria-current={active ? "page" : undefined}
                className={
                  active
                    ? "text-on-surface transition-colors dark:text-white"
                    : "transition-colors hover:text-on-surface dark:hover:text-white"
                }
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          <div className="hidden items-center gap-2 rounded-full border border-slate-200/60 bg-slate-100 px-2.5 py-1.5 text-xs text-secondary xl:flex dark:border-slate-800 dark:bg-[#151c2d] dark:text-slate-400">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <span>Nothing uploaded</span>
          </div>
          <ThemeToggle />
          <button
            type="button"
            onClick={() => {
              dismissPdfToolCompletion();
              inputRef.current?.click();
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-sky-700 px-3 py-2 text-sm font-semibold text-white shadow-[0_2px_8px_rgba(3,105,161,0.3)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-sky-800 hover:shadow-[0_4px_14px_rgba(3,105,161,0.4)] focus:outline-none focus:ring-2 focus:ring-sky-600/40 dark:bg-sky-500 dark:text-slate-950 dark:shadow-md dark:shadow-sky-500/25 dark:hover:bg-sky-400 dark:hover:shadow-sky-500/30 sm:px-4"
          >
            <MaterialIcon name="upload_file" className="text-[18px]" />
            <span className="hidden sm:inline">Open File</span>
            <span className="sm:hidden">Open</span>
          </button>
          <input
            ref={inputRef}
            className="hidden"
            type="file"
            multiple
            accept="application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp"
            onChange={(e) => {
              const files = e.target.files ? Array.from(e.target.files) : [];
              e.target.value = "";
              if (files.length) void openFilesIntoDearPdf(files);
            }}
          />
        </div>
      </div>
    </header>
  );
}
