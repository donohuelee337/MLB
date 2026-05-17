# Sub-project 1: Results Accuracy & Verification

**Status:** Design approved  
**Platform:** Google Apps Script (Sheets-native)  
**Dependency:** None — first in the 5-project chain  
**Feeds into:** Sub-project 2 (Full Boxscore Database), Sub-project 4 (Calibration-Driven EV Gates)

---

## Context

The MLB-BOIZ pipeline produces bet recommendations and logs them to `📋 MLB_Results_Log`. The grader (`MLBResultsGrader.js`) fetches boxscores from statsapi and grades each row as WIN/LOSS/PUSH/VOID. Before we can build advanced EV gates, a continuous Kelly system, or a Python analytics engine, the results foundation must be provably correct.

This sub-project adds a verification layer: anomaly detection, reconciliation reporting, independent spot-checks, and a local boxscore cache that seeds the future database.

---

## Architecture

```
gradeMLBPendingResults_()
    │
    ├── [existing] grades rows, writes result/actual/pnl
    │
    ├── [NEW] writes stat line to 📦 Boxscore_Cache (append-only)
    │
    └── [NEW] calls mlbRunResultsAudit_()
                │
                ├── Self-Audit (7+3 anomaly rules)
                ├── Reconciliation Dashboard rebuild
                └── Writes summary to Pipeline Log

Manual triggers:
    📊 Verify Random Sample  → spot-check N rows (fresh API calls)
    📊 Audit Results         → re-runs audit + dashboard without re-grading
    📊 Open Results Audit    → navigates to the audit tab
```

**New file:** `MLBResultsAudit.js` — all audit logic isolated from grading code.

**Existing code changes:** Two hook points in `MLBResultsGrader.js`:
1. Cache write inside the grading loop (after boxscore extraction, before writing result)
2. Audit trigger at the end of `gradeMLBPendingResults_()`

---

## Component 1: Self-Audit

Runs automatically after every grading pass. Scans Results Log rows and flags anomalies in column 28 (`audit_flag`). Never modifies results — flags only.

### Anomaly Rules

| # | Rule | Flag text | Detection logic |
|---|------|-----------|-----------------|
| 1 | Push semantics | `AUDIT: actual == line, graded WIN/LOSS not PUSH` | `parseFloat(actual) === parseFloat(line)` AND result is WIN or LOSS |
| 2 | Stale PENDING | `AUDIT: PENDING > 48h` | Slate date + 48h < now AND result is empty or PENDING |
| 3 | VOID but active | `AUDIT: VOID but boxscore shows player active` | Result is VOID AND Boxscore_Cache has a non-null stat for that player+game |
| 4 | Stat mismatch | `AUDIT: cached actual ≠ log actual` | Boxscore_Cache `actual_stat` ≠ Results Log `actual_K` column |
| 5 | Missing player_id | `AUDIT: graded but no player_id` | Result is WIN/LOSS/PUSH AND player_id column is empty/NaN |
| 6 | Duplicate bet_key | `AUDIT: duplicate bet_key` | Two+ rows share same non-empty bet_key |
| 7 | PnL math check | `AUDIT: pnl ≠ expected` | Recomputed `mlbPnlFromResult_(result, stake, odds)` ≠ stored pnl (tolerance ±$0.01) |
| 8 | Snapshot gap | `AUDIT: card picks > logged rows for window` | Pipeline Log card-picks count > actual Results Log rows for that slate+window |
| 9 | Missing close line | `AUDIT: graded but no close_line` | Result is WIN/LOSS/PUSH AND close_line + close_odds both blank |
| 10 | Doubleheader collision | `AUDIT: same player+slate, different gamePk` | Two rows with same player_id + slate but different gamePk — flag for review |

### Behavior
- Flags are written to col 28; cleared on re-run if the condition no longer triggers.
- Writes count summary to Pipeline Log: `"Audit: N flags (breakdown by type)"`.
- Toast notification if any flags found.

---

## Component 2: Reconciliation Dashboard

A dedicated **`📊 Results_Audit`** tab, rebuilt on every audit run. Follows existing tab convention (row 1 = title, row 3 = headers, row 4+ = data).

