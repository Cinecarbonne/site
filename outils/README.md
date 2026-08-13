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

Preparation:

```text
1. Copier le tableau Excel du mois dans outils/input/source.xlsx
```

Execution complete:

```powershell
python outils/operations_mensuelles.py
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
