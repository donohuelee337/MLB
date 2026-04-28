# MLB-BOIZ — where we are (vs NBA AI-BOIZ)

**Canonical repo:** `Documents\Cursor\MLB` — use this folder in Cursor and for `clasp push`.

## Done (MVP+, AI-BOIZ spirit)

| AI-BOIZ idea | MLB-BOIZ today |
|--------------|----------------|
| Config + slate date | `Config.js`, **`⚙️ Config`**, `SLATE_DATE`, menu **`📆 Set SLATE_DATE to tomorrow (NY) + Morning`** |
| Odds pull (The Odds API) | `FetchMLBOdds.js` → **`✅ FanDuel_MLB_Odds`**, `baseball_mlb` + FanDuel |
| Injury intel | `FetchMLBInjuries.js` → **`🚑 MLB_Injury_Report`**, `INJURY_DATA_MLB` |
| Schedule / context | `MLBSchedule.js` → **`📅 MLB_Schedule`** (statsapi + probables + **home plate umpire** via `officials` hydrate) |
| Pitcher game logs (Stats API) | `MLBPitcherGameLogs.js` → **`📒 Pitcher_Game_Logs`** (warms cache for queue) |
| Slate / line density | `MLBSlateBoard.js` → **`🎯 MLB_Slate_Board`** (join uses flexible game keys vs FD labels) |
| Schedule ↔ FD join | `MLBMatchKeys.js` — normalized labels + abbr→Odds team names + **`MLB_ABBR_ODDS_TEAM_ALTERNATES`**; `mlbBuildPersonPropOddsIndexMerged_` for alternate FD market fallback |
| Pitcher K | `MLBPitcherKQueue.js` → **`📋 Pitcher_K_Queue`** (`throws`, `opp_abbr`, **`opp_k_pa`** season SO/PA, **`opp_k_pa_vs`** vs same-hand via statsapi); `MLBPitcherKBetCard.js` → **`🎰 Pitcher_K_Card`** (K9 blend, park, L/R, opp K%, **`ABS_K_LAMBDA_MULT`**, per-pitcher ABS from **`SAVANT_PITCHER_ABS_CSV_URL`**, HP ump) |
| Pitcher outs / walks / HA | `MLBPitcherSecondaryMarkets.js` → **`🔩 Pitcher_Outs_Card`**, **`🪶 Pitcher_BB_Card`**, **`🧱 Pitcher_HA_Card`** — shared queue + card body; ABS shadow mult inverted into walks (1/mult) + HA (50%); alternate FD market fallback for walks + HA |
| Batter TB / Hits / HR | `MLBBatterTBQueue.js` + `MLBBatterTBBetCard.js` → **`🎲 Batter_TB_Card`**, **`🎯 Batter_Hits_Card`**, **`💥 Batter_HR_Card`** — shared queue + card body; L7 + season blend per batter; park TB env |
| Opponent K context | `MLBTeamHitting.js` — cached team hitting; `mlbTeamIdFromAbbr_` in `Config.js` |
| Multi-market bet card | `MLBBetCard.js` → **`🃏 MLB_Bet_Card`** — merges all 7 model cards, NBA-style odds band (**`CARD_USE_NBA_ODDS_BAND`**, **`CARD_SINGLES_MIN/MAX_AMERICAN`**), **confidence tiers** (A+ ≥5% EV / A ≥3% / B ≥1% / C >0%), **Kelly sizing** (**`KELLY_BANKROLL`**, **`KELLY_FRACTION`**, **`KELLY_MAX_BET_PCT`**), forced BB slot, game-grouped layout, honorable mentions, debug reject tab (**`🧪 MLB_Bet_Card_Debug`**) |
| Results log + grading | `MLBResultsLog.js` / **`📋 MLB_Results_Log`**; `MLBResultsGrader.js` — multi-market grader (K, outs, walks, HA, TB, hits, HR); runs at start of each ball window |
| CLV proxy (all markets) | **`close_line` / `close_odds` / `clv_note`** — `mlbBackfillResultsLogClosingK_` now covers all 7 markets; FD index cached per market to avoid redundant fetches; runs on **FINAL** + menu **📈 Backfill closing K** |
| Umpire → λ (optional) | **`⚙️ HP_UMP_LAMBDA_MULT`** — scales 🎰 λ when `hp_umpire` present (default **1** = off) |
| Savant / ABS CSV (optional) | `MLBSavantIngest.js` — team CSV (**`SAVANT_ABS_CSV_URL`**, `team_id,abs_k_mult`) + pitcher CSV (**`SAVANT_PITCHER_ABS_CSV_URL`**, `pitcher_id,abs_k_mult`); 🎰 K uses per-pitcher → per-team → `ABS_K_LAMBDA_MULT` fallback; walks/HA use inverted per-pitcher mult |
| League priors (platoon) | **`LEAGUE_HITTING_K_PA`** + **`LEAGUE_HITTING_K_PA_VS_L/R`** for OPP_K ratio when `opp_k_pa_vs` present |
| Pipeline observability | `MLBPipelineLog.js` → **`⚾ Pipeline_Log`** — funnel, warnings, near-misses for all 7 markets (`mlbAppendAllMarketNearMisses_`), game coverage |
| Auto slate-date advance | `ensureMlbPipelineSlateDateAdvanced_` — advances `SLATE_DATE` to tomorrow NY when all today's games are final before midnight |
| Multi-window | **`🌅 Morning`**, **`🌤 Midday`** (skips injury HTTP), **`🔒 Final`** — `runMLBBallWindow_` in `PipelineMenu.js` |

