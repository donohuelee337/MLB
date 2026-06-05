"""MLB Stats API schedule + probables for Savant ETL."""
from __future__ import annotations

import re
from datetime import datetime
from typing import Any

import requests

STATSAPI = "https://statsapi.mlb.com/api/v1"
USER_AGENT = "mlb-boiz-savant-etl/1.0 (+https://github.com/mlb-boiz)"


def fetch_schedule(date_str: str) -> list[dict[str, Any]]:
    """Return slate rows: game_pk, away/home abbr, probable pitcher ids/names."""
    url = (
        f"{STATSAPI}/schedule"
        f"?sportId=1&date={date_str}&hydrate=probablePitcher,team"
    )
    r = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=60)
    r.raise_for_status()
    data = r.json()
    out: list[dict[str, Any]] = []
    for day in data.get("dates") or []:
        for g in day.get("games") or []:
            game_pk = g.get("gamePk")
            if not game_pk:
                continue
            away = g.get("teams", {}).get("away", {})
            home = g.get("teams", {}).get("home", {})
            away_team = away.get("team") or {}
            home_team = home.get("team") or {}
            away_prob = away.get("probablePitcher") or {}
            home_prob = home.get("probablePitcher") or {}
            out.append(
                {
                    "game_pk": int(game_pk),
                    "away_abbr": _team_abbr(away_team),
                    "home_abbr": _team_abbr(home_team),
                    "away_team_id": away_team.get("id"),
                    "home_team_id": home_team.get("id"),
                    "away_pitcher_id": away_prob.get("id"),
                    "away_pitcher_name": away_prob.get("fullName") or "",
                    "home_pitcher_id": home_prob.get("id"),
                    "home_pitcher_name": home_prob.get("fullName") or "",
                }
            )
    return out


def _team_abbr(team: dict) -> str:
    abbr = (team.get("abbreviation") or team.get("teamCode") or "").strip().upper()
    aliases = {
        "AZ": "ARI",
        "WSH": "WSN",
        "WAS": "WSN",
        "ATH": "OAK",
        "SF": "SF",
        "TB": "TB",
        "KC": "KC",
    }
    return aliases.get(abbr, abbr)


def slate_date_default() -> str:
    return datetime.now().strftime("%Y-%m-%d")
