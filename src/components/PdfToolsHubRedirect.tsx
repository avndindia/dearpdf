"use client";

import Link from "next/link";
import { useEffect } from "react";

/** /pdf-tools catalog duplicated home — send users to the home tools section. */
export default function PdfToolsHubRedirect() {
  useEffect(() => {
    window.location.replace("/#tools");
  }, []);

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-3 px-4 py-20 text-center">
      <p className="text-sm font-medium text-on-surface">Opening all tools…</p>
      <p className="text-[13px] text-slate-500">
        The full directory lives on the home page.{" "}
        <Link href="/#tools" className="font-semibold text-primary-container underline underline-offset-2">
          Continue to tools
        </Link>
      </p>
    </div>
  );
}
