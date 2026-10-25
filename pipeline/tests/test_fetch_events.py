"""Tests for fetch_events.py — date precision, BCE/CE, dedup, category mapping.

Real assertion tests (not placeholder stubs) for the V-2 defect: midpoint placement
for decade/century/millennium precision, and BCE year-zero handling.
"""

import sys
from pathlib import Path

# Ensure we can import the pipeline module
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(REPO_ROOT / "pipeline"))

import fetch_events as fe


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _row(event_qid="Q1", title="Test Event", date_str="+1945-08-15T00:00:00Z",
         prec="11", sitelinks="50", class_label="battle"):
    """Build a mock SPARQL result row."""
    return {
        "event": {"value": f"http://www.wikidata.org/entity/{event_qid}"},
        "eventLabel": {"value": title},
        "date": {"value": date_str},
        "prec": {"value": prec},
        "sitelinks": {"value": sitelinks},
        "classLabel": {"value": class_label},
    }


# Category map matching pipeline/category_map.json
CLASS_MAP = {
    "battle": "war",
    "war": "war",
    "military operation": "war",
    "rebellion": "war",
    "revolution": "war",
    "coup d'état": "politics",
    "treaty": "politics",
    "public election": "politics",
    "legislation": "politics",
    "coronation": "politics",
    "assassination": "politics",
    "massacre": "war",
    "genocide": "war",
    "terrorist attack": "war",
    "earthquake": "disaster",
    "volcanic eruption": "disaster",
    "flood": "disaster",
    "tsunami": "disaster",
    "tornado": "disaster",
    "wildfire": "disaster",
    "natural disaster": "disaster",
    "shipwrecking": "disaster",
    "explosion": "disaster",
    "aviation accident": "disaster",
    "railway accident": "disaster",
    "epidemic": "disaster",
    "pandemic": "disaster",
    "expedition": "exploration",
    "spaceflight": "exploration",
    "invention": "science",
    "founding": "politics",
}


# ---------------------------------------------------------------------------
# normalize_date — BCE/CE year parsing
# ---------------------------------------------------------------------------

class TestNormalizeDate:
    """Test the raw year-parsing function (no midpoint adjustment)."""

    def test_ce_year(self):
        """1945 CE → 1945"""
        assert fe.normalize_date("+1945-08-15T00:00:00Z", 11) == 1945

    def test_ce_year_no_plus(self):
        """1945 CE (no plus sign) → 1945"""
        assert fe.normalize_date("1945-08-15T00:00:00Z", 11) == 1945

    def test_1_bce_wikidata_year_zero(self):
        """1 BCE (Wikidata year -0000) → -1"""
        # Wikidata stores 1 BCE as year 0 with minus sign: "-0000"
        assert fe.normalize_date("-0000-01-01T00:00:00Z", 9) == -1

    def test_2_bce(self):
        """2 BCE (Wikidata year -1) → -2"""
        assert fe.normalize_date("-0001-01-01T00:00:00Z", 9) == -2

    def test_44_bce(self):
        """44 BCE → -44.
        Wikidata stores 44 BCE as year -0043 (1 BCE = 0, so 44 BCE = -43).
        After year-zero correction: -43 - 1 = -44.
        """
        assert fe.normalize_date("-0043-03-15T00:00:00Z", 11) == -44

    def test_501_bce(self):
        """501 BCE → -501.
        Wikidata stores 501 BCE as year -0500 (1 BCE = 0, so 501 BCE = -500).
        After year-zero correction: -500 - 1 = -501.
        """
        assert fe.normalize_date("-0500-01-01T00:00:00Z", 9) == -501

    def test_1_ce(self):
        """1 CE → 1"""
        assert fe.normalize_date("+0001-01-01T00:00:00Z", 9) == 1

    def test_year_zero_not_in_output(self):
        """Normalize never returns 0 — no year zero in signed-year convention."""
        # Wikidata year -0000 (1 BCE) → -1
        assert fe.normalize_date("-0000-01-01T00:00:00Z", 9) != 0
        assert fe.normalize_date("-0000-01-01T00:00:00Z", 9) == -1
        # Wikidata year +0001 (1 CE) → 1
        assert fe.normalize_date("+0001-01-01T00:00:00Z", 9) != 0
        assert fe.normalize_date("+0001-01-01T00:00:00Z", 9) == 1
        # Wikidata year +0000 (CE year-zero artifact) → 1 (guard)
        assert fe.normalize_date("+0000-01-01T00:00:00Z", 9) != 0
        assert fe.normalize_date("+0000-01-01T00:00:00Z", 9) == 1
        # Wikidata year 0000 (no sign, CE year-zero artifact) → 1 (guard)
        assert fe.normalize_date("0000-01-01T00:00:00Z", 9) != 0
        assert fe.normalize_date("0000-01-01T00:00:00Z", 9) == 1


    # ---------------------------------------------------------------------------
