# Phase 2: Lineup Hydration, H Shrink, Backtest + Auto-Calibration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three independent improvements that fix the root causes of the H calibration gap and close the feedback loop — lineup-based PA estimates, a Config-tunable H P(win) shrink factor, a gate backtest tab, and an auto-calibration Config writer.

**Architecture:** Task 1 (lineup hydration) is the largest: a new `MLBLineups.js` file + pipeline step + PA-per-slot injection in `MLBBatterHitsV2.js`. Task 2 (H shrink) is a single 5-line change in `MLBBatterHitsV2.js`. Task 3 (backtest + auto-calibration) is two new functions — one in a new `MLBGateBacktest.js` and one extending `MLBCalibration.js`. All three tasks are independent and can be implemented in any order.

**Tech Stack:** Google Apps Script (V8 runtime), Google Sheets, statsapi MLB stats API. Deploy via `clasp push`. Spec: `docs/superpowers/specs/2026-05-22-profitability-robustness-design.md` §4–6.

---

## File Map

| File | Change |
|------|--------|
| `MLBLineups.js` | **New file** — lineup fetch/cache/lookup functions + write Lineup_Data tab |
| `Config.js` | Add 9 `LINEUP_PA_SLOT_*` rows + `H_MODEL_P_SHRINK` row in `buildConfigTab` |
| `PipelineMenu.js` | 3 changes: reset call + pipeline step + FINAL auto-calibration call |
| `MLBBatterHitsV2.js` | 2 changes: slot PA injection + H shrink factor |
| `MLBGateBacktest.js` | **New file** — `runGateBacktest()` function |
| `MLBCalibration.js` | Add `mlbWriteCalibrationProposals_()` + `mlbApplyCalibrationProposals_()` |

---

## Task 1: Lineup Hydration (`MLBLineups.js`)

**Files:**
- Create: `MLBLineups.js`
- Modify: `Config.js` (add LINEUP_PA_SLOT_* rows)
- Modify: `PipelineMenu.js` (reset + new step)
- Modify: `MLBBatterHitsV2.js` (inject slot PA)

### 1.1 Create `MLBLineups.js`

- [ ] **Step 1.1.1: Create the file with cache + reset**

Create `MLBLineups.js` at the repo root with the following content:

```javascript
// ============================================================
// 📋 MLB Lineups — confirmed batting order per gamePk
// ============================================================
// Fetches tonight's lineup from statsapi once per pipeline run
// and caches { gamePk → { playerId → slot (1–9) } }.
// Consumers call mlbLineupSlotForBatter_(gamePk, batterId).
// Fallback: returns null when lineup not confirmed yet.
// Called at pipeline start (after schedule fetch).
// ============================================================

const MLB_LINEUP_DATA_TAB = '📋 Lineup_Data';

var __mlbLineupsCache = null;  // null = not yet loaded; {} = loaded (may be empty)

function mlbResetLineupsCache_() {
  __mlbLineupsCache = null;
}

/**
 * Returns confirmed batting order slot (1–9) for a batter in a game,
 * or null if lineup not confirmed / batter not in lineup.
 */
function mlbLineupSlotForBatter_(gamePk, batterId) {
  if (__mlbLineupsCache === null) return null;
  const gKey = String(parseInt(gamePk, 10) || 0);
  const pKey = String(parseInt(batterId, 10) || 0);
  const gameMap = __mlbLineupsCache[gKey];
  if (!gameMap) return null;
  return gameMap[pKey] || null;
}
```

- [ ] **Step 1.1.2: Add the fetch function**

Append to `MLBLineups.js`:

