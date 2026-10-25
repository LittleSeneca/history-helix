"""Tests for fetch_people.py — date parsing (BCE/CE), schema validation,
no-empty-field assertions, and a committed fixture.

Mirrors the test_fetch_events.py structure: real assertions, no stubs.
"""

import json
import sys
from pathlib import Path

# Ensure we can import the pipeline module
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(REPO_ROOT / "pipeline"))

import fetch_people as fp

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _row(person_qid="Q42", name="Test Person",
         birth_str="+1900-01-01T00:00:00Z",
         death_str="+1980-01-01T00:00:00Z",
         sitelinks="50"):
    """Build a mock SPARQL result row for a person."""
    return {
        "person": {"value": f"http://www.wikidata.org/entity/{person_qid}"},
        "personLabel": {"value": name},
        "birth": {"value": birth_str},
        "death": {"value": death_str},
        "sitelinks": {"value": sitelinks},
    }


# ---------------------------------------------------------------------------
# normalize_person — field presence
# ---------------------------------------------------------------------------

class TestNormalizePersonRequiredFields:
    """Every required field must be present — no fabricated data."""

    def test_all_fields_present(self):
        row = _row()
        person = fp.normalize_person(row)
        assert person is not None
        assert set(person.keys()) == {
            "id", "name", "qid", "birth", "death", "sitelinks", "sourceUrl",
        }

    def test_missing_person_uri(self):
        row = _row()
        del row["person"]
        assert fp.normalize_person(row) is None

    def test_empty_person_uri(self):
        row = _row()
        row["person"]["value"] = ""
        assert fp.normalize_person(row) is None

    def test_missing_name(self):
        row = _row()
        del row["personLabel"]
        assert fp.normalize_person(row) is None

    def test_empty_name(self):
        row = _row(name="")
        assert fp.normalize_person(row) is None

    def test_missing_birth(self):
        row = _row()
        del row["birth"]
        assert fp.normalize_person(row) is None

    def test_empty_birth(self):
        row = _row(birth_str="")
        assert fp.normalize_person(row) is None

    def test_missing_death(self):
        row = _row()
        del row["death"]
        assert fp.normalize_person(row) is None

    def test_empty_death(self):
        row = _row(death_str="")
        assert fp.normalize_person(row) is None

    def test_missing_sitelinks(self):
        row = _row()
        del row["sitelinks"]
        assert fp.normalize_person(row) is None


# ---------------------------------------------------------------------------
# normalize_person — date parsing (via shared normalize_date)
# ---------------------------------------------------------------------------

class TestDateParsing:
    """BCE/CE parsing is inherited from fetch_events.normalize_date.
    These tests verify the integration for people records."""

    def test_ce_dates(self):
        """1900–1980 CE → 1900, 1980"""
        row = _row(birth_str="+1900-01-01T00:00:00Z",
                   death_str="+1980-06-15T00:00:00Z")
        person = fp.normalize_person(row)
        assert person["birth"] == 1900
        assert person["death"] == 1980

    def test_bce_dates(self):
        """100 BCE – 44 BCE.
        Wikidata: 100 BCE = year -0099, 44 BCE = year -0043.
        After normalize_date: -100, -44.
        """
        row = _row(birth_str="-0099-01-01T00:00:00Z",
                   death_str="-0043-03-15T00:00:00Z")
        person = fp.normalize_person(row)
        assert person["birth"] == -100
        assert person["death"] == -44

    def test_1_bce_wikidata_zero(self):
        """1 BCE (Wikidata year -0000) → -1."""
        row = _row(birth_str="-0000-01-01T00:00:00Z",
                   death_str="+0050-01-01T00:00:00Z")
        person = fp.normalize_person(row)
        assert person["birth"] == -1
        assert person["death"] == 50

    def test_1_ce(self):
        """1 CE → 1."""
        row = _row(birth_str="+0001-01-01T00:00:00Z",
                   death_str="+0070-01-01T00:00:00Z")
        person = fp.normalize_person(row)
        assert person["birth"] == 1
        assert person["death"] == 70

    def test_year_zero_not_returned(self):
        """Normalize never returns year 0 — signed-year convention."""
        # Wikidata year 0 (1 BCE) → -1
        row = _row(birth_str="-0000-01-01T00:00:00Z",
                   death_str="+0050-01-01T00:00:00Z")
        person = fp.normalize_person(row)
        assert person["birth"] != 0
        assert person["death"] != 0
        assert person["birth"] == -1
        # Wikidata +0000 (CE year-zero artifact) → 1 (guard)
        row2 = _row(birth_str="+0000-01-01T00:00:00Z",
                    death_str="+0050-01-01T00:00:00Z")
        person2 = fp.normalize_person(row2)
        assert person2["birth"] != 0
        assert person2["birth"] == 1


