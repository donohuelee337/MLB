// ============================================================
// 🎨 MLB Promo sheet formatting — rendering only, insulated from model logic
// ============================================================
// Mirrors the 🃏 MLB_Bet_Card palette in MLBBetCardFormatting.js so promo
// tabs (Streak / HR / GS) share the same Inter + heat-map visual language.
// Model refresh files write data only; call the mlbApply*PromoFormatting_
// helpers here after setValues.
// ============================================================

/**
 * Title bar (row 1) — italic Inter on white, navy underline.
 */
function mlbPromoApplyTitleBar_(sh, ncol, title) {
  sh.getRange(1, 1, 1, ncol)
    .merge()
    .setValue(title)
    .setFontFamily(MLB_BC_TITLE_FONT)
    .setFontSize(11)
    .setFontStyle('italic')
    .setFontWeight('normal')
    .setBackground(MLB_BC_PAPER)
    .setFontColor(MLB_BC_INK)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setWrap(true);
  sh.setRowHeight(1, 26);
  sh.getRange(1, 1, 1, ncol)
    .setBorder(null, null, true, null, null, null, MLB_BC_INK, SpreadsheetApp.BorderStyle.SOLID);
}

/**
 * Header row (row 3) — small Inter on black.
 */
function mlbPromoApplyHeaderRow_(sh, ncol) {
  sh.getRange(3, 1, 1, ncol)
    .setFontFamily(MLB_BC_BODY_FONT)
    .setFontSize(9)
    .setFontWeight('normal')
    .setBackground(MLB_BC_HEADER_BG)
    .setFontColor(MLB_BC_HEADER_TEXT)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  sh.setRowHeight(3, 22);
  sh.setFrozenRows(3);
}

/**
 * Base body styling — hairline grid on ivory.
 */
function mlbPromoApplyBodyBase_(sh, nRows, ncol) {
  if (!nRows) return;
  const body = sh.getRange(4, 1, nRows, ncol);
  body.setFontFamily(MLB_BC_BODY_FONT)
    .setFontSize(10)
    .setFontWeight('normal')
    .setFontColor(MLB_BC_INK)
    .setBackground(MLB_BC_PAPER)
    .setVerticalAlignment('middle')
    .setBorder(true, true, true, true, true, true, MLB_BC_RULE, SpreadsheetApp.BorderStyle.SOLID);
  sh.setRowHeights(4, nRows, 21);

  let bandToggle = false;
  for (let i = 0; i < nRows; i++) {
    if (bandToggle) sh.getRange(4 + i, 1, 1, ncol).setBackground(MLB_BC_PAPER_ALT);
    bandToggle = !bandToggle;
  }
}

/**
 * Heat-map a probability column. Values in [0,1]; when all values are tiny
 * (GS promo), normalize against the column max so top rows still read green.
 */
function mlbPromoApplyProbHeat_(sh, startRow, nRows, col, values, fgOverride) {
  if (!nRows || !values || !values.length) return;
  let maxV = 0;
  for (let i = 0; i < values.length; i++) {
    const v = parseFloat(String(values[i]));
    if (!isNaN(v) && v > maxV) maxV = v;
  }
  const relative = maxV > 0 && maxV < 0.01;
  for (let i = 0; i < nRows; i++) {
    const raw = parseFloat(String(values[i]));
    if (isNaN(raw)) continue;
    const t = relative ? (maxV > 0 ? raw / maxV : 0) : raw;
    const heat = mlbBcHeat_(t);
    sh.getRange(startRow + i, col)
      .setBackground(heat.bg)
      .setFontColor(fgOverride != null ? fgOverride : heat.fg)
      .setFontWeight('bold');
  }
}

/** Yellow pick highlight — same as 🃏 Streak picks on the bet card. */
function mlbPromoHighlightCells_(sh, sheetRow, cols, noteCol, pickFg) {
  const pickBg = '#fde047';
  const fg = pickFg != null ? pickFg : '#7c2d12';
  cols.forEach(function (c) {
    sh.getRange(sheetRow, c)
      .setBackground(pickBg)
      .setFontColor(fg)
      .setFontWeight('bold');
  });
  if (noteCol) {
    const cell = sh.getRange(sheetRow, noteCol);
    if (!cell.getNote()) cell.setNote('');
  }
}

function mlbPromoHighlightPickRow_(sh, sheetRow, cols, noteText, noteCol, pickFg) {
  mlbPromoHighlightCells_(sh, sheetRow, cols, noteCol, pickFg);
  if (noteText && noteCol) sh.getRange(sheetRow, noteCol).setNote(noteText);
}

