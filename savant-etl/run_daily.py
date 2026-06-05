#!/usr/bin/env python3
"""
Daily Savant ETL for MLB-BOIZ.

  python run_daily.py --date 2026-05-31
  python run_daily.py   # today (local date)

Writes:
  out/savant_matchup_daily.csv
  out/savant_team_context.csv

Upload both to Google Drive (anyone with link) and set Config URLs in the Sheet.
"""
from __future__ import annotations

import argparse
import csv
import re
import sys
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from lib.parse_probable_pitchers import parse_probable_pitchers_html  # noqa: E402
from lib.statsapi_schedule import fetch_schedule, slate_date_default  # noqa: E402
from lib.team_context import fetch_team_context_csv, parse_team_discipline_csv  # noqa: E402

PROBABLE_URL = "https://baseballsavant.mlb.com/probable-pitchers"
USER_AGENT = "mlb-boiz-savant-etl/1.0"
OUT_DIR = ROOT / "out"

MATCHUP_FIELDS = [
    "as_of_date",
    "game_pk",
    "pitcher_id",
    "pitcher_name",
    "throws",
    "opp_team_id",
    "opp_abbr",
    "pa",
    "k_pct",
    "bb_pct",
    "avg",
    "woba",
    "exit_velo",
    "launch_angle",
    "xba",
    "xslg",
    "xwoba",
    "never_faced",
    "sample_flag",
]

TEAM_FIELDS = [
    "as_of_date",
    "team_id",
    "abbr",
    "team_name",
    "whiff_pct",
    "chase_pct",
    "source",
]

# Name fragments from Savant headings → abbr (for schedule join)
NAME_TO_ABBR = {
    "blue jays": "TOR",
    "orioles": "BAL",
    "padres": "SD",
    "nationals": "WSN",
    "twins": "MIN",
    "pirates": "PIT",
    "red sox": "BOS",
    "guardians": "CLE",
    "angels": "LAA",
    "rays": "TB",
    "braves": "ATL",
    "reds": "CIN",
    "marlins": "MIA",
    "mets": "NYM",
    "tigers": "DET",
    "white sox": "CWS",
    "brewers": "MIL",
    "astros": "HOU",
    "royals": "KC",
    "rangers": "TEX",
    "giants": "SF",
    "rockies": "COL",
    "yankees": "NYY",
    "athletics": "OAK",
    "diamondbacks": "ARI",
    "mariners": "SEA",
    "phillies": "PHI",
    "dodgers": "LAD",
    "cubs": "CHC",
    "cardinals": "STL",
}


def abbr_from_team_name(name: str) -> str:
    n = re.sub(r"\s+", " ", (name or "").lower())
    for frag, ab in NAME_TO_ABBR.items():
        if frag in n:
            return ab
    return ""


