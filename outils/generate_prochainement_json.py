#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Generate prochainement.json from upcoming movie titles.

Input priority:
1) extract list from outils/input/source.xlsx (zone "prochainement")
2) fallback: outils/input/prochainement_titles.json
3) fallback: existing prochainement.json when it still contains titles

Output:
- prochainement.json with poster URLs (no local image files required)
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import enrich_3_0 as enrich
import normalize as norm
import pandas as pd

TOOLS_DIR = Path(__file__).resolve().parent
SITE_DIR = TOOLS_DIR.parent
INPUT_TITLES = TOOLS_DIR / "input" / "prochainement_titles.json"
OUTPUT_JSON = SITE_DIR / "prochainement.json"
SOURCE_XLSX = TOOLS_DIR / "input" / "source.xlsx"
WORK_PROCHAINEMENT = TOOLS_DIR / "work" / "prochainement.json"


@dataclass
class PosterCandidate:
    source: str
    poster_url: str
    release_date: str
    match_score: float
    matched_title: str
    ref: str


def _normalize_date(value: str) -> str:
    text = str(value or "").strip()
    match = re.match(r"^(\d{4})", text)
    if not match:
        return ""
    year = match.group(1)
    if re.match(r"^\d{4}-\d{2}-\d{2}$", text):
        return text
    return f"{year}-01-01"


def _split_title_blob(value: str) -> list[str]:
    text = str(value or "").strip()
    if not text:
        return []
    parts = re.split(r"[,;\n]+", text)
    titles = []
    for part in parts:
        cleaned = re.sub(r"\s+", " ", part).strip(" .\t\r\n")
        cleaned = _fix_mojibake(cleaned)
        if cleaned:
            titles.append(cleaned)
    return titles


def _fix_mojibake(value: str) -> str:
    text = str(value or "")
    if not text:
        return ""
    if all(token not in text for token in ("Ã", "Â", "â€™", "â€“", "â€”")):
        return text
    try:
        repaired = text.encode("latin-1").decode("utf-8")
        return repaired
    except Exception:
        return text


def _extract_titles(payload: Any) -> list[str]:
    titles: list[str] = []

    def _collect(value: Any) -> None:
        if isinstance(value, str):
            titles.extend(_split_title_blob(value))
            return
        if isinstance(value, dict):
            for key in ("title", "titre", "name", "film"):
                if isinstance(value.get(key), str):
                    titles.extend(_split_title_blob(value.get(key)))
                    return
            for key in ("titles", "titres", "items", "films", "movies"):
                if key in value:
                    _collect(value.get(key))
                    return
            return
        if isinstance(value, list):
            for item in value:
                _collect(item)

    _collect(payload)

    deduped: list[str] = []
    seen: set[str] = set()
    for title in titles:
        key = enrich.normalize_for_match(title)
        if key and key not in seen:
            seen.add(key)
            deduped.append(title)
    return deduped


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _extract_upcoming_blocks_from_source() -> list[str]:
    if not SOURCE_XLSX.exists():
        return []
    try:
        raw = pd.read_excel(
            SOURCE_XLSX,
            sheet_name=norm.SHEET_NAME,
            header=None,
            dtype=object,
        )
    except Exception:
        try:
            raw = pd.read_excel(
                SOURCE_XLSX,
                sheet_name=0,
                header=None,
                dtype=object,
            )
        except Exception:
            return []

    index_list = list(raw.index)
    blocks: list[str] = []

    for pos, idx in enumerate(index_list):
        row = raw.loc[idx]
        a = row.get(norm.COL_A)
        b = row.get(norm.COL_B)
        title_cell = row.get(norm.COL_TITRE)
        title = norm.norm_str(title_cell)
        if not title:
            continue

        has_weekday = norm.is_weekday_label(a)
        has_date = norm.parse_date_cell(b) is not None
        if "prochainement" not in title.lower() or has_weekday or has_date:
            continue

        next_pos = pos + 1
        if next_pos >= len(index_list):
            continue
        next_idx = index_list[next_pos]
        next_row = raw.loc[next_idx]
        next_title = norm.norm_str(next_row.get(norm.COL_TITRE))
        if next_title:
            blocks.append(_fix_mojibake(next_title))

    return blocks


