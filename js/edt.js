// Emploi du temps : créneaux de la semaine (alternance A / B), avec les colles et DS du jour.
// Même table « creneaux » que l'appli Android.

import { tous, un, executer } from "./db.js";
import { echapper, aujourdhui, couleurHex, dialogue, confirmer, toast, choisirFichier, reglages } from "./util.js";
import { heureLisible, lundi, lireHeure, titreColore, TYPES, tousLesEvenements, ongletsPlanning } from "./planning.js";
import { lireCreneaux, remplacerCreneaux, definirSemaineA, maClasse } from "./classe.js";

const NOMS_JOURS = ["", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const FORMAT = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });
const court = (j) => FORMAT.format(new Date(j * 86400000));
const versHeure = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** « A », « B » ou null (alternance non réglée) pour la semaine du jour donné. */
export function typeSemaine(jour) {
  const a = reglages.lire("lundiA", null);
  if (a == null) return null;
  const n = Math.round((lundi(jour) - a) / 7);
  return ((n % 2) + 2) % 2 === 0 ? "A" : "B";
}

const creneauxTous = () => tous(`SELECT creneaux.*, matieres.nom AS matiereNom, matieres.couleur AS matiereCouleur
  FROM creneaux LEFT JOIN matieres ON matieres.id = creneaux.matiereId ORDER BY creneaux.jour, creneaux.debut, creneaux.id`);

/** Créneaux qui ont lieu le jour donné (selon l'alternance A / B). */
export function creneauxDuJour(jour, liste = creneauxTous()) {
  const js = ((jour + 3) % 7 + 7) % 7 + 1;
  const t = typeSemaine(jour);
  return liste.filter((c) => c.jour === js && (c.semaines === "TOUTES" || !t || c.semaines === t));
}

const titreCreneau = (c) => [c.matiereNom, c.intitule && c.intitule.toLowerCase() !== String(c.matiereNom || "").toLowerCase() ? c.intitule : null].filter(Boolean).join(" — ") || "Créneau";

function carteCreneau(c, maintenant) {
  const coul = c.matiereCouleur != null ? couleurHex(c.matiereCouleur) : "#607d8b";
  return `<button class="creneau${maintenant ? " en-cours" : ""}" data-creneau="${c.id}" style="--c:${coul}">
    <span class="creneau-h">${heureLisible(c.debut)}–${heureLisible(c.fin)}${c.semaines !== "TOUTES" ? ` <span class="badge-ab">${c.semaines}</span>` : ""}</span>
    <span class="creneau-t">${echapper(titreCreneau(c))}</span>
    ${c.salle || c.professeur ? `<span class="petit muet">${[c.salle, c.professeur].filter(Boolean).map(echapper).join(" · ")}</span>` : ""}
  </button>`;
}

/** Bloc de l'accueil : les cours d'aujourd'hui (ou de demain, une fois la journée finie). */
export function blocEdtAccueil() {
  const liste = creneauxTous();
  if (!liste.length) return "";
  const j = aujourdhui();
  const d = new Date();
  const min = d.getHours() * 60 + d.getMinutes();
  let jour = j, cs = creneauxDuJour(j, liste).filter((c) => c.fin > min);
  let titre = "Aujourd'hui";
  if (!cs.length) {
    for (let k = 1; k <= 7; k++) { cs = creneauxDuJour(j + k, liste); if (cs.length) { jour = j + k; break; } }
    titre = jour === j + 1 ? "Demain" : `${NOMS_JOURS[((jour + 3) % 7 + 7) % 7 + 1]} ${court(jour)}`;
  }
  if (!cs.length) return "";
  return `<section><h2 class="titre-section">${titre}${typeSemaine(jour) ? ` · semaine ${typeSemaine(jour)}` : ""} <a class="lien petit" href="#/edt">Emploi du temps ›</a></h2>
    <div class="liste-creneaux">${cs.map((c) => carteCreneau(c, jour === j && c.debut <= min && c.fin > min)).join("")}</div></section>`;
}

// ------------------------------------------------------------------ Page Emploi du temps

