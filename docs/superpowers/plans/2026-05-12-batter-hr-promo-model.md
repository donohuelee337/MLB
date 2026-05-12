# Batter HR promo model — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a **promo-focused** batter HR ranking sheet keyed by **`gamePk` + `batterId`**, using **lineup-based expected PA**, **opponent SP HR environment**, **HR park factors**, optional **degraded roster fallback**, **Poisson `P(HR≥1)`**, and **optional Platt calibration** from historical results—per `docs/superpowers/specs/2026-05-12-batter-hr-promo-predictive-model-design.md`.

**Architecture:** Pure math and calibration helpers live in **`MLBHrPromoModelCore.js`** and **`MLBHrPromoEval.js`**. Network + sheet orchestration lives in **`MLBHrPromoRefresh.js`** (boxscore lineup parse, pitcher season HR rate, batter season HR/PA with shrinkage + L14 blend, λ assembly, write **`📣 Batter_HR_Promo`**). **Weather** is explicitly a no-op in phase 1 (always multiplier `1` and empty column) until a provider is chosen; config keys are reserved. **Statcast** is out of scope (phase 2 in spec).

**Tech stack:** Google Apps Script (V8), MLB Stats API (`mlbStatsApiBaseUrl_()` from `MLBPitcherGameLogs.js`), existing schedule tab `MLB_SCHEDULE_TAB` in `MLBSchedule.js`, existing HR park helper `mlbParkHrLambdaMultForHomeAbbr_` in `MLBParkFactors.js`, existing team hitting fetch pattern from `MLBBatterHRQueue.js` (`mlbFetchTeamHittingStats_`), game-log splits pattern from `MLBBatterTBQueue.js` (`mlbStatsApiGetHittingGameSplits_`).

**Spec reference:** `docs/superpowers/specs/2026-05-12-batter-hr-promo-predictive-model-design.md`

---

## File map (create / modify)

| Path | Responsibility |
|------|------------------|
| `MLBHrPromoModelCore.js` | **Create** — PA table, clamps, shrinkage, blend, Poisson `p`, Platt apply, `mlbHrPromoModelSelfTest_`. |
| `MLBHrPromoEval.js` | **Create** — read graded HR rows from results log, fit Platt coefficients, store in Script Properties, `runMlbHrPromoBacktestMenu_` stub that logs Brier vs baseline (expand after labels exist). |
| `MLBHrPromoRefresh.js` | **Create** — `refreshBatterHrPromoSheet_`: schedule iteration, per-game boxscore, lineup parse, SP id resolution, λ row build, sheet write, `addPipelineWarning_` on fallbacks. |
| `Config.js` | **Modify** — new `row_` keys + `validateMlbPipelineConfig_` ranges for HR promo. |
| `MLBBatterTBBetCard.js` | **Modify** — HR card uses **`mlbParkHrLambdaMultForHomeAbbr_`** via `parkFactorFn`; update `cardTitle` text. |
| `PipelineMenu.js` | **Modify** — menu item + `runMLBBallWindow_` step + reindexed `outcomes[]` / `logStep_` for **Batter HR promo** + **MLB Bet Card**; toast coverage. |
| `MLBPipelineLog.js` | **Modify** only if a new near-miss helper is needed; otherwise **no change** (warnings already flow through `addPipelineWarning_`). |

Constants to define in `MLBHrPromoRefresh.js` (not `MLBBatterHRQueue.js` to avoid coupling):

- `MLB_BATTER_HR_PROMO_TAB = '📣 Batter_HR_Promo'`
- `MLB_BATTER_HR_PROMO_NAMED_RANGE = 'MLB_BATTER_HR_PROMO'`

---

### Task 1: `MLBHrPromoModelCore.js` (pure math + self-test)

**Files:**

- Create: `c:\Users\Lee\Documents\Cursor\MLB\MLBHrPromoModelCore.js`
- Test: run `mlbHrPromoModelSelfTest_` from Apps Script editor after `clasp push`

- [ ] **Step 1: Create file with the following exact contents**

