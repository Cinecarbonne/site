#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Normalize Ciné Carbonne Excel (Feuil1) into a clean table (v3: direct column mapping).

Entrée :  input/source.xlsx  (Feuil1)
Sorties :
    - work/normalized.xlsx
    - work/prochainement.json  (liste de textes "prochainement")
"""

from pathlib import Path
import re
from datetime import datetime, time
from dateutil import parser as dtparser
import json

import pandas as pd
import openpyxl

# --- chemins ---
INPUT_PATH          = Path("input/source.xlsx")
OUTPUT_PATH         = Path("work/normalized.xlsx")
PROCHAINEMENT_PATH  = Path("work/prochainement.json")
SHEET_NAME          = "Feuil1"

# --- colonnes du fichier source (index 0-based pour pandas) ---
COL_A, COL_B, COL_C = 0, 1, 2
COL_TITRE   = 4      # E
COL_VERSION = 5      # F
COL_CM    = 6      # G
COL_REAL      = 7      # H
COL_PRIX    = 8      # I
COL_CATEG   = 9      # J
COL_TARIF   = 10     # K
COL_COMMENT = 11     # L

WEEKDAYS_FR = {"lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"}

# --- contexte date d'exécution ---
EXEC_DATE   = datetime.today().date()
IS_DECEMBER = (EXEC_DATE.month == 12)


# ------------------------------------------------------------
# utilitaires
# ------------------------------------------------------------

def is_weekday_label(x):
    if x is None or (isinstance(x, float) and pd.isna(x)):
        return False
    s = str(x).strip().lower()
    return any(s.startswith(w) for w in WEEKDAYS_FR)


def parse_date_cell(x):
    """Parse une cellule de date Excel (ou texte) en date, avec correction décembre → janvier N+1."""
    if pd.isna(x):
        return None

    # 1) Cas : vrai datetime / Timestamp venant d'Excel
    if isinstance(x, (pd.Timestamp, datetime)):
        d = pd.to_datetime(x).date()

        # Ajustement "décembre → janvier N+1"
        if IS_DECEMBER and d.month == 1 and d.year == EXEC_DATE.year:
            d = d.replace(year=EXEC_DATE.year + 1)

        return d

    # 2) Cas : texte à parser
    s = str(x).strip()
    for dayfirst in (True, False):
        try:
            d = dtparser.parse(s, dayfirst=dayfirst, fuzzy=True).date()

            # Même ajustement pour le texte
            if IS_DECEMBER and d.month == 1 and d.year == EXEC_DATE.year:
                d = d.replace(year=EXEC_DATE.year + 1)

            return d
        except Exception:
            pass

    return None

def parse_time_cell(x):
    if pd.isna(x):
        return None
    if isinstance(x, (pd.Timestamp, datetime)):
        t = pd.to_datetime(x).time()
        return t.replace(second=0, microsecond=0)
    if isinstance(x, time):
        return x.replace(second=0, microsecond=0)

    s = str(x).strip()
    m = re.search(r"(\d{1,2})\s*[h:]\s*(\d{1,2})?$", s)
    if m:
        hh = int(m.group(1))
        mm = int(m.group(2)) if m.group(2) else 0
        if 0 <= hh < 24 and 0 <= mm < 60:
            return time(hh, mm)

    try:
        t = dtparser.parse(s).time()
        return t.replace(second=0, microsecond=0)
    except Exception:
        return None


def norm_str(x):
    if x is None or (isinstance(x, float) and pd.isna(x)):
        return None
    s = str(x).strip()
    return s or None


def normalize_version(v):
    v = (v or "").strip().upper()
    if v == "VOSTFR":
        return "VOstFR"
    if v in ("VO", "VF"):
        return v
    return "VF"


def is_red_background(cell):
    """Retourne True si la cellule Excel a un fond rouge (#FF0000)."""
    fill = cell.fill
    if fill is None:
        return False

    fg = fill.fgColor
    if fg is None:
        return False

    rgb = getattr(fg, "rgb", None)
    if rgb is None:
        return False

    # rgb peut être une string ou un objet avec .rgb
    if not isinstance(rgb, str):
        rgb = getattr(rgb, "rgb", None)
        if rgb is None or not isinstance(rgb, str):
            return False

    code = rgb.upper().lstrip("#")
    # ARGB -> RRGGBB
    if len(code) == 8:
        code = code[2:]

    return code == "FF0000"


# ------------------------------------------------------------
# MAIN
# ------------------------------------------------------------

def main():
    if not INPUT_PATH.exists():
        raise SystemExit(f"❌ Fichier introuvable : {INPUT_PATH}")

    # pandas : valeurs
    raw = pd.read_excel(INPUT_PATH, sheet_name=SHEET_NAME, header=None, dtype=object)

    # openpyxl : styles (couleurs)
    wb = openpyxl.load_workbook(INPUT_PATH, data_only=True)
    ws = wb[SHEET_NAME]

    records = []
    upcoming_blocks = []   # pour "prochainement"
    current_date = None

    # raw.index est en général un RangeIndex, mais on l'utilise explicitement
    index_list = list(raw.index)

    for idx, row in raw.iterrows():
        # --------------------------------------------------------
        # 1) Gestion "PROCHAINEMENT"
        # --------------------------------------------------------
        a = row.get(COL_A)
        b = row.get(COL_B)

        titre_cell_value = row.get(COL_TITRE)
        titre_norm = norm_str(titre_cell_value)

        # "pas de jour / pas de date" à gauche
        has_weekday = is_weekday_label(a)
        has_date = parse_date_cell(b) is not None

        if titre_norm and "prochainement" in titre_norm.lower() and not has_weekday and not has_date:
            # on prend la ligne suivante, colonne E
            try:
                next_idx_pos = index_list.index(idx) + 1
                if next_idx_pos < len(index_list):
                    next_idx = index_list[next_idx_pos]
                    next_row = raw.loc[next_idx]
                    next_title = norm_str(next_row.get(COL_TITRE))
                    if next_title:
                        upcoming_blocks.append(next_title)
            except ValueError:
                # idx pas trouvé dans index_list (très improbable)
                pass
            # on ne fait pas de séance avec cette ligne "prochainement"
            # mais on CONTINUE la boucle pour passer à la suite
            # (continue implicite ici, on laisse la suite exécuter,
            # mais sans date ni heure ça ne créera rien)
            # pas de "continue" forcé pour ne pas casser une logique éventuelle.
            # On ne sort pas ici.

        # --------------------------------------------------------
        # 2) Ignorer les lignes dont le titre (col E) a un fond rouge
        # --------------------------------------------------------
        titre_cell_excel = ws.cell(row=idx + 1, column=COL_TITRE + 1)  # openpyxl = 1-based
        if is_red_background(titre_cell_excel):
            continue

        # --------------------------------------------------------
        # 3) Mise à jour du jour courant
        # --------------------------------------------------------
        if is_weekday_label(a) and parse_date_cell(b):
            current_date = parse_date_cell(b)

        # --------------------------------------------------------
        # 4) Détection séance classique
        # --------------------------------------------------------
        t = parse_time_cell(row.get(COL_C))
        titre = norm_str(row.get(COL_TITRE))

        if current_date and t and titre:
            version = normalize_version(norm_str(row.get(COL_VERSION)))
            cm = norm_str(row.get(COL_CM))
            realisateur =  norm_str(row.get(COL_REAL))
            recompenses = norm_str(row.get(COL_PRIX))
            categorie = norm_str(row.get(COL_CATEG))
            tarif = norm_str(row.get(COL_TARIF))
            commentaire = norm_str(row.get(COL_COMMENT))

            # --- Normalisation textuelle du champ Tarif ---
            if tarif:
                # Remplacer TU par Tarif Unique
                tarif = re.sub(r"\bTU\b", "Tarif Unique", tarif, flags=re.IGNORECASE)

                # Remplacer ADH par Adhérents
                tarif = re.sub(r"\bADH\b", "Adhérents", tarif, flags=re.IGNORECASE)

            records.append({
                "Date": current_date.strftime("%Y-%m-%d"),
                "Heure": f"{t.hour:02d}:{t.minute:02d}",
                "Titre": titre,
                "Version": version,
                "CM": cm,
                "Realisateur" : realisateur,
                "Recompenses": recompenses,
                "Categorie": categorie,
                "Tarif": tarif,
                "Commentaire": commentaire,
            })

    # --------------------------------------------------------
    # export des séances
    # --------------------------------------------------------
    df = pd.DataFrame(records, columns=[
        "Date", "Heure", "Titre", "Version", "CM", 'Realisateur',
        "Recompenses", "Categorie", "Tarif", "Commentaire"
    ])

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    df.to_excel(OUTPUT_PATH, index=False)
    print(f"✅ Écrit : {OUTPUT_PATH} ({len(df)} lignes)")

    # --------------------------------------------------------
    # export "prochainement"
    # on écrit systématiquement un JSON (liste de chaînes)
    # --------------------------------------------------------
    PROCHAINEMENT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with PROCHAINEMENT_PATH.open("w", encoding="utf-8") as f:
        json.dump(upcoming_blocks, f, ensure_ascii=False, indent=2)

    print(f"✅ Écrit : {PROCHAINEMENT_PATH} ({len(upcoming_blocks)} bloc(s))")


if __name__ == "__main__":
    main()
