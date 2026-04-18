# MLB-BOIZ — where we are (vs NBA AI-BOIZ)

**Canonical repo:** `Documents\Cursor\mlb-boiz` — use this folder in Cursor and for `clasp push`.

## Done (MVP, AI-BOIZ spirit)

| AI-BOIZ idea | MLB-BOIZ today |
|--------------|----------------|
| Config + slate date | `Config.js`, `⚙️ Config` tab, `SLATE_DATE`, tomorrow menu helper |
| Odds pull (The Odds API) | `FetchMLBOdds.js` → `✅ FanDuel_MLB_Odds`, batched `baseball_mlb` markets |
| Injury intel | `FetchMLBInjuries.js` → `🚑 MLB_Injury_Report`, `INJURY_DATA_MLB` |
| Schedule / context | `MLBSchedule.js` → `📅 MLB_Schedule` (statsapi + probable pitchers) |
| Morning window | `PipelineMenu.js` — injuries → schedule → odds → **`⚾ Pipeline_Log`** |
| Docs / research | `docs/2026-04-11-mlb-research-briefing.md`, API + ABS research, `ABS-2026.md`, clasp setup, tomorrow checklist |
| clasp | `.clasp.json` tracked for clone on other machines |

## Not built yet (NBA has these)

- `🗄️ Game_Logs` / BallDontLie-style ingest → **MLB Stats API** game logs per player
- Slate queue + projection blend (L7 / platoon / park) → **minutes → PA/IP model**
- `StatEngine.js` analogue → **Poisson / binomial** by market (start with `pitcher_strikeouts`)
- Sim + signal scoring → **v20-style** gates (or EV-first portfolio spec from ai-boiz docs)
- Bet card + results log + **CLV** snapshots
- Multi-window (morning / midday / final) if you want parity with NBA

## Single repo (formerly two folders)

The old **`mlb-pitcher-k`** folder was merged into **`mlb-boiz`** (2026-04-18): pipeline-log helpers live in `MLBPipelineLog.js`, the morning runner writes **`⚾ Pipeline_Log`**, and extra research files sit in `docs/` (`2026-04-11-mlb-api-data-research.md`, `2026-04-11-abs-system-research.md`). Use **one** Google Sheet + the `scriptId` in this repo’s `.clasp.json`. Pitcher-K **design spec** remains `docs/2026-04-11-mlb-pitcher-k-pipeline-design.md`.

## Suggested next implementation order

1. **Game logs ingest** (MLB Stats API) for pitchers on today’s slate → tab or lightweight cache.
2. **Slate queue** — one row per (game, pitcher, FD K line) joined to schedule + injuries.
3. **Stat layer** — Poisson on K for one market end-to-end; then bet card stub (top N by edge).
4. Extend **`⚾ Pipeline_Log`** — game coverage / near-miss sections once sim + card exist.
