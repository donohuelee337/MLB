"""Parse Baseball Savant probable-pitchers HTML into matchup rows."""
from __future__ import annotations

import re
from typing import Any

from bs4 import BeautifulSoup

OPP_LABEL_TO_ABBR = {
    "toronto blue jays": "TOR",
    "baltimore orioles": "BAL",
    "san diego padres": "SD",
    "washington nationals": "WSN",
    "minnesota twins": "MIN",
    "pittsburgh pirates": "PIT",
    "boston red sox": "BOS",
    "cleveland guardians": "CLE",
    "los angeles angels": "LAA",
    "tampa bay rays": "TB",
    "atlanta braves": "ATL",
    "cincinnati reds": "CIN",
    "miami marlins": "MIA",
    "new york mets": "NYM",
    "detroit tigers": "DET",
    "chicago white sox": "CWS",
    "milwaukee brewers": "MIL",
    "houston astros": "HOU",
    "kansas city royals": "KC",
    "texas rangers": "TEX",
    "san francisco giants": "SF",
    "colorado rockies": "COL",
    "new york yankees": "NYY",
    "athletics": "OAK",
    "arizona diamondbacks": "ARI",
    "seattle mariners": "SEA",
    "philadelphia phillies": "PHI",
    "los angeles dodgers": "LAD",
    "chicago cubs": "CHC",
    "st. louis cardinals": "STL",
    "st louis cardinals": "STL",
}


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip().lower())


def _pct(cell: str) -> float | None:
    s = (cell or "").strip().replace("%", "")
    if not s:
        return None
    try:
        v = float(s)
        return v / 100.0 if v > 1 else v
    except ValueError:
        return None


def _num(cell: str) -> float | None:
    s = (cell or "").strip().replace(" MPH", "").replace("mph", "").lstrip(".")
    if not s or s == "-":
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _opp_abbr(label: str) -> str:
    t = _norm(label)
    m = re.search(r"current\s+(.+?)\s+roster", t)
    if not m:
        return ""
    return OPP_LABEL_TO_ABBR.get(m.group(1).strip(), "")


def _throws_from_h3(h3) -> str:
    block = h3.get_text(" ", strip=True).lower()
    return "L" if "throws: left" in block or "throws:left" in block else "R"


def _tables_after(h4, limit: int = 2) -> list:
    out = []
    for sib in h4.next_siblings:
        if getattr(sib, "name", None) == "table":
            out.append(sib)
            if len(out) >= limit:
                break
        elif getattr(sib, "name", None) in ("h2", "h3", "h4"):
            break
    if len(out) < limit:
        out = h4.find_all_next("table", limit=limit)
    return out


def _row_from_tables(tables: list, never: bool) -> dict[str, Any]:
    pa = k_pct = bb_pct = avg = woba = None
    exit_velo = launch_angle = xba = xslg = xwoba = None
    if tables:
        trs = tables[0].find_all("tr")
        if len(trs) >= 2:
            cells = [c.get_text(strip=True) for c in trs[1].find_all(["td", "th"])]
            if len(cells) >= 5:
                pa = _num(cells[0])
                k_pct = _pct(cells[1])
                bb_pct = _pct(cells[2])
                avg = _num("." + cells[3] if cells[3].startswith(".") else cells[3])
                woba = _num("." + cells[4] if cells[4].startswith(".") else cells[4])
        if len(tables) >= 2:
            trs2 = tables[1].find_all("tr")
            if len(trs2) >= 2:
                c2 = [c.get_text(strip=True) for c in trs2[1].find_all(["td", "th"])]
                if len(c2) >= 5:
                    exit_velo = _num(c2[0])
                    launch_angle = _num(c2[1])
                    xba = _num("." + c2[2] if c2[2].startswith(".") else c2[2])
                    xslg = _num("." + c2[3] if c2[3].startswith(".") else c2[3])
                    xwoba = _num("." + c2[4] if c2[4].startswith(".") else c2[4])
    pa_i = int(pa) if pa is not None else 0
    if never:
        flag = "never_faced"
    elif pa_i < 30:
        flag = "low_pa"
    else:
        flag = "ok"
    return {
        "pa": pa_i,
        "k_pct": k_pct,
        "bb_pct": bb_pct,
        "avg": avg,
        "woba": woba,
        "exit_velo": exit_velo,
        "launch_angle": launch_angle,
        "xba": xba,
        "xslg": xslg,
        "xwoba": xwoba,
        "never_faced": 1 if never else 0,
        "sample_flag": flag,
    }


def parse_probable_pitchers_html(html: str, as_of_date: str) -> list[dict[str, Any]]:
    soup = BeautifulSoup(html, "html.parser")
    rows: list[dict[str, Any]] = []
    away_team = ""
    home_team = ""
    pitcher_name = ""
    throws = "R"

    for tag in soup.find_all(["h2", "h3", "h4"]):
        if tag.name == "h2":
            txt = tag.get_text(" ", strip=True)
            m = re.match(r"(.+?)\s+@\s+(.+)", txt)
            if m:
                away_team, home_team = m.group(1).strip(), m.group(2).strip()
            continue
        if tag.name == "h3":
            pitcher_name = tag.get_text(" ", strip=True)
            throws = _throws_from_h3(tag)
            continue
        if tag.name == "h4":
            label = tag.get_text(" ", strip=True)
            never = "never faced" in label.lower()
            opp_abbr = _opp_abbr(label)
            stats = _row_from_tables(_tables_after(tag), never)
            rows.append(
                {
                    "as_of_date": as_of_date,
                    "pitcher_name": pitcher_name,
                    "throws": throws,
                    "opp_abbr": opp_abbr,
                    "away_team": away_team,
                    "home_team": home_team,
                    **stats,
                }
            )
    return rows
