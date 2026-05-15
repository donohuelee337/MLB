// ============================================================
// 🎨 MLB Bet Card formatting — rendering only, insulated from model logic
// ============================================================
// All visual styling for 🃏 MLB_Bet_Card lives here so model rollbacks
// don't take the formatting with them. Aesthetic = Topps card-back /
// MLB The Show overlay: ivory paper, navy ink, monospace numbers,
// subtle alternating row bands within each game group.
//
// Public functions:
//   mlbGradePlay_(ev, american)               → 'A+' | 'A' | 'B+' | 'B' | 'C' | ''
//   mlbKellyStake_(p, american, bk, frac)     → integer $ (fractional Kelly)
//   mlbScheduleGameTimeIndex_(ss)             → { gamePk: { iso, hhmm } }
//   mlbApplyBetCardFormatting_(sh, n, ncol)   → applies all visual styling
//   mlbAppendBetTrackerSection_(ss, sh, r, d) → appends results panel below card
// ============================================================

// ---- palette -------------------------------------------------------------
const MLB_BC_PAPER       = '#faf7f0';   // ivory body
const MLB_BC_PAPER_ALT   = '#f4efe2';   // alt-row band
const MLB_BC_INK         = '#1a2332';   // navy text + dividers
const MLB_BC_INK_SOFT    = '#56627a';   // de-emphasized cells
const MLB_BC_RULE        = '#d4cdb8';   // hairline borders
const MLB_BC_HEADER_BG   = '#1a2332';
const MLB_BC_HEADER_TEXT = '#faf7f0';
const MLB_BC_BODY_FONT   = 'Source Sans Pro';
const MLB_BC_NUM_FONT    = 'Roboto Mono';
const MLB_BC_TITLE_FONT  = 'Playfair Display';

// ---- grade rubric --------------------------------------------------------
/**
 * Rubric favors small +EV bites at low variance over speculative +odds.
 *  A+ : EV ≥ 0.05 AND odds ≤ +130   (high edge, low variance — bypass card caps)
 *  A  : EV ≥ 0.04 AND odds ≤ +180
 *  B+ : EV ≥ 0.025
 *  B  : EV ≥ 0.015
 *  C  : EV > 0
 */
function mlbGradePlay_(ev, american) {
  const e = parseFloat(String(ev));
  const o = parseFloat(String(american));
  if (isNaN(e) || e <= 0) return '';
  if (isNaN(o)) return '';
  if (e >= 0.05  && o <= 130) return 'A+';
  if (e >= 0.04  && o <= 180) return 'A';
  if (e >= 0.025)             return 'B+';
  if (e >= 0.015)             return 'B';
  return 'C';
}

/**
 * Fractional-Kelly stake in dollars at this American price for the model
 * probability. f* = (p*b - q)/b where b = decimal-odds-minus-one.
 * Returns 0 if EV <= 0; '' if inputs invalid.
 */
function mlbKellyStake_(p, american, bankroll, fraction) {
  const pn = parseFloat(String(p));
  const o  = parseFloat(String(american));
  const bk = parseFloat(String(bankroll));
  const fr = parseFloat(String(fraction));
  if (isNaN(pn) || isNaN(o) || isNaN(bk) || bk <= 0) return '';
  const frac = !isNaN(fr) && fr > 0 ? Math.min(1, fr) : 0.25;
  const b = o > 0 ? o / 100 : 100 / Math.abs(o);
  if (b <= 0) return '';
  const q = 1 - pn;
  const fStar = (pn * b - q) / b;
  if (!isFinite(fStar) || fStar <= 0) return 0;
  return Math.round(bk * frac * fStar);
}

/** gamePk → { iso, hhmm } map from the 📅 MLB_Schedule tab (gameDateRaw at col 3). */
function mlbScheduleGameTimeIndex_(ss) {
  const idx = {};
  const sh = ss.getSheetByName(MLB_SCHEDULE_TAB);
  if (!sh || sh.getLastRow() < 4) return idx;
  const tz = Session.getScriptTimeZone();
  const block = sh.getRange(4, 1, sh.getLastRow(), 3).getValues();
  for (let i = 0; i < block.length; i++) {
    const g   = parseInt(block[i][0], 10);
    const iso = String(block[i][2] || '').trim();
    if (!g || !iso) continue;
    let hhmm = '';
    try { hhmm = Utilities.formatDate(new Date(iso), tz, 'h:mm a'); } catch (e) {}
    idx[g] = { iso: iso, hhmm: hhmm };
  }
  return idx;
}

