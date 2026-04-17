# AI-BOIZ MLB — Research Briefing

**Date:** 2026-04-11
**Purpose:** Map each AI-BOIZ (NBA) pipeline pillar to its MLB equivalent — data sources, methods, and exploitable edges.

---

## Pillar 1: Odds & Markets

### NBA (current)
- The Odds API, sport key `basketball_nba`
- FanDuel player props: PTS, REB, AST, 3PM, BLK, STL + combos (PRA, PA, PR, RA) + alt lines
- ~17 standard + ~12 alt market keys

### MLB equivalent
- **Same provider**: The Odds API, sport key **`baseball_mlb`**
- **32 player prop market keys** (19 standard + 13 alternate):

| Category | Standard Markets | Alt Markets |
|----------|-----------------|-------------|
| **Pitcher** | `pitcher_strikeouts`, `pitcher_hits_allowed`, `pitcher_walks`, `pitcher_earned_runs`, `pitcher_outs`, `pitcher_record_a_win` | `pitcher_strikeouts_alternate`, `pitcher_hits_allowed_alternate`, `pitcher_walks_alternate` |
| **Batter** | `batter_hits`, `batter_total_bases`, `batter_home_runs`, `batter_rbis`, `batter_runs_scored`, `batter_stolen_bases`, `batter_walks`, `batter_strikeouts`, `batter_singles`, `batter_doubles`, `batter_triples`, `batter_hits_runs_rbis`, `batter_first_home_run` | `batter_hits_alternate`, `batter_total_bases_alternate`, `batter_home_runs_alternate`, `batter_rbis_alternate`, `batter_runs_scored_alternate`, `batter_walks_alternate`, `batter_strikeouts_alternate`, `batter_singles_alternate`, `batter_doubles_alternate`, `batter_triples_alternate` |

- **Game-level markets**: `h2h`, `spreads` (run line), `totals`, `team_totals` + period markets (F1/F3/F5/F7 innings for ML, spreads, totals)
- **SGP supported** on FanDuel for MLB

### Key differences from NBA
- **Per-game volume is lower**: ~9 batters + 1 pitcher per team vs 10+ NBA players with minutes. Fewer total prop lines per game.
- **Most liquid props** (ranked): pitcher K's > batter total bases > batter hits > batter HR > batter RBI/runs
- **Staggered schedule**: MLB typically has 12-16 games spread from 12:35 PM to 10:10 PM ET. Props post and move at different times throughout the day, unlike NBA where everything centers around a single tip-off window.

### Timing
| Phase | Timing | What happens |
|-------|--------|--------------|
| Probable pitchers announced | Night before / early AM | Initial lines posted. Pitcher K props appear first. |
| Overnight / early morning | 12 AM - 10 AM ET | Game lines available. Some batter props begin. |
| Lineup confirmation | 1-3 hours before first pitch | Major line movement. Batter props finalize. Sharp money enters. |
| Pre-game convergence | 30 min before first pitch | Lines settle. |

**Critical**: If a scheduled starter gets scratched, all pitcher props and many batter props are pulled and re-posted.

### API quota planning
- With 15 games/day, a full prop sweep costs ~100+ credits per pass
- At hourly sweeps across 12 hours: ~1,000+ credits/day
- Recommended plan: **100K credits ($59/mo)** minimum for serious polling
- Endpoint pattern identical to NBA: `/v4/sports/baseball_mlb/events/{eventId}/odds`

---

## Pillar 2: Player Stats & Game Logs

### NBA (current)
- BallDontLie API (ALL-STAR key, JSON, free)
- Game logs, box scores, player stats, team IDs

### MLB equivalent — Primary: MLB Stats API

| Property | Value |
|----------|-------|
| Base URL | `https://statsapi.mlb.com/api/v1/` |
| Auth | **None required** — fully open |
| Format | JSON |
| Cost | Free |
| Apps Script | **Works directly via `UrlFetchApp`** |

**Key endpoints:**

