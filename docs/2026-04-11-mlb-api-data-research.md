# MLB API & Data Sources — Verified Research

**Date:** 2026-04-11
**Purpose:** Document verified API endpoints, response shapes, data availability, and implementation notes for the AI-BOIZ MLB pipeline. All endpoints tested with live 2026 data unless noted.

---

## 1. MLB Stats API (Primary — Free, No Auth)

**Base URL:** `https://statsapi.mlb.com/api/v1/`
**Auth:** None. Fully open.
**Format:** JSON
**Apps Script:** Works directly via `UrlFetchApp.fetch()`

### Verified Endpoints

#### Schedule (with Probable Pitchers)

```
GET /schedule?sportId=1&date=2026-04-11&hydrate=probablePitcher
```

**Response shape** (confirmed live):
```json
{
  "totalGames": 15,
  "dates": [{
    "games": [{
      "gamePk": 823480,
      "gameDate": "2026-04-11T17:05:00Z",
      "officialDate": "2026-04-11",
      "status": { "abstractGameState": "Preview", "detailedState": "Scheduled" },
      "teams": {
        "away": {
          "team": { "id": 109, "name": "Arizona Diamondbacks" },
          "leagueRecord": { "wins": 8, "losses": 6 },
          "probablePitcher": { "id": 694297, "fullName": "Brandon Pfaadt" }
        },
        "home": {
          "team": { "id": 143, "name": "Philadelphia Phillies" },
          "leagueRecord": { "wins": 6, "losses": 7 },
          "probablePitcher": { "id": 592836, "fullName": "Taijuan Walker" }
        }
      },
      "venue": { "id": 2681, "name": "Citizens Bank Park" },
      "dayNight": "day",
      "scheduledInnings": 9
    }]
  }]
}
```

**Key fields for pipeline:**
- `gamePk` — unique game ID, needed for boxscore/feed/live lookups
- `teams.away/home.probablePitcher` — may be absent if not yet announced
- `venue.id` / `venue.name` — links to park factors
- `gameDate` — UTC timestamp
- `dayNight` — "day" or "night" (relevant for day-after-night signal)
- `status.abstractGameState` — "Preview" / "Live" / "Final"

#### Pitcher Game Log

```
GET /people/{playerId}/stats?stats=gameLog&group=pitching&season=2026
```

**Response shape** (confirmed — Brandon Pfaadt, id 694297):
```json
{
  "stats": [{
    "splits": [{
      "date": "2026-03-31",
      "stat": {
        "summary": "6.0 IP, 5 ER, 3 K, BB",
        "gamesPlayed": 1, "gamesStarted": 1,
        "inningsPitched": "6.0", "strikeOuts": 3, "baseOnBalls": 1,
        "hits": 6, "earnedRuns": 5, "homeRuns": 0,
        "numberOfPitches": 85, "strikes": 57,
        "era": "7.50", "whip": "1.17",
        "battersFaced": 24, "outs": 18,
        "strikeoutsPer9Inn": "4.50", "walksPer9Inn": "1.50",
        "hitsPer9Inn": "9.00"
      },
      "opponent": { "id": 116, "name": "Detroit Tigers" },
      "isHome": true, "isWin": true,
      "game": { "gamePk": 825107 }
    }]
  }]
}
```

**Key pitching stats available per game:** IP, K, BB, H, ER, HR, pitches, strikes, BF, outs, ERA, WHIP, K/9, BB/9, H/9, ground/air outs. Everything needed for projection.

#### Batter Game Log

```
GET /people/{playerId}/stats?stats=gameLog&group=hitting&season=2026
```

**Response shape** (confirmed — Shohei Ohtani, id 660271):
```json
{
  "stats": [{
    "splits": [{
      "date": "2026-04-03",
      "stat": {
        "summary": "2-5 | HR, 2 K, 4 RBI",
        "gamesPlayed": 1,
        "atBats": 5, "plateAppearances": 6,
        "hits": 2, "doubles": 0, "triples": 0, "homeRuns": 1,
        "strikeOuts": 2, "baseOnBalls": 0,
        "totalBases": 5, "rbi": 4, "runs": 1,
        "stolenBases": 0, "caughtStealing": 0,
        "avg": ".217", "obp": ".406", "slg": ".348",
        "babip": ".333", "numberOfPitches": 22
      },
      "opponent": { "id": 120, "name": "Washington Nationals" },
      "isHome": false, "isWin": true,
      "positionsPlayed": [{ "abbreviation": "DH" }],
      "game": { "gamePk": 822758 }
    }]
  }]
}
```

