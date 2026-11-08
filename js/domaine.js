// Moteur de révision : transposition fidèle du code Kotlin de l'appli Android
// (Repetition.kt, FileRevision.kt, Trou.kt, Leurres.kt, Calcul.kt, ApplicationNumerique.kt).

import { melanger, auHasard } from "./util.js";

// Expressions avec « lookbehind » : construites à l'exécution (les vieux iPhone ne les
// comprennent pas ; on se replie alors sur une version plus simple).
function regexSure(source, drapeaux, secours) {
  try {
    return new RegExp(source, drapeaux);
  } catch {
    return new RegExp(secours, drapeaux);
  }
}

// ------------------------------------------------------------------ Répétition espacée (Leitner)

export const Reponse = {
  NE_SAIT_PAS: "NE_SAIT_PAS",
  RATE: "RATE",
  DIFFICILE: "DIFFICILE",
  BIEN: "BIEN",
  FACILE: "FACILE",
};
export const LIBELLE_REPONSE = {
  NE_SAIT_PAS: "Je ne sais pas",
  RATE: "Raté",
  DIFFICILE: "Difficile",
  BIEN: "Bien",
  FACILE: "Facile",
};
export const estUnEchec = (r) => r === Reponse.NE_SAIT_PAS || r === Reponse.RATE;

const INTERVALLES = [1, 2, 4, 8, 16, 32];
export const BOITE_MAX = 6;
export const intervalle = (b) => INTERVALLES[Math.min(Math.max(b, 1), BOITE_MAX) - 1];
export const estNouvelle = (e) => e.prochaine === null || e.prochaine === undefined;
export const estDue = (e, jour) => !estNouvelle(e) && e.prochaine <= jour;

/**
 * Applique une réponse à l'état d'une carte. Mêmes règles que l'appli Android :
 * Raté → boîte 1 ; Difficile → même boîte ; Bien → +1 ; Facile → +2 ; intervalles 1-2-4-8-16-32 j ;
 * révision en avance : une bonne réponse ne change rien ; mode DS : intervalles resserrés.
 */
export function appliquer(etat, reponse, jour, jourObjectif = null) {
  const nouvelle = estNouvelle(etat);
  const enAvance = !nouvelle && etat.prochaine > jour;
  const echec = estUnEchec(reponse);
  const echecs = echec ? etat.nbEchecs + 1 : etat.nbEchecs;
  const consecutifs = echec ? etat.echecsConsecutifs + 1 : 0;
  let boite, jours, raison;
  const lib = LIBELLE_REPONSE[reponse];
  if (echec) {
    boite = 1; jours = 1; raison = `${lib} → boîte 1`;
  } else if (enAvance) {
    boite = etat.boite; jours = etat.prochaine - jour;
    raison = `Révision en avance : la carte reste en boîte ${boite}`;
  } else if (nouvelle) {
    boite = reponse === Reponse.DIFFICILE ? 1 : reponse === Reponse.BIEN ? 2 : 3;
    jours = intervalle(boite); raison = `${lib} → boîte ${boite}`;
  } else {
    boite = reponse === Reponse.DIFFICILE ? Math.max(etat.boite, 1)
      : reponse === Reponse.BIEN ? Math.min(etat.boite + 1, BOITE_MAX)
      : Math.min(etat.boite + 2, BOITE_MAX);
    jours = intervalle(boite); raison = `${lib} → boîte ${boite}`;
  }
  let noteDs = "";
  if (jourObjectif !== null && jourObjectif !== undefined && jourObjectif > jour) {
    const restant = jourObjectif - jour;
    const plafond = reponse === Reponse.FACILE ? restant
      : reponse === Reponse.BIEN ? Math.max(1, Math.floor((restant * 2) / 3))
      : Math.max(1, Math.floor(restant / 2));
    if (jours > plafond) {
      jours = plafond;
      noteDs = " (avancée pour le DS / la colle)";
    }
  }
  const quand = jours === 0 ? "aujourd'hui" : jours === 1 ? "demain" : `dans ${jours} jours`;
  return {
    etat: {
      boite,
      prochaine: jour + jours,
      nbRevisions: etat.nbRevisions + 1,
      nbEchecs: echecs,
      echecsConsecutifs: consecutifs,
    },
    dansJours: jours,
    enAvance,
    explication: `${raison} · prochaine révision ${quand}${noteDs}${echec ? " ; elle revient aussi dans quelques cartes" : ""}.`,
  };
}

