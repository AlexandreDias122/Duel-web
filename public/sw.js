// Service worker : l'appli reste utilisable hors ligne une fois les cartes et scripts chargés.
const STATIC = "duelweb-static-v1";
const RUNTIME = "duelweb-runtime-v1";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(STATIC).then((c) => c.addAll(["./", "./index.html", "./manifest.webmanifest", "./icon.svg"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Les illustrations externes restent dans le cache HTTP du navigateur
  // (les réponses opaques coûtent très cher en quota sur Safari).
  if (url.origin !== location.origin) return;
  // Scripts Lua et fichiers compilés (nom versionné) : cache d'abord.
  if (url.pathname.includes("/scripts/") || url.pathname.includes("/assets/")) {
    e.respondWith(cacheFirst(RUNTIME, req));
    return;
  }
  // Données et page : réseau d'abord, cache en secours hors ligne.
  e.respondWith(networkFirst(url.pathname.includes("/data/") ? RUNTIME : STATIC, req));
});

async function cacheFirst(name, req) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function networkFirst(name, req) {
  const cache = await caches.open(name);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}
