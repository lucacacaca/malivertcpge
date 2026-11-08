// Étape W3 : cours d'un chapitre (photos, PDF, notes), TD (exercices, statut, photos),
// liste « À faire » et TIPE. Mêmes tables et mêmes fichiers que l'appli Android
// (les fichiers sont gardés dans le navigateur et passent dans la sauvegarde .zip).

import { tous, un, valeur, executer, dernierId, transaction, idbLire, idbEcrire, idbEffacer } from "./db.js";
import { echapper, aujourdhui, dateLisible, delaiLisible, couleurHex, dialogue, confirmer, toast, reglages } from "./util.js";

const versIso = (j) => (j == null ? "" : new Date(j * 86400000).toISOString().slice(0, 10));
const depuisIso = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "")); return m ? Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000) : null; };
const hasard = () => Math.floor(1000 + Math.random() * 9000);

// ------------------------------------------------------------------ Fichiers (photos, PDF)

/** Sélecteur de fichiers (plusieurs possibles). */
function choisirFichiers(accept, multiple = false) {
  return new Promise((resoudre) => {
    const i = document.createElement("input");
    i.type = "file"; i.accept = accept; i.multiple = multiple; i.style.display = "none";
    i.addEventListener("change", () => { resoudre([...(i.files || [])]); i.remove(); });
    document.body.appendChild(i);
    i.click();
  });
}

async function chargerImage(fichier) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(fichier, { imageOrientation: "from-image" }); } catch { /* repli ci-dessous */ }
  }
  return new Promise((ok, ko) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => ko(new Error("Image illisible."));
    img.src = URL.createObjectURL(fichier);
  });
}

/** Réduit la photo (côté max 2400 px, JPEG), l'enregistre, renvoie son chemin relatif (« cours/ch3_… .jpg »). */
async function enregistrerPhoto(fichier, dossier, prefixe) {
  const img = await chargerImage(fichier);
  const l = img.width, h = img.height, k = Math.min(1, 2400 / Math.max(l, h));
  const c = document.createElement("canvas");
  c.width = Math.round(l * k); c.height = Math.round(h * k);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  const blob = await new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.85));
  if (!blob) throw new Error("Impossible d'enregistrer la photo.");
  const chemin = `${dossier}/${prefixe}_${Date.now()}_${hasard()}.jpg`;
  await idbEcrire("f:" + chemin, blob);
  return chemin;
}

const urls = new Map();
async function urlFichier(chemin) {
  if (!chemin) return null;
  if (urls.has(chemin)) return urls.get(chemin);
  const b = await idbLire("f:" + chemin);
  if (!b) return null;
  const type = chemin.endsWith(".pdf") ? "application/pdf" : "image/jpeg";
  const blob = b instanceof Blob && b.type ? b : new Blob([b], { type });
  const u = URL.createObjectURL(blob);
  urls.set(chemin, u);
  return u;
}
async function effacerFichier(chemin) {
  if (!chemin) return;
  if (urls.has(chemin)) { URL.revokeObjectURL(urls.get(chemin)); urls.delete(chemin); }
  await idbEffacer("f:" + chemin).catch(() => {});
}
/** Remplit les <img data-chemin> une fois la page affichée. */
function chargerImages(racine) {
  racine.querySelectorAll("img[data-chemin]").forEach(async (img) => {
    const u = await urlFichier(img.dataset.chemin);
    if (u) img.src = u; else img.alt = "Photo absente";
  });
}

/** Visionneuse plein écran (photos), avec précédente / suivante et action facultative. */
function visionneuse(chemins, depart = 0, { onSupprimer } = {}) {
  let i = depart;
  const v = document.createElement("div");
  v.className = "visionneuse";
  document.body.appendChild(v);
  const fermer = () => { v.remove(); document.removeEventListener("keydown", clavier); };
  async function afficher() {
    v.innerHTML = `<div class="vis-haut"><span>${i + 1} / ${chemins.length}</span>
        ${onSupprimer ? `<button class="bouton petit discret texte-rouge" data-v="suppr">Supprimer</button>` : ""}
        <button class="icone" data-v="fermer" aria-label="Fermer">✕</button></div>
      <div class="vis-image"><img alt=""></div>
      ${chemins.length > 1 ? `<button class="vis-nav g" data-v="prec" aria-label="Précédente">‹</button><button class="vis-nav d" data-v="suiv" aria-label="Suivante">›</button>` : ""}`;
    v.querySelector("img").src = (await urlFichier(chemins[i])) || "";
  }
  const clavier = (e) => {
    if (e.key === "Escape") fermer();
    if (e.key === "ArrowLeft") { i = (i - 1 + chemins.length) % chemins.length; afficher(); }
    if (e.key === "ArrowRight") { i = (i + 1) % chemins.length; afficher(); }
  };
  v.addEventListener("click", async (e) => {
    const a = e.target.closest("[data-v]")?.dataset.v;
    if (a === "fermer" || e.target.classList.contains("vis-image")) fermer();
    if (a === "prec") { i = (i - 1 + chemins.length) % chemins.length; afficher(); }
    if (a === "suiv") { i = (i + 1) % chemins.length; afficher(); }
    if (a === "suppr" && (await confirmer("Supprimer cette photo ?", "Elle sera définitivement supprimée.", "Supprimer", true))) {
      fermer();
      onSupprimer(chemins[i]);
    }
  });
  document.addEventListener("keydown", clavier);
  afficher();
}

// ------------------------------------------------------------------ Cours d'un chapitre

