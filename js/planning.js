// Planning (colles, DS, évaluations), détail d'une épreuve, résultats (notes et moyennes),
// rappels à l'ouverture et ajout au calendrier (.ics). Même base que l'appli Android.

import { tous, un, valeur, executer, dernierId, transaction } from "./db.js";
import { blocTdEpreuve } from "./w3.js";
import {
  echapper, aujourdhui, dateLisible, delaiLisible, couleurHex, dialogue, confirmer, toast,
  telecharger, choisirFichier, reglages, simplifier,
} from "./util.js";

// ------------------------------------------------------------------ Types et petits outils

export const TYPES = {
  COLLE: { lib: "Colle", coul: "#8e24aa" },
  DS: { lib: "DS", coul: "#e53935" },
  EVALUATION: { lib: "Évaluation", coul: "#fb8c00" },
  AUTRE: { lib: "Autre", coul: "#546e7a" },
};
const TYPES_NOTE = { COLLE: "Colle", DS: "DS", DM: "DM", INTERRO: "Interro", CONCOURS_BLANC: "Concours blanc", AUTRE: "Autre" };
const DEBUT_DS = 8 * 60;
const aPreparer = (t) => t === "COLLE" || t === "DS" || t === "EVALUATION";
const pct = (x) => Math.round(x * 100);

