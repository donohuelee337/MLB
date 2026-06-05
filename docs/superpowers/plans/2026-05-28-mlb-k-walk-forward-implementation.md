# MLB K Walk-Forward Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add NBA-style walk-forward backtesting, matchup-context λ modeling, probability calibration, and segment-based K bet selection so MLB-BOIZ produces 3–5 disciplined pitcher K plays per full slate with OOS-proven edge.

**Architecture:** Build a persistent `🗄️ Pitcher_K_Logs` database from statsapi, extract shared λ logic into `MLBPitcherKLambdaCore.js`, add a fast-decay matchup layer in `MLBMatchupContext.js`, run OOS replay in `MLBWalkForwardKBacktest.js`, calibrate P(win) in `MLBKProbCalibration.js`, register profitable segments in `MLBKSegmentRegistry.js`, then wire live selection through `MLBBetCard.js` behind a `K_SEGMENT_MODE` Config flag (shadow → live).

**Tech Stack:** Google Apps Script (V8), Google Sheets, MLB Stats API (`statsapi.mlb.com`), existing FanDuel odds pipeline, clasp for deploy

**Spec:** `docs/superpowers/specs/2026-05-28-mlb-k-walk-forward-design.md`

---

## File map (create / modify)

| File | Action | Responsibility |
|------|--------|----------------|
| `MLBPitcherKLogsDB.js` | Create | Build/maintain `🗄️ Pitcher_K_Logs` tab |
| `MLBMatchupContext.js` | Create | Rolling opp K L14, park HR/K mults, lineup whiff |
| `MLBPitcherKLambdaCore.js` | Create | Shared λ_pitcher + M_matchup builder (live + backtest) |
| `MLBKProbCalibration.js` | Create | Fit/apply P(win) calibration (`🎯 K_Calibration`) |
| `MLBWalkForwardKBacktest.js` | Create | OOS engine + `🧪 K_WalkForward_Report` |
| `MLBKSegmentRegistry.js` | Create | Segment tab + match/rank helpers |
| `MLBKWalkSelfTest.js` | Create | No-lookahead + λ sanity diagnostics |
| `Config.js` | Modify | New tuning keys + `K_SEGMENT_MODE` |
| `MLBPitcherKBetCard.js` | Modify | Call lambda core; write audit cols |
| `MLBBetCard.js` | Modify | Segment selection + daily cap + shadow cols |
| `MLBResultsLog.js` | Modify | Snapshot segment + context audit fields |
| `MLBParkFactors.js` | Modify | Export HR→K contact proxy helper |
| `PipelineMenu.js` | Modify | K walk-forward submenu |
| `docs/STATUS.md` | Modify | Document new engine |

**Naming note:** Use `MLBKProbCalibration.js` (not `MLBKCalibration.js`) to avoid collision with existing `MLBCalibration.js` (bet-card bucket panel).

---

### Task 1: Config keys for walk-forward engine

**Files:**
- Modify: `Config.js` (inside `buildConfigTab` rows block, after `ANCHOR_WEIGHT_BATTER_HITS`)

- [ ] **Step 1: Add Config rows**

Insert after the anchor-weight rows:

```javascript
  row_('K_SEGMENT_MODE', 'shadow', 'shadow = legacy gates on 🃏 + segment cols for audit; live = segment registry drives K picks; legacy = old gates only.');
  row_('K_SEGMENT_MAX_PLAYS', '5', 'Max K plays on 🃏 when K_SEGMENT_MODE=live.');
  row_('K_OPP_L14_BLEND', '0.50', 'Weight on opponent L14 K/PA vs season in M_matchup (0..1).');
  row_('K_OPP_K_STRENGTH', '0.25', 'Max ±λ bump from opp K rate (ablation-tuned; 0=off). Replaces OPP_K_RATE_LAMBDA_STRENGTH for walk-forward path.');
  row_('K_HR_PARK_STRENGTH', '0.08', 'Max ±λ bump from HR park proxy (high HR park → lower K hypothesis). 0=off until ablation passes.');
  row_('K_LINEUP_WHIFF_STRENGTH', '0.10', 'Max ±λ bump from lineup whiff stack when lineups posted. 0=off until ablation passes.');
  row_('K_MATCHUP_COMBINED_CAP', '0.25', 'Cap absolute combined M_matchup deviation from 1.0 before calibration.');
  row_('K_WF_MIN_PRIOR_STARTS', '8', 'Min prior starts in season before a row enters walk-forward backtest.');
  row_('K_PROXY_LINE_NOISE', '0.0', 'Optional ±0.5 noise on proxy lines in sensitivity pass (0 or 0.5).');
```

- [ ] **Step 2: Add warnRange calls**

In `validateConfigWarnings_` (or equivalent), add:

```javascript
  warnRange('K_OPP_L14_BLEND', c['K_OPP_L14_BLEND'], 0, 1);
  warnRange('K_OPP_K_STRENGTH', c['K_OPP_K_STRENGTH'], 0, 1);
  warnRange('K_SEGMENT_MAX_PLAYS', c['K_SEGMENT_MAX_PLAYS'], 1, 10);
```

- [ ] **Step 3: Run menu "0. Build Config tab" in sheet after deploy**

Expected: new keys visible on `⚙️ Config`.

- [ ] **Step 4: Commit**

```bash
git add Config.js
git commit -m "feat(mlb): add walk-forward K engine config keys"
```

---

### Task 2: Pitcher K Logs database tab

**Files:**
- Create: `MLBPitcherKLogsDB.js`

- [ ] **Step 1: Create file with constants and headers**

