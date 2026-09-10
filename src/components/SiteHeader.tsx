import Link from "next/link";
import PrivacyChip from "./PrivacyChip";

export default function SiteHeader() {
  return (
    <header className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-5 sm:px-6">
      <Link href="/" className="group flex items-baseline gap-1">
        <span className="text-2xl font-semibold tracking-tight text-[var(--ink)] sm:text-3xl">
          Dear<span className="text-[var(--accent)]">PDF</span>
        </span>
      </Link>
      <nav className="flex flex-wrap items-center gap-4 text-sm text-[var(--muted)]">
        <PrivacyChip />
        <Link href="/about" className="hover:text-[var(--ink)]">
          About
        </Link>
        <Link href="/privacy" className="hover:text-[var(--ink)]">
          Privacy
        </Link>
      </nav>
    </header>
  );
}
