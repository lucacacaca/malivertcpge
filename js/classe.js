// « Ma classe » : colloscope, DS / DM et emploi du temps d'une classe, intégrés à l'appli
// (data/classes). Chacun choisit sa classe, son groupe de colle et ses groupes (TD, TP, LV2) :
// l'appli n'installe que ce qui le concerne.

import { tous, executer, valeur, transaction } from "./db.js";
import { echapper, reglages, toast, confirmer, aujourdhui } from "./util.js";
import { importer, matiereDe, lireHeure, lundi, lirePlanning } from "./planning.js";

let indexClasses = null;

export async function lesClasses() {
  if (!indexClasses) {
    try {
      const r = await fetch("data/classes/index.json");
      indexClasses = r.ok ? (await r.json()).classes : [];
    } catch { indexClasses = []; }
  }
  return indexClasses;
}

async function chargerClasse(fichier) {
  const r = await fetch("data/classes/" + fichier);
  if (!r.ok) throw new Error("Fichier de classe introuvable.");
  return r.json();
}

/** Choix enregistré : {id, fichier, version, groupe, options: {td: "gr2", …}}. */
export const maClasse = () => reglages.lire("classe", null);

// ------------------------------------------------------------------ Lecture de la classe

const JOURS = { lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6, dimanche: 7, lun: 1, mar: 2, mer: 3, jeu: 4, ven: 5, sam: 6, dim: 7 };

/** Le créneau concerne-t-il cet élève ? (« pour » : {td: "gr2"} ; absent = tout le monde). */
function concerne(c, options) {
  return Object.entries(c.pour || {}).every(([k, v]) => {
    const choix = options[k];
    return Array.isArray(v) ? v.includes(choix) : choix === v;
  });
}

/** Créneaux d'un fichier d'emploi du temps (même format que l'appli Android), filtrés. */
export function lireCreneaux(liste, matieres, options = {}) {
  const res = [], erreurs = [];
  (liste || []).forEach((o, i) => {
    if (!concerne(o, options)) return;
    const jour = JOURS[String(o.jour || "").trim().toLowerCase()] ?? (Number(o.jour) >= 1 && Number(o.jour) <= 7 ? Number(o.jour) : null);
    const debut = lireHeure(o.debut), fin = lireHeure(o.fin);
    if (!jour || debut == null || fin == null || fin <= debut) { erreurs.push(`Créneau ${i + 1} ignoré : jour ou heures illisibles.`); return; }
    const ecrite = String(o.matiere || "").trim();
    const m = matiereDe(ecrite, matieres);
    const s = String(o.semaines || "").trim().toUpperCase();
    res.push({
      jour, debut, fin, matiereId: m ? m.id : null,
      intitule: String(o.intitule || "").trim() || (m ? "" : ecrite),
      salle: String(o.salle || "").trim(), professeur: String(o.prof || o.professeur || "").trim(),
      semaines: s === "A" ? "A" : s === "B" ? "B" : "TOUTES",
    });
  });
  return { creneaux: res, erreurs };
}

export function remplacerCreneaux(creneaux) {
  transaction(() => {
    executer("DELETE FROM creneaux");
    for (const c of creneaux) {
      executer("INSERT INTO creneaux (jour, debut, fin, matiereId, intitule, salle, professeur, semaines) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [c.jour, c.debut, c.fin, c.matiereId, c.intitule, c.salle, c.professeur, c.semaines]);
    }
  });
}

/** Date ISO d'un lundi de semaine A → réglage de l'alternance. */
export function definirSemaineA(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!m) return;
  reglages.ecrire("lundiA", lundi(Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000)));
}

const colleIdentique = (e, mid) => valeur("SELECT id FROM evenements WHERE type = ? AND jour = ? AND heure IS ? AND matiereId IS ? AND titre = ? LIMIT 1",
  [e.type, e.jour, e.heure, mid, e.titre]);

/** Événements d'une liste du fichier, au format de l'import du planning. */
async function evenementsDe(liste) {
  return lirePlanning(JSON.stringify({ evenements: liste || [] }), tous("SELECT id, nom FROM matieres")).evenements;
}

/**
 * Installe (ou met à jour) la classe : DS / DM communs + colles du groupe dans le planning,
 * emploi du temps filtré selon les groupes. Si le groupe change, les colles à venir de
 * l'ancien groupe sont retirées. Renvoie un résumé.
 */
