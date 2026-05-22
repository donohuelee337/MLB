# MLB-BOIZ: Profitability Gates + Model Robustness

**Date:** 2026-05-22  
**Status:** Approved for implementation planning  
**Data basis:** 3,151 graded rows, 32 slates (Apr 18 – May 21 2026), real-money betting  
**Goal:** Stop negative-ROI bleeding immediately (Phase 1), then fix the root causes in the model and close the calibration feedback loop (Phase 2).

---

## 1. Context & Key Findings

**Results summary at the time of spec:**

| Market | n | Hit Rate | Break-Even | Edge | ROI |
|--------|---|----------|------------|------|-----|
| K (strikeouts) | 983 | 51.6% | 53.0% | -1.4% | -6.2% |
| H (batter hits) | 1,125 | 56.7% | 62.4% | -5.7% | -8.9% |

**K breakdown reveals two sub-markets with opposite profiles:**

| Segment | n | Hit | BE | Edge | ROI |
|---------|---|-----|----|------|-----|
| K Over, model ≥ 0.60 | 309 | 57.9% | 54.5% | +3.5% | +0.6% |
| K Under, model < 0.75 | ~378 | ~46% | ~53% | ~-7% | ~-14% |
| K Under, model ≥ 0.75 | 134 | 61.9% | 56.1% | +5.9% | -0.3% |
| K 0.55–0.60 bucket | 161 | 40.4% | 50.8% | -10.4% | -24.9% |

**H breakdown — no model% bucket shows consistent positive edge.** The structural problem is that FD prices H lines at an average break-even of 62.4% while the true hit rate is 56.7%. Worst trap: **H odds -155 to -130** (n=178, ROI -34.4%). Near-viable zone: **H odds -130 to -110** (n=129, ROI +5.5%).

**Root causes:**
1. K: Two distinct markets (Over vs Under) treated with one floor. K Under below 0.75 model% is a consistent money loser.
2. H: Model systematically overestimates P(≥1 hit) by ~6 percentage points. Likely causes: (a) flat season-average PA/game doesn't account for batting-order slot, (b) Poisson calibration is not shrunk toward empirical rates.
3. Both: `MIN_EV_BET_CARD` exists in Config but is not enforced on the live card.
4. `refreshMLBProfitabilityReport` is not run on FINAL — no automatic feedback after grading.

---

## 2. Architecture

Two independent phases. Phase 1 is Config keys + two small bet card hooks. Phase 2 is three independent improvements: lineup hydration, H calibration shrink, and backtesting/auto-calibration tooling. Each Phase 2 item can ship independently.

```
Phase 1 (same day):
  Config.js  ──────────────────────────►  MLBBetCard.js
  (new keys: K_OVER floor, K_UNDER floor,    (3 new filter checks:
   MAX_ODDS_H, MIN_EV_BET_CARD enforced)      per-side K floor,
                                              H odds cap,
  PipelineMenu.js                             EV floor)
  (FINAL: auto-run profitability report)

Phase 2A (lineup hydration):
  statsapi /schedule?hydrate=lineups
  ──► MLBLineups.js (new file)
  ──► 📋 Lineup_Data tab (new, for visibility)
  ──► MLBBatterHitsV2.js: estPa += slotMult

Phase 2B (H calibration shrink):
  Config.js  ──►  MLBBatterHitsCard.js
  (H_MODEL_P_SHRINK key)   (multiply pWin before writing card)

Phase 2C (backtest + auto-calibration):
  MLBGateBacktest.js (new) ──► 🔬 Gate_Backtest tab
  MLBCalibration.js  ──► "proposed Config" section in 🎯 Bet_Card_Calibration
  PipelineMenu.js   ──► menu item: "Apply calibration → Config"
```

---

## 3. Phase 1 — Gate Fixes

### 3.1 Per-side K floors

**Why:** K Overs and K Unders behave as separate markets. A single `MIN_MODEL_PCT_K` cannot serve both.

**New Config keys** (added to `Config.js` via `buildConfigTab`):
```
MIN_MODEL_PCT_K_OVER  = 0.60   (replaces the shared K floor for Over plays)
MIN_MODEL_PCT_K_UNDER = 0.75   (new; gates out the -14% ROI segment below 0.75)
```

**Code change** in `mlbBetCardThresholds_` (`MLBBetCard.js`): accept an optional `side` parameter. When `marketKey === 'K'` and `side` is provided, look up `MIN_MODEL_PCT_K_OVER` or `MIN_MODEL_PCT_K_UNDER` first, falling back to `MIN_MODEL_PCT_K`, then to the global floor.