export function apercu(etat, reponse, jour, jourObjectif) {
  const j = appliquer(etat, reponse, jour, jourObjectif).dansJours;
  return j <= 1 ? "demain" : `${j} j`;
}

// ------------------------------------------------------------------ File de révision sans fin

const DELAI_REAPPRENTISSAGE = 4;
const ECART_GROUPES = 3;
const TAILLE_LOT_AVANCE = 25;

/** Éléments : {id, groupe (= formule), etat}. Voir FileRevision.kt pour les priorités. */
export class FileRevision {
  constructor(cartes, jour) {
    this.cartes = new Map(cartes.map((c) => [c.id, c]));
    this.jour = jour;
    this.tirage = 0;
    this.vuesAuTirage = new Map();
    this.aReapprendre = new Map();
    this.derniersGroupes = [];
    this.groupesVus = new Set();
  }
  get taille() { return this.cartes.size; }

  suivante() {
    if (this.cartes.size === 0) return null;
    this.tirage++;
    const choix = this.choisir();
    this.vuesAuTirage.set(choix.id, this.tirage);
    this.aReapprendre.delete(choix.id);
    this.derniersGroupes.push(choix.groupe);
    this.groupesVus.add(choix.groupe);
    while (this.derniersGroupes.length > ECART_GROUPES) this.derniersGroupes.shift();
    return choix;
  }

  enregistrer(id, etat, echec) {
    const c = this.cartes.get(id);
    if (!c) return;
    this.cartes.set(id, { ...c, etat });
    if (echec) this.aReapprendre.set(id, this.tirage + DELAI_REAPPRENTISSAGE);
  }

  choisir() {
    for (const [id, quand] of this.aReapprendre) {
      if (quand <= this.tirage && this.cartes.has(id)) return this.cartes.get(id);
    }
    const toutes = [...this.cartes.values()];
    const pasVues = toutes.filter((c) => !this.vuesAuTirage.has(c.id));
    const formulesNeuves = pasVues.filter((c) => !this.groupesVus.has(c.groupe));
    const a = this.choisirParmi(formulesNeuves, true);
    if (a) return a;
    const b = this.choisirParmi(pasVues, false);
    if (b) return b;
    const parAnciennete = toutes.sort((x, y) => (this.vuesAuTirage.get(x.id) || 0) - (this.vuesAuTirage.get(y.id) || 0));
    let possibles = parAnciennete.filter((c) => !this.aReapprendre.has(c.id));
    if (!possibles.length) possibles = parAnciennete;
    return possibles.find((c) => !this.derniersGroupes.includes(c.groupe)) || possibles[0];
  }

  choisirParmi(liste, nouvellesDabord) {
    if (!liste.length) return null;
    const nouvelles = liste.filter((c) => estNouvelle(c.etat));
    const dues = liste.filter((c) => estDue(c.etat, this.jour));
    for (const l of nouvellesDabord ? [nouvelles, dues] : [dues, nouvelles]) {
      const p = this.prendre(l);
      if (p) return p;
    }
    const enAvance = liste.slice()
      .sort((x, y) => (x.etat.prochaine ?? 0) - (y.etat.prochaine ?? 0) || x.etat.boite - y.etat.boite)
      .slice(0, TAILLE_LOT_AVANCE);
    return this.prendre(enAvance);
  }

  prendre(liste) {
    if (!liste.length) return null;
    const variees = liste.filter((c) => !this.derniersGroupes.includes(c.groupe));
    return auHasard(variees.length ? variees : liste);
  }
}

// ------------------------------------------------------------------ Formule à trous

