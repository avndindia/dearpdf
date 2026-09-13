"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function SearchablePdfRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/pdf-tools/pdf-to-text");
  }, [router]);
  return (
    <div className="pdf-page" style={{ padding: "2rem" }}>
      <p>Opening PDF OCR…</p>
    </div>
  );
}