```javascript
/**
 * Fetches today's confirmed lineups from statsapi and populates
 * __mlbLineupsCache. Writes a debug tab (📋 Lineup_Data) with all
 * confirmed slots so you can verify the data visually.
 *
 * Statsapi endpoint:
 *   /api/v1/schedule?sportId=1&date=YYYY-MM-DD&hydrate=lineups
 *   Returns lineups[].players[].battingOrder: "100"|"200"…"900"
 *   (100 = slot 1, 900 = slot 9). battingOrder is absent when lineup
 *   is not yet confirmed for that game.
 *
 * Called by runMLBBallWindow_ after fetchMLBScheduleForSlate.
 */
function mlbFetchAndCacheLineups_(ss, cfg) {
  __mlbLineupsCache = {};
  const slateDate = getSlateDateString_(cfg);
  if (!slateDate) return;

  const url =
    mlbStatsApiBaseUrl_() +
    '/schedule?sportId=1&date=' + encodeURIComponent(slateDate) +
    '&hydrate=lineups&gameType=R';

  let payload;
  try {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      Logger.log('mlbFetchAndCacheLineups_ HTTP ' + res.getResponseCode());
      return;
    }
    payload = JSON.parse(res.getContentText());
  } catch (e) {
    Logger.log('mlbFetchAndCacheLineups_ error: ' + e.message);
    return;
  }

  const dates = (payload && payload.dates) || [];
  const tabRows = [['gamePk', 'matchup', 'team', 'slot', 'playerId', 'playerName', 'confirmed']];
  let confirmedGames = 0;

  dates.forEach(function (dateObj) {
    const games = dateObj.games || [];
    games.forEach(function (game) {
      const gamePk = String(parseInt(game.gamePk, 10) || 0);
      if (!gamePk || gamePk === '0') return;
      const matchup = String(game.teams && game.teams.away && game.teams.home
        ? (game.teams.away.team.name || '') + ' @ ' + (game.teams.home.team.name || '')
        : '');

      const lineups = (game.lineups) || {};
      const awayLineup  = (lineups.awayPlayers)  || [];
      const homeLineup  = (lineups.homePlayers)  || [];

      function processTeamLineup(players, teamLabel) {
        let hasAnySlot = false;
        players.forEach(function (p) {
          const pid = String(parseInt(p.id, 10) || 0);
          if (!pid || pid === '0') return;
          const orderStr = String(p.battingOrder || '');
          const orderNum = parseInt(orderStr, 10);
          if (isNaN(orderNum) || orderNum < 100) return;
          const slot = Math.round(orderNum / 100);
          if (slot < 1 || slot > 9) return;
          if (!__mlbLineupsCache[gamePk]) __mlbLineupsCache[gamePk] = {};
          __mlbLineupsCache[gamePk][pid] = slot;
          tabRows.push([gamePk, matchup, teamLabel, slot, pid, p.fullName || '', 'YES']);
          hasAnySlot = true;
        });
        return hasAnySlot;
      }

      const awayOk = processTeamLineup(awayLineup, 'away');
      const homeOk = processTeamLineup(homeLineup, 'home');
      if (awayOk || homeOk) confirmedGames++;

      if (!awayOk) tabRows.push([gamePk, matchup, 'away', '', '', '', 'NO']);
      if (!homeOk) tabRows.push([gamePk, matchup, 'home', '', '', '', 'NO']);
    });
  });

  // Write debug tab.
  let sh = ss.getSheetByName(MLB_LINEUP_DATA_TAB);
  if (!sh) sh = ss.insertSheet(MLB_LINEUP_DATA_TAB);
  else sh.clearContents();
  sh.setTabColor('#7b1fa2');
  sh.getRange(1, 1, tabRows.length, tabRows[0].length).setValues(tabRows);
  sh.getRange(1, 1, 1, tabRows[0].length).setFontWeight('bold').setBackground('#4a148c').setFontColor('#fff');

  Logger.log('mlbFetchAndCacheLineups_: ' + confirmedGames + ' confirmed games cached');
}
```

- [ ] **Step 1.1.3: Commit new file**

```
git add MLBLineups.js
git commit -m "feat(lineups): MLBLineups.js — fetch/cache confirmed batting order per gamePk"
```

### 1.2 Add `LINEUP_PA_SLOT_*` and `H_MODEL_P_SHRINK` Config keys

- [ ] **Step 1.2.1: Add rows to `buildConfigTab` in `Config.js`**

Find the block of `row_('MIN_EDGE_H', ...)` (around line 131). After the new `MAX_ODDS_H` row added in Phase 1 Task 1, append:

```javascript
  // --- Lineup PA-per-slot table (Phase 2A) ---
  row_('LINEUP_PA_SLOT_1', '4.4', 'Estimated PA/game for batting order slot 1. Used when lineup is confirmed; falls back to season PA/game when not. League avg 2024–2025.');
  row_('LINEUP_PA_SLOT_2', '4.3', 'Estimated PA/game for batting order slot 2.');
  row_('LINEUP_PA_SLOT_3', '4.1', 'Estimated PA/game for batting order slot 3.');
  row_('LINEUP_PA_SLOT_4', '4.0', 'Estimated PA/game for batting order slot 4.');
  row_('LINEUP_PA_SLOT_5', '3.9', 'Estimated PA/game for batting order slot 5.');
  row_('LINEUP_PA_SLOT_6', '3.7', 'Estimated PA/game for batting order slot 6.');
  row_('LINEUP_PA_SLOT_7', '3.6', 'Estimated PA/game for batting order slot 7.');
  row_('LINEUP_PA_SLOT_8', '3.4', 'Estimated PA/game for batting order slot 8.');
  row_('LINEUP_PA_SLOT_9', '3.2', 'Estimated PA/game for batting order slot 9.');
  // --- H calibration shrink (Phase 2B) ---
  row_('H_MODEL_P_SHRINK', '0.94', 'Multiplicative shrink on H P(win) before EV calculation. Closes empirical ~6pp calibration gap (model overestimates vs actual hit rate). 1.0 = off. Tune up toward 1.0 as lineup-hydration improves lambda accuracy. If this key is missing, re-run "0. Build Config tab".');
```

