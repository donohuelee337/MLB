// ============================================================
// 📋 Batter prop queues — TB / Hits / HR (shared body)
// ============================================================
// Odds-driven: each distinct (game, batter) with a main FD line gets a row.
// Name → MLB player id via statsapi /people/search; L7 + season stat/game
// from hitting gameLog. Join gamePk via MLBMatchKeys odds→schedule map.
// Shared body: mlbBatterPropQueueBody_(meta).
// ============================================================

const MLB_BATTER_TB_QUEUE_TAB   = '📋 Batter_TB_Queue';
const MLB_BATTER_TB_MARKET      = 'batter_total_bases';

const MLB_BATTER_HITS_QUEUE_TAB = '📋 Batter_Hits_Queue';
const MLB_BATTER_HITS_MARKET    = 'batter_hits';

const MLB_BATTER_HR_QUEUE_TAB   = '📋 Batter_HR_Queue';
const MLB_BATTER_HR_MARKET      = 'batter_home_runs';

/** Column count for every batter prop queue tab (and the card body reads this many cols). */
const MLB_BATTER_PROP_QUEUE_COLS = 14;

var __mlbHitGameLogSplitCache  = {};
var __mlbPlayerSearchIdCache   = {};

function mlbResetBatterPropCaches_() {
  __mlbHitGameLogSplitCache = {};
  __mlbPlayerSearchIdCache  = {};
}

function mlbResetBatterTbCaches_() {
  mlbResetBatterPropCaches_();
}

// ── statsapi helpers ──────────────────────────────────────────────────────────

function mlbStatsApiGetHittingGameSplits_(playerId, season) {
  const id = parseInt(playerId, 10);
  if (!id) return [];
  const se = String(season);
  const key = id + ':' + se;
  if (__mlbHitGameLogSplitCache[key]) return __mlbHitGameLogSplitCache[key];

  const url =
    mlbStatsApiBaseUrl_() +
    '/people/' + id +
    '/stats?stats=gameLog&group=hitting&season=' + encodeURIComponent(se);
  try {
    Utilities.sleep(40);
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      __mlbHitGameLogSplitCache[key] = [];
      return [];
    }
    const payload = JSON.parse(res.getContentText());
    const stats = payload.stats && payload.stats[0] ? payload.stats[0] : {};
    const sorted = mlbSortSplitsNewestFirst_(stats.splits || []);
    __mlbHitGameLogSplitCache[key] = sorted;
    return sorted;
  } catch (e) {
    Logger.log('mlbStatsApiGetHittingGameSplits_: ' + e.message);
    __mlbHitGameLogSplitCache[key] = [];
    return [];
  }
}

function mlbStatsApiResolvePlayerIdFromName_(displayName) {
  const nm = String(displayName || '').trim();
  if (!nm) return NaN;
  const norm = mlbNormalizePersonName_(nm);
  if (Object.prototype.hasOwnProperty.call(__mlbPlayerSearchIdCache, norm)) {
    return __mlbPlayerSearchIdCache[norm];
  }
  const url =
    mlbStatsApiBaseUrl_() + '/people/search?names=' + encodeURIComponent(nm) + '&sportIds=1';
  try {
    Utilities.sleep(55);
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      __mlbPlayerSearchIdCache[norm] = NaN;
      return NaN;
    }
    const payload = JSON.parse(res.getContentText());
    const people = payload.people || [];
    if (!people.length) {
      __mlbPlayerSearchIdCache[norm] = NaN;
      return NaN;
    }
    const want = mlbNormalizePersonName_(nm);
    let pick = people[0];
    for (let i = 0; i < people.length; i++) {
      if (mlbNormalizePersonName_(people[i].fullName || '') === want) { pick = people[i]; break; }
    }
    const id = parseInt(pick.id, 10);
    const out = id || NaN;
    __mlbPlayerSearchIdCache[norm] = out;
    return out;
  } catch (e) {
    Logger.log('mlbStatsApiResolvePlayerIdFromName_: ' + e.message);
    __mlbPlayerSearchIdCache[norm] = NaN;
    return NaN;
  }
}

