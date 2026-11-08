// Écrans de l'appli (sauf la séance de révision, dans seance.js).

import { tous, un, valeur, executer, dernierId, exporterSauvegarde, analyserSauvegarde, restaurerSauvegarde, resumeSauvegarde, nomSauvegarde, reinitialiser } from "./db.js";
import { lesCatalogues, cataloguePour, ajouterChapitres, completerFormules, lireFiches, importerFiches, fichesPartagees, ajouterFichesPartagees } from "./catalogue.js";
import { rendreMath, ficheFormule } from "./rendu.js";
import {
  echapper, aujourdhui, debutDuJourMillis, dateLisible, delaiLisible, couleurHex, couleurArgb, dialogue, confirmer, toast,
  telecharger, choisirFichier, reglages, simplifier,
} from "./util.js";

export const VERSION_APPLI = "W1 · 1.0";

const pct = (x) => Math.round(x * 100);
const LIB_PROGRAMME = { PCSI: "PCSI", PSI: "PSI", LES_DEUX: "PCSI + PSI" };

// ------------------------------------------------------------------ Données utiles

function progressionChapitres() {
  const jour = aujourdhui();
  return tous(`SELECT chapitres.id AS chapitreId, chapitres.titre AS titre, chapitres.matiereId AS matiereId,
      matieres.nom AS matiere, COALESCE(chapitres.couleur, matieres.couleur) AS couleur,
      (SELECT COUNT(*) FROM formules f WHERE f.chapitreId = chapitres.id AND f.horsRevision = 0) AS nbFormules,
      (SELECT COUNT(*) FROM cartes c INNER JOIN formules f ON f.id = c.formuleId WHERE f.chapitreId = chapitres.id) AS nbCartes,
      (SELECT COALESCE(SUM(MIN(c.boite, 6)), 0) FROM cartes c INNER JOIN formules f ON f.id = c.formuleId
        WHERE f.chapitreId = chapitres.id AND c.nbRevisions > 0) AS points,
      (SELECT COUNT(*) FROM cartes c INNER JOIN formules f ON f.id = c.formuleId
        WHERE f.chapitreId = chapitres.id AND c.prochaine IS NOT NULL AND c.prochaine <= ?) AS dues
    FROM chapitres INNER JOIN matieres ON matieres.id = chapitres.matiereId
    WHERE chapitres.masque = 0 AND matieres.masquee = 0
    ORDER BY matieres.ordre, chapitres.ordre, chapitres.id`, [jour])
    .map((p) => {
      const attendues = Math.max(p.nbCartes, 2 * p.nbFormules);
      return { ...p, progression: attendues ? Math.min(1, p.points / (6 * attendues)) : 0 };
    });
}

function barre(x, couleur) {
  return `<div class="barre"><div style="width:${pct(x)}%;background:${couleur}"></div></div>`;
}

function statsJour() {
  const jour = aujourdhui();
  const filtre = `FROM cartes c INNER JOIN formules f ON f.id = c.formuleId INNER JOIN chapitres ch ON ch.id = f.chapitreId
    INNER JOIN matieres m ON m.id = ch.matiereId WHERE ch.masque = 0 AND m.masquee = 0 AND f.horsRevision = 0`;
  return {
    dues: valeur(`SELECT COUNT(*) ${filtre} AND c.prochaine IS NOT NULL AND c.prochaine <= ?`, [jour]),
    jamais: valeur(`SELECT COUNT(*) FROM formules f INNER JOIN chapitres ch ON ch.id = f.chapitreId
      INNER JOIN matieres m ON m.id = ch.matiereId WHERE ch.masque = 0 AND m.masquee = 0 AND f.horsRevision = 0
      AND NOT EXISTS (SELECT 1 FROM cartes c WHERE c.formuleId = f.id AND c.prochaine IS NOT NULL)`),
    aujourdhui: valeur("SELECT COUNT(*) FROM revisions WHERE instant >= ?", [debutDuJourMillis()]),
    formules: valeur(`SELECT COUNT(*) FROM formules f INNER JOIN chapitres ch ON ch.id = f.chapitreId
      INNER JOIN matieres m ON m.id = ch.matiereId WHERE ch.masque = 0 AND m.masquee = 0 AND f.horsRevision = 0`),
    favoris: valeur("SELECT COUNT(*) FROM formules WHERE favori = 1 AND horsRevision = 0"),
  };
}

function joursDepuisSauvegarde() {
  const d = reglages.lire("derniereSauvegarde", null);
  return d ? Math.floor((Date.now() - d) / 86400000) : null;
}

// ------------------------------------------------------------------ Accueil