/** 1080 → « 18h00 ». */
export const heureLisible = (m) => `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
const FORMAT_COURT = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const FORMAT_SEMAINE = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" });
/** « jeu. 5 nov. ». */
export const dateCourte = (j) => FORMAT_COURT.format(new Date(j * 86400000));
/** Lundi de la semaine du jour (le 1/1/1970 était un jeudi). */
export const lundi = (j) => j - (((j + 3) % 7) + 7) % 7;
/** Dimanche de la semaine affichée sur l'accueil : la suivante le samedi et le dimanche. */
const dimancheAffiche = (j) => { const l = lundi(j); return j - l >= 5 ? l + 13 : l + 6; };
const titreSemaine = (l) => "Semaine du " + FORMAT_SEMAINE.format(new Date(l * 86400000));
/** Début de l'année scolaire (1er août) contenant le jour. */
export function debutAnneeScolaire(j) {
  const d = new Date(j * 86400000);
  const a = d.getUTCMonth() >= 7 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return Math.round(Date.UTC(a, 7, 1) / 86400000);
}
const libelleAnnee = (debut) => { const a = new Date(debut * 86400000).getUTCFullYear(); return `${a}-${a + 1}`; };
const versIso = (j) => new Date(j * 86400000).toISOString().slice(0, 10);
const depuisIso = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "").trim()); return m ? Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000) : null; };
const versHeure = (m) => (m == null ? "" : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
/** « 17:00 », « 17h00 », « 17h », « 8h30 » → minutes depuis minuit. */
export function lireHeure(t) {
  const m = /^\s*(\d{1,2})\s*[:hH]\s*(\d{2})?\s*$/.exec(String(t ?? ""));
  if (!m) return null;
  const h = +m[1], mn = +(m[2] || 0);
  return h <= 23 && mn <= 59 ? h * 60 + mn : null;
}
/** « 12 », « 10,5 » → nombre ; sinon null. */
export function lireNombre(t) {
  const s = String(t ?? "").trim().replace(",", ".");
  if (!s || !/^-?\d*\.?\d+$/.test(s)) return null;
  return Number(s);
}
/** 12 → « 12 », 10.5 → « 10,5 ». */
const nombreCourt = (v) => (v == null ? "" : Number.isInteger(v) ? String(v) : String(v).replace(".", ","));
/** « 12,5 » : une décimale. */
const texteMoy = (v) => v.toFixed(1).replace(".", ",");
/** Instant (ms, heure locale) du jour à minuit. */
const minuitLocal = (j) => { const d = new Date(j * 86400000); return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()).getTime(); };
/** Fin de l'épreuve : début + durée (1 h colle, 4 h DS) ; sans heure : fin de la journée. */
function finMillis(e) {
  if (e.heure == null) return minuitLocal(e.jour + 1);
  const d = e.duree ?? (e.type === "DS" || e.type === "EVALUATION" ? 240 : 60);
  return minuitLocal(e.jour) + (e.heure + d) * 60000;
}

/** Onglets en haut des pages Colles et DS / Emploi du temps / Résultats. */
export function ongletsPlanning(actif) {
  return `<nav class="sous-onglets">${[["planning", "Colles et DS"], ["edt", "Emploi du temps"], ["resultats", "Résultats"]]
    .map(([k, t]) => `<a href="#/${k}" class="${k === actif ? "actif" : ""}">${t}</a>`).join("")}</nav>`;
}

// ------------------------------------------------------------------ Lecture des événements

const SQL_EVT = `SELECT evenements.*, matieres.nom AS matiereNom, matieres.couleur AS matiereCouleur,
    matieres.sansProgramme AS matiereSansProgramme,
    (SELECT COUNT(*) FROM evenement_chapitres ec WHERE ec.evenementId = evenements.id) AS nbChapitres
  FROM evenements LEFT JOIN matieres ON matieres.id = evenements.matiereId`;
const ORDRE_EVT = " ORDER BY evenements.jour, COALESCE(evenements.heure, 0), evenements.id";

export const tousLesEvenements = () => tous(SQL_EVT + ORDRE_EVT);
const evenement = (id) => un(SQL_EVT + " WHERE evenements.id = ?", [id]);

export function titreAffiche(e) {
  if (e.titre && e.titre.trim()) return e.titre;
  return e.matiereNom ? `${TYPES[e.type]?.lib || e.type} de ${e.matiereNom}` : TYPES[e.type]?.lib || e.type;
}
/** Titre avec la matière en gras, dans sa couleur. */
export function titreColore(e) {
  const nom = e.matiereNom ? `<b style="color:${couleurHex(e.matiereCouleur)}">${echapper(e.matiereNom)}</b>` : "";
  if (e.titre && e.titre.trim()) return echapper(e.titre) + (nom ? " · " + nom : "");
  return nom ? `${TYPES[e.type]?.lib || e.type} de ${nom}` : echapper(TYPES[e.type]?.lib || e.type);
}
const programmeManquant = (e) => aPreparer(e.type) && !e.nbChapitres && !String(e.programme || "").trim() && !(e.matiereSansProgramme && e.type === "COLLE");

function details(e) {
  let h = null;
  if (e.heure != null) {
    h = e.duree != null ? `${heureLisible(e.heure)}–${heureLisible(e.heure + e.duree)}` : e.type === "DS" ? `${heureLisible(e.heure)} (durée ?)` : heureLisible(e.heure);
  }
  return [dateCourte(e.jour), h, e.salle || null, e.colleur || null].filter(Boolean).map(echapper).join(" · ");
}
function resumeProgramme(e) {
  if (programmeManquant(e)) return "Programme à compléter";
  const p = String(e.programme || "").trim();
  return [e.nbChapitres ? `${e.nbChapitres} chapitre(s)` : null, p ? (p.length > 60 ? p.slice(0, 60) + "…" : p) : null].filter(Boolean).join(" · ");
}

function carteEvenement(e, passe) {
  const prog = resumeProgramme(e);
  const t = TYPES[e.type] || TYPES.AUTRE;
  return `<a class="evt${passe ? " passe" : ""}" href="#/epreuve/${e.id}" style="--c:${t.coul}">
    <span class="evt-type">${t.lib}</span>
    <span class="evt-titre">${titreColore(e)}</span>
    <span class="petit">${details(e)}</span>
    ${prog ? `<span class="petit ${programmeManquant(e) ? "erreur" : "muet"}">${echapper(prog)}</span>` : ""}
  </a>`;
}

/** Colles / DS de la semaine affichée (pour l'accueil), pas encore terminés. */
export function epreuvesDeLaSemaine() {
  const j = aujourdhui();
  const maintenant = Date.now();
  return tous(SQL_EVT + " WHERE evenements.jour >= ? AND evenements.jour <= ?" + ORDRE_EVT, [j, dimancheAffiche(j)])
    .filter((e) => aPreparer(e.type) && finMillis(e) > maintenant);
}

export function blocSemaineAccueil() {
  const evs = epreuvesDeLaSemaine();
  const colles = evs.filter((e) => e.type === "COLLE");
  const ds = evs.filter((e) => e.type !== "COLLE");
  const ligne = (e) => `<a class="ligne cliquable" href="#/epreuve/${e.id}"><span class="trait" style="background:${TYPES[e.type].coul}"></span>
      <span class="ligne-texte"><span>${titreColore(e)}</span><span class="petit ${programmeManquant(e) ? "erreur" : "muet"}">${dateCourte(e.jour)}${e.heure != null ? " · " + heureLisible(e.heure) : ""} · ${delaiLisible(e.jour)}${programmeManquant(e) ? " · programme à compléter" : ""}</span></span><span class="chevron">›</span></a>`;
  const bloc = (titre, l, vide) => `<section><h2 class="titre-section">${titre}</h2>${l.length ? `<div class="liste">${l.map(ligne).join("")}</div>` : `<p class="petit muet">${vide}</p>`}</section>`;
  return bloc("Colles de la semaine", colles, "Aucune colle prévue — ajoute-les dans Planning.")
    + bloc("DS et évaluations de la semaine", ds, "Aucun DS ni évaluation cette semaine.");
}

// ------------------------------------------------------------------ Enregistrement

function definirChapitres(id, chapitres) {
  executer("DELETE FROM evenement_chapitres WHERE evenementId = ?", [id]);
  for (const c of chapitres) executer("INSERT OR IGNORE INTO evenement_chapitres (evenementId, chapitreId) VALUES (?, ?)", [id, c]);
}

/** Enregistre l'événement et tient à jour son objectif de révision (mode DS / colle). */
function enregistrer(e, chapitres, preparer) {
  return transaction(() => {
    let id = e.id;
    const v = [e.type, e.titre, e.matiereId, e.jour, e.heure, e.salle, e.colleur, e.programme, e.duree];
    if (!id) {
      executer("INSERT INTO evenements (type, titre, matiereId, jour, heure, salle, colleur, programme, duree, objectifId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)", v);
      id = dernierId();
    } else {
      executer("UPDATE evenements SET type = ?, titre = ?, matiereId = ?, jour = ?, heure = ?, salle = ?, colleur = ?, programme = ?, duree = ? WHERE id = ?", [...v, id]);
    }
    definirChapitres(id, chapitres);
    const ancien = valeur("SELECT objectifId FROM evenements WHERE id = ?", [id]);
    const existant = ancien ? un("SELECT * FROM objectifs WHERE id = ?", [ancien]) : null;
    let objectifId = null;
    if (preparer && aPreparer(e.type) && chapitres.length) {
      const matiere = e.matiereId ? valeur("SELECT nom FROM matieres WHERE id = ?", [e.matiereId]) : null;
      const titre = e.titre || (matiere ? `${TYPES[e.type].lib} de ${matiere}` : TYPES[e.type].lib);
      const liste = [...chapitres].sort((a, b) => a - b).join(",");
      if (existant) {
        executer("UPDATE objectifs SET titre = ?, jour = ?, chapitres = ? WHERE id = ?", [titre, e.jour, liste, existant.id]);
        objectifId = existant.id;
      } else {
        executer("INSERT INTO objectifs (titre, jour, chapitres) VALUES (?, ?, ?)", [titre, e.jour, liste]);
        objectifId = dernierId();
      }
    } else if (existant) {
      executer("DELETE FROM objectifs WHERE id = ?", [existant.id]);
    }
    executer("UPDATE evenements SET objectifId = ? WHERE id = ?", [objectifId, id]);
    return id;
  });
}

function supprimerEvenement(id) {
  transaction(() => {
    const o = valeur("SELECT objectifId FROM evenements WHERE id = ?", [id]);
    if (o) executer("DELETE FROM objectifs WHERE id = ?", [o]);
    executer("DELETE FROM evenements WHERE id = ?", [id]);
  });
}

// ------------------------------------------------------------------ Import d'un fichier de planning

const ALIAS = { math: "mathematiques", maths: "mathematiques", si: "sciencesindustriellessii", s2i: "sciencesindustriellessii", sii: "sciencesindustriellessii", info: "informatique", philo: "francaisphilosophie", francais: "francaisphilosophie" };
const compact = (s) => simplifier(s).replace(/[^a-z0-9]/g, "");
export function matiereDe(nom, matieres) {
  if (!String(nom || "").trim()) return null;
  const n = ALIAS[compact(nom)] || compact(nom);
  return matieres.find((m) => compact(m.nom) === n)
    || matieres.find((m) => compact(m.nom).startsWith(n) || n.startsWith(compact(m.nom)))
    || matieres.find((m) => compact(m.nom).includes(n) || n.includes(compact(m.nom))) || null;
}

/** Lit un planning JSON {"evenements": [...]} (même format que l'appli Android). */
export function lirePlanning(texte, matieres) {
  let liste;
  try { liste = JSON.parse(texte).evenements; } catch { liste = null; }
  if (!Array.isArray(liste)) return { evenements: [], erreurs: ["Fichier illisible : ce n'est pas un planning au bon format."] };
  const evenements = [], erreurs = [];
  liste.forEach((o, i) => {
    if (!o || typeof o !== "object") { erreurs.push(`Ligne ${i + 1} : format incorrect.`); return; }
    const type = Object.keys(TYPES).find((t) => t === String(o.type || "").trim().toUpperCase());
    const jour = depuisIso(o.date);
    if (!type || jour == null) { erreurs.push(`Ligne ${i + 1} : type ou date manquant(e) (date au format AAAA-MM-JJ).`); return; }
    const ecrite = String(o.matiere || "").trim();
    const bareme = lireNombre(o.bareme);
    evenements.push({
      type, titre: String(o.titre || "").trim(), matiere: matiereDe(ecrite, matieres), matiereEcrite: ecrite, jour,
      heure: lireHeure(o.heure) ?? (type === "DS" ? DEBUT_DS : null), duree: lireHeure(o.duree),
      salle: String(o.salle || "").trim(), colleur: String(o.colleur || "").trim(), programme: String(o.programme || "").trim(),
      note: lireNombre(o.note), bareme: bareme > 0 ? bareme : 20,
    });
  });
  return { evenements, erreurs };
}

export function importer(liste) {
  return transaction(() => {
    let n = 0, nbNotes = 0;
    for (const e of liste) {
      const mid = e.matiere ? e.matiere.id : null;
      let id = valeur(`SELECT id FROM evenements WHERE type = ? AND jour = ? AND heure IS ? AND matiereId IS ? AND titre = ? LIMIT 1`, [e.type, e.jour, e.heure, mid, e.titre]);
      if (!id) {
        executer("INSERT INTO evenements (type, titre, matiereId, jour, heure, salle, colleur, programme, objectifId, duree) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)",
          [e.type, e.titre, mid, e.jour, e.heure, e.salle, e.colleur, e.programme, e.duree]);
        id = dernierId();
        n++;
      }
      if (e.note != null && !valeur("SELECT COUNT(*) FROM notes WHERE evenementId = ?", [id])) {
        const t = e.type === "DS" ? "DS" : e.type === "COLLE" ? "COLLE" : "AUTRE";
        executer("INSERT INTO notes (matiereId, evenementId, type, jour, valeur, bareme, coefficient, rang, effectif, moyenneClasse, commentaire) VALUES (?, ?, ?, ?, ?, ?, 1, NULL, NULL, NULL, '')",
          [mid, id, t, e.jour, e.note, e.bareme]);
        nbNotes++;
      }
    }
    return [n, nbNotes];
  });
}

async function importerFichier(nav) {
  const f = await choisirFichier(".json,application/json,text/plain");
  if (!f) return;
  const l = lirePlanning(await f.text(), tous("SELECT id, nom FROM matieres"));
  const lignes = l.evenements.map((e) => `<li>${dateCourte(e.jour)}${e.heure != null ? " " + heureLisible(e.heure) : ""} — ${TYPES[e.type].lib}${e.matiere ? " de " + echapper(e.matiere.nom) : ""}${e.titre ? ` « ${echapper(e.titre)} »` : ""}${e.note != null ? ` — note ${nombreCourt(e.note)}/${nombreCourt(e.bareme)}` : ""}
    ${!e.matiere && e.matiereEcrite ? `<br><span class="erreur">matière « ${echapper(e.matiereEcrite)} » introuvable : l'événement sera sans matière</span>` : ""}</li>`).join("");
  const ok = await dialogue({
    titre: "Importer un planning", large: true,
    contenu: `<p>${l.evenements.length} événement(s) lu(s). Les événements déjà présents seront ignorés ; rien n'est supprimé.</p>
      <ul class="liste-import">${lignes}</ul>${l.erreurs.map((x) => `<p class="erreur">${echapper(x)}</p>`).join("")}`,
    boutons: [{ texte: "Annuler", valeur: false }, ...(l.evenements.length ? [{ texte: "Importer", valeur: true, style: "primaire" }] : [])],
  });
  if (!ok) return;
  const [n, nbNotes] = importer(l.evenements);
  const ignores = l.evenements.length - n;
  toast(`${n} événement(s) importé(s)${ignores > 0 ? ` (${ignores} déjà présent(s))` : ""}${nbNotes ? `, ${nbNotes} note(s) ajoutée(s) dans Résultats.` : "."}`, 5000);
  nav.rafraichir();
}

// ------------------------------------------------------------------ Calendrier (.ics)

const echIcs = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const utcIcs = (ms) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const dateIcs = (j) => versIso(j).replace(/-/g, "");
/** Plie les lignes à 75 octets (norme iCalendar). */
function plier(ligne) {
  const out = [];
  let reste = ligne;
  while (new TextEncoder().encode(reste).length > 73) {
    let n = 73;
    while (new TextEncoder().encode(reste.slice(0, n)).length > 73) n--;
    out.push(reste.slice(0, n));
    reste = " " + reste.slice(n);
  }
  out.push(reste);
  return out.join("\r\n");
}

export function genererIcs(evs) {
  const l = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//malivertcpge//Planning//FR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  const stamp = utcIcs(Date.now());
  for (const e of evs) {
    const chap = tous("SELECT chapitres.titre FROM evenement_chapitres ec INNER JOIN chapitres ON chapitres.id = ec.chapitreId WHERE ec.evenementId = ? ORDER BY chapitres.ordre", [e.id]).map((c) => c.titre);
    const desc = [e.colleur ? "Colleur : " + e.colleur : null, e.programme ? "Programme : " + e.programme : null, chap.length ? "Chapitres : " + chap.join(", ") : null].filter(Boolean).join("\n");
    l.push("BEGIN:VEVENT", `UID:evenement-${e.id}-${e.jour}@malivertcpge`, `DTSTAMP:${stamp}`);
    if (e.heure == null) {
      l.push(`DTSTART;VALUE=DATE:${dateIcs(e.jour)}`, `DTEND;VALUE=DATE:${dateIcs(e.jour + 1)}`);
    } else {
      const debut = minuitLocal(e.jour) + e.heure * 60000;
      l.push(`DTSTART:${utcIcs(debut)}`, `DTEND:${utcIcs(finMillis(e))}`);
    }
    l.push(`SUMMARY:${echIcs(titreAffiche(e))}`);
    if (e.salle) l.push(`LOCATION:${echIcs(e.salle)}`);
    if (desc) l.push(`DESCRIPTION:${echIcs(desc)}`);
    if (aPreparer(e.type)) {
      l.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${echIcs(titreAffiche(e))} demain`, "TRIGGER:-P1D", "END:VALARM");
      if (e.heure != null) l.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${echIcs(titreAffiche(e))}`, "TRIGGER:-PT1H", "END:VALARM");
    }
    l.push("END:VEVENT");
  }
  l.push("END:VCALENDAR");
  return l.map(plier).join("\r\n") + "\r\n";
}

const estIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/** Ouvre / télécharge le fichier .ics : le téléphone propose de l'ajouter à son agenda. */
export function ajouterAuCalendrier(evs, nom) {
  if (!evs.length) { toast("Rien à ajouter."); return; }
  const texte = genererIcs(evs);
  if (estIos()) {
    // Safari sur iPhone ouvre directement l'écran « Ajouter au calendrier ».
    location.href = "data:text/calendar;charset=utf-8," + encodeURIComponent(texte);
    return;
  }
  telecharger(new Blob([texte], { type: "text/calendar;charset=utf-8" }), nom);
  toast("Fichier téléchargé : ouvre-le pour l'ajouter à ton agenda.", 4500);
}

// ------------------------------------------------------------------ Onglet Planning

export function vuePlanning(el, nav, params) {
  const jour = aujourdhui();
  const passee = params.get("annee") === "passee";
  const afficherPasse = reglages.lire("planningPasses", false);
  const debut = debutAnneeScolaire(jour);
  const debutPassee = debutAnneeScolaire(debut - 1);
  const tous_ = tousLesEvenements();
  const cette = tous_.filter((e) => e.jour >= debut);
  const listePassee = tous_.filter((e) => e.jour >= debutPassee && e.jour < debut);
  const aVoir = passee ? listePassee : cette.filter((e) => afficherPasse || e.jour >= jour);
  const aCompleter = passee ? [] : cette.filter((e) => e.jour >= jour && programmeManquant(e));
  const semaines = new Map();
  for (const e of aVoir) { const l = lundi(e.jour); if (!semaines.has(l)) semaines.set(l, []); semaines.get(l).push(e); }
  const aVenirCal = cette.filter((e) => finMillis(e) > Date.now());

  // Encadré : cette semaine et la suivante.
  const maintenant = Date.now();
  const evals = cette.filter((e) => aPreparer(e.type) && finMillis(e) > maintenant);
  const prochaine = lundi(jour) + 7;
  const ligneEnc = (e) => `<a class="enc-ligne" href="#/epreuve/${e.id}"><span class="trait" style="background:${TYPES[e.type].coul}"></span>
    <span><span>${titreColore(e)}</span><br><span class="petit ${programmeManquant(e) ? "erreur" : "muet"}">${[dateCourte(e.jour), e.heure != null ? heureLisible(e.heure) : null, programmeManquant(e) ? "programme à compléter" : null].filter(Boolean).join(" · ")}</span></span></a>`;
  const encadre = [["Cette semaine", evals.filter((e) => e.jour < prochaine)],
    [`Semaine prochaine (${titreSemaine(prochaine).replace("Semaine ", "")})`, evals.filter((e) => e.jour >= prochaine && e.jour < prochaine + 7)]]
    .map(([t, l]) => `<h3 class="enc-titre">${t}</h3>${l.length ? l.map(ligneEnc).join("") : `<p class="petit muet">Rien de prévu.</p>`}`).join("");

  el.innerHTML = `
    ${ongletsPlanning("planning")}
    <h1 class="titre-page">Colles et DS</h1>
    <div class="onglets">
      <a class="onglet${passee ? "" : " actif"}" href="#/planning">Cette année (${libelleAnnee(debut)})</a>
      <a class="onglet${passee ? " actif" : ""}" href="#/planning?annee=passee">Année passée (${listePassee.length})</a>
    </div>
    ${passee ? `<p class="petit muet">Colles, DS et évaluations de l'année ${libelleAnnee(debutPassee)}. Pour ajouter ta feuille de colles de l'an dernier : envoie-en une photo à Claude, puis « Importer un fichier » avec le fichier qu'il te prépare.</p>`
      : `<section class="carte-acc encadre-semaines">${encadre}</section>`}
    <div class="rangee-boutons">
      <a class="bouton primaire" href="#/evenement/0">+ Ajouter</a>
      <button class="bouton" id="importer">Importer un fichier</button>
      <a class="bouton" href="#/classe">Ma classe</a>
      ${passee ? "" : `<button class="bouton" id="calendrier" ${aVenirCal.length ? "" : "disabled"}>📅 Tout ajouter au calendrier</button>`}
    </div>
    ${passee ? "" : `<label class="interrupteur"><input type="checkbox" id="passes" ${afficherPasse ? "checked" : ""}><span>Afficher les événements passés</span></label>`}
    ${aCompleter.length ? `<details class="replie alerte"><summary>⚠ ${aCompleter.length} programme(s) à compléter</summary>
      ${aCompleter.map((e) => `<a class="lien-bloc" href="#/evenement/${e.id}">• ${dateCourte(e.jour)} — ${echapper(titreAffiche(e))}</a>`).join("")}</details>` : ""}
    ${aVoir.length ? "" : `<p class="muet">${passee ? "Rien pour l'année passée pour l'instant." : "Aucun événement à venir. Ajoute tes colles et DS avec « + Ajouter », ou importe un fichier de planning (Claude peut le préparer à partir d'une photo du colloscope)."}</p>`}
    ${[...semaines.entries()].map(([l, evs]) => `<h2 class="titre-section">${titreSemaine(l)}${l === lundi(jour) ? " (cette semaine)" : ""}</h2>
      <div class="liste">${evs.map((e) => carteEvenement(e, e.jour < jour)).join("")}</div>`).join("")}
  `;
  el.querySelector("#importer").onclick = () => importerFichier(nav);
  const cal = el.querySelector("#calendrier");
  if (cal) cal.onclick = () => ajouterAuCalendrier(aVenirCal, "colles_et_ds.ics");
  const p = el.querySelector("#passes");
  if (p) p.onchange = () => { reglages.ecrire("planningPasses", p.checked); nav.rafraichir(); };
}

// ------------------------------------------------------------------ Création / modification d'un événement

export function vueEvenement(el, id, nav) {
  const e = id ? un("SELECT * FROM evenements WHERE id = ?", [id]) : null;
  if (id && !e) { el.innerHTML = `<p class="muet">Événement introuvable.</p>`; return; }
  const matieres = tous("SELECT id, nom, couleur FROM matieres WHERE masquee = 0 ORDER BY ordre, id");
  const chapitres = tous(`SELECT chapitres.id, chapitres.titre, chapitres.matiereId FROM chapitres INNER JOIN matieres ON matieres.id = chapitres.matiereId
    WHERE chapitres.masque = 0 AND matieres.masquee = 0 ORDER BY matieres.ordre, chapitres.ordre, chapitres.id`);
  const coches = new Set(e ? tous("SELECT chapitreId FROM evenement_chapitres WHERE evenementId = ?", [e.id]).map((c) => c.chapitreId) : []);
  const S = {
    type: e?.type || "COLLE", matiereId: e?.matiereId ?? null, jour: e?.jour ?? aujourdhui() + 1,
    heure: e ? e.heure : 18 * 60, duree: e?.duree ?? null, preparer: e ? (e.objectifId != null || coches.size === 0) : true,
  };

  function dessiner() {
    const chapsAffiches = S.matiereId ? chapitres.filter((c) => c.matiereId === S.matiereId) : chapitres;
    const parMatiere = new Map();
    for (const c of chapsAffiches) { if (!parMatiere.has(c.matiereId)) parMatiere.set(c.matiereId, []); parMatiere.get(c.matiereId).push(c); }
    const estDs = S.type === "DS" || S.type === "EVALUATION";
    el.querySelector("#types").innerHTML = Object.entries(TYPES).map(([t, v]) => `<button type="button" class="puce-choix${S.type === t ? " actif" : ""}" data-type="${t}">${v.lib}</button>`).join("");
    el.querySelector("#matieres").innerHTML = [`<button type="button" class="puce-choix${S.matiereId == null ? " actif" : ""}" data-matiere="">Aucune</button>`,
      ...matieres.map((m) => `<button type="button" class="puce-choix${S.matiereId === m.id ? " actif" : ""}" data-matiere="${m.id}"><span class="pastille" style="background:${couleurHex(m.couleur)}"></span>${echapper(m.nom)}</button>`)].join("");
    el.querySelector("#bloc-duree").hidden = !estDs;
    el.querySelector("#durees").innerHTML = [60, 120, 180, 240].map((m) => `<button type="button" class="puce-choix${S.duree === m ? " actif" : ""}" data-duree="${m}">${m / 60} h</button>`).join("");
    const h = lireHeure(el.querySelector("#heure").value);
    el.querySelector("#info-duree").textContent = S.duree == null ? "Durée non précisée : choisis 3 h ou 4 h." : h != null ? `De ${heureLisible(h)} à ${heureLisible(h + S.duree)}` : `${S.duree / 60} h`;
    el.querySelector("#bloc-colleur").hidden = S.type !== "COLLE";
    el.querySelector("#bloc-preparer").hidden = !aPreparer(S.type);
    el.querySelector("#chapitres").innerHTML = chapsAffiches.length ? [...parMatiere.entries()].map(([mid, cs]) => `
      <details class="replie" ${S.matiereId ? "open" : ""}><summary>${echapper(matieres.find((m) => m.id === mid)?.nom || "")} <small class="muet">${cs.filter((c) => coches.has(c.id)).length} / ${cs.length}</small></summary>
      ${cs.map((c) => `<label class="case"><input type="checkbox" value="${c.id}" ${coches.has(c.id) ? "checked" : ""}><span>${echapper(c.titre)}</span></label>`).join("")}</details>`).join("")
      : `<p class="petit muet">Aucun chapitre dans cette matière : ajoute-les dans l'onglet Matières, ou écris le programme en texte libre.</p>`;
  }

  el.innerHTML = `
    <a class="retour" href="#/planning">‹ Planning</a>
    <h1 class="titre-page">${e ? "Modifier l'événement" : "Nouvel événement"}</h1>
    <div class="puces" id="types"></div>
    <h3 class="sous-titre">Matière</h3>
    <div class="puces" id="matieres"></div>
    <label class="champ"><span>Titre (facultatif, ex. DS n°3)</span><input id="titre" maxlength="100" value="${echapper(e?.titre || "")}"></label>
    <div class="deux-col">
      <label class="champ"><span>Date</span><input id="date" type="date" value="${versIso(S.jour)}"></label>
      <label class="champ"><span>Heure (vide = pas d'heure)</span><input id="heure" type="time" value="${versHeure(S.heure)}"></label>
    </div>
    <div id="bloc-duree"><h3 class="sous-titre">Durée</h3><div class="puces" id="durees"></div><p class="petit muet" id="info-duree"></p></div>
    <label class="champ"><span>Salle</span><input id="salle" maxlength="60" value="${echapper(e?.salle || "")}"></label>
    <label class="champ" id="bloc-colleur"><span>Colleur / colleuse</span><input id="colleur" maxlength="60" value="${echapper(e?.colleur || "")}"></label>
    <label class="champ"><span>Programme (texte libre)</span><textarea id="programme" rows="2">${echapper(e?.programme || "")}</textarea></label>
    <label class="interrupteur" id="bloc-preparer"><input type="checkbox" id="preparer" ${S.preparer ? "checked" : ""}>
      <span><b>Préparer en mode révision</b><br><small>Les chapitres cochés apparaissent dans Réviser → Colles et DS, avec des révisions rapprochées jusqu'au jour J.</small></span></label>
    <h3 class="sous-titre">Chapitres au programme</h3>
    <div id="chapitres"></div>
    ${e ? `<button class="bouton discret texte-rouge" id="supprimer">Supprimer cet événement…</button>` : ""}
    <div class="barre-bas"><button class="bouton primaire large" id="enregistrer">Enregistrer</button></div>
  `;
  dessiner();
  el.onclick = (ev) => {
    const b = ev.target.closest("[data-type],[data-matiere],[data-duree]");
    if (!b) return;
    if (b.dataset.type) {
      // Un nouveau DS commence par défaut à 8h.
      const h = el.querySelector("#heure");
      if (b.dataset.type === "DS" && S.type !== "DS" && (!e || !h.value)) h.value = versHeure(DEBUT_DS);
      S.type = b.dataset.type;
    }
    if (b.dataset.matiere !== undefined) S.matiereId = b.dataset.matiere ? Number(b.dataset.matiere) : null;
    if (b.dataset.duree) { const d = Number(b.dataset.duree); S.duree = S.duree === d ? null : d; }
    dessiner();
  };
  el.querySelector("#heure").oninput = () => dessiner();
  el.querySelector("#chapitres").onchange = (ev) => {
    const i = ev.target;
    if (i.type === "checkbox") { i.checked ? coches.add(Number(i.value)) : coches.delete(Number(i.value)); }
  };
  el.querySelector("#enregistrer").onclick = () => {
    const jour = depuisIso(el.querySelector("#date").value);
    if (jour == null) { toast("Choisis une date."); return; }
    const nouveau = enregistrer({
      id: e?.id || 0, type: S.type, titre: el.querySelector("#titre").value.trim(), matiereId: S.matiereId, jour,
      heure: lireHeure(el.querySelector("#heure").value), duree: S.type === "DS" || S.type === "EVALUATION" ? S.duree : e?.duree ?? null,
      salle: el.querySelector("#salle").value.trim(), colleur: el.querySelector("#colleur").value.trim(),
      programme: el.querySelector("#programme").value.trim(),
    }, [...coches], el.querySelector("#preparer").checked);
    toast("Enregistré ✓");
    location.replace(`#/epreuve/${nouveau}`);
  };
  const sup = el.querySelector("#supprimer");
  if (sup) sup.onclick = async () => {
    if (!(await confirmer("Supprimer cet événement ?", "Suppression définitive. Si un objectif de révision y était lié, il est supprimé aussi (tes révisions déjà faites sont conservées).", "Supprimer", true))) return;
    supprimerEvenement(e.id);
    toast("Événement supprimé");
    location.replace("#/planning");
  };
}