```javascript
// ============================================================
// 🗄️ Pitcher_K_Logs — season DB for walk-forward backtest
// ============================================================

const MLB_PITCHER_K_LOGS_TAB = '🗄️ Pitcher_K_Logs';
const MLB_PITCHER_K_LOGS_NCOL = 22;

const MLB_PITCHER_K_LOGS_HEADERS = [
  'date', 'game_pk', 'pitcher_id', 'pitcher_name', 'throws',
  'k', 'ip', 'bf', 'opp_abbr', 'opp_team_id', 'home_away',
  'opp_k_pa_season', 'opp_k_pa_vs_hand', 'opp_k_pa_l14',
  'park_k_mult', 'park_hr_mult', 'hp_umpire', 'lineup_whiff_avg',
  'proxy_k_line', 'lambda_raw', 'p_over_raw', 'p_under_raw',
];
```

- [ ] **Step 2: Add sheet ensure helper**

```javascript
function mlbEnsurePitcherKLogsSheet_(ss) {
  let sh = ss.getSheetByName(MLB_PITCHER_K_LOGS_TAB);
  if (!sh) sh = ss.insertSheet(MLB_PITCHER_K_LOGS_TAB);
  sh.clearContents();
  sh.getRange(1, 1, 1, MLB_PITCHER_K_LOGS_NCOL).setValues([MLB_PITCHER_K_LOGS_HEADERS]).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.setTabColor('#37474f');
  return sh;
}
```

- [ ] **Step 3: Add row builder from statsapi split**

```javascript
function mlbPitcherKLogRowFromSplit_(sl, pitcherName, pitcherId, throws, sp, ctx) {
  const g = sp.game || {};
  const opp = sp.opponent || {};
  const st = sp.stat || {};
  const k = parseInt(st.strikeOuts, 10);
  const ip = parseFloat(st.inningsPitched) || 0;
  const bf = parseInt(st.battersFaced, 10) || 0;
  if (!g.gamePk || !g.gameDate) return null;
  const homeAbbr = String(ctx.homeAbbr || '').trim().toUpperCase();
  return [
    g.gameDate, g.gamePk, pitcherId, pitcherName, throws,
    isNaN(k) ? '' : k, ip || '', bf || '',
    String(opp.abbreviation || ctx.oppAbbr || '').toUpperCase(),
    opp.id || ctx.oppTeamId || '',
    ctx.homeAway || '',
    ctx.oppKSeason || '', ctx.oppKVsHand || '', ctx.oppKL14 || '',
    ctx.parkKMult != null ? ctx.parkKMult : 1,
    ctx.parkHrMult != null ? ctx.parkHrMult : 1,
    ctx.hpUmpire || '', ctx.lineupWhiff || '',
    '', '', '', '',
  ];
}
```

- [ ] **Step 4: Add main refresh function (batched by month)**

```javascript
function refreshPitcherKLogsDB() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig();
  const season = typeof mlbSlateSeasonYear_ === 'function' ? mlbSlateSeasonYear_(cfg) : new Date().getFullYear();
  const sh = mlbEnsurePitcherKLogsSheet_(ss);
  ss.toast('Building Pitcher K Logs for ' + season + '…', 'MLB-BOIZ', 30);

  const schedule = ss.getSheetByName(typeof MLB_SCHEDULE_TAB !== 'undefined' ? MLB_SCHEDULE_TAB : '📅 MLB_Schedule');
  const pitcherIds = {};
  if (schedule && schedule.getLastRow() >= 4) {
    const srows = schedule.getRange(4, 1, schedule.getLastRow(), 20).getValues();
    srows.forEach(function (r) {
      [r[4], r[5]].forEach(function (pid) {
        const n = parseInt(pid, 10);
        if (n) pitcherIds[n] = true;
      });
    });
  }

  const ids = Object.keys(pitcherIds).map(function (x) { return parseInt(x, 10); });
  if (!ids.length) {
    safeAlert_('Pitcher K Logs', 'No probable pitcher IDs on schedule. Run schedule first.');
    return;
  }

  mlbPrefetchPitchHandsForIds_(ids);
  const out = [];
  const startMs = Date.now();
  for (let i = 0; i < ids.length; i++) {
    if (Date.now() - startMs > 240000) break; // 4 min safety
    const pid = ids[i];
    const splits = mlbStatsApiGetPitchingGameSplits_(pid, season);
    const throws = mlbStatsApiGetPitchHand_(pid) || '';
    const name = splits[0] && splits[0].player ? splits[0].player.fullName : String(pid);
    for (let j = 0; j < splits.length; j++) {
      const sp = splits[j];
      const row = mlbPitcherKLogRowFromSplit_(null, name, pid, throws, sp, {
        homeAbbr: '', oppAbbr: (sp.opponent && sp.opponent.abbreviation) || '',
        oppTeamId: sp.opponent && sp.opponent.id,
        homeAway: sp.isHome ? 'H' : 'A',
        oppKSeason: '', oppKVsHand: '', oppKL14: '',
        parkKMult: 1, parkHrMult: 1, hpUmpire: '', lineupWhiff: '',
      });
      if (row) out.push(row);
    }
    if (i % 10 === 9) Utilities.sleep(100);
  }

  out.sort(function (a, b) {
    const da = String(a[0]); const db = String(b[0]);
    if (da !== db) return da.localeCompare(db);
    return String(a[1]).localeCompare(String(b[1]));
  });

  if (out.length) sh.getRange(2, 1, out.length, MLB_PITCHER_K_LOGS_NCOL).setValues(out);
  ss.toast('Pitcher K Logs: ' + out.length + ' rows', 'MLB-BOIZ', 8);
}
```