export function vueAccueil(el, nav) {
  const s = statsJour();
  const progression = progressionChapitres();
  const parMatiere = new Map();
  for (const p of progression) {
    if (!parMatiere.has(p.matiereId)) parMatiere.set(p.matiereId, { nom: p.matiere, couleur: p.couleur, somme: 0, n: 0 });
    const m = parMatiere.get(p.matiereId);
    if (p.nbFormules > 0) { m.somme += p.progression; m.n++; }
  }
  const objectifs = tous("SELECT * FROM objectifs WHERE jour >= ? ORDER BY jour LIMIT 3", [aujourdhui()]);
  const jSauv = joursDepuisSauvegarde();
  const heure = new Date().getHours();
  const salut = heure < 6 ? "Bonne nuit" : heure < 18 ? "Bonjour" : "Bonsoir";

  el.innerHTML = `
    <h1 class="titre-page">${salut} 👋</h1>
    ${nav.peutInstaller() ? `<div class="encart accent" id="encart-installer"><div><b>Installe l'appli</b><p class="petit">Elle s'ouvrira comme une vraie appli, même hors ligne.</p></div><button class="bouton primaire" data-nav="#/installer">Comment ?</button></div>` : ""}
    <section class="carte-acc">
      <div class="chiffres">
        <div><b>${s.dues}</b><span>cartes à revoir aujourd'hui</span></div>
        <div><b>${s.aujourdhui}</b><span>réponses aujourd'hui</span></div>
        <div><b>${s.formules}</b><span>formules</span></div>
      </div>
      <button class="bouton primaire large" id="btn-reviser" data-nav="#/seance">▶ Réviser maintenant</button>
      <p class="petit muet centre">${s.dues ? "On commence par faire le tour de tes formules, puis les cartes dues." : s.jamais ? `${s.jamais} formule(s) jamais vue(s) t'attendent.` : "Tout est à jour : une petite séance d'entretien ?"}</p>
    </section>
    ${objectifs.length ? `<section><h2 class="titre-section">Colles et DS à préparer</h2>${objectifs.map((o) => `
      <div class="ligne">
        <div class="ligne-texte"><b>${echapper(o.titre)}</b><span class="petit muet">${dateLisible(o.jour)} · ${delaiLisible(o.jour)}</span></div>
        <button class="bouton petit" data-nav="#/seance?o=${o.id}">Réviser</button>
      </div>`).join("")}</section>` : ""}
    <section>
      <h2 class="titre-section">Progression</h2>
      ${parMatiere.size ? [...parMatiere.values()].filter((m) => m.n).map((m) => `
        <div class="ligne-progression">
          <span class="pastille" style="background:${couleurHex(m.couleur)}"></span>
          <span class="nom">${echapper(m.nom)}</span>
          ${barre(m.somme / m.n, couleurHex(m.couleur))}
          <span class="pct">${pct(m.somme / m.n)} %</span>
        </div>`).join("") : `<p class="muet">Pas encore de formules. Va dans « Matières » pour ajouter des chapitres.</p>`}
    </section>
    ${jSauv === null || jSauv >= 7 ? `<div class="encart"><div><b>Sauvegarde</b><p class="petit">${jSauv === null ? "Tu n'as encore jamais fait de sauvegarde." : `Dernière sauvegarde il y a ${jSauv} jours.`} Elle protège ta progression et permet de passer au téléphone / au PC.</p></div><button class="bouton" data-nav="#/sauvegarde">Sauvegarder</button></div>` : ""}
    <div class="encart discret"><div><b>Bientôt</b><p class="petit">Planning des colles et DS, notes et moyennes (étape W2), puis TD, cours, TIPE et emploi du temps (W3).</p></div></div>
  `;
}

// ------------------------------------------------------------------ Matières

export function vueMatieres(el) {
  const ms = tous(`SELECT m.*, (SELECT COUNT(*) FROM chapitres c WHERE c.matiereId = m.id AND c.masque = 0) AS nbChapitres,
    (SELECT COUNT(*) FROM formules f INNER JOIN chapitres c ON c.id = f.chapitreId WHERE c.matiereId = m.id) AS nbFormules
    FROM matieres m ORDER BY m.ordre, m.id`);
  const visibles = ms.filter((m) => !m.masquee);
  const masquees = ms.filter((m) => m.masquee);
  const ligne = (m) => `
    <a class="ligne cliquable" href="#/matiere/${m.id}">
      <span class="pastille grande" style="background:${couleurHex(m.couleur)}"></span>
      <div class="ligne-texte"><b>${echapper(m.nom)}</b><span class="petit muet">${m.nbChapitres} chapitre(s) · ${m.nbFormules} formule(s)</span></div>
      <span class="chevron">›</span>
    </a>`;
  el.innerHTML = `
    <h1 class="titre-page">Matières</h1>
    <div class="liste">${visibles.map(ligne).join("") || `<p class="muet">Aucune matière visible.</p>`}</div>
    <button class="bouton" id="ajouter-matiere">+ Ajouter une matière</button>
    ${masquees.length ? `<details class="replie"><summary>Matières masquées (${masquees.length})</summary><div class="liste">${masquees.map(ligne).join("")}</div></details>` : ""}
  `;
  el.querySelector("#ajouter-matiere").onclick = async () => {
    const nom = await dialogue({
      titre: "Nouvelle matière",
      contenu: `<label class="champ"><span>Nom</span><input id="nom-matiere" maxlength="60"></label>
        <label class="champ"><span>Couleur</span><input id="couleur-matiere" type="color" value="#26a69a"></label>`,
      boutons: [{ texte: "Annuler", valeur: null }, { texte: "Ajouter", style: "primaire", valeur: (f) => {
        const n = f.querySelector("#nom-matiere").value.trim();
        return n ? { nom: n, couleur: f.querySelector("#couleur-matiere").value } : undefined;
      } }],
      apresOuverture: (f) => f.querySelector("#nom-matiere").focus(),
    });
    if (!nom) return;
    const ordre = (valeur("SELECT COALESCE(MAX(ordre), -1) FROM matieres") ?? -1) + 1;
    executer("INSERT INTO matieres (nom, couleur, ordre, masquee, sansProgramme) VALUES (?, ?, ?, 0, 0)", [nom.nom, couleurArgb(nom.couleur), ordre]);
    location.hash = `#/matiere/${dernierId()}`;
  };
}