**Key batting stats per game:** AB, PA, H, 2B, 3B, HR, K, BB, TB, RBI, R, SB, CS, AVG, OBP, SLG, BABIP, pitches seen, position played. Complete for projection.

**Note:** Ohtani shows `positionsPlayed: ["P", "DH"]` on two-way days — useful for detecting pitching starts.

#### Team Roster

```
GET /teams/{teamId}/roster?rosterType=active&season=2026
```

**Response shape** (confirmed — LAD, id 119):
```json
{
  "roster": [{
    "person": { "id": 660271, "fullName": "Shohei Ohtani" },
    "jerseyNumber": "17",
    "position": { "code": "Y", "name": "Two-Way Player", "type": "Two-Way Player", "abbreviation": "TWP" },
    "status": { "code": "A", "description": "Active" }
  }]
}
```

**Position codes:** 1=P, 2=C, 3=1B, 4=2B, 5=3B, 6=SS, 7=LF, 8=CF, 9=RF, 10=DH, Y=TWP

#### Boxscore

```
GET /game/{gamePk}/boxscore
```

**Size warning:** ~166KB for a completed game. Very detailed — contains full batting/pitching lines for all players, fielding info, and game notes. For pipeline use, the game log endpoints are more efficient (one call per player vs one massive call per game).

#### All 30 Teams

```
GET /teams?sportId=1&season=2026
```

Returns all 30 active MLB teams with:
- `id` — API team ID
- `abbreviation` — 2-3 letter code (NYY, LAD, etc.)
- `venue.id` / `venue.name` — home park
- `league` / `division` — for standings context
- `teamName`, `shortName`, `franchiseName`

### Team ID → Abbreviation Map (Verified 2026)

| ID | Abbreviation | Team | Venue |
|----|-------------|------|-------|
| 108 | LAA | Los Angeles Angels | Angel Stadium |
| 109 | AZ | Arizona Diamondbacks | Chase Field |
| 110 | BAL | Baltimore Orioles | Oriole Park at Camden Yards |
| 111 | BOS | Boston Red Sox | Fenway Park |
| 112 | CHC | Chicago Cubs | Wrigley Field |
| 113 | CIN | Cincinnati Reds | Great American Ball Park |
| 114 | CLE | Cleveland Guardians | Progressive Field |
| 115 | COL | Colorado Rockies | Coors Field |
| 116 | DET | Detroit Tigers | Comerica Park |
| 117 | HOU | Houston Astros | Daikin Park |
| 118 | KC | Kansas City Royals | Kauffman Stadium |
| 119 | LAD | Los Angeles Dodgers | UNIQLO Field at Dodger Stadium |
| 120 | WSH | Washington Nationals | Nationals Park |
| 121 | NYM | New York Mets | Citi Field |
| 133 | ATH | Athletics | Sutter Health Park |
| 134 | PIT | Pittsburgh Pirates | PNC Park |
| 135 | SD | San Diego Padres | Petco Park |
| 136 | SEA | Seattle Mariners | T-Mobile Park |
| 137 | SF | San Francisco Giants | Oracle Park |
| 138 | STL | St. Louis Cardinals | Busch Stadium |
| 139 | TB | Tampa Bay Rays | Tropicana Field |
| 140 | TEX | Texas Rangers | Globe Life Field |
| 141 | TOR | Toronto Blue Jays | Rogers Centre |
| 142 | MIN | Minnesota Twins | Target Field |
| 143 | PHI | Philadelphia Phillies | Citizens Bank Park |
| 144 | ATL | Atlanta Braves | Truist Park |
| 145 | CWS | Chicago White Sox | Rate Field |
| 146 | MIA | Miami Marlins | loanDepot park |
| 147 | NYY | New York Yankees | Yankee Stadium |
| 158 | MIL | Milwaukee Brewers | American Family Field |

**Note:** Athletics moved to Sacramento (Sutter Health Park) — team abbreviation changed from OAK to ATH. Houston venue is now "Daikin Park". Dodger Stadium is now "UNIQLO Field at Dodger Stadium".

### Additional Endpoints (Not Yet Tested)

```
Sabermetrics:    /people/{id}?hydrate=stats(group=[hitting],type=[sabermetrics],season=2026)
Standings:       /standings?leagueId=103,104&season=2026
Player search:   /people/search?names=Shohei%20Ohtani
Live feed:       /game/{gamePk}/feed/live    (contains lineups, umpires, play-by-play)
```

The live feed endpoint is the richest — it includes confirmed lineups, umpire assignments (in `liveData.boxscore.officials`), and play-by-play. It's also the largest response.

