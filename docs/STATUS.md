# MLB-BOIZ — where we are (vs NBA AI-BOIZ)

**Canonical repo:** `Documents\Cursor\mlb-boiz` — use this folder in Cursor and for `clasp push`.

## Done (MVP+, AI-BOIZ spirit)

| AI-BOIZ idea | MLB-BOIZ today |
|--------------|----------------|
| Config + slate date | `Config.js`, **`⚙️ Config`**, `SLATE_DATE`, menu **`📆 Set SLATE_DATE to tomorrow (NY) + Morning`** |
| Odds pull (The Odds API) | `FetchMLBOdds.js` → **`✅ FanDuel_MLB_Odds`**, `baseball_mlb` + FanDuel |
| Injury intel | `FetchMLBInjuries.js` → **`🚑 MLB_Injury_Report`**, `INJURY_DATA_MLB` |
| Schedule / context | `MLBSchedule.js` → **`📅 MLB_Schedule`** (statsapi + probables + **home plate umpire** via `officials` hydrate) |
| Pitcher game logs (Stats API) | `MLBPitcherGameLogs.js` → **`📒 Pitcher_Game_Logs`** (warms cache for queue) |
| Slate / line density | `MLBSlateBoard.js` → **`🎯 MLB_Slate_Board`** (join uses flexible game keys vs FD labels) |
| Schedule ↔ FD join | `MLBMatchKeys.js` — normalized labels + abbr→Odds team names + **`MLB_ABBR_ODDS_TEAM_ALTERNATES`** for label drift |
| Pitcher K slate | `MLBPitcherKQueue.js` → **`📋 Pitcher_K_Queue`** (`throws`, **`opp_abbr`**, **`opp_k_pa`** season SO/PA, **`opp_k_pa_vs`** vs same-handed pitching via statsapi `/stats` aggregate) |
| Opponent K context | `MLBTeamHitting.js` — cached team hitting; `mlbTeamIdFromAbbr_` in `Config.js` |
| Poisson + EV (K) | `MLBPitcherKBetCard.js` → **`🎰 Pitcher_K_Card`** (K9 blend, park, L/R, **opp K%** prefers vs-hand vs **`LEAGUE_HITTING_K_PA`** when **`OPP_K_RATE_LAMBDA_STRENGTH`** is non-zero, **`ABS_K_LAMBDA_MULT`**, HP ump) |
| Bet card | `MLBBetCard.js` → **`🃏 MLB_Bet_Card`** (optional **`MIN_EV_BET_CARD`** floor) |
| Results log + grading | `MLBResultsLog.js` / **`📋 MLB_Results_Log`**; `MLBResultsGrader.js` — menu grader; runs at start of each ball window |
| CLV proxy (close line) | **`close_line` / `close_odds` / `clv_note`** (line move + **implied Δpp** vs open when odds parse) — `mlbBackfillResultsLogClosingK_` on **FINAL** + menu **📈 Backfill closing K** |
| Umpire → λ (optional) | **`⚙️ HP_UMP_LAMBDA_MULT`** — scales 🎰 λ when **`hp_umpire`** present (default **1** = off) |
| Pipeline observability | `MLBPipelineLog.js` → **`⚾ Pipeline_Log`** (funnel, warnings, near-miss append, bet-card game coverage) |
| Savant hook (optional) | `MLBSavantIngest.js` — **`SAVANT_INGEST_ENABLED`** / **`SAVANT_ABS_CSV_URL`**; best-effort URL probe after odds (**`PipelineMenu.js`**) |
| Multi-window | **`🌅 Morning`**, **`🌤 Midday`** (skips injury HTTP), **`🔒 Final`** — `runMLBBallWindow_` in `PipelineMenu.js` |
| Docs / clasp | `docs/*`, `.clasp.json` |

## Orchestrator (truth source)

**Menu:** **`⚾ MLB-BOIZ`** (`PipelineMenu.js`).

**`runMLBBallWindow_(windowTag, skipInjuriesFetch)`** — order of work:

1. `gradeMLBPendingResults_` (best-effort)
2. `mlbResetPitchGameLogFetchCache_` + `mlbResetPitchHandCache_` + **`mlbResetTeamHittingSeasonCache_`**
3. Config (`buildConfigTab`)
4. MLB injuries (ESPN) — **skipped when Midday**
5. MLB schedule (statsapi)
6. Pitcher game logs (statsapi)
7. FanDuel MLB odds
8. **Savant ingest (optional)** — URL probe / warnings only unless wired further
9. Slate board (join)
10. Pitcher K queue
11. Pitcher K card
12. MLB Bet Card
13. `mlbAppendPitcherKNearMisses_` → `snapshotMLBBetCardToLog` (if bet card OK) → **`mlbBackfillResultsLogClosingK_` when `FINAL` + odds OK** → `mlbAppendBetCardPipelineCoverage_` → step warnings → `writePipelineLogTab_` → toast; activates **`🃏 MLB_Bet_Card`**

One-off menu items mirror those stages (e.g. **`📒 Pitcher game logs only`**, **`🎰 Pitcher K card only (Poisson + EV)`**, **`📋 Open Pipeline Log`**).

## Not built yet (still fair gaps vs NBA / spec)

- Broader **StatEngine** beyond pitcher-K Poisson; **v20-style sim** gates
- Full multi-market breadth if you want NBA-style `Game_Logs` for every prop type
- **Savant** parsed into team maps (ump K env, catcher framing, **ABS** team factors) — hook exists; **`ABS_K_LAMBDA_MULT`** still manual until CSV/schema is defined
- **True league priors** split by vs L / vs R for **`LEAGUE_HITTING_K_PA`** (today one prior vs both platoon and season totals)

## Suggested next product steps

1. Tune **`K9_BLEND_L7_WEIGHT`**, **`MIN_EV_BET_CARD`**, **`OPP_K_RATE_LAMBDA_STRENGTH`**, **`LEAGUE_HITTING_K_PA`** after several slates (re-run **0. Build Config tab** when keys are missing).
2. When ready to experiment: set **`SAVANT_INGEST_ENABLED`** true and a stable **`SAVANT_ABS_CSV_URL`**, then teach `MLBSavantIngest.js` to parse and join **`ABS_K_LAMBDA_MULT`** (or a new column) by team id.
3. Pick one larger theme: **StatEngine/sim**, **non-K markets**, or **split league priors** for platoon λ.

## Single repo (formerly two folders)

The old **`mlb-pitcher-k`** folder was merged into **`mlb-boiz`** (2026-04-18). Use **one** Google Sheet + the `scriptId` in this repo’s `.clasp.json`. Pitcher-K **design spec:** `docs/2026-04-11-mlb-pitcher-k-pipeline-design.md`.
