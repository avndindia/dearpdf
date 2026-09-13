import type { Metadata } from "next";
import Link from "next/link";
import MaterialIcon from "@/components/MaterialIcon";

export const metadata: Metadata = {
  title: "How it Works",
  description:
    "DearPDF runs PDF tools entirely in your browser with WebAssembly — nothing is uploaded.",
};

export default function HowItWorksPage() {
  return (
    <div className="mx-auto max-w-[800px] space-y-8 px-4 py-10 sm:px-6">
      <div className="inline-flex items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700">
        <MaterialIcon name="memory" className="text-[15px]" />
        Client-side architecture
      </div>
      <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
        How DearPDF works
      </h1>
      <p className="text-base leading-relaxed text-slate-600">
        Every tool loads a PDF engine into your browser&apos;s WebAssembly sandbox.
        Files are read into memory with the File API, processed on your CPU, and
        written back via Blob URLs — with zero document bytes transferred to DearPDF
        servers.
      </p>

      <ol className="space-y-4">
        {[
          {
            n: "01",
            title: "Memory buffers",
            body: "Your file is opened as an ArrayBuffer in this tab. Nothing is posted to a conversion API.",
          },
          {
            n: "02",
            title: "Native CPU via Wasm",
            body: "pdf-lib, PDF.js, qpdf WASM, and Tesseract.js run locally. Heavy work stays on-device.",
          },
          {
            n: "03",
            title: "Zero network for documents",
            body: "The result is a Blob URL download. Open DevTools → Network while you work: document transfer stays at 0 B.",
          },
        ].map((step) => (
          <li
            key={step.n}
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
          >
            <div className="mb-1 text-xs font-bold uppercase tracking-wider text-brand-600">
              {step.n}
            </div>
            <h2 className="text-lg font-semibold text-slate-900">{step.title}</h2>
            <p className="mt-1 text-sm text-slate-600">{step.body}</p>
          </li>
        ))}
      </ol>

      <p className="text-sm text-slate-600">
        Want the full privacy model?{" "}
        <Link href="/privacy-architecture" className="font-semibold text-brand-600 underline">
          Privacy Architecture
        </Link>
        .
      </p>
    </div>
  );
}
