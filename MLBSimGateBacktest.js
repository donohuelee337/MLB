// ============================================================
// 🔬 Sim-era gate backtest — replay 📋 MLB_Results_Log with anchored P/EV
// ============================================================
// Historical rows store model λ in `proj` (pre-sim era) or anchored λ (post-sim).
// We treat `proj` as λ_model, infer missing λ from logged Model P(Win), then
// recompute Poisson/binomial P + EV for each anchor weight and gate combo.
// Compares legacy (logged P/EV gates) vs sim-recompute at live Config.
// Run from menu after grading; never automatic.
// ============================================================

const MLB_SIM_GATE_BACKTEST_TAB = '🔬 Sim_Gate_Backtest';

/** Anchor sweep (gates fixed to live ⚙️ Config). */
const MLB_SIM_ANCHOR_GRID_K = [0.20, 0.35, 0.50];
const MLB_SIM_ANCHOR_GRID_H = [0.20, 0.35, 0.50];

/** Joint gate sweep at anchor weights from Config (or grid below if you edit). */
const MLB_SIM_GATE_GRID = {
  ANCHOR_WEIGHT_K: [0.25, 0.35, 0.45],
  ANCHOR_WEIGHT_BATTER_HITS: [0.25, 0.35, 0.45],
  MIN_MODEL_PCT_K_OVER: [0.58, 0.60, 0.62],
  MIN_MODEL_PCT_K_UNDER: [0.70, 0.75, 0.80],
  MAX_ODDS_H: [-130, -150, 0],
  MIN_EV_BET_CARD: [0.02, 0.03],
  H_MODEL_P_SHRINK: [0.92, 0.94, 1.00],
};

const MLB_SIM_BACKTEST_MIN_N = 10;

function mlbSimBacktestClamp01_(w) {
  const n = parseFloat(String(w), 10);
  if (isNaN(n)) return 0.35;
  return Math.max(0, Math.min(1, n));
}

function mlbSimBacktestSideNorm_(side) {
  return String(side || '').trim().toLowerCase();
}

function mlbSimBacktestInvertLambdaK_(line, side, targetP) {
  const L = parseFloat(String(line), 10);
  const t = parseFloat(String(targetP), 10);
  if (isNaN(L) || isNaN(t) || t <= 0 || t >= 1) return NaN;
  let lo = 0.05;
  let hi = 18;
  for (let i = 0; i < 45; i++) {
    const mid = (lo + hi) / 2;
    const pu = mlbProbOverUnderK_(L, mid);
    const p = mlbSimBacktestSideNorm_(side) === 'under' ? pu.pUnder : pu.pOver;
    if (isNaN(p) || p === '') return NaN;
    if (p < t) lo = mid;
    else hi = mid;
  }
  return Math.round(((lo + hi) / 2) * 100) / 100;
}

function mlbSimBacktestHRawP_(line, lambdaModel, estPa, side) {
  const lineNum = parseFloat(String(line), 10);
  const lam = parseFloat(String(lambdaModel), 10);
  const pa = parseFloat(String(estPa), 10);
  if (isNaN(lineNum) || isNaN(lam) || lam <= 0 || isNaN(pa) || pa <= 0) return NaN;
  let ba = lam / pa;
  ba = Math.max(0.02, Math.min(0.499, ba));
  const kO = Math.floor(lineNum) + 1;
  const kU = Math.floor(lineNum + 1e-9);
  if (mlbSimBacktestSideNorm_(side) === 'under') {
    return mlbBinomialPLeqK_(kU, pa, ba);
  }
  return mlbBinomialPGeqK_(kO, pa, ba);
}