// ------------------------------------------------------------------ Détail d'une colle / d'un DS

function progressionDe(ids) {
  if (!ids.length) return [];
  const jour = aujourdhui();
  const marques = ids.map(() => "?").join(",");
  return tous(`SELECT chapitres.id AS chapitreId, chapitres.titre AS titre, matieres.nom AS matiere,
      (SELECT COUNT(*) FROM formules f WHERE f.chapitreId = chapitres.id AND f.horsRevision = 0) AS nbFormules,
      (SELECT COUNT(*) FROM cartes c INNER JOIN formules f ON f.id = c.formuleId WHERE f.chapitreId = chapitres.id) AS nbCartes,
      (SELECT COALESCE(SUM(MIN(c.boite, 6)), 0) FROM cartes c INNER JOIN formules f ON f.id = c.formuleId WHERE f.chapitreId = chapitres.id AND c.nbRevisions > 0) AS points,
      (SELECT COUNT(*) FROM cartes c INNER JOIN formules f ON f.id = c.formuleId WHERE f.chapitreId = chapitres.id AND c.boite >= 4) AS ancrees,
      (SELECT COUNT(*) FROM cartes c INNER JOIN formules f ON f.id = c.formuleId WHERE f.chapitreId = chapitres.id AND c.prochaine IS NOT NULL AND c.prochaine <= ?) AS dues
    FROM chapitres INNER JOIN matieres ON matieres.id = chapitres.matiereId
    WHERE chapitres.id IN (${marques}) ORDER BY matieres.ordre, chapitres.ordre, chapitres.id`, [jour, ...ids])
    .map((p) => { const a = Math.max(p.nbCartes, 2 * p.nbFormules); return { ...p, attendues: a, progression: a ? Math.min(1, p.points / (6 * a)) : 0 }; });
}

