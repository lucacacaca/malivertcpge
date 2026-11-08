// Démarrage de l'appli et navigation (adresses du type #/matiere/3).

import { ouvrir, surChangement } from "./db.js";
import { lancerSeance } from "./seance.js";
import { lancerVisite } from "./tuto.js";
import { vueEdt } from "./edt.js";
import { vueExercice, vueTdMatiere, vueTaches, vueTipe } from "./w3.js";
import { vueClasse } from "./classe.js";
import { vuePlanning, vueEvenement, vueDetail, vueResultats, rappelOuverture } from "./planning.js";
import {
  vueAccueil, vueMatieres, vueMatiere, vueChapitre, vueReviser, vuePlus, vueSauvegarde, vuePartage,
  vueAide, vueInstaller, vueAssistant,
} from "./vues.js";
import { reglages, toast } from "./util.js";

const contenu = document.getElementById("contenu");
const zoneSeance = document.getElementById("seance");
let invitationInstall = null;
let finSeance = null;

const estInstallee = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

const nav = {
  aller(h) { if (location.hash === h) route(); else location.hash = h; },
  rafraichir() { route(true); },
  visite() { lancerVisite(); },
  estInstallee,
  invite: () => !!invitationInstall,
  peutInstaller: () => !estInstallee() && !reglages.lire("encartInstallFerme", false),
  async installer() {
    if (!invitationInstall) return;
    invitationInstall.prompt();
    const r = await invitationInstall.userChoice;
    if (r.outcome === "accepted") toast("Appli installée ✓");
    invitationInstall = null;
    route(true);
  },
};

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  invitationInstall = e;
});

function marquerOnglet(nom) {
  document.querySelectorAll("[data-onglet]").forEach((b) => b.classList.toggle("actif", b.dataset.onglet === nom));
}

async function route(garderDefilement = false) {
  const h = location.hash || "#/accueil";
  const [chemin, requete] = h.slice(1).split("?");
  const morceaux = chemin.split("/").filter(Boolean);
  const params = new URLSearchParams(requete || "");
  const y = window.scrollY;

  // Séance : plein écran, sans la navigation.
  if (morceaux[0] === "seance") {
    document.body.classList.add("en-seance");
    zoneSeance.hidden = false;
    if (finSeance) finSeance();
    const opts = {
      chapitres: (params.get("c") || "").split(",").map(Number).filter(Boolean),
      favoris: params.get("f") === "1",
      objectif: Number(params.get("o")) || null,
      titre: params.get("t") || null,
    };
    try {
      finSeance = await lancerSeance(zoneSeance, opts, () => {
        finSeance = null;
        history.length > 1 ? history.back() : nav.aller("#/accueil");
      });
    } catch (e) {
      console.error(e);
      zoneSeance.innerHTML = `<div class="encart" style="margin:24px"><div><b>Oups, la séance n'a pas pu démarrer</b><p class="petit">${String(e.message || e)}</p><button class="bouton" onclick="location.hash='#/accueil'">Retour à l'accueil</button></div></div>`;
    }
    return;
  }
  if (finSeance) { finSeance(); finSeance = null; }
  document.body.classList.remove("en-seance");
  zoneSeance.hidden = true;
  zoneSeance.innerHTML = "";

  if (!reglages.lire("assistantFait", false) && morceaux[0] !== "assistant") {
    location.replace("#/assistant");
    return;
  }
  document.body.classList.toggle("sans-nav", morceaux[0] === "assistant");
  // Chaque page s'affiche dans un bloc neuf (les écouteurs de la page précédente disparaissent avec).
  contenu.onclick = null;
  const vue = document.createElement("div");
  vue.className = "vue";
  contenu.replaceChildren(vue);
  const onglets = { accueil: "accueil", matieres: "matieres", matiere: "matieres", chapitre: "matieres", exercice: "matieres", td: "matieres", taches: "plus", tipe: "plus", reviser: "reviser", planning: "planning", resultats: "planning", evenement: "planning", epreuve: "planning", edt: "planning", classe: "plus", plus: "plus", sauvegarde: "plus", partage: "plus", aide: "plus", installer: "plus" };
  marquerOnglet(onglets[morceaux[0]] || "accueil");
  try {
    switch (morceaux[0]) {
      case "assistant": await vueAssistant(vue, nav); break;
      case "matieres": vueMatieres(vue, nav); break;
      case "matiere": await vueMatiere(vue, Number(morceaux[1]), nav); break;
      case "chapitre": vueChapitre(vue, Number(morceaux[1]), nav, params); break;
      case "exercice": vueExercice(vue, Number(morceaux[1]), nav); break;
      case "td": vueTdMatiere(vue, Number(morceaux[1])); break;
      case "taches": vueTaches(vue, nav); break;
      case "tipe": vueTipe(vue, nav); break;
      case "reviser": vueReviser(vue, nav); break;
      case "plus": vuePlus(vue, nav); break;
      case "sauvegarde": vueSauvegarde(vue, nav); break;
      case "partage": await vuePartage(vue, nav); break;
      case "aide": vueAide(vue, nav); break;
      case "installer": vueInstaller(vue, nav); break;
      case "planning": vuePlanning(vue, nav, params); break;
      case "evenement": vueEvenement(vue, Number(morceaux[1]) || 0, nav); break;
      case "epreuve": vueDetail(vue, Number(morceaux[1]) || 0, nav, params); break;
      case "resultats": vueResultats(vue, nav, params); break;
      case "edt": vueEdt(vue, nav, params); break;
      case "classe": await vueClasse(vue, nav); break;
      default: vueAccueil(vue, nav);
    }
  } catch (e) {
    console.error(e);
    contenu.innerHTML = `<div class="encart"><div><b>Oups, une erreur</b><p class="petit">${String(e.message || e)}</p><button class="bouton" onclick="location.hash='#/accueil';location.reload()">Recharger</button></div></div>`;
  }
  window.scrollTo(0, garderDefilement ? y : 0);
}

// Liens internes déclarés avec data-nav (boutons).
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-nav]");
  if (b && !b.disabled) {
    e.preventDefault();
    nav.aller(b.dataset.nav);
  }
});

async function demarrer() {
  try {
    await ouvrir();
  } catch (e) {
    console.error(e);
    contenu.innerHTML = `<div class="encart"><div><b>Impossible d'ouvrir les données</b><p class="petit">${String(e.message || e)}</p><p class="petit">Essaie de recharger la page. En navigation privée, le stockage peut être bloqué.</p></div></div>`;
    return;
  }
  // Demande au navigateur de ne pas effacer les données (surtout utile sur iPhone).
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  surChangement(() => route(true));
  window.addEventListener("hashchange", () => route());
  document.getElementById("chargement").remove();
  await route();
  // Rappel des colles / DS proches (une fois par jour), sauf pendant l'assistant ou une séance.
  if (reglages.lire("assistantFait", false) && !/^#\/(seance|assistant)/.test(location.hash)) rappelOuverture(nav).catch(console.error);
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").then((reg) => {
      reg.addEventListener("updatefound", () => {
        const w = reg.installing;
        w && w.addEventListener("statechange", () => {
          if (w.state === "installed" && navigator.serviceWorker.controller) {
            toast("Nouvelle version disponible : elle sera utilisée à la prochaine ouverture.", 5000);
          }
        });
      });
    }).catch(() => {});
  });
}

demarrer();