// ── per-market stat summaries ─────────────────────────────────────────────────

function mlbHittingTbSummary_(playerId, season) {
  const splits = mlbStatsApiGetHittingGameSplits_(playerId, season);
  const n = splits.length;
  const l7n = Math.min(7, n);
  let totTb = 0, l7tb = 0;
  for (let i = 0; i < n; i++) {
    const tb = parseInt((splits[i].stat || {}).totalBases, 10) || 0;
    totTb += tb;
    if (i < 7) l7tb += tb;
  }
  return {
    statPgSzn: n > 0 ? Math.round((totTb / n) * 1000) / 1000 : '',
    l7Avg:     l7n > 0 ? Math.round((l7tb / l7n) * 1000) / 1000 : '',
    l7n:       l7n || '',
  };
}

function mlbHittingHitsSummary_(playerId, season) {
  const splits = mlbStatsApiGetHittingGameSplits_(playerId, season);
  const n = splits.length;
  const l7n = Math.min(7, n);
  let totH = 0, l7h = 0;
  for (let i = 0; i < n; i++) {
    const h = parseInt((splits[i].stat || {}).hits, 10) || 0;
    totH += h;
    if (i < 7) l7h += h;
  }
  return {
    statPgSzn: n > 0 ? Math.round((totH / n) * 1000) / 1000 : '',
    l7Avg:     l7n > 0 ? Math.round((l7h / l7n) * 1000) / 1000 : '',
    l7n:       l7n || '',
  };
}

function mlbHittingHrSummary_(playerId, season) {
  const splits = mlbStatsApiGetHittingGameSplits_(playerId, season);
  const n = splits.length;
  const l7n = Math.min(7, n);
  let totHr = 0, l7hr = 0;
  for (let i = 0; i < n; i++) {
    const hr = parseInt((splits[i].stat || {}).homeRuns, 10) || 0;
    totHr += hr;
    if (i < 7) l7hr += hr;
  }
  return {
    statPgSzn: n > 0 ? Math.round((totHr / n) * 1000) / 1000 : '',
    l7Avg:     l7n > 0 ? Math.round((l7hr / l7n) * 1000) / 1000 : '',
    l7n:       l7n || '',
  };
}

// ── unified FD odds collector ─────────────────────────────────────────────────

/**
 * Collect FD odds rows for any batter prop market key.
 * Returns { normalizedGame||normalizedPlayer: { gameLabel, displayName, pointMap } }.
 * Replaces the three formerly separate mlbCollectBatter*OddsRows_ functions.
 */
function mlbCollectBatterOddsRows_(ss, marketKey) {
  const want = String(marketKey || '').trim();
  const byKey = {};
  const sh = ss.getSheetByName(MLB_ODDS_CONFIG.tabName);
  if (!sh || sh.getLastRow() < 4 || !want) return byKey;
  const last = sh.getLastRow();
  const block = sh.getRange(4, 1, last, 6).getValues();
  for (let i = 0; i < block.length; i++) {
    const player   = block[i][0];
    const gameLabel = block[i][1];
    const market   = String(block[i][2] || '');
    const side     = String(block[i][3] || '');
    const lineRaw  = block[i][4];
    const price    = block[i][5];
    if (market !== want) continue;
    const g = mlbNormalizeGameLabel_(gameLabel);
    const p = mlbNormalizePersonName_(player);
    if (!g || !p) continue;
    const pt = parseFloat(lineRaw);
    if (isNaN(pt)) continue;
    const key = g + '||' + p;
    if (!byKey[key]) {
      byKey[key] = { gameLabel: gameLabel, displayName: String(player || '').trim(), pointMap: {} };
    }
    if (!byKey[key].pointMap[pt]) byKey[key].pointMap[pt] = {};
    const sl = side.toLowerCase();
    if (sl.indexOf('over')  !== -1) byKey[key].pointMap[pt].Over  = price;
    if (sl.indexOf('under') !== -1) byKey[key].pointMap[pt].Under = price;
  }
  return byKey;
}

