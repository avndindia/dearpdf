import type { Metadata } from "next";
import Link from "next/link";
import MaterialIcon from "@/components/MaterialIcon";

export const metadata: Metadata = {
  title: "Privacy Architecture",
  description:
    "How DearPDF keeps documents on-device: WebAssembly, Blob URLs, and zero upload pipelines.",
};

export default function PrivacyArchitecturePage() {
  return (
    <div className="mx-auto max-w-[800px] space-y-8 px-4 py-10 sm:px-6">
      <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
        Wasm Sandbox Active · 0 B document transfer
      </div>
      <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
        Privacy Architecture
      </h1>
      <p className="text-base leading-relaxed text-slate-600">
        DearPDF is built so confidential contracts, invoices, and scans never need
        to leave this device. Processing is intentional local compute — not a
        “privacy mode” bolted onto an upload queue.
      </p>

      <ul className="space-y-3 text-slate-600">
        {[
          "PDF and image processing happen in your browser tab (WebAssembly + canvas).",
          "Files are not uploaded to DearPDF servers for conversion.",
          "Passwords for encryption stay in memory on this device.",
          "OCR language models may be downloaded from public CDNs by Tesseract.js into your browser cache — your document itself is not sent to DearPDF.",
          "No account is required to use the tools.",
          "Verify results in DevTools Network: document requests show 0 B transferred (memory / cache only).",
        ].map((item) => (
          <li
            key={item}
            className="flex gap-2 rounded-xl border border-slate-200 bg-white p-3.5 text-sm shadow-sm"
          >
            <MaterialIcon name="verified" className="mt-0.5 shrink-0 text-[18px] text-emerald-600" />
            <span>{item}</span>
          </li>
        ))}
      </ul>

      <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 font-mono text-[11px] text-slate-100 shadow-md">
        <div className="mb-2 flex items-center justify-between border-b border-slate-800 pb-2">
          <span className="text-slate-400">DevTools Network (illustrative)</span>
          <span className="font-semibold text-emerald-400">Verified 0B</span>
        </div>
        <div className="flex justify-between text-slate-300">
          <span className="text-emerald-400">confidential_contract.pdf</span>
          <span>MEM_BLOB</span>
          <span className="font-bold text-emerald-400">0 B (0 packets)</span>
        </div>
      </div>

      <p className="text-sm text-slate-600">
        Always verify the downloaded result before sharing sensitive documents.{" "}
        <Link href="/how-it-works" className="font-semibold text-brand-600 underline">
          How it Works
        </Link>
        .
      </p>
    </div>
  );
}
