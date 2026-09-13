import Link from "next/link";
import MaterialIcon from "@/components/MaterialIcon";

export default function SiteFooter() {
  return (
    <footer className="w-full border-t border-outline-variant/30 bg-surface-container-lowest py-space-lg">
      <div className="flex w-full flex-col items-center justify-between gap-space-md px-space-xl md:flex-row">
        <div className="flex items-center gap-space-md">
          <div className="flex items-center gap-space-xs text-on-surface-variant">
            <MaterialIcon name="verified_user" className="text-[16px] text-primary" />
            <span className="font-label-md text-label-md font-medium text-on-surface">
              Zero bytes leave your computer
            </span>
          </div>
          <span className="hidden text-outline-variant sm:inline">·</span>
          <span className="hidden font-body-sm text-body-sm text-on-surface-variant sm:inline">
            WebAssembly Client Computing
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-space-md font-label-md text-label-md">
          <Link
            href="/pdf-tools"
            className="text-on-surface-variant transition-colors hover:text-on-surface"
          >
            Tools
          </Link>
          <span className="text-outline-variant">/</span>
          <Link
            href="/privacy-architecture"
            className="text-on-surface-variant transition-colors hover:text-on-surface"
          >
            Architecture
          </Link>
          <span className="text-outline-variant">/</span>
          <Link
            href="/how-it-works"
            className="text-on-surface-variant transition-colors hover:text-on-surface"
          >
            Audit
          </Link>
          <span className="text-outline-variant">/</span>
          <Link
            href="/privacy-architecture"
            className="text-on-surface-variant transition-colors hover:text-on-surface"
          >
            Privacy
          </Link>
          <span className="text-outline-variant">/</span>
          <span className="rounded border border-outline-variant/30 bg-surface-container-low px-space-xs py-0.5 font-mono font-label-sm text-label-sm text-on-surface-variant">
            v2.5.0-wasm
          </span>
          <span className="text-outline-variant">/</span>
          <span className="text-on-surface-variant">© 2026 DearPDF</span>
        </div>
      </div>
    </footer>
  );
}