# ---------------------------------------------------------------------------
# normalize_person — boundary-value table-driven tests (AC 5)
# ---------------------------------------------------------------------------

class TestBoundaryDateParsing:
    """Table-driven boundary test for people date parsing (AC 5).

    Covers: 1 BCE, 2 BCE, 245 BCE, 246 BCE, 1 CE, 100 CE.
    Tests the integration through normalize_person, which calls normalize_date.
    """

    BOUNDARY_CASES = [
        # (wikidata_str, expected_int, description)
        ("-0000-01-01T00:00:00Z", -1,   "1 BCE"),
        ("-0001-01-01T00:00:00Z", -2,   "2 BCE"),
        ("-0244-01-01T00:00:00Z", -245, "245 BCE"),
        ("-0245-01-01T00:00:00Z", -246, "246 BCE"),
        ("+0001-01-01T00:00:00Z", 1,    "1 CE"),
        ("+0100-01-01T00:00:00Z", 100,  "100 CE"),
    ]

    def test_boundary_table(self):
        for wd, expected, desc in self.BOUNDARY_CASES:
            # Death is well past all test births so birth>death never triggers
            row = _row(birth_str=wd, death_str="+0200-01-01T00:00:00Z")
            person = fp.normalize_person(row)
            assert person is not None, f"{desc}: person should not be None"
            assert person["birth"] == expected, (
                f"{desc}: Wikidata {wd} → expected birth={expected}, got {person['birth']}"
            )


# ---------------------------------------------------------------------------
# normalize_person — range filtering
# ---------------------------------------------------------------------------

class TestRangeFiltering:
    """People outside the 10,000 BCE – 2100 CE span are dropped."""

    def test_birth_before_range(self):
        row = _row(birth_str="-12000-01-01T00:00:00Z",
                   death_str="-11000-01-01T00:00:00Z")
        assert fp.normalize_person(row) is None

    def test_birth_after_range(self):
        row = _row(birth_str="+2150-01-01T00:00:00Z",
                   death_str="+2200-01-01T00:00:00Z")
        assert fp.normalize_person(row) is None

    def test_death_before_range(self):
        row = _row(birth_str="-09000-01-01T00:00:00Z",
                   death_str="-12000-01-01T00:00:00Z")
        assert fp.normalize_person(row) is None

    def test_death_after_range(self):
        row = _row(birth_str="+2000-01-01T00:00:00Z",
                   death_str="+2200-01-01T00:00:00Z")
        assert fp.normalize_person(row) is None

    def test_birth_after_death_dropped(self):
        """Sanity: birth > death is nonsense data — drop it."""
        row = _row(birth_str="+1980-01-01T00:00:00Z",
                   death_str="+1900-01-01T00:00:00Z")
        assert fp.normalize_person(row) is None

    def test_same_year_birth_death_kept(self):
        """Died in birth year — tragic but valid."""
        row = _row(birth_str="+1900-01-01T00:00:00Z",
                   death_str="+1900-12-31T00:00:00Z")
        person = fp.normalize_person(row)
        assert person is not None
        assert person["birth"] == 1900
        assert person["death"] == 1900

    def test_uri_in_date_field_dropped(self):
        """Some Wikidata rows return URIs instead of date literals — skip."""
        row = _row(death_str="http://www.wikidata.org/.well-known/genid/abc123")
        assert fp.normalize_person(row) is None

    def test_birth_uri_dropped(self):
        row = _row(birth_str="http://www.wikidata.org/.well-known/genid/abc")
        assert fp.normalize_person(row) is None


# ---------------------------------------------------------------------------
# normalize_person — output shape
# ---------------------------------------------------------------------------

