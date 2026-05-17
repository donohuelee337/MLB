# Results Accuracy & Verification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a verification layer to MLB-BOIZ results grading: self-audit, reconciliation dashboard, spot-check, boxscore cache, and bet ledger lock.

**Architecture:** Single new file `MLBResultsAudit.js` contains all audit/dashboard/spot-check/cache logic. Two minimal hook points added to `MLBResultsGrader.js` (cache write + audit trigger). Bet Ledger Lock modifies upsert logic in `MLBResultsLog.js`. Menu items added in `PipelineMenu.js`. Config keys added in `Config.js`.

**Tech Stack:** Google Apps Script (V8 runtime), Google Sheets, MLB Stats API (boxscores)

**Spec:** `docs/superpowers/specs/2026-05-17-results-accuracy-verification-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `MLBResultsAudit.js` | Create | All audit logic: cache read/write, 10 anomaly rules, dashboard builder, spot-check, self-test |
| `MLBResultsGrader.js` | Modify (2 lines) | Hook: call cache write after stat extraction; call audit at end of grading |
| `MLBResultsLog.js` | Modify (~15 lines) | Bet Ledger Lock: freeze identity fields on upsert |
| `PipelineMenu.js` | Modify (~6 lines) | Add 3 menu items under separator |
| `Config.js` | Modify (~4 lines) | Add `AUDIT_SPOT_CHECK_N` and `AUDIT_STALE_PENDING_HOURS` to `buildConfigTab` |

---

## Task 1: Boxscore Cache — Tab Setup & Write Helper

**Files:**
- Create: `MLBResultsAudit.js`

The cache must exist before anything else can reference it. This task creates the file with the cache tab constants and write function.

- [ ] **Step 1: Create `MLBResultsAudit.js` with cache constants and write helper**

```javascript
// ============================================================
// 📊 MLB Results Audit — verification, cache, dashboard
// ============================================================
// Non-destructive verification layer. Flags anomalies, caches
// boxscore stat lines, provides reconciliation dashboard and
// spot-check re-grading. Never modifies graded results.
// ============================================================

const MLB_BOXSCORE_CACHE_TAB = '📦 Boxscore_Cache';
const MLB_BOXSCORE_CACHE_NCOL = 16;
const MLB_BOXSCORE_CACHE_HEADERS = [
  'cached_at', 'slate', 'gamePk', 'player_id', 'player_name',
  'market', 'actual_stat', 'game_status', 'ip', 'k',
  'h', 'ab', 'tb', 'hr', 'bb', 'source',
];

const MLB_AUDIT_TAB = '📊 Results_Audit';

/**
 * Ensure 📦 Boxscore_Cache tab exists with correct headers.
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function mlbEnsureBoxscoreCacheTab_(ss) {
  let sh = ss.getSheetByName(MLB_BOXSCORE_CACHE_TAB);
  if (!sh) {
    sh = ss.insertSheet(MLB_BOXSCORE_CACHE_TAB);
    sh.setTabColor('#6d4c41');
  }
  if (sh.getLastRow() < 3 || String(sh.getRange(3, 1).getValue() || '').trim() !== 'cached_at') {
    sh.getRange(1, 1, 1, MLB_BOXSCORE_CACHE_NCOL)
      .merge()
      .setValue('📦 Boxscore Cache — append-only stat lines from grading + spot-checks')
      .setFontWeight('bold')
      .setBackground('#4e342e')
      .setFontColor('#ffffff');
    sh.getRange(3, 1, 1, MLB_BOXSCORE_CACHE_NCOL)
      .setValues([MLB_BOXSCORE_CACHE_HEADERS])
      .setFontWeight('bold')
      .setBackground('#5d4037')
      .setFontColor('#ffffff');
    sh.setFrozenRows(3);
  }
  return sh;
}

/**
 * Append a stat line to 📦 Boxscore_Cache. Append-only — never overwrites.
 * @param {object} opts - { ss, slate, gamePk, playerId, playerName, market, actualStat, gameStatus, ip, k, h, ab, tb, hr, bb, source }
 */
function mlbWriteBoxscoreCache_(opts) {
  var ss = opts.ss || SpreadsheetApp.getActiveSpreadsheet();
  var sh = mlbEnsureBoxscoreCacheTab_(ss);
  var tz = Session.getScriptTimeZone();
  var now = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss');
  var nextRow = Math.max(sh.getLastRow(), 3) + 1;
  sh.getRange(nextRow, 1, 1, MLB_BOXSCORE_CACHE_NCOL).setValues([[
    now,
    String(opts.slate || ''),
    opts.gamePk || '',
    opts.playerId || '',
    String(opts.playerName || ''),
    String(opts.market || ''),
    opts.actualStat != null ? opts.actualStat : '',
    String(opts.gameStatus || ''),
    opts.ip != null ? opts.ip : '',
    opts.k != null ? opts.k : '',
    opts.h != null ? opts.h : '',
    opts.ab != null ? opts.ab : '',
    opts.tb != null ? opts.tb : '',
    opts.hr != null ? opts.hr : '',
    opts.bb != null ? opts.bb : '',
    String(opts.source || 'grader'),
  ]]);
}

/**
 * Read latest cached stat for a gamePk + player_id combo.
 * Returns the row object or null if not found.
 */
