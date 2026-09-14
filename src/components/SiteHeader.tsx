"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";
import MaterialIcon from "@/components/MaterialIcon";
import { openFileIntoDearPdf } from "@/lib/open-file-handoff";

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
    <Link href="/" className="flex select-none items-center py-1 transition-transform hover:scale-[1.02]">
      <Image
        src="/logo-dearpdf-lockup.png"
        alt="DearPDF.in"
        width={200}
        height={40}
        className="h-10 w-auto object-contain drop-shadow-sm sm:h-11"
        priority
      />
    </Link>
  );
}

export default function SiteHeader() {
  const pathname = usePathname() || "/";
  const inputRef = useRef<HTMLInputElement>(null);

  if (pathname.startsWith("/admin")) {
    return (
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-border-subtle bg-white/95 shadow-[0_1px_8px_rgba(0,0,0,0.03)] backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:h-20 sm:px-6">
          <LogoLink />
          <span className="rounded-full border border-border-subtle bg-surface-slate px-3 py-1 font-mono text-[11px] text-secondary">
            /admin
          </span>
        </div>
      </header>
    );
  }

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-border-subtle bg-white/95 shadow-[0_1px_8px_rgba(0,0,0,0.03)] backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-3 px-4 sm:h-20 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <LogoLink />
          <div className="hidden items-center gap-1.5 rounded-full border border-emerald-200/60 bg-security-bg px-2.5 py-1 text-[11px] font-semibold text-security-emerald sm:inline-flex">
            <span className="h-1.5 w-1.5 rounded-full bg-security-emerald" />
            Client-Side Only
          </div>
        </div>

        <nav className="hidden items-center gap-1 rounded-xl bg-slate-100 p-1 md:flex">
          {NAV.filter((item) => item.href !== "/").map((item) => {
            const active = item.match(pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={
                  active
                    ? "rounded-lg bg-white px-3.5 py-1.5 text-sm font-semibold text-on-surface shadow-sm transition-all"
                    : "rounded-lg px-3.5 py-1.5 text-sm text-slate-500 transition-all hover:bg-white hover:text-on-surface"
                }
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          <div className="hidden items-center gap-2 rounded-full border border-slate-200/60 bg-slate-100 px-3.5 py-1.5 font-mono text-[12px] text-secondary xl:flex">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-security-emerald opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-security-emerald" />
            </span>
            <span>Nothing uploaded</span>
          </div>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-cta to-ruby-deep px-3 py-2 text-sm font-semibold text-white shadow-[0_2px_8px_rgba(225,29,72,0.35)] transition-all duration-200 hover:-translate-y-0.5 hover:from-crimson-vivid hover:to-cta hover:shadow-[0_4px_14px_rgba(225,29,72,0.45)] focus:outline-none focus:ring-2 focus:ring-cta/40 sm:px-4"
          >
            <MaterialIcon name="upload_file" className="text-[18px]" />
            <span className="hidden sm:inline">Open File</span>
            <span className="sm:hidden">Open</span>
          </button>
          <input
            ref={inputRef}
            className="hidden"
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void openFileIntoDearPdf(file);
            }}
          />
        </div>
      </div>
    </header>
  );
}