## Orchestrator (truth source)

**Menu:** **`⚾ MLB-BOIZ`** (`PipelineMenu.js`).

**`runMLBBallWindow_(windowTag, skipInjuriesFetch)`** — order of work:

1. `gradeMLBPendingResults_` (best-effort)
2. Reset caches: pitch game logs, pitch hand, team hitting, Savant ABS, batter TB
3. Config (`buildConfigTab` + `validateMlbPipelineConfig_`)
4. MLB injuries (ESPN) — skipped when Midday
5. MLB schedule (statsapi)
6. Pitcher game logs (statsapi)
7. FanDuel MLB odds
8. Savant ingest (optional — team + pitcher ABS CSVs)
9. Slate board (join)
10. Pitcher K queue → K card
11. Pitcher Outs queue → Outs card
12. Pitcher Walks queue → Walks card
13. Pitcher HA queue → HA card
14. Batter TB queue → TB card
15. Batter Hits queue → Hits card
16. Batter HR queue → HR card
17. MLB Bet Card
18. `mlbAppendAllMarketNearMisses_` → `snapshotMLBBetCardToLog` → **`mlbBackfillResultsLogClosingK_` (all 7 markets) when FINAL** → `mlbAppendBetCardPipelineCoverage_` → warnings → `writePipelineLogTab_` → toast; activates **`🃏 MLB_Bet_Card`**

One-off menu items available for every stage (e.g. **`📋 Pitcher Walks queue / card`**, **`📋 Batter TB queue only`**, **`🎯 Batter Hits card only`**, **`📋 Open Pipeline Log`**).

## Not built yet (still fair gaps)

- Broader **StatEngine** beyond Poisson per-market; **sim-layer** gates
- **Closing-line backfill for FINAL** only covers the K tab today — multi-market CLV is now in the backfill but depends on FD odds tab still being populated at close time
- **Savant** umpire / catcher framing leaderboards (non-CSV) and richer ABS fields beyond a single λ multiplier
- **CSV quality**: quoted commas / non-UTF8 encodings not handled in the simple parser

## Suggested next product steps

1. Tune **`K9_BLEND_L7_WEIGHT`**, **`MIN_EV_BET_CARD`**, **`OPP_K_RATE_LAMBDA_STRENGTH`**, **`KELLY_FRACTION`** after several slates — scan **`⚾ Pipeline_Log`** + **`📋 MLB_Results_Log`** CLV columns.
2. Host small public CSVs (`team_id,abs_k_mult`, `pitcher_id,abs_k_mult`), set **`SAVANT_INGEST_ENABLED`** + **`SAVANT_ABS_CSV_URL`** / **`SAVANT_PITCHER_ABS_CSV_URL`**, then iterate multipliers from Pipeline_Log warnings.
3. Next larger theme candidates: per-market EV floors + card caps config knobs (⚙️ MIN_EV_PITCHER_K / BET_CARD_MAX_PITCHER_K etc.), sim layer, or non-FD book support.

## Single repo (formerly two folders)

The old **`mlb-pitcher-k`** folder was merged into **`mlb-boiz`** (2026-04-18). Use **one** Google Sheet + the `scriptId` in this repo's `.clasp.json`.
