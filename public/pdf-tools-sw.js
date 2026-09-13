const CACHE = "dearpdf-pdf-tools-v3";
const MAX_CRAWL = 120;

function cacheable(url) {
  if (url.origin === "https://fonts.googleapis.com" || url.origin === "https://fonts.gstatic.com") return true;
  return (
    url.origin === self.location.origin &&
    (
      url.pathname.startsWith("/pdf-tools") ||
      url.pathname.startsWith("/assets/") ||
      url.pathname.startsWith("/_next/") ||
      url.pathname.startsWith("/pdfjs/") ||
      url.pathname === "/pdf.worker.min.mjs" ||
      url.pathname.startsWith("/icons/") ||
      url.pathname === "/favicon.svg" ||
      url.pathname === "/apple-touch-icon.png" ||
      url.pathname === "/pdf-tools.webmanifest" ||
      url.pathname === "/pdf-tools-sw.js"
    )
  );
}

function isRscRequest(request) {
  return Boolean(
    request.headers.get("rsc") ||
    request.headers.get("RSC") ||
    request.headers.get("Next-Router-State-Tree") ||
    request.headers.get("Next-Router-Prefetch") ||
    request.headers.get("Next-Url"),
  );
}

function cacheKey(url) {
  return url.origin === self.location.origin ? url.pathname + url.search : url.href;
}

function assetPathsFrom(text, contentType) {
  const found = new Set();
  const htmlRe = /(?:src|href)=["'](\/(?:assets|_next)\/[^"']+)["']/g;
  const jsRe = /["'](\/(?:assets|_next)\/[A-Za-z0-9._\/@-]+(?:\.[A-Za-z0-9]+)?)["']/g;
  const re = contentType.includes("text/html") ? htmlRe : jsRe;
  for (const match of text.matchAll(re)) found.add(match[1]);
  return [...found];
}

async function putAndCrawl(cache, url, response, depth, budget) {
  if (!response || !response.ok || budget.count >= MAX_CRAWL) return;
  budget.count += 1;
  const key = typeof url === "string" ? url : cacheKey(url);
  await cache.put(key, response.clone());
  if (depth > 1) return;
  const type = response.headers.get("content-type") || "";
  if (!type.includes("text/html") && !type.includes("javascript") && !type.includes("ecmascript")) return;
  const text = await response.clone().text();
  const paths = assetPathsFrom(text, type);
  await Promise.all(paths.map(async (path) => {
    if (budget.count >= MAX_CRAWL || await cache.match(path)) return;
    try {
      const next = await fetch(path, { credentials: "same-origin" });
      await putAndCrawl(cache, path, next, depth + 1, budget);
    } catch {
      // Keep precache going even if one asset is missing.
    }
  }));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll([
      "/pdf-tools",
      "/pdf-tools.webmanifest",
      "/favicon.svg",
      "/icons/pdf-tools-192.png",
      "/icons/pdf-tools-512.png",
    ])).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  const navigate = request.mode === "navigate";
  if (url.origin !== self.location.origin) {
    if (!cacheable(url)) return;
  } else if (!cacheable(url) && !navigate) {
    return;
  }
  const key = cacheKey(url);
  const asset = url.pathname.startsWith("/assets/") ||
      url.pathname.startsWith("/_next/") ||
      url.pathname.startsWith("/pdfjs/") ||
      url.pathname === "/pdf.worker.min.mjs" || url.hostname === "fonts.gstatic.com";
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (asset) {
      const cached = await cache.match(key);
      if (cached) return cached;
    }
    try {
      const fresh = await fetch(request);
      if (fresh && fresh.ok && !isRscRequest(request) && cacheable(url)) await cache.put(key, fresh.clone());
      return fresh;
    } catch {
      const cached = await cache.match(key);
      if (cached) return cached;
      if (isRscRequest(request)) {
        return new Response("", { status: 503, statusText: "offline" });
      }
      if (navigate) {
        const tools = await cache.match("/pdf-tools");
        if (tools) {
          if (url.pathname === "/pdf-tools") return tools;
          return Response.redirect(new URL("/pdf-tools", self.location.origin));
        }
      }
      throw new Error("offline");
    }
  })());
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "prefetch" || !Array.isArray(data.urls)) return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const budget = { count: 0 };
    for (const url of data.urls) {
      try {
        const response = await fetch(url, { credentials: url.startsWith("http") && !url.includes(self.location.origin) ? "omit" : "same-origin" });
        await putAndCrawl(cache, url, response, 0, budget);
      } catch {
        // Skip unreachable URLs during precache.
      }
    }
  })());
});