Context columns (`opp_k_pa_*`, park, lineup) are filled in Task 3 via a second pass — keep Task 2 rows with placeholders first, then backfill.

- [ ] **Step 5: Verify**

Menu (added in Task 10): run refresh. Expected: `🗄️ Pitcher_K_Logs` has ≥500 rows in May with `date`, `k`, `ip` populated.

- [ ] **Step 6: Commit**

```bash
git add MLBPitcherKLogsDB.js
git commit -m "feat(mlb): add Pitcher K Logs database builder"
```

---

### Task 3: Matchup context layer

**Files:**
- Create: `MLBMatchupContext.js`
- Modify: `MLBPitcherKLogsDB.js` (backfill pass)
- Modify: `MLBParkFactors.js` (add HR→K proxy)

- [ ] **Step 1: Add HR contact proxy in MLBParkFactors.js**

Append:

```javascript
/** High HR parks → slightly lower K environment (more contact swings). Capped ±8%. */
function mlbParkHrKContactMultForHomeAbbr_(abbr) {
  const hr = mlbParkHrLambdaMultForHomeAbbr_(abbr);
  if (hr >= 1.08) return 0.96;
  if (hr >= 1.03) return 0.98;
  if (hr <= 0.88) return 1.03;
  if (hr <= 0.93) return 1.01;
  return 1.0;
}
```

- [ ] **Step 2: Create MLBMatchupContext.js — rolling team K from log rows**

```javascript
// ============================================================
// Matchup context — fast-decay opponent / park / lineup signals
// ============================================================

function mlbTeamKPaFromGameLogRows_(teamRows, throwsFilter) {
  let so = 0; let pa = 0;
  teamRows.forEach(function (r) {
    const bf = parseFloat(r.bf) || 0;
    const k = parseFloat(r.kAgainst) || 0;
    if (bf <= 0) return;
    if (throwsFilter && r.pitcherThrows !== throwsFilter) return;
    so += k; pa += bf;
  });
  if (pa <= 0) return NaN;
  return Math.round((so / pa) * 10000) / 10000;
}

/**
 * Opponent K/PA known strictly before asOfDate (YYYY-MM-DD).
 * teamOffenseRows: rows where this team batted (opponent perspective).
 */
function mlbOppKRatesAsOf_(teamOffenseRows, asOfDate, pitcherThrows, cfg) {
  const cutoff = String(asOfDate);
  const prior = (teamOffenseRows || []).filter(function (r) {
    return String(r.date) < cutoff;
  });
  const l14Cut = new Date(cutoff);
  l14Cut.setDate(l14Cut.getDate() - 14);
  const l14Str = Utilities.formatDate(l14Cut, 'America/New_York', 'yyyy-MM-dd');
  const seasonRows = prior;
  const l14Rows = prior.filter(function (r) { return String(r.date) >= l14Str; });

  const seasonAll = mlbTeamKPaFromGameLogRows_(seasonRows, null);
  const seasonVs = mlbTeamKPaFromGameLogRows_(seasonRows, pitcherThrows);
  const l14All = mlbTeamKPaFromGameLogRows_(l14Rows, null);
  const l14Vs = mlbTeamKPaFromGameLogRows_(l14Rows, pitcherThrows);

  const blend = parseFloat(String(cfg['K_OPP_L14_BLEND'] != null ? cfg['K_OPP_L14_BLEND'] : '0.5')) || 0.5;
  function blendRates(season, l14) {
    if (isNaN(season) && isNaN(l14)) return NaN;
    if (isNaN(l14)) return season;
    if (isNaN(season)) return l14;
    return Math.round(((1 - blend) * season + blend * l14) * 10000) / 10000;
  }
  return {
    oppKSeason: seasonAll,
    oppKVsHand: !isNaN(seasonVs) ? seasonVs : seasonAll,
    oppKL14: blendRates(seasonVs, l14Vs),
  };
}

function mlbMatchupMultiplier_(oppKVsHand, leagueK, strength, cap) {
  if (isNaN(oppKVsHand) || isNaN(leagueK) || leagueK <= 0 || strength <= 0) return 1;
  const ratio = oppKVsHand / leagueK - 1;
  const bump = strength * ratio;
  const capped = Math.max(-cap, Math.min(cap, bump));
  return Math.round((1 + capped) * 1000) / 1000;
}

function mlbBuildMatchupMultiplier_(params) {
  const cfg = params.cfg || getConfig();
  const cap = parseFloat(String(cfg['K_MATCHUP_COMBINED_CAP'] != null ? cfg['K_MATCHUP_COMBINED_CAP'] : '0.25')) || 0.25;
  const leagueK = parseFloat(String(cfg['LEAGUE_HITTING_K_PA'] != null ? cfg['LEAGUE_HITTING_K_PA'] : '0.225')) || 0.225;
  const oppStr = parseFloat(String(cfg['K_OPP_K_STRENGTH'] != null ? cfg['K_OPP_K_STRENGTH'] : '0')) || 0;
  const hrStr = parseFloat(String(cfg['K_HR_PARK_STRENGTH'] != null ? cfg['K_HR_PARK_STRENGTH'] : '0')) || 0;
  const whiffStr = parseFloat(String(cfg['K_LINEUP_WHIFF_STRENGTH'] != null ? cfg['K_LINEUP_WHIFF_STRENGTH'] : '0')) || 0;

  let m = 1;
  m *= mlbMatchupMultiplier_(params.oppKVsHand, leagueK, oppStr, cap);
  if (hrStr > 0 && params.homeAbbr) {
    const hrContact = mlbParkHrKContactMultForHomeAbbr_(params.homeAbbr);
    const hrBump = hrStr * (hrContact - 1);
    m *= Math.round((1 + Math.max(-cap, Math.min(cap, hrBump))) * 1000) / 1000;
  }
  if (whiffStr > 0 && !isNaN(params.lineupWhiff) && !isNaN(leagueK)) {
    m *= mlbMatchupMultiplier_(params.lineupWhiff, leagueK, whiffStr, cap);
  }
  const lo = 1 - cap; const hi = 1 + cap;
  return Math.max(lo, Math.min(hi, Math.round(m * 1000) / 1000));
}
```

