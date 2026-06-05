# Savant daily ETL (MLB-BOIZ)

Fetches [probable pitchers](https://baseballsavant.mlb.com/probable-pitchers) matchup tables and optional team plate-discipline context, joins to [Stats API](https://statsapi.mlb.com/) `game_pk` / pitcher ids, and writes CSVs for Apps Script ingest.

## Setup

```bash
cd savant-etl
python -m pip install -r requirements.txt
```

## Run (local, before Morning pipeline)

```bash
python run_daily.py --date 2026-05-31
```

Outputs:

| File | Config key |
|------|------------|
| `out/savant_matchup_daily.csv` | `SAVANT_MATCHUP_DAILY_CSV_URL` |
| `out/savant_team_context.csv` | `SAVANT_TEAM_CONTEXT_CSV_URL` (or legacy `SAVANT_TEAM_WHIFF_CSV_URL`) |

## Host on Google Drive

1. Upload both CSVs to Drive.
2. Share → anyone with the link.
3. Use a direct-download URL in **⚙️ Config** (same pattern as `docs/SAVANT-INGEST.md`).
4. Set `SAVANT_INGEST_ENABLED` = `true`.

## GitHub Actions

Workflow `.github/workflows/savant-daily.yml` runs on schedule (14:00 UTC ≈ 10:00 ET) and uploads artifacts. Download artifacts and upload to Drive, or wire a future Drive-upload secret.

## Sample PA flags

| `sample_flag` | Meaning |
|---------------|---------|
| `ok` | PA ≥ 30 (configurable via `SAVANT_MATCHUP_MIN_PA`) |
| `low_pa` | Some history, below min PA |
| `never_faced` | Savant “never faced” block |
| `missing_savant` | Stats API probable exists but Savant block not matched |
