# Ajouter ou mettre à jour une classe

Chaque classe est un fichier `data/classes/<id>.json`. Après modification : augmenter `version`, lancer
`python3 outils/construire.py`, publier. Les élèves voient « Colloscope mis à jour » et cliquent « Mettre à jour ».

```json
{
 "format": 1, "id": "psi-2026", "nom": "PSI", "annee": "2026-2027", "version": 2, "filiere": "PSI",
 "description": "Colloscope, DS / DM et emploi du temps de la PSI.",
 "groupesColle": ["1", "2", "…", "16"],
 "options": [
  {"cle": "td", "libelle": "Groupe de TD", "choix": ["gr1", "gr2"]},
  {"cle": "tp", "libelle": "Groupe de TP", "choix": ["A", "B"]},
  {"cle": "lv2", "libelle": "LV2", "choix": ["Allemand", "Espagnol", "Aucune"]}
 ],
 "commun": [ {"type": "DS", "matiere": "Mathématiques", "date": "2026-11-14"} ],
 "colles": {
  "14": [ {"type": "COLLE", "matiere": "Chimie", "date": "2026-11-10", "heure": "16:00", "salle": "C008", "colleur": "Lemaire"} ]
 },
 "edt": {
  "semaineA": "2026-10-26",
  "creneaux": [
   {"jour": "mardi", "debut": "14h", "fin": "15h", "matiere": "maths", "intitule": "TD", "salle": "E002", "semaines": "", "pour": {"td": "gr2"}}
  ]
 }
}
```

- `commun` : événements de toute la classe (DS, DM, concours blancs) ; `colles` : une liste par groupe.
  Même format que l'import de planning (type COLLE / DS / EVALUATION / AUTRE, date AAAA-MM-JJ, heure, note…).
- `edt.creneaux` : même format que l'import d'emploi du temps de l'appli Android, plus `pour` :
  le créneau n'est installé que pour les élèves dont les choix correspondent (`{"td": "gr2"}`,
  ou une liste `{"tp": ["A", "B"]}`). Sans `pour`, il est pour tout le monde.
- Quand un élève change de groupe, les colles **à venir** de l'ancien groupe sont retirées ; l'emploi du temps est remplacé.
