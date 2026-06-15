#!/usr/bin/env python3
"""
savant_export.py — weekly Baseball Savant CSV export for MLB-BOIZ (Path B).

Why: Baseball Savant has no official API. Rather than have Apps Script
scrape it live (fragile, can get blocked), this runs on your machine via
pybaseball — the maintained community scraper — and writes four small CSVs
with the EXACT column headers the GAS ingest accepts. You publish them
once, point the *_CSV_URL config keys at them, and the Game Cards EV/LA
blurbs + the future out-pitch panel light up. Arsenal/EV/LA are
season-level stats, so running this WEEKLY is plenty.

Outputs (canonical headers the GAS parsers accept as-is):
  savant_pitcher_profile.csv   player_id, player_name, ev_avg, la_avg, xba, xwoba, barrel_pct
  savant_batter_profile.csv    (same shape, batter EV/LA)
  savant_arsenal_pitcher.csv   player_id, player_name, pitch_type, pitch_usage, whiff_percent, run_value_per_100, pitches
  savant_arsenal_batter.csv    (same shape, batter-vs-pitch-type)

Usage:
  pip install pybaseball pandas requests
  python savant_export.py [YEAR] [OUTPUT_DIR]
  (defaults: current year, current directory)

Each dataset is wrapped in its own try/except — one failure won't sink
the others. Then publish + wire up (see PUBLISH steps printed at the end).
"""

import sys
import io
import os
import datetime

import pandas as pd
import requests

YEAR = int(sys.argv[1]) if len(sys.argv) > 1 else datetime.date.today().year
OUT = sys.argv[2] if len(sys.argv) > 2 else "."
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "Accept": "text/csv,text/plain,*/*"}

os.makedirs(OUT, exist_ok=True)


def _write(df, name):
    path = os.path.join(OUT, name)
    df.to_csv(path, index=False)
    print(f"  ✓ {name}  ({len(df)} rows)")


def _profile(exitvelo_fn, expected_fn, role):
    """EV/LA from exitvelo_barrels + xBA/xwOBA from expected_stats, merged."""
    evb = exitvelo_fn(YEAR, 50)              # avg_hit_speed, avg_hit_angle, brl_percent
    evb = evb.rename(columns={
        "last_name, first_name": "player_name",
        "avg_hit_speed": "ev_avg",
        "avg_hit_angle": "la_avg",
        "brl_percent": "barrel_pct",
    })
    keep = ["player_id", "player_name", "ev_avg", "la_avg", "barrel_pct"]
    out = evb[[c for c in keep if c in evb.columns]].copy()
    try:
        exp = expected_fn(YEAR, 50).rename(columns={"est_ba": "xba", "est_woba": "xwoba"})
        out = out.merge(exp[["player_id", "xba", "xwoba"]], on="player_id", how="left")
    except Exception as e:
        print(f"  (xBA merge skipped for {role}: {e})")
        out["xba"] = ""
        out["xwoba"] = ""
    return out


def main():
    print(f"Baseball Savant export — {YEAR} → {os.path.abspath(OUT)}")
    from pybaseball import (
        statcast_pitcher_exitvelo_barrels, statcast_pitcher_expected_stats,
        statcast_batter_exitvelo_barrels, statcast_batter_expected_stats,
        statcast_pitcher_arsenal_stats,
    )

    # --- EV / LA / xBA profiles (the Game Card blurbs) ---
    try:
        _write(_profile(statcast_pitcher_exitvelo_barrels, statcast_pitcher_expected_stats, "pitcher"),
               "savant_pitcher_profile.csv")
    except Exception as e:
        print(f"  ✗ pitcher profile failed: {e}")
    try:
        _write(_profile(statcast_batter_exitvelo_barrels, statcast_batter_expected_stats, "batter"),
               "savant_batter_profile.csv")
    except Exception as e:
        print(f"  ✗ batter profile failed: {e}")

    # --- Pitcher arsenal (pybaseball; columns already match GAS) ---
    try:
        pa = statcast_pitcher_arsenal_stats(YEAR, 25).rename(columns={"last_name, first_name": "player_name"})
        _write(pa, "savant_arsenal_pitcher.csv")
    except Exception as e:
        print(f"  ✗ pitcher arsenal failed: {e}")

    # --- Batter arsenal (no pybaseball fn — direct leaderboard CSV) ---
    try:
        url = ("https://baseballsavant.mlb.com/leaderboard/pitch-arsenal-stats"
               f"?type=batter&year={YEAR}&min=25&csv=true")
        r = requests.get(url, headers=UA, timeout=30)
        r.raise_for_status()
        ba = pd.read_csv(io.StringIO(r.text)).rename(columns={"last_name, first_name": "player_name"})
        _write(ba, "savant_arsenal_batter.csv")
    except Exception as e:
        print(f"  ✗ batter arsenal failed: {e}")

    print("""
PUBLISH (do once; then it's a 1-line re-run weekly):
  1. Upload each CSV somewhere with a STABLE public URL. Easiest options:
       • Google Drive → share "Anyone with link" → use the direct form:
         https://drive.google.com/uc?export=download&id=<FILE_ID>
       • or a Google Sheet tab → File ▸ Share ▸ Publish to web ▸ CSV
       • or a GitHub gist → the "Raw" URL
  2. In the ⚙️ Config tab, set:
       STATCAST_ENABLED            = Y
       STATCAST_PITCHER_PROFILE_CSV_URL = <savant_pitcher_profile URL>
       STATCAST_BATTER_PROFILE_CSV_URL  = <savant_batter_profile URL>
       ARSENAL_INGEST_ENABLED      = Y
       ARSENAL_P_CSV_URL           = <savant_arsenal_pitcher URL>
       ARSENAL_B_CSV_URL           = <savant_arsenal_batter URL>
  3. Run ⚾ MLB-BOIZ ▸ 🧪 Test Savant arsenal fetch (and a pipeline window)
     — the canaries should go green and EV/LA fills on the Game Cards.
Weekly: just re-run this script; the published URLs update in place.
""")


if __name__ == "__main__":
    main()
