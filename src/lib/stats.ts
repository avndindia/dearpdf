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

export type StatTool = (typeof STAT_TOOLS)[number];
export type StatEventType = "open" | "start" | "success" | "error" | "cancel";

const TOOL_SET = new Set<string>(STAT_TOOLS);
const SESSION_KEY = "dearpdf_sid";
const ENDPOINT = "/api/stats/event";

let inFlightTool: string | null = null;
let pagehideBound = false;

export function isStatTool(value: string): value is StatTool {
  return TOOL_SET.has(value);
}

export function toolFromPath(pathname: string): StatTool | null {
  const match = pathname.match(/^\/pdf-tools\/([^/?#]+)/);
  if (!match) return null;
  const slug = match[1];
  if (slug === "compress-split") return "compress";
  if (slug === "searchable-pdf") return "pdf-to-text";
  return isStatTool(slug) ? slug : null;
}

function randomId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sessionId() {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing && /^[a-zA-Z0-9_-]{8,64}$/.test(existing)) return existing;
    const next = randomId();
    sessionStorage.setItem(SESSION_KEY, next);
    return next;
  } catch {
    return randomId();
  }
}

function send(tool: string, eventType: StatEventType) {
  if (typeof window === "undefined" || !isStatTool(tool)) return;
  const body = JSON.stringify({
    tool,
    event_type: eventType,
    session_id: sessionId(),
  });
  try {
    if (eventType === "cancel" && typeof navigator.sendBeacon === "function") {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon(ENDPOINT, blob)) return;
    }
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Telemetry must never interrupt a tool.
  }
}

function bindPagehide() {
  if (pagehideBound || typeof window === "undefined") return;
  pagehideBound = true;
  window.addEventListener("pagehide", () => {
    if (!inFlightTool) return;
    const tool = inFlightTool;
    inFlightTool = null;
    send(tool, "cancel");
  });
}

export function trackToolEvent(tool: string, eventType: StatEventType) {
  if (!isStatTool(tool)) return;
  bindPagehide();
  if (eventType === "start") inFlightTool = tool;
  if (eventType === "success" || eventType === "error" || eventType === "cancel") {
    if (inFlightTool === tool) inFlightTool = null;
  }
  send(tool, eventType);
}

export async function runTracked<T>(
  tool: string,
  work: () => Promise<T>,
  isCancel?: (error: unknown) => boolean,
): Promise<T> {
  trackToolEvent(tool, "start");
  try {
    const result = await work();
    trackToolEvent(tool, "success");
    return result;
  } catch (error) {
    trackToolEvent(tool, isCancel?.(error) ? "cancel" : "error");
    throw error;
  }
}