class TestOutputShape:
    """Verify the shape of normalized person records."""

    def test_id_is_12_char_hex(self):
        person = fp.normalize_person(_row())
        assert len(person["id"]) == 12
        assert all(c in "0123456789abcdef" for c in person["id"])

    def test_qid_extracted_from_uri(self):
        person = fp.normalize_person(_row(person_qid="Q12345"))
        assert person["qid"] == "Q12345"

    def test_source_url(self):
        person = fp.normalize_person(_row(person_qid="Q76"))
        assert person["sourceUrl"] == "https://www.wikidata.org/wiki/Q76"

    def test_sitelinks_is_int(self):
        person = fp.normalize_person(_row(sitelinks="42"))
        assert person["sitelinks"] == 42

    def test_name_preserved(self):
        person = fp.normalize_person(_row(name="Marie Curie"))
        assert person["name"] == "Marie Curie"


# ---------------------------------------------------------------------------
# Fixture tests — committed small dataset for offline validation
# ---------------------------------------------------------------------------

FIXTURE_PATH = REPO_ROOT / "pipeline" / "tests" / "fixtures" / "people_sample.json"


class TestFixture:
    """Offline validation against a committed fixture."""

    def test_fixture_exists(self):
        assert FIXTURE_PATH.exists(), (
            f"Fixture missing: {FIXTURE_PATH}. "
            "Create it with a small WDQS query result."
        )

    def test_fixture_is_valid_json(self):
        with open(FIXTURE_PATH) as f:
            data = json.load(f)
        assert isinstance(data, list), "Fixture must be a list of rows"

    def test_fixture_rows_normalize_cleanly(self):
        """Every row in the fixture must produce a valid person or be
        legitimately skipped (no crashes)."""
        with open(FIXTURE_PATH) as f:
            rows = json.load(f)

        normalized = 0
        skipped = 0
        for row in rows:
            person = fp.normalize_person(row)
            if person is None:
                skipped += 1
            else:
                normalized += 1
                # Every normalized person must have non-empty fields
                assert person["name"], f"empty name for {person.get('qid', '?')}"
                assert person["qid"], "empty qid"
                assert isinstance(person["birth"], int), "birth not int"
                assert isinstance(person["death"], int), "death not int"
                assert person["sitelinks"] > 0, "sitelinks not positive"
                assert person["sourceUrl"].startswith("https://www.wikidata.org/wiki/")

        assert normalized > 0, "Fixture produced zero valid people"
        print(f"  Fixture: {normalized} valid, {skipped} skipped")


# ---------------------------------------------------------------------------
# SPARQL builder
# ---------------------------------------------------------------------------

class TestBuildSparql:
    """Test that SPARQL queries are well-formed."""

    def test_ce_years(self):
        sparql = fp.build_sparql(1900, 1909)
        assert "?person wdt:P31 wd:Q5" in sparql
        assert "wdt:P569 ?birth" in sparql
        assert "wdt:P570 ?death" in sparql
        assert "+1900-01-01T00:00:00Z" in sparql
        assert "+1909-12-31T23:59:59Z" in sparql
        assert "OFFSET 0" in sparql

    def test_bce_years(self):
        sparql = fp.build_sparql(-100, -50)
        assert "-00100-01-01T00:00:00Z" in sparql
        assert "-00050-12-31T23:59:59Z" in sparql

    def test_offset(self):
        sparql = fp.build_sparql(1900, 1909, offset=5000)
        assert "OFFSET 5000" in sparql

    def test_sitelink_filter(self):
        sparql = fp.build_sparql(1900, 1909)
        assert f"FILTER(?sitelinks >= {fp.SITELINK_MIN})" in sparql


# ---------------------------------------------------------------------------
# Cache key
# ---------------------------------------------------------------------------

class TestCacheKey:
    """Cache keys must be deterministic."""

    def test_same_sparql_same_key(self):
        a = fp.cache_key(fp.build_sparql(1900, 1909))
        b = fp.cache_key(fp.build_sparql(1900, 1909))
        assert a == b

    def test_different_sparql_different_key(self):
        a = fp.cache_key(fp.build_sparql(1900, 1909))
        b = fp.cache_key(fp.build_sparql(1910, 1919))
        assert a != b