# normalize_date — boundary-value table-driven tests (AC 5)
# ---------------------------------------------------------------------------

class TestBoundaryNormalizeDate:
    """Table-driven boundary test for BCE/CE year parsing (AC 5).

    Covers: 1 BCE, 2 BCE, 245 BCE, 246 BCE, 1 CE, 100 CE.
    Also verifies Wikidata convention mapping: N BCE → Wikidata year N-1.
    """

    BOUNDARY_CASES = [
        # (wikidata_str, prec, expected, description)
        ("-0000-01-01T00:00:00Z", 9, -1,   "1 BCE"),
        ("-0001-01-01T00:00:00Z", 9, -2,   "2 BCE"),
        ("-0244-01-01T00:00:00Z", 9, -245, "245 BCE"),
        ("-0245-01-01T00:00:00Z", 9, -246, "246 BCE"),
        ("+0001-01-01T00:00:00Z", 9, 1,    "1 CE"),
        ("+0100-01-01T00:00:00Z", 9, 100,  "100 CE"),
    ]

    def test_boundary_table(self):
        for wd, prec, expected, desc in self.BOUNDARY_CASES:
            result = fe.normalize_date(wd, prec)
            assert result == expected, (
                f"{desc}: Wikidata {wd} → expected {expected}, got {result}"
            )


# ---------------------------------------------------------------------------
# normalize_event — midpoint placement for decade/century/millennium
# ---------------------------------------------------------------------------

class TestMidpointPlacement:
    """Test that precision-based midpoint placement is applied correctly."""

    # ── Decade (precision 8) ──

    def test_decade_1940s_to_1945(self):
        """1940s (precision 8) → year 1945 (midpoint of decade)."""
        row = _row(date_str="+1940-01-01T00:00:00Z", prec="8")
        evt = fe.normalize_event(row, CLASS_MAP)
        assert evt is not None
        assert evt["year"] == 1945
        assert evt["precision"] == "decade"

    def test_decade_1810s_to_1815(self):
        """1810s (precision 8) → year 1815."""
        row = _row(date_str="+1810-01-01T00:00:00Z", prec="8")
        evt = fe.normalize_event(row, CLASS_MAP)
        assert evt is not None
        assert evt["year"] == 1815

    def test_decade_2000s_to_2005(self):
        """2000s (precision 8) → year 2005."""
        row = _row(date_str="+2000-01-01T00:00:00Z", prec="8")
        evt = fe.normalize_event(row, CLASS_MAP)
        assert evt is not None
        assert evt["year"] == 2005

    # ── Century (precision 7) ──

    def test_century_19th_to_1850(self):
        """19th century (precision 7, year 1800) → year 1850."""
        row = _row(date_str="+1800-01-01T00:00:00Z", prec="7")
        evt = fe.normalize_event(row, CLASS_MAP)
        assert evt is not None
        assert evt["year"] == 1850
        assert evt["precision"] == "century"

    def test_century_1st_ce_to_50(self):
        """1st century CE (precision 7, year 1) → year 50."""
        row = _row(date_str="+0001-01-01T00:00:00Z", prec="7")
        evt = fe.normalize_event(row, CLASS_MAP)
        assert evt is not None
        assert evt["year"] == 50

    def test_century_20th_to_1950(self):
        """20th century (precision 7, year 1900) → year 1950."""
        row = _row(date_str="+1900-01-01T00:00:00Z", prec="7")
        evt = fe.normalize_event(row, CLASS_MAP)
        assert evt is not None
        assert evt["year"] == 1950

    # ── Millennium (precision 6) — the V-2 fix ──

    def test_millennium_2nd_ce_to_1500(self):
        """2nd millennium CE (precision 6, year 1000) → year 1500 (midpoint)."""
        row = _row(date_str="+1000-01-01T00:00:00Z", prec="6")
        evt = fe.normalize_event(row, CLASS_MAP)
        assert evt is not None
        assert evt["year"] == 1500

    def test_millennium_1st_ce_to_500(self):
        """1st millennium CE (precision 6, year 1) → year 500."""
        row = _row(date_str="+0001-01-01T00:00:00Z", prec="6")
        evt = fe.normalize_event(row, CLASS_MAP)
        assert evt is not None
        assert evt["year"] == 500

    def test_millennium_1st_bce_to_m500(self):
        """1st millennium BCE (precision 6, year -1 → our year -1)
        → midpoint should land near -500 (500 BCE).
        normalize_date(-0001) → -2, then millennium midpoint:
        (-2 // 1000) * 1000 + 500 = -1 * 1000 + 500 = -500.
        """
        row = _row(date_str="-0001-01-01T00:00:00Z", prec="6")
        evt = fe.normalize_event(row, CLASS_MAP)
        assert evt is not None
        assert evt["year"] == -500

    # ── BCE century — verifies midpoint works for negative years ──

    def test_bce_century_6th_to_m550(self):
        """6th century BCE (Wikidata year -500, precision 7).
        normalize_date(-0500) → -501, then century midpoint:
        (-501 // 100) * 100 + 50 = -6 * 100 + 50 = -550.
        """
        row = _row(date_str="-0500-01-01T00:00:00Z", prec="7")
        evt = fe.normalize_event(row, CLASS_MAP)
        assert evt is not None
        # 6th century BCE midpoint is ~550 BCE = year -550
        assert evt["year"] == -550
        assert evt["precision"] == "century"

    # ── Year precision (9) — no midpoint adjustment ──

    def test_year_precision_no_adjustment(self):
        """Year precision (9) passes through unchanged."""
        row = _row(date_str="+1066-10-14T00:00:00Z", prec="9")
        evt = fe.normalize_event(row, CLASS_MAP)
        assert evt is not None
        assert evt["year"] == 1066
        assert evt["precision"] == "year"