export async function vueMatiere(el, id, nav) {
  const m = un("SELECT * FROM matieres WHERE id = ?", [id]);
  if (!m) { el.innerHTML = `<p>Matière introuvable.</p>`; return; }
  const couleur = couleurHex(m.couleur);
  const prog = new Map(progressionChapitres().map((p) => [p.chapitreId, p]));
  const chapitres = tous(`SELECT c.*, (SELECT COUNT(*) FROM formules f WHERE f.chapitreId = c.id) AS nbFormules
    FROM chapitres c WHERE c.matiereId = ? ORDER BY c.ordre, c.id`, [id]);
  const cat = await cataloguePour(m.nom);
  const visibles = chapitres.filter((c) => !c.masque);
  const masques = chapitres.filter((c) => c.masque);
  const ligne = (c) => {
    const p = prog.get(c.id);
    return `<a class="ligne cliquable" href="#/chapitre/${c.id}">
      <div class="ligne-texte"><b>${echapper(c.titre)}</b>
        <span class="petit muet">${LIB_PROGRAMME[c.programme] || ""} · ${c.nbFormules} formule(s)${p && p.dues ? ` · ${p.dues} à revoir` : ""}</span>
        ${p ? barre(p.progression, couleur) : ""}</div>
      <span class="chevron">›</span></a>`;
  };
  el.innerHTML = `
    <a class="retour" href="#/matieres">‹ Matières</a>
    <h1 class="titre-page"><span class="pastille grande" style="background:${couleur}"></span> ${echapper(m.nom)}</h1>
    <div class="rangee-boutons">
      ${visibles.length ? `<button class="bouton primaire" data-nav="#/seance?c=${visibles.map((c) => c.id).join(",")}&t=${encodeURIComponent(m.nom)}">▶ Réviser la matière</button>` : ""}
      ${cat ? `<button class="bouton" id="cat">+ Chapitres du catalogue</button>` : ""}
      <button class="bouton" id="import">Importer mes fiches (.json)</button>
    </div>
    <div class="liste">${visibles.map(ligne).join("") || `<p class="muet">Aucun chapitre. ${cat ? "Ajoute-en depuis le catalogue." : "Importe tes fiches ou ajoute un chapitre."}</p>`}</div>
    ${masques.length ? `<details class="replie"><summary>Chapitres masqués (${masques.length})</summary><div class="liste">${masques.map(ligne).join("")}</div></details>` : ""}
    <details class="replie"><summary>Plus d'options</summary>
      <div class="pile-boutons">
        <button class="bouton discret" id="nouveau-ch">+ Créer un chapitre vide</button>
        ${cat ? `<button class="bouton discret" id="completer">Ajouter les formules du catalogue qui manquent</button>` : ""}
        <button class="bouton discret" id="masquer">${m.masquee ? "Afficher cette matière" : "Masquer cette matière"}</button>
      </div>
    </details>
  `;
  if (cat) {
    el.querySelector("#cat").onclick = () => dialogueCatalogue(m, cat, nav);
    el.querySelector("#completer").onclick = async () => {
      const n = await completerFormules(id);
      toast(n ? `${n} formule(s) ajoutée(s).` : "Toutes les formules du catalogue sont déjà là.");
      nav.rafraichir();
    };
  }
  el.querySelector("#import").onclick = async () => {
    const f = await choisirFichier(".json,application/json");
    if (!f) return;
    try {
      const chapitres = lireFiches(await f.text());
      const nbF = chapitres.reduce((s, c) => s + c.formules.length, 0);
      if (!(await confirmer("Importer ces fiches ?", `${chapitres.length} chapitre(s), ${nbF} fiche(s) dans « ${m.nom} ». Les fiches déjà présentes ne sont pas ajoutées deux fois.`, "Importer"))) return;
      const [c, n] = importerFiches(id, chapitres);
      toast(`${n} fiche(s) ajoutée(s)${c ? `, ${c} chapitre(s) créé(s)` : ""}.`);
      nav.rafraichir();
    } catch (e) {
      dialogue({ titre: "Import impossible", contenu: `<p>${echapper(e.message)}</p>` });
    }
  };
  el.querySelector("#nouveau-ch").onclick = async () => {
    const titre = await dialogue({
      titre: "Nouveau chapitre",
      contenu: `<label class="champ"><span>Titre</span><input id="t" maxlength="100"></label>`,
      boutons: [{ texte: "Annuler", valeur: null }, { texte: "Créer", style: "primaire", valeur: (f) => f.querySelector("#t").value.trim() || undefined }],
      apresOuverture: (f) => f.querySelector("#t").focus(),
    });
    if (!titre) return;
    const ordre = (valeur("SELECT COALESCE(MAX(ordre), -1) FROM chapitres WHERE matiereId = ?", [id]) ?? -1) + 1;
    executer("INSERT INTO chapitres (matiereId, titre, programme, ordre, masque) VALUES (?, ?, 'LES_DEUX', ?, 0)", [id, titre, ordre]);
    nav.rafraichir();
  };
  el.querySelector("#masquer").onclick = () => {
    executer("UPDATE matieres SET masquee = ? WHERE id = ?", [m.masquee ? 0 : 1, id]);
    toast(m.masquee ? "Matière affichée." : "Matière masquée (elle n'apparaît plus dans les révisions).");
    nav.rafraichir();
  };
}