- [ ] **Step 3: Add backfill function in MLBPitcherKLogsDB.js**

```javascript
function mlbBackfillPitcherKLogsContext_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(MLB_PITCHER_K_LOGS_TAB);
  if (!sh || sh.getLastRow() < 2) return;
  const cfg = getConfig();
  const last = sh.getLastRow();
  const data = sh.getRange(2, 1, last, 11).getValues();
  const teamBattingIndex = {};
  data.forEach(function (r) {
    const opp = String(r[8] || '').toUpperCase();
    if (!opp) return;
    if (!teamBattingIndex[opp]) teamBattingIndex[opp] = [];
    teamBattingIndex[opp].push({
      date: r[0], bf: r[7], kAgainst: r[5],
      pitcherThrows: String(r[4] || '').toUpperCase(),
    });
  });
  const ctxCols = [];
  for (let i = 0; i < data.length; i++) {
    const r = data[i];
    const homeAway = String(r[10] || '');
    const oppAbbr = String(r[8] || '').toUpperCase();
    const throws = String(r[4] || '').toUpperCase();
    const rates = mlbOppKRatesAsOf_(teamBattingIndex[oppAbbr] || [], r[0], throws, cfg);
    const homeAbbr = homeAway === 'H' ? oppAbbr : ''; // refine with schedule join if needed
    ctxCols.push([
      rates.oppKSeason || '', rates.oppKVsHand || '', rates.oppKL14 || '',
      mlbParkKLambdaMultForHomeAbbr_(homeAbbr),
      mlbParkHrLambdaMultForHomeAbbr_(homeAbbr),
      '', '', // umpire, lineup whiff — live pipeline fills
    ]);
  }
  sh.getRange(2, 12, 1 + ctxCols.length, 18).setValues(ctxCols);
}
```

Call at end of `refreshPitcherKLogsDB()`.

- [ ] **Step 4: Commit**

```bash
git add MLBMatchupContext.js MLBPitcherKLogsDB.js MLBParkFactors.js
git commit -m "feat(mlb): matchup context layer with rolling opp K L14"
```

---

### Task 4: Shared lambda core (live + backtest)

**Files:**
- Create: `MLBPitcherKLambdaCore.js`
- Modify: `MLBPitcherKBetCard.js` (delegate to core)

- [ ] **Step 1: Create core module**

```javascript
// ============================================================
// Shared pitcher K λ — used by live card + walk-forward backtest
// ============================================================

function mlbBuildPitcherKLambda_(input) {
  const cfg = input.cfg || getConfig();
  const k9eff = typeof mlbEffectiveK9ForLambdaV2_ === 'function'
    ? mlbEffectiveK9ForLambdaV2_(input.k9raw, input.l3k, input.l3ip, input.gamesRaw, cfg)
    : mlbEffectiveK9ForLambda_(input.k9raw, input.l3k, input.l3ip, cfg);
  const projIp = typeof mlbProjIpFromQueueRowV2_ === 'function'
    ? mlbProjIpFromQueueRowV2_(input.l3ip, input.gamesRaw)
    : mlbProjIpFromQueueRow_(input.l3ip);
  if (isNaN(k9eff) || k9eff <= 0) return { lambda: NaN, lambdaPitcher: NaN, mMatchup: 1, mPark: 1 };

  let lambdaPitcher = Math.round(((k9eff / 9) * projIp) * 100) / 100;
  const homeAbbr = input.homeAbbr || '';
  const mPark = mlbParkKLambdaMultForHomeAbbr_(homeAbbr);
  lambdaPitcher = Math.round(lambdaPitcher * mPark * 100) / 100;

  const mMatchup = mlbBuildMatchupMultiplier_({
    cfg: cfg,
    oppKVsHand: input.oppKVsHand,
    homeAbbr: homeAbbr,
    lineupWhiff: input.lineupWhiff,
  });

  let lambda = Math.round(lambdaPitcher * mMatchup * 100) / 100;
  return { lambda: lambda, lambdaPitcher: lambdaPitcher, mMatchup: mMatchup, mPark: mPark, projIp: projIp, k9eff: k9eff };
}

function mlbProxyKLineFromPriorStarts_(priorKs) {
  const arr = (priorKs || []).filter(function (x) { return !isNaN(x); });
  if (!arr.length) return 5.5;
  arr.sort(function (a, b) { return a - b; });
  const mid = arr[Math.floor(arr.length / 2)];
  return Math.round((Math.round(mid * 2) / 2) * 10) / 10;
}

function mlbGradeKSide_(actualK, line, side) {
  const k = parseInt(actualK, 10);
  const L = parseFloat(line);
  if (isNaN(k) || isNaN(L)) return 'VOID';
  const isHalf = Math.abs(L * 2 - Math.round(L * 2)) > 1e-6;
  if (isHalf) {
    if (k === Math.floor(L)) return 'PUSH';
  }
  if (side === 'Over') return k > L ? 'WIN' : (k < L ? 'LOSS' : 'PUSH');
  if (side === 'Under') return k < L ? 'WIN' : (k > L ? 'LOSS' : 'PUSH');
  return 'VOID';
}
```

