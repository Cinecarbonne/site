#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
enrich.py — Enrichit un Excel "normalisé" avec les données TMDB.

- Recherche TMDB (FR puis EN en secours), résolution interactive si ambiguïté
- Récupère crédits, affiche, meilleure backdrop + galerie (max 5)
- Score: priorité année courante > précédente > autres,
         classement interne = 0.65 × similarité + 0.35 × popularité
- Auto-margin = 4
- Alerte sur mots-clés ("club", "jeunes", "patrimoine") → forçage du choix manuel
- Réalisateurs préchargés en parallèle pour les 5 meilleurs choix (rapide)
- Cache pour éviter les requêtes répétées
- Lit depuis work/{--in}, écrit work/{--out}
"""

import os, sys, argparse, json, time, difflib
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from concurrent.futures import ThreadPoolExecutor, as_completed

import pandas as pd
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
import  tkinter as tk
from tkinter import ttk as ttk
import name_tools as nt
from unidecode import unidecode



# ---------- Constantes ----------
TMDB_API_KEY = os.environ.get("TMDB_API_KEY", "").strip()
print("API_KEY (enrich): "+os.environ.get("TMDB_API_KEY", "").strip())

TMDB_BASE = "https://api.themoviedb.org/3"
LANG_DEFAULT = "fr-FR"

IMG_W300 = "https://image.tmdb.org/t/p/w300"
IMG_W500 = "https://image.tmdb.org/t/p/w500"
IMG_W780 = "https://image.tmdb.org/t/p/w780"
IMG_ORIG = "https://image.tmdb.org/t/p/original"

mode_Gui=False
window=None

OUTPUT_ENRICH_COLS = [
    "datetime_local",
    "date",
    "heure",
    "version",
    "tarif",
    "categorie",
    "commentaire",
    "prix",
    "titre",
    "titre_original",
    "realisateur",
    "acteurs_principaux",
    "genres",
    "annee",
    "pays",
    "duree_min",
    "synopsis",
    "affiche_url",
    "backdrop_url",
    "backdrops",
    "trailer_url",
    "tmdb_id",
    "imdb_id",
    "allocine_url"
]

SUSPECT_WORDS = ("club", "jeunes", "patrimoine")

DETAILS_CACHE: dict[tuple[int, str], dict] = {}
CREDITS_CACHE: dict[tuple[int, str], dict] = {}


# ---------- HTTP session ----------
def _with_timeout(func, timeout=12):
    def wrapped(method, url, **kwargs):
        kwargs.setdefault("timeout", timeout)
        return func(method, url, **kwargs)
    return wrapped

def make_session(timeout=12):
    sess = requests.Session()
    retries = Retry(total=5, backoff_factor=0.4,
                    status_forcelist=(429, 500, 502, 503, 504),
                    allowed_methods=["GET"])
    adapter = HTTPAdapter(max_retries=retries, pool_connections=20, pool_maxsize=20)
    sess.mount("http://", adapter)
    sess.mount("https://", adapter)
    sess.request = _with_timeout(sess.request, timeout=timeout)  # type: ignore
    return sess

SESSION = make_session()

# ---------- Wikidata / Allociné ----------
WIKIDATA_SPARQL = "https://query.wikidata.org/sparql"
WIKIDATA_UA = {"User-Agent": "CineCarbonne/1.0 (contact: webmaster@cine-carbonne.example)"}

def allocine_url_from_imdb(imdb_id: str) -> Optional[str]:
    """Retourne l'URL Allociné via Wikidata P1265 à partir d'un IMDb ID (ttxxxxxx).
    Ex: tt1375666 -> https://www.allocine.fr/film/fichefilm_gen_cfilm=143692.html
    """
    imdb_id = (imdb_id or "").strip()
    if not imdb_id:
        return None
    q = f"""
    SELECT ?allo WHERE {{
      ?item wdt:P31 wd:Q11424 ;
            wdt:P345 "{imdb_id}" ;
            wdt:P1265 ?allo .
    }} LIMIT 1
    """
    try:
        r = SESSION.get(WIKIDATA_SPARQL, params={"query": q, "format": "json"}, headers=WIKIDATA_UA)
        if r.status_code != 200:
            return None
        data = r.json()
        b = data.get("results", {}).get("bindings", [])
        if not b:
            return None
        allo_id = b[0]["allo"]["value"]
        return f"https://www.allocine.fr/film/fichefilm_gen_cfilm={allo_id}.html"
    except Exception:
        return None


def tmdb_get(path: str, params: Dict[str, Any]) -> Dict[str, Any]:
    if not TMDB_API_KEY:
        raise RuntimeError("TMDB_API_KEY manquant.")
    url = f"{TMDB_BASE}{path}"
    full = {"api_key": TMDB_API_KEY, **params}
    r = SESSION.get(url, params=full)
    r.raise_for_status()
    return r.json()


# ---------- TMDB helpers ----------
def search_movie(query: str, lang: str) -> List[Dict[str, Any]]:
    data = tmdb_get("/search/movie", {"query": query, "language": lang, "include_adult": False})
    return data.get("results", []) or []

def search_movie_with_director(title: str, director: str, lang: str) -> List[Dict[str, Any]]:
    base = search_movie(title, lang)
    director = (director or "").strip()
    if not director:
        return base
    extra = search_movie(f"{title} {director}", lang)
    if not extra:
        return base
    seen = {int(c["id"]) for c in base if c.get("id")}
    merged = list(base)
    for c in extra:
        mid = int(c.get("id") or 0)
        if mid and mid not in seen:
            merged.append(c)
            seen.add(mid)
    return merged

def get_movie_details(mid: int, lang: str): return tmdb_get(f"/movie/{mid}", {"language": lang})
def get_movie_credits(mid: int, lang: str): return tmdb_get(f"/movie/{mid}/credits", {"language": lang})
def get_movie_images(mid: int):             return tmdb_get(f"/movie/{mid}/images", {})

def pick_best_poster(details):
    p = details.get("poster_path")
    return f"{IMG_W500}{p}" if p else None

def pick_best_backdrop(images, dfr=None, den=None):
    backs = (images or {}).get("backdrops") or []
    if not backs:
        p = (dfr or {}).get("backdrop_path") or (den or {}).get("backdrop_path")
        return f"{IMG_W780}{p}" if p else None
    backs = sorted(backs, key=lambda b: (b.get("vote_average", 0),
                                         b.get("vote_count", 0),
                                         b.get("width", 0)), reverse=True)
    return f"{IMG_W780}{backs[0]['file_path']}" if backs and backs[0].get("file_path") else None

def build_all_backdrops(images, prefer_min_width=1280, limit=5):
    backs = (images or {}).get("backdrops") or []
    backs = sorted(backs, key=lambda b: (b.get("vote_average", 0),
                                         b.get("vote_count", 0),
                                         b.get("width", 0)), reverse=True)
    urls = []
    for b in backs:
        p = b.get("file_path")
        w = int(b.get("width") or 0)
        if p and (w >= prefer_min_width or not urls):
            urls.append(f"{IMG_W780}{p}")
        if limit and len(urls) >= limit:
            break
    return urls

def extract_people(credits):
    cast = credits.get("cast") or []
    crew = credits.get("crew") or []
    dirs = [c["name"] for c in crew if c.get("job") == "Director"]
    main = [c["name"] for c in cast[:6] if c.get("name")]
    return ", ".join(dirs), ", ".join(main)

def extract_genres(details):   return ", ".join(g["name"] for g in details.get("genres") or [])
def extract_countries(details):return ", ".join(c["name"] for c in details.get("production_countries") or [])
# ---------- Scoring ----------
def _year_bucket(res):
    rd = (res.get("release_date") or "").strip()
    if not rd or len(rd) < 4: return 0
    try:
        y = int(rd[:4]); cy = datetime.now().year
        if y == cy: return 2
        if y == cy - 1: return 1
        return 0
    except: return 0

def _title_similarity(query, res):
    q = (query or "").strip().lower()
    t1 = (res.get("title") or "").strip().lower()
    t2 = (res.get("original_title") or "").strip().lower()
    s1 = difflib.SequenceMatcher(a=q, b=t1).ratio() if t1 else 0.0
    s2 = difflib.SequenceMatcher(a=q, b=t2).ratio() if t2 else 0.0
    return max(s1, s2)

def _composite(query, res):
    sim = _title_similarity(query, res) * 100.0
    pop = float(res.get("popularity") or 0.0)
    return 0.65 * sim + 0.35 * pop

def _director_similarity(given, proposed):
    if not given or not proposed:
        return 0.0
    # normalize given director name
    a = nt.canonicalize(given).split()
    a.sort()
    norm_given = unidecode(" ".join(a))
    # normalize proposed director name
    a = nt.canonicalize(proposed).split()
    a.sort()
    norm_proposed = unidecode(" ".join(a))
    return nt.match(norm_given, norm_proposed)


def _rank_key(query, res):
    return (_year_bucket(res), _composite(query, res))


# ---------- Cache réalisateurs ----------
def get_director_str_cached(mid: int, lang: str) -> str:
    key = (mid, lang)
    if key in CREDITS_CACHE:
        crew = CREDITS_CACHE[key].get("crew") or []
    else:
        data = get_movie_credits(mid, lang)
        CREDITS_CACHE[key] = data
        crew = data.get("crew") or []
    dirs = [c.get("name") for c in crew if c.get("job") == "Director" and c.get("name")]
    return ", ".join(dirs) if dirs else ""


# ---------- Sélection automatique / manuelle ----------
def _prefetch_directors(cands, lang_for_director):
    directors = {}
    if not cands:
        return directors
    with ThreadPoolExecutor(max_workers=6) as ex:
        futs = {ex.submit(get_director_str_cached, int(c["id"]), lang_for_director): int(c["id"])
                for c in cands}
        for fut in as_completed(futs):
            mid = futs[fut]
            try:
                directors[mid] = fut.result() or ""
            except Exception:
                directors[mid] = ""
    return directors

def auto_pick_or_prompt(cands, title, director, _unused, auto_margin, *,
                        lang_for_director="fr-FR", force_prompt=False):
    if not cands:
        print(f"[info] Aucun résultat TMDB pour: {title}")
        return None

    director = (director or "").strip()
    ordered = sorted(cands, key=lambda c: _rank_key(title, c), reverse=True)

    dir_scores = {}
    directors = {}
    if director:
        top_for_directors = ordered[:10]
        directors = _prefetch_directors(top_for_directors, lang_for_director)
        for c in top_for_directors:
            mid = int(c["id"])
            direc = directors.get(mid, "")
            if direc:
                dir_scores[mid] = _director_similarity(director, direc)

        if dir_scores and not force_prompt:
            best_mid, best_score = max(dir_scores.items(), key=lambda x: x[1])
            if best_score >= 0.90:
                for c in ordered:
                    if int(c["id"]) == best_mid:
                        return c

        ordered = sorted(
            ordered,
            key=lambda c: (
                dir_scores.get(int(c["id"]), 0.0),
                _year_bucket(c),
                _composite(title, c),
            ),
            reverse=True,
        )
    if len(ordered) == 1 and not force_prompt:
        return ordered[0]

    if len(ordered) >= 2 and not force_prompt:
        s1 = _composite(title, ordered[0])
        s2 = _composite(title, ordered[1])
        if (s1 - s2) >= auto_margin:
            return ordered[0]


    # --- liste interactive ---
    short = ordered[:10]
    top_for_directors = short[:5]
    if not directors:
        directors = _prefetch_directors(top_for_directors, lang_for_director)

    if (not mode_Gui):
        print("\nPlusieurs correspondances pour:", title)
    else :
        choices=[]
    for idx, c in enumerate(short, start=1):
        tit = c.get("title") or c.get("name") or ""
        rd  = c.get("release_date") or ""
        yy  = rd[:4] if rd else "----"
        pop = float(c.get("popularity") or 0.0)
        sim = _title_similarity(title, c)
        mid = int(c.get("id"))
        direc = directors.get(mid, "")
        #si la comparaison du nom du realisateur depasse eun score de 0.9 on peut raisonnablement pensé qu'il s'agit du bon film
        if not force_prompt and director and _director_similarity(director, direc) >= 0.9:
            return short[idx - 1]
        suffix = f" — {direc}" if direc else ""
        if (not mode_Gui):
            print(f"  [{idx}] {tit}{suffix} ({yy})  pop={pop:.1f}  sim={sim:.2f}")
        else :
            choice_str=f"  [{idx}] {tit}{suffix} ({yy})  pop={pop:.1f}  sim={sim:.2f}"
            choices.append(choice_str)

    if (mode_Gui):
        choice=gui_select_movie(title,choices)
    else:
        print("  [0] Aucun / passer")

        while True:
            try:
                choice = int(input("Choix ? [0..9] : ").strip() or "1")
            except Exception:
                choice = -1
            if 0 <= choice <= min(10, len(short)):
                break
            print("Entrée invalide.")
    if choice == 0:
        return None
    return short[choice - 1]


# ---------- Pipeline ----------
def normalize_columns(df):
    mapping = {"Titre": "titre", "TitreOriginal": "titre_original", "Realisateur": "realisateur",
               "ActeursPrincipaux": "acteurs_principaux", "Genres": "genres", "Annee": "annee",
               "Pays": "pays", "DureeMin": "duree_min", "Synopsis": "synopsis",
               "AfficheURL": "affiche_url", "BackdropURL": "backdrop_url",
               "TrailerURL": "trailer_url", "Date": "date", "Heure": "heure",
               "Version": "version", "Tarif": "tarif", "Categorie": "categorie",
               "Commentaire": "commentaire", "datetime_local": "datetime_local"}
    for o, n in mapping.items():
        if o in df.columns and n not in df.columns:
            df[n] = df[o]
    return df

def ensure_output_cols(df):
    for c in OUTPUT_ENRICH_COLS:
        if c not in df.columns:
            df[c] = ""
    if "backdrops" not in df.columns:
        df["backdrops"] = ""
    return df


def enrich_row(row, args, force_prompt=False):
    global window
    if mode_Gui :
        window.config(cursor="watch")
    row = row.copy()
    title = (row.get("titre") or row.get("Titre") or "").strip()
    director= (row.get("realisateur") or row.get("Realisateur") or "").strip()
    if not title:
        return row

    cands_fr = search_movie_with_director(title, director, args.lang)
    chosen = auto_pick_or_prompt(cands_fr, title, director, None, args.auto_margin,
                                 lang_for_director=args.lang, force_prompt=force_prompt)
    details_fr = get_movie_details(chosen["id"], args.lang) if chosen else None

    details_en = None
    if not details_fr:
        cands_en = search_movie_with_director(title, director, "en-US")
        chosen = auto_pick_or_prompt(cands_en, title, director, None, args.auto_margin,
                                     lang_for_director="en-US", force_prompt=force_prompt)
        if chosen:
            details_en = get_movie_details(chosen["id"], "en-US")

    details = details_fr or details_en
    if not details:
        return row

    mid = int(details.get("id"))
    credits = get_movie_credits(mid, args.lang)
    images = get_movie_images(mid)

    poster = pick_best_poster(details) or (IMG_W500 + details.get("poster_path", "")) if details.get("poster_path") else ""
    best_back = pick_best_backdrop(images, details_fr, details_en) or ""
    all_backs = build_all_backdrops(images, prefer_min_width=1280)

    dirs, main = extract_people(credits)
    genres = extract_genres(details)
    pays = extract_countries(details)
    row["tmdb_id"] = str(mid)
    row["imdb_id"] = (details.get("imdb_id") or "").strip()
    # Allociné via Wikidata (IMDb -> Wikidata P1265)
    try:
        row["allocine_url"] = allocine_url_from_imdb(row["imdb_id"]) or row.get("allocine_url", "")
    except Exception:
        row["allocine_url"] = row.get("allocine_url", "")
    row["affiche_url"] = poster or row.get("affiche_url", "")
    row["backdrop_url"] = best_back or row.get("backdrop_url", "")
    row["backdrops"] = json.dumps(all_backs, ensure_ascii=False)
    row["titre"] = details.get("title") or row.get("titre", "")
    row["titre_original"] = details.get("original_title") or row.get("titre_original", "")
    row["realisateur"] = dirs or row.get("realisateur", "")
    row["acteurs_principaux"] = main or row.get("acteurs_principaux", "")
    row["genres"] = genres or row.get("genres", "")
    row["annee"] = (details.get("release_date") or "")[:4] or row.get("annee", "")
    row["pays"] = pays or row.get("pays", "")
    row["duree_min"] = str(details.get("runtime") or "").strip() or row.get("duree_min", "")
    row["synopsis"] = (details_fr or {}).get("overview") or (details_en or {}).get("overview") or row.get("synopsis", "")
    if mode_Gui:
        window.config(cursor="")
    return row

def gui_select_movie(title,choices):
    global window
    window.attributes("-topmost", True)

    new_window = tk.Toplevel(window)
    new_window.title("selection : %s" %title)
    hauteur=str(30*len(choices)+20)
    new_window.geometry("600x%s" %hauteur)

    choice=tk.IntVar(new_window, value = 0  )

    var=1
    for c in choices:
        ttk.Radiobutton(new_window, text=c, variable=choice, value=var).pack(fill='x')
        var+=1
    tk.Button(new_window, text="Valider/Passer", command=new_window.destroy).pack()
    #force display
    window.attributes("-topmost", False)
    new_window.attributes("-topmost", True)
    window.update()
    window.update_idletasks()

    window.wait_window(new_window)
    return choice.get()

def main(main_window=None):
    p = argparse.ArgumentParser()
    p.add_argument("--in", dest="in_xlsx", default="normalized.xlsx")
    p.add_argument("--out", dest="out_xlsx", default="enriched.xlsx")
    p.add_argument("--lang", dest="lang", default=LANG_DEFAULT)
    p.add_argument("--auto-margin", dest="auto_margin", type=float, default=4.0)
    args = p.parse_args()

    # positionnement de mode_GUI afin de gérer  la selection des films
    global  mode_Gui,window,TMDB_API_KEY

    if (main_window ) :
        mode_Gui=True
        window=main_window
        root=Path(os.getcwd())
        TMDB_API_KEY = os.environ.get("TMDB_API_KEY", "").strip()
    else:
        root = Path(__file__).resolve().parent
    work = root / "work"
    work.mkdir(parents=True, exist_ok=True)
    in_path = work / args.in_xlsx
    out_path = work / args.out_xlsx

    if not in_path.exists():
        print(f"[ERREUR] {in_path} introuvable.")
        sys.exit(1)

    df = pd.read_excel(in_path, dtype=str).fillna("")
    df = normalize_columns(df)
    df = ensure_output_cols(df)

    flagged = []
    print(f"[info] {len(df)} lignes à traiter")
    for i in range(len(df)):
        row = df.iloc[i].copy()

        cat = (row.get("categorie") or row.get("Categorie") or "")
        com = (row.get("commentaire") or row.get("Commentaire") or "")
        txt = f"{cat} || {com}".lower()
        need_prompt = False
        if any(w in txt for w in SUSPECT_WORDS):
            t = (row.get("titre") or row.get("Titre") or row.get("titre_original") or "Sans titre")
            print(f"[alerte] '{t}' : mot-clé trouvé → {txt}")
            flagged.append({"index": i, "titre": t, "categorie": cat, "commentaire": com})
            need_prompt = True

        try:
            df.iloc[i] = enrich_row(row, args, force_prompt=need_prompt)
        except KeyboardInterrupt:
            print("\n[stop] interrompu.")
            break
        except Exception as e:
            print(f"[warn] Ligne {i}: {e}")
            time.sleep(0.2)

    if flagged:
        print("\n=== Films potentiellement 'anciens' ===")
        for f in flagged:
            print(f"- [{f['index']}] {f['titre']}")
            if f["categorie"]:
                print(f"   categorie : {f['categorie']}")
            if f["commentaire"]:
                print(f"   commentaire : {f['commentaire']}")
        print("=== Fin liste ===\n")

    print(f"[info] Écriture : {out_path}")
    with pd.ExcelWriter(out_path, engine="openpyxl") as w:
        df.to_excel(w, index=False)
    print("[done] Enrich terminé.")


if __name__ == "__main__":
    main()
