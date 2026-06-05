// ============================================================
// ⚡ Sim_Batter_Hits — anchored binomial (live h.v2-full)
// ============================================================
// Reads 🧪 Batter_Hits_Card_v2-full. Writes ⚡ Sim_Batter_Hits in the
// same column layout (v2 schema) so 🃏 merge indices stay stable.
// Anchors λ toward FD line; BA_used = λ_anch / est_pa (clamped).
// ============================================================

const MLB_BATTER_HITS_SIM_TAB = '⚡ Sim_Batter_Hits';

function refreshBatterHitsSimEngine_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig();
  const wRaw = String(cfg['ANCHOR_WEIGHT_BATTER_HITS'] != null ? cfg['ANCHOR_WEIGHT_BATTER_HITS'] : '0.35').trim();
  let w = parseFloat(wRaw, 10);
  if (isNaN(w)) w = 0.35;
  w = Math.max(0, Math.min(1, w));

  // H_MODEL_P_SHRINK: empirical calibration factor. The sim layer is authoritative
  // for the bet card, so the shrink MUST be applied here (the v2-full card applies
  // it too but those values get overwritten when the sim recomputes from lambda).
  // Audit: graded Results Log shows model overestimates P(≥1 hit) by +10..+18pp
  // across all model% buckets ≥0.60. Closes the systemic H calibration gap.
  const hShrinkRaw = parseFloat(String(cfg['H_MODEL_P_SHRINK'] != null ? cfg['H_MODEL_P_SHRINK'] : '1'));
  const hShrink = (!isNaN(hShrinkRaw) && hShrinkRaw > 0 && hShrinkRaw <= 1) ? hShrinkRaw : 1;

  const srcTab =
    typeof MLB_BATTER_HITS_V2_CARD_TAB !== 'undefined'
      ? MLB_BATTER_HITS_V2_CARD_TAB
      : '🧪 Batter_Hits_Card_v2-full';
  const src = ss.getSheetByName(srcTab);
  if (!src || src.getLastRow() < 4) {
    mlbClearBatterHitsSimSheet_(ss);
    return;
  }

  const last = src.getLastRow();
  const colsToRead = Math.min(34, Math.max(22, src.getLastColumn()));
  // Data is rows 4..last → (last - 3) rows. This sim has no blank-row skip, so
  // reading `last` rows used to append 3 phantom blank rows to the output sheet.
  const rows = src.getRange(4, 1, last - 3, colsToRead).getValues();
  const pairs = [];

  rows.forEach(function (r) {
    const line = r[3];
    const fdOver = r[4];
    const fdUnder = r[5];
    const lambdaModel = parseFloat(String(r[6]), 10);
    const estPa = parseFloat(String(r[25] != null ? r[25] : ''), 10);
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
    // 🧪 one-sided-shrink shadow (audit cols 37..40; NOT used for live picks).
    // The live shrink above scales BOTH sides by H_MODEL_P_SHRINK, but the
    // documented calibration miss is one-sided ("model overestimates P(≥1 hit)").
    // Correcting a too-high Over should RAISE the Under (its complement), not
    // shrink it too. This shadow shrinks only the Over and derives the Under as
    // the complement (exact for half-integer hit lines — no push). Compare its
    // graded ROI vs the live symmetric shrink before promoting.
    let pO1s = '';
    let pU1s = '';
    let bestSide1s = '';
    let bestEv1s = '';

    if (!isNaN(estPa) && estPa > 0 && !isNaN(lamAnch) && lamAnch > 0 && !isNaN(lineNum)) {
      let baAnch = lamAnch / estPa;
      baAnch = Math.max(0.02, Math.min(0.499, baAnch));
      const kO = Math.floor(lineNum) + 1;
      const kU = Math.floor(lineNum + 1e-9);
      const pORaw = mlbBinomialPGeqK_(kO, estPa, baAnch);
      const pURaw = mlbBinomialPLeqK_(kU, estPa, baAnch);
      const pOAdj = (hShrink > 0 && hShrink < 1) ? Math.min(pORaw * hShrink, 0.9999) : pORaw;
      const pUAdj = (hShrink > 0 && hShrink < 1) ? Math.min(pURaw * hShrink, 0.9999) : pURaw;
      pOver = Math.round(pOAdj * 1000) / 1000;
      pUnder = Math.round(pUAdj * 1000) / 1000;
      if (fdOver !== '') evO = mlbEvPerDollarRisked_(pOAdj, fdOver);
      if (fdUnder !== '') evU = mlbEvPerDollarRisked_(pUAdj, fdUnder);

      // One-sided shadow: shrink the Over, Under = 1 − Over_adj.
      const pO1sAdj = (hShrink > 0 && hShrink < 1) ? Math.min(pORaw * hShrink, 0.9999) : pORaw;
      const pU1sAdj = Math.max(0, Math.min(0.9999, 1 - pO1sAdj));
      pO1s = Math.round(pO1sAdj * 1000) / 1000;
      pU1s = Math.round(pU1sAdj * 1000) / 1000;
      const evO1s = fdOver !== '' ? mlbEvPerDollarRisked_(pO1sAdj, fdOver) : '';
      const evU1s = fdUnder !== '' ? mlbEvPerDollarRisked_(pU1sAdj, fdUnder) : '';
      if (evO1s !== '' && evU1s !== '') {
        if (evO1s >= evU1s) { bestSide1s = 'Over'; bestEv1s = evO1s; }
        else { bestSide1s = 'Under'; bestEv1s = evU1s; }
      } else if (evO1s !== '') { bestSide1s = 'Over'; bestEv1s = evO1s; }
      else if (evU1s !== '') { bestSide1s = 'Under'; bestEv1s = evU1s; }
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

    const outRow = r.slice();
    while (outRow.length < 34) outRow.push('');
    outRow[6] = !isNaN(lamAnch) ? lamAnch : '';
    outRow[7] = edge;
    outRow[8] = pOver;
    outRow[9] = pUnder;
    outRow[10] = imO;
    outRow[11] = imU;
    outRow[12] = evO;
    outRow[13] = evU;
    outRow[14] = bestSide;
    outRow[15] = bestEv;

    pairs.push({
      row: outRow,
      aud: [!isNaN(lambdaModel) ? lambdaModel : '', 0, pO1s, pU1s, bestSide1s, bestEv1s],
    });
  });

  pairs.sort(function (a, b) {
    const be = parseFloat(b.row[15], 10);
    const ae = parseFloat(a.row[15], 10);
    if (isNaN(be) && isNaN(ae)) return 0;
    if (isNaN(be)) return -1;
    if (isNaN(ae)) return 1;
    return be - ae;
  });

  const out = pairs.map(function (p) {
    return p.row;
  });
  const audit = pairs.map(function (p) {
    return p.aud;
  });

  _mlbWriteBatterHitsSimSheet_(ss, out, audit);
}

