// ============================================================
// 🎯 Bet Card Calibration — per-market hit rates by (model% × edge) buckets
// ============================================================
// Reads 📋 MLB_Results_Log (and 🧪 MLB_Results_Log_v2 for shadow). For each
// graded row computes prob_bucket and edge_bucket = |proj − line|, pivots,
// and reports actual hit rate vs implied break-even at the row's odds. Used
// to set per-market thresholds in Config (MIN_MODEL_PCT_K/TB/H, MIN_EDGE_*).
//
// SELF-DIAGNOSTIC: every cell shows raw N, wins, losses, pushes, voids — not
// just hit_rate — so thin samples are obvious at a glance.
// ============================================================
//
// Bucket grids:
//   prob:  [0.55,0.60) [0.60,0.65) [0.65,0.70) [0.70,0.75) [0.75,0.80) [0.80,+)
//   edge:  <0.5,  0.5–1.0,  >=1.0
//
// Recommendation logic per market: walk prob buckets ascending; flag the
// lowest bucket whose (hit_rate − implied_breakeven) is positive with at
// least MIN_SAMPLE_PER_BUCKET rows. Same for edge. Shown for human review
// — the BetCard does NOT auto-apply these; you set Config manually.
// ============================================================

const MLB_CALIBRATION_TAB = '🎯 Bet_Card_Calibration';
const MLB_CALIBRATION_MIN_SAMPLE = 10;

const MLB_CALIBRATION_PROB_BUCKETS = [
  { lo: 0.55, hi: 0.60, label: '0.55–0.60' },
  { lo: 0.60, hi: 0.65, label: '0.60–0.65' },
  { lo: 0.65, hi: 0.70, label: '0.65–0.70' },
  { lo: 0.70, hi: 0.75, label: '0.70–0.75' },
  { lo: 0.75, hi: 0.80, label: '0.75–0.80' },
  { lo: 0.80, hi: 1.01, label: '0.80+' },
];

const MLB_CALIBRATION_EDGE_BUCKETS = [
  { lo: 0,    hi: 0.5,  label: '<0.5' },
  { lo: 0.5,  hi: 1.0,  label: '0.5–1.0' },
  { lo: 1.0,  hi: 999,  label: '>=1.0' },
];

const MLB_CALIBRATION_MARKETS = [
  { key: 'K',  label: 'STRIKEOUTS',   test: function (m) { return m.indexOf('strikeout')  !== -1; } },
  { key: 'TB', label: 'TOTAL BASES',  test: function (m) { return m.indexOf('total base') !== -1; } },
  { key: 'H',  label: 'HITS',         test: function (m) { return m.indexOf('batter hit') !== -1 && m.indexOf('shadow') === -1; } },
  { key: 'Hs', label: 'HITS (shadow)', test: function (m) { return m.indexOf('batter hit') !== -1 && m.indexOf('shadow') !== -1; } },
];

function mlbCalibrationBucketFor_(value, buckets) {
  for (let i = 0; i < buckets.length; i++) {
    if (value >= buckets[i].lo && value < buckets[i].hi) return i;
  }
  return -1;
}

function mlbCalibrationMarketKey_(marketStr) {
  const m = String(marketStr || '').toLowerCase();
  for (let i = 0; i < MLB_CALIBRATION_MARKETS.length; i++) {
    if (MLB_CALIBRATION_MARKETS[i].test(m)) return MLB_CALIBRATION_MARKETS[i].key;
  }
  return '';
}

/**
 * Collect graded rows from one log tab.
 * @param ss - active spreadsheet
 * @param tab - tab name
 * @param ncol - logical column count for that log
 * @param oddsCol - 0-indexed odds column
 * @param projCol - 0-indexed proj column (use -1 if absent; falls back to NaN edge)
 * @param resCol - 0-indexed result column
 * @param marketCol - 0-indexed market column
 * @param lineCol - 0-indexed line column
 * @param probCol - 0-indexed model_p_win column
 */
