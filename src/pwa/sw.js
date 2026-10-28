// Service Worker
// HTML はネットワーク優先（取れたらキャッシュを更新、オフラインならキャッシュ）、それ以外はキャッシュ優先。
// キャッシュ優先にすると、修正を公開しても iPhone に古い HTML が残り続けるため。

const VERSION = "__VERSION__";
const CACHE = `tlog-${VERSION}`;
const PRECACHE = [
  "./",
  "index.html",
  "model.html",
  "check.html",
  "manifest.webmanifest",
  "icons/icon-180.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("tlog-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isHtml(req) {
  return req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html");
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    // ?app=1 や #id が付いていても同じページのキャッシュを返す
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  // Google Fonts は取得時にキャッシュ（opaque な応答も含む）
  if (res.ok || res.type === "opaque") cache.put(req, res.clone());
  return res;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const fonts = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  if (!sameOrigin && !fonts) return;
  e.respondWith(sameOrigin && isHtml(req) ? networkFirst(req) : cacheFirst(req));
});
