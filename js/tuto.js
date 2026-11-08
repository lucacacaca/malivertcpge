// Visite guidée : des bulles qui présentent les boutons principaux (au premier lancement).

const ETAPES = [
  { sel: null, titre: "Bienvenue 👋", texte: "Petite visite de l'appli en 7 étapes. Tu pourras la revoir dans Plus → Visite guidée." },
  { sel: "#btn-reviser", titre: "Réviser", texte: "Le bouton le plus important : il lance une séance avec toutes tes formules. 10–15 minutes par jour suffisent." },
  { sel: "[data-onglet='matieres']", titre: "Matières", texte: "Tes chapitres et tes fiches. Touche une formule pour voir sa fiche complète, la mettre en favori ou ne plus la réviser." },
  { sel: "[data-onglet='reviser']", titre: "Choisir quoi réviser", texte: "Révision libre, favoris, ou seulement certains chapitres (avant une colle par exemple)." },
  { sel: "[data-onglet='planning']", titre: "Planning", texte: "Tes colles et DS avec leur programme, l'ajout au calendrier, et tes notes (Résultats)." },
  { sel: "[data-onglet='plus']", titre: "Plus", texte: "Sauvegarde (même format que l'appli Android), fiches partagées, aide et installation." },
  { sel: null, titre: "Pendant une séance", texte: "Réponds d'abord dans ta tête ou sur un brouillon, puis « Afficher la réponse » et sois honnête : Raté, Difficile, Bien ou Facile. L'appli s'occupe de te redemander chaque formule au bon moment." },
];

export function lancerVisite() {
  let i = 0;
  const calque = document.createElement("div");
  calque.className = "visite";
  document.body.appendChild(calque);

  function cible() {
    const e = ETAPES[i];
    if (!e.sel) return null;
    const el = [...document.querySelectorAll(e.sel)].find((x) => x.offsetParent !== null);
    return el || null;
  }
  function afficher() {
    const e = ETAPES[i];
    const el = cible();
    let trou = "", position = "centre";
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "instant" in document.documentElement.style ? "instant" : "auto" });
      const r = el.getBoundingClientRect();
      const m = 6;
      trou = `<div class="visite-trou" style="left:${r.left - m}px;top:${r.top - m}px;width:${r.width + 2 * m}px;height:${r.height + 2 * m}px"></div>`;
      position = r.top > window.innerHeight / 2 ? "haut" : "bas";
    }
    calque.innerHTML = `${trou || `<div class="visite-fond"></div>`}
      <div class="visite-bulle ${position}">
        <div class="visite-compteur">${i + 1} / ${ETAPES.length}</div>
        <h3>${e.titre}</h3><p>${e.texte}</p>
        <div class="rangee-boutons fin">
          <button class="bouton discret" data-v="fin">${i === ETAPES.length - 1 ? "Fermer" : "Passer"}</button>
          ${i < ETAPES.length - 1 ? `<button class="bouton primaire" data-v="suivant">Suivant</button>` : `<button class="bouton primaire" data-v="fin">C'est compris !</button>`}
        </div>
      </div>`;
  }
  calque.addEventListener("click", (ev) => {
    const v = ev.target.closest("[data-v]")?.dataset.v;
    if (v === "suivant") { i++; afficher(); }
    if (v === "fin") calque.remove();
  });
  window.addEventListener("resize", () => calque.isConnected && afficher(), { once: true });
  afficher();
}