```javascript
// ============================================================
// 📐 HR promo model — pure math (no UrlFetchApp)
// ============================================================
// Spec: docs/superpowers/specs/2026-05-12-batter-hr-promo-predictive-model-design.md
// ============================================================

/**
 * Default expected PA by batting order (1..9). Tune only via backtest + config override.
 * @returns {number[]}
 */
function mlbHrPromoDefaultPaTable_() {
  return [4.65, 4.55, 4.45, 4.35, 4.2, 4.05, 3.9, 3.75, 3.6];
}

/**
 * Parse optional JSON array of 9 positive numbers from config HR_PROMO_EXPECTED_PA_JSON.
 * @param {string} jsonRaw
 * @returns {number[]|null}
 */
function mlbHrPromoPaTableFromConfigJson_(jsonRaw) {
  const s = String(jsonRaw || '').trim();
  if (!s) return null;
  try {
    const arr = JSON.parse(s);
    if (!arr || arr.length !== 9) return null;
    const out = [];
    for (let i = 0; i < 9; i++) {
      const x = parseFloat(arr[i], 10);
      if (isNaN(x) || x <= 0) return null;
      out.push(x);
    }
    return out;
  } catch (e) {
    return null;
  }
}

/**
 * @param {number} slot1Based batting order 1..9
 * @param {number[]|null} paTable optional length-9 table
 * @returns {number}
 */
function mlbHrPromoExpectedPaForOrder_(slot1Based, paTable) {
  const t = paTable && paTable.length === 9 ? paTable : mlbHrPromoDefaultPaTable_();
  const slot = parseInt(slot1Based, 10);
  const idx = (isNaN(slot) ? 5 : Math.max(1, Math.min(9, slot))) - 1;
  return t[idx];
}

function mlbHrPromoClamp_(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

/**
 * Pitcher HR environment multiplier: leagueAvg / spHr9, clamped.
 * Missing or non-positive inputs → 1.
 * @param {number} spHr9
 * @param {number} leagueHr9
 * @param {number} lo
 * @param {number} hi
 */
function mlbHrPromoPitcherMultFromHrPer9_(spHr9, leagueHr9, lo, hi) {
  const sp = parseFloat(spHr9, 10);
  const lg = parseFloat(leagueHr9, 10);
  if (isNaN(sp) || sp <= 0 || isNaN(lg) || lg <= 0) return 1;
  return mlbHrPromoClamp_(lg / sp, lo, hi);
}

/**
 * Shrink observed HR/PA toward prior when PA is below minPa (linear weight pa/minPa).
 * @param {number} hr
 * @param {number} pa
 * @param {number} priorHrPerPa
 * @param {number} minPa
 */
function mlbHrPromoShrinkHrPerPa_(hr, pa, priorHrPerPa, minPa) {
  const m = parseInt(minPa, 10) || 30;
  const p = parseInt(pa, 10) || 0;
  const h = parseInt(hr, 10) || 0;
  const prior = parseFloat(priorHrPerPa, 10);
  const pr = !isNaN(prior) && prior >= 0 ? prior : 0.03;
  if (p <= 0) return pr;
  if (p >= m) return h / p;
  const w = p / m;
  return w * (h / p) + (1 - w) * pr;
}

/**
 * Blend season HR/PA with recent HR/PA (e.g. last 14 games as HR/game converted to /PA using expected PA).
 * @param {number} sznHrPerPa
 * @param {number} recentHrPerPa
 * @param {number} weightRecent 0..1
 */
function mlbHrPromoBlendHrPerPa_(sznHrPerPa, recentHrPerPa, weightRecent) {
  const w = Math.max(0, Math.min(1, parseFloat(weightRecent)));
  const a = parseFloat(sznHrPerPa, 10);
  const b = parseFloat(recentHrPerPa, 10);
  if (isNaN(a) || a < 0) return isNaN(b) || b < 0 ? 0 : b;
  if (isNaN(b) || b < 0) return a;
  return (1 - w) * a + w * b;
}

/** @param {number} lambda non-negative */
function mlbHrPromoPoissonPHrGe1_(lambda) {
  const L = Math.max(0, Number(lambda) || 0);
  return 1 - Math.exp(-L);
}

/**
 * Platt scaling on logit(p0). Coefficients from calibration fit.
 * @param {number} p0
 * @param {number} a
 * @param {number} b
 */
function mlbHrPromoPlattP_(p0, a, b) {
  const p = Math.max(1e-6, Math.min(1 - 1e-6, p0));
  const z = Math.log(p / (1 - p));
  const aa = parseFloat(a, 10);
  const bb = parseFloat(b, 10);
  if (isNaN(aa) || isNaN(bb)) return p0;
  const t = aa * z + bb;
  return 1 / (1 + Math.exp(-t));
}

/**
 * Run from Apps Script editor: must not throw.
 * @returns {string}
 */
function mlbHrPromoModelSelfTest_() {
  const t = mlbHrPromoDefaultPaTable_();
  if (t.length !== 9) throw new Error('PA table length');
  if (Math.abs(mlbHrPromoExpectedPaForOrder_(1, t) - 4.65) > 1e-9) throw new Error('slot1 PA');
  if (Math.abs(mlbHrPromoExpectedPaForOrder_(9, t) - 3.6) > 1e-9) throw new Error('slot9 PA');
  if (Math.abs(mlbHrPromoPitcherMultFromHrPer9_(1.2, 1.2, 0.85, 1.15) - 1) > 1e-9) throw new Error('pitcher neutral');
  if (Math.abs(mlbHrPromoPitcherMultFromHrPer9_(2.4, 1.2, 0.85, 1.15) - 0.85) > 1e-9) throw new Error('pitcher clamp low');
  if (Math.abs(mlbHrPromoShrinkHrPerPa_(5, 50, 0.03, 100) - 0.1) > 1e-9) throw new Error('shrink no shrink');
  const sh0 = mlbHrPromoShrinkHrPerPa_(0, 10, 0.03, 100);
  if (Math.abs(sh0 - 0.03) > 1e-9) throw new Error('shrink all prior');
  const p = mlbHrPromoPoissonPHrGe1_(1);
  if (Math.abs(p - (1 - Math.exp(-1))) > 1e-9) throw new Error('poisson');
  const json = '[4,4,4,4,4,4,4,4,4]';
  const custom = mlbHrPromoPaTableFromConfigJson_(json);
  if (!custom || Math.abs(mlbHrPromoExpectedPaForOrder_(2, custom) - 4) > 1e-9) throw new Error('config PA table');
  return 'mlbHrPromoModelSelfTest_: OK';
}
```

- [ ] **Step 2: Push and run the self-test**

Run (repo root, after saving file):

```powershell
cd "c:\Users\Lee\Documents\Cursor\MLB"; clasp push
```

In Apps Script: run **`mlbHrPromoModelSelfTest_`** from the function dropdown.

**Expected:** Execution log ends with `mlbHrPromoModelSelfTest_: OK` and no thrown errors.

- [ ] **Step 3: Commit**

```powershell
cd "c:\Users\Lee\Documents\Cursor\MLB"
git add MLBHrPromoModelCore.js
git commit -m "feat(hr-promo): add pure math core and self-test"
```

---

### Task 2: `Config.js` — new tuning keys

**Files:**

- Modify: `c:\Users\Lee\Documents\Cursor\MLB\Config.js` (inside `buildConfigTab`, after `TB_BLEND_RECENT_WEIGHT` block is a natural place)

- [ ] **Step 1: Insert these `row_` calls after `TB_BLEND_RECENT_WEIGHT`**