def join_matchups_to_schedule(
    parsed: list[dict], schedule: list[dict]
) -> list[dict]:
    """Attach game_pk / pitcher_id / opp_team_id from statsapi probables."""
    by_key: dict[tuple[str, str], dict] = {}
    for row in parsed:
        key = (row["pitcher_name"].lower(), row["opp_abbr"])
        by_key[key] = row

    out: list[dict] = []
    for g in schedule:
        for side, pid, pname, opp_id, opp_abbr in (
            (
                "away",
                g.get("away_pitcher_id"),
                g.get("away_pitcher_name"),
                g.get("home_team_id"),
                g.get("home_abbr"),
            ),
            (
                "home",
                g.get("home_pitcher_id"),
                g.get("home_pitcher_name"),
                g.get("away_team_id"),
                g.get("away_abbr"),
            ),
        ):
            if not pname:
                continue
            key = (str(pname).lower(), opp_abbr or "")
            sav = by_key.get(key)
            if not sav:
                # fallback: match by last name + opp abbr
                last = str(pname).split()[-1].lower()
                for (pn, oa), srow in by_key.items():
                    if oa == opp_abbr and pn.endswith(last):
                        sav = srow
                        break
            base = sav or {
                "as_of_date": g.get("as_of_date", ""),
                "pitcher_name": pname,
                "throws": "R",
                "opp_abbr": opp_abbr,
                "pa": 0,
                "k_pct": "",
                "bb_pct": "",
                "avg": "",
                "woba": "",
                "exit_velo": "",
                "launch_angle": "",
                "xba": "",
                "xslg": "",
                "xwoba": "",
                "never_faced": 0,
                "sample_flag": "missing_savant",
            }
            out.append(
                {
                    "as_of_date": base.get("as_of_date") or g.get("as_of_date", ""),
                    "game_pk": g["game_pk"],
                    "pitcher_id": pid or "",
                    "pitcher_name": pname,
                    "throws": base.get("throws", "R"),
                    "opp_team_id": opp_id or "",
                    "opp_abbr": opp_abbr,
                    "pa": base.get("pa", 0),
                    "k_pct": base.get("k_pct", ""),
                    "bb_pct": base.get("bb_pct", ""),
                    "avg": base.get("avg", ""),
                    "woba": base.get("woba", ""),
                    "exit_velo": base.get("exit_velo", ""),
                    "launch_angle": base.get("launch_angle", ""),
                    "xba": base.get("xba", ""),
                    "xslg": base.get("xslg", ""),
                    "xwoba": base.get("xwoba", ""),
                    "never_faced": base.get("never_faced", 0),
                    "sample_flag": base.get("sample_flag", "ok"),
                }
            )
    return out


def enrich_team_rows(rows: list[dict], schedule: list[dict]) -> list[dict]:
    """Map team_name → team_id / abbr using today's schedule teams."""
    id_by_abbr: dict[str, int] = {}
    for g in schedule:
        for ab, tid in (
            (g.get("away_abbr"), g.get("away_team_id")),
            (g.get("home_abbr"), g.get("home_team_id")),
        ):
            if ab and tid:
                id_by_abbr[ab] = tid
    name_abbr = {abbr_from_team_name(r["team_name"]): r for r in rows}
    out = []
    for r in rows:
        ab = abbr_from_team_name(r["team_name"])
        out.append(
            {
                **r,
                "abbr": ab,
                "team_id": id_by_abbr.get(ab, ""),
            }
        )
    return out


def write_csv(path: Path, fields: list[str], rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        for row in rows:
            w.writerow({k: row.get(k, "") for k in fields})


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default=slate_date_default(), help="Slate date YYYY-MM-DD")
    ap.add_argument("--year", type=int, default=0, help="Statcast season year (default: date year)")
    ap.add_argument("--skip-team", action="store_true", help="Skip team context CSV fetch")
    args = ap.parse_args()
    slate = args.date
    year = args.year or int(slate[:4])

    print(f"Savant ETL slate={slate} year={year}")

    schedule = fetch_schedule(slate)
    for g in schedule:
        g["as_of_date"] = slate
    print(f"  statsapi games: {len(schedule)}")

    r = requests.get(PROBABLE_URL, headers={"User-Agent": USER_AGENT}, timeout=120)
    r.raise_for_status()
    parsed = parse_probable_pitchers_html(r.text, slate)
    print(f"  savant matchup blocks: {len(parsed)}")

    matchups = join_matchups_to_schedule(parsed, schedule)
    print(f"  matchup rows (joined): {len(matchups)}")

    write_csv(OUT_DIR / "savant_matchup_daily.csv", MATCHUP_FIELDS, matchups)

    if not args.skip_team:
        try:
            raw = fetch_team_context_csv(year)
            teams = parse_team_discipline_csv(raw, slate)
            teams = enrich_team_rows(teams, schedule)
            print(f"  team context rows: {len(teams)}")
            write_csv(OUT_DIR / "savant_team_context.csv", TEAM_FIELDS, teams)
        except Exception as e:
            print(f"  WARN team context fetch failed: {e}", file=sys.stderr)

    print(f"Done → {OUT_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
