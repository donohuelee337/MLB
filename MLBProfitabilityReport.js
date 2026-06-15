// ============================================================
// 💰 MLB profitability report — live Bet Card results log
// ============================================================
// Summarizes graded 📋 MLB_Results_Log rows: ROI, hit rate vs break-even,
// and segments that look like false-positive traps (thin edge, low model %).
// Run after grading; pair with 🎯 Bet_Card_Calibration for threshold tuning.
// ============================================================

const MLB_PROFITABILITY_TAB = '💰 Profitability_Report';
const MLB_PROFITABILITY_MIN_SEGMENT_N = 8;

function refreshMLBProfitabilityReport() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const report = mlbBuildProfitabilityReport_(ss);
  mlbWriteProfitabilityReportTab_(ss, report);
  ss.toast(
    'Graded ' + report.gradedN + ' · ROI ' + (report.roiPct != null ? report.roiPct + '%' : 'n/a') + ' — see ' + MLB_PROFITABILITY_TAB,
    'Profitability',
    8
  );
}

function mlbActivateProfitabilityTab_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(MLB_PROFITABILITY_TAB);
  if (sh) sh.activate();
  else ss.toast('Run "Refresh profitability report" first', 'MLB-BOIZ', 5);
}

/**
 * @returns {Object}
 */