- [ ] **Step 1.2.2: Commit**

```
git add Config.js
git commit -m "feat(config): add LINEUP_PA_SLOT_1-9 and H_MODEL_P_SHRINK keys"
```

### 1.3 Wire `MLBLineups.js` into `PipelineMenu.js`

- [ ] **Step 1.3.1: Add cache reset at pipeline start**

In `PipelineMenu.js`, find the cache-reset block (around lines 197–208) ending with the schedule block cache reset:
```javascript
  if (typeof mlbResetScheduleBlockCache_ === 'function') mlbResetScheduleBlockCache_();
```
Add the following line immediately after it:
```javascript
  if (typeof mlbResetLineupsCache_ === 'function') mlbResetLineupsCache_();
```

- [ ] **Step 1.3.2: Add lineup fetch as a pipeline step**

Find (around line 246):
```javascript
  step('MLB schedule (statsapi)', fetchMLBScheduleForSlate);
  step('Pitcher game logs (statsapi)', refreshMLBPitcherGameLogs);
```
Insert a new step between them:
```javascript
  step('MLB schedule (statsapi)', fetchMLBScheduleForSlate);
  step('Lineups (statsapi)', function () {
    if (typeof mlbFetchAndCacheLineups_ === 'function') mlbFetchAndCacheLineups_(ss, cfg);
  });
  step('Pitcher game logs (statsapi)', refreshMLBPitcherGameLogs);
```

- [ ] **Step 1.3.3: Commit**

```
git add PipelineMenu.js
git commit -m "feat(pipeline): add Lineups step (statsapi) after schedule fetch"
```

### 1.4 Inject slot PA into `mlbHitsV2ComputeRow_`

- [ ] **Step 1.4.1: Inject lineup slot PA after `out.estPa` is assigned**

In `MLBBatterHitsV2.js`, find (around line 253–254):
```javascript
  out.paPerGameSzn = mlbHitsV2BatterPaPerGame_(batterId, season);
  out.estPa = out.paPerGameSzn;
```
Add the following lines immediately after them (the slot lookup runs only when `MLBLineups.js` is loaded):
```javascript
  // If tonight's confirmed lineup is available, use batting-order-slot PA
  // instead of season average. Slot 1 ≈ 4.4 PA vs slot 9 ≈ 3.2 PA — a
  // ~0.25 hit-probability swing for a .280 hitter.
  if (typeof mlbLineupSlotForBatter_ === 'function') {
    const slot = mlbLineupSlotForBatter_(gamePk, batterId);
    if (slot) {
      const slotPa = parseFloat(String(cfg['LINEUP_PA_SLOT_' + slot] != null
        ? cfg['LINEUP_PA_SLOT_' + slot] : '0')) || 0;
      if (slotPa > 0) out.estPa = slotPa;
    }
  }
  // abMult (ablation audit) reflects estPa vs season baseline.
  // It is recomputed below from the (potentially updated) out.estPa.
```

Note: the `abMult` line at around line 273–274 already reads `out.estPa / out.paPerGameSzn`, so it will automatically reflect the slot adjustment without a separate change.

- [ ] **Step 1.4.2: Verify the ablation column still makes sense**

Read lines 270–275 of `MLBBatterHitsV2.js` to confirm `abMult` is computed as:
```javascript
  if (!isNaN(out.paPerGameSzn) && out.paPerGameSzn > 0 && !isNaN(out.estPa)) {
    out.abMult = Math.round((out.estPa / out.paPerGameSzn) * 1000) / 1000;
  }
```
If so, no change needed — `abMult` will show the slot adjustment automatically in the ablation panel.

- [ ] **Step 1.4.3: Commit**

```
git add MLBBatterHitsV2.js
git commit -m "feat(hits-v2): inject batting-order-slot PA into estPa when lineup confirmed"
```

### 1.5 Validate lineup hydration end-to-end

- [ ] **Step 1.5.1: Push and run Morning pipeline**

```
clasp push
```
Then run **`⚾ MLB-BOIZ → 🌅 Morning`**.

- [ ] **Step 1.5.2: Check Lineup_Data tab**

Open `📋 Lineup_Data`. Confirm:
- Header row: `gamePk | matchup | team | slot | playerId | playerName | confirmed`
- Games with confirmed lineups have `confirmed = YES` with slots 1–9
- Games without confirmed lineups have `confirmed = NO` with blank slot

