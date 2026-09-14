"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Alias route → /pdf-tools/ai-summary */
export default function SummaryRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/pdf-tools/ai-summary");
  }, [router]);
  return (
    <p className="p-8 text-center text-slate-500" role="status">
      Opening on-device AI Summary…
    </p>
  );
}
