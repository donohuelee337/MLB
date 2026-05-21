// ============================================================
// ⚡ Sim_Pitcher_K — anchored Poisson (Phase 1)
// ============================================================
// Reads 🎰 Pitcher_K_Card (22 cols, row 4+). Writes ⚡ Sim_Pitcher_K
// with the SAME 22-column schema so MLBBetCard merge is unchanged.
// Cols 23–24: lambda_K_model, context_score (audit; not read by merge).
// anchoredLambda = line*(1-w) + lambda*w, w = ANCHOR_WEIGHT_K.
// ============================================================

const MLB_PITCHER_K_SIM_TAB = '⚡ Sim_Pitcher_K';

/**
 * Rebuild sim rows from the current K card. Idempotent.
 * Call only after refreshPitcherKBetCard().
 */
function refreshPitcherKSimEngine_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig();
  const wRaw = String(cfg['ANCHOR_WEIGHT_K'] != null ? cfg['ANCHOR_WEIGHT_K'] : '0.35').trim();
  let w = parseFloat(wRaw, 10);
  if (isNaN(w)) w = 0.35;
  w = Math.max(0, Math.min(1, w));

  const src = ss.getSheetByName(MLB_PITCHER_K_CARD_TAB);
  if (!src || src.getLastRow() < 4) {
    mlbClearPitcherKSimSheet_(ss);
    return;
  }

  const last = src.getLastRow();
  // Read up to 30 cols so we can pick up 🧪 k.v2 audit (lambda_K_v2 at col 27..30).
  // If card hasn't been rebuilt with v2 schema yet, fall back to its current width
  // and v2 cells will be blank — sim degrades gracefully.
  const colsToRead = Math.min(30, Math.max(22, src.getLastColumn()));
  const rows = src.getRange(4, 1, last, colsToRead).getValues();
  const out = [];

  rows.forEach(function (r) {
    const gamePk = r[0];
    const matchup = r[1];
    const side = r[2];
    const pitcher = r[3];
    const line = r[4];
    const fdOver = r[5];
    const fdUnder = r[6];
    const projIp = r[7];
    const lambdaModel = parseFloat(String(r[8]), 10);
    const lineNum = parseFloat(String(line), 10);
    // 🧪 v2 audit passthroughs from card (cols 27..30 of card → r[26..29]).
    const lambdaV2Model = parseFloat(String(r[26] != null ? r[26] : ''), 10);
    const gamesV2 = r[27] != null ? r[27] : '';
    const k9EffV2 = r[28] != null ? r[28] : '';
    const projIpV2 = r[29] != null ? r[29] : '';

    let lamAnch = NaN;
    if (!isNaN(lambdaModel) && lambdaModel > 0 && !isNaN(lineNum)) {
      lamAnch = lineNum * (1 - w) + lambdaModel * w;
      lamAnch = Math.round(lamAnch * 100) / 100;
    }

    let edge = '';
    if (!isNaN(lamAnch) && lamAnch > 0 && !isNaN(lineNum)) {
      edge = Math.round((lamAnch - lineNum) * 100) / 100;
    }

    // 🧪 v2 anchored λ + EV stack (audit only — not used for live picks).
    let lamAnchV2 = NaN;
    if (!isNaN(lambdaV2Model) && lambdaV2Model > 0 && !isNaN(lineNum)) {
      lamAnchV2 = Math.round((lineNum * (1 - w) + lambdaV2Model * w) * 100) / 100;
    }
    let edgeV2 = '';
    if (!isNaN(lamAnchV2) && lamAnchV2 > 0 && !isNaN(lineNum)) {
      edgeV2 = Math.round((lamAnchV2 - lineNum) * 100) / 100;
    }
    const hasV2 = !isNaN(lamAnchV2) && lamAnchV2 > 0 && !isNaN(lineNum);
    const puV2 = hasV2 ? mlbProbOverUnderK_(line, lamAnchV2) : { pOver: '', pUnder: '' };
    const pOverV2 = puV2.pOver === '' ? '' : Math.round(puV2.pOver * 1000) / 1000;
    const pUnderV2 = puV2.pUnder === '' ? '' : Math.round(puV2.pUnder * 1000) / 1000;
    const evOV2 = pOverV2 !== '' && fdOver !== '' ? mlbEvPerDollarRisked_(pOverV2, fdOver) : '';
    const evUV2 = pUnderV2 !== '' && fdUnder !== '' ? mlbEvPerDollarRisked_(pUnderV2, fdUnder) : '';
    let bestSideV2 = '';
    let bestEvV2 = '';
    if (evOV2 !== '' && evUV2 !== '') {
      if (evOV2 >= evUV2) { bestSideV2 = 'Over'; bestEvV2 = evOV2; }
      else { bestSideV2 = 'Under'; bestEvV2 = evUV2; }
    } else if (evOV2 !== '') { bestSideV2 = 'Over'; bestEvV2 = evOV2; }
    else if (evUV2 !== '') { bestSideV2 = 'Under'; bestEvV2 = evUV2; }

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

    out.push([
      gamePk,
      matchup,
      side,
      pitcher,
      line,
      fdOver,
      fdUnder,
      projIp,
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
      // 🧪 v2 audit cols 23..30. Cols 1..22 above are live.
      !isNaN(lambdaV2Model) ? lambdaV2Model : '',
      !isNaN(lamAnchV2) ? lamAnchV2 : '',
      edgeV2,
      bestSideV2,
      bestEvV2,
      gamesV2 === '' || gamesV2 == null ? '' : gamesV2,
      k9EffV2 === '' || k9EffV2 == null ? '' : k9EffV2,
      projIpV2 === '' || projIpV2 == null ? '' : projIpV2,
    ]);
  });

  out.sort(function (a, b) {
    const be = parseFloat(b[17], 10);
    const ae = parseFloat(a[17], 10);
    if (isNaN(be) && isNaN(ae)) return 0;
    if (isNaN(be)) return -1;
    if (isNaN(ae)) return 1;
    return be - ae;
  });

  let sh = ss.getSheetByName(MLB_PITCHER_K_SIM_TAB);
  if (sh) {
    // Floor at the new layout width (30) so breakApart covers any stale merge
    // from prior runs — old floor was 22 (pre-v2). Capped at maxColumns to
    // avoid the very error this whole guard is preventing.
    const cr = Math.max(sh.getLastRow(), 3);
    const cc = Math.min(Math.max(sh.getLastColumn(), 30), sh.getMaxColumns());
    try {
      sh.getRange(1, 1, cr, cc).breakApart();
    } catch (e) {}
    sh.clearContents();
    sh.clearFormats();
  } else {
    sh = ss.insertSheet(MLB_PITCHER_K_SIM_TAB);
  }
  sh.setTabColor('#1565c0');
  // Sim sheet may have been created at 22 cols (pre-v2); ensure room for v2 audit (23..30).
  const NEED_COLS_K_SIM = 30;
  if (sh.getMaxColumns() < NEED_COLS_K_SIM) {
    sh.insertColumnsAfter(sh.getMaxColumns(), NEED_COLS_K_SIM - sh.getMaxColumns());
  }

  sh.getRange(1, 1, 1, 30)
    .merge()
    .setValue(
      '⚡ Sim_Pitcher_K — anchored Poisson (ANCHOR_WEIGHT_K); EV is authoritative for 🃏 K rows. Cols 23..30 = 🧪 k.v2 shadow (audit only).'
    )
    .setFontWeight('bold')
    .setBackground('#0d47a1')
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center')
    .setWrap(true);
  sh.setRowHeight(1, 36);

  const headers = [
    'gamePk',
    'matchup',
    'side',
    'pitcher',
    'fd_k_line',
    'fd_over',
    'fd_under',
    'proj_IP',
    'lambda_K_anchored',
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
    'pitcher_id',
    'hp_umpire',
    'throws',
    'lambda_K_v2',
    'lambda_K_anch_v2',
    'edge_v2',
    'best_side_v2',
    'best_ev_v2',
    'games',
    'k9_eff_v2',
    'projIP_v2',
  ];
  sh.getRange(3, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight('bold')
    .setBackground('#1976d2')
    .setFontColor('#ffffff');

  if (out.length) {
    sh.getRange(4, 1, out.length, headers.length).setValues(out);
    try {
      ss.setNamedRange('MLB_PITCHER_K_SIM', sh.getRange(4, 1, out.length, headers.length));
    } catch (e) {}
  }
  sh.setFrozenRows(3);
  try {
    ss.toast(out.length + ' sim rows · anchored λ', 'Pitcher K Sim', 6);
  } catch (e) {}
}

/** Empty K card → clear sim tab and leave a one-line hint (no data rows). */
function mlbClearPitcherKSimSheet_(ss) {
  let sh = ss.getSheetByName(MLB_PITCHER_K_SIM_TAB);
  if (!sh) sh = ss.insertSheet(MLB_PITCHER_K_SIM_TAB);
  sh.clear();
  sh.getRange(1, 1).setValue('⚡ Sim_Pitcher_K — run 🎰 Pitcher_K_Card first');
}