```
Schedule:        /schedule?sportId=1&date=2025-07-04
Box score:       /game/{gamePk}/boxscore
Live feed:       /game/{gamePk}/feed/live
Batter logs:     /people/{id}/stats?stats=gameLog&group=hitting&season=2025
Pitcher logs:    /people/{id}/stats?stats=gameLog&group=pitching&season=2025
Sabermetrics:    /people/{id}?hydrate=stats(group=[hitting],type=[sabermetrics],season=2025)
Roster:          /teams/{teamId}/roster?season=2025
Player search:   /people/search?names=Shohei%20Ohtani
Standings:       /standings?leagueId=103,104&season=2025
```

**Verdict**: Direct BallDontLie replacement. Same JSON-over-HTTP pattern, zero auth, richer data.

### MLB equivalent — Secondary: Baseball Savant (Statcast)

| Property | Value |
|----------|-------|
| Base URL | `https://baseballsavant.mlb.com/` |
| Auth | None |
| Format | **CSV** (not JSON — requires parsing) |
| Cost | Free |
| Limit | 25,000 rows per query |
| Apps Script | **Works but needs CSV parsing & date chunking** |

**Key data**: exit velocity, launch angle, barrel rate, hard-hit%, xBA, xSLG, xwOBA, sprint speed, spin rate, pitch velocity, whiff rate, chase rate.

```
Pitch-level CSV:     /statcast_search/csv?all=true&player_type=batter&game_date_gt=2025-07-01&game_date_lt=2025-07-07
Expected stats:      /leaderboard/expected_statistics?type=batter&year=2025&min=q
Custom leaderboard:  /leaderboard/custom?year=2025&type=batter&min=q&selections=xba,xslg,xwoba
```

### MLB equivalent — Tertiary: FanGraphs (needs proxy)

No official API. Requires membership ($5.99/mo) for CSV exports. Unique data: **wRC+, FIP, xFIP, WAR, park factors, platoon splits, projections (ZiPS, Steamer, ATC)**.

**Recommended approach**: Periodic Google Sheet with manually refreshed FanGraphs data, or a lightweight Cloud Function running `pybaseball`.

### Data freshness

| Source | Update Speed |
|--------|-------------|
| MLB Stats API (live feed) | Real-time (~3-second cache during games) |
| MLB Stats API (game logs) | Minutes after game becomes Final |
| Baseball Savant (Statcast) | ~24 hours for advanced metrics (xBA, xwOBA) |
| FanGraphs | Next morning |

### Architecture recommendation
**Tier 1 (Apps Script direct)**: MLB Stats API for schedules, game logs, box scores, rosters, standings. Covers 80% of needs.
**Tier 2 (Apps Script direct with CSV parsing)**: Baseball Savant for Statcast metrics.
**Tier 3 (optional Cloud Function sidecar)**: FanGraphs for wRC+, FIP, WAR, park factors.

---

## Pillar 3: Injury / Roster / Lineup

### NBA (current)
- ESPN injury API: `site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries`
- ESPN roster API for team rosters
- Injury statuses: Out, Doubtful, Questionable, Day-To-Day

### MLB equivalent

**Injuries**: ESPN MLB injury endpoint:
```
https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/injuries
```
Same pattern as NBA. JSON, no auth, works from Apps Script.

MLB injury structure is simpler than NBA — players are either **on the IL** (10-day, 15-day, 60-day) or **active**. No "questionable" / "doubtful" ambiguity. This is cleaner for modeling.

**Probable pitchers** (the single most important MLB pregame data point):
```
https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2025-07-04&hydrate=probablePitcher
```
Returns the probable starter for each team. This is what triggers line posting.

**Confirmed lineups** (submitted ~1-3 hours before first pitch):
```
https://statsapi.mlb.com/api/v1/game/{gamePk}/feed/live
```
Contains confirmed lineups once posted. Before that, sources like Rotowire and RotoGrinders post "expected" lineups.

**Rosters**:
```
https://statsapi.mlb.com/api/v1/teams/{teamId}/roster?rosterType=active&season=2025
```

**Bullpen availability** (unique to MLB, analogous to NBA minutes model):
- No direct API for "is this reliever available today"
- Must be computed from recent game logs: pitches thrown, innings pitched, days since last appearance
- Rule of thumb: 3 appearances in 4 days = likely unavailable. 25+ pitches yesterday = likely unavailable today.
- Compute from: `statsapi.mlb.com/api/v1/people/{id}/stats?stats=gameLog&group=pitching&season=2025`

