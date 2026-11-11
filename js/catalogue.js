// Catalogue intégré (mêmes fichiers que l'appli Android) et import de fiches.

import { tous, un, valeur, executer, dernierId, transaction } from "./db.js";
import { simplifier } from "./util.js";

let index = null;
let catalogues = null;
let formulesParChapitre = null;
let anParFormule = null;

async function json(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Fichier introuvable : ${url}`);
  return r.json();
}

export async function chargerIndex() {
  if (!index) index = await json("data/index.json");
  return index;
}

/** Catalogues de chapitres par matière (physique, chimie, sii, maths, allemand). */
export async function lesCatalogues() {
  if (!catalogues) catalogues = await json("data/chapitres.json");
  return catalogues;
}

/** Catalogue le plus probable pour une matière (d'après son nom), ou null. */
export async function cataloguePour(nomMatiere) {
  const cats = await lesCatalogues();
  const n = simplifier(nomMatiere);
  return cats.find((c) => c.motsCles.some((m) => n.includes(simplifier(m)))) || null;
}

async function formules() {
  if (!formulesParChapitre) {
    const idx = await chargerIndex();
    const listes = await Promise.all(idx.formules.map((f) => json("data/catalogue/" + f).catch(() => ({ formules: [] }))));
    formulesParChapitre = new Map();
    for (const l of listes) {
      for (const f of l.formules) {
        if (!formulesParChapitre.has(f.chapitre)) formulesParChapitre.set(f.chapitre, []);
        formulesParChapitre.get(f.chapitre).push(f);
      }
    }
  }
  return formulesParChapitre;
}

/** Modèles d'applications numériques, par clé catalogue de formule. */
export async function modelesAn() {
  if (!anParFormule) {
    const idx = await chargerIndex();
    const listes = await Promise.all(idx.an.map((f) => json("data/catalogue/" + f).catch(() => ({ modeles: [] }))));
    anParFormule = new Map();
    for (const l of listes) {
      for (const m of l.modeles) {
        if (!anParFormule.has(m.formule)) anParFormule.set(m.formule, []);
        anParFormule.get(m.formule).push(m);
      }
    }
  }
  return anParFormule;
}

export async function nbFormulesCatalogue(cleChapitre) {
  return ((await formules()).get(cleChapitre) || []).length;
}

/** Ajoute des chapitres du catalogue à une matière, avec leurs formules. Renvoie [chapitres, formules]. */
export async function ajouterChapitres(matiereId, chapitresCatalogue) {
  const parChapitre = await formules();
  const deja = new Set(tous("SELECT cleCatalogue FROM chapitres WHERE matiereId = ? AND cleCatalogue IS NOT NULL", [matiereId]).map((l) => l.cleCatalogue));
  let nbC = 0, nbF = 0;
  transaction(() => {
    let ordre = (valeur("SELECT COALESCE(MAX(ordre), -1) FROM chapitres WHERE matiereId = ?", [matiereId]) ?? -1) + 1;
    for (const c of chapitresCatalogue) {
      if (deja.has(c.cle)) continue;
      executer(
        "INSERT INTO chapitres (matiereId, titre, programme, ordre, masque, couleur, imageCouverture, cleCatalogue, nature, reference) VALUES (?, ?, ?, ?, 0, NULL, NULL, ?, ?, ?)",
        [matiereId, c.titre, c.programme, ordre++, c.cle, c.nature, c.reference],
      );
      nbC++;
      nbF += insererFormules(dernierId(), parChapitre.get(c.cle) || []);
    }
  });
  if (nbC) await remettreDansLOrdre(matiereId);
  return [nbC, nbF];
}

/** Les places des chapitres du catalogue sont redistribuées dans l'ordre du catalogue (chapitres perso inchangés). */
async function remettreDansLOrdre(matiereId) {
  const rang = new Map((await lesCatalogues()).flatMap((cat) => cat.chapitres.map((c) => c.cle)).map((cle, i) => [cle, i]));
  const actuels = tous("SELECT id, ordre, cleCatalogue FROM chapitres WHERE matiereId = ? ORDER BY ordre, id", [matiereId]);
  const duCatalogue = actuels.filter((c) => rang.has(c.cleCatalogue)).sort((a, b) => rang.get(a.cleCatalogue) - rang.get(b.cleCatalogue));
  let k = 0;
  transaction(() => {
    actuels.forEach((c, place) => {
      const voulu = rang.has(c.cleCatalogue) ? duCatalogue[k++] : c;
      if (voulu.ordre !== place) executer("UPDATE chapitres SET ordre = ? WHERE id = ?", [place, voulu.id]);
    });
  });
}

/** Ajoute, dans tous les chapitres du catalogue de la matière, les formules qui manquent. */
export async function completerFormules(matiereId) {
  const parChapitre = await formules();
  let n = 0;
  transaction(() => {
    for (const ch of tous("SELECT id, cleCatalogue FROM chapitres WHERE matiereId = ? AND cleCatalogue IS NOT NULL", [matiereId])) {
      n += insererFormules(ch.id, parChapitre.get(ch.cleCatalogue) || []);
    }
  });
  return n;
}

function insererFormules(chapitreId, liste) {
  const deja = new Set(tous("SELECT cleCatalogue FROM formules WHERE chapitreId = ? AND cleCatalogue IS NOT NULL", [chapitreId]).map((l) => l.cleCatalogue));
  let ordre = (valeur("SELECT COALESCE(MAX(ordre), 0) FROM formules WHERE chapitreId = ?", [chapitreId]) ?? 0) + 1;
  let n = 0;
  for (const f of liste) {
    if (deja.has(f.cle)) continue;
    deja.add(f.cle);
    executer(
      `INSERT INTO formules (chapitreId, intitule, latex, symboles, hypotheses, unites, erreursFrequentes, exemple,
        programme, statut, signalee, noteSignalement, ordre, nature, source, cleCatalogue, favori, horsRevision)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'NON_EVALUEE', 0, '', ?, ?, ?, ?, 0, 0)`,
      [chapitreId, f.intitule, f.latex, f.symboles || "", f.hypotheses || "", f.unites || "", f.erreursFrequentes || "",
        f.exemple || "", f.programme || "LES_DEUX", ordre++, f.nature || "AJOUT_UTILE", f.source || "", f.cle],
    );
    n++;
  }
  return n;
}

// ------------------------------------------------------------------ Import de fiches (.json préparé par Claude)

/** Lit un fichier de fiches : {chapitres: [{titre, programme, formules: [...]}]}. */
export function lireFiches(texte) {
  const d = JSON.parse(texte);
  if (!d || !Array.isArray(d.chapitres)) throw new Error("Ce fichier n'est pas un fichier de fiches.");
  return d.chapitres
    .map((c) => ({
      titre: String(c.titre || "").trim(),
      programme: ["PCSI", "PSI", "LES_DEUX"].includes(c.programme) ? c.programme : "LES_DEUX",
      formules: (c.formules || [])
        .map((f) => ({
          intitule: String(f.intitule || "").trim(),
          latex: String(f.latex || "").trim(),
          symboles: f.symboles || "", hypotheses: f.hypotheses || "", unites: f.unites || "",
          erreursFrequentes: f.erreursFrequentes || "", exemple: f.exemple || "",
        }))
        .filter((f) => f.intitule && f.latex),
    }))
    .filter((c) => c.titre);
}

/** Ajoute les fiches à la matière : chapitre de même titre complété, sinon créé. */
export function importerFiches(matiereId, chapitres, source = "Mes fiches de cours (import)") {
  let nbC = 0, nbF = 0;
  transaction(() => {
    const existants = new Map(tous("SELECT id, titre FROM chapitres WHERE matiereId = ?", [matiereId]).map((c) => [simplifier(c.titre), c.id]));
    for (const ci of chapitres) {
      let id = existants.get(simplifier(ci.titre));
      if (!id) {
        const ordre = (valeur("SELECT COALESCE(MAX(ordre), -1) FROM chapitres WHERE matiereId = ?", [matiereId]) ?? -1) + 1;
        executer("INSERT INTO chapitres (matiereId, titre, programme, ordre, masque) VALUES (?, ?, ?, ?, 0)", [matiereId, ci.titre, ci.programme, ordre]);
        id = dernierId();
        existants.set(simplifier(ci.titre), id);
        nbC++;
      }
      const deja = new Set(tous("SELECT intitule, latex FROM formules WHERE chapitreId = ?", [id]).map((f) => simplifier(f.intitule) + "|" + f.latex));
      let ordre = valeur("SELECT COALESCE(MAX(ordre), 0) FROM formules WHERE chapitreId = ?", [id]) ?? 0;
      for (const f of ci.formules) {
        const cle = simplifier(f.intitule) + "|" + f.latex;
        if (deja.has(cle)) continue;
        deja.add(cle);
        executer(
          `INSERT INTO formules (chapitreId, intitule, latex, symboles, hypotheses, unites, erreursFrequentes, exemple,
            programme, statut, signalee, noteSignalement, ordre, nature, source, cleCatalogue, favori, horsRevision)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'NON_EVALUEE', 0, '', ?, 'A_VERIFIER', ?, NULL, 0, 0)`,
          [id, f.intitule, f.latex, f.symboles, f.hypotheses, f.unites, f.erreursFrequentes, f.exemple, ci.programme, ++ordre, source],
        );
        nbF++;
      }
    }
  });
  return [nbC, nbF];
}

/** Matière dont le nom correspond (sans accents ni majuscules). */
export function trouverMatiere(nom) {
  const n = simplifier(nom);
  const ms = tous("SELECT id, nom FROM matieres ORDER BY ordre");
  return ms.find((m) => simplifier(m.nom) === n)
    || ms.find((m) => simplifier(m.nom).startsWith(n) || n.startsWith(simplifier(m.nom)))
    || ms.find((m) => simplifier(m.nom).includes(n) || n.includes(simplifier(m.nom)))
    || null;
}

/** Fiches partagées (fichiers dans data/partage), avec l'information « déjà ajoutées ». */
export async function fichesPartagees() {
  const idx = await chargerIndex();
  return idx.partage.map((p) => ({
    ...p,
    ajoutees: !!un("SELECT 1 AS x FROM formules WHERE source = ? LIMIT 1", [p.source]),
  }));
}

export async function ajouterFichesPartagees(p) {
  let m = trouverMatiere(p.matiere);
  if (!m) {
    const ordre = (valeur("SELECT COALESCE(MAX(ordre), -1) FROM matieres") ?? -1) + 1;
    executer("INSERT INTO matieres (nom, couleur, ordre, masquee, sansProgramme) VALUES (?, ?, ?, 0, 0)", [p.matiere, 0xff8d6e63, ordre]);
    m = { id: dernierId() };
  }
  executer("UPDATE matieres SET masquee = 0 WHERE id = ?", [m.id]);
  const chapitres = lireFiches(JSON.stringify(await json("data/partage/" + p.fichier)));
  return importerFiches(m.id, chapitres, p.source);
}