function mlbSimBacktestInvertEstPaH_(line, lambdaModel, side, targetP) {
  const t = parseFloat(String(targetP), 10);
  if (isNaN(t) || t <= 0 || t >= 1) return 3.8;
  let lo = 2.2;
  let hi = 6.0;
  for (let i = 0; i < 45; i++) {
    const mid = (lo + hi) / 2;
    const p = mlbSimBacktestHRawP_(line, lambdaModel, mid, side);
    if (isNaN(p)) return 3.8;
    if (p < t) lo = mid;
    else hi = mid;
  }
  return Math.round(((lo + hi) / 2) * 100) / 100;
}

/**
 * @returns {Object|null} facts for K/H graded row, or null if not K/H or unusable.
 */
function mlbSimBacktestParseRow_(r, cfg) {
  const mktStr = String(r[5] || '').toLowerCase();
  const isK = mktStr.indexOf('strikeout') !== -1;
  const isH = mktStr.indexOf('batter hit') !== -1 && mktStr.indexOf('shadow') === -1;
  if (!isK && !isH) return null;

  const side = mlbSimBacktestSideNorm_(r[7]);
  const line = r[6];
  const odds = parseFloat(String(r[8] || '0'), 10);
  const loggedModelP = parseFloat(String(r[9] || '0'), 10);
  const loggedEv = parseFloat(String(r[10] || '0'), 10);
  const projRaw = parseFloat(String(r[26] != null ? r[26] : ''), 10);
  const c = cfg || {};
  const hShrinkAtBet = parseFloat(String(c['H_MODEL_P_SHRINK'] != null ? c['H_MODEL_P_SHRINK'] : '0.94'), 10) || 0.94;

  if (isNaN(odds) || odds === 0) return null;
  if (isNaN(loggedModelP) || loggedModelP <= 0) return null;

  let lambdaModel = NaN;
  let estPa = 3.8;
  let lambdaSource = '';

  if (isK) {
    // Infer model λ from logged P (stat-card era). Avoid re-anchoring `proj` if it was already sim λ.
    lambdaModel = mlbSimBacktestInvertLambdaK_(line, side, loggedModelP);
    lambdaSource = 'inverted_from_logged_p';
    if (!isNaN(projRaw) && projRaw > 0) {
      const pu = mlbProbOverUnderK_(line, projRaw);
      const pProj = side === 'under' ? pu.pUnder : pu.pOver;
      if (pProj !== '' && !isNaN(pProj) && Math.abs(pProj - loggedModelP) < 0.04) {
        lambdaModel = projRaw;
        lambdaSource = 'proj_matches_logged_p';
      }
    }
    if (isNaN(lambdaModel) || lambdaModel <= 0) return null;
  } else {
    if (isNaN(projRaw) || projRaw <= 0) return null;
    lambdaModel = projRaw;
    lambdaSource = 'proj';
    const pForPa = hShrinkAtBet > 0 && hShrinkAtBet < 1 ? loggedModelP / hShrinkAtBet : loggedModelP;
    estPa = mlbSimBacktestInvertEstPaH_(line, lambdaModel, side, pForPa);
  }

  return {
    isK: isK,
    isH: isH,
    side: side,
    line: line,
    odds: odds,
    lambdaModel: lambdaModel,
    lambdaSource: lambdaSource,
    estPa: estPa,
    loggedModelP: loggedModelP,
    loggedEv: isNaN(loggedEv) ? 0 : loggedEv,
    result: r[16],
    stake: parseFloat(String(r[24] || '0'), 10) || 0,
    pnl: parseFloat(String(r[25] || '0'), 10) || 0,
  };
}

function mlbSimBacktestSimK_(facts, w) {
  const lineNum = parseFloat(String(facts.line), 10);
  const wN = mlbSimBacktestClamp01_(w);
  const lamAnch = Math.round((lineNum * (1 - wN) + facts.lambdaModel * wN) * 100) / 100;
  const pu = mlbProbOverUnderK_(facts.line, lamAnch);
  const pWin = facts.side === 'under' ? pu.pUnder : pu.pOver;
  if (pWin === '' || isNaN(pWin)) return { modelP: NaN, ev: NaN, lamAnch: lamAnch };
  const ev = mlbEvPerDollarRisked_(pWin, facts.odds);
  return {
    modelP: Math.round(pWin * 1000) / 1000,
    ev: ev === '' ? NaN : ev,
    lamAnch: lamAnch,
  };
}

