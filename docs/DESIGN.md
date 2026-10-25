# History Helix — Implementation Plan

> **For Hermes:** Execute this via the kanban workstream loop (`hermes-kanban-workstreams`) — spec → dispatch worker → integrate. Model law: cards on `deepseek-v4-pro`. Clickable prototype is a *predecessor* to the plan, not the plan.

**Goal:** A static HTML5 app rendering the sweep of human history (10,000 BCE → 2100 CE) as a single diagonal corkscrew, where every major event fires a leader line into the coil, and the coil surface is the **aggregate of human lives** — each strand a sampled person, bundled by birth cohort, thick with real population density and stretched by real life expectancy.

**Architecture:** Zero-backend static site. Offline data pipeline (Python) mines Wikidata (events) + Our World in Data (demographics) into versioned JSON; a Vite-bundled ES-module frontend renders batched `Path2D` strands on Canvas 2D with a crisp SVG overlay for the helix guides, event markers, leader lines and labels. Pan/zoom/scrub + hover/filter/search on top.

**Tech Stack:** Vite (build) · vanilla ES modules (no framework) · Canvas 2D · inline SVG overlay · Python 3 + `requests`/`pandas` for the pipeline · Vitest for unit tests · Playwright for render verification · nginx:alpine on k3s (HTTPRoute on the existing `kube-system/edge` Gateway).

**Repo:** `github.com/LittleSeneca/history-helix` (new, public — personal account, not Brooks Security).
**Deploy target:** `helix.brooks-security.com` — static `dist/` behind the existing Traefik Gateway (see `k3s-gateway-api-ingress` skill). No auth gate (public viz).

---

## 1. Context & Assumptions

- **Time span:** 10,000 BCE → 2100 CE, linear along the coil, ~12 turns (≈ 1,000 yr / turn).
- **Events:** auto-mined from Wikidata Query Service (`https://query.wikidata.org/sparql`). Broad and noisy by choice; notability filtered by sitelink count. Human curation pass is an explicit *later* phase, not a prerequisite.
- **Strands:** sampled individual lives. Density per birth cohort ∝ real world population; strand arc length ∝ real life-expectancy-at-birth. Both from OWID/HYDE.
- **Rendering:** Canvas 2D for strands (batched per color), SVG overlay for everything with text/hover.
- **Honesty constraint (non-negotiable):** no fabricated data. Population, life expectancy and events each carry provenance. Where a series is interpolated or estimated, `provenance.md` says so.