```javascript
  row_(
    'HR_PROMO_BLEND_L14_WEIGHT',
    '0.25',
    '0..1 — blend L14 HR/game-derived rate with season HR/PA for 📣 Batter_HR_Promo only. Tune via backtest (not TB_BLEND_RECENT_WEIGHT).'
  );
  row_('HR_PROMO_PITCHER_MULT_MIN', '0.85', 'Clamp floor for opponent SP HR-environment λ multiplier.');
  row_('HR_PROMO_PITCHER_MULT_MAX', '1.15', 'Clamp ceiling for opponent SP HR-environment λ multiplier.');
  row_('LEAGUE_PITCHING_HR9', '1.15', 'League average HR/9 prior for SP mult (seasonal tune yearly).');
  row_('HR_PROMO_SHRINK_MIN_PA', '50', 'Minimum PA for full trust in HR/PA; below this, shrink toward LEAGUE_HITTING_HR_PER_PA.');
  row_('LEAGUE_HITTING_HR_PER_PA', '0.032', 'League HR/PA prior for batter shrinkage (tune yearly).');
  row_('HR_PROMO_CALIB_MIN_ROWS', '500', 'Minimum graded 📋 MLB_Results_Log rows with batter HR market before Platt calibration is applied.');
  row_('HR_PROMO_EXPECTED_PA_JSON', '', 'Optional: JSON array of 9 expected PA for batting orders 1..9; blank = built-in defaults.');
  row_(
    'HR_PROMO_LINEUP_FALLBACK',
    'roster',
    'roster | skip — when boxscore has no batting order: roster = include all team hitters from mlbFetchTeamHittingStats_ with low confidence; skip = omit those games batters.'
  );
  row_('HR_PROMO_WEATHER_ENABLED', 'false', 'Reserved: phase-1 code keeps weather mult at 1. When true + parks allowlisted, future version applies bounded wind/temp mult.');
  row_('HR_PROMO_WEATHER_PARKS', 'CHC,BOS', 'Comma abbrev list — only used when HR_PROMO_WEATHER_ENABLED is true (phase 2).');
```

- [ ] **Step 2: Extend `validateMlbPipelineConfig_`**

After the existing `warnRange('TB_BLEND_RECENT_WEIGHT', ...)` block, add:

```javascript
  warnRange('HR_PROMO_BLEND_L14_WEIGHT', c['HR_PROMO_BLEND_L14_WEIGHT'], 0, 1);
  warnRange('HR_PROMO_PITCHER_MULT_MIN', c['HR_PROMO_PITCHER_MULT_MIN'], 0.7, 1);
  warnRange('HR_PROMO_PITCHER_MULT_MAX', c['HR_PROMO_PITCHER_MULT_MAX'], 1, 1.35);
  warnRange('LEAGUE_PITCHING_HR9', c['LEAGUE_PITCHING_HR9'], 0.5, 2.5);
  warnRange('HR_PROMO_SHRINK_MIN_PA', c['HR_PROMO_SHRINK_MIN_PA'], 1, 200);
  warnRange('LEAGUE_HITTING_HR_PER_PA', c['LEAGUE_HITTING_HR_PER_PA'], 0.01, 0.08);
  warnRange('HR_PROMO_CALIB_MIN_ROWS', c['HR_PROMO_CALIB_MIN_ROWS'], 50, 50000);
```

- [ ] **Step 3: Re-run `buildConfigTab` from the spreadsheet menu**

**Expected:** New keys appear on `⚙️ Config` with defaults above.

- [ ] **Step 4: Commit**

```powershell
git add Config.js
git commit -m "config: add HR promo model tuning keys"
```

---

### Task 3: HR card park factor (HR table, not TB)

**Files:**

- Modify: `c:\Users\Lee\Documents\Cursor\MLB\MLBBatterTBBetCard.js` — function `refreshBatterHrBetCard`

- [ ] **Step 1: Replace `refreshBatterHrBetCard` with**

```javascript
function refreshBatterHrBetCard() {
  mlbBatterPropBetCardBody_({
    queueTab:        MLB_BATTER_HR_QUEUE_TAB,
    alertTitle:      'Batter HR card',
    alertDetail:     'Run Batter HR queue first (pipeline or menu).',
    cardTab:         MLB_BATTER_HR_CARD_TAB,
    cardTitle:       '💥 Batter HR card — λ HR/game blend × park HR mult; Poisson vs FD batter_home_runs',
    tabColor:          '#c2185b',
    headBg:            '#880e4f',
    headBg2:           '#c2185b',
    fdLineHeader:      'fd_hr_line',
    lambdaHeader:      'lambda_HR',
    namedRange:        'MLB_BATTER_HR_CARD',
    toastLabel:        'Batter HR card',
    parkFactorFn:      mlbParkHrLambdaMultForHomeAbbr_,
  });
}
```

- [ ] **Step 2: Manual smoke test**

Run menu **📋 Batter HR queue / card** (or `runBatterHrQueueAndCard_`). Open **`💥 Batter_HR_Card`**: λ values should shift vs previous run when park HR ≠ park TB for that home team.

- [ ] **Step 3: Commit**

```powershell
git add MLBBatterTBBetCard.js
git commit -m "fix(hr-card): apply HR park factor instead of TB park factor"
```

---

### Task 4: `MLBHrPromoRefresh.js` — lineup, λ, sheet

**Files:**

- Create: `c:\Users\Lee\Documents\Cursor\MLB\MLBHrPromoRefresh.js`

**Contract (must all be satisfied in the final concatenated file):**