---

## Pillar 4: Contextual Signals

### NBA (current) → MLB equivalent

| NBA Signal | MLB Equivalent | Data Source | Magnitude |
|------------|---------------|-------------|-----------|
| **Referee tendencies** (Zebra Grid) | **Home plate umpire zone** | UmpScorecards.com, MLB Stats API | K rates swing 10-20% between loose/tight umps |
| **Defensive ratings** (by position) | **Park factors** (by stat category) | FanGraphs Guts! page, ESPN | Coors Field = +25-30% runs; Oracle Park suppresses HR by ~15% |
| **Team momentum / streaks** | **Team momentum / streaks** | MLB Stats API standings, game logs | Similar concept, applies to totals and team props |
| **Blowout / tank game** | **Blowout risk** (large spread favorites) | Vegas spread from odds API | Starters pulled early in blowouts → affects all props |
| **Minutes volatility (CV)** | **Innings pitched volatility** (for pitchers) / **PA volatility** (for batters) | Game logs | Pitchers with high IP variance → unpredictable K totals |
| *No equivalent* | **Weather** (temp, wind, humidity) | Weather APIs (OpenWeather, etc.) | 10°F increase ≈ +5-8% HR rate. Wind blowing out at 15+ mph = significant |
| *No equivalent* | **Platoon splits** (L/R matchups) | FanGraphs, Baseball Savant | Same-hand matchups suppress BA by ~20-30 points, boost K% by 5-8% |
| *No equivalent* | **Bullpen fatigue** | Computed from game logs | Gassed bullpen → higher game totals, more late-inning scoring |
| *No equivalent* | **Day game after night game** | Schedule API | Offense typically depressed ~5-8% |
| *No equivalent* | **Catcher framing** | Baseball Savant, Statcast | Elite framers gain 1+ called strikes/game → boosts pitcher K props |

### Umpire signal detail (MLB's Zebra Grid)

The home plate umpire is the single largest "referee effect" in MLB — much bigger than NBA refs.

**Data sources**:
- **UmpScorecards.com**: Publishes daily umpire assignments with historical data (accuracy %, consistency, favor home/away, K rate, BB rate). Scrape-able HTML.
- **MLB Stats API**: Umpire assignments available in game data.
- **SwishAnalytics, Statfox**: Commercial umpire data.

**Key metrics for umpire signal**:
- Runs per game (avg in their games vs league avg)
- Strikeout rate (K/9 in their games vs league avg)
- Walk rate (BB/9 in their games vs league avg)
- Zone size tendency (tight = fewer K's, more walks; wide = more K's, fewer walks)

**Signal construction**: Same pattern as Zebra Grid. Build `UMPIRE_PROFILES` map, load today's assignments, compute alignment with bet direction.

### Park factors detail

Park factors are permanent structural edges — they don't change day-to-day like refs do. FanGraphs publishes component-level park factors:

| Park | HR Factor | Run Factor | Notes |
|------|-----------|------------|-------|
| Coors Field (COL) | ~130 | ~128 | Everything inflated. The ultimate Over park. |
| Great American (CIN) | ~115 | ~110 | HR-friendly, especially to left field |
| Yankee Stadium (NYY) | ~120 | ~105 | Short right field porch → LHB HR heaven |
| Oracle Park (SF) | ~80 | ~90 | Suppresses HR, especially to right-center |
| Petco Park (SD) | ~85 | ~90 | Pitcher-friendly |
| T-Mobile Park (SEA) | ~90 | ~95 | Suppresses offense |

**Implementation**: Static lookup table (like `REFEREE_PROFILES`), refreshed monthly. Apply as multiplier to projections.

### Weather implementation

Temperature and wind are the two biggest factors.

| Condition | Effect | Source |
|-----------|--------|--------|
| Temperature > 85°F | +8-12% HR rate vs 65°F games | OpenWeatherMap API |
| Wind blowing out > 15 mph | +15-25% HR rate | Weather API + park orientation data |
| Wind blowing in > 15 mph | -15-20% HR rate | Weather API + park orientation data |
| Humidity > 70% | Slight increase in ball carry | Weather API |
| Altitude (Denver) | Permanent +20-25% ball carry | Static (park factor) |

