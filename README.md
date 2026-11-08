# malivertcpge

Appli web pour apprendre et retenir ses formules de prépa (PCSI / PSI) : fiches, cartes de révision et répétition espacée. Elle marche sur PC, Android et iPhone, même hors ligne.

**Ouvrir l'appli : https://lucacacaca.github.io/malivertcpge/**

## Installer

- **iPhone (Safari)** : bouton Partager → « Sur l'écran d'accueil ».
- **Android (Chrome)** : menu ⋮ → « Installer l'application » (ou « Ajouter à l'écran d'accueil »).
- **PC (Chrome / Edge)** : icône d'installation dans la barre d'adresse.

Le tutoriel complet se trouve dans l'appli, sous **Plus → Comment ça marche**.

## Données

Tout reste **sur ton appareil** : rien n'est envoyé sur internet. Pour changer d'appareil, fais une sauvegarde (**Plus → Sauvegarde**). Le fichier `.zip` a le même format que l'appli Android PrepaApp (base v16), dans les deux sens.

## Technique

- Site statique sans compilation : modules ES, [sql.js](https://github.com/sql-js/sql.js) (SQLite avec le même schéma que l'appli Android), KaTeX et JSZip, tous inclus dans `vendor/`.
- Base enregistrée dans IndexedDB. Le service worker (`sw.js`) permet de l'utiliser hors ligne.
- Après chaque modification, lancer `python3 outils/construire.py`, qui régénère `data/index.json` et `sw.js` (et donc la version du cache).

### Étapes

- **W1** : révisions, installation, tutoriel, sauvegarde ✓
- **W2** : planning des colles et DS, notes et moyennes, ajout au calendrier ✓
- **W3** : TD, cours, TIPE, à faire, emploi du temps
