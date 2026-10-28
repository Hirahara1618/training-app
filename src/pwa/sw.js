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

// 模型のメッシュ（名前に中身のハッシュ入り）は版をまたいで残す別のキャッシュに置く。
// 最初に模型を開いたときに入る（スマホは軽量版だけを取るので、事前には取らない）
const MESH_CACHE = "tlog-mesh";
const MESH_FILES = __MESH_FILES__;

// 古い版のキャッシュを消す。有効化のときに加えて、ページを開くたびにも行う
// （入れ替わりの直前に古い Service Worker が書き込み中だと、消したあとに古いキャッシュが作り直されることがある）
async function removeOldCaches() {
  const keys = await caches.keys();
  await Promise.all(keys.filter((k) => k.startsWith("tlog-") && k !== CACHE && k !== MESH_CACHE).map((k) => caches.delete(k)));
}

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    await removeOldCaches();
    // 今の版で使わないメッシュを消す
    const mesh = await caches.open(MESH_CACHE);
    for (const req of await mesh.keys()) {
      if (!MESH_FILES.some((f) => new URL(f, self.registration.scope).href === req.url)) await mesh.delete(req);
    }
    await self.clients.claim();
  })());
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

async function cacheFirst(req, name) {
  const cache = await caches.open(name || CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  // Google Fonts は取得時にキャッシュ（opaque な応答も含む）
  if (res.ok || res.type === "opaque") cache.put(req, res.clone());
  return res;
}

// 休憩タイマーの通知（通知サーバーからの本文なしの Push）
self.addEventListener("push", (e) => {
  e.waitUntil(self.registration.showNotification("休憩終了", {
    body: "次のセットを始めましょう",
    tag: "rest",
    renotify: true,
    icon: "icons/icon-192.png",
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of list) if (c.url.startsWith(self.registration.scope) && "focus" in c) return c.focus();
    return self.clients.openWindow("./");
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const fonts = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  if (!sameOrigin && !fonts) return;
  if (sameOrigin && url.pathname.endsWith(".bin")) { e.respondWith(cacheFirst(req, MESH_CACHE)); return; }
  if (sameOrigin && req.mode === "navigate") e.waitUntil(removeOldCaches());
  e.respondWith(sameOrigin && isHtml(req) ? networkFirst(req) : cacheFirst(req));
});
