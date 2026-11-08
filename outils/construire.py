#!/usr/bin/env python3
"""Prépare l'appli avant publication (à relancer après chaque modification) :
 - data/index.json : liste des fichiers du catalogue et des fiches partagées ;
 - sw.js : liste des fichiers à garder hors ligne + numéro de version (empreinte du contenu).
Usage : python3 outils/construire.py   (depuis la racine du dépôt)
"""
import hashlib, json, os

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(RACINE)

PARTAGE = [
    {"fichier": "francais_arcanes_creation.json", "titre": "Les arcanes de la création",
     "matiere": "Français-philosophie", "description": "définitions, plan, citations de Platon, Zola et Woolf, exemples",
     "source": "Fiches partagées : Les arcanes de la création"},
    {"fichier": "fiches_physique_pcsi.json", "titre": "Physique PCSI + incertitudes en TP",
     "matiere": "Physique", "description": "incertitudes (type A/B, propagation, z-score) et compléments PCSI",
     "source": "Fiches partagées : physique PCSI"},
    {"fichier": "fiches_sii_pcsi.json", "titre": "SII PCSI : asservissements et cinématique",
     "matiere": "Sciences industrielles (SII)", "description": "1er et 2e ordre, Bode, stabilité, cinématique",
     "source": "Fiches partagées : SII PCSI"},
    {"fichier": "fiches_maths_pcsi.json", "titre": "Maths PCSI : algèbre linéaire, intégration, DL",
     "matiere": "Mathématiques", "description": "espaces vectoriels, applications linéaires, bases, Taylor, DL",
     "source": "Fiches partagées : maths PCSI"},
]

cat = sorted(os.listdir("data/catalogue"))
index = {
    "formules": [f for f in cat if f.startswith("formules_") and f.endswith(".json")],
    "an": [f for f in cat if f.startswith("an_") and f.endswith(".json")],
    "partage": [p for p in PARTAGE if os.path.exists("data/partage/" + p["fichier"])],
}
with open("data/index.json", "w", encoding="utf-8") as f:
    json.dump(index, f, ensure_ascii=False, indent=1)

# Classes (colloscope + emploi du temps) : data/classes/*.json → data/classes/index.json
classes = []
for n in sorted(os.listdir("data/classes")):
    if n.endswith(".json") and n != "index.json":
        with open("data/classes/" + n, encoding="utf-8") as fh:
            c = json.load(fh)
        classes.append({"id": c["id"], "nom": c["nom"], "annee": c.get("annee", ""), "filiere": c.get("filiere", ""),
                        "description": c.get("description", ""), "fichier": n, "version": c.get("version", 1),
                        "groupesDisponibles": sorted(c.get("colles", {}).keys(), key=lambda g: (len(g), g))})
with open("data/classes/index.json", "w", encoding="utf-8") as f:
    json.dump({"classes": classes}, f, ensure_ascii=False, indent=1)

fichiers = ["./", "index.html", "styles.css", "manifest.webmanifest"]
for dossier in ["js", "vendor", "data", "icons"]:
    for racine, _, noms in os.walk(dossier):
        for n in sorted(noms):
            fichiers.append(os.path.join(racine, n).replace(os.sep, "/"))
empreinte = hashlib.sha256()
for f in fichiers[1:]:
    with open(f, "rb") as fh:
        empreinte.update(f.encode() + fh.read())
version = empreinte.hexdigest()[:10]

with open("outils/sw.modele.js", encoding="utf-8") as f:
    modele = f.read()
with open("sw.js", "w", encoding="utf-8") as f:
    f.write(modele.replace("__VERSION__", version).replace("__FICHIERS__", json.dumps(fichiers, indent=2)))
print("version", version, "-", len(fichiers), "fichiers")