export function vueEdt(el, nav, params) {
  const j = aujourdhui();
  const l = lundi(Number(params.get("s")) || j);
  const liste = creneauxTous();
  const evs = tousLesEvenements().filter((e) => e.jour >= l && e.jour < l + 7);
  const t = typeSemaine(l);
  const classe = maClasse();
  const nbJours = liste.some((c) => c.jour === 6) || evs.some((e) => e.jour === l + 5) ? 6 : 5;
  const d = new Date(), min = d.getHours() * 60 + d.getMinutes();

  el.innerHTML = `
    ${ongletsPlanning("edt")}
    <h1 class="titre-page">Emploi du temps</h1>
    <div class="nav-semaine">
      <a class="icone" href="#/edt?s=${l - 7}" aria-label="Semaine précédente">‹</a>
      <div class="centre"><b>Semaine du ${court(l)}</b>${t ? ` · <span class="badge-ab grand">Semaine ${t}</span>` : ""}
        ${l !== lundi(j) ? `<br><a class="petit" href="#/edt">Revenir à cette semaine</a>` : ""}</div>
      <a class="icone" href="#/edt?s=${l + 7}" aria-label="Semaine suivante">›</a>
    </div>
    ${liste.length ? "" : `<div class="encart accent"><div><b>Emploi du temps vide</b><p class="petit">Choisis ta classe et tes groupes : ton emploi du temps se remplit tout seul. Sinon, ajoute tes créneaux à la main ou importe un fichier.</p></div>
      <a class="bouton primaire" href="#/classe">Ma classe</a></div>`}
    <div class="semaine" style="--n:${nbJours}">
      ${Array.from({ length: nbJours }, (_, i) => {
        const jour = l + i;
        const cs = creneauxDuJour(jour, liste);
        const ep = evs.filter((e) => e.jour === jour);
        return `<div class="jour${jour === j ? " aujourdhui" : ""}">
          <h3>${NOMS_JOURS[i + 1]} <span class="muet">${court(jour)}</span></h3>
          ${ep.map((e) => `<a class="evt-mini" href="#/epreuve/${e.id}" style="--c:${(TYPES[e.type] || TYPES.AUTRE).coul}">${e.heure != null ? heureLisible(e.heure) + " · " : ""}${titreColore(e)}</a>`).join("")}
          ${cs.map((c) => carteCreneau(c, jour === j && c.debut <= min && c.fin > min)).join("") || (ep.length ? "" : `<p class="petit muet">—</p>`)}
        </div>`;
      }).join("")}
    </div>
    <div class="rangee-boutons">
      <button class="bouton primaire" id="ajouter">+ Créneau</button>
      <button class="bouton" id="importer">Importer un fichier</button>
      <a class="bouton" href="#/classe">${classe ? "Ma classe : " + echapper(classe.nom) + (classe.groupe ? " · gr. " + echapper(classe.groupe) : "") : "Ma classe"}</a>
    </div>
    <div class="encart discret"><div><b>Semaines A / B</b><p class="petit">${t ? `La semaine du ${court(l)} est une semaine ${t}.` : "Alternance non réglée : les créneaux A et B s'affichent toutes les semaines."}</p></div>
      <div class="rangee-boutons"><button class="bouton petit" data-ab="A">C'est une semaine A</button><button class="bouton petit" data-ab="B">C'est une semaine B</button></div></div>
  `;
  el.onclick = async (ev) => {
    const c = ev.target.closest("[data-creneau]");
    if (c) { if (await dialogueCreneau(un("SELECT * FROM creneaux WHERE id = ?", [Number(c.dataset.creneau)]))) nav.rafraichir(); return; }
    const ab = ev.target.closest("[data-ab]");
    if (ab) { reglages.ecrire("lundiA", ab.dataset.ab === "A" ? l : l + 7); nav.rafraichir(); }
  };
  el.querySelector("#ajouter").onclick = async () => {
    const js = ((j + 3) % 7 + 7) % 7 + 1;
    if (await dialogueCreneau({ id: 0, jour: js > 5 ? 1 : js, debut: 8 * 60, fin: 10 * 60, matiereId: null, intitule: "", salle: "", professeur: "", semaines: "TOUTES" })) nav.rafraichir();
  };
  el.querySelector("#importer").onclick = () => importerEdt(nav);
}