1. Read `📅 MLB_Schedule` from row 4: col **0** `gamePk`, **3** `away`, **4** `home`, **5** `matchup`, **11** `awayProbablePitcherId`, **12** `homeProbablePitcherId` (0-based indices on the row array).
2. Per `gamePk`, fetch boxscore JSON with `mlbFetchBoxscoreJson_(gamePk)` from `MLBResultsGrader.js` and **`Utilities.sleep(120)`** between games.
3. Parse starters: `teams = mlbBoxscoreTeams_(payload)`; for each `side` in `['away','home']`, `teams[side].players` — for each entry, `battingOrder` → slot `ord = bo >= 100 ? Math.floor(bo/100) : bo` (reject outside 1..9). Collect `{ order, batterId, name }`.
4. Opponent SP: away lineup uses `homeProbablePitcherId`; home uses `awayProbablePitcherId`.
5. Season hitting: `mlbFetchTeamHittingStats_(teamId, abbr, season)` from `MLBBatterHRQueue.js`; cache `batterId → { hr, pa, name }` per abbreviation before the game loop to minimize API calls.
6. L14: `mlbStatsApiGetHittingGameSplits_(batterId, season)` from `MLBBatterTBQueue.js`; sum HR over first `Math.min(14, n)` games (newest-first order already in that helper’s return). `recentHrPerPa = l14Hr / (l14Games * mlbHrPromoExpectedPaForOrder_(slot, paTable))`.
7. `hrPerPaEff = mlbHrPromoBlendHrPerPa_(shrunkSznHrPerPa, recentHrPerPa, HR_PROMO_BLEND_L14_WEIGHT)` where `shrunkSznHrPerPa = mlbHrPromoShrinkHrPerPa_(hr, pa, LEAGUE_HITTING_HR_PER_PA, HR_PROMO_SHRINK_MIN_PA)`.
8. `pitcherMult = mlbHrPromoPitcherMultFromHrPer9_(spHr9, LEAGUE_PITCHING_HR9, HR_PROMO_PITCHER_MULT_MIN, HR_PROMO_PITCHER_MULT_MAX)`; missing SP → `1`, `confidence=low`, `reason=sp_missing`.
9. `parkMult = mlbParkHrLambdaMultForHomeAbbr_(homeAbbr)` from `MLBParkFactors.js`.
10. `λ_raw = hrPerPaEff * expectedPA * parkMult * pitcherMult`; `p_poisson = mlbHrPromoPoissonPHrGe1_(λ_raw)`.
11. Platt: read `PropertiesService.getScriptProperties().getProperty('HR_PROMO_PLATT_A')` / `HR_PROMO_PLATT_B`; if both numeric, `p_cal = mlbHrPromoPlattP_(p_poisson, a, b)` else `p_cal = p_poisson`, `calibration_status = calibrated | none`.
12. Fallback `HR_PROMO_LINEUP_FALLBACK === 'roster'`: if fewer than 9 parsed starters for a team, emit **all** hitters from that team’s cached stats with `expectedPA=4`, `lineup_slot=0`, `confidence=low`, `reason=lineup_missing`. If `skip`, emit **no** rows for that team.
13. Weather column always `''` and multiplier `1` in phase 1.

**Sheet:** tab name **`📣 Batter_HR_Promo`** (exact). Headers row 3 (exact):

`rank,gamePk,matchup,batter,batterId,team,λ_raw,p_poisson,p_calibrated,calibration_status,confidence,reason,lineup_slot,opponent_sp_id,park_mult_hr,pitcher_mult,weather_mult,szn_HR,szn_PA,L14_HR`

Named range **`MLB_BATTER_HR_PROMO`** on data rows. Sort output by `p_calibrated` desc, tie-break `λ_raw` desc, then `batter`.

- [ ] **Step 1: Create `MLBHrPromoRefresh.js` — paste Part A below at top of file**

```javascript
// ============================================================
// 📣 Batter HR promo — lineup + SP + park λ (no odds)
// ============================================================
// Spec: docs/superpowers/specs/2026-05-12-batter-hr-promo-predictive-model-design.md
// Depends: MLBResultsGrader.js (boxscore), MLBBatterHRQueue.js (team hitting),
//   MLBBatterTBQueue.js (hitting gameLog), MLBParkFactors.js, MLBPitcherKQueue.js
//   (mlbSlateSeasonYear_), MLBPitcherGameLogs.js (mlbStatsApiBaseUrl_), Config.js
// ============================================================

var MLB_BATTER_HR_PROMO_TAB = '📣 Batter_HR_Promo';
var MLB_BATTER_HR_PROMO_NAMED_RANGE = 'MLB_BATTER_HR_PROMO';

function mlbHrPromoParseConfigNum_(cfg, key, def) {
  const x = parseFloat(String(cfg[key] != null ? cfg[key] : def).trim(), 10);
  return isNaN(x) ? def : x;
}

function mlbHrPromoBattingOrderFromPlayers_(players) {
  const line = [];
  if (!players) return line;
  for (const k in players) {
    if (!Object.prototype.hasOwnProperty.call(players, k)) continue;
    const p = players[k];
    const pers = p && p.person ? p.person : {};
    const id = parseInt(pers.id, 10);
    if (!id) continue;
    const boRaw = p.battingOrder;
    if (boRaw == null || String(boRaw).trim() === '') continue;
    const boNum = parseInt(boRaw, 10);
    if (isNaN(boNum)) continue;
    const ord = boNum >= 100 ? Math.floor(boNum / 100) : boNum;
    if (ord < 1 || ord > 9) continue;
    line.push({
      order: ord,
      batterId: id,
      name: String(pers.fullName || '').trim(),
    });
  }
  line.sort(function (a, b) {
    return a.order - b.order;
  });
  return line;
}

function mlbHrPromoFetchPitcherSeasonHr9_(pitcherId, season) {
  const id = parseInt(pitcherId, 10);
  if (!id) return null;
  const url =
    mlbStatsApiBaseUrl_() +
    '/people/' +
    id +
    '/stats?stats=season&group=pitching&season=' +
    encodeURIComponent(String(season));
  try {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return null;
    const payload = JSON.parse(res.getContentText());
    const splits = payload.stats && payload.stats[0] && payload.stats[0].splits;
    const st = splits && splits[0] && splits[0].stat;
    if (!st) return null;
    const hr = parseInt(st.homeRuns, 10) || 0;
    const ipStr = String(st.inningsPitched || '').trim();
    const ip = ipStr ? mlbParseInningsString_(ipStr) : NaN;
    if (isNaN(ip) || ip <= 0) return null;
    return (9 * hr) / ip;
  } catch (e) {
    Logger.log('mlbHrPromoFetchPitcherSeasonHr9_: ' + e.message);
    return null;
  }
}

function mlbHrPromoL14HrFromSplits_(playerId, season) {
  const splits = mlbStatsApiGetHittingGameSplits_(playerId, season);
  const n = splits.length;
  const lg = Math.min(14, n);
  let h = 0;
  for (let i = 0; i < lg; i++) {
    h += parseInt((splits[i].stat || {}).homeRuns, 10) || 0;
  }
  return { l14hr: h, l14g: lg };
}
```

