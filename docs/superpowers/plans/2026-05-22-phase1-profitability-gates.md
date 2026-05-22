# Phase 1: Profitability Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire four data-backed gate changes that stop real-money losses from K Unders, thin K plays, the H -155 to -130 odds death zone, and thin EV noise — while ensuring the profitability report fires automatically on every FINAL run.

**Architecture:** All changes are Config keys + small guard clauses in `MLBBetCard.js` + one auto-run hook in `PipelineMenu.js`. No new files. Every new guard degrades gracefully to today's behavior if the new Config key is absent (old sheet). The spec lives at `docs/superpowers/specs/2026-05-22-profitability-robustness-design.md` §3.

**Tech Stack:** Google Apps Script (V8 runtime), Google Sheets. Deploy via `clasp push`. No npm, no tests runner — validation is behavioral (run the pipeline, inspect the bet card).

---

## File Map

| File | Change |
|------|--------|
| `Config.js` | Add 3 new `row_()` calls in `buildConfigTab`; add 2 new `warnRange()` calls in `validateConfig_` |
| `MLBBetCard.js` | Extend `mlbBetCardThresholds_` for per-side K floors; add H odds cap + EV floor guards in `refreshMLBBetCard` |
| `PipelineMenu.js` | Add `refreshMLBProfitabilityReport` call in FINAL block |

---

## Task 1: Add new Config keys

**Files:**
- Modify: `Config.js` (lines 124–131 and 237–241)

### Context

`buildConfigTab()` writes rows to `⚙️ Config` using `row_(key, default, note)`. New keys are appended after existing ones — the sheet is rebuilt from scratch each run, so order matters only for readability. `validateConfig_()` calls `warnRange(label, raw, lo, hi)` to flag out-of-range values.

Current last keys before the betting section (lines 124–131):
```javascript
row_('MIN_EV_BET_CARD', '0', '...');
row_('MIN_MODEL_PCT_BET_CARD', '0.60', '...');
row_('MIN_MODEL_PCT_K',  '', '...');
row_('MIN_MODEL_PCT_TB', '', '...');
row_('MIN_MODEL_PCT_H',  '', '...');
row_('MIN_EDGE_K',  '0', '...');
row_('MIN_EDGE_TB', '0', '...');
row_('MIN_EDGE_H',  '0', '...');
```

- [ ] **Step 1.1: Add `MIN_MODEL_PCT_K_OVER`, `MIN_MODEL_PCT_K_UNDER`, `MAX_ODDS_H` rows**

In `Config.js`, find the block ending with `row_('MIN_EDGE_H', ...)` (around line 131). Add three new rows immediately after it:

```javascript
  row_('MIN_MODEL_PCT_K_OVER',  '0.60', 'Model P(Win) floor for K OVER plays on 🃏 card. Blank = use MIN_MODEL_PCT_K → MIN_MODEL_PCT_BET_CARD → 0.60. Data: K Over ≥0.60 shows +3.5pp edge (n=309 graded).');
  row_('MIN_MODEL_PCT_K_UNDER', '0.75', 'Model P(Win) floor for K UNDER plays on 🃏 card. Higher than Over floor — K Unders below 0.75 show -14% ROI (n≈378). Blank falls back to MIN_MODEL_PCT_K.');
  row_('MAX_ODDS_H', '-130', 'Max juice (American) for BATTER HITS plays on 🃏 card. H at -155 to -130 shows -34.4% ROI (n=178). 0 or blank = no cap. Example: -130 gates out -140, -155, -200 etc.');
```

- [ ] **Step 1.2: Update the existing `MIN_EV_BET_CARD` default from `'0'` to `'0.03'`**

Still in `Config.js`, find:
```javascript
  row_('MIN_EV_BET_CARD', '0', 'Min EV per $1 on 🃏 card; 0 = any positive EV ...
```
Change the default value from `'0'` to `'0.03'`:
```javascript
  row_('MIN_EV_BET_CARD', '0.03', 'Min EV per $1 on 🃏 card; 0 = any positive EV (any edge). 0.03 gates thin-positive noise while keeping real edge plays. Tune from 💰 Profitability_Report. If this key is missing, re-run menu "0. Build Config tab".');
```