function mlbReadBoxscoreCache_(ss, gamePk, playerId) {
  var sh = ss.getSheetByName(MLB_BOXSCORE_CACHE_TAB);
  if (!sh || sh.getLastRow() < 4) return null;
  var data = sh.getRange(4, 1, sh.getLastRow() - 3, MLB_BOXSCORE_CACHE_NCOL).getValues();
  var gpk = parseInt(gamePk, 10);
  var pid = parseInt(playerId, 10);
  for (var i = data.length - 1; i >= 0; i--) {
    if (parseInt(data[i][2], 10) === gpk && parseInt(data[i][3], 10) === pid) {
      return {
        cachedAt: data[i][0], slate: data[i][1], gamePk: data[i][2],
        playerId: data[i][3], playerName: data[i][4], market: data[i][5],
        actualStat: data[i][6], gameStatus: data[i][7], ip: data[i][8],
        k: data[i][9], h: data[i][10], ab: data[i][11],
        tb: data[i][12], hr: data[i][13], bb: data[i][14], source: data[i][15],
      };
    }
  }
  return null;
}
```

- [ ] **Step 2: Validate syntax**

Run: `node --check MLBResultsAudit.js`
Expected: no output (exit 0)

- [ ] **Step 3: Deploy and verify tab creation**

Run: `clasp push -f`

Then in the Sheet: run `mlbEnsureBoxscoreCacheTab_` from the script editor (or add a temp menu item). Verify the `📦 Boxscore_Cache` tab appears with correct headers at row 3.

- [ ] **Step 4: Commit**

```bash
git add MLBResultsAudit.js
git commit -m "MLB-BOIZ v0.X.0: add MLBResultsAudit.js with boxscore cache write/read"
```

---

## Task 2: Hook Cache Write into Grader

**Files:**
- Modify: `MLBResultsGrader.js` (inside `gradeMLBPendingResults_`, after each stat extraction)

Minimal change: after the grader extracts a stat from the boxscore and before it writes the result, also write to the cache.

- [ ] **Step 1: Add cache write calls for K grading**

In `MLBResultsGrader.js`, inside `gradeMLBPendingResults_()`, after `const kActual = mlbPitcherKsFromBoxscore_(box, pid);` and before the VOID check, add:

```javascript
      // --- cache write (before grade logic) ---
      if (kActual !== null) {
        mlbWriteBoxscoreCache_({
          ss: ss, slate: slateStr, gamePk: gamePk, playerId: pid,
          playerName: player, market: 'K', actualStat: kActual,
          gameStatus: mlbBoxscoreIsFinal_(box) ? 'Final' : 'In Progress',
          ip: '', k: kActual, h: '', ab: '', tb: '', hr: '', bb: '',
          source: 'grader',
        });
      }
```

- [ ] **Step 2: Add cache write calls for TB grading**

After `const tbActual = mlbBatterTbFromBoxscore_(box, pid);`:

```javascript
      if (tbActual !== null) {
        mlbWriteBoxscoreCache_({
          ss: ss, slate: slateStr, gamePk: gamePk, playerId: pid,
          playerName: player, market: 'TB', actualStat: tbActual,
          gameStatus: mlbBoxscoreIsFinal_(box) ? 'Final' : 'In Progress',
          ip: '', k: '', h: '', ab: '', tb: tbActual, hr: '', bb: '',
          source: 'grader',
        });
      }
```

- [ ] **Step 3: Add cache write calls for Hits grading**

After `const hActual = mlbBatterHitsFromBoxscore_(box, pid);`:

```javascript
      if (hActual !== null) {
        mlbWriteBoxscoreCache_({
          ss: ss, slate: slateStr, gamePk: gamePk, playerId: pid,
          playerName: player, market: 'Hits', actualStat: hActual,
          gameStatus: mlbBoxscoreIsFinal_(box) ? 'Final' : 'In Progress',
          ip: '', k: '', h: hActual, ab: '', tb: '', hr: '', bb: '',
          source: 'grader',
        });
      }
```

- [ ] **Step 4: Validate syntax**

Run: `node --check MLBResultsGrader.js`
Expected: exit 0

- [ ] **Step 5: Deploy and verify**

Run: `clasp push -f`

Run the grader on a past slate (from the menu). Check that `📦 Boxscore_Cache` tab now has rows with stat lines for each graded bet.

- [ ] **Step 6: Commit**

```bash
git add MLBResultsGrader.js
git commit -m "MLB-BOIZ v0.X.1: hook boxscore cache write into grader loop"
```

---

## Task 3: Self-Audit — 10 Anomaly Rules

**Files:**
- Modify: `MLBResultsAudit.js` (append to existing file)

- [ ] **Step 1: Add the main audit function with all 10 rules**

Append to `MLBResultsAudit.js`:

```javascript
/**
 * Run all anomaly rules against 📋 MLB_Results_Log.
 * Writes flags to column 28. Clears stale flags on re-run.
 * @returns {{ total: number, byRule: object }}
 */