export async function ongletCours(zone, chapitreId, nav) {
  const docs = tous("SELECT * FROM documents WHERE chapitreId = ? ORDER BY ordre, id", [chapitreId]);
  const photos = docs.filter((d) => d.type === "PHOTO");
  zone.innerHTML = `
    <div class="rangee-boutons">
      <button class="bouton primaire" id="photo">📷 Photos</button>
      <button class="bouton" id="pdf">📄 PDF</button>
      <button class="bouton" id="note">✎ Note</button>
    </div>
    ${docs.length ? "" : `<p class="muet">Ajoute les pages de ton cours en photo, un PDF ou une note écrite. Tout reste sur cet appareil et part dans la sauvegarde.</p>`}
    ${photos.length ? `<div class="grille-photos">${photos.map((d, i) => `<button class="vignette" data-photo="${i}"><img data-chemin="${echapper(d.chemin)}" alt="Page ${i + 1}" loading="lazy"></button>`).join("")}</div>` : ""}
    <div class="liste">${docs.filter((d) => d.type !== "PHOTO").map((d) => d.type === "PDF"
      ? `<div class="ligne"><span class="ico-doc">📄</span><div class="ligne-texte"><b>${echapper(d.titre || "PDF")}</b><span class="petit muet">ajouté le ${new Date(d.ajouteLe).toLocaleDateString("fr-FR")}</span></div>
          <button class="bouton petit" data-ouvrir="${d.id}">Ouvrir</button><button class="icone" data-doc="${d.id}" aria-label="Options">⋮</button></div>`
      : `<div class="note-cours" data-modifier="${d.id}"><b>${echapper(d.titre || "Note")}</b><div class="texte-note">${echapper(d.texte)}</div></div>`).join("")}</div>`;
  chargerImages(zone);
  const ordre = () => (valeur("SELECT COALESCE(MAX(ordre), -1) FROM documents WHERE chapitreId = ?", [chapitreId]) ?? -1) + 1;
  zone.querySelector("#photo").onclick = async () => {
    const fs = await choisirFichiers("image/*", true);
    if (!fs.length) return;
    toast("Enregistrement…");
    let n = 0;
    for (const f of fs) {
      try {
        const chemin = await enregistrerPhoto(f, "cours", "ch" + chapitreId);
        executer("INSERT INTO documents (chapitreId, type, titre, chemin, texte, ordre, ajouteLe) VALUES (?, 'PHOTO', '', ?, '', ?, ?)", [chapitreId, chemin, ordre(), Date.now()]);
        n++;
      } catch (e) { toast(e.message); }
    }
    toast(`${n} photo(s) ajoutée(s) ✓`);
    nav.rafraichir();
  };
  zone.querySelector("#pdf").onclick = async () => {
    const [f] = await choisirFichiers("application/pdf,.pdf");
    if (!f) return;
    const chemin = `pdf/ch${chapitreId}_${Date.now()}_${hasard()}.pdf`;
    await idbEcrire("f:" + chemin, new Blob([await f.arrayBuffer()], { type: "application/pdf" }));
    executer("INSERT INTO documents (chapitreId, type, titre, chemin, texte, ordre, ajouteLe) VALUES (?, 'PDF', ?, ?, '', ?, ?)", [chapitreId, f.name.replace(/\.pdf$/i, ""), chemin, ordre(), Date.now()]);
    toast("PDF ajouté ✓");
    nav.rafraichir();
  };
  zone.querySelector("#note").onclick = async () => { if (await dialogueNoteCours({ id: 0, titre: "", texte: "" }, chapitreId, ordre())) nav.rafraichir(); };
  zone.onclick = async (e) => {
    const p = e.target.closest("[data-photo]");
    if (p) {
      visionneuse(photos.map((d) => d.chemin), Number(p.dataset.photo), {
        onSupprimer: async (chemin) => { executer("DELETE FROM documents WHERE chapitreId = ? AND chemin = ?", [chapitreId, chemin]); await effacerFichier(chemin); nav.rafraichir(); },
      });
      return;
    }
    const o = e.target.closest("[data-ouvrir]");
    if (o) {
      const d = docs.find((x) => x.id === Number(o.dataset.ouvrir));
      const u = await urlFichier(d.chemin);
      if (u) window.open(u, "_blank"); else toast("Fichier absent de cet appareil.");
      return;
    }
    const m = e.target.closest("[data-modifier]");
    if (m) { if (await dialogueNoteCours(docs.find((x) => x.id === Number(m.dataset.modifier)), chapitreId, 0)) nav.rafraichir(); return; }
    const d = e.target.closest("[data-doc]");
    if (d) {
      const doc = docs.find((x) => x.id === Number(d.dataset.doc));
      const r = await dialogue({
        titre: doc.titre || "PDF",
        contenu: `<label class="champ"><span>Titre</span><input id="t" maxlength="100" value="${echapper(doc.titre)}"></label>`,
        boutons: [{ texte: "Supprimer", style: "discret texte-rouge", valeur: () => "suppr" }, { texte: "Annuler", valeur: null },
          { texte: "Enregistrer", style: "primaire", valeur: (f) => ({ titre: f.querySelector("#t").value.trim() }) }],
      });
      if (r === "suppr") {
        if (!(await confirmer("Supprimer ce PDF ?", "Il sera définitivement supprimé de cet appareil.", "Supprimer", true))) return;
        executer("DELETE FROM documents WHERE id = ?", [doc.id]);
        await effacerFichier(doc.chemin);
      } else if (r) executer("UPDATE documents SET titre = ? WHERE id = ?", [r.titre, doc.id]);
      if (r) nav.rafraichir();
    }
  };
}

