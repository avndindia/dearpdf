import { pdfTools } from "./pdf-tool-catalog";

const PREFERENCE_KEY = "dearpdf-pdf-tools-offline";
const SW_URL = "/pdf-tools-sw.js";

export function isPdfToolsOfflineEnabled() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(PREFERENCE_KEY) === "1";
}

function pageAssetUrls() {
  return [
    ...Array.from(document.querySelectorAll("script[src], link[rel='stylesheet'], link[rel='modulepreload'], link[rel='preload']")),
  ]
    .map((node) => ("src" in node ? String((node as HTMLScriptElement).src) : String((node as HTMLLinkElement).href)))
    .filter(Boolean);
}

async function waitForServiceWorkerControl() {
  if (navigator.serviceWorker.controller) return;
  await new Promise<void>((resolve) => {
    const finish = () => resolve();
    navigator.serviceWorker.addEventListener("controllerchange", finish, { once: true });
    window.setTimeout(finish, 8000);
  });
}

export async function enablePdfToolsOffline() {
  if (!("serviceWorker" in navigator)) {
    throw new Error("This browser cannot keep PDF tools offline.");
  }
  window.localStorage.setItem(PREFERENCE_KEY, "1");
  const registration = await navigator.serviceWorker.register(SW_URL, { scope: "/", updateViaCache: "none" });
  await navigator.serviceWorker.ready;
  await waitForServiceWorkerControl();
  const catalog = [
    "/pdf-tools",
    "/pdf-tools.webmanifest",
    "/favicon.svg",
    "/icons/pdf-tools-192.png",
    "/icons/pdf-tools-512.png",
    ...pdfTools.map((tool) => tool.href),
    ...pageAssetUrls(),
  ];
  registration.active?.postMessage({ type: "prefetch", urls: catalog });
}

export async function disablePdfToolsOffline() {
  window.localStorage.removeItem(PREFERENCE_KEY);
  if (!("serviceWorker" in navigator)) return;
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(
    registrations
      .filter((registration) => registration.active?.scriptURL.includes("pdf-tools-sw.js") || registration.installing?.scriptURL.includes("pdf-tools-sw.js"))
      .map((registration) => registration.unregister()),
  );
  if ("caches" in window) {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith("dc-pdf-tools")).map((key) => caches.delete(key)));
  }
}

export async function syncPdfToolsOfflinePreference() {
  try {
    await enablePdfToolsOffline();
  } catch {
    /* Browsers without service workers still run the tools online. */
  }
}
