"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

export const PDF_NEXT_STEPS = [
  { href: "/pdf-tools/compress", label: "Compress PDF" },
  { href: "/pdf-tools/merge", label: "Merge with another PDF" },
  { href: "/pdf-tools/organise", label: "Organise pages" },
  { href: "/pdf-tools/split", label: "Split PDF" },
  { href: "/pdf-tools/page-numbers", label: "Add page numbers" },
  { href: "/pdf-tools/watermark", label: "Add watermark" },
  { href: "/pdf-tools/sign", label: "Sign PDF" },
  { href: "/pdf-tools/ai-summary", label: "AI Summary" },
  { href: "/pdf-tools/lock", label: "Add password" },
] as const;

export default function PdfNextStepSelector() {
  const pathname = usePathname();
  const [value, setValue] = useState("download");
  const tools = PDF_NEXT_STEPS.filter((tool) => tool.href !== pathname);

  useEffect(() => {
    window.__dearPdfNextStep = value;
    return () => { window.__dearPdfNextStep = "download"; };
  }, [value]);

  return (
    <label className="pdf-next-step-selector">
      <span>After completion</span>
      <select
        value={value}
        onChange={(event) => {
          const next = event.target.value;
          window.__dearPdfNextStep = next;
          setValue(next);
        }}
        aria-label="Choose what to do after this PDF is completed"
      >
        <option value="download">Download PDF</option>
        {tools.map((tool) => <option key={tool.href} value={tool.href}>{tool.label}</option>)}
      </select>
    </label>
  );
}
