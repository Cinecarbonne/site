#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Remplace le catalogue scolaire a partir de la table d'un document Word."""

from __future__ import annotations

import argparse
import re
import tempfile
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse
from xml.etree import ElementTree

import pandas as pd

try:
    from .ajouter_film import SCOLAIRES_DIR, SITE_DIR, TOOLS_DIR, _catalog_item, _title_key, save_catalog
except ImportError:  # Execution directe depuis le dossier scolaires.
    from ajouter_film import SCOLAIRES_DIR, SITE_DIR, TOOLS_DIR, _catalog_item, _title_key, save_catalog
import enrich_3_0 as enrich


WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PACKAGE_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
NS = {"w": WORD_NS, "r": REL_NS}
URL_RE = re.compile(r"https?://[^\s<>\"]+", re.IGNORECASE)
ALLOCINE_ID_RE = re.compile(r"(?:cfilm=|fichefilm-)(\d+)", re.IGNORECASE)
SKIPPED_TITLES = {"films", "maternelle", "primaire"}
SEARCH_ALIASES = {
    # Coquille presente dans la liste 2026-2027.
    "le secret des perlins": "Le Secret des Perlims",
}


def _cell_text(cell: ElementTree.Element) -> str:
    paragraphs: list[str] = []
    for paragraph in cell.findall(".//w:p", NS):
        value = "".join(node.text or "" for node in paragraph.findall(".//w:t", NS)).strip()
        if value:
            paragraphs.append(value)
    return "\n".join(paragraphs).strip()


def _cell_links(cell: ElementTree.Element, relationships: dict[str, str]) -> list[str]:
    links: list[str] = []
    for hyperlink in cell.findall(".//w:hyperlink", NS):
        rel_id = hyperlink.get(f"{{{REL_NS}}}id", "")
        target = relationships.get(rel_id, "").strip()
        if target and target not in links:
            links.append(target)
    for match in URL_RE.findall(_cell_text(cell)):
        target = match.rstrip(".,;:)")
        if target and target not in links:
            links.append(target)
    return links


def read_movies(docx_path: Path) -> list[dict[str, str]]:
    """Lit les deux premieres colonnes de la premiere table du DOCX."""
    if not docx_path.is_file():
        raise FileNotFoundError(f"Document introuvable : {docx_path}")

    with zipfile.ZipFile(docx_path) as archive:
        document = ElementTree.fromstring(archive.read("word/document.xml"))
        relationships_root = ElementTree.fromstring(archive.read("word/_rels/document.xml.rels"))

    relationships = {
        element.get("Id", ""): element.get("Target", "")
        for element in relationships_root.findall(f"{{{PACKAGE_REL_NS}}}Relationship")
    }
    table = document.find(".//w:tbl", NS)
    if table is None:
        raise ValueError("Le document ne contient aucune table.")

    movies: list[dict[str, str]] = []
    for row in table.findall("./w:tr", NS):
        cells = row.findall("./w:tc", NS)
        if len(cells) < 2:
            continue
        title = _cell_text(cells[0]).split("\n", 1)[0].strip()
        if not title or title.casefold() in SKIPPED_TITLES:
            continue
        allocine_links = [
            unquote(link)
            for link in _cell_links(cells[1], relationships)
            if "allocine.fr" in link.casefold()
        ]
        if not allocine_links:
            raise ValueError(f"Aucun lien Allocine dans la ligne « {title} ».")
        movies.append({"title": title, "allocine_url": allocine_links[0]})

    if not movies:
        raise ValueError("Aucun film n'a ete trouve dans le document.")
    return movies


def _direct_allocine_url(url: str) -> str:
    match = ALLOCINE_ID_RE.search(url or "")
    if not match:
        return ""
    return f"https://www.allocine.fr/film/fichefilm_gen_cfilm={match.group(1)}.html"


def _allocine_search_term(url: str) -> str:
    try:
        values = parse_qs(urlparse(url).query).get("q", [])
    except ValueError:
        return ""
    return values[0].strip() if values else ""


