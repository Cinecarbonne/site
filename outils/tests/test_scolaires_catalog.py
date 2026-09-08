from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import pandas as pd


SITE_DIR = Path(__file__).resolve().parents[2]
TOOLS_DIR = SITE_DIR / "outils"
for path in (SITE_DIR, TOOLS_DIR):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

import enrich_3_0 as enrich  # noqa: E402
from scolaires import ajouter_film  # noqa: E402


class SchoolCatalogTests(unittest.TestCase):
    def test_catalog_item_matches_the_public_schema(self):
        row = pd.Series(
            {
                "Titre": "Le Film",
                "Realisateur": "Une Réalisatrice",
                "Version": "VF",
                "date_sortie": "2026-09-08",
                "affiche_url": "https://example.test/poster.jpg",
                "backdrops": '["https://example.test/photo.jpg"]',
            }
        )

        item = ajouter_film._catalog_item(row)

        self.assertEqual(item["titre"], "Le Film")
        self.assertEqual(item["annee"], "2026-09-08")
        self.assertEqual(item["backdrops"], ["https://example.test/photo.jpg"])
        self.assertEqual(
            list(item),
            [
                "titre",
                "titre_original",
                "realisateur",
                "acteurs_principaux",
                "genres",
                "duree_min",
                "annee",
                "pays",
                "version",
                "recompenses",
                "synopsis",
                "affiche_url",
                "backdrops",
                "trailer_url",
                "allocine_url",
            ],
        )

    def test_add_movie_updates_and_sorts_the_editable_catalog(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            catalog_path = root / "films.json"
            legacy_path = root / "legacy.json"
            legacy_path.write_text(
                json.dumps([{"titre": "Zulu", "affiche_url": "z.jpg"}]),
                encoding="utf-8",
            )
            enriched = {
                "titre": "À l'école",
                "affiche_url": "a.jpg",
                "backdrops": [],
            }

            with (
                patch.object(ajouter_film, "CATALOG_PATH", catalog_path),
                patch.object(ajouter_film, "LEGACY_CATALOG_PATH", legacy_path),
                patch.object(ajouter_film, "enrich_movie", return_value=(enriched, {})),
            ):
                result = ajouter_film.add_movie("À l'école")

            saved = json.loads(catalog_path.read_text(encoding="utf-8"))
            self.assertEqual(result["count"], 2)
            self.assertEqual([item["titre"] for item in saved], ["À l'école", "Zulu"])

    def test_enrichment_accepts_isolated_input_and_output_paths(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            input_path = root / "source.xlsx"
            output_path = root / "resultat.xlsx"
            report_path = root / "rapport.json"
            pd.DataFrame(
                [
                    {
                        "Date": "2026-09-08",
                        "Heure": "00:00",
                        "Titre": "Film test",
                        "Version": "VF",
                        "Realisateur": "",
                        "Categorie": "SCOL",
                    }
                ]
            ).to_excel(input_path, index=False)

            with (
                patch.object(enrich, "get_movies_from_allociné", return_value=None),
                patch.object(enrich, "get_movies_from_tmdb", return_value=None),
                patch.object(enrich, "get_movies_from_google", return_value=None),
                patch.object(enrich, "youtube_pick_trailer", return_value=""),
                patch.object(enrich, "_open_report_for_reading") as open_report,
            ):
                result = enrich.main(
                    input_path=input_path,
                    output_path=output_path,
                    report_path=report_path,
                    open_report=False,
                )

            self.assertEqual(result, 0)
            self.assertTrue(output_path.exists())
            self.assertTrue(report_path.exists())
            open_report.assert_not_called()


if __name__ == "__main__":
    unittest.main()