### Panel A: Summary Stats (top section)

| Metric | K | Hits | TB | All |
|--------|---|------|----|----|
| Total logged | | | | |
| Graded (W/L/P/V) | | | | |
| Still PENDING | | | | |
| Resolution rate % | | | | |
| Audit flags active | | | | |

### Panel B: Win Rate by Market × Window

Per market (K, Hits, TB), across time windows:

| Market | Yesterday | L7 | L14 | L30 | Season |
|--------|-----------|-----|-----|------|--------|
| Record (W-L) | | | | | |
| Hit rate % | | | | | |
| PnL $ | | | | | |
| ROI % | | | | | |
| Avg EV at bet time | | | | | |
| Actual hit rate vs. model P | | | | | |

The "Actual hit rate vs. model P" row is the calibration signal: divergence here tells you if your model is overconfident, underconfident, or well-calibrated per market per window.

### Panel C: Anomaly Log

| Slate | Player | Market | Flag | Details |
|-------|--------|--------|------|---------|
| (sorted newest first, all active audit flags) |

### Panel D: Calibration Plot Data

| Model P bucket | Predicted % | Actual % | N (sample) | Confidence band ± |
|----------------|-------------|----------|------------|-------------------|
| 60–65% | 62.5 | ? | ? | ±? |
| 65–70% | 67.5 | ? | ? | ±? |
| 70–75% | 72.5 | ? | ? | ±? |
| 75–80% | 77.5 | ? | ? | ±? |
| 80–85% | 82.5 | ? | ? | ±? |
| 85–90% | 87.5 | ? | ? | ±? |
| 90–100% | 95.0 | ? | ? | ±? |

Confidence band uses Wilson score interval (better than normal approximation for small N): `z=1.96; center = (p̂ + z²/2n) / (1 + z²/n); margin = z×sqrt(p̂(1-p̂)/n + z²/4n²) / (1 + z²/n)`. Buckets with N < 5 show "insufficient data" instead of a percentage.

This table is the foundation for Sub-project 4 (calibration-driven EV gates).

---

## Component 3: Spot-Check Mechanism

Manual trigger: menu item `📊 Verify Random Sample`.

### Process

1. **Sample:** Pick `AUDIT_SPOT_CHECK_N` rows (default 10) randomly from graded rows (WIN/LOSS/PUSH). 70% weighted to last 7 days, 30% older.
2. **Re-fetch:** For each row, fresh `UrlFetchApp.fetch` to statsapi boxscore (not cache).
3. **Re-grade:** Extract stat, run `mlbGradePitcherKRow_()` with stored line+side, compute PnL.
4. **Compare:** Check stored `actual_K`, `result`, `pnl $` against fresh values.
5. **Report:** Write results to a section of `📊 Results_Audit` tab.

### Output table

| Row # | Slate | Player | Market | Stored | Fresh | Match? | Note |
|-------|-------|--------|--------|--------|-------|--------|------|
| (per sampled row) |

### Mismatch handling
- Mismatch → audit flag on the original Results Log row.
- Red highlight in the spot-check report.
- Toast alert: `"⚠️ Spot-check found N mismatch(es) — see 📊 Results_Audit"`.
- Never auto-corrects. Reports only.

---

## Component 4: Boxscore Cache

Append-only **`📦 Boxscore_Cache`** tab. Stores the stat line every time we grade or spot-check.

### Schema

| Column | Type | Description |
|--------|------|-------------|
| `cached_at` | datetime | When stored |
| `slate` | yyyy-MM-dd | Game date |
| `gamePk` | integer | MLB game ID |
| `player_id` | integer | MLB person ID |
| `player_name` | string | Human-readable |
| `market` | string | K / Hits / TB |
| `actual_stat` | integer | The number graded against |
| `game_status` | string | Final / Suspended / etc. |
| `ip` | string | Innings pitched (pitchers) |
| `k` | integer | Strikeouts (pitchers) |
| `h` | integer | Hits (batters) |
| `ab` | integer | At-bats (batters) |
| `tb` | integer | Total bases (batters) |
| `hr` | integer | Home runs (batters) |
| `bb` | integer | Walks (batters) |
| `source` | string | `grader` or `spot-check` |