async function dialogueNoteCours(d, chapitreId, ordre) {
  const r = await dialogue({
    titre: d.id ? "Modifier la note" : "Nouvelle note", large: true,
    contenu: `<label class="champ"><span>Titre</span><input id="t" maxlength="100" value="${echapper(d.titre)}"></label>
      <label class="champ"><span>Texte</span><textarea id="x" rows="12">${echapper(d.texte)}</textarea></label>`,
    boutons: [...(d.id ? [{ texte: "Supprimer", style: "discret texte-rouge", valeur: () => "suppr" }] : []), { texte: "Annuler", valeur: null },
      { texte: "Enregistrer", style: "primaire", valeur: (f) => ({ titre: f.querySelector("#t").value.trim(), texte: f.querySelector("#x").value }) }],
  });
  if (!r) return false;
  if (r === "suppr") {
    if (!(await confirmer("Supprimer cette note ?", "Elle sera définitivement supprimée.", "Supprimer", true))) return false;
    executer("DELETE FROM documents WHERE id = ?", [d.id]);
  } else if (d.id) executer("UPDATE documents SET titre = ?, texte = ? WHERE id = ?", [r.titre, r.texte, d.id]);
  else executer("INSERT INTO documents (chapitreId, type, titre, chemin, texte, ordre, ajouteLe) VALUES (?, 'NOTE', ?, NULL, ?, ?, ?)", [chapitreId, r.titre, r.texte, ordre, Date.now()]);
  return true;
}

// ------------------------------------------------------------------ TD

export const STATUTS = {
  PAS_FAIT: { lib: "Pas fait", coul: "#9e9e9e" },
  FAIT: { lib: "Fait", coul: "#1e88e5" },
  A_REFAIRE: { lib: "À refaire", coul: "#e53935" },
  MAITRISE: { lib: "Maîtrisé", coul: "#43a047" },
};
const CYCLE = ["PAS_FAIT", "FAIT", "MAITRISE", "A_REFAIRE"];
const FILTRES = {
  TOUS: { lib: "Tous", ok: () => true },
  A_FAIRE: { lib: "À faire", ok: (s) => s === "PAS_FAIT" || s === "A_REFAIRE" },
  A_REFAIRE: { lib: "À refaire", ok: (s) => s === "A_REFAIRE" },
  FAITS: { lib: "Faits", ok: (s) => s === "FAIT" || s === "MAITRISE" },
};

const SQL_EX = `SELECT exercices.*, chapitres.titre AS chapitreTitre, chapitres.matiereId AS matiereId,
    (SELECT COUNT(*) FROM exercice_photos p WHERE p.exerciceId = exercices.id) AS nbPhotos
  FROM exercices INNER JOIN chapitres ON chapitres.id = exercices.chapitreId`;
const ORDRE_EX = " ORDER BY chapitres.ordre, chapitres.id, exercices.ordre, exercices.id";

export const exercicesDesChapitres = (ids) => (ids.length ? tous(SQL_EX + ` WHERE exercices.chapitreId IN (${ids.map(() => "?").join(",")})` + ORDRE_EX, ids) : []);

const nomExercice = (x) => [x.numero ? `Ex. ${x.numero}` : null, x.titre || null].filter(Boolean).join(" — ") || "Exercice";

/** Filtres + liste d'exercices (groupés par chapitre si demandé). */
export function listeTd(exs, filtre, { parChapitre = false } = {}) {
  const f = FILTRES[filtre] || FILTRES.TOUS;
  const faits = exs.filter((x) => x.statut === "FAIT" || x.statut === "MAITRISE").length;
  const visibles = exs.filter((x) => f.ok(x.statut));
  const ligne = (x) => `<div class="ligne exo">
      <button class="statut" data-cycle="${x.id}" style="--c:${STATUTS[x.statut]?.coul || "#999"}" title="Changer le statut">${STATUTS[x.statut]?.lib || x.statut}</button>
      <a class="ligne-texte" href="#/exercice/${x.id}"><b>${echapper(nomExercice(x))}</b>${x.note || x.nbPhotos ? `<span class="petit muet">${[x.nbPhotos ? `📷 ${x.nbPhotos}` : null, x.note ? echapper(x.note.slice(0, 80)) : null].filter(Boolean).join(" · ")}</span>` : ""}</a>
      <span class="chevron">›</span></div>`;
  let corps;
  if (parChapitre) {
    const groupes = new Map();
    for (const x of visibles) { if (!groupes.has(x.chapitreId)) groupes.set(x.chapitreId, { titre: x.chapitreTitre, l: [] }); groupes.get(x.chapitreId).l.push(x); }
    corps = [...groupes.entries()].map(([id, g]) => `<h3 class="sous-titre"><a href="#/chapitre/${id}?onglet=td">${echapper(g.titre)}</a></h3><div class="liste">${g.l.map(ligne).join("")}</div>`).join("");
  } else corps = `<div class="liste">${visibles.map(ligne).join("")}</div>`;
  return `<p class="petit muet">${faits} / ${exs.length} faits</p>
    <div class="puces">${Object.entries(FILTRES).map(([k, v]) => `<button class="puce-choix${k === filtre ? " actif" : ""}" data-filtre="${k}">${v.lib} (${exs.filter((x) => v.ok(x.statut)).length})</button>`).join("")}</div>
    ${visibles.length ? corps : `<p class="petit muet">Aucun exercice ici.</p>`}`;
}

/** Gère les clics de la liste (filtre, changement rapide de statut). */
function brancherListe(zone, rafraichir) {
  zone.addEventListener("click", (e) => {
    const f = e.target.closest("[data-filtre]");
    if (f) { reglages.ecrire("filtreTd", f.dataset.filtre); rafraichir(); return; }
    const c = e.target.closest("[data-cycle]");
    if (c) {
      const x = un("SELECT statut FROM exercices WHERE id = ?", [Number(c.dataset.cycle)]);
      const s = CYCLE[(CYCLE.indexOf(x.statut) + 1) % CYCLE.length];
      executer("UPDATE exercices SET statut = ?, modifieLe = ? WHERE id = ?", [s, Date.now(), Number(c.dataset.cycle)]);
      rafraichir();
    }
  });
}