export function vueDetail(el, id, nav, params) {
  const objArg = Number(params.get("o")) || 0;
  let e = id ? evenement(id) : objArg ? un(SQL_EVT + " WHERE evenements.objectifId = ?", [objArg]) : null;
  const objectifId = e?.objectifId ?? (objArg || null);
  const o = objectifId ? un("SELECT * FROM objectifs WHERE id = ?", [objectifId]) : null;
  if (!e && !o) { el.innerHTML = `<a class="retour" href="#/planning">‹ Planning</a><p class="muet">Cette épreuve n'existe plus.</p>`; return; }
  let ids = e ? tous("SELECT chapitreId FROM evenement_chapitres WHERE evenementId = ?", [e.id]).map((c) => c.chapitreId) : [];
  if (!ids.length && o) ids = String(o.chapitres || "").split(",").map(Number).filter(Boolean);
  const prog = progressionDe(ids);
  const prepa = e ? aPreparer(e.type) : true;
  const note = e ? un("SELECT * FROM notes WHERE evenementId = ? LIMIT 1", [e.id]) : null;
  const attendues = prog.reduce((s, p) => s + p.attendues, 0);
  const total = attendues ? Math.min(1, prog.reduce((s, p) => s + p.points, 0) / (6 * attendues)) : 0;
  const dues = prog.reduce((s, p) => s + p.dues, 0);
  const coul = e ? (TYPES[e.type] || TYPES.AUTRE).coul : TYPES.DS.coul;
  const estPasse = e ? finMillis(e) < Date.now() : o.jour < aujourdhui();

  el.innerHTML = `
    <a class="retour" href="#/planning">‹ Planning</a>
    ${e ? `<div class="evt-type" style="color:${coul};margin-top:8px">${TYPES[e.type]?.lib || e.type}</div>
      <h1 class="titre-page sans-marge">${titreColore(e)}</h1>
      <p class="muet">${details(e)} · ${delaiLisible(e.jour)}</p>
      ${e.programme ? `<p>Programme : ${echapper(e.programme)}</p>` : ""}`
    : `<h1 class="titre-page">${echapper(o.titre)}</h1><p class="muet">${dateLisible(o.jour)} · ${delaiLisible(o.jour)}</p>`}
    <div class="rangee-boutons">
      ${o && !estPasse ? `<button class="bouton primaire" data-nav="#/seance?o=${o.id}">▶ Réviser</button>` : ""}
      ${e ? `<a class="bouton" href="#/evenement/${e.id}">✎ Modifier</a>` : ""}
      ${e && !estPasse ? `<button class="bouton" id="calendrier">📅 Ajouter au calendrier</button>` : ""}
      ${e && e.type !== "AUTRE" && e.jour <= aujourdhui() ? `<button class="bouton" id="note">${note ? `Note : ${nombreCourt(note.valeur)}/${nombreCourt(note.bareme)}` : "+ Ajouter la note"}</button>` : ""}
    </div>
    ${prepa ? (prog.length ? `
      <section class="carte-acc">
        <div class="ligne-titre"><b>Progression des formules</b><b class="gros">${pct(total)} %</b></div>
        <div class="barre"><div style="width:${pct(total)}%;background:var(--primaire)"></div></div>
        <p class="petit muet">${prog.length} chapitre(s) · ${prog.reduce((s, p) => s + p.nbFormules, 0)} formule(s)${dues ? ` · ${dues} carte(s) à revoir aujourd'hui` : ""}</p>
      </section>
      <div class="liste">${prog.map((p) => `<a class="ligne cliquable colonne" href="#/chapitre/${p.chapitreId}">
        <span class="ligne-titre"><span>${echapper(p.titre)}</span><b>${pct(p.progression)} %</b></span>
        <div class="barre"><div style="width:${pct(p.progression)}%;background:var(--primaire)"></div></div>
        <span class="petit muet">${echapper(p.matiere)} · ${p.nbFormules} formule(s) · ${p.ancrees} carte(s) bien ancrée(s)${p.dues ? ` · ${p.dues} à revoir` : ""}</span></a>`).join("")}</div>`
      : `<p class="muet">${e?.matiereSansProgramme ? "Pas de programme pour cette matière." : "Aucun chapitre au programme : touche « ✎ Modifier » pour les cocher."}</p>`) : ""}
    ${prepa && prog.length ? `<div id="td-epreuve"></div>` : ""}
  `;
  const zoneTd = el.querySelector("#td-epreuve");
  if (zoneTd) blocTdEpreuve(zoneTd, prog.map((p) => p.chapitreId));
  const cal = el.querySelector("#calendrier");
  if (cal) cal.onclick = () => ajouterAuCalendrier([e], `${simplifier(titreAffiche(e)).replace(/[^a-z0-9]+/g, "_")}.ics`);
  const bn = el.querySelector("#note");
  if (bn) bn.onclick = async () => { if (await dialogueNote(note || noteDepuis(e))) nav.rafraichir(); };
}