- [ ] **Step 1.3: Add warnRange calls for the new keys**

In `validateConfig_()` (around line 237), add two lines after the existing `warnRange('MIN_EV_BET_CARD', ...)` line:
```javascript
  warnRange('MIN_MODEL_PCT_K_OVER',  c['MIN_MODEL_PCT_K_OVER'],  0.50, 0.90);
  warnRange('MIN_MODEL_PCT_K_UNDER', c['MIN_MODEL_PCT_K_UNDER'], 0.50, 0.95);
  warnRange('MAX_ODDS_H', c['MAX_ODDS_H'], -300, 0);
```

- [ ] **Step 1.4: Verify build**

Run `clasp push` (or paste into Apps Script editor). Then run menu **`⚾ MLB-BOIZ → 0. Build Config tab`**. Open `⚙️ Config` and confirm these rows appear with the correct default values:
- `MIN_MODEL_PCT_K_OVER` → `0.60`
- `MIN_MODEL_PCT_K_UNDER` → `0.75`
- `MAX_ODDS_H` → `-130`
- `MIN_EV_BET_CARD` → `0.03`

- [ ] **Step 1.5: Commit**

```
git add Config.js
git commit -m "feat(config): add per-side K floors, H odds cap, update MIN_EV default to 0.03"
```

---

## Task 2: Per-side K floors in `mlbBetCardThresholds_`

**Files:**
- Modify: `MLBBetCard.js` (lines 29–44 and 99–100)

### Context

`mlbBetCardThresholds_(cfg, marketKey)` currently takes two args and returns `{ minP, minEdge }`. The K block reads the threshold like this (line 99):
```javascript
const kThr = mlbBetCardThresholds_(cfg, 'K');
if (isNaN(pwNum) || pwNum < kThr.minP) return;
```

We need to pass `bestSide` so the function can look up `MIN_MODEL_PCT_K_OVER` or `MIN_MODEL_PCT_K_UNDER`. The function signature gains an optional third parameter; existing callers without a `side` arg continue to work unchanged.

- [ ] **Step 2.1: Extend `mlbBetCardThresholds_` to accept optional `side`**

Replace the entire function (lines 33–44) with:
```javascript
function mlbBetCardThresholds_(cfg, marketKey, side) {
  const globalRaw = String(cfg['MIN_MODEL_PCT_BET_CARD'] != null ? cfg['MIN_MODEL_PCT_BET_CARD'] : '').trim();
  const globalNum = parseFloat(globalRaw, 10);
  const globalP = !isNaN(globalNum) && globalNum > 0 ? globalNum : MLB_BET_CARD_MIN_MODEL_PCT;

  // Per-side key (K only for now): MIN_MODEL_PCT_K_OVER / MIN_MODEL_PCT_K_UNDER.
  // Falls back to per-market key (MIN_MODEL_PCT_K), then global, then 0.60.
  let sideKey = '';
  if (marketKey === 'K' && side) {
    sideKey = 'MIN_MODEL_PCT_K_' + String(side).toUpperCase();
  }
  const sideRaw = sideKey ? String(cfg[sideKey] != null ? cfg[sideKey] : '').trim() : '';
  const sideNum = parseFloat(sideRaw, 10);

  const pRaw = String(cfg['MIN_MODEL_PCT_' + marketKey] != null ? cfg['MIN_MODEL_PCT_' + marketKey] : '').trim();
  const pNum = parseFloat(pRaw, 10);
  const marketP = !isNaN(pNum) && pNum > 0 ? pNum : globalP;

  const minP = (!isNaN(sideNum) && sideNum > 0) ? sideNum : marketP;

  const eRaw = String(cfg['MIN_EDGE_' + marketKey] != null ? cfg['MIN_EDGE_' + marketKey] : '0').trim();
  const eNum = parseFloat(eRaw, 10);
  const minEdge = !isNaN(eNum) && eNum > 0 ? eNum : 0;
  return { minP: minP, minEdge: minEdge };
}
```

