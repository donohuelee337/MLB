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

// ---- palette (black & white base; data cells keep heat-map colors) ------
const MLB_BC_PAPER       = '#ffffff';   // body background
const MLB_BC_PAPER_ALT   = '#f5f5f5';   // alt-row band (rarely used now)
const MLB_BC_INK         = '#000000';   // primary text + dividers
const MLB_BC_INK_SOFT    = '#6b6b6b';   // de-emphasized cells
const MLB_BC_RULE        = '#e0e0e0';   // hairline borders
const MLB_BC_HEADER_BG   = '#000000';
const MLB_BC_HEADER_TEXT = '#ffffff';
// One font everywhere — Inter matches Claude's UI typeface and is in Google Fonts.
const MLB_BC_BODY_FONT   = 'Inter';
const MLB_BC_NUM_FONT    = 'Inter';
const MLB_BC_TITLE_FONT  = 'Inter';

// ---- heat-map palette (10% bands, no neutral) ---------------------------
// <60% → red, darker toward 0; ≥60% → green, darker toward 100.
function _bcHeat_(pct) {
  if (pct == null || isNaN(pct)) return { bg: '#ffffff', fg: MLB_BC_INK };
  const p = Math.max(0, Math.min(1, pct));
  const band = Math.min(9, Math.floor(p * 10));
  const table = [
    { bg: '#7f1d1d', fg: '#ffffff' },  // 0–9
    { bg: '#991b1b', fg: '#ffffff' },  // 10–19
    { bg: '#b91c1c', fg: '#ffffff' },  // 20–29
    { bg: '#dc2626', fg: '#ffffff' },  // 30–39
    { bg: '#ef4444', fg: '#ffffff' },  // 40–49
    { bg: '#f87171', fg: '#ffffff' },  // 50–59
    { bg: '#86efac', fg: MLB_BC_INK }, // 60–69
    { bg: '#4ade80', fg: MLB_BC_INK }, // 70–79
    { bg: '#22c55e', fg: '#ffffff' },  // 80–89
    { bg: '#15803d', fg: '#ffffff' },  // 90–100
  ];
  return table[band];
}

/** Normalize slate value (Date or string) to 'yyyy-MM-dd'; '' if blank. */
function _bcNormSlate_(v, tz) {
  if (v == null || v === '') return '';
  if (v instanceof Date) {
    try { return Utilities.formatDate(v, tz || Session.getScriptTimeZone(), 'yyyy-MM-dd'); } catch (e) { return ''; }
  }
  return String(v).trim();
}

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
 * American odds → profit-per-$1 (decimal odds minus 1). +100 → 1, -110 → 0.909.
 */
function mlbAmericanToB_(american) {
  const o = parseFloat(String(american));
  if (isNaN(o) || o === 0) return NaN;
  return o > 0 ? o / 100 : 100 / Math.abs(o);
}

/**
 * Raw fractional-Kelly fraction of bankroll for (p, american, fraction).
 * Returns 0 when no edge / inputs bad. Output range [0..1].
 */
function mlbKellyFraction_(p, american, fraction) {
  const pn = parseFloat(String(p));
  const b  = mlbAmericanToB_(american);
  const fr = parseFloat(String(fraction));
  if (isNaN(pn) || isNaN(b) || b <= 0) return 0;
  const frac = !isNaN(fr) && fr > 0 ? Math.min(1, fr) : 0.25;
  const q = 1 - pn;
  const fStar = (pn * b - q) / b;
  if (!isFinite(fStar) || fStar <= 0) return 0;
  return frac * fStar;
}

/**
 * Read tier-staking config with sane defaults. Pulled once per card build.
 * Falls back to a $2.50/$5/$7.50 ladder anchored at 0.5/1.0/1.5% of bankroll.
 */