const EXCLUS_TROU = ["\\begin", "\\iff", "\\Leftrightarrow", "\\Rightarrow", "\\qquad", "\\text{ et }"];
const PHRASE = /\\text\{\s/;
const DEBUT_G = "\\begin{gathered}";
const FIN_G = "\\end{gathered}";

export function decouperTrou(latex) {
  const tex = latex.trim();
  if (tex.startsWith(DEBUT_G) && tex.endsWith(FIN_G)) {
    const lignes = tex.slice(DEBUT_G.length, tex.length - FIN_G.length).split("\\\\").map((l) => l.trim());
    for (let k = 0; k < lignes.length; k++) {
      const t = decouperLigne(lignes[k]);
      if (!t) continue;
      const avant = lignes.slice(0, k);
      const apres = lignes.slice(k + 1);
      return {
        visible: DEBUT_G + [...avant, t.visible].join(" \\\\ "),
        cachee: t.cachee,
        suite: apres.length ? " \\\\ " + apres.join(" \\\\ ") + FIN_G : FIN_G,
      };
    }
    return null;
  }
  return decouperLigne(tex);
}
export const questionTrou = (t) => `${t.visible} = \\boxed{\\;?\\;}${t.suite || ""}`;

function decouperLigne(tex) {
  if (EXCLUS_TROU.some((e) => tex.includes(e))) return null;
  let profondeur = 0, premier = -1, i = 0;
  const lettreApres = (j) => j < tex.length && /[a-zA-Z]/.test(tex[j]);
  while (i < tex.length) {
    const c = tex[i];
    if (c === "\\") {
      if (tex.startsWith("\\left", i) && !lettreApres(i + 5)) profondeur++;
      else if (tex.startsWith("\\right", i) && !lettreApres(i + 6)) profondeur--;
      i += 2;
      continue;
    }
    if (c === "{") profondeur++;
    else if (c === "}") profondeur--;
    else if (c === "=" && profondeur === 0 && premier < 0) premier = i;
    i++;
  }
  if (premier <= 0) return null;
  const visible = tex.slice(0, premier).trim();
  const cachee = tex.slice(premier + 1).trim();
  if (!visible || !cachee) return null;
  if (PHRASE.test(cachee)) return null;
  return { visible, cachee, suite: "" };
}

// ------------------------------------------------------------------ Leurres (versions fausses)

export function compacter(s) {
  return s.replace(/\\[,;:! ]|\\quad|\\qquad|\s+/g, "");
}

function equilibre(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && i + 1 < s.length) { i++; continue; }
    if (c === "{") n++;
    if (c === "}") { n--; if (n < 0) return false; }
  }
  return n === 0;
}

function fermante(s, ouvrante) {
  let n = 0;
  for (let i = ouvrante; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && i + 1 < s.length) { i++; continue; }
    if (c === "{") n++;
    if (c === "}") { n--; if (n === 0) return i; }
  }
  return -1;
}

function zonesProtegees(s) {
  const zones = [];
  const re = /\\(text|mathrm|operatorname|textbf|textit|mbox|begin|end)\s*\{/g;
  let m;
  while ((m = re.exec(s))) {
    const o = m.index + m[0].length - 1;
    const f = fermante(s, o);
    if (f > o) zones.push([m.index, f]);
  }
  return zones;
}
const protege = (i, zones) => zones.some(([a, b]) => i >= a && i <= b);
const remplacer = (s, debut, fin, par) => s.slice(0, debut) + par + s.slice(fin);
const echapRegex = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function* parcourir(re, s) {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  let m;
  while ((m = g.exec(s))) {
    yield m;
    if (m[0].length === 0) g.lastIndex++;
  }
}

function signes(s, zones) {
  const l = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if ((c === "+" || c === "-") && !protege(i, zones)) {
      const avant = s[i - 1], apres = s[i + 1];
      if (avant === "-" || apres === "-" || apres === ">" || avant === "<" || avant === "\\") continue;
      l.push({ latex: remplacer(s, i, i + 1, c === "+" ? "-" : "+"), piege: "signe changé" });
    }
  }
  for (const m of parcourir(/\\(pm|mp)(?![a-zA-Z])/, s)) {
    if (!protege(m.index, zones)) {
      l.push({ latex: remplacer(s, m.index, m.index + m[0].length, m[1] === "pm" ? "\\mp" : "\\pm"), piege: "signe changé" });
    }
  }
  return l;
}

