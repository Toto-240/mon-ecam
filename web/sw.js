// Garde l'interface disponible hors connexion ; les données restent en cache dans l'appli.
const CACHE = "mon-ecam-v8";
const FILES = ["./", "index.html", "app.css", "app.js", "revisions.js", "devoirs.js", "ds.js", "icon.svg", "manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.pathname.endsWith("data.enc") || url.pathname.endsWith("config.json")) return;
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        if (url.origin === location.origin) caches.open(CACHE).then((c) => c.put(e.request, r.clone()));
        return r;
      })
      .catch(() => caches.match(e.request))
  );
});
