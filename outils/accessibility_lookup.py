#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Find preliminary accessibility information for the monthly film list.

Only two public sources are queried:
- Cine-Sens, for DCP accessibility, GRETA and La Bavarde;
- Tout en Parlant, for VAST.

The result is deliberately conservative. Missing information is reported as
"À vérifier" and never interpreted as proof that a device is unavailable.
"""

from __future__ import annotations

import argparse
import datetime as dt
import difflib
import html
import json
import re
import unicodedata
from collections.abc import Iterable
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

import pandas as pd
import requests


BASE_DIR = Path(__file__).resolve().parent
DEFAULT_INPUT_PATH = BASE_DIR / "work/normalized.xlsx"
DEFAULT_CACHE_PATH = BASE_DIR / "work/accessibilite_cache.json"
DEFAULT_REPORT_PATH = BASE_DIR / "work/accessibilite_report.json"

CINE_SENS_API = "https://www.cine-sens.fr/wp-json/wp/v2"
CINE_SENS_CATEGORY_SLUG = "films-accessibles"
CINE_SENS_CATEGORY_URL = (
    "https://www.cine-sens.fr/category/actualites/films-accessibles/"
)
VAST_URL = "https://www.toutenparlant.org/vast-cinema/films-en-vast"

CODE_ORDER = ("AD", "SME", "SR", "VAST", "LB", "G*")
TO_VERIFY = "À vérifier"
CACHE_VERSION = 1
HTTP_TIMEOUT_SECONDS = 20
USER_AGENT = "CineCarbonneAccessibilityLookup/1.0"

_SPACE_RE = re.compile(r"\s+")
_DEVICE_COLON_RE = re.compile(
    r"\s*:\s*(?=(?:AD\b|SME\b|ST[\s-]?SME\b|SR\b|SON\s+RENFORC))",
    re.IGNORECASE,
)
_DIRECTOR_SEPARATOR_RE = re.compile(r"\s+de\s+", re.IGNORECASE)
_DISPLAY_SUFFIX_RE = re.compile(
    r"(?:\s*-\s*SCOL(?:AIRE)?\s*|\s*\+\s*CM\d+\s*)+$",
    re.IGNORECASE,
)
_DISPLAY_PREFIX_RE = re.compile(r"^\s*CM\d+\s*[-:]\s*", re.IGNORECASE)


def _utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def _fold_text(value: object) -> str:
    text = html.unescape(str(value or ""))
    text = (
        text.replace("\u2018", "'")
        .replace("\u2019", "'")
        .replace("\u02bc", "'")
        .replace("\xa0", " ")
        .replace("\u202f", " ")
    )
    text = unicodedata.normalize("NFKD", text)
    return "".join(ch for ch in text if not unicodedata.combining(ch)).lower()


def strip_display_suffixes(value: object) -> str:
    """Remove ingest-only labels before comparing a film title."""

    text = html.unescape(str(value or "")).strip()
    text = _DISPLAY_PREFIX_RE.sub("", text)
    previous = None
    while text != previous:
        previous = text
        text = _DISPLAY_SUFFIX_RE.sub("", text).strip()
    return text


def normalize_title(value: object) -> str:
    """Normalize titles without discarding meaningful words."""

    text = strip_display_suffixes(value)
    text = _fold_text(text).replace("&", " et ")
    # Parentheses often mark an optional letter: "Parfait(s)" -> "parfaits".
    text = text.replace("(", "").replace(")", "")
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return _SPACE_RE.sub(" ", text).strip()


def normalize_person(value: object) -> str:
    text = _fold_text(value)
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return _SPACE_RE.sub(" ", text).strip()


def title_similarity(left: object, right: object) -> float:
    left_norm = normalize_title(left)
    right_norm = normalize_title(right)
    if not left_norm or not right_norm:
        return 0.0
    return difflib.SequenceMatcher(None, left_norm, right_norm).ratio()


def directors_match(expected: object, candidate: object) -> bool:
    expected_norm = normalize_person(expected)
    candidate_norm = normalize_person(candidate)
    if not expected_norm or not candidate_norm:
        return False
    if expected_norm in candidate_norm or candidate_norm in expected_norm:
        return True
    return difflib.SequenceMatcher(None, expected_norm, candidate_norm).ratio() >= 0.88


class _TextBlocksParser(HTMLParser):
    _BOUNDARY_TAGS = {
        "br",
        "div",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "li",
        "p",
        "tr",
    }

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._ignored_depth = 0

    def handle_starttag(
        self, tag: str, attrs: list[tuple[str, str | None]]
    ) -> None:
        if tag in {"script", "style"}:
            self._ignored_depth += 1
        elif not self._ignored_depth and tag in self._BOUNDARY_TAGS:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style"}:
            self._ignored_depth = max(0, self._ignored_depth - 1)
        elif not self._ignored_depth and tag in self._BOUNDARY_TAGS:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self._ignored_depth:
            self.parts.append(data)

    def blocks(self) -> list[str]:
        blocks = []
        for part in "".join(self.parts).splitlines():
            cleaned = _SPACE_RE.sub(" ", html.unescape(part)).strip()
            if cleaned:
                blocks.append(cleaned)
        return blocks


class _VastTitlesParser(HTMLParser):
    """Extract poster titles from the Wix film catalogue."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.titles: list[str] = []

    def handle_starttag(
        self, tag: str, attrs: list[tuple[str, str | None]]
    ) -> None:
        attributes = dict(attrs)
        css_class = attributes.get("class") or ""
        title = (attributes.get("title") or "").strip()
        if title and "wixui-image" in css_class:
            self.titles.append(title)


