const STORAGE_KEY = "dearpdf-pdf-tool-bookmarks";

function readList(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function writeList(hrefs: string[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(hrefs));
  window.dispatchEvent(new Event("dearpdf-pdf-tool-bookmarks"));
}

export function listPdfToolBookmarks() {
  return readList();
}

export function isPdfToolBookmarked(href: string) {
  return readList().includes(href);
}

export function togglePdfToolBookmark(href: string) {
  const current = readList();
  const next = current.includes(href) ? current.filter((item) => item !== href) : [...current, href];
  writeList(next);
  return next.includes(href);
}

export const PDF_TOOLS_HUB_HREF = "/#tools";

export function isPdfToolsHubBookmarked() {
  return isPdfToolBookmarked(PDF_TOOLS_HUB_HREF);
}

export function bookmarkPdfToolsHub() {
  if (!isPdfToolBookmarked(PDF_TOOLS_HUB_HREF)) togglePdfToolBookmark(PDF_TOOLS_HUB_HREF);
  return true;
}

export function unbookmarkPdfToolsHub() {
  if (isPdfToolBookmarked(PDF_TOOLS_HUB_HREF)) togglePdfToolBookmark(PDF_TOOLS_HUB_HREF);
  return false;
}

export const PDF_TOOL_BOOKMARKS_EVENT = "dearpdf-pdf-tool-bookmarks";
