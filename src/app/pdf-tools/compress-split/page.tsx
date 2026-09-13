"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function CompressSplitRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/pdf-tools/compress?split=1");
  }, [router]);
  return (
    <div className="pdf-page" style={{ padding: "2rem" }}>
      <p>Opening Compress with size-split…</p>
    </div>
  );
}