Dome/retractable roof parks (MIL, HOU, MIA, ARI, TOR, TEX, SEA) are weather-neutral when roof is closed.

---

## Pillar 5: Projection Model

### NBA (current)
- Weighted median projection: 0.35 × L7 + 0.25 × L30 + 0.20 × H2H + 0.10 × splits + 0.10 × season
- Minutes-based projection: project minutes first, multiply by per-minute rate
- Anchored projection: 85% FD line + 15% our model

### MLB equivalent: Marcel-style + PA/IP-based projection

The MLB "minutes = money" insight is: **Plate Appearances = Money** for batters, **Innings Pitched = Money** for pitchers.

**Step 1: Establish rate stats** (Marcel-style weighting)

For batters, project per-PA rates:
```
Weighted Rate = (Rate_Y1 × PA_Y1 × 5 + Rate_Y2 × PA_Y2 × 4 + Rate_Y3 × PA_Y3 × 3) / Total_Weighted_PA
Regressed Rate = (Weighted_Rate × Total_PA + League_Avg × 1200) / (Total_PA + 1200)
```

Key rates to project: K%, BB%, HR/PA, H/PA, 2B/PA, 3B/PA, TB/PA, SB/opportunity

For pitchers, project per-IP or per-batter-faced rates:
```
K/9, BB/9, HR/9, H/9 (or K%, BB%, HR/PA against)
Regression PA: ~900 batters faced of league-average performance
```

**Step 2: Project today's playing time**

For batters — estimate plate appearances:
| Lineup Spot | PA/Game (avg) |
|-------------|---------------|
| 1 | 4.7 |
| 2 | 4.6 |
| 3 | 4.5 |
| 4 | 4.4 |
| 5 | 4.3 |
| 6 | 4.2 |
| 7 | 4.1 |
| 8 | 4.0 |
| 9 | 3.9 |

Adjusted by: game total (higher total = more PA), team pace, opposing pitcher pace.

```
Projected_PA = BasePA(lineup_spot) × (GameTotal / LeagueAvgTotal) × PaceFactor
```

For pitchers — estimate innings pitched:
- Season IP / GS = average IP per start
- Adjust for: recent pitch counts, bullpen rest, opponent lineup quality, pitch count limits

**Step 3: Daily projection**
```
Projected Stat = Regressed Rate × Projected PA (or IP)
```

**Step 4: Matchup adjustments** (Log5 method)

Bill James' Log5 combines batter skill, pitcher skill, and league average:
```
P(outcome) = (pBatter × pPitcher) / [pBatter × pPitcher + (1 - pBatter)(1 - pPitcher)]
```

Apply platoon adjustments on top: same-hand matchups suppress BA ~20-30 points, boost K% ~5-8%.

**Step 5: Park + weather + umpire adjustments**

Multiply projection by park factor for that stat category, weather adjustment, and umpire zone adjustment.

**Step 6: Anchor to FD line**

Same anchored projection concept:
```
Anchored = FD_Line × (1 + anchor_weight × (our_proj - FD_Line) / FD_Line)
```

---

## Pillar 6: Statistical Engine

### NBA (current)
- Poisson CDF for discrete stats (PTS, REB, AST, BLK, STL, 3PM)
- Normal approximation for combo stats (PRA, PA, PR, RA)
- Z-score, EV, CV, Kelly criterion

### MLB: Distribution recommendations by prop type

