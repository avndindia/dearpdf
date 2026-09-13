"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";
import MaterialIcon from "@/components/MaterialIcon";
import { openFileIntoDearPdf } from "@/lib/open-file-handoff";

const NAV = [
  { href: "/#tools", label: "All Tools", match: (p: string) => p === "/" },
  { href: "/how-it-works", label: "How it Works", match: (p: string) => p.startsWith("/how-it-works") },
  {
    href: "/privacy-architecture",
    label: "Privacy Architecture",
    match: (p: string) => p.startsWith("/privacy-architecture") || p.startsWith("/privacy"),
  },
  { href: "/about", label: "About", match: (p: string) => p.startsWith("/about") },
];

export default function SiteHeader() {
  const pathname = usePathname() || "/";
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-14 bg-white/95 backdrop-blur border-b border-slate-200">
      <div className="mx-auto flex h-full max-w-[1240px] items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-4 min-w-0">
          <Link href="/" className="group flex items-center gap-2.5 shrink-0">
            <Image
              src="/logo-dearpdf.png"
              alt="DearPDF"
              width={28}
              height={28}
              className="h-7 w-7 rounded-md object-contain shadow-sm transition-opacity group-hover:opacity-90"
              priority
            />
            <div className="flex flex-col">
              <span className="text-[15px] font-bold leading-none tracking-tight text-slate-900">
                DearPDF
              </span>
              <span className="mt-0.5 text-[11px] font-medium leading-tight text-slate-500">
                100% Client-side · Zero uploads
              </span>
            </div>
          </Link>
          <div className="hidden items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 sm:inline-flex">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
            <span>Wasm Sandbox Active</span>
          </div>
        </div>

        <nav className="hidden items-center gap-1 text-[13px] font-medium text-slate-600 md:flex">
          {NAV.map((item) => {
            const active = item.match(pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={
                  active
                    ? "rounded-md bg-slate-100 px-2.5 py-1.5 font-semibold text-slate-900"
                    : "rounded-md px-2.5 py-1.5 transition-colors hover:bg-slate-50 hover:text-slate-900"
                }
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-[13px] font-semibold text-white shadow-sm shadow-brand-600/20 transition-all hover:bg-brand-700 active:bg-brand-700"
          >
            <MaterialIcon name="upload_file" className="text-[17px]" />
            <span>Open File</span>
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