function mlbStakeTiersFromConfig_(cfg) {
  function num(k, dflt) {
    const v = parseFloat(String(cfg && cfg[k] != null ? cfg[k] : '').trim(), 10);
    return isNaN(v) ? dflt : v;
  }
  return {
    bankroll: num('BANKROLL', 500),
    kellyFraction: num('KELLY_FRACTION', 0.25),
    tier1Usd: num('STAKE_TIER_1_USD', 2.50),
    tier2Usd: num('STAKE_TIER_2_USD', 5.00),
    tier3Usd: num('STAKE_TIER_3_USD', 7.50),
    tier1Pct: num('STAKE_TIER_1_KELLY_PCT', 0.5) / 100,
    tier2Pct: num('STAKE_TIER_2_KELLY_PCT', 1.0) / 100,
    tier3Pct: num('STAKE_TIER_3_KELLY_PCT', 1.5) / 100,
  };
}

/**
 * Tier ladder: map Kelly-fraction-of-bankroll → {tier, stake}.
 * tier ∈ {0=skip, 1, 2, 3}; stake ∈ {0, TIER_1_USD, TIER_2_USD, TIER_3_USD}.
 */
function mlbStakeFromKellyFraction_(kellyFrac, tiers) {
  if (!isFinite(kellyFrac) || kellyFrac <= 0) return { tier: 0, stake: 0 };
  if (kellyFrac >= tiers.tier3Pct) return { tier: 3, stake: tiers.tier3Usd };
  if (kellyFrac >= tiers.tier2Pct) return { tier: 2, stake: tiers.tier2Usd };
  if (kellyFrac >= tiers.tier1Pct) return { tier: 1, stake: tiers.tier1Usd };
  return { tier: 0, stake: 0 };
}

/**
 * Tier-aware stake in $ at this American price for the model probability.
 * Kelly conviction → 1u / 2u / 3u ladder ($2.50 / $5 / $7.50 default).
 * Returns 0 if Kelly says edge is below the 1u floor.
 * Returns '' if inputs invalid (preserves blank cells on the card).
 *
 * Back-compat: 3rd/4th args accepted for legacy callers but ignored when a
 * `cfg` is passed via the 5th arg; tiers always come from Config now.
 */
function mlbKellyStake_(p, american, bankroll, fraction, cfg) {
  const pn = parseFloat(String(p));
  const o  = parseFloat(String(american));
  if (isNaN(pn) || isNaN(o)) return '';
  const tiers = mlbStakeTiersFromConfig_(cfg || getConfig());
  const frac  = mlbKellyFraction_(pn, o, tiers.kellyFraction);
  const tier  = mlbStakeFromKellyFraction_(frac, tiers);
  return tier.stake;
}