/**
 * Apply Topps card-back styling to 🃏 MLB_Bet_Card.
 * Expects the sheet to already have:
 *   row 1: empty (will be merged title bar)
 *   row 3: header row written
 *   rows 4..(3+n): data rows already written, 0-indexed column layout below
 *     0:date 1:# 2:grade 3:gamePk 4:matchup 5:play 6:player 7:market
 *     8:side 9:line 10:odds 11:model% 12:book% 13:ev 14:kelly$
 *     15:proj 16:proj−line 17:flags 18:player_id 19:time
 */
function mlbApplyBetCardFormatting_(sh, rows, headers, slateDate) {
  const ncol = headers.length;

  // Column widths
  [76, 36, 42, 64, 168, 280, 130, 96, 46, 44, 56, 60, 60, 64, 56, 50, 60, 130, 64, 56]
    .forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });

  // Title bar (row 1) — italic serif on ivory, navy underline
  sh.getRange(1, 1, 1, ncol)
    .merge()
    .setValue(
      'MLB Card · ' + slateDate + ' · sorted by game time, EV within game · A+ plays bypass caps'
    )
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

  // Header row (3) — small sans on navy
  sh.getRange(3, 1, 1, ncol)
    .setFontFamily(MLB_BC_BODY_FONT)
    .setFontSize(9)
    .setFontWeight('normal')
    .setBackground(MLB_BC_HEADER_BG)
    .setFontColor(MLB_BC_HEADER_TEXT)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  sh.setRowHeight(3, 22);

  if (!rows || rows.length === 0) return;

  // Body styling — clean sans on ivory, hairline rules
  const body = sh.getRange(4, 1, rows.length, ncol);
  body.setFontFamily(MLB_BC_BODY_FONT)
      .setFontSize(10)
      .setFontWeight('normal')
      .setFontColor(MLB_BC_INK)
      .setBackground(MLB_BC_PAPER)
      .setVerticalAlignment('middle')
      .setBorder(true, true, true, true, true, true, MLB_BC_RULE, SpreadsheetApp.BorderStyle.SOLID);
  sh.setRowHeights(4, rows.length, 21);

  // Tabular monospace on numeric columns (1-indexed: line, odds, model%, book%, ev, kelly, proj, proj−line)
  const numCols = [10, 11, 12, 13, 14, 15, 16, 17];
  numCols.forEach(function (c) {
    sh.getRange(4, c, rows.length, 1).setFontFamily(MLB_BC_NUM_FONT).setFontSize(9.5);
  });

  // Number formats
  sh.getRange(4, 10, rows.length, 1).setNumberFormat('0.0').setHorizontalAlignment('right');       // line
  sh.getRange(4, 11, rows.length, 1).setNumberFormat('+0;-0').setHorizontalAlignment('right');     // odds
  sh.getRange(4, 12, rows.length, 1).setNumberFormat('0.0%').setHorizontalAlignment('right');      // model %
  sh.getRange(4, 13, rows.length, 1).setNumberFormat('0.0%').setHorizontalAlignment('right');      // book %
  sh.getRange(4, 14, rows.length, 1).setNumberFormat('+0.000;-0.000').setHorizontalAlignment('right'); // ev
  sh.getRange(4, 15, rows.length, 1).setNumberFormat('$0').setHorizontalAlignment('right');        // kelly
  sh.getRange(4, 16, rows.length, 1).setNumberFormat('0.00').setHorizontalAlignment('right');      // proj
  sh.getRange(4, 17, rows.length, 1).setNumberFormat('+0.00;-0.00').setHorizontalAlignment('right'); // proj−line
  sh.getRange(4,  9, rows.length, 1).setHorizontalAlignment('center');                              // side

  // Subtle alternating row band within each game group (col index 3 = gamePk)
  let bandToggle = false;
  let prevPkBand = String(rows[0][3] || '');
  for (let i = 0; i < rows.length; i++) {
    const pk = String(rows[i][3] || '');
    if (pk !== prevPkBand) { bandToggle = false; prevPkBand = pk; }
    if (bandToggle) sh.getRange(4 + i, 1, 1, ncol).setBackground(MLB_BC_PAPER_ALT);
    bandToggle = !bandToggle;
  }

  // Grade cell colors (col 3, 1-indexed)
  const gradeBg = {
    'A+': '#5d8a3a',
    'A':  '#9bb56b',
    'B+': '#e6c955',
    'B':  '#d99a4a',
    'C':  '#c47670',
  };
  for (let i = 0; i < rows.length; i++) {
    const g  = String(rows[i][2] || '');
    const bg = gradeBg[g];
    if (bg) {
      sh.getRange(4 + i, 3)
        .setBackground(bg)
        .setFontFamily(MLB_BC_BODY_FONT)
        .setFontWeight('bold')
        .setFontColor(g === 'A+' || g === 'C' ? MLB_BC_PAPER : MLB_BC_INK)
        .setHorizontalAlignment('center');
    }
  }

  // Model % color cue — green when clearly above coin-flip, amber in coin-flip zone
  for (let i = 0; i < rows.length; i++) {
    const mp = parseFloat(String(rows[i][11]));
    if (isNaN(mp)) continue;
    let color = MLB_BC_INK;
    if (mp >= 0.62)      color = '#2e6b1f';
    else if (mp >= 0.55) color = MLB_BC_INK;
    else                 color = '#b56807';   // amber — basically coin flip
    sh.getRange(4 + i, 12).setFontColor(color);
  }

  // EV color cue — green strong, slate marginal
  for (let i = 0; i < rows.length; i++) {
    const ev = parseFloat(String(rows[i][13]));
    if (isNaN(ev)) continue;
    sh.getRange(4 + i, 14).setFontColor(ev >= 0.05 ? '#2e6b1f' : ev >= 0.02 ? MLB_BC_INK : MLB_BC_INK_SOFT);
  }

  // Game dividers — hairline navy below the last row of each game group
  let prevPk = String(rows[0][3] || '');
  for (let i = 1; i < rows.length; i++) {
    const pk = String(rows[i][3] || '');
    if (pk !== prevPk) {
      sh.getRange(4 + i - 1, 1, 1, ncol)
        .setBorder(null, null, true, null, null, null, MLB_BC_INK, SpreadsheetApp.BorderStyle.SOLID);
      prevPk = pk;
    }
  }

  // De-emphasize technical columns (gamePk, player_id)
  sh.getRange(4, 4, rows.length, 1).setFontColor(MLB_BC_INK_SOFT).setFontFamily(MLB_BC_NUM_FONT).setFontSize(9);
  sh.getRange(4, 19, rows.length, 1).setFontColor(MLB_BC_INK_SOFT).setFontFamily(MLB_BC_NUM_FONT).setFontSize(9);

  // Time column — small italic serif, right-aligned
  sh.getRange(4, 20, rows.length, 1)
    .setFontFamily(MLB_BC_TITLE_FONT)
    .setFontStyle('italic')
    .setFontSize(10)
    .setHorizontalAlignment('right');
}