function mlbSimBacktestSimH_(facts, w, hShrink) {
  const lineNum = parseFloat(String(facts.line), 10);
  const wN = mlbSimBacktestClamp01_(w);
  let lamAnch = lineNum * (1 - wN) + facts.lambdaModel * wN;
  lamAnch = Math.round(lamAnch * 1000) / 1000;
  let pRaw = mlbSimBacktestHRawP_(facts.line, lamAnch, facts.estPa, facts.side);
  if (isNaN(pRaw)) return { modelP: NaN, ev: NaN, lamAnch: lamAnch };
  const shrink = parseFloat(String(hShrink != null ? hShrink : '1'), 10);
  const pWin = shrink > 0 && shrink < 1 ? pRaw * shrink : pRaw;
  const ev = mlbEvPerDollarRisked_(pWin, facts.odds);
  return {
    modelP: Math.round(pWin * 1000) / 1000,
    ev: ev === '' ? NaN : ev,
    lamAnch: lamAnch,
  };
}

function mlbSimBacktestPassesGates_(facts, sim, gates) {
  if (!sim || isNaN(sim.modelP) || isNaN(sim.ev)) return false;
  if (sim.ev <= 0) return false;
  const minEv = parseFloat(String(gates.MIN_EV_BET_CARD != null ? gates.MIN_EV_BET_CARD : '0')) || 0;
  if (minEv > 0 && sim.ev < minEv) return false;

  if (facts.isK) {
    const floor = facts.side === 'under'
      ? (parseFloat(String(gates.MIN_MODEL_PCT_K_UNDER != null ? gates.MIN_MODEL_PCT_K_UNDER : '0.75')) || 0.75)
      : (parseFloat(String(gates.MIN_MODEL_PCT_K_OVER != null ? gates.MIN_MODEL_PCT_K_OVER : '0.60')) || 0.60);
    if (sim.modelP < floor) return false;
    return true;
  }

  if (facts.isH) {
    const maxOddsH = parseFloat(String(gates.MAX_ODDS_H != null ? gates.MAX_ODDS_H : '0')) || 0;
    if (maxOddsH < 0 && facts.odds < maxOddsH) return false;
    const hFloor = parseFloat(String(gates.MIN_MODEL_PCT_H != null ? gates.MIN_MODEL_PCT_H : ''), 10);
    const globalFloor = parseFloat(String(gates.MIN_MODEL_PCT_BET_CARD != null ? gates.MIN_MODEL_PCT_BET_CARD : '0.60'), 10) || 0.60;
    const floor = !isNaN(hFloor) && hFloor > 0 ? hFloor : globalFloor;
    if (sim.modelP < floor) return false;
    return true;
  }

  return false;
}

function mlbSimBacktestPassesLegacyGates_(facts, gates) {
  if (facts.loggedEv <= 0) return false;
  const minEv = parseFloat(String(gates.MIN_EV_BET_CARD != null ? gates.MIN_EV_BET_CARD : '0')) || 0;
  if (minEv > 0 && facts.loggedEv < minEv) return false;

  if (facts.isK) {
    const floor = facts.side === 'under'
      ? (parseFloat(String(gates.MIN_MODEL_PCT_K_UNDER != null ? gates.MIN_MODEL_PCT_K_UNDER : '0.75')) || 0.75)
      : (parseFloat(String(gates.MIN_MODEL_PCT_K_OVER != null ? gates.MIN_MODEL_PCT_K_OVER : '0.60')) || 0.60);
    return facts.loggedModelP >= floor;
  }

  if (facts.isH) {
    const maxOddsH = parseFloat(String(gates.MAX_ODDS_H != null ? gates.MAX_ODDS_H : '0')) || 0;
    if (maxOddsH < 0 && facts.odds < maxOddsH) return false;
    return true;
  }
  return false;
}

function mlbSimBacktestScoreRows_(parsed, evalFn) {
  var n = 0;
  var wins = 0;
  var stake = 0;
  var pnl = 0;
  parsed.forEach(function (facts) {
    if (!evalFn(facts)) return;
    n++;
    if (facts.result === 'WIN') wins++;
    stake += facts.stake;
    pnl += facts.pnl;
  });
  const hitRate = n > 0 ? wins / n : 0;
  const roi = stake > 0 ? pnl / stake : 0;
  return { n: n, wins: wins, hitRate: hitRate, roi: roi, pnl: pnl, stake: stake };
}

function mlbSimBacktestCartesian_(grid) {
  const gridKeys = Object.keys(grid);
  var combos = [{}];
  gridKeys.forEach(function (key) {
    const vals = grid[key];
    var next = [];
    combos.forEach(function (existing) {
      vals.forEach(function (v) {
        var combo = {};
        gridKeys.forEach(function (k) {
          if (existing[k] !== undefined) combo[k] = existing[k];
        });
        combo[key] = v;
        next.push(combo);
      });
    });
    combos = next;
  });
  return combos;
}

function mlbSimBacktestGatesFromCfg_(cfg) {
  return {
    MIN_MODEL_PCT_K_OVER: parseFloat(String(cfg['MIN_MODEL_PCT_K_OVER'] != null ? cfg['MIN_MODEL_PCT_K_OVER'] : '0.60')) || 0.60,
    MIN_MODEL_PCT_K_UNDER: parseFloat(String(cfg['MIN_MODEL_PCT_K_UNDER'] != null ? cfg['MIN_MODEL_PCT_K_UNDER'] : '0.75')) || 0.75,
    MIN_MODEL_PCT_H: parseFloat(String(cfg['MIN_MODEL_PCT_H'] != null ? cfg['MIN_MODEL_PCT_H'] : ''), 10),
    MIN_MODEL_PCT_BET_CARD: parseFloat(String(cfg['MIN_MODEL_PCT_BET_CARD'] != null ? cfg['MIN_MODEL_PCT_BET_CARD'] : '0.60')) || 0.60,
    MAX_ODDS_H: parseFloat(String(cfg['MAX_ODDS_H'] != null ? cfg['MAX_ODDS_H'] : '0')) || 0,
    MIN_EV_BET_CARD: parseFloat(String(cfg['MIN_EV_BET_CARD'] != null ? cfg['MIN_EV_BET_CARD'] : '0')) || 0,
    H_MODEL_P_SHRINK: parseFloat(String(cfg['H_MODEL_P_SHRINK'] != null ? cfg['H_MODEL_P_SHRINK'] : '1')) || 1,
    ANCHOR_WEIGHT_K: mlbSimBacktestClamp01_(cfg['ANCHOR_WEIGHT_K']),
    ANCHOR_WEIGHT_BATTER_HITS: mlbSimBacktestClamp01_(cfg['ANCHOR_WEIGHT_BATTER_HITS']),
  };
}

function mlbSimBacktestWriteBlock_(sh, startRow, startCol, data) {
  if (!data || !data.length) return startRow;
  const nRows = data.length;
  const nCols = data[0].length;
  sh.getRange(startRow, startCol, nRows, nCols).setValues(data);
  return startRow + nRows;
}

function mlbSimBacktestWriteSection_(sh, startRow, title, header, rows) {
  sh.getRange(startRow, 1).setValue(title).setFontWeight('bold');
  sh.getRange(startRow + 1, 1, 1, header.length)
    .setValues([header])
    .setFontWeight('bold')
    .setBackground('#1b5e20')
    .setFontColor('#ffffff');
  if (rows.length) {
    mlbSimBacktestWriteBlock_(sh, startRow + 2, 1, rows);
    return startRow + 2 + rows.length;
  }
  sh.getRange(startRow + 2, 1).setValue('(no rows)');
  return startRow + 3;
}

function mlbSimBacktestFmtRoi_(roi) {
  return Math.round(roi * 10000) / 100 + '%';
}

/**
 * Replay graded Results Log with anchored sim P/EV + gate grid.
 * Tab sections: baseline, anchor sweep, full sim gate grid, proposed Config.
 */
function runSimGateBacktest() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig();
  const liveGates = mlbSimBacktestGatesFromCfg_(cfg);

  const logSh = ss.getSheetByName(MLB_RESULTS_LOG_TAB);
  if (!logSh || logSh.getLastRow() < 4) {
    ss.toast('No graded data in ' + MLB_RESULTS_LOG_TAB, 'Sim Gate Backtest', 6);
    return;
  }

  const last = logSh.getLastRow();
  const ncol = Math.max(MLB_RESULTS_LOG_NCOL, logSh.getLastColumn());
  const data = logSh.getRange(4, 1, last, ncol).getValues();
  const graded = data.filter(function (r) {
    return r && (r[16] === 'WIN' || r[16] === 'LOSS');
  });

  const parsed = [];
  var skipped = 0;
  graded.forEach(function (r) {
    const f = mlbSimBacktestParseRow_(r, cfg);
    if (f) parsed.push(f);
    else skipped++;
  });

  if (parsed.length < MLB_SIM_BACKTEST_MIN_N) {
    ss.toast('Need ≥' + MLB_SIM_BACKTEST_MIN_N + ' parseable K/H rows (have ' + parsed.length + ')', 'Sim Gate Backtest', 8);
    return;
  }

  // --- Baseline: legacy logged P vs sim at live Config anchors ---
  const legacyScore = mlbSimBacktestScoreRows_(parsed, function (facts) {
    return mlbSimBacktestPassesLegacyGates_(facts, liveGates);
  });
  const simLiveScore = mlbSimBacktestScoreRows_(parsed, function (facts) {
    const sim = facts.isK
      ? mlbSimBacktestSimK_(facts, liveGates.ANCHOR_WEIGHT_K)
      : mlbSimBacktestSimH_(facts, liveGates.ANCHOR_WEIGHT_BATTER_HITS, liveGates.H_MODEL_P_SHRINK);
    return mlbSimBacktestPassesGates_(facts, sim, liveGates);
  });
  const simNoAnchorScore = mlbSimBacktestScoreRows_(parsed, function (facts) {
    const sim = facts.isK
      ? mlbSimBacktestSimK_(facts, 0)
      : mlbSimBacktestSimH_(facts, 0, liveGates.H_MODEL_P_SHRINK);
    return mlbSimBacktestPassesGates_(facts, sim, liveGates);
  });

  // --- Anchor sweep (gates = live Config) ---
  const anchorRows = [];
  MLB_SIM_ANCHOR_GRID_K.forEach(function (wK) {
    MLB_SIM_ANCHOR_GRID_H.forEach(function (wH) {
      const gates = {};
      Object.keys(liveGates).forEach(function (k) { gates[k] = liveGates[k]; });
      gates.ANCHOR_WEIGHT_K = wK;
      gates.ANCHOR_WEIGHT_BATTER_HITS = wH;
      const sc = mlbSimBacktestScoreRows_(parsed, function (facts) {
        const sim = facts.isK
          ? mlbSimBacktestSimK_(facts, wK)
          : mlbSimBacktestSimH_(facts, wH, liveGates.H_MODEL_P_SHRINK);
        return mlbSimBacktestPassesGates_(facts, sim, gates);
      });
      if (sc.n >= MLB_SIM_BACKTEST_MIN_N) {
        anchorRows.push([
          wK, wH, sc.n, sc.wins, mlbSimBacktestFmtRoi_(sc.hitRate),
          mlbSimBacktestFmtRoi_(sc.roi), Math.round(sc.pnl * 100) / 100,
        ]);
      }
    });
  });
  anchorRows.sort(function (a, b) {
    const ra = parseFloat(String(a[5]).replace('%', '')) / 100;
    const rb = parseFloat(String(b[5]).replace('%', '')) / 100;
    return rb - ra;
  });

  // --- Full sim gate grid ---
  const combos = mlbSimBacktestCartesian_(MLB_SIM_GATE_GRID);
  const gridResults = [];
  combos.forEach(function (g) {
    const gates = mlbSimBacktestGatesFromCfg_(cfg);
    gates.MIN_MODEL_PCT_K_OVER = g.MIN_MODEL_PCT_K_OVER;
    gates.MIN_MODEL_PCT_K_UNDER = g.MIN_MODEL_PCT_K_UNDER;
    gates.MAX_ODDS_H = g.MAX_ODDS_H;
    gates.MIN_EV_BET_CARD = g.MIN_EV_BET_CARD;
    gates.H_MODEL_P_SHRINK = g.H_MODEL_P_SHRINK;
    gates.ANCHOR_WEIGHT_K = g.ANCHOR_WEIGHT_K;
    gates.ANCHOR_WEIGHT_BATTER_HITS = g.ANCHOR_WEIGHT_BATTER_HITS;

    const sc = mlbSimBacktestScoreRows_(parsed, function (facts) {
      const sim = facts.isK
        ? mlbSimBacktestSimK_(facts, gates.ANCHOR_WEIGHT_K)
        : mlbSimBacktestSimH_(facts, gates.ANCHOR_WEIGHT_BATTER_HITS, gates.H_MODEL_P_SHRINK);
      return mlbSimBacktestPassesGates_(facts, sim, gates);
    });
    if (sc.n < MLB_SIM_BACKTEST_MIN_N) return;
    gridResults.push({
      score: sc,
      params: g,
    });
  });
  gridResults.sort(function (a, b) { return b.score.roi - a.score.roi; });

  // --- Write tab ---
  var sh = ss.getSheetByName(MLB_SIM_GATE_BACKTEST_TAB);
  if (!sh) sh = ss.insertSheet(MLB_SIM_GATE_BACKTEST_TAB);
  else sh.clearContents().clearFormats();
  sh.setTabColor('#0d47a1');

  let row = 1;
  sh.getRange(row++, 1).setValue('🔬 Sim-era gate backtest — ' + new Date()).setFontWeight('bold');
  sh.getRange(row++, 1).setValue(
    'Replay ' + parsed.length + ' graded K/H rows (skipped ' + skipped + ' non-K/H or missing P). ' +
    'K: λ_model inverted from logged Model P(Win) (stat-card era). H: λ from proj, estPa inferred. ' +
    'ROI uses actual WIN/LOSS $ on rows that pass gates — subset changes when sim tightens filters.'
  ).setWrap(true);
  row++;

  sh.getRange(row++, 1).setValue('Live Config baseline').setFontWeight('bold');
  const baselineRows = [
    ['mode', 'n', 'wins', 'hit%', 'ROI', 'pnl $'],
    ['legacy (logged P/EV + gates)', legacyScore.n, legacyScore.wins, mlbSimBacktestFmtRoi_(legacyScore.hitRate), mlbSimBacktestFmtRoi_(legacyScore.roi), Math.round(legacyScore.pnl * 100) / 100],
    ['sim w=0 (recomputed P/EV, same gates)', simNoAnchorScore.n, simNoAnchorScore.wins, mlbSimBacktestFmtRoi_(simNoAnchorScore.hitRate), mlbSimBacktestFmtRoi_(simNoAnchorScore.roi), Math.round(simNoAnchorScore.pnl * 100) / 100],
    ['sim @ ANCHOR_K=' + liveGates.ANCHOR_WEIGHT_K + ' ANCHOR_H=' + liveGates.ANCHOR_WEIGHT_BATTER_HITS,
      simLiveScore.n, simLiveScore.wins, mlbSimBacktestFmtRoi_(simLiveScore.hitRate),
      mlbSimBacktestFmtRoi_(simLiveScore.roi), Math.round(simLiveScore.pnl * 100) / 100],
  ];
  mlbSimBacktestWriteBlock_(sh, row, 1, baselineRows);
  row += baselineRows.length + 1;

  row = mlbSimBacktestWriteSection_(
    sh, row, 'Anchor sweep (gates fixed to live Config)',
    ['ANCHOR_K', 'ANCHOR_H', 'n', 'wins', 'hit%', 'ROI', 'pnl $'],
    anchorRows
  ) + 1;

  const gridHeader = [
    'ROI', 'n', 'wins', 'hit%', 'pnl $', 'ANCHOR_K', 'ANCHOR_H',
    'K_OVER', 'K_UNDER', 'MAX_ODDS_H', 'MIN_EV', 'H_SHRINK',
  ];
  const gridOut = gridResults.slice(0, 250).map(function (r) {
    return [
      mlbSimBacktestFmtRoi_(r.score.roi),
      r.score.n,
      r.score.wins,
      mlbSimBacktestFmtRoi_(r.score.hitRate),
      Math.round(r.score.pnl * 100) / 100,
      r.params.ANCHOR_WEIGHT_K,
      r.params.ANCHOR_WEIGHT_BATTER_HITS,
      r.params.MIN_MODEL_PCT_K_OVER,
      r.params.MIN_MODEL_PCT_K_UNDER,
      r.params.MAX_ODDS_H,
      r.params.MIN_EV_BET_CARD,
      r.params.H_MODEL_P_SHRINK,
    ];
  });
  row = mlbSimBacktestWriteSection_(
    sh, row,
    'Sim gate grid (top 250 by ROI of ' + gridResults.length + ' combos)',
    gridHeader,
    gridOut
  ) + 1;

  if (anchorRows.length) {
    sh.getRange(row++, 1).setValue('Suggested anchor review (best ROI in sweep — verify n before applying)').setFontWeight('bold');
    mlbSimBacktestWriteBlock_(sh, row, 1, [
      ['ANCHOR_WEIGHT_K', anchorRows[0][0]],
      ['ANCHOR_WEIGHT_BATTER_HITS', anchorRows[0][1]],
    ]);
    row += 3;
  }
  if (gridResults.length) {
    const best = gridResults[0];
    sh.getRange(row++, 1).setValue('Best sim gate combo (n≥' + MLB_SIM_BACKTEST_MIN_N + ')').setFontWeight('bold');
    mlbSimBacktestWriteBlock_(sh, row, 1, [
      ['ROI', mlbSimBacktestFmtRoi_(best.score.roi)],
      ['n', best.score.n],
      ['ANCHOR_WEIGHT_K', best.params.ANCHOR_WEIGHT_K],
      ['ANCHOR_WEIGHT_BATTER_HITS', best.params.ANCHOR_WEIGHT_BATTER_HITS],
      ['MIN_MODEL_PCT_K_OVER', best.params.MIN_MODEL_PCT_K_OVER],
      ['MIN_MODEL_PCT_K_UNDER', best.params.MIN_MODEL_PCT_K_UNDER],
      ['MAX_ODDS_H', best.params.MAX_ODDS_H],
    ]);
  }

  sh.setFrozenRows(3);
  sh.autoResizeColumns(1, 12);
  ss.toast(
    'Sim backtest: legacy n=' + legacyScore.n + ' · sim-live n=' + simLiveScore.n +
      ' · grid=' + gridResults.length + ' combos',
    'Sim Gate Backtest',
    10
  );
  try { sh.activate(); } catch (e) {}
}

function mlbActivateSimGateBacktestTab_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(MLB_SIM_GATE_BACKTEST_TAB);
  if (sh) sh.activate();
  else ss.toast('Run 🔬 Run sim-era gate backtest first', 'MLB-BOIZ', 5);
}
