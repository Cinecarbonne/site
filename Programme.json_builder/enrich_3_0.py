#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
enrich_3_0.py
Pseudocode-first version.
We will replace each step with real code progressively.
"""

import base64
import difflib
import html
import json
import os
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import quote_plus
from typing import Optional

import pandas as pd
import re
import requests
import unicodedata


def log_step(text: str) -> None:
    print(f"- {text}", flush=True)


def load_env_file(path: Path) -> None:
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            os.environ[key] = value


def _normalize_text(value: str) -> str:
    text = str(value or "").lower()
    text = unicodedata.normalize("NFKD", text)
    return "".join(c for c in text if not unicodedata.combining(c))


def _has_cineclub_or_patrimoine(categorie: str, commentaire: str) -> bool:
    text = _normalize_text(f"{categorie} {commentaire}")
    compact = re.sub(r"[^a-z0-9]+", "", text)
    if "cineclub" in compact:
        return True
    return "patrimoine" in text


ALLOCINE_BASE_URL = "https://www.allocine.fr"
ALLOCINE_SEARCH_URL = "https://www.allocine.fr/rechercher/"
ALLOCINE_TIMEOUT = 12
ALLOCINE_MATCH_THRESHOLD = 0.85
ALLOCINE_WEIGHT_TITLE = 0.70
ALLOCINE_WEIGHT_DIRECTOR = 0.30
ALLOCINE_MAX_WORKERS = 6
ALLOCINE_SESSION = requests.Session()
ALLOCINE_SESSION.headers.update(
    {
        "User-Agent": "CineCarbonne/1.0",
        "Accept-Language": "fr-FR,fr;q=0.9",
    }
)

TMDB_BASE_URL = "https://api.themoviedb.org/3"
TMDB_TIMEOUT = 12
TMDB_LANG_DEFAULT = "fr-FR"
TMDB_MATCH_THRESHOLD = 0.70
TMDB_WEIGHT_TITLE = 0.80
TMDB_WEIGHT_DIRECTOR = 0.20
TMDB_CANDIDATE_LIMIT = 25
TMDB_DIRECTOR_ACCEPT_THRESHOLD = 0.90
TMDB_MAX_WORKERS = 6
TMDB_SESSION = requests.Session()
TMDB_SESSION.headers.update({"User-Agent": "CineCarbonne/1.0"})

CROSS_MATCH_TITLE_THRESHOLD = 0.85
CROSS_MATCH_DIRECTOR_THRESHOLD = 0.85


def normalize_for_match(text: str) -> str:
    text = _normalize_text(text)
    text = text.replace("-", " ")
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _strip_tags(value: str) -> str:
    return re.sub(r"<[^>]+>", " ", value or "")


def _clean_html_text(value: str) -> str:
    text = html.unescape(_strip_tags(value))
    return re.sub(r"\s+", " ", text).strip()


def _allocine_decode_obfuscated(token: str) -> str:
    if not token or not token.startswith("ACr"):
        return ""
    try:
        raw = token.replace("ACr", "")
        return base64.b64decode(raw).decode("utf-8")
    except Exception:
        return ""


def _image_key(url: str) -> str:
    if not url:
        return ""
    base = url.split("?", 1)[0].strip()
    return base.rsplit("/", 1)[-1].lower()


def _allocine_extract_og_image(html_text: str) -> str:
    match = re.search(
        r'<meta[^>]+property="og:image"[^>]+content="([^"]+)"',
        html_text,
        flags=re.IGNORECASE,
    )
    if not match:
        match = re.search(
            r'<meta[^>]+name="twitter:image"[^>]+content="([^"]+)"',
            html_text,
            flags=re.IGNORECASE,
        )
    return match.group(1) if match else ""


def _allocine_extract_affiche_thumbnail(html_text: str) -> str:
    card = re.search(
        r'<div[^>]*class="[^"]*entity-card-player-ovw[^"]*"[^>]*>.*?</div>\s*</div>',
        html_text,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if not card:
        return ""
    match = re.search(
        r'<img[^>]*class="[^"]*thumbnail-img[^"]*"[^>]*(?:src|data-src)="([^"]+)"',
        card.group(0),
        flags=re.IGNORECASE,
    )
    return match.group(1) if match else ""


def _allocine_parse_release_date(html_text: str) -> str:
    card = re.search(
        r'<div[^>]*class="[^"]*entity-card-player-ovw[^"]*"[^>]*>.*?</div>\s*</div>',
        html_text,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if not card:
        return ""
    match = re.search(
        r'<span[^>]*class="[^"]*date[^"]*"[^>]*>(.*?)</span>',
        card.group(0),
        flags=re.IGNORECASE | re.DOTALL,
    )
    if not match:
        return ""
    raw = _clean_html_text(match.group(1))
    return _parse_french_date(raw)


def _allocine_parse_countries(html_text: str) -> str:
    match = re.search(
        r'Nationalit[^<]*</span>\s*<span class="that">(.*?)</span>',
        html_text,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if not match:
        return ""
    block = match.group(1)
    names = re.findall(
        r'<span[^>]*class="[^"]*nationality[^"]*"[^>]*>(.*?)</span>',
        block,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if not names:
        names = re.findall(r"<span[^>]*>(.*?)</span>", block, flags=re.IGNORECASE | re.DOTALL)
    cleaned = [_clean_html_text(n) for n in names if _clean_html_text(n)]
    return ", ".join(cleaned)


def _allocine_parse_json_ld(html_text: str) -> dict:
    scripts = re.findall(
        r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>',
        html_text,
        flags=re.IGNORECASE | re.DOTALL,
    )
    for raw in scripts:
        try:
            data = json.loads(raw)
        except Exception:
            continue
        if isinstance(data, list):
            for item in data:
                if isinstance(item, dict) and item.get("@type") == "Movie":
                    return item
        if isinstance(data, dict) and data.get("@type") == "Movie":
            return data
    return {}


def allocine_awards(allocine_url: str) -> list[str]:
    film_id = extract_allocine_film_id(allocine_url)
    if not film_id:
        return []
    awards_url = f"{ALLOCINE_BASE_URL}/film/fichefilm-{film_id}/palmares/"
    resp = ALLOCINE_SESSION.get(awards_url, timeout=ALLOCINE_TIMEOUT)
    if resp.status_code != 200:
        return []
    html_text = resp.text
    starts = [m.start() for m in re.finditer(r'<div class="awards mdl">', html_text)]
    blocks = []
    for i, start in enumerate(starts):
        end = starts[i + 1] if i + 1 < len(starts) else len(html_text)
        blocks.append(html_text[start:end])
    results = []

    def is_nomination(text: str) -> bool:
        norm = normalize_for_match(text)
        return "nomme" in norm or "nomination" in norm or "nominee" in norm

    def is_prize_status(text: str) -> bool:
        norm = normalize_for_match(text)
        return "prix" in norm or "palme" in norm or "laureat" in norm or "gagnant" in norm

    def strip_edition(text: str) -> str:
        cleaned = re.sub(r"\(\s*(?:edition|édition)\s*\d+\s*\)", "", text, flags=re.IGNORECASE)
        cleaned = re.sub(r"\(\s*(?:edition|édition)\s*\)", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\b(?:edition|édition)\s*\d+\b", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\(\s*\)", "", cleaned)
        cleaned = re.sub(r"\s{2,}", " ", cleaned).strip()
        return cleaned

    for block in blocks:
        title_match = re.search(
            r'card-awards-link[^>]*>(.*?)</span>',
            block,
            flags=re.IGNORECASE | re.DOTALL,
        )
        title_text = _clean_html_text(title_match.group(1)) if title_match else ""
        title_text = strip_edition(title_text)
        row_starts = [m.start() for m in re.finditer(r'<div class="table-award-row">', block)]
        categories = []
        for i, start in enumerate(row_starts):
            end = row_starts[i + 1] if i + 1 < len(row_starts) else len(block)
            row = block[start:end]
            status_match = re.search(
                r'class="awards-[^"]+"[^>]*>([^<]+)',
                row,
                flags=re.IGNORECASE | re.DOTALL,
            )
            status_text = _clean_html_text(status_match.group(1)) if status_match else ""
            if status_text and is_nomination(status_text):
                continue
            if not status_text or not is_prize_status(status_text):
                continue
            row_categories = re.findall(
                r'<div class="item">(.*?)</div>',
                row,
                flags=re.IGNORECASE | re.DOTALL,
            )
            row_categories = [_clean_html_text(c) for c in row_categories]
            row_categories = [c for c in row_categories if c]
            if row_categories:
                cat = row_categories[0]
                if cat not in categories:
                    categories.append(cat)
        if title_text and categories:
            results.append(f"{title_text}: {', '.join(categories)}")
    return results


def _clean_image_url(value: str) -> str:
    if not value:
        return ""
    if isinstance(value, dict):
        return _clean_image_url(value.get("url") or value.get("@id") or "")
    if isinstance(value, list):
        for item in value:
            cleaned = _clean_image_url(item)
            if cleaned:
                return cleaned
        return ""
    text = str(value).strip()
    if not text:
        return ""
    if text.startswith("{") and "\"url\"" in text:
        try:
            payload = json.loads(text)
        except Exception:
            payload = None
        if isinstance(payload, dict):
            return _clean_image_url(payload.get("url") or payload.get("@id") or "")
    if text.startswith("http://") or text.startswith("https://"):
        return text
    match = re.search(r"https?://[^\s\"']+", text)
    return match.group(0) if match else ""


def _parse_iso_duration_minutes(value: str) -> int:
    if not value:
        return 0
    match = re.match(r"^PT(?:(\d+)H)?(?:(\d+)M)?", value)
    if not match:
        return 0
    hours = int(match.group(1) or 0)
    mins = int(match.group(2) or 0)
    return (hours * 60) + mins


def _parse_iso_date(value: str):
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return datetime.strptime(text, "%Y-%m-%d").date()
    except Exception:
        return None


def _parse_french_date(value: str) -> str:
    text = normalize_for_match(value)
    if not text:
        return ""
    match = re.search(r"(\d{1,2})/(\d{1,2})/(\d{4})", text)
    if match:
        day, month, year = match.groups()
        return f"{year}-{int(month):02d}-{int(day):02d}"
    match = re.search(r"(\d{1,2})\s+([a-z]+)\s+(\d{4})", text)
    if not match:
        return ""
    day, month_name, year = match.groups()
    months = {
        "janvier": 1,
        "fevrier": 2,
        "mars": 3,
        "avril": 4,
        "mai": 5,
        "juin": 6,
        "juillet": 7,
        "aout": 8,
        "septembre": 9,
        "octobre": 10,
        "novembre": 11,
        "decembre": 12,
    }
    month = months.get(month_name)
    if not month:
        return ""
    return f"{year}-{month:02d}-{int(day):02d}"


def _join_list(value) -> str:
    if isinstance(value, list):
        return ", ".join([str(v) for v in value if v])
    return str(value or "")


def _split_list(value) -> list[str]:
    if not value:
        return []
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    text = str(value)
    items = [v.strip() for v in text.split(",")]
    return [v for v in items if v]


def _merge_list_pref_allocine(allocine_val, tmdb_val) -> list[str]:
    left = _split_list(allocine_val)
    right = _split_list(tmdb_val)
    seen = {normalize_for_match(item) for item in left}
    merged = list(left)
    for item in right:
        key = normalize_for_match(item)
        if key and key not in seen:
            seen.add(key)
            merged.append(item)
    return merged


def _allocine_fullsize_photo_url(url: str) -> str:
    if not url:
        return ""
    cleaned = _clean_image_url(url)
    if cleaned.startswith("//"):
        cleaned = f"https:{cleaned}"
    cleaned = re.sub(r"/[cr]_\d+_\d+", "", cleaned)
    return cleaned


def _allocine_extract_shot_urls(html_text: str) -> list[str]:
    sections = re.findall(
        r'<section[^>]*class="[^"]*section-movie-photo[^"]*"[^>]*>.*?</section>',
        html_text,
        flags=re.IGNORECASE | re.DOTALL,
    )
    content_blocks = []
    for section in sections:
        title_match = re.search(
            r'<h2[^>]*class="[^"]*titlebar[^"]*"[^>]*>(.*?)</h2>',
            section,
            flags=re.IGNORECASE | re.DOTALL,
        )
        title_text = _clean_html_text(title_match.group(1)) if title_match else ""
        title_norm = normalize_for_match(title_text)
        if not title_norm:
            continue
        if "plus de photos" in title_norm:
            continue
        if "affiche" in title_norm:
            continue
        if "photo" not in title_norm:
            continue
        content_blocks.append(section)
    content = "\n".join(content_blocks) if content_blocks else ""
    tags = re.findall(
        r'<img[^>]*class="[^"]*shot-img[^"]*"[^>]*>',
        content,
        flags=re.IGNORECASE,
    )
    urls = []
    for tag in tags:
        match = re.search(r'data-src="([^"]+)"', tag, flags=re.IGNORECASE)
        if not match:
            match = re.search(r'src="([^"]+)"', tag, flags=re.IGNORECASE)
        if match:
            url = match.group(1)
            if url and "acsta.net" in url:
                urls.append(url)
    return urls


def extract_allocine_film_id(allocine_url: str) -> str:
    match = re.search(r"cfilm=(\d+)", allocine_url or "")
    if match:
        return match.group(1)
    match = re.search(r"fichefilm-(\d+)", allocine_url or "")
    return match.group(1) if match else ""


def allocine_affiche_url(allocine_url: str) -> str:
    if not allocine_url:
        return ""
    resp = ALLOCINE_SESSION.get(allocine_url, timeout=ALLOCINE_TIMEOUT)
    resp.raise_for_status()
    html_text = resp.text
    thumb_url = _allocine_extract_affiche_thumbnail(html_text)
    og_url = _allocine_extract_og_image(html_text)
    if thumb_url and og_url:
        if _image_key(thumb_url) == _image_key(og_url):
            return _clean_image_url(thumb_url)
        return _clean_image_url(og_url)
    return _clean_image_url(thumb_url or og_url or "")


def allocine_movie_meta(allocine_url: str) -> dict:
    if not allocine_url:
        return {}
    resp = ALLOCINE_SESSION.get(allocine_url, timeout=ALLOCINE_TIMEOUT)
    resp.raise_for_status()
    html_text = resp.text

    data = _allocine_parse_json_ld(html_text)
    title = _clean_html_text(data.get("name") or "")
    alt_title = _clean_html_text(data.get("alternateName") or "")
    directors_raw = data.get("director") or []
    directors = []
    if isinstance(directors_raw, dict):
        name = directors_raw.get("name") or ""
        if name:
            directors.append(name)
    elif isinstance(directors_raw, list):
        for item in directors_raw:
            if isinstance(item, dict):
                name = item.get("name") or ""
                if name:
                    directors.append(name)
            elif isinstance(item, str):
                directors.append(item)
    directors = [d for d in directors if d]
    directors_str = ", ".join(directors)

    synopsis = _clean_html_text(data.get("description") or "")
    genres_raw = data.get("genre") or []
    if isinstance(genres_raw, str):
        genres = [genres_raw]
    elif isinstance(genres_raw, list):
        genres = [g for g in genres_raw if isinstance(g, str)]
    else:
        genres = []
    runtime_min = _parse_iso_duration_minutes(data.get("duration") or "")
    actors_raw = data.get("actor") or []
    actors = []
    if isinstance(actors_raw, list):
        for item in actors_raw:
            if isinstance(item, dict):
                name = item.get("name") or ""
                if name:
                    actors.append(name)
            elif isinstance(item, str):
                actors.append(item)
    actors = [a for a in actors if a][:8]

    thumb_url = _allocine_extract_affiche_thumbnail(html_text)
    og_url = _allocine_extract_og_image(html_text)
    if thumb_url and og_url:
        if _image_key(thumb_url) == _image_key(og_url):
            affiche = _clean_image_url(thumb_url)
        else:
            affiche = _clean_image_url(og_url)
    else:
        affiche = _clean_image_url(thumb_url or og_url or "")

    release_date = _allocine_parse_release_date(html_text)
    countries = _allocine_parse_countries(html_text)
    awards = allocine_awards(allocine_url)

    return {
        "affiche": affiche,
        "allocine_title": title or alt_title,
        "allocine_alt_title": alt_title,
        "allocine_directors": directors_str,
        "allocine_release_date": release_date,
        "allocine_synopsis": synopsis,
        "allocine_genres": genres,
        "allocine_duree_min": str(runtime_min) if runtime_min else "",
        "allocine_pays": countries,
        "allocine_acteurs": ", ".join(actors),
        "allocine_recompenses": awards,
    }


def allocine_photo_urls(allocine_url: str, poster_url: str) -> list[str]:
    film_id = extract_allocine_film_id(allocine_url)
    if not film_id:
        return []
    page_url = f"{ALLOCINE_BASE_URL}/film/fichefilm-{film_id}/photos/"
    resp = ALLOCINE_SESSION.get(page_url, timeout=ALLOCINE_TIMEOUT)
    resp.raise_for_status()
    shot_urls = _allocine_extract_shot_urls(resp.text)
    full_urls = []
    seen = set()
    poster_key = _image_key(poster_url)
    for url in shot_urls:
        full_url = _allocine_fullsize_photo_url(url)
        if not full_url:
            continue
        if poster_key and _image_key(full_url) == poster_key:
            continue
        if full_url not in seen:
            seen.add(full_url)
            full_urls.append(full_url)
    return full_urls


def _allocine_build_search_url(title: str) -> str:
    normalized = normalize_for_match(title)
    if not normalized:
        return ""
    return f"{ALLOCINE_SEARCH_URL}?q={quote_plus(normalized)}"


def _allocine_fetch_search(title: str) -> str:
    url = _allocine_build_search_url(title)
    if not url:
        return ""
    resp = ALLOCINE_SESSION.get(url, timeout=ALLOCINE_TIMEOUT)
    resp.raise_for_status()
    return resp.text


def _allocine_movies_section(html_text: str) -> str:
    match = re.search(
        r'<section[^>]*class="[^"]*movies-results[^"]*"[^>]*>(.*?)</section>',
        html_text,
        flags=re.IGNORECASE | re.DOTALL,
    )
    return match.group(1) if match else ""


def _allocine_parse_directors(item_html: str) -> str:
    block = re.search(
        r'<div[^>]*class="[^"]*meta-body-direction[^"]*"[^>]*>(.*?)</div>',
        item_html,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if block:
        names = re.findall(
            r'<span[^>]*class="[^"]*dark-grey-link[^"]*"[^>]*>(.*?)</span>',
            block.group(1),
            flags=re.IGNORECASE | re.DOTALL,
        )
        cleaned = [_clean_html_text(n) for n in names if _clean_html_text(n)]
        if cleaned:
            return ", ".join(cleaned)
    text = _clean_html_text(item_html)
    match = re.search(r"(?:Un film de|De)\s+([^|]+?)(?:Avec|$)", text, flags=re.IGNORECASE)
    if match:
        return match.group(1).strip()
    return ""


def _allocine_parse_movies(section_html: str) -> list[dict]:
    items = re.findall(
        r'<li[^>]*class="[^"]*mdl[^"]*"[^>]*>(.*?)</li>',
        section_html,
        flags=re.IGNORECASE | re.DOTALL,
    )
    results = []
    for item in items:
        title_span = re.search(
            r'<span[^>]*class="([^"]*meta-title-link[^"]*)"[^>]*>(.*?)</span>',
            item,
            flags=re.IGNORECASE | re.DOTALL,
        )
        if not title_span:
            continue
        class_attr = title_span.group(1)
        title = _clean_html_text(title_span.group(2))
        url = ""
        token_match = re.search(r"ACr[0-9A-Za-z+/=]+", class_attr)
        if token_match:
            decoded = _allocine_decode_obfuscated(token_match.group(0))
            if decoded.startswith("http"):
                url = decoded
            elif decoded.startswith("/"):
                url = f"{ALLOCINE_BASE_URL}{decoded}"
        if not url:
            for token in re.findall(r"ACr[0-9A-Za-z+/=]+", item):
                decoded = _allocine_decode_obfuscated(token)
                if "/film/fichefilm" in decoded:
                    url = (
                        decoded
                        if decoded.startswith("http")
                        else f"{ALLOCINE_BASE_URL}{decoded}"
                    )
                    break
        directors = _allocine_parse_directors(item)
        if title:
            results.append({"title": title, "url": url, "directors": directors})
    return results


def allocine_search_movies(title: str) -> list[dict]:
    html_text = _allocine_fetch_search(title)
    section = _allocine_movies_section(html_text)
    results = _allocine_parse_movies(section) if section else []
    return results


def _similarity(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    return difflib.SequenceMatcher(a=a, b=b).ratio()


def _title_variants(title: str) -> list[str]:
    raw = title or ""
    base = normalize_for_match(raw)
    variants = {base} if base else set()
    no_paren = re.sub(r"\([^)]*\)", " ", raw)
    no_paren_norm = normalize_for_match(no_paren)
    if no_paren_norm:
        variants.add(no_paren_norm)
    for match in re.findall(r"\(([^)]+)\)", raw):
        alt = normalize_for_match(match)
        if alt:
            variants.add(alt)
    for sep in (" / ", "/", " - ", " – ", " — ", ":"):
        if sep in raw:
            for part in raw.split(sep):
                part_norm = normalize_for_match(part)
                if part_norm:
                    variants.add(part_norm)
    return [v for v in variants if v]


def _split_director_names(value: str) -> list[str]:
    if not value:
        return []
    parts = re.split(r"[,/]| et | and | & ", str(value), flags=re.IGNORECASE)
    names = []
    for part in parts:
        norm = normalize_for_match(part)
        if norm:
            names.append(norm)
    return names


def _best_director_score(input_director: str, candidate_directors: str) -> float:
    input_names = _split_director_names(input_director)
    candidate_names = _split_director_names(candidate_directors)
    if not input_names or not candidate_names:
        return 0.0
    scores = []
    for name in input_names:
        best = max(_similarity(name, cand) for cand in candidate_names)
        scores.append(best)
    return sum(scores) / len(scores)


def _director_name_score(input_name: str, candidate_name: str) -> float:
    a = normalize_for_match(input_name)
    b = normalize_for_match(candidate_name)
    if not a or not b:
        return 0.0
    a_tokens = a.split()
    b_tokens = b.split()
    if not a_tokens or not b_tokens:
        return _similarity(a, b)
    scores = [
        _similarity(a, b),
        _similarity(" ".join(a_tokens), " ".join(reversed(b_tokens))),
        _similarity(" ".join(sorted(a_tokens)), " ".join(sorted(b_tokens))),
    ]
    set_a = set(a_tokens)
    set_b = set(b_tokens)
    token_score = len(set_a & set_b) / max(len(set_a), len(set_b))
    scores.append(token_score)
    best = max(scores)
    if a_tokens[-1] == b_tokens[-1]:
        best = min(1.0, best + 0.15)
    return best


def _best_director_match(input_director: str, candidate_directors: str) -> float:
    input_names = _split_director_names(input_director)
    candidate_names = _split_director_names(candidate_directors)
    if not input_names or not candidate_names:
        return 0.0
    best = 0.0
    for input_name in input_names:
        for cand_name in candidate_names:
            score = _director_name_score(input_name, cand_name)
            if score > best:
                best = score
            if best >= 0.99:
                return best
    return best


def allocine_pick_best(title: str, director: str, candidates: list[dict]):
    variants = _title_variants(title)
    if not variants or not candidates:
        return None
    best = None
    best_score = 0.0
    for cand in candidates:
        cand_title = normalize_for_match(cand.get("title", ""))
        title_score = max((_similarity(v, cand_title) for v in variants), default=0.0)
        director_score = _best_director_score(director, cand.get("directors", ""))
        if director:
            score = (ALLOCINE_WEIGHT_TITLE * title_score) + (ALLOCINE_WEIGHT_DIRECTOR * director_score)
        else:
            score = title_score
        if score > best_score:
            best_score = score
            best = {**cand, "score": score, "title_score": title_score, "director_score": director_score}
    if best and best_score >= ALLOCINE_MATCH_THRESHOLD:
        return best
    return None


def allocine_find_movie(title: str, director: str) -> dict:
    candidates = allocine_search_movies(title)
    match = allocine_pick_best(title, director, candidates)
    return {"candidates": candidates, "match": match}


def tmdb_get(path: str, params: dict) -> dict:
    api_key = os.environ.get("TMDB_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("TMDB_API_KEY missing. Set it in your environment.")
    full_params = {"api_key": api_key, **params}
    url = f"{TMDB_BASE_URL}{path}"
    resp = TMDB_SESSION.get(url, params=full_params, timeout=TMDB_TIMEOUT)
    resp.raise_for_status()
    return resp.json()


def tmdb_search_movies(title: str, lang: str) -> list[dict]:
    data = tmdb_get(
        "/search/movie",
        {
            "query": title,
            "language": lang,
            "include_adult": False,
        },
    )
    results = data.get("results") or []
    return results


def tmdb_get_credits(movie_id: int, lang: str) -> dict:
    data = tmdb_get(f"/movie/{movie_id}/credits", {"language": lang})
    return data


def tmdb_extract_directors(credits: dict) -> list[str]:
    crew = credits.get("crew") or []
    return [c.get("name") for c in crew if c.get("job") == "Director" and c.get("name")]


def tmdb_pick_best(title: str, director: str, candidates: list[dict], lang: str):
    variants = _title_variants(title)
    if not candidates:
        return None
    top = candidates[:TMDB_CANDIDATE_LIMIT]

    def _title_score(cand: dict) -> float:
        if not variants:
            return 0.0
        cand_title = normalize_for_match(cand.get("title", ""))
        cand_original = normalize_for_match(cand.get("original_title", ""))
        score = max((_similarity(v, cand_title) for v in variants), default=0.0)
        if cand_original:
            score = max(score, max((_similarity(v, cand_original) for v in variants), default=0.0))
        return score

    if not director:
        cand = top[0]
        title_score = _title_score(cand)
        if title_score >= TMDB_MATCH_THRESHOLD:
            directors = []
            movie_id = int(cand.get("id") or 0)
            if movie_id:
                credits = tmdb_get_credits(movie_id, lang)
                directors = tmdb_extract_directors(credits)
            return {
                **cand,
                "score": title_score,
                "title_score": title_score,
                "director_score": 0.0,
                "directors": directors,
            }
        directors = []
        movie_id = int(cand.get("id") or 0)
        if movie_id:
            credits = tmdb_get_credits(movie_id, lang)
            directors = tmdb_extract_directors(credits)
        return {
            **cand,
            "score": title_score,
            "title_score": title_score,
            "director_score": 0.0,
            "directors": directors,
        }
    best = None
    best_score = -1.0
    best_title = -1.0
    for cand in top:
        director_score = 0.0
        directors = []
        movie_id = int(cand.get("id") or 0)
        if movie_id:
            credits = tmdb_get_credits(movie_id, lang)
            directors = tmdb_extract_directors(credits)
            director_score = _best_director_match(director, ", ".join(directors))
        title_score = _title_score(cand)
        score = (TMDB_WEIGHT_TITLE * title_score) + (TMDB_WEIGHT_DIRECTOR * director_score)
        if director_score > best_score or (director_score == best_score and title_score > best_title):
            best_score = director_score
            best_title = title_score
            best = {
                **cand,
                "score": score,
                "title_score": title_score,
                "director_score": director_score,
                "directors": directors,
            }
        if director_score >= TMDB_DIRECTOR_ACCEPT_THRESHOLD:
            return best
    return best


def tmdb_find_movie(title: str, director: str, lang: str) -> dict:
    candidates = tmdb_search_movies(title, lang)
    match = tmdb_pick_best(title, director, candidates, lang)
    return {"candidates": candidates, "match": match}


def tmdb_get_details(movie_id: int, lang: str) -> dict:
    return tmdb_get(f"/movie/{movie_id}", {"language": lang})


def tmdb_get_release_dates(movie_id: int) -> dict:
    return tmdb_get(f"/movie/{movie_id}/release_dates", {})


def _dedupe_videos(items: list[dict]) -> list[dict]:
    seen = set()
    merged = []
    for item in items:
        key = (item.get("site") or "").lower(), (item.get("key") or "")
        if not key[1]:
            continue
        if key in seen:
            continue
        seen.add(key)
        merged.append(item)
    return merged


def tmdb_get_videos(movie_id: int, lang: str) -> dict:
    langs = []
    if lang:
        langs.append(lang)
    if "fr-FR" not in langs:
        langs.append("fr-FR")
    if "en-US" not in langs:
        langs.append("en-US")
    langs.append("")
    all_results = []
    for l in langs:
        params = {"language": l} if l else {}
        try:
            data = tmdb_get(f"/movie/{movie_id}/videos", params)
        except Exception:
            continue
        results = data.get("results") or []
        if results:
            all_results.extend(results)
    return {"results": _dedupe_videos(all_results)}


def _version_prefers_original(version: str) -> Optional[bool]:
    v = normalize_for_match(version)
    if not v:
        return None
    if "vost" in v or "vo" in v or "ov" in v:
        return True
    if "vf" in v or "francais" in v or "french" in v:
        return False
    return None


def _tmdb_preferred_language(version: str, details: dict) -> str:
    original = (details.get("original_language") or "").lower()
    if original == "fr":
        return "fr"
    prefers_original = _version_prefers_original(version)
    if prefers_original is True:
        return original
    if prefers_original is False:
        return "fr"
    return "fr" if original else ""


def _tmdb_video_url(item: dict) -> str:
    key = item.get("key") or ""
    site = (item.get("site") or "").lower()
    if not key:
        return ""
    if site == "youtube":
        return f"https://www.youtube.com/watch?v={key}"
    if site == "vimeo":
        return f"https://vimeo.com/{key}"
    return ""


def _tmdb_published_ts(value: str) -> float:
    if not value:
        return 0.0
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except Exception:
        return 0.0


def tmdb_pick_trailer(videos: dict, version: str, details: dict) -> str:
    results = videos.get("results") or []
    if not results:
        return ""
    desired_lang = _tmdb_preferred_language(version, details)
    preferred_countries = ("FR", "BE", "CH", "CA", "LU", "MC")
    prod_countries = [
        (c.get("iso_3166_1") or "").upper()
        for c in (details.get("production_countries") or [])
        if c.get("iso_3166_1")
    ]
    supported = [r for r in results if _tmdb_video_url(r)]
    if not supported:
        return ""

    def score(item: dict) -> tuple:
        lang = (item.get("iso_639_1") or "").lower()
        country = (item.get("iso_3166_1") or "").upper()
        if desired_lang:
            lang_rank = 0 if lang == desired_lang else 2
        else:
            lang_rank = 1
        if country == "FR":
            country_rank = 0
        elif country in preferred_countries:
            country_rank = 1
        elif country and country in prod_countries:
            country_rank = 2
        else:
            country_rank = 3
        typ = (item.get("type") or "").lower()
        if typ == "trailer":
            type_rank = 0
        elif typ == "teaser":
            type_rank = 1
        else:
            type_rank = 2
        official_rank = 0 if item.get("official") is True else 1
        published_rank = -_tmdb_published_ts(item.get("published_at") or "")
        size_rank = -(int(item.get("size") or 0))
        return (lang_rank, country_rank, type_rank, official_rank, published_rank, size_rank)

    best = min(supported, key=score)
    return _tmdb_video_url(best)


def tmdb_release_date_fr(release_dates: dict) -> str:
    results = release_dates.get("results") or []
    for entry in results:
        if entry.get("iso_3166_1") != "FR":
            continue
        items = entry.get("release_dates") or []
        for item in items:
            date_str = item.get("release_date") or ""
            if date_str:
                return date_str[:10]
    return ""


def tmdb_extract_main_cast(credits: dict, limit: int = 8) -> list[str]:
    cast = credits.get("cast") or []
    names = [c.get("name") for c in cast if c.get("name")]
    return names[:limit]


def _title_similarity_allocine_tmdb(allocine_title: str, tmdb_title: str, tmdb_original: str) -> float:
    variants = _title_variants(allocine_title or "")
    if not variants:
        return 0.0
    candidates = [tmdb_title or "", tmdb_original or ""]
    best = 0.0
    for cand in candidates:
        cand_norm = normalize_for_match(cand)
        if not cand_norm:
            continue
        best = max(best, max((_similarity(v, cand_norm) for v in variants), default=0.0))
    return best


def verify_allocine_tmdb(allocine_meta: dict, tmdb_meta: dict) -> dict:
    allocine_title = allocine_meta.get("allocine_title") or ""
    allocine_directors = allocine_meta.get("allocine_directors") or ""
    allocine_date_raw = allocine_meta.get("allocine_release_date") or ""
    allocine_date = _parse_iso_date(allocine_date_raw)
    tmdb_title = tmdb_meta.get("tmdb_title") or ""
    tmdb_original = tmdb_meta.get("tmdb_original_title") or ""
    tmdb_directors = tmdb_meta.get("tmdb_directors") or ""
    tmdb_date_raw = tmdb_meta.get("tmdb_release_date") or ""
    tmdb_date = _parse_iso_date(tmdb_date_raw)

    title_score = _title_similarity_allocine_tmdb(allocine_title, tmdb_title, tmdb_original)
    director_score = _best_director_score(allocine_directors, tmdb_directors)

    date_match = None
    if allocine_date and tmdb_date:
        date_match = allocine_date == tmdb_date

    verified = title_score >= CROSS_MATCH_TITLE_THRESHOLD and director_score >= CROSS_MATCH_DIRECTOR_THRESHOLD

    return {
        "verified": verified,
        "title_score": title_score,
        "director_score": director_score,
        "date_match": date_match,
        "allocine_date": allocine_date_raw,
        "tmdb_date": tmdb_date_raw,
    }


def _prompt_source_choice(film: dict, allocine_meta: dict, tmdb_meta: dict, match_info: dict) -> str:
    print("\n--- allocine/tmdb mismatch ---", flush=True)
    print(f"Titre source: {film.get('titre', '')}", flush=True)
    print("Allocine:", flush=True)
    print(f"  titre: {allocine_meta.get('allocine_title', '')}", flush=True)
    print(f"  realisateur: {allocine_meta.get('allocine_directors', '')}", flush=True)
    print(f"  date: {match_info.get('allocine_date', '')}", flush=True)
    print("TMDB:", flush=True)
    print(f"  titre: {tmdb_meta.get('tmdb_title', '')}", flush=True)
    print(f"  titre original: {tmdb_meta.get('tmdb_original_title', '')}", flush=True)
    print(f"  realisateur: {tmdb_meta.get('tmdb_directors', '')}", flush=True)
    print(f"  date: {match_info.get('tmdb_date', '')}", flush=True)
    print(
        f"Scores: titre={match_info.get('title_score', 0):.2f} "
        f"realisateur={match_info.get('director_score', 0):.2f} "
        f"date_match={match_info.get('date_match')}",
        flush=True,
    )
    while True:
        choice = input("Choisir source (a=allocine, t=tmdb, m=merge, s=skip): ").strip().lower()
        if choice in {"a", "t", "m", "s"}:
            return choice


def main() -> int:
    # Charger l'environnement (.env) pour utiliser les clés API de Google et TMDB
    env_path = Path(__file__).resolve().parent / ".env"
    load_env_file(env_path)

    # Charger work/normalized.xlsx
    in_path = Path("work/normalized.xlsx")
    df = pd.read_excel(in_path, sheet_name=0, dtype=str).fillna("")

    # Charger les colonnes
    columns = list(df.columns)
    if columns:
        log_step(f"colonnes detectees: {', '.join(columns)}")

    # 4) Pour chaque film (chaque ligne)
    films = []
    for _, row in df.iterrows():
        row_data = {col: str(row.get(col, "")).strip() for col in columns}
        date = row_data.get("Date", "")
        heure = row_data.get("Heure", "")
        titre = row_data.get("Titre", "")
        version = row_data.get("Version", "")
        cm = row_data.get("CM", "")
        realisateur = row_data.get("Realisateur", "")
        recompenses = row_data.get("Recompenses", "")
        categorie = row_data.get("Categorie", "")
        tarif = row_data.get("Tarif", "")
        commentaire = row_data.get("Commentaire", "")

        log_step(f"film: {titre}")

        is_cineclub = _has_cineclub_or_patrimoine(categorie, commentaire)
        is_scolaire = "SCOL" in str(categorie).upper()

        film_info = {
            "titre": titre,
            "realisateur": realisateur,
            "version": version,
            "categorie": categorie,
            "commentaire": commentaire,
            "date": date,
            "heure": heure,
            "cm": cm,
            "recompenses": recompenses,
            "tarif": tarif,
            "is_cineclub": is_cineclub,
            "is_scolaire": is_scolaire,
            "raw": row_data,
            "enriched": {},
        }
        films.append(film_info)

    # 5) Recherche Allocine par titre + realisateur (scraping)
    log_step("allocine: chercher par titre + realisateur (scraping)")
    def _allocine_lookup(idx: int, title: str, director: str):
        if not title:
            return idx, title, None, None, ""
        try:
            result = allocine_find_movie(title, director)
            match = result.get("match")
            return idx, title, result, match, ""
        except Exception as exc:
            return idx, title, None, None, str(exc)

    futures = []
    max_workers = min(ALLOCINE_MAX_WORKERS, max(1, len(films)))
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        for idx, film in enumerate(films):
            titre = film.get("titre", "")
            realisateur = film.get("realisateur", "")
            futures.append(executor.submit(_allocine_lookup, idx, titre, realisateur))
        for future in as_completed(futures):
            idx, titre, result, match, error = future.result()
            film = films[idx]
            if not titre:
                continue
            if error:
                log_step(f"allocine: erreur recherche {titre} ({error})")
                continue
            if not result:
                log_step(f"allocine: erreur recherche {titre} (no result)")
                continue
            candidates = result.get("candidates") or []
            film["allocine_candidates"] = candidates
            if match:
                film["allocine_url"] = match.get("url", "")
                film["allocine_title"] = match.get("title", "")
                film["allocine_directors"] = match.get("directors", "")
                film["allocine_score"] = match.get("score", 0.0)
                film["allocine_title_score"] = match.get("title_score", 0.0)
                film["allocine_director_score"] = match.get("director_score", 0.0)
                log_step(f"allocine: {titre} -> {film['allocine_url']}")
            else:
                log_step(f"allocine: no match for {titre} ({len(candidates)} candidats)")

    # 6) Recuperer metadonnees Allocine (affiche, titre, realisateurs, date)
    log_step("allocine: recuperer metadonnees (scraping)")
    def _allocine_meta_lookup(idx: int, allocine_url: str):
        if not allocine_url:
            return idx, allocine_url, {}, ""
        try:
            meta = allocine_movie_meta(allocine_url)
            return idx, allocine_url, meta, ""
        except Exception as exc:
            return idx, allocine_url, {}, str(exc)

    futures = []
    max_workers = min(ALLOCINE_MAX_WORKERS, max(1, len(films)))
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        for idx, film in enumerate(films):
            allocine_url = film.get("allocine_url", "")
            futures.append(executor.submit(_allocine_meta_lookup, idx, allocine_url))
        for future in as_completed(futures):
            idx, allocine_url, meta, error = future.result()
            film = films[idx]
            if not allocine_url:
                continue
            if error:
                log_step(f"allocine: erreur metadonnees {allocine_url} ({error})")
                continue
            if meta:
                if meta.get("affiche"):
                    film["enriched"]["affiche"] = meta.get("affiche")
                if meta.get("allocine_title"):
                    film["enriched"]["allocine_title"] = meta.get("allocine_title")
                if meta.get("allocine_alt_title"):
                    film["enriched"]["allocine_alt_title"] = meta.get("allocine_alt_title")
                if meta.get("allocine_directors"):
                    film["enriched"]["allocine_directors"] = meta.get("allocine_directors")
                if meta.get("allocine_release_date"):
                    film["enriched"]["allocine_release_date"] = meta.get("allocine_release_date")
                if meta.get("allocine_synopsis"):
                    film["enriched"]["allocine_synopsis"] = meta.get("allocine_synopsis")
                if meta.get("allocine_genres"):
                    film["enriched"]["allocine_genres"] = meta.get("allocine_genres")
                if meta.get("allocine_duree_min"):
                    film["enriched"]["allocine_duree_min"] = meta.get("allocine_duree_min")
                if meta.get("allocine_pays"):
                    film["enriched"]["allocine_pays"] = meta.get("allocine_pays")
                if meta.get("allocine_acteurs"):
                    film["enriched"]["allocine_acteurs"] = meta.get("allocine_acteurs")
                if meta.get("allocine_recompenses"):
                    base_rewards = film.get("recompenses", "")
                    film["enriched"]["allocine_recompenses"] = _merge_list_pref_allocine(
                        base_rewards,
                        meta.get("allocine_recompenses", []),
                    )
            if not film["enriched"].get("allocine_directors"):
                fallback_directors = film.get("allocine_directors", "")
                if fallback_directors:
                    film["enriched"]["allocine_directors"] = fallback_directors
            if not film["enriched"].get("allocine_title"):
                fallback_title = film.get("allocine_title", "")
                if fallback_title:
                    film["enriched"]["allocine_title"] = fallback_title
            if not film["enriched"].get("allocine_recompenses"):
                base_rewards = film.get("recompenses", "")
                if base_rewards:
                    film["enriched"]["allocine_recompenses"] = _split_list(base_rewards)

    # 7) Recuperer les photos Allocine
    log_step("allocine: recuperer photos (scraping)")
    def _allocine_photos_lookup(idx: int, allocine_url: str, poster_url: str):
        if not allocine_url:
            return idx, allocine_url, [], ""
        try:
            photos = allocine_photo_urls(allocine_url, poster_url)
            return idx, allocine_url, photos, ""
        except Exception as exc:
            return idx, allocine_url, [], str(exc)

    futures = []
    max_workers = min(ALLOCINE_MAX_WORKERS, max(1, len(films)))
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        for idx, film in enumerate(films):
            allocine_url = film.get("allocine_url", "")
            poster_url = film.get("enriched", {}).get("affiche", "")
            futures.append(executor.submit(_allocine_photos_lookup, idx, allocine_url, poster_url))
        for future in as_completed(futures):
            idx, allocine_url, photos, error = future.result()
            film = films[idx]
            if not allocine_url:
                continue
            if error:
                log_step(f"allocine: erreur photos {allocine_url} ({error})")
                continue
            film["enriched"]["backdrops"] = photos

    # 8) Classer et choisir un candidat
    log_step("tmdb: chercher par titre (langue principale puis en-US si besoin)")
    def _tmdb_lookup(idx: int, title: str, director: str):
        if not title:
            return idx, title, None, None, None, ""
        try:
            result = tmdb_find_movie(title, director, TMDB_LANG_DEFAULT)
            match = result.get("match")
            used_lang = TMDB_LANG_DEFAULT
            if not match:
                result = tmdb_find_movie(title, director, "en-US")
                match = result.get("match")
                used_lang = "en-US"
            return idx, title, result, match, used_lang, ""
        except Exception as exc:
            return idx, title, None, None, None, str(exc)

    futures = []
    max_workers = min(TMDB_MAX_WORKERS, max(1, len(films)))
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        for idx, film in enumerate(films):
            titre = film.get("titre", "")
            realisateur = film.get("realisateur", "")
            futures.append(executor.submit(_tmdb_lookup, idx, titre, realisateur))
        for future in as_completed(futures):
            idx, titre, result, match, used_lang, error = future.result()
            film = films[idx]
            if not titre:
                continue
            if error:
                log_step(f"tmdb: erreur recherche {titre} ({error})")
                continue
            if not result:
                log_step(f"tmdb: erreur recherche {titre} (no result)")
                continue
            candidates = result.get("candidates") or []
            film["tmdb_candidates"] = candidates
            if match:
                film["tmdb_id"] = str(match.get("id") or "")
                film["tmdb_title"] = match.get("title") or ""
                film["tmdb_original_title"] = match.get("original_title") or ""
                film["tmdb_release_date"] = match.get("release_date") or ""
                film["tmdb_score"] = match.get("score", 0.0)
                film["tmdb_title_score"] = match.get("title_score", 0.0)
                film["tmdb_director_score"] = match.get("director_score", 0.0)
                film["tmdb_directors"] = ", ".join(match.get("directors") or [])
                film["tmdb_lang"] = used_lang
                log_step(f"tmdb: {titre} -> {film['tmdb_id']} ({film['tmdb_title']})")
            else:
                log_step(f"tmdb: no match for {titre} ({len(candidates)} candidats)")

    # 9) Verifier correspondance Allocine/TMDB
    log_step("allocine/tmdb: verifier correspondance")
    for film in films:
        allocine_meta = film.get("enriched", {})
        tmdb_meta = {
            "tmdb_title": film.get("tmdb_title", ""),
            "tmdb_original_title": film.get("tmdb_original_title", ""),
            "tmdb_release_date": film.get("tmdb_release_date", ""),
            "tmdb_directors": film.get("tmdb_directors", ""),
        }
        if not allocine_meta.get("allocine_title") or not tmdb_meta.get("tmdb_title"):
            continue
        result = verify_allocine_tmdb(allocine_meta, tmdb_meta)
        film["enriched"]["allocine_tmdb_match"] = result
        date_match = result.get("date_match")
        mismatch = (
            result.get("title_score", 0) < CROSS_MATCH_TITLE_THRESHOLD
            or result.get("director_score", 0) < CROSS_MATCH_DIRECTOR_THRESHOLD
        )
        if mismatch:
            log_step(
                "allocine/tmdb: mismatch "
                f"{film.get('titre', '')} "
                f"(title={result.get('title_score', 0):.2f}, "
                f"director={result.get('director_score', 0):.2f}, "
                f"date_match={date_match})"
            )
            choice = _prompt_source_choice(film, allocine_meta, tmdb_meta, result)
            film["enriched"]["source_preference"] = choice

    # 10) Recuperer details TMDB (synopsis, genres, pays, duree, acteurs, trailers)
    log_step("tmdb: recuperer details (synopsis, genres, pays, duree, acteurs, trailers)")
    def _tmdb_details_lookup(idx: int, movie_id: str, lang: str):
        if not movie_id:
            return idx, movie_id, {}, {}, {}, {}, ""
        try:
            movie_id_int = int(movie_id)
        except Exception:
            return idx, movie_id, {}, {}, {}, {}, ""
        try:
            details = tmdb_get_details(movie_id_int, lang)
            credits = tmdb_get_credits(movie_id_int, lang)
            release_dates = tmdb_get_release_dates(movie_id_int)
            videos = tmdb_get_videos(movie_id_int, lang)
            return idx, movie_id, details, credits, release_dates, videos, ""
        except Exception as exc:
            return idx, movie_id, {}, {}, {}, {}, str(exc)

    futures = []
    max_workers = min(TMDB_MAX_WORKERS, max(1, len(films)))
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        for idx, film in enumerate(films):
            movie_id = film.get("tmdb_id", "")
            lang = film.get("tmdb_lang", TMDB_LANG_DEFAULT)
            futures.append(executor.submit(_tmdb_details_lookup, idx, movie_id, lang))
        for future in as_completed(futures):
            idx, movie_id, details, credits, release_dates, videos, error = future.result()
            film = films[idx]
            if not movie_id:
                continue
            if error:
                log_step(f"tmdb: erreur details {movie_id} ({error})")
                continue
            synopsis = details.get("overview") or ""
            genres = [g.get("name") for g in (details.get("genres") or []) if g.get("name")]
            runtime = details.get("runtime") or 0
            countries = [c.get("name") for c in (details.get("production_countries") or []) if c.get("name")]
            cast = tmdb_extract_main_cast(credits)
            trailer_url = tmdb_pick_trailer(videos, film.get("version", ""), details)
            film["enriched"]["tmdb_synopsis"] = synopsis
            film["enriched"]["tmdb_genres"] = genres
            film["enriched"]["tmdb_duree_min"] = str(runtime) if runtime else ""
            film["enriched"]["tmdb_pays"] = ", ".join(countries)
            film["enriched"]["tmdb_acteurs"] = ", ".join(cast)
            film["enriched"]["tmdb_recompenses"] = []
            film["enriched"]["tmdb_trailer_url"] = trailer_url
            fr_date = tmdb_release_date_fr(release_dates)
            if fr_date:
                film["tmdb_release_date"] = fr_date
            elif details.get("release_date"):
                film["tmdb_release_date"] = details.get("release_date") or film.get("tmdb_release_date", "")
    # 11) Choisir la source et fusionner pour les champs principaux
    log_step("fusion: choisir source pour synopsis/genres/duree/pays/acteurs/recompenses")
    for film in films:
        enriched = film.get("enriched", {})
        pref = enriched.get("source_preference", "")
        if pref == "s":
            synopsis = ""
            genres = []
            duree_min = ""
            pays = []
            acteurs = []
            recompenses = []
        elif pref == "t":
            synopsis = enriched.get("tmdb_synopsis", "")
            genres = enriched.get("tmdb_genres", [])
            duree_min = enriched.get("tmdb_duree_min", "")
            pays = enriched.get("tmdb_pays", "")
            acteurs = enriched.get("tmdb_acteurs", "")
            recompenses = enriched.get("tmdb_recompenses", [])
        elif pref == "a":
            synopsis = enriched.get("allocine_synopsis", "")
            genres = enriched.get("allocine_genres", [])
            duree_min = enriched.get("allocine_duree_min", "")
            pays = enriched.get("allocine_pays", "")
            acteurs = enriched.get("allocine_acteurs", "")
            recompenses = enriched.get("allocine_recompenses", [])
        elif pref == "m":
            synopsis = enriched.get("allocine_synopsis", "") or enriched.get("tmdb_synopsis", "")
            genres = _merge_list_pref_allocine(
                enriched.get("allocine_genres", []),
                enriched.get("tmdb_genres", []),
            )
            duree_min = enriched.get("allocine_duree_min", "") or enriched.get("tmdb_duree_min", "")
            pays = _merge_list_pref_allocine(
                enriched.get("allocine_pays", ""),
                enriched.get("tmdb_pays", ""),
            )
            acteurs = _merge_list_pref_allocine(
                enriched.get("allocine_acteurs", ""),
                enriched.get("tmdb_acteurs", ""),
            )
            recompenses = _merge_list_pref_allocine(
                enriched.get("allocine_recompenses", []),
                enriched.get("tmdb_recompenses", []),
            )
        else:
            synopsis = enriched.get("allocine_synopsis", "") or enriched.get("tmdb_synopsis", "")
            genres = enriched.get("allocine_genres", []) or enriched.get("tmdb_genres", [])
            duree_min = enriched.get("allocine_duree_min", "") or enriched.get("tmdb_duree_min", "")
            pays = enriched.get("allocine_pays", "") or enriched.get("tmdb_pays", "")
            acteurs = enriched.get("allocine_acteurs", "") or enriched.get("tmdb_acteurs", "")
            recompenses = enriched.get("allocine_recompenses", []) or enriched.get("tmdb_recompenses", [])

        enriched["synopsis"] = synopsis
        enriched["genres"] = genres
        enriched["duree_min"] = duree_min
        enriched["pays"] = pays
        enriched["acteurs_principaux"] = acteurs
        enriched["recompenses"] = recompenses
        enriched["date_sortie"] = (
            enriched.get("allocine_release_date") or film.get("tmdb_release_date", "")
        )
        enriched["trailer_url"] = enriched.get("tmdb_trailer_url", "")

    # 12) Ecriture du fichier enrichi
    log_step("ecrire work/enriched.xlsx")
    out_rows = []
    for film in films:
        row_data = dict(film.get("raw", {}))
        enriched = film.get("enriched", {})
        row_data["affiche_url"] = enriched.get("affiche", "")
        row_data["synopsis"] = enriched.get("synopsis", "")
        row_data["genres"] = _join_list(enriched.get("genres", ""))
        row_data["duree_min"] = enriched.get("duree_min", "")
        row_data["pays"] = _join_list(enriched.get("pays", ""))
        row_data["acteurs_principaux"] = _join_list(enriched.get("acteurs_principaux", ""))
        row_data["recompenses"] = _join_list(enriched.get("recompenses", ""))
        row_data["date_sortie"] = enriched.get("date_sortie", "")
        row_data["trailer_url"] = enriched.get("trailer_url", "")
        row_data["allocine_url"] = film.get("allocine_url", "")
        backdrops = enriched.get("backdrops", [])
        row_data["backdrops"] = json.dumps(backdrops, ensure_ascii=False) if backdrops else ""
        out_rows.append(row_data)

    out_df = pd.DataFrame(out_rows)
    if "affiche_url" not in out_df.columns:
        out_df["affiche_url"] = ""
    if "synopsis" not in out_df.columns:
        out_df["synopsis"] = ""
    if "genres" not in out_df.columns:
        out_df["genres"] = ""
    if "duree_min" not in out_df.columns:
        out_df["duree_min"] = ""
    if "pays" not in out_df.columns:
        out_df["pays"] = ""
    if "acteurs_principaux" not in out_df.columns:
        out_df["acteurs_principaux"] = ""
    if "recompenses" not in out_df.columns:
        out_df["recompenses"] = ""
    if "date_sortie" not in out_df.columns:
        out_df["date_sortie"] = ""
    if "trailer_url" not in out_df.columns:
        out_df["trailer_url"] = ""
    if "allocine_url" not in out_df.columns:
        out_df["allocine_url"] = ""
    if "backdrops" not in out_df.columns:
        out_df["backdrops"] = ""
    ordered = list(columns)
    if "affiche_url" not in ordered:
        ordered.append("affiche_url")
    if "synopsis" not in ordered:
        ordered.append("synopsis")
    if "genres" not in ordered:
        ordered.append("genres")
    if "duree_min" not in ordered:
        ordered.append("duree_min")
    if "pays" not in ordered:
        ordered.append("pays")
    if "acteurs_principaux" not in ordered:
        ordered.append("acteurs_principaux")
    if "recompenses" not in ordered:
        ordered.append("recompenses")
    if "date_sortie" not in ordered:
        ordered.append("date_sortie")
    if "trailer_url" not in ordered:
        ordered.append("trailer_url")
    if "allocine_url" not in ordered:
        ordered.append("allocine_url")
    if "backdrops" not in ordered:
        ordered.append("backdrops")
    for col in ordered:
        if col not in out_df.columns:
            out_df[col] = ""
    extra_cols = [col for col in out_df.columns if col not in ordered]
    out_df = out_df[ordered + extra_cols]

    out_path = Path("work/enriched.xlsx")
    out_df.to_excel(out_path, index=False)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
