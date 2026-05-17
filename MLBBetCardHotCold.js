// ============================================================
// 🔥🧊 MLB Bet Card hot/cold L14 streakiness indicator
// ============================================================
// Reads the MLB Stats API game-log splits already cached by the
// pitcher/hitter queues, classifies each bet-card row's player as
// HOT, COLD, or neutral relative to their L14 median, and paints
// the row's outer border red (hot) or blue (cold).
//
// Stats can lie — players go on streaks, play through injuries,
// or get cold without showing it in the season-average λ feeding
// the model. This overlay flags streakiness so the human picker
// can choose to fade or ride accordingly.
//
// Heuristic (per row, by market kind):
//   K  → strikeOuts per pitching game (last 14 starts)
//   H  → hits per hitting game        (last 14 games)
//   TB → totalBases per hitting game  (last 14 games)
//
// Within those L14 splits:
//   • median = simple median of available games (need ≥ MIN_GAMES, default 8)
//   • L5 = the most recent 5 games (or all available if fewer)
//   • l5above = count of L5 games strictly above median
//   • l5below = count of L5 games strictly below median
//
//   When median > 0:
//     HOT  if l5above ≥ L5_THRESHOLD  (default 4 of 5)
//     COLD if l5below ≥ L5_THRESHOLD
//   When median == 0 (rookies / part-time bats):
//     HOT if ≥ 3 of last 5 are strictly > 0
//     COLD never (already at floor — nothing to read into)
//   If both fire, HOT wins (flagging signal > flagging absence).
//
// Config knobs (⚙️ Config tab, all optional):
//   BET_CARD_HOTCOLD_ENABLED       'true' | 'false'   (default true)
//   BET_CARD_HOTCOLD_WINDOW        integer            (default 14)
//   BET_CARD_HOTCOLD_MIN_GAMES     integer            (default 8)
//   BET_CARD_HOTCOLD_L5_COUNT      integer            (default 5)
//   BET_CARD_HOTCOLD_L5_THRESHOLD  integer            (default 4)
//
// This file is INTENTIONALLY isolated from MLBBetCard.js model logic
// — same insulation as MLBBetCardFormatting.js. If hot/cold needs to
// be ripped out, this single file + the call site at the bottom of
// mlbApplyBetCardFormatting_ is the entire surface area.
// ============================================================

const MLB_BC_HOT_BORDER  = '#dc2626';  // crimson — matches heat-map red band
const MLB_BC_COLD_BORDER = '#2563eb';  // royal blue — high contrast vs ivory paper

/**
 * Read hot/cold tuning from ⚙️ Config with sane defaults.
 * Keeps a single source of truth so future tweaks land in one place.
 */
function mlbHotColdConfig_(cfg) {
  function num(k, dflt) {
    const v = parseFloat(String(cfg && cfg[k] != null ? cfg[k] : '').trim(), 10);
    return isNaN(v) ? dflt : v;
  }
  function bool(k, dflt) {
    const raw = cfg && cfg[k] != null ? String(cfg[k]).trim().toLowerCase() : '';
    if (raw === '') return dflt;
    return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'y';
  }
  return {
    enabled:     bool('BET_CARD_HOTCOLD_ENABLED', true),
    window:      Math.max(2, num('BET_CARD_HOTCOLD_WINDOW', 14)),
    minGames:    Math.max(2, num('BET_CARD_HOTCOLD_MIN_GAMES', 8)),
    l5Count:     Math.max(2, num('BET_CARD_HOTCOLD_L5_COUNT', 5)),
    l5Threshold: Math.max(1, num('BET_CARD_HOTCOLD_L5_THRESHOLD', 4)),
  };
}

/** Median of a non-empty numeric array (mutates a sorted copy). */
function mlbHotColdMedian_(arr) {
  if (!arr || !arr.length) return NaN;
  const sorted = arr.slice().sort(function (a, b) { return a - b; });
  const m = sorted.length;
  if (m % 2 === 1) return sorted[(m - 1) / 2];
  return (sorted[m / 2 - 1] + sorted[m / 2]) / 2;
}

/**
 * Map bet-card row's market column (col 6 in 0-indexed rows[] layout, which
 * is 'kind' implicitly via market string) to a stat extractor.
 * @returns {function(split):number|null}  or null if unsupported market.
 */