- [ ] **Step 2.2: Pass `bestSide` at the K call site**

Find (around line 99):
```javascript
      const kThr = mlbBetCardThresholds_(cfg, 'K');
```
Replace with:
```javascript
      const kThr = mlbBetCardThresholds_(cfg, 'K', bestSide);
```

- [ ] **Step 2.3: Verify fallback logic mentally**

Walk through the three cases:
1. `MIN_MODEL_PCT_K_OVER = 0.60`, side = `'Over'` → `sideKey = 'MIN_MODEL_PCT_K_OVER'` → minP = 0.60 ✓
2. `MIN_MODEL_PCT_K_UNDER = 0.75`, side = `'Under'` → `sideKey = 'MIN_MODEL_PCT_K_UNDER'` → minP = 0.75 ✓
3. Key missing (old sheet), side = `'Under'` → `sideRaw = ''` → falls back to `MIN_MODEL_PCT_K` → `MIN_MODEL_PCT_BET_CARD` → 0.60 ✓

- [ ] **Step 2.4: Commit**

```
git add MLBBetCard.js
git commit -m "feat(bet-card): per-side K model% floors (K_OVER=0.60, K_UNDER=0.75)"
```

---

## Task 3: H odds cap + EV floor in `refreshMLBBetCard`

**Files:**
- Modify: `MLBBetCard.js` (H block, lines ~149–217)

### Context

The H block loop (starting line 149) validates `american` then immediately calls `mlbBetCardThresholds_`. We insert the odds cap check right after the `american` validity check (line 170). The EV floor check goes right after the existing `if (isNaN(ev) || ev <= 0) return;` check (line 184) — for both K and H blocks.

- [ ] **Step 3.1: Add H odds cap in the H block**

Find this line in the H block (around line 170):
```javascript
      if (american === '' || american == null || isNaN(parseFloat(String(american)))) return;
```
Add the following two lines immediately after it:
```javascript
      const maxOddsH = parseFloat(String(cfg['MAX_ODDS_H'] != null ? cfg['MAX_ODDS_H'] : '0')) || 0;
      if (maxOddsH < 0 && parseFloat(String(american)) < maxOddsH) return;
```

**How the math works:** American odds of -155 are numerically less than -130 (`-155 < -130` is true in JavaScript). So `american < maxOddsH` correctly identifies "too much juice" when `maxOddsH = -130`. The `maxOddsH < 0` guard means if the Config value is `0` or blank (disabled), the check is skipped entirely.

- [ ] **Step 3.2: Add EV floor in the K block**

Find this line in the K block (around line 106):
```javascript
      if (isNaN(ev) || ev <= 0) return;
```
Add the following two lines immediately after it:
```javascript
      const minEvK = parseFloat(String(cfg['MIN_EV_BET_CARD'] != null ? cfg['MIN_EV_BET_CARD'] : '0')) || 0;
      if (minEvK > 0 && ev < minEvK) return;
```

- [ ] **Step 3.3: Add EV floor in the H block**

Find this line in the H block (around line 184):
```javascript
      if (isNaN(ev) || ev <= 0) return;
```
Add the following two lines immediately after it:
```javascript
      const minEvH = parseFloat(String(cfg['MIN_EV_BET_CARD'] != null ? cfg['MIN_EV_BET_CARD'] : '0')) || 0;
      if (minEvH > 0 && ev < minEvH) return;
```

- [ ] **Step 3.4: Verify guards are correct by reading them back**

After editing, the H filter sequence should read:
```
1. injury flag check
2. bestSide check (Over/Under)
3. line check
4. american validity check
5. ← NEW: H odds cap (MAX_ODDS_H)
6. batter name check
7. pWin floor check (mlbBetCardThresholds_)
8. edge floor check (minEdge)
9. EV > 0 check
10. ← NEW: EV floor (MIN_EV_BET_CARD)
11. grade check
```