- [ ] **Step 2: Append Part B — team cache + one batter row builder**

```javascript
function mlbHrPromoBuildTeamHittingMap_(abbr, season, abbrToId) {
  const teamId = abbrToId[String(abbr || '').trim().toUpperCase()];
  const out = {};
  if (!teamId) return out;
  const players = mlbFetchTeamHittingStats_(teamId, abbr, season) || [];
  for (let i = 0; i < players.length; i++) {
    const pl = players[i];
    const id = parseInt(pl.playerId, 10);
    if (!id) continue;
    out[String(id)] = { hr: pl.hr, pa: pl.pa, name: pl.name };
  }
  return out;
}

/**
 * @returns {Object} one output row object (values written as sheet row in Part C)
 */
function mlbHrPromoRowForBatter_(ctx) {
  const cfg = ctx.cfg;
  const season = ctx.season;
  const paTable = mlbHrPromoPaTableFromConfigJson_(cfg['HR_PROMO_EXPECTED_PA_JSON']);
  const wL14 = mlbHrPromoParseConfigNum_(cfg, 'HR_PROMO_BLEND_L14_WEIGHT', 0.25);
  const shrinkMin = parseInt(String(cfg['HR_PROMO_SHRINK_MIN_PA'] != null ? cfg['HR_PROMO_SHRINK_MIN_PA'] : '50').trim(), 10) || 50;
  const prior = mlbHrPromoParseConfigNum_(cfg, 'LEAGUE_HITTING_HR_PER_PA', 0.032);
  const lgHr9 = mlbHrPromoParseConfigNum_(cfg, 'LEAGUE_PITCHING_HR9', 1.15);
  const pmLo = mlbHrPromoParseConfigNum_(cfg, 'HR_PROMO_PITCHER_MULT_MIN', 0.85);
  const pmHi = mlbHrPromoParseConfigNum_(cfg, 'HR_PROMO_PITCHER_MULT_MAX', 1.15);

  const slot = ctx.lineupSlot;
  const exPa = ctx.expectedPaOverride != null ? ctx.expectedPaOverride : mlbHrPromoExpectedPaForOrder_(slot, paTable);

  const hit = ctx.teamHitMap[String(ctx.batterId)] || { hr: 0, pa: 0, name: '' };
  const sznHr = parseInt(hit.hr, 10) || 0;
  const sznPa = parseInt(hit.pa, 10) || 0;
  const shrunk = mlbHrPromoShrinkHrPerPa_(sznHr, sznPa, prior, shrinkMin);

  const l14 = mlbHrPromoL14HrFromSplits_(ctx.batterId, season);
  const denomRecent = Math.max(1, l14.l14g) * exPa;
  const recentHrPerPa = l14.l14hr / denomRecent;
  const hrPerPaEff = mlbHrPromoBlendHrPerPa_(shrunk, recentHrPerPa, wL14);

  let pitcherMult = 1;
  let conf = ctx.baseConfidence || 'high';
  let reason = ctx.baseReason || '';
  const spId = parseInt(ctx.opponentSpId, 10);
  if (!spId) {
    pitcherMult = 1;
    conf = 'low';
    reason = reason ? reason + ';sp_missing' : 'sp_missing';
  } else {
    const hr9 = mlbHrPromoFetchPitcherSeasonHr9_(spId, season);
    if (hr9 == null) {
      addPipelineWarning_('HR promo: missing SP HR/9 for pitcher ' + spId);
    } else {
      pitcherMult = mlbHrPromoPitcherMultFromHrPer9_(hr9, lgHr9, pmLo, pmHi);
    }
  }

  const parkMult = mlbParkHrLambdaMultForHomeAbbr_(ctx.homeAbbr);
  const lambdaRaw = hrPerPaEff * exPa * parkMult * pitcherMult;
  const pPoisson = mlbHrPromoPoissonPHrGe1_(lambdaRaw);

  const props = PropertiesService.getScriptProperties();
  const a = parseFloat(String(props.getProperty('HR_PROMO_PLATT_A') || '').trim(), 10);
  const b = parseFloat(String(props.getProperty('HR_PROMO_PLATT_B') || '').trim(), 10);
  let pCal = pPoisson;
  let calStatus = 'none';
  if (!isNaN(a) && !isNaN(b)) {
    pCal = mlbHrPromoPlattP_(pPoisson, a, b);
    calStatus = 'calibrated';
  }

  const name = String(hit.name || ctx.nameFallback || '').trim();
  return {
    gamePk: ctx.gamePk,
    matchup: ctx.matchup,
    batter: name,
    batterId: ctx.batterId,
    team: ctx.teamAbbr,
    lambdaRaw: lambdaRaw,
    pPoisson: pPoisson,
    pCalibrated: pCal,
    calibrationStatus: calStatus,
    confidence: conf,
    reason: reason,
    lineupSlot: slot,
    opponentSpId: spId || '',
    parkMult: parkMult,
    pitcherMult: pitcherMult,
    weatherMult: 1,
    sznHr: sznHr,
    sznPa: sznPa,
    l14Hr: l14.l14hr,
  };
}
```

