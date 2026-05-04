# MLB-BOIZ

Google Apps Script + Google Sheets pipeline in the **AI-BOIZ** spirit: slate-first, FanDuel lines via **The Odds API**, free **MLB Stats API** context, script-menu windows.

**Roadmap / parity checklist / two-folder note:** [docs/STATUS.md](docs/STATUS.md).

## What works today

1. **⚙️ Config** — `SLATE_DATE`, book/region, **`K9_BLEND_L7_WEIGHT`**, **`MIN_EV_BET_CARD`**, **`MAX_ODDS_BET_CARD`**, **`HP_UMP_LAMBDA_MULT`**, **`EST_AB_PER_GAME`**, **`BANKROLL`**, **`KELLY_FRACTION`** (after **0. Build Config tab**).
2. **🚑 MLB_Injury_Report** — ESPN MLB injuries.
3. **📅 MLB_Schedule** — statsapi slate + probables + home-plate umpire when assigned.
4. **📒 Pitcher_Game_Logs** — statsapi game logs for probables (cache for queue).
5. **✅ FanDuel_MLB_Odds** — The Odds API `baseball_mlb` + FanDuel.
6. **🎯 MLB_Slate_Board** — per-game FD line counts joined to schedule.
7. **📋 Pitcher_K_Queue** — schedule × FD K (`pitcher_strikeouts`) + L3 / season K9 + throws (R/L) + HP umpire.
8. **🎰 Pitcher_K_Card** — Poisson + naive EV from K queue.
9. **🎰 Batter_Hits_Card** — Binomial P(≥k hits) on λ = season BA × est_AB; reads FD `batter_hits` / `batter_hits_alternate`.
10. **💣 Batter_HR_Queue** — research-only ranking by season HR/PA × park (no FD price required).
11. **🃏 MLB_Bet_Card** — ranked **K + Batter Hits**, sorted by **game start time** then EV. Grade rubric (A+/A/B+/B/C); **A+ plays bypass** the per-game and total card caps. Each row shows **grade, model %, book %, ev/$1, kelly $, proj, proj − line**.
12. **📋 MLB_Results_Log** + **📊** grading — upsert by `bet_key`; boxscore K / batter hits; `🔒 Final` + `📈 Backfill` close from ✅ FD tab. **`grade`** captured for post-hoc analysis.
13. **⚾ Pipeline_Log** — funnel, warnings, near-misses, game coverage after Morning / Midday / Final.

**Pitcher walks** were removed from the bet card and pipeline because FanDuel rarely posts straight walk lines. The walk queue/card files remain in the repo (disconnected); historical walk rows in the Results Log still grade and CLV-backfill for backward compat.

**Menus:** **🌅 Morning**, **🌤 Midday**, **🔒 Final**, **📆 Set SLATE_DATE to tomorrow (NY) + Morning**, per-stage "only" items, **📋 Open Pipeline Log**.

## Bet card grade rubric

| Grade | Criteria | Treatment |
|---|---|---|
| **A+** | EV ≥ 0.05 AND odds ≤ +130 | Bypasses 2/game and 30 total caps |
| **A**  | EV ≥ 0.04 AND odds ≤ +180 | Subject to caps |
| **B+** | EV ≥ 0.025 | Subject to caps |
| **B**  | EV ≥ 0.015 | Subject to caps |
| **C**  | EV > 0 | Subject to caps |

A+ favors low-variance "small +EV bites" — high edge at favorite-ish prices.

`kelly $` = `BANKROLL × KELLY_FRACTION × max(0, (p·b − q)/b)` for model probability `p` at American odds `american` (b = decimal-1). Default is quarter-Kelly on a $1000 bank.

The `model %` column is color-coded so coin-flip-zone (<55%) plays show in amber even when EV is positive — count edge can hide variance, the probability is the honest read.

## Setup (once)

Full **clasp** walkthrough (including "Project not found"): see **[docs/CLASP-SETUP.md](docs/CLASP-SETUP.md)**.

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

Git is initialized locally. **GitHub CLI (`gh`) is not required** — create the empty repo in the browser, then:

```bash
git remote add origin https://github.com/YOUR_USER/mlb-boiz.git
git push -u origin main
```

If `git push` asks for credentials, use a **Personal Access Token** as the password (GitHub deprecated password auth).

## Legal

Gambling may be illegal where you live. This software is for research and personal organization only.
