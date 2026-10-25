#!/usr/bin/env python3
"""
History Helix — Wikidata Events Pipeline
=========================================
Mines major historical events from Wikidata Query Service into data/events.json.

See docs/DESIGN.md §3.1 for the query shape and normalization rules.

Usage:
    python3 pipeline/fetch_events.py          # full fetch
    python3 pipeline/fetch_events.py --dry-run  # validate QIDs only (no fetch)
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
EVENTS_JSON = DATA_DIR / "events.json"
EVENT_CLASSES_JSON = PIPELINE_DIR / "event_classes.json"
CATEGORY_MAP_JSON = PIPELINE_DIR / "category_map.json"

# ── Constants ───────────────────────────────────────────────
WDQS_ENDPOINT = "https://query.wikidata.org/sparql"
USER_AGENT = (
    "HistoryHelix/0.1 (https://github.com/LittleSeneca/history-helix; "
    "shiloh@brooks-security.com) Wikidata events pipeline"
)
SITELINK_MIN = int(os.environ.get("HISTORY_HELIX_SITELINK_MIN", "10"))
YEAR_MIN = -10000
YEAR_MAX = 2100
CHUNK_DELAY = 1.5  # seconds between chunked queries (be polite to WDQS)
CHUNK_SIZE_YEARS = 200  # split queries into chunks for reliability (reduced from 500 in A-8 to avoid WDQS 504 timeouts on dense modern periods)
FETCH_TIMEOUT = 120  # seconds


# ═══════════════════════════════════════════════════════════════
#  SPARQL helpers
# ═══════════════════════════════════════════════════════════════

def build_value_block(qids: list[str]) -> str:
    """Build a VALUES block for the class QIDs."""
    return " ".join(f"wd:{q}" for q in qids)


def build_sparql(qids: list[str], year_from: int, year_to: int, offset: int = 0) -> str:
    """Build a SPARQL query for a chunk of years."""
    values = build_value_block(qids)
    date_from = f"{year_from:+05d}-01-01T00:00:00Z" if year_from >= 0 else f"{year_from:+06d}-01-01T00:00:00Z"
    date_to   = f"{year_to:+05d}-12-31T23:59:59Z" if year_to >= 0 else f"{year_to:+06d}-12-31T23:59:59Z"

    return f"""SELECT ?event ?eventLabel ?date ?prec ?sitelinks ?class ?classLabel WHERE {{
  VALUES ?class {{ {values} }}
  ?event wdt:P31/wdt:P279* ?class .
  ?event p:P585 ?st .
  ?st psv:P585 ?dv .
  ?dv wikibase:timeValue ?date ; wikibase:timePrecision ?prec .
  ?event wikibase:sitelinks ?sitelinks .
  FILTER(?sitelinks >= {SITELINK_MIN})
  FILTER(?date >= "{date_from}"^^xsd:dateTime)
  FILTER(?date <= "{date_to}"^^xsd:dateTime)
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en,fr,de". }}
}}
ORDER BY ?date
OFFSET {offset}
LIMIT 5000"""


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
#  QID validation
# ═══════════════════════════════════════════════════════════════

def validate_class_qids(classes: list[dict]) -> list[dict]:
    """Validate every class QID against the live Wikidata endpoint.
    Returns the list with labels updated from live data.
    Raises SystemExit if any QID fails validation."""
    print("Validating class QIDs against live endpoint...")
    valid = []
    for entry in classes:
        qid = entry["qid"]
        try:
            label = fetch_label(qid)
            if not label:
                print(f"  FAIL: {qid} — no English label found", file=sys.stderr)
                sys.exit(1)
            print(f"  OK: {qid} → {label}")
            entry["label"] = label  # update from live
            valid.append(entry)
        except Exception as e:
            print(f"  FAIL: {qid} — {e}", file=sys.stderr)
            sys.exit(1)
    print(f"  All {len(valid)} QIDs validated.\n")
    return valid


def fetch_label(qid: str) -> str | None:
    """Fetch the English label for a single QID."""
    url = f"https://www.wikidata.org/wiki/Special:EntityData/{qid}.json"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read())
    return data["entities"][qid]["labels"].get("en", {}).get("value")


# ═══════════════════════════════════════════════════════════════
#  Normalization
# ═══════════════════════════════════════════════════════════════

# Wikidata precision codes (from wikibase:timePrecision)
# 0 = billion years, 1 = hundred million years, ..., 6 = millennium,
# 7 = century, 8 = decade, 9 = year, 10 = month, 11 = day
PREC_YEAR   = 9
PREC_DECADE = 8
PREC_CENTURY = 7

# Label for precision in output
PREC_LABELS = {
    7: "century",
    8: "decade",
    9: "year",
    10: "month",
    11: "day",
}


def normalize_date(date_str: str, prec: int) -> int:
    """Convert Wikidata dateTime string to our signed-year integer.

    Convention: **signed-year numbering** with no year zero.
        1 BCE → -1,  2 BCE → -2,  …,  N BCE → -N
        1 CE  → +1,  2 CE  → +2,  …,  N CE  → +N

    Wikidata represents BCE dates with a minus sign and a zero-based year:
        1 BCE → \"-0000\",  2 BCE → \"-0001\",  …,  N BCE → \"-{N-1:04d}\"
    The conversion is:
        - Parse the sign and absolute year from the raw string.
        - For BCE:  return -(year + 1).   (year=0 → -1 = 1 BCE)
        - For CE:   guard year=0 (a Wikidata artifact for uncertain
          boundary dates) → treat as 1 CE.
        - Result: never returns 0.

    Precision-based midpoint placement is handled downstream in normalize_event().
    """
    s = date_str
    if s.startswith("-"):
        sign = -1
        s = s[1:]
    else:
        sign = 1
        s = s.lstrip("+")

    parts = s.split("-")
    year = int(parts[0])

    if sign == -1:
        # Wikidata: 1 BCE → year 0,  2 BCE → year 1,  …,  N BCE → year N-1
        # Signed-year: 1 BCE → -1,  2 BCE → -2,  …,  N BCE → -N
        # So: -(year + 1).  year=0 → -1 ✓,  year=1 → -2 ✓,  etc.
        return -(year + 1)

    # CE: year 0 should never appear in valid Wikidata dates, but if it does
    # (e.g. \"+0000\" for uncertain boundary dates), treat it as 1 CE.
    if year == 0:
        return 1

    return year


def normalize_event(row: dict, class_label_map: dict) -> dict | None:
    """Normalize a single SPARQL result row into our event record.
    Returns None if the event should be skipped (out of year range, etc.)"""
    event_uri = row.get("event", {}).get("value", "")
    if not event_uri:
        return None
    qid = event_uri.rsplit("/", 1)[-1]

    title = row.get("eventLabel", {}).get("value", "")
    if not title:
        return None

    date_str = row.get("date", {}).get("value", "")
    prec = int(row.get("prec", {}).get("value", "9"))

    sitelinks = int(row.get("sitelinks", {}).get("value", "0"))
    class_label = row.get("classLabel", {}).get("value", "")

    # Normalize year
    year = normalize_date(date_str, prec)

    # Clamp precision-based representative years
    if prec == PREC_DECADE:
        year = (year // 10) * 10 + 5  # midpoint of decade
    elif prec == PREC_CENTURY:
        year = (year // 100) * 100 + 50  # midpoint of century
    elif prec == 6:
        # Millennium — midpoint (e.g. 2nd millennium CE → 1500)
        year = (year // 1000) * 1000 + 500
    # prec < 6: geological/archaeological scale — leave as-is, precision noted

    # Filter to our time span
    if year < YEAR_MIN or year > YEAR_MAX:
        return None

    precision_label = PREC_LABELS.get(prec, f"prec{prec}")

    # Map class label to category
    category = class_label_map.get(class_label.lower(), class_label_map.get("default_category", "politics"))

    return {
        "id": hashlib.sha256(f"{qid}-{year}-{title}".encode()).hexdigest()[:12],
        "title": title,
        "year": year,
        "precision": precision_label,
        "category": category,
        "sitelinks": sitelinks,
        "qid": qid,
        "sourceUrl": f"https://www.wikidata.org/wiki/{qid}",
    }


# ═══════════════════════════════════════════════════════════════
#  Dedup
# ═══════════════════════════════════════════════════════════════

def dedup_events(events: list[dict]) -> list[dict]:
    """Merge duplicate events (same historical event, different QIDs).
    Heuristic: same year ± 1 + normalized title match.
    Keeps the one with highest sitelinks count."""
    def norm_title(t):
        return t.lower().strip().rstrip(".")

    # Group by (year_bucket, norm_title)
    groups: dict[tuple[int, str], list[dict]] = {}
    for e in events:
        # Bucket year into ±1 window
        for y in (e["year"], e["year"] - 1, e["year"] + 1):
            key = (y, norm_title(e["title"]))
            if key in groups:
                groups[key].append(e)
                break
        else:
            key = (e["year"], norm_title(e["title"]))
            if key not in groups:
                groups[key] = []
            groups[key].append(e)

    # For each group, keep the one with highest sitelinks
    deduped = []
    for evts in groups.values():
        if len(evts) == 1:
            deduped.append(evts[0])
        else:
            best = max(evts, key=lambda e: e["sitelinks"])
            deduped.append(best)

    # Sort by year
    deduped.sort(key=lambda e: e["year"])
    return deduped


# ═══════════════════════════════════════════════════════════════
#  Main fetch
# ═══════════════════════════════════════════════════════════════

def fetch_all(classes: list[dict]) -> list[dict]:
    """Fetch events from WDQS in year chunks, normalize, return list."""
    qids = [c["qid"] for c in classes]
    all_rows = []

    # Chunk by years for reliability
    for chunk_start in range(YEAR_MIN, YEAR_MAX, CHUNK_SIZE_YEARS):
        chunk_end = min(chunk_start + CHUNK_SIZE_YEARS - 1, YEAR_MAX)
        print(f"  Fetching {chunk_start}–{chunk_end} ...", end=" ", flush=True)

        data = None
        retries = 0
        max_retries = 3
        while data is None and retries <= max_retries:
            try:
                data = cached_query(build_sparql(qids, chunk_start, chunk_end))
            except urllib.error.HTTPError as e:
                retries += 1
                if retries <= max_retries:
                    wait = 2 ** retries  # 2, 4, 8 seconds backoff
                    print(f"HTTP {e.code} (retry {retries}/{max_retries} in {wait}s)...", end=" ", flush=True)
                    time.sleep(wait)
                else:
                    print(f"ERROR: HTTP {e.code} after {max_retries} retries")
            except Exception as e:
                print(f"ERROR: {e}")
                break

        if data is None:
            print("  (continuing with next chunk)")
            continue

        bindings = data.get("results", {}).get("bindings", [])
        print(f"{len(bindings)} results")
        all_rows.extend(bindings)
        time.sleep(CHUNK_DELAY)

    print(f"\nTotal raw rows: {len(all_rows)}")
    return all_rows


def main():
    print("=== History Helix — Events Pipeline ===\n")

    # Load configs
    with open(EVENT_CLASSES_JSON) as f:
        event_classes_cfg = json.load(f)
    classes = event_classes_cfg["classes"]

    with open(CATEGORY_MAP_JSON) as f:
        cat_cfg = json.load(f)
    class_label_map = cat_cfg["map"]
    # Build reverse lookup: lowercase label → category
    # (the classLabel in SPARQL is lowercase already in most cases)

    # Validate QIDs
    if "--skip-qid-check" not in sys.argv:
        classes = validate_class_qids(classes)
    else:
        print("Skipping QID validation (--skip-qid-check)\n")

    if "--dry-run" in sys.argv:
        print("Dry run — QIDs validated, exiting.")
        return

    # Fetch
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    print("Fetching events from Wikidata Query Service...")
    rows = fetch_all(classes)

    # Normalize
    print("Normalizing events...")
    events = []
    skipped = 0
    for row in rows:
        evt = normalize_event(row, class_label_map)
        if evt:
            events.append(evt)
        else:
            skipped += 1
    print(f"  {len(events)} normalized, {skipped} skipped (out of range or no label)")

    # Dedup
    before = len(events)
    events = dedup_events(events)
    print(f"  Dedup: {before} → {len(events)} ({before - len(events)} merged)")

    # Write output
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(EVENTS_JSON, "w") as f:
        json.dump({
            "description": "Major historical events from Wikidata, filtered to sitelinks >= 15",
            "retrieved": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "count": len(events),
            "events": events,
        }, f, indent=2, ensure_ascii=False)

    print(f"\nWrote {len(events)} events to {EVENTS_JSON}")

    # Summary stats
    cats = {}
    precs = {}
    for e in events:
        cats[e["category"]] = cats.get(e["category"], 0) + 1
        precs[e["precision"]] = precs.get(e["precision"], 0) + 1
    print(f"\nCategories: {json.dumps(cats, indent=2)}")
    print(f"Precisions: {json.dumps(precs, indent=2)}")
    print("Done.")


if __name__ == "__main__":
    main()