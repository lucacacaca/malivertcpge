// Séance de révision sans fin (transposition de SeanceViewModel + SeanceScreen de l'appli Android).

import { tous, un, executer, transaction } from "./db.js";
import {
  Reponse, LIBELLE_REPONSE, estUnEchec, appliquer, apercu, FileRevision, decouperTrou, questionTrou,
  tousLesLeurres, choisirLeurres, compacter, tirerAn, corrigerAn, VERDICTS, Nombres,
} from "./domaine.js";
import { modelesAn } from "./catalogue.js";
import { rendreMath, texteRiche, section, estTexteSeul } from "./rendu.js";
import { echapper, aujourdhui, dateLisible, delaiLisible, couleurHex, melanger, auHasard, reglages, confirmer, toast } from "./util.js";

const TYPES = ["NOM_VERS_FORMULE", "FORMULE_VERS_NOM", "HYPOTHESES", "TROU", "QCM", "VRAI_FAUX", "ORDRE_GRANDEUR", "AN"];
const CONSIGNES = {
  NOM_VERS_FORMULE: "Écris la formule (sur une feuille ou dans ta tête), puis vérifie.",
  FORMULE_VERS_NOM: "Qu'est-ce que c'est ? Que représente chaque symbole ?",
  HYPOTHESES: "Quelles sont les hypothèses ou conditions de validité ?",
  TROU: "Que faut-il mettre à la place de la case ? Réponds, puis vérifie.",
  QCM: "Touche la bonne formule. Attention aux détails !",
  VRAI_FAUX: "Cette formule est-elle juste ? Regarde bien les signes, exposants, indices…",
  ORDRE_GRANDEUR: "Estime le résultat (sans calculatrice) et touche la bonne valeur.",
  AN: "Fais le calcul et tape ton résultat dans l'unité demandée.",
};
const AUTO = new Set(["QCM", "VRAI_FAUX", "ORDRE_GRANDEUR", "AN"]);
const MAX_HISTORIQUE = 30;

const SQL_FORMULES = `SELECT formules.*, chapitres.matiereId AS matiereId, chapitres.titre AS chapitreTitre,
  matieres.nom AS matiereNom, COALESCE(chapitres.couleur, matieres.couleur) AS couleurCtx
  FROM formules INNER JOIN chapitres ON chapitres.id = formules.chapitreId
  INNER JOIN matieres ON matieres.id = chapitres.matiereId`;

const contient = (s, ...mots) => mots.some((m) => s.toLowerCase().includes(m));
const estLangue = (f) => contient(f.matiereNom, "allemand", "anglais", "langue") || String(f.cleCatalogue || "").startsWith("allemand.");
const estLitteraire = (f) => contient(f.matiereNom, "français", "francais", "philo", "culture");
const estTexte = (f) => estLangue(f) || estLitteraire(f);

function consigne(c) {
  const t = c.carte.type, f = c.ctx;
  if (estLitteraire(f)) {
    return {
      NOM_VERS_FORMULE: "Retrouve la réponse (dis-la ou écris-la), puis vérifie.",
      FORMULE_VERS_NOM: "À quoi cela correspond-il ? (notion, auteur et œuvre, partie du plan…)",
      HYPOTHESES: "Dans quelle partie du plan l'utiliser, et pour montrer quoi ?",
      QCM: "Touche la bonne réponse.",
    }[t] || CONSIGNES[t];
  }
  if (!estLangue(f)) return CONSIGNES[t];
  return {
    NOM_VERS_FORMULE: "Traduis en allemand (dis-le ou écris-le), puis vérifie.",
    FORMULE_VERS_NOM: "Que veut dire ce mot ou cette expression ?",
    TROU: "Complète la case (verbe : 3e pers. du présent – prétérit – participe II).",
    QCM: "Touche la bonne traduction.",
  }[t] || CONSIGNES[t];
}

/**
 * Lance une séance dans [racine]. options : {chapitres: [ids], favoris, objectif, titre}.
 * [onFermer] est appelé quand on quitte.
 */