---

## 2. Baseball Savant (Statcast Data — Free, No Auth)

**Base URL:** `https://baseballsavant.mlb.com/`
**Auth:** None
**Format:** CSV or JS-rendered HTML (no clean JSON API)
**Apps Script:** Works via `UrlFetchApp` but requires CSV parsing

### Endpoint Status

| Endpoint | Status | Notes |
|----------|--------|-------|
| Statcast Search CSV | **Timeout** | Heavy query, may need date chunking (max 7-day windows) |
| Expected Stats Leaderboard CSV | **500 Error** | `?csv=true` param returned server error; may be rate-limited or seasonal |
| Custom Leaderboard CSV | **500 Error** | Same issue as expected stats |
| Park Factors page | **JS-rendered** | Cannot scrape directly; data not in static HTML |
| ABS Challenge Dashboard | **Available** | `baseballsavant.mlb.com/abs` |
| ABS Challenge Leaderboard | **Available** | `baseballsavant.mlb.com/leaderboard/abs-challenges` |

### Implementation Strategy for Apps Script

Savant CSV endpoints are unreliable for direct `UrlFetchApp` calls due to:
1. Heavy server-side processing (queries can timeout)
2. Rate limiting on CSV exports
3. 25,000 row limit per query

**Recommended approach:**
- **Option A (Manual refresh):** Download CSV manually, paste into a Google Sheet tab, reference from Apps Script. Refresh weekly.
- **Option B (Date-chunked fetches):** Break Statcast search into 1-day windows with specific player IDs to keep response size small.
- **Option C (Cloud Function sidecar):** Use a lightweight Cloud Function with `pybaseball` (Python) to fetch and cache Savant data, expose a simple JSON API for Apps Script.

**Priority data from Savant:**
- xBA, xSLG, xwOBA (expected stats for BABIP regression detection)
- Barrel rate, hard-hit rate (quality of contact indicators)
- Pitch-type performance (for matchup analysis)
- ABS challenge data (for umpire signal adjustment)

---

## 3. ESPN MLB Injuries (Free, No Auth)

```
GET https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/injuries
```

**Status:** Confirmed working. Returns ~976KB JSON with all team injuries.
**Format:** Same pattern as the NBA injuries endpoint already used in AI-BOIZ.
**Apps Script:** Direct `UrlFetchApp.fetch()`, identical to existing NBA implementation.

MLB injury structure is simpler than NBA:
- Players are on the **IL** (10-day, 15-day, 60-day) or **active**
- No "questionable" / "doubtful" ambiguity
- Cleaner for modeling: a player is either available or not

---

## 4. Park Factors Reference Table

Compiled from FanGraphs Guts (2025 5-year regressed), Baseball Savant (2025 1-year), and FantasyPros analysis. Values are indexed to 100 (100 = neutral).

### Runs & Home Runs (Primary Factors)

