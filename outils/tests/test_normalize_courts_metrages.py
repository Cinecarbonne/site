from __future__ import annotations

import sys
import unittest
from datetime import datetime
from pathlib import Path

import pandas as pd


TOOLS_DIR = Path(__file__).resolve().parents[1]
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

import normalize  # noqa: E402


def empty_source(row_count: int = 40, column_count: int = 15) -> pd.DataFrame:
    return pd.DataFrame(
        [[None for _ in range(column_count)] for _ in range(row_count)],
        dtype=object,
    )


class VersionNormalizationTests(unittest.TestCase):
    def test_vost_ocap_is_a_distinct_version(self):
        for value in ("Vost OCAP", "VOST OCAP", "VOST-OCAP"):
            with self.subTest(value=value):
                self.assertEqual(normalize.normalize_version(value), "VOST OCAP")

    def test_vost_ocap_marker_can_be_read_from_title(self):
        title, version, _, _ = normalize.normalize_title_field(
            "Le film VOST OCAP"
        )

        self.assertEqual(title, "Le film")
        self.assertEqual(version, "VOST OCAP")


class CourtMetrageDefinitionTests(unittest.TestCase):
    def test_definition_accepts_new_format_without_colon(self):
        parsed = normalize.parse_cm_definition(
            "CM1 Je suis une biche - Fiction fantastique - 02'00"
        )

        self.assertEqual(parsed["code"], "CM1")
        self.assertEqual(parsed["titre"], "Je suis une biche")
        self.assertEqual(parsed["genre"], "Fiction fantastique")
        self.assertEqual(parsed["duree"], "02'00")

    def test_definition_keeps_legacy_colon_format(self):
        parsed = normalize.parse_cm_definition(
            "CM2: Johnny Express - Animation Science fiction - 05'20"
        )

        self.assertEqual(parsed["code"], "CM2")
        self.assertEqual(parsed["titre"], "Johnny Express")


class FooterCourtMetrageCatalogTests(unittest.TestCase):
    def test_footer_position_is_dynamic_and_current_month_is_selected(self):
        raw = empty_source(row_count=60)
        raw.iat[3, 0] = "Mercredi"
        raw.iat[3, 1] = datetime(2026, 9, 2)

        # Le bloc peut changer de ligne d'un programme a l'autre.
        raw.iat[37, 13] = "Courts métrages à venir"
        raw.iat[38, 13] = "09/26"
        raw.iat[38, 14] = "CM1 Je suis une biche - Fiction fantastique - 02'00"
        raw.iat[39, 13] = "09/26"
        raw.iat[39, 14] = "CM2 Johnny Express - Animation Science fiction - 05'20"

        # Un code reutilise pour un mois suivant ne doit pas remplacer celui
        # du programme traite.
        raw.iat[40, 13] = "10/26"
        raw.iat[40, 14] = "CM1 Court d'octobre - Fiction - 03'00"

        catalog = normalize.extract_cm_catalog(raw)

        self.assertEqual(set(catalog), {"CM1", "CM2"})
        self.assertEqual(catalog["CM1"]["titre"], "Je suis une biche")
        self.assertEqual(catalog["CM2"]["titre"], "Johnny Express")

    def test_footer_overrides_legacy_definition_for_same_code(self):
        raw = empty_source()
        raw.iat[0, 0] = "CM1: Ancien titre - Fiction - 01'00"
        raw.iat[3, 0] = "Mercredi"
        raw.iat[3, 1] = datetime(2026, 9, 2)
        raw.iat[20, 13] = "Courts metrages a venir"
        raw.iat[21, 13] = "09/26"
        raw.iat[21, 14] = "CM1 Nouveau titre - Animation - 02'00"

        catalog = normalize.extract_cm_catalog(raw)

        self.assertEqual(catalog["CM1"]["titre"], "Nouveau titre")

    def test_session_references_are_resolved_from_catalog(self):
        catalog = {
            "CM1": {
                "code": "CM1",
                "titre": "Je suis une biche",
                "genre": "Fiction fantastique",
                "duree": "02'00",
                "texte": "Je suis une biche - Fiction fantastique - 02'00",
            },
            "CM2": {
                "code": "CM2",
                "titre": "Johnny Express",
                "genre": "Animation Science fiction",
                "duree": "05'20",
                "texte": "Johnny Express - Animation Science fiction - 05'20",
            },
        }

        resolved = normalize.resolve_courts_metrages(catalog, "CM1 / CM2")

        self.assertEqual(
            [court["titre"] for court in resolved],
            ["Je suis une biche", "Johnny Express"],
        )


if __name__ == "__main__":
    unittest.main()
