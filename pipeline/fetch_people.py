#!/usr/bin/env python3
"""
History Helix — Wikidata People Pipeline
=========================================
Mines real people (humans with recorded birth AND death dates) from Wikidata
Query Service into data/people.json.

Reuses the chunked-query + cache + normalize pattern from fetch_events.py.
See docs/DESIGN.md §3.1 for the WDQS pattern.

Usage:
    python3 pipeline/fetch_people.py          # full fetch
    python3 pipeline/fetch_people.py --dry-run  # query first chunk only
"""

import json
import os
import sys
import time
import hashlib
import urllib.request
import urllib.parse
import urllib.error
from pathlib import Path

# ── Paths ──────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent
PIPELINE_DIR = ROOT / "pipeline"
CACHE_DIR = PIPELINE_DIR / ".cache"
DATA_DIR = ROOT / "data"
PEOPLE_JSON = DATA_DIR / "people.json"
PROVENANCE_MD = DATA_DIR / "provenance.md"

# Import shared date normalizer from the events pipeline (same directory)
sys.path.insert(0, str(PIPELINE_DIR))
from fetch_events import normalize_date  # noqa: E402

# ── Constants ───────────────────────────────────────────────
WDQS_ENDPOINT = "https://query.wikidata.org/sparql"
USER_AGENT = (
    "HistoryHelix/0.1 (https://github.com/LittleSeneca/history-helix; "
    "shiloh@brooks-security.com) Wikidata people pipeline"
)
SITELINK_MIN = int(os.environ.get("HISTORY_HELIX_PEOPLE_SITELINK_MIN", "25"))
YEAR_MIN = -2000
YEAR_MAX = 2026
CHUNK_DELAY = 1.5          # seconds between queries (be polite to WDQS)
CHUNK_SIZE_YEARS = 10       # birth-decade chunks
QUERY_LIMIT = 5000          # WDQS response cap per query
FETCH_TIMEOUT = 120         # seconds
NARROW_MIN_YEARS = 1         # don't split chunks smaller than 1 year


# ═══════════════════════════════════════════════════════════════
#  SPARQL helpers
# ═══════════════════════════════════════════════════════════════

def build_sparql(year_from: int, year_to: int, offset: int = 0) -> str:
    """Build a SPARQL query for a chunk of birth years.

    Filters on wdt:P31 wd:Q5 (instance of human), with both P569 (birth)
    and P570 (death) required.  Uses the same date-formatting convention
    as fetch_events.py.

    Query-plan notes:
    - P569 (date of birth) comes first with rangeSafe hint — this lets
      Blazegraph use its date-range index instead of scanning all humans.
    - The type check (P31 Q5) and death-date (P570) come after the
      date filter to avoid full-table scans.
    """
    date_from = (
        f"{year_from:+05d}-01-01T00:00:00Z" if year_from >= 0
        else f"{year_from:+06d}-01-01T00:00:00Z"
    )
    date_to = (
        f"{year_to:+05d}-12-31T23:59:59Z" if year_to >= 0
        else f"{year_to:+06d}-12-31T23:59:59Z"
    )

    return f"""SELECT ?person ?personLabel ?birth ?death ?sitelinks WHERE {{
  ?person wdt:P569 ?birth .
  hint:Prior hint:rangeSafe true .
  FILTER(?birth >= "{date_from}"^^xsd:dateTime)
  FILTER(?birth <= "{date_to}"^^xsd:dateTime)
  ?person wdt:P31 wd:Q5 .
  ?person wdt:P570 ?death .
  ?person wikibase:sitelinks ?sitelinks .
  FILTER(?sitelinks >= {SITELINK_MIN})
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
}}
ORDER BY ?birth
OFFSET {offset}
LIMIT {QUERY_LIMIT}"""


def query_wdqs(sparql: str) -> dict:
    """Send a SPARQL query to WDQS, return parsed JSON."""
    params = urllib.parse.urlencode({"format": "json", "query": sparql})
    url = f"{WDQS_ENDPOINT}?{params}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT) as resp:
            raw = resp.read()
            return json.loads(raw)
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")[:500]
        print(f"  WDQS HTTP {e.code}: {body}", file=sys.stderr)
        raise
    except Exception as e:
        print(f"  WDQS error: {e}", file=sys.stderr)
        raise


def cache_key(sparql: str) -> str:
    """Deterministic cache filename from SPARQL text."""
    return hashlib.sha256(sparql.encode()).hexdigest()[:16] + ".json"