function mlbHotColdStatExtractor_(marketText) {
  const m = String(marketText || '').toLowerCase();
  if (m.indexOf('strikeout') !== -1) {
    return function (sp) {
      const st = (sp && sp.stat) || {};
      const v = parseInt(st.strikeOuts, 10);
      return isNaN(v) ? null : v;
    };
  }
  if (m.indexOf('total base') !== -1) {
    return function (sp) {
      const st = (sp && sp.stat) || {};
      const v = parseInt(st.totalBases, 10);
      return isNaN(v) ? null : v;
    };
  }
  if (m.indexOf('batter hit') !== -1 || m === 'hits' || m.indexOf('hit') !== -1) {
    return function (sp) {
      const st = (sp && sp.stat) || {};
      const v = parseInt(st.hits, 10);
      return isNaN(v) ? null : v;
    };
  }
  return null;
}

/**
 * Pull cached splits for a player. Pitching splits when the market is
 * strikeouts, hitting splits otherwise. Cache hit when the queue (or
 * a prior bet-card invocation in the same execution) already fetched
 * them. Cache miss falls back to a fresh API call — slower but never
 * silently returns stale data.
 *
 * @returns {Array<Object>} splits newest-first, or [] on any failure.
 */
function mlbHotColdSplitsForMarket_(playerId, marketText, season) {
  const id = parseInt(playerId, 10);
  if (!id) return [];
  const m = String(marketText || '').toLowerCase();
  if (m.indexOf('strikeout') !== -1) {
    if (typeof mlbStatsApiGetPitchingGameSplits_ !== 'function') return [];
    return mlbStatsApiGetPitchingGameSplits_(id, season) || [];
  }
  if (typeof mlbStatsApiGetHittingGameSplits_ !== 'function') return [];
  return mlbStatsApiGetHittingGameSplits_(id, season) || [];
}

/**
 * Classify a single (player, market) pair as HOT / COLD / null.
 * Pure-ish: no spreadsheet I/O, only network reads through the cached
 * statsapi helpers.
 *
 * @returns {{state: ('HOT'|'COLD'|null), n: number, median: number,
 *            l5above: number, l5below: number, l5avg: number,
 *            recent: Array<number>}}
 */
function mlbHotColdClassify_(playerId, marketText, season, tuning) {
  const cfg = tuning || mlbHotColdConfig_({});
  const empty = { state: null, n: 0, median: NaN, l5above: 0, l5below: 0, l5avg: NaN, recent: [] };
  if (!parseInt(playerId, 10)) return empty;
  const extract = mlbHotColdStatExtractor_(marketText);
  if (!extract) return empty;

  const splits = mlbHotColdSplitsForMarket_(playerId, marketText, season);
  if (!splits.length) return empty;

  const window = splits.slice(0, cfg.window);
  const stats = [];
  for (let i = 0; i < window.length; i++) {
    const v = extract(window[i]);
    if (v != null && !isNaN(v)) stats.push(v);
  }
  if (stats.length < cfg.minGames) return Object.assign(empty, { n: stats.length });

  const median = mlbHotColdMedian_(stats);
  const last5  = stats.slice(0, Math.min(cfg.l5Count, stats.length));
  let above = 0, below = 0, sum = 0;
  for (let i = 0; i < last5.length; i++) {
    if (last5[i] > median) above++;
    else if (last5[i] < median) below++;
    sum += last5[i];
  }
  const l5avg = last5.length ? sum / last5.length : NaN;

  let state = null;
  if (median > 0) {
    if (above >= cfg.l5Threshold) state = 'HOT';
    else if (below >= cfg.l5Threshold) state = 'COLD';
  } else {
    let posCount = 0;
    for (let i = 0; i < last5.length; i++) if (last5[i] > 0) posCount++;
    if (posCount >= 3) state = 'HOT';
  }

  return { state: state, n: stats.length, median: median, l5above: above, l5below: below, l5avg: l5avg, recent: last5 };
}

/**
 * Paint the outer border of each non-spacer row in the rendered bet card
 * red (HOT) or blue (COLD). Inner cell hairlines are preserved.
 *
 * @param {Sheet} sh — the 🃏 MLB_Bet_Card sheet
 * @param {Array<Array>} rows — the rows array as written into the sheet
 *                              starting at row 4 (matches the layout
 *                              documented in mlbApplyBetCardFormatting_).
 * @param {Object} cfg — getConfig() output (slate, knobs, season).
 * @returns {{hot: number, cold: number, scanned: number}} for caller logging.
 */