| Prop | Best Distribution | Why | Lambda/Parameters |
|------|------------------|-----|-------------------|
| **Pitcher K's** | **Poisson** | Discrete count, independent events, stable rate. The best-fitting MLB Poisson application. | λ = K/9 × projected_IP/9 |
| **Batter hits** | **Binomial** (n=PA, p=adj_BA) or Poisson (λ=H/game) | Fixed number of trials (PA) with per-trial probability. Poisson works as approximation. | n ≈ 4, p ≈ .250-.300 |
| **Total bases** | **Normal approximation** | Sum of variable-value outcomes (0/1/2/3/4 bases per AB). Compound distribution → normal via CLT. | μ = TB/PA × PA, σ from game logs |
| **Home runs** | **Poisson** (very low λ) or **Bernoulli** | Rare events. Most batters HR in ~8% of games. Even a 40-HR hitter has λ ≈ 0.25/game. | λ = HR/PA × PA ≈ 0.15-0.30 |
| **RBIs** | **Poisson** (with contextual λ) | Count stat, but highly dependent on baserunner context. Projection is noisier. | λ adjusted for lineup protection |
| **Runs scored** | **Poisson** (with contextual λ) | Same context-dependence issue as RBI. | λ adjusted for lineup position |
| **Stolen bases** | **Poisson** (very low λ) or **Bernoulli** | Rare events for most players. Speed specialists may have λ ≈ 0.3-0.5. | λ = SB/game rate |
| **Pitcher ER** | **Poisson** | Discrete count of earned runs. FIP-based λ is more predictive than ERA-based. | λ = FIP-implied ER/start |
| **Hits + Runs + RBIs** | **Normal approximation** | Combo stat → sum of components → normal via CLT. | μ = sum of component projections |

### CV (Coefficient of Variation) in MLB

| CV Range | Category | MLB Examples |
|----------|----------|-------------|
| < 0.20 | LOCKED_IN | Elite pitcher K's (Corbin Burnes K prop), leadoff hitter PA consistency |
| 0.20-0.35 | NORMAL | Most batter hits, pitcher K's for mid-tier starters |
| 0.35-0.50 | VOLATILE | RBI, runs scored, total bases for inconsistent hitters |
| > 0.50 | CHAOTIC | HR (for anyone), SB (for non-speedsters), pitcher wins |

**Most targetable props (low CV, predictable)**: Pitcher strikeouts for elite starters, batter hits for consistent contact hitters.
**Props to avoid (high CV, noise-dominated)**: HR (except at Coors), RBI, runs scored, pitcher wins.

---

## Pillar 7: Matchup Intelligence

### NBA (current)
- H2H structural edges (MatchupIntel.js)
- Defensive ratings by position
- Teammate correlations
- Injury cascades (on/off usage shifts)

### MLB equivalent

**Pitcher vs. Batter H2H**:
- Available via MLB Stats API and Baseball Reference
- **Critical caveat**: Most matchups are 5-20 PA. Too small for standalone analysis.
- Bill James' approach: use H2H as a modifier on base rates (Log5), not a standalone predictor
- Weight: maybe 5-10% of projection, regressed heavily toward component rates

**Statcast matchup metrics**:
- Pitch-type vulnerability: batter's xwOBA by pitch type vs pitcher's pitch mix
- Source: Baseball Savant's `statcast_search` endpoint
- If a batter has a .200 xwOBA vs sliders and the pitcher throws 40% sliders → strong Under signal on hits/TB

**Platoon splits** (one of the biggest Bill James edges):
- Source: FanGraphs splits data
- Magnitude: Same-hand matchups (LHB vs LHP, RHB vs RHP) suppress BA by ~20-30 points, boost K% by 5-8%
- **Key question: do books fully price platoon?** Evidence suggests they partially do for extreme cases but underadjust for marginal splits. This is exploitable.

**Catcher framing**:
- Source: Baseball Savant catcher framing leaderboard
- Elite framers (e.g., top-5 catchers) gain 1+ called strikes per game
- Impact: boosts pitcher K props, suppresses walks
- **Largely unpriced by books** — this is a structural edge

**Pitcher "stuff" metrics** (Stuff+, Pitching+):
- Source: PitchingBot via Baseball Savant
- Measures raw pitch quality (movement, velocity, spin) independent of results
- Leading indicator: a pitcher with great Stuff+ but mediocre results is likely to improve
- Useful for identifying mispriced K props early in the season

### Correlation structure (for SGPs)