// ------------------------------------------------------------------ Rappel à l'ouverture

/** Une fois par jour : rappelle les colles / DS d'aujourd'hui, demain et après-demain. */
export async function rappelOuverture(nav) {
  const j = aujourdhui();
  if (reglages.lire("rappelVu", null) === j) return;
  const evs = tous(SQL_EVT + " WHERE evenements.jour >= ? AND evenements.jour <= ?" + ORDRE_EVT, [j, j + 2])
    .filter((e) => aPreparer(e.type) && finMillis(e) > Date.now());
  if (!evs.length) return;
  reglages.ecrire("rappelVu", j);
  const r = await dialogue({
    titre: "📌 Bientôt",
    contenu: `<div class="liste">${evs.map((e) => `<div class="ligne"><span class="trait" style="background:${TYPES[e.type].coul}"></span>
      <div class="ligne-texte"><span>${titreColore(e)}</span><span class="petit ${programmeManquant(e) ? "erreur" : "muet"}">${delaiLisible(e.jour)}${e.heure != null ? " à " + heureLisible(e.heure) : ""}${e.salle ? " · " + echapper(e.salle) : ""}${programmeManquant(e) ? " · programme à compléter" : ""}</span></div>
      ${e.objectifId ? `<button class="bouton petit" data-reviser="${e.objectifId}">▶ Réviser</button>` : `<button class="bouton petit" data-voir="${e.id}">Voir</button>`}</div>`).join("")}</div>`,
    boutons: [{ texte: "OK", valeur: true, style: "primaire" }],
    apresOuverture: (fond) => {
      fond.addEventListener("click", (ev) => {
        const b = ev.target.closest("[data-reviser],[data-voir]");
        if (!b) return;
        fond.querySelector(".modal-boutons button").click();
        nav.aller(b.dataset.reviser ? `#/seance?o=${b.dataset.reviser}` : `#/epreuve/${b.dataset.voir}`);
      });
    },
  });
  return r;
}

