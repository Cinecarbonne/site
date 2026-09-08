# Catalogue des films scolaires

Le fichier `films.json` est la liste utilisée directement par la page Scolaires du site. Il peut être modifié à la main avec un éditeur de texte.

Pour ajouter un film avec sa fiche complète, double-cliquer sur `Ajouter un film.cmd`, saisir son titre, puis laisser l’outil rechercher l’affiche, les données techniques, le synopsis, les photos et la bande-annonce.

Si plusieurs films portent un titre proche, relancer l’outil dans un terminal en précisant le réalisateur ou l’adresse Allociné :

```powershell
& ".\scolaires\Ajouter un film.cmd" "Titre du film" --realisateur "Nom du réalisateur"
& ".\scolaires\Ajouter un film.cmd" "Titre du film" --url-allocine "https://www.allocine.fr/film/fichefilm_gen_cfilm=000000.html"
```

Pour refaire entièrement une fiche déjà présente, ajouter l’option `--remplacer`.

Pour remplacer tout le catalogue à partir d’un document Word contenant une table de titres et de liens Allociné :

```powershell
& ".\.venv\Scripts\python.exe" ".\scolaires\importer_docx.py" "C:\chemin\liste-films.docx"
```

L’import est sécurisé : `films.json` n’est remplacé que si toutes les fiches ont été enrichies et disposent d’une affiche.