async function dialogueCatalogue(m, cat, nav) {
  const deja = new Set(tous("SELECT cleCatalogue FROM chapitres WHERE matiereId = ? AND cleCatalogue IS NOT NULL", [m.id]).map((x) => x.cleCatalogue));
  const groupes = [["PCSI", "PCSI"], ["PSI", "PSI"], ["LES_DEUX", "PCSI + PSI"]]
    .map(([p, lib]) => [lib, cat.chapitres.filter((c) => c.programme === p)])
    .filter(([, l]) => l.length);
  const contenu = `
    <p class="petit muet">${echapper(cat.avertissement)}</p>
    ${groupes.map(([lib, l]) => `
      <div class="groupe-cases">
        <div class="groupe-titre"><b>${lib}</b> <button class="lien" data-tout="${lib}">tout cocher</button></div>
        ${l.map((c) => `<label class="case${deja.has(c.cle) ? " desactivee" : ""}" data-groupe="${lib}">
          <input type="checkbox" value="${echapper(c.cle)}" ${deja.has(c.cle) ? "checked disabled" : ""}>
          <span>${echapper(c.titre)}${deja.has(c.cle) ? ` <small class="muet">(déjà là)</small>` : ""}</span></label>`).join("")}
      </div>`).join("")}`;
  const choix = await dialogue({
    titre: `Catalogue · ${m.nom}`,
    contenu,
    large: true,
    boutons: [{ texte: "Annuler", valeur: null }, { texte: "Ajouter", style: "primaire", valeur: (f) => [...f.querySelectorAll("input:checked:not(:disabled)")].map((i) => i.value) }],
    apresOuverture: (f) => f.querySelectorAll("[data-tout]").forEach((b) => {
      b.onclick = () => f.querySelectorAll(`[data-groupe="${b.dataset.tout}"] input:not(:disabled)`).forEach((i) => { i.checked = true; });
    }),
  });
  if (!choix || !choix.length) return;
  const [c, n] = await ajouterChapitres(m.id, cat.chapitres.filter((x) => choix.includes(x.cle)));
  toast(`${c} chapitre(s) et ${n} formule(s) ajoutés.`);
  nav.rafraichir();
}

// ------------------------------------------------------------------ Chapitre

export function vueChapitre(el, id, nav) {
  const c = un("SELECT c.*, m.nom AS matiereNom, m.couleur AS matiereCouleur FROM chapitres c INNER JOIN matieres m ON m.id = c.matiereId WHERE c.id = ?", [id]);
  if (!c) { el.innerHTML = `<p>Chapitre introuvable.</p>`; return; }
  const couleur = couleurHex(c.couleur ?? c.matiereCouleur);
  const fs = tous("SELECT * FROM formules WHERE chapitreId = ? ORDER BY ordre, id", [id]);
  el.innerHTML = `
    <a class="retour" href="#/matiere/${c.matiereId}">‹ ${echapper(c.matiereNom)}</a>
    <h1 class="titre-page">${echapper(c.titre)}</h1>
    <p class="petit muet">${LIB_PROGRAMME[c.programme] || ""}${c.reference ? ` · ${echapper(c.reference)}` : ""}</p>
    <div class="rangee-boutons">
      ${fs.length ? `<button class="bouton primaire" data-nav="#/seance?c=${id}&t=${encodeURIComponent(c.titre)}">▶ Réviser ce chapitre</button>` : ""}
      <button class="bouton discret" id="masquer">${c.masque ? "Afficher le chapitre" : "Masquer le chapitre"}</button>
    </div>
    <div class="liste-formules" style="--accent:${couleur}">
      ${fs.map((f) => `
        <button class="formule${f.horsRevision ? " hors" : ""}" data-f="${f.id}">
          <div class="formule-titre">${f.favori ? `<span class="etoile active">★</span> ` : ""}${echapper(f.intitule)}${f.horsRevision ? ` <small class="muet">(pas révisée)</small>` : ""}</div>
          <div class="formule-math">${rendreMath(f.latex, true)}</div>
        </button>`).join("") || `<p class="muet">Aucune formule dans ce chapitre.</p>`}
    </div>`;
  el.querySelector("#masquer").onclick = () => {
    executer("UPDATE chapitres SET masque = ? WHERE id = ?", [c.masque ? 0 : 1, id]);
    nav.rafraichir();
  };
  el.querySelectorAll("[data-f]").forEach((b) => { b.onclick = () => dialogueFormule(Number(b.dataset.f), nav); });
}

async function dialogueFormule(id, nav) {
  const f = un("SELECT * FROM formules WHERE id = ?", [id]);
  const r = await dialogue({
    titre: f.intitule,
    contenu: ficheFormule(f),
    large: true,
    boutons: [
      { texte: f.favori ? "★ Retirer des favoris" : "☆ Favori", valeur: "favori" },
      { texte: f.horsRevision ? "Remettre en révision" : "Ne plus réviser", valeur: "hors" },
      { texte: "Fermer", valeur: null, style: "primaire" },
    ],
  });
  if (r === "favori") executer("UPDATE formules SET favori = ? WHERE id = ?", [f.favori ? 0 : 1, id]);
  if (r === "hors") executer("UPDATE formules SET horsRevision = ? WHERE id = ?", [f.horsRevision ? 0 : 1, id]);
  if (r) nav.rafraichir();
}

// ------------------------------------------------------------------ Réviser (choix)

