import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import requests


OUTILS_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(OUTILS_DIR))

import accessibility_lookup as lookup


def _source(url="https://example.test/article", date="2026-06-01"):
    return {"url": url, "date": date, "article_title": "Films accessibles"}


def _entry(title, director, codes, evidence=None):
    return {
        "title": title,
        "director": director,
        "codes": codes,
        "evidence": evidence or f"{title} de {director} : {' '.join(codes)}",
        "source": _source(),
    }


def _section(application, evidence):
    return {
        "application": application,
        "evidence": evidence,
        "source": _source(),
    }


class NormalizationTests(unittest.TestCase):
    def test_accents_apostrophes_parentheses_and_suffixes(self):
        self.assertEqual(
            lookup.normalize_title("L’Écologie des sentiment(s) - SCOL + CM1"),
            lookup.normalize_title("L'ecologie des sentiments"),
        )
        self.assertEqual(
            lookup.normalize_title("CM2 - Les Parfait(s)"),
            lookup.normalize_title("Les Parfaits"),
        )

    def test_fuzzy_match_below_point_93_requires_director(self):
        candidates = [
            _entry("La Bataille Gaulle", "Antonin Baudry", ["AD"]),
        ]
        matches, confidence, ambiguous = lookup._unique_candidate_matches(
            "La Bataille de Gaulle", "Antonin Baudry", candidates
        )
        self.assertEqual(len(matches), 1)
        self.assertGreaterEqual(confidence, 0.85)
        self.assertLess(confidence, 0.93)
        self.assertEqual(ambiguous, [])

        without_director, _, _ = lookup._unique_candidate_matches(
            "La Bataille de Gaulle", "", candidates
        )
        self.assertEqual(without_director, [])


class ExtractionTests(unittest.TestCase):
    def test_extracts_ad_sme_sr_and_vast(self):
        entry = lookup.extract_dcp_entry(
            "UN FILM de Une Réalisatrice : AD, ST-SME, son renforcé et VAST"
        )
        self.assertIsNotNone(entry)
        self.assertEqual(entry["title"], "UN FILM")
        self.assertEqual(entry["director"], "Une Réalisatrice")
        self.assertEqual(entry["codes"], ["AD", "SME", "SR", "VAST"])

    def test_title_colon_does_not_break_dcp_parsing(self):
        entry = lookup.extract_dcp_entry(
            "LES PARFAIT(S) : ARNAQUES EN FAMILLE de Ludovic Bernard : "
            "AD, SME et SR, UGC"
        )
        self.assertEqual(entry["title"], "LES PARFAIT(S) : ARNAQUES EN FAMILLE")
        self.assertEqual(entry["director"], "Ludovic Bernard")

    def test_extracts_greta_and_la_bavarde_sections(self):
        post = {
            "date": "2026-06-01T09:00:00",
            "link": "https://example.test/films",
            "title": {"rendered": "Films"},
            "content": {
                "rendered": (
                    "<ul><li>LA CHALEUR de Lucile Hadzihalilovic : "
                    "AD et SME</li></ul>"
                    "<p>RUBRIQUE GRETA* : LA CHALEUR</p>"
                    "<p>RUBRIQUE LA BAVARDE* : LA CHALEUR</p>"
                )
            },
        }
        extracted = lookup.extract_cine_sens_post(post)
        self.assertEqual(extracted["entries"][0]["codes"], ["AD", "SME"])
        self.assertEqual(
            [item["application"] for item in extracted["application_sections"]],
            ["greta", "la_bavarde"],
        )

    def test_extracts_vast_poster_titles_without_duplicates(self):
        markup = """
        <div class="W4V2qg wixui-image" title="Fjord"><img></div>
        <div class="W4V2qg wixui-image" title="Sorda"><img></div>
        <div class="W4V2qg wixui-image" title="FJORD"><img></div>
        <div title="Navigation"></div>
        """
        self.assertEqual(lookup.parse_vast_titles(markup), ["Fjord", "Sorda"])