function mlbCalibrationCollectRows_(ss, tab, ncol, marketCol, lineCol, oddsCol, probCol, resCol, projCol) {
  const sh = ss.getSheetByName(tab);
  if (!sh || sh.getLastRow() < 4) return [];
  const last = sh.getLastRow();
  const data = sh.getRange(4, 1, last, ncol).getValues();
  const out = [];
  for (let i = 0; i < data.length; i++) {
    const r = data[i];
    const result = String(r[resCol] || '').trim().toUpperCase();
    if (result !== 'WIN' && result !== 'LOSS' && result !== 'PUSH' && result !== 'VOID') continue;
    const mk = mlbCalibrationMarketKey_(r[marketCol]);
    if (!mk) continue;
    const prob = parseFloat(String(r[probCol]));
    if (isNaN(prob) || prob <= 0 || prob >= 1) continue;
    const odds = parseFloat(String(r[oddsCol]));
    if (isNaN(odds)) continue;
    const line = parseFloat(String(r[lineCol]));
    const proj = projCol >= 0 ? parseFloat(String(r[projCol])) : NaN;
    const edge = !isNaN(line) && !isNaN(proj) ? Math.abs(proj - line) : NaN;
    out.push({
      market: mk,
      prob: prob,
      odds: odds,
      result: result,
      edge: edge,
    });
  }
  return out;
}

/** American odds → implied break-even probability (no vig adjustment). */
function mlbCalibrationImpliedBe_(american) {
  const a = parseFloat(american, 10);
  if (isNaN(a) || a === 0) return NaN;
  if (a > 0) return 100 / (a + 100);
  return Math.abs(a) / (Math.abs(a) + 100);
}

/** Profit per $1 risked at this American price, given win/loss. */
function mlbCalibrationPnlPerDollar_(result, american) {
  if (result === 'WIN') {
    const a = parseFloat(american, 10);
    if (a > 0) return a / 100;
    return 100 / Math.abs(a);
  }
  if (result === 'LOSS') return -1;
  return 0;
}

function mlbCalibrationCellInit_() {
  return { n: 0, wins: 0, losses: 0, pushes: 0, voids: 0, oddsSum: 0, beSum: 0, pnlSum: 0 };
}

function mlbCalibrationAddRow_(cell, row) {
  cell.n += 1;
  if (row.result === 'WIN') cell.wins += 1;
  else if (row.result === 'LOSS') cell.losses += 1;
  else if (row.result === 'PUSH') cell.pushes += 1;
  else if (row.result === 'VOID') cell.voids += 1;
  cell.oddsSum += row.odds;
  const be = mlbCalibrationImpliedBe_(row.odds);
  if (!isNaN(be)) cell.beSum += be;
  cell.pnlSum += mlbCalibrationPnlPerDollar_(row.result, row.odds);
}

function mlbCalibrationCellSummary_(cell) {
  const decided = cell.wins + cell.losses;
  const hitRate = decided > 0 ? cell.wins / decided : NaN;
  const avgOdds = cell.n > 0 ? cell.oddsSum / cell.n : NaN;
  const avgBe = decided > 0 ? cell.beSum / cell.n : NaN;
  const edgeVsBe = !isNaN(hitRate) && !isNaN(avgBe) ? hitRate - avgBe : NaN;
  const pnlPerDollar = cell.n > 0 ? cell.pnlSum / cell.n : NaN;
  return {
    n: cell.n,
    wins: cell.wins,
    losses: cell.losses,
    pushes: cell.pushes,
    voids: cell.voids,
    hitRate: hitRate,
    avgOdds: avgOdds,
    avgBe: avgBe,
    edgeVsBe: edgeVsBe,
    pnlPerDollar: pnlPerDollar,
  };
}

/**
 * For one market's rows, find the lowest prob bucket whose hit_rate beats
 * implied break-even with N >= MIN_SAMPLE. Returns the bucket's low end or
 * '—' if no bucket qualifies.
 */
function mlbCalibrationRecommendFloor_(rowsByBucket, buckets) {
  for (let i = 0; i < buckets.length; i++) {
    const c = rowsByBucket[i];
    if (!c || c.n < MLB_CALIBRATION_MIN_SAMPLE) continue;
    const s = mlbCalibrationCellSummary_(c);
    if (!isNaN(s.edgeVsBe) && s.edgeVsBe > 0) return buckets[i].lo;
  }
  return '';
}