// ── shared queue body ─────────────────────────────────────────────────────────

/**
 * Shared queue-build + sheet-write body for all batter prop markets.
 * Adding a new batter market only requires a new refresh function calling this.
 *
 * @param {Object}   meta
 * @param {string}   meta.marketKey          FD market key, e.g. 'batter_total_bases'
 * @param {Function} meta.statsFn            (playerId, season) → {statPgSzn, l7Avg, l7n}
 * @param {string}   meta.queueTab
 * @param {string}   meta.queueTitle         title row text (season appended automatically)
 * @param {string}   meta.queueTabColor
 * @param {string}   meta.queueHeadBg        title row background
 * @param {string}   meta.queueHeadBg2       header row background
 * @param {string}   meta.fdLineHeader       e.g. 'fd_tb_line'
 * @param {string}   meta.l7AvgHeader        e.g. 'L7_TB_avg'
 * @param {string}   meta.statPgSznHeader    e.g. 'TB_pg_szn'
 * @param {string}   meta.namedRange         e.g. 'MLB_BATTER_TB_QUEUE'
 * @param {string}   meta.toastLabel
 * @param {string}   meta.toastUnit          e.g. 'batter TB rows'
 */
function mlbBatterPropQueueBody_(meta) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig();
  const season = mlbSlateSeasonYear_(cfg);
  const gamePkMap = mlbBuildOddsGameNormToGamePk_(ss);
  const inj = mlbLoadInjuryLookup_(ss);
  const agg = mlbCollectBatterOddsRows_(ss, meta.marketKey);

  const out = [];
  const keys = Object.keys(agg);
  keys.forEach(function (key) {
    const entry = agg[key];
    const gNorm = mlbNormalizeGameLabel_(entry.gameLabel);
    const gamePk = mlbResolveGamePkFromFdGameLabel_(ss, entry.gameLabel, gamePkMap);
    let matchup = '';
    let hpUmp = '';
    let note = '';
    if (!gamePk) {
      note = 'schedule_game_miss';
    } else {
      const schedMeta = mlbScheduleMetaForGamePk_(ss, gamePk);
      matchup = schedMeta.matchup;
      hpUmp   = schedMeta.hpUmp;
    }

    const pm = entry.pointMap;
    const mainPt = mlbPickMainKPoint_(pm);
    const px = mlbMainKPrices_(pm, mainPt);

    let pidNum = mlbStatsApiResolvePlayerIdFromName_(entry.displayName);
    if (isNaN(pidNum) || !pidNum) {
      note = note ? note + '; id_miss' : 'id_miss';
    }

    let statPgSzn = '', l7Avg = '', l7n = '';
    if (!isNaN(pidNum) && pidNum) {
      const stats = meta.statsFn(pidNum, season);
      statPgSzn = stats.statPgSzn;
      l7Avg     = stats.l7Avg;
      l7n       = stats.l7n;
    }

    const injSt = inj[mlbNormalizePersonName_(entry.displayName)] || '';

    out.push([
      gamePk || '',
      matchup,
      entry.displayName,
      !isNaN(pidNum) && pidNum ? pidNum : '',
      mainPt != null ? mainPt : '',
      px.over,
      px.under,
      l7Avg,
      l7n,
      statPgSzn,
      note,
      injSt,
      hpUmp,
      gNorm,
    ]);
  });

  let sh = ss.getSheetByName(meta.queueTab);
  if (sh) {
    sh.clearContents();
    sh.clearFormats();
  } else {
    sh = ss.insertSheet(meta.queueTab);
  }
  sh.setTabColor(meta.queueTabColor);
  [72, 200, 150, 88, 56, 64, 64, 64, 44, 52, 220, 88, 140, 160].forEach(function (w, i) {
    sh.setColumnWidth(i + 1, w);
  });

  sh.getRange(1, 1, 1, MLB_BATTER_PROP_QUEUE_COLS)
    .merge()
    .setValue(meta.queueTitle + ' · ' + season)
    .setFontWeight('bold')
    .setBackground(meta.queueHeadBg)
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center');

  const headers = [
    'gamePk', 'matchup', 'batter', 'batter_id',
    meta.fdLineHeader, 'fd_over', 'fd_under',
    meta.l7AvgHeader, 'L7_games', meta.statPgSznHeader,
    'notes', 'injury_status', 'hp_umpire', 'odds_game_norm',
  ];
  sh.getRange(3, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight('bold')
    .setBackground(meta.queueHeadBg2)
    .setFontColor('#ffffff');
  sh.setFrozenRows(3);

  if (out.length) {
    sh.getRange(4, 1, out.length, MLB_BATTER_PROP_QUEUE_COLS).setValues(out);
    try {
      ss.setNamedRange(meta.namedRange, sh.getRange(4, 1, out.length, MLB_BATTER_PROP_QUEUE_COLS));
    } catch (e) {}
  }

  ss.toast(out.length + ' ' + meta.toastUnit, meta.toastLabel, 6);
}