- [ ] **Step 3: Append Part C — `refreshBatterHrPromoSheet_` + sheet write**

```javascript
function refreshBatterHrPromoSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig();
  const season = mlbSlateSeasonYear_(cfg);
  const fb = String(cfg['HR_PROMO_LINEUP_FALLBACK'] || 'roster')
    .trim()
    .toLowerCase();
  const abbrToId = mlbAbbrToTeamId_();

  const sch = ss.getSheetByName(MLB_SCHEDULE_TAB);
  if (!sch || sch.getLastRow() < 4) {
    safeAlert_('Batter HR promo', 'Run 📅 MLB schedule first.');
    return;
  }
  const lastS = sch.getLastRow();
  const schedRows = sch.getRange(4, 1, lastS, 14).getValues();

  const teamCaches = {};
  function cacheFor(abbr) {
    const a = String(abbr || '').trim().toUpperCase();
    if (!a) return {};
    if (!teamCaches[a]) teamCaches[a] = mlbHrPromoBuildTeamHittingMap_(a, season, abbrToId);
    return teamCaches[a];
  }

  const rowsOut = [];

  function processTeam(ctx2, teamAbbr, isHome, opponentSpCell) {
    const sideKey = isHome ? 'home' : 'away';
    const t = ctx2.teams && ctx2.teams[sideKey] ? ctx2.teams[sideKey] : null;
    const players = t && t.players ? t.players : null;
    const order = mlbHrPromoBattingOrderFromPlayers_(players);
    const hitMap = cacheFor(teamAbbr);
    const oppSp = isHome ? ctx2.awaySp : ctx2.homeSp;

    if (order.length >= 9) {
      for (let i = 0; i < order.length; i++) {
        const o = order[i];
        rowsOut.push(
          mlbHrPromoRowForBatter_({
            cfg: ctx2.cfg,
            season: ctx2.season,
            gamePk: ctx2.gamePk,
            matchup: ctx2.matchup,
            teamAbbr: teamAbbr,
            homeAbbr: ctx2.home,
            batterId: o.batterId,
            nameFallback: o.name,
            lineupSlot: o.order,
            opponentSpId: opponentSpCell,
            baseConfidence: 'high',
            baseReason: '',
            teamHitMap: hitMap,
          })
        );
      }
      return;
    }
    if (fb === 'skip') {
      addPipelineWarning_('HR promo: lineup_missing skip · ' + ctx2.matchup + ' · ' + teamAbbr);
      return;
    }
    const ids = Object.keys(hitMap);
    for (let j = 0; j < ids.length; j++) {
      const bid = parseInt(ids[j], 10);
      const h0 = hitMap[ids[j]];
      if (!bid || !h0 || (parseInt(h0.pa, 10) || 0) < 30) continue;
      if ((parseInt(h0.hr, 10) || 0) === 0) continue;
      rowsOut.push(
        mlbHrPromoRowForBatter_({
          cfg: ctx2.cfg,
          season: ctx2.season,
          gamePk: ctx2.gamePk,
          matchup: ctx2.matchup,
          teamAbbr: teamAbbr,
          homeAbbr: ctx2.home,
          batterId: bid,
          nameFallback: h0.name,
          lineupSlot: 0,
          expectedPaOverride: 4,
          opponentSpId: opponentSpCell,
          baseConfidence: 'low',
          baseReason: 'lineup_missing',
          teamHitMap: hitMap,
        })
      );
    }
  }

  for (let r = 0; r < schedRows.length; r++) {
    const gamePk = parseInt(schedRows[r][0], 10);
    if (!gamePk) continue;
    const away = String(schedRows[r][3] || '').trim().toUpperCase();
    const home = String(schedRows[r][4] || '').trim().toUpperCase();
    const matchup = String(schedRows[r][5] || '').trim();
    const awaySp = schedRows[r][11];
    const homeSp = schedRows[r][12];

    cacheFor(away);
    cacheFor(home);

    if (r > 0) Utilities.sleep(120);
    const box = mlbFetchBoxscoreJson_(gamePk);
    const teams = mlbBoxscoreTeams_(box);
    const ctxLoop = {
      cfg: cfg,
      season: season,
      gamePk: gamePk,
      matchup: matchup,
      home: home,
      awaySp: awaySp,
      homeSp: homeSp,
      teams: teams,
    };

    processTeam(ctxLoop, away, false, homeSp);
    if (schedRows.length > 1) Utilities.sleep(60);
    processTeam(ctxLoop, home, true, awaySp);
  }

  rowsOut.sort(function (a, b) {
    if (b.pCalibrated !== a.pCalibrated) return b.pCalibrated - a.pCalibrated;
    if (b.lambdaRaw !== a.lambdaRaw) return b.lambdaRaw - a.lambdaRaw;
    return String(a.batter).localeCompare(String(b.batter));
  });

  const headers = [
    'rank',
    'gamePk',
    'matchup',
    'batter',
    'batterId',
    'team',
    'λ_raw',
    'p_poisson',
    'p_calibrated',
    'calibration_status',
    'confidence',
    'reason',
    'lineup_slot',
    'opponent_sp_id',
    'park_mult_hr',
    'pitcher_mult',
    'weather_mult',
    'szn_HR',
    'szn_PA',
    'L14_HR',
  ];

  let sh = ss.getSheetByName(MLB_BATTER_HR_PROMO_TAB);
  if (sh) {
    try {
      sh.getRange(1, 1, Math.max(sh.getLastRow(), 3), Math.max(sh.getLastColumn(), headers.length)).breakApart();
    } catch (e) {}
    sh.clearContents();
    sh.clearFormats();
  } else {
    sh = ss.insertSheet(MLB_BATTER_HR_PROMO_TAB);
  }
  sh.setTabColor('#e65100');
  sh.getRange(1, 1, 1, headers.length)
    .merge()
    .setValue('📣 Batter HR promo — lineup λ × park_HR × SP · Poisson + optional Platt')
    .setFontWeight('bold')
    .setBackground('#e65100')
    .setFontColor('#ffffff');
  sh.getRange(3, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight('bold')
    .setBackground('#f57c00')
    .setFontColor('#ffffff');

  if (rowsOut.length) {
    const grid = [];
    for (let i = 0; i < rowsOut.length; i++) {
      const o = rowsOut[i];
      grid.push([
        i + 1,
        o.gamePk,
        o.matchup,
        o.batter,
        o.batterId,
        o.team,
        Math.round(o.lambdaRaw * 10000) / 10000,
        Math.round(o.pPoisson * 1000) / 1000,
        Math.round(o.pCalibrated * 1000) / 1000,
        o.calibrationStatus,
        o.confidence,
        o.reason,
        o.lineupSlot,
        o.opponentSpId,
        Math.round(o.parkMult * 1000) / 1000,
        Math.round(o.pitcherMult * 1000) / 1000,
        o.weatherMult,
        o.sznHr,
        o.sznPa,
        o.l14Hr,
      ]);
    }
    sh.getRange(4, 1, grid.length, headers.length).setValues(grid);
    sh.getRange(4, 9, grid.length, 1).setNumberFormat('0.0%');
    sh.getRange(4, 10, grid.length, 1).setNumberFormat('0.0%');
    try {
      ss.setNamedRange(MLB_BATTER_HR_PROMO_NAMED_RANGE, sh.getRange(4, 1, grid.length, headers.length));
    } catch (e) {}
  }
  sh.setFrozenRows(3);
  ss.toast(rowsOut.length + ' promo HR rows', 'Batter HR promo', 8);
}
```