/** gamePk → { iso, hhmm } map from the 📅 MLB_Schedule tab (gameDateRaw at col 3). */
function mlbScheduleGameTimeIndex_(ss) {
  const idx = {};
  const sh = ss.getSheetByName(MLB_SCHEDULE_TAB);
  if (!sh || sh.getLastRow() < 4) return idx;
  const tz = Session.getScriptTimeZone();
  const block = sh.getRange(4, 1, Math.max(0, sh.getLastRow() - 3), 3).getValues();
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
 *     0:date 1:# 2:gamePk 3:matchup 4:play 5:player 6:market
 *     7:side 8:line 9:odds 10:model% 11:book% 12:ev 13:stake$
 *     14:proj 15:proj−line 16:flags 17:player_id 18:time
 */
function mlbApplyBetCardFormatting_(sh, rows, headers, slateDate) {
  const ncol = headers.length;

  // Column widths
  [76, 36, 64, 168, 280, 130, 96, 46, 44, 56, 60, 60, 64, 56, 50, 60, 130, 64, 56]
    .forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });

  // Title bar (row 1) — italic serif on ivory, navy underline
  sh.getRange(1, 1, 1, ncol)
    .merge()
    .setValue('MLB Card · ' + slateDate + ' · sorted by game time, EV within game')
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
  const numCols = [9, 10, 11, 12, 13, 14, 15, 16];
  numCols.forEach(function (c) {
    sh.getRange(4, c, rows.length, 1).setFontFamily(MLB_BC_NUM_FONT).setFontSize(9.5);
  });

  // Number formats
  sh.getRange(4,  9, rows.length, 1).setNumberFormat('0.0').setHorizontalAlignment('right');       // line
  sh.getRange(4, 10, rows.length, 1).setNumberFormat('+0;-0').setHorizontalAlignment('right');     // odds
  sh.getRange(4, 11, rows.length, 1).setNumberFormat('0.0%').setHorizontalAlignment('right');      // model %
  sh.getRange(4, 12, rows.length, 1).setNumberFormat('0.0%').setHorizontalAlignment('right');      // book %
  sh.getRange(4, 13, rows.length, 1).setNumberFormat('+0.000;-0.000').setHorizontalAlignment('right'); // ev
  sh.getRange(4, 14, rows.length, 1).setNumberFormat('$0.00').setHorizontalAlignment('right');    // stake (1u/2u/3u $)
  sh.getRange(4, 15, rows.length, 1).setNumberFormat('0.00').setHorizontalAlignment('right');      // proj
  sh.getRange(4, 16, rows.length, 1).setNumberFormat('+0.00;-0.00').setHorizontalAlignment('right'); // proj−line
  sh.getRange(4,  8, rows.length, 1).setHorizontalAlignment('center');                              // side

  // Spacer rows (blank gamePk + blank play) — taller white gap with no borders.
  for (let i = 0; i < rows.length; i++) {
    if (!rows[i][2] && !rows[i][4]) {
      sh.getRange(4 + i, 1, 1, ncol)
        .setBackground('#ffffff')
        .setBorder(false, false, false, false, false, false);
      sh.setRowHeight(4 + i, 14);
    }
  }

  // Subtle alternating row band within each game group (skip spacer rows).
  let bandToggle = false;
  let prevPkBand = String(rows[0][2] || '');
  for (let i = 0; i < rows.length; i++) {
    if (!rows[i][2] && !rows[i][4]) { bandToggle = false; continue; }
    const pk = String(rows[i][2] || '');
    if (pk !== prevPkBand) { bandToggle = false; prevPkBand = pk; }
    if (bandToggle) sh.getRange(4 + i, 1, 1, ncol).setBackground(MLB_BC_PAPER_ALT);
    bandToggle = !bandToggle;
  }

  // Projection-diff row tint — applied before colored cells so model%/EV
  // /proj−line cells overlay on top and aren't overridden.
  //   |proj − line| > 1   → very light green (strong projected edge)
  //   |proj − line| < 0.5 → very light red   (weak projected edge)
  for (let i = 0; i < rows.length; i++) {
    if (!rows[i][2] && !rows[i][4]) continue;  // spacer rows
    const edge = parseFloat(String(rows[i][15]));
    if (isNaN(edge)) continue;
    const a = Math.abs(edge);
    if (a > 1) {
      sh.getRange(4 + i, 1, 1, ncol).setBackground('#dcfce7');
    } else if (a < 0.5) {
      sh.getRange(4 + i, 1, 1, ncol).setBackground('#fee2e2');
    }
  }

  // Model % cell — heat-map shading (same palette the tracker uses below).
  for (let i = 0; i < rows.length; i++) {
    const mp = parseFloat(String(rows[i][10]));
    if (isNaN(mp)) continue;
    const heat = _bcHeat_(mp);
    sh.getRange(4 + i, 11).setBackground(heat.bg).setFontColor(heat.fg).setFontWeight('bold');
  }

  // EV cell — same heat scale, mapped from neg/pos EV magnitude
  for (let i = 0; i < rows.length; i++) {
    const ev = parseFloat(String(rows[i][12]));
    if (isNaN(ev)) continue;
    // Map EV [-0.05 .. +0.15] to [0 .. 1] for heat lookup so most plays land mid-band.
    const t = Math.max(0, Math.min(1, (ev + 0.05) / 0.20));
    const heat = _bcHeat_(t);
    sh.getRange(4 + i, 13).setBackground(heat.bg).setFontColor(heat.fg).setFontWeight(Math.abs(ev) >= 0.05 ? 'bold' : 'normal');
  }

  // proj − line cell — green when |edge| > 1 (strong projected edge),
  // red when |edge| < 0.5 (weak projected edge).
  for (let i = 0; i < rows.length; i++) {
    const edge = parseFloat(String(rows[i][15]));
    if (isNaN(edge)) continue;
    const a = Math.abs(edge);
    if (a > 1) {
      sh.getRange(4 + i, 16).setBackground('#15803d').setFontColor('#ffffff');
    } else if (a < 0.5) {
      sh.getRange(4 + i, 16).setBackground('#b91c1c').setFontColor('#ffffff');
    }
  }

  // De-emphasize technical columns (gamePk, player_id)
  sh.getRange(4, 3, rows.length, 1).setFontColor(MLB_BC_INK_SOFT).setFontFamily(MLB_BC_NUM_FONT).setFontSize(9);
  sh.getRange(4, 18, rows.length, 1).setFontColor(MLB_BC_INK_SOFT).setFontFamily(MLB_BC_NUM_FONT).setFontSize(9);

  // Time column — small italic serif, right-aligned
  sh.getRange(4, 19, rows.length, 1)
    .setFontFamily(MLB_BC_TITLE_FONT)
    .setFontStyle('italic')
    .setFontSize(10)
    .setHorizontalAlignment('right');

  // MLB The Streak picks — highlight the two players with the highest projected
  // H total. Streak is a daily pick-one promo (player needs ≥1 H to keep streak),
  // so the two strongest projections are the natural picks to surface.
  // Filters out 'Batter hits (shadow)' to avoid double-highlighting v2 rows.
  const streakCandidates = [];
  for (let i = 0; i < rows.length; i++) {
    const market = String(rows[i][6] || '').toLowerCase();
    if (market !== 'batter hits') continue;
    const proj = parseFloat(String(rows[i][14]));
    if (isNaN(proj)) continue;
    streakCandidates.push({ rowIdx: i, proj: proj, player: String(rows[i][5] || '').trim() });
  }
  // Dedupe by player (keep highest proj per player), then take top 2.
  const bestPerPlayer = {};
  streakCandidates.forEach(function (c) {
    if (!c.player) return;
    if (!bestPerPlayer[c.player] || c.proj > bestPerPlayer[c.player].proj) {
      bestPerPlayer[c.player] = c;
    }
  });
  const streakPicks = Object.keys(bestPerPlayer)
    .map(function (k) { return bestPerPlayer[k]; })
    .sort(function (a, b) { return b.proj - a.proj; })
    .slice(0, 2);

  streakPicks.forEach(function (pick, idx) {
    const rank = idx + 1;
    // Bold gold on player cell (col 6) + the same on proj cell (col 15) so the
    // pair reads as "this player at this projection".
    sh.getRange(4 + pick.rowIdx, 6)
      .setBackground('#fde047')      // tailwind yellow-300
      .setFontColor('#7c2d12')       // tailwind orange-900 for high contrast
      .setFontWeight('bold')
      .setNote('🔥 MLB The Streak — Pick #' + rank + ' · projected ' + pick.proj.toFixed(2) + ' H');
    sh.getRange(4 + pick.rowIdx, 15)
      .setBackground('#fde047')
      .setFontColor('#7c2d12')
      .setFontWeight('bold');
  });
}