def html_blocks(content: str) -> list[str]:
    parser = _TextBlocksParser()
    parser.feed(content or "")
    return parser.blocks()


def extract_dcp_entry(line: str) -> dict[str, Any] | None:
    """Parse a Cine-Sens list item describing devices on a DCP."""

    colon = _DEVICE_COLON_RE.search(line)
    if not colon:
        return None

    left = line[: colon.start()].strip()
    devices = line[colon.end() :].strip()
    separators = list(_DIRECTOR_SEPARATOR_RE.finditer(left))
    if separators:
        separator = separators[-1]
        title = left[: separator.start()].strip()
        director = left[separator.end() :].strip()
    else:
        title = left
        director = ""

    folded_devices = _fold_text(devices)
    codes: list[str] = []
    if re.search(r"\bAD\b", devices, re.IGNORECASE):
        codes.append("AD")
    if re.search(r"\b(?:ST[\s-]?)?SME\b", devices, re.IGNORECASE):
        codes.append("SME")
    if re.search(r"\bSR\b", devices, re.IGNORECASE) or re.search(
        r"\bson\s+renforce\b", folded_devices
    ):
        codes.append("SR")
    if re.search(r"\bVAST\b", devices, re.IGNORECASE):
        codes.append("VAST")

    if not title or not codes:
        return None
    if normalize_title(title).startswith(
        ("rubrique ", "details des versions ", "la mention ")
    ):
        return None
    return {"title": title, "director": director, "codes": codes, "evidence": line}


def extract_cine_sens_post(post: dict[str, Any]) -> dict[str, Any]:
    rendered_content = post.get("content", {})
    if isinstance(rendered_content, dict):
        rendered_content = rendered_content.get("rendered", "")
    blocks = html_blocks(str(rendered_content or ""))

    entries: list[dict[str, Any]] = []
    application_sections: list[dict[str, str]] = []
    for block in blocks:
        entry = extract_dcp_entry(block)
        if entry:
            entries.append(entry)
            continue

        folded = _fold_text(block)
        if "rubrique greta" in folded:
            application_sections.append(
                {"application": "greta", "evidence": block}
            )
        elif "rubrique la bavarde" in folded:
            application_sections.append(
                {"application": "la_bavarde", "evidence": block}
            )

    source = {
        "url": str(post.get("link", "")),
        "date": str(post.get("date", ""))[:10],
        "article_title": html.unescape(
            str((post.get("title") or {}).get("rendered", ""))
            if isinstance(post.get("title"), dict)
            else str(post.get("title", ""))
        ),
    }
    for entry in entries:
        entry["source"] = source
    for section in application_sections:
        section["source"] = source
    return {"entries": entries, "application_sections": application_sections}


