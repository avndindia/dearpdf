import type { Metadata } from "next";
import Link from "next/link";
import MaterialIcon from "@/components/MaterialIcon";

export const metadata: Metadata = {
  title: "How it Works",
  description:
    "DearPDF runs PDF tools entirely in your browser — nothing is uploaded to our servers.",
};

const STEPS = [
  {
    n: "01",
    icon: "folder_open",
    title: "Open on this device",
    body: "You pick a file with your browser. It is read into this tab’s memory — not posted to a conversion API.",
    chip: "0 bytes sent",
  },
  {
    n: "02",
    icon: "memory",
    title: "Edit in your browser",
    body: "Merge, compress, OCR, and the other tools run locally on your CPU. Heavy work stays on-device.",
    chip: "Local processing",
  },
  {
    n: "03",
    icon: "download_for_offline",
    title: "Download the result",
    body: "The finished PDF is saved from a local download link. Close the tab and the working copy is gone.",
    chip: "Instant download",
  },
];

const FAQS = [
  {
    q: "Can DearPDF see my confidential documents?",
    a: "No. Document bytes are not uploaded to DearPDF servers for conversion. Processing happens in your browser tab.",
  },
  {
    q: "Does it work offline?",
    a: "After the first visit, core tools can keep working offline via the app’s cached assets.",
  },
  {
    q: "Is there a file size limit?",
    a: "There is no artificial paywall limit. Very large files are constrained only by your device memory.",
  },
  {
    q: "What powers the tools?",
    a: "Browser-native libraries (including WebAssembly engines) for PDF, images, and OCR — all running locally.",
  },
];

export default function HowItWorksPage() {
  return (
    <div className="bg-canvas-bg">
      <div className="mx-auto max-w-4xl space-y-10 px-4 py-10 sm:px-6">
        <div>
          <div className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-rose-subtle px-3 py-1 text-[11px] font-semibold text-primary-container">
            <MaterialIcon name="verified_user" className="text-[15px]" />
            Local browser tools — no cloud upload
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-on-surface sm:text-4xl">
            How DearPDF works
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-slate-600">
            Every tool processes your file in this browser. Open a document, make the change,
            download the result — without sending the PDF to DearPDF servers.
          </p>
        </div>

        <section>
          <h2 className="mb-4 text-xl font-bold tracking-tight text-on-surface">
            The 3-step pipeline
          </h2>
          <ol className="space-y-4">
            {STEPS.map((step) => (
              <li
                key={step.n}
                className="rounded-2xl border border-border-subtle bg-white p-5 shadow-sm"
              >
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-rose-tint bg-rose-subtle text-primary-container">
                      <MaterialIcon name={step.icon} className="text-[20px]" />
                    </div>
                    <div>
                      <div className="font-mono text-[11px] font-semibold uppercase tracking-wider text-primary-container">
                        {step.n}
                      </div>
                      <h3 className="text-lg font-semibold text-on-surface">{step.title}</h3>
                    </div>
                  </div>
                  <span className="rounded-full border border-emerald-200 bg-security-bg px-2.5 py-0.5 font-mono text-[11px] font-semibold text-security-emerald">
                    {step.chip}
                  </span>
                </div>
                <p className="text-sm leading-relaxed text-slate-600">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-border-subtle bg-white p-5 shadow-sm">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Typical cloud converter
            </div>
            <ul className="space-y-2 text-sm text-slate-600">
              <li>Upload file to a remote server</li>
              <li>Wait for server processing</li>
              <li>Download from a temporary link</li>
            </ul>
            <p className="mt-3 text-[12px] text-amber-700">Your document leaves your device.</p>
          </div>
          <div className="rounded-2xl border border-brand-200 bg-rose-subtle/40 p-5 shadow-sm">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-primary-container">
              DearPDF
            </div>
            <ul className="space-y-2 text-sm text-slate-700">
              <li>Open file in this tab</li>
              <li>Process locally in the browser</li>
              <li>Save result from a local download</li>
            </ul>
            <p className="mt-3 text-[12px] font-semibold text-security-emerald">
              Document stays on this device.
            </p>
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-xl font-bold tracking-tight text-on-surface">FAQ</h2>
          <p className="mb-4 text-sm text-slate-500">
            Plain answers about private, in-browser PDF tools.
          </p>
          <div className="space-y-3">
            {FAQS.map((item) => (
              <details
                key={item.q}
                className="group rounded-2xl border border-border-subtle bg-white p-4 shadow-sm open:border-brand-300"
              >
                <summary className="cursor-pointer list-none text-sm font-semibold text-on-surface marker:content-none">
                  <span className="flex items-center justify-between gap-3">
                    {item.q}
                    <MaterialIcon
                      name="expand_more"
                      className="text-[18px] text-slate-400 transition group-open:rotate-180"
                    />
                  </span>
                </summary>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        <div className="flex flex-col items-start justify-between gap-4 rounded-2xl border border-border-subtle bg-white p-5 shadow-sm sm:flex-row sm:items-center">
          <div>
            <h3 className="text-base font-bold text-on-surface">Try a tool now</h3>
            <p className="text-sm text-slate-500">Nothing uploaded. Start with Merge or Compress.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/pdf-tools/merge"
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-cta to-ruby-deep px-4 py-2 text-sm font-semibold text-white shadow-[0_2px_8px_rgba(225,29,72,0.35)]"
            >
              <MaterialIcon name="call_merge" className="text-[16px]" />
              Merge PDF
            </Link>
            <Link
              href="/#tools"
              className="inline-flex items-center gap-1.5 rounded-xl border border-border-subtle bg-white px-4 py-2 text-sm font-semibold text-on-surface hover:border-brand-300 hover:bg-rose-subtle"
            >
              All tools
              <MaterialIcon name="arrow_forward" className="text-[16px]" />
            </Link>
          </div>
        </div>

        <p className="text-sm text-slate-600">
          Want the full privacy model?{" "}
          <Link href="/privacy-architecture" className="font-semibold text-primary-container underline">
            Privacy Architecture
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