Call site in the K section of `refreshMLBBetCard`: pass `bestSide` to `mlbBetCardThresholds_(cfg, 'K', bestSide)`.

**Fallback safety:** If the new keys are missing from Config (old sheet), `mlbBetCardThresholds_` falls back to `MIN_MODEL_PCT_K` → `MIN_MODEL_PCT_BET_CARD` → 0.60. No breakage on old sheets.

### 3.2 H odds cap

**Why:** H odds -155 to -130 is the single worst segment (-34.4% ROI, n=178). FD prices mid-range H favorites most efficiently; the model has no edge there.

**New Config key:**
```
MAX_ODDS_H = -130   (American; only H plays at odds ≥ -130 appear on card)
```
A value of `0` or blank disables the cap (same as today).

**Code change** in the H section of `refreshMLBBetCard`: after the existing `american` validity check, add:
```javascript
const maxOddsH = parseFloat(String(cfg['MAX_ODDS_H'] || '0')) || 0;
if (maxOddsH < 0 && american < maxOddsH) return;  // too much juice
```

Note: `-130 < -155` in JavaScript, so `american < maxOddsH` correctly gates out plays heavier than -130.

**Config warning:** add `MAX_ODDS_H` to the range-warning block in `buildConfigTab` with range [-300, 0].

### 3.3 Wire MIN_EV_BET_CARD on the live card

**Why:** `MIN_EV_BET_CARD` is in Config (default `0`) and is enforced on shadow snapshots but not on the live card.

**Code change** in `refreshMLBBetCard`: after `if (isNaN(ev) || ev <= 0) return;` in both the K block and the H block, add:
```javascript
const minEv = parseFloat(String(cfg['MIN_EV_BET_CARD'] || '0')) || 0;
if (ev < minEv) return;
```

**Default stays 0** (no change in behavior unless Config is updated). Suggested first value: `0.03`.

### 3.4 Auto-run profitability report on FINAL

**Why:** `refreshMLBProfitabilityReport` exists and works, but is never called automatically after grading.

**Code change** in `runMLBBallWindow_` (`PipelineMenu.js`): in the same FINAL block where `runPitcherDataDiagnostic` is called, add:
```javascript
if (windowTag === 'FINAL' && typeof refreshMLBProfitabilityReport === 'function') {
  try {
    refreshMLBProfitabilityReport();
  } catch (e) {
    addPipelineWarning_('Profitability report: ' + (e.message || e));
  }
}
```

`refreshBetCardCalibration` already runs on every window (line 400) — no change needed there.

---

## 4. Phase 2A — Lineup Hydration + PA-Per-Slot

**Why:** `mlbHitsV2BatterPaPerGame_` computes season-average PA/game from game logs. This is a reasonable baseline but ignores tonight's batting order slot. Slot 1 averages ~4.4 PA/game; slot 9 averages ~3.2 PA/game — a ~0.25 hit-probability difference for a .280 hitter. Improving `estPa` should reduce the calibration gap in H.

### 4.1 New file: `MLBLineups.js`

**Responsibility:** Fetch tonight's confirmed lineups from statsapi once per pipeline run, cache by gamePk, expose a per-batter slot lookup.

**Statsapi endpoint:** `GET /api/v1/schedule?sportId=1&date=YYYY-MM-DD&hydrate=lineups`  
Returns lineup arrays with `battingOrder` (100 = slot 1, 200 = slot 2 … 900 = slot 9) for each team per game.

**Key functions:**
```javascript
mlbFetchAndCacheLineups_(ss, cfg)
  // Called once per pipeline run (new step 9.5, after schedule fetch).
  // Reads SLATE_DATE from cfg; calls statsapi once; populates module-level
  // cache: { gamePk → { playerId → slot (1–9) } }. Falls back gracefully
  // if endpoint 4xx / no lineups confirmed yet.

mlbLineupSlotForBatter_(gamePk, batterId)
  // Returns slot 1–9 or null (not yet confirmed / not in lineup).

mlbResetLineupsCache_()
  // Called at pipeline start in runMLBBallWindow_.
```

**New tab:** `📋 Lineup_Data` — written by `mlbFetchAndCacheLineups_`; shows gamePk, team, slot, playerId, playerName for visibility and debug. Includes `confirmed: true/false` flag per game.

### 4.2 New Config keys (PA-per-slot table)

