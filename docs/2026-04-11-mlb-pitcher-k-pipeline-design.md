# MLB Pitcher Strikeouts — Pipeline Design Spec

**Date:** 2026-04-11  
**Status:** Draft  
**Scope:** New Google Sheets + Apps Script project (separate from NBA AI-BOIZ). Single daily run. **Pitcher strikeout props only** for v1. Pre-game pipeline through bet card; grading is a follow-up. No Deep Dive / Claude step in v1.

**Related research (this repo):** `docs/superpowers/research/2026-04-11-mlb-research-briefing.md`, `docs/superpowers/research/2026-04-11-mlb-api-data-research.md`, `docs/superpowers/research/2026-04-11-abs-system-research.md`

---

## 1. Goals

### Primary goal

Produce a small, defensible **daily bet card** for FanDuel pitcher strikeout markets using:

- Current-season projections (no multi-year Marcel in v1)
- Poisson-based stat layer (K as a count process)
- Context signals: **home-plate umpire**, **catcher framing + challenge skill**, **platoon (team vs pitcher hand)**, **ABS-related team metrics**
- Pipeline observability (funnel, warnings, optional game coverage)

### Non-goals (v1)

- Other MLB prop types, game totals, or SGP construction
- Deep Dive / LLM validation
- Automated grading / CLV (reserve data hooks only)
- Multi-window runs (morning / midday / final)

### Architecture decision

**Clean-sheet rebuild (Approach B):** New files and tabs modeled on proven AI-BOIZ pipeline stages (Config → Ingest → Slate → Stats → Sim → Card → Pipeline Log), without copying NBA-specific tangled modules wholesale.

---

## 2. Pipeline overview

One menu action runs the full chain in order:

```
Ingest → Slate → Stats → Sim → Bet Card → Pipeline Log flush
```

**Orchestrator:** `MLBMenu.js` — `runDailyMlbPipeline()` resets the log, calls each stage, writes `⚾ Pipeline_Log`, shows a completion toast.

**First run:** Workspace bootstrap creates missing tabs, headers, and named ranges (mirror the NBA `buildWorkspace` idea).

---

## 3. File layout (one responsibility each)

| File | Responsibility |
|------|----------------|
| `MLBConfig.js` | `⚾ Config` sheet, `getConfig()`, static `MLB_TEAM_MAP`, hard-coded `PARK_FACTORS` (annual code update), shared constants |
| `MLBIngest.js` | Odds, injuries, schedule/probables, officials, Savant CSV fetches, team platoon inputs; writes ingest tabs |
| `MLBSlate.js` | Build `⚾ Slate_Queue` from FD + schedule + in-memory signal maps; name matching; injury skips |
| `MLBStats.js` | MLB Stats API game logs, λ and StatEngine outputs, `⚾ Pitchers` audit tab |
| `MLBSim.js` | Anchored mean, context scoring, `⚾ Sim_Engine` / `SIM_RESULTS` |
| `MLBBetCard.js` | Floors, caps, greedy selection → `⚾ Bet_Card` |
| `MLBPipelineLog.js` | Same pattern as NBA: `resetPipelineLog_`, `logStep_`, `logGameCoverage_`, `addPipelineWarning_`, `writePipelineLogTab_`, toast builder |
| `MLBMenu.js` | `onOpen` menu + `runDailyMlbPipeline()` only |

**Stat math:** Implement Poisson CDF, EV, CV, etc. either in `MLBStats.js` or a tiny `MLBStatMath.js` if we want strict separation; v1 preference is **keep distribution math colocated with `MLBStats.js`** unless the file grows past a reasonable size.

---

## 4. Sheets and named ranges

