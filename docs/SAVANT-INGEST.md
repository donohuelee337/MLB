# Baseball Savant ingest (MLB-BOIZ)

Sources: [Baseball Savant](https://baseballsavant.mlb.com/), [ABS dashboard](https://baseballsavant.mlb.com/abs), [ABS challenge leaderboard](https://baseballsavant.mlb.com/leaderboard/abs-challenges).

Apps Script cannot reliably scrape JS-heavy pages or run huge Statcast search queries (timeouts). Use **CSV export → public HTTPS URL** (Google Drive “anyone with link”, GitHub raw, or a small hosted file).

## Enable

1. **0. Build Config tab** (picks up new keys).
2. Set **`SAVANT_INGEST_ENABLED`** = `true`.
3. Set at least one URL below.
4. Run **Morning** (or any ball window) and check **Pipeline_Log** for Savant warnings.

## Daily ETL (`savant-etl/`)

Run **outside** Apps Script (local or GitHub Actions). See `savant-etl/README.md`.

```bash
cd savant-etl && pip install -r requirements.txt
python run_daily.py --date 2026-05-31
```

Produces:

- `out/savant_matchup_daily.csv` — from [probable pitchers](https://baseballsavant.mlb.com/probable-pitchers) (SP vs **current opponent roster**: PA, K%, xwOBA, …) joined to Stats API `game_pk` / `pitcher_id`.
- `out/savant_team_context.csv` — team whiff/chase (plate discipline export).

Upload both to Drive → set URLs in Config → **Morning** ingest loads caches in `MLBSavantIngest.js`.

Workflow: `.github/workflows/savant-daily.yml` (artifacts; copy to Drive until auto-upload is wired).

## Config keys

| Key | Purpose |
|-----|---------|
| `SAVANT_ABS_CSV_URL` | Per-team λ multiplier **or** Savant ABS leaderboard CSV |
| `SAVANT_TEAM_WHIFF_CSV_URL` | Team whiff% / K% for lineup fallback |
| `SAVANT_TEAM_CONTEXT_CSV_URL` | From `savant-etl` team context (merges into whiff cache) |
| `SAVANT_MATCHUP_DAILY_CSV_URL` | From `savant-etl` matchup daily (SP vs roster) |
| `SAVANT_MATCHUP_MIN_PA` | Min PA before matchup K% affects λ / Deep Dive (default `30`) |
| `K_SAVANT_MATCHUP_STRENGTH` | λ bump from Savant SP K% vs roster (`0` = off until ablated) |
| `SAVANT_ABS_K_FLIP_SENSITIVITY` | Scale when auto-deriving λ from K-flips (default `0.012`) |
| `K_LINEUP_WHIFF_MIN_PA` | Min PA per batter in lineup whiff average (default `20`) |
| `K_LINEUP_WHIFF_STRENGTH` | Max ±λ from lineup whiff (default `0.10`; set `0` to disable) |

## ABS CSV formats

### A — Pre-built multipliers

```csv
team_id,abs_k_mult
121,1.02
144,0.98
```

See `examples/savant-abs-sample.csv`.

### B — Savant ABS leaderboard export

Export from [ABS challenges leaderboard](https://baseballsavant.mlb.com/leaderboard/abs-challenges) (team view, CSV). Required columns (names flexible):

- Team: `team_id`, `team_name`, or `abbr`
- K-flips: `k_minus`, `k_flips`, `k_flip`, etc.
- Optional: `games` (else estimated from challenges)

The parser **derives** `abs_k_mult` per team: more K-flips per game → slightly **higher** λ for pitcher K (capped 0.92–1.08). See `examples/savant-abs-leaderboard-sample.csv`.

## Team whiff CSV (optional)

Statcast **batting** leaderboard: whiff % or K% by team. Example:

```csv
abbr,whiff_pct
NYM,24.5
```

Used when confirmed lineups have fewer than 5 batters meeting `K_LINEUP_WHIFF_MIN_PA`. See `examples/savant-team-whiff-sample.csv`.

## Matchup daily CSV (probable-pitchers)

See `examples/savant-matchup-daily-sample.csv`. Required: `game_pk`, `pitcher_id`. Optional: `pa`, `k_pct`, `xwoba`, `never_faced`, `sample_flag`.

- **`mlbSavantMatchupSnippet_`** → 🧠 K Deep Dive prompt when enabled.
- **`K_SAVANT_MATCHUP_STRENGTH`** → extra λ factor via `mlbGetSavantSpVsOppKPa_` (ignored when `never_faced` or PA &lt; `SAVANT_MATCHUP_MIN_PA`).

## Lineup whiff (statsapi + Savant)

`mlbLineupWhiffAvgForGamePk_` (in `MLBLineups.js`):

1. Confirmed lineup from statsapi → average batter SO/PA (vs-hand when SP throws L/R).
2. Else Savant team whiff CSV.
3. Else `NaN` (no lineup whiff bump).

Feed into `mlbBuildMatchupMultiplier_` when **`K_LINEUP_WHIFF_STRENGTH`** > 0.

## Self-test

Menu: **🔬 K Walk-Forward (advanced)** → **✅ Run Savant ingest self-test** (parses sample CSVs, no HTTP).

## Hosting CSV on Drive

1. Upload CSV to Google Drive.
2. Share → anyone with the link.
3. Use a direct-download URL pattern Apps Script can `UrlFetch` (or publish to web).

If Savant’s `?csv=true` URL times out from Apps Script, download manually weekly and point `SAVANT_ABS_CSV_URL` at your hosted copy.
