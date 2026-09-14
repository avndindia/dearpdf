export interface Env {
  DB: D1Database;
  ADMIN_PASSWORD?: string;
  ADMIN_SESSION_SECRET?: string;
}

export const STAT_TOOLS = [
  "merge",
  "split",
  "organise",
  "compress",
  "page-numbers",
  "crop",
  "edit",
  "sign",
  "watermark",
  "metadata",
  "flatten",
  "pdf-to-text",
  "pdf-to-word",
  "images-to-pdf",
  "pdf-to-images",
  "grayscale",
  "repair",
  "unlock",
  "lock",
] as const;

export const EVENT_TYPES = ["open", "start", "success", "error", "cancel"] as const;

export type StatTool = (typeof STAT_TOOLS)[number];
export type StatEventType = (typeof EVENT_TYPES)[number];

export const TOOL_LABELS: Record<StatTool, string> = {
  merge: "Merge PDF",
  split: "Split & Extract",
  organise: "Organise Pages",
  compress: "Compress PDF",
  "page-numbers": "Page Numbers",
  crop: "Crop PDF",
  edit: "Edit PDF",
  sign: "Sign PDF",
  watermark: "Watermark",
  metadata: "Metadata",
  flatten: "Flatten PDF",
  "pdf-to-text": "PDF OCR",
  "pdf-to-word": "PDF to Word",
  "images-to-pdf": "Images to PDF",
  "pdf-to-images": "PDF to Images",
  grayscale: "Grayscale",
  repair: "Repair PDF",
  unlock: "Remove Password",
  lock: "Add Password",
};

export function json(data: unknown, status = 200, extra?: HeadersInit) {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  if (extra) new Headers(extra).forEach((value, key) => headers.set(key, value));
  return new Response(JSON.stringify(data), { status, headers });
}
