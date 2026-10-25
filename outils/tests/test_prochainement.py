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

import generate_prochainement_json as generator
import normalize


class ProchainementExtractionTests(unittest.TestCase):
    def source(self):
        raw = pd.DataFrame([[None] * 9 for _ in range(12)], dtype=object)
        raw.iat[8, 8] = "Cinés goûters"
        raw.iat[9, 8] = "Film enfant A\nFilm enfant B\nFilm enfant C\nFilm enfant D"
        return raw

    def test_current_marker_reads_title_list_instead_of_cine_gouters(self):
        raw = self.source()
        raw.iat[5, 4] = "Prochainement"
        raw.iat[6, 4] = "Kill Bill, Hope, Moulin"
        self.assertEqual(
            normalize.extract_prochainement_blocks(raw), ["Kill Bill, Hope, Moulin"]
        )

    def test_legacy_marker_in_column_i_still_reads_column_e(self):
        raw = self.source()
        raw.iat[3, 8] = "Prochainement :"
        raw.iat[4, 4] = "Film A, Film B"
        self.assertEqual(normalize.extract_prochainement_blocks(raw), ["Film A, Film B"])

    def test_missing_or_empty_marker_never_uses_an_unrelated_list(self):
        raw = self.source()
        self.assertEqual(normalize.extract_prochainement_blocks(raw), [])
        raw.iat[5, 4] = "Prochainement"
        self.assertEqual(normalize.extract_prochainement_blocks(raw), [])

    def test_session_title_is_not_a_footer_marker(self):
        raw = self.source()
        raw.iat[5, 2] = "21h"
        raw.iat[5, 4] = "Prochainement"
        raw.iat[6, 4] = "Film suivant"
        self.assertEqual(normalize.extract_prochainement_blocks(raw), [])


class ProchainementGenerationTests(unittest.TestCase):
    def test_generic_allocine_image_is_not_a_poster(self):
        with (
            patch.object(generator.enrich, "allocine_get") as get,
            patch.object(generator.enrich, "_allocine_extract_og_image", return_value=(
                "https://fr.web.img3.acsta.net/commons/v9/common/empty/empty_portrait.png"
            )),
        ):
            get.return_value.text = ""
            self.assertIsNone(generator._allocine_candidate("Les Braves", "https://example.test/film"))

    def test_missing_marker_stops_generation_despite_stale_title_file(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "source.xlsx"
            pd.DataFrame({"I": ["Cinés goûters", "Film A\nFilm B"]}).to_excel(
                source, sheet_name="Feuil1", index=False, header=False
            )
            with self.assertRaisesRegex(SystemExit, "Aucun titre prochainement"):
                generator.load_titles(source)

    def test_manual_kill_bill_selection_bypasses_search_and_survives_regeneration(self):
        title = "Kill Bill: The Whole Bloody Affair"
        url = "https://www.allocine.fr/film/fichefilm_gen_cfilm=1000028176.html"
        candidate = generator.PosterCandidate(
            "allocine", "https://example.test/kill-bill.jpg", "2026-07-08", 1.0, title, url
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            overrides = Path(temp_dir) / "overrides.json"
            overrides.write_text(json.dumps({
                "Soirée spéciale Kill Bill": {"title": title, "allocine_url": url}
            }), encoding="utf-8")
            with (
                patch.object(generator, "INPUT_OVERRIDES", overrides),
                patch.object(generator, "_allocine_candidate", return_value=candidate) as allocine,
                patch.object(generator, "_tmdb_candidate") as tmdb,
            ):
                items, missing = generator.build_output_items(["soirée spéciale KILL BILL"])
        allocine.assert_called_once_with(title, url)
        tmdb.assert_not_called()
        self.assertEqual(missing, [])
        self.assertEqual(items[0]["title"], title)
        self.assertEqual(items[0]["poster"], candidate.poster_url)


if __name__ == "__main__":
    unittest.main()