def cached_query(sparql: str) -> dict:
    """Query WDQS with disk cache."""
    key = cache_key(sparql)
    cache_path = CACHE_DIR / key
    if cache_path.exists():
        print(f"  [cache hit] {key}")
        with open(cache_path) as f:
            return json.load(f)
    print(f"  [fetching] {key}")
    data = query_wdqs(sparql)
    with open(cache_path, "w") as f:
        json.dump(data, f)
    return data


# ═══════════════════════════════════════════════════════════════
#  Fetch with adaptive narrowing
# ═══════════════════════════════════════════════════════════════

def fetch_chunk(year_from: int, year_to: int, depth: int = 0) -> list[dict]:
    """Fetch all people in a birth-year range, paginating within the chunk
    and narrowing the window on timeout / HTTP 504.

    Returns a list of raw SPARQL binding dicts.
    """
    indent = "  " * (depth + 1)
    label = f"{year_from}–{year_to}"
    print(f"{indent}Chunk {label} ...", end=" ", flush=True)

    all_bindings: list[dict] = []
    offset = 0

    while True:
        sparql = build_sparql(year_from, year_to, offset)
        data = None
        retries = 0
        max_retries = 2

        while data is None and retries <= max_retries:
            try:
                data = cached_query(sparql)
            except (urllib.error.HTTPError, Exception) as e:
                retries += 1
                code = getattr(e, "code", 0)
                if retries <= max_retries and code in (0, 504, 429):
                    wait = 2 ** retries
                    print(f"(retry {retries}/{max_retries} in {wait}s)...",
                          end=" ", flush=True)
                    time.sleep(wait)
                else:
                    # Hard failure — try narrowing
                    if year_to - year_from > NARROW_MIN_YEARS:
                        print(f"\n{indent}  narrowing {label} after failure...")
                        mid = (year_from + year_to) // 2
                        left = fetch_chunk(year_from, mid, depth + 1)
                        right = fetch_chunk(mid + 1, year_to, depth + 1)
                        return left + right
                    print(f"ERROR (giving up on {label})")
                    return all_bindings

        if data is None:
            print("(skipped)")
            return all_bindings

        bindings = data.get("results", {}).get("bindings", [])
        n = len(bindings)
        all_bindings.extend(bindings)

        if n < QUERY_LIMIT:
            # No more pages
            print(f"{n} total" if offset == 0 else f"+{n} = {len(all_bindings)} total")
            break
        else:
            offset += n
            print(f"+{n} → offset {offset} ...", end=" ", flush=True)
            # Small delay between paginated queries on same chunk
            time.sleep(0.5)

    return all_bindings


# ═══════════════════════════════════════════════════════════════
#  Normalization
# ═══════════════════════════════════════════════════════════════

def normalize_person(row: dict) -> dict | None:
    """Normalize a single SPARQL result row into our person record.

    Returns None if any required field is missing or if the person
    falls outside our year range after normalization.
    """
    person_uri = row.get("person", {}).get("value", "")
    if not person_uri:
        return None
    qid = person_uri.rsplit("/", 1)[-1]

    name = row.get("personLabel", {}).get("value", "")
    if not name:
        return None

    birth_str = row.get("birth", {}).get("value", "")
    if not birth_str:
        return None
    # Validate: reject URIs (contain "://") but accept all date formats
    # (Wikidata sometimes omits the leading + for CE dates)
    if "://" in birth_str:
        return None

    death_str = row.get("death", {}).get("value", "")
    if not death_str:
        return None

    # Validate: reject URIs (contain "://") but accept all date formats
    if "://" in death_str:
        return None

    if "sitelinks" not in row:
        return None
    sitelinks_raw = row["sitelinks"].get("value", "")
    if not sitelinks_raw:
        return None
    try:
        sitelinks = int(sitelinks_raw)
    except (ValueError, TypeError):
        return None

    # Normalize dates using shared signed-year convention (see fetch_events.normalize_date).
    # 1 BCE → -1, 2 BCE → -2, …, no year 0.  Wikidata +0000/0000 → 1 CE.
    birth = normalize_date(birth_str, 9)   # precision 9 = year (not used further)
    death = normalize_date(death_str, 9)

    # Drop if either date is outside our span (catches BCE dates
    # beyond YEAR_MIN and future dates beyond YEAR_MAX)
    if birth < YEAR_MIN or birth > YEAR_MAX:
        return None
    if death < YEAR_MIN or death > YEAR_MAX:
        return None

    # Sanity: birth must precede death (allow same-year: died at birth)
    if birth > death:
        return None

    return {
        "id": hashlib.sha256(f"{qid}-{birth}".encode()).hexdigest()[:12],
        "name": name,
        "qid": qid,
        "birth": birth,
        "death": death,
        "sitelinks": sitelinks,
        "sourceUrl": f"https://www.wikidata.org/wiki/{qid}",
    }


