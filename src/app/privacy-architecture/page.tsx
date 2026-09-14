import type { Metadata } from "next";
import Link from "next/link";
import MaterialIcon from "@/components/MaterialIcon";

export const metadata: Metadata = {
  title: "Privacy Architecture",
  description:
    "How DearPDF keeps documents on-device: local browser processing and zero upload pipelines.",
};

const LAYERS = [
  {
    n: "01",
    icon: "terminal",
    title: "Browser sandbox",
    body: "PDF tools run inside your browser process. Document data is not handed to a remote conversion queue.",
  },
  {
    n: "02",
    icon: "delete_sweep",
    title: "Ephemeral working copy",
    body: "Files are held in tab memory while you work. Closing the tab clears that working copy.",
  },
  {
    n: "03",
    icon: "wifi_off",
    title: "Offline-capable after first visit",
    body: "Cached app assets let core tools keep working without an active connection.",
  },
  {
    n: "04",
    icon: "visibility_off",
    title: "No document telemetry",
    body: "Filenames and file contents are never sent. Optional anonymous usage pings (tool name, event type) may be used to improve the product.",
  },
];

export default function PrivacyArchitecturePage() {
  return (
    <div className="bg-canvas-bg">
      <div className="mx-auto max-w-4xl space-y-10 px-4 py-10 sm:px-6">
        <div>
          <div className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-security-bg px-2.5 py-1 text-[11px] font-medium text-security-emerald">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-security-emerald" />
            Nothing uploaded · Local browser processing
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-on-surface sm:text-4xl">
            Privacy Architecture
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-slate-600">
            DearPDF is built so contracts, invoices, and scans do not need to leave this device.
            Processing is intentional local compute — not a privacy mode bolted onto an upload
            queue.
          </p>
        </div>

        <section className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-border-subtle bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <MaterialIcon name="cloud_off" className="text-[20px] text-slate-400" />
              <h3 className="text-base font-bold text-on-surface">Typical cloud converters</h3>
            </div>
            <ul className="space-y-3 text-sm text-slate-600">
              <li className="flex gap-2">
                <MaterialIcon name="cancel" className="mt-0.5 shrink-0 text-[16px] text-rose-500" />
                Multipart upload of your raw document to remote servers
              </li>
              <li className="flex gap-2">
                <MaterialIcon name="cancel" className="mt-0.5 shrink-0 text-[16px] text-rose-500" />
                Temporary files written on someone else’s disk
              </li>
              <li className="flex gap-2">
                <MaterialIcon name="cancel" className="mt-0.5 shrink-0 text-[16px] text-rose-500" />
                Download links and logs that can linger
              </li>
            </ul>
            <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
              Your document leaves your device and may be retained longer than you expect.
            </p>
          </div>

          <div className="rounded-2xl border border-brand-200 bg-rose-subtle/50 p-5 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <MaterialIcon name="verified_user" className="text-[20px] text-primary-container" />
              <h3 className="text-base font-bold text-on-surface">DearPDF client-side engine</h3>
            </div>
            <ul className="space-y-3 text-sm text-slate-700">
              <li className="flex gap-2">
                <MaterialIcon name="check_circle" className="mt-0.5 shrink-0 text-[16px] text-security-emerald" />
                Direct file open in this browser tab
              </li>
              <li className="flex gap-2">
                <MaterialIcon name="check_circle" className="mt-0.5 shrink-0 text-[16px] text-security-emerald" />
                Local processing for merge, compress, OCR, and more
              </li>
              <li className="flex gap-2">
                <MaterialIcon name="check_circle" className="mt-0.5 shrink-0 text-[16px] text-security-emerald" />
                Instant local download — no remote staging URL required
              </li>
            </ul>
            <p className="mt-4 rounded-lg border border-emerald-200 bg-security-bg px-3 py-2 text-[12px] font-medium text-security-emerald">
              Built so documents do not need to be uploaded for conversion.
            </p>
          </div>
        </section>

        <section>
          <div className="mb-4">
            <h2 className="text-xl font-bold tracking-tight text-on-surface">
              Four layers of isolation
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Defense-in-depth guarantees for every DearPDF tool.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {LAYERS.map((layer) => (
              <div
                key={layer.n}
                className="rounded-2xl border border-border-subtle bg-white p-4 shadow-sm"
              >
                <div className="mb-2 flex items-center gap-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-rose-tint bg-rose-subtle text-primary-container">
                    <MaterialIcon name={layer.icon} className="text-[18px]" />
                  </div>
                  <div>
                    <div className="font-mono text-[10px] font-semibold uppercase tracking-wider text-primary-container">
                      {layer.n}
                    </div>
                    <h3 className="text-sm font-bold text-on-surface">{layer.title}</h3>
                  </div>
                </div>
                <p className="text-[13px] leading-relaxed text-slate-600">{layer.body}</p>
              </div>
            ))}
          </div>
        </section>

        <ul className="space-y-3 text-slate-600">
          {[
            "PDF and image processing happen in your browser tab.",
            "Files are not uploaded to DearPDF servers for conversion.",
            "Passwords for encryption stay in memory on this device.",
            "OCR language models may be downloaded from public CDNs by Tesseract.js into your browser cache — your document itself is not sent to DearPDF.",
            "No account is required to use the tools.",
            "Anonymous usage pings may be sent (tool name, event type, time, random session id) so we can see which tools are used. Filenames and file contents are never sent.",
          ].map((item) => (
            <li
              key={item}
              className="flex gap-2 rounded-2xl border border-border-subtle bg-white p-3.5 text-sm shadow-sm"
            >
              <MaterialIcon name="verified" className="mt-0.5 shrink-0 text-[18px] text-security-emerald" />
              <span>{item}</span>
            </li>
          ))}
        </ul>

        <div className="rounded-xl border border-slate-800 bg-tech-black p-4 font-mono text-[11px] text-slate-100 shadow-md">
          <div className="mb-2 flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="text-slate-400">What a network inspector should show for your PDF</span>
            <span className="font-semibold text-emerald-400">0 B document transfer</span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-slate-300">
            <span className="text-emerald-400">your-document.pdf</span>
            <span>local memory / Blob</span>
            <span className="font-bold text-emerald-400">not uploaded</span>
          </div>
        </div>

        <p className="text-sm text-slate-600">
          Always verify the downloaded result before sharing sensitive documents.{" "}
          <Link href="/how-it-works" className="font-semibold text-primary-container underline">
            How it Works
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