| Venue (Team) | Venue ID | Runs | HR | Roof | Notes |
|--------------|----------|------|-----|------|-------|
| Coors Field (COL) | 19 | 128+ | 115+ | Open | Everything inflated. The ultimate Over park. Altitude + dry air. |
| Sutter Health Park (ATH) | 2529 | 115+ | 110+ | Open | New MLB venue 2025. Ran very hot in inaugural year. |
| Great American Ball Park (CIN) | 2602 | 108 | 117 | Open | #1 HR park. Short dimensions, river carries. |
| Fenway Park (BOS) | 3 | 106 | ~92 | Open | Boosts hits/runs (Green Monster doubles) but suppresses HR. |
| Comerica Park (DET) | 2394 | 108+ | ~100 | Open | Newly run-friendly. Dimensions changed. |
| Target Field (MIN) | 3312 | 105+ | ~100 | Open | Wind-dependent. Can play both ways. |
| Citizens Bank Park (PHI) | 2681 | 103 | 108 | Open | HR-friendly, especially to right-center. |
| UNIQLO Field/Dodger Stadium (LAD) | 22 | ~100 | 107+ | Open | HR factor rose recently. Slightly above neutral. |
| Oriole Park at Camden Yards (BAL) | 2 | 102+ | 112+ | Open | Post-2025 renovation = launching pad. LHB HR heaven. |
| Yankee Stadium (NYY) | 3313 | 105 | 110+ | Open | Short right field porch. LHB HR boost. |
| loanDepot park (MIA) | 4169 | 105+ | ~100 | Retractable | Humidor removed pre-2025. Runs jumped. |
| Kauffman Stadium (KC) | 7 | 106 | 100+ | Open | Walls moved in for 2026. HR expected to rise. |
| Progressive Field (CLE) | 5 | ~100 | ~100 | Open | Neutral. |
| Rate Field (CWS) | 4 | ~100 | ~100 | Open | Neutral. |
| Nationals Park (WSH) | 3309 | ~100 | ~100 | Open | Neutral. |
| Truist Park (ATL) | 4705 | ~100 | ~100 | Open | Neutral. |
| PNC Park (PIT) | 31 | ~98 | ~92 | Open | Slight pitcher lean. Spacious dimensions. |
| Wrigley Field (CHC) | 17 | ~95 | ~98 | Open | Wind-dependent. Can be extreme either way. |
| Citi Field (NYM) | 3289 | ~95 | ~97 | Open | Mild suppression. |
| Busch Stadium (STL) | 2889 | ~98 | ~90 | Open | HR suppressor. |
| Oracle Park (SF) | 2395 | 90 | 80-85 | Open | Significant HR suppression, especially to right-center. |
| Petco Park (SD) | 2680 | 92 | 88 | Open | Pitcher-friendly. Marine layer suppresses fly balls. |
| T-Mobile Park (SEA) | 680 | 88 | 90 | Retractable | Lowest run-scoring park in MLB. Marine layer. |
| Globe Life Field (TEX) | 5325 | ~100 | ~100 | Retractable | Climate-controlled. Neutral. |
| American Family Field (MIL) | 32 | ~100 | ~100 | Retractable | Roof closed = neutral. |
| Rogers Centre (TOR) | 14 | ~100 | ~100 | Retractable | Climate-controlled. Neutral. |
| Tropicana Field (TB) | 12 | ~96 | ~95 | Dome | Indoor. Slight pitcher lean. Catwalks can eat HRs. |
| Daikin Park (HOU) | 2392 | ~100 | ~100 | Retractable | Roof closed = neutral. |
| Chase Field (AZ) | 15 | ~100 | ~88 | Retractable | HR suppressor despite hot climate. Humidor effect. |
| Angel Stadium (LAA) | 1 | ~100 | ~100 | Open | Neutral. |

### Dome/Retractable Roof Parks (Weather-Neutral)

These parks should bypass weather adjustments when roof is closed:
- **Full dome:** Tropicana Field (TB)
- **Retractable:** Globe Life Field (TEX), American Family Field (MIL), Rogers Centre (TOR), Daikin Park (HOU), Chase Field (AZ), T-Mobile Park (SEA), loanDepot park (MIA)

### Implementation Notes

- Store as a static object in Apps Script, keyed by venue ID
- Include `runs`, `hr`, `hits`, `roofType` properties
- Refresh annually (park factors are stable year-to-year except after renovations)
- For 2026 specifically, monitor Kauffman Stadium (new dimensions) and Sutter Health Park (second year data)

---

## 5. Weather API — OpenWeatherMap

**Endpoint:** `https://api.openweathermap.org/data/2.5/weather`
**Auth:** API key required (free tier)
**Format:** JSON
**Free tier:** 1,000,000 calls/month, 60 calls/minute

### Free Tier Sufficiency for MLB

| Usage | Calls/Day | Monthly |
|-------|-----------|---------|
| 15 games × 3 checks/game | 45 | ~1,350 |
| Hourly checks × 15 parks × 12 hours | 180 | ~5,400 |
| **Total worst case** | ~225 | ~6,750 |

Free tier (1M calls/month) is massively oversized for this use case. No paid plan needed.

### Request Format

```
GET https://api.openweathermap.org/data/2.5/weather?lat={lat}&lon={lon}&appid={key}&units=imperial
```

Using lat/lon (instead of city name) is more precise for ballparks in metro areas.

### Park Coordinates & Wind Orientation

Wind direction matters relative to the park's home-plate-to-center-field orientation. "Wind blowing out" means wind traveling from home plate toward center field.

| Venue | Lat | Lon | CF Bearing (°) | Notes |
|-------|-----|-----|----------------|-------|
| Coors Field | 39.756 | -104.994 | ~205 (SSW) | Already altitude-adjusted. Wind is bonus. |
| Great American Ball Park | 39.097 | -84.508 | ~210 (SSW) | River wind can blow out. |
| Wrigley Field | 41.948 | -87.656 | ~215 (SSW) | Wind off Lake Michigan is the #1 variable. |
| Yankee Stadium | 40.829 | -73.927 | ~200 (SSW) | Short porch amplifies wind-out effect. |
| Fenway Park | 42.346 | -71.097 | ~200 (SSW) | Green Monster blocks some wind effect. |
| Citizens Bank Park | 39.906 | -75.167 | ~210 (SSW) | Open outfield, wind matters. |
| Oracle Park | 37.778 | -122.389 | ~215 (SSW) | McCovey Cove wind usually blows IN. |
| Petco Park | 32.707 | -117.157 | ~210 (SSW) | Marine layer more than wind. |
| T-Mobile Park | 47.591 | -122.333 | ~180 (S) | Retractable roof, but open = marine layer. |

