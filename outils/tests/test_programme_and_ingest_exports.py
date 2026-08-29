from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import pandas as pd


TOOLS_DIR = Path(__file__).resolve().parents[1]
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

import excel_to_json  # noqa: E402
import make_tableau_ingest as ingest  # noqa: E402


COURTS_METRAGES = [
    {
        "code": "CM1",
        "titre": "Je suis une biche",
        "genre": "Fiction fantastique",
        "duree": "02'00",
        "texte": "Je suis une biche - Fiction fantastique - 02'00",
    }
]


class ProgrammeJsonExportTests(unittest.TestCase):
    def test_version_and_courts_metrages_are_kept(self):
        row = pd.Series(
            {
                "Date": "2026-09-03",
                "Heure": "21:00",
                "Titre": "Paradise",
                "Version": "VOST OCAP",
                "courts_metrages": json.dumps(COURTS_METRAGES, ensure_ascii=False),
            }
        )

        exported = excel_to_json.row_to_obj(row)

        self.assertEqual(exported["version"], "VOST OCAP")
        self.assertEqual(exported["courts_metrages"], COURTS_METRAGES)


class IngestWorkbookExportTests(unittest.TestCase):
    def test_version_and_court_metrage_are_visible_in_ingest(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            normalized = root / "normalized.xlsx"
            output = root / "tableau_ingest.xlsx"
            pd.DataFrame(
                [
                    {
                        "Date": "2026-09-03",
                        "Heure": "21:00",
                        "Titre": "Paradise",
                        "Version": "VOST OCAP",
                        "CM": "CM1",
                        "courts_metrages": json.dumps(
                            COURTS_METRAGES,
                            ensure_ascii=False,
                        ),
                        "Realisateur": "Jeremy Comte",
                        "Categorie": "Decouverte",
                    }
                ]
            ).to_excel(normalized, index=False)

            with (
                patch.object(ingest, "lookup_films", return_value=({}, {})),
                patch.object(ingest, "accessibility_for", return_value="A verifier"),
            ):
                result = ingest.main(
                    [
                        "--input",
                        str(normalized),
                        "--source",
                        str(root / "missing-source.xlsx"),
                        "--output",
                        str(output),
                        "--cache",
                        str(root / "cache.json"),
                        "--report",
                        str(root / "report.json"),
                    ]
                )

            self.assertEqual(result, 0)
            exported = pd.read_excel(output).fillna("")
            self.assertEqual(
                list(exported.columns),
                ["Titre", "Version", "Date", "Heure", "Accessibilité"],
            )
            self.assertEqual(exported.iloc[0]["Titre"], "CM1 - Je suis une biche")
            self.assertEqual(exported.iloc[0]["Version"], "")
            self.assertEqual(exported.iloc[1]["Titre"], "Paradise + CM1")
            self.assertEqual(exported.iloc[1]["Version"], "VOST OCAP")


if __name__ == "__main__":
    unittest.main()
