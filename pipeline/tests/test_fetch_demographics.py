"""Tests for fetch_demographics.py — offline, fixture-driven."""

import json
import os
import sys
from pathlib import Path

import pytest

# Ensure we can import the pipeline module
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(REPO_ROOT / "pipeline"))

# Import under test
import fetch_demographics as fd

FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures"
POP_FIXTURE = FIXTURE_DIR / "population_sample.csv"
LE_FIXTURE = FIXTURE_DIR / "life_expectancy_sample.csv"


# ---------------------------------------------------------------------------
# parse_world_rows
# ---------------------------------------------------------------------------

class TestParseWorldRows:
    def test_extracts_world_rows_only(self):
        csv_text = POP_FIXTURE.read_text()
        rows = fd.parse_world_rows(csv_text, "population_historical")
        # 10 World rows, 1 NonWorld row
        assert len(rows) == 10

    def test_sorted_by_year(self):
        csv_text = POP_FIXTURE.read_text()
        rows = fd.parse_world_rows(csv_text, "population_historical")
        years = [r["year"] for r in rows]
        assert years == sorted(years)

    def test_fields_present(self):
        csv_text = POP_FIXTURE.read_text()
        rows = fd.parse_world_rows(csv_text, "population_historical")
        for r in rows:
            assert "year" in r
            assert "value" in r
            assert isinstance(r["year"], int)
            assert isinstance(r["value"], float)

    def test_le_parsing(self):
        csv_text = LE_FIXTURE.read_text()
        rows = fd.parse_world_rows(csv_text, "life_expectancy_0")
        assert len(rows) == 7  # 7 World rows


# ---------------------------------------------------------------------------
# build_population_series
# ---------------------------------------------------------------------------

class TestBuildPopulationSeries:
    def test_shape(self):
        raw = [
            {"year": -10000, "value": 4501152.0},
            {"year": 2023, "value": 8091734933.0},
        ]
        series = fd.build_population_series(raw)
        assert len(series) == 2
        for r in series:
            assert set(r.keys()) == {"year", "value", "sourceId"}
            assert r["sourceId"] == fd.POP_SOURCE_ID
            assert isinstance(r["value"], int)

    def test_rounds_to_int(self):
        raw = [{"year": 0, "value": 123.6}]
        series = fd.build_population_series(raw)
        assert series[0]["value"] == 124


# ---------------------------------------------------------------------------
# build_life_expectancy_series
# ---------------------------------------------------------------------------

