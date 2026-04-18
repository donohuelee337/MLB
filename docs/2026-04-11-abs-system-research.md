# ABS (Automated Ball-Strike) Challenge System — Research Brief

**Date:** 2026-04-11
**Purpose:** Document the ABS Challenge System's mechanics, data sources, and impact on the AI-BOIZ MLB betting model — specifically what it destroys, what it creates, and what it changes about the umpire signal pillar.

---

## 1. What Is ABS?

The Automated Ball-Strike Challenge System debuted on Opening Night 2026 (March 26, Giants vs. Yankees on Netflix). It is **not** full robot umps — human umpires still make every initial ball/strike call. Players can challenge those calls using Hawk-Eye camera tracking (12 cameras per park, T-Mobile 5G private network). Results display on the scoreboard in ~15 seconds.

**Key distinction**: This is a *challenge system*, not an automated zone. The human umpire's zone still matters on every pitch that isn't challenged. The ABS zone only comes into play on challenged calls.

---

## 2. Challenge Mechanics

| Rule | Detail |
|------|--------|
| **Challenges per team** | 2 per game. Successful challenges are retained. |
| **Who can challenge** | Batter, pitcher, or catcher only. No dugout assistance. |
| **How to challenge** | Tap hat/helmet immediately after the call (~2 seconds). |
| **Extra innings** | Teams get 1 additional challenge per extra inning if they enter that inning with 0. |
| **Position players pitching** | Challenges not permitted. |
| **Post-replay** | Cannot challenge after a replay review. |
| **Games per day** | Average 4.1 challenges per game (Spring Training data). |
| **Time added** | Average 13.8 seconds per challenge → ~57 seconds per game. |
| **Where it applies** | All MLB park games (Spring Training, regular season, postseason). Exceptions: Mexico City Series, Field of Dreams, Little League Classic. |

### Challenge Success Rates

| Period | Overturn Rate | Notes |
|--------|---------------|-------|
| Triple-A 2024 | 50% | Full season data |
| Spring Training 2025 | 52.2% | 1,844 challenges across 288 games |
| Opening Weekend 2026 | 54% | 175 challenges, 94 overturned |
| First 12 games 2026 | 61.3% | 31 challenges, 19 overturned |

**By challenger type (Spring Training):**
- Defensive (pitcher/catcher): 54.4% success
- Batters: 50.0% success
- Catchers specifically: 56% → highest individual success rate

**By game phase (Spring Training, overturn rate declining through game):**
- Innings 1-3: 60%
- Innings 4-6: 51%
- Innings 7-8: 43%
- Inning 9: 46%

The declining overturn rate through the game likely reflects umpires settling into the zone and/or teams burning challenges on marginal calls early.

---

## 3. The ABS Strike Zone vs. The Human Zone

The ABS zone is a **2D rectangle** measured at the **center of home plate** (not the front edge).

| Dimension | ABS Zone | Human Umpire Zone |
|-----------|----------|-------------------|
| Width | 17 inches (plate width) | 17 inches |
| Top | 53.5% of player height | ~55.6% of player height |
| Bottom | 27% of player height | ~24.2% of player height |
| Shape | Rectangle | Rounded / irregular |
| Depth | 2D at plate center | 3D (effectively 2D with front-edge bias) |
| 2-2 count zone size | 443 sq inches | 449 sq inches |

**Net effect**: The ABS zone is **slightly smaller** than the average human zone. The top is lower (53.5% vs 55.6%) and the bottom is higher (27% vs 24.2%). This means:
- High fastballs that umpires would call strikes are ABS balls
- Low breaking balls at the knees that umpires stretch are ABS balls
- The zone is more rectangular and less "generous" at corners

**Margin of error**: ~1/6 inch (~4mm). Any part of the ball touching the zone edge counts as a strike.

---

## 4. Impact on the Umpire Signal Pillar

### What's destroyed: individual umpire tendencies on challenged pitches

The existing research briefing identifies umpire zone profiles as "MLB's Zebra Grid" — the single largest referee effect in MLB. ABS **partially neutralizes** this edge:

- **Challenged pitches**: Umpire tendency is irrelevant. The ABS zone is the same regardless of who's behind the plate.
- **Unchallenged pitches (~97.4%)**: Umpire tendency **still matters**. With only 2.6% of called pitches challenged (Spring Training data), the vast majority of pitches are still called by the human ump.

### What changes: the umpire edge becomes a *second-order* effect

Pre-ABS, an umpire with a wide zone boosted pitcher K's and suppressed walks on **every pitch**. Post-ABS, that same umpire's wide zone still affects most pitches, but the ~3-5 most impactful wrong calls per game can now be corrected.

**New mental model**: Think of ABS as removing the *tails* of umpire variation. An ump who calls a 460 sq-inch zone still helps pitchers on the 95%+ of pitches that aren't challenged. But the most egregious blown calls — the ones that flip K's to walks or vice versa — now have a correction mechanism.

### What's created: challenge strategy as a new signal