# ═══════════════════════════════════════════════════════════════
#  Provenance update
# ═══════════════════════════════════════════════════════════════

PROVENANCE_PEOPLE_MD = PIPELINE_DIR / "provenance_people.md"


def update_provenance(count: int) -> None:
    """Append the People section to provenance.md if not already present."""
    if not PROVENANCE_MD.exists():
        PROVENANCE_MD.write_text("")
    existing = PROVENANCE_MD.read_text()
    if "## People — Wikidata Query Service" in existing:
        return  # already there

    section_template = PROVENANCE_PEOPLE_MD.read_text()
    section = section_template.format(min_sitelinks=SITELINK_MIN)
    PROVENANCE_MD.write_text(existing.rstrip() + "\n" + section + "\n")
    print(f"Updated {PROVENANCE_MD}")


# ═══════════════════════════════════════════════════════════════
#  Main
# ═══════════════════════════════════════════════════════════════

def main() -> None:
    print("=== History Helix — People Pipeline ===\n")
    print(f"Sitelink threshold: >= {SITELINK_MIN}")
    print(f"Chunk size: {CHUNK_SIZE_YEARS} years")
    print(f"Year range: {YEAR_MIN} to {YEAR_MAX}")
    print()

    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    # ── Fetch ──
    print("Fetching people from Wikidata Query Service...")
    all_bindings: list[dict] = []

    chunks = list(range(YEAR_MIN, YEAR_MAX, CHUNK_SIZE_YEARS))
    total_chunks = len(chunks)
    for i, chunk_start in enumerate(chunks):
        chunk_end = min(chunk_start + CHUNK_SIZE_YEARS - 1, YEAR_MAX)
        label = f"{chunk_start}–{chunk_end}"

        if "--dry-run" in sys.argv and i > 0:
            print(f"  Dry run — stopping after first chunk.")
            break

        bindings = fetch_chunk(chunk_start, chunk_end)
        all_bindings.extend(bindings)

        # Heartbeat every 50 chunks for long runs
        if (i + 1) % 50 == 0:
            print(f"  [{i+1}/{total_chunks} chunks, {len(all_bindings)} raw rows so far]")

        time.sleep(CHUNK_DELAY)

    print(f"\nTotal raw rows: {len(all_bindings)}")

    # ── Normalize ──
    print("Normalizing people...")
    people: list[dict] = []
    skipped = 0
    seen_ids: set[str] = set()

    for row in all_bindings:
        person = normalize_person(row)
        if person is None:
            skipped += 1
        elif person["id"] not in seen_ids:
            seen_ids.add(person["id"])
            people.append(person)
        else:
            skipped += 1  # duplicate

    print(f"  {len(people)} normalized, {skipped} skipped "
          f"(missing fields, out of range, or duplicate)")

    # ── Sort by birth ──
    people.sort(key=lambda p: p["birth"])

    # ── Write output ──
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(PEOPLE_JSON, "w") as f:
        json.dump({
            "description": (
                f"Notable people from Wikidata (sitelinks >= {SITELINK_MIN}), "
                "with recorded birth and death dates"
            ),
            "retrieved": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "count": len(people),
            "people": people,
        }, f, indent=2, ensure_ascii=False)

    print(f"\nWrote {len(people)} people to {PEOPLE_JSON}")

    # ── Summary stats ──
    if people:
        birth_years = [p["birth"] for p in people]
        print(f"Birth range: {min(birth_years)} to {max(birth_years)}")
        print(f"Median sitelinks: {sorted(p['sitelinks'] for p in people)[len(people)//2]}")

        # Count by millennium
        millennia: dict[int, int] = {}
        for p in people:
            m = (p["birth"] // 1000) * 1000
            millennia[m] = millennia.get(m, 0) + 1
        print(f"By birth millennium:")
        for m in sorted(millennia.keys()):
            print(f"  {m:+d}: {millennia[m]}")

    # ── Update provenance ──
    update_provenance(len(people))

    print("Done.")


if __name__ == "__main__":
    main()