function mlbBuildProfitabilityReport_(ss) {
  const sh = ss.getSheetByName(MLB_RESULTS_LOG_TAB);
  const empty = {
    gradedN: 0,
    totalStake: 0,
    totalPnl: 0,
    roiPct: null,
    hitRate: null,
    segments: [],
    traps: [],
    recommendations: [],
  };
  if (!sh || sh.getLastRow() < 4) return empty;

  const data = sh.getRange(4, 1, sh.getLastRow() - 3, MLB_RESULTS_LOG_NCOL).getValues();
  const byMarket = {};
  const byProb = {};
  const byEdge = {};
  const byVersion = {};
  // CLV — the leading indicator. Outcomes need ~1000 bets to separate skill
  // from noise; average closing-line value shows in ~50. Positive avg CLV
  // with negative P/L = variance (keep going). Negative CLV = the market
  // moves against your bets after you make them — the model is late/wrong.
  const clvAgg = { n: 0, sum: 0, pos: 0 };
  const clvByMarket = {};
  const pnlBySlate = {};
  // Post-fix view: rows carrying a model_version stamp are post-audit (the
  // stamp landed in build 26). The pre-audit backlog has none and will
  // forever drown the topline — this isolates "how is the CURRENT system
  // doing" from the broken model's record.
  const postFix = { n: 0, wins: 0, losses: 0, stake: 0, pnl: 0, clvN: 0, clvSum: 0 };
  let gradedN = 0;
  let wins = 0;
  let losses = 0;
  let totalStake = 0;
  let totalPnl = 0;
  let stakeRows = 0;

  function segInit_() {
    return { n: 0, wins: 0, losses: 0, stake: 0, pnl: 0 };
  }
  function segAdd_(cell, result, stake, pnl) {
    cell.n++;
    if (result === 'WIN') cell.wins++;
    if (result === 'LOSS') cell.losses++;
    if (stake > 0) {
      cell.stake += stake;
      cell.pnl += pnl;
    }
  }

  data.forEach(function (r) {
    // CLV counts for every row that has a capture, graded or not.
    const clv = parseFloat(String(r[33]));
    if (!isNaN(clv)) {
      const mkC = mlbCalibrationMarketKey_(r[5]) || 'other';
      clvAgg.n++;
      clvAgg.sum += clv;
      if (clv > 0) clvAgg.pos++;
      if (!clvByMarket[mkC]) clvByMarket[mkC] = { n: 0, sum: 0, pos: 0 };
      clvByMarket[mkC].n++;
      clvByMarket[mkC].sum += clv;
      if (clv > 0) clvByMarket[mkC].pos++;
    }

    const result = String(r[16] || '').trim().toUpperCase();
    if (result !== 'WIN' && result !== 'LOSS') return;
    gradedN++;
    if (result === 'WIN') wins++;
    else losses++;

    const stake = parseFloat(String(r[24]));
    const pnl = parseFloat(String(r[25]));
    if (!isNaN(stake) && stake > 0) {
      stakeRows++;
      totalStake += stake;
      if (!isNaN(pnl)) totalPnl += pnl;
      // Per-slate P/L for the bankroll curve / drawdown.
      const slateYmd = typeof mlbDateCellToYmd_ === 'function' ? mlbDateCellToYmd_(r[1]) : String(r[1] || '');
      if (slateYmd && !isNaN(pnl)) {
        pnlBySlate[slateYmd] = (pnlBySlate[slateYmd] || 0) + pnl;
      }
    }

    const mk = mlbCalibrationMarketKey_(r[5]) || 'other';
    if (!byMarket[mk]) byMarket[mk] = segInit_();
    segAdd_(byMarket[mk], result, stake, pnl);

    const mvRaw = String(r.length > 38 && r[38] != null ? r[38] : '').trim();
    const mv = mvRaw || '(unstamped)';
    if (!byVersion[mv]) byVersion[mv] = segInit_();
    segAdd_(byVersion[mv], result, stake, pnl);

    // Post-fix accumulator — stamped rows only.
    if (mvRaw) {
      postFix.n++;
      if (result === 'WIN') postFix.wins++; else postFix.losses++;
      if (!isNaN(stake) && stake > 0) {
        postFix.stake += stake;
        if (!isNaN(pnl)) postFix.pnl += pnl;
      }
      const clvPf = parseFloat(String(r[33]));
      if (!isNaN(clvPf)) { postFix.clvN++; postFix.clvSum += clvPf; }
    }

    const prob = parseFloat(String(r[9]));
    if (!isNaN(prob) && prob > 0 && prob < 1) {
      const pi = mlbCalibrationBucketFor_(prob, MLB_CALIBRATION_PROB_BUCKETS);
      const label = pi >= 0 ? MLB_CALIBRATION_PROB_BUCKETS[pi].label : 'other';
      if (!byProb[label]) byProb[label] = segInit_();
      segAdd_(byProb[label], result, stake, pnl);
    }

    const line = parseFloat(String(r[6]));
    const proj = parseFloat(String(r[26]));
    if (!isNaN(line) && !isNaN(proj)) {
      const edge = Math.abs(proj - line);
      const ei = mlbCalibrationBucketFor_(edge, MLB_CALIBRATION_EDGE_BUCKETS);
      const elabel = ei >= 0 ? MLB_CALIBRATION_EDGE_BUCKETS[ei].label : 'other';
      if (!byEdge[elabel]) byEdge[elabel] = segInit_();
      segAdd_(byEdge[elabel], result, stake, pnl);
    }
  });

  const decided = wins + losses;
  const hitRate = decided > 0 ? wins / decided : null;
  const roiPct = totalStake > 0 ? Math.round((totalPnl / totalStake) * 10000) / 100 : null;

  const segments = [];
  function pushSeg_(dim, key, cell) {
    const d = cell.wins + cell.losses;
    const hr = d > 0 ? cell.wins / d : NaN;
    const roi = cell.stake > 0 ? (cell.pnl / cell.stake) * 100 : NaN;
    segments.push({
      dim: dim,
      key: key,
      n: cell.n,
      wins: cell.wins,
      losses: cell.losses,
      hitRate: hr,
      stake: cell.stake,
      pnl: cell.pnl,
      roiPct: roi,
    });
  }
  Object.keys(byMarket).sort().forEach(function (k) {
    pushSeg_('market', k, byMarket[k]);
  });
  Object.keys(byVersion).sort().forEach(function (k) {
    pushSeg_('model_version', k, byVersion[k]);
  });
  Object.keys(byProb).sort().forEach(function (k) {
    pushSeg_('model%', k, byProb[k]);
  });
  Object.keys(byEdge).sort().forEach(function (k) {
    pushSeg_('|proj−line|', k, byEdge[k]);
  });

  // Bankroll curve from per-slate P/L (chronological): running balance,
  // peak, and max drawdown — risk-of-ruin visibility for the $500 roll.
  const cfgBr = typeof getConfig === 'function' ? getConfig() : {};
  const startBankroll =
    parseFloat(String(cfgBr['BANKROLL'] != null ? cfgBr['BANKROLL'] : '500')) || 500;
  let runBal = startBankroll;
  let peakBal = startBankroll;
  let maxDdUsd = 0;
  Object.keys(pnlBySlate).sort().forEach(function (s) {
    runBal += pnlBySlate[s];
    if (runBal > peakBal) peakBal = runBal;
    const dd = peakBal - runBal;
    if (dd > maxDdUsd) maxDdUsd = dd;
  });
  const bankroll = {
    start: startBankroll,
    current: Math.round(runBal * 100) / 100,
    peak: Math.round(peakBal * 100) / 100,
    maxDrawdownUsd: Math.round(maxDdUsd * 100) / 100,
    maxDrawdownPct: peakBal > 0 ? Math.round((maxDdUsd / peakBal) * 1000) / 10 : 0,
    slates: Object.keys(pnlBySlate).length,
  };

  const clv = {
    n: clvAgg.n,
    avgPp: clvAgg.n > 0 ? Math.round((clvAgg.sum / clvAgg.n) * 100) / 100 : null,
    beatClosePct: clvAgg.n > 0 ? Math.round((clvAgg.pos / clvAgg.n) * 1000) / 10 : null,
    byMarket: Object.keys(clvByMarket).sort().map(function (k) {
      const c = clvByMarket[k];
      return {
        market: k,
        n: c.n,
        avgPp: Math.round((c.sum / c.n) * 100) / 100,
        beatClosePct: Math.round((c.pos / c.n) * 1000) / 10,
      };
    }),
  };

  const traps = [];
  segments.forEach(function (s) {
    const d = s.wins + s.losses;
    if (d < MLB_PROFITABILITY_MIN_SEGMENT_N) return;
    if (!isNaN(s.roiPct) && s.roiPct < -8) {
      traps.push(s.dim + ' ' + s.key + ': ROI ' + Math.round(s.roiPct) + '% (n=' + d + ')');
    }
    if (!isNaN(s.hitRate) && s.hitRate < 0.48 && d >= MLB_PROFITABILITY_MIN_SEGMENT_N) {
      traps.push(s.dim + ' ' + s.key + ': hit rate ' + Math.round(s.hitRate * 1000) / 10 + '% (n=' + d + ')');
    }
  });

  const recommendations = [];
  if (clv.n >= 50 && clv.avgPp != null) {
    if (clv.avgPp > 0.5 && roiPct != null && roiPct < 0) {
      recommendations.push(
        'CLV +' + clv.avgPp + 'pp avg (n=' + clv.n + ') with negative P/L — that is variance, not a broken model. Stay the course; do not loosen gates to chase.'
      );
    } else if (clv.avgPp < -0.5) {
      recommendations.push(
        'CLV ' + clv.avgPp + 'pp avg (n=' + clv.n + ') — the market moves AGAINST your bets after entry. The model is late or wrong; tighten gates / increase market anchoring before adding volume.'
      );
    }
  }
  if (gradedN < 30) {
    recommendations.push('Need 30+ graded live plays before tightening gates — keep logging snapshots.');
  } else {
    if (roiPct != null && roiPct > 0) {
      recommendations.push('Positive ROI on staked rows — raise MIN_MODEL_PCT only where calibration shows edge (see 🎯 Bet_Card_Calibration).');
    } else if (roiPct != null) {
      recommendations.push('Negative ROI — tighten MIN_MODEL_PCT_H / MIN_EDGE_H from calibration; keep K if K segment is positive.');
    }
    recommendations.push('Gate thin SP samples: OPP_SP_MIN_IP (default 10) and HR_PROMO_SHRINK_MIN_PA (50+).');
    recommendations.push('Avoid roster-fallback HR rows (lineup_missing + low PA) for promo picks — require lineup_slot ≥ 1.');
    recommendations.push('TB v1/v2 stayed off Bet Card for a reason — promote shadow only after 100+ graded wins vs v2.');
  }
  if (traps.length) {
    recommendations.push('Review trap segments below — consider excluding from Bet Card filters.');
  }

  return {
    gradedN: gradedN,
    stakeRows: stakeRows,
    totalStake: Math.round(totalStake * 100) / 100,
    totalPnl: Math.round(totalPnl * 100) / 100,
    roiPct: roiPct,
    hitRate: hitRate,
    segments: segments,
    traps: traps,
    recommendations: recommendations,
    clv: clv,
    bankroll: bankroll,
    postFix: {
      n: postFix.n,
      hitRate: (postFix.wins + postFix.losses) > 0 ? postFix.wins / (postFix.wins + postFix.losses) : null,
      stake: Math.round(postFix.stake * 100) / 100,
      pnl: Math.round(postFix.pnl * 100) / 100,
      roiPct: postFix.stake > 0 ? Math.round((postFix.pnl / postFix.stake) * 10000) / 100 : null,
      clvAvg: postFix.clvN > 0 ? Math.round((postFix.clvSum / postFix.clvN) * 100) / 100 : null,
      clvN: postFix.clvN,
    },
  };
}