function fractions(s, zones) {
  const l = [];
  for (const m of parcourir(/\\[dt]?frac\s*\{/, s)) {
    if (protege(m.index, zones)) continue;
    const o1 = m.index + m[0].length - 1;
    const f1 = fermante(s, o1);
    if (f1 < 0 || f1 + 1 >= s.length || s[f1 + 1] !== "{") continue;
    const o2 = f1 + 1, f2 = fermante(s, o2);
    if (f2 < 0) continue;
    const a = s.slice(o1 + 1, f1), b = s.slice(o2 + 1, f2);
    if (compacter(a) === compacter(b)) continue;
    l.push({ latex: remplacer(s, o1, f2 + 1, `{${b}}{${a}}`), piege: "fraction inversée" });
  }
  return l;
}

function exposants(s, zones) {
  const l = [];
  for (const m of parcourir(/\^(\{(-?)(\d+)\}|(\d))/, s)) {
    if (protege(m.index, zones)) continue;
    const signe = m[2] || "";
    const n = parseInt(m[3] || m[4], 10);
    const autre = n === 2 ? 3 : n === 3 ? 2 : n + 1;
    const fin = m.index + m[0].length;
    l.push({ latex: remplacer(s, m.index, fin, `^{${signe}${autre}}`), piege: "exposant modifié" });
    if (n === 2 && !signe) l.push({ latex: remplacer(s, m.index, fin, ""), piege: "carré oublié" });
    if (signe === "-") l.push({ latex: remplacer(s, m.index, fin, `^{${n}}`), piege: "exposant modifié" });
  }
  return l;
}

function racines(s, zones) {
  const l = [];
  for (const m of parcourir(/\\sqrt\s*\{/, s)) {
    if (protege(m.index, zones)) continue;
    const o = m.index + m[0].length - 1;
    const f = fermante(s, o);
    if (f < 0) continue;
    l.push({ latex: remplacer(s, m.index, f + 1, `{${s.slice(o + 1, f)}}`), piege: "racine oubliée" });
  }
  return l;
}

const ECHANGES = [
  ["\\sin", "\\cos"], ["\\cos", "\\sin"], ["\\sinh", "\\cosh"], ["\\cosh", "\\sinh"], ["\\tan", "\\cot"],
  ["\\leq", "\\geq"], ["\\geq", "\\leq"], ["\\le", "\\ge"], ["\\ge", "\\le"], ["\\ll", "\\gg"], ["\\gg", "\\ll"],
  ["\\wedge", "\\cdot"], ["\\cdot", "\\wedge"], ["\\times", "\\cdot"], ["\\ddot", "\\dot"], ["\\dot", "\\ddot"],
  ["\\mu_0", "\\varepsilon_0"], ["\\varepsilon_0", "\\mu_0"], ["\\max", "\\min"], ["\\min", "\\max"],
  ["\\cup", "\\cap"], ["\\cap", "\\cup"], ["\\Rightarrow", "\\Leftarrow"], ["\\iff", "\\Rightarrow"],
];
const LIBELLES = {
  "\\sin": "sinus et cosinus échangés", "\\cos": "sinus et cosinus échangés", "\\sinh": "sh et ch échangés",
  "\\cosh": "sh et ch échangés", "\\tan": "tan remplacé par cotan", "\\leq": "inégalité inversée",
  "\\geq": "inégalité inversée", "\\le": "inégalité inversée", "\\ge": "inégalité inversée",
  "\\ll": "inégalité inversée", "\\gg": "inégalité inversée",
  "\\wedge": "produit vectoriel / scalaire échangés", "\\cdot": "produit vectoriel / scalaire échangés",
  "\\times": "produit vectoriel / scalaire échangés", "\\ddot": "dérivée première / seconde échangées",
  "\\dot": "dérivée première / seconde échangées", "\\mu_0": "μ₀ et ε₀ échangés", "\\varepsilon_0": "μ₀ et ε₀ échangés",
  "\\max": "max et min échangés", "\\min": "max et min échangés", "\\cup": "union et intersection échangées",
  "\\cap": "union et intersection échangées", "\\Rightarrow": "sens de l'implication changé",
  "\\iff": "équivalence remplacée par une implication",
};

function remplacements(s, zones) {
  const l = [];
  for (const [de, vers] of ECHANGES) {
    const re = new RegExp(echapRegex(de) + (/[a-zA-Z]$/.test(de) ? "(?![a-zA-Z])" : ""), "g");
    for (const m of parcourir(re, s)) {
      if (!protege(m.index, zones)) {
        l.push({ latex: remplacer(s, m.index, m.index + m[0].length, vers), piege: LIBELLES[de] || "symbole changé" });
      }
    }
  }
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if ((c === "<" || c === ">") && !protege(i, zones) && s[i - 1] !== "-" && s[i + 1] !== "-") {
      l.push({ latex: remplacer(s, i, i + 1, c === "<" ? ">" : "<"), piege: "inégalité inversée" });
    }
  }
  return l;
}

const RE_NOMBRE = regexSure("(?<![\\^_\\d.,a-zA-Z\\\\])(\\d+)(?![\\d.,])", "g", "(\\d+)(?![\\d.,])");

function dansExposantOuIndice(s, i) {
  let profondeur = 0;
  for (let j = i - 1; j >= 0; j--) {
    if (s[j] === "}") profondeur++;
    else if (s[j] === "{") {
      if (profondeur === 0) {
        const marque = s[j - 1];
        return marque === "^" || marque === "_";
      }
      profondeur--;
    }
  }
  return false;
}

function nombres(s, zones) {
  const l = [];
  for (const m of parcourir(RE_NOMBRE, s)) {
    const i = m.index;
    // Repli sans lookbehind : on vérifie le caractère précédent à la main.
    if (i > 0 && /[\^_\d.,a-zA-Z\\]/.test(s[i - 1])) continue;
    if (protege(i, zones) || dansExposantOuIndice(s, i)) continue;
    const n = parseInt(m[0], 10);
    if (!n) continue;
    const fin = i + m[0].length;
    l.push({ latex: remplacer(s, i, fin, String(n * 2)), piege: "coefficient modifié" });
    if (n === 2) {
      const apres = s[fin];
      if (apres && (apres === "\\" || /[a-zA-Z]/.test(apres))) {
        l.push({ latex: remplacer(s, i, fin, ""), piege: "facteur 2 oublié" });
      }
    }
  }
  const egal = s.indexOf("=");
  if (egal > 0 && !protege(egal, zones)) {
    const reste = s.slice(egal + 1).trimStart();
    if (reste && reste[0] !== "-" && reste[0] !== "+" && !/\d/.test(reste[0])) {
      l.push({ latex: s.slice(0, egal + 1) + " 2\\," + reste, piege: "facteur 2 ajouté" });
    }
  }
  return l;
}

function indices(s, zones) {
  const l = [];
  for (const m of parcourir(/_(\{([12])\}|([12]))(?![\d])/, s)) {
    if (protege(m.index, zones)) continue;
    const n = m[2] || m[3];
    l.push({ latex: remplacer(s, m.index, m.index + m[0].length, `_{${n === "1" ? "2" : "1"}}`), piege: "indice changé" });
  }
  return l;
}

function bornes(s, zones) {
  const l = [];
  for (const m of parcourir(/_\{\s*([a-zA-Z])\s*=\s*([01])\s*\}/, s)) {
    if (protege(m.index, zones)) continue;
    l.push({ latex: remplacer(s, m.index, m.index + m[0].length, `_{${m[1]}=${m[2] === "0" ? "1" : "0"}}`), piege: "borne de départ changée" });
  }
  for (const m of parcourir(/\\int\s*_(\{[^{}]*\}|\\?[a-zA-Z0-9]+)\s*\^(\{[^{}]*\}|\\?[a-zA-Z0-9]+)/, s)) {
    if (protege(m.index, zones)) continue;
    if (compacter(m[1]) !== compacter(m[2])) {
      l.push({ latex: remplacer(s, m.index, m.index + m[0].length, `\\int_${m[2]}^${m[1]}`), piege: "bornes de l'intégrale échangées" });
    }
  }
  return l;
}

function matrices(s) {
  const l = [];
  for (const m of parcourir(/\\begin\{([Bbpv]?matrix)\}([\s\S]*?)\\end\{\1\}/, s)) {
    const contenu = m[2];
    const debut = m.index + m[0].indexOf(contenu, `\\begin{${m[1]}}`.length);
    const lignes = contenu.split("\\\\");
    lignes.forEach((ligne, k) => {
      const cases = ligne.split("&");
      if (cases.length === 2 && compacter(cases[0]) !== compacter(cases[1])) {
        const nouv = lignes.slice();
        nouv[k] = " " + cases[1].trim() + " & " + cases[0].trim() + " ";
        l.push({ latex: remplacer(s, debut, debut + contenu.length, nouv.join("\\\\")), piege: "composantes échangées" });
      }
    });
  }
  return l;
}

/** Toutes les versions fausses possibles d'une formule (sans doublon). */
export function tousLesLeurres(latex) {
  const original = latex.trim();
  if (!original) return [];
  const z = zonesProtegees(original);
  const bruts = [
    ...signes(original, z), ...fractions(original, z), ...exposants(original, z), ...racines(original, z),
    ...remplacements(original, z), ...nombres(original, z), ...indices(original, z), ...bornes(original, z),
    ...matrices(original),
  ];
  const vus = new Set([compacter(original)]);
  return bruts.filter((l) => {
    if (!equilibre(l.latex)) return false;
    const c = compacter(l.latex);
    if (vus.has(c)) return false;
    vus.add(c);
    return true;
  });
}

/** [nb] leurres en variant les pièges (un de chaque sorte d'abord). */
export function choisirLeurres(latex, nb) {
  const parPiege = new Map();
  for (const l of tousLesLeurres(latex)) {
    if (!parPiege.has(l.piege)) parPiege.set(l.piege, []);
    parPiege.get(l.piege).push(l);
  }
  for (const [k, v] of parPiege) parPiege.set(k, melanger(v));
  const sortes = melanger([...parPiege.keys()]);
  const choisis = [];
  for (let rang = 0; choisis.length < nb; rang++) {
    let ajout = false;
    for (const s of sortes) {
      const l = parPiege.get(s)[rang];
      if (!l) continue;
      choisis.push(l);
      ajout = true;
      if (choisis.length === nb) break;
    }
    if (!ajout) break;
  }
  return choisis;
}

// ------------------------------------------------------------------ Calcul et nombres

/** Évaluateur d'expressions des applications numériques (voir Calcul.kt). */
export function calculer(texte, variables = {}) {
  let pos = 0;
  const espaces = () => { while (pos < texte.length && texte[pos] === " ") pos++; };
  const prendre = (c) => { espaces(); if (texte[pos] === c) { pos++; return true; } return false; };
  const FONCTIONS = {
    sqrt: Math.sqrt, exp: Math.exp, ln: Math.log, log: Math.log10, sin: Math.sin, cos: Math.cos, tan: Math.tan,
    asin: Math.asin, acos: Math.acos, atan: Math.atan, abs: Math.abs,
  };
  function somme() {
    let v = produit();
    for (;;) {
      if (prendre("+")) v += produit();
      else if (prendre("-")) v -= produit();
      else return v;
    }
  }
  function produit() {
    let v = unaire();
    for (;;) {
      if (prendre("*")) v *= unaire();
      else if (prendre("/")) v /= unaire();
      else return v;
    }
  }
  function unaire() {
    if (prendre("-")) return -unaire();
    if (prendre("+")) return unaire();
    return puissance();
  }
  function puissance() {
    const base = atome();
    return prendre("^") ? Math.pow(base, unaire()) : base;
  }
  function atome() {
    espaces();
    if (pos >= texte.length) throw new Error(`Expression incomplète : « ${texte} »`);
    const c = texte[pos];
    if (prendre("(")) {
      const v = somme();
      if (!prendre(")")) throw new Error("Parenthèse manquante");
      return v;
    }
    if (/[\d.]/.test(c)) {
      const m = /^[\d.]+([eE][-+]?\d+)?/.exec(texte.slice(pos));
      pos += m[0].length;
      return parseFloat(m[0]);
    }
    if (/[a-zA-Z_]/.test(c)) {
      const m = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(texte.slice(pos));
      pos += m[0].length;
      const nom = m[0];
      if (prendre("(")) {
        const x = somme();
        if (!prendre(")")) throw new Error(`Parenthèse manquante après ${nom}`);
        if (!FONCTIONS[nom]) throw new Error(`Fonction inconnue : ${nom}`);
        return FONCTIONS[nom](x);
      }
      if (nom === "pi") return Math.PI;
      if (!(nom in variables)) throw new Error(`Variable inconnue : ${nom}`);
      return variables[nom];
    }
    throw new Error(`Caractère inattendu « ${c} »`);
  }
  const v = somme();
  espaces();
  if (pos !== texte.length) throw new Error(`Caractère inattendu en position ${pos}`);
  return v;
}

export const Nombres = {
  /** « 4,7 », « 4.7e-3 », « 4,7×10^-3 », « 1 200 » → nombre ; sinon null. */
  lire(saisie) {
    let s = String(saisie).trim().replace(/[  ]/g, " ").replace(/−/g, "-").replace(/,/g, ".");
    s = s.replace(/\s*[×x*·]\s*10\s*\^\s*/g, "e");
    s = s.replace(/(\d)\s+(?=\d)/g, "$1");
    s = s.replace(/ /g, "");
    if (!s || !/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return null;
    const v = parseFloat(s);
    return Number.isFinite(v) ? v : null;
  },
  arrondir(v, chiffres) {
    if (v === 0 || !Number.isFinite(v)) return v;
    const e = Math.floor(Math.log10(Math.abs(v)));
    const f = Math.pow(10, chiffres - 1 - e);
    return Math.round(v * f) / f;
  },
  latex(v, chiffres = 3) {
    if (v === 0) return "0";
    const a = Nombres.arrondir(v, chiffres);
    const e = Math.floor(Math.log10(Math.abs(a)));
    const dec = (x, d) => x.toFixed(Math.max(0, d)).replace(".", "{,}");
    if (e >= -2 && e <= 4) return dec(a, chiffres - 1 - e);
    return dec(a / Math.pow(10, e), chiffres - 1) + ` \\times 10^{${e}}`;
  },
};

// ------------------------------------------------------------------ Applications numériques

export function tirerAn(modele) {
  const valeurs = {};
  let texte = modele.enonce;
  for (const v of modele.variables) {
    const brute = v.min + Math.random() * (v.max - v.min);
    const chiffres = v.chiffres ?? 2;
    const affichee = v.entier ? Math.round(brute) : Nombres.arrondir(brute, chiffres);
    valeurs[v.nom] = affichee * (v.facteur ?? 1);
    const nombre = v.entier ? String(affichee) : Nombres.latex(affichee, chiffres);
    texte = texte.split(`{${v.nom}}`).join(v.unite ? `${nombre}\\,${v.unite}` : nombre);
  }
  const si = calculer(modele.calcul, valeurs);
  return { modele, enonce: texte, valeurs, resultat: si / (modele.facteur ?? 1) };
}

export const VERDICTS = {
  JUSTE: { libelle: "Juste", reponse: Reponse.BIEN },
  ORDRE_DE_GRANDEUR: { libelle: "Bon ordre de grandeur, mais pas assez précis", reponse: Reponse.DIFFICILE },
  FAUX: { libelle: "Faux", reponse: Reponse.RATE },
};

export function corrigerAn(attendu, donne, tolerance) {
  if (attendu === 0) return Math.abs(donne) < 1e-12 ? "JUSTE" : "FAUX";
  if (Math.abs(donne - attendu) / Math.abs(attendu) <= tolerance) return "JUSTE";
  const r = donne / attendu;
  if (r > 0 && Math.abs(Math.log10(r)) <= Math.log10(2)) return "ORDRE_DE_GRANDEUR";
  return "FAUX";
}
