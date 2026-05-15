// ============================================================
// 🔬 Hits_Model_Compare — v1 vs v2 hits side-by-side + ablation hooks
// ============================================================
// Rebuilt on demand from 📋 MLB_Results_Log (v1 hits rows) and
// 🧪 MLB_Results_Log_v2 (all rows). Pairs by (slate, gamePk, batter_id,
// line). Shows per-version summary at top + per-bet rows below.
// Idempotent: this panel is purely derived; never edited by hand.
// ============================================================

const MLB_HITS_COMPARE_TAB = '🔬 Hits_Model_Compare';

function mlbHitsCompareReadV1HitsRows_(ss) {
  const sh = ss.getSheetByName(MLB_RESULTS_LOG_TAB);
  if (!sh || sh.getLastRow() < 4) return [];
  const last = sh.getLastRow();
  const data = sh.getRange(4, 1, last, MLB_RESULTS_LOG_NCOL).getValues();
  const out = [];
  for (let i = 0; i < data.length; i++) {
    const market = String(data[i][5] || '').toLowerCase();
    if (market.indexOf('batter hit') === -1) continue;
    out.push({
      slate: String(data[i][1] || '').trim(),
      gamePk: parseInt(data[i][13], 10) || '',
      batterId: parseInt(data[i][14], 10) || '',
      player: String(data[i][3] || '').trim(),
      line: data[i][6],
      side: String(data[i][7] || '').trim(),
      odds: data[i][8],
      pWin: data[i][9],
      ev: data[i][10],
      actualH: data[i][15],
      result: String(data[i][16] || '').trim(),
    });
  }
  return out;
}

function mlbHitsCompareReadV2Rows_(ss) {
  const sh = ss.getSheetByName(MLB_RESULTS_LOG_V2_TAB);
  if (!sh || sh.getLastRow() < 4) return [];
  const last = sh.getLastRow();
  const data = sh.getRange(4, 1, last, MLB_RESULTS_LOG_V2_NCOL).getValues();
  const out = [];
  for (let i = 0; i < data.length; i++) {
    out.push({
      slate: String(data[i][1] || '').trim(),
      gamePk: parseInt(data[i][13], 10) || '',
      batterId: parseInt(data[i][14], 10) || '',
      player: String(data[i][3] || '').trim(),
      line: data[i][6],
      side: String(data[i][7] || '').trim(),
      odds: data[i][8],
      pWin: data[i][9],
      ev: data[i][10],
      actualH: data[i][15],
      result: String(data[i][16] || '').trim(),
      modelVersion: String(data[i][24] || 'h.v2-full').trim() || 'h.v2-full',
      baseLam: data[i][25],
      parkMult: data[i][26],
      oppMult: data[i][27],
      handMult: data[i][28],
      abMult: data[i][29],
    });
  }
  return out;
}

function mlbHitsCompareKey_(slate, gamePk, batterId, line) {
  return (
    String(slate || '').trim() +
    '|' +
    String(gamePk || '').trim() +
    '|' +
    String(batterId || '').trim() +
    '|' +
    String(line != null ? line : '').trim()
  );
}

function mlbHitsCompareSummarizeRows_(rows) {
  let n = 0;
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let voids = 0;
  let pending = 0;
  for (let i = 0; i < rows.length; i++) {
    n++;
    const r = String(rows[i].result || '').trim();
    if (r === 'WIN') wins++;
    else if (r === 'LOSS') losses++;
    else if (r === 'PUSH') pushes++;
    else if (r === 'VOID') voids++;
    else pending++;
  }
  const decided = wins + losses;
  const rate = decided > 0 ? Math.round((wins / decided) * 1000) / 10 : '';
  return { n: n, wins: wins, losses: losses, pushes: pushes, voids: voids, pending: pending, rate: rate };
}