/** « 1-12 », « 1,3,5 », « 4 » → liste de numéros. */
function lireNumeros(t) {
  const res = [];
  for (const p of String(t).split(/[,;]/).map((x) => x.trim()).filter(Boolean)) {
    const m = /^(\d+)\s*[-à]\s*(\d+)$/.exec(p);
    if (m && +m[2] >= +m[1] && +m[2] - +m[1] < 100) for (let k = +m[1]; k <= +m[2]; k++) res.push(String(k));
    else res.push(p);
  }
  return res;
}

export function ongletTd(zone, chapitreId, nav) {
  function dessiner() {
    const exs = exercicesDesChapitres([chapitreId]);
    zone.innerHTML = `<div class="rangee-boutons"><button class="bouton primaire" id="ajouter">+ Exercices</button></div>
      ${exs.length ? listeTd(exs, reglages.lire("filtreTd", "TOUS")) : `<p class="muet">Ajoute les exercices de ton TD (ex. « 1-12 ») : coche ceux que tu as faits, ceux à refaire, ajoute la photo de l'énoncé et de la correction.</p>`}`;
    zone.querySelector("#ajouter").onclick = async () => {
      const r = await dialogue({
        titre: "Ajouter des exercices",
        contenu: `<label class="champ"><span>Numéros (ex. « 1-12 », « 1, 3, 5 » ou « TD2 ex 4 »)</span><input id="n" maxlength="200"></label>
          <label class="champ"><span>Titre (facultatif, si un seul exercice)</span><input id="t" maxlength="100"></label>`,
        boutons: [{ texte: "Annuler", valeur: null }, { texte: "Ajouter", style: "primaire", valeur: (f) => ({ n: f.querySelector("#n").value, t: f.querySelector("#t").value.trim() }) }],
        apresOuverture: (f) => f.querySelector("#n").focus(),
      });
      if (!r) return;
      const nums = lireNumeros(r.n);
      if (!nums.length && r.t) nums.push("");
      if (!nums.length) return;
      let o = (valeur("SELECT COALESCE(MAX(ordre), -1) FROM exercices WHERE chapitreId = ?", [chapitreId]) ?? -1) + 1;
      transaction(() => {
        for (const n of nums) executer("INSERT INTO exercices (chapitreId, numero, titre, statut, note, ordre, modifieLe) VALUES (?, ?, ?, 'PAS_FAIT', '', ?, ?)", [chapitreId, n, nums.length === 1 ? r.t : "", o++, Date.now()]);
      });
      toast(`${nums.length} exercice(s) ajouté(s) ✓`);
      nav.rafraichir();
    };
  }
  brancherListe(zone, dessiner);
  dessiner();
}

/** Tous les TD d'une matière, par chapitre. */
export function vueTdMatiere(el, matiereId) {
  const m = un("SELECT * FROM matieres WHERE id = ?", [matiereId]);
  if (!m) { el.innerHTML = `<p class="muet">Matière introuvable.</p>`; return; }
  function dessiner() {
    const ids = tous("SELECT id FROM chapitres WHERE matiereId = ? AND masque = 0", [matiereId]).map((c) => c.id);
    const exs = exercicesDesChapitres(ids);
    el.innerHTML = `<a class="retour" href="#/matiere/${matiereId}">‹ ${echapper(m.nom)}</a>
      <h1 class="titre-page">📋 Tous les TD</h1>
      <div id="zone">${exs.length ? listeTd(exs, reglages.lire("filtreTd", "TOUS"), { parChapitre: true }) : `<p class="muet">Aucun exercice. Ouvre un chapitre → onglet TD pour en ajouter.</p>`}</div>`;
  }
  dessiner();
  brancherListe(el, dessiner);
}

