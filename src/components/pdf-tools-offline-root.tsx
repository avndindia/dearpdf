"use client";

import { useEffect } from "react";
import { syncPdfToolsOfflinePreference } from "../lib/pdf-tools-offline";

function offlinePdfToolsLink(event: MouseEvent) {
  if (navigator.onLine) return;
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  const anchor = target.closest<HTMLAnchorElement>("a[href]");
  if (!anchor || anchor.download || (anchor.target && anchor.target !== "_self")) return;
  const nextUrl = new URL(anchor.href, window.location.href);
  if (nextUrl.origin !== window.location.origin || !nextUrl.pathname.startsWith("/pdf-tools")) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  window.location.assign(`${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
}

export default function PdfToolsOfflineRoot() {
  useEffect(() => {
    void syncPdfToolsOfflinePreference();
    document.addEventListener("click", offlinePdfToolsLink, true);
    return () => document.removeEventListener("click", offlinePdfToolsLink, true);
  }, []);
  return null;
}