### Environment facts
- Host: `devbox.brooks-security.com` (Linux, bash). Node via `node`/`npm` (verify versions in Task 0.1; install via the repo's own devcontainer or `nvm` — **never** touch system packages).
- `gh` authed as `LittleSeneca` with `repo`+`workflow` scopes.
- k3s single-node, Gateway `kube-system/edge`, HTTPRoutes use `sectionName: web`. Traefik rewrites `X-Forwarded-*` to `http` on the origin leg (don't rely on them for proto detection).

---

## 2. Geometry Spec (the part that must be right)

One shared module produces every coordinate; nothing duplicates these constants.

### 2.1 The helix

```
t          = year (numeric; BCE negative, no year zero — see pitfalls)
u          = (t - tMin) / (tMax - tMin)          // 0..1 across the whole span
THETA      = 2π * TURNS                           // TURNS ≈ 12
theta(u)   = THETA * u
```

Local coil point (axis vertical), then the whole scene is rotated so the axis climbs up-and-right:

```
R      = coil radius (px, scene units)
SQUASH = 0.40                                     // cross-section vertical squash → depth
LEAN   = 32°                                      // axis tilt. This is the "up and to the right"
riseY(u) = -LEN * u                               // axis advances upward in local space

localX(u) = R * cos(theta(u))
localY(u) = riseY(u) + SQUASH * R * sin(theta(u))

// depth (for z-order): front of coil = sin(theta) > 0
depth(u)  = sin(theta(u))                         // +1 near camera, -1 behind

project(u) = rotate(localX, localY, LEAN) + center
```

**Depth ordering:** strands on the front of the coil (`depth > 0`) draw *over* strands on the back. Concretely: render back half, then front half — two passes, or sort batches by a coarse depth bucket.

### 2.2 A life is an arc

A person born `b`, died `d` is a sub-curve of the coil from `u(b)` to `u(d)`, offset radially by `ρ` so the cohort reads as a ribbon, not one line:

```
strandPoint(u, rho, cohortPhase) =
   project_on_surface(u, radius = R + rho, thetaBase = theta(u) + cohortPhase)
```

Sampled at `N ≈ 12` points along `u ∈ [u(b), u(d)]`; drawn as one `Path2D` subpath (`moveTo` … `lineTo`s).

- **`cohortPhase`** — small angular jitter shared by a cohort so its bundle has a coherent twist; ± a few degrees.
- **`rho`** — per-strand radial offset, e.g. uniform in `[-BAND, +BAND]` (`BAND ≈ 6–10px`), so overlapping cohorts interleave (generational overlap, by construction).
- **Arc length grows with life expectancy automatically** — a 1470s life (~35 yr) covers ~12° of the coil; a 2020s life (~73 yr) covers ~26°. The Industrial-Revolution lengthening is data, not styling.

### 2.3 Cohort → strand count (population honesty)

```
cohortsT  = 25-year bins across [tMin, tMax]        // ~484 bins
pop(c)    = interpolated world population at cohort midpoint (OWID/HYDE)
alloc(c)  = max(FLOOR, round(BUDGET * pop(c) / Σpop))   // BUDGET ≈ 60_000 strands, FLOOR ≈ 1
remainder = BUDGET - Σalloc                          // largest-remainder → exact conservation
lifeExp(c)= interpolated life expectancy at cohort midpoint
strandLife = clamp(gauss(lifeExp(c), sigma ≈ 0.25*lifeExp), 1, ...)   // individual deviation
```

Early cohorts get ~1–3 strands (world pop ~1–5 M); the modern cohorts get thousands. The bundle's *thickness* is literally the population curve.

**Conservation test:** `Σalloc == BUDGET` exactly (largest-remainder method), asserted in tests.

### 2.4 Event anchoring + leader lines

```
anchor(e) = project(u(event.year)) at radius R (on the coil surface, front preferred)
```

- Route labels into the **left** or **right margin** by which side of the coil axis the anchor lands; alternate on a set of parallel **tracks** (`TRACK_GAP ≈ 22px`).
- `assignTracks(events)` — greedy: sort by anchor Y, place each on the lowest track whose last occupant is ≥ `GAP` away; extend beyond available tracks by collapsing into a "+N more" cluster node.
- Leader line: anchor → elbow (a fixed offset along the label direction) → label start. Quartz-thin stroke, low opacity; label text in SVG.

### 2.5 Level of detail (LOD)

12,000 years of coiled history on screen = label explosion. Rule:

```
at zoom z, show events with sitelinks >= threshold(z)   // low z → only the giants
strands: always all, but alpha scales with 1/zoom       // dense zoom → thinner, dimmer
```

Thresholds in `config.js`, culled set recomputed on zoom settle (debounced).

---

## 3. Data Pipeline

Two independent, re-runnable scripts. Each caches raw responses under `pipeline/.cache/` (gitignored) and emits normalized JSON with provenance.

### 3.1 Events — `pipeline/fetch_events.py`

- **Endpoint:** `https://query.wikidata.org/sparql?format=json`. **Always send a descriptive `User-Agent`** (WDQS policy; a missing UA gets 403).
- **Class list** (`pipeline/event_classes.json`) — *validate every QID against the live endpoint before trusting it*; candidates to confirm: battle, war, treaty, election, natural disaster, epidemic/disease outbreak, expedition, invention/discovery, founding/dissolution. Treat the list as data, not code.
- **Query shape:**

```sparql
SELECT ?event ?eventLabel ?date ?prec ?sitelinks ?classLabel WHERE {
  ?event wdt:P31/wdt:P279* ?class .
  ?event p:P585 ?st .
  ?st psv:P585 ?dv .
  ?dv wikibase:timeValue ?date ; wikibase:timePrecision ?prec .
  ?event wikibase:sitelinks ?sitelinks .
  FILTER(?sitelinks >= 15)
  FILTER(?date >= "-10000-01-01T00:00:00Z"^^xsd:dateTime)
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,fr,de". }
}
```

- **Normalize** → `data/events.json`: `{id, title, year, precision, category, sitelinks, qid, sourceUrl}`.
- **Pitfalls to handle explicitly:**
  - **Date precision** (P585 precision: 6=decade, 7=century, 9=year, 10=month, 11=day). Year-scope only year precision; carry sub-year events at their year.
  - **No year zero.** Wikidata stores 1 BCE as year `0`. Convert with care so sorting and `u()` don't drift by one across the BCE/CE boundary.
  - **Signed-year convention.** The project stores all years as signed integers with no year 0:
    `1 BCE = -1`, `2 BCE = -2`, …, `N BCE = -N`; `1 CE = +1`, `2 CE = +2`, …, `N CE = +N`.
    The pipeline normalizer (`normalize_date` in `fetch_events.py`) converts Wikidata dateTime
    strings (where `-0000` = 1 BCE, `-0001` = 2 BCE, etc.) with the formula `-(year + 1)` for BCE
    and guards against Wikidata's `+0000` artifact by mapping it to `1 CE`. The result is that
    year `0` never appears in any output artifact — there is a clean gap between `-1` and `+1`.
    Every BCE row in `data/people.json` and `data/events.json` obeys this rule.
  - **Proleptic Gregorian** — pre-1583 dates are Gregorian-normalized, not Julian. Documented, not "fixed".
  - **Dedup** — same historical event as multiple QIDs; collapse by (year ± 1, normalized title) heuristic, keep highest sitelinks.
  - **Bias** — expect heavy Western/modern skew. Record it in `provenance.md`; the curation phase exists to correct it.

- **Category mapping:** P31 (or `classLabel`) → display category via `pipeline/category_map.json` (war / politics / science / exploration / religion / culture / disaster / economy). Tested against a fixed fixture.

### 3.2 Demographics — `pipeline/fetch_demographics.py`

- **Population:** OWID grapher CSV (HYDE-backed, long-run world population) → `data/demographics.json → population[]`.
- **Life expectancy:** OWID long-run life-expectancy CSV. Coverage pre-1500 is thin; where the series is absent, use **documented anchor points** (forager ≈ 30, classical ≈ 25–35, medieval ≈ 30, ~40 by 1800, ~50 by 1900, ~73 today) with citations, and **linear interpolation between anchors**. Every anchor is cited in `provenance.md`; the app can render an "estimated" hatch on pre-modern cohorts.
- Output shape: `population: [{year, value, sourceId}]`, `lifeExpectancy: [{year, value, estimated: bool, sourceId}]`.

### 3.3 Provenance — `data/provenance.md`
Per-series: source, retrieval date, license, transformations, known gaps. The README links it. This is what makes the viz defensible instead of decorative.

---

## 4. Repo Structure

```
history-helix/
├── index.html
├── package.json                 # vite, vitest, playwright
├── vite.config.js
├── README.md
├── src/
│   ├── main.js                  # bootstrap: load data → layout → render → wire interaction
│   ├── config.js                # TURNS, LEAN, SQUASH, BUDGET, LOD thresholds, colors
│   ├── geometry/
│   │   ├── helix.js             # u(), theta(), project(), depth(); the ONLY geometry source
│   │   └── coil.js              # strandPoint(), strandPath(), cohort sampling
│   ├── data/
│   │   └── load.js              # fetch + shape events.json / demographics.json
│   ├── render/
│   │   ├── strands.js           # cohort → Path2D batches, canvas passes (back/front)
│   │   ├── overlay.js           # SVG: helix guides, era markers, event markers, leaders
│   │   └── labels.js            # assignTracks() collision placement
│   ├── interaction/
│   │   ├── viewport.js          # pan/zoom/scrub, transform matrix, LOD settle
│   │   ├── hover.js             # hit-testing (strand bands, event markers), tooltip
│   │   └── filters.js           # category toggles, search, era readout
│   └── ui/
│       └── panel.js             # legend, filter rail, era banner, tooltip element
├── data/
│   ├── events.json              # generated
│   ├── demographics.json        # generated
│   └── provenance.md
├── pipeline/
│   ├── event_classes.json
│   ├── category_map.json
│   ├── fetch_events.py
│   ├── fetch_demographics.py
│   ├── build.py                 # runs both, writes data/, prints summary
│   └── .cache/                  # gitignored raw responses
├── tests/
│   ├── geometry.test.js
│   ├── labels.test.js
│   ├── lands.test.js            # category mapping + date precision/BCE parsing fixtures
│   └── conservation.test.js     # Σalloc == BUDGET
├── deploy/
│   ├── Dockerfile               # nginx:alpine + dist/
│   └── k8s/                     # deployment.yaml, service.yaml, httproute.yaml
└── .github/workflows/
    ├── ci.yml                   # lint + vitest + playwright render checks
    └── deploy.yml               # build → image → roll k3s
```

No monoliths: `helix.js` owns geometry and nothing else; `strands.js` owns rendering and nothing else. If any file crosses ~400 lines, split before continuing.

---

## 5. Phased Build (TDD, bite-sized, commit per task)

> Each task ≈ 2–5 min. `npm test` between tasks. Commit after each.

### Phase 0 — Repo & skeleton
- **0.1** `gh repo create LittleSeneca/history-helix --public --clone`; verify `node --version`/`npm --version`; note them in README.
- **0.2** `npm init -y`; add `vite vitest`; `npm create vite` style `index.html`. Confirm `npm run dev` serves a page (verify with curl to the dev port).
- **0.3** Commit `chore: scaffold vite static app`.
- **0.4** CI: `.github/workflows/ci.yml` runs lint + `npm test` on PR. Verify green on a trivial test.

### Phase 1 — Geometry core (TDD)
- **1.1** `tests/geometry.test.js`: assert `u(tMin)==0`, `u(tMax)==1`, `u()` strictly increasing; `theta()` period == TURNS.
- **1.2** Implement `src/geometry/helix.js` until green.
- **1.3** Test `project()`: axis direction under LEAN is up-right (Δx>0, Δy<0); `depth()` sign flips across the coil. Implement.
- **1.4** Render the bare corkscrew to canvas — a single stroked helix spine. Commit. **Visual checkpoint: does it read as a corkscrew climbing up-and-right?** (Screenshot; if not, tune LEAN/SQUASH here, not later.)

### Phase 2 — Demographics pipeline
- **2.1** `fetch_demographics.py`: download OWID CSVs, write `demographics.json`. Assert non-empty, monotonic year keys.
- **2.2** Anchor fallback for pre-1500 life expectancy + provenance entries.
- **2.3** Add `estimated` flags; commit raw→normalized diff in `provenance.md`.

### Phase 3 — Strands
- **3.1** `tests/conservation.test.js`: `Σalloc == BUDGET`, floors respected. Implement `allocCohorts()`.
- **3.2** `coil.js`: `strandPath(u0,u1,rho,phase) → Path2D`; test that endpoint coords match `project()` at the ends.
- **3.3** `render/strands.js`: group strands by color → **one `Path2D` per color**, stroke a handful of times (target: <10 stroke calls for 60k strands). Two passes (back/front by depth).
- **3.4** Verify: canvas non-blank (Playwright pixel sample), strand count matches expected at a given BUDGET; measure frame time on pan. Commit.

### Phase 4 — Events pipeline + overlay
- **4.1** `fetch_events.py` with UA header; validate class QIDs against live endpoint; cache.
- **4.2** `tests/lands.test.js` fixtures: date precision (decade/century), BCE/CE year-zero edge, dedup, category mapping. Implement normalizer.
- **4.3** `assignTracks()` + `tests/labels.test.js` (property: no two labels on a track within GAP; overflow → cluster node). Implement.
- **4.4** SVG overlay: era markers (century rings/tick labels), event markers, leader lines, labels. Commit. **Visual checkpoint.**

### Phase 5 — Interaction
- **5.1** `viewport.js`: pan/zoom/scrub with a transform matrix; LOD recompute on settle (debounced).
- **5.2** `hover.js`: hit-test strand bands (cohort ± phase) → "a life: b 1432 – d 1478, cohort 1430s"; event markers → tooltip with title/category/link. Verify via dispatched events + read-back (per `interactive-svg-charts` technique — a screenshot can't hover).
- **5.3** `filters.js`: category toggles, era banner, search-jump-to-event. Commit.

### Phase 6 — Polish, a11y, deploy
- **6.1** `prefers-reduced-motion`, keyboard nav (arrow scrub, tab to events), `aria-label`s, mobile: no horizontal overflow at 320px, tap targets ≥ 64px.
- **6.2** `deploy/Dockerfile` + k8s manifests; HTTPRoute `helix.brooks-security.com` on Gateway `kube-system/edge`, `sectionName: web`. Verify public HTTPS serves `200` and shows a non-blank canvas.
- **6.3** README with the honesty statement (sampled lives, sourced data, known bias) + `provenance.md` link.

---

## 6. Tests & Validation

**Unit (Vitest):**
- geometry invariants (§2.1–2.2)
- strand-count conservation (§2.3)
- date precision / BCE parsing / dedup / category mapping on fixed fixtures (§3.1)
- label track assignment non-overlap + overflow (§2.4)

**Render (Playwright, in CI):**
- canvas is non-blank (sample pixels — not a vision judgment)
- SVG event-node count == expected for a given zoom/LOD
- dispatch `pointermove` on a known event marker → assert tooltip text; `pointerleave` → cleared
- keyboard: `ArrowRight` moves the era readout

**Manual checkpoints** (screenshot, then *measure*): Phase 1.4 corkscrew reads right; Phase 4.4 labels sane; Phase 6.2 public URL.

---

## 7. Risks & Open Questions

| Risk | Mitigation |
|---|---|
| **Wikidata noise / false "major"** | sitelink threshold is a tunable config; the curation phase (post-MVP) is the real fix. Ship MVP noisy, label it so. |
| **Wikidata bias (Western/modern)** | Documented in `provenance.md`; curation phase rebalances. Do not silently "correct". |
| **WDQS rate limits / UA policy** | Cache raw responses; sleep between chunked (date-ranged) queries; descriptive UA. |
| **12,000 yr linear → empty prehistory** | Offer a "compress prehistory" toggle (non-linear `u()` for the first N turns) as an explicit Phase-6 option — never silently. |
| **60k strands perf** | Batched `Path2D` per color; test frame time early (3.3). If it misses, drop BUDGET or add a WebGL path behind a flag. |
| **Label explosion at 12 turns** | LOD thresholds by sitelinks + zoom; cluster overflow nodes. |
| **BCE/CE off-by-one** | Explicit unit fixture at the boundary (Task 4.2). |
| **Sensitive content (genocide, atrocity events)** | Tone: factual, sourced, no sensationalism; category-level review before public deploy. |

**Open questions for Graham:**
1. **Prehistory compression toggle** — want it in v1 or defer? (Recommend: defer to Phase 6, ship linear first.)
2. **Public or private repo** — I default to public (it's a viz); say the word for private.
3. **Deploy hostname** — `helix.brooks-security.com` assumed; confirm or give an alternative.
4. **Metric emphasis** — should strand color encode *era* (recommended) or *event category density*? Color-by-era is legible; density coloring is a second mode worth a toggle.

---

## 8. Execution Handoff

Plan saved. Next move is **not** a chat edit spree — it's:

1. `gh repo create LittleSeneca/history-helix --public` (Phase 0.1).
2. Stand up a kanban board with Phases 0–6 as cards on **deepseek-v4-pro**; workers execute per-card, I integrate and open PRs.
3. Human review gate before the public deploy (Phase 6.2) — no self-merge.

Say go and I'll create the repo and cut the first cards.