export async function lancerSeance(racine, options, onFermer) {
  const S = {
    jour: aujourdhui(),
    titre: "Révision", sousTitre: "", jourObjectif: null,
    cartes: new Map(), ctx: new Map(), reservoir: [], modeles: new Map(),
    file: null, c: null, reponseVisible: false, attente: false,
    qcm: null, an: null, vf: null, og: null,
    message: "", nbReponses: 0, nbReussies: 0, ratees: new Set(),
    historique: [], precedente: null, reculs: 0, terminee: false,
    avecAn: reglages.lire("avecAn", true), menu: false,
  };

  racine.innerHTML = `<div class="seance"><div class="seance-chargement">Préparation des cartes…</div></div>`;

  // ---------------------------------------------------------------- Chargement
  const visibles = tous(`${SQL_FORMULES} WHERE chapitres.masque = 0 AND matieres.masquee = 0 AND formules.horsRevision = 0`);
  let formules;
  let ids = options.chapitres || [];
  if (options.objectif) {
    const o = un("SELECT * FROM objectifs WHERE id = ?", [options.objectif]);
    if (o) {
      ids = String(o.chapitres).split(",").map((x) => Number(x.trim())).filter(Boolean);
      S.jourObjectif = o.jour;
      S.titre = o.titre;
      S.sousTitre = `Mode DS / colle : ${dateLisible(o.jour)} (${delaiLisible(o.jour)})`;
    }
  }
  if (options.favoris && !options.objectif) {
    formules = visibles.filter((f) => f.favori);
    S.titre = "Mes favoris";
    S.sousTitre = "Formules marquées d'une étoile";
  } else if (!ids.length) {
    formules = visibles;
    if (!options.objectif) { S.titre = "Révision libre"; S.sousTitre = "Toutes les matières"; }
  } else {
    formules = tous(`${SQL_FORMULES} WHERE formules.chapitreId IN (${ids.map(() => "?").join(",")}) AND formules.horsRevision = 0`, ids);
    if (!options.objectif) { S.titre = options.titre || "Séance ciblée"; S.sousTitre = `${ids.length} chapitre(s)`; }
  }
  formules.forEach((f) => S.ctx.set(f.id, f));
  const vus = new Set();
  S.reservoir = [...visibles, ...formules].filter((f) => !vus.has(f.id) && vus.add(f.id));
  S.modeles = await modelesAn();

  // Types de cartes possibles pour chaque formule ; création des cartes manquantes.
  const leurresCache = new Map();
  const leurresDe = (f) => {
    if (!leurresCache.has(f.id)) leurresCache.set(f.id, leurresQcm(f));
    return leurresCache.get(f.id);
  };
  function possible(type, f) {
    switch (type) {
      case "NOM_VERS_FORMULE": case "FORMULE_VERS_NOM": return true;
      case "HYPOTHESES": return !!String(f.hypotheses || "").trim();
      case "TROU": return decouperTrou(f.latex) !== null;
      case "QCM": return leurresDe(f).length >= 3;
      case "VRAI_FAUX": return !estTexte(f) && tousLesLeurres(f.latex).length > 0;
      default: return !!(f.cleCatalogue && (S.modeles.get(f.cleCatalogue) || []).length);
    }
  }
  function leurresQcm(f) {
    const bonne = f.latex.trim();
    const proches = estTexte(f) ? [] : choisirLeurres(bonne, 3).map((l) => [l.latex, l.piege]);
    if (proches.length >= 3) return proches;
    const deja = new Set([...proches.map((p) => compacter(p[0])), compacter(bonne)]);
    const autres = (liste) => melanger([...new Set(liste.map((x) => x.latex.trim()).filter((l) => !deja.has(compacter(l))))]);
    const memeCh = autres(S.reservoir.filter((x) => x.chapitreId === f.chapitreId));
    const memeM = autres(S.reservoir.filter((x) => x.matiereId === f.matiereId && x.chapitreId !== f.chapitreId)).filter((l) => !memeCh.includes(l));
    const piege = estLangue(f) ? "autre mot" : estTexte(f) ? "autre réponse" : "autre formule";
    return [...proches, ...[...memeCh, ...memeM].slice(0, 3 - proches.length).map((l) => [l, piege])];
  }
  S.leurresFrais = leurresQcm;

  const parFormule = new Map();
  for (const f of formules) parFormule.set(f.id, TYPES.filter((t) => possible(t, f)));
  const listeIds = formules.map((f) => f.id);
  if (listeIds.length) {
    transaction(() => { for (const f of formules) {
      for (const t of parFormule.get(f.id)) {
        executer("INSERT OR IGNORE INTO cartes (formuleId, type, boite, prochaine, nbRevisions, nbEchecs, echecsConsecutifs, derniere) VALUES (?, ?, 0, NULL, 0, 0, 0, NULL)", [f.id, t]);
      }
    } });
    for (let i = 0; i < listeIds.length; i += 500) {
      const paquet = listeIds.slice(i, i + 500);
      for (const c of tous(`SELECT * FROM cartes WHERE formuleId IN (${paquet.map(() => "?").join(",")})`, paquet)) {
        if ((parFormule.get(c.formuleId) || []).includes(c.type)) S.cartes.set(c.id, c);
      }
    }
  }
  demarrer([...S.cartes.values()]);

  // ---------------------------------------------------------------- Logique

  function retenues(liste) {
    return S.avecAn ? liste : liste.filter((c) => c.type !== "AN" && c.type !== "ORDRE_GRANDEUR");
  }
  function etat(c) {
    return { boite: c.boite, prochaine: c.prochaine, nbRevisions: c.nbRevisions, nbEchecs: c.nbEchecs, echecsConsecutifs: c.echecsConsecutifs };
  }

  function demarrer(liste) {
    const l = retenues(liste);
    S.file = new FileRevision(l.map((c) => ({ id: c.id, groupe: c.formuleId, etat: etat(c) })), S.jour);
    S.vide = l.length === 0;
    S.nbReponses = 0; S.nbReussies = 0; S.ratees.clear(); S.message = ""; S.terminee = false;
    passer();
  }
  function reconstruire() {
    const l = retenues([...S.cartes.values()].filter((c) => S.ctx.has(c.formuleId)));
    S.file = new FileRevision(l.map((c) => ({ id: c.id, groupe: c.formuleId, etat: etat(c) })), S.jour);
    S.vide = l.length === 0;
    passer();
  }

  function passer() {
    if (S.c && (!S.historique.length || S.historique[S.historique.length - 1].carte.id !== S.c.carte.id)) {
      S.historique.push(S.c);
      if (S.historique.length > MAX_HISTORIQUE) S.historique.shift();
    }
    S.precedente = null; S.reculs = 0;
    const e = S.file ? S.file.suivante() : null;
    const carte = e ? S.cartes.get(e.id) : null;
    const ctx = carte ? S.ctx.get(carte.formuleId) : null;
    S.c = carte && ctx ? { carte, ctx } : null;
    S.reponseVisible = false; S.attente = false;
    S.qcm = null; S.an = null; S.vf = null; S.og = null;
    const c = S.c;
    if (!c) return;
    const f = c.ctx;
    if (c.carte.type === "QCM") {
      const bonne = f.latex.trim();
      const melange = melanger([...S.leurresFrais(f), [bonne, ""]]);
      S.qcm = { options: melange.map((m) => m[0]), bonne: melange.findIndex((m) => m[0] === bonne && m[1] === ""), pieges: melange.map((m) => m[1]), choisi: -1 };
    } else if (c.carte.type === "VRAI_FAUX") {
      const l = choisirLeurres(f.latex, 1)[0];
      S.vf = !l || Math.random() < 0.5 ? { latex: f.latex, juste: true, piege: null, choix: null } : { latex: l.latex, juste: false, piege: l.piege, choix: null };
    } else if (c.carte.type === "AN") {
      const m = auHasard(S.modeles.get(f.cleCatalogue) || []);
      if (m) S.an = { tiree: tirerAn(m), saisie: "", erreur: "", donne: null, verdict: null };
    } else if (c.carte.type === "ORDRE_GRANDEUR") {
      const m = auHasard(S.modeles.get(f.cleCatalogue) || []);
      const t = m ? tirerAn(m) : null;
      const r = t ? t.resultat : null;
      if (t && Number.isFinite(r) && r !== 0) {
        S.og = t;
        const unite = t.modele.unite ? `\\,${t.modele.unite}` : "";
        const facteurs = melanger([[1, ""], [10, "10 fois trop grand"], [0.1, "10 fois trop petit"], auHasard([[100, "100 fois trop grand"], [0.01, "100 fois trop petit"]])]);
        S.qcm = { options: facteurs.map(([k]) => Nombres.latex(r * k) + unite), bonne: facteurs.findIndex(([k]) => k === 1), pieges: facteurs.map((x) => x[1]), choisi: -1 };
      }
    }
  }

  function repondre(reponse, rester = reponse === Reponse.NE_SAIT_PAS) {
    const c = S.c;
    if (!c) return;
    const carte = S.cartes.get(c.carte.id) || c.carte;
    const res = appliquer(etat(carte), reponse, S.jour, S.jourObjectif);
    const maintenant = Date.now();
    const nouvelle = { ...carte, ...res.etat, derniere: maintenant };
    S.cartes.set(nouvelle.id, nouvelle);
    S.file.enregistrer(nouvelle.id, res.etat, estUnEchec(reponse));
    S.nbReponses++;
    if (estUnEchec(reponse)) S.ratees.add(nouvelle.id); else S.nbReussies++;
    S.message = `« ${c.ctx.intitule} » : ${res.explication}`;
    executer("UPDATE cartes SET boite = ?, prochaine = ?, nbRevisions = ?, nbEchecs = ?, echecsConsecutifs = ?, derniere = ? WHERE id = ?",
      [nouvelle.boite, nouvelle.prochaine, nouvelle.nbRevisions, nouvelle.nbEchecs, nouvelle.echecsConsecutifs, maintenant, nouvelle.id]);
    executer("INSERT INTO revisions (carteId, instant, reponse, boiteAvant, boiteApres, enAvance, modeObjectif) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [nouvelle.id, maintenant, reponse, carte.boite, nouvelle.boite, res.enAvance ? 1 : 0, S.jourObjectif !== null ? 1 : 0]);
    mettreAJourStatut(nouvelle.formuleId, reponse, nouvelle);
    if (rester) {
      S.c = { ...c, carte: nouvelle };
      S.reponseVisible = true;
      S.attente = true;
    } else {
      passer();
    }
  }

  function mettreAJourStatut(formuleId, reponse, carte) {
    const f = un("SELECT statut FROM formules WHERE id = ?", [formuleId]);
    if (!f) return;
    let nouveau = f.statut;
    if (estUnEchec(reponse) && carte.echecsConsecutifs >= 2) nouveau = "PRIORITAIRE";
    else if (estUnEchec(reponse)) nouveau = f.statut === "PRIORITAIRE" ? "PRIORITAIRE" : "A_REVOIR";
    else if (tous("SELECT boite FROM cartes WHERE formuleId = ?", [formuleId]).every((x) => x.boite >= 4)) nouveau = "MAITRISEE";
    if (nouveau !== f.statut) executer("UPDATE formules SET statut = ? WHERE id = ?", [nouveau, formuleId]);
  }

  // ---------------------------------------------------------------- Affichage

  function enTete() {
    const encore = S.precedente && S.reculs + 1 < S.historique.length;
    return `
      <header class="seance-haut">
        <button class="icone" data-a="fermer" aria-label="Fermer la séance">✕</button>
        <div class="seance-titre">
          <div class="t">${echapper(S.titre)}</div>
          <div class="st">${echapper(S.sousTitre)}${S.nbReponses ? ` · ${S.nbReponses} réponse(s)` : ""}</div>
        </div>
        ${!S.terminee && !S.precedente && S.historique.length ? `<button class="bouton discret petit" data-a="precedente" title="Revoir la carte d'avant">↶ Précédente</button>` : ""}
        ${S.precedente ? `<button class="bouton discret petit" data-a="precedente" ${encore ? "" : "disabled"}>↶ Encore avant</button>` : ""}
        ${S.c && !S.terminee && !S.precedente ? `<button class="icone etoile${S.c.ctx.favori ? " active" : ""}" data-a="favori" aria-label="Favori">★</button>` : ""}
        ${!S.terminee ? `<div class="menu-zone"><button class="icone" data-a="menu" aria-label="Menu">⋮</button>${S.menu ? menu() : ""}</div>` : ""}
      </header>`;
  }
  function menu() {
    return `<div class="menu">
      <button data-a="an">${S.avecAn ? "✓ " : ""}Applications numériques</button>
      ${S.c ? `<button data-a="masquer">Ne plus réviser cette formule</button>` : ""}
      <button data-a="terminer">Terminer la séance</button>
    </div>`;
  }

  function carteHtml(c, visible, msg) {
    const f = c.ctx, t = c.carte.type, texte = estTexteSeul(f.latex);
    const sym = texte ? "Précisions" : "Symboles";
    const hyp = texte ? "Dans le plan / contexte" : "Hypothèses / conditions";
    let q = "", r = "", sections = "";
    const titre = (s) => `<div class="q-titre">${echapper(s)}</div>`;
    const formule = (tex) => `<div class="formule-bloc">${rendreMath(tex, true)}</div>`;
    switch (t) {
      case "NOM_VERS_FORMULE":
        q = titre(f.intitule); r = formule(f.latex); sections = section(sym, f.symboles) + section(hyp, f.hypotheses); break;
      case "FORMULE_VERS_NOM":
        q = formule(f.latex); r = titre(f.intitule); sections = section(sym, f.symboles) + section(hyp, f.hypotheses) + section("Unités", f.unites); break;
      case "HYPOTHESES":
        q = titre(f.intitule) + formule(f.latex); sections = section(hyp, f.hypotheses); break;
      case "TROU": {
        const tr = decouperTrou(f.latex);
        q = titre(f.intitule) + formule(tr ? questionTrou(tr) : f.latex); r = formule(f.latex); sections = section(sym, f.symboles); break;
      }
      case "QCM":
        q = titre(f.intitule); sections = section(sym, f.symboles) + section(hyp, f.hypotheses); break;
      case "VRAI_FAUX": {
        q = titre(f.intitule) + formule(S.vf ? S.vf.latex : f.latex);
        if (S.vf && visible) {
          const verdict = S.vf.juste ? "La formule affichée était JUSTE." : `La formule affichée était FAUSSE (piège : ${S.vf.piege}).`;
          const ta = S.vf.choix === null ? "" : (S.vf.choix === S.vf.juste ? " Bonne réponse !" : " Ce n'était pas ta réponse.");
          r = `<div class="verdict ${S.vf.choix === S.vf.juste ? "ok" : "ko"}">${echapper(verdict + ta)}</div>` + (S.vf.juste ? "" : `<div class="petit muet">La bonne formule :</div>${formule(f.latex)}`);
        }
        sections = section(sym, f.symboles); break;
      }
      case "ORDRE_GRANDEUR":
        if (S.og) {
          const m = S.og.modele;
          q = titre(f.intitule) + `<div class="enonce">${texteRiche(S.og.enonce + `\n\nQuel est l'ordre de grandeur de $${m.symbole}$ ?`)}</div>`;
          r = formule(f.latex);
          sections = section("Résultat exact", `$${m.symbole} = ${Nombres.latex(S.og.resultat)}${m.unite ? "\\," + m.unite : ""}$`) + section(sym, f.symboles);
        }
        break;
      case "AN":
        if (S.an) {
          const m = S.an.tiree.modele, u = m.unite ? `\\,${m.unite}` : "";
          q = titre(f.intitule) + `<div class="enonce">${texteRiche(S.an.tiree.enonce + `\n\nRéponds : $${m.symbole} = \\;?$` + (m.unite ? ` en $${m.unite}$.` : " (sans unité)."))}</div>`;
          r = formule(f.latex);
          let ta = "";
          if (S.an.donne !== null) {
            const ecart = S.an.tiree.resultat === 0 ? 0 : 100 * Math.abs(S.an.donne - S.an.tiree.resultat) / Math.abs(S.an.tiree.resultat);
            ta = `\nTa réponse : $${Nombres.latex(S.an.donne)}${u}$ (écart : $${Nombres.latex(ecart, 2)}\\,\\%$) → ${VERDICTS[S.an.verdict].libelle}`;
          }
          sections = section("Résultat", `$${m.symbole} = ${Nombres.latex(S.an.tiree.resultat)}${u}$` + ta) + section(sym, f.symboles);
        }
        break;
    }
    if (estTexte(f)) sections += section("Exemple", f.exemple);
    sections += section("Erreurs fréquentes", f.erreursFrequentes);

    let options = "";
    if (S.qcm && (t === "QCM" || t === "ORDRE_GRANDEUR") && c === S.c) {
      options = `<div class="qcm">${S.qcm.options.map((o, i) => {
        let cl = "option";
        if (S.qcm.choisi !== -1) {
          if (i === S.qcm.bonne) cl += " bonne";
          else if (i === S.qcm.choisi) cl += " fausse";
        }
        const piege = S.qcm.choisi !== -1 && i !== S.qcm.bonne && S.qcm.pieges[i] ? `<div class="piege">Piège : ${echapper(S.qcm.pieges[i])}</div>` : "";
        return `<button class="${cl}" data-qcm="${i}" ${S.qcm.choisi !== -1 ? "disabled" : ""}>${rendreMath(o, t === "QCM")}${piege}</button>`;
      }).join("")}</div>`;
    }
    const couleur = couleurHex(f.couleurCtx);
    return `
      <article class="carte" style="--accent:${couleur}">
        ${msg ? `<div class="bandeau-info">${echapper(msg)}</div>` : ""}
        <div class="carte-entete"><span class="pastille" style="background:${couleur}"></span>${echapper(f.matiereNom)} · ${echapper(f.chapitreTitre)}</div>
        <div class="consigne">${echapper(consigne(c))}</div>
        <div class="question">${q}</div>
        ${options}
        ${visible && (r || sections) ? `<div class="reponse"><div class="reponse-titre">Réponse</div>${r}${sections}</div>` : ""}
      </article>`;
  }

  function actions() {
    const c = S.c;
    const t = c.carte.type;
    if (S.attente) {
      return `<div class="actions"><div class="message-reponse">${echapper(S.message)}</div><button class="bouton primaire large" data-a="suivant">Suivant ▶</button></div>`;
    }
    if (t === "VRAI_FAUX") {
      return `<div class="actions deux"><button class="bouton rep-rate" data-a="vf-faux">✗ Fausse</button><button class="bouton rep-bien" data-a="vf-juste">✓ Juste</button></div>`;
    }
    if (t === "AN" && S.an) {
      return `<div class="actions">
        <form class="saisie-an" data-a="an-form">
          <input inputmode="decimal" autocomplete="off" placeholder="Ex. 4,7 ou 4,7e-3" value="${echapper(S.an.saisie)}" aria-label="Ta réponse">
          <button class="bouton primaire" type="submit">Valider</button>
        </form>
        ${S.an.erreur ? `<div class="erreur">${echapper(S.an.erreur)}</div>` : ""}
        <button class="bouton discret" data-a="nsp">Je ne sais pas</button></div>`;
    }
    if (AUTO.has(t)) {
      return `<div class="actions"><button class="bouton discret" data-a="nsp">Je ne sais pas</button></div>`;
    }
    if (!S.reponseVisible) {
      return `<div class="actions deux"><button class="bouton discret" data-a="nsp">Je ne sais pas</button><button class="bouton primaire" data-a="voir">Afficher la réponse <kbd>Espace</kbd></button></div>`;
    }
    const e = etat(S.cartes.get(c.carte.id) || c.carte);
    const b = (rep, cl, k) => `<button class="bouton ${cl}" data-rep="${rep}"><span>${LIBELLE_REPONSE[rep]}</span><small>${apercu(e, rep, S.jour, S.jourObjectif)} <kbd>${k}</kbd></small></button>`;
    return `<div class="actions quatre">${b("RATE", "rep-rate", 1)}${b("DIFFICILE", "rep-difficile", 2)}${b("BIEN", "rep-bien", 3)}${b("FACILE", "rep-facile", 4)}</div>`;
  }

  function bilan() {
    const pct = S.nbReponses ? Math.round((100 * S.nbReussies) / S.nbReponses) : 0;
    const ratees = [...new Set([...S.ratees].map((id) => S.cartes.get(id)).filter(Boolean).map((c) => S.ctx.get(c.formuleId)?.intitule).filter(Boolean))];
    return `<div class="bilan">
      <h2>Séance terminée</h2>
      <div class="chiffres"><div><b>${S.nbReponses}</b><span>réponses</span></div><div><b>${pct} %</b><span>réussies</span></div><div><b>${S.ratees.size}</b><span>ratées</span></div></div>
      ${ratees.length ? `<h3>À retravailler</h3><ul class="liste-simple">${ratees.map((t) => `<li>${echapper(t)}</li>`).join("")}</ul>` : `<p class="muet">Aucune carte ratée, bravo !</p>`}
      <div class="pile-boutons">
        ${S.ratees.size ? `<button class="bouton primaire" data-a="revoir-ratees">Revoir les cartes ratées</button>` : ""}
        <button class="bouton" data-a="continuer">Continuer la séance</button>
        <button class="bouton discret" data-a="fermer">Fermer</button>
      </div></div>`;
  }

  function afficher() {
    let corps;
    if (S.terminee) corps = bilan();
    else if (S.vide || !S.c) {
      corps = `<div class="vide"><h2>Aucune carte</h2><p class="muet">Ajoute des chapitres et des formules dans « Matières », ou choisis d'autres chapitres.</p><button class="bouton primaire" data-a="fermer">Retour</button></div>`;
    } else if (S.precedente) {
      const p = S.precedente;
      const fiche = { ...p, carte: { ...p.carte, type: "NOM_VERS_FORMULE" } };
      corps = `<div class="zone-carte">${carteHtml(fiche, true, "↶ Carte précédente (déjà notée : rien n'est changé)")}</div>
        <div class="actions"><button class="bouton primaire large" data-a="reprendre">Reprendre ▶</button></div>`;
    } else {
      corps = `<div class="zone-carte">${carteHtml(S.c, S.reponseVisible, "")}</div>${actions()}`;
    }
    racine.innerHTML = `<div class="seance">${enTete()}${corps}</div>`;
    const champ = racine.querySelector(".saisie-an input");
    if (champ && !matchMedia("(pointer: coarse)").matches) champ.focus();
    racine.querySelector(".zone-carte")?.scrollTo(0, 0);
  }

  // ---------------------------------------------------------------- Interactions

  async function action(a) {
    switch (a) {
      case "fermer": nettoyer(); onFermer(); return;
      case "menu": S.menu = !S.menu; break;
      case "an":
        S.menu = false; S.avecAn = !S.avecAn; reglages.ecrire("avecAn", S.avecAn);
        toast(S.avecAn ? "Applications numériques activées" : "Applications numériques désactivées");
        reconstruire(); break;
      case "masquer": {
        S.menu = false;
        const c = S.c;
        if (!c) break;
        afficher();
        if (await confirmer("Ne plus réviser cette formule ?", `« ${c.ctx.intitule} » ne sera plus proposée en révision. Tu pourras la remettre depuis sa fiche (Matières).`, "Ne plus réviser")) {
          executer("UPDATE formules SET horsRevision = 1 WHERE id = ?", [c.ctx.id]);
          S.ctx.delete(c.ctx.id);
          toast(`« ${c.ctx.intitule} » ne sera plus proposée.`);
          reconstruire();
        }
        break;
      }
      case "terminer": S.menu = false; S.terminee = true; break;
      case "favori": {
        const f = S.c.ctx;
        f.favori = f.favori ? 0 : 1;
        executer("UPDATE formules SET favori = ? WHERE id = ?", [f.favori, f.id]);
        toast(f.favori ? "Ajoutée aux favoris ★" : "Retirée des favoris");
        break;
      }
      case "precedente": {
        const k = S.precedente ? S.reculs + 1 : 0;
        if (k < S.historique.length) { S.reculs = k; S.precedente = S.historique[S.historique.length - 1 - k]; }
        break;
      }
      case "reprendre": S.precedente = null; S.reculs = 0; break;
      case "voir": S.reponseVisible = true; break;
      case "nsp":
        if (S.qcm && S.qcm.choisi === -1) S.qcm.choisi = -2; // montre la bonne réponse
        repondre(Reponse.NE_SAIT_PAS, true);
        break;
      case "suivant": passer(); break;
      case "vf-juste": case "vf-faux": {
        const juste = a === "vf-juste";
        S.vf.choix = juste;
        repondre(juste === S.vf.juste ? Reponse.BIEN : Reponse.RATE, true);
        break;
      }
      case "revoir-ratees": {
        const l = [...S.ratees].map((id) => S.cartes.get(id)).filter(Boolean);
        S.titre = "Cartes ratées"; S.c = null; S.historique = [];
        demarrer(l);
        break;
      }
      case "continuer": S.terminee = false; break;
    }
    afficher();
  }

  function surClic(e) {
    const q = e.target.closest("[data-qcm]");
    if (q && S.qcm && S.qcm.choisi === -1) {
      const i = Number(q.dataset.qcm);
      S.qcm.choisi = i;
      repondre(i === S.qcm.bonne ? Reponse.BIEN : Reponse.RATE, true);
      afficher();
      return;
    }
    const r = e.target.closest("[data-rep]");
    if (r) { repondre(r.dataset.rep, false); afficher(); return; }
    const b = e.target.closest("[data-a]");
    if (b && b.tagName !== "FORM") { action(b.dataset.a); return; }
    if (S.menu && !e.target.closest(".menu-zone")) { S.menu = false; afficher(); }
  }
  function surEnvoi(e) {
    const form = e.target.closest("[data-a='an-form']");
    if (!form) return;
    e.preventDefault();
    const saisie = form.querySelector("input").value;
    S.an.saisie = saisie;
    const donne = Nombres.lire(saisie);
    if (donne === null) {
      S.an.erreur = "Nombre non reconnu. Exemples : 4,7 · 4,7e-3 · 4,7×10^-3";
    } else {
      S.an.donne = donne;
      S.an.verdict = corrigerAn(S.an.tiree.resultat, donne, S.an.tiree.modele.tolerance ?? 0.03);
      repondre(VERDICTS[S.an.verdict].reponse, true);
    }
    afficher();
  }
  function surClavier(e) {
    if (e.target.tagName === "INPUT" || S.terminee || !S.c || S.precedente) return;
    if (e.key === " " && !S.reponseVisible && !AUTO.has(S.c.carte.type)) { e.preventDefault(); action("voir"); }
    else if (e.key === "Enter" && S.attente) { e.preventDefault(); action("suivant"); }
    else if (S.reponseVisible && !S.attente && ["1", "2", "3", "4"].includes(e.key)) {
      repondre(["RATE", "DIFFICILE", "BIEN", "FACILE"][Number(e.key) - 1], false);
      afficher();
    }
  }
  function nettoyer() {
    racine.removeEventListener("click", surClic);
    racine.removeEventListener("submit", surEnvoi);
    document.removeEventListener("keydown", surClavier);
  }
  racine.addEventListener("click", surClic);
  racine.addEventListener("submit", surEnvoi);
  document.addEventListener("keydown", surClavier);
  afficher();
  return nettoyer;
}