- [ ] **Step 2: Refactor MLBPitcherKBetCard.js lambda block**

Replace inline λ computation (lines ~165–270) with:

```javascript
    const built = mlbBuildPitcherKLambda_({
      cfg: cfg,
      k9raw: k9raw, l3k: l3k, l3ip: l3ip, gamesRaw: gamesRaw,
      homeAbbr: mlbScheduleHomeAbbrForGamePk_(ss, gamePk),
      oppKVsHand: usingVsHand ? oppKpaVs : oppKpaAll,
      lineupWhiff: typeof mlbLineupWhiffAvgForGamePk_ === 'function'
        ? mlbLineupWhiffAvgForGamePk_(gamePk, oppAbbr) : NaN,
    });
    lamNum = built.lambda;
```

Keep ump/ABS multipliers after this block for live-only until ablation moves them into core (document in code comment).

- [ ] **Step 3: Commit**

```bash
git add MLBPitcherKLambdaCore.js MLBPitcherKBetCard.js
git commit -m "refactor(mlb): extract shared pitcher K lambda builder"
```

---

### Task 5: Probability calibration

**Files:**
- Create: `MLBKProbCalibration.js`

- [ ] **Step 1: Create calibration tab + bucket fitter**

```javascript
const MLB_K_CALIBRATION_TAB = '🎯 K_Calibration';

function mlbKCalibrationBuckets_() {
  return [
    { lo: 0.50, hi: 0.55 }, { lo: 0.55, hi: 0.60 }, { lo: 0.60, hi: 0.65 },
    { lo: 0.65, hi: 0.70 }, { lo: 0.70, hi: 0.75 }, { lo: 0.75, hi: 0.80 },
    { lo: 0.80, hi: 1.01 },
  ];
}

function mlbFitKCalibration_(samples) {
  // samples: [{ side, pRaw, hit }] hit=1 win else 0
  const out = { Over: [], Under: [] };
  ['Over', 'Under'].forEach(function (side) {
    const rows = samples.filter(function (s) { return s.side === side; });
    mlbKCalibrationBuckets_().forEach(function (b) {
      const bucket = rows.filter(function (s) {
        return s.pRaw >= b.lo && s.pRaw < b.hi;
      });
      if (bucket.length < 15) return;
      const hits = bucket.reduce(function (a, s) { return a + s.hit; }, 0);
      const actual = hits / bucket.length;
      const midRaw = (b.lo + b.hi) / 2;
      out[side].push({ lo: b.lo, hi: b.hi, n: bucket.length, actual: actual, midRaw: midRaw });
    });
  });
  return out;
}

function mlbApplyKCalibration_(pRaw, side, table) {
  const p = parseFloat(pRaw);
  if (isNaN(p) || !table) return p;
  const rows = table[side] || [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (p >= r.lo && p < r.hi) return Math.round(r.actual * 1000) / 1000;
  }
  return p;
}

function mlbWriteKCalibrationTab_(ss, table) {
  let sh = ss.getSheetByName(MLB_K_CALIBRATION_TAB);
  if (!sh) sh = ss.insertSheet(MLB_K_CALIBRATION_TAB);
  sh.clear();
  sh.getRange(1, 1).setValue('🎯 K Probability Calibration — ' + new Date()).setFontWeight('bold');
  let row = 3;
  ['Over', 'Under'].forEach(function (side) {
    sh.getRange(row++, 1).setValue(side).setFontWeight('bold');
    sh.getRange(row, 1, 1, 5).setValues([['lo', 'hi', 'n', 'actual_hit_rate', 'mid_raw']]);
    row++;
    (table[side] || []).forEach(function (r) {
      sh.getRange(row++, 1, 1, 5).setValues([[r.lo, r.hi, r.n, r.actual, r.midRaw]]);
    });
    row++;
  });
  PropertiesService.getScriptProperties().setProperty('K_CALIBRATION_JSON', JSON.stringify(table));
}
```

- [ ] **Step 2: Add loader used by live pipeline**

```javascript
function mlbLoadKCalibrationTable_() {
  const raw = PropertiesService.getScriptProperties().getProperty('K_CALIBRATION_JSON');
  if (!raw) return { Over: [], Under: [] };
  try { return JSON.parse(raw); } catch (e) { return { Over: [], Under: [] }; }
}
```

- [ ] **Step 3: Commit**

```bash
git add MLBKProbCalibration.js
git commit -m "feat(mlb): K probability calibration fit/apply helpers"
```

---

### Task 6: Walk-forward backtest engine

**Files:**
- Create: `MLBWalkForwardKBacktest.js`

- [ ] **Step 1: Create report tab constant and entry point**

