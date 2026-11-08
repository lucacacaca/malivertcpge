// Base de données : la MÊME base SQLite que l'appli Android (version 16), dans le navigateur
// grâce à sql.js. Elle est gardée dans IndexedDB ; les sauvegardes .zip sont compatibles
// dans les deux sens avec l'appli Android (infos.json + base/prepa.db + fichiers/).

import { echapper } from "./util.js";

export const VERSION_BASE = 16;
const NOM_IDB = "malivertcpge";
const MAGASIN = "kv";

let SQL = null;
let base = null;
let minuteur = null;
const ecouteurs = new Set();

// ------------------------------------------------------------------ IndexedDB

function idb() {
  return new Promise((ok, ko) => {
    const r = indexedDB.open(NOM_IDB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(MAGASIN);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  });
}
async function idbOp(mode, fn) {
  const d = await idb();
  return new Promise((ok, ko) => {
    const t = d.transaction(MAGASIN, mode);
    const requete = fn(t.objectStore(MAGASIN));
    t.oncomplete = () => { d.close(); ok(requete ? requete.result : undefined); };
    t.onerror = () => { d.close(); ko(t.error); };
    t.onabort = () => { d.close(); ko(t.error); };
  });
}
export const idbLire = (cle) => idbOp("readonly", (s) => s.get(cle));
export const idbEcrire = (cle, v) => idbOp("readwrite", (s) => s.put(v, cle));
export const idbEffacer = (cle) => idbOp("readwrite", (s) => s.delete(cle));
export const idbCles = () => idbOp("readonly", (s) => s.getAllKeys());

// ------------------------------------------------------------------ Ouverture

const MATIERES_PAR_DEFAUT = [
  ["Mathématiques", 0xff1e88e5], ["Physique", 0xffe53935], ["Chimie", 0xff43a047],
  ["Sciences industrielles (SII)", 0xfffb8c00], ["Informatique", 0xff5e35b1],
  ["Français-philosophie", 0xff8d6e63], ["Anglais", 0xff00897b], ["Allemand", 0xfffdd835], ["TIPE", 0xff546e7a],
];

/** Ouvre la base (la crée au premier lancement). Renvoie true si elle vient d'être créée. */
export async function ouvrir() {
  SQL = await window.initSqlJs({ locateFile: (f) => "vendor/" + f });
  let octets = null;
  try {
    octets = await idbLire("base");
  } catch {
    octets = null;
  }
  if (octets) {
    base = new SQL.Database(new Uint8Array(octets));
    base.run("PRAGMA foreign_keys = ON");
    return false;
  }
  await creerBaseVide();
  return true;
}

async function creerBaseVide() {
  const schema = await (await fetch("data/schema.json")).json();
  base = new SQL.Database();
  for (const sql of schema) base.run(sql);
  base.run(`PRAGMA user_version = ${VERSION_BASE}`);
  base.run("PRAGMA foreign_keys = ON");
  MATIERES_PAR_DEFAUT.forEach(([nom, couleur], i) => {
    base.run("INSERT INTO matieres (nom, couleur, ordre, masquee, sansProgramme) VALUES (?, ?, ?, 0, ?)",
      [nom, couleur, i, nom === "Anglais" ? 1 : 0]);
  });
  await sauverMaintenant();
}

/** Efface tout et repart d'une base neuve. */
export async function reinitialiser() {
  const cles = await idbCles();
  for (const c of cles) if (String(c).startsWith("f:")) await idbEffacer(c);
  await idbEffacer("base");
  await creerBaseVide();
  prevenir();
}

// ------------------------------------------------------------------ Requêtes

/** Toutes les lignes (objets {colonne: valeur}). */
export function tous(sql, params = []) {
  const st = base.prepare(sql);
  try {
    st.bind(params);
    const lignes = [];
    while (st.step()) lignes.push(st.getAsObject());
    return lignes;
  } finally {
    st.free();
  }
}
export function un(sql, params = []) {
  return tous(sql, params)[0] ?? null;
}
export function valeur(sql, params = []) {
  const l = un(sql, params);
  return l ? Object.values(l)[0] : null;
}
/** Requête de modification ; programme la sauvegarde dans le navigateur. */
export function executer(sql, params = []) {
  base.run(sql, params);
  programmerSauvegarde();
}
export function dernierId() {
  return valeur("SELECT last_insert_rowid()");
}
export function transaction(fn) {
  base.run("BEGIN");
  try {
    const r = fn();
    base.run("COMMIT");
    programmerSauvegarde();
    return r;
  } catch (e) {
    base.run("ROLLBACK");
    throw e;
  }
}

/** Être prévenu quand les données changent (pour rafraîchir l'écran). */
export function surChangement(fn) {
  ecouteurs.add(fn);
  return () => ecouteurs.delete(fn);
}
function prevenir() {
  ecouteurs.forEach((f) => { try { f(); } catch (e) { console.error(e); } });
}

function programmerSauvegarde() {
  clearTimeout(minuteur);
  minuteur = setTimeout(sauverMaintenant, 400);
}
export async function sauverMaintenant() {
  clearTimeout(minuteur);
  if (!base) return;
  const octets = base.export();
  base.run("PRAGMA foreign_keys = ON");
  await idbEcrire("base", octets);
}
// Sauvegarde immédiate quand on quitte l'appli ou qu'on change d'onglet.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") sauverMaintenant();
});

