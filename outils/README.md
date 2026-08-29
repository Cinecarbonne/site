# Programme-to-json

# TBD
gestion des chois de fil multiple dans l'interface Uilisateur

## Environnement Python

Utiliser un seul environnement virtuel a la racine du repository.
Ne pas recreer de `.venv` dans `outils/` ni dans `Lab/outils/`.

Installation (depuis la racine du repo):

```powershell
py -3.13 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

Execution des scripts:

```powershell
python outils/normalize.py
python outils/enrich_3_0.py
python outils/excel_to_json.py
```

## Operations mensuelles

Source Google Sheet par defaut:

```text
Le script telecharge ProgrammeCineCarbonne DG et choisit automatiquement le
plus grand onglet dont le nom est un nombre. Les onglets comme Template sont
ignores. Le bloc Prochainement de l'onglet reste traite sans changement.
```

Execution complete:

```powershell
python outils/operations_mensuelles.py
```

Pour imposer un programme precis:

```powershell
python outils/operations_mensuelles.py --programme 359
```

L'ancien fonctionnement avec un fichier local reste disponible:

```powershell
python outils/operations_mensuelles.py --source C:\chemin\programme.xlsx
```

Le Google Sheet peut etre remplace avec `--spreadsheet-url` ou avec la variable
d'environnement `CINECARBONNE_GOOGLE_SHEET_URL`.

Regle Allocine/TMDB:

```text
Sans URL Allocine dans le programme, le script recherche le film sur Allocine
et TMDB et conserve le choix manuel en cas d'ecart.

Avec une URL Allocine fournie, le script consulte encore TMDB. Si les fiches
correspondent, TMDB peut completer les informations manquantes. En cas d'ecart,
Allocine est retenu automatiquement, sans question et sans reutiliser de
ressource TMDB pour cette fiche.
```

Controle apres execution:

```text
Verifier outils/work/enrichment_report.json.
S'il contient des items, ce sont les seances a relire avant publication
du programme.
Le fichier est ouvert automatiquement a la fin de l'etape enrich.
```

Secours Google optionnel:

```text
Renseigner GOOGLE_API_KEY et GOOGLE_CX dans outils/.env pour activer le
secours web quand Allocine et TMDB ne trouvent aucun candidat.
OPEN_ENRICHMENT_REPORT=0 permet de desactiver l'ouverture automatique.
```

Options utiles:

```powershell
python outils/operations_mensuelles.py --dry-run
python outils/operations_mensuelles.py --programme 359 --dry-run
python outils/operations_mensuelles.py --from-step enrich
python outils/operations_mensuelles.py --to-step tableau
python outils/operations_mensuelles.py --from-step prochainement --to-step prochainement
python outils/generate_prochainement_json.py --source outils/input/source.xlsx
```

Ordre des etapes:

```text
normalize
enrich_3_0
excel_to_json
generate_prochainement_json
make_tableau_ingest
```

### Courts metrages

Le normaliseur conserve la compatibilite avec les anciennes definitions placees
en haut du tableau. Dans le format actuel, il repere automatiquement l'intitule
`Courts metrages a venir` en colonne N, quelle que soit sa ligne, puis lit les
definitions `CM1`, `CM2`, etc. en colonne O. Seules les definitions du mois de
debut du programme (`09/26`, par exemple) sont retenues.

Les references de la colonne CM sont exportees avec leur titre, genre et duree
dans `data/programme.json`. Le tableau ingest ajoute une ligne distincte pour
chaque court metrage et conserve le marqueur `+ CM1`, `+ CM2`, etc. sur la ligne
du long metrage.

La colonne VO historique du tableau ingest est remplacee par `Version` et affiche
explicitement `VF`, `VO` ou `VOST OCAP`.

## Accessibilite du tableau ingest

`make_tableau_ingest.py` ajoute une cinquieme colonne `Accessibilité` au
classeur `outils/work/tableau_ingest.xlsx`. Les codes sont repetes sur chaque
seance du meme film, y compris dans les lignes scolaires. Les lignes de courts
metrages restent conservees.

Legende:

```text
AD    Audiodescription signalee par Cine-Sens
SME   Sous-titres sourds et malentendants signales par Cine-Sens
SR    Son renforce signale par Cine-Sens
VAST  Film present dans la liste Tout en Parlant
LB    Film present dans la rubrique La Bavarde de Cine-Sens
G*    Film present dans la rubrique GRETA de Cine-Sens
```

`G*` ne signifie pas que GRETA est utilisable a Cine Carbonne. L'application
spectateur est gratuite, mais le cinema doit souscrire un abonnement
professionnel commercialise sur devis par CinemaNext. Cine Carbonne n'est pas
abonne a ce jour.

Sources consultees:

- [Films accessibles de Cine-Sens](https://www.cine-sens.fr/category/actualites/films-accessibles/)
- [Films en VAST de Tout en Parlant](https://www.toutenparlant.org/vast-cinema/films-en-vast)
- [Fonctionnement de GRETA](https://www.cine-sens.fr/actualites/solutions-d-adaptation-rendre-les-cinemas-accessibles-au-handicap-sensoriel-2/application-greta/)
- [Contact CinemaNext](https://www.cinemanext.com/fr/contactus)

La recherche peut aussi etre lancee seule:

```powershell
python outils/accessibility_lookup.py
```

Elle genere `outils/work/accessibilite_report.json`, qui conserve les
rapprochements, leur confiance, les URL, les dates et les cas ambigus. Le
dernier catalogue valide est conserve dans
`outils/work/accessibilite_cache.json`.

Mode hors connexion:

```powershell
python outils/accessibility_lookup.py --offline
python outils/make_tableau_ingest.py --offline
```

Si une source est indisponible, le dernier cache de cette source est utilise.
Sans cache, le classeur est quand meme genere avec `À vérifier`. Cette mention
signifie seulement qu'aucune information assez fiable n'a ete trouvee; elle ne
prouve jamais l'absence d'un dispositif. Les indications restent un reperage
prealable: la presence reelle des pistes sur le DCP doit etre confirmee apres
l'ingest.

Publication site:

```text
- excel_to_json exclut les projections scolaires de data/programme.json.
- Les projections scolaires restent conservees dans les fichiers de travail
  et les tableaux internes, notamment normalized.xlsx, enriched.xlsx,
  tableau_ingest.xlsx et le tableau service genere par l'interface.
```

## Operation PDF

Preparation:

```text
1. Copier le nouveau PDF du programme dans PDFs/
```

Execution:

```powershell
python outils/operation_pdf.py
```

Options utiles:

```powershell
python outils/operation_pdf.py --page 8
```

Notes:

```text
- L'operation PDF met a jour data/PDFs.json et genere PDFs/programme_page8.jpg
- Sans --page, l'image exportee prend la derniere page du dernier PDF
```

## Structure recommandee

```text
/index.html
/cinema.html
/evenement.html
/accessibilite.html
/css/
/js/
/data/
/images/
/icons/
/fonts/
/PDFs/
/outils/
```