function _mlbWriteBatterHitsSimSheet_(ss, out, audit) {
  const NEED_COLS = 34;
  // Audit block: 35 lambda_hits_model, 36 context_score,
  // 37..40 = 🧪 one-sided-shrink shadow (p_over/p_under/best_side/best_ev).
  const AUDIT_COLS = 6;
  let sh = ss.getSheetByName(MLB_BATTER_HITS_SIM_TAB);
  if (sh) {
    const cr = Math.max(sh.getLastRow(), 3);
    const cc = Math.max(sh.getLastColumn(), NEED_COLS + AUDIT_COLS);
    try {
      sh.getRange(1, 1, cr, cc).breakApart();
    } catch (e) {}
    sh.clearContents();
    sh.clearFormats();
  } else {
    sh = ss.insertSheet(MLB_BATTER_HITS_SIM_TAB);
  }
  if (sh.getMaxColumns() < NEED_COLS + AUDIT_COLS) {
    sh.insertColumnsAfter(sh.getMaxColumns(), NEED_COLS + AUDIT_COLS - sh.getMaxColumns());
  }
  sh.setTabColor('#2e7d32');

  sh.getRange(1, 1, 1, NEED_COLS)
    .merge()
    .setValue(
      '⚡ Sim_Batter_Hits — anchored h.v2-full (ANCHOR_WEIGHT_BATTER_HITS); 🃏 H rows use this tab. Cols 35..36 = model λ + context audit; 37..40 = 🧪 one-sided-shrink shadow (audit only).'
    )
    .setFontWeight('bold')
    .setBackground('#1b5e20')
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center')
    .setWrap(true);
  sh.setRowHeight(1, 36);

  const headers = [
    'gamePk',
    'matchup',
    'batter',
    'fd_hits_line',
    'fd_over',
    'fd_under',
    'lambda_H_anchored',
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
    'base_lambda',
    'park_mult',
    'opp_sp_mult',
    'hand_mult',
    'ab_mult',
    'h_per_pa_vs_hand',
    'h_per_pa_szn',
    'est_pa',
    'vs_hand_sample_pa',
    'opp_sp_name',
    'opp_sp_throws',
    'opp_sp_h9',
    'opp_sp_ip',
    'model_tag',
    'hp_umpire',
    'hot_cold',
  ];
  sh.getRange(3, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight('bold')
    .setBackground('#388e3c')
    .setFontColor('#ffffff');

  if (out.length) {
    sh.getRange(4, 1, out.length, NEED_COLS).setValues(
      out.map(function (row) {
        return row.slice(0, NEED_COLS);
      })
    );
    try {
      ss.setNamedRange('MLB_BATTER_HITS_SIM', sh.getRange(4, 1, out.length, NEED_COLS));
    } catch (e) {}
    sh.getRange(3, NEED_COLS + 1, 1, AUDIT_COLS)
      .setValues([[
        'lambda_hits_model',
        'context_score',
        'p_over_1side',
        'p_under_1side',
        'best_side_1side',
        'best_ev_1side',
      ]])
      .setFontWeight('bold')
      .setBackground('#388e3c')
      .setFontColor('#ffffff');
    sh.getRange(4, NEED_COLS + 1, out.length, AUDIT_COLS).setValues(audit);
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
  sh.getRange(1, 1).setValue('⚡ Sim_Batter_Hits — run 🧪 Batter_Hits_Card_v2-full first');
}