function mlbRunResultsAudit_(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var logSh = ss.getSheetByName(MLB_RESULTS_LOG_TAB);
  if (!logSh || logSh.getLastRow() < 4) return { total: 0, byRule: {} };

  var cfg = getConfig();
  var staleHours = parseFloat(String(cfg['AUDIT_STALE_PENDING_HOURS'] || '48')) || 48;
  var now = new Date();
  var tz = Session.getScriptTimeZone();
  var last = logSh.getLastRow();
  var ncol = Math.max(28, logSh.getLastColumn());
  var data = logSh.getRange(4, 1, last - 3, ncol).getValues();

  // Ensure col 28 header exists
  if (String(logSh.getRange(3, 28).getValue() || '').trim() !== 'audit_flag') {
    logSh.getRange(3, 28).setValue('audit_flag').setFontWeight('bold')
      .setBackground('#1565C0').setFontColor('#ffffff');
  }

  var flags = {};  // row index → flag text
  var byRule = {};

  function flag(i, ruleNum, text) {
    var prev = flags[i] || '';
    flags[i] = prev ? prev + ' | ' + text : text;
    byRule[ruleNum] = (byRule[ruleNum] || 0) + 1;
  }

  // Build bet_key frequency map for Rule 6
  var betKeyCount = {};
  for (var i = 0; i < data.length; i++) {
    var bk = String(data[i][21] || '').trim();
    if (bk) betKeyCount[bk] = (betKeyCount[bk] || 0) + 1;
  }

  // Build player+slate index for Rule 10
  var playerSlateMap = {};  // "playerId|slate" → [gamePks]
  for (var i = 0; i < data.length; i++) {
    var pid10 = String(data[i][14] || '').trim();
    var slate10 = data[i][1] instanceof Date
      ? Utilities.formatDate(data[i][1], tz, 'yyyy-MM-dd')
      : String(data[i][1] || '').trim();
    if (pid10 && slate10) {
      var key10 = pid10 + '|' + slate10;
      if (!playerSlateMap[key10]) playerSlateMap[key10] = [];
      var gpk10 = parseInt(data[i][13], 10);
      if (gpk10 && playerSlateMap[key10].indexOf(gpk10) === -1) {
        playerSlateMap[key10].push(gpk10);
      }
    }
  }

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var result = String(row[16] || '').trim().toUpperCase();
    var actual = row[15];
    var line = row[6];
    var side = String(row[7] || '').toLowerCase();
    var slateRaw = row[1];
    var slate = slateRaw instanceof Date
      ? Utilities.formatDate(slateRaw, tz, 'yyyy-MM-dd')
      : String(slateRaw || '').trim();
    var gamePk = parseInt(row[13], 10);
    var playerId = parseInt(row[14], 10);
    var stake = row[24];
    var odds = row[8];
    var pnl = row[25];
    var closeLine = row[18];
    var closeOdds = row[19];
    var betKey = String(row[21] || '').trim();

    // Rule 1: Push semantics
    if ((result === 'WIN' || result === 'LOSS') && actual !== '' && actual != null && line !== '' && line != null) {
      var aNum = parseFloat(String(actual));
      var lNum = parseFloat(String(line));
      if (!isNaN(aNum) && !isNaN(lNum) && aNum === lNum) {
        flag(i, 1, 'AUDIT: actual == line, graded ' + result + ' not PUSH');
      }
    }

    // Rule 2: Stale PENDING
    if ((!result || result === 'PENDING') && slate) {
      var slateDate = new Date(slate + 'T23:59:59');
      var hoursSince = (now.getTime() - slateDate.getTime()) / 3600000;
      if (hoursSince > staleHours) {
        flag(i, 2, 'AUDIT: PENDING > ' + Math.round(hoursSince) + 'h');
      }
    }

    // Rule 3: VOID but active
    if (result === 'VOID' && gamePk && playerId) {
      var cached = mlbReadBoxscoreCache_(ss, gamePk, playerId);
      if (cached && cached.actualStat !== '' && cached.actualStat != null) {
        flag(i, 3, 'AUDIT: VOID but cache shows stat=' + cached.actualStat);
      }
    }

    // Rule 4: Stat mismatch vs cache
    if ((result === 'WIN' || result === 'LOSS' || result === 'PUSH') && gamePk && playerId) {
      var cached4 = mlbReadBoxscoreCache_(ss, gamePk, playerId);
      if (cached4 && cached4.actualStat !== '' && cached4.actualStat != null) {
        var logActual = parseFloat(String(actual));
        var cacheActual = parseFloat(String(cached4.actualStat));
        if (!isNaN(logActual) && !isNaN(cacheActual) && logActual !== cacheActual) {
          flag(i, 4, 'AUDIT: cached=' + cacheActual + ' vs log=' + logActual);
        }
      }
    }

    // Rule 5: Missing player_id
    if ((result === 'WIN' || result === 'LOSS' || result === 'PUSH') && (!playerId || isNaN(playerId))) {
      flag(i, 5, 'AUDIT: graded but no player_id');
    }

    // Rule 6: Duplicate bet_key
    if (betKey && betKeyCount[betKey] > 1) {
      flag(i, 6, 'AUDIT: duplicate bet_key (' + betKeyCount[betKey] + ' rows)');
    }

    // Rule 7: PnL math check
    if ((result === 'WIN' || result === 'LOSS' || result === 'PUSH' || result === 'VOID') &&
        stake !== '' && stake != null && !isNaN(parseFloat(String(stake)))) {
      var expectedPnl = mlbPnlFromResult_(result, stake, odds);
      var storedPnl = parseFloat(String(pnl));
      if (!isNaN(storedPnl) && Math.abs(storedPnl - expectedPnl) > 0.011) {
        flag(i, 7, 'AUDIT: pnl stored=' + storedPnl.toFixed(2) + ' expected=' + expectedPnl.toFixed(2));
      }
    }

    // Rule 9: Missing close line
    if ((result === 'WIN' || result === 'LOSS' || result === 'PUSH') &&
        (closeLine === '' || closeLine == null) && (closeOdds === '' || closeOdds == null)) {
      flag(i, 9, 'AUDIT: graded but no close_line');
    }

    // Rule 10: Doubleheader collision
    if (playerId && slate) {
      var key10check = String(playerId) + '|' + slate;
      if (playerSlateMap[key10check] && playerSlateMap[key10check].length > 1) {
        flag(i, 10, 'AUDIT: same player+slate, gamePks=' + playerSlateMap[key10check].join(','));
      }
    }
  }

  // Rule 8: Snapshot gap (requires Pipeline Log data — best-effort)
  // Checked at a higher level after pipeline run; skipped in standalone audit.

  // Write flags (clear old flags, set new ones)
  var totalFlags = 0;
  for (var i = 0; i < data.length; i++) {
    var newFlag = flags[i] || '';
    var oldFlag = String(data[i][27] || '').trim();
    if (newFlag !== oldFlag) {
      logSh.getRange(4 + i, 28).setValue(newFlag);
    }
    if (newFlag) totalFlags++;
  }

  return { total: totalFlags, byRule: byRule };
}
```

- [ ] **Step 2: Validate syntax**

Run: `node --check MLBResultsAudit.js`
Expected: exit 0

- [ ] **Step 3: Commit**

```bash
git add MLBResultsAudit.js
git commit -m "MLB-BOIZ v0.X.2: self-audit 10 anomaly rules"
```

---

## Task 4: Reconciliation Dashboard

**Files:**
- Modify: `MLBResultsAudit.js` (append dashboard builder)

- [ ] **Step 1: Add dashboard builder function**

Append to `MLBResultsAudit.js`:

```javascript
/**
 * Build/rebuild the 📊 Results_Audit dashboard tab.
 * Panels: A (summary), B (win rate by market × window), C (anomaly log), D (calibration).
 */