export function vueReviser(el, nav) {
  const s = statsJour();
  const progression = progressionChapitres().filter((p) => p.nbFormules > 0);
  const parMatiere = new Map();
  for (const p of progression) {
    if (!parMatiere.has(p.matiereId)) parMatiere.set(p.matiereId, { nom: p.matiere, couleur: couleurHex(p.couleur), chapitres: [] });
    parMatiere.get(p.matiereId).chapitres.push(p);
  }
  const objectifs = tous("SELECT * FROM objectifs WHERE jour >= ? ORDER BY jour", [aujourdhui()]);
  const avecAn = reglages.lire("avecAn", true);
  el.innerHTML = `
    <h1 class="titre-page">Réviser</h1>
    <div class="grille-choix">
      <button class="choix" data-nav="#/seance"><b>▶ Révision libre</b><span>Toutes tes formules · ${s.dues} à revoir aujourd'hui</span></button>
      <button class="choix" data-nav="#/seance?f=1" ${s.favoris ? "" : "disabled"}><b>★ Mes favoris</b><span>${s.favoris} formule(s) marquée(s) d'une étoile</span></button>
    </div>
    ${objectifs.length ? `<h2 class="titre-section">Colles et DS</h2>${objectifs.map((o) => `
      <div class="ligne"><div class="ligne-texte"><b>${echapper(o.titre)}</b><span class="petit muet">${dateLisible(o.jour)} · ${delaiLisible(o.jour)}</span></div>
      <button class="bouton petit" data-nav="#/seance?o=${o.id}">Réviser</button></div>`).join("")}` : ""}
    <h2 class="titre-section">Choisir des chapitres</h2>
    <div class="arbre" id="arbre">
      ${[...parMatiere.entries()].map(([mid, m]) => `
        <details class="replie"><summary><span class="pastille" style="background:${m.couleur}"></span> ${echapper(m.nom)} <label class="lien"><input type="checkbox" data-matiere="${mid}"> tout</label></summary>
          ${m.chapitres.map((c) => `<label class="case"><input type="checkbox" value="${c.chapitreId}" data-m="${mid}">
            <span>${echapper(c.titre)} <small class="muet">${pct(c.progression)} %${c.dues ? ` · ${c.dues} à revoir` : ""}</small></span></label>`).join("")}
        </details>`).join("") || `<p class="muet">Ajoute d'abord des chapitres dans « Matières ».</p>`}
    </div>
    <button class="bouton primaire large" id="lancer" disabled>▶ Réviser la sélection</button>
    <label class="interrupteur"><input type="checkbox" id="an" ${avecAn ? "checked" : ""}><span>Applications numériques et ordres de grandeur</span></label>
  `;
  const arbre = el.querySelector("#arbre");
  const maj = () => {
    const n = arbre.querySelectorAll("input[value]:checked").length;
    const b = el.querySelector("#lancer");
    b.disabled = !n;
    b.textContent = n ? `▶ Réviser la sélection (${n} chapitre${n > 1 ? "s" : ""})` : "▶ Réviser la sélection";
  };
  arbre.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.matiere) arbre.querySelectorAll(`[data-m="${t.dataset.matiere}"]`).forEach((i) => { i.checked = t.checked; });
    maj();
  });
  arbre.querySelectorAll("summary .lien").forEach((l) => l.addEventListener("click", (e) => e.stopPropagation()));
  el.querySelector("#lancer").onclick = () => {
    const ids = [...arbre.querySelectorAll("input[value]:checked")].map((i) => i.value);
    nav.aller(`#/seance?c=${ids.join(",")}`);
  };
  el.querySelector("#an").onchange = (e) => reglages.ecrire("avecAn", e.target.checked);
}

// ------------------------------------------------------------------ Plus

export function vuePlus(el, nav) {
  el.innerHTML = `
    <h1 class="titre-page">Plus</h1>
    <div class="grille-choix">
      <button class="choix" data-nav="#/sauvegarde"><b>💾 Sauvegarde</b><span>Exporter, restaurer, passer du téléphone au PC</span></button>
      <button class="choix" data-nav="#/partage"><b>📚 Fiches partagées</b><span>Fiches supplémentaires à ajouter</span></button>
      <button class="choix" data-nav="#/aide"><b>❓ Comment ça marche</b><span>La répétition espacée et comment bien réviser</span></button>
      <button class="choix" id="visite"><b>🧭 Visite guidée</b><span>Revoir la présentation des boutons</span></button>
      <button class="choix" data-nav="#/installer"><b>📲 Installer l'appli</b><span>iPhone, Android, PC</span></button>
      <button class="choix" id="zero"><b>🗑 Recommencer à zéro</b><span>Efface toutes les données de cet appareil</span></button>
    </div>
    <p class="petit muet centre">malivertcpge · version ${VERSION_APPLI} · fonctionne hors ligne · tes données restent sur cet appareil</p>`;
  el.querySelector("#visite").onclick = () => nav.visite();
  el.querySelector("#zero").onclick = async () => {
    if (!(await confirmer("Tout effacer ?", "Toutes tes données sur cet appareil (progression, chapitres, fiches) seront effacées. Fais d'abord une sauvegarde si tu veux les garder.", "Tout effacer", true))) return;
    await reinitialiser();
    reglages.ecrire("assistantFait", false);
    location.hash = "#/assistant";
    location.reload();
  };
}

// ------------------------------------------------------------------ Sauvegarde

