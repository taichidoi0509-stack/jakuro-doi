const CACHE_NAME = "moriken-mahjong-v67";

const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./assets/mahjong/1m.gif",
  "./assets/mahjong/1p.gif",
  "./assets/mahjong/1s.gif",
  "./assets/mahjong/1z.gif",
  "./assets/mahjong/2m.gif",
  "./assets/mahjong/2p.gif",
  "./assets/mahjong/2s.gif",
  "./assets/mahjong/2z.gif",
  "./assets/mahjong/3m.gif",
  "./assets/mahjong/3p.gif",
  "./assets/mahjong/3s.gif",
  "./assets/mahjong/3z.gif",
  "./assets/mahjong/4m.gif",
  "./assets/mahjong/4p.gif",
  "./assets/mahjong/4s.gif",
  "./assets/mahjong/4z.gif",
  "./assets/mahjong/5m.gif",
  "./assets/mahjong/5p.gif",
  "./assets/mahjong/5pr.gif",
  "./assets/mahjong/5s.gif",
  "./assets/mahjong/5sr.gif",
  "./assets/mahjong/5z.gif",
  "./assets/mahjong/6m.gif",
  "./assets/mahjong/6p.gif",
  "./assets/mahjong/6s.gif",
  "./assets/mahjong/6z.gif",
  "./assets/mahjong/7m.gif",
  "./assets/mahjong/7p.gif",
  "./assets/mahjong/7s.gif",
  "./assets/mahjong/7z.gif",
  "./assets/mahjong/8m.gif",
  "./assets/mahjong/8p.gif",
  "./assets/mahjong/8s.gif",
  "./assets/mahjong/9m.gif",
  "./assets/mahjong/9p.gif",
  "./assets/mahjong/9s.gif",
  "./assets/mahjong/blank.gif",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((cacheName) => cacheName !== CACHE_NAME)
            .map((cacheName) => caches.delete(cacheName))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.ok) {
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, response.clone());
          });
        }
        return response;
      })
      .catch(async () => {
        const cachedResponse = await caches.match(event.request);
        if (cachedResponse) return cachedResponse;
        if (event.request.mode === "navigate") return caches.match("./index.html");
        return Response.error();
      })
  );
});