// ------------------------------------------------------------------ Résultats

function noteDepuis(e) {
  const t = { COLLE: "COLLE", DS: "DS", EVALUATION: "INTERRO", AUTRE: "AUTRE" }[e.type] || "AUTRE";
  return { id: 0, type: t, matiereId: e.matiereId, evenementId: e.id, jour: e.jour, valeur: null, bareme: 20, coefficient: 1, rang: null, effectif: null, moyenneClasse: null, commentaire: "" };
}

const moyenne = (l) => { const s = l.reduce((a, n) => a + n.c, 0); return s > 0 ? l.reduce((a, n) => a + n.v * n.c, 0) / s : null; };
function tendance(l) {
  if (l.length < 4) return null;
  const t = [...l].sort((a, b) => a.j - b.j);
  const r = moyenne(t.slice(-3)), a = moyenne(t.slice(0, -3));
  return r == null || a == null ? null : r - a;
}
const surVingt = (n) => (n.bareme > 0 ? (n.valeur * 20) / n.bareme : 0);
const classeSurVingt = (n) => (n.moyenneClasse != null && n.bareme > 0 ? (n.moyenneClasse * 20) / n.bareme : null);

function bilans(notes) {
  const groupes = new Map();
  for (const n of notes) { const k = n.matiereId ?? "x"; if (!groupes.has(k)) groupes.set(k, []); groupes.get(k).push(n); }
  return [...groupes.entries()].map(([k, l]) => {
    const n20 = l.map((n) => ({ v: surVingt(n), c: n.coefficient, j: n.jour }));
    const cl = l.filter((n) => classeSurVingt(n) != null).map((n) => ({ v: classeSurVingt(n), c: n.coefficient, j: n.jour }));
    return {
      matiereId: k === "x" ? null : k, nom: l[0].matiereNom || "Sans matière", couleur: l[0].matiereCouleur != null ? couleurHex(l[0].matiereCouleur) : "#607d8b",
      coefficient: l[0].matiereCoef ?? 1, notes: [...l].sort((a, b) => a.jour - b.jour || a.id - b.id),
      moyenne: moyenne(n20), moyenneClasse: moyenne(cl), tendance: tendance(n20),
    };
  }).sort((a, b) => b.notes.length - a.notes.length);
}