export function vueSauvegarde(el, nav) {
  const j = joursDepuisSauvegarde();
  el.innerHTML = `
    <a class="retour" href="#/plus">‹ Plus</a>
    <h1 class="titre-page">Sauvegarde</h1>
    <p>La sauvegarde est un fichier <b>.zip</b> qui contient toute ta progression. C'est <b>le même format que l'appli Android</b> : tu peux faire une sauvegarde sur ton téléphone et la restaurer ici (ou l'inverse).</p>
    <p class="petit muet">${j === null ? "Aucune sauvegarde faite depuis cet appareil." : `Dernière sauvegarde depuis cet appareil : il y a ${j} jour(s).`}</p>
    <div class="pile-boutons">
      <button class="bouton primaire" id="exporter">⬇ Faire une sauvegarde</button>
      <button class="bouton" id="restaurer">⬆ Restaurer une sauvegarde…</button>
    </div>
    <div class="encart discret"><div><b>Passer du téléphone au PC</b>
      <p class="petit">1. Sur le téléphone : Sauvegarde → le fichier .zip est téléchargé.<br>
      2. Envoie-le sur le PC (mail, Drive, câble…).<br>
      3. Sur le PC : Restaurer → choisis le fichier. Toutes les données du PC sont remplacées par celles du téléphone.</p></div></div>
    <div class="encart discret"><div><b>Sur iPhone</b>
      <p class="petit">Le fichier arrive dans l'appli « Fichiers » (dossier Téléchargements). Pense à installer l'appli sur l'écran d'accueil : sinon Safari peut effacer les données d'un site peu utilisé.</p></div></div>`;
  el.querySelector("#exporter").onclick = async () => {
    try {
      telecharger(await exporterSauvegarde(), nomSauvegarde());
      toast("Sauvegarde téléchargée.");
      nav.rafraichir();
    } catch (e) {
      dialogue({ titre: "Sauvegarde impossible", contenu: `<p>${echapper(e.message)}</p>` });
    }
  };
  el.querySelector("#restaurer").onclick = () => restaurer(nav);
}

export async function restaurer(nav, apres) {
  const f = await choisirFichier(".zip,application/zip");
  if (!f) return false;
  try {
    const a = await analyserSauvegarde(f);
    const r = await dialogue({
      titre: "Restaurer cette sauvegarde ?",
      contenu: `${resumeSauvegarde(a.infos)}<p class="avertissement">Toutes les données actuelles de cet appareil seront remplacées.</p>`,
      boutons: [{ texte: "Annuler", valeur: false }, { texte: "Remplacer mes données", valeur: true, style: "danger" }],
    });
    if (!r) return false;
    await restaurerSauvegarde(a);
    toast("Sauvegarde restaurée ✓");
    if (apres) apres(); else nav.rafraichir();
    return true;
  } catch (e) {
    dialogue({ titre: "Restauration impossible", contenu: `<p>${echapper(e.message)}</p>` });
    return false;
  }
}

// ------------------------------------------------------------------ Fiches partagées

export async function vuePartage(el, nav) {
  const liste = await fichesPartagees();
  el.innerHTML = `
    <a class="retour" href="#/plus">‹ Plus</a>
    <h1 class="titre-page">Fiches partagées</h1>
    <p class="muet">Des fiches en plus du catalogue, préparées à partir de fiches de cours. Ajoute celles qui te servent : elles vont dans la bonne matière et ne sont jamais ajoutées deux fois.</p>
    <div class="liste">${liste.map((p, i) => `
      <div class="ligne">
        <div class="ligne-texte"><b>${echapper(p.titre)}</b><span class="petit muet">${echapper(p.matiere)} · ${echapper(p.description)}</span></div>
        ${p.ajoutees ? `<span class="badge">✓ ajoutées</span>` : `<button class="bouton petit" data-i="${i}">Ajouter</button>`}
      </div>`).join("")}</div>`;
  el.querySelectorAll("[data-i]").forEach((b) => {
    b.onclick = async () => {
      const [c, n] = await ajouterFichesPartagees(liste[Number(b.dataset.i)]);
      toast(`${n} fiche(s) ajoutée(s)${c ? `, ${c} chapitre(s) créé(s)` : ""}.`);
      nav.rafraichir();
    };
  });
}

// ------------------------------------------------------------------ Aide

export function vueAide(el, nav) {
  el.innerHTML = `
    <a class="retour" href="#/plus">‹ Plus</a>
    <h1 class="titre-page">Comment ça marche</h1>
    <article class="aide">
      <h2>L'idée : la répétition espacée</h2>
      <p>L'appli te redemande chaque formule <b>juste avant que tu l'oublies</b>. Plus tu la connais, plus elle espace les révisions. Résultat : tu révises peu, mais tu retiens longtemps.</p>

      <h2>Les cartes</h2>
      <p>Chaque formule donne jusqu'à 8 cartes, pour l'interroger sous plusieurs angles :</p>
      <ul>
        <li><b>Nom → formule</b> : écris la formule, puis vérifie.</li>
        <li><b>Formule → nom</b> : qu'est-ce que c'est, que veut dire chaque symbole ?</li>
        <li><b>Hypothèses</b> : quand la formule est-elle valable ?</li>
        <li><b>Formule à trous</b> : que faut-il mettre dans la case ?</li>
        <li><b>QCM</b> : la bonne formule parmi des versions piégées (un signe, un exposant, un facteur 2…).</li>
        <li><b>Vrai ou faux</b> : la formule affichée est-elle juste ?</li>
        <li><b>Application numérique</b> : fais le calcul, tape ton résultat.</li>
        <li><b>Ordre de grandeur</b> : estime le résultat sans calculatrice.</li>
      </ul>

      <h2>Les boutons</h2>
      <p>Chaque carte est dans une <b>boîte de 1 à 6</b>. Elle revient après 1, 2, 4, 8, 16 puis 32 jours selon sa boîte.</p>
      <ul>
        <li><span class="puce rep-rate">Raté</span> ou « Je ne sais pas » → boîte 1 : demain, et quelques cartes plus loin dans la séance.</li>
        <li><span class="puce rep-difficile">Difficile</span> → la carte reste dans sa boîte.</li>
        <li><span class="puce rep-bien">Bien</span> → boîte suivante.</li>
        <li><span class="puce rep-facile">Facile</span> → deux boîtes plus haut.</li>
      </ul>
      <p>Sous chaque bouton, tu vois quand la carte reviendra. Sur PC : <kbd>Espace</kbd> pour afficher la réponse, <kbd>1</kbd> à <kbd>4</kbd> pour répondre, <kbd>Entrée</kbd> pour passer.</p>

      <h2>Une séance</h2>
      <ul>
        <li>Elle commence par <b>faire le tour de toutes tes formules</b> (une carte de chacune, les jamais vues d'abord).</li>
        <li>Puis viennent les cartes <b>dues aujourd'hui</b>, puis les autres en avance. La séance ne s'arrête jamais toute seule : arrête-toi quand tu veux (✕ ou ⋮ → Terminer).</li>
        <li>Une bonne réponse <b>en avance</b> ne fait pas monter la carte (tu n'as pas encore eu le temps d'oublier) ; une erreur la fait redescendre.</li>
        <li><b>↶ Précédente</b> remontre la formule de la carte d'avant, sans changer sa note.</li>
        <li><b>★</b> met la formule en favori ; <b>⋮ → Ne plus réviser</b> l'écarte des révisions.</li>
      </ul>

      <h2>Bien réviser avec l'appli</h2>
      <ul>
        <li><b>Réponds vraiment avant de regarder</b> : écris la formule sur un brouillon ou dis-la à voix haute. Reconnaître la réponse, ce n'est pas la savoir.</li>
        <li><b>Sois honnête</b> : une hésitation ou une erreur de signe, c'est Difficile ou Raté. Garde Facile pour ce qui était immédiat.</li>
        <li><b>Un peu tous les jours</b> (10–15 min) plutôt qu'une grosse séance par semaine.</li>
        <li><b>Avant une colle ou un DS</b>, révise depuis la colle (mode DS : les révisions sont resserrées pour tout revoir avant l'épreuve).</li>
      </ul>

      <h2>Tes données</h2>
      <p>Tout reste <b>sur ton appareil</b> (rien n'est envoyé sur Internet). Fais une <a href="#/sauvegarde">sauvegarde</a> de temps en temps : elle protège ta progression et permet de passer du téléphone au PC (même format que l'appli Android).</p>
    </article>`;
}