/**
 * Orange (HOT) / blue (COLD) medium border on the batter-name cell — same as
 * 🃏 MLB_Bet_Card. Applied last so body hairlines don't overwrite it.
 * @param {number} nameCol — 1-based batter name column
 * @param {number} batterIdCol — 1-based batter_id column
 * @param {number} [season]
 * @param {string[]} [hotColdFlags] optional per-row flags (parallel to rows)
 */
function mlbPromoApplyHotColdNameBorders_(sh, startRow, rows, nameCol, batterIdCol, season, hotColdFlags) {
  if (!sh || !rows || !rows.length) return;
  let yr = season;
  if (!yr) {
    try {
      yr = mlbSlateSeasonYear_(getConfig());
    } catch (e) {
      return;
    }
  }
  let hotColdMap = null;
  try {
    hotColdMap = mlbBuildBatterHotColdMap_(sh.getParent());
  } catch (e) {
    hotColdMap = {};
  }
  const hotStyle = SpreadsheetApp.BorderStyle.SOLID_MEDIUM;
  const idIdx = batterIdCol - 1;
  for (let i = 0; i < rows.length; i++) {
    const batterId = rows[i][idIdx];
    const idKey = String(parseInt(batterId, 10) || '');
    if (!idKey && !(hotColdFlags && hotColdFlags[i])) continue;
    let f = hotColdFlags && hotColdFlags[i] != null ? String(hotColdFlags[i]).trim().toUpperCase() : '';
    if (!f && typeof mlbBatterHitsHotColdFlag_ === 'function') {
      f = String(mlbBatterHitsHotColdFlag_(batterId, yr, hotColdMap) || '').toUpperCase();
    }
    if (f !== 'HOT' && f !== 'COLD') continue;
    const color = f === 'HOT' ? MLB_HOT_BORDER_COLOR : MLB_COLD_BORDER_COLOR;
    sh.getRange(startRow + i, nameCol).setBorder(
      true, true, true, true, false, false, color, hotStyle
    );
  }
}

/**
 * 🔥 Streak_Picks — heat on p_hit_v2 + p_streak; yellow on is_pick rows.
 * @param {Array[]} rows — grid written at row 4 (same shape as setValues)
 * @param {string[]} [hotColdFlags] optional per-row HOT/COLD from v2 card
 */