If the tab is missing or all rows show `confirmed = NO`, the statsapi endpoint may not have lineups for the current date (common for Morning runs before ~10am ET). This is expected — the fallback to season PA/game applies.

- [ ] **Step 1.5.3: Check `estPa` column in Hits v2 card**

Open `🧪 Batter_Hits_Card_v2-full`. The `estPa` column is column 22 (0-indexed col 21) in the ablation section. For batters in confirmed lineups, the value should match the slot PA (e.g., 4.4 for slot 1, 3.2 for slot 9) rather than the season PA/game average. For unconfirmed batters, the season average applies.

---

## Task 2: H P(win) Shrink Factor

**Files:**
- Modify: `MLBBatterHitsV2.js` (lines ~351–358)

### Context

In `refreshBatterHitsV2BetCard` (around line 351), `pOver` and `pUnder` are computed from Poisson CDF via `mlbProbOverUnderK_`:
```javascript
const pu = hasModel ? mlbProbOverUnderK_(mainPt, lambdaDisp) : { pOver: '', pUnder: '' };
const pOver  = pu.pOver  === '' ? '' : Math.round(pu.pOver  * 1000) / 1000;
const pUnder = pu.pUnder === '' ? '' : Math.round(pu.pUnder * 1000) / 1000;
```
`evO` and `evU` are computed from these `pOver`/`pUnder` values on the next two lines. The shrink is applied between these two blocks so EV recomputes from the shrunk P, but `lambda` (the Poisson mean written to the card's `lambda_H` column) remains unaffected.

- [ ] **Step 2.1: Add shrink factor between P computation and EV computation**

In `MLBBatterHitsV2.js`, find the exact block (around lines 351–358):
```javascript
    const pu = hasModel ? mlbProbOverUnderK_(mainPt, lambdaDisp) : { pOver: '', pUnder: '' };
    const pOver = pu.pOver === '' ? '' : Math.round(pu.pOver * 1000) / 1000;
    const pUnder = pu.pUnder === '' ? '' : Math.round(pu.pUnder * 1000) / 1000;

    const imO = mlbAmericanImplied_(px.over);
    const imU = mlbAmericanImplied_(px.under);
    const evO = pOver !== '' && px.over !== '' ? mlbEvPerDollarRisked_(pOver, px.over) : '';
    const evU = pUnder !== '' && px.under !== '' ? mlbEvPerDollarRisked_(pUnder, px.under) : '';
```
Replace with:
```javascript
    const pu = hasModel ? mlbProbOverUnderK_(mainPt, lambdaDisp) : { pOver: '', pUnder: '' };
    // H_MODEL_P_SHRINK: empirical calibration factor. Model overestimates P(≥1 hit)
    // by ~6pp vs observed; shrinking toward reality prevents false-positive EV signals.
    // Apply here (not in mlbHitsV2ComputeRow_) so lambda and raw P audit cols stay honest.
    const hShrink = (function () {
      const raw = parseFloat(String(cfg['H_MODEL_P_SHRINK'] != null ? cfg['H_MODEL_P_SHRINK'] : '1'));
      return (!isNaN(raw) && raw > 0 && raw <= 1) ? raw : 1;
    })();
    const pOver = pu.pOver === '' ? ''
      : Math.round(Math.min(pu.pOver * hShrink, 0.9999) * 1000) / 1000;
    const pUnder = pu.pUnder === '' ? ''
      : Math.round(Math.min(pu.pUnder * hShrink, 0.9999) * 1000) / 1000;

    const imO = mlbAmericanImplied_(px.over);
    const imU = mlbAmericanImplied_(px.under);
    const evO = pOver !== '' && px.over !== '' ? mlbEvPerDollarRisked_(pOver, px.over) : '';
    const evU = pUnder !== '' && px.under !== '' ? mlbEvPerDollarRisked_(pUnder, px.under) : '';
```

- [ ] **Step 2.2: Commit**

```
git add MLBBatterHitsV2.js
git commit -m "feat(hits-v2): H_MODEL_P_SHRINK — shrink P(win) before EV to close 6pp calibration gap"
```

- [ ] **Step 2.3: Validate**

Push (`clasp push`) and run **`⚾ MLB-BOIZ → 🎯 Batter Hits v2 card only`** (if available in menu) or Morning pipeline.

Open `🧪 Batter_Hits_Card_v2-full`. With `H_MODEL_P_SHRINK = 0.94`, the `p_over` column values should be approximately `0.94 × (old p_over)`. For example:
- Old `p_over = 0.72` → new `p_over ≈ 0.677`
- Old `p_over = 0.65` → new `p_over ≈ 0.611`

The `lambda_H` column must be unchanged (same values as before the shrink).

The bet card should show fewer H plays or lower EV values for H rows — this is expected.

---

## Task 3A: Gate Backtest (`MLBGateBacktest.js`)

**Files:**
- Create: `MLBGateBacktest.js`
- Modify: `PipelineMenu.js` (add menu item)

### Context

`runGateBacktest()` reads `📋 MLB_Results_Log` (same tab as `MLBProfitabilityReport.js`), applies a grid of candidate Config settings, and writes `🔬 Gate_Backtest` with configurations sorted by ROI. It simulates the exact same filter sequence as the bet card but on historical graded rows instead of tonight's card.

Column indices in `📋 MLB_Results_Log` (0-indexed):
- `5` = market, `7` = side, `8` = odds (American), `9` = model P(Win), `10` = EV/$1, `16` = result (WIN/LOSS), `24` = stake $, `25` = pnl $

- [ ] **Step 3A.1: Create `MLBGateBacktest.js`**

Create `MLBGateBacktest.js` at the repo root:

```javascript
// ============================================================
// 🔬 Gate Backtest — simulate Config gate combinations on historical Results Log
// ============================================================
// Iterates a grid of candidate gate values and computes projected ROI,
// hit rate, n bets, and max consecutive losses for each combination.
// Output: 🔬 Gate_Backtest tab, sorted by ROI desc.
// Run from menu after grading; never runs automatically.
// ============================================================

const MLB_GATE_BACKTEST_TAB = '🔬 Gate_Backtest';

// Parameter search grid. Edit these arrays and re-run to change the search space.
// Total combinations = product of all array lengths. Current default: 4×3×5×4×5 = 1200.
const MLB_BACKTEST_GRID = {
  MIN_MODEL_PCT_K_OVER:  [0.58, 0.60, 0.62, 0.65],
  MIN_MODEL_PCT_K_UNDER: [0.70, 0.75, 0.80],
  MAX_ODDS_H:            [-110, -120, -130, -150, 0],
  MIN_EV_BET_CARD:       [0, 0.02, 0.03, 0.05],
  H_MODEL_P_SHRINK:      [0.90, 0.92, 0.94, 0.96, 1.00],
};

const MLB_BACKTEST_MIN_N = 10;  // skip configs with fewer graded rows than this

function runGateBacktest() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logSh = ss.getSheetByName(MLB_RESULTS_LOG_TAB);
  if (!logSh || logSh.getLastRow() < 4) {
    ss.toast('No graded data in ' + MLB_RESULTS_LOG_TAB, 'Gate Backtest', 6);
    return;
  }

  const data = logSh.getRange(4, 1, logSh.getLastRow() - 3, MLB_RESULTS_LOG_NCOL).getValues();
  const graded = data.filter(function (r) {
    return r && r[16] === 'WIN' || r[16] === 'LOSS';
  });

  if (graded.length < MLB_BACKTEST_MIN_N) {
    ss.toast('Need ≥' + MLB_BACKTEST_MIN_N + ' graded rows', 'Gate Backtest', 6);
    return;
  }

  // Pre-parse all rows once.
  const parsed = graded.map(function (r) {
    const mktStr = String(r[5] || '').toLowerCase();
    return {
      isK: mktStr.indexOf('strikeout') !== -1,
      isH: mktStr.indexOf('batter hit') !== -1,
      side: String(r[7] || '').toLowerCase(),
      odds: parseFloat(String(r[8] || '0')) || 0,
      modelP: parseFloat(String(r[9] || '0')) || 0,
      ev: parseFloat(String(r[10] || '0')) || 0,
      result: r[16],
      stake: parseFloat(String(r[24] || '0')) || 0,
      pnl: parseFloat(String(r[25] || '0')) || 0,
    };
  });

  // Build grid combinations.
  const gridKeys = Object.keys(MLB_BACKTEST_GRID);
  const combos = [{}];
  gridKeys.forEach(function (key) {
    const vals = MLB_BACKTEST_GRID[key];
    const next = [];
    combos.forEach(function (existing) {
      vals.forEach(function (v) {
        const combo = {};
        gridKeys.forEach(function (k) { if (existing[k] !== undefined) combo[k] = existing[k]; });
        combo[key] = v;
        next.push(combo);
      });
    });
    combos.length = 0;
    next.forEach(function (c) { combos.push(c); });
  });

  // Evaluate each combination.
  const results = [];
  combos.forEach(function (g) {
    const kOverFloor = g['MIN_MODEL_PCT_K_OVER']  || 0.60;
    const kUnderFloor = g['MIN_MODEL_PCT_K_UNDER'] || 0.75;
    const maxOddsH = g['MAX_ODDS_H'] || 0;  // 0 = disabled
    const minEv = g['MIN_EV_BET_CARD'] || 0;
    const hShrink = g['H_MODEL_P_SHRINK'] || 1.0;

    let n = 0, wins = 0, stake = 0, pnl = 0;
    let maxConsecLoss = 0, curConsecLoss = 0;

    parsed.forEach(function (row) {
      // Apply gate filters.
      if (row.isK) {
        const floor = row.side === 'under' ? kUnderFloor : kOverFloor;
        if (row.modelP < floor) return;
      } else if (row.isH) {
        if (maxOddsH < 0 && row.odds < maxOddsH) return;
      } else {
        return;  // skip other markets
      }
      if (minEv > 0 && row.ev < minEv) return;
      // H_MODEL_P_SHRINK affects EV stored in log only for rows logged after the
      // shrink was applied. For backtest, we simulate it as a conceptual filter:
      // if hShrink < 1 and the row's market is H, skip rows where shrunk_P < 0.52
      // (rough proxy for EV turning negative after shrink at avg -145 odds).
      if (row.isH && hShrink < 1) {
        const shrunkP = row.modelP * hShrink;
        // Re-check EV with shrunk P at the stored odds.
        const decimalOdds = row.odds >= 0
          ? (row.odds / 100 + 1)
          : (1 - 100 / row.odds);
        const shrunkEv = shrunkP * (decimalOdds - 1) - (1 - shrunkP);
        if (minEv > 0 && shrunkEv < minEv) return;
        if (shrunkEv <= 0) return;
      }

      n++;
      const isWin = row.result === 'WIN';
      if (isWin) {
        wins++;
        curConsecLoss = 0;
      } else {
        curConsecLoss++;
        if (curConsecLoss > maxConsecLoss) maxConsecLoss = curConsecLoss;
      }
      stake += row.stake;
      pnl += row.pnl;
    });

    if (n < MLB_BACKTEST_MIN_N) return;
    const hitRate = wins / n;
    const roi = stake > 0 ? pnl / stake : 0;
    // Sharpe proxy: roi / stddev(binary pnl per bet). Simplified: roi / sqrt(hitRate*(1-hitRate)).
    const sharpe = hitRate > 0 && hitRate < 1
      ? roi / Math.sqrt(hitRate * (1 - hitRate) / n)
      : 0;

    results.push({
      n: n,
      wins: wins,
      hitRate: hitRate,
      roi: roi,
      pnl: pnl,
      stake: stake,
      maxConsecLoss: maxConsecLoss,
      sharpe: sharpe,
      params: g,
    });
  });

  // Sort by ROI desc.
  results.sort(function (a, b) { return b.roi - a.roi; });

  // Write output tab.
  let sh = ss.getSheetByName(MLB_GATE_BACKTEST_TAB);
  if (!sh) sh = ss.insertSheet(MLB_GATE_BACKTEST_TAB);
  else sh.clearContents().clearFormats();
  sh.setTabColor('#1b5e20');

  const header = [
    'ROI', 'n', 'wins', 'hit%', 'pnl $', 'stake $', 'max_consec_loss', 'sharpe',
    'K_OVER_floor', 'K_UNDER_floor', 'MAX_ODDS_H', 'MIN_EV', 'H_SHRINK',
  ];
  sh.getRange(1, 1, 1, header.length)
    .setValues([header])
    .setFontWeight('bold')
    .setBackground('#1b5e20')
    .setFontColor('#ffffff');

  const rows = results.map(function (r) {
    return [
      Math.round(r.roi * 10000) / 100 + '%',
      r.n,
      r.wins,
      Math.round(r.hitRate * 1000) / 10 + '%',
      Math.round(r.pnl * 100) / 100,
      Math.round(r.stake * 100) / 100,
      r.maxConsecLoss,
      Math.round(r.sharpe * 100) / 100,
      r.params['MIN_MODEL_PCT_K_OVER'],
      r.params['MIN_MODEL_PCT_K_UNDER'],
      r.params['MAX_ODDS_H'],
      r.params['MIN_EV_BET_CARD'],
      r.params['H_MODEL_P_SHRINK'],
    ];
  });

  if (rows.length > 0) {
    sh.getRange(2, 1, rows.length, header.length).setValues(rows);
  } else {
    sh.getRange(2, 1).setValue('No configurations passed the n≥' + MLB_BACKTEST_MIN_N + ' filter.');
  }

  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, header.length);
  ss.toast('Gate backtest: ' + results.length + ' configs evaluated · best ROI: '
    + (results[0] ? results[0].roi.toFixed(1) + '%' : 'n/a'), 'Gate Backtest', 8);
  try { sh.activate(); } catch (e) {}
}
```

- [ ] **Step 3A.2: Add menu item for gate backtest**

In `PipelineMenu.js`, find the `SpreadsheetApp.getUi().createMenu` block that builds the `⚾ MLB-BOIZ` menu. Add the backtest item alongside the profitability report item:
```javascript
    .addItem('🔬 Run gate backtest', 'runGateBacktest')
```
Place it after the `'💰 Refresh profitability report'` item.

- [ ] **Step 3A.3: Commit**

```
git add MLBGateBacktest.js PipelineMenu.js
git commit -m "feat(backtest): gate backtest tab — simulate gate combinations on historical Results Log"
```

- [ ] **Step 3A.4: Validate**

Push (`clasp push`). Run **`⚾ MLB-BOIZ → 🔬 Run gate backtest`**.

Open `🔬 Gate_Backtest`. Confirm:
- Header row has the 13 columns listed above
- Results are sorted by ROI descending
- `n` column values are all ≥ 10
- The combination `K_OVER_floor=0.60, K_UNDER_floor=0.75, MAX_ODDS_H=-130, MIN_EV=0.03, H_SHRINK=0.94` appears somewhere in the results with sensible ROI/hit-rate numbers

---

## Task 3B: Auto-Calibration Config Writer (`MLBCalibration.js`)

**Files:**
- Modify: `MLBCalibration.js` (append two new functions)
- Modify: `PipelineMenu.js` (FINAL auto-call + new menu item)

### Context

`refreshBetCardCalibration()` already writes `recommended_min_model_pct` to column K (col 11, 1-indexed) of the per-market summary rows (rows 4–7 of `🎯 Bet_Card_Calibration`). The markets in order are: STRIKEOUTS, TOTAL BASES, HITS, HITS (shadow). We map: STRIKEOUTS → `MIN_MODEL_PCT_K`, HITS → `MIN_MODEL_PCT_H`.

The `recommended_min_model_pct` cell contains either a number (e.g. `0.6`) or the string `'— (no qualifying bucket)'`.

`setConfigValue_(key, value)` is already defined in `Config.js` — it writes to the CONFIG named range.

- [ ] **Step 3B.1: Add `mlbWriteCalibrationProposals_` to `MLBCalibration.js`**

Append to `MLBCalibration.js` (after `mlbActivateCalibrationTab_`):

```javascript
/**
 * Reads the recommended_min_model_pct column from the calibration summary
 * and appends a "Proposed Config Updates" section at the bottom of the tab.
 * Called automatically on FINAL. Does NOT write to Config — use
 * mlbApplyCalibrationProposals_ for that (menu action, requires human review).
 */
function mlbWriteCalibrationProposals_(ss, cfg) {
  const sh = ss.getSheetByName(MLB_CALIBRATION_TAB);
  if (!sh || sh.getLastRow() < 4) return;

  // Read summary rows (rows 4–7): market name in col 1, recommended floor in col 11.
  const summaryData = sh.getRange(4, 1, 4, 11).getValues();
  const proposals = [];
  const MARKET_TO_CONFIG_KEY = {
    'STRIKEOUTS': 'MIN_MODEL_PCT_K',
    'HITS': 'MIN_MODEL_PCT_H',
  };

  summaryData.forEach(function (row) {
    const market = String(row[0] || '').trim().toUpperCase();
    const configKey = MARKET_TO_CONFIG_KEY[market];
    if (!configKey) return;
    const rec = row[10];
    if (rec === '' || rec === null || String(rec).indexOf('no qualifying') !== -1) return;
    const recNum = parseFloat(String(rec));
    if (isNaN(recNum)) return;
    const current = parseFloat(String(cfg[configKey] || '0')) || 0;
    proposals.push({
      key: configKey,
      current: current || 0.60,
      recommended: recNum,
      direction: recNum > (current || 0.60) ? '↑ tighten' : recNum < (current || 0.60) ? '↓ loosen' : '= no change',
    });
  });

  // Write proposals section below the existing content.
  const lastRow = sh.getLastRow();
  const startRow = lastRow + 2;
  sh.getRange(startRow, 1, 1, 4)
    .merge()
    .setValue('📝 Proposed Config Updates (review then run "✅ Apply calibration → Config" from menu)')
    .setFontWeight('bold')
    .setBackground('#e65100')
    .setFontColor('#ffffff');

  const hdr = [['Config Key', 'Current', 'Recommended', 'Direction']];
  sh.getRange(startRow + 1, 1, 1, 4)
    .setValues(hdr)
    .setFontWeight('bold')
    .setBackground('#bf360c')
    .setFontColor('#ffffff');

  if (proposals.length === 0) {
    sh.getRange(startRow + 2, 1).setValue('No qualifying buckets — need n≥10 with positive edge to recommend a floor.');
    return;
  }

  const rows = proposals.map(function (p) {
    return [p.key, p.current, p.recommended, p.direction];
  });
  sh.getRange(startRow + 2, 1, rows.length, 4).setValues(rows);
}

/**
 * Reads the proposals written by mlbWriteCalibrationProposals_ and applies them
 * to the Config tab. Called from menu (human-triggered). Idempotent.
 */
function mlbApplyCalibrationProposals_(ss) {
  if (!ss) ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(MLB_CALIBRATION_TAB);
  if (!sh) {
    ss.toast('Run calibration first', 'Apply Calibration', 5);
    return;
  }

  // Find the proposals section (look for the orange header).
  const allData = sh.getRange(1, 1, sh.getLastRow(), 4).getValues();
  let proposalStartRow = -1;
  for (let i = allData.length - 1; i >= 0; i--) {
    if (String(allData[i][0]).indexOf('Proposed Config') !== -1) {
      proposalStartRow = i + 3;  // skip section header + column header
      break;
    }
  }

  if (proposalStartRow < 0) {
    ss.toast('No proposals found — run FINAL pipeline first', 'Apply Calibration', 5);
    return;
  }

  let applied = 0;
  for (let i = proposalStartRow; i < allData.length; i++) {
    const key = String(allData[i][0] || '').trim();
    const rec = parseFloat(String(allData[i][2] || ''));
    if (!key || isNaN(rec)) break;
    setConfigValue_(key, rec);
    applied++;
  }

  ss.toast(applied + ' Config key(s) updated from calibration proposals', 'Apply Calibration', 6);
}
```

- [ ] **Step 3B.2: Add FINAL auto-call in `PipelineMenu.js`**

Find the FINAL block where `runPitcherDataDiagnostic` and `refreshMLBProfitabilityReport` are called (around lines 423–435). Add the following block after `refreshMLBProfitabilityReport`:

```javascript
  if (windowTag === 'FINAL' && typeof mlbWriteCalibrationProposals_ === 'function') {
    try {
      mlbWriteCalibrationProposals_(ss, getConfig());
    } catch (e) {
      addPipelineWarning_('Calibration proposals: ' + (e.message || e));
    }
  }
```

- [ ] **Step 3B.3: Add menu item**

In the `⚾ MLB-BOIZ` menu builder in `PipelineMenu.js`, add:
```javascript
    .addItem('✅ Apply calibration → Config', 'mlbApplyCalibrationProposals_')
```
Place it after the `'🔬 Run gate backtest'` item.

Note: `mlbApplyCalibrationProposals_` can be called from the menu without `ss` argument because `ss` defaults to `SpreadsheetApp.getActiveSpreadsheet()` inside the function.

- [ ] **Step 3B.4: Commit**

```
git add MLBCalibration.js PipelineMenu.js
git commit -m "feat(calibration): auto-write Config proposals on FINAL + apply-calibration menu action"
```

- [ ] **Step 3B.5: Validate**

Push (`clasp push`). Run **`⚾ MLB-BOIZ → 🔒 Final`** (or manually call `refreshBetCardCalibration` then `mlbWriteCalibrationProposals_` from the script editor).

Open `🎯 Bet_Card_Calibration`. Scroll to the bottom. Confirm:
- An orange "📝 Proposed Config Updates" section appears
- The rows show `MIN_MODEL_PCT_K` and `MIN_MODEL_PCT_H` with current → recommended values
- Direction column shows `↑ tighten` / `↓ loosen` / `= no change` as appropriate

Then run **`⚾ MLB-BOIZ → ✅ Apply calibration → Config`**. Open `⚙️ Config` and confirm the target keys were updated to the recommended values.

---

## Self-Review Checklist (spec coverage)

| Spec §  | Requirement | Task |
|---------|-------------|------|
| §4.1 | `MLBLineups.js` with `mlbFetchAndCacheLineups_`, `mlbLineupSlotForBatter_`, `mlbResetLineupsCache_` | Task 1.1 |
| §4.2 | `LINEUP_PA_SLOT_1..9` Config keys | Task 1.2 |
| §4.3 | `out.estPa` injection in `mlbHitsV2ComputeRow_` | Task 1.4 |
| §4.4 | Pipeline step + cache reset | Task 1.3 |
| §4 — H v3 | v3 inherits from v2 struct automatically — no separate change needed | ✓ (noted) |
| §5 | `H_MODEL_P_SHRINK` Config key + shrink in `MLBBatterHitsV2.js` | Tasks 1.2 + 2 |
| §6.1 | `MLBGateBacktest.js` + `🔬 Gate_Backtest` tab + menu item | Task 3A |
| §6.2 | `mlbWriteCalibrationProposals_` on FINAL + `mlbApplyCalibrationProposals_` menu | Task 3B |
| §7 | Fallback when lineup absent — `mlbLineupSlotForBatter_` returns null → estPa unchanged | Task 1.4 |
| §8 | Validation steps for 2A, 2B, 2C | Steps 1.5, 2.3, 3A.4, 3B.5 |
