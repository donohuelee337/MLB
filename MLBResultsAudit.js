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

  var flags = {};
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
  var playerSlateMap = {};
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

  // Write flags (clear old, set new)
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

  sh.getRange(1, 1, 1, 8).merge()
    .setValue('📊 MLB-BOIZ Results Audit — ' + today)
    .setFontWeight('bold').setBackground('#1565C0').setFontColor('#ffffff');

  var logSh = ss.getSheetByName(MLB_RESULTS_LOG_TAB);
  if (!logSh || logSh.getLastRow() < 4) {
    sh.getRange(4, 1).setValue('No results log data found.');
    return;
  }
  var ncol = Math.max(MLB_RESULTS_LOG_NCOL, 28);
  var data = logSh.getRange(4, 1, logSh.getLastRow() - 3, ncol).getValues();

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
    ['Resolution rate %',
      stats.K.total ? Math.round((stats.K.graded / stats.K.total) * 100) + '%' : '—',
      stats.Hits.total ? Math.round((stats.Hits.graded / stats.Hits.total) * 100) + '%' : '—',
      stats.TB.total ? Math.round((stats.TB.graded / stats.TB.total) * 100) + '%' : '—',
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
      return s.w + '-' + s.l + ' ' + hitPct + '% | $' + s.pnl.toFixed(0) + ' ' + roi + '% ROI | avgEV ' + avgEv + ' | model ' + avgMp + '% vs actual ' + hitPct + '%';
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