/**
 * Append a hit-rate-by-model-probability tracker below the main bet card.
 * Reads 📋 MLB_Results_Log, groups graded rows by market × time window × bucket,
 * and writes a small results panel using the same lineup-card palette.
 * @returns {number} next row index after the tracker
 */
function mlbAppendBetTrackerSection_(ss, sh, startRow, slateDate) {
  return _mlbRenderBetTrackerPanel_(ss, sh, startRow, slateDate, {
    logTab: MLB_RESULTS_LOG_TAB,
    logNcol: MLB_RESULTS_LOG_NCOL,
    title: 'Bet Tracker  ·  hit rate by model probability bucket  ·  graded slates only',
    markets: [
      { key: 'K',  label: 'STRIKEOUTS',  test: function (m) { return m.indexOf('strikeout')   !== -1; } },
      { key: 'H',  label: 'HITS',        test: function (m) { return m.indexOf('batter hit')  !== -1 && m.indexOf('shadow') === -1; } },
      { key: 'TB', label: 'TOTAL BASES', test: function (m) { return m.indexOf('total base')  !== -1; } },
    ],
  });
}

/**
 * v2 shadow tracker — same panel format, reads 🧪 MLB_Results_Log_v2 which mirrors
 * v1's column layout for indices 0..23. Hits-only since v2 currently only models hits.
 * Renders even when log is missing so user sees the panel scaffolding.
 */
