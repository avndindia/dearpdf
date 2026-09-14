import type { Metadata } from "next";
import Link from "next/link";
import MaterialIcon from "@/components/MaterialIcon";

export const metadata: Metadata = {
  title: "About",
  description:
    "DearPDF is a privacy-first suite of PDF tools that run entirely in your browser.",
};

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-[800px] space-y-6 px-4 py-10 sm:px-6">
      <div className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-sky-50 px-2.5 py-1 text-[11px] font-medium text-primary-container">
        <span className="h-1.5 w-1.5 rounded-full bg-primary-container" />
        100% client-side · Zero uploads
      </div>
      <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
        About DearPDF
      </h1>
      <p className="text-base leading-relaxed text-slate-600">
        DearPDF is a fast, private PDF suite for everyday fixes — merge, compress,
        number pages, OCR, sign, and more. Every tool processes files in your
        browser with WebAssembly and client-side libraries. There is no upload
        step and no account.
      </p>
      <p className="leading-relaxed text-slate-600">
        The product promise is simple:{" "}
        <strong className="font-semibold text-slate-900">
          drop a file, get it back fixed, nothing uploaded.
        </strong>{" "}
        Some tools are labelled partial when the browser can only do a best-effort
        conversion (for example OCR accuracy or simplified Word layout).
      </p>
      <div className="flex flex-wrap gap-3 pt-2">
        <Link
          href="/#tools"
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          <MaterialIcon name="apps" className="text-[18px]" />
          Browse tools
        </Link>
        <Link
          href="/privacy-architecture"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-brand-500 hover:text-brand-600"
        >
          Privacy Architecture
        </Link>
      </div>
      <p className="text-sm text-slate-500">
        Site:{" "}
        <a className="font-medium text-brand-600 underline" href="https://dearpdf.in">
          dearpdf.in
        </a>
      </p>
    </div>
  );
}