```
LINEUP_PA_SLOT_1 = 4.4
LINEUP_PA_SLOT_2 = 4.3
LINEUP_PA_SLOT_3 = 4.1
LINEUP_PA_SLOT_4 = 4.0
LINEUP_PA_SLOT_5 = 3.9
LINEUP_PA_SLOT_6 = 3.7
LINEUP_PA_SLOT_7 = 3.6
LINEUP_PA_SLOT_8 = 3.4
LINEUP_PA_SLOT_9 = 3.2
```
All tunable. Source: league-average PA/slot from 2024–2025 statsapi data.

### 4.3 Integration in `MLBBatterHitsV2.js`

In `mlbHitsV2ComputeRow_`, after `out.estPa = out.paPerGameSzn;`, add:
```javascript
const slot = mlbLineupSlotForBatter_(gamePk, batterId);
if (slot) {
  const slotPa = parseFloat(String(cfg['LINEUP_PA_SLOT_' + slot] || '0')) || 0;
  if (slotPa > 0) {
    out.estPa = slotPa;
    // abMult (ablation) is recomputed below using estPa / paPerGameSzn
  }
}
```

**Fallback:** if lineup not confirmed, `slot` is null and `out.estPa` stays as `paPerGameSzn` (no change from today). Zero regression when lineup data is absent.

**Also apply in `MLBBatterHitsV3.js`** — v3 inherits `estPa` from the v2 computation path, so it gets the improvement automatically if v2 exports it through the shared struct.

### 4.4 Pipeline step

In `runMLBBallWindow_`, add step between schedule fetch and pitcher game logs:
```
step('Lineups (statsapi)', function() { mlbFetchAndCacheLineups_(ss, cfg); })
```
This runs for Morning, Midday, and Final (lineups become confirmed closer to game time; Midday/Final runs will capture confirmed orders that Morning missed).

---

## 5. Phase 2B — H Calibration Shrink Factor

**Why:** Even with improved PA estimates, the model likely overestimates P(win) due to Poisson distribution properties and FD's aggressive H line pricing. A multiplicative shrink factor applied before EV calculation closes the residual gap empirically without retraining the model.

**New Config key:**
```
H_MODEL_P_SHRINK = 0.94   (multiplier on raw P(win) before EV calc; 1.0 = off)
```
Suggested starting value 0.94 (closes the observed ~6pp overconfidence). Tune up toward 1.0 as lineup-hydration improves raw lambda accuracy and the calibration gap narrows.

**Code change in `MLBBatterHitsCard.js`** (where pWinOver / pWinUnder are written to the card, not in `mlbHitsV2ComputeRow_` — keeps the lambda and raw P audit columns honest):

In the row-write loop, after `pWinOver` and `pWinUnder` are computed from Poisson CDF on lambda:
```javascript
const hShrink = parseFloat(String(cfg['H_MODEL_P_SHRINK'] || '1')) || 1;
if (hShrink > 0 && hShrink < 1) {
  pWinOver  = Math.min(pWinOver  * hShrink, 0.9999);
  pWinUnder = Math.min(pWinUnder * hShrink, 0.9999);
}
```
EV is then recomputed from the shrunk P. The raw Poisson P is still written to an audit column so the ablation panels remain meaningful.

**Note:** the shrink factor affects the bet card via the card's pWin column, not directly inside the model. If `H_MODEL_P_SHRINK` is 1.0 (default), there is no change in behavior.

---

## 6. Phase 2C — Backtesting Tab + Auto-Calibration Config Writer

### 6.1 Gate Backtest (`MLBGateBacktest.js`)

**Purpose:** Apply candidate Config gate values to the existing Results Log and compute projected ROI for each combination *before* changing live Config. Replaces guessing with evidence.

**New function: `runGateBacktest()`**

Reads `📋 MLB_Results_Log`. For each row in a configurable parameter grid (defined in a new `🔬 Gate_Backtest_Config` section at the top of the backtest tab), simulates which rows would have made the bet card and computes:
- `n` (bet count), win rate, ROI, max drawdown (consecutive losses), Sharpe proxy

