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
    href: "/pdf-tools",
    label: "All Tools",
    match: (p: string) => p === "/pdf-tools" || p.startsWith("/pdf-tools/"),
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

export default function SiteHeader() {
  const pathname = usePathname() || "/";
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-outline-variant/30 bg-surface-container-lowest shadow-[0_1px_3px_0_rgba(15,23,42,0.05)]">
      <div className="flex h-14 w-full items-center justify-between gap-space-md px-space-xl">
        <div className="flex min-w-0 items-center gap-space-lg">
          <Link href="/" className="flex select-none items-center gap-space-md">
            <Image
              src="/logo-dearpdf.png"
              alt="DearPDF"
              width={32}
              height={32}
              className="h-8 w-auto object-contain"
              priority
            />
            <div className="flex flex-col">
              <span className="font-headline-md text-headline-md leading-none tracking-tight text-on-surface">
                DearPDF
              </span>
              <span className="mt-space-xs font-label-sm text-label-sm font-normal leading-tight text-on-surface-variant">
                Private PDF tools
              </span>
            </div>
          </Link>
          <div className="hidden h-4 w-px bg-outline-variant/40 md:block" />
          <div className="hidden items-center gap-space-sm rounded-full border border-outline-variant/40 bg-surface-container-low px-space-md py-space-xs md:inline-flex">
            <span className="relative flex h-2 w-2">
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <span className="font-label-sm text-label-sm font-medium text-on-surface-variant">
              Nothing uploaded
            </span>
          </div>
        </div>

        <nav className="hidden items-center gap-space-xs lg:flex">
          {NAV.map((item) => {
            const active = item.match(pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={
                  active
                    ? "rounded bg-secondary-container px-space-md py-space-xs font-semibold text-on-secondary-fixed transition-colors"
                    : "rounded px-space-md py-space-xs font-label-lg text-label-lg text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-on-surface"
                }
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-space-md">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="inline-flex h-8 items-center gap-space-sm rounded bg-primary-container px-space-md font-label-lg text-label-lg text-on-primary shadow-sm transition-colors hover:bg-primary focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <MaterialIcon name="file_open" className="text-[16px]" />
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