function mlbWriteProfitabilityReportTab_(ss, report) {
  let sh = ss.getSheetByName(MLB_PROFITABILITY_TAB);
  if (!sh) sh = ss.insertSheet(MLB_PROFITABILITY_TAB);
  sh.clear();
  sh.setTabColor('#2e7d32');

  const tz = ss.getSpreadsheetTimeZone() || 'America/New_York';
  const stamp = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm');
  sh.getRange(1, 1)
    .setValue('💰 Profitability — live ' + MLB_RESULTS_LOG_TAB + ' — ' + stamp)
    .setFontWeight('bold');

  let row = 3;
  const clv = report.clv || { n: 0 };
  const br = report.bankroll || {};
  const summary = [
    ['Graded plays', report.gradedN],
    ['Rows with stake $', report.stakeRows],
    ['Total stake', report.totalStake],
    ['Total P/L', report.totalPnl],
    ['ROI %', report.roiPct != null ? report.roiPct + '%' : ''],
    [
      'Hit rate',
      report.hitRate != null ? Math.round(report.hitRate * 1000) / 10 + '%' : '',
    ],
    ['— CLV (north star) —', ''],
    ['Avg CLV (pp)', clv.avgPp != null ? clv.avgPp : '(no captures yet)'],
    ['Beat-close %', clv.beatClosePct != null ? clv.beatClosePct + '%  (n=' + clv.n + ')' : ''],
    ['— POST-FIX ONLY (model_version stamped — the current system) —', ''],
    ['Stamped plays', (report.postFix && report.postFix.n) || 0],
    [
      'Post-fix ROI / hit',
      report.postFix && report.postFix.n > 0
        ? (report.postFix.roiPct != null ? report.postFix.roiPct + '%' : 'n/a') +
          ' · ' + (report.postFix.hitRate != null ? Math.round(report.postFix.hitRate * 1000) / 10 + '%' : '') +
          ' · P/L $' + report.postFix.pnl
        : '(none yet — pre-audit backlog only; this fills as new slates grade)',
    ],
    [
      'Post-fix CLV',
      report.postFix && report.postFix.clvN > 0
        ? report.postFix.clvAvg + 'pp (n=' + report.postFix.clvN + ')'
        : '(no captures yet)',
    ],
    ['— Bankroll —', ''],
    ['Start / Current', br.start != null ? '$' + br.start + ' → $' + br.current : ''],
    ['Peak', br.peak != null ? '$' + br.peak : ''],
    [
      'Max drawdown',
      br.maxDrawdownUsd != null
        ? '$' + br.maxDrawdownUsd + ' (' + br.maxDrawdownPct + '% off peak, ' + br.slates + ' slates)'
        : '',
    ],
  ];
  sh.getRange(row, 1, summary.length, 2).setValues(summary);
  row += summary.length + 1;

  if (clv.byMarket && clv.byMarket.length) {
    sh.getRange(row, 1).setValue('CLV by market (avg pp · beat-close % · n) — positive avg = real edge signal').setFontWeight('bold');
    row++;
    clv.byMarket.forEach(function (c) {
      sh.getRange(row, 1).setValue(
        '• ' + c.market + ': ' + (c.avgPp >= 0 ? '+' : '') + c.avgPp + 'pp · ' + c.beatClosePct + '% · n=' + c.n
      );
      row++;
    });
    row++;
  }

  sh.getRange(row, 1).setValue('Recommendations').setFontWeight('bold');
  row++;
  report.recommendations.forEach(function (t) {
    sh.getRange(row, 1).setValue('• ' + t);
    row++;
  });
  row++;

  if (report.traps.length) {
    sh.getRange(row, 1).setValue('Likely trap segments (n≥' + MLB_PROFITABILITY_MIN_SEGMENT_N + ', poor ROI or hit%)').setFontWeight('bold');
    row++;
    report.traps.forEach(function (t) {
      sh.getRange(row, 1).setValue(t);
      sh.getRange(row, 1).setBackground('#ffebee');
      row++;
    });
    row++;
  }

  sh.getRange(row, 1, 1, 8)
    .setValues([['dimension', 'bucket', 'n', 'wins', 'losses', 'hit%', 'stake', 'roi%']])
    .setFontWeight('bold')
    .setBackground('#1b5e20')
    .setFontColor('#fff');
  row++;
  const segRows = report.segments.map(function (s) {
    const d = s.wins + s.losses;
    return [
      s.dim,
      s.key,
      s.n,
      s.wins,
      s.losses,
      d > 0 ? Math.round(s.hitRate * 1000) / 10 + '%' : '',
      s.stake > 0 ? Math.round(s.stake * 100) / 100 : '',
      !isNaN(s.roiPct) && s.stake > 0 ? Math.round(s.roiPct * 10) / 10 + '%' : '',
    ];
  });
  if (segRows.length) {
    sh.getRange(row, 1, segRows.length, 8).setValues(segRows);
  }

  sh.setColumnWidth(1, 120);
  sh.setColumnWidth(2, 100);
}
