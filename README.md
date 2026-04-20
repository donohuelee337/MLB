# MLB-BOIZ

Google Apps Script + Google Sheets pipeline in the **AI-BOIZ** spirit: slate-first, FanDuel lines via **The Odds API**, free **MLB Stats API** context, script-menu windows.

**Roadmap / parity checklist / two-folder note:** [docs/STATUS.md](docs/STATUS.md).

## What works today (MVP+)

1. **⚙️ Config** — `SLATE_DATE`, book/region, **`K9_BLEND_L7_WEIGHT`**, **`MIN_EV_BET_CARD`**, **`HP_UMP_LAMBDA_MULT`** (after **0. Build Config tab**).
2. **🚑 MLB_Injury_Report** — ESPN MLB injuries (**`INJURY_DATA_MLB`**).
3. **📅 MLB_Schedule** — statsapi slate + probables + home-plate umpire when assigned.
4. **📒 Pitcher_Game_Logs** — statsapi game logs for probables (cache for queue).
5. **✅ FanDuel_MLB_Odds** — The Odds API `baseball_mlb` + FanDuel.
6. **🎯 MLB_Slate_Board** — per-game FD line counts joined to schedule (flexible game keys).
7. **📋 Pitcher_K_Queue** — schedule × FD K (`pitcher_strikeouts`) + L3 / season K9 + **throws** (R/L) + HP umpire.
8. **📋 Pitcher_BB_Queue** — same join for **`pitcher_walks`** + L3 / season BB9.
9. **🎰 Pitcher_K_Card** — Poisson + naive EV from K queue.
10. **🎰 Pitcher_BB_Card** — Poisson + naive EV for walks (no park λ v1).
11. **🃏 MLB_Bet_Card** — ranked **K + walks** (EV floor optional).
12. **📋 MLB_Results_Log** + **📊** grading — upsert by **`bet_key`** (includes market); boxscore K or **BB**; **🔒 Final** + **📈 Backfill** close from ✅ FD tab.
13. **⚾ Pipeline_Log** — funnel, warnings, near-misses, game coverage after **Morning / Midday / Final**.

**Menus:** **🌅 Morning**, **🌤 Midday**, **🔒 Final**, **📆 Set SLATE_DATE to tomorrow (NY) + Morning**, per-stage “only” items, **📋 Open Pipeline Log**.

**Note:** The older **`mlb-pitcher-k`** folder was merged into this repo (same machine path used to hold a duplicate Apps Script stub). Work only here; use a single Sheet bound to `.clasp.json`.

## Setup (once)

Full **clasp** walkthrough (including “Project not found”): see **[docs/CLASP-SETUP.md](docs/CLASP-SETUP.md)**.

Short path:

1. Create a **new Google Sheet** (recommended: separate workbook from NBA AI-BOIZ).
2. **Extensions → Apps Script** — note the **script ID** in the URL (`script.google.com/home/projects/SCRIPT_ID/edit`).
3. This repo includes **`.clasp.json`** (tracked) so you can `git clone` on another machine and run **`clasp login`** then **`clasp push`**. For a brand-new script, copy `.clasp.json.example` → `.clasp.json` and set `scriptId`.
4. **Project Settings → Script properties** — add:
   - `ODDS_API_KEY` — your key from [the-odds-api.com](https://the-odds-api.com/) (never commit this key).
5. Reload the Sheet → **⚾ MLB-BOIZ** menu appears.

## Slate date (tomorrow)

Set **⚙️ Config → `SLATE_DATE`** to `yyyy-MM-dd` for the day you want (e.g. tomorrow). The morning runner uses that for both schedule and odds event filtering.

## ABS (2026)

League uses the **ABS challenge system** (human calls pitches; players may challenge). See `docs/ABS-2026.md` and Savant: [ABS dashboard](https://baseballsavant.mlb.com/abs).

## Repo / backup

This repo is meant to be **separate** from `ai-boiz`. Git is initialized locally (`main` branch, two commits). **GitHub CLI (`gh`) is not required** — create the empty repo in the browser, then:

```bash
cd C:\Users\Garage\Documents\Cursor\mlb-boiz
git remote add origin https://github.com/YOUR_USER/mlb-boiz.git
git push -u origin main
```

If `git push` asks for credentials, use a **Personal Access Token** as the password (GitHub deprecated password auth).

## Legal

Gambling may be illegal where you live. This software is for research and personal organization only.