def parse_vast_titles(content: str) -> list[str]:
    parser = _VastTitlesParser()
    parser.feed(content or "")
    seen: set[str] = set()
    titles: list[str] = []
    for title in parser.titles:
        normalized = normalize_title(title)
        if normalized and normalized not in seen:
            seen.add(normalized)
            titles.append(title)
    return titles


def _session_get(
    session: requests.Session,
    url: str,
    *,
    params: dict[str, Any] | None = None,
) -> requests.Response:
    response = session.get(url, params=params, timeout=HTTP_TIMEOUT_SECONDS)
    response.raise_for_status()
    return response


def fetch_cine_sens(session: requests.Session) -> dict[str, Any]:
    category_response = _session_get(
        session,
        f"{CINE_SENS_API}/categories",
        params={"slug": CINE_SENS_CATEGORY_SLUG, "per_page": 20},
    )
    categories = category_response.json()
    category = next(
        (
            item
            for item in categories
            if item.get("slug") == CINE_SENS_CATEGORY_SLUG
        ),
        None,
    )
    if not category:
        raise RuntimeError(
            f"Catégorie Ciné-Sens introuvable: {CINE_SENS_CATEGORY_SLUG}"
        )

    posts: list[dict[str, Any]] = []
    page = 1
    total_pages = 1
    while page <= total_pages:
        response = _session_get(
            session,
            f"{CINE_SENS_API}/posts",
            params={
                "categories": category["id"],
                "per_page": 100,
                "page": page,
                "_fields": "date,link,title,content",
            },
        )
        posts.extend(response.json())
        total_pages = int(response.headers.get("X-WP-TotalPages", "1"))
        page += 1

    entries: list[dict[str, Any]] = []
    application_sections: list[dict[str, Any]] = []
    for post in posts:
        extracted = extract_cine_sens_post(post)
        entries.extend(extracted["entries"])
        application_sections.extend(extracted["application_sections"])

    return {
        "fetched_at": _utc_now(),
        "source_url": category.get("link") or CINE_SENS_CATEGORY_URL,
        "category_slug": CINE_SENS_CATEGORY_SLUG,
        "posts_checked": len(posts),
        "entries": entries,
        "application_sections": application_sections,
    }


def fetch_vast(session: requests.Session) -> dict[str, Any]:
    response = _session_get(session, VAST_URL)
    titles = parse_vast_titles(response.text)
    if not titles:
        raise RuntimeError("Aucun titre VAST n'a été extrait.")
    return {
        "fetched_at": _utc_now(),
        "source_url": VAST_URL,
        "titles": titles,
    }


def _read_json(path: Path) -> dict[str, Any]:
    try:
        with path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}
    return data if isinstance(data, dict) else {}


def _write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_suffix(path.suffix + ".tmp")
    with temporary_path.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    temporary_path.replace(path)


