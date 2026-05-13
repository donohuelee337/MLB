# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**MLB-BOIZ** is a Google Apps Script + Google Sheets betting analysis pipeline for MLB prop markets. It runs entirely inside a Google Sheet via a script menu — there is no Node server, no web app, no npm. All code is deployed via `clasp` and executed in the GAS V8 runtime.

## Deploy & development workflow

```bash
# Push local JS files to the bound Google Apps Script project
clasp push

# Login (first time or after token expiry)
clasp login

# Open the script editor in browser
clasp open
```

There are no tests, no build step, and no linter. The only way to run code is inside the Google Sheet via the **⚾ MLB-BOIZ** menu after `clasp push`.

**Script properties required** (set via Apps Script UI → Project Settings → Script properties):
- `ODDS_API_KEY` — key from the-odds-api.com
- `STATSAPI_BASE` — optional override (default: `https://statsapi.mlb.com/api/v1`)

## Pipeline architecture

The pipeline has a single orchestrator: `runMLBBallWindow_(windowTag, skipInjuriesFetch)` in `PipelineMenu.js`. Three menu windows call it:

- **Morning** — full refresh (injuries + schedule + odds + all model cards)
- **Midday** — skips injury HTTP fetch, re-runs everything else
- **Final** — full refresh + snapshot to Results Log + closing line backfill

The pipeline runs a linear sequence of `step(name, fn)` calls. Each step catches its own errors so one failure doesn't abort the run. Step outcomes are logged to `⚾ Pipeline_Log` after all steps complete.

### Step order

1. Grade pending results (best-effort, `MLBResultsGrader.js`)
2. Auto-advance `SLATE_DATE` if NY slate is complete
3. Reset all in-memory caches
4. Config rebuild + validation
5. Injuries (ESPN API) — skipped in Midday
6. Schedule (statsapi)
7. Pitcher game logs (statsapi)
8. FanDuel odds (The Odds API)
9. Savant ABS ingest (optional CSV)
10. Slate board join
11–22. Pitcher K → Pitcher Outs → Pitcher Walks → Pitcher HA → Batter TB → Batter Hits → Batter HR (each: queue then card)
23. Merge all cards → `🃏 MLB_Bet_Card`
24. Snapshot to Results Log, near-miss append, pipeline coverage, write Pipeline Log tab

## Key files and responsibilities

| File | Role |
|------|------|
| `PipelineMenu.js` | `onOpen()` menu wiring; `runMLBBallWindow_` orchestrator |
| `Config.js` | `buildConfigTab()`, `getConfig()`, `MLB_TEAM_ABBREV` map (id→abbr), `mlbTeamIdFromAbbr_`, `validateMlbPipelineConfig_` |
| `MLBMatchKeys.js` | Schedule ↔ FanDuel join: `mlbCandidateGameKeys_`, `mlbBuildPersonPropOddsIndexMerged_`, `mlbOddsPointMapForPerson_`, team name alternates map |
| `MLBPitcherKBetCard.js` | Poisson λ model for pitcher Ks; blends L3 K/9 and season K/9 |
| `MLBPitcherSecondaryMarkets.js` | Pitcher Outs, Walks, Hits Allowed queue + card (parallel structure to K market) |
| `MLBBatterTBBetCard.js` | Batter TB, Hits, HR cards (same Poisson + EV pattern) |
| `MLBBetCard.js` | Merges all model cards, applies odds band filter, per-game cap (2 plays), total cap (48 plays) |
| `MLBResultsLog.js` | Upsert by `bet_key`; freezes open_line/open_odds on first write |
| `MLBResultsGrader.js` | Fetches statsapi boxscores; grades K/TB/Hits vs line |
| `MLBPipelineLog.js` | Funnel, warnings, near-misses, game coverage → `⚾ Pipeline_Log` tab |
| `MLBSavantIngest.js` | Optional CSV fetch for per-team ABS K multipliers |

## Modeling pattern (Queue → Card)

Every market follows the same two-file pattern:

1. **Queue** — joins schedule × FD odds × game logs. Produces a staging tab (e.g. `📋 Pitcher_K_Queue`) with all model inputs.
2. **Card** — reads the queue tab, computes Poisson λ, calculates win probability and EV per Over/Under line, writes a card tab (e.g. `🎰 Pitcher_K_Card`).

The Poisson λ for pitcher K:
```
λ = blend(L3_K/9, season_K/9)
  × park_factor
  × hp_ump_mult
  × abs_team_mult        (per-team from Savant CSV or ABS_K_LAMBDA_MULT fallback)
  × opp_k_ratio          (when OPP_K_RATE_LAMBDA_STRENGTH > 0)
```

Batter TB uses the same structure: `blend(L7_avg_tb, season_avg_tb) × park_tb_factor`.

## Schedule ↔ FD odds join (critical complexity)

`MLBMatchKeys.js` handles the mismatch between statsapi game labels and The Odds API team names. The join key is `normalizedGame||normalizedPlayerName`. The `mlbCandidateGameKeys_` function generates multiple candidate strings (statsapi label + all `MLB_ABBR_ODDS_TEAM_ALTERNATES` variants) to handle team name drift (e.g. Oakland A's → Las Vegas Athletics). When adding new market types, use `mlbBuildPersonPropOddsIndexMerged_(ss, mainKey, altKey)` to merge standard + alternate FanDuel market keys into one index.

## Config tab

The `⚙️ Config` tab is rebuilt by `buildConfigTab()` at the start of every pipeline window. Config is read by `getConfig()` which reads the `CONFIG` named range (key–value pairs, columns A–B). Key tuning parameters:

- `K9_BLEND_L7_WEIGHT` / `TB_BLEND_RECENT_WEIGHT` — blend weight (0–1) for recent vs season stats
- `OPP_K_RATE_LAMBDA_STRENGTH` — default 0 (off); scales opponent K% into λ when > 0
- `CARD_USE_NBA_ODDS_BAND` / `CARD_SINGLES_MIN_AMERICAN` / `CARD_SINGLES_MAX_AMERICAN` — odds band filter
- `MLB_FORCE_PITCHER_WALKS_BET_CARD` — walks bypass odds band and per-game cap
- `SLATE_AUTO_ADVANCE_WHEN_COMPLETE` — auto-advances `SLATE_DATE` to tomorrow when all games are final

When adding a new config key, add it inside `buildConfigTab()` (using the `row_()` helper) — it will be written to the sheet on next run.

## In-memory caches

Several modules maintain module-level cache objects reset at the start of each window run:
- `mlbResetPitchGameLogFetchCache_()` — pitcher game log HTTP results
- `mlbResetPitchHandCache_()` — pitcher handedness (L/R)
- `mlbResetTeamHittingSeasonCache_()` — opponent team SO/PA stats
- `mlbResetSavantAbsCache_()` — Savant ABS team multipliers
- `mlbResetBatterTbCaches_()` — batter TB log results

Always call the relevant reset function in `runMLBBallWindow_` when adding a new cached module.

## GAS runtime constraints

- **No `require`/`import`** — all JS files are concatenated by GAS; all top-level functions and `const` objects are global.
- **No `async/await`** — use synchronous `UrlFetchApp.fetch()` for HTTP.
- **6-minute execution limit** — the full Morning window runs ~2–3 min; keep individual steps lean. Use `Utilities.sleep()` only when rate-limiting requires it.
- **Sheet writes are expensive** — batch reads (`getRange().getValues()`) and batch writes (`setValues()`) rather than cell-by-cell.
- Tab names are constants defined at the top of their respective files (e.g. `MLB_PITCHER_K_QUEUE_TAB`, `MLB_BET_CARD_TAB`).
