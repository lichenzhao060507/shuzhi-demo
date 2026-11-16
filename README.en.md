[中文](README.md) | **English**

# Digital Transformation Advisor · Static Demo Site

A static demo site for assessing the digital maturity of small and medium-sized enterprises (SMEs). It applies the *Digitalization Level Assessment Indicators for SMEs (2024 Edition)* (MIIT Enterprise [2024] No. 56) to produce a level verdict, scenario gaps, a transformation roadmap, and a ranking of investments by return — with every number traceable to a criterion or to the source document.

**Live demo: <https://lichenzhao060507.github.io/shuzhi-demo/>**

The site is fully static: no backend, no build step, no third-party runtime dependencies. `index.html` plus `assets/` and `data/` is all it needs.

## Pages

| Page | Content |
|---|---|
| `index.html` | Main site: assessment method, 16 application scenarios, entry points to the samples |
| `highlights.html` | What the tool does: traceability, transparent criteria, ranked roadmap |
| `report.html` | Full diagnostic report for a sample firm (level, gaps, roadmap, ROI) |
| `ask.html` | Q&A: follow-up questions on the selected firm's level, gaps, sequencing and policy basis |

## Layout

```
index.html / highlights.html / report.html / ask.html   the four pages
.nojekyll                                               lets GitHub Pages serve as-is
assets/
  styles.css  redesign.css  typography.css  …            design tokens, themes, per-page styles
  engine.js                                              criteria engine: scoring, leveling, gaps
  app.js                                                 main-site rendering and interaction
  agent/                                                 Q&A page: retrieval, planner, tools, memory, claim checks
  fonts/                                                 self-hosted Noto Sans/Serif SC (licence included)
  img/                                                   hero and scenario art (AI-generated, not photographs)
data/
  criteria.json                                          15 indicators, 16 scenarios, four level thresholds
  fixtures.json                                          metadata for the 6 sample firms
  samples/*.json                                         full precomputed results for the 6 samples
  policy-notes.json                                      policy annotations tied to the conclusions
  agent/                                                 Q&A knowledge base: 1,349 cases, 118 papers, 70 policies, 5 public cases
official/                                                the 2024 assessment indicators, as published (PDF)
beta/                                                    earlier snapshot plus design review notes
```

## Local preview

```bash
python -m http.server 8000
# open http://127.0.0.1:8000/
```

Opening `index.html` by double-clicking will not work: the pages `fetch` JSON from `data/`, which the `file://` origin blocks.

## Criteria and engine

`data/criteria.json` is the single source of criteria, in four parts:

- `indicators`: 15 collection items, each with a point cap and options;
- `scenarios`: 16 application scenarios, marked as binding or non-binding;
- `levels`: four thresholds (Initial / Standardized / Integrated / Collaborative). A level requires the score, the number of scenarios reached, **and** the number of binding scenarios reached to clear their thresholds at the same time;
- `source`: where each part of the criteria comes from.

`assets/engine.js` is the deterministic in-browser implementation, also `require`-able for regression tests:

- single choice: `score = option index / (option count - 1) × 100`;
- multiple choice: `score = selected / valid options × 100`; "none" is excluded from the denominator, and picking "none" in a single-choice item scores 0;
- per item: `points = max_points × score / 100`;
- total: sum unrounded points, then `round2` with half-even rounding (matching Python `round`; `toFixed` is half-up and off by 0.01);
- level: all three thresholds at once;
- missing scenario: falls back to level 1, matching the backend rule baseline.

## Two data paths

| Path | Source | Output |
|---|---|---|
| Sample firms | `data/samples/*.json`, precomputed by the backend | Complete, including ROI ranges and roadmap ranking |
| Custom profile | computed in the browser by `assets/engine.js` | Level and a gap-priority table, no monetary figures |

Custom profiles deliberately return no money figures: amounts depend on cost ranges and effectiveness elasticities that are not shipped to the front end. Inventing a number would destroy the traceability that the whole tool rests on, so the page says so where the figures would go.

The six samples cover the usual anti-patterns — no level at all, hardware without connectivity, systems without process change, data collection without analysis, subsidies without capability — plus a Standardized-level baseline.

## Q&A page

`ask.html` offers two planners, switchable in the page:

- **Rules (offline)**: zero cost, composes answers from the criteria and the knowledge base, attaches source text to any sentence about policy;
- **Model (BYOK)**: the user supplies an OpenAI-compatible endpoint and key; the key stays in browser local storage.

Every number in an answer comes from the deterministic assessment result. When retrieval finds nothing, the answer says so rather than filling the gap.

## Deployment

GitHub Pages is enabled on the `main` branch root (`legacy` build; `.nojekyll` keeps Jekyll from touching `assets/`). For nginx, OSS or COS, serve the directory as the site root or mount it at a sub-path.

## Notes

- `beta/` is an earlier snapshot kept for comparison; it is not an entry point.
- The hero and scenario images under `assets/img/` are AI-generated illustrations of factory floors, not photographs, and the pages do not present them as evidence.
- `data/` is an export snapshot, not hand-edited source. Editing numbers there by hand decouples the site from the criteria.
- Nothing cross-checks the criteria, the policy library and the presentation layer automatically. After a change, verify against the PDF in `official/`.