/** Courbe des notes sur 20 (trait plein) et moyenne de classe (pointillés), en SVG. */
function graphique(notes, couleur, haut) {
  const L = 600, H = haut, m = 10, l = L - 2 * m, h = H - 2 * m;
  const y = (v) => m + h * (1 - Math.max(0, Math.min(20, v)) / 20);
  const x = (i) => m + (notes.length <= 1 ? l / 2 : (l * i) / (notes.length - 1));
  const grille = [5, 10, 15].map((v) => `<line x1="${m}" x2="${m + l}" y1="${y(v)}" y2="${y(v)}" stroke="var(--bord)" stroke-width="1"/>${haut > 80 ? `<text x="${m + 2}" y="${y(v) - 3}" font-size="11" fill="var(--muet)">${v}</text>` : ""}`).join("");
  const cl = notes.map((n, i) => (classeSurVingt(n) != null ? `${x(i)},${y(classeSurVingt(n))}` : null)).filter(Boolean);
  const pts = notes.map((n, i) => [x(i), y(surVingt(n))]);
  return `<svg class="graphique" viewBox="0 0 ${L} ${H}" preserveAspectRatio="none" style="height:${haut}px" aria-hidden="true">${grille}
    ${cl.length > 1 ? `<polyline points="${cl.join(" ")}" fill="none" stroke="var(--muet)" stroke-width="2" stroke-dasharray="8 6" vector-effect="non-scaling-stroke"/>` : ""}
    <polyline points="${pts.map((p) => p.join(",")).join(" ")}" fill="none" stroke="${couleur}" stroke-width="3" vector-effect="non-scaling-stroke"/>
  </svg><div class="points-graphique" style="height:${haut}px">${pts.map(([px, py]) => `<span style="left:${(px / L) * 100}%;top:${(py / H) * 100}%;background:${couleur}"></span>`).join("")}</div>`;
}

export function vueResultats(el, nav, params) {
  const passee = params.get("annee") === "passee";
  const ouvertes = new Set(reglages.lire("resultatsOuverts", []));
  const jour = aujourdhui();
  const debut = debutAnneeScolaire(jour), debutPassee = debutAnneeScolaire(debut - 1);
  const toutes = tous(`SELECT notes.*, matieres.nom AS matiereNom, matieres.couleur AS matiereCouleur, matieres.coefficient AS matiereCoef
    FROM notes LEFT JOIN matieres ON matieres.id = notes.matiereId ORDER BY notes.jour, notes.id`);
  const liste = passee ? toutes.filter((n) => n.jour >= debutPassee && n.jour < debut) : toutes.filter((n) => n.jour >= debut);
  const nbPassees = toutes.filter((n) => n.jour >= debutPassee && n.jour < debut).length;
  const parMatiere = bilans(liste);
  const gen = parMatiere.filter((b) => b.moyenne != null);
  const sc = gen.reduce((s, b) => s + b.coefficient, 0);
  const generale = sc > 0 ? gen.reduce((s, b) => s + b.moyenne * b.coefficient, 0) / sc : null;
  const dejaNotes = new Set(tous("SELECT evenementId FROM notes WHERE evenementId IS NOT NULL").map((r) => r.evenementId));
  const aNoter = passee ? [] : tousLesEvenements().filter((e) => e.type !== "AUTRE" && e.jour <= jour && e.jour >= jour - 45 && !dejaNotes.has(e.id)).sort((a, b) => b.jour - a.jour);

  el.innerHTML = `
    ${ongletsPlanning("resultats")}
    <h1 class="titre-page">Résultats</h1>
    <div class="onglets">
      <a class="onglet${passee ? "" : " actif"}" href="#/resultats">Cette année (${libelleAnnee(debut)})</a>
      <a class="onglet${passee ? " actif" : ""}" href="#/resultats?annee=passee">Année passée (${nbPassees})</a>
    </div>
    <section class="encart accent">
      <div><span class="petit">${passee ? `Moyenne générale ${libelleAnnee(debutPassee)}` : "Moyenne générale"}</span>
        <div class="tres-gros">${generale != null ? texteMoy(generale) + " / 20" : "—"}</div><span class="petit muet">${liste.length} note(s)</span></div>
      <button class="bouton primaire" id="nouvelle">+ Note</button>
    </section>
    ${aNoter.length ? `<h2 class="titre-section">À noter (${aNoter.length})</h2><div class="liste">${aNoter.slice(0, 6).map((e) => `
      <button class="ligne cliquable" data-anoter="${e.id}"><span class="ligne-texte"><span>${titreColore(e)}</span><span class="petit muet">${dateCourte(e.jour)}</span></span><span class="lien">Ajouter la note ▶</span></button>`).join("")}</div>` : ""}
    ${liste.length ? "" : `<p class="muet">${passee ? "Aucune note de l'année passée. Importe ta feuille de colles de l'an dernier (Planning → Importer un fichier) : les notes arrivent ici avec leurs graphiques."
      : "Aucune note pour l'instant. Ajoute tes notes de colles et de DS : moyenne par matière, moyenne générale (avec les coefficients), rang et évolution en graphique."}</p>`}
    <div class="liste">${parMatiere.map((b) => {
      const cle = String(b.matiereId);
      const ouverte = ouvertes.has(cle);
      const t = b.tendance;
      const infos = [`${b.notes.length} note(s)`, b.moyenneClasse != null ? `classe : ${texteMoy(b.moyenneClasse)}` : null,
        t != null ? (t > 0.5 ? `en progrès ↗ (+${texteMoy(t)})` : t < -0.5 ? `en baisse ↘ (${texteMoy(t)})` : "stable →") : null,
        b.coefficient !== 1 ? `coef. ${texteMoy(b.coefficient)}` : null].filter(Boolean).join(" · ");
      return `<div class="carte-resultat${ouverte ? " ouverte" : ""}" data-cle="${cle}">
        <div class="ligne-titre"><span><span class="pastille" style="background:${b.couleur}"></span> <b>${echapper(b.nom)}</b></span><b class="gros">${b.moyenne != null ? texteMoy(b.moyenne) : "—"}</b></div>
        <p class="petit muet">${infos}</p>
        ${b.notes.length >= 2 ? `<div class="zone-graphique">${graphique(b.notes, b.couleur, ouverte ? 160 : 60)}</div>` : ""}
        ${ouverte ? `<div class="notes">${[...b.notes].reverse().map((n) => `<button class="ligne cliquable" data-note="${n.id}">
          <span class="ligne-texte"><span>${TYPES_NOTE[n.type] || n.type} · ${dateLisible(n.jour)}</span>
          <span class="petit muet">${[n.rang != null ? `rang ${n.rang}${n.effectif != null ? "/" + n.effectif : ""}` : null, classeSurVingt(n) != null ? `classe ${texteMoy(classeSurVingt(n))}` : null, n.coefficient !== 1 ? `coef ${texteMoy(n.coefficient)}` : null, n.commentaire || null].filter(Boolean).map(echapper).join(" · ")}</span></span>
          <b>${nombreCourt(n.valeur)}/${nombreCourt(n.bareme)}</b></button>`).join("")}</div><p class="petit muet">Touche une note pour la modifier.</p>`
          : `<span class="petit lien">Touche pour voir le détail</span>`}
      </div>`;
    }).join("")}</div>
    ${liste.length ? `<button class="bouton discret" id="coefs">Coefficients des matières (moyenne générale)</button>` : ""}
  `;
  el.querySelector("#nouvelle").onclick = async () => {
    if (await dialogueNote({ id: 0, type: "COLLE", matiereId: null, evenementId: null, jour: passee ? debut - 1 : jour, valeur: null, bareme: 20, coefficient: 1, rang: null, effectif: null, moyenneClasse: null, commentaire: "" })) nav.rafraichir();
  };
  el.onclick = async (ev) => {
    const a = ev.target.closest("[data-anoter]");
    if (a) { if (await dialogueNote(noteDepuis(evenement(Number(a.dataset.anoter))))) nav.rafraichir(); return; }
    const n = ev.target.closest("[data-note]");
    if (n) { if (await dialogueNote(un("SELECT * FROM notes WHERE id = ?", [Number(n.dataset.note)]))) nav.rafraichir(); return; }
    const c = ev.target.closest("[data-cle]");
    if (c) {
      const k = c.dataset.cle;
      ouvertes.has(k) ? ouvertes.delete(k) : ouvertes.add(k);
      reglages.ecrire("resultatsOuverts", [...ouvertes]);
      nav.rafraichir();
    }
  };
  const bc = el.querySelector("#coefs");
  if (bc) bc.onclick = async () => {
    const ms = tous("SELECT id, nom, couleur, coefficient FROM matieres ORDER BY ordre").filter((m) => parMatiere.some((b) => b.matiereId === m.id));
    const r = await dialogue({
      titre: "Coefficients",
      contenu: `<p class="petit muet">Poids de chaque matière dans la moyenne générale (ex. coefficients du concours).</p>
        ${ms.map((m) => `<label class="champ ligne-coef"><b style="color:${couleurHex(m.couleur)}">${echapper(m.nom)}</b><input inputmode="decimal" data-coef="${m.id}" value="${nombreCourt(m.coefficient)}"></label>`).join("")}`,
      boutons: [{ texte: "Annuler", valeur: false }, { texte: "OK", style: "primaire", valeur: (fond) => [...fond.querySelectorAll("[data-coef]")].map((i) => [Number(i.dataset.coef), lireNombre(i.value)]) }],
    });
    if (!r) return;
    for (const [id, c] of r) if (c != null && c > 0) executer("UPDATE matieres SET coefficient = ? WHERE id = ?", [c, id]);
    nav.rafraichir();
  };
}