// ------------------------------------------------------------------ Installation

export function vueInstaller(el, nav) {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const android = /Android/.test(ua);
  const installee = nav.estInstallee();
  el.innerHTML = `
    <a class="retour" href="#/plus">‹ Plus</a>
    <h1 class="titre-page">Installer l'appli</h1>
    ${installee ? `<div class="encart accent"><div><b>✓ L'appli est déjà installée sur cet appareil.</b></div></div>` : ""}
    ${nav.invite() ? `<button class="bouton primaire large" id="installer">📲 Installer maintenant</button>` : ""}
    <section class="${ios ? "" : "replie-doux"}"><h2>iPhone / iPad</h2><ol>
      <li>Ouvre ce site dans <b>Safari</b> (pas dans une autre appli).</li>
      <li>Touche le bouton <b>Partager</b> (carré avec une flèche vers le haut).</li>
      <li>Fais défiler et touche <b>« Sur l'écran d'accueil »</b>, puis <b>Ajouter</b>.</li>
      <li>Ouvre l'appli depuis sa nouvelle icône. <b>Important</b> : sur iPhone, c'est ce qui protège tes données.</li>
    </ol></section>
    <section class="${android ? "" : "replie-doux"}"><h2>Android</h2><ol>
      <li>Ouvre ce site dans <b>Chrome</b>.</li>
      <li>Touche le bouton « Installer » ci-dessus, ou le menu <b>⋮</b> → <b>« Installer l'application »</b> (ou « Ajouter à l'écran d'accueil »).</li>
      <li>L'icône apparaît avec tes autres applis.</li>
    </ol></section>
    <section class="${!ios && !android ? "" : "replie-doux"}"><h2>PC (Windows, Mac)</h2><ol>
      <li>Ouvre ce site dans <b>Chrome</b> ou <b>Edge</b>.</li>
      <li>Clique sur l'icône d'installation à droite de la barre d'adresse (un écran avec une flèche), ou menu → « Installer malivertcpge ».</li>
      <li>L'appli s'ouvre dans sa propre fenêtre et marche hors ligne.</li>
    </ol></section>
    <p class="petit muet">Mises à jour : elles s'installent toutes seules à l'ouverture de l'appli (connexion Internet nécessaire de temps en temps).</p>`;
  const b = el.querySelector("#installer");
  if (b) b.onclick = () => nav.installer();
}

// ------------------------------------------------------------------ Bientôt (W2 / W3)

export function vueBientot(el, quoi) {
  const textes = {
    planning: ["Planning", "Colles, DS et évaluations, programmes, révision ciblée avant chaque épreuve, ajout au calendrier du téléphone."],
    resultats: ["Résultats", "Notes, moyennes par matière et générale, graphiques, cette année / année passée."],
  };
  const [t, d] = textes[quoi] || ["Bientôt", ""];
  el.innerHTML = `<h1 class="titre-page">${t}</h1><div class="encart discret"><div><b>Arrive à l'étape W2</b><p>${d}</p>
    <p class="petit">Si tu as restauré une sauvegarde de l'appli Android, tes données sont déjà là : elles s'afficheront ici dès la prochaine version.</p></div></div>`;
}

// ------------------------------------------------------------------ Assistant de départ