### Wind Signal Calculation

```
wind_bearing = weather_api.wind.deg
cf_bearing = PARK_ORIENTATIONS[venue_id]

angle_diff = abs(wind_bearing - cf_bearing)
if angle_diff > 180: angle_diff = 360 - angle_diff

if angle_diff < 45:      wind_effect = "blowing_out"
elif angle_diff > 135:    wind_effect = "blowing_in"
else:                     wind_effect = "crosswind"

wind_speed = weather_api.wind.speed  // mph

if wind_effect == "blowing_out" and wind_speed >= 15:
    hr_adjustment = 1.15 to 1.25  // +15-25% HR rate
elif wind_effect == "blowing_in" and wind_speed >= 15:
    hr_adjustment = 0.80 to 0.85  // -15-20% HR rate
else:
    hr_adjustment = 1.00
```

### Temperature Signal

```
temp = weather_api.main.temp  // °F

if temp >= 85: temp_hr_boost = 1.08 to 1.12
elif temp >= 75: temp_hr_boost = 1.03 to 1.05
elif temp <= 45: temp_hr_penalty = 0.92 to 0.95
else: temp_hr_boost = 1.00
```

### Implementation in Apps Script

```javascript
function fetchWeather_(lat, lon) {
  var key = PropertiesService.getScriptProperties().getProperty('OWM_KEY');
  var url = 'https://api.openweathermap.org/data/2.5/weather'
    + '?lat=' + lat + '&lon=' + lon
    + '&appid=' + key + '&units=imperial';
  var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  return JSON.parse(resp.getContentText());
}
```

---

## 6. Data Flow Architecture Summary

```
                                   ┌──────────────────────┐
                                   │  The Odds API         │
                                   │  baseball_mlb         │
                                   │  (player props)       │
                                   └──────────┬───────────┘
                                              │
┌──────────────────┐   ┌──────────────────┐   │   ┌──────────────────┐
│ MLB Stats API    │   │ ESPN Injuries    │   │   │ OpenWeatherMap   │
│ - Schedule       │   │ - IL status      │   │   │ - Temp, wind     │
│ - Game logs      │   │                  │   │   │                  │
│ - Rosters        │   └────────┬─────────┘   │   └────────┬─────────┘
│ - Probable       │            │             │            │
│   pitchers       │            │             │            │
│ - Lineups        │            │             │            │
│ - Umpires        │            │             │            │
└────────┬─────────┘            │             │            │
         │                      │             │            │
         ▼                      ▼             ▼            ▼
    ┌─────────────────────────────────────────────────────────┐
    │              Google Apps Script Pipeline                 │
    │                                                         │
    │  Fetch → Slate → Projection → Sim Engine → Bet Card    │
    │                                                         │
    └─────────────────────────────────────────────────────────┘
         │
         ▼
    ┌──────────────────────┐
    │ Baseball Savant       │
    │ (weekly CSV refresh)  │
    │ - xBA, xSLG, xwOBA   │
    │ - ABS challenge data  │
    │ - Barrel rate         │
    └──────────────────────┘
```

**Real-time sources** (fetched each pipeline run): MLB Stats API, Odds API, ESPN Injuries, OpenWeatherMap
**Periodic sources** (refreshed weekly/manually): Baseball Savant Statcast CSV, Park Factors table, Umpire profiles

---

## 7. API Quota & Cost Summary

| Source | Cost | Auth | Calls/Day Estimate | Limit |
|--------|------|------|-------------------|-------|
| MLB Stats API | Free | None | ~50-100 | No published limit (be respectful) |
| The Odds API | Existing key | API key | ~100-200 (sport key change only) | Plan-dependent |
| ESPN Injuries | Free | None | 1-3 | No published limit |
| OpenWeatherMap | Free | API key (free tier) | ~50-225 | 1M/month |
| Baseball Savant | Free | None | ~5-10 (weekly) | 25K rows/query, rate limited |

**Total incremental cost:** $0/month for all new data sources. Only existing Odds API plan may need upgrade for higher polling frequency (~$59/mo for 100K credits if daily MLB + NBA).
