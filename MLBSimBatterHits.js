// ============================================================
// ⚡ Sim_Batter_Hits — anchored binomial (Phase 2)
// ============================================================
// Reads 🎰 Batter_Hits_Card (22 cols). Writes ⚡ Sim_Batter_Hits same schema.
// Anchors expected hits λ toward FD line; BA_used = λ_anch / est_AB (clamped).
// ============================================================

const MLB_BATTER_HITS_SIM_TAB = '⚡ Sim_Batter_Hits';

function refreshBatterHitsSimEngine_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig();
  const wRaw = String(cfg['ANCHOR_WEIGHT_BATTER_HITS'] != null ? cfg['ANCHOR_WEIGHT_BATTER_HITS'] : '0.35').trim();
  let w = parseFloat(wRaw, 10);
  if (isNaN(w)) w = 0.35;
  w = Math.max(0, Math.min(1, w));

  const src = ss.getSheetByName(MLB_BATTER_HITS_BINOMIAL_TAB);
  if (!src || src.getLastRow() < 4) {
    mlbClearBatterHitsSimSheet_(ss);
    return;
  }

  const last = src.getLastRow();
  const rows = src.getRange(4, 1, last, 22).getValues();
  const pairs = [];

  rows.forEach(function (r) {
    const gamePk = r[0];
    const matchup = r[1];
    const side = r[2];
    const batter = r[3];
    const line = r[4];
    const fdOver = r[5];
    const fdUnder = r[6];
    const estAb = parseFloat(String(r[7]), 10);
    const lambdaModel = parseFloat(String(r[8]), 10);
    const lineNum = parseFloat(String(line), 10);

    let lamAnch = NaN;
    if (!isNaN(lambdaModel) && lambdaModel > 0 && !isNaN(lineNum)) {
      lamAnch = lineNum * (1 - w) + lambdaModel * w;
      lamAnch = Math.round(lamAnch * 1000) / 1000;
    }

    let edge = '';
    if (!isNaN(lamAnch) && lamAnch > 0 && !isNaN(lineNum)) {
      edge = Math.round((lamAnch - lineNum) * 100) / 100;
    }

    let pOver = '';
    let pUnder = '';
    let evO = '';
    let evU = '';
    let bestSide = '';
    let bestEv = '';

    if (!isNaN(estAb) && estAb > 0 && !isNaN(lamAnch) && lamAnch > 0 && !isNaN(lineNum)) {
      let baAnch = lamAnch / estAb;
      baAnch = Math.max(0.02, Math.min(0.499, baAnch));
      const kO = Math.floor(lineNum) + 1;
      const kU = Math.floor(lineNum + 1e-9);
      const pO = mlbBinomialPGeqK_(kO, estAb, baAnch);
      const pU = mlbBinomialPLeqK_(kU, estAb, baAnch);
      pOver = Math.round(pO * 1000) / 1000;
      pUnder = Math.round(pU * 1000) / 1000;
      if (fdOver !== '') evO = mlbEvPerDollarRisked_(pO, fdOver);
      if (fdUnder !== '') evU = mlbEvPerDollarRisked_(pU, fdUnder);
      if (evO !== '' && evU !== '') {
        if (evO >= evU && evO > 0) {
          bestSide = 'Over';
          bestEv = evO;
        } else if (evU > evO && evU > 0) {
          bestSide = 'Under';
          bestEv = evU;
        } else if (evO >= evU) {
          bestSide = 'Over';
          bestEv = evO;
        } else {
          bestSide = 'Under';
          bestEv = evU;
        }
      } else if (evO !== '') {
        bestSide = 'Over';
        bestEv = evO;
      } else if (evU !== '') {
        bestSide = 'Under';
        bestEv = evU;
      }
    }

    const imO = mlbAmericanImplied_(fdOver);
    const imU = mlbAmericanImplied_(fdUnder);

    const main = [
      gamePk,
      matchup,
      side,
      batter,
      line,
      fdOver,
      fdUnder,
      estAb,
      !isNaN(lamAnch) ? lamAnch : '',
      edge,
      pOver,
      pUnder,
      imO,
      imU,
      evO,
      evU,
      bestSide,
      bestEv,
      r[18],
      r[19],
      r[20],
      r[21],
    ];
    const aud = [!isNaN(lambdaModel) ? lambdaModel : '', 0];
    pairs.push({ main: main, aud: aud });
  });

  pairs.sort(function (a, b) {
    const be = parseFloat(b.main[17], 10);
    const ae = parseFloat(a.main[17], 10);
    if (isNaN(be) && isNaN(ae)) return 0;
    if (isNaN(be)) return -1;
    if (isNaN(ae)) return 1;
    return be - ae;
  });

  const out = pairs.map(function (p) {
    return p.main;
  });
  const audit = pairs.map(function (p) {
    return p.aud;
  });

  _mlbWriteBatterHitsSimSheet_(ss, out, audit);
}

function _mlbWriteBatterHitsSimSheet_(ss, out, audit) {
  let sh = ss.getSheetByName(MLB_BATTER_HITS_SIM_TAB);
  if (sh) {
    const cr = Math.max(sh.getLastRow(), 3);
    const cc = Math.max(sh.getLastColumn(), 24);
    try {
      sh.getRange(1, 1, cr, cc).breakApart();
    } catch (e) {}
    sh.clearContents();
    sh.clearFormats();
  } else {
    sh = ss.insertSheet(MLB_BATTER_HITS_SIM_TAB);
  }
  sh.setTabColor('#2e7d32');

  sh.getRange(1, 1, 1, 22)
    .merge()
    .setValue('⚡ Sim_Batter_Hits — anchored binomial (ANCHOR_WEIGHT_BATTER_HITS); 🃏 hits rows use this tab.')
    .setFontWeight('bold')
    .setBackground('#1b5e20')
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center')
    .setWrap(true);
  sh.setRowHeight(1, 36);

  const headers = [
    'gamePk',
    'matchup',
    'side',
    'batter',
    'fd_hits_line',
    'fd_over',
    'fd_under',
    'est_AB',
    'lambda_hits_anchored',
    'edge_vs_line',
    'p_over',
    'p_under',
    'implied_over',
    'implied_under',
    'ev_over_$1',
    'ev_under_$1',
    'best_side',
    'best_ev_$1',
    'flags',
    'batter_id',
    '',
    'team_abbr',
  ];
  sh.getRange(3, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight('bold')
    .setBackground('#388e3c')
    .setFontColor('#ffffff');

  if (out.length) {
    sh.getRange(4, 1, out.length, headers.length).setValues(out);
    try {
      ss.setNamedRange('MLB_BATTER_HITS_SIM', sh.getRange(4, 1, out.length, headers.length));
    } catch (e) {}
    sh.getRange(3, 23, 3, 24)
      .setValues([['lambda_hits_model', 'context_score']])
      .setFontWeight('bold')
      .setBackground('#388e3c')
      .setFontColor('#ffffff');
    sh.getRange(4, 23, out.length, 24).setValues(audit);
  }
  sh.setFrozenRows(3);
  try {
    ss.toast(out.length + ' batter hits sim rows', 'Sim Batter Hits', 6);
  } catch (e) {}
}

function mlbClearBatterHitsSimSheet_(ss) {
  let sh = ss.getSheetByName(MLB_BATTER_HITS_SIM_TAB);
  if (!sh) sh = ss.insertSheet(MLB_BATTER_HITS_SIM_TAB);
  sh.clear();
  sh.getRange(1, 1).setValue('⚡ Sim_Batter_Hits — run 🎰 Batter_Hits_Card first');
}
