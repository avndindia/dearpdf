import type { Metadata } from "next";
import PrivacyChip from "@/components/PrivacyChip";

export const metadata: Metadata = {
  title: "About",
  description: "DearPDF is a privacy-first suite of PDF tools that run in your browser.",
};

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10 sm:px-6">
      <PrivacyChip />
      <h1 className="text-4xl font-semibold tracking-tight">About DearPDF</h1>
      <p className="text-lg leading-relaxed text-[var(--muted)]">
        DearPDF is a calm set of PDF utilities for everyday fixes — merge,
        compress, number pages, OCR, and more. Every tool processes files in
        your browser with WebAssembly and client-side libraries. There is no
        upload step and no account.
      </p>
      <p className="leading-relaxed text-[var(--muted)]">
        The product promise is simple: drop a file, get it back fixed, nothing
        uploaded. Some tools are labelled partial when the browser can only do
        a best-effort conversion (for example OCR accuracy or simplified Word
        layout).
      </p>
      <p className="leading-relaxed text-[var(--muted)]">
        Site: <a className="text-[var(--accent)] underline" href="https://dearpdf.in">dearpdf.in</a>
      </p>
    </div>
  );
}