// ── public refresh functions ──────────────────────────────────────────────────

function refreshBatterTbSlateQueue() {
  mlbResetBatterTbCaches_();
  mlbBatterPropQueueBody_({
    marketKey:       MLB_BATTER_TB_MARKET,
    statsFn:         mlbHittingTbSummary_,
    queueTab:        MLB_BATTER_TB_QUEUE_TAB,
    queueTitle:      '📋 Batter total bases queue — FD batter_total_bases + hitting gameLog (L7 / season TB·game)',
    queueTabColor:   '#1565c0',
    queueHeadBg:     '#0d47a1',
    queueHeadBg2:    '#1976d2',
    fdLineHeader:    'fd_tb_line',
    l7AvgHeader:     'L7_TB_avg',
    statPgSznHeader: 'TB_pg_szn',
    namedRange:      'MLB_BATTER_TB_QUEUE',
    toastLabel:      'Batter TB queue',
    toastUnit:       'batter TB rows',
  });
}

function refreshBatterHitsSlateQueue() {
  mlbBatterPropQueueBody_({
    marketKey:       MLB_BATTER_HITS_MARKET,
    statsFn:         mlbHittingHitsSummary_,
    queueTab:        MLB_BATTER_HITS_QUEUE_TAB,
    queueTitle:      '📋 Batter hits queue — FD batter_hits + hitting gameLog (L7 / season H·game)',
    queueTabColor:   '#0277bd',
    queueHeadBg:     '#01579b',
    queueHeadBg2:    '#0288d1',
    fdLineHeader:    'fd_hits_line',
    l7AvgHeader:     'L7_H_avg',
    statPgSznHeader: 'H_pg_szn',
    namedRange:      'MLB_BATTER_HITS_QUEUE',
    toastLabel:      'Batter Hits queue',
    toastUnit:       'batter hits rows',
  });
}

function refreshBatterHrSlateQueue() {
  mlbBatterPropQueueBody_({
    marketKey:       MLB_BATTER_HR_MARKET,
    statsFn:         mlbHittingHrSummary_,
    queueTab:        MLB_BATTER_HR_QUEUE_TAB,
    queueTitle:      '📋 Batter HR queue — FD batter_home_runs + hitting gameLog (L7 / season HR·game)',
    queueTabColor:   '#6a1b9a',
    queueHeadBg:     '#4a148c',
    queueHeadBg2:    '#7b1fa2',
    fdLineHeader:    'fd_hr_line',
    l7AvgHeader:     'L7_HR_avg',
    statPgSznHeader: 'HR_pg_szn',
    namedRange:      'MLB_BATTER_HR_QUEUE',
    toastLabel:      'Batter HR queue',
    toastUnit:       'batter HR rows',
  });
}