The K filter sequence should read the same order with the EV floor at step 10.

- [ ] **Step 3.5: Commit**

```
git add MLBBetCard.js
git commit -m "feat(bet-card): H odds cap MAX_ODDS_H + enforce MIN_EV_BET_CARD on live card"
```

---

## Task 4: Auto-run profitability report on FINAL

**Files:**
- Modify: `PipelineMenu.js` (FINAL block, around lines 423–429)

### Context

`runPitcherDataDiagnostic` is already auto-run on FINAL (lines 423–428). The profitability report function (`refreshMLBProfitabilityReport`) is defined in `MLBProfitabilityReport.js` and works standalone. We add it in the same FINAL block pattern, wrapped in try/catch with a pipeline warning on failure.

- [ ] **Step 4.1: Add profitability report call in FINAL block**

Find this block (around lines 423–429):
```javascript
  if (windowTag === 'FINAL' && typeof runPitcherDataDiagnostic === 'function') {
    try {
      runPitcherDataDiagnostic();
    } catch (e) {
      addPipelineWarning_('Pitcher diagnostic: ' + (e.message || e));
    }
  }
```
Add the following block immediately after it (before `outcomes.forEach`):
```javascript
  if (windowTag === 'FINAL' && typeof refreshMLBProfitabilityReport === 'function') {
    try {
      refreshMLBProfitabilityReport();
    } catch (e) {
      addPipelineWarning_('Profitability report: ' + (e.message || e));
    }
  }
```

- [ ] **Step 4.2: Commit**

```
git add PipelineMenu.js
git commit -m "feat(pipeline): auto-run profitability report on FINAL window"
```

---

## Task 5: End-to-end validation

**Files:** None — behavioral verification only.

- [ ] **Step 5.1: Push to Apps Script**

```
clasp push
```
Expected: no syntax errors in output.

- [ ] **Step 5.2: Rebuild Config tab**

Run menu **`⚾ MLB-BOIZ → 0. Build Config tab`**.
Open `⚙️ Config`. Confirm the following rows exist with these values:
- `MIN_MODEL_PCT_K_OVER` = `0.60`
- `MIN_MODEL_PCT_K_UNDER` = `0.75`
- `MAX_ODDS_H` = `-130`
- `MIN_EV_BET_CARD` = `0.03`

- [ ] **Step 5.3: Rebuild the bet card from existing model tabs**

Run menu **`⚾ MLB-BOIZ → 🃏 Bet Card only`** (or Morning pipeline if model tabs are stale).

Open `🃏 MLB_Bet_Card`. Verify:
1. **K Unders at model% < 0.75 are absent.** If any K Under row appears, its `model %` column must read ≥ 75%.
2. **No H play with odds more negative than -130 appears.** Check the `odds` column for all H rows — no value below -130 (e.g. -140, -155, -200 must not appear).
3. **No play with EV/$1 < 0.03 appears.** Check the `ev/$1` column — all values must be ≥ 0.03.

- [ ] **Step 5.4: Sanity-check the K Over floor is unchanged**

In the bet card, confirm K Over plays with model% ≥ 0.60 still appear. The floor for Overs should not have tightened (it's the same 0.60 as before, just now explicit).

- [ ] **Step 5.5: Verify FINAL auto-run (deferred — run at end of day)**

After grading runs automatically at FINAL, open `💰 Profitability_Report`. Confirm the tab was updated (check the timestamp or a row count).

- [ ] **Step 5.6: Final commit / tag**

```
git add .
git commit -m "chore: phase 1 validation complete — K/H gates + profitability auto-run live"
```

---

## Rollback

If any gate is too aggressive (e.g. MAX_ODDS_H -130 cuts too many H plays), simply update the Config tab value in the spreadsheet:
- Set `MAX_ODDS_H` to `-150` to loosen the H cap
- Set `MIN_MODEL_PCT_K_UNDER` to `0.70` to loosen the Under floor
- Set `MIN_EV_BET_CARD` to `0` to disable the EV floor

No code change required. Config is read fresh each pipeline run.
