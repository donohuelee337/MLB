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
| Schedule ↔ FD join | `MLBMatchKeys.js` — normalized labels + abbr→Odds team names for fewer `fd_k_miss` rows |
| Pitcher K slate | `MLBPitcherKQueue.js` → **`📋 Pitcher_K_Queue`** (+ **`throws`** R/L from statsapi `/people/{id}`) |
| Pitcher walks slate | `MLBPitcherWalkQueue.js` → **`📋 Pitcher_BB_Queue`** (`pitcher_walks` main line) |
| Poisson + EV (K) | `MLBPitcherKBetCard.js` → **`🎰 Pitcher_K_Card`** (blended K/9 via **`K9_BLEND_L7_WEIGHT`**) |
| Poisson + EV (BB) | `MLBPitcherWalkBetCard.js` → **`🎰 Pitcher_BB_Card`** (blended BB9; **`BB9_BLEND_L3_WEIGHT`** optional) |
| Bet card | `MLBBetCard.js` → **`🃏 MLB_Bet_Card`** — **K + walks**, ranked EV (optional **`MIN_EV_BET_CARD`** floor) |
| Results log + grading | `MLBResultsLog.js` / **`📋 MLB_Results_Log`**; `MLBResultsGrader.js` — menu grader; runs at start of each ball window |
| CLV proxy (close line) | **`close_line` / `close_odds` / `clv_note`** — `mlbBackfillResultsLogClosingK_` on **FINAL** (after odds) + menu **📈 Backfill closing K** (join tries log **Game** then schedule **`gamePk`** matchup) |
| Umpire → λ (optional) | **`⚙️ HP_UMP_LAMBDA_MULT`** — scales 🎰 λ when **`hp_umpire`** present (default **1** = off) |
| Pipeline observability | `MLBPipelineLog.js` → **`⚾ Pipeline_Log`** (funnel, warnings, near-miss append, bet-card game coverage) |
| Multi-window | **`🌅 Morning`**, **`🌤 Midday`** (skips injury HTTP), **`🔒 Final`** — `runMLBBallWindow_` in `PipelineMenu.js` |
| Docs / clasp | `docs/*`, `.clasp.json` |

## Orchestrator (truth source)

**Menu:** **`⚾ MLB-BOIZ`** (`PipelineMenu.js`).

**`runMLBBallWindow_(windowTag, skipInjuriesFetch)`** — order of work:

1. `gradeMLBPendingResults_` (best-effort)
2. `mlbResetPitchGameLogFetchCache_`
3. Config (`buildConfigTab`)
4. MLB injuries (ESPN) — **skipped when Midday**
5. MLB schedule (statsapi)
6. Pitcher game logs (statsapi)
7. FanDuel MLB odds
8. Slate board (join)
9. Pitcher K queue
10. Pitcher K card
11. Pitcher BB queue
12. Pitcher BB card
13. MLB Bet Card
14. `mlbAppendPitcherKNearMisses_` (K + BB injury near-misses) → `snapshotMLBBetCardToLog` (if bet card OK) → **`mlbBackfillResultsLogClosingK_` when `FINAL` + odds OK** → `mlbAppendBetCardPipelineCoverage_` → step warnings → `writePipelineLogTab_` → toast; activates **`🃏 MLB_Bet_Card`**

One-off menu items mirror those stages (e.g. **`📋 Pitcher BB queue only`**, **`🎰 Pitcher BB card only`**, **`📋 Open Pipeline Log`**).

## Not built yet (still fair gaps vs NBA / spec)

- Broader **StatEngine** beyond pitcher-K Poisson; **v20-style sim** gates
- Full multi-market breadth if you want NBA-style `Game_Logs` for every prop type
- **Savant** ump/catcher framing, **ABS** team signals, opponent platoon from team stats API — see `docs/2026-04-11-mlb-pitcher-k-pipeline-design.md` (not wired; park table is a small static v1 in `MLBParkFactors.js` only)

## Suggested next product steps

1. Tune **`K9_BLEND_L7_WEIGHT`** / **`MIN_EV_BET_CARD`** on **`⚙️ Config`** after a few slates (re-run **0. Build Config tab** if those keys are missing).
2. Extend **`MLB_ABBR_ODDS_TEAM_ALTERNATES`** / Odds name map in `MLBMatchKeys.js` when a team rebrands or the Odds API changes strings.
3. Pick one backlog theme: CLV, sim layer, or non-K markets.

## Single repo (formerly two folders)

The old **`mlb-pitcher-k`** folder was merged into **`mlb-boiz`** (2026-04-18). Use **one** Google Sheet + the `scriptId` in this repo’s `.clasp.json`. Pitcher-K **design spec:** `docs/2026-04-11-mlb-pitcher-k-pipeline-design.md`.