class ResolutionTests(unittest.TestCase):
    def setUp(self):
        self.catalogues = {
            "cine_sens": {
                "entries": [
                    _entry(
                        "TOY STORY 5",
                        "Andrew Stanton, McKenna Harris",
                        ["AD", "SME", "SR"],
                    ),
                    _entry(
                        "LA CHALEUR",
                        "Lucile Hadzihalilovic",
                        ["AD", "SME"],
                    ),
                ],
                "application_sections": [
                    _section("greta", "RUBRIQUE GRETA* : TOY STORY 5, LA CHALEUR"),
                    _section(
                        "la_bavarde", "RUBRIQUE LA BAVARDE* : LA CHALEUR"
                    ),
                ],
            },
            "vast": {
                "source_url": lookup.VAST_URL,
                "titles": ["Fjord", "Sorda"],
            },
        }

    def test_known_toy_story_result(self):
        result = lookup.resolve_film(
            "Toy Story 5", "Andrew Stanton, McKenna Harris", self.catalogues
        )
        self.assertEqual(result["output"], "AD SME SR G*")

    def test_known_la_chaleur_result(self):
        result = lookup.resolve_film("La Chaleur", "", self.catalogues)
        self.assertEqual(result["output"], "AD SME LB G*")

    def test_vast_result(self):
        result = lookup.resolve_film("Fjord", "", self.catalogues)
        self.assertEqual(result["output"], "VAST")

    def test_absent_title_is_to_verify(self):
        result = lookup.resolve_film("Titre absent", "", self.catalogues)
        self.assertEqual(result["output"], lookup.TO_VERIFY)
        self.assertEqual(result["status"], "to_verify")

    def test_duplicate_records_are_merged(self):
        catalogues = {
            "cine_sens": {
                "entries": [
                    _entry("UN FILM", "Alice Martin", ["AD"]),
                    _entry("UN FILM", "Alice Martin", ["SME"]),
                ],
                "application_sections": [],
            },
            "vast": {},
        }
        result = lookup.resolve_film("Un film", "Alice Martin", catalogues)
        self.assertEqual(result["output"], "AD SME")
        self.assertEqual(len(result["sources"]), 2)

    def test_equal_high_confidence_candidates_remain_ambiguous(self):
        catalogues = {
            "cine_sens": {
                "entries": [
                    _entry("FILM ALPHA LONG TITRE X", "", ["AD"]),
                    _entry("FILM ALPHA LONG TITRE Y", "", ["SME"]),
                ],
                "application_sections": [],
            },
            "vast": {},
        }
        result = lookup.resolve_film("Film Alpha Long Titre Z", "", catalogues)
        self.assertEqual(result["output"], lookup.TO_VERIFY)
        self.assertEqual(result["status"], "ambiguous")
        self.assertEqual(len(result["ambiguous_candidates"]), 2)

    def test_same_title_with_different_directors_is_not_merged(self):
        catalogues = {
            "cine_sens": {
                "entries": [
                    _entry("LE VOYAGE", "Alice Martin", ["AD"]),
                    _entry("LE VOYAGE", "Bruno Dupont", ["SME"]),
                ],
                "application_sections": [],
            },
            "vast": {},
        }
        selected = lookup.resolve_film("Le Voyage", "Alice Martin", catalogues)
        self.assertEqual(selected["output"], "AD")

        ambiguous = lookup.resolve_film("Le Voyage", "", catalogues)
        self.assertEqual(ambiguous["output"], lookup.TO_VERIFY)
        self.assertEqual(ambiguous["status"], "ambiguous")


class CacheAndNetworkTests(unittest.TestCase):
    def test_offline_without_cache_still_writes_to_verify_report(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            mapping, report = lookup.lookup_films(
                [{"title": "Film inconnu", "director": ""}],
                offline=True,
                cache_path=root / "cache.json",
                report_path=root / "report.json",
            )
            self.assertEqual(
                lookup.accessibility_for(mapping, "Film inconnu"),
                lookup.TO_VERIFY,
            )
            self.assertEqual(
                report["sources"]["cine_sens"]["status"], "unavailable"
            )
            self.assertTrue((root / "report.json").exists())

    @mock.patch.object(
        lookup, "fetch_vast", side_effect=requests.ConnectionError("hors ligne")
    )
    @mock.patch.object(
        lookup,
        "fetch_cine_sens",
        side_effect=requests.ConnectionError("hors ligne"),
    )
    def test_network_failure_uses_each_cached_source(
        self, _fetch_cine_sens, _fetch_vast
    ):
        with tempfile.TemporaryDirectory() as directory:
            cache_path = Path(directory) / "cache.json"
            cache_path.write_text(
                json.dumps(
                    {
                        "version": 1,
                        "sources": {
                            "cine_sens": {
                                "fetched_at": "2026-01-01T00:00:00+00:00",
                                "source_url": "https://cine-sens.test",
                                "entries": [],
                                "application_sections": [],
                            },
                            "vast": {
                                "fetched_at": "2026-01-01T00:00:00+00:00",
                                "source_url": "https://vast.test",
                                "titles": ["Fjord"],
                            },
                        },
                    }
                ),
                encoding="utf-8",
            )
            catalogues, statuses = lookup.load_catalogues(
                cache_path=cache_path
            )
            self.assertEqual(statuses["cine_sens"]["status"], "cache")
            self.assertEqual(statuses["vast"]["status"], "cache")
            self.assertEqual(catalogues["vast"]["titles"], ["Fjord"])


class _FakeResponse:
    def __init__(self, payload, headers=None):
        self._payload = payload
        self.headers = headers or {}

    def json(self):
        return self._payload

    def raise_for_status(self):
        return None


class _FakeSession:
    def __init__(self):
        self.calls = []

    def get(self, url, params=None, timeout=None):
        self.calls.append((url, params, timeout))
        if url.endswith("/categories"):
            return _FakeResponse(
                [{"id": 5, "slug": "films-accessibles", "count": 2}]
            )
        page = params["page"]
        payload = [
            {
                "date": f"2026-0{page}-01T00:00:00",
                "link": f"https://example.test/page-{page}",
                "title": {"rendered": f"Page {page}"},
                "content": {
                    "rendered": (
                        f"<li>FILM {page} de Alice Martin : AD et SME</li>"
                    )
                },
            }
        ]
        return _FakeResponse(payload, {"X-WP-TotalPages": "2"})


class PaginationTests(unittest.TestCase):
    def test_cine_sens_category_slug_and_pagination(self):
        session = _FakeSession()
        result = lookup.fetch_cine_sens(session)
        self.assertEqual(result["posts_checked"], 2)
        self.assertEqual(len(result["entries"]), 2)
        self.assertEqual(
            session.calls[0][1]["slug"], lookup.CINE_SENS_CATEGORY_SLUG
        )
        self.assertEqual(
            [call[1]["page"] for call in session.calls[1:]], [1, 2]
        )


if __name__ == "__main__":
    unittest.main()