### Behavior
- **Append-only** — never overwrite. Stat corrections produce a second row with later `cached_at`.
- **Dedup on read** — latest `cached_at` for a given `gamePk + player_id` wins.
- **Size:** ~2,700 rows/season (15 bets/day × 180 days). Well within Sheets limits even with spot-check doublings.
- **Bridge to Python:** Export source for Sub-project 2. Sheets API or CSV export.

### Integration
- `gradeMLBPendingResults_()` writes a cache row after successfully extracting a stat from a boxscore, inside the existing grading loop. Zero additional API calls.
- Spot-check writes rows with `source = 'spot-check'`.

---

## Component 5: Bet Ledger Lock (Snapshot Immutability)

Protects logged bets from being corrupted by later pipeline runs.

### Problem
`snapshotMLBBetCardToLog` upserts rows on each window. If a game has started and the play is no longer on the card, the existing row survives (upsert only touches rows that match). But when a play IS still on the card (e.g., odds refreshed pre-game), the upsert overwrites most fields.

### Fix
Once a row has `open_line` and `open_odds` set (first snapshot), the upsert treats these fields as **frozen**:

**Frozen on first write (never overwritten by upsert):**
- `slate` (col 2), `player` (col 4), `market` (col 6), `side` (col 8), `gamePk` (col 14), `player_id` (col 15), `open_line` (col 23), `open_odds` (col 24), `bet_key` (col 22)

**Updatable by later upserts:**
- `Logged At` (col 1), `Line` (col 7 — shows latest/closing line for CLV context), `Odds` (col 9), `close_line` (col 19), `close_odds` (col 20), `clv_note` (col 21), `Window` (col 12), `Model P(Win)` (col 10), `EV ($1)` (col 11), `stake $` (col 25 — only if currently blank)

**Never touched by upsert (grader-owned):**
- `actual_K`, `result`, `grade_notes`, `pnl $`

### Audit Rule Integration
- Rule #8 (snapshot gap) catches the case where a bet was on the card but the snapshot failed before writing it.
- The lock ensures that even if the snapshot runs 3 times, the bet's identity is preserved.

---

## Config Tab Additions

| Key | Default | Purpose |
|-----|---------|---------|
| `AUDIT_SPOT_CHECK_N` | 10 | Rows to verify per spot-check run |
| `AUDIT_STALE_PENDING_HOURS` | 48 | Hours after slate before PENDING is flagged stale |

---

## Menu Additions

```
⚾ MLB-BOIZ
├── ... (existing items) ...
├── ─────────────────
├── 📊 Audit Results
├── 📊 Verify Random Sample
└── 📊 Open Results Audit
```

---

## What Does NOT Change

- `MLBResultsGrader.js` grading logic — identical except two new hook lines
- `MLBResultsLog.js` — unchanged
- Results Log column layout — stays at 27 columns (col 28 is additive)
- Existing tracker panels — continue working unchanged
- All model/card/queue code — untouched

---

## Success Criteria

1. Self-audit catches 100% of the defined anomaly types with zero false negatives on synthetic test cases.
2. Dashboard accurately reflects W/L/P/V counts that match manual verification of the Results Log.
3. Spot-check passes with 0 mismatches on 10 random rows (initial run validates existing grading is correct).
4. Boxscore cache correctly stores stat lines with no data loss.
5. Bet Ledger Lock prevents `open_line`/`open_odds` from being overwritten on re-snapshot.
6. Calibration table in Panel D shows meaningful data once 30+ graded rows exist per bucket.

---

## Roadmap Position

```
[1] Results Accuracy ← YOU ARE HERE
 │
 ├──→ [2] Full Boxscore Database (Python + SQLite)
 │         └── reads 📦 Boxscore_Cache as seed
 │
 ├──→ [3] Advanced Analytics Engine (Python + pandas)
 │         └── H2H, platoon, park, hot/cold, rolling windows
 │
 └──→ [4] Calibration-Driven EV Gates (GAS + Python)
 │         └── uses Panel D calibration data
 │
      [5] Continuous Kelly System (GAS)
           └── uses calibrated probabilities from [4]
```
