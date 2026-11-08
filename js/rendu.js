// Affichage des formules avec KaTeX (hors ligne), comme dans l'appli Android.

import { echapper } from "./util.js";

const MACROS = {
  "\\dd": "\\mathrm{d}",
  "\\R": "\\mathbb{R}",
  "\\N": "\\mathbb{N}",
  "\\Z": "\\mathbb{Z}",
  "\\Q": "\\mathbb{Q}",
  "\\C": "\\mathbb{C}",
  "\\K": "\\mathbb{K}",
};

/** Texte seul (« \text{die Umwelt} », définitions, citations) : en HTML pour passer à la ligne. */
const TEXTE_SEUL = /^(\s|=|\\text\{[^{}\\$]*\})+$/;
export const estTexteSeul = (tex) => TEXTE_SEUL.test(String(tex).trim());

export function rendreMath(tex, enBloc = true) {
  if (enBloc && TEXTE_SEUL.test(tex)) {
    const html = echapper(tex).replace(/\\text\{([^{}]*)\}/g, "$1").replace(/\s*=\s*/g, " = ");
    return `<div class="texte-seul">${html}</div>`;
  }
  try {
    return window.katex.renderToString(tex, {
      displayMode: enBloc,
      throwOnError: true,
      strict: "ignore",
      trust: false,
      macros: { ...MACROS },
    });
  } catch (e) {
    const message = String(e && e.message ? e.message : e).replace(/^KaTeX parse error: /, "");
    return `<span class="erreur-latex">⚠ LaTeX à corriger : ${echapper(message)}<code>${echapper(tex)}</code></span>`;
  }
}

/** Texte pouvant contenir des maths : $…$ (dans la ligne) ou $$…$$ (en bloc). */
export function texteRiche(texte) {
  const motif = /\\\$|\$\$([\s\S]+?)\$\$|\$([^$]+?)\$/g;
  let html = "";
  let dernier = 0;
  let m;
  const morceau = (t) => echapper(t).replace(/\n/g, "<br>");
  while ((m = motif.exec(texte)) !== null) {
    html += morceau(texte.slice(dernier, m.index));
    if (m[0] === "\\$") html += "$";
    else if (m[1] !== undefined) html += rendreMath(m[1], true);
    else html += rendreMath(m[2], false);
    dernier = motif.lastIndex;
  }
  return html + morceau(texte.slice(dernier));
}

/** Bloc « titre + texte riche » (Symboles, Hypothèses…) ; rien si le texte est vide. */
export function section(titre, texte) {
  if (!texte || !String(texte).trim()) return "";
  return `<div class="section"><div class="section-titre">${echapper(titre)}</div><div class="section-texte">${texteRiche(String(texte))}</div></div>`;
}

/** Fiche complète d'une formule (détail). */
export function ficheFormule(f) {
  const texte = estTexteSeul(f.latex);
  return `
    <div class="fiche">
      <div class="formule-bloc">${rendreMath(f.latex, true)}</div>
      ${section(texte ? "Précisions" : "Symboles", f.symboles)}
      ${section(texte ? "Dans le plan / contexte" : "Hypothèses / conditions de validité", f.hypotheses)}
      ${section("Unités", f.unites)}
      ${section("Erreurs fréquentes", f.erreursFrequentes)}
      ${section("Exemple", f.exemple)}
      ${f.nature === "A_VERIFIER" ? `<p class="petit avertissement">Fiche importée : à vérifier.</p>` : ""}
    </div>`;
}
