"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Bookmark,
  BookmarkCheck,
  Combine,
  Contrast,
  Crop,
  FileCog,
  FileImage,
  FileType2,
  GalleryHorizontal,
  Hash,
  Images,
  Layers,
  LockKeyhole,
  LockOpen,
  Minimize2,
  Paintbrush,
  PenLine,
  ScanText,
  Scissors,
  Signature,
  Stamp,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import {
  isPdfToolBookmarked,
  listPdfToolBookmarks,
  PDF_TOOL_BOOKMARKS_EVENT,
  togglePdfToolBookmark,
} from "../lib/pdf-tool-bookmarks";
import { pdfToolCategories, pdfTools, type PdfToolCatalogItem } from "../lib/pdf-tool-catalog";

const toolIcons: Record<string, LucideIcon> = {
  "Merge PDF": Combine,
  "Split & extract": Scissors,
  "Organise pages": GalleryHorizontal,
  "Images to PDF": Images,
  "Watermark PDF": Stamp,
  "Edit PDF": PenLine,
  "Compress PDF": Minimize2,
  "PDF to Images": FileImage,
  "PDF to Word": FileType2,
  "Add Page Numbers": Hash,
  "Crop PDF": Crop,
  "Edit Metadata": FileCog,
  "PDF OCR": ScanText,
  "Grayscale PDF": Contrast,
  "Flatten PDF": Layers,
  "Sign PDF": Signature,
  "Repair PDF": Wrench,
  "Remove Password from PDF": LockOpen,
  "Add Password to PDF": LockKeyhole,
};

function ToolCard({
  tool,
  bookmarked,
  onToggle,
}: {
  tool: PdfToolCatalogItem;
  bookmarked: boolean;
  onToggle: (href: string) => void;
}) {
  const Icon = toolIcons[tool.title] ?? Paintbrush;
  return (
    <div className={`pdf-tool-card-wrap${bookmarked ? " is-bookmarked" : ""}`}>
      <Link className="pdf-tool-card available pdf-tool-card-compact" href={tool.href} prefetch={false}>
        <span className="pdf-tool-visual" aria-hidden="true"><Icon strokeWidth={1.7} /></span>
        <h3>{tool.title}</h3>
        <p>{tool.description}</p>
      </Link>
      <button
        type="button"
        className="pdf-tool-bookmark"
        aria-pressed={bookmarked}
        aria-label={bookmarked ? `Remove bookmark for ${tool.title}` : `Bookmark ${tool.title}`}
        onClick={() => onToggle(tool.href)}
      >
        {bookmarked ? <BookmarkCheck aria-hidden="true" strokeWidth={1.8} /> : <Bookmark aria-hidden="true" strokeWidth={1.8} />}
      </button>
    </div>
  );
}

export default function PdfToolDirectory() {
  const [bookmarks, setBookmarks] = useState<string[]>([]);

  useEffect(() => {
    const sync = () => setBookmarks(listPdfToolBookmarks());
    sync();
    window.addEventListener(PDF_TOOL_BOOKMARKS_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(PDF_TOOL_BOOKMARKS_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  function onToggle(href: string) {
    togglePdfToolBookmark(href);
    setBookmarks(listPdfToolBookmarks());
  }

  const bookmarkedTools = bookmarks
    .map((href) => pdfTools.find((tool) => tool.href === href))
    .filter((tool): tool is PdfToolCatalogItem => Boolean(tool));

  return (
    <div className="pdf-directory">
      <div className="pdf-tool-groups">
        {bookmarkedTools.length ? (
          <section className="pdf-tool-bookmarked">
            <h2>Bookmarked</h2>
            <div className="pdf-tool-grid">
              {bookmarkedTools.map((tool) => (
                <ToolCard key={tool.href} tool={tool} bookmarked={isPdfToolBookmarked(tool.href)} onToggle={onToggle} />
              ))}
            </div>
          </section>
        ) : null}
        {pdfToolCategories.map((category) => {
          const tools = pdfTools.filter((tool) => tool.category === category);
          if (!tools.length) return null;
          return (
            <section key={category}>
              <h2>{category}</h2>
              <div className="pdf-tool-grid">
                {tools.map((tool) => (
                  <ToolCard key={tool.href} tool={tool} bookmarked={bookmarks.includes(tool.href)} onToggle={onToggle} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
