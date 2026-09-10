import PrivacyChip from "@/components/PrivacyChip";
import HomeTools from "@/components/HomeTools";

export default function HomePage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-16 pt-4 sm:px-6">
      <section className="mb-12 space-y-5 pt-6 sm:pt-10">
        <PrivacyChip />
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-[var(--ink)] sm:text-5xl lg:text-6xl">
          Drop a file. Get it back fixed.{" "}
          <span className="text-[var(--accent)]">Nothing uploaded.</span>
        </h1>
        <p className="max-w-2xl text-lg leading-relaxed text-[var(--muted)] sm:text-xl">
          Warm, quiet PDF tools that run entirely in your browser. Your
          documents never leave this device.
        </p>
      </section>
      <HomeTools />
    </div>
  );
}
