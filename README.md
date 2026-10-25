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
- Every series carries provenance. See **[data/provenance.md](data/provenance.md)** for the full
  source listing, retrieval dates, licenses, transformations, and known gaps.

## Deploy

The app is a static site served from `dist/` via nginx:alpine, deployed on the k3s cluster
behind the existing Traefik Gateway at **[helix.brooks-security.com](https://helix.brooks-security.com)**.

- **Dockerfile:** `deploy/Dockerfile` — multi-stage Node build → nginx:alpine.
- **Kubernetes manifests:** `deploy/k8s/` — Deployment, Service (ClusterIP), HTTPRoute
  (Gateway `kube-system/edge`, `sectionName: web`).
- **CI/CD:** `.github/workflows/ci.yml` (lint + test), `.github/workflows/deploy.yml`
  (build image → push to GHCR).

## Status

Pre-alpha. Built against a phased plan: **[docs/DESIGN.md](docs/DESIGN.md)**.

## Development

```bash
npm install
npm run dev      # vite dev server
npm test         # vitest
npm run build    # static dist/
```

### Accessibility

- **Reduced motion:** respects `prefers-reduced-motion: reduce` — all animations and transitions
  are disabled.
- **Keyboard navigation:** event markers are focusable (Tab), Arrow keys pan, +/- zoom, Enter/Space
  shows event tooltips. The SVG overlay carries an `aria-label` describing keyboard controls.
- **Responsive:** no horizontal overflow at 320 px, tap targets ≥ 64 px on small screens.