# Data Provenance — Demographics

Generated: 2026-10-24
Pipeline: `pipeline/fetch_demographics.py`
Repo: `github.com/LittleSeneca/history-helix`

## Population

- **Source:** Our World in Data — "Population, 10,000 BCE to 2023" (long-run data)
- **URL:** <https://ourworldindata.org/grapher/population.csv?v=1&csvType=full&useColumnShortNames=true>
- **Underlying data:** HYDE v3.3 (2023), Gapminder v7 (2022), UN WPP (2024)
- **Entity used:** World (OWID_WRL)
- **Retrieval date:** 2026-10-24
- **License:** CC BY 4.0
- **Citation:** HYDE (2023); Gapminder (2022); UN WPP (2024) – with major processing by Our World in Data
- **Transformations:**
  - Filtered to entity "World" only.
  - Population values rounded to nearest integer (original is integer count).
  - Year range: -10000 to 2023.
- **Known gaps:** None. Series is contiguous across the full span.

## Life Expectancy

- **Source:** Our World in Data — "Life expectancy" (long-run)
- **URL:** <https://ourworldindata.org/grapher/life-expectancy.csv?v=1&csvType=full&useColumnShortNames=true>
- **Underlying data:** UN WPP (2024); HMD (2025); Zijdeman et al. (2015); Riley (2005)
- **Entity used:** World (OWID_WRL)
- **Retrieval date:** 2026-10-24
- **License:** CC BY 4.0
- **Citation:** UN WPP (2022); HMD (2023); Zijdeman et al. (2015); Riley (2005) – with minor processing by Our World in Data
- **Transformations:**
  - Filtered to entity "World" only.
  - OWID data covers 1770–2023. Rows sourced from OWID are marked `estimated: false`.
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
{
  "population": [
    {"year": -10000, "value": 4501152, "sourceId": "owid-population-hyde-gapminder-un"},
    ...
  ],
  "lifeExpectancy": [
    {"year": -10000, "value": 30.0, "estimated": true, "sourceId": "anchor-gurven2007"},
    {"year": 1770, "value": 28.5, "estimated": false, "sourceId": "owid-life-expectancy"},
    ...
  ]
}
```