// ------------------------------------------------------------------ Sauvegarde .zip (compatible Android)

const NOM_APPLI = "PrepaApp";

function compter(table) {
  return valeur(`SELECT COUNT(*) FROM ${table}`) ?? 0;
}

function maintenantTexte() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function nomSauvegarde() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `PrepaApp_sauvegarde_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.zip`;
}

/** Fabrique le fichier .zip de sauvegarde (même format que l'appli Android). */
export async function exporterSauvegarde() {
  await sauverMaintenant();
  const zip = new window.JSZip();
  const cles = (await idbCles()).filter((c) => String(c).startsWith("f:"));
  const infos = {
    appli: NOM_APPLI,
    format: 1,
    versionBase: VERSION_BASE,
    date: maintenantTexte(),
    matieres: compter("matieres"),
    chapitres: compter("chapitres"),
    formules: compter("formules"),
    evenements: compter("evenements"),
    images: cles.length,
    origine: "web",
  };
  zip.file("infos.json", JSON.stringify(infos, null, 2));
  zip.file("base/prepa.db", base.export());
  base.run("PRAGMA foreign_keys = ON");
  for (const c of cles) zip.file("fichiers/" + String(c).slice(2), await idbLire(c));
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  localStorage.setItem("mcpge.derniereSauvegarde", JSON.stringify(Date.now()));
  return blob;
}

/** Lit un .zip de sauvegarde et le vérifie, sans rien changer. */
export async function analyserSauvegarde(fichier) {
  let zip;
  try {
    zip = await window.JSZip.loadAsync(fichier);
  } catch {
    throw new Error("Ce fichier n'est pas un .zip valide.");
  }
  const infosF = zip.file("infos.json");
  const baseF = zip.file("base/prepa.db");
  if (!infosF || !baseF) throw new Error("Ce fichier n'est pas une sauvegarde de l'appli.");
  let infos;
  try {
    infos = JSON.parse(await infosF.async("string"));
  } catch {
    throw new Error("Sauvegarde abîmée (infos illisibles).");
  }
  if (infos.appli !== NOM_APPLI) throw new Error("Ce fichier n'est pas une sauvegarde de l'appli.");
  const octets = await baseF.async("uint8array");
  // Base Android en mode « WAL » : on la repasse en mode classique pour sql.js.
  if (octets.length > 19 && octets[18] === 2) { octets[18] = 1; octets[19] = 1; }
  let essai;
  try {
    essai = new SQL.Database(octets);
    const ok = essai.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='matieres'");
    if (!ok.length) throw new Error();
  } catch {
    throw new Error("Sauvegarde abîmée (base illisible).");
  }
  const version = essai.exec("PRAGMA user_version")[0].values[0][0];
  essai.close();
  if (version > VERSION_BASE) {
    throw new Error(`Cette sauvegarde vient d'une version plus récente (base v${version}). Mets d'abord l'appli web à jour (recharge la page).`);
  }
  if (version < VERSION_BASE) {
    throw new Error(`Cette sauvegarde vient d'une ancienne version de l'appli Android (base v${version}). ` +
      "Installe d'abord la dernière version de l'appli Android, ouvre-la une fois, puis refais la sauvegarde.");
  }
  const fichiers = Object.keys(zip.files).filter((n) => n.startsWith("fichiers/") && !zip.files[n].dir);
  return { infos, octets, zip, fichiers };
}

/** Remplace TOUTES les données par celles de la sauvegarde analysée. */
export async function restaurerSauvegarde(analyse) {
  const nouvelle = new SQL.Database(analyse.octets);
  nouvelle.run("PRAGMA foreign_keys = ON");
  const anciennes = (await idbCles()).filter((c) => String(c).startsWith("f:"));
  for (const c of anciennes) await idbEffacer(c);
  for (const nom of analyse.fichiers) {
    const contenu = await analyse.zip.file(nom).async("blob");
    await idbEcrire("f:" + nom.slice("fichiers/".length), contenu);
  }
  if (base) base.close();
  base = nouvelle;
  await sauverMaintenant();
  prevenir();
}

export function resumeSauvegarde(infos) {
  return `<ul class="liste-simple">
    <li>Date : <b>${echapper(infos.date)}</b> ${infos.origine === "web" ? "(appli web)" : "(appli Android)"}</li>
    <li>${infos.matieres} matières · ${infos.chapitres} chapitres · ${infos.formules} formules</li>
    <li>${infos.evenements} colles / DS · ${infos.images} image(s)</li>
  </ul>`;
}