function mlbApplyStreakPromoFormatting_(sh, rows, headers, slateDate, hotColdFlags) {
  const ncol = headers.length;
  mlbPromoApplyTitleBar_(
    sh,
    ncol,
    'Streak Picks · ' + slateDate + ' · p_streak = p_hit_v2 × K/9 × bullpen × dead-PA · LOW = below STREAK_MIN_PA (no pick)'
  );
  mlbPromoApplyHeaderRow_(sh, ncol);

  if (!rows || !rows.length) return;
  if (typeof mlbApplyPropCardFormatting_ === 'function') {
    mlbApplyPropCardFormatting_(sh, rows, headers, {
      hotColdFlags: hotColdFlags,
      startRow: 4,
      headerRow: 3,
      skipHeaderNotes: true,
      cols: { player: 'batter', team: 'bat_team', proj: 'p_streak', batterId: 'batter_id' },
    });
  } else {
    mlbPromoApplyBodyBase_(sh, rows.length, ncol);
  }

  const cHit = typeof mlbPropCol_ === 'function' ? mlbPropCol_(headers, 'p_hit_v2') : 6;
  const cStreak = typeof mlbPropCol_ === 'function' ? mlbPropCol_(headers, 'p_streak') : 22;
  const cRank = typeof mlbPropCol_ === 'function' ? mlbPropCol_(headers, 'pick_rank') : 23;
  const cIsPick = typeof mlbPropCol_ === 'function' ? mlbPropCol_(headers, 'is_pick') : 24;
  const cBat = typeof mlbPropCol_ === 'function' ? mlbPropCol_(headers, 'batter') : 3;
  const cLowPa = typeof mlbPropCol_ === 'function' ? mlbPropCol_(headers, 'low_sample_pa') : 10;
  const cSeasonPa = typeof mlbPropCol_ === 'function' ? mlbPropCol_(headers, 'season_pa') : 8;
  const cSeasonAb = typeof mlbPropCol_ === 'function' ? mlbPropCol_(headers, 'season_ab') : 9;

  sh.getRange(4, cHit, rows.length, 1).setNumberFormat('0.0%').setFontFamily(MLB_BC_NUM_FONT).setFontSize(9.5);
  sh.getRange(4, cStreak, rows.length, 1).setNumberFormat('0.0%').setFontFamily(MLB_BC_NUM_FONT).setFontSize(9.5);
  const cBabip = typeof mlbPropCol_ === 'function' ? mlbPropCol_(headers, 'season_babip') : 7;
  [cSeasonPa, cSeasonAb, 12, 13, 14, 15, 17, 18, 19, 20, 21].forEach(function (c) {
    sh.getRange(4, c, rows.length, 1).setFontFamily(MLB_BC_NUM_FONT).setFontSize(9.5);
  });
  sh.getRange(4, cBabip, rows.length, 1).setNumberFormat('0.000').setFontFamily(MLB_BC_NUM_FONT).setFontSize(9.5);
  sh.getRange(4, 1, rows.length, 1).setFontColor(MLB_BC_INK).setFontFamily(MLB_BC_NUM_FONT).setFontSize(9);
  mlbPromoApplyProbHeat_(sh, 4, rows.length, cHit, rows.map(function (r) { return r[cHit - 1]; }), MLB_BC_INK);
  mlbPromoApplyProbHeat_(sh, 4, rows.length, cStreak, rows.map(function (r) { return r[cStreak - 1]; }), MLB_BC_INK);

  if (cLowPa > 0) {
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][cLowPa - 1] || '').toUpperCase() !== 'LOW') continue;
      sh.getRange(4 + i, cLowPa, 1, 1)
        .setBackground('#ffebee')
        .setFontColor('#b71c1c')
        .setFontWeight('bold');
      if (cSeasonPa > 0) {
        sh.getRange(4 + i, cSeasonPa, 1, 1).setBackground('#fff3e0').setFontColor('#e65100');
      }
      if (cSeasonAb > 0) {
        sh.getRange(4 + i, cSeasonAb, 1, 1).setBackground('#fff3e0').setFontColor('#e65100');
      }
    }
  }

  for (let i = 0; i < rows.length; i++) {
    if (rows[i][cIsPick - 1] !== true && String(rows[i][cIsPick - 1]).toUpperCase() !== 'TRUE') continue;
    const rank = parseInt(rows[i][cRank - 1], 10) || 0;
    const pStreak = parseFloat(rows[i][cStreak - 1]);
    const label = !isNaN(pStreak)
      ? 'P(≥1 hit) ' + (pStreak * 100).toFixed(1) + '%'
      : 'streak pick';
    mlbPromoHighlightPickRow_(
      sh,
      4 + i,
      [cBat, cStreak],
      '🔥 MLB The Streak — Pick #' + rank + ' · ' + label,
      cBat,
      MLB_BC_INK
    );
  }

}

/**
 * 📣 Batter_HR_Promo — heat on p_poisson + p_calibrated; yellow top pick.
 */