/** Saisie / modification d'une note. Résout true si quelque chose a changé. */
async function dialogueNote(n) {
  const matieres = tous("SELECT id, nom, couleur FROM matieres WHERE masquee = 0 ORDER BY ordre, id");
  const r = await dialogue({
    titre: n.id ? "Modifier la note" : "Nouvelle note", large: true,
    contenu: `
      <div class="puces" id="n-type">${Object.entries(TYPES_NOTE).map(([t, l]) => `<button type="button" class="puce-choix${n.type === t ? " actif" : ""}" data-t="${t}">${l}</button>`).join("")}</div>
      <div class="puces" id="n-matiere">${matieres.map((m) => `<button type="button" class="puce-choix${n.matiereId === m.id ? " actif" : ""}" data-m="${m.id}"><span class="pastille" style="background:${couleurHex(m.couleur)}"></span>${echapper(m.nom)}</button>`).join("")}</div>
      <label class="champ"><span>Date</span><input id="n-date" type="date" value="${versIso(n.jour)}"></label>
      <div class="deux-col"><label class="champ"><span>Note</span><input id="n-valeur" inputmode="decimal" value="${nombreCourt(n.valeur)}"></label>
        <label class="champ"><span>Sur</span><input id="n-bareme" inputmode="decimal" value="${nombreCourt(n.bareme)}"></label></div>
      <div class="deux-col"><label class="champ"><span>Rang</span><input id="n-rang" inputmode="numeric" value="${n.rang ?? ""}"></label>
        <label class="champ"><span>sur (élèves)</span><input id="n-effectif" inputmode="numeric" value="${n.effectif ?? ""}"></label></div>
      <div class="deux-col"><label class="champ"><span>Moy. classe</span><input id="n-classe" inputmode="decimal" value="${nombreCourt(n.moyenneClasse)}"></label>
        <label class="champ"><span>Coef</span><input id="n-coef" inputmode="decimal" value="${nombreCourt(n.coefficient)}"></label></div>
      <label class="champ"><span>Commentaire (facultatif)</span><input id="n-com" maxlength="200" value="${echapper(n.commentaire || "")}"></label>
      <p class="erreur" id="n-erreur"></p>`,
    boutons: [
      ...(n.id ? [{ texte: "Supprimer", style: "discret texte-rouge", valeur: () => "supprimer" }] : []),
      { texte: "Annuler", valeur: false },
      {
        texte: "Enregistrer", style: "primaire",
        valeur: (fond) => {
          const q = (s) => fond.querySelector(s).value;
          const v = lireNombre(q("#n-valeur")), b = lireNombre(q("#n-bareme")), c = lireNombre(q("#n-coef"));
          const err = v == null ? "Écris la note." : !(b > 0) ? "Le barème doit être positif." : v < 0 || v > b ? "La note doit être entre 0 et le barème." : !(c > 0) ? "Le coefficient doit être positif." : "";
          if (err) { fond.querySelector("#n-erreur").textContent = err; return undefined; }
          const ent = (s) => { const x = parseInt(q(s), 10); return Number.isFinite(x) ? x : null; };
          return {
            type: fond.querySelector("#n-type .actif")?.dataset.t || "AUTRE", matiereId: Number(fond.querySelector("#n-matiere .actif")?.dataset.m) || null,
            jour: depuisIso(q("#n-date")) ?? n.jour, valeur: v, bareme: b, coefficient: c, rang: ent("#n-rang"), effectif: ent("#n-effectif"),
            moyenneClasse: lireNombre(q("#n-classe")), commentaire: q("#n-com").trim(),
          };
        },
      },
    ],
    apresOuverture: (fond) => {
      fond.addEventListener("click", (ev) => {
        const b = ev.target.closest(".puce-choix");
        if (!b) return;
        b.parentElement.querySelectorAll(".puce-choix").forEach((x) => x.classList.toggle("actif", x === b));
      });
    },
  });
  if (!r) return false;
  if (r === "supprimer") {
    if (!(await confirmer("Supprimer cette note ?", "La note sera définitivement supprimée.", "Supprimer", true))) return false;
    executer("DELETE FROM notes WHERE id = ?", [n.id]);
    toast("Note supprimée");
    return true;
  }
  const v = [r.matiereId, n.evenementId ?? null, r.type, r.jour, r.valeur, r.bareme, r.coefficient, r.rang, r.effectif, r.moyenneClasse, r.commentaire];
  if (n.id) executer("UPDATE notes SET matiereId = ?, evenementId = ?, type = ?, jour = ?, valeur = ?, bareme = ?, coefficient = ?, rang = ?, effectif = ?, moyenneClasse = ?, commentaire = ? WHERE id = ?", [...v, n.id]);
  else executer("INSERT INTO notes (matiereId, evenementId, type, jour, valeur, bareme, coefficient, rang, effectif, moyenneClasse, commentaire) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", v);
  toast("Note enregistrée ✓");
  return true;
}