# ---------------------------------------------------------------------------
# normalize_event — filtering and edge cases
# ---------------------------------------------------------------------------

class TestNormalizeEventFiltering:
    """Test that events are correctly filtered/skipped."""

    def test_skips_event_with_no_title(self):
        """Event without a label should be skipped."""
        row = _row(title="")
        row["eventLabel"] = {}
        evt = fe.normalize_event(row, CLASS_MAP)
        assert evt is None

    def test_skips_event_out_of_year_range(self):
        """Event before 10,000 BCE should be skipped."""
        row = _row(date_str="-15000-01-01T00:00:00Z", prec="9")
        evt = fe.normalize_event(row, CLASS_MAP)
        assert evt is None

    def test_skips_event_after_2100(self):
        """Event after 2100 CE should be skipped."""
        row = _row(date_str="+2200-01-01T00:00:00Z", prec="9")
        evt = fe.normalize_event(row, CLASS_MAP)
        assert evt is None

    def test_event_without_event_uri(self):
        """Row without event URI should be skipped."""
        row = _row()
        del row["event"]
        evt = fe.normalize_event(row, CLASS_MAP)
        assert evt is None


# ---------------------------------------------------------------------------
# normalize_event — output shape
# ---------------------------------------------------------------------------

class TestNormalizeEventShape:
    """Test the shape of normalized event records."""

    def test_all_fields_present(self):
        row = _row()
        evt = fe.normalize_event(row, CLASS_MAP)
        assert evt is not None
        assert set(evt.keys()) == {
            "id", "title", "year", "precision", "category",
            "sitelinks", "qid", "sourceUrl",
        }

    def test_id_is_12_char_hex(self):
        row = _row()
        evt = fe.normalize_event(row, CLASS_MAP)
        assert len(evt["id"]) == 12
        assert all(c in "0123456789abcdef" for c in evt["id"])

    def test_source_url_is_wikidata(self):
        row = _row(event_qid="Q12345")
        evt = fe.normalize_event(row, CLASS_MAP)
        assert evt["sourceUrl"] == "https://www.wikidata.org/wiki/Q12345"

    def test_qid_extracted_from_uri(self):
        row = _row(event_qid="Q42")
        evt = fe.normalize_event(row, CLASS_MAP)
        assert evt["qid"] == "Q42"

    def test_sitelinks_is_int(self):
        row = _row(sitelinks="42")
        evt = fe.normalize_event(row, CLASS_MAP)
        assert evt["sitelinks"] == 42


# ---------------------------------------------------------------------------
# Dedup
# ---------------------------------------------------------------------------

