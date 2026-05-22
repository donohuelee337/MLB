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

const MLB_BACKTEST_MIN_N = 10;

function runGateBacktest() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logSh = ss.getSheetByName(MLB_RESULTS_LOG_TAB);
  if (!logSh || logSh.getLastRow() < 4) {
    ss.toast('No graded data in ' + MLB_RESULTS_LOG_TAB, 'Gate Backtest', 6);
    return;
  }

  const data = logSh.getRange(4, 1, logSh.getLastRow() - 3, MLB_RESULTS_LOG_NCOL).getValues();
  const graded = data.filter(function (r) {
    return r && (r[16] === 'WIN' || r[16] === 'LOSS');
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

  // Build grid combinations via cartesian product.
  const gridKeys = Object.keys(MLB_BACKTEST_GRID);
  var combos = [{}];
  gridKeys.forEach(function (key) {
    const vals = MLB_BACKTEST_GRID[key];
    var next = [];
    combos.forEach(function (existing) {
      vals.forEach(function (v) {
        var combo = {};
        gridKeys.forEach(function (k) { if (existing[k] !== undefined) combo[k] = existing[k]; });
        combo[key] = v;
        next.push(combo);
      });
    });
    combos = next;
  });

  // Evaluate each combination.
  const results = [];
  combos.forEach(function (g) {
    const kOverFloor  = g['MIN_MODEL_PCT_K_OVER']  || 0.60;
    const kUnderFloor = g['MIN_MODEL_PCT_K_UNDER'] || 0.75;
    const maxOddsH    = g['MAX_ODDS_H'] || 0;
    const minEv       = g['MIN_EV_BET_CARD'] || 0;
    const hShrink     = g['H_MODEL_P_SHRINK'] || 1.0;

    var n = 0, wins = 0, stake = 0, pnl = 0;
    var maxConsecLoss = 0, curConsecLoss = 0;

    parsed.forEach(function (row) {
      if (row.isK) {
        const floor = row.side === 'under' ? kUnderFloor : kOverFloor;
        if (row.modelP < floor) return;
      } else if (row.isH) {
        if (maxOddsH < 0 && row.odds < maxOddsH) return;
      } else {
        return;
      }
      if (minEv > 0 && row.ev < minEv) return;

      // Simulate H shrink: recompute EV with shrunk P at stored odds.
      if (row.isH && hShrink < 1) {
        const shrunkP = row.modelP * hShrink;
        const decimalOdds = row.odds >= 0
          ? (row.odds / 100 + 1)
          : (1 - 100 / row.odds);
        const shrunkEv = shrunkP * (decimalOdds - 1) - (1 - shrunkP);
        if (shrunkEv <= 0) return;
        if (minEv > 0 && shrunkEv < minEv) return;
      }

      n++;
      if (row.result === 'WIN') {
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
    const sharpe = hitRate > 0 && hitRate < 1
      ? roi / Math.sqrt(hitRate * (1 - hitRate) / n)
      : 0;

    results.push({
      n: n, wins: wins, hitRate: hitRate,
      roi: roi, pnl: pnl, stake: stake,
      maxConsecLoss: maxConsecLoss, sharpe: sharpe,
      params: g,
    });
  });

  results.sort(function (a, b) { return b.roi - a.roi; });

  // Write output tab.
  var sh = ss.getSheetByName(MLB_GATE_BACKTEST_TAB);
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

  if (results.length === 0) {
    sh.getRange(2, 1).setValue('No configurations passed the n≥' + MLB_BACKTEST_MIN_N + ' filter.');
  } else {
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
    sh.getRange(2, 1, rows.length, header.length).setValues(rows);
  }

  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, header.length);
  ss.toast(
    'Gate backtest: ' + results.length + ' configs · best ROI: ' +
    (results[0] ? results[0].roi.toFixed(3) : 'n/a'),
    'Gate Backtest', 8
  );
  try { sh.activate(); } catch (e) {}
}