function refreshBetCardCalibration() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 📋 MLB_Results_Log layout (0-indexed): 5 market, 6 line, 7 side, 8 odds,
  // 9 model_p, 10 ev, 16 result, 26 proj.
  const liveRows = mlbCalibrationCollectRows_(
    ss, MLB_RESULTS_LOG_TAB, MLB_RESULTS_LOG_NCOL,
    5, 6, 8, 9, 16, 26
  );
  // 🧪 MLB_Results_Log_v2 layout: same first 24 cols. proj is NOT in shadow log
  // (column gap was reserved for ablation cols), so edge bucket falls back to
  // NaN for shadow rows — they aggregate into 'unknown_edge'.
  const shadowRows = mlbCalibrationCollectRows_(
    ss, MLB_RESULTS_LOG_V2_TAB, MLB_RESULTS_LOG_V2_NCOL,
    5, 6, 8, 9, 16, -1
  );

  // Group: byMarket -> byProb -> byEdge -> cell. Also overall byMarket.
  const allRows = liveRows.concat(shadowRows);
  const grouped = {};
  const totals = {};
  allRows.forEach(function (row) {
    const pi = mlbCalibrationBucketFor_(row.prob, MLB_CALIBRATION_PROB_BUCKETS);
    if (pi < 0) return;
    const ei = !isNaN(row.edge) ? mlbCalibrationBucketFor_(row.edge, MLB_CALIBRATION_EDGE_BUCKETS) : -2;
    if (!grouped[row.market]) grouped[row.market] = {};
    const byProb = grouped[row.market];
    if (!byProb[pi]) byProb[pi] = { byEdge: {}, total: mlbCalibrationCellInit_() };
    if (ei === -2) {
      // Shadow rows w/o proj: bucket as 'unknown edge' under prob row only.
      if (!byProb[pi].byEdge.unk) byProb[pi].byEdge.unk = mlbCalibrationCellInit_();
      mlbCalibrationAddRow_(byProb[pi].byEdge.unk, row);
    } else if (ei >= 0) {
      if (!byProb[pi].byEdge[ei]) byProb[pi].byEdge[ei] = mlbCalibrationCellInit_();
      mlbCalibrationAddRow_(byProb[pi].byEdge[ei], row);
    }
    mlbCalibrationAddRow_(byProb[pi].total, row);
    if (!totals[row.market]) totals[row.market] = mlbCalibrationCellInit_();
    mlbCalibrationAddRow_(totals[row.market], row);
  });

  let sh = ss.getSheetByName(MLB_CALIBRATION_TAB);
  if (sh) {
    sh.clearContents();
    sh.clearFormats();
  } else {
    sh = ss.insertSheet(MLB_CALIBRATION_TAB);
  }
  sh.setTabColor('#1565c0');

  const widths = [140, 88, 56, 56, 56, 56, 56, 68, 72, 72, 88, 84, 140];
  widths.forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });

  sh.getRange(1, 1, 1, 13)
    .merge()
    .setValue(
      '🎯 Bet Card Calibration — actual hit rate by (market × model% × |proj−line|) · live + shadow logs · N≥' + MLB_CALIBRATION_MIN_SAMPLE + ' to recommend a floor'
    )
    .setFontWeight('bold')
    .setBackground('#0d47a1')
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center')
    .setWrap(true);
  sh.setRowHeight(1, 30);

  // -------- Per-market summary (top) --------
  let row = 3;
  sh.getRange(row, 1, 1, 11)
    .setValues([['market', 'n', 'wins', 'losses', 'pushes', 'voids', 'hit_rate', 'avg_implied_be', 'hit_minus_be', 'pnl_per_$1', 'recommended_min_model_pct']])
    .setFontWeight('bold')
    .setBackground('#1565c0')
    .setFontColor('#ffffff');
  row++;

  MLB_CALIBRATION_MARKETS.forEach(function (mk) {
    const cell = totals[mk.key];
    if (!cell) {
      sh.getRange(row, 1, 1, 11).setValues([[mk.label, 0, 0, 0, 0, 0, '', '', '', '', '']]);
      row++;
      return;
    }
    const s = mlbCalibrationCellSummary_(cell);
    const byProb = grouped[mk.key] || {};
    const probTotals = MLB_CALIBRATION_PROB_BUCKETS.map(function (_, i) {
      return byProb[i] ? byProb[i].total : null;
    });
    const rec = mlbCalibrationRecommendFloor_(probTotals, MLB_CALIBRATION_PROB_BUCKETS);
    sh.getRange(row, 1, 1, 11).setValues([[
      mk.label,
      s.n, s.wins, s.losses, s.pushes, s.voids,
      isNaN(s.hitRate)   ? '' : Math.round(s.hitRate * 1000) / 10 + '%',
      isNaN(s.avgBe)     ? '' : Math.round(s.avgBe * 1000) / 10 + '%',
      isNaN(s.edgeVsBe)  ? '' : (s.edgeVsBe >= 0 ? '+' : '') + (Math.round(s.edgeVsBe * 1000) / 10) + 'pp',
      isNaN(s.pnlPerDollar) ? '' : (s.pnlPerDollar >= 0 ? '+$' : '-$') + Math.abs(Math.round(s.pnlPerDollar * 100) / 100),
      rec === '' ? '— (no qualifying bucket)' : rec,
    ]]);
    row++;
  });

  row += 1;

  // -------- Per-market prob × edge grid --------
  MLB_CALIBRATION_MARKETS.forEach(function (mk) {
    sh.getRange(row, 1, 1, 13)
      .merge()
      .setValue(mk.label + '  ·  hit rate by (model_p × |proj−line|) — N too small (<' + MLB_CALIBRATION_MIN_SAMPLE + ') greyed')
      .setFontWeight('bold')
      .setBackground('#1976d2')
      .setFontColor('#ffffff')
      .setHorizontalAlignment('center');
    row++;
    sh.getRange(row, 1, 1, 13)
      .setValues([[
        'prob_bucket', 'edge_bucket', 'n', 'wins', 'losses', 'pushes', 'voids',
        'hit_rate', 'avg_odds', 'implied_be', 'hit_minus_be', 'pnl_per_$1', 'note',
      ]])
      .setFontWeight('bold')
      .setBackground('#1e88e5')
      .setFontColor('#ffffff');
    row++;

    const byProb = grouped[mk.key] || {};
    MLB_CALIBRATION_PROB_BUCKETS.forEach(function (pb, pi) {
      // Total row (sums edge buckets within prob bucket).
      const probTotalCell = byProb[pi] ? byProb[pi].total : null;
      const sProb = probTotalCell ? mlbCalibrationCellSummary_(probTotalCell) : null;
      const probNote = !sProb
        ? '(no data)'
        : sProb.n < MLB_CALIBRATION_MIN_SAMPLE
          ? 'thin sample'
          : '';
      const probRow = [
        pb.label, 'ALL EDGES',
        sProb ? sProb.n : 0,
        sProb ? sProb.wins : 0,
        sProb ? sProb.losses : 0,
        sProb ? sProb.pushes : 0,
        sProb ? sProb.voids : 0,
        sProb && !isNaN(sProb.hitRate)   ? Math.round(sProb.hitRate * 1000) / 10 + '%' : '',
        sProb && !isNaN(sProb.avgOdds)   ? Math.round(sProb.avgOdds * 100) / 100 : '',
        sProb && !isNaN(sProb.avgBe)     ? Math.round(sProb.avgBe * 1000) / 10 + '%' : '',
        sProb && !isNaN(sProb.edgeVsBe)  ? (sProb.edgeVsBe >= 0 ? '+' : '') + (Math.round(sProb.edgeVsBe * 1000) / 10) + 'pp' : '',
        sProb && !isNaN(sProb.pnlPerDollar) ? (sProb.pnlPerDollar >= 0 ? '+$' : '-$') + Math.abs(Math.round(sProb.pnlPerDollar * 100) / 100) : '',
        probNote,
      ];
      sh.getRange(row, 1, 1, 13).setValues([probRow]).setFontWeight('bold').setBackground('#bbdefb');
      row++;

      // Edge breakouts under this prob.
      MLB_CALIBRATION_EDGE_BUCKETS.forEach(function (eb, ei) {
        const cell = byProb[pi] && byProb[pi].byEdge[ei];
        const s = cell ? mlbCalibrationCellSummary_(cell) : null;
        const note = !s ? '(no data)' : s.n < MLB_CALIBRATION_MIN_SAMPLE ? 'thin sample' : '';
        sh.getRange(row, 1, 1, 13).setValues([[
          '', eb.label,
          s ? s.n : 0,
          s ? s.wins : 0,
          s ? s.losses : 0,
          s ? s.pushes : 0,
          s ? s.voids : 0,
          s && !isNaN(s.hitRate)   ? Math.round(s.hitRate * 1000) / 10 + '%' : '',
          s && !isNaN(s.avgOdds)   ? Math.round(s.avgOdds * 100) / 100 : '',
          s && !isNaN(s.avgBe)     ? Math.round(s.avgBe * 1000) / 10 + '%' : '',
          s && !isNaN(s.edgeVsBe)  ? (s.edgeVsBe >= 0 ? '+' : '') + (Math.round(s.edgeVsBe * 1000) / 10) + 'pp' : '',
          s && !isNaN(s.pnlPerDollar) ? (s.pnlPerDollar >= 0 ? '+$' : '-$') + Math.abs(Math.round(s.pnlPerDollar * 100) / 100) : '',
          note,
        ]]);
        if (!s || s.n < MLB_CALIBRATION_MIN_SAMPLE) {
          sh.getRange(row, 1, 1, 13).setFontColor('#9e9e9e');
        } else if (!isNaN(s.edgeVsBe) && s.edgeVsBe > 0) {
          sh.getRange(row, 1, 1, 13).setBackground('#e8f5e9');
        } else if (!isNaN(s.edgeVsBe) && s.edgeVsBe < 0) {
          sh.getRange(row, 1, 1, 13).setBackground('#ffebee');
        }
        row++;
      });

      // Unknown-edge bucket (shadow rows w/o proj) — only show if non-zero.
      if (byProb[pi] && byProb[pi].byEdge.unk) {
        const s = mlbCalibrationCellSummary_(byProb[pi].byEdge.unk);
        const note = s.n < MLB_CALIBRATION_MIN_SAMPLE ? 'thin sample · no proj col (shadow)' : 'no proj col (shadow)';
        sh.getRange(row, 1, 1, 13).setValues([[
          '', 'unknown',
          s.n, s.wins, s.losses, s.pushes, s.voids,
          !isNaN(s.hitRate)   ? Math.round(s.hitRate * 1000) / 10 + '%' : '',
          !isNaN(s.avgOdds)   ? Math.round(s.avgOdds * 100) / 100 : '',
          !isNaN(s.avgBe)     ? Math.round(s.avgBe * 1000) / 10 + '%' : '',
          !isNaN(s.edgeVsBe)  ? (s.edgeVsBe >= 0 ? '+' : '') + (Math.round(s.edgeVsBe * 1000) / 10) + 'pp' : '',
          !isNaN(s.pnlPerDollar) ? (s.pnlPerDollar >= 0 ? '+$' : '-$') + Math.abs(Math.round(s.pnlPerDollar * 100) / 100) : '',
          note,
        ]]).setFontColor('#9e9e9e');
        row++;
      }
    });

    row += 1;
  });

  sh.setFrozenRows(3);
  try {
    ss.toast('Calibration: ' + allRows.length + ' graded rows', 'MLB-BOIZ', 6);
  } catch (e) {}
}

function mlbActivateCalibrationTab_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(MLB_CALIBRATION_TAB);
  if (sh) sh.activate();
  else {
    refreshBetCardCalibration();
    const sh2 = ss.getSheetByName(MLB_CALIBRATION_TAB);
    if (sh2) sh2.activate();
  }
}