function mlbAppendBetTrackerSectionV2_(ss, sh, startRow, slateDate) {
  if (typeof MLB_RESULTS_LOG_V2_TAB === 'undefined') return startRow;
  return _mlbRenderBetTrackerPanel_(ss, sh, startRow, slateDate, {
    logTab: MLB_RESULTS_LOG_V2_TAB,
    logNcol: typeof MLB_RESULTS_LOG_V2_NCOL !== 'undefined' ? MLB_RESULTS_LOG_V2_NCOL : 30,
    title: 'Bet Tracker v2 (shadow)  ·  h.v2-full advanced-features model  ·  hits only',
    markets: [
      { key: 'H', label: 'HITS v2', test: function (m) { return m.indexOf('batter hit') !== -1; } },
    ],
  });
}

/**
 * Edge-based tracker — buckets graded bets by |proj − line|.
 * Three buckets: < 0.5 (weak edge), 0.5–1.0 (middle), > 1.0 (strong edge).
 * Needs `proj` column (col 25) in 📋 MLB_Results_Log; older rows w/o proj are skipped.
 */
function mlbAppendBetTrackerByEdgeSection_(ss, sh, startRow, slateDate) {
  const edgeBuckets = [
    { label: '< 0.5',    heat: 0.05 },
    { label: '0.5 – 1.0', heat: 0.55 },
    { label: '> 1.0',    heat: 0.95 },
  ];
  return _mlbRenderBetTrackerPanel_(ss, sh, startRow, slateDate, {
    logTab: MLB_RESULTS_LOG_TAB,
    logNcol: MLB_RESULTS_LOG_NCOL,
    title: 'Bet Tracker  ·  hit rate by |projection − line|  ·  graded slates only',
    markets: [
      { key: 'K',  label: 'STRIKEOUTS',  test: function (m) { return m.indexOf('strikeout')   !== -1; } },
      { key: 'H',  label: 'HITS',        test: function (m) { return m.indexOf('batter hit')  !== -1 && m.indexOf('shadow') === -1; } },
      { key: 'TB', label: 'TOTAL BASES', test: function (m) { return m.indexOf('total base')  !== -1; } },
    ],
    buckets: edgeBuckets,
    bucketer: function (row, mp) {
      const proj = parseFloat(String(row[26]));
      const line = parseFloat(String(row[6]));
      if (isNaN(proj) || isNaN(line)) return null;
      const d = Math.abs(proj - line);
      if (d < 0.5) return '< 0.5';
      if (d > 1.0) return '> 1.0';
      return '0.5 – 1.0';
    },
    labelHeat: function (b) { return b.heat; },
    cumulativeStyle: 'simple',
  });
}

