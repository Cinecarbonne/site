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
```

Options utiles:

```powershell
python outils/operations_mensuelles.py --dry-run
python outils/operations_mensuelles.py --from-step enrich
python outils/operations_mensuelles.py --to-step tableau
```

Ordre des etapes:

```text
normalize
enrich_3_0
excel_to_json
generate_prochainement_json
make_tableau_ingest
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
/cinejeune.html
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
