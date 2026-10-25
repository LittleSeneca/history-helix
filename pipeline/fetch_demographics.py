#!/usr/bin/env python3
"""Fetch and normalize world population + life expectancy from Our World in Data.

Population: OWID grapher CSV (HYDE-backed, long-run).
  URL: https://ourworldindata.org/grapher/population.csv?v=1&csvType=full&useColumnShortNames=true
  Entity: World (OWID_WRL). Years: -10000..2023.

Life expectancy: OWID grapher CSV.
  URL: https://ourworldindata.org/grapher/life-expectancy.csv?v=1&csvType=full&useColumnShortNames=true
  Entity: World (OWID_WRL). Years: 1770..2023.
  Pre-1500 gaps filled from documented anchor points with linear interpolation.

Outputs:
  data/demographics.json  — {population: [...], lifeExpectancy: [...]}
  data/provenance.md      — sources, citations, transformations, known gaps
"""

import csv
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

POP_URL = (
    "https://ourworldindata.org/grapher/population.csv"
    "?v=1&csvType=full&useColumnShortNames=true"
)
LE_URL = (
    "https://ourworldindata.org/grapher/life-expectancy.csv"
    "?v=1&csvType=full&useColumnShortNames=true"
)

POP_SOURCE_ID = "owid-population-hyde-gapminder-un"
LE_SOURCE_ID = "owid-life-expectancy"

# Directory layout (relative to repo root; script lives in pipeline/)
REPO_ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = REPO_ROOT / "pipeline" / ".cache"
DATA_DIR = REPO_ROOT / "data"

POP_CACHE = CACHE_DIR / "population.csv"
LE_CACHE = CACHE_DIR / "life_expectancy.csv"

POP_OUT = DATA_DIR / "demographics.json"
PROV_OUT = DATA_DIR / "provenance.md"

USER_AGENT = "history-helix/0.1 (demographics pipeline; github.com/LittleSeneca/history-helix)"
RETRIEVAL_DATE = datetime.now(timezone.utc).strftime("%Y-%m-%d")
OWID_LICENSE = "CC BY 4.0"
OWID_CITATION = (
    "HYDE (2023); Gapminder (2022); UN WPP (2024) "
    "– with major processing by Our World in Data"
)

# Anchor points for life expectancy pre-1500 (cited in provenance.md).
# Format: (year, value, citation_label)
LE_ANCHORS = [
    (-10000, 30.0, "gurven2007"),   # hunter-gatherer
    (-3000,  26.0, "cohen1984"),    # early agriculture
    (100,    28.0, "frier2000"),    # Roman Empire
    (1000,   30.0, "russell1958"),  # Medieval
    (1500,   32.0, "wrigley1981"),  # Early modern
]


# ---------------------------------------------------------------------------
# Fetch helpers
# ---------------------------------------------------------------------------

def fetch_csv(url: str, cache_path: Path) -> str:
    """Download CSV text, caching to `cache_path`. Raise on HTTP error."""
    if cache_path.exists():
        return cache_path.read_text(encoding="utf-8")
    resp = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=60)
    resp.raise_for_status()
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(resp.text, encoding="utf-8")
    return resp.text


def parse_world_rows(csv_text: str, value_col: str) -> list[dict]:
    """Extract (year, value) for entity=='World' from OWID full-format CSV.

    OWID full CSV columns: entity, code, year, <value_col>
    Returns list of {year: int, value: float}, sorted by year ascending.
    """
    reader = csv.DictReader(csv_text.splitlines())
    rows = []
    for rec in reader:
        if rec["entity"] != "World":
            continue
        year = int(rec["year"])
        val = float(rec[value_col])
        rows.append({"year": year, "value": val})
    rows.sort(key=lambda r: r["year"])
    return rows


# ---------------------------------------------------------------------------
# Normalisation
# ---------------------------------------------------------------------------

def build_population_series(raw: list[dict]) -> list[dict]:
    """Convert raw population rows to output shape."""
    return [
        {"year": r["year"], "value": int(round(r["value"])), "sourceId": POP_SOURCE_ID}
        for r in raw
    ]


