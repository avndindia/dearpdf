"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import MaterialIcon from "@/components/MaterialIcon";

type StitchToolShellProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
  /** Extra class on the outer pdf-page (e.g. merge-page has-files). */
  className?: string;
  /** Optional short trust / caution line under the workspace. */
  note?: ReactNode;
  /** Optional related tool links under the trust strip. */
  related?: { href: string; label: string }[];
};

/**
 * Tool chrome under the global SiteHeader.
 * Brand / privacy live in SiteHeader — this shell only adds All-tools back,
 * title, workspace body, and a calm trust footer.
 */
export default function StitchToolShell({
  title,
  subtitle,
  children,
  className = "",
  note,
  related,
}: StitchToolShellProps) {
  return (
    <div className={`pdf-page stitch-tool-shell ${className}`.trim()}>
      <div className="stitch-tool-topbar">
        <div className="stitch-tool-topbar-left">
          <Link href="/pdf-tools" className="stitch-tool-back">
            <MaterialIcon name="arrow_back" className="text-[14px]" />
            <span>All tools</span>
          </Link>
        </div>
      </div>

      <header className="stitch-tool-heading">
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </header>

      <div className="stitch-tool-body">{children}</div>

      <footer className="stitch-tool-trust">
        <div className="stitch-tool-trust-main">
          <MaterialIcon name="verified_user" className="text-[16px] text-primary" />
          <span>
            {note ??
              "Processed in this browser. Nothing is uploaded. Open the download before you file or send it."}
          </span>
        </div>
        {related && related.length > 0 ? (
          <div className="stitch-tool-related">
            {related.map((item) => (
              <Link key={item.href} href={item.href}>
                {item.label}
              </Link>
            ))}
          </div>
        ) : (
          <Link href="/pdf-tools" className="stitch-tool-trust-link">
            Browse all tools
          </Link>
        )}
      </footer>
    </div>
  );
}