def load_catalogues(
    *,
    offline: bool = False,
    cache_path: Path = DEFAULT_CACHE_PATH,
    session: requests.Session | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Load both catalogues, falling back to the last cache per source."""

    cached = _read_json(cache_path)
    cached_sources = cached.get("sources", {})
    if not isinstance(cached_sources, dict):
        cached_sources = {}

    catalogues: dict[str, Any] = {}
    source_status: dict[str, Any] = {}
    fetchers = {"cine_sens": fetch_cine_sens, "vast": fetch_vast}
    own_session = session is None
    active_session = session or requests.Session()
    active_session.headers.update({"User-Agent": USER_AGENT})

    try:
        for name, fetcher in fetchers.items():
            cached_catalogue = cached_sources.get(name)
            if offline:
                if isinstance(cached_catalogue, dict):
                    catalogues[name] = cached_catalogue
                    source_status[name] = {
                        "status": "cache",
                        "fetched_at": cached_catalogue.get("fetched_at"),
                        "url": cached_catalogue.get("source_url"),
                    }
                else:
                    catalogues[name] = {}
                    source_status[name] = {
                        "status": "unavailable",
                        "error": "Mode hors connexion et cache absent.",
                    }
                continue

            try:
                catalogue = fetcher(active_session)
                catalogues[name] = catalogue
                source_status[name] = {
                    "status": "live",
                    "fetched_at": catalogue.get("fetched_at"),
                    "url": catalogue.get("source_url"),
                }
            except (
                requests.RequestException,
                RuntimeError,
                ValueError,
                KeyError,
                TypeError,
            ) as exc:
                if isinstance(cached_catalogue, dict):
                    catalogues[name] = cached_catalogue
                    source_status[name] = {
                        "status": "cache",
                        "fetched_at": cached_catalogue.get("fetched_at"),
                        "url": cached_catalogue.get("source_url"),
                        "live_error": str(exc),
                    }
                else:
                    catalogues[name] = {}
                    source_status[name] = {
                        "status": "unavailable",
                        "error": str(exc),
                    }
    finally:
        if own_session:
            active_session.close()

    if not offline and any(catalogues.values()):
        cacheable_catalogues = {
            name: catalogue
            for name, catalogue in catalogues.items()
            if catalogue
        }
        _write_json(
            cache_path,
            {
                "version": CACHE_VERSION,
                "updated_at": _utc_now(),
                "sources": cacheable_catalogues,
            },
        )
    return catalogues, source_status


def _unique_candidate_matches(
    title: str,
    director: str,
    candidates: Iterable[dict[str, Any]],
) -> tuple[list[dict[str, Any]], float, list[dict[str, Any]]]:
    """Return accepted records, confidence and plausible ambiguous candidates."""

    scored: list[tuple[float, dict[str, Any]]] = []
    for candidate in candidates:
        score = title_similarity(title, candidate.get("title", ""))
        if score >= 0.85:
            scored.append((score, candidate))
    if not scored:
        return [], 0.0, []

    scored.sort(key=lambda item: item[0], reverse=True)
    best_score = scored[0][0]
    exact = [
        item
        for item in scored
        if normalize_title(item[1].get("title", "")) == normalize_title(title)
    ]
    if exact:
        eligible = exact
    else:
        high_confidence = [item for item in scored if item[0] >= 0.93]
        if high_confidence:
            eligible = high_confidence
        else:
            eligible = [
                item
                for item in scored
                if directors_match(director, item[1].get("director", ""))
            ]

    if not eligible:
        return [], best_score, []

    normalized_titles = {
        normalize_title(candidate.get("title", ""))
        for _, candidate in eligible
    }
    if len(normalized_titles) != 1:
        ambiguous = [
            {
                "title": candidate.get("title", ""),
                "director": candidate.get("director", ""),
                "confidence": round(score, 3),
            }
            for score, candidate in eligible
        ]
        return [], best_score, ambiguous

    selected_title = next(iter(normalized_titles))
    accepted = [
        candidate
        for _, candidate in eligible
        if normalize_title(candidate.get("title", "")) == selected_title
    ]

    if best_score < 0.93:
        accepted = [
            candidate
            for candidate in accepted
            if directors_match(director, candidate.get("director", ""))
        ]
        if not accepted:
            return [], best_score, []

    director_variants = {
        normalize_person(candidate.get("director", ""))
        for candidate in accepted
        if normalize_person(candidate.get("director", ""))
    }
    if len(director_variants) > 1:
        matching_director = [
            candidate
            for candidate in accepted
            if directors_match(director, candidate.get("director", ""))
        ]
        matching_variants = {
            normalize_person(candidate.get("director", ""))
            for candidate in matching_director
            if normalize_person(candidate.get("director", ""))
        }
        if len(matching_variants) == 1:
            accepted = matching_director
        else:
            ambiguous = [
                {
                    "title": candidate.get("title", ""),
                    "director": candidate.get("director", ""),
                    "confidence": round(best_score, 3),
                }
                for candidate in accepted
            ]
            return [], best_score, ambiguous
    return accepted, best_score, []


def _section_candidates(section: dict[str, Any]) -> list[dict[str, Any]]:
    evidence = str(section.get("evidence", ""))
    _, separator, listed_titles = evidence.partition(":")
    if not separator:
        return []
    return [
        {
            "title": title.strip(" .;"),
            "director": "",
            "section": section,
        }
        for title in listed_titles.split(",")
        if title.strip(" .;")
    ]


def _find_application_sections(
    title: str,
    application: str,
    sections: Iterable[dict[str, Any]],
) -> tuple[list[dict[str, Any]], float, list[dict[str, Any]]]:
    target = normalize_title(title)
    relevant = [
        section
        for section in sections
        if section.get("application") == application
    ]

    exact_sections = []
    for section in relevant:
        candidates = _section_candidates(section)
        if any(normalize_title(item["title"]) == target for item in candidates):
            exact_sections.append(section)
            continue
        # This also handles the rare title containing a comma.
        normalized_evidence = normalize_title(
            str(section.get("evidence", "")).partition(":")[2]
        )
        if target and re.search(rf"(?:^| ){re.escape(target)}(?:$| )", normalized_evidence):
            exact_sections.append(section)
    if exact_sections:
        return exact_sections, 1.0, []

    candidates = [
        item for section in relevant for item in _section_candidates(section)
    ]
    matches, confidence, ambiguous = _unique_candidate_matches(
        title, "", candidates
    )
    matched_sections = []
    seen: set[tuple[str, str]] = set()
    for match in matches:
        section = match["section"]
        source = section.get("source", {})
        key = (str(source.get("url", "")), str(section.get("evidence", "")))
        if key not in seen:
            seen.add(key)
            matched_sections.append(section)
    return matched_sections, confidence, ambiguous


def _source_evidence(
    source_name: str,
    source: dict[str, Any],
    evidence: str,
    codes: Iterable[str],
    confidence: float,
) -> dict[str, Any]:
    code_set = set(codes)
    return {
        "source": source_name,
        "url": source.get("url") or source.get("source_url"),
        "date": source.get("date"),
        "evidence": evidence,
        "codes": [code for code in CODE_ORDER if code in code_set],
        "confidence": round(confidence, 3),
    }


def resolve_film(
    title: str,
    director: str,
    catalogues: dict[str, Any],
) -> dict[str, Any]:
    codes: set[str] = set()
    sources: list[dict[str, Any]] = []
    ambiguous: list[dict[str, Any]] = []
    confidences: list[float] = []

    cine_sens = catalogues.get("cine_sens") or {}
    dcp_matches, dcp_confidence, dcp_ambiguous = _unique_candidate_matches(
        title, director, cine_sens.get("entries", [])
    )
    ambiguous.extend(dcp_ambiguous)
    for match in dcp_matches:
        match_codes = set(match.get("codes", []))
        codes.update(match_codes)
        confidences.append(dcp_confidence)
        sources.append(
            _source_evidence(
                "Ciné-Sens",
                match.get("source", {}),
                str(match.get("evidence", "")),
                match_codes,
                dcp_confidence,
            )
        )

    sections = cine_sens.get("application_sections", [])
    for application, code, label in (
        ("la_bavarde", "LB", "Ciné-Sens / La Bavarde"),
        ("greta", "G*", "Ciné-Sens / GRETA"),
    ):
        matches, confidence, section_ambiguous = _find_application_sections(
            title, application, sections
        )
        ambiguous.extend(section_ambiguous)
        for section in matches:
            codes.add(code)
            confidences.append(confidence)
            sources.append(
                _source_evidence(
                    label,
                    section.get("source", {}),
                    str(section.get("evidence", "")),
                    [code],
                    confidence,
                )
            )

    vast = catalogues.get("vast") or {}
    vast_candidates = [
        {
            "title": candidate,
            "director": "",
            "source": {
                "source_url": vast.get("source_url"),
                "date": None,
            },
            "evidence": candidate,
            "codes": ["VAST"],
        }
        for candidate in vast.get("titles", [])
    ]
    vast_matches, vast_confidence, vast_ambiguous = _unique_candidate_matches(
        title, "", vast_candidates
    )
    ambiguous.extend(vast_ambiguous)
    for match in vast_matches:
        codes.add("VAST")
        confidences.append(vast_confidence)
        sources.append(
            _source_evidence(
                "Tout en Parlant / VAST",
                match.get("source", {}),
                str(match.get("evidence", "")),
                ["VAST"],
                vast_confidence,
            )
        )

    ordered_codes = [code for code in CODE_ORDER if code in codes]
    if ordered_codes:
        output = " ".join(ordered_codes)
        status = "found"
    else:
        output = TO_VERIFY
        status = "ambiguous" if ambiguous else "to_verify"

    return {
        "title": title,
        "director": director,
        "output": output,
        "status": status,
        "codes": ordered_codes,
        "confidence": round(max(confidences), 3) if confidences else 0.0,
        "sources": sources,
        "ambiguous_candidates": ambiguous,
    }


def _film_key(title: object, director: object = "") -> tuple[str, str]:
    return normalize_title(title), normalize_person(director)


def lookup_films(
    films: Iterable[dict[str, Any]],
    *,
    offline: bool = False,
    cache_path: Path = DEFAULT_CACHE_PATH,
    report_path: Path = DEFAULT_REPORT_PATH,
    session: requests.Session | None = None,
) -> tuple[dict[tuple[str, str], str], dict[str, Any]]:
    catalogues, source_status = load_catalogues(
        offline=offline, cache_path=cache_path, session=session
    )

    unique_films: dict[tuple[str, str], dict[str, str]] = {}
    for film in films:
        title = strip_display_suffixes(film.get("title", ""))
        director = str(film.get("director", "") or "").strip()
        key = _film_key(title, director)
        if key[0] and key not in unique_films:
            unique_films[key] = {"title": title, "director": director}

    results = [
        resolve_film(film["title"], film["director"], catalogues)
        for film in unique_films.values()
    ]
    mapping = {
        _film_key(result["title"], result["director"]): result["output"]
        for result in results
    }
    report = {
        "generated_at": _utc_now(),
        "offline": offline,
        "legend": {
            "AD": "Audiodescription présente dans les informations Ciné-Sens.",
            "SME": "Sous-titres sourds et malentendants signalés par Ciné-Sens.",
            "SR": "Son renforcé signalé par Ciné-Sens.",
            "VAST": "Film présent dans la liste VAST de Tout en Parlant.",
            "LB": "Film présent dans la rubrique La Bavarde de Ciné-Sens.",
            "G*": (
                "Film présent dans la rubrique GRETA de Ciné-Sens; "
                "Ciné Carbonne n'est pas abonné."
            ),
            TO_VERIFY: (
                "Aucune information suffisamment fiable n'a été trouvée; "
                "cela ne prouve pas l'absence de dispositif."
            ),
        },
        "sources": source_status,
        "films": results,
    }
    _write_json(report_path, report)
    return mapping, report


def accessibility_for(
    mapping: dict[tuple[str, str], str],
    title: object,
    director: object = "",
) -> str:
    key = _film_key(title, director)
    if key in mapping:
        return mapping[key]

    # Directors may be missing from CM source cells; reuse a unique title match.
    title_matches = {
        value for (candidate_title, _), value in mapping.items() if candidate_title == key[0]
    }
    if len(title_matches) == 1:
        return next(iter(title_matches))
    return TO_VERIFY


def read_films_from_workbook(path: Path) -> list[dict[str, str]]:
    frame = pd.read_excel(path, sheet_name=0, dtype=object).fillna("")
    if "Titre" not in frame.columns:
        raise ValueError(f"Colonne Titre absente de {path}")
    director_column = next(
        (
            column
            for column in ("Realisateur", "Réalisateur", "realisateur")
            if column in frame.columns
        ),
        None,
    )
    films = []
    for _, row in frame.iterrows():
        films.append(
            {
                "title": str(row.get("Titre", "")).strip(),
                "director": (
                    str(row.get(director_column, "")).strip()
                    if director_column
                    else ""
                ),
            }
        )
    return films


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Recherche les dispositifs d'accessibilité des films."
    )
    parser.add_argument(
        "--input",
        type=Path,
        default=DEFAULT_INPUT_PATH,
        help="Classeur normalisé à analyser.",
    )
    parser.add_argument(
        "--cache",
        type=Path,
        default=DEFAULT_CACHE_PATH,
        help="Cache local des deux sources.",
    )
    parser.add_argument(
        "--report",
        type=Path,
        default=DEFAULT_REPORT_PATH,
        help="Rapport JSON détaillé.",
    )
    parser.add_argument(
        "--offline",
        action="store_true",
        help="N'utilise que le dernier cache disponible.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    films = read_films_from_workbook(args.input)
    _, report = lookup_films(
        films,
        offline=args.offline,
        cache_path=args.cache,
        report_path=args.report,
    )
    found = sum(item["status"] == "found" for item in report["films"])
    to_verify = len(report["films"]) - found
    print(
        f"OK: {len(report['films'])} film(s), "
        f"{found} renseigné(s), {to_verify} à vérifier."
    )
    print(f"Rapport: {args.report}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
