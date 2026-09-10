import Link from "next/link";

export default function SiteFooter() {
  return (
    <footer className="mx-auto mt-auto w-full max-w-5xl border-t border-[var(--line)] px-4 py-8 text-sm text-[var(--muted)] sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p>
          <strong className="font-medium text-[var(--ink)]">DearPDF</strong> — drop a
          file, get it back fixed. Nothing uploaded.
        </p>
        <div className="flex gap-4">
          <Link href="/about" className="hover:text-[var(--ink)]">
            About
          </Link>
          <Link href="/privacy" className="hover:text-[var(--ink)]">
            Privacy
          </Link>
          <a href="https://dearpdf.in" className="hover:text-[var(--ink)]">
            dearpdf.in
          </a>
        </div>
      </div>
    </footer>
  );
}
