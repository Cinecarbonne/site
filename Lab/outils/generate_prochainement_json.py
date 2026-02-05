#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
G?n?re Lab/prochainement.json ? partir de outils/input/source.xlsx.

Logique :
1) Trouver une ligne qui contient uniquement "Prochainement" dans une seule cellule.
2) Lire les titres dans la m?me colonne, ? partir de la ligne suivante (m?me cellule),
   s?par?s par des virgules.
3) Pour chaque titre, r?cup?rer l'affiche (Allocin? en priorit?, puis TMDB),
   en privil?giant les films dont l'ann?e de sortie est l'ann?e courante ou l'ann?e-1.
4) En cas d'ambigu?t?, proposer un choix interactif.
"""

from __future__ import annotations

import difflib
import json
import re
from datetime import date
from pathlib import Path

import pandas as pd

from enrich_3_0 import (
    allocine_find_movie,
    allocine_movie_meta,
    normalize_for_match,
    tmdb_search_movies,
    tmdb_get_credits,
)


BASE_DIR = Path(__file__).resolve().parent
LAB_DIR = BASE_DIR.parent

INPUT_XLSX = BASE_DIR / "input/source.xlsx"
OUTPUT_JSON = LAB_DIR / "prochainement.json"
SHEET_NAME = "Feuil1"

TMDB_IMG_W500 = "https://image.tmdb.org/t/p/w500"
MATCH_THRESHOLD = 0.90


def _is_empty(value) -> bool:
    if value is None:
        return True
    try:
        if pd.isna(value):
            return True
    except Exception:
        pass
    return str(value).strip() == ""


def _find_prochainement_block(df: pd.DataFrame) -> tuple[int, int] | tuple[None, None]:
    for idx, row in df.iterrows():
        non_empty = [(col_idx, val) for col_idx, val in enumerate(row) if not _is_empty(val)]
        if len(non_empty) != 1:
            continue
        col_idx, val = non_empty[0]
        if str(val).strip().lower() == "prochainement":
            return idx, col_idx
    return None, None


def _collect_titles(df: pd.DataFrame, start_idx: int, col_idx: int) -> tuple[str, list[str]]:
    cell = df.iat[start_idx + 1, col_idx] if start_idx + 1 < len(df) else None
    if _is_empty(cell):
        raise SystemExit("[ERREUR] 'Prochainement' trouv? mais la cellule en dessous est vide.")
    raw = str(cell).strip()
    titles = [t.strip() for t in raw.split(",") if t.strip()]
    if not titles:
        raise SystemExit("[ERREUR] Aucun titre exploitable sous 'Prochainement'.")
    return raw, titles


def _year_from_date(value: str) -> int | None:
    if not value:
        return None
    match = re.match(r"^(\d{4})", str(value))
    if not match:
        return None
    try:
        return int(match.group(1))
    except Exception:
        return None


def _title_score(input_title: str, cand_title: str, cand_orig: str = "") -> float:
    base = normalize_for_match(input_title)
    if not base:
        return 0.0
    cand_title_norm = normalize_for_match(cand_title)
    cand_orig_norm = normalize_for_match(cand_orig)
    score = difflib.SequenceMatcher(a=base, b=cand_title_norm).ratio() if cand_title_norm else 0.0
    if cand_orig_norm:
        score = max(score, difflib.SequenceMatcher(a=base, b=cand_orig_norm).ratio())
    return score


def _director_score(name_a: str, name_b: str) -> float:
    a = normalize_for_match(name_a or "")
    b = normalize_for_match(name_b or "")
    if not a or not b:
        return 0.0
    return difflib.SequenceMatcher(a=a, b=b).ratio()


def _tmdb_director(movie_id: int, lang: str) -> str:
    try:
        credits = tmdb_get_credits(movie_id, lang)
    except Exception:
        return ""
    crew = credits.get("crew") or []
    directors = [c.get("name") for c in crew if c.get("job") == "Director" and c.get("name")]
    return ", ".join(directors)


def _build_allocine_candidates(title: str, allowed_years: set[int]) -> list[dict]:
    res = allocine_find_movie(title, "")
    candidates = res.get("candidates") or []
    out = []
    for cand in candidates[:6]:
        url = cand.get("url") or ""
        meta = {}
        if url:
            try:
                meta = allocine_movie_meta(url)
            except Exception:
                meta = {}
        release_date = meta.get("allocine_release_date") or ""
        year = _year_from_date(release_date)
        out.append(
            {
                "source": "allocine",
                "title": cand.get("title") or "",
                "directors": cand.get("directors") or "",
                "release_date": release_date,
                "poster": meta.get("affiche") or "",
                "url": url,
                "popularity": None,
                "title_score": _title_score(title, cand.get("title") or ""),
                "year_ok": year in allowed_years if year is not None else False,
            }
        )
    return out


def _build_tmdb_candidates(title: str, allowed_years: set[int]) -> list[dict]:
    candidates = tmdb_search_movies(title, "fr-FR") or []
    if not candidates:
        candidates = tmdb_search_movies(title, "en-US") or []
    out = []
    for cand in candidates[:6]:
        movie_id = int(cand.get("id") or 0)
        director = _tmdb_director(movie_id, "fr-FR") if movie_id else ""
        release_date = cand.get("release_date") or ""
        year = _year_from_date(release_date)
        out.append(
            {
                "source": "tmdb",
                "title": cand.get("title") or "",
                "directors": director,
                "release_date": release_date,
                "poster": f"{TMDB_IMG_W500}{cand.get('poster_path')}" if cand.get("poster_path") else "",
                "url": "",
                "popularity": cand.get("popularity"),
                "title_score": _title_score(title, cand.get("title") or "", cand.get("original_title") or ""),
                "year_ok": year in allowed_years if year is not None else False,
            }
        )
    return out


def _best_candidate(cands: list[dict]) -> dict | None:
    if not cands:
        return None
    return max(
        cands,
        key=lambda c: (c.get("title_score") or 0.0, 1 if c.get("year_ok") else 0, c.get("popularity") or 0.0),
    )


def _auto_select(allocine_cands: list[dict], tmdb_cands: list[dict]) -> tuple[dict | None, str | None]:
    allocine_good = [c for c in allocine_cands if c.get("title_score", 0) >= MATCH_THRESHOLD and c.get("year_ok")]
    tmdb_good = [c for c in tmdb_cands if c.get("title_score", 0) >= MATCH_THRESHOLD and c.get("year_ok")]

    if len(allocine_good) > 1:
        return None, "plusieurs_allocine"

    if len(allocine_good) == 1:
        alloc = allocine_good[0]
        if tmdb_good:
            tmdb_best = _best_candidate(tmdb_good)
            if tmdb_best:
                score_dir = _director_score(alloc.get("directors", ""), tmdb_best.get("directors", ""))
                if score_dir >= MATCH_THRESHOLD:
                    return alloc, None
                return None, "realisateur_diff"
        return alloc, None

    if tmdb_good:
        return _best_candidate(tmdb_good), None

    return None, "aucun_match"


def _manual_choice(raw_cell: str, title: str, candidates: list[dict]) -> dict | None:
    if not candidates:
        return None

    def _sort_key(c):
        source_rank = 0 if c.get("source") == "allocine" else 1
        return (source_rank, -(c.get("title_score") or 0.0))

    ordered = sorted(candidates, key=_sort_key)

    print("\n[CHOIX] Ambigu?t? d?tect?e")
    print(f"  Cellule compl?te: {raw_cell!r}")
    print(f"  Titre extrait: {title!r}")
    for idx, cand in enumerate(ordered, start=1):
        pop = cand.get("popularity")
        pop_txt = f"{pop:.2f}" if isinstance(pop, (int, float)) else "n/a"
        score_txt = f"{cand.get('title_score', 0.0) * 100:.0f}%"
        print(
            f"  {idx}) [{cand['source']}] {cand.get('title')}"
            f" | date: {cand.get('release_date') or 'n/a'}"
            f" | r?al: {cand.get('directors') or 'n/a'}"
            f" | pop: {pop_txt}"
            f" | match: {score_txt}"
        )
    print("  0) Ignorer ce titre")

    while True:
        choice = input("Choisir un num?ro: ").strip()
        if choice.isdigit():
            num = int(choice)
            if num == 0:
                return None
            if 1 <= num <= len(ordered):
                return ordered[num - 1]
        print("Entr?e invalide.")


def _fetch_poster(raw_cell: str, title: str, allowed_years: set[int]) -> dict | None:
    allocine_cands = []
    tmdb_cands = []

    try:
        allocine_cands = _build_allocine_candidates(title, allowed_years)
    except Exception as exc:
        print(f"[WARN] Allocin? ?chou? pour {title!r}: {exc}")

    try:
        tmdb_cands = _build_tmdb_candidates(title, allowed_years)
    except Exception as exc:
        print(f"[WARN] TMDB ?chou? pour {title!r}: {exc}")

    # Ne garder que les candidats avec affiche
    allocine_cands = [c for c in allocine_cands if c.get("poster")]
    tmdb_cands = [c for c in tmdb_cands if c.get("poster")]

    chosen, reason = _auto_select(allocine_cands, tmdb_cands)
    if chosen:
        return chosen

    if reason == "plusieurs_allocine":
        candidates = allocine_cands + tmdb_cands
        return _manual_choice(raw_cell, title, candidates)

    if reason == "realisateur_diff":
        candidates = allocine_cands + tmdb_cands
        return _manual_choice(raw_cell, title, candidates)

    # aucun match > 90
    candidates = allocine_cands + tmdb_cands
    return _manual_choice(raw_cell, title, candidates)


def _resolve_input_path() -> Path:
    if INPUT_XLSX.exists():
        return INPUT_XLSX
    input_dir = INPUT_XLSX.parent
    if not input_dir.is_dir():
        raise SystemExit(f"[ERREUR] Fichier introuvable : {INPUT_XLSX}")
    candidates = [p for p in input_dir.glob("*.xlsx") if not p.name.startswith("~$")]
    if len(candidates) == 1:
        print(f"[INFO] source.xlsx manquant, utilisation de {candidates[0].name}")
        return candidates[0]
    if len(candidates) > 1:
        chosen = max(candidates, key=lambda p: p.stat().st_mtime)
        print(f"[WARN] source.xlsx manquant, utilisation du plus r?cent: {chosen.name}")
        return chosen
    raise SystemExit(f"[ERREUR] Aucun .xlsx trouv? dans {input_dir}")


def main() -> None:
    input_path = _resolve_input_path()

    df = pd.read_excel(input_path, sheet_name=SHEET_NAME, header=None, dtype=object)
    header_idx, col_idx = _find_prochainement_block(df)
    if header_idx is None:
        raise SystemExit("[ERREUR] Ligne 'Prochainement' introuvable.")

    raw_cell, titles = _collect_titles(df, header_idx, col_idx)

    today = date.today()
    allowed_years = {today.year, today.year - 1}

    data = []
    for title in titles:
        chosen = _fetch_poster(raw_cell, title, allowed_years)
        if not chosen:
            print(f"[WARN] Affiche introuvable pour {title!r}")
            continue
        item = {
            "poster": chosen.get("poster"),
            "alt": title,
            "source": chosen.get("source"),
        }
        if chosen.get("release_date"):
            item["release_date"] = chosen.get("release_date")
        if chosen.get("title"):
            item["title"] = chosen.get("title")
        if chosen.get("directors"):
            item["directors"] = chosen.get("directors")
        if chosen.get("popularity") is not None:
            item["popularity"] = chosen.get("popularity")
        data.append(item)

    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"[OK] ?crit : {OUTPUT_JSON} ({len(data)} affiche(s))")


if __name__ == "__main__":
    main()
