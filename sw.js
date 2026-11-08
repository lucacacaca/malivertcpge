// Service worker : garde l'appli sur l'appareil pour qu'elle marche HORS LIGNE.
// Fichier généré par outils/construire.py (ne pas modifier à la main).
const VERSION = "3c7addcac4";
const CACHE = "malivertcpge-" + VERSION;
const FICHIERS = [
  "./",
  "index.html",
  "styles.css",
  "manifest.webmanifest",
  "js/app.js",
  "js/catalogue.js",
  "js/classe.js",
  "js/db.js",
  "js/domaine.js",
  "js/edt.js",
  "js/planning.js",
  "js/rendu.js",
  "js/seance.js",
  "js/tuto.js",
  "js/util.js",
  "js/vues.js",
  "vendor/jszip.min.js",
  "vendor/sql-wasm.js",
  "vendor/sql-wasm.wasm",
  "vendor/katex/LICENSE.txt",
  "vendor/katex/katex-integre.min.css",
  "vendor/katex/katex.min.js",
  "vendor/katex/contrib/mhchem.min.js",
  "data/chapitres.json",
  "data/index.json",
  "data/schema.json",
  "data/classes/index.json",
  "data/classes/psi-2026.json",
  "data/partage/fiches_maths_pcsi.json",
  "data/partage/fiches_physique_pcsi.json",
  "data/partage/fiches_sii_pcsi.json",
  "data/partage/francais_arcanes_creation.json",
  "data/catalogue/an_chimie.json",
  "data/catalogue/an_pcsi_2.json",
  "data/catalogue/an_physique_sii.json",
  "data/catalogue/an_psi.json",
  "data/catalogue/an_sii_psi.json",
  "data/catalogue/an_supplement.json",
  "data/catalogue/formules_allemand.json",
  "data/catalogue/formules_chimie.json",
  "data/catalogue/formules_maths_pcsi_analyse.json",
  "data/catalogue/formules_maths_psi.json",
  "data/catalogue/formules_physique_pcsi.json",
  "data/catalogue/formules_physique_pcsi_2.json",
  "data/catalogue/formules_physique_psi.json",
  "data/catalogue/formules_sii_pcsi.json",
  "data/catalogue/formules_sii_psi.json",
  "icons/apple-touch-icon.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png"
];

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
