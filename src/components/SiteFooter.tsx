import Link from "next/link";
import MaterialIcon from "@/components/MaterialIcon";

export default function SiteFooter() {
  return (
    <footer className="mt-8 w-full border-t border-border-subtle bg-white shadow-[0_-1px_8px_rgba(0,0,0,0.02)] dark:bg-slate-950 dark:shadow-[0_-1px_8px_rgba(0,0,0,0.35)]">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6">
        <div className="flex flex-col items-start justify-between gap-4 rounded-2xl border border-emerald-200/60 bg-security-bg/70 p-4 md:flex-row md:items-center dark:border-emerald-500/30 dark:bg-emerald-950/35">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-300/40 bg-security-emerald/10 text-security-emerald">
              <MaterialIcon name="verified_user" className="text-[22px]" />
            </div>
            <div>
              <p className="text-sm font-bold text-on-surface">Files stay on this device</p>
              <p className="text-[13px] text-slate-500 dark:text-slate-400">
                PDF tools run in your browser — nothing is uploaded to DearPDF servers.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {["No cloud upload", "Works offline", "Free forever"].map((label) => (
              <span
                key={label}
                className="rounded-md border border-emerald-200 bg-white px-2.5 py-1 font-mono text-[12px] text-security-emerald shadow-sm dark:border-emerald-500/30 dark:bg-slate-900"
              >
                {label}
              </span>
            ))}
          </div>
        </div>

        <div className="flex flex-col items-center justify-between gap-4 pt-1 md:flex-row">
          <div className="flex flex-wrap items-center justify-center gap-3 text-[13px] text-slate-500 dark:text-slate-400">
            <span>© 2026 DearPDF.in</span>
            <span className="h-1 w-1 rounded-full bg-slate-300 dark:bg-slate-600" />
            <span className="rounded border border-slate-200 bg-slate-100 px-2.5 py-0.5 font-mono text-[12px] text-secondary dark:border-slate-600 dark:bg-slate-800 dark:text-sky-300">
              v2.5.0
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-5 text-[13px]">
            <Link href="/#tools" className="text-slate-500 transition-colors hover:text-primary-container dark:text-slate-400">
              Tools
            </Link>
            <Link
              href="/privacy-architecture"
              className="text-slate-500 transition-colors hover:text-primary-container dark:text-slate-400"
            >
              Architecture
            </Link>
            <Link href="/how-it-works" className="text-slate-500 transition-colors hover:text-primary-container dark:text-slate-400">
              How it Works
            </Link>
            <Link
              href="/privacy-architecture"
              className="text-slate-500 transition-colors hover:text-primary-container dark:text-slate-400"
            >
              Privacy
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
