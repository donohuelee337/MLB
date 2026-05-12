// ============================================================
// ⚡ Sim_Batter_TB — anchored Poisson (Phase 2)
// ============================================================
// Reads 🎰 Batter_TB_Card (22 cols). Writes ⚡ Sim_Batter_TB same schema.
// ============================================================

const MLB_BATTER_TB_SIM_TAB = '⚡ Sim_Batter_TB';

function refreshBatterTBSimEngine_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig();
  const wRaw = String(cfg['ANCHOR_WEIGHT_BATTER_TB'] != null ? cfg['ANCHOR_WEIGHT_BATTER_TB'] : '0.35').trim();
  let w = parseFloat(wRaw, 10);
  if (isNaN(w)) w = 0.35;
  w = Math.max(0, Math.min(1, w));

  const src = ss.getSheetByName(MLB_BATTER_TB_SLG_LEGACY_TAB);
  if (!src || src.getLastRow() < 4) {
    mlbClearBatterTBSimSheet_(ss);
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
    const estAb = r[7];
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

    const hasModel = !isNaN(lamAnch) && lamAnch > 0 && !isNaN(lineNum);
    const pu = hasModel ? mlbProbOverUnderK_(line, lamAnch) : { pOver: '', pUnder: '' };
    const pOver = pu.pOver === '' ? '' : Math.round(pu.pOver * 1000) / 1000;
    const pUnder = pu.pUnder === '' ? '' : Math.round(pu.pUnder * 1000) / 1000;

    const imO = mlbAmericanImplied_(fdOver);
    const imU = mlbAmericanImplied_(fdUnder);
    const evO = pOver !== '' && fdOver !== '' ? mlbEvPerDollarRisked_(pOver, fdOver) : '';
    const evU = pUnder !== '' && fdUnder !== '' ? mlbEvPerDollarRisked_(pUnder, fdUnder) : '';

    let bestSide = '';
    let bestEv = '';
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

    pairs.push({
      main: [
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
      ],
      aud: [!isNaN(lambdaModel) ? lambdaModel : '', 0],
    });
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

  let sh = ss.getSheetByName(MLB_BATTER_TB_SIM_TAB);
  if (sh) {
    const cr = Math.max(sh.getLastRow(), 3);
    const cc = Math.max(sh.getLastColumn(), 24);
    try {
      sh.getRange(1, 1, cr, cc).breakApart();
    } catch (e) {}
    sh.clearContents();
    sh.clearFormats();
  } else {
    sh = ss.insertSheet(MLB_BATTER_TB_SIM_TAB);
  }
  sh.setTabColor('#5e35b1');

  sh.getRange(1, 1, 1, 22)
    .merge()
    .setValue('⚡ Sim_Batter_TB — anchored Poisson (ANCHOR_WEIGHT_BATTER_TB); 🃏 TB rows use this tab.')
    .setFontWeight('bold')
    .setBackground('#4a148c')
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center')
    .setWrap(true);
  sh.setRowHeight(1, 36);

  const headers = [
    'gamePk',
    'matchup',
    'side',
    'batter',
    'fd_tb_line',
    'fd_over',
    'fd_under',
    'est_AB',
    'lambda_TB_anchored',
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
    .setBackground('#6a1b9a')
    .setFontColor('#ffffff');

  if (out.length) {
    sh.getRange(4, 1, out.length, headers.length).setValues(out);
    try {
      ss.setNamedRange('MLB_BATTER_TB_SIM', sh.getRange(4, 1, out.length, headers.length));
    } catch (e) {}
    sh.getRange(3, 23, 3, 24)
      .setValues([['lambda_TB_model', 'context_score']])
      .setFontWeight('bold')
      .setBackground('#6a1b9a')
      .setFontColor('#ffffff');
    sh.getRange(4, 23, out.length, 24).setValues(audit);
  }
  sh.setFrozenRows(3);
  try {
    ss.toast(out.length + ' batter TB sim rows', 'Sim Batter TB', 6);
  } catch (e) {}
}

function mlbClearBatterTBSimSheet_(ss) {
  let sh = ss.getSheetByName(MLB_BATTER_TB_SIM_TAB);
  if (!sh) sh = ss.insertSheet(MLB_BATTER_TB_SIM_TAB);
  sh.clear();
  sh.getRange(1, 1).setValue('⚡ Sim_Batter_TB — run 🎰 Batter_TB_Card first');
}