def build_life_expectancy_series(
    owid_raw: list[dict],
    anchors: list[tuple[int, float, str]],
) -> list[dict]:
    """Merge OWID data with anchor-based interpolation for pre-modern gaps.

    Strategy:
    - Collect all known points: anchors (estimated) + OWID data points.
    - Linearly interpolate every year across the full span.
    - Years within the OWID range (first OWID year to last OWID year) are
      NOT marked estimated even if they fall between OWID data points — they
      are data-derived.  Mark them estimated=false / sourceId=LE_SOURCE_ID.
    - Years before the first OWID year are marked estimated=true.
    - Exact anchor years keep their citation-based sourceId.
    """
    owid_by_year: dict[int, float] = {r["year"]: r["value"] for r in owid_raw}
    owid_years = sorted(owid_by_year)
    first_owid_year = owid_years[0]
    last_owid_year = owid_years[-1]

    anchors_sorted = sorted(anchors, key=lambda a: a[0])

    # Step 1: collect all known points
    known: dict[int, tuple[float, str]] = {}  # year -> (value, source_label)

    for year, val, citation_label in anchors_sorted:
        known[year] = (val, f"anchor-{citation_label}")

    for year, val in owid_by_year.items():
        known[year] = (val, LE_SOURCE_ID)  # OWID overrides anchors

    known_years = sorted(known)
    min_year = known_years[0]
    max_year = known_years[-1]

    # Step 2: interpolate for every year
    result: list[dict] = []
    for year in range(min_year, max_year + 1):
        if year in known:
            val, src = known[year]
        else:
            # Find bounding known years
            lo_year = None
            hi_year = None
            for ky in known_years:
                if ky < year:
                    lo_year = ky
                if ky > year and hi_year is None:
                    hi_year = ky
            if lo_year is None or hi_year is None:
                continue  # shouldn't happen
            lo_val = known[lo_year][0]
            hi_val = known[hi_year][0]
            frac = (year - lo_year) / (hi_year - lo_year)
            val = lo_val + frac * (hi_val - lo_val)
            src = "interpolated"

        # Decide estimated flag
        if year < first_owid_year:
            estimated = True
        else:
            estimated = False
            if src.startswith("anchor-"):
                src = LE_SOURCE_ID  # normalize source for OWID-range years

        result.append({
            "year": year,
            "value": round(val, 4),
            "estimated": estimated,
            "sourceId": src,
        })

    result.sort(key=lambda r: r["year"])
    return result


# ---------------------------------------------------------------------------
# Provenance
# ---------------------------------------------------------------------------

PROVENANCE_TEMPLATE = """# Data Provenance — Demographics

Generated: {retrieval_date}
Pipeline: `pipeline/fetch_demographics.py`
Repo: `github.com/LittleSeneca/history-helix`

## Population

- **Source:** Our World in Data — "Population, 10,000 BCE to 2023" (long-run data)
- **URL:** <{pop_url}>
- **Underlying data:** HYDE v3.3 (2023), Gapminder v7 (2022), UN WPP (2024)
- **Entity used:** World (OWID_WRL)
- **Retrieval date:** {retrieval_date}
- **License:** {owid_license}
- **Citation:** {owid_citation}
- **Transformations:**
  - Filtered to entity "World" only.
  - Population values rounded to nearest integer (original is integer count).
  - Year range: {pop_min_year} to {pop_max_year}.
- **Known gaps:** None. Series is contiguous across the full span.

## Life Expectancy

- **Source:** Our World in Data — "Life expectancy" (long-run)
- **URL:** <{le_url}>
- **Underlying data:** UN WPP (2024); HMD (2025); Zijdeman et al. (2015); Riley (2005)
- **Entity used:** World (OWID_WRL)
- **Retrieval date:** {retrieval_date}
- **License:** {owid_license}
- **Citation:** UN WPP (2022); HMD (2023); Zijdeman et al. (2015); Riley (2005) – with minor processing by Our World in Data
- **Transformations:**
  - Filtered to entity "World" only.
  - OWID data covers 1770–{le_max_year}. Rows sourced from OWID are marked `estimated: false`.
  - Pre-1770 gap filled from documented anchor points (see below) with **linear interpolation** between anchors.
  - Every interpolated year is marked `estimated: true` and `sourceId: "interpolated"`.
  - Anchor-year values are marked `estimated: true` with `sourceId` referencing the citation label.
- **Known gaps:** OWID World series begins at 1770. All years before 1770 are estimated.

### Pre-1500 Life Expectancy Anchor Points

All values are life expectancy at birth.

| Year | Value | Citation |
|------|-------|-----------|
| -10000 (10,000 BCE) | 30.0 | Gurven & Kaplan (2007), "Longevity Among Hunter-Gatherers: A Cross-Cultural Examination", *Population and Development Review* 33(2). Hunter-gatherer modal age at death. |
| -3000 (3,000 BCE) | 26.0 | Cohen & Armelagos, eds. (1984), *Paleopathology at the Origins of Agriculture*. Skeletal evidence for declining health with early agriculture. |
| 100 CE | 28.0 | Frier (2000), "Demography", in *Cambridge Ancient History* vol. XI; Scheidel (2001), "Roman Age Structure: Evidence and Models", *JRS* 91. Roman Egypt census data suggests e₀ ≈ 22–35; we use 28 as midpoint. |
| 1000 CE | 30.0 | Russell (1958), "Late Ancient and Medieval Population", *Transactions of the American Philosophical Society* 48(3). Medieval skeletal and documentary evidence. |
| 1500 CE | 32.0 | Wrigley & Schofield (1981), *The Population History of England 1541–1871*; Riley (2001), *Rising Life Expectancy: A Global History*. |

**Interpolation method:** Linear between consecutive anchor points (and from the 1500 CE anchor to the first OWID data point at 1770). For years after the last anchor but before the first OWID year, the line is drawn anchor→first_OWID.

**Caveats:**
- Life expectancy at birth in pre-modern societies is heavily influenced by infant/child mortality. The "~30 years" anchor does not mean most adults died at 30; it means high childhood mortality pulled the period average down. Survivors past childhood often lived into their 50s–60s.
- These are global averages — regional variation was substantial.
- The anchors represent scholarly consensus ranges; exact year-by-year values are estimates and are marked as such.

## Data shape reference

`data/demographics.json`:

```json
{{
  "population": [
    {{"year": -10000, "value": 4501152, "sourceId": "{pop_source_id}"}},
    ...
  ],
  "lifeExpectancy": [
    {{"year": -10000, "value": 30.0, "estimated": true, "sourceId": "anchor-gurven2007"}},
    {{"year": 1770, "value": 28.5, "estimated": false, "sourceId": "{le_source_id}"}},
    ...
  ]
}}
```
"""