/**
 * Append a hit-rate-by-model-probability tracker below the main bet card.
 * Reads 📋 MLB_Results_Log, groups graded rows by market × time window × bucket,
 * and writes a small results panel using the same lineup-card palette.
 * @returns {number} next row index after the tracker
 */
function mlbAppendBetTrackerSection_(ss, sh, startRow, slateDate) {
  const log = ss.getSheetByName(MLB_RESULTS_LOG_TAB);
  if (!log || log.getLastRow() < 4) return startRow;

  const ncol = 20;  // tracker width matches bet card
  const tz = Session.getScriptTimeZone();
  const data = log.getRange(4, 1, log.getLastRow(), MLB_RESULTS_LOG_NCOL).getValues();

  const slateD = new Date(slateDate + 'T12:00:00');
  const ymd = function (offsetDays) {
    return Utilities.formatDate(new Date(slateD.getTime() + offsetDays * 86400000), tz, 'yyyy-MM-dd');
  };
  const yest  = ymd(-1);
  const cut7  = ymd(-7);
  const cut30 = ymd(-30);

  const markets = [
    { key: 'K',  label: 'STRIKEOUTS',  test: function (m) { return m.indexOf('strikeout')   !== -1; } },
    { key: 'H',  label: 'HITS',        test: function (m) { return m.indexOf('batter hit')  !== -1 && m.indexOf('shadow') === -1; } },
    { key: 'TB', label: 'TOTAL BASES', test: function (m) { return m.indexOf('total base')  !== -1; } },
  ];
  const buckets = [
    { lo: 0.50, hi: 0.60,  label: '50–60%' },
    { lo: 0.60, hi: 0.70,  label: '60–70%' },
    { lo: 0.70, hi: 0.80,  label: '70–80%' },
    { lo: 0.80, hi: 0.90,  label: '80–90%' },
    { lo: 0.90, hi: 1.001, label: '90–100%' },
  ];
  const windows = ['yesterday', 'last7', 'last30', 'lifetime'];

  // stats[marketKey][window][bucketLabel] = { w, l, p }
  const stats = {};
  markets.forEach(function (m) {
    stats[m.key] = {};
    windows.forEach(function (w) {
      stats[m.key][w] = {};
      buckets.forEach(function (b) { stats[m.key][w][b.label] = { w: 0, l: 0, p: 0 }; });
    });
  });

  data.forEach(function (row) {
    const slate = String(row[1] || '').trim();
    if (!slate || slate >= slateDate) return;
    const market = String(row[5] || '').toLowerCase();
    const result = String(row[16] || '').trim().toUpperCase();
    if (result !== 'WIN' && result !== 'LOSS' && result !== 'PUSH') return;
    const mp = parseFloat(String(row[9]));
    if (isNaN(mp) || mp < 0.5) return;

    let mKey = null;
    for (let i = 0; i < markets.length; i++) {
      if (markets[i].test(market)) { mKey = markets[i].key; break; }
    }
    if (!mKey) return;

    let bKey = null;
    for (let i = 0; i < buckets.length; i++) {
      if (mp >= buckets[i].lo && mp < buckets[i].hi) { bKey = buckets[i].label; break; }
    }
    if (!bKey) return;

    function bump(w) {
      const s = stats[mKey][w][bKey];
      if      (result === 'WIN')  s.w++;
      else if (result === 'LOSS') s.l++;
      else                        s.p++;
    }
    if (slate === yest)   bump('yesterday');
    if (slate >= cut7)    bump('last7');
    if (slate >= cut30)   bump('last30');
    bump('lifetime');
  });

  function fmtCell(s) {
    const n = s.w + s.l;
    if (n === 0) return '—';
    return s.w + '-' + s.l + '  ' + Math.round((s.w / n) * 100) + '%';
  }

  let r = startRow;

  // Title row
  sh.getRange(r, 1, 1, ncol)
    .merge()
    .setValue('Bet Tracker  ·  hit rate by model probability bucket  ·  graded slates only')
    .setFontFamily(MLB_BC_TITLE_FONT)
    .setFontSize(11)
    .setFontStyle('italic')
    .setFontColor(MLB_BC_INK)
    .setBackground(MLB_BC_PAPER)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setBorder(true, null, true, null, null, null, MLB_BC_INK, SpreadsheetApp.BorderStyle.SOLID);
  sh.setRowHeight(r, 28);
  r++;

  // Window-header row
  sh.getRange(r, 1, 1, ncol).setBackground(MLB_BC_PAPER);
  sh.getRange(r, 1, 1, 5)
    .setValues([['', 'YESTERDAY', 'LAST 7', 'LAST 30', 'LIFETIME']])
    .setFontFamily(MLB_BC_BODY_FONT)
    .setFontSize(9)
    .setFontColor(MLB_BC_INK)
    .setBackground(MLB_BC_PAPER_ALT)
    .setHorizontalAlignment('center');
  r++;

  markets.forEach(function (m) {
    // Market subtitle row
    sh.getRange(r, 1, 1, ncol).setBackground(MLB_BC_PAPER);
    sh.getRange(r, 1, 1, 5).merge()
      .setValue(m.label + '  (' + m.key + ')')
      .setFontFamily(MLB_BC_TITLE_FONT)
      .setFontSize(10)
      .setFontStyle('italic')
      .setFontColor(MLB_BC_INK)
      .setBackground(MLB_BC_PAPER)
      .setHorizontalAlignment('left')
      .setBorder(null, null, true, null, null, null, MLB_BC_RULE, SpreadsheetApp.BorderStyle.SOLID);
    sh.setRowHeight(r, 22);
    r++;

    // Bucket rows
    buckets.forEach(function (b) {
      const cells = [b.label];
      windows.forEach(function (w) { cells.push(fmtCell(stats[m.key][w][b.label])); });
      sh.getRange(r, 1, 1, ncol).setBackground(MLB_BC_PAPER);
      sh.getRange(r, 1, 1, 5)
        .setValues([cells])
        .setFontFamily(MLB_BC_BODY_FONT)
        .setFontSize(10)
        .setFontColor(MLB_BC_INK)
        .setBackground(MLB_BC_PAPER)
        .setHorizontalAlignment('center')
        .setVerticalAlignment('middle');
      sh.getRange(r, 1)
        .setFontFamily(MLB_BC_TITLE_FONT)
        .setFontStyle('italic')
        .setHorizontalAlignment('right')
        .setFontColor(MLB_BC_INK_SOFT);
      sh.getRange(r, 2, 1, 4).setFontFamily(MLB_BC_NUM_FONT).setFontSize(9.5);
      sh.setRowHeight(r, 20);
      r++;
    });

    // Spacer between markets
    sh.getRange(r, 1, 1, ncol).setBackground(MLB_BC_PAPER);
    sh.setRowHeight(r, 8);
    r++;
  });

  return r;
}
