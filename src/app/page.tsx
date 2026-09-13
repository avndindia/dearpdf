import Link from "next/link";
import PrivacyChip from "@/components/PrivacyChip";
import PdfToolDirectory from "@/components/pdf-tool-directory";
import PdfPrivacyStrip from "@/components/pdf-privacy-strip";
import PdfToolsInstall from "@/components/pdf-tools-install";

export default function HomePage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-16 pt-4 sm:px-6">
      <section className="mb-10 space-y-5 pt-6 sm:pt-10">
        <PrivacyChip />
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-[var(--ink)] sm:text-5xl lg:text-6xl">
          Drop a file. Get it back fixed.{" "}
          <span className="text-[var(--accent)]">Nothing uploaded.</span>
        </h1>
        <p className="max-w-2xl text-lg leading-relaxed text-[var(--muted)] sm:text-xl">
          Warm, quiet PDF tools that run entirely in your browser. Your
          documents never leave this device.
        </p>
        <p>
          <Link
            href="/pdf-tools"
            className="inline-flex items-center rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[var(--accent-hover)]"
          >
            Browse all PDF tools
          </Link>
        </p>
      </section>

      <section className="pdf-page !w-full !max-w-none" aria-labelledby="home-tools-title">
        <div className="pdf-tools-heading mb-4">
          <div>
            <h2 id="home-tools-title" className="text-2xl font-semibold tracking-tight">
              Tools
            </h2>
            <PdfPrivacyStrip />
          </div>
          <PdfToolsInstall />
        </div>
        <PdfToolDirectory />
      </section>
    </div>
  );
}
