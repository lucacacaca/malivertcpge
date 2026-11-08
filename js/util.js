// Petits outils partagés : dates, HTML, dialogues, fichiers.

export const $ = (sel, racine = document) => racine.querySelector(sel);
export const $$ = (sel, racine = document) => Array.from(racine.querySelectorAll(sel));

export function echapper(texte) {
  return String(texte ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Jour courant compté depuis le 1/1/1970 (même convention que l'appli Android). */
export function aujourdhui() {
  const d = new Date();
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
}

export function debutDuJourMillis() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

const FORMAT_DATE = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const FORMAT_COURT = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });

/** « samedi 7 novembre ». */
export function dateLisible(jour) {
  return FORMAT_DATE.format(new Date(jour * 86400000));
}
export function dateCourte(jour) {
  return FORMAT_COURT.format(new Date(jour * 86400000));
}

/** « demain », « dans 6 jours », « aujourd'hui », « passé ». */
export function delaiLisible(jour) {
  const n = jour - aujourdhui();
  if (n < 0) return "passé";
  if (n === 0) return "aujourd'hui";
  if (n === 1) return "demain";
  return `dans ${n} jours`;
}

/** Couleur Android (ARGB entier) → « #1e88e5 ». */
export function couleurHex(v) {
  const n = Number(v ?? 0);
  const rgb = ((n % 16777216) + 16777216) % 16777216;
  return "#" + rgb.toString(16).padStart(6, "0");
}

/** Couleur « #rrggbb » → entier ARGB opaque (format de la base Android). */
export function couleurArgb(hex) {
  return 0xff000000 + parseInt(hex.replace("#", ""), 16);
}

export function melanger(liste) {
  const a = liste.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function auHasard(liste) {
  return liste.length ? liste[Math.floor(Math.random() * liste.length)] : null;
}

/** Texte comparé sans accents ni majuscules. */
export function simplifier(s) {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

// ------------------------------------------------------------------ Messages et dialogues

export function toast(message, duree = 3200) {
  const zone = document.getElementById("toasts");
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  zone.appendChild(el);
  requestAnimationFrame(() => el.classList.add("visible"));
  setTimeout(() => {
    el.classList.remove("visible");
    setTimeout(() => el.remove(), 300);
  }, duree);
}

/**
 * Fenêtre modale. [contenu] : HTML ; [boutons] : [{texte, valeur, style}].
 * Renvoie une promesse résolue avec la valeur du bouton (null si fermée).
 */
export function dialogue({ titre = "", contenu = "", boutons = [{ texte: "OK", valeur: true, style: "primaire" }], large = false, apresOuverture }) {
  return new Promise((resoudre) => {
    const fond = document.createElement("div");
    fond.className = "modal-fond";
    fond.innerHTML = `
      <div class="modal${large ? " large" : ""}" role="dialog" aria-modal="true" aria-label="${echapper(titre)}">
        ${titre ? `<h2 class="modal-titre">${echapper(titre)}</h2>` : ""}
        <div class="modal-contenu">${contenu}</div>
        <div class="modal-boutons">
          ${boutons.map((b, i) => `<button class="bouton ${b.style || "discret"}" data-i="${i}">${echapper(b.texte)}</button>`).join("")}
        </div>
      </div>`;
    const fermer = (v) => {
      fond.classList.remove("visible");
      setTimeout(() => fond.remove(), 200);
      document.removeEventListener("keydown", clavier);
      resoudre(v);
    };
    const clavier = (e) => { if (e.key === "Escape") fermer(null); };
    fond.addEventListener("click", (e) => {
      if (e.target === fond) fermer(null);
      const b = e.target.closest("[data-i]");
      if (b && b.parentElement.classList.contains("modal-boutons")) {
        const btn = boutons[Number(b.dataset.i)];
        const v = typeof btn.valeur === "function" ? btn.valeur(fond) : btn.valeur;
        if (v !== undefined) fermer(v);
      }
    });
    document.addEventListener("keydown", clavier);
    document.body.appendChild(fond);
    requestAnimationFrame(() => fond.classList.add("visible"));
    if (apresOuverture) apresOuverture(fond);
  });
}

export function confirmer(titre, message, texteOui = "Oui", danger = false) {
  return dialogue({
    titre,
    contenu: `<p>${echapper(message)}</p>`,
    boutons: [
      { texte: "Annuler", valeur: false },
      { texte: texteOui, valeur: true, style: danger ? "danger" : "primaire" },
    ],
  });
}

// ------------------------------------------------------------------ Fichiers

export function telecharger(blob, nom) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nom;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Ouvre le sélecteur de fichiers ; résout avec le fichier choisi (ou null). */
export function choisirFichier(accept = "") {
  return new Promise((resoudre) => {
    const input = document.createElement("input");
    input.type = "file";
    if (accept) input.accept = accept;
    input.style.display = "none";
    input.addEventListener("change", () => {
      resoudre(input.files && input.files[0] ? input.files[0] : null);
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  });
}

// ------------------------------------------------------------------ Réglages (petites préférences)

export const reglages = {
  lire(cle, defaut) {
    try {
      const v = localStorage.getItem("mcpge." + cle);
      return v === null ? defaut : JSON.parse(v);
    } catch {
      return defaut;
    }
  },
  ecrire(cle, valeur) {
    try {
      localStorage.setItem("mcpge." + cle, JSON.stringify(valeur));
    } catch {
      /* stockage indisponible : le réglage n'est simplement pas gardé */
    }
  },
};