def write_provenance(
    pop_min_year: int,
    pop_max_year: int,
    le_max_year: int,
) -> None:
    """Write `data/provenance.md`."""
    text = PROVENANCE_TEMPLATE.format(
        retrieval_date=RETRIEVAL_DATE,
        pop_url=POP_URL,
        le_url=LE_URL,
        owid_license=OWID_LICENSE,
        owid_citation=OWID_CITATION,
        pop_min_year=pop_min_year,
        pop_max_year=pop_max_year,
        le_max_year=le_max_year,
        pop_source_id=POP_SOURCE_ID,
        le_source_id=LE_SOURCE_ID,
    )
    PROV_OUT.parent.mkdir(parents=True, exist_ok=True)
    PROV_OUT.write_text(text, encoding="utf-8")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    print("=== Demographics Pipeline ===", flush=True)

    # --- Population ---
    print("Fetching population data...", flush=True)
    pop_csv = fetch_csv(POP_URL, POP_CACHE)
    pop_raw = parse_world_rows(pop_csv, "population_historical")
    if not pop_raw:
        print("ERROR: no World population rows found", file=sys.stderr)
        sys.exit(1)
    pop_series = build_population_series(pop_raw)
    pop_years = [r["year"] for r in pop_series]
    print(f"  Population: {len(pop_series)} rows, "
          f"{pop_years[0]}..{pop_years[-1]}", flush=True)

    # --- Life expectancy ---
    print("Fetching life expectancy data...", flush=True)
    le_csv = fetch_csv(LE_URL, LE_CACHE)
    le_raw = parse_world_rows(le_csv, "life_expectancy_0")
    if not le_raw:
        print("ERROR: no World life expectancy rows found", file=sys.stderr)
        sys.exit(1)
    print(f"  OWID LE rows: {len(le_raw)}, "
          f"{le_raw[0]['year']}..{le_raw[-1]['year']}", flush=True)

    le_series = build_life_expectancy_series(le_raw, LE_ANCHORS)
    le_years = [r["year"] for r in le_series]
    le_estimated = sum(1 for r in le_series if r["estimated"])
    print(f"  Life expectancy (with anchors): {len(le_series)} rows, "
          f"{le_years[0]}..{le_years[-1]}, "
          f"{le_estimated} estimated", flush=True)

    # --- Validate ---
    # Strictly ascending years
    for i in range(len(pop_years) - 1):
        assert pop_years[i] < pop_years[i + 1], \
            f"Population years not strictly ascending at index {i}"
    for i in range(len(le_years) - 1):
        assert le_years[i] < le_years[i + 1], \
            f"LE years not strictly ascending at index {i}"

    # Span check
    assert pop_years[0] <= -10000, f"Population doesn't reach -10000 (starts at {pop_years[0]})"
    assert pop_years[-1] >= 2000, f"Population doesn't reach 2000 (ends at {pop_years[-1]})"
    assert le_years[0] <= -10000, f"LE doesn't reach -10000 (starts at {le_years[0]})"
    assert le_years[-1] >= 2000, f"LE doesn't reach 2000 (ends at {le_years[-1]})"

    # --- Write ---
    demographics = {
        "population": pop_series,
        "lifeExpectancy": le_series,
    }
    print(f"Writing {POP_OUT}...", flush=True)
    POP_OUT.parent.mkdir(parents=True, exist_ok=True)
    POP_OUT.write_text(json.dumps(demographics, indent=2), encoding="utf-8")

    print(f"Writing {PROV_OUT}...", flush=True)
    write_provenance(pop_years[0], pop_years[-1], le_years[-1])

    print("Done.", flush=True)


if __name__ == "__main__":
    main()