function mlbBuildAuditDashboard_(ss, auditResult) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var tz = Session.getScriptTimeZone();
  var today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');

  var sh = ss.getSheetByName(MLB_AUDIT_TAB);
  if (sh) { sh.clearContents(); sh.clearFormats(); }
  else { sh = ss.insertSheet(MLB_AUDIT_TAB); sh.setTabColor('#1565C0'); }

  // Title row
  sh.getRange(1, 1, 1, 8).merge()
    .setValue('📊 MLB-BOIZ Results Audit — ' + today)
    .setFontWeight('bold').setBackground('#1565C0').setFontColor('#ffffff');

  // Read results log
  var logSh = ss.getSheetByName(MLB_RESULTS_LOG_TAB);
  if (!logSh || logSh.getLastRow() < 4) {
    sh.getRange(4, 1).setValue('No results log data found.');
    return;
  }
  var ncol = Math.max(MLB_RESULTS_LOG_NCOL, 28);
  var data = logSh.getRange(4, 1, logSh.getLastRow() - 3, ncol).getValues();

  // Time window boundaries
  var todayD = new Date(today + 'T12:00:00');
  function ymd(offset) { return Utilities.formatDate(new Date(todayD.getTime() + offset * 86400000), tz, 'yyyy-MM-dd'); }
  var yest = ymd(-1);
  var cut7 = ymd(-7);
  var cut14 = ymd(-14);
  var cut30 = ymd(-30);

  var markets = ['K', 'Hits', 'TB'];
  function marketOf(m) {
    m = String(m || '').toLowerCase();
    if (m.indexOf('strikeout') !== -1) return 'K';
    if (m.indexOf('batter hit') !== -1) return 'Hits';
    if (m.indexOf('total base') !== -1) return 'TB';
    return '';
  }

  // Aggregate stats
  var stats = {};
  markets.forEach(function (mk) {
    stats[mk] = { total: 0, graded: 0, pending: 0, flags: 0 };
    ['yesterday', 'L7', 'L14', 'L30', 'season'].forEach(function (w) {
      stats[mk][w] = { w: 0, l: 0, p: 0, v: 0, pnl: 0, staked: 0, evSum: 0, modelPSum: 0, n: 0 };
    });
  });

  data.forEach(function (row) {
    var mk = marketOf(row[5]);
    if (!mk) return;
    stats[mk].total++;
    var result = String(row[16] || '').trim().toUpperCase();
    if (result === 'WIN' || result === 'LOSS' || result === 'PUSH' || result === 'VOID') {
      stats[mk].graded++;
    } else {
      stats[mk].pending++;
    }
    var flagCol = String(row[27] || '').trim();
    if (flagCol) stats[mk].flags++;

    var slate = row[1] instanceof Date
      ? Utilities.formatDate(row[1], tz, 'yyyy-MM-dd')
      : String(row[1] || '').trim();
    if (!slate || slate >= today) return;
    if (result !== 'WIN' && result !== 'LOSS' && result !== 'PUSH') return;

    var stk = parseFloat(String(row[24]));
    var pnlVal = parseFloat(String(row[25]));
    var ev = parseFloat(String(row[10]));
    var mp = parseFloat(String(row[9]));

    function bump(w) {
      var s = stats[mk][w];
      if (result === 'WIN') s.w++;
      else if (result === 'LOSS') s.l++;
      else s.p++;
      if (!isNaN(stk) && stk > 0) s.staked += stk;
      if (!isNaN(pnlVal)) s.pnl += pnlVal;
      if (!isNaN(ev)) s.evSum += ev;
      if (!isNaN(mp)) { s.modelPSum += mp; s.n++; }
    }
    if (slate === yest) bump('yesterday');
    if (slate >= cut7) bump('L7');
    if (slate >= cut14) bump('L14');
    if (slate >= cut30) bump('L30');
    bump('season');
  });

  // --- Panel A: Summary Stats ---
  var r = 3;
  sh.getRange(r, 1, 1, 6).setValues([['Metric', 'K', 'Hits', 'TB', 'All', '']])
    .setFontWeight('bold').setBackground('#37474f').setFontColor('#ffffff');
  r++;
  var allTot = 0, allGr = 0, allPend = 0, allFlags = 0;
  markets.forEach(function (mk) { allTot += stats[mk].total; allGr += stats[mk].graded; allPend += stats[mk].pending; allFlags += stats[mk].flags; });
  var panelA = [
    ['Total logged', stats.K.total, stats.Hits.total, stats.TB.total, allTot],
    ['Graded (W/L/P/V)', stats.K.graded, stats.Hits.graded, stats.TB.graded, allGr],
    ['Still PENDING', stats.K.pending, stats.Hits.pending, stats.TB.pending, allPend],
    ['Resolution rate %', allTot ? Math.round((stats.K.graded / Math.max(1, stats.K.total)) * 100) + '%' : '—',
      allTot ? Math.round((stats.Hits.graded / Math.max(1, stats.Hits.total)) * 100) + '%' : '—',
      allTot ? Math.round((stats.TB.graded / Math.max(1, stats.TB.total)) * 100) + '%' : '—',
      allTot ? Math.round((allGr / allTot) * 100) + '%' : '—'],
    ['Audit flags', stats.K.flags, stats.Hits.flags, stats.TB.flags, allFlags],
  ];
  sh.getRange(r, 1, panelA.length, 5).setValues(panelA);
  r += panelA.length + 2;

  // --- Panel B: Win Rate by Market × Window ---
  sh.getRange(r, 1, 1, 7).setValues([['Market', 'Yesterday', 'L7', 'L14', 'L30', 'Season', '']])
    .setFontWeight('bold').setBackground('#37474f').setFontColor('#ffffff');
  r++;
  var winLabels = ['yesterday', 'L7', 'L14', 'L30', 'season'];
  markets.forEach(function (mk) {
    function cell(w) {
      var s = stats[mk][w];
      var n = s.w + s.l;
      if (n === 0) return '—';
      var hitPct = Math.round((s.w / n) * 100);
      var roi = s.staked > 0 ? Math.round((s.pnl / s.staked) * 100) : 0;
      var avgEv = s.n > 0 ? (s.evSum / s.n).toFixed(3) : '—';
      var avgMp = s.n > 0 ? Math.round((s.modelPSum / s.n) * 100) : '—';
      var actualPct = hitPct;
      return s.w + '-' + s.l + ' ' + hitPct + '% | $' + s.pnl.toFixed(0) + ' ' + roi + '% ROI | avgEV ' + avgEv + ' | model ' + avgMp + '% vs actual ' + actualPct + '%';
    }
    var cells = [mk];
    winLabels.forEach(function (w) { cells.push(cell(w)); });
    cells.push('');
    sh.getRange(r, 1, 1, 7).setValues([cells]);
    r++;
  });
  r += 2;

  // --- Panel C: Anomaly Log ---
  sh.getRange(r, 1).setValue('Active Audit Flags').setFontWeight('bold');
  r++;
  sh.getRange(r, 1, 1, 5).setValues([['Slate', 'Player', 'Market', 'Flag', 'gamePk']])
    .setFontWeight('bold').setBackground('#455a64').setFontColor('#ffffff');
  r++;
  var anomRows = [];
  data.forEach(function (row) {
    var f = String(row[27] || '').trim();
    if (!f) return;
    var slate = row[1] instanceof Date ? Utilities.formatDate(row[1], tz, 'yyyy-MM-dd') : String(row[1] || '');
    anomRows.push([slate, String(row[3] || ''), String(row[5] || ''), f, row[13] || '']);
  });
  anomRows.sort(function (a, b) { return a[0] > b[0] ? -1 : a[0] < b[0] ? 1 : 0; });
  if (anomRows.length > 0) {
    sh.getRange(r, 1, anomRows.length, 5).setValues(anomRows);
  } else {
    sh.getRange(r, 1).setValue('No flags — all clear ✓');
  }
  r += Math.max(anomRows.length, 1) + 2;

  // --- Panel D: Calibration Plot Data ---
  sh.getRange(r, 1).setValue('Calibration: Model P(Win) vs Actual Hit Rate').setFontWeight('bold');
  r++;
  sh.getRange(r, 1, 1, 5).setValues([['Model P bucket', 'Predicted %', 'Actual %', 'N', 'Confidence ±']])
    .setFontWeight('bold').setBackground('#1b5e20').setFontColor('#ffffff');
  r++;

  var calBuckets = [
    { lo: 0.60, hi: 0.65 }, { lo: 0.65, hi: 0.70 }, { lo: 0.70, hi: 0.75 },
    { lo: 0.75, hi: 0.80 }, { lo: 0.80, hi: 0.85 }, { lo: 0.85, hi: 0.90 },
    { lo: 0.90, hi: 1.01 },
  ];
  var calStats = calBuckets.map(function () { return { w: 0, n: 0 }; });

  data.forEach(function (row) {
    var result = String(row[16] || '').trim().toUpperCase();
    if (result !== 'WIN' && result !== 'LOSS') return;
    var mp = parseFloat(String(row[9]));
    if (isNaN(mp) || mp < 0.60) return;
    for (var b = 0; b < calBuckets.length; b++) {
      if (mp >= calBuckets[b].lo && mp < calBuckets[b].hi) {
        calStats[b].n++;
        if (result === 'WIN') calStats[b].w++;
        break;
      }
    }
  });

  calBuckets.forEach(function (b, idx) {
    var s = calStats[idx];
    var label = Math.round(b.lo * 100) + '–' + Math.round(Math.min(b.hi, 1.0) * 100) + '%';
    var predicted = ((b.lo + Math.min(b.hi, 1.0)) / 2 * 100).toFixed(1);
    if (s.n < 5) {
      sh.getRange(r, 1, 1, 5).setValues([[label, predicted, 'insufficient data', s.n, '—']]);
    } else {
      var pHat = s.w / s.n;
      var z = 1.96;
      var denom = 1 + z * z / s.n;
      var center = (pHat + z * z / (2 * s.n)) / denom;
      var margin = z * Math.sqrt(pHat * (1 - pHat) / s.n + z * z / (4 * s.n * s.n)) / denom;
      sh.getRange(r, 1, 1, 5).setValues([
        [label, predicted, (pHat * 100).toFixed(1), s.n, '±' + (margin * 100).toFixed(1)]
      ]);
    }
    r++;
  });

  return r;
}
```

- [ ] **Step 2: Validate syntax**

Run: `node --check MLBResultsAudit.js`
Expected: exit 0

- [ ] **Step 3: Commit**

```bash
git add MLBResultsAudit.js
git commit -m "MLB-BOIZ v0.X.3: reconciliation dashboard (panels A-D)"
```

---

## Task 5: Spot-Check Mechanism

**Files:**
- Modify: `MLBResultsAudit.js` (append spot-check function)

- [ ] **Step 1: Add spot-check function**

Append to `MLBResultsAudit.js`:

```javascript
/**
 * Spot-check: re-grade N random already-graded rows from fresh boxscore data.
 * Writes results to 📊 Results_Audit tab. Reports mismatches.
 */
