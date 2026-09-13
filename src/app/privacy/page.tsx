"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Legacy route — Cloudflare also 301s /privacy → /privacy-architecture. */
export default function PrivacyRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/privacy-architecture");
  }, [router]);
  return (
    <p className="px-4 py-10 text-center text-sm text-slate-500">
      Redirecting to Privacy Architecture…
    </p>
  );
}