function _mlbRenderBetTrackerPanel_(ss, sh, startRow, slateDate, opts) {
  const log = ss.getSheetByName(opts.logTab);
  // Tracker spans the bet card width but composes 5 visual zones via merged
  // cells, so it doesn't inherit the cramped bet-card column widths and we
  // never call setColumnWidth (which would mangle the bet card above).
  // 1-indexed (col_start, col_end_inclusive) per zone:
  //   Z0 bucket label | Z1 YESTERDAY | Z2 LAST 7 | Z3 LAST 30 | Z4 LIFETIME
  const ZONES = [
    { start: 1,  end: 4  },
    { start: 5,  end: 6  },
    { start: 7,  end: 11 },
    { start: 12, end: 15 },
    { start: 16, end: 19 },
  ];
  const ncol = 19;
  function zRange(rowNum, zi) {
    const z = ZONES[zi];
    return sh.getRange(rowNum, z.start, 1, z.end - z.start + 1);
  }
  function zMerge(rowNum, zi, value) {
    const rng = zRange(rowNum, zi);
    try { rng.breakApart(); } catch (e) {}
    rng.merge();
    if (value !== undefined) rng.setValue(value);
    return rng;
  }
  const tz = Session.getScriptTimeZone();
  const data = (log && log.getLastRow() >= 4)
    ? log.getRange(4, 1, log.getLastRow() - 3, opts.logNcol).getValues()
    : [];

  const slateD = new Date(slateDate + 'T12:00:00');
  const ymd = function (offsetDays) {
    return Utilities.formatDate(new Date(slateD.getTime() + offsetDays * 86400000), tz, 'yyyy-MM-dd');
  };
  const yest  = ymd(-1);
  const cut7  = ymd(-7);
  const cut30 = ymd(-30);

  const markets = opts.markets;
  const buckets = opts.buckets || [
    { lo: 0.60, hi: 0.70,  label: '60–70%' },
    { lo: 0.70, hi: 0.80,  label: '70–80%' },
    { lo: 0.80, hi: 0.90,  label: '80–90%' },
    { lo: 0.90, hi: 1.001, label: '90–100%' },
  ];
  // Default bucketer = model%-based; override via opts.bucketer for edge etc.
  const bucketer = opts.bucketer || function (row, mp) {
    for (let i = 0; i < buckets.length; i++) {
      if (mp >= buckets[i].lo && mp < buckets[i].hi) return buckets[i].label;
    }
    return null;
  };
  // Label-cell heat function: returns a 0..1 value passed to _bcHeat_.
  const labelHeatFn = opts.labelHeat || function (b) { return (b.lo + Math.min(b.hi, 1.0)) / 2; };
  const cumulativeStyle = opts.cumulativeStyle || 'thresholds';  // 'thresholds' | 'simple' | 'none'
  const windows = ['yesterday', 'last7', 'last30', 'lifetime'];

  // stats[marketKey][window][bucketLabel] = { w, l, p, staked, pnl }
  const stats = {};
  markets.forEach(function (m) {
    stats[m.key] = {};
    windows.forEach(function (w) {
      stats[m.key][w] = {};
      buckets.forEach(function (b) { stats[m.key][w][b.label] = { w: 0, l: 0, p: 0, staked: 0, pnl: 0 }; });
    });
  });

  // Dedup: every MORNING/MIDDAY/FINAL snapshot used to append a new row
  // when the slate cell read back as a Date (upsert compared toString()).
  // Collapse same-bet rows down to one, preferring graded over PENDING.
  // Stable key = bet_key when present, else slate+gamePk+player+side+line.
  const isGraded = function (res) {
    return res === 'WIN' || res === 'LOSS' || res === 'PUSH';
  };
  const dedup = {};
  data.forEach(function (row) {
    const slate = _bcNormSlate_(row[1], tz);
    if (!slate) return;
    const betKey = String(row[21] || '').trim();
    const fallback = [
      slate,
      String(row[13] != null ? row[13] : '').trim(),
      String(row[14] != null ? row[14] : '').trim(),
      String(row[7] || '').trim().toLowerCase().replace(/\s+/g, ''),
      String(row[6] != null ? row[6] : '').trim(),
    ].join('|');
    const key = betKey || fallback;
    const prev = dedup[key];
    if (!prev) { dedup[key] = row; return; }
    const prevRes = String(prev[16] || '').trim().toUpperCase();
    const curRes  = String(row[16] || '').trim().toUpperCase();
    if (isGraded(curRes) && !isGraded(prevRes)) dedup[key] = row;
  });

  Object.keys(dedup).forEach(function (key) {
    const row = dedup[key];
    const slate = _bcNormSlate_(row[1], tz);
    if (!slate || slate >= slateDate) return;
    const market = String(row[5] || '').toLowerCase();
    const result = String(row[16] || '').trim().toUpperCase();
    if (!isGraded(result)) return;
    const mp = parseFloat(String(row[9]));
    if (isNaN(mp) || mp < 0.6) return;

    let mKey = null;
    for (let i = 0; i < markets.length; i++) {
      if (markets[i].test(market)) { mKey = markets[i].key; break; }
    }
    if (!mKey) return;

    const bKey = bucketer(row, mp);
    if (!bKey || !stats[mKey][windows[0]][bKey]) return;

    const stake = parseFloat(String(row[24]));
    const pnl   = parseFloat(String(row[25]));

    function bump(w) {
      const s = stats[mKey][w][bKey];
      if      (result === 'WIN')  s.w++;
      else if (result === 'LOSS') s.l++;
      else                        s.p++;
      if (!isNaN(stake) && stake > 0) s.staked += stake;
      if (!isNaN(pnl))                s.pnl    += pnl;
    }
    if (slate === yest)   bump('yesterday');
    if (slate >= cut7)    bump('last7');
    if (slate >= cut30)   bump('last30');
    bump('lifetime');
  });

  function fmtCell(s) {
    const n = s.w + s.l;
    if (n === 0) return '—';
    const hitPct = Math.round((s.w / n) * 100);
    const top = s.w + '-' + s.l + '  ' + hitPct + '%';
    if (s.staked <= 0) return top;
    const roi    = (s.pnl / s.staked) * 100;
    const pnlStr = (s.pnl >= 0 ? '+$' : '-$') + Math.abs(s.pnl).toFixed(0);
    const roiStr = (roi  >= 0 ? '+' : '') + roi.toFixed(0) + '%';
    return top + '\n' + pnlStr + ' ' + roiStr;
  }

  let r = startRow;

  // Title row — merged across all tracker columns
  sh.getRange(r, 1, 1, ncol)
    .merge()
    .setValue(opts.title)
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

  // Window-header row — paint full row, then merge zones with labels
  sh.getRange(r, 1, 1, ncol).setBackground(MLB_BC_PAPER);
  const winHeaders = ['', 'YESTERDAY', 'LAST 7', 'LAST 30', 'LIFETIME'];
  winHeaders.forEach(function (label, zi) {
    zMerge(r, zi, label)
      .setFontFamily(MLB_BC_BODY_FONT)
      .setFontSize(9)
      .setFontColor(MLB_BC_INK)
      .setBackground(MLB_BC_PAPER_ALT)
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');
  });
  sh.setRowHeight(r, 20);
  r++;

  markets.forEach(function (m) {
    // Market subtitle row — single full-width merged cell, left-aligned label
    sh.getRange(r, 1, 1, ncol).setBackground(MLB_BC_PAPER);
    sh.getRange(r, 1, 1, ncol).merge()
      .setValue(m.label + '  (' + m.key + ')')
      .setFontFamily(MLB_BC_TITLE_FONT)
      .setFontSize(10)
      .setFontStyle('italic')
      .setFontColor(MLB_BC_INK)
      .setBackground(MLB_BC_PAPER)
      .setHorizontalAlignment('left')
      .setVerticalAlignment('middle')
      .setBorder(null, null, true, null, null, null, MLB_BC_RULE, SpreadsheetApp.BorderStyle.SOLID);
    sh.setRowHeight(r, 22);
    r++;

    // Bucket rows — bucket label zone tinted by labelHeat; each window
    // zone heat-maps by its own hit-rate (red bad → green good).
    buckets.forEach(function (b) {
      sh.getRange(r, 1, 1, ncol).setBackground('#ffffff');
      // Bucket label zone
      const labelHeat = _bcHeat_(labelHeatFn(b));
      zMerge(r, 0, b.label)
        .setFontFamily(MLB_BC_TITLE_FONT)
        .setFontSize(10)
        .setFontWeight('normal')
        .setFontColor(labelHeat.fg)
        .setBackground(labelHeat.bg)
        .setHorizontalAlignment('center')
        .setVerticalAlignment('middle');
      // Window zones
      let hasPnl = false;
      windows.forEach(function (w, wi) {
        const s = stats[m.key][w][b.label];
        const n = s.w + s.l;
        const cellTxt = fmtCell(s);
        if (cellTxt.indexOf('\n') !== -1) hasPnl = true;
        const rng = zMerge(r, wi + 1, cellTxt)
          .setFontFamily(MLB_BC_NUM_FONT)
          .setFontSize(10)
          .setFontWeight('normal')
          .setHorizontalAlignment('center')
          .setVerticalAlignment('middle')
          .setWrap(true);
        if (n === 0) {
          rng.setBackground('#ffffff').setFontColor(MLB_BC_INK_SOFT);
        } else {
          const heat = _bcHeat_(s.w / n);
          rng.setBackground(heat.bg).setFontColor(heat.fg);
        }
      });
      sh.setRowHeight(r, hasPnl ? 34 : 22);
      r++;
    });

    // Cumulative row(s) — depends on cumulativeStyle.
    if (cumulativeStyle !== 'none') {
      function aggForThreshold(w, minLo) {
        const a = { w: 0, l: 0, p: 0, staked: 0, pnl: 0 };
        buckets.forEach(function (b) {
          if (b.lo != null && b.lo + 1e-9 < minLo) return;
          const s = stats[m.key][w][b.label];
          a.w += s.w; a.l += s.l; a.p += s.p; a.staked += s.staked; a.pnl += s.pnl;
        });
        return a;
      }
      function aggAll(w) {
        const a = { w: 0, l: 0, p: 0, staked: 0, pnl: 0 };
        buckets.forEach(function (b) {
          const s = stats[m.key][w][b.label];
          a.w += s.w; a.l += s.l; a.p += s.p; a.staked += s.staked; a.pnl += s.pnl;
        });
        return a;
      }
      function fmtThreshold(label, a) {
        const n = a.w + a.l;
        if (n === 0) return label + ' —';
        return label + ' ' + a.w + '-' + a.l + ' ' + Math.round((a.w / n) * 100) + '%';
      }
      // fmtPlain reuses fmtCell so cumulative shows pnl/ROI when stake data is present.
      const fmtPlain = fmtCell;
      const aggs = {};
      const cellTexts = [];
      windows.forEach(function (w) {
        if (cumulativeStyle === 'thresholds') {
          const a60 = aggForThreshold(w, 0.60);
          const a70 = aggForThreshold(w, 0.70);
          aggs[w] = { primary: a60 };
          cellTexts.push(fmtThreshold('60+', a60) + '\n' + fmtThreshold('70+', a70));
        } else {
          const a = aggAll(w);
          aggs[w] = { primary: a };
          cellTexts.push(fmtPlain(a));
        }
      });
      const isThresholds = cumulativeStyle === 'thresholds';
      sh.getRange(r, 1, 1, ncol).setBackground('#ffffff');
      zMerge(r, 0, 'CUMULATIVE')
        .setFontFamily(MLB_BC_TITLE_FONT)
        .setFontWeight('bold')
        .setFontSize(9)
        .setBackground(MLB_BC_PAPER_ALT)
        .setFontColor(MLB_BC_INK)
        .setHorizontalAlignment('center')
        .setVerticalAlignment('middle')
        .setWrap(false);
      let hasPnlCum = false;
      windows.forEach(function (w, wi) {
        const a = aggs[w].primary;
        const n = a.w + a.l;
        if (cellTexts[wi].indexOf('\n') !== -1) hasPnlCum = true;
        const rng = zMerge(r, wi + 1, cellTexts[wi])
          .setFontFamily(MLB_BC_NUM_FONT)
          .setFontSize(isThresholds ? 9 : 10)
          .setFontWeight('bold')
          .setHorizontalAlignment('center')
          .setVerticalAlignment('middle')
          .setWrap(true);
        if (n === 0) {
          rng.setBackground('#ffffff').setFontColor(MLB_BC_INK_SOFT);
        } else {
          const heat = _bcHeat_(a.w / n);
          rng.setBackground(heat.bg).setFontColor(heat.fg);
        }
      });
      sh.getRange(r, 1, 1, ncol).setBorder(true, null, null, null, null, null, MLB_BC_RULE, SpreadsheetApp.BorderStyle.SOLID);
      sh.setRowHeight(r, isThresholds ? 36 : (hasPnlCum ? 34 : 22));
      r++;
    }

    // Spacer between markets
    sh.getRange(r, 1, 1, ncol).setBackground(MLB_BC_PAPER);
    sh.setRowHeight(r, 8);
    r++;
  });

  return r;
}