function mlbSpotCheckResults_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var cfg = getConfig();
  var n = parseInt(String(cfg['AUDIT_SPOT_CHECK_N'] || '10'), 10) || 10;
  var tz = Session.getScriptTimeZone();
  var today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');

  var logSh = ss.getSheetByName(MLB_RESULTS_LOG_TAB);
  if (!logSh || logSh.getLastRow() < 4) {
    ss.toast('No results log data for spot-check.', 'MLB-BOIZ', 5);
    return;
  }
  var ncol = Math.max(MLB_RESULTS_LOG_NCOL, 28);
  var data = logSh.getRange(4, 1, logSh.getLastRow() - 3, ncol).getValues();

  // Filter to graded rows with gamePk + player_id
  var cut7 = Utilities.formatDate(new Date(new Date().getTime() - 7 * 86400000), tz, 'yyyy-MM-dd');
  var recent = [];
  var older = [];
  for (var i = 0; i < data.length; i++) {
    var result = String(data[i][16] || '').trim().toUpperCase();
    if (result !== 'WIN' && result !== 'LOSS' && result !== 'PUSH') continue;
    var gpk = parseInt(data[i][13], 10);
    var pid = parseInt(data[i][14], 10);
    if (!gpk || !pid) continue;
    var slate = data[i][1] instanceof Date
      ? Utilities.formatDate(data[i][1], tz, 'yyyy-MM-dd')
      : String(data[i][1] || '').trim();
    if (slate >= cut7) recent.push(i);
    else older.push(i);
  }

  // Sample: 70% recent, 30% older
  function shuffle(arr) {
    for (var j = arr.length - 1; j > 0; j--) {
      var k = Math.floor(Math.random() * (j + 1));
      var tmp = arr[j]; arr[j] = arr[k]; arr[k] = tmp;
    }
    return arr;
  }
  shuffle(recent);
  shuffle(older);
  var nRecent = Math.min(Math.ceil(n * 0.7), recent.length);
  var nOlder = Math.min(n - nRecent, older.length);
  if (nRecent + nOlder < n) nRecent = Math.min(n - nOlder, recent.length);
  var sample = recent.slice(0, nRecent).concat(older.slice(0, nOlder));

  var results = [];
  var mismatches = 0;

  sample.forEach(function (idx) {
    var row = data[idx];
    var gamePk = parseInt(row[13], 10);
    var pid = parseInt(row[14], 10);
    var storedActual = parseFloat(String(row[15]));
    var storedResult = String(row[16] || '').trim().toUpperCase();
    var line = row[6];
    var side = row[7];
    var market = String(row[5] || '').toLowerCase();
    var player = String(row[3] || '').trim();
    var slate = row[1] instanceof Date
      ? Utilities.formatDate(row[1], tz, 'yyyy-MM-dd')
      : String(row[1] || '').trim();

    var box = mlbFetchBoxscoreJson_(gamePk);
    Utilities.sleep(150);
    if (!box) {
      results.push([4 + idx, slate, player, market, storedResult, 'FETCH_FAIL', '?', 'boxscore unavailable']);
      return;
    }

    var freshStat = null;
    var isK = market.indexOf('strikeout') !== -1;
    var isTb = market.indexOf('total base') !== -1;
    if (isK) freshStat = mlbPitcherKsFromBoxscore_(box, pid);
    else if (isTb) freshStat = mlbBatterTbFromBoxscore_(box, pid);
    else freshStat = mlbBatterHitsFromBoxscore_(box, pid);

    if (freshStat === null) {
      results.push([4 + idx, slate, player, market, storedResult, 'NULL_STAT', '?', 'no stat line in boxscore']);
      return;
    }

    var freshGrade = mlbGradePitcherKRow_(line, side, freshStat);
    var match = (freshStat === storedActual || parseFloat(String(freshStat)) === storedActual) &&
                freshGrade.result === storedResult;

    // Write to cache
    mlbWriteBoxscoreCache_({
      ss: ss, slate: slate, gamePk: gamePk, playerId: pid,
      playerName: player, market: isK ? 'K' : isTb ? 'TB' : 'Hits',
      actualStat: freshStat, gameStatus: mlbBoxscoreIsFinal_(box) ? 'Final' : '?',
      ip: '', k: isK ? freshStat : '', h: (!isK && !isTb) ? freshStat : '',
      ab: '', tb: isTb ? freshStat : '', hr: '', bb: '',
      source: 'spot-check',
    });

    if (!match) {
      mismatches++;
      logSh.getRange(4 + idx, 28).setValue(
        (String(data[idx][27] || '').trim() ? String(data[idx][27]).trim() + ' | ' : '') +
        'AUDIT: spot-check mismatch (fresh=' + freshStat + '/' + freshGrade.result + ')'
      );
    }

    results.push([
      4 + idx, slate, player, market, storedResult, freshGrade.result,
      match ? '✓' : '✗ MISMATCH',
      match ? 'actual=' + freshStat + ' confirmed' : 'stored=' + storedActual + '/' + storedResult + ' fresh=' + freshStat + '/' + freshGrade.result,
    ]);
  });

  // Write spot-check results to audit tab
  var sh = ss.getSheetByName(MLB_AUDIT_TAB);
  if (!sh) { sh = ss.insertSheet(MLB_AUDIT_TAB); sh.setTabColor('#1565C0'); }
  var startRow = Math.max(sh.getLastRow() + 3, 4);
  sh.getRange(startRow, 1).setValue('Spot-Check Results — ' + today + ' (N=' + sample.length + ')').setFontWeight('bold');
  startRow++;
  sh.getRange(startRow, 1, 1, 8)
    .setValues([['Row#', 'Slate', 'Player', 'Market', 'Stored', 'Fresh', 'Match?', 'Note']])
    .setFontWeight('bold').setBackground('#455a64').setFontColor('#ffffff');
  startRow++;
  if (results.length > 0) {
    sh.getRange(startRow, 1, results.length, 8).setValues(results);
  }

  if (mismatches > 0) {
    ss.toast('⚠️ Spot-check found ' + mismatches + ' mismatch(es) — see 📊 Results_Audit', 'MLB-BOIZ', 8);
  } else {
    ss.toast('✓ Spot-check: ' + sample.length + ' rows verified, 0 mismatches', 'MLB-BOIZ', 6);
  }
}
```

- [ ] **Step 2: Validate syntax**

Run: `node --check MLBResultsAudit.js`
Expected: exit 0

- [ ] **Step 3: Commit**

```bash
git add MLBResultsAudit.js
git commit -m "MLB-BOIZ v0.X.4: spot-check mechanism with fresh boxscore re-grading"
```

---

## Task 6: Bet Ledger Lock

**Files:**
- Modify: `MLBResultsLog.js` (inside `snapshotMLBBetCardToLog`, the upsert branch)

- [ ] **Step 1: Add field-freeze logic to the upsert path**

In `MLBResultsLog.js`, inside `snapshotMLBBetCardToLog`, find the block that starts with `if (hitRow > 0) {`. Replace the existing upsert write logic:

Currently the code writes all 12 columns unconditionally:
```javascript
      logSh.getRange(hitRow, 1, 1, 12).setValues([
        [
          loggedAt,
          slate,
          row[1],
          player,
          matchup,
          market,
          line,
          side,
          odds,
          modelProb,
          ev,
          window,
        ],
      ]);
```

Replace with field-freeze aware upsert:
```javascript
      // Bet Ledger Lock: freeze identity fields after first write.
      // Only update: Logged At (1), Line (7), Odds (9), Model P (10), EV (11), Window (12)
      var prevSlate = prev[1] instanceof Date
        ? Utilities.formatDate(prev[1], tz, 'yyyy-MM-dd')
        : String(prev[1] || '').trim();
      var hasFrozenIdentity = prevSlate && String(prev[3] || '').trim();
      if (hasFrozenIdentity) {
        // Identity frozen — only update volatile fields
        logSh.getRange(hitRow, 1).setValue(loggedAt);           // Logged At
        logSh.getRange(hitRow, 7).setValue(line);               // Line (latest/closing)
        logSh.getRange(hitRow, 9).setValue(odds);               // Odds (latest)
        logSh.getRange(hitRow, 10).setValue(modelProb);         // Model P(Win)
        logSh.getRange(hitRow, 11).setValue(ev);                // EV ($1)
        logSh.getRange(hitRow, 12).setValue(window);            // Window
      } else {
        // First real write — set everything
        logSh.getRange(hitRow, 1, 1, 12).setValues([
          [loggedAt, slate, row[1], player, matchup, market, line, side, odds, modelProb, ev, window],
        ]);
      }
```

- [ ] **Step 2: Validate syntax**

Run: `node --check MLBResultsLog.js`
Expected: exit 0

- [ ] **Step 3: Deploy and verify**

Run: `clasp push -f`

Run a pipeline window (or manual snapshot from menu). Verify:
- First snapshot: all fields populate normally
- Second snapshot (Midday): `player`, `market`, `side`, `gamePk`, `player_id`, `open_line`, `open_odds` remain unchanged; `Line`, `Odds`, `Window` update.

- [ ] **Step 4: Commit**

```bash
git add MLBResultsLog.js
git commit -m "MLB-BOIZ v0.X.5: bet ledger lock — freeze identity fields on upsert"
```

---

## Task 7: Menu Integration + Config Additions

**Files:**
- Modify: `PipelineMenu.js` (add menu items)
- Modify: `Config.js` (add audit config keys to `buildConfigTab`)
- Modify: `MLBResultsGrader.js` (add audit trigger at end)

- [ ] **Step 1: Add menu items to `PipelineMenu.js`**

In `onOpen()`, find the existing menu builder. Add before the final `.addToUi()`:

```javascript
      .addSeparator()
      .addItem('📊 Audit Results', 'mlbRunAuditFromMenu_')
      .addItem('📊 Verify Random Sample', 'mlbSpotCheckResults_')
      .addItem('📊 Open Results Audit', 'mlbActivateAuditTab_')
```

- [ ] **Step 2: Add menu wrapper functions to `MLBResultsAudit.js`**

Append to `MLBResultsAudit.js`:

```javascript
/** Menu entry: run audit + rebuild dashboard (no re-grading). */
function mlbRunAuditFromMenu_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var result = mlbRunResultsAudit_(ss);
  mlbBuildAuditDashboard_(ss, result);
  if (result.total > 0) {
    ss.toast('Audit complete: ' + result.total + ' flag(s) found — see 📊 Results_Audit', 'MLB-BOIZ', 7);
  } else {
    ss.toast('Audit complete: no flags — all clear ✓', 'MLB-BOIZ', 5);
  }
}