- [ ] **Step 4: `clasp push`, run `refreshBatterHrPromoSheet_` once, then commit**

```powershell
cd "c:\Users\Lee\Documents\Cursor\MLB"
clasp push
git add MLBHrPromoRefresh.js
git commit -m "feat(hr-promo): refresh sheet from lineups and SP context"
```

---

### Task 5: `MLBHrPromoEval.js` — Platt fit + menu hook

**Files:**

- Create: `c:\Users\Lee\Documents\Cursor\MLB\MLBHrPromoEval.js`

- [ ] **Step 1: Create the file with the following exact contents**

```javascript
// ============================================================
// 📈 HR promo — Platt calibration from 📋 MLB_Results_Log
// ============================================================
// Uses existing column "Model P(Win)" (index 9) = bet card model_prob for the play.
// Labels y: WIN on Over 0.5 HR → 1; LOSS → 0 (skip PUSH/blank/PENDING).
// Market filter: column index 5 contains "home run" (case-insensitive).
// Requires ≥ HR_PROMO_CALIB_MIN_ROWS graded rows (Config).
// ============================================================

function mlbHrPromoLoadPlattFromScriptProperties_() {
  const p = PropertiesService.getScriptProperties();
  const a = parseFloat(String(p.getProperty('HR_PROMO_PLATT_A') || '').trim(), 10);
  const b = parseFloat(String(p.getProperty('HR_PROMO_PLATT_B') || '').trim(), 10);
  return { a: isNaN(a) ? null : a, b: isNaN(b) ? null : b };
}

function mlbHrPromoSavePlattToScriptProperties_(a, b) {
  PropertiesService.getScriptProperties().setProperties({
    HR_PROMO_PLATT_A: String(a),
    HR_PROMO_PLATT_B: String(b),
  });
}

/** Simple 2-D Newton on logistic NLL for (a,b); small data only. */
function mlbHrPromoFitPlattNewton_(pairs, maxIt) {
  let a = 1;
  let b = 0;
  const n = pairs.length;
  const IT = maxIt || 40;
  for (let it = 0; it < IT; it++) {
    let ga = 0,
      gb = 0,
      haa = 0,
      hab = 0,
      hbb = 0;
    for (let i = 0; i < n; i++) {
      const p0 = pairs[i].p0;
      const y = pairs[i].y;
      const p = Math.max(1e-6, Math.min(1 - 1e-6, p0));
      const z = Math.log(p / (1 - p));
      const t = a * z + b;
      const q = 1 / (1 + Math.exp(-t));
      const d = q - y;
      const dqdt = q * (1 - q);
      ga += d * dqdt * z;
      gb += d * dqdt * 1;
      haa += dqdt * dqdt * z * z + d * dqdt * (1 - 2 * q) * z * z;
      hab += dqdt * dqdt * z + d * dqdt * (1 - 2 * q) * z;
      hbb += dqdt * dqdt + d * dqdt * (1 - 2 * q);
    }
    const det = haa * hbb - hab * hab;
    if (Math.abs(det) < 1e-8) break;
    const da = (-ga * hbb + gb * hab) / det;
    const db = (ga * hab - gb * haa) / det;
    a -= da;
    b -= db;
    if (Math.abs(da) < 1e-6 && Math.abs(db) < 1e-6) break;
  }
  return { a: a, b: b };
}

function mlbHrPromoFitPlattFromResultsLogBestEffort_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig();
  const minN = parseInt(String(cfg['HR_PROMO_CALIB_MIN_ROWS'] != null ? cfg['HR_PROMO_CALIB_MIN_ROWS'] : '500').trim(), 10) || 500;
  const logSh = ss.getSheetByName(MLB_RESULTS_LOG_TAB);
  if (!logSh || logSh.getLastRow() < 4) {
    safeAlert_('HR promo calibration', 'No results log rows.');
    return;
  }
  const last = logSh.getLastRow();
  const data = logSh.getRange(4, 1, last, MLB_RESULTS_LOG_NCOL).getValues();
  const pairs = [];
  for (let i = 0; i < data.length; i++) {
    const market = String(data[i][5] || '').toLowerCase();
    if (market.indexOf('home run') === -1) continue;
    const res = String(data[i][16] || '').trim().toUpperCase();
    if (res !== 'WIN' && res !== 'LOSS') continue;
    const p0 = parseFloat(data[i][9], 10);
    if (isNaN(p0) || p0 <= 0 || p0 >= 1) continue;
    pairs.push({ p0: p0, y: res === 'WIN' ? 1 : 0 });
  }
  if (pairs.length < minN) {
    safeAlert_(
      'HR promo calibration',
      'Only ' + pairs.length + ' graded HR rows (need ' + minN + '). No coefficients written.'
    );
    return;
  }
  const coef = mlbHrPromoFitPlattNewton_(pairs, 50);
  mlbHrPromoSavePlattToScriptProperties_(coef.a, coef.b);
  safeAlert_('HR promo calibration', 'Platt saved: a=' + coef.a + ' b=' + coef.b + ' (n=' + pairs.length + ')');
}

function runMlbHrPromoBacktestMenu_() {
  safeAlert_(
    'HR promo backtest',
    'v1: fit Platt on graded HR rows (menu item). Rolling Brier vs baseline: export results log + notebook, or extend MLBHrPromoEval.js with a second function once snapshot density is high enough.'
  );
}
```