def _write_titles_input(titles: list[str], origin: str) -> None:
    INPUT_TITLES.parent.mkdir(parents=True, exist_ok=True)
    INPUT_TITLES.write_text(
        json.dumps({"titles": titles}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"[info] titres mis a jour depuis {origin}: {INPUT_TITLES}")


def load_titles() -> list[str]:
    source_blocks = _extract_upcoming_blocks_from_source()
    if source_blocks:
        WORK_PROCHAINEMENT.parent.mkdir(parents=True, exist_ok=True)
        WORK_PROCHAINEMENT.write_text(
            json.dumps(source_blocks, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        titles = _extract_titles(source_blocks)
        if titles:
            _write_titles_input(titles, "source.xlsx")
            return titles

    if INPUT_TITLES.exists():
        titles = _extract_titles(_read_json(INPUT_TITLES))
        if titles:
            return titles

    if OUTPUT_JSON.exists():
        titles = _extract_titles(_read_json(OUTPUT_JSON))
        if titles:
            _write_titles_input(titles, "prochainement.json")
            return titles

    raise SystemExit(
        "Aucun titre trouve (source.xlsx / prochainement_titles.json / prochainement.json). Cree d'abord "
        f"{INPUT_TITLES} avec une liste de titres."
    )


def _load_env() -> None:
    for env_path in (TOOLS_DIR / ".env", SITE_DIR / ".env"):
        if env_path.exists():
            enrich.load_env_file(env_path)


def _allocine_candidate(title: str) -> PosterCandidate | None:
    try:
        result = enrich.allocine_find_movie(title, "")
    except Exception:
        return None

    match = (result or {}).get("match") or {}
    url = str(match.get("url") or "").strip()
    if not url:
        return None

    score = float(match.get("score") or 0.0)
    matched_title = _fix_mojibake(str(match.get("title") or title).strip())
    poster_url = ""
    release_date = ""

    try:
        resp = enrich.allocine_get(url)
        html_text = resp.text or ""
        poster_url = enrich._allocine_extract_og_image(html_text) or enrich._allocine_extract_affiche_thumbnail(
            html_text
        )
        release_date = enrich._allocine_parse_release_date(html_text) or ""
    except Exception:
        poster_url = ""

    if not poster_url:
        try:
            poster_url = enrich.allocine_affiche_url(url)
        except Exception:
            poster_url = ""

    if not poster_url:
        return None

    return PosterCandidate(
        source="allocine",
        poster_url=poster_url,
        release_date=_normalize_date(release_date),
        match_score=score,
        matched_title=matched_title,
        ref=url,
    )


def _tmdb_candidate(title: str) -> PosterCandidate | None:
    api_key = str(os.environ.get("TMDB_API_KEY", "") or "").strip()
    if not api_key:
        return None

    used_lang = enrich.TMDB_LANG_DEFAULT
    try:
        result = enrich.tmdb_find_movie(title, "", used_lang)
        match = (result or {}).get("match") or {}
        if not match:
            used_lang = "en-US"
            result = enrich.tmdb_find_movie(title, "", used_lang)
            match = (result or {}).get("match") or {}
    except Exception:
        return None

    if not match:
        return None

    movie_id = int(match.get("id") or 0)
    if movie_id <= 0:
        return None

    score = float(match.get("score") or 0.0)
    matched_title = _fix_mojibake(str(match.get("title") or match.get("original_title") or title).strip())
    release_date = _normalize_date(str(match.get("release_date") or ""))
    poster_path = str(match.get("poster_path") or "").strip()

    try:
        details = enrich.tmdb_get_details(movie_id, used_lang)
        if details.get("release_date"):
            release_date = _normalize_date(str(details.get("release_date")))
        if details.get("poster_path"):
            poster_path = str(details.get("poster_path"))
    except Exception:
        pass

    if not poster_path:
        return None

    poster_url = f"https://image.tmdb.org/t/p/w780{poster_path}"
    return PosterCandidate(
        source="tmdb",
        poster_url=poster_url,
        release_date=release_date,
        match_score=score,
        matched_title=matched_title,
        ref=str(movie_id),
    )


def choose_best(title: str, allocine: PosterCandidate | None, tmdb: PosterCandidate | None) -> PosterCandidate | None:
    if allocine and not tmdb:
        return allocine
    if tmdb and not allocine:
        return tmdb
    if not allocine and not tmdb:
        return None

    assert allocine is not None and tmdb is not None

    score_diff = abs(allocine.match_score - tmdb.match_score)
    if score_diff <= 0.12:
        a_date = allocine.release_date or "0000-00-00"
        t_date = tmdb.release_date or "0000-00-00"
        if t_date > a_date:
            return tmdb
        return allocine

    if tmdb.match_score > allocine.match_score:
        return tmdb
    return allocine


def build_output_items(titles: list[str]) -> tuple[list[dict[str, Any]], list[str]]:
    output: list[dict[str, Any]] = []
    missing: list[str] = []

    for idx, title in enumerate(titles, start=1):
        print(f"[{idx}/{len(titles)}] {title}")
        allocine = _allocine_candidate(title)
        tmdb = _tmdb_candidate(title)
        chosen = choose_best(title, allocine, tmdb)

        if not chosen:
            missing.append(title)
            continue

        output.append(
            {
                "title": title,
                "poster": chosen.poster_url,
                "alt": f"Affiche de {title}",
                "source": chosen.source,
                "match_title": chosen.matched_title,
                "release_date": chosen.release_date,
                "match_score": round(chosen.match_score, 4),
            }
        )

    return output, missing


def main() -> int:
    _load_env()
    titles = load_titles()
    items, missing = build_output_items(titles)

    OUTPUT_JSON.write_text(
        json.dumps(items, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(f"[done] ecrit {OUTPUT_JSON} ({len(items)} affiche(s))")
    if missing:
        print(f"[warn] {len(missing)} titre(s) sans affiche: {', '.join(missing)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
