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
  // Resolve card columns BY HEADER NAME (row 3). Build 24 inserted pitch_team
  // at card col 5 and this reader's hard-coded indices silently shifted: r[4]
  // became the team abbr → parseFloat=NaN → every sim row lost its model and
  // the 🃏 card produced zero K picks. Fallback indices = current card layout.
  const hdr = mlbHeaderIndexMap_(src, 3);
  const ci = function (name, fb) { return hdr[name] != null ? hdr[name] : fb; };
  const C_LINE = ci('fd_k_line', 5);
  const C_OVER = ci('fd_over', 6);
  const C_UNDER = ci('fd_under', 7);
  const C_IP = ci('proj_IP', 8);
  const C_LAMBDA = ci('proj_K', 9);
  const C_FLAGS = ci('flags', 19);
  const C_PID = ci('pitcher_id', 20);
  const C_UMP = ci('hp_umpire', 21);
  const C_THROWS = ci('throws', 22);
  const C_L_V2 = ci('lambda_K_v2', 27);
  const C_GAMES_V2 = ci('games', 28);
  const C_K9_V2 = ci('k9_eff_v2', 29);
  const C_IP_V2 = ci('projIP_v2', 30);
  const C_L_V3 = ci('lambda_K_v3_bf', 31);
  const C_SBF_V3 = ci('season_bf', 32);
  const C_KPA_V3 = ci('k_per_pa', 33);
  const C_PA_V3 = ci('proj_pa_bf', 34);
  const colsToRead = src.getLastColumn();
  // Data is rows 4..last → (last - 3) rows; reading `last` rows over-reads 3.
  const rows = src.getRange(4, 1, last - 3, colsToRead).getValues();
  const out = [];

  // 🧪 Market-blend shadow (cols 39..41, audit only — NOT used for picks).
  // p_blend = w·fair_market + (1−w)·p_model_raw, fair = de-vigged two-way FD
  // price, p_model_raw = Poisson at the UNANCHORED model λ. Rationale: across
  // ~2,900 graded bets the model's biggest claimed edges were its biggest
  // misses — the market prior was right. This column accumulates the data to
  // judge whether blended probabilities gate/stake better before any of it
  // touches the live pick path.
  const wMktRaw = parseFloat(String(cfg['K_PROB_BLEND_MARKET_W'] != null ? cfg['K_PROB_BLEND_MARKET_W'] : '0.65'));
  const wMkt = !isNaN(wMktRaw) ? Math.max(0, Math.min(1, wMktRaw)) : 0.65;

  rows.forEach(function (r) {
    const gamePk = r[0];
    const matchup = r[1];
    const side = r[2];
    const pitcher = r[3];
    const line = r[C_LINE];
    const fdOver = r[C_OVER];
    const fdUnder = r[C_UNDER];
    const projIp = r[C_IP];
    const lambdaModel = parseFloat(String(r[C_LAMBDA]), 10);
    const lineNum = parseFloat(String(line), 10);
    // 🧪 v2 audit passthroughs from card.
    const lambdaV2Model = parseFloat(String(r[C_L_V2] != null ? r[C_L_V2] : ''), 10);
    const gamesV2 = r[C_GAMES_V2] != null ? r[C_GAMES_V2] : '';
    const k9EffV2 = r[C_K9_V2] != null ? r[C_K9_V2] : '';
    const projIpV2 = r[C_IP_V2] != null ? r[C_IP_V2] : '';
    // 🧪 v3.bf audit passthroughs from card.
    const lambdaV3BfModel = parseFloat(String(r[C_L_V3] != null ? r[C_L_V3] : ''), 10);
    const seasonBfV3 = r[C_SBF_V3] != null ? r[C_SBF_V3] : '';
    const kPerPaV3 = r[C_KPA_V3] != null ? r[C_KPA_V3] : '';
    const projPaBfV3 = r[C_PA_V3] != null ? r[C_PA_V3] : '';

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

    // 🧪 v3.bf anchored λ + EV stack (audit only — same anchor weight as v1).
    let lamAnchV3Bf = NaN;
    if (!isNaN(lambdaV3BfModel) && lambdaV3BfModel > 0 && !isNaN(lineNum)) {
      lamAnchV3Bf = Math.round((lineNum * (1 - w) + lambdaV3BfModel * w) * 100) / 100;
    }
    let edgeV3Bf = '';
    if (!isNaN(lamAnchV3Bf) && lamAnchV3Bf > 0 && !isNaN(lineNum)) {
      edgeV3Bf = Math.round((lamAnchV3Bf - lineNum) * 100) / 100;
    }
    const hasV3Bf = !isNaN(lamAnchV3Bf) && lamAnchV3Bf > 0 && !isNaN(lineNum);
    const puV3Bf = hasV3Bf ? mlbProbOverUnderK_(line, lamAnchV3Bf) : { pOver: '', pUnder: '' };
    const pOverV3Bf = puV3Bf.pOver === '' ? '' : Math.round(puV3Bf.pOver * 1000) / 1000;
    const pUnderV3Bf = puV3Bf.pUnder === '' ? '' : Math.round(puV3Bf.pUnder * 1000) / 1000;
    const evOV3Bf = pOverV3Bf !== '' && fdOver !== '' ? mlbEvPerDollarRisked_(pOverV3Bf, fdOver) : '';
    const evUV3Bf = pUnderV3Bf !== '' && fdUnder !== '' ? mlbEvPerDollarRisked_(pUnderV3Bf, fdUnder) : '';
    let bestSideV3Bf = '';
    let bestEvV3Bf = '';
    if (evOV3Bf !== '' && evUV3Bf !== '') {
      if (evOV3Bf >= evUV3Bf) { bestSideV3Bf = 'Over'; bestEvV3Bf = evOV3Bf; }
      else { bestSideV3Bf = 'Under'; bestEvV3Bf = evUV3Bf; }
    } else if (evOV3Bf !== '') { bestSideV3Bf = 'Over'; bestEvV3Bf = evOV3Bf; }
    else if (evUV3Bf !== '') { bestSideV3Bf = 'Under'; bestEvV3Bf = evUV3Bf; }

    const hasModel = !isNaN(lamAnch) && lamAnch > 0 && !isNaN(lineNum);
    const pu = hasModel ? mlbProbOverUnderK_(line, lamAnch) : { pOver: '', pUnder: '' };
    const pOver = pu.pOver === '' ? '' : Math.round(pu.pOver * 1000) / 1000;
    const pUnder = pu.pUnder === '' ? '' : Math.round(pu.pUnder * 1000) / 1000;

    const imO = mlbAmericanImplied_(fdOver);
    const imU = mlbAmericanImplied_(fdUnder);
    const evO = pOver !== '' && fdOver !== '' ? mlbEvPerDollarRisked_(pOver, fdOver) : '';
    const evU = pUnder !== '' && fdUnder !== '' ? mlbEvPerDollarRisked_(pUnder, fdUnder) : '';

    // Market-blend shadow values (see header comment above).
    let pOverBlend = '';
    let pUnderBlend = '';
    if (imO !== '' && imU !== '' && !isNaN(lambdaModel) && lambdaModel > 0 && !isNaN(lineNum)) {
      const fair = mlbDevigTwoWay_(imO, imU);
      const puRawModel = mlbProbOverUnderK_(line, lambdaModel);
      if (fair.fairSide !== '' && puRawModel.pOver !== '') {
        pOverBlend = Math.round((wMkt * fair.fairSide + (1 - wMkt) * puRawModel.pOver) * 1000) / 1000;
        pUnderBlend = Math.round((wMkt * fair.fairOpp + (1 - wMkt) * puRawModel.pUnder) * 1000) / 1000;
      }
    }

    const pick = (typeof mlbChooseSideOutcomeFirst_ === 'function')
      ? mlbChooseSideOutcomeFirst_('Over', pOver, evO, 'Under', pUnder, evU, cfg)
      : { side: '', ev: NaN };
    const board = typeof mlbKPickOnBoard_ === 'function'
      ? mlbKPickOnBoard_(lamAnch, lineNum)
      : { onBoard: true };
    let pickSide = pick.side;
    let pickEv = isNaN(pick.ev) ? '' : Math.round(pick.ev * 1000) / 1000;
    let flags = String(r[C_FLAGS] || '');
    if (hasModel && !board.onBoard) {
      pickSide = '';
      pickEv = '';
      flags = flags ? flags + '; agree_fd' : 'agree_fd';
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
      pickSide,
      pickEv,
      flags,
      r[C_PID],
      r[C_UMP],
      r[C_THROWS],
      // 🧪 v2 audit cols 23..30. Cols 1..22 above are live.
      !isNaN(lambdaV2Model) ? lambdaV2Model : '',
      !isNaN(lamAnchV2) ? lamAnchV2 : '',
      edgeV2,
      bestSideV2,
      bestEvV2,
      gamesV2 === '' || gamesV2 == null ? '' : gamesV2,
      k9EffV2 === '' || k9EffV2 == null ? '' : k9EffV2,
      projIpV2 === '' || projIpV2 == null ? '' : projIpV2,
      // 🧪 v3.bf audit cols 31..38.
      !isNaN(lambdaV3BfModel) ? lambdaV3BfModel : '',
      !isNaN(lamAnchV3Bf) ? lamAnchV3Bf : '',
      edgeV3Bf,
      bestSideV3Bf,
      bestEvV3Bf,
      seasonBfV3 === '' || seasonBfV3 == null ? '' : seasonBfV3,
      kPerPaV3 === '' || kPerPaV3 == null ? '' : kPerPaV3,
      projPaBfV3 === '' || projPaBfV3 == null ? '' : projPaBfV3,
      // 🧪 market-blend shadow cols 39..41.
      pOverBlend,
      pUnderBlend,
      pOverBlend !== '' ? wMkt : '',
    ]);
  });

  const pickMode = typeof mlbPickBy_ === 'function' ? mlbPickBy_(cfg) : 'outcome';
  out.sort(function (a, b) {
    let be;
    let ae;
    if (pickMode === 'ev') {
      be = parseFloat(b[17], 10);
      ae = parseFloat(a[17], 10);
    } else {
      be = String(b[16] || '') === 'Over' ? parseFloat(b[10], 10)
        : String(b[16] || '') === 'Under' ? parseFloat(b[11], 10)
        : -1e9;
      ae = String(a[16] || '') === 'Over' ? parseFloat(a[10], 10)
        : String(a[16] || '') === 'Under' ? parseFloat(a[11], 10)
        : -1e9;
    }
    if (isNaN(be) && isNaN(ae)) return 0;
    if (isNaN(be)) return -1;
    if (isNaN(ae)) return 1;
    return be - ae;
  });

  let sh = ss.getSheetByName(MLB_PITCHER_K_SIM_TAB);
  if (sh) {
    // Floor at the new layout width (38) so breakApart covers any stale merge
    // from prior runs — old floors were 22 (pre-v2) then 30 (pre-v3.bf).
    // Capped at maxColumns to avoid the very error this guard is preventing.
    const cr = Math.max(sh.getLastRow(), 3);
    const cc = Math.min(Math.max(sh.getLastColumn(), 38), sh.getMaxColumns());
    try {
      sh.getRange(1, 1, cr, cc).breakApart();
    } catch (e) {}
    sh.clearContents();
    sh.clearFormats();
  } else {
    sh = ss.insertSheet(MLB_PITCHER_K_SIM_TAB);
  }
  sh.setTabColor('#1565c0');
  // Sim sheet may have been created at 22/30/38 cols; ensure room for v2
  // (23..30) + v3.bf (31..38) + market-blend shadow (39..41).
  const NEED_COLS_K_SIM = 41;
  if (sh.getMaxColumns() < NEED_COLS_K_SIM) {
    sh.insertColumnsAfter(sh.getMaxColumns(), NEED_COLS_K_SIM - sh.getMaxColumns());
  }

  sh.getRange(1, 1, 1, NEED_COLS_K_SIM)
    .merge()
    .setValue(
      '⚡ Sim_Pitcher_K — anchored Poisson (ANCHOR_WEIGHT_K). pick = side we prefer (PICK_BY=outcome). Cols 23..30 = 🧪 k.v2 · 31..38 = 🧪 k.v3.bf · 39..41 = 🧪 market-blend shadow (audit only).'
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
    'pick',
    'pick_ev_$1',
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
    'lambda_K_v3_bf',
    'lambda_K_anch_v3_bf',
    'edge_v3_bf',
    'best_side_v3_bf',
    'best_ev_v3_bf',
    'season_bf',
    'k_per_pa',
    'proj_pa_bf',
    'p_over_blend',
    'p_under_blend',
    'blend_w',
  ];
  sh.getRange(3, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight('bold')
    .setBackground('#1976d2')
    .setFontColor('#ffffff');

  if (out.length) {
    sh.getRange(4, 1, out.length, headers.length).setValues(out);
    for (let i = 0; i < out.length; i++) {
      if (String(out[i][18] || '').indexOf('agree_fd') !== -1) {
        sh.getRange(4 + i, 1, 1, headers.length).setBackground('#f0f0f0');
      }
    }
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