| Tab | Purpose |
|-----|---------|
| `⚾ Config` | Key/value config; named range `CONFIG` (keys col A, values col B) |
| `⚾ FD_Odds` | Raw FanDuel K lines; `FD_ODDS_DATA` |
| `⚾ Injury_Report` | ESPN MLB injuries; `INJURY_DATA` |
| `⚾ Schedule` | One row per game: `gamePk`, matchup label, start time, away/home team ids, probable pitcher ids/names, **HP umpire** (when resolved), flags |
| `⚾ Slate_Queue` | Candidates + signal columns + stat columns; `SLATE_DATA` / `SLATE_QUEUE` (same range pattern as NBA if convenient) |
| `⚾ Pitchers` | Audit row per pitcher-game: ids, sample sizes, K/9, projected IP, λ, factors applied |
| `⚾ Sim_Engine` | Scored candidates; `SIM_RESULTS` |
| `⚾ Bet_Card` | Final plays |
| `⚾ Pipeline_Log` | Funnel, game coverage, near misses, warnings |

Optional **debug dump** tab for raw Savant CSV rows: off by default, gated by a Config flag `SAVANT_DEBUG_TAB` = false.

---

## 5. Config keys (initial set)

| Category | Keys |
|----------|------|
| API | `ODDS_API_KEY` |
| Projection weights | `WEIGHT_L7`, `WEIGHT_L15`, `WEIGHT_L30`, `WEIGHT_SEASON` |
| IP | `MAX_PROJECTED_IP` |
| Anchoring | `ANCHOR_WEIGHT` |
| ABS blanket | `ABS_K_FACTOR` (e.g. 0.98), optional `ABS_BB_FACTOR` reserved for future BB props |
| Signal weights / caps | `UMPIRE_WEIGHT`, `UMPIRE_ABS_DAMPING` (~0.65), `FRAMING_WEIGHT`, `CHALLENGE_WEIGHT`, `ABS_TEAM_WEIGHT`, per-signal max absolute contribution |
| Bet card | `MIN_ODDS`, `MAX_ODDS`, `MIN_EDGE_PCT`, `MIN_PWIN_GAP`, `MAX_BET_CARD`, `MAX_PLAYS_PER_GAME`, `MAX_LINES_PER_PITCHER`, `KELLY_FRACTION` |
| Rookies / thin samples | `MIN_STARTS_FOR_FULL_WEIGHT`, league prior parameters for K rate shrinkage (documented numerics in implementation plan) |
| Debug | `SAVANT_DEBUG_TAB` |

---

## 6. Static data (no manual refresh)

| Data | Source | Update mechanism |
|------|--------|------------------|
| Team ids / abbreviations | `MLB_TEAM_MAP` in code | Change only when MLB expands/relocates |
| Park K (and related) factors | `PARK_FACTORS` in code | Once per season or when FanGraphs-style reference values change |
| Umpire environment | Baseball Savant (+ MLB IDs from feed when available) | **Every run** via `UrlFetchApp` + CSV parse; join by umpire id or normalized name with **warning** on ambiguity |
| Catcher framing + ABS challenge | Savant leaderboards CSV | **Every run** |
| IL / injuries | ESPN JSON | **Every run** |

**Savant URL patterns** are validated at implementation time and documented in code comments; if a leaderboard shape changes, ingest logs a warning and falls back to **neutral** signal values (0 contribution), never silent wrong numbers.

---

## 7. MLBIngest.js — Stages and I/O

**Order:**

1. **FanDuel pitcher K odds** — The Odds API `baseball_mlb`, markets `pitcher_strikeouts`, `pitcher_strikeouts_alternate`. Resolve “today” in **Eastern** calendar date. Per-event fetches. Write `⚾ FD_Odds` + `FD_ODDS_DATA`.

2. **ESPN MLB injuries** — Same host/path pattern as NBA injuries, baseball slug. Write `⚾ Injury_Report` + `INJURY_DATA`.

3. **Schedule + probable pitchers** — `GET /api/v1/schedule?sportId=1&date={yyyy-mm-dd}&hydrate=probablePitcher,team`. Write `⚾ Schedule` core columns.