- [ ] **Step 2: `clasp push`, run `mlbHrPromoFitPlattFromResultsLogBestEffort_` once (expect alert if n < min rows)**

- [ ] **Step 4: Commit** (Eval only; menu is Task 6)

```powershell
git add MLBHrPromoEval.js
git commit -m "feat(hr-promo): Platt calibration from results log"
```

---

### Task 6: `PipelineMenu.js` — menu + window step + log reindex

**Files:**

- Modify: `c:\Users\Lee\Documents\Cursor\MLB\PipelineMenu.js`

- [ ] **Step 0: In `onOpen`, after the existing Batter HR model line, add**

```javascript
    .addItem('📣 Batter HR promo sheet (lineup λ, no odds)', 'refreshBatterHrPromoSheet_')
    .addItem('📣 HR promo — fit Platt calibration (results log)', 'mlbHrPromoFitPlattFromResultsLogBestEffort_')
```

- [ ] **Step 1: After** `step('Batter HR model (P(HR≥1))', refreshBatterHRQueue);` **insert**

```javascript
  step('Batter HR promo sheet', refreshBatterHrPromoSheet_);
```

- [ ] **Step 2: Reindex `outcomes` variables**

Replace:

```javascript
  const oHrModel = outcomes[21] || { ok: true };
  const oBet = outcomes[22] || { ok: true };
```

with:

```javascript
  const oHrModel = outcomes[21] || { ok: true };
  const oHrPromo = outcomes[22] || { ok: true };
  const oBet = outcomes[23] || { ok: true };
```

Insert **before** `logStep_('MLB Bet Card', ...)`:

```javascript
  logStep_(
    'Batter HR promo',
    0,
    oHrPromo.ok ? mlbTabDataRowsBelowHeader3_(ss, '📣 Batter_HR_Promo') : 0,
    oHrPromo.ok ? '' : oHrPromo.err || 'failed'
  );
```

Use the **literal** tab name `'📣 Batter_HR_Promo'` here so `PipelineMenu.js` does not declare a second global `const` that collides with `MLB_BATTER_HR_PROMO_TAB` in `MLBHrPromoRefresh.js`.

- [ ] **Step 3: Run `runMiddayWindowMLB` or `runMorningWindowMLB` on a test copy**

**Expected:** `⚾ Pipeline_Log` shows **Batter HR promo** row with row count or warning; spreadsheet still completes **MLB Bet Card** step.

- [ ] **Step 4: Commit**

```powershell
git add PipelineMenu.js
git commit -m "chore(pipeline): add Batter HR promo sheet step and log row"
```

---

### Task 7: Calibration data (no new log column in v1)

**Files:**

- None required for first ship.

- [ ] **Step 1: Document in `MLBHrPromoEval.js` file header** (already in Task 5 template) that **`Model P(Win)`** holds the model probability copied from the 🃏 bet card for HR plays, and Platt uses **`result`** WIN/LOSS.

- [ ] **Step 2: Optional follow-up** — If you snapshot **promo-sheet-only** picks (not on 🃏), add a dedicated append path (new tab writer or extend `MLBResultsLog.js` with one extra column); only then widen calibration beyond bet-card HR plays.

- [ ] **Step 3: No commit** unless you implement the optional follow-up.

---

## Spec coverage checklist (self-review)

| Spec section | Task |
|--------------|------|
| Feature builder + λ | Task 4 |
| Lineup + PA | Tasks 1, 4 |
| SP multiplier + bounds | Tasks 1, 2, 4 |
| HR park | Tasks 3, 4 |
| Weather optional / guarded | Config keys Task 2; runtime `1` Task 4 |
| Calibration + insufficient data | Task 5 (+ Task 7 optional follow-up) |
| Degraded modes | Task 4 |
| Output columns | Task 4 |
| Backtest | Task 5 (stub + follow-up once log column exists) |
| Statcast phase 2 | Explicitly not in this plan |

**Placeholder scan:** No `TBD` / `TODO` tokens in this plan file.

---

## Plan complete

Plan saved to `docs/superpowers/plans/2026-05-12-batter-hr-promo-model.md`.

**Two execution options:**

1. **Subagent-driven (recommended)** — Fresh subagent per task, review between tasks, fast iteration. **Required sub-skill:** `superpowers:subagent-driven-development`.

2. **Inline execution** — Run tasks in this session with checkpoints. **Required sub-skill:** `superpowers:executing-plans`.

Which approach do you want?