ABS creates an entirely new category of data:
- **K-Flips** (-K): Strikeouts reversed to continued at-bats
- **BB-Flips** (+BB): Walks reversed to continued at-bats (or vice versa)
- **Challenge success rate by team/player**: Some catchers are elite challengers (56%+), some are below 50%
- **Expected challenge rate**: Baseball Savant model predicting how often pitches *should* be challenged based on location, count, game state
- **Overturns vs. Expected**: Net value of a team's/player's challenge decisions

---

## 5. Impact on Betting Props

### Pitcher Strikeouts (the #1 MLB prop target)

**Direction: Slight decrease in K rate expected.**

| Metric | Pre-ABS | ABS Effect |
|--------|---------|------------|
| MLB K rate (2025) | 22.2% | Expected slight decrease |
| Triple-A ABS K rate | 22.61% | vs. 23.87% in challenge-only games |
| Mechanism | Fewer "stolen" strike-3 calls survive challenges | ~1-2 K-flips per game across both teams |

**Modeling implication**: For pitchers who heavily rely on painting corners (elite command pitchers), ABS is a mild headwind on K props. For power pitchers who blow it past hitters mid-zone, ABS has minimal impact — their K's aren't the ones getting challenged.

**Specific edge**: A pitcher facing a team with aggressive, accurate batter-challengers may lose 0.5-1.0 K per start compared to facing a team that rarely challenges or challenges poorly.

### Batter Walks

**Direction: Slight increase in BB rate expected.**

| Metric | Pre-ABS | ABS Effect |
|--------|---------|------------|
| Triple-A ABS BB rate | 12.30% | vs. 10.45% in challenge games |
| Mechanism | Umpire "pitcher calls" on borderline pitches can be overturned | Batters can challenge close strike-2 or strike-3 calls |

This is the clearest statistical effect from MiLB testing: walks go up when the zone gets tighter/challengeable.

### Game Totals

**Direction: Slight increase in scoring expected.**

More walks → more baserunners → more runs. Fewer strikeouts → more balls in play → more runs. The compound effect is a small upward push on run scoring.

**Caution**: Sportsbooks are likely already pricing this in after a full Spring Training of data. The edge isn't "bet every over" — it's in identifying *specific games* where ABS effects compound with other factors.

### Catcher Framing

**Direction: Framing value is reduced but NOT eliminated.**

Pre-ABS, elite framers like Yasmani Grandal or Jose Trevino could steal 10-15 called strikes per game via framing. Post-ABS:
- Framing still works on the ~97% of pitches not challenged
- But the most egregious "frame jobs" — the ones that actually flip outcomes — are now challengeable
- Net effect: framing value drops from "major edge" to "moderate edge"
- **New framing skill**: Challenge accuracy. Catchers who are good challengers (56%+ success) add value in a completely new way

**Modeling implication**: The catcher framing signal from the research briefing should be downweighted but not eliminated. A new "catcher challenge skill" signal should be added.

---

## 6. Data Sources for ABS

### Baseball Savant (Primary — Free, No Auth)

Two new pages launched for 2026:

| Page | URL | Data |
|------|-----|------|
| **ABS Dashboard** | `baseballsavant.mlb.com/abs` | League-wide challenge stats, trends, aggregate data |
| **ABS Leaderboard** | `baseballsavant.mlb.com/leaderboard/abs-challenges` | Per-player/team challenge data, overturns vs. expected, K/BB flips, filterable by pitch type |

**Key metrics available:**
- Challenges won/lost/total by batter and by fielder (pitcher/catcher)
- Challenge rate (actual vs. potential)
- K-Flips (-K) and BB-Flips (+BB)
- Overturns vs. Expected Overturns (quality of challenge decisions)
- Expected Challenge Rate (model-based)
- Rate vs. Expected (actual - expected challenge %)
- Filterable by pitch type, count, inning

**Access method**: Savant pages are scrapeable HTML/CSV. The `baseballr` R package has a `statcast_leaderboards()` function that may add ABS data. Direct CSV export is likely available (same pattern as existing Savant leaderboards).

### MLB Gameday / Stats API

Umpire assignments are still available via the MLB Stats API game data. Even with ABS, knowing the umpire matters for the ~97% of unchallenged pitches.

```
Umpire assignment:  /game/{gamePk}/feed/live  →  liveData.boxscore.officials
```

### Delayed Pitch Location Data

MLB has instituted a **deliberate delay on all pitch location data** (Gameday App, broadcast zone overlay) as an anti-cheating measure. This means:
- Real-time pitch tracking feeds will NOT show location instantly
- The broadcast strike zone box will be delayed by several seconds
- Clubs are prohibited from using their own ball-tracking systems

This delay does not affect post-game analysis or next-day model inputs, but it means any "live" ABS data feed for in-game use is restricted.

---

## 7. Implications for the AI-BOIZ MLB Model

### Umpire Signal: Modify, Don't Remove

The umpire signal should be **downweighted but retained**:

| Pre-ABS Weight | Post-ABS Recommendation | Rationale |
|----------------|------------------------|-----------|
| Full umpire zone signal | 60-70% of original weight | ~97% of pitches still called by human ump. Tails of distribution are clipped by challenges. |