| Correlation | Direction | Mechanism |
|-------------|-----------|-----------|
| Pitcher K's ↔ Pitcher hits allowed | **Negative** | More K's = fewer balls in play = fewer hits |
| Batter hits ↔ Batter total bases | **Positive** | Hits are a subset of total bases |
| Batter hits ↔ Batter runs scored | **Positive** | Getting on base → more chances to score |
| Batter HR ↔ Batter RBI | **Positive** | HR always produces at least 1 RBI |
| Opposing batter hits ↔ Pitcher ER | **Positive** | More hits allowed → more runs scored |
| Game total Over ↔ Batter hits Over | **Positive** | High-scoring games → more at-bats → more hits |

---

## Pillar 8: Market Inefficiencies (The Bill James Edge)

### Where books are systematically mispriced

**Tier 1 — High-confidence edges (Bill James would bet these)**:

1. **BABIP regression**: A batter hitting .350 with a .380 BABIP (league avg ~.300) has inflated hit/TB props. BABIP stabilizes at ~800 balls in play — most in-season BABIP is noise. **Fade inflated hit props when BABIP is 40+ points above career norms.**

2. **ERA vs FIP discrepancy**: A pitcher with 4.50 ERA but 3.20 FIP is better than his results show. His ER/hits allowed props may be set too high. **Buy under on ER for pitchers with FIP far below ERA.** Conversely, a 2.50 ERA / 4.00 FIP pitcher is a sell.

3. **Platoon matchups not fully priced**: When a lefty with a career .220 BA vs LHP faces a tough left-handed starter, does FanDuel drop his hit line by enough? Often not. **Under on batter hits/TB in unfavorable platoon matchups.**

4. **Park factor mispricing**: The public knows Coors = offense (so Coors overs may be overpriced). But less-known park effects are underpriced: Yankee Stadium short porch for LHB HR, Oracle Park suppressing HR, Great American Ball Park boosting HR. **Exploit non-obvious park effects.**

5. **Catcher framing alpha**: When an elite framing catcher is behind the plate, pitcher K props should be slightly higher and walk props lower. **Books don't adjust for this.** Small edge, but consistent.

**Tier 2 — Moderate-confidence edges**:

6. **Recency bias / Plexiglass Principle**: The public (and line-setters) overweight last 7-14 days. A star slugger in a 2-week slump has depressed props. Bill James' Plexiglass Principle says extreme recent performance reverts. **Buy Over on slumping stars with unchanged underlying rates (check xwOBA, barrel%, K%).**

7. **HR/FB rate noise**: HR/FB stabilizes at ~300 fly balls (~1.5 seasons). A pitcher "giving up too many homers" based on 2 months of data is almost certainly experiencing noise. **Under on HR allowed for pitchers with elevated HR/FB but good FIP.**

8. **Bullpen fatigue not priced into game totals**: When both bullpens are gassed (high usage last 3 days), game totals should be higher. **Over on game totals when both bullpens are depleted.**

9. **Weather edges in the lineup-to-first-pitch window**: Wind direction shifts after lines are set. If wind shifts to blowing out at 15+ mph and the book hasn't adjusted totals, there's an edge on HR/TB overs.

**Tier 3 — Structural/timing edges**:

10. **Lineup confirmation window**: Between lineup confirmation (1-3 hours before first pitch) and line adjustment, there's a brief window. If a key batter is scratched or a lineup change affects batting order, props may be stale for a few minutes.

11. **Post-breakout underpricing**: When a player legitimately changes (new pitch, swing change), the market is slow to catch up because it regresses toward outdated career norms. **Identify real changes via Statcast (barrel% jump, pitch mix change) and ride the over before the market adjusts.**

### Props to AVOID (too random for reliable edge)

| Prop | Why | NBA equivalent |
|------|-----|----------------|
| **RBI** | Heavily dependent on baserunner context, not individual skill | — |
| **Runs scored** | Depends on what teammates do after you reach base | — |
| **Pitcher wins** | Team-dependent, bullpen-dependent, near-random | — |
| **Triples** | Too rare, park-dependent, speed + luck | — |
| **SB** (for non-speedsters) | Too rare for most players. Only exploitable for known base-stealers. | Under 3PT |

### Props to TARGET (most analytically exploitable)

