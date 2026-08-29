from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch


TOOLS_DIR = Path(__file__).resolve().parents[1]
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

import enrich_3_0 as enrich  # noqa: E402


class ProvidedAllocineUrlTests(unittest.TestCase):
    def test_provided_url_skips_search_but_loads_metadata_once(self):
        allocine_url = (
            "https://www.allocine.fr/film/fichefilm_gen_cfilm=1000034332.html"
        )
        films = [
            {
                "titre": "Une affaire turque",
                "realisateur": "Huseyin Aydin Gursoy",
                "allocine_url": allocine_url,
                "enriched": {},
            },
            {
                "titre": "Une affaire turque",
                "realisateur": "Huseyin Aydin Gursoy",
                "allocine_url": allocine_url,
                "enriched": {},
            },
        ]
        metadata = {
            "allocine_title": "Une affaire turque",
            "affiche": "https://example.test/poster.jpg",
        }

        with (
            patch.object(enrich, "allocine_find_movie") as search,
            patch.object(enrich, "allocine_movie_meta", return_value=metadata) as meta,
            patch.object(enrich, "allocine_photo_urls", return_value=[]) as photos,
        ):
            enrich.get_movies_from_allociné(films, only_missing=True)

        search.assert_not_called()
        meta.assert_called_once_with(allocine_url)
        photos.assert_called_once_with(allocine_url, "https://example.test/poster.jpg")
        for film in films:
            self.assertEqual(
                film["enriched"]["allocine_title"],
                "Une affaire turque",
            )
            self.assertEqual(
                film["enriched"]["affiche"],
                "https://example.test/poster.jpg",
            )

    def test_provided_url_mismatch_automatically_keeps_allocine(self):
        film = {
            "titre": "Le film source",
            "allocine_url_provided": True,
            "enriched": {},
        }

        with (
            patch.object(enrich, "_prompt_source_choice") as terminal_prompt,
            patch.object(enrich, "_gui_prompt_source_choice") as gui_prompt,
        ):
            choice = enrich._choose_mismatch_source(
                film,
                {"allocine_title": "Le bon film"},
                {"tmdb_title": "Un autre film"},
                {"title_score": 0.1, "director_score": 0.2},
            )

        self.assertEqual(choice, "a")
        terminal_prompt.assert_not_called()
        gui_prompt.assert_not_called()

    def test_matching_provided_url_still_allows_tmdb_complements(self):
        film = {
            "allocine_url_provided": True,
            "enriched": {},
        }

        self.assertTrue(enrich._tmdb_resources_allowed(film))

    def test_allocine_only_choice_blocks_tmdb_resources_and_fallback_names(self):
        film = {
            "titre": "Titre saisi",
            "realisateur": "Realisation saisie",
            "tmdb_title": "Mauvais titre TMDB",
            "tmdb_directors": "Mauvaise realisation TMDB",
            "enriched": {"source_preference": "a"},
        }

        self.assertFalse(enrich._tmdb_resources_allowed(film))
        self.assertEqual(enrich._canonical_title_for_output(film), "Titre saisi")
        self.assertEqual(
            enrich._canonical_director_for_output(film),
            "Realisation saisie",
        )


if __name__ == "__main__":
    unittest.main()