async function importerEdt(nav) {
  const f = await choisirFichier(".json,application/json,text/plain");
  if (!f) return;
  let racine;
  try { racine = JSON.parse(await f.text()); } catch { racine = null; }
  if (!racine || !Array.isArray(racine.creneaux)) { toast("Fichier illisible : ce n'est pas un emploi du temps au bon format.", 4500); return; }
  const { creneaux, erreurs } = lireCreneaux(racine.creneaux, tous("SELECT id, nom FROM matieres"));
  const ok = await dialogue({
    titre: "Importer un emploi du temps",
    contenu: `<p>${creneaux.length} créneau(x) lu(s). <b>L'emploi du temps actuel sera remplacé.</b></p>${erreurs.map((e) => `<p class="erreur">${echapper(e)}</p>`).join("")}`,
    boutons: [{ texte: "Annuler", valeur: false }, ...(creneaux.length ? [{ texte: "Remplacer", valeur: true, style: "primaire" }] : [])],
  });
  if (!ok) return;
  remplacerCreneaux(creneaux);
  if (racine.semaineA) definirSemaineA(racine.semaineA);
  toast(`${creneaux.length} créneau(x) importé(s) ✓`);
  nav.rafraichir();
}

async function dialogueCreneau(c) {
  const ms = tous("SELECT id, nom FROM matieres WHERE masquee = 0 ORDER BY ordre, id");
  const r = await dialogue({
    titre: c.id ? "Modifier le créneau" : "Nouveau créneau",
    contenu: `
      <label class="champ"><span>Jour</span><select id="c-jour">${NOMS_JOURS.slice(1).map((n, i) => `<option value="${i + 1}" ${c.jour === i + 1 ? "selected" : ""}>${n}</option>`).join("")}</select></label>
      <div class="deux-col"><label class="champ"><span>Début</span><input id="c-debut" type="time" value="${versHeure(c.debut)}"></label>
        <label class="champ"><span>Fin</span><input id="c-fin" type="time" value="${versHeure(c.fin)}"></label></div>
      <label class="champ"><span>Matière</span><select id="c-matiere"><option value="">Aucune</option>${ms.map((m) => `<option value="${m.id}" ${c.matiereId === m.id ? "selected" : ""}>${echapper(m.nom)}</option>`).join("")}</select></label>
      <label class="champ"><span>Intitulé (Cours, TD, TP…)</span><input id="c-intitule" maxlength="60" value="${echapper(c.intitule)}"></label>
      <div class="deux-col"><label class="champ"><span>Salle</span><input id="c-salle" maxlength="40" value="${echapper(c.salle)}"></label>
        <label class="champ"><span>Professeur</span><input id="c-prof" maxlength="60" value="${echapper(c.professeur)}"></label></div>
      <label class="champ"><span>Semaines</span><select id="c-semaines">${[["TOUTES", "Toutes les semaines"], ["A", "Semaines A"], ["B", "Semaines B"]].map(([v, t]) => `<option value="${v}" ${c.semaines === v ? "selected" : ""}>${t}</option>`).join("")}</select></label>
      <p class="erreur" id="c-erreur"></p>`,
    boutons: [
      ...(c.id ? [{ texte: "Supprimer", style: "discret texte-rouge", valeur: () => "supprimer" }] : []),
      { texte: "Annuler", valeur: false },
      {
        texte: "Enregistrer", style: "primaire",
        valeur: (f) => {
          const q = (s) => f.querySelector(s).value;
          const debut = lireHeure(q("#c-debut")), fin = lireHeure(q("#c-fin"));
          if (debut == null || fin == null || fin <= debut) { f.querySelector("#c-erreur").textContent = "L'heure de fin doit être après le début."; return undefined; }
          return { jour: Number(q("#c-jour")), debut, fin, matiereId: Number(q("#c-matiere")) || null, intitule: q("#c-intitule").trim(), salle: q("#c-salle").trim(), professeur: q("#c-prof").trim(), semaines: q("#c-semaines") };
        },
      },
    ],
  });
  if (!r) return false;
  if (r === "supprimer") {
    if (!(await confirmer("Supprimer ce créneau ?", "Il disparaîtra de l'emploi du temps.", "Supprimer", true))) return false;
    executer("DELETE FROM creneaux WHERE id = ?", [c.id]);
    return true;
  }
  const v = [r.jour, r.debut, r.fin, r.matiereId, r.intitule, r.salle, r.professeur, r.semaines];
  if (c.id) executer("UPDATE creneaux SET jour = ?, debut = ?, fin = ?, matiereId = ?, intitule = ?, salle = ?, professeur = ?, semaines = ? WHERE id = ?", [...v, c.id]);
  else executer("INSERT INTO creneaux (jour, debut, fin, matiereId, intitule, salle, professeur, semaines) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", v);
  toast("Enregistré ✓");
  return true;
}
