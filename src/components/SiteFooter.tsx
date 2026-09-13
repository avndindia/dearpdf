import Image from "next/image";
import Link from "next/link";

export default function SiteFooter() {
  return (
    <footer className="mt-6 w-full border-t border-slate-200 bg-white py-6">
      <div className="mx-auto flex max-w-[1240px] flex-col items-center justify-between gap-4 px-4 text-xs text-slate-500 sm:px-6 md:flex-row">
        <div className="flex items-center gap-3">
          <Image
            src="/logo-dearpdf.png"
            alt="DearPDF"
            width={20}
            height={20}
            className="h-5 w-5 rounded object-contain"
          />
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            <span className="font-semibold text-slate-800">
              Zero bytes leave your computer.
            </span>
            <span className="hidden text-slate-400 sm:inline">·</span>
            <span className="hidden sm:inline">WebAssembly Client Computing</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-slate-600">
          <Link href="/#tools" className="transition-colors hover:text-brand-600">
            Tools
          </Link>
          <Link href="/how-it-works" className="transition-colors hover:text-brand-600">
            Architecture
          </Link>
          <Link
            href="/privacy-architecture"
            className="transition-colors hover:text-brand-600"
          >
            Audit
          </Link>
          <Link
            href="/privacy-architecture"
            className="transition-colors hover:text-brand-600"
          >
            Privacy
          </Link>
          <span className="font-mono text-[10px] text-slate-400">v2.5.0-wasm</span>
          <span>© 2026 DearPDF</span>
        </div>
      </div>
    </footer>
  );
}