function refreshHitsModelCompare() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const v1Rows = mlbHitsCompareReadV1HitsRows_(ss);
  const v2Rows = mlbHitsCompareReadV2Rows_(ss);

  // Group v2 by modelVersion for summary; data table uses h.v2-full only for the pairing.
  const v2ByVersion = {};
  v2Rows.forEach(function (r) {
    const v = r.modelVersion || 'h.v2-full';
    if (!v2ByVersion[v]) v2ByVersion[v] = [];
    v2ByVersion[v].push(r);
  });

  const v1Summary = mlbHitsCompareSummarizeRows_(v1Rows);

  // Pair on key. A given (slate, gamePk, batter, line) can have rows from v1
  // and from multiple v2 variants. Build a wide row per key.
  const keyed = {};
  v1Rows.forEach(function (r) {
    const k = mlbHitsCompareKey_(r.slate, r.gamePk, r.batterId, r.line);
    if (!keyed[k]) keyed[k] = { key: k, v1: null, v2: {} };
    keyed[k].v1 = r;
  });
  v2Rows.forEach(function (r) {
    const k = mlbHitsCompareKey_(r.slate, r.gamePk, r.batterId, r.line);
    if (!keyed[k]) keyed[k] = { key: k, v1: null, v2: {} };
    keyed[k].v2[r.modelVersion || 'h.v2-full'] = r;
  });

  function firstV2_(entry) {
    const ks = Object.keys(entry.v2);
    return ks.length ? entry.v2[ks[0]] : null;
  }
  const sortedKeys = Object.keys(keyed).sort(function (a, b) {
    const A = keyed[a];
    const B = keyed[b];
    const aFirst = firstV2_(A);
    const bFirst = firstV2_(B);
    const aSlate = (A.v1 && A.v1.slate) || (aFirst && aFirst.slate) || '';
    const bSlate = (B.v1 && B.v1.slate) || (bFirst && bFirst.slate) || '';
    if (aSlate !== bSlate) return aSlate < bSlate ? 1 : -1;
    return 0;
  });

  let sh = ss.getSheetByName(MLB_HITS_COMPARE_TAB);
  if (sh) {
    sh.clearContents();
    sh.clearFormats();
  } else {
    sh = ss.insertSheet(MLB_HITS_COMPARE_TAB);
  }
  sh.setTabColor('#283593');

  const widths = [
    88, 72, 150, 48,  // slate, gamePk, batter, line
    48, 56, 52, 48, 52, // v1 side/lambda/p/ev/result
    48, 56, 52, 48, 52, // v2 side/lambda/p/ev/result
    48, 48,             // actual_H, agreement
    72, 52, 52, 52, 52, // v2 multipliers
  ];
  widths.forEach(function (w, i) {
    sh.setColumnWidth(i + 1, w);
  });

  sh.getRange(1, 1, 1, 21)
    .merge()
    .setValue(
      '🔬 Hits Model Compare — v1 vs v2 (shadow) · pairs on (slate, gamePk, batter, line) · summary up top'
    )
    .setFontWeight('bold')
    .setBackground('#1a237e')
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center')
    .setWrap(true);
  sh.setRowHeight(1, 30);

  // Summary header row 3.
  const summaryHeaders = ['version', 'n_logged', 'wins', 'losses', 'pushes', 'voids', 'pending', 'win_rate_%'];
  sh.getRange(3, 1, 1, summaryHeaders.length)
    .setValues([summaryHeaders])
    .setFontWeight('bold')
    .setBackground('#3949ab')
    .setFontColor('#ffffff');

  const summaryRows = [['h.v1', v1Summary.n, v1Summary.wins, v1Summary.losses, v1Summary.pushes, v1Summary.voids, v1Summary.pending, v1Summary.rate]];
  Object.keys(v2ByVersion).forEach(function (v) {
    const s = mlbHitsCompareSummarizeRows_(v2ByVersion[v]);
    summaryRows.push([v, s.n, s.wins, s.losses, s.pushes, s.voids, s.pending, s.rate]);
  });
  sh.getRange(4, 1, summaryRows.length, summaryHeaders.length).setValues(summaryRows);

  const tableStart = 4 + summaryRows.length + 2;
  const detailHeaders = [
    'slate',
    'gamePk',
    'batter',
    'line',
    'v1_side',
    'v1_p_win',
    'v1_ev',
    'v1_actual_H',
    'v1_result',
    'v2_side',
    'v2_p_win',
    'v2_ev',
    'v2_actual_H',
    'v2_result',
    'agreement',
    'who_won',
    'v2_model_version',
    'v2_park_mult',
    'v2_opp_mult',
    'v2_hand_mult',
    'v2_ab_mult',
  ];
  sh.getRange(tableStart, 1, 1, detailHeaders.length)
    .setValues([detailHeaders])
    .setFontWeight('bold')
    .setBackground('#5c6bc0')
    .setFontColor('#ffffff');
  sh.setFrozenRows(tableStart);

  const detailOut = [];
  sortedKeys.forEach(function (k) {
    const e = keyed[k];
    const v1 = e.v1;
    // For the table we use the canonical v2-full row if present, else first available.
    const v2Versions = Object.keys(e.v2);
    if (!v1 && v2Versions.length === 0) return;
    const v2 = e.v2['h.v2-full'] || (v2Versions.length ? e.v2[v2Versions[0]] : null);

    const slate = (v1 && v1.slate) || (v2 && v2.slate) || '';
    const gamePk = (v1 && v1.gamePk) || (v2 && v2.gamePk) || '';
    const batter = (v1 && v1.player) || (v2 && v2.player) || '';
    const line = (v1 && v1.line) || (v2 && v2.line) || '';

    let agreement = '';
    if (v1 && v2) {
      if (v1.side === v2.side) agreement = 'AGREE';
      else if (v1.side && v2.side) agreement = 'DISAGREE';
    } else if (v1) agreement = 'V1_ONLY';
    else agreement = 'V2_ONLY';

    let whoWon = '';
    const v1Res = v1 ? v1.result : '';
    const v2Res = v2 ? v2.result : '';
    if (v1Res === 'WIN' && v2Res === 'WIN') whoWon = 'BOTH';
    else if (v1Res === 'WIN' && v2Res && v2Res !== 'PENDING') whoWon = 'V1';
    else if (v2Res === 'WIN' && v1Res && v1Res !== 'PENDING') whoWon = 'V2';
    else if (v1Res === 'LOSS' && v2Res === 'LOSS') whoWon = 'NEITHER';

    detailOut.push([
      slate,
      gamePk,
      batter,
      line,
      v1 ? v1.side : '',
      v1 ? v1.pWin : '',
      v1 ? v1.ev : '',
      v1 ? v1.actualH : '',
      v1 ? v1.result : '',
      v2 ? v2.side : '',
      v2 ? v2.pWin : '',
      v2 ? v2.ev : '',
      v2 ? v2.actualH : '',
      v2 ? v2.result : '',
      agreement,
      whoWon,
      v2 ? v2.modelVersion : '',
      v2 ? v2.parkMult : '',
      v2 ? v2.oppMult : '',
      v2 ? v2.handMult : '',
      v2 ? v2.abMult : '',
    ]);
  });

  if (detailOut.length) {
    sh.getRange(tableStart + 1, 1, detailOut.length, detailHeaders.length).setValues(detailOut);
  } else {
    sh.getRange(tableStart + 1, 1).setValue('(no rows yet — run pipeline, then grade)');
  }

  ss.toast('Compare panel · v1=' + v1Summary.n + ' · v2 rows=' + v2Rows.length, 'MLB-BOIZ', 6);
}

function mlbActivateHitsCompareTab_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(MLB_HITS_COMPARE_TAB);
  if (sh) sh.activate();
  else {
    refreshHitsModelCompare();
    const sh2 = ss.getSheetByName(MLB_HITS_COMPARE_TAB);
    if (sh2) sh2.activate();
  }
}
