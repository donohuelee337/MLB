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
| Results log + grading | `MLBResultsLog.js` / **`📋 MLB_Results_Log`**; `MLBResultsGrader.js` — menu grader; runs at start of each ball window; **proj_IP / actual_IP / ip_error** on K bets |
| Pitcher start DB + IP audit | **`🗄️ Pitcher_K_Logs`** — cols **proj_ip_v1/v2**, **ip_error_v1/v2** (walk-forward backfill); menu **📏 Backfill K Logs proj IP** |
| CLV proxy (close line) | **`close_line` / `close_odds` / `clv_note`** (line move + **implied Δpp** vs open when odds parse) — `mlbBackfillResultsLogClosingK_` on **FINAL** + menu **📈 Backfill closing K** |
| Umpire → λ (optional) | **`⚙️ HP_UMP_LAMBDA_MULT`** — scales 🎰 λ when **`hp_umpire`** present (default **1** = off) |
| Pipeline observability | `MLBPipelineLog.js` → **`⚾ Pipeline_Log`** (funnel, warnings, near-miss append, bet-card game coverage) |
| Savant / ABS CSV (optional) | `MLBSavantIngest.js` — **`SAVANT_ABS_CSV_URL`** (mult or [ABS leaderboard](https://baseballsavant.mlb.com/leaderboard/abs-challenges) K-flip derive), **`SAVANT_TEAM_WHIFF_CSV_URL`**; see **`docs/SAVANT-INGEST.md`** |
| Lineup whiff stack | `mlbLineupWhiffAvgForGamePk_` in **`MLBLineups.js`** — statsapi lineup SO/PA (vs-hand) + Savant team fallback; uses **`K_LINEUP_WHIFF_STRENGTH`** (default 0.10) |
| League priors (platoon) | **`LEAGUE_HITTING_K_PA`** + **`LEAGUE_HITTING_K_PA_VS_L`** / **`LEAGUE_HITTING_K_PA_VS_R`** for OPP_K ratio when **`opp_k_pa_vs`** is present |
| Multi-window | **`🌅 Morning`**, **`🌤 Midday`** (skips injury HTTP), **`🔒 Final`** — `runMLBBallWindow_` in `PipelineMenu.js` |
| **K walk-forward engine (2026-05)** | Menu **`🔬 K Walk-Forward`** — logs → **`🧪 K_Discrepancy_Report`** (λ, fair line, typical FD ladder, **p_gap**) → **`🧠 K_Deep_Dive`** (Claude via Script property **`ANTHROPIC_API_KEY`**) → **`🧪 K_Segment_Miner`** (on flagged rows when any); **`🎯 K_Calibration`**, **`🎯 K_Segment_Registry`**; bet card **`K_SEGMENT_MODE`** |
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

- **Savant live URL** — Apps Script may timeout on Savant `?csv=true`; prefer weekly manual export → hosted CSV (see **`docs/SAVANT-INGEST.md`**)
- **First-pitch / contact CSV** — deferred per spec §9
- **Historical FanDuel K lines** in backtest — proxy lines from rolling median K for now; merge `close_line` from Results Log over time
- Full multi-market breadth (H/TB on live card disabled via **`K_SEGMENT_INCLUDE_H=N`** until K segments prove profitable)
- **Savant** umpire / catcher framing leaderboards (non-CSV) and richer ABS fields beyond derived **λ** + team whiff
- **CSV quality**: quoted commas / non-UTF8 encodings not handled in the simple parser

## K walk-forward go-live (manual checklist)

### Overnight season dump (NBA Game_Logs style)

1. **`clasp push`** → **0. Build Config tab**
2. **🔬 K Walk-Forward → ⏳ Start season K dump (clear + overnight)** — league cache + 10‑min chunks until done (leave sheet authorized).
3. Morning: **📊 Pitcher K dump status** → **🔄 Backfill K Logs context cols** → **🧪 Run K walk-forward backtest**

Use **🗄️ Build Pitcher K Logs (slate only)** only for quick daily slate refresh (~30 SPs), not for backtest scale.

### After dump complete

1. **🔄 Backfill K Logs context cols** (opp K L14; park kept from dump when not on schedule tab).
2. **Script property `ANTHROPIC_API_KEY`** → **🔌 Test Anthropic connection** (once).
3. **🧪 Run K walk-forward backtest** — review **`🧪 K_Discrepancy_Report`** (flag=Y), then **🧠 Claude deep dive (discrepancies)**.
4. **`🧪 K_Segment_Miner`** (runs on flagged subset when present) + **`🎯 K_Calibration`**.
5. **🎯 Seed registry from miner** — enable only after Claude + miner agree.
6. Do **not** enable **`K_SEGMENT_MODE=live`** if miner shows no positive pockets.
7. Leave **`K_SEGMENT_MODE=shadow`** for several slates; compare audit cols vs graded results.
8. Set **`K_SEGMENT_MODE=live`** when ready; rollback with **`legacy`**.

**Spec:** `docs/superpowers/specs/2026-05-28-mlb-k-walk-forward-design.md`

## Suggested next product steps

1. Run the go-live checklist above; tune **`K_OPP_K_STRENGTH`**, **`K_OPP_L14_BLEND`**, **`K_HR_PARK_STRENGTH`** from ablation in the walk-forward report (not gate backtest on logged picks).
2. Accumulate **`close_line`** in **`📋 MLB_Results_Log`** to improve proxy-line quality in **`🗄️ Pitcher_K_Logs`**.
3. Enable Savant ingest + tune **`K_LINEUP_WHIFF_STRENGTH`** after walk-forward ablation.

## Single repo (formerly two folders)

The old **`mlb-pitcher-k`** folder was merged into **`mlb-boiz`** (2026-04-18). Use **one** Google Sheet + the `scriptId` in this repo’s `.clasp.json`. Pitcher-K **design spec:** `docs/2026-04-11-mlb-pitcher-k-pipeline-design.md`.