| Prop | Why | CV | Stabilization |
|------|-----|----|---------------|
| **Pitcher strikeouts** | Highest predictability, fastest stabilization (K% at ~60 PA), lowest variance | Low | Fast |
| **Batter hits** | Moderate predictability, but BABIP regression creates edge | Medium | Slow (BABIP) |
| **Batter total bases** | Good mix of predictability + variance | Medium | Moderate |
| **Pitcher ER** (FIP-based) | FIP vs ERA discrepancy creates systematic edge | Medium | Fast (FIP) |

---

## Summary: NBA → MLB Translation Table

| AI-BOIZ Component | NBA Implementation | MLB Equivalent | Key Difference |
|-------------------|-------------------|----------------|----------------|
| Odds API | `basketball_nba` | `baseball_mlb` | More games per day, staggered start times |
| Stats API | BallDontLie | **MLB Stats API** (free, no auth, JSON) | Direct replacement, richer data |
| Advanced metrics | NBA.com stats | **Baseball Savant** (Statcast CSV) | xBA/xSLG/xwOBA replace traditional stats |
| Injury data | ESPN NBA injuries | **ESPN MLB injuries** (same pattern) | IL system is simpler (no questionable/doubtful) |
| Roster/lineup | ESPN NBA roster | **MLB Stats API roster + probablePitcher** | Probable pitcher is the key data point |
| Referee signals | Zebra Grid (crew chiefs) | **Umpire zone profiles** (UmpScorecards) | Larger effect size than NBA refs |
| Defensive ratings | DEF_RATINGS by position | **Park factors** by stat category | Permanent structural feature, not matchup-dependent |
| Minutes model | Project minutes → per-min rate | **Project PA/IP → per-PA/IP rate** | Same philosophy, different units |
| Stat engine | Poisson (PTS,REB,AST) / Normal (combos) | **Poisson (K's, HR) / Binomial (hits) / Normal (TB, combos)** | More distribution variety needed |
| Projection weights | L7/L30/H2H/splits/season | **Marcel-style** (3-year weighted + regression) | Regression to mean is the core concept |
| Signal scoring | Multi-signal (refs, injury, momentum, etc.) | **Multi-signal (umpire, park, weather, platoon, bullpen, Statcast)** | More signals available, richer context |
| Market edge thesis | NBA public overweights hot streaks | **MLB public overweights BA, ERA, recent form** | Bill James = trust process over outcomes |
| Anchored projection | 85% FD / 15% our model | **Same approach, adjust anchor weight by signal count** | Identical concept |
| Deep dive (Claude) | Validates/kills plays with AI context check | **Same approach** | Add baseball-specific prompts |

---

## New Resources Needed

### APIs (free)
- [x] The Odds API — already have key, just change sport key to `baseball_mlb`
- [ ] MLB Stats API — `statsapi.mlb.com/api/v1/` — no key needed
- [ ] Baseball Savant CSV — `baseballsavant.mlb.com/statcast_search/csv` — no key needed
- [ ] ESPN MLB injuries — `site.api.espn.com/apis/site/v2/sports/baseball/mlb/injuries` — no key needed

### APIs (paid/optional)
- [ ] FanGraphs membership ($5.99/mo) for CSV exports of park factors, wRC+, FIP, platoon splits
- [ ] Weather API (OpenWeatherMap free tier: 1,000 calls/day, sufficient)
- [ ] The Odds API plan upgrade if polling volume increases (currently on free 500 credits)

### Data tables to build (static/periodic refresh)
- [ ] MLB team map (30 teams + abbreviations + IDs)
- [ ] Park factor table (30 parks × stat categories)
- [ ] Umpire profile table (analogous to `REFEREE_PROFILES`)
- [ ] Park wind orientation data (for weather signal)

### Conceptual shifts
- [ ] Replace "minutes model" with "PA model" (batters) and "IP model" (pitchers)
- [ ] Replace position-based defensive ratings with component park factors
- [ ] Add platoon split signal (no NBA equivalent)
- [ ] Add weather signal (no NBA equivalent)
- [ ] Add bullpen fatigue signal (no NBA equivalent)
- [ ] Add catcher framing signal (no NBA equivalent)
- [ ] Redesign projection engine around Marcel-style regression instead of simple weighted medians
- [ ] Implement Log5 for matchup adjustments