/** Bloc « TD de ces chapitres » pour la page d'une colle / d'un DS. */
export function blocTdEpreuve(zone, ids) {
  function dessiner() {
    const exs = exercicesDesChapitres(ids);
    zone.innerHTML = `<h2 class="titre-section">TD de ces chapitres</h2>${exs.length ? listeTd(exs, reglages.lire("filtreTd", "TOUS"), { parChapitre: true })
      : `<p class="petit muet">Aucun exercice dans ces chapitres (ajoute-les dans l'onglet TD du chapitre).</p>`}`;
  }
  dessiner();
  brancherListe(zone, dessiner);
}

// ------------------------------------------------------------------ Un exercice

export function vueExercice(el, id, nav) {
  const x = un(SQL_EX + " WHERE exercices.id = ?", [id]);
  if (!x) { el.innerHTML = `<p class="muet">Exercice introuvable.</p>`; return; }
  const photos = tous("SELECT * FROM exercice_photos WHERE exerciceId = ? ORDER BY sorte, ordre, id", [id]);
  const parSorte = (s) => photos.filter((p) => p.sorte === s);
  const sectionPhotos = (s, t) => `<h3 class="sous-titre">${t}</h3>
    <div class="grille-photos">${parSorte(s).map((p, i) => `<button class="vignette" data-photo="${s}:${i}"><img data-chemin="${echapper(p.chemin)}" alt="${t} ${i + 1}" loading="lazy"></button>`).join("")}
      <button class="vignette ajout" data-ajout="${s}">＋<small>Photo</small></button></div>`;
  el.innerHTML = `
    <a class="retour" href="#/chapitre/${x.chapitreId}?onglet=td">‹ ${echapper(x.chapitreTitre)}</a>
    <h1 class="titre-page">${echapper(nomExercice(x))}</h1>
    <div class="puces">${Object.entries(STATUTS).map(([k, v]) => `<button class="puce-choix statut-choix${x.statut === k ? " actif" : ""}" data-statut="${k}" style="--c:${v.coul}">${v.lib}</button>`).join("")}</div>
    <div class="deux-col"><label class="champ"><span>Numéro</span><input id="numero" maxlength="40" value="${echapper(x.numero)}"></label>
      <label class="champ"><span>Titre</span><input id="titre" maxlength="100" value="${echapper(x.titre)}"></label></div>
    <label class="champ"><span>Ma note (méthode, piège, où j'ai bloqué…)</span><textarea id="note" rows="4">${echapper(x.note)}</textarea></label>
    ${sectionPhotos("ENONCE", "Énoncé")}
    ${sectionPhotos("CORRECTION", "Correction")}
    <div class="rangee-boutons" style="margin-top:16px">
      <button class="bouton" id="ia">🤖 Demander une correction à une IA</button>
      <button class="bouton discret texte-rouge" id="supprimer">Supprimer l'exercice</button>
    </div>`;
  chargerImages(el);
  let minuteur = null;
  const sauver = () => {
    clearTimeout(minuteur);
    executer("UPDATE exercices SET numero = ?, titre = ?, note = ?, modifieLe = ? WHERE id = ?",
      [el.querySelector("#numero").value.trim(), el.querySelector("#titre").value.trim(), el.querySelector("#note").value, Date.now(), id]);
  };
  ["#numero", "#titre", "#note"].forEach((s) => {
    el.querySelector(s).addEventListener("input", () => { clearTimeout(minuteur); minuteur = setTimeout(sauver, 600); });
    el.querySelector(s).addEventListener("blur", sauver);
  });
  el.onclick = async (e) => {
    const s = e.target.closest("[data-statut]");
    if (s) {
      executer("UPDATE exercices SET statut = ?, modifieLe = ? WHERE id = ?", [s.dataset.statut, Date.now(), id]);
      el.querySelectorAll("[data-statut]").forEach((b) => b.classList.toggle("actif", b === s));
      return;
    }
    const a = e.target.closest("[data-ajout]");
    if (a) {
      const fs = await choisirFichiers("image/*", true);
      if (!fs.length) return;
      sauver();
      let o = (valeur("SELECT COALESCE(MAX(ordre), -1) FROM exercice_photos WHERE exerciceId = ? AND sorte = ?", [id, a.dataset.ajout]) ?? -1) + 1;
      for (const f of fs) {
        try {
          const chemin = await enregistrerPhoto(f, "td", "ex" + id);
          executer("INSERT INTO exercice_photos (exerciceId, sorte, chemin, ordre) VALUES (?, ?, ?, ?)", [id, a.dataset.ajout, chemin, o++]);
        } catch (err) { toast(err.message); }
      }
      nav.rafraichir();
      return;
    }
    const p = e.target.closest("[data-photo]");
    if (p) {
      const [sorte, i] = p.dataset.photo.split(":");
      visionneuse(parSorte(sorte).map((q) => q.chemin), Number(i), {
        onSupprimer: async (chemin) => { executer("DELETE FROM exercice_photos WHERE exerciceId = ? AND chemin = ?", [id, chemin]); await effacerFichier(chemin); nav.rafraichir(); },
      });
    }
  };
  el.querySelector("#ia").onclick = async () => {
    sauver();
    const texte = `Voici l'énoncé${parSorte("CORRECTION").length ? " et ma correction" : ""} d'un exercice de prépa (${nomExercice(x)}, chapitre « ${x.chapitreTitre} »). Explique-moi la méthode pas à pas, sans sauter d'étape, et dis-moi où sont les pièges.${x.note ? `\nMa note : ${x.note}` : ""}`;
    const fichiers = [];
    for (const ph of photos) {
      const b = await idbLire("f:" + ph.chemin);
      if (b) fichiers.push(new File([b], ph.chemin.split("/").pop(), { type: "image/jpeg" }));
    }
    try {
      if (fichiers.length && navigator.canShare && navigator.canShare({ files: fichiers })) {
        await navigator.share({ files: fichiers, text: texte, title: nomExercice(x) });
        return;
      }
    } catch (err) { if (err.name === "AbortError") return; }
    try { await navigator.clipboard.writeText(texte); } catch { /* presse-papiers indisponible */ }
    dialogue({
      titre: "Demander une correction",
      contenu: `<p>Le partage de photos n'est pas disponible ici. La demande ci-dessous a été copiée : colle-la dans Claude (ou une autre IA) avec les photos de l'exercice.</p><pre class="bloc-texte">${echapper(texte)}</pre>`,
    });
  };
  el.querySelector("#supprimer").onclick = async () => {
    if (!(await confirmer("Supprimer cet exercice ?", "L'exercice, sa note et ses photos seront supprimés.", "Supprimer", true))) return;
    for (const p of photos) await effacerFichier(p.chemin);
    executer("DELETE FROM exercices WHERE id = ?", [id]);
    location.replace(`#/chapitre/${x.chapitreId}?onglet=td`);
  };
}

// ------------------------------------------------------------------ À faire

const IMPORTANCES = [
  { lib: "Quand j'ai le temps", pastille: "○", coul: "#9e9e9e" },
  { lib: "Normale", pastille: "●", coul: "#1e88e5" },
  { lib: "Importante", pastille: "!", coul: "#fb8c00" },
  { lib: "Urgente", pastille: "!!", coul: "#e53935" },
];
const imp = (n) => IMPORTANCES[n] || IMPORTANCES[1];
/** « demain », « en retard (3 j) »… */
function echeance(j) {
  if (j == null) return "";
  const n = j - aujourdhui();
  if (n < 0) return `en retard (${-n} j)`;
  return n === 0 ? "aujourd'hui" : n === 1 ? "demain" : `${dateLisible(j)} (dans ${n} j)`;
}

const tachesAFaire = () => tous("SELECT * FROM taches WHERE faite = 0 ORDER BY importance DESC, pourLe IS NULL, pourLe, creeeLe");

function ligneTache(t) {
  const retard = t.pourLe != null && t.pourLe < aujourdhui() && !t.faite;
  return `<div class="ligne tache${t.faite ? " faite" : ""}">
    <input type="checkbox" data-cocher="${t.id}" ${t.faite ? "checked" : ""} aria-label="Fait">
    <button class="ligne-texte texte-bouton" data-tache="${t.id}"><span>${t.importance !== 1 ? `<b style="color:${imp(t.importance).coul}">${imp(t.importance).pastille}</b> ` : ""}${echapper(t.texte)}</span>
      ${t.pourLe != null || t.note ? `<span class="petit ${retard ? "erreur" : "muet"}">${[echeance(t.pourLe) || null, t.note ? echapper(t.note.slice(0, 80)) : null].filter(Boolean).join(" · ")}</span>` : ""}</button></div>`;
}

export function blocTachesAccueil() {
  const l = tachesAFaire();
  if (!l.length) return "";
  return `<section><h2 class="titre-section">À faire (${l.length}) <a class="lien petit" href="#/taches">Tout voir ›</a></h2>
    <div class="liste" data-zone-taches>${l.slice(0, 3).map(ligneTache).join("")}</div></section>`;
}

/** Cocher une tâche depuis n'importe quelle page (accueil, À faire). */
export function brancherTaches(el, nav) {
  el.addEventListener("change", (e) => {
    const c = e.target.closest("[data-cocher]");
    if (!c) return;
    executer("UPDATE taches SET faite = ?, faiteLe = ? WHERE id = ?", [c.checked ? 1 : 0, c.checked ? Date.now() : null, Number(c.dataset.cocher)]);
    if (c.checked) toast("Bien joué ✓");
    setTimeout(() => nav.rafraichir(), 250);
  });
  el.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-tache]");
    if (b && (await dialogueTache(un("SELECT * FROM taches WHERE id = ?", [Number(b.dataset.tache)])))) nav.rafraichir();
  });
}

