# History Helix

One corkscrew through 12,000 years of human history.

Time is the coil's angle. Every major event fires a leader line into the thread. And the thread
itself is the **aggregate of human lives** — each strand a sampled person, bundled by birth
cohort, its thickness the real population curve and its length the real life expectancy of its
era. The Industrial Revolution lengthens the strands; the population boom thickens the bundle.
Nobody styled that. It is the data.

## Honesty statement

- **Events** are auto-mined from Wikidata — broad, noisy, and Western/modern-skewed. That skew is
  documented, not hidden; a human curation pass is a planned later phase.
- **Population** and **life expectancy** come from Our World in Data (HYDE-backed long-run series),
  with cited anchor points where the series is thin (pre-1500).
- **Strands are sampled lives**, not every human who ever lived. Density is scaled to real
  population, so the bundle is honest about *how many* without drawing *all* of them.
- Every series carries provenance. See `docs/DESIGN.md` and (once generated) `data/provenance.md`.

## Status

Pre-alpha. Built against a phased plan: **[docs/DESIGN.md](docs/DESIGN.md)**.

## Development

```bash
npm install
npm run dev      # vite dev server
npm test         # vitest
npm run build    # static dist/
```