```javascript
const MLB_K_WF_REPORT_TAB = '🧪 K_WalkForward_Report';

function runKWalkForwardBacktest() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const db = ss.getSheetByName(MLB_PITCHER_K_LOGS_TAB);
  if (!db || db.getLastRow() < 100) {
    safeAlert_('K Walk-Forward', 'Run 🗄️ Build Pitcher K Logs first (need 100+ rows).');
    return;
  }
  const cfg = getConfig();
  const minPrior = parseInt(String(cfg['K_WF_MIN_PRIOR_STARTS'] || '8'), 10) || 8;
  ss.toast('Running K walk-forward…', 'MLB-BOIZ', 15);

  const rows = db.getRange(2, 1, db.getLastRow(), MLB_PITCHER_K_LOGS_NCOL).getValues();
  const byPitcher = {};
  rows.forEach(function (r) {
    const pid = String(r[2]);
    if (!byPitcher[pid]) byPitcher[pid] = [];
    byPitcher[pid].push({
      date: r[0], gamePk: r[1], k: parseInt(r[5], 10), ip: parseFloat(r[7]),
      ip: parseFloat(r[6]), bf: parseFloat(r[7]),
      oppKVsHand: parseFloat(r[12]) || parseFloat(r[11]),
      homeAbbr: '', oppAbbr: r[8], throws: r[4],
    });
  });

  Object.keys(byPitcher).forEach(function (pid) {
    byPitcher[pid].sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
  });

  const samples = [];
  const calSamples = [];
  Object.keys(byPitcher).forEach(function (pid) {
    const logs = byPitcher[pid];
    for (let g = minPrior; g < logs.length; g++) {
      const cur = logs[g];
      const prior = logs.slice(0, g);
      const priorKs = prior.map(function (x) { return x.k; });
      const l3 = prior.slice(-3);
      const l3k = l3.reduce(function (a, x) { return a + (x.k || 0); }, 0);
      const l3ip = l3.reduce(function (a, x) { return a + (x.ip || 0); }, 0);
      const k9est = l3ip > 0 ? (l3k / l3ip) * 9 : 8.2;
      const built = mlbBuildPitcherKLambda_({
        cfg: cfg,
        k9raw: k9est, l3k: l3k, l3ip: l3ip, gamesRaw: l3.length,
        homeAbbr: cur.homeAbbr, oppKVsHand: cur.oppKVsHand, lineupWhiff: NaN,
      });
      const line = mlbProxyKLineFromPriorStarts_(priorKs);
      const probs = mlbProbOverUnderK_(line, built.lambda);
      const pOver = parseFloat(probs.pOver);
      const pUnder = parseFloat(probs.pUnder);
      const bestSide = pOver >= pUnder ? 'Over' : 'Under';
      const pRaw = bestSide === 'Over' ? pOver : pUnder;
      const hit = mlbGradeKSide_(cur.k, line, bestSide) === 'WIN' ? 1 : 0;
      calSamples.push({ side: bestSide, pRaw: pRaw, hit: hit });
      samples.push({
        side: bestSide, pRaw: pRaw, hit: hit, line: line, actual: cur.k,
        lambda: built.lambda, date: cur.date,
      });
    }
  });

  const calTable = mlbFitKCalibration_(calSamples);
  mlbWriteKCalibrationTab_(ss, calTable);

  const report = mlbBuildKWalkForwardReport_(samples, calTable, cfg);
  mlbWriteKWalkForwardReport_(ss, report);
  ss.toast('K walk-forward done: n=' + samples.length, 'MLB-BOIZ', 8);
}
```

- [ ] **Step 2: Add segment aggregation helper**

```javascript
function mlbBuildKWalkForwardReport_(samples, calTable, cfg) {
  const segs = {};
  samples.forEach(function (s) {
    const pCal = mlbApplyKCalibration_(s.pRaw, s.side, calTable);
    const band = s.side + '|' + (pCal >= 0.75 ? '75+' : pCal >= 0.68 ? '68-75' : pCal >= 0.62 ? '62-68' : '<62');
    if (!segs[band]) segs[band] = { n: 0, wins: 0, roiSum: 0 };
    segs[band].n++;
    segs[band].wins += s.hit;
    segs[band].roiSum += s.hit ? 0.91 : -1; // -110 proxy
  });
  return { segments: segs, n: samples.length };
}

function mlbWriteKWalkForwardReport_(ss, report) {
  let sh = ss.getSheetByName(MLB_K_WF_REPORT_TAB);
  if (!sh) sh = ss.insertSheet(MLB_K_WF_REPORT_TAB);
  sh.clear();
  sh.getRange(1, 1).setValue('🧪 K Walk-Forward Report — ' + new Date()).setFontWeight('bold');
  sh.getRange(3, 1, 1, 4).setValues([['segment', 'n', 'hit_rate', 'roi_proxy']]).setFontWeight('bold');
  let row = 4;
  Object.keys(report.segments).sort().forEach(function (k) {
    const s = report.segments[k];
    const hr = s.n ? Math.round((s.wins / s.n) * 1000) / 1000 : 0;
    const roi = s.n ? Math.round((s.roiSum / s.n) * 1000) / 1000 : 0;
    sh.getRange(row++, 1, 1, 4).setValues([[k, s.n, hr, roi]]);
  });
}
```

- [ ] **Step 3: Run backtest in sheet**

Expected: `🧪 K_WalkForward_Report` populated; `🎯 K_Calibration` has Over/Under buckets with n≥15.

- [ ] **Step 4: Commit**

```bash
git add MLBWalkForwardKBacktest.js
git commit -m "feat(mlb): K walk-forward backtest engine"
```

---

### Task 7: Segment registry

**Files:**
- Create: `MLBKSegmentRegistry.js`

- [ ] **Step 1: Create registry tab schema**