export async function vueAssistant(el, nav) {
  const cats = await lesCatalogues();
  const ms = tous("SELECT * FROM matieres ORDER BY ordre");
  const partage = await fichesPartagees();
  let etape = 0;
  const choix = { filiere: "PSI_PCSI", matieres: new Set(ms.filter((m) => !/tipe/i.test(m.nom)).map((m) => m.id)), partage: new Set() };

  const etapes = [
    () => `
      <div class="assistant-logo">∑</div>
      <h1>Bienvenue sur malivertcpge</h1>
      <p>L'appli pour <b>apprendre et retenir ses formules de prépa</b> : fiches, cartes de révision, QCM piégés, applications numériques, et un programme de révision qui s'adapte à toi.</p>
      <p class="muet">On règle tout en 3 étapes (1 minute).</p>
      <div class="pile-boutons">
        <button class="bouton primaire large" data-a="suivant">Commencer</button>
        <button class="bouton discret" data-a="restaurer">J'ai déjà une sauvegarde (appli Android ou web)</button>
      </div>`,
    () => `
      <div class="etape">Étape 1 / 3</div>
      <h1>Ta classe</h1>
      <p class="muet">Pour choisir les chapitres à ajouter. Tu pourras en ajouter ou en retirer plus tard.</p>
      ${[["PCSI", "PCSI", "1re année"], ["PSI_PCSI", "PSI + révisions de PCSI", "2e année, avec les chapitres de 1re année"], ["PSI", "PSI seulement", "2e année"]]
        .map(([v, t, d]) => `<label class="choix-radio"><input type="radio" name="filiere" value="${v}" ${choix.filiere === v ? "checked" : ""}><span><b>${t}</b><small>${d}</small></span></label>`).join("")}
      <p class="petit muet">Les chapitres de physique et de chimie de PSI suivent le cours de M. Courtin (lycée Victor Hugo) ; les autres suivent le programme officiel.</p>
      <div class="rangee-boutons fin"><button class="bouton discret" data-a="precedent">Retour</button><button class="bouton primaire" data-a="suivant">Suivant</button></div>`,
    () => `
      <div class="etape">Étape 2 / 3</div>
      <h1>Tes matières</h1>
      <p class="muet">Décoche celles que tu ne veux pas réviser (elles seront masquées, pas supprimées).</p>
      ${ms.map((m) => `<label class="case"><input type="checkbox" value="${m.id}" ${choix.matieres.has(m.id) ? "checked" : ""}>
        <span><span class="pastille" style="background:${couleurHex(m.couleur)}"></span> ${echapper(m.nom)}</span></label>`).join("")}
      <div class="rangee-boutons fin"><button class="bouton discret" data-a="precedent">Retour</button><button class="bouton primaire" data-a="suivant">Suivant</button></div>`,
    () => `
      <div class="etape">Étape 3 / 3</div>
      <h1>Fiches en plus</h1>
      <p class="muet">Des fiches partagées par le créateur de l'appli, en plus du catalogue. Facultatif : tu pourras les ajouter plus tard (Plus → Fiches partagées).</p>
      ${partage.map((p, i) => `<label class="case"><input type="checkbox" value="${i}" ${choix.partage.has(i) ? "checked" : ""}>
        <span><b>${echapper(p.titre)}</b><br><small class="muet">${echapper(p.matiere)} · ${echapper(p.description)}</small></span></label>`).join("")}
      <div class="rangee-boutons fin"><button class="bouton discret" data-a="precedent">Retour</button><button class="bouton primaire" data-a="terminer">C'est parti !</button></div>`,
  ];

  function lire() {
    const r = el.querySelector("input[name=filiere]:checked");
    if (r) choix.filiere = r.value;
    if (etape === 2) choix.matieres = new Set([...el.querySelectorAll("input[type=checkbox]:checked")].map((i) => Number(i.value)));
    if (etape === 3) choix.partage = new Set([...el.querySelectorAll("input[type=checkbox]:checked")].map((i) => Number(i.value)));
  }
  function afficher() {
    el.innerHTML = `<div class="assistant">${etapes[etape]()}</div>`;
  }
  async function terminer() {
    el.innerHTML = `<div class="assistant"><h1>Préparation…</h1><p class="muet">Ajout des chapitres et des formules.</p></div>`;
    const programmes = choix.filiere === "PCSI" ? ["PCSI", "LES_DEUX"] : choix.filiere === "PSI" ? ["PSI", "LES_DEUX"] : ["PCSI", "PSI", "LES_DEUX"];
    let nbC = 0, nbF = 0;
    for (const m of ms) {
      const garder = choix.matieres.has(m.id);
      executer("UPDATE matieres SET masquee = ? WHERE id = ?", [garder ? 0 : 1, m.id]);
      if (!garder) continue;
      const cat = cats.find((c) => c.motsCles.some((k) => simplifier(m.nom).includes(simplifier(k))));
      if (!cat) continue;
      const [c, f] = await ajouterChapitres(m.id, cat.chapitres.filter((ch) => programmes.includes(ch.programme)));
      nbC += c; nbF += f;
    }
    for (const i of choix.partage) {
      const [, f] = await ajouterFichesPartagees(partage[i]);
      nbF += f;
    }
    reglages.ecrire("assistantFait", true);
    toast(`${nbC} chapitres et ${nbF} formules ajoutés ✓`, 4000);
    nav.aller("#/accueil");
    setTimeout(() => nav.visite(), 600);
  }
  el.onclick = async (e) => {
    const a = e.target.closest("[data-a]")?.dataset.a;
    if (!a) return;
    lire();
    if (a === "suivant") etape++;
    else if (a === "precedent") etape--;
    else if (a === "terminer") return terminer();
    else if (a === "restaurer") {
      if (await restaurer(nav, () => { reglages.ecrire("assistantFait", true); nav.aller("#/accueil"); })) return;
    }
    afficher();
  };
  afficher();
}