class TestBuildLifeExpectancySeries:
    OWID = [
        {"year": 1770, "value": 28.5},
        {"year": 1800, "value": 28.5},
        {"year": 1850, "value": 29.3},
        {"year": 1900, "value": 32.0},
        {"year": 1950, "value": 46.3944},
        {"year": 2000, "value": 67.6236},
        {"year": 2023, "value": 73.1694},
    ]

    ANCHORS = fd.LE_ANCHORS  # use real anchors

    def test_non_empty(self):
        series = fd.build_life_expectancy_series(self.OWID, self.ANCHORS)
        assert len(series) > 0

    def test_fields_present(self):
        series = fd.build_life_expectancy_series(self.OWID, self.ANCHORS)
        for r in series:
            assert set(r.keys()) == {"year", "value", "estimated", "sourceId"}
            assert isinstance(r["year"], int)
            assert isinstance(r["value"], (int, float))
            assert isinstance(r["estimated"], bool)
            assert isinstance(r["sourceId"], str)

    def test_years_strictly_ascending(self):
        series = fd.build_life_expectancy_series(self.OWID, self.ANCHORS)
        years = [r["year"] for r in series]
        for i in range(len(years) - 1):
            assert years[i] < years[i + 1], \
                f"years not strictly ascending at index {i}: {years[i]} >= {years[i+1]}"

    def test_spans_at_least_m10000_to_2000(self):
        series = fd.build_life_expectancy_series(self.OWID, self.ANCHORS)
        years = [r["year"] for r in series]
        assert years[0] <= -10000
        assert years[-1] >= 2000

    def test_owid_years_not_estimated(self):
        series = fd.build_life_expectancy_series(self.OWID, self.ANCHORS)
        by_year = {r["year"]: r for r in series}
        for owid_row in self.OWID:
            r = by_year[owid_row["year"]]
            assert r["estimated"] is False, \
                f"year {owid_row['year']} should not be estimated"
            assert r["sourceId"] == fd.LE_SOURCE_ID

    def test_pre_1500_estimated(self):
        """All years before 1500 must be marked estimated:true."""
        series = fd.build_life_expectancy_series(self.OWID, self.ANCHORS)
        for r in series:
            if r["year"] < 1500:
                assert r["estimated"] is True, \
                    f"year {r['year']} should be estimated"

    def test_pre_owid_estimated(self):
        """Years before first OWID year (1770) should be estimated."""
        series = fd.build_life_expectancy_series(self.OWID, self.ANCHORS)
        for r in series:
            if r["year"] < 1770:
                assert r["estimated"] is True, \
                    f"year {r['year']} should be estimated"

    def test_anchor_years_present(self):
        series = fd.build_life_expectancy_series(self.OWID, self.ANCHORS)
        by_year = {r["year"]: r for r in series}
        for year, val, cit in self.ANCHORS:
            assert year in by_year, f"anchor year {year} missing"
            assert by_year[year]["value"] == val
            assert by_year[year]["sourceId"] == f"anchor-{cit}"

    def test_low_year_has_value(self):
        """-10000 should have a reasonable life expectancy value."""
        series = fd.build_life_expectancy_series(self.OWID, self.ANCHORS)
        r0 = series[0]
        assert r0["year"] <= -10000
        assert 20 <= r0["value"] <= 40, \
            f"life expectancy at -10000 is {r0['value']}, expected 20-40"

    def test_values_never_negative(self):
        series = fd.build_life_expectancy_series(self.OWID, self.ANCHORS)
        for r in series:
            assert r["value"] >= 0, f"negative value at year {r['year']}"


# ---------------------------------------------------------------------------
# Full pipeline integration (offline — exercises normalisers only)
# ---------------------------------------------------------------------------

class TestFullPipelineOutput:
    """Run the full pipeline offline by patching fetch_csv to use fixtures."""

    def test_integration(self, monkeypatch, tmp_path):
        # Patch fetch_csv to return fixtures
        def mock_fetch(url, cache_path):
            if "population" in url:
                return POP_FIXTURE.read_text()
            elif "life-expectancy" in url:
                return LE_FIXTURE.read_text()
            raise RuntimeError(f"unexpected URL: {url}")

        monkeypatch.setattr(fd, "fetch_csv", mock_fetch)

        # Redirect output to tmp_path
        out_file = tmp_path / "demographics.json"
        prov_file = tmp_path / "provenance.md"

        monkeypatch.setattr(fd, "POP_OUT", out_file)
        monkeypatch.setattr(fd, "PROV_OUT", prov_file)

        fd.main()

        # Verify output
        assert out_file.exists()
        data = json.loads(out_file.read_text())

        # Population shape
        assert "population" in data
        assert len(data["population"]) > 0
        for r in data["population"]:
            assert set(r.keys()) == {"year", "value", "sourceId"}

        # Population span
        pop_years = [r["year"] for r in data["population"]]
        assert pop_years == sorted(pop_years)
        assert pop_years[0] <= -10000

        # Life expectancy shape
        assert "lifeExpectancy" in data
        assert len(data["lifeExpectancy"]) > 0
        for r in data["lifeExpectancy"]:
            assert set(r.keys()) == {"year", "value", "estimated", "sourceId"}

        # Life expectancy span and monotonicity
        le_years = [r["year"] for r in data["lifeExpectancy"]]
        assert le_years == sorted(le_years)
        for i in range(len(le_years) - 1):
            assert le_years[i] < le_years[i + 1]

        # Provenance written
        assert prov_file.exists()
        prov_text = prov_file.read_text()
        assert "Population" in prov_text
        assert "Life Expectancy" in prov_text
        assert "CC BY 4.0" in prov_text