4. **Home plate umpires** — For each `gamePk`, fetch officials from **`/game/{gamePk}/feed/live`** or **`/game/{gamePk}/boxscore`** (implementation picks the more reliable pre-game source; **documented fallback chain**). Write umpire columns on `⚾ Schedule`.

5. **Savant umpire metrics** — CSV fetch, join to today’s HP umpires. In-memory map (+ optional debug tab).

6. **Savant catcher framing + ABS** — CSV fetch(es). **Catcher resolution for the battery:**  
   - **(a)** If official lineup exposes starting catcher for that game, use it.  
   - **(b)** Else **fallback:** last catcher who caught this pitcher (from recent game logs via Stats API), with **Pipeline Log warning**.  
   - **(c)** If still unknown: **neutral** catcher signal (0) + warning.

7. **Team platoon context** — For each probable starter, opponent team + pitcher handedness (L/R from `people` or roster). Opponent **team** K% vs RHP/LHP vs league baseline from Stats API team stats. Store **in memory** for stats stage (optional narrow dump later if needed).

**Errors:** Retry with backoff on 429/5xx where practical. Non-fatal failures → neutral signals + `addPipelineWarning_`.

---

## 8. MLBSlate.js — Slate queue

**Grain:** One row per **(pitcher, game, market key, line)** so main and alt lines remain distinct for EV; bet card enforces per-pitcher limits.

**Steps:**

- Load FD rows; parse player/team string; match to `⚾ Schedule` probable starters using **normalized names** and team context. **Unmatched** FD rows → warning, dropped.
- Attach `gamePk`, matchup, start time, opponent, pitcher throw hand.
- Apply **injury gate:** if pitcher is out / IL (per ESPN + optional schedule flags), **drop** row (Config: default drop).
- Attach numeric **signal inputs** (not final sim score): umpire delta, framing, challenge, ABS team metrics, platoon delta — exact column layout fixed in implementation plan.

**Pipeline Log:** `logStep_('Slate Queue', fdRowCount, slateRowCount)` plus warnings for unmatched names and fallback catcher usage.

---

## 9. MLBStats.js — λ, Poisson, audit tab

### Data

- `people/{id}/stats?stats=gameLog&group=pitching&season=2026` (season from Config constant `MLB_SEASON` = 2026).

### Projection

- **Weighted K/9** from logs using Config weights across L7 / L15 / L30 / season-to-date buckets.
- **Projected IP:** mean IP per start this season, capped by `MAX_PROJECTED_IP`.
- **λ (expected K for Poisson):**  
  `λ = (weighted K/9) * (projected IP / 9)`  
  then apply multipliers (in this order; exact formulas in implementation plan):

  1. **Park K factor** (from `PARK_FACTORS` for home ballpark)  
  2. **Platoon:** opponent team K% vs pitcher hand vs league → documented multiplier, default 1.0 if missing  
  3. **`ABS_K_FACTOR`** blanket adjustment

### Double-counting rule (normative)

| Component | Where it affects the model |
|-----------|----------------------------|
| Talent (logs), park K, platoon (team vs hand), blanket ABS | **λ only** |
| Umpire zone, catcher framing + challenge, ABS team challenge quality / K-flip environment | **Sim context score only** — **not** second multipliers on λ |

### Stat layer

- **Poisson** distribution for Over/Under vs FD line (document half-line handling; K props typically .5 increments).
- Outputs written to `⚾ Slate_Queue`: P(Win), z-score, EV%, CV category, fair line, edge% (names aligned with NBA semantics for future tooling).

### Thin samples

- Fewer than `MIN_STARTS_FOR_FULL_WEIGHT` starts: blend pitcher K rate toward **league prior** with documented shrinkage; log warning.

### `⚾ Pitchers` tab

One row per pitcher-game: mlbId, name, team, starts count, weighted K/9, projected IP, λ, park/platoon/ABS factors applied.

**Pipeline Log:** `logStep_('Slate Stats', …)` with warnings for thin samples and API failures.

