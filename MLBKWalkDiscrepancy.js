// ============================================================
// 🧪 K Discrepancy Report — model vs market stand-in (NBA spirit)
// ============================================================
// OOS λ + fair K line vs typical FD ladder; p_gap = p_model − p_market.
// Run after walk-forward samples exist (same gameSamples as miner).
// ============================================================

const MLB_K_WF_DISCREPANCY_TAB = '🧪 K_Discrepancy_Report';

const MLB_K_TYPICAL_LINES_DEFAULT_ = [3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5];

/**
 * Half-line where Poisson P(Under) first reaches 50% (NBA fairLine analog).
 */
function mlbFairKLineFromLambda_(lambda) {
  const L = parseFloat(lambda);
  if (isNaN(L) || L <= 0) return 5.5;
  const cap = Math.max(20, Math.ceil(L * 3));
  for (let k = 0; k <= cap; k++) {
    const pUnder = mlbPoissonCdf_(k, L);
    if (pUnder >= 0.5) return k + 0.5;
  }
  return Math.round(L * 2) / 2 + 0.5;
}

function mlbTypicalKLinesFromCfg_(cfg) {
  const raw = String(cfg['K_WF_TYPICAL_K_LINES'] != null ? cfg['K_WF_TYPICAL_K_LINES'] : '').trim();
  if (!raw) return MLB_K_TYPICAL_LINES_DEFAULT_.slice();
  const out = raw.split(',').map(function (s) {
    return parseFloat(String(s).trim(), 10);
  });
  const clean = out.filter(function (x) {
    return !isNaN(x) && x > 0;
  });
  return clean.length ? clean : MLB_K_TYPICAL_LINES_DEFAULT_.slice();
}

function mlbNearestTypicalKLine_(value, lines) {
  const v = parseFloat(value);
  if (isNaN(v) || !lines || !lines.length) return 5.5;
  let best = lines[0];
  let bestD = Math.abs(v - best);
  for (let i = 1; i < lines.length; i++) {
    const d = Math.abs(v - lines[i]);
    if (d < bestD) {
      bestD = d;
      best = lines[i];
    }
  }
  return best;
}

/**
 * One OOS start → discrepancy record (model vs market proxy).
 */
function mlbBuildKDiscrepancyRow_(g, cfg, calTable) {
  const sides = mlbWalkForwardBothSides_(g, cfg, calTable);
  if (!sides.length) return null;

  const lambda = sides[0].lambda;
  const fairLine = mlbFairKLineFromLambda_(lambda);
  const typical = mlbTypicalKLinesFromCfg_(cfg);
  const marketLine = mlbNearestTypicalKLine_(fairLine, typical);
  const lineGap = Math.round((fairLine - marketLine) * 10) / 10;

  const probs = mlbProbOverUnderK_(marketLine, lambda);
  const pOver = parseFloat(probs.pOver);
  const pUnder = parseFloat(probs.pUnder);
  if (isNaN(pOver) || isNaN(pUnder)) return null;

  const modelSide = pOver >= pUnder ? 'Over' : 'Under';
  const pRaw = modelSide === 'Over' ? pOver : pUnder;
  const pCal = mlbApplyKCalibration_(pRaw, modelSide, calTable);
  const american = mlbWalkForwardOddsProxy_(modelSide, cfg);
  const pMarket = parseFloat(String(mlbAmericanImplied_(american)), 10);
  const pGap = Math.round((pCal - pMarket) * 1000) / 1000;

  const minLineGap =
    parseFloat(String(cfg['K_WF_MIN_FAIR_LINE_GAP'] != null ? cfg['K_WF_MIN_FAIR_LINE_GAP'] : '0.5')) || 0.5;
  const minPgap =
    parseFloat(String(cfg['K_WF_MIN_PWIN_GAP'] != null ? cfg['K_WF_MIN_PWIN_GAP'] : '0.02')) || 0.02;

  const flag =
    Math.abs(lineGap) >= minLineGap - 1e-6 && Math.abs(pGap) >= minPgap - 1e-6 ? 'Y' : 'N';

  const hit = mlbGradeKSide_(g.k, marketLine, modelSide) === 'WIN' ? 1 : 0;

  return {
    date: g.date,
    pitcherId: g.pitcherId || '',
    pitcherName: g.pitcherName || '',
    oppAbbr: g.oppAbbr || '',
    throws: g.throws || '',
    lambda: lambda,
    fairLine: fairLine,
    marketLine: marketLine,
    lineGap: lineGap,
    modelSide: modelSide,
    pRaw: Math.round(pRaw * 1000) / 1000,
    pCal: Math.round(pCal * 1000) / 1000,
    pMarket: pMarket,
    pGap: pGap,
    american: american,
    actualK: g.k,
    hit: hit,
    flag: flag,
    oppKVsHand: g.oppKVsHand,
    parkKMult: g.parkKMult || 1,
  };
}

