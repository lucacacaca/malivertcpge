// Service worker : garde l'appli sur l'appareil pour qu'elle marche HORS LIGNE.
// Fichier généré par outils/construire.py (ne pas modifier à la main).
const VERSION = "__VERSION__";
const CACHE = "malivertcpge-" + VERSION;
const FICHIERS = __FICHIERS__;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FICHIERS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((cles) => Promise.all(cles.filter((k) => k.startsWith("malivertcpge-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// D'abord la copie gardée (rapide, hors ligne) ; sinon le réseau.
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((r) => r || fetch(e.request).then((rep) => {
      if (rep.ok) {
        const copie = rep.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copie));
      }
      return rep;
    }).catch(() => caches.match("index.html"))),
  );
});
