#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Ajoute la mention "a partir de X ans" dans le champ commentaire pour
les films "Jeune Public" de programme.json, a partir des pages AlloCine.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import unicodedata
from pathlib import Path
from typing import Any

import requests

ALLOCINE_TIMEOUT = 15
DEFAULT_PROGRAMME_PATH = Path(__file__).resolve().parents[1] / "programme.json"

SESSION = requests.Session()
SESSION.headers.update(
    {
        "User-Agent": "CineCarbonne/1.0",
        "Accept-Language": "fr-FR,fr;q=0.9",
    }
)

AGE_LABEL_RE = re.compile(
    r'<[^>]*class="[^"]*kids-label[^"]*"[^>]*>(.*?)</[^>]+>',
    flags=re.IGNORECASE | re.DOTALL,
)
AGE_TEXT_RE = re.compile(r"a\s*partir\s*de\s*(\d{1,2})\s*ans?", flags=re.IGNORECASE)
TAG_RE = re.compile(r"<[^>]+>")


def normalize_text(value: str) -> str:
    text = html.unescape(value or "")
    text = unicodedata.normalize("NFKD", text)
    text = "".join(char for char in text if not unicodedata.combining(char))
    text = text.lower()
    return re.sub(r"\s+", " ", text).strip()


def extract_age_from_text(value: str) -> int | None:
    match = AGE_TEXT_RE.search(normalize_text(value))
    if not match:
        return None
    return int(match.group(1))


def has_jeune_public(categorie: str) -> bool:
    return "jeune public" in normalize_text(categorie)


def clean_html_to_text(html_text: str) -> str:
    text = TAG_RE.sub(" ", html_text)
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def extract_age_from_allocine_html(html_text: str) -> int | None:
    # Priorite au label AlloCine dedie au jeune public.
    for label_html in AGE_LABEL_RE.findall(html_text):
        age = extract_age_from_text(clean_html_to_text(label_html))
        if age is not None:
            return age

    # Secours: balayage du texte de la page complete.
    return extract_age_from_text(clean_html_to_text(html_text))


def fetch_allocine_age(allocine_url: str) -> tuple[int | None, str | None]:
    try:
        response = SESSION.get(allocine_url, timeout=ALLOCINE_TIMEOUT)
    except requests.RequestException as exc:
        return None, f"request_error: {exc}"

    if response.status_code != 200:
        return None, f"http_status: {response.status_code}"

    age = extract_age_from_allocine_html(response.text)
    if age is None:
        return None, "age_not_found"

    return age, None


def merge_comment_with_age(commentaire: str, age: int) -> str:
    age_text = f"à partir de {age} ans"
    base = (commentaire or "").strip()
    if not base:
        return age_text
    if base.endswith((".", "!", "?", ";", ":")):
        return f"{base} {age_text}"
    return f"{base}, {age_text}"


def load_programme(path: Path) -> list[dict[str, Any]]:
    try:
        raw_data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"JSON invalide: {exc}") from exc

    if not isinstance(raw_data, list):
        raise ValueError("Le fichier programme doit contenir une liste JSON.")

    for index, item in enumerate(raw_data):
        if not isinstance(item, dict):
            raise ValueError(f"Entree non-objet detectee a l'index {index}.")

    return raw_data


def save_programme(path: Path, films: list[dict[str, Any]]) -> None:
    content = json.dumps(films, ensure_ascii=False, indent=2) + "\n"
    path.write_text(content, encoding="utf-8")


def update_jeune_public_ages(programme_path: Path, dry_run: bool = False) -> int:
    films = load_programme(programme_path)

    url_cache: dict[str, tuple[int | None, str | None]] = {}
    updated_entries: list[tuple[str, int]] = []

    stats = {
        "jeune_public": 0,
        "already_has_age": 0,
        "missing_allocine_url": 0,
        "allocine_errors": 0,
        "age_not_found": 0,
        "updated": 0,
    }

    for film in films:
        categorie = str(film.get("categorie", "") or "")
        if not has_jeune_public(categorie):
            continue

        stats["jeune_public"] += 1
        commentaire = str(film.get("commentaire", "") or "")
        if extract_age_from_text(commentaire) is not None:
            stats["already_has_age"] += 1
            continue

        allocine_url = str(film.get("allocine_url", "") or "").strip()
        if not allocine_url:
            stats["missing_allocine_url"] += 1
            continue

        if allocine_url not in url_cache:
            url_cache[allocine_url] = fetch_allocine_age(allocine_url)

        age, error = url_cache[allocine_url]
        if error:
            if error == "age_not_found":
                stats["age_not_found"] += 1
            else:
                stats["allocine_errors"] += 1
            continue

        assert age is not None
        film["commentaire"] = merge_comment_with_age(commentaire, age)
        stats["updated"] += 1
        updated_entries.append((str(film.get("titre", "Sans titre")), age))

    if stats["updated"] > 0 and not dry_run:
        save_programme(programme_path, films)

    print(f"Fichier: {programme_path}")
    print(f"Films Jeune Public traites: {stats['jeune_public']}")
    print(f"Films deja renseignes: {stats['already_has_age']}")
    print(f"Films mis a jour: {stats['updated']}")
    print(f"Films sans allocine_url: {stats['missing_allocine_url']}")
    print(f"Pages sans age trouve: {stats['age_not_found']}")
    print(f"Erreurs reseau/http: {stats['allocine_errors']}")

    if updated_entries:
        print("")
        print("Films mis a jour:")
        for title, age in updated_entries:
            print(f"- {title}: à partir de {age} ans")

    if dry_run:
        print("")
        print("Dry-run actif: aucune ecriture sur disque.")

    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Ajoute dans programme.json la mention d'age AlloCine pour les films "
            "Jeune Public."
        )
    )
    parser.add_argument(
        "--programme",
        default=str(DEFAULT_PROGRAMME_PATH),
        help=f"Chemin du programme JSON (defaut: {DEFAULT_PROGRAMME_PATH})",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Affiche les changements sans modifier le fichier.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    programme_path = Path(args.programme).expanduser().resolve()

    if not programme_path.exists():
        print(f"Fichier introuvable: {programme_path}", file=sys.stderr)
        return 1

    try:
        return update_jeune_public_ages(programme_path, dry_run=args.dry_run)
    except ValueError as exc:
        print(f"Erreur: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