export async function installerClasse(choix, { edt = true } = {}) {
  const idx = await lesClasses();
  const info = idx.find((c) => c.id === choix.id);
  if (!info) throw new Error("Classe introuvable.");
  const classe = await chargerClasse(info.fichier);
  const ancien = maClasse();
  let retirees = 0;
  if (ancien && ancien.id === choix.id && ancien.groupe && ancien.groupe !== choix.groupe) {
    const vieilles = await evenementsDe(classe.colles?.[ancien.groupe]);
    const j = aujourdhui();
    transaction(() => {
      for (const e of vieilles) {
        if (e.jour < j) continue;
        const id = colleIdentique(e, e.matiere ? e.matiere.id : null);
        if (!id) continue;
        const o = valeur("SELECT objectifId FROM evenements WHERE id = ?", [id]);
        if (o) executer("DELETE FROM objectifs WHERE id = ?", [o]);
        executer("DELETE FROM evenements WHERE id = ?", [id]);
        retirees++;
      }
    });
  }
  const evs = [...(await evenementsDe(classe.commun)), ...(choix.groupe ? await evenementsDe(classe.colles?.[choix.groupe]) : [])];
  const [n, nbNotes] = importer(evs);
  let nbCreneaux = 0;
  if (edt && classe.edt) {
    const { creneaux } = lireCreneaux(classe.edt.creneaux, tous("SELECT id, nom FROM matieres"), choix.options || {});
    remplacerCreneaux(creneaux);
    nbCreneaux = creneaux.length;
    if (classe.edt.semaineA) definirSemaineA(classe.edt.semaineA);
  }
  reglages.ecrire("classe", { id: classe.id, nom: classe.nom, annee: classe.annee, fichier: info.fichier, version: classe.version || 1, groupe: choix.groupe || "", options: choix.options || {} });
  return { n, nbNotes, nbCreneaux, retirees, groupeDisponible: !choix.groupe || !!classe.colles?.[choix.groupe] };
}

// ------------------------------------------------------------------ Formulaire (assistant et page « Ma classe »)

/** Choix d'une option ; s'il n'est pas fait, déduit du groupe de colle quand c'est possible (TP a / b / c). */
function choixOption(o, etat) {
  if (etat.options?.[o.cle]) return etat.options[o.cle];
  if (o.selonGroupe && etat.groupe) {
    const v = Object.keys(o.selonGroupe).find((k) => o.selonGroupe[k].map(String).includes(String(etat.groupe)));
    if (v) { etat.options = { ...(etat.options || {}), [o.cle]: v }; return v; }
  }
  return "";
}

/** HTML du choix de classe et de groupes. État : {id, groupe, options}. */
export async function formulaireClasse(etat) {
  const idx = await lesClasses();
  const classe = etat.id ? await chargerClasse(idx.find((c) => c.id === etat.id)?.fichier || "") .catch(() => null) : null;
  const dispo = new Set(idx.find((c) => c.id === etat.id)?.groupesDisponibles || []);
  return `
    ${idx.map((c) => `<label class="choix-radio"><input type="radio" name="classe" value="${c.id}" ${etat.id === c.id ? "checked" : ""}>
      <span><b>${echapper(c.nom)} ${echapper(c.annee)}</b><small>${echapper(c.description)}</small></span></label>`).join("")}
    <label class="choix-radio"><input type="radio" name="classe" value="" ${!etat.id ? "checked" : ""}>
      <span><b>Ma classe n'est pas dans la liste</b><small>Tu ajouteras tes colles et ton emploi du temps à la main (ou avec un fichier).</small></span></label>
    ${classe ? `
      <div class="bloc-groupes">
        <label class="champ"><span>Ton groupe de colle</span>
          <select name="groupe"><option value="">— choisir —</option>
            ${(classe.groupesColle || Object.keys(classe.colles || {})).map((g) => `<option value="${echapper(g)}" ${etat.groupe === g ? "selected" : ""}>Groupe ${echapper(g)}${dispo.has(g) ? "" : " (colloscope pas encore disponible)"}</option>`).join("")}
          </select></label>
        ${(classe.options || []).map((o) => `<label class="champ"><span>${echapper(o.libelle)}</span>
          <select name="opt-${o.cle}"><option value="">— choisir —</option>
            ${o.choix.map((v) => `<option ${choixOption(o, etat) === v ? "selected" : ""}>${echapper(v)}</option>`).join("")}</select></label>`).join("")}
        ${etat.groupe && !dispo.has(etat.groupe) ? `<p class="petit avertissement">Le colloscope du groupe ${echapper(etat.groupe)} n'est pas encore dans l'appli : les DS et l'emploi du temps commun seront installés, et tes colles arriveront avec une prochaine mise à jour (ou ajoute-les à la main dans Planning).</p>` : ""}
      </div>` : ""}`;
}

