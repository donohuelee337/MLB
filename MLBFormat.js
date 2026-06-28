// ============================================================
// 🎨 MLBFormat — shared house style for every board/card tab
// ============================================================
// ONE styling vocabulary so all tabs — current and future — look like a
// single product instead of N hand-rolled renderers. The palette mirrors
// the 🃏 bet card (MLBBetCardFormatting.js: ivory paper, black ink, Inter,
// the mlbBcHeat_ 10%-band heat map) so the card and the boards finally
// match. Every function here is PURE FORMATTING — it never reads or writes
// model values, so a model rollback can never drag the look with it.
//
// House layout contract (what every standardized tab looks like):
//   row 1            → merged title banner (mlbFmtTitle_)
//   row H (2 or 4)   → bold column headers (mlbFmtHeader_)
//   rows H+1..end    → body: Inter, hairline rules, frozen header
//
// Public API:
//   mlbFmtPalette_()                                  → frozen palette object
//   mlbFmtTitle_(sh, text, ncol, opts)               → merged banner row
//   mlbFmtHeader_(sh, rowIdx, headers, opts)         → bold header row
//   mlbFmtBody_(sh, firstRow, nRows, ncol, opts)     → font + hairlines + bands
//   mlbFmtHeatColumn_(sh, firstRow, col, nRows, opts)→ heat a probability col
//   mlbFmtFreeze_(sh, rows)                           → frozen rows
//   mlbFmtTab_(sh, spec)                              → one-call wrapper
//
// opts.accent (hex) lets a tab keep an identity color on the title/header
// (e.g. the 🎯 amber) while still using the shared structure, fonts and
// hairlines. Omit it to get the default black header.
// ============================================================

// Palette — kept byte-for-byte in sync with the MLB_BC_* constants so the
// card and the boards render identically. Mirrored (not imported) so this
// file is safe to load even if the formatting file is rolled back.
const MLB_FMT_PAPER       = '#ffffff';
const MLB_FMT_PAPER_ALT   = '#f7f7f7'; // alt-row band (subtle)
const MLB_FMT_INK         = '#000000';
const MLB_FMT_INK_SOFT    = '#6b6b6b';
const MLB_FMT_RULE        = '#e0e0e0'; // hairline borders
const MLB_FMT_HEADER_BG   = '#000000';
const MLB_FMT_HEADER_TEXT = '#ffffff';
const MLB_FMT_FONT        = 'Inter';
const MLB_FMT_TITLE_ROW_H = 32;

/** @returns {Object} frozen house palette (read-only vocabulary). */
function mlbFmtPalette_() {
  return {
    paper: MLB_FMT_PAPER,
    paperAlt: MLB_FMT_PAPER_ALT,
    ink: MLB_FMT_INK,
    inkSoft: MLB_FMT_INK_SOFT,
    rule: MLB_FMT_RULE,
    headerBg: MLB_FMT_HEADER_BG,
    headerText: MLB_FMT_HEADER_TEXT,
    font: MLB_FMT_FONT,
  };
}

/** Coerce a 1-based column count to a safe positive integer. */
function mlbFmtNCol_(ncol) {
  const n = parseInt(ncol, 10);
  return isFinite(n) && n > 0 ? n : 1;
}

/**
 * Merged title banner across row `rowIdx` (default 1).
 * @param {Sheet} sh
 * @param {string} text
 * @param {number} ncol  columns to span
 * @param {Object} [opts] { rowIdx, accent, textColor, fontSize, rowHeight }
 */
function mlbFmtTitle_(sh, text, ncol, opts) {
  const o = opts || {};
  const n = mlbFmtNCol_(ncol);
  const rowIdx = o.rowIdx || 1;
  const range = sh.getRange(rowIdx, 1, 1, n);
  try { range.breakApart(); } catch (e) {}
  range
    .merge()
    .setValue(String(text != null ? text : ''))
    .setFontFamily(MLB_FMT_FONT)
    .setFontWeight('bold')
    .setFontSize(o.fontSize || 11)
    .setBackground(o.accent || MLB_FMT_HEADER_BG)
    .setFontColor(o.textColor || MLB_FMT_HEADER_TEXT)
    .setHorizontalAlignment(o.align || 'left')
    .setVerticalAlignment('middle')
    .setWrap(true);
  try { sh.setRowHeight(rowIdx, o.rowHeight || MLB_FMT_TITLE_ROW_H); } catch (e) {}
  return range;
}

/**
 * Bold column-header row.
 * @param {Sheet} sh
 * @param {number} rowIdx
 * @param {string[]} headers
 * @param {Object} [opts] { accent, textColor, fontSize }
 */
function mlbFmtHeader_(sh, rowIdx, headers, opts) {
  const o = opts || {};
  const hdrs = headers || [];
  if (!hdrs.length) return null;
  const range = sh.getRange(rowIdx, 1, 1, hdrs.length);
  range
    .setValues([hdrs])
    .setFontFamily(MLB_FMT_FONT)
    .setFontWeight('bold')
    .setFontSize(o.fontSize || 10)
    .setBackground(o.accent || MLB_FMT_HEADER_BG)
    .setFontColor(o.textColor || MLB_FMT_HEADER_TEXT)
    .setVerticalAlignment('middle');
  return range;
}

