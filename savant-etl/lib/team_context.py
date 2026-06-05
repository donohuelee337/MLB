"""Team-level Statcast context from Savant CSV leaderboards."""
from __future__ import annotations

import csv
import io
from typing import Any

import requests

USER_AGENT = "mlb-boiz-savant-etl/1.0"

# Savant team plate-discipline export (batting side = offense whiff/chase)
TEAM_DISCIPLINE_URL = (
    "https://baseballsavant.mlb.com/leaderboard/team-stats"
    "?type=batter&year={year}&team=&min=1"
    "&group=plate-discipline&csv=true"
)


def _norm_header(h: str) -> str:
    return "".join(c if c.isalnum() else "_" for c in h.lower()).strip("_")


def fetch_team_context_csv(year: int) -> str:
    url = TEAM_DISCIPLINE_URL.format(year=year)
    r = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=120)
    r.raise_for_status()
    return r.text


def parse_team_discipline_csv(text: str, as_of_date: str) -> list[dict[str, Any]]:
    """Parse Savant team-stats plate-discipline CSV into team context rows."""
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        return []
    fields = {_norm_header(f): f for f in reader.fieldnames}
    team_col = fields.get("team") or fields.get("team_name") or fields.get("name")
    whiff_col = fields.get("whiff") or fields.get("whiff_pct") or fields.get("whiff_percent")
    chase_col = fields.get("chase") or fields.get("chase_pct") or fields.get("chase_percent")
    if not team_col:
        return []

    rows: list[dict[str, Any]] = []
    for raw in reader:
        team_name = (raw.get(team_col) or "").strip()
        if not team_name or team_name.upper() == "MLB":
            continue
        whiff = _pct_val(raw.get(whiff_col or "", ""))
        chase = _pct_val(raw.get(chase_col or "", ""))
        rows.append(
            {
                "as_of_date": as_of_date,
                "team_name": team_name,
                "whiff_pct": whiff,
                "chase_pct": chase,
                "source": "savant_team_plate_discipline",
            }
        )
    return rows


def _pct_val(s: str) -> float | None:
    s = (s or "").strip().replace("%", "")
    if not s:
        return None
    try:
        v = float(s)
        return round(v / 100.0 if v > 1 else v, 4)
    except ValueError:
        return None