function mlbApplyHrPromoFormatting_(sh, rows, headers, slateDate, topPick, hotColdFlags) {
  const ncol = headers.length;
  mlbPromoApplyTitleBar_(
    sh,
    ncol,
    'HR Promo · ' + slateDate + ' · lineup λ × park_HR × SP · Poisson + optional Platt'
  );
  mlbPromoApplyHeaderRow_(sh, ncol);

  if (!rows || !rows.length) return;
  if (typeof mlbApplyPropCardFormatting_ === 'function') {
    mlbApplyPropCardFormatting_(sh, rows, headers, {
      hotColdFlags: hotColdFlags,
      startRow: 4,
      headerRow: 3,
      skipHeaderNotes: true,
      cols: { player: 'batter', team: 'team', proj: ['λ_raw', 'p_calibrated'], batterId: 'batterId' },
    });
  } else {
    mlbPromoApplyBodyBase_(sh, rows.length, ncol);
  }

  sh.getRange(4, 7, rows.length, 1).setNumberFormat('0.0000');
  sh.getRange(4, 8, rows.length, 2).setNumberFormat('0.0%');
  [15, 16, 17].forEach(function (c) {
    sh.getRange(4, c, rows.length, 1).setNumberFormat('0.000').setFontFamily(MLB_BC_NUM_FONT).setFontSize(9.5);
  });
  sh.getRange(4, 2, rows.length, 1).setFontColor(MLB_BC_INK_SOFT).setFontFamily(MLB_BC_NUM_FONT).setFontSize(9);
  sh.getRange(4, 5, rows.length, 1).setFontColor(MLB_BC_INK_SOFT).setFontFamily(MLB_BC_NUM_FONT).setFontSize(9);

  const cPois = typeof mlbPropCol_ === 'function' ? mlbPropCol_(headers, 'p_poisson') : 8;
  const cCal = typeof mlbPropCol_ === 'function' ? mlbPropCol_(headers, 'p_calibrated') : 9;
  mlbPromoApplyProbHeat_(sh, 4, rows.length, cPois, rows.map(function (r) { return r[cPois - 1]; }));
  mlbPromoApplyProbHeat_(sh, 4, rows.length, cCal, rows.map(function (r) { return r[cCal - 1]; }));

  if (topPick) {
    const noteText =
      '🔥 Best HR matchup of the slate · ' + topPick.batter +
      ' vs SP id ' + (topPick.opponentSpId || '?') +
      ' · p_calibrated=' + (Math.round(topPick.pCalibrated * 1000) / 10) + '%' +
      ' · pitcher_mult=' + (Math.round(topPick.pitcherMult * 1000) / 1000) +
      ' · park_mult=' + (Math.round(topPick.parkMult * 1000) / 1000);
    const cBat = typeof mlbPropCol_ === 'function' ? mlbPropCol_(headers, 'batter') : 4;
    mlbPromoHighlightPickRow_(sh, 4, [cBat, cCal, 16], noteText, cBat);
  }
}

/**
 * 📣 Batter_GS_Promo — heat on p_poisson + p_calibrated; yellow same-team trio.
 */
function mlbApplyGsPromoFormatting_(sh, rows, headers, slateDate, trioMeta, hotColdFlags) {
  const ncol = headers.length;
  mlbPromoApplyTitleBar_(
    sh,
    ncol,
    'Grand Slam Promo · ' + slateDate + ' · λ_GS = λ_HR × GS/HR × order weight · illustrative P(≥1)'
  );
  mlbPromoApplyHeaderRow_(sh, ncol);

  if (!rows || !rows.length) return;
  if (typeof mlbApplyPropCardFormatting_ === 'function') {
    mlbApplyPropCardFormatting_(sh, rows, headers, {
      hotColdFlags: hotColdFlags,
      startRow: 4,
      headerRow: 3,
      skipHeaderNotes: true,
      cols: { player: 'batter', team: 'team', proj: 'λ_GS', batterId: 'batterId' },
    });
  } else {
    mlbPromoApplyBodyBase_(sh, rows.length, ncol);
  }

  sh.getRange(4, 7, rows.length, 2).setNumberFormat('0.0000');
  sh.getRange(4, 9, rows.length, 2).setNumberFormat('0.0000%');
  sh.getRange(4, 22, rows.length, 1).setNumberFormat('0.0000');
  sh.getRange(4, 2, rows.length, 1).setFontColor(MLB_BC_INK_SOFT).setFontFamily(MLB_BC_NUM_FONT).setFontSize(9);
  sh.getRange(4, 5, rows.length, 1).setFontColor(MLB_BC_INK_SOFT).setFontFamily(MLB_BC_NUM_FONT).setFontSize(9);

  mlbPromoApplyProbHeat_(sh, 4, rows.length, 9, rows.map(function (r) { return r[8]; }));
  mlbPromoApplyProbHeat_(sh, 4, rows.length, 10, rows.map(function (r) { return r[9]; }));

  if (trioMeta && trioMeta.rowIdxs && trioMeta.rowIdxs.length) {
    const teamsLabel = (trioMeta.teams && trioMeta.teams.length)
      ? trioMeta.teams.join('/')
      : (trioMeta.team || '');
    const anchorRow = trioMeta.anchorRow || {};
    const noteText =
      '💎 GS Promo trio · ' + teamsLabel +
      ' · pick ANY 3 batters across the slate — these are the top ' +
      trioMeta.rowIdxs.length + ' by P(GS) (mixed teams OK).' +
      ' Lead bat: ' + (anchorRow.batter || '') + '.';
    trioMeta.rowIdxs.forEach(function (rowIdx, pos) {
      mlbPromoHighlightPickRow_(
        sh,
        4 + rowIdx,
        [4, 6],
        pos === 0 ? noteText : '',
        4
      );
    });
  }

  mlbPromoApplyHotColdNameBorders_(sh, 4, rows, 4, 5, null, hotColdFlags);
}
