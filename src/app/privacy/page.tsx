import type { Metadata } from "next";
import PrivacyChip from "@/components/PrivacyChip";

export const metadata: Metadata = {
  title: "Privacy",
  description: "DearPDF processes PDFs entirely in your browser. Files stay on this device.",
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10 sm:px-6">
      <PrivacyChip />
      <h1 className="text-4xl font-semibold tracking-tight">Privacy</h1>
      <ul className="list-disc space-y-3 pl-5 text-lg leading-relaxed text-[var(--muted)]">
        <li>PDF and image processing happens in your browser tab.</li>
        <li>Files are not uploaded to DearPDF servers for conversion.</li>
        <li>Passwords you enter for encryption stay in memory on this device.</li>
        <li>OCR language models may be downloaded from public CDNs by Tesseract.js into your browser cache — your document itself is not sent to DearPDF.</li>
        <li>We do not require an account to use the tools.</li>
      </ul>
      <p className="leading-relaxed text-[var(--muted)]">
        Always verify the downloaded result before sharing sensitive documents.
      </p>
    </div>
  );
}