**Grid parameters** (hardcoded constants in `MLBGateBacktest.js`; change them in the file to adjust search space):
```javascript
const MLB_BACKTEST_GRID = {
  MIN_MODEL_PCT_K_OVER:  [0.58, 0.60, 0.62, 0.65],
  MIN_MODEL_PCT_K_UNDER: [0.70, 0.75, 0.80],
  MAX_ODDS_H:            [-110, -120, -130, -150, 0],
  MIN_EV_BET_CARD:       [0, 0.02, 0.03, 0.05],
  H_MODEL_P_SHRINK:      [0.90, 0.92, 0.94, 0.96, 1.00],
};
```
The function iterates all combinations (4×3×5×4×5 = 1,200 max) and filters to those with n ≥ 10.

Output: sorted table of configurations by ROI, with n and Sharpe shown so thin-sample winners are visible.

**Tab:** `🔬 Gate_Backtest` — written fresh each run, never accumulates.

**Menu item:** `⚾ MLB-BOIZ → 🔬 Run gate backtest`

### 6.2 Auto-Calibration Config Writer

**Purpose:** After FINAL grading, read the `🎯 Bet_Card_Calibration` sheet's `recommended_min_model_pct` column and propose Config updates. Eliminates manual read-and-type.

**New section in `MLBCalibration.js`: `mlbWriteCalibrationProposals_(ss, cfg)`**

- Reads the recommended_min_model_pct cells from the calibration tab (already populated by `refreshBetCardCalibration`).
- Writes a "📝 Proposed Config Updates" section at the bottom of the `🎯 Bet_Card_Calibration` tab showing: current Config value → recommended value → change direction.
- Does NOT auto-apply — requires human review + a single menu click.

**New menu item:** `⚾ MLB-BOIZ → ✅ Apply calibration → Config`
Calls `mlbApplyCalibrationProposals_(ss)` which reads the proposals and writes the recommended values to the Config tab. Idempotent (running twice is safe).

**Auto-run on FINAL** in `PipelineMenu.js`:
```javascript
if (windowTag === 'FINAL' && typeof mlbWriteCalibrationProposals_ === 'function') {
  try { mlbWriteCalibrationProposals_(ss, cfg); } catch (e) { ... }
}
```

---

## 7. Error Handling

| Scenario | Behavior |
|----------|----------|
| New Config keys missing (old sheet) | All new checks fall back to existing behavior (0.60 floor, no odds cap, no EV floor). No regression. |
| Lineup endpoint 4xx / timeout | `mlbFetchAndCacheLineups_` catches, logs pipeline warning, leaves cache empty. H model falls back to season PA/game. |
| Lineup not confirmed at Morning run | `mlbLineupSlotForBatter_` returns null → estPa unchanged. Midday/Final re-fetch picks up confirmed lineups. |
| `H_MODEL_P_SHRINK` missing or 1.0 | No change to existing behavior. |
| Backtest with < 10 graded rows | Function returns early with a "not enough data" notice in the tab. |
| Calibration proposals not yet written | `mlbApplyCalibrationProposals_` no-ops gracefully. |

---

## 8. Testing & Validation

- **Phase 1:** After `clasp push`, run Morning pipeline. Verify: (a) K Unders below 0.75 no longer appear on bet card; (b) H plays at -155 no longer appear; (c) `MIN_EV_BET_CARD = 0.03` drops thin plays; (d) FINAL run generates profitability report automatically.
- **Phase 2A:** Confirm `📋 Lineup_Data` tab populated after Morning run. Check a few batter rows in `🧪 Batter_Hits_Card_v2-full` — `estPa` column should reflect slot values for confirmed lineups, season average for unconfirmed.
- **Phase 2B:** With `H_MODEL_P_SHRINK = 0.94`, verify pWin values in the H card are ~6% lower than before. Verify raw lambda column is unchanged.
- **Phase 2C:** Run `🔬 Run gate backtest`. Verify it produces a sorted result table. Run FINAL and confirm "Proposed Config Updates" section appears in `🎯 Bet_Card_Calibration`.

---

## 9. Config Keys Summary

| Key | Phase | Default | Description |
|-----|-------|---------|-------------|
| `MIN_MODEL_PCT_K_OVER` | 1 | `0.60` | K Over model% floor |
| `MIN_MODEL_PCT_K_UNDER` | 1 | `0.75` | K Under model% floor |
| `MAX_ODDS_H` | 1 | `-130` | Max juice for H plays (American; 0 = off) |
| `MIN_EV_BET_CARD` | 1 | `0.03` | Min EV/$1 floor enforced on live card |
| `H_MODEL_P_SHRINK` | 2B | `0.94` | Multiplicative shrink on H P(win) before EV |
| `LINEUP_PA_SLOT_1..9` | 2A | `4.4..3.2` | PA/game by batting order slot |