async function dialogueTache(t) {
  const r = await dialogue({
    titre: t.id ? "Modifier" : "À faire",
    contenu: `<label class="champ"><span>Quoi ?</span><input id="t" maxlength="200" value="${echapper(t.texte)}"></label>
      <div class="puces" id="imp">${IMPORTANCES.map((v, k) => `<button type="button" class="puce-choix${t.importance === k ? " actif" : ""}" data-imp="${k}"><b style="color:${v.coul}">${v.pastille}</b> ${v.lib}</button>`).join("")}</div>
      <label class="champ"><span>Pour le (facultatif)</span><input id="d" type="date" value="${versIso(t.pourLe)}"></label>
      <label class="champ"><span>Note (facultatif)</span><textarea id="n" rows="3">${echapper(t.note)}</textarea></label>`,
    boutons: [...(t.id ? [{ texte: "Supprimer", style: "discret texte-rouge", valeur: () => "suppr" }] : []), { texte: "Annuler", valeur: null },
      { texte: "Enregistrer", style: "primaire", valeur: (f) => {
        const texte = f.querySelector("#t").value.trim();
        if (!texte) return undefined;
        return { texte, importance: Number(f.querySelector("#imp .actif")?.dataset.imp ?? 1), pourLe: depuisIso(f.querySelector("#d").value), note: f.querySelector("#n").value.trim() };
      } }],
    apresOuverture: (f) => {
      f.querySelector("#imp").addEventListener("click", (e) => { const b = e.target.closest("[data-imp]"); if (b) f.querySelectorAll("[data-imp]").forEach((x) => x.classList.toggle("actif", x === b)); });
      if (!t.id) f.querySelector("#t").focus();
    },
  });
  if (!r) return false;
  if (r === "suppr") executer("DELETE FROM taches WHERE id = ?", [t.id]);
  else if (t.id) executer("UPDATE taches SET texte = ?, importance = ?, pourLe = ?, note = ? WHERE id = ?", [r.texte, r.importance, r.pourLe, r.note, t.id]);
  else executer("INSERT INTO taches (texte, importance, faite, pourLe, note, creeeLe, faiteLe) VALUES (?, ?, 0, ?, ?, ?, NULL)", [r.texte, r.importance, r.pourLe, r.note, Date.now()]);
  return true;
}

export function vueTaches(el, nav) {
  const l = tachesAFaire();
  const faites = tous("SELECT * FROM taches WHERE faite = 1 ORDER BY faiteLe DESC, id DESC");
  el.innerHTML = `
    <h1 class="titre-page">À faire</h1>
    <form class="ajout-rapide" id="rapide"><input id="texte" maxlength="200" placeholder="Ajouter : rendre le DM de maths, acheter une calculatrice…" autocomplete="off">
      <button class="bouton primaire" type="submit">Ajouter</button></form>
    <button class="bouton discret petit" id="detail">+ Avec une date ou une importance…</button>
    <div class="liste" style="margin-top:12px">${l.map(ligneTache).join("") || `<p class="muet">Rien à faire 🎉 Ajoute ce que tu ne veux pas oublier (hors révisions et TIPE).</p>`}</div>
    ${faites.length ? `<details class="replie"><summary>Faites (${faites.length})</summary><div class="liste">${faites.slice(0, 50).map(ligneTache).join("")}</div>
      <button class="bouton discret petit" id="vider">Effacer les choses faites</button></details>` : ""}`;
  brancherTaches(el, nav);
  el.querySelector("#rapide").onsubmit = (e) => {
    e.preventDefault();
    const t = el.querySelector("#texte").value.trim();
    if (!t) return;
    executer("INSERT INTO taches (texte, importance, faite, pourLe, note, creeeLe, faiteLe) VALUES (?, 1, 0, NULL, '', ?, NULL)", [t, Date.now()]);
    nav.rafraichir();
    setTimeout(() => document.querySelector("#texte")?.focus(), 50);
  };
  el.querySelector("#detail").onclick = async () => { if (await dialogueTache({ id: 0, texte: el.querySelector("#texte").value.trim(), importance: 1, pourLe: null, note: "" })) nav.rafraichir(); };
  const v = el.querySelector("#vider");
  if (v) v.onclick = async () => {
    if (!(await confirmer("Effacer les choses faites ?", `${faites.length} élément(s) seront supprimés.`, "Effacer", true))) return;
    executer("DELETE FROM taches WHERE faite = 1");
    nav.rafraichir();
  };
}