/**
 * Body styling: Inter font, ink text, hairline grid, optional alt-row bands.
 * No-op when nRows < 1 (empty board) so callers needn't guard.
 * @param {Sheet} sh
 * @param {number} firstRow  first data row (1-based)
 * @param {number} nRows
 * @param {number} ncol
 * @param {Object} [opts] { bands, fontSize, rule }
 */
function mlbFmtBody_(sh, firstRow, nRows, ncol, opts) {
  const o = opts || {};
  const rows = parseInt(nRows, 10);
  if (!isFinite(rows) || rows < 1) return null;
  const n = mlbFmtNCol_(ncol);
  const range = sh.getRange(firstRow, 1, rows, n);
  range
    .setFontFamily(MLB_FMT_FONT)
    .setFontColor(MLB_FMT_INK)
    .setFontSize(o.fontSize || 10)
    .setVerticalAlignment('middle');
  // Hairline grid in the house rule color.
  try {
    range.setBorder(true, true, true, true, true, true, o.rule || MLB_FMT_RULE, SpreadsheetApp.BorderStyle.SOLID);
  } catch (e) {}
  // Optional subtle alternating bands (off by default; heat columns own their bg).
  if (o.bands) {
    for (let i = 1; i < rows; i += 2) {
      try { sh.getRange(firstRow + i, 1, 1, n).setBackground(MLB_FMT_PAPER_ALT); } catch (e) {}
    }
  }
  return range;
}

/**
 * Heat-map a probability/percentage column using the shared mlbBcHeat_ bands.
 * Reads each cell (expects 0..1, or 0..100 with pct=true) and recolors bg/fg.
 * Silent no-op if mlbBcHeat_ isn't loaded (formatting file rolled back).
 * @param {Sheet} sh
 * @param {number} firstRow
 * @param {number} col       1-based column to color
 * @param {number} nRows
 * @param {Object} [opts] { pct } pct=true → values are 0..100
 */
function mlbFmtHeatColumn_(sh, firstRow, col, nRows, opts) {
  const o = opts || {};
  const rows = parseInt(nRows, 10);
  if (!isFinite(rows) || rows < 1) return;
  if (typeof mlbBcHeat_ !== 'function') return;
  const vals = sh.getRange(firstRow, col, rows, 1).getValues();
  for (let i = 0; i < rows; i++) {
    let v = parseFloat(String(vals[i][0]));
    if (!isFinite(v)) continue;
    if (o.pct) v = v / 100;
    const heat = mlbBcHeat_(v);
    if (!heat) continue;
    try {
      sh.getRange(firstRow + i, col, 1, 1)
        .setBackground(heat.bg)
        .setFontColor(heat.fg)
        .setFontFamily(MLB_FMT_FONT);
    } catch (e) {}
  }
}

/** Freeze the first `rows` rows (header protection). */
function mlbFmtFreeze_(sh, rows) {
  const r = parseInt(rows, 10);
  if (isFinite(r) && r >= 0) {
    try { sh.setFrozenRows(r); } catch (e) {}
  }
}

/**
 * One-call convenience wrapper for the common board layout.
 * @param {Sheet} sh
 * @param {Object} spec {
 *   ncol, title, titleOpts,
 *   headerRow, headers, headerOpts,
 *   firstDataRow, nRows, bodyOpts,
 *   heatCols: [ {col, pct} ],
 *   freezeRows
 * }
 */
function mlbFmtTab_(sh, spec) {
  const s = spec || {};
  const ncol = mlbFmtNCol_(s.ncol);
  if (s.title != null) mlbFmtTitle_(sh, s.title, ncol, s.titleOpts);
  if (s.headers && s.headers.length) {
    mlbFmtHeader_(sh, s.headerRow || (s.title != null ? 2 : 1), s.headers, s.headerOpts);
  }
  if (s.firstDataRow && s.nRows) {
    mlbFmtBody_(sh, s.firstDataRow, s.nRows, ncol, s.bodyOpts);
    if (s.heatCols && s.heatCols.length) {
      s.heatCols.forEach(function (h) {
        if (h && h.col) mlbFmtHeatColumn_(sh, s.firstDataRow, h.col, s.nRows, { pct: !!h.pct });
      });
    }
  }
  if (s.freezeRows != null) mlbFmtFreeze_(sh, s.freezeRows);
}

/**
 * Self-test (no Sheet I/O): palette wiring + heat passthrough.
 * @returns {string}
 */
function mlbFmtSelfTest_() {
  const p = mlbFmtPalette_();
  if (p.font !== 'Inter' || p.ink !== '#000000') throw new Error('palette wiring');
  if (mlbFmtNCol_('x') !== 1 || mlbFmtNCol_(14) !== 14) throw new Error('ncol coerce');
  const heatOk = typeof mlbBcHeat_ === 'function'
    ? (!!mlbBcHeat_(0.9) && !!mlbBcHeat_(0.1)) : 'mlbBcHeat_ not loaded';
  return 'OK palette=Inter heat=' + heatOk;
}