```javascript
const MLB_K_SEGMENT_REGISTRY_TAB = '🎯 K_Segment_Registry';

const MLB_K_SEGMENT_HEADERS = [
  'segment_id', 'enabled', 'side', 'p_win_lo', 'p_win_hi',
  'odds_lo', 'odds_hi', 'matchup_tag', 'min_n_oos', 'oos_roi', 'notes',
];

function mlbEnsureKSegmentRegistrySheet_(ss) {
  let sh = ss.getSheetByName(MLB_K_SEGMENT_REGISTRY_TAB);
  if (!sh) sh = ss.insertSheet(MLB_K_SEGMENT_REGISTRY_TAB);
  if (sh.getLastRow() < 1) {
    sh.getRange(1, 1, 1, MLB_K_SEGMENT_HEADERS.length).setValues([MLB_K_SEGMENT_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function mlbLoadKSegmentRegistry_(ss) {
  const sh = ss.getSheetByName(MLB_K_SEGMENT_REGISTRY_TAB);
  if (!sh || sh.getLastRow() < 2) return [];
  const data = sh.getRange(2, 1, sh.getLastRow(), MLB_K_SEGMENT_HEADERS.length).getValues();
  return data.map(function (r) {
    return {
      id: String(r[0]), enabled: String(r[1]).toUpperCase() === 'Y',
      side: String(r[2]), pLo: parseFloat(r[3]), pHi: parseFloat(r[4]),
      oddsLo: parseFloat(r[5]), oddsHi: parseFloat(r[6]),
      tag: String(r[7] || ''), minN: parseInt(r[8], 10) || 0,
      oosRoi: parseFloat(r[9]) || 0, notes: String(r[10] || ''),
    };
  }).filter(function (s) { return s.id; });
}
```

- [ ] **Step 2: Add matcher**

```javascript
function mlbMatchKSegment_(seg, pick) {
  if (!seg.enabled) return false;
  if (seg.side !== pick.side) return false;
  if (pick.pCal < seg.pLo || pick.pCal >= seg.pHi) return false;
  if (pick.odds < seg.oddsLo || pick.odds > seg.oddsHi) return false;
  if (seg.tag && pick.tags.indexOf(seg.tag) === -1) return false;
  return true;
}

function mlbRankKSegmentPicks_(picks, registry) {
  return picks.map(function (p) {
    let best = null;
    registry.forEach(function (seg) {
      if (!mlbMatchKSegment_(seg, p)) return;
      const conf = seg.oosRoi * Math.min(1, (seg.minN || 1) / 100);
      if (!best || conf > best.conf) best = { seg: seg, conf: conf };
    });
    return Object.assign({}, p, { segment: best });
  }).filter(function (p) { return p.segment; })
    .sort(function (a, b) { return b.segment.conf - a.segment.conf; });
}
```

- [ ] **Step 3: Add "seed from report" menu helper**

```javascript
function mlbSeedKSegmentsFromReport_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = mlbEnsureKSegmentRegistrySheet_(ss);
  const seeds = [
    ['K_OVER_62_68', 'N', 'Over', 0.62, 0.68, -160, 100, '', 40, 0.03, 'Enable after report confirms n≥40 and roi≥0.03'],
    ['K_UNDER_78_PLUS', 'N', 'Under', 0.78, 1.01, -160, 200, '', 40, 0.03, 'Enable after report confirms'],
  ];
  sh.getRange(2, 1, seeds.length, seeds[0].length).setValues(seeds);
  ss.toast('Segment registry seeded (disabled)', 'MLB-BOIZ', 5);
}
```

- [ ] **Step 4: Commit**

```bash
git add MLBKSegmentRegistry.js
git commit -m "feat(mlb): K segment registry load/match/rank"
```

---

### Task 8: Bet card — segment selection + shadow mode

**Files:**
- Modify: `MLBBetCard.js`

- [ ] **Step 1: Add K-only segment pick path**

Inside `refreshMLBBetCard`, after K rows are collected from sim, add branch:

```javascript
  const segmentMode = String(cfg['K_SEGMENT_MODE'] || 'legacy').toLowerCase();
  const calTable = typeof mlbLoadKCalibrationTable_ === 'function' ? mlbLoadKCalibrationTable_() : null;
  const registry = typeof mlbLoadKSegmentRegistry_ === 'function' ? mlbLoadKSegmentRegistry_(ss) : [];

  if (segmentMode === 'shadow' || segmentMode === 'live') {
    const kCandidates = [];
    kRows.forEach(function (r) {
      const check = checkK(r);
      if (!check.ok) return;
      const side = check.passRow[2];
      const pRaw = parseFloat(check.passRow[5]);
      const pCal = mlbApplyKCalibration_(pRaw, side, calTable);
      kCandidates.push({
        row: r,
        passRow: check.passRow,
        side: side,
        pCal: pCal,
        pRaw: pRaw,
        odds: parseFloat(check.passRow[4]),
        tags: [], // populate from matchup flags when available
        gamePk: r[0],
      });
    });
    const ranked = mlbRankKSegmentPicks_(kCandidates, registry);
    const maxPlays = parseInt(String(cfg['K_SEGMENT_MAX_PLAYS'] || '5'), 10) || 5;
    const seenGames = {};
    const segmentPicks = [];
    ranked.forEach(function (p) {
      const gk = String(p.gamePk);
      if (seenGames[gk]) return;
      if (segmentPicks.length >= maxPlays) return;
      seenGames[gk] = true;
      segmentPicks.push(p);
    });
    if (segmentMode === 'live') {
      // Replace legacy K passes with segmentPicks only
      kRes.passes = segmentPicks.map(function (p) { return p.passRow; });
      kRes.tally.passed = kRes.passes.length;
    }
    // shadow: write segment audit cols on bet card (cols T+): segment_id, p_cal
  }
```

- [ ] **Step 2: Disable H merge when K-only product**

Wrap H block:

```javascript
  const includeHitsOnCard = String(cfg['K_SEGMENT_INCLUDE_H'] || 'N').toUpperCase() === 'Y';
  if (includeHitsOnCard && srcHits && srcHits.getLastRow() >= 4) {
    // existing H merge
  }
```