/** Lit le formulaire ; renvoie {id, groupe, options}. */
export function lireFormulaireClasse(racine) {
  const id = racine.querySelector("input[name=classe]:checked")?.value || "";
  const options = {};
  racine.querySelectorAll("select[name^=opt-]").forEach((s) => { if (s.value) options[s.name.slice(4)] = s.value; });
  return { id, groupe: racine.querySelector("select[name=groupe]")?.value || "", options };
}

export function resumeInstallation(r) {
  return [`${r.n} colle(s) / DS ajouté(s)`, r.retirees ? `${r.retirees} colle(s) de l'ancien groupe retirée(s)` : null,
    r.nbCreneaux ? `${r.nbCreneaux} créneau(x) d'emploi du temps` : null].filter(Boolean).join(", ") + " ✓";
}

// ------------------------------------------------------------------ Page « Ma classe »

export async function vueClasse(el, nav) {
  const actuelle = maClasse();
  const idx = await lesClasses();
  const info = actuelle ? idx.find((c) => c.id === actuelle.id) : null;
  const majDispo = info && info.version > (actuelle.version || 1);
  const etat = actuelle ? { id: actuelle.id, groupe: actuelle.groupe, options: { ...actuelle.options } } : { id: "", groupe: "", options: {} };

  async function dessiner() {
    el.innerHTML = `
      <a class="retour" href="#/plus">‹ Plus</a>
      <h1 class="titre-page">Ma classe</h1>
      ${actuelle ? `<section class="encart ${majDispo ? "accent" : ""}"><div><b>${echapper(actuelle.nom)} ${echapper(actuelle.annee || "")}</b>
        <p class="petit">${actuelle.groupe ? `Groupe de colle ${echapper(actuelle.groupe)}` : "Pas de groupe de colle"}${Object.entries(actuelle.options || {}).map(([, v]) => " · " + echapper(v)).join("")}</p>
        <p class="petit muet">${majDispo ? "Une mise à jour du colloscope / de l'emploi du temps est disponible." : "Colloscope et emploi du temps à jour."}</p></div>
        <button class="bouton ${majDispo ? "primaire" : ""}" id="maj">${majDispo ? "Mettre à jour" : "Réinstaller"}</button></section>` : ""}
      <p class="muet">Choisis ta classe et tes groupes : l'appli ajoute dans le Planning les DS / DM de la classe et les colles de ton groupe, et remplit ton emploi du temps avec tes créneaux (TD, TP, LV2).</p>
      <div id="formulaire">${await formulaireClasse(etat)}</div>
      <button class="bouton primaire large" id="valider">Enregistrer</button>
      <section class="aide petit muet"><h2>Ta classe n'y est pas ?</h2>
        <p>Envoie une photo du <b>colloscope complet</b> (tous les groupes) et de l'<b>emploi du temps</b> de ta classe au créateur de l'appli : il l'ajoutera, et toute ta classe pourra le choisir ici. En attendant, ajoute tes colles dans Planning et tes créneaux dans Emploi du temps.</p>
        <p>Rien n'est supprimé de ton planning, sauf les colles <b>à venir</b> de ton ancien groupe quand tu changes de groupe. L'emploi du temps, lui, est remplacé.</p></section>`;
    el.querySelector("#formulaire").onchange = async (e) => {
      Object.assign(etat, lireFormulaireClasse(el));
      if (e.target.name === "classe") { etat.groupe = ""; etat.options = {}; }
      el.querySelector("#formulaire").innerHTML = await formulaireClasse(etat);
    };
    const maj = el.querySelector("#maj");
    if (maj) maj.onclick = () => valider({ id: actuelle.id, groupe: actuelle.groupe, options: actuelle.options });
    el.querySelector("#valider").onclick = () => valider(lireFormulaireClasse(el));
  }

  async function valider(choix) {
    if (!choix.id) {
      reglages.ecrire("classe", null);
      toast("Classe retirée : ton planning et ton emploi du temps restent tels quels.");
      nav.rafraichir();
      return;
    }
    if (valeur("SELECT COUNT(*) FROM creneaux") && !(await confirmer("Remplacer l'emploi du temps ?", "Ton emploi du temps actuel sera remplacé par celui de la classe, filtré selon tes groupes. Ton planning (colles, DS, notes) est conservé.", "Continuer"))) return;
    try {
      const r = await installerClasse(choix);
      toast(resumeInstallation(r), 5000);
      nav.rafraichir();
    } catch (e) {
      toast("Erreur : " + e.message, 5000);
    }
  }
  await dessiner();
}