// ------------------------------------------------------------------ TIPE

const prix = (v) => (v == null ? "" : v.toFixed(2).replace(".", ",") + " €");

export function vueTipe(el, nav) {
  const ech = tous("SELECT * FROM tipe_echeances ORDER BY faite, jour, id");
  const taches = tous("SELECT * FROM tipe_taches ORDER BY faite, pourLe IS NULL, pourLe, creeeLe");
  const achats = tous("SELECT * FROM tipe_achats ORDER BY achete, id");
  const total = achats.reduce((s, a) => s + (a.prix || 0) * a.quantite, 0);
  const reste = achats.filter((a) => !a.achete).reduce((s, a) => s + (a.prix || 0) * a.quantite, 0);
  const tipe = un("SELECT id FROM matieres WHERE nom LIKE '%TIPE%' LIMIT 1");
  const prochaine = ech.find((e) => !e.faite && e.jour >= aujourdhui());
  const j = aujourdhui();
  el.innerHTML = `
    <h1 class="titre-page">TIPE</h1>
    ${prochaine ? `<div class="encart accent"><div><span class="petit">Prochaine échéance</span><br><b>${echapper(prochaine.titre)}</b><p class="petit muet">${dateLisible(prochaine.jour)} · ${delaiLisible(prochaine.jour)}</p></div></div>` : ""}
    <h2 class="titre-section">Échéances <button class="bouton petit" data-ajouter="ech">+</button></h2>
    <div class="liste">${ech.map((e) => `<div class="ligne${e.faite ? " faite" : ""}"><input type="checkbox" data-coche="ech:${e.id}" ${e.faite ? "checked" : ""} aria-label="Faite">
      <button class="ligne-texte texte-bouton" data-ech="${e.id}"><span>${echapper(e.titre)}</span><span class="petit ${!e.faite && e.jour < j ? "erreur" : "muet"}">${dateLisible(e.jour)} · ${e.faite ? "faite" : delaiLisible(e.jour)}${e.note ? " · " + echapper(e.note.slice(0, 60)) : ""}</span></button></div>`).join("")
      || `<p class="petit muet">Ajoute les dates importantes : MCOT, mise en cohérence, rendu du rapport, oral…</p>`}</div>
    <h2 class="titre-section">Tâches <button class="bouton petit" data-ajouter="tache">+</button></h2>
    <div class="liste">${taches.map((t) => `<div class="ligne${t.faite ? " faite" : ""}"><input type="checkbox" data-coche="tache:${t.id}" ${t.faite ? "checked" : ""} aria-label="Faite">
      <button class="ligne-texte texte-bouton" data-ttipe="${t.id}"><span>${echapper(t.texte)}</span>${t.pourLe != null ? `<span class="petit ${!t.faite && t.pourLe < j ? "erreur" : "muet"}">${echeance(t.pourLe)}</span>` : ""}</button></div>`).join("")
      || `<p class="petit muet">Les étapes de ton TIPE : biblio, protocole, mesures, analyse…</p>`}</div>
    <h2 class="titre-section">Achats <button class="bouton petit" data-ajouter="achat">+</button></h2>
    ${achats.length ? `<p class="petit muet">Total ${prix(total)} · reste à acheter ${prix(reste)}</p>` : ""}
    <div class="liste">${achats.map((a) => `<div class="ligne${a.achete ? " faite" : ""}"><input type="checkbox" data-coche="achat:${a.id}" ${a.achete ? "checked" : ""} aria-label="Acheté">
      <button class="ligne-texte texte-bouton" data-achat="${a.id}"><span>${a.quantite > 1 ? a.quantite + " × " : ""}${echapper(a.nom)}</span>
        <span class="petit muet">${[a.prix != null ? prix(a.prix * a.quantite) : null, a.magasin || null, a.note || null].filter(Boolean).map(echapper).join(" · ")}</span></button></div>`).join("")
      || `<p class="petit muet">Matériel à acheter pour tes expériences, avec le prix et le magasin.</p>`}</div>
    ${tipe ? `<p style="margin-top:20px"><a class="bouton" href="#/matiere/${tipe.id}">Fiches et cours du TIPE ›</a></p>` : ""}`;
  el.addEventListener("change", (e) => {
    const c = e.target.closest("[data-coche]");
    if (!c) return;
    const [sorte, id] = c.dataset.coche.split(":");
    const v = c.checked ? 1 : 0;
    if (sorte === "ech") executer("UPDATE tipe_echeances SET faite = ? WHERE id = ?", [v, +id]);
    if (sorte === "tache") executer("UPDATE tipe_taches SET faite = ? WHERE id = ?", [v, +id]);
    if (sorte === "achat") executer("UPDATE tipe_achats SET achete = ? WHERE id = ?", [v, +id]);
    setTimeout(() => nav.rafraichir(), 250);
  });
  el.onclick = async (e) => {
    const a = e.target.closest("[data-ajouter]")?.dataset.ajouter;
    let fait = false;
    if (a === "ech") fait = await dialogueEcheance({ id: 0, titre: "", jour: j + 7, note: "" });
    if (a === "tache") fait = await dialogueTacheTipe({ id: 0, texte: "", pourLe: null });
    if (a === "achat") fait = await dialogueAchat({ id: 0, nom: "", prix: null, quantite: 1, magasin: "", note: "" });
    const b = e.target.closest("[data-ech],[data-ttipe],[data-achat]");
    if (b?.dataset.ech) fait = await dialogueEcheance(un("SELECT * FROM tipe_echeances WHERE id = ?", [+b.dataset.ech]));
    if (b?.dataset.ttipe) fait = await dialogueTacheTipe(un("SELECT * FROM tipe_taches WHERE id = ?", [+b.dataset.ttipe]));
    if (b?.dataset.achat) fait = await dialogueAchat(un("SELECT * FROM tipe_achats WHERE id = ?", [+b.dataset.achat]));
    if (fait) nav.rafraichir();
  };
}

