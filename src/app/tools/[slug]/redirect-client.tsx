"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function LegacyToolRedirectClient({ target }: { target: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(target);
  }, [router, target]);
  return (
    <div className="mx-auto max-w-5xl px-4 py-16 text-[var(--muted)]">
      Opening the updated tool…
    </div>
  );
}