The umpire signal should also be **adjusted per matchup**:
- If the batting team has aggressive, accurate challengers → umpire edge is further reduced
- If the batting team rarely challenges or challenges poorly → umpire edge is closer to full strength

### New Signals to Add

| Signal | Source | Edge Type | Priority |
|--------|--------|-----------|----------|
| **Team challenge accuracy** | Savant ABS Leaderboard | Teams with poor challenge accuracy (~45%) effectively "waste" their challenges. Umpire zone matters more against them. | Medium |
| **Catcher challenge skill** | Savant ABS Leaderboard | Elite catcher-challengers (56%+) add ~1-2 correct calls/game. Equivalent to a modest framing boost. | Medium |
| **K-Flip / BB-Flip rate** | Savant ABS Dashboard | Direct measure of how often ABS changes strikeout/walk outcomes. Relevant for K and BB prop adjustments. | High |
| **Pitcher corner-painting rate** | Statcast pitch location data | Pitchers who live on the edges are more exposed to ABS challenges. Power mid-zone pitchers are less affected. | Low (future) |

### Projection Adjustments

For the initial MLB model, apply a blanket **ABS correction factor**:

```
Projected_K = Base_K_projection × 0.98    (2% reduction for ABS zone + challenge effects)
Projected_BB = Base_BB_projection × 1.03  (3% increase for ABS zone + challenge effects)
```

These are rough estimates from Triple-A data (K rate dropped ~5% in full-ABS but only ~1-2% in challenge system; BB rate increased ~18% in full-ABS but much less in challenge system). The challenge system is a far milder effect than full ABS.

Refine these factors as 2026 regular season data accumulates.

### Framing Signal Adjustment

```
Pre-ABS framing weight:  100%
Post-ABS framing weight: 65-75%
New catcher challenge weight: 15-20%
```

The total catcher impact signal is roughly the same magnitude, but the composition shifts from pure framing toward framing + challenge skill.

---

## 8. Key Unknowns (Monitor Through Season)

1. **Does the overturn rate stabilize?** Spring Training was 52%, early season is 54-61%. If it stays above 55%, umpire tendency is meaningfully clipped.

2. **Do teams develop challenge strategies?** Some teams may save challenges for high-leverage situations (2-strike counts, bases loaded). This would make late-game ABS effects larger than early-game.

3. **Do umpires adjust?** If umpires know they'll be challenged, they may call a tighter zone proactively — which would *increase* walks even on unchallenged pitches. Monitor league-wide called strike rate.

4. **Pitcher behavioral changes?** Pitchers who used to nibble corners knowing umpires would give them the call may now pitch differently. More mid-zone pitches → more contact → different stat distributions.

5. **How quickly does Savant ABS data stabilize?** "Overturns vs. Expected" needs sample size. Probably not usable for modeling until ~50+ games per team (~mid-May).

6. **Do sportsbooks fully price ABS?** Early indications suggest books adjusted opening lines for ABS effects, but team-specific challenge skill may not yet be priced.

---

## 9. Data Collection Priority for Apps Script

| Priority | Data | Source | Method | Frequency |
|----------|------|--------|--------|-----------|
| **P1** | Team challenge success rates | Savant ABS Leaderboard CSV | `UrlFetchApp` + CSV parse | Weekly |
| **P1** | K-Flip / BB-Flip counts by team | Savant ABS Dashboard | `UrlFetchApp` + HTML/CSV parse | Weekly |
| **P2** | Catcher challenge stats | Savant ABS Leaderboard CSV | `UrlFetchApp` + CSV parse | Weekly |
| **P2** | Today's HP umpire assignment | MLB Stats API `/game/{gamePk}/feed/live` | `UrlFetchApp` JSON | Daily (pre-game) |
| **P3** | Umpire zone profiles (pre-ABS baselines) | UmpScorecards / manual | Static table + periodic refresh | Monthly |
| **P3** | Pitcher edge-painting rate | Statcast pitch location CSV | `UrlFetchApp` + CSV parse | Weekly |

---

## 10. Summary: What ABS Means for AI-BOIZ MLB

| Aspect | Impact | Action |
|--------|--------|--------|
| Umpire signal | Reduced but not eliminated | Downweight to 60-70%, add team challenge skill modifier |
| Pitcher K props | Slight downward pressure | Apply ~2% K reduction factor, refine with season data |
| Batter BB props | Slight upward pressure | Apply ~3% BB increase factor, refine with season data |
| Game totals | Marginal upward push | Factor into total/team-total projections |
| Catcher framing | Reduced value, new challenge value | Split into framing (65-75%) + challenge skill (15-20%) |
| New data streams | Savant ABS Dashboard + Leaderboard | Build weekly CSV ingestion pipeline |
| Biggest unknown | Whether sportsbooks fully price team-level ABS effects | Monitor line movements vs. ABS-adjusted projections |

**Bottom line**: ABS is a *modifier* on existing signals, not a paradigm shift. The umpire edge gets smaller but doesn't disappear. The catcher signal changes composition. A new "challenge skill" dimension emerges. The most exploitable angle is likely team-specific challenge accuracy — books may price the league-wide ABS effect but miss that some teams are significantly better or worse at using their challenges.