---

## 10. MLBSim.js — Anchored mean and context score

**Inputs:** `SLATE_DATA` including FD line, side, odds, λ, stat outputs, signal columns.

**Anchored mean:**

- `model_mean = λ` (already includes park, platoon, blanket ABS).  
- `anchoredMean = FD_Line * (1 - ANCHOR_WEIGHT) + model_mean * ANCHOR_WEIGHT`.

**Probability:** Recompute **pWin vs FD line** from **Poisson using `anchoredMean`** so sim and card share one coherent probability story (StatEngine row may still hold unanchored diagnostics if useful — document which column is authoritative for the card).

**Context score (bounded):**

- **Umpire:** contribution × `UMPIRE_WEIGHT` × `UMPIRE_ABS_DAMPING`  
- **Catcher:** framing × `FRAMING_WEIGHT` + challenge skill × `CHALLENGE_WEIGHT`  
- **ABS team:** small bounded term × `ABS_TEAM_WEIGHT`  
- Each term has a **config cap** on absolute magnitude.

**Ordering / tiers:**

- **Primary sort:** edge% (or EV%, same ordering rule as implementation locks).  
- **Secondary:** context score.  
- **Tiers:** lightweight labels (`EDGE`, `MIXED`, `SKIP`) from Config thresholds.

**Correlation tag:** `CORR_DUP` when same pitcher/game has multiple lines surviving filters.

**Outputs:** `⚾ Sim_Engine` + `SIM_RESULTS`.

**Pipeline Log:** `logStep_('Sim Engine', …)`; optional `logNearMiss_` deferred to bet card if preferred for parity with NBA.

---

## 11. MLBBetCard.js — Selection

**Gates:**

- Odds in `[MIN_ODDS, MAX_ODDS]`  
- `MIN_EDGE_PCT`, `MIN_PWIN_GAP`  
- CV rules for Over vs Under (mirror NBA spirit: stricter on high-volatility Overs; exact thresholds in implementation plan)

**Caps:**

- `MAX_LINES_PER_PITCHER` default **1** (best edge line kept)  
- `MAX_PLAYS_PER_GAME` default **2**  
- Stop at `MAX_BET_CARD`

**Algorithm:** Greedy sort by **edge%** desc, then **context score**, fill until caps satisfied.

**Grading hooks (no grading code in v1):** Persist `gamePk`, pitcher `playerId`, market key, side, line, American price, ISO **decision timestamp**, and `run_date` string on each card row. Document that **line snapshots** (morning/midday/final analog) will attach when grading ships.

---

## 12. MLBPipelineLog.js

Match NBA semantics: funnel rows per stage, warnings section, optional per-game coverage keyed by matchup label or `gamePk`, near-miss table if implemented.

**Window label:** `'DAILY'` (single run type for v1).

---

## 13. Testing and validation (pre-ship)

- Dry run on a day with partial slate: verify no script errors, Pipeline Log shows sensible counts.  
- Spot-check 2–3 pitchers: λ, anchored mean, pWin vs FanDuel line manually.  
- Force missing Savant CSV: verify neutral signals + warnings, no crash.  
- Confirm unmatched FD names appear in warnings.

---

## 14. Self-review checklist

| Check | Result |
|-------|--------|
| Placeholders | Numeric defaults live in Config + implementation plan; no “TBD” sections remain. |
| Internal consistency | λ vs sim-only signal split is explicit; anchoring reconciles pWin in sim. |
| Scope | Single prop type, single daily run, separate spreadsheet — bounded. |
| Ambiguity | “Today” = America/New_York calendar date; official tie-break for umpire fetch order documented in §7. |

---

## 15. Next step after approval

Translate this spec into `docs/superpowers/plans/2026-04-11-mlb-pitcher-k-pipeline.md` (implementation plan: file-by-file tasks, clasp project setup, tab headers, named ranges, verification commands) per the writing-plans workflow. **No production code until that plan exists.**