def resolve_allocine_urls(movies: list[dict[str, str]]) -> list[dict[str, str]]:
    """Transforme les liens de recherche Allocine du DOCX en fiches de films."""
    resolved = [dict(movie) for movie in movies]
    pending: dict[int, str] = {}
    for index, movie in enumerate(resolved):
        direct_url = _direct_allocine_url(movie["allocine_url"])
        if direct_url:
            movie["allocine_url"] = direct_url
        else:
            pending[index] = movie["title"]

    def lookup(index: int, title: str, search_url: str) -> tuple[int, dict | None, str]:
        try:
            queries = [title]
            alias = SEARCH_ALIASES.get(_title_key(title))
            if alias:
                queries.append(alias)
            search_term = _allocine_search_term(search_url)
            if search_term and _title_key(search_term) != _title_key(title):
                queries.append(search_term)
            for query in queries:
                result = enrich.allocine_find_movie(query, "")
                if result.get("match"):
                    return index, result["match"], ""
            # Certains intitulés pédagogiques ajoutent une longue explication
            # après le titre officiel (par exemple « Icare le garçon… »).
            first_word = title.split(maxsplit=1)[0].strip("'’-:,. ")
            if len(first_word) >= 5:
                result = enrich.allocine_find_movie(first_word, "")
                match = result.get("match")
                if match and _title_key(match.get("title", "")) == _title_key(first_word):
                    return index, match, ""
            return index, None, ""
        except Exception as error:  # pragma: no cover - depend du reseau
            return index, None, str(error)

    if pending:
        with ThreadPoolExecutor(max_workers=min(6, len(pending))) as executor:
            futures = [
                executor.submit(lookup, index, title, resolved[index]["allocine_url"])
                for index, title in pending.items()
            ]
            for future in as_completed(futures):
                index, match, error = future.result()
                if error:
                    raise RuntimeError(f"Recherche Allocine impossible pour « {resolved[index]['title']} » : {error}")
                direct_url = _direct_allocine_url((match or {}).get("url", ""))
                if not direct_url:
                    raise RuntimeError(f"Aucune fiche Allocine trouvee pour « {resolved[index]['title']} ».")
                resolved[index]["allocine_url"] = direct_url
                print(f"Lien resolu : {resolved[index]['title']} -> {direct_url}", flush=True)
    return resolved


def import_catalog(docx_path: Path, expected_count: int | None = None) -> list[dict]:
    movies = read_movies(docx_path)
    if expected_count is not None and len(movies) != expected_count:
        raise RuntimeError(f"Le document contient {len(movies)} films au lieu des {expected_count} attendus.")

    for env_path in (TOOLS_DIR / ".env", SITE_DIR / ".env"):
        enrich.load_env_file(env_path)
    movies = resolve_allocine_urls(movies)

    with tempfile.TemporaryDirectory(prefix="import-scolaires-", dir=SCOLAIRES_DIR) as temp_dir:
        work_dir = Path(temp_dir)
        input_path = work_dir / "films.xlsx"
        output_path = work_dir / "films_enrichis.xlsx"
        report_path = work_dir / "rapport.json"
        rows = [
            {
                "Date": date.today().isoformat(),
                "Heure": "00:00",
                "Titre": movie["title"],
                "Version": "VF",
                "CM": "",
                "Realisateur": "",
                "Recompenses": "",
                "Categorie": "SCOL",
                "Tarif": "",
                "Commentaire": "",
                "url_allocine": movie["allocine_url"],
            }
            for movie in movies
        ]
        pd.DataFrame(rows).to_excel(input_path, index=False)

        result = enrich.main(
            input_path=input_path,
            output_path=output_path,
            report_path=report_path,
            open_report=False,
        )
        if result != 0 or not output_path.exists():
            raise RuntimeError("L'enrichissement n'a pas produit le catalogue attendu.")

        enriched_rows = pd.read_excel(output_path, sheet_name=0, dtype=str).fillna("")
        items = [_catalog_item(row) for _, row in enriched_rows.iterrows()]

    if len(items) != len(movies):
        raise RuntimeError(f"{len(items)} fiches produites pour {len(movies)} films : catalogue inchange.")
    without_poster = [item.get("titre", "") for item in items if not item.get("affiche_url")]
    if without_poster:
        raise RuntimeError(
            "Affiche manquante pour : " + ", ".join(without_poster) + ". Catalogue inchange."
        )
    duplicate_titles = sorted(
        {item["titre"] for item in items if sum(_title_key(other["titre"]) == _title_key(item["titre"]) for other in items) > 1}
    )
    if duplicate_titles:
        raise RuntimeError("Titres en double apres enrichissement : " + ", ".join(duplicate_titles))

    save_catalog(items)
    return items


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Remplace films.json avec les films d'une table Word et leurs fiches enrichies."
    )
    parser.add_argument("document", type=Path, help="Document DOCX contenant les titres et liens Allocine")
    parser.add_argument("--attendus", type=int, help="Nombre de films attendu avant de remplacer le catalogue")
    parser.add_argument("--lister", action="store_true", help="Affiche uniquement les films trouves, sans enrichir")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    movies = read_movies(args.document)
    print(f"{len(movies)} film(s) trouves dans {args.document}")
    if args.lister:
        for index, movie in enumerate(movies, start=1):
            print(f"{index:02d}. {movie['title']} | {movie['allocine_url']}")
        return 0

    try:
        items = import_catalog(args.document, expected_count=args.attendus)
    except (FileNotFoundError, RuntimeError, ValueError) as error:
        raise SystemExit(f"Erreur : {error}") from error
    print(f"Catalogue remplace : {len(items)} films dans {SCOLAIRES_DIR / 'films.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