class TestDedup:
    """Test the deduplication heuristic."""

    def test_no_dupes_unchanged(self):
        events = [
            {"id": "a", "title": "Battle of X", "year": 1066, "sitelinks": 50, "qid": "Q1"},
            {"id": "b", "title": "Treaty of Y", "year": 1815, "sitelinks": 40, "qid": "Q2"},
        ]
        result = fe.dedup_events(events)
        assert len(result) == 2

    def test_duplicate_within_year_keeps_highest_sitelinks(self):
        events = [
            {"id": "a", "title": "Battle of X", "year": 1066, "sitelinks": 50, "qid": "Q1"},
            {"id": "b", "title": "Battle of X", "year": 1066, "sitelinks": 30, "qid": "Q2"},
        ]
        result = fe.dedup_events(events)
        assert len(result) == 1
        assert result[0]["sitelinks"] == 50

    def test_duplicate_year_plus_one_merges(self):
        events = [
            {"id": "a", "title": "Battle of X", "year": 1066, "sitelinks": 50, "qid": "Q1"},
            {"id": "b", "title": "Battle of X", "year": 1067, "sitelinks": 30, "qid": "Q2"},
        ]
        result = fe.dedup_events(events)
        assert len(result) == 1
        assert result[0]["sitelinks"] == 50

    def test_sorted_by_year(self):
        events = [
            {"id": "c", "title": "Event C", "year": 1900, "sitelinks": 10, "qid": "Q3"},
            {"id": "a", "title": "Event A", "year": 1000, "sitelinks": 10, "qid": "Q1"},
            {"id": "b", "title": "Event B", "year": 1500, "sitelinks": 10, "qid": "Q2"},
        ]
        result = fe.dedup_events(events)
        years = [e["year"] for e in result]
        assert years == sorted(years)

    def test_title_normalization_ignores_trailing_period(self):
        events = [
            {"id": "a", "title": "Battle of X.", "year": 1066, "sitelinks": 50, "qid": "Q1"},
            {"id": "b", "title": "Battle of X", "year": 1066, "sitelinks": 30, "qid": "Q2"},
        ]
        result = fe.dedup_events(events)
        assert len(result) == 1


# ---------------------------------------------------------------------------
# Category mapping
# ---------------------------------------------------------------------------

class TestCategoryMapping:
    """Test that class labels are mapped to the correct categories."""

    def test_battle_maps_to_war(self):
        row = _row(class_label="battle")
        evt = fe.normalize_event(row, CLASS_MAP)
        assert evt["category"] == "war"

    def test_treaty_maps_to_politics(self):
        row = _row(class_label="treaty")
        evt = fe.normalize_event(row, CLASS_MAP)
        assert evt["category"] == "politics"

    def test_earthquake_maps_to_disaster(self):
        row = _row(class_label="earthquake")
        evt = fe.normalize_event(row, CLASS_MAP)
        assert evt["category"] == "disaster"

    def test_invention_maps_to_science(self):
        row = _row(class_label="invention")
        evt = fe.normalize_event(row, CLASS_MAP)
        assert evt["category"] == "science"

    def test_expedition_maps_to_exploration(self):
        row = _row(class_label="expedition")
        evt = fe.normalize_event(row, CLASS_MAP)
        assert evt["category"] == "exploration"

    def test_unknown_class_defaults_to_politics(self):
        row = _row(class_label="something_entirely_new")
        evt = fe.normalize_event(row, CLASS_MAP)
        assert evt["category"] == "politics"


# ---------------------------------------------------------------------------
# Precision label mapping
# ---------------------------------------------------------------------------

class TestPrecisionLabels:
    """Test that precision codes get the correct label strings."""

    def test_precision_11_is_day(self):
        row = _row(prec="11")
        evt = fe.normalize_event(row, CLASS_MAP)
        assert evt["precision"] == "day"

    def test_precision_10_is_month(self):
        row = _row(prec="10")
        evt = fe.normalize_event(row, CLASS_MAP)
        assert evt["precision"] == "month"

    def test_precision_9_is_year(self):
        row = _row(prec="9")
        evt = fe.normalize_event(row, CLASS_MAP)
        assert evt["precision"] == "year"

    def test_precision_8_is_decade(self):
        row = _row(prec="8", date_str="+1940-01-01T00:00:00Z")
        evt = fe.normalize_event(row, CLASS_MAP)
        assert evt["precision"] == "decade"

    def test_precision_7_is_century(self):
        row = _row(prec="7", date_str="+1800-01-01T00:00:00Z")
        evt = fe.normalize_event(row, CLASS_MAP)
        assert evt["precision"] == "century"

    def test_precision_6_is_prec6(self):
        """Precision 6 (millennium) gets labelled 'prec6' (not in PREC_LABELS)."""
        row = _row(prec="6", date_str="+1000-01-01T00:00:00Z")
        evt = fe.normalize_event(row, CLASS_MAP)
        assert evt["precision"] == "prec6"