function mlbBuildKWalkDiscrepancyRows_(gameSamples, cfg, calTable) {
  const rows = [];
  (gameSamples || []).forEach(function (g) {
    const r = mlbBuildKDiscrepancyRow_(g, cfg, calTable);
    if (r) rows.push(r);
  });
  return rows;
}

function mlbFilterDiscrepancyGameSamples_(gameSamples, cfg, calTable) {
  const flagged = [];
  (gameSamples || []).forEach(function (g) {
    const r = mlbBuildKDiscrepancyRow_(g, cfg, calTable);
    if (r && r.flag === 'Y') flagged.push(g);
  });
  return flagged;
}

function mlbWriteKWalkDiscrepancyReport_(ss, gameSamples, calTable, cfg) {
  const disc = mlbBuildKWalkDiscrepancyRows_(gameSamples, cfg, calTable);
  let sh = ss.getSheetByName(MLB_K_WF_DISCREPANCY_TAB);
  if (!sh) sh = ss.insertSheet(MLB_K_WF_DISCREPANCY_TAB);
  sh.clear();

  sh.getRange(1, 1)
    .setValue('🧪 K Discrepancy Report — ' + new Date())
    .setFontWeight('bold');
  sh.getRange(2, 1).setValue(
    'OOS projection vs typical FD K ladder (not pitcher median). flag=Y when |fair−market|≥' +
      (cfg['K_WF_MIN_FAIR_LINE_GAP'] || '0.5') +
      ' and |p_gap|≥' +
      (cfg['K_WF_MIN_PWIN_GAP'] || '0.02') +
      '. Run 🧠 K Deep Dive (Claude) on flagged rows.'
  );

  const headers = [
    'date',
    'pitcher',
    'opp',
    'throws',
    'lambda',
    'fair_line',
    'market_line',
    'line_gap',
    'model_side',
    'p_model_raw',
    'p_model_cal',
    'p_market',
    'p_gap',
    'market_odds',
    'actual_k',
    'hit',
    'flag',
    'claude_verdict',
    'claude_note',
  ];
  sh.getRange(4, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');

  const sheetRows = disc.map(function (r) {
    return [
      r.date,
      r.pitcherName || r.pitcherId,
      r.oppAbbr,
      r.throws,
      r.lambda,
      r.fairLine,
      r.marketLine,
      r.lineGap,
      r.modelSide,
      r.pRaw,
      r.pCal,
      r.pMarket,
      r.pGap,
      r.american,
      r.actualK,
      r.hit,
      r.flag,
      '',
      '',
    ];
  });

  if (sheetRows.length) {
    sh.getRange(5, 1, sheetRows.length, headers.length).setValues(sheetRows);
  }

  const nFlag = disc.filter(function (r) {
    return r.flag === 'Y';
  }).length;
  const hitsFlag = disc.filter(function (r) {
    return r.flag === 'Y' && r.hit;
  }).length;
  const hrFlag = nFlag ? Math.round((hitsFlag / nFlag) * 1000) / 1000 : 0;

  let foot = 5 + sheetRows.length + 1;
  sh.getRange(foot++, 1).setValue('total_rows: ' + disc.length);
  sh.getRange(foot++, 1).setValue('flagged: ' + nFlag + ' · flagged_hit_rate: ' + hrFlag);

  sh.setTabColor('#1565c0');
  return { rows: disc, nFlag: nFlag, flaggedHitRate: hrFlag };
}

function mlbActivateKWalkDiscrepancyTab_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(MLB_K_WF_DISCREPANCY_TAB);
  if (sh) sh.activate();
  else ss.toast('Run K walk-forward backtest first', 'MLB-BOIZ', 5);
}