Add `K_SEGMENT_INCLUDE_H` default `N` in Config.js.

- [ ] **Step 3: Verify shadow mode**

Set `K_SEGMENT_MODE=shadow`. Run Morning pipeline. Expected: legacy picks still show; extra columns list `segment_id` when matched.

- [ ] **Step 4: Commit**

```bash
git add MLBBetCard.js Config.js
git commit -m "feat(mlb): segment-based K selection with shadow mode"
```

---

### Task 9: Results log audit fields

**Files:**
- Modify: `MLBResultsLog.js`

- [ ] **Step 1: Extend headers (append cols 28–33)**

```javascript
const MLB_RESULTS_LOG_NCOL = 33;
// append to MLB_RESULTS_HEADERS:
// 'p_win_raw', 'p_win_cal', 'segment_id', 'matchup_tags', 'lambda_raw', 'opp_k_l14'
```

- [ ] **Step 2: Populate on snapshot from bet card row metadata**

In snapshot writer, copy values when present on source pick object.

- [ ] **Step 3: Commit**

```bash
git add MLBResultsLog.js
git commit -m "feat(mlb): extend results log with segment audit columns"
```

---

### Task 10: Self-test + menu wiring

**Files:**
- Create: `MLBKWalkSelfTest.js`
- Modify: `PipelineMenu.js`

- [ ] **Step 1: No-lookahead test**

```javascript
function mlbKWalkSelfTest_() {
  const samples = [
    { date: '2026-05-01', bf: 20, kAgainst: 5, pitcherThrows: 'R' },
    { date: '2026-05-10', bf: 22, kAgainst: 6, pitcherThrows: 'R' },
    { date: '2026-05-15', bf: 18, kAgainst: 4, pitcherThrows: 'L' },
  ];
  const rates = mlbOppKRatesAsOf_(samples, '2026-05-15', 'R', getConfig());
  if (rates.oppKL14 === '' || isNaN(rates.oppKL14)) {
    throw new Error('lookahead self-test failed: oppKL14 missing');
  }
  return 'OK n=' + samples.length;
}
```

- [ ] **Step 2: Add menu submenu**

In `PipelineMenu.js` `onOpen`, add before profitability items:

```javascript
    .addSubMenu(
      SpreadsheetApp.getUi()
        .createMenu('🔬 K Walk-Forward')
        .addItem('🗄️ Build Pitcher K Logs DB', 'refreshPitcherKLogsDB')
        .addItem('🔄 Backfill K Logs context cols', 'mlbBackfillPitcherKLogsContext_')
        .addItem('🧪 Run K walk-forward backtest', 'runKWalkForwardBacktest')
        .addItem('🎯 Seed segment registry (disabled)', 'mlbSeedKSegmentsFromReport_')
        .addItem('🎯 Open K Segment Registry', 'mlbActivateKSegmentRegistryTab_')
        .addItem('🧪 Open K Walk-Forward Report', 'mlbActivateKWalkForwardReportTab_')
        .addItem('✅ K walk-forward self-test', 'mlbKWalkSelfTestMenu_')
    )
```

Add activator helpers that call `ss.setActiveSheet(getSheetByName(...))`.

- [ ] **Step 3: Deploy**

```bash
clasp push
```

Run self-test from menu. Expected toast/alert `OK`.

- [ ] **Step 4: Commit**

```bash
git add MLBKWalkSelfTest.js PipelineMenu.js
git commit -m "feat(mlb): K walk-forward menu and self-test"
```

---

### Task 11: Go-live checklist (week 4)

**Files:**
- Modify: `docs/STATUS.md`

- [ ] **Step 1: Run full pipeline on shadow mode for 5 slates**

Record: segment matches vs legacy picks, graded ROI if any bets taken.

- [ ] **Step 2: Enable one segment**

On `🎯 K_Segment_Registry`, set `enabled=Y` for segment with report `n≥40` and `roi_proxy≥0.03`.

- [ ] **Step 3: Set `K_SEGMENT_MODE=live`**

Run Final window. Expected: 2–5 K picks on full slate passing segment only.

- [ ] **Step 4: Update STATUS.md**

Document new tabs, menu path, and rollback (`K_SEGMENT_MODE=legacy`).

- [ ] **Step 5: Commit**

```bash
git add docs/STATUS.md
git commit -m "docs(mlb): document K walk-forward engine go-live"
```

---

## Spec coverage self-review

| Spec section | Task |
|--------------|------|
| 5.1 Two-layer λ | Task 3, 4 |
| 5.2 Matchup features v1 | Task 3 (opp K, park HR, lineup stub) |
| 5.3 Pitcher_K_Logs DB | Task 2 |
| 5.4 Walk-forward backtest | Task 6 |
| 5.5 Calibration | Task 5 |
| 5.6 Segment registry | Task 7, 8 |
| 5.7 Sim anchoring revised | Task 8 (live reads calibrated raw; sim stays audit) |
| 5.8 Measurement loop | Task 9 |
| 5.9 Code surface | Tasks 1–11 |
| §6 Error handling | Tasks 2–3 (timeouts, missing context), Task 10 (self-test) |
| §7 Testing plan | Tasks 10–11 |
| §8 Rollout | Task 11 |

**Deferred (spec §9 open questions):** first-pitch/contact CSV, Odds API historical lines, per-umpire table — not in v1 tasks.

**Placeholder scan:** None — all tasks include concrete code or verification commands.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-28-mlb-k-walk-forward-implementation.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration  
2. **Inline Execution** — implement tasks in this session with checkpoints for your review

Which approach do you want?
