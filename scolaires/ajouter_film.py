#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Ajoute un film enrichi au catalogue scolaire de Cine Carbonne."""

from __future__ import annotations

import argparse
import json
import math
import sys
import tempfile
import unicodedata
from datetime import date
from pathlib import Path
from typing import Any

import pandas as pd


SCOLAIRES_DIR = Path(__file__).resolve().parent
SITE_DIR = SCOLAIRES_DIR.parent
TOOLS_DIR = SITE_DIR / "outils"
CATALOG_PATH = SCOLAIRES_DIR / "films.json"
LEGACY_CATALOG_PATH = SITE_DIR / "data" / "scolaires.json"

if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

import enrich_3_0 as enrich  # noqa: E402


def _text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and math.isnan(value):
        return ""
    text = str(value).strip()
    return "" if text.lower() == "nan" else text


def _title_key(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", _text(value).casefold())
    return "".join(char for char in normalized if not unicodedata.combining(char))


def _backdrops(value: Any) -> list[str]:
    if isinstance(value, list):
        return [_text(item) for item in value if _text(item)]
    text = _text(value)
    if not text:
        return []
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return []
    return [_text(item) for item in parsed if _text(item)] if isinstance(parsed, list) else []


def _catalog_item(row: pd.Series) -> dict[str, Any]:
    release_date = _text(row.get("date_sortie")) or _text(row.get("annee"))
    return {
        "titre": _text(row.get("Titre")) or _text(row.get("titre")),
        "titre_original": _text(row.get("titre_original")),
        "realisateur": _text(row.get("Realisateur")) or _text(row.get("realisateur")),
        "acteurs_principaux": _text(row.get("acteurs_principaux")),
        "genres": _text(row.get("genres")),
        "duree_min": _text(row.get("duree_min")),
        "annee": release_date,
        "pays": _text(row.get("pays")),
        "version": _text(row.get("Version")) or _text(row.get("version")) or "VF",
        "recompenses": _text(row.get("recompenses")),
        "synopsis": _text(row.get("synopsis")),
        "affiche_url": _text(row.get("affiche_url")),
        "backdrops": _backdrops(row.get("backdrops")),
        "trailer_url": _text(row.get("trailer_url")),
        "allocine_url": _text(row.get("allocine_url")),
    }


def load_catalog() -> list[dict[str, Any]]:
    source = CATALOG_PATH if CATALOG_PATH.exists() else LEGACY_CATALOG_PATH
    if not source.exists():
        return []
    payload = json.loads(source.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise ValueError(f"Le catalogue {source} doit contenir une liste JSON.")
    return [item for item in payload if isinstance(item, dict)]


def save_catalog(items: list[dict[str, Any]]) -> None:
    ordered = sorted(items, key=lambda item: _title_key(item.get("titre", "")))
    content = json.dumps(ordered, ensure_ascii=False, indent=2) + "\n"
    CATALOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = CATALOG_PATH.with_suffix(".json.tmp")
    temporary_path.write_text(content, encoding="utf-8")
    temporary_path.replace(CATALOG_PATH)


def enrich_movie(title: str, director: str, version: str, allocine_url: str) -> tuple[dict[str, Any], dict[str, Any]]:
    for env_path in (TOOLS_DIR / ".env", SITE_DIR / ".env"):
        enrich.load_env_file(env_path)

    with tempfile.TemporaryDirectory(prefix="enrichissement-", dir=SCOLAIRES_DIR) as temp_dir:
        work_dir = Path(temp_dir)
        input_path = work_dir / "film.xlsx"
        output_path = work_dir / "film_enrichi.xlsx"
        report_path = work_dir / "rapport.json"

        pd.DataFrame(
            [
                {
                    "Date": date.today().isoformat(),
                    "Heure": "00:00",
                    "Titre": title,
                    "Version": version,
                    "CM": "",
                    "Realisateur": director,
                    "Recompenses": "",
                    "Categorie": "SCOL",
                    "Tarif": "",
                    "Commentaire": "",
                    "url_allocine": allocine_url,
                }
            ]
        ).to_excel(input_path, index=False)

        result = enrich.main(
            input_path=input_path,
            output_path=output_path,
            report_path=report_path,
            open_report=False,
        )
        if result != 0 or not output_path.exists():
            raise RuntimeError("L'enrichissement du film n'a pas produit de fiche.")

        enriched_rows = pd.read_excel(output_path, sheet_name=0, dtype=str).fillna("")
        if enriched_rows.empty:
            raise RuntimeError("La fiche enrichie est vide.")
        report = json.loads(report_path.read_text(encoding="utf-8")) if report_path.exists() else {}
        return _catalog_item(enriched_rows.iloc[0]), report


def add_movie(
    title: str,
    director: str = "",
    version: str = "VF",
    allocine_url: str = "",
    replace: bool = False,
) -> dict[str, Any]:
    catalog = load_catalog()
    key = _title_key(title)
    existing_index = next(
        (index for index, item in enumerate(catalog) if _title_key(item.get("titre", "")) == key),
        None,
    )
    if existing_index is not None and not replace:
        raise ValueError(
            f"« {catalog[existing_index].get('titre', title)} » est deja dans la liste. "
            "Utilisez --remplacer pour refaire sa fiche."
        )

    item, report = enrich_movie(title, director, version, allocine_url)
    if not item.get("affiche_url"):
        raise RuntimeError(
            "Aucune affiche n'a ete trouvee. La liste n'a pas ete modifiee; "
            "essayez avec --realisateur ou --url-allocine."
        )

    if existing_index is None:
        catalog.append(item)
    else:
        catalog[existing_index] = item
    save_catalog(catalog)
    return {"film": item, "report": report, "count": len(catalog)}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Ajoute un film au catalogue scolaire et complete automatiquement sa fiche."
    )
    parser.add_argument("titre", nargs="?", help="Titre du film")
    parser.add_argument("--realisateur", default="", help="Realisateur, utile pour lever une ambiguite")
    parser.add_argument("--version", default="VF", help="Version de projection (VF par defaut)")
    parser.add_argument("--url-allocine", default="", help="URL Allocine exacte, si elle est connue")
    parser.add_argument("--remplacer", action="store_true", help="Remplace une fiche deja presente")
    parser.add_argument(
        "--synchroniser",
        action="store_true",
        help="Cree films.json a partir du catalogue existant sans enrichissement",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.synchroniser:
        catalog = load_catalog()
        save_catalog(catalog)
        print(f"Catalogue synchronise : {len(catalog)} film(s) dans {CATALOG_PATH}")
        return 0

    title = _text(args.titre)
    if not title:
        title = input("Titre du film : ").strip()
    if not title:
        raise SystemExit("Le titre est obligatoire.")

    try:
        result = add_movie(
            title=title,
            director=_text(args.realisateur),
            version=_text(args.version) or "VF",
            allocine_url=_text(args.url_allocine),
            replace=args.remplacer,
        )
    except (RuntimeError, ValueError) as error:
        raise SystemExit(f"Erreur : {error}") from error

    film = result["film"]
    print(f"Ajoute : {film['titre']} ({film.get('annee', '')})")
    print(f"Catalogue : {result['count']} film(s) dans {CATALOG_PATH}")
    issue_count = int((result.get("report") or {}).get("issue_count") or 0)
    if issue_count:
        print(f"Attention : {issue_count} point(s) de la fiche meritent une verification manuelle.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