/** Dialogue générique : champs [{cle, lib, type, valeur}] → objet, ou "suppr". */
async function formulaire(titre, champs, existe) {
  const r = await dialogue({
    titre,
    contenu: champs.map((c) => c.type === "textarea"
      ? `<label class="champ"><span>${c.lib}</span><textarea data-cle="${c.cle}" rows="3">${echapper(c.valeur ?? "")}</textarea></label>`
      : `<label class="champ"><span>${c.lib}</span><input data-cle="${c.cle}" type="${c.type === "number" ? "text" : c.type || "text"}" ${c.type === "number" ? 'inputmode="decimal"' : ""} value="${echapper(c.valeur ?? "")}"></label>`).join("") + `<p class="erreur" id="f-err"></p>`,
    boutons: [...(existe ? [{ texte: "Supprimer", style: "discret texte-rouge", valeur: () => "suppr" }] : []), { texte: "Annuler", valeur: null },
      { texte: "Enregistrer", style: "primaire", valeur: (f) => {
        const o = {};
        f.querySelectorAll("[data-cle]").forEach((i) => { o[i.dataset.cle] = i.value.trim(); });
        if (!o[champs[0].cle]) { f.querySelector("#f-err").textContent = "Remplis « " + champs[0].lib + " »."; return undefined; }
        return o;
      } }],
    apresOuverture: (f) => { if (!existe) f.querySelector("[data-cle]").focus(); },
  });
  if (r === "suppr" && !(await confirmer("Supprimer ?", "Suppression définitive.", "Supprimer", true))) return null;
  return r;
}

async function dialogueEcheance(e) {
  const r = await formulaire(e.id ? "Échéance" : "Nouvelle échéance", [
    { cle: "titre", lib: "Titre (ex. rendu de la MCOT)", valeur: e.titre }, { cle: "jour", lib: "Date", type: "date", valeur: versIso(e.jour) },
    { cle: "note", lib: "Note", type: "textarea", valeur: e.note }], e.id);
  if (!r) return false;
  if (r === "suppr") executer("DELETE FROM tipe_echeances WHERE id = ?", [e.id]);
  else {
    const jour = depuisIso(r.jour) ?? e.jour;
    if (e.id) executer("UPDATE tipe_echeances SET titre = ?, jour = ?, note = ? WHERE id = ?", [r.titre, jour, r.note, e.id]);
    else executer("INSERT INTO tipe_echeances (titre, jour, faite, note) VALUES (?, ?, 0, ?)", [r.titre, jour, r.note]);
  }
  return true;
}
async function dialogueTacheTipe(t) {
  const r = await formulaire(t.id ? "Tâche" : "Nouvelle tâche", [
    { cle: "texte", lib: "Quoi ?", valeur: t.texte }, { cle: "pourLe", lib: "Pour le (facultatif)", type: "date", valeur: versIso(t.pourLe) }], t.id);
  if (!r) return false;
  if (r === "suppr") executer("DELETE FROM tipe_taches WHERE id = ?", [t.id]);
  else if (t.id) executer("UPDATE tipe_taches SET texte = ?, pourLe = ? WHERE id = ?", [r.texte, depuisIso(r.pourLe), t.id]);
  else executer("INSERT INTO tipe_taches (texte, faite, pourLe, creeeLe) VALUES (?, 0, ?, ?)", [r.texte, depuisIso(r.pourLe), Date.now()]);
  return true;
}
async function dialogueAchat(a) {
  const r = await formulaire(a.id ? "Achat" : "Nouvel achat", [
    { cle: "nom", lib: "Quoi ?", valeur: a.nom }, { cle: "prix", lib: "Prix unitaire (€)", type: "number", valeur: a.prix ?? "" },
    { cle: "quantite", lib: "Quantité", type: "number", valeur: a.quantite }, { cle: "magasin", lib: "Magasin / site", valeur: a.magasin },
    { cle: "note", lib: "Note", type: "textarea", valeur: a.note }], a.id);
  if (!r) return false;
  if (r === "suppr") { executer("DELETE FROM tipe_achats WHERE id = ?", [a.id]); return true; }
  const p = r.prix === "" ? null : Number(String(r.prix).replace(",", "."));
  const q = Math.max(1, parseInt(r.quantite, 10) || 1);
  const v = [r.nom, Number.isFinite(p) ? p : null, q, r.magasin, r.note];
  if (a.id) executer("UPDATE tipe_achats SET nom = ?, prix = ?, quantite = ?, magasin = ?, note = ? WHERE id = ?", [...v, a.id]);
  else executer("INSERT INTO tipe_achats (nom, prix, quantite, achete, magasin, note) VALUES (?, ?, ?, 0, ?, ?)", [v[0], v[1], v[2], v[3], v[4]]);
  return true;
}