function mlbApplyBetCardHotColdBorders_(sh, rows, cfg) {
  const tuning = mlbHotColdConfig_(cfg || {});
  const stats = { hot: 0, cold: 0, scanned: 0 };
  if (!tuning.enabled || !rows || !rows.length) return stats;

  const season = typeof mlbSlateSeasonYear_ === 'function'
    ? mlbSlateSeasonYear_(cfg || {})
    : new Date().getFullYear();
  const ncol = rows[0].length;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    if (!r[2] && !r[4]) continue;
    const playerId = r[17];
    const market   = r[6];
    if (!parseInt(playerId, 10)) continue;
    if (!market) continue;

    stats.scanned++;
    let cls;
    try {
      cls = mlbHotColdClassify_(playerId, market, season, tuning);
    } catch (e) {
      Logger.log('mlbApplyBetCardHotColdBorders_: classify failed for ' + playerId + ' / ' + market + ': ' + e.message);
      continue;
    }
    if (!cls || !cls.state) continue;

    const color = cls.state === 'HOT' ? MLB_BC_HOT_BORDER : MLB_BC_COLD_BORDER;
    try {
      sh.getRange(4 + i, 1, 1, ncol).setBorder(
        true, true, true, true, null, null,
        color, SpreadsheetApp.BorderStyle.SOLID_THICK
      );
    } catch (e) {
      Logger.log('mlbApplyBetCardHotColdBorders_: setBorder failed row ' + (4 + i) + ': ' + e.message);
      continue;
    }
    if (cls.state === 'HOT') stats.hot++;
    else stats.cold++;
  }

  Logger.log(
    'MLB bet card hot/cold: scanned=' + stats.scanned +
    ' hot=' + stats.hot + ' cold=' + stats.cold +
    ' window=' + tuning.window + ' minGames=' + tuning.minGames +
    ' L5≥' + tuning.l5Threshold + '/' + tuning.l5Count
  );
  return stats;
}

// ============================================================
// 🔍 Diagnostic — paint a small table on the bet card sheet
// showing per-row hot/cold scores. Run from the script editor
// to validate the classifier without re-rendering everything.
// ============================================================
function diagnoseBetCardHotCold() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(MLB_BET_CARD_TAB);
  if (!sh || sh.getLastRow() < 4) {
    safeAlert_('Hot/Cold diag', 'Build 🃏 MLB_Bet_Card first.');
    return;
  }
  const cfg = getConfig();
  const tuning = mlbHotColdConfig_(cfg);
  const season = mlbSlateSeasonYear_(cfg);
  const ncol = MLB_BET_CARD_NCOL;
  const last = sh.getLastRow();
  const block = sh.getRange(4, 1, last - 3, ncol).getValues();
  const diagTab = '🔍 BetCard_HotCold_Diag';
  let diag = ss.getSheetByName(diagTab);
  if (diag) { diag.clearContents(); diag.clearFormats(); }
  else      { diag = ss.insertSheet(diagTab); }
  diag.setTabColor('#7c3aed');
  diag.getRange(1, 1).setValue('🔥🧊 Bet Card Hot/Cold diagnostic — ' + new Date()).setFontWeight('bold');
  diag.getRange(2, 1).setValue(
    'Tuning: window=' + tuning.window + ' minGames=' + tuning.minGames +
    ' L5_threshold=' + tuning.l5Threshold + '/' + tuning.l5Count
  );
  const headers = ['row', 'player', 'market', 'state', 'n', 'median', 'L5_above', 'L5_below', 'L5_avg', 'recent_5'];
  diag.getRange(4, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#312e81').setFontColor('#ffffff');

  const out = [];
  for (let i = 0; i < block.length; i++) {
    const r = block[i];
    if (!r[2] && !r[4]) continue;
    const playerId = r[17];
    const market = r[6];
    if (!parseInt(playerId, 10) || !market) continue;
    const cls = mlbHotColdClassify_(playerId, market, season, tuning);
    out.push([
      4 + i,
      r[5],
      market,
      cls.state || '—',
      cls.n,
      isNaN(cls.median) ? '' : cls.median,
      cls.l5above,
      cls.l5below,
      isNaN(cls.l5avg) ? '' : Math.round(cls.l5avg * 100) / 100,
      (cls.recent || []).join(', '),
    ]);
  }
  if (out.length) {
    diag.getRange(5, 1, out.length, headers.length).setValues(out);
  }
  [50, 180, 160, 60, 40, 60, 70, 70, 60, 140].forEach(function (w, c) { diag.setColumnWidth(c + 1, w); });
  ss.toast(out.length + ' rows scanned · see ' + diagTab, 'Hot/Cold diag', 6);
}
