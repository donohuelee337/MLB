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
| Schedule ↔ FD join | `MLBMatchKeys.js` — normalized labels + abbr→Odds team names for fewer `fd_k_miss` rows |
| Pitcher K slate | `MLBPitcherKQueue.js` → **`📋 Pitcher_K_Queue`** (+ **`throws`** R/L from statsapi `/people/{id}`) |
| Poisson + EV (K) stats | `MLBPitcherKBetCard.js` → **`🎰 Pitcher_K_Card`** (blended K/9 via **`K9_BLEND_L7_WEIGHT`**) |
| Sim (K) — anchored λ | `MLBSimPitcherK.js` → **`⚡ Sim_Pitcher_K`** — reads K card; **`ANCHOR_WEIGHT_K`**; **`🃏` K rows use this tab** (see `docs/superpowers/specs/2026-05-11-mlb-nba-parity-sim-architecture-design.md`) |
| Binomial + EV (Hits) | `MLBBatterHitsCard.js` → **`🎰 Batter_Hits_Card`** — P(≥k hits) on λ = season BA × est_AB; reads FD `batter_hits` + `batter_hits_alternate` |
| Poisson + EV (TB) | `MLBBatterTBCard.js` → **`🎰 Batter_TB_Card`** — P(≥k TB) vs FanDuel total bases |
| Bet card | `MLBBetCard.js` → **`🃏 MLB_Bet_Card`** — **K (from ⚡ Sim) + Batter Hits + TB**, sorted by **game start time** then EV; **grade rubric** (A+/A/B+/B/C) with A+ bypass; **kelly $**, **model %**, **book %**, **proj**, **proj − line** columns; lineup-card aesthetic (ivory paper, navy ink, mono numbers) |
| Results log + grading | `MLBResultsLog.js` / **`📋 MLB_Results_Log`**; `MLBResultsGrader.js` — menu grader; runs at start of each ball window; supports K + batter hits (historical walk rows still grade) |
| CLV proxy (close line) | **`close_line` / `close_odds` / `clv_note`** — `mlbBackfillResultsLogClosing_` on **FINAL** (after odds) + menu **📈 Backfill closing lines** (handles K and batter hits; legacy walk rows for backward compat) |
| Umpire → λ (optional) | **`⚙️ HP_UMP_LAMBDA_MULT`** — scales 🎰 λ when **`hp_umpire`** present (default **1** = off) |
| Pipeline observability | `MLBPipelineLog.js` → **`⚾ Pipeline_Log`** (funnel, warnings, near-miss append, bet-card game coverage) |
| Multi-window | **`🌅 Morning`**, **`🌤 Midday`** (skips injury HTTP), **`🔒 Final`** — `runMLBBallWindow_` in `PipelineMenu.js` |
| Docs / clasp | `docs/*`, `.clasp.json` |

## Orchestrator (truth source)

**Menu:** **`⚾ MLB-BOIZ`** (`PipelineMenu.js`).

**`runMLBBallWindow_(windowTag, skipInjuriesFetch)`** — order of work:

1. `gradeMLBPendingResults_` (best-effort; K + batter hits)
2. `mlbResetPitchGameLogFetchCache_`
3. Config (`buildConfigTab`)
4. MLB injuries (ESPN) — **skipped when Midday**
5. MLB schedule (statsapi)
6. Pitcher game logs (statsapi)
7. FanDuel MLB odds
8. Slate board (join)
9. Pitcher K queue
10. Pitcher K card (`🎰` — raw λ / audit)
11. **Sim Engine (Pitcher K)** (`refreshPitcherKSimEngine_` → **`⚡ Sim_Pitcher_K`**)
12. Batter Hits card
13. Batter TB card
14. MLB Bet Card (merge K from ⚡ + Hits + TB → grade → sort by game time)
15. `mlbAppendPitcherKNearMisses_` → `snapshotMLBBetCardToLog` (if bet card OK; captures `grade` in Results Log) → **`mlbBackfillResultsLogClosing_` when `FINAL` + odds OK** → `mlbAppendBetCardPipelineCoverage_` → step warnings → `writePipelineLogTab_` → toast; activates **`🃏 MLB_Bet_Card`**

One-off menu items mirror those stages (e.g. **`📋 Pitcher K queue only`**, **`⚡ Pitcher K Sim only`**, **`🎰 Batter Hits card only`**, **`📋 Open Pipeline Log`**).

## Bet card details

- **Layout** (20 cols): `slate · # · grade · gamePk · matchup · play · player · market · side · line · odds · model % · book % · ev/$1 · kelly $ · proj · proj − line · flags · player_id · time`
- **Grade rubric** (in `mlbGradePlay_`):
  - **A+**: EV ≥ 0.05 AND odds ≤ +130 — bypasses 2/game and 30 total caps
  - **A**: EV ≥ 0.04 AND odds ≤ +180
  - **B+**: EV ≥ 0.025
  - **B**: EV ≥ 0.015
  - **C**: EV > 0
- **Kelly $** = `BANKROLL × KELLY_FRACTION × max(0, (p·b − q)/b)` for model probability `p` at American odds (b = decimal odds − 1). Default quarter-Kelly on $1000.
- **Sort**: game start time asc, EV desc within game (read from schedule `gameDateRaw`).
- **Visual cues**: model % colored dark-green when ≥62% (well above coin flip), amber when <55% (coin-flip zone). Grade cells colored with muted Topps card-back palette. Game dividers via hairline navy underline.

## Not built yet (still fair gaps vs NBA / spec)

- **Context score** + CV gates on Sim (Phase 1 ships **anchored Poisson K** only; see architecture spec)
- Broader **StatEngine** beyond pitcher-K Poisson; **v20-style sim** parity for batter props
- Full multi-market breadth if you want NBA-style `Game_Logs` for every prop type
- **Savant** ump/catcher framing, **ABS** team signals, opponent platoon from team stats API — see `docs/2026-04-11-mlb-pitcher-k-pipeline-design.md` (not wired; park table is a small static v1 in `MLBParkFactors.js` only)

## Suggested next product steps

1. Tune **`K9_BLEND_L7_WEIGHT`** / **`MIN_EV_BET_CARD`** / **`MAX_ODDS_BET_CARD`** / **`EST_AB_PER_GAME`** / **`KELLY_FRACTION`** on **`⚙️ Config`** after a few slates (re-run **0. Build Config tab** if keys are missing).
2. After enough graded slates, analyze WIN% by **`grade`** column (Results Log col Y). If A+ doesn't dominate, tighten the rubric in `mlbGradePlay_`.
3. Extend **`MLB_ABBR_ODDS_TEAM_ALTERNATES`** / Odds name map in `MLBMatchKeys.js` when a team rebrands or the Odds API changes strings.
4. Pick one backlog theme: CLV, sim layer, or non-K/Hits markets.

## Single repo (formerly two folders)

The old **`mlb-pitcher-k`** folder was merged into **`mlb-boiz`** (2026-04-18). Use **one** Google Sheet + the `scriptId` in this repo’s `.clasp.json`. Pitcher-K **design spec:** `docs/2026-04-11-mlb-pitcher-k-pipeline-design.md`.
