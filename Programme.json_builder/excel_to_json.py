#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
excel_to_json.py — Convertit work/enriched.xlsx vers public/data/programme.json

- Import incrémental robuste :
  1) Charge le JSON existant et NE GARDE QUE les séances dont la date >= aujourd'hui (heure ignorée).
  2) Ajoute TOUTES les lignes de l'Excel sans filtrage, en écrasant sur collision de clé.
  3) Trie chronologiquement et écrit le JSON final.

- Clé unique : date + heure.
- Champs exportés : compatibles avec le site (tarif, recompenses, commentaire, backdrops, etc.)
- Parsing date/heure déterministe (ISO prioritaire, puis DD/MM/YYYY), pour éviter inversions jour/mois.
"""

import json
from pathlib import Path
from datetime import datetime
import pandas as pd
import re

# Emplacements
IN_XLSX  = Path("work/enriched.xlsx")
OUT_JSON = Path("../Lab/programme.json")

# Champs exportés (garde l’ordre)
FIELDS_TO_KEEP = [
    "datetime_local","date","heure",
    "titre","titre_original","realisateur","acteurs_principaux",
    "genres","duree_min","annee","pays","version",
    "tarif","recompenses","categorie","commentaire",
    "synopsis","affiche_url","backdrops",
    "trailer_url","tmdb_id","imdb_id",
    "allocine_url"
]


def safe_str(x):
    if x is None:
        return ""
    try:
        if pd.isna(x):
            return ""
    except Exception:
        pass
    return str(x)

ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
ISO_DT   = re.compile(r"^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$")
EU_DATE  = re.compile(r"^\d{1,2}/\d{1,2}/\d{4}$")

def parse_dt(obj: dict):
    """
    Parse déterministe pour éviter les inversions jour/mois.
    Priorité: datetime_local (ISO), puis date+heure.
    Retourne un pd.Timestamp ou None.
    """
    dl = (obj.get("datetime_local") or "").strip()
    if dl:
        # ISO datetime "YYYY-MM-DD HH:MM" ou "YYYY-MM-DDTHH:MM(:SS)?"
        if ISO_DT.match(dl):
            # Essais explicites avant fallback
            dt = pd.to_datetime(dl.replace("T", " "), format="%Y-%m-%d %H:%M", errors="coerce")
            if pd.isna(dt):
                dt = pd.to_datetime(dl, dayfirst=False, errors="coerce")
            return None if pd.isna(dt) else dt
        # Fallback (historique / tolérant)
        dt = pd.to_datetime(dl, dayfirst=True, errors="coerce")
        return None if pd.isna(dt) else dt

    d = (obj.get("date") or obj.get("Date") or "").strip()
    h = (obj.get("heure") or obj.get("Heure") or "").strip() or "00:00"

    if not d:
        return None

    # ISO date "YYYY-MM-DD" => parse strict
    if ISO_DATE.match(d):
        dt = pd.to_datetime(f"{d} {h}", format="%Y-%m-%d %H:%M", errors="coerce")
        return None if pd.isna(dt) else dt

    # Européen "DD/MM/YYYY" => dayfirst=True
    if EU_DATE.match(d):
        dt = pd.to_datetime(f"{d} {h}", dayfirst=True, errors="coerce")
        return None if pd.isna(dt) else dt

    # Dernier recours (tolérant mais moins déterministe)
    dt = pd.to_datetime(f"{d} {h}", dayfirst=True, errors="coerce")
    return None if pd.isna(dt) else dt

def base_key(obj: dict) -> str:
    """
    Clé unique: date + heure.
    """
    date_s = (obj.get("date") or obj.get("Date") or "").strip()
    heure_s = (obj.get("heure") or obj.get("Heure") or "").strip()
    return f"dht|{date_s}|{heure_s}"

def make_key(obj: dict) -> str:
    """
    Clé unique par séance: date + heure (fallback datetime_local).
    """
    return base_key(obj)

def load_existing() -> list:
    if OUT_JSON.exists():
        try:
            with open(OUT_JSON, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, list):
                    for item in data:
                        if isinstance(item, dict):
                            item.pop("backdrop_url", None)
                    return data
        except Exception:
            pass
    return []

def row_to_obj(r: pd.Series) -> dict:
    """
    Convertit une ligne pandas -> dict pour JSON, avec gestion case-insensible.
    """
    # dictionnaire "clé minuscule -> valeur"
    raw = {}
    try:
        raw = {str(k).strip().lower(): r[k] for k in r.index}
    except Exception:
        for k in r.index:
            try:
                raw[str(k).strip().lower()] = r[k]
            except Exception:
                pass

    obj = {}
    for k in FIELDS_TO_KEEP:
        if k == "backdrops":
            val = r.get(k, "")
            if val == "" and "backdrops" not in r and "backdrops" in raw:
                val = raw.get("backdrops", "")
            s = safe_str(val)
            if s and s.lstrip().startswith("["):
                try:
                    obj[k] = json.loads(s)
                except Exception:
                    obj[k] = []
            else:
                obj[k] = []
            continue

        v = r.get(k, None)
        if v is None:
            v = raw.get(k.lower(), "")
        obj[k] = safe_str(v)

    return obj

def drop_past(items: list, mode: str) -> list:
    """
    Supprime les séances passées si demandé.
    mode = 'date' (date < aujourd'hui) ou 'datetime' (dt < maintenant).
    """
    now = pd.Timestamp.now()
    today = now.normalize().date()
    kept = []
    for obj in items:
        dt = parse_dt(obj)
        if dt is None:
            kept.append(obj)
            continue
        if mode == "datetime":
            if dt >= now:
                kept.append(obj)
        else:  # 'date'
            if dt.date() >= today:
                kept.append(obj)
    return kept

def main():
    # 0) Charger l’Excel (obligatoire)
    if not IN_XLSX.exists():
        raise SystemExit(f"[ERREUR] {IN_XLSX} introuvable.")
    df = pd.read_excel(IN_XLSX, sheet_name=0, dtype=str).fillna("")

    merged: dict[str, dict] = {}

    # 1) Charger l'existant et NE GARDER QUE les séances dont la date >= aujourd'hui (heure ignorée)
    existing = load_existing()
    if existing:
        for x in drop_past(existing, mode="date"):
            merged[make_key(x)] = x

    # 2) Ajouter / écraser avec l'Excel (on ne filtre PAS l'Excel)
    for _, r in df.iterrows():
        obj = row_to_obj(r)
        categorie = (obj.get("categorie") or "").strip().upper()
        if categorie == "SCOL":
            continue
        merged[make_key(obj)] = obj

    items = list(merged.values())

    # 3) Tri chronologique (les items sans date parsable partent à la fin)
    def sort_key(o):
        dt = parse_dt(o)
        return dt.to_pydatetime() if dt is not None else datetime(9999, 1, 1)
    items.sort(key=sort_key)

    # 4) Écriture
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)

    print(f"[done] écrit: {OUT_JSON}  ({len(items)} séances)")
    print("[info] logique: (existant filtré aux >= aujourd'hui) + Excel (écrase sur même clé) ; tri chronologique")

if __name__ == "__main__":
    main()