/** Menu entry: navigate to audit tab. */
function mlbActivateAuditTab_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(MLB_AUDIT_TAB);
  if (!sh) {
    mlbRunAuditFromMenu_();
    sh = ss.getSheetByName(MLB_AUDIT_TAB);
  }
  if (sh) sh.activate();
}
```

- [ ] **Step 3: Add config keys to `Config.js`**

In `buildConfigTab`, find the array of config rows and add:

```javascript
    ['AUDIT_SPOT_CHECK_N', '10'],
    ['AUDIT_STALE_PENDING_HOURS', '48'],
```

- [ ] **Step 4: Add audit trigger at end of grader**

In `MLBResultsGrader.js`, at the end of `gradeMLBPendingResults_()`, after the toast block, add:

```javascript
  // Trigger audit after grading
  try {
    var auditResult = mlbRunResultsAudit_(ss);
    mlbBuildAuditDashboard_(ss, auditResult);
  } catch (e) {
    Logger.log('Audit after grading failed: ' + e.message);
  }
```

- [ ] **Step 5: Validate syntax for all modified files**

Run:
```bash
node --check PipelineMenu.js && node --check Config.js && node --check MLBResultsGrader.js && node --check MLBResultsAudit.js
```
Expected: all exit 0

- [ ] **Step 6: Deploy and verify menu**

Run: `clasp push -f`

Reload the Sheet. Verify `⚾ MLB-BOIZ` menu shows the three new items under a separator. Click `📊 Audit Results` and verify the `📊 Results_Audit` tab appears.

- [ ] **Step 7: Commit**

```bash
git add PipelineMenu.js Config.js MLBResultsGrader.js MLBResultsAudit.js
git commit -m "MLB-BOIZ v0.X.6: menu integration, config keys, audit trigger after grading"
```

---

## Task 8: Integration Verification

**Files:** None (testing only)

- [ ] **Step 1: Run full Morning pipeline on a past slate**

Set `SLATE_DATE` to yesterday (or a recent date with completed games). Run `🌅 Morning` from the menu.

Verify:
1. Pipeline completes without errors
2. Grading runs (toast shows "Graded N MLB result row(s)")
3. `📦 Boxscore_Cache` has new rows from grading
4. `📊 Results_Audit` tab appears with Panels A-D populated
5. `audit_flag` column (col 28) in Results Log is populated (or empty if no anomalies)
6. Toast shows audit summary

- [ ] **Step 2: Run spot-check**

Click `📊 Verify Random Sample` from the menu.

Verify:
1. Spot-check completes (toast shows result)
2. `📊 Results_Audit` tab has spot-check results section
3. All rows show ✓ (no mismatches expected on valid data)
4. `📦 Boxscore_Cache` has new rows with `source = 'spot-check'`

- [ ] **Step 3: Verify Bet Ledger Lock**

Run `🌤 Midday` or `🔒 Final` for the same slate date.

Verify in `📋 MLB_Results_Log`:
1. `open_line` and `open_odds` columns preserved from Morning
2. `Line` and `Odds` columns updated to latest values
3. `Window` column shows latest window tag
4. Player name, market, side, gamePk, player_id unchanged

- [ ] **Step 4: Verify calibration panel**

In `📊 Results_Audit`, check Panel D:
1. Buckets with N ≥ 5 show actual hit rate %
2. Buckets with N < 5 show "insufficient data"
3. Confidence bands are reasonable (±5-15% for N=20-50)

- [ ] **Step 5: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "MLB-BOIZ v0.X.7: integration fixes from verification"
```
