// ============================================================
// 📋 Batter TB queue — FanDuel batter_total_bases × statsapi hitting
// ============================================================
// Odds-driven: each distinct (game, batter) with a main FD line gets a row.
// Name → MLB player id via statsapi /people/search; L7 + season TB/game from
// hitting gameLog. Join gamePk via MLBMatchKeys odds→schedule map.
// ============================================================

const MLB_BATTER_TB_QUEUE_TAB = '📋 Batter_TB_Queue';
const MLB_BATTER_TB_MARKET = 'batter_total_bases';

const MLB_BATTER_HITS_QUEUE_TAB = '📋 Batter_Hits_Queue';
const MLB_BATTER_HITS_MARKET = 'batter_hits';

var __mlbHitGameLogSplitCache = {};
var __mlbPlayerSearchIdCache = {};

function mlbResetBatterPropCaches_() {
  __mlbHitGameLogSplitCache = {};
  __mlbPlayerSearchIdCache = {};
}

function mlbResetBatterTbCaches_() {
  mlbResetBatterPropCaches_();
}

function mlbStatsApiGetHittingGameSplits_(playerId, season) {
  const id = parseInt(playerId, 10);
  if (!id) return [];
  const se = String(season);
  const key = id + ':' + se;
  if (__mlbHitGameLogSplitCache[key]) return __mlbHitGameLogSplitCache[key];

  const url =
    mlbStatsApiBaseUrl_() +
    '/people/' +
    id +
    '/stats?stats=gameLog&group=hitting&season=' +
    encodeURIComponent(se);
  try {
    Utilities.sleep(40);
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      __mlbHitGameLogSplitCache[key] = [];
      return [];
    }
    const payload = JSON.parse(res.getContentText());
    const stats = payload.stats && payload.stats[0] ? payload.stats[0] : {};
    const raw = stats.splits || [];
    const sorted = mlbSortSplitsNewestFirst_(raw);
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
      const p = people[i];
      if (mlbNormalizePersonName_(p.fullName || '') === want) {
        pick = p;
        break;
      }
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

function mlbHittingTbSummary_(playerId, season) {
  const splits = mlbStatsApiGetHittingGameSplits_(playerId, season);
  let totTb = 0;
  const n = splits.length;
  let l7tb = 0;
  const l7n = Math.min(7, splits.length);
  for (let i = 0; i < splits.length; i++) {
    const st = splits[i].stat || {};
    const tb = parseInt(st.totalBases, 10) || 0;
    totTb += tb;
    if (i < 7) {
      l7tb += tb;
    }
  }
  const tbpgSzn = n > 0 ? Math.round((totTb / n) * 1000) / 1000 : '';
  const l7Avg = l7n > 0 ? Math.round((l7tb / l7n) * 1000) / 1000 : '';
  return {
    tbpgSzn: tbpgSzn,
    l7tb: l7n ? l7tb : '',
    l7n: l7n || '',
    games: n,
    l7Avg: l7Avg,
  };
}

function mlbHittingHitsSummary_(playerId, season) {
  const splits = mlbStatsApiGetHittingGameSplits_(playerId, season);
  let totH = 0;
  const n = splits.length;
  let l7h = 0;
  const l7n = Math.min(7, splits.length);
  for (let i = 0; i < splits.length; i++) {
    const st = splits[i].stat || {};
    const h = parseInt(st.hits, 10) || 0;
    totH += h;
    if (i < 7) {
      l7h += h;
    }
  }
  const hpgSzn = n > 0 ? Math.round((totH / n) * 1000) / 1000 : '';
  const l7Avg = l7n > 0 ? Math.round((l7h / l7n) * 1000) / 1000 : '';
  return {
    hpgSzn: hpgSzn,
    l7h: l7n ? l7h : '',
    l7n: l7n || '',
    games: n,
    l7Avg: l7Avg,
  };
}

/**
 * Aggregate FD rows for batter_total_bases → one point map per norm(game)||norm(player).
 */
function mlbCollectBatterTbOddsRows_(ss) {
  const byKey = {};
  const sh = ss.getSheetByName(MLB_ODDS_CONFIG.tabName);
  if (!sh || sh.getLastRow() < 4) return byKey;
  const last = sh.getLastRow();
  const block = sh.getRange(4, 1, last, 6).getValues();
  for (let i = 0; i < block.length; i++) {
    const player = block[i][0];
    const gameLabel = block[i][1];
    const market = String(block[i][2] || '');
    const side = String(block[i][3] || '');
    const lineRaw = block[i][4];
    const price = block[i][5];
    if (market !== MLB_BATTER_TB_MARKET) continue;
    const g = mlbNormalizeGameLabel_(gameLabel);
    const p = mlbNormalizePersonName_(player);
    if (!g || !p) continue;
    const pt = parseFloat(lineRaw);
    if (isNaN(pt)) continue;
    const key = g + '||' + p;
    if (!byKey[key]) {
      byKey[key] = {
        gameLabel: gameLabel,
        displayName: String(player || '').trim(),
        pointMap: {},
      };
    }
    if (!byKey[key].pointMap[pt]) byKey[key].pointMap[pt] = {};
    const sl = side.toLowerCase();
    if (sl.indexOf('over') !== -1) byKey[key].pointMap[pt].Over = price;
    if (sl.indexOf('under') !== -1) byKey[key].pointMap[pt].Under = price;
  }
  return byKey;
}

function mlbCollectBatterHitsOddsRows_(ss) {
  const byKey = {};
  const sh = ss.getSheetByName(MLB_ODDS_CONFIG.tabName);
  if (!sh || sh.getLastRow() < 4) return byKey;
  const last = sh.getLastRow();
  const block = sh.getRange(4, 1, last, 6).getValues();
  for (let i = 0; i < block.length; i++) {
    const player = block[i][0];
    const gameLabel = block[i][1];
    const market = String(block[i][2] || '');
    const side = String(block[i][3] || '');
    const lineRaw = block[i][4];
    const price = block[i][5];
    if (market !== MLB_BATTER_HITS_MARKET) continue;
    const g = mlbNormalizeGameLabel_(gameLabel);
    const p = mlbNormalizePersonName_(player);
    if (!g || !p) continue;
    const pt = parseFloat(lineRaw);
    if (isNaN(pt)) continue;
    const key = g + '||' + p;
    if (!byKey[key]) {
      byKey[key] = {
        gameLabel: gameLabel,
        displayName: String(player || '').trim(),
        pointMap: {},
      };
    }
    if (!byKey[key].pointMap[pt]) byKey[key].pointMap[pt] = {};
    const sl = side.toLowerCase();
    if (sl.indexOf('over') !== -1) byKey[key].pointMap[pt].Over = price;
    if (sl.indexOf('under') !== -1) byKey[key].pointMap[pt].Under = price;
  }
  return byKey;
}

function refreshBatterTbSlateQueue() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  mlbResetBatterTbCaches_();
  const cfg = getConfig();
  const season = mlbSlateSeasonYear_(cfg);
  const gamePkMap = mlbBuildOddsGameNormToGamePk_(ss);
  const inj = mlbLoadInjuryLookup_(ss);
  const agg = mlbCollectBatterTbOddsRows_(ss);

  const out = [];
  const keys = Object.keys(agg);
  keys.forEach(function (key) {
    const entry = agg[key];
    const gNorm = mlbNormalizeGameLabel_(entry.gameLabel);
    let gamePk = mlbResolveGamePkFromFdGameLabel_(ss, entry.gameLabel, gamePkMap);
    let matchup = '';
    let hpUmp = '';
    let note = '';
    if (!gamePk) {
      note = 'schedule_game_miss';
    } else {
      const meta = mlbScheduleMetaForGamePk_(ss, gamePk);
      matchup = meta.matchup;
      hpUmp = meta.hpUmp;
    }

    const pm = entry.pointMap;
    const mainPt = mlbPickMainKPoint_(pm);
    const px = mlbMainKPrices_(pm, mainPt);

    let pidNum = mlbStatsApiResolvePlayerIdFromName_(entry.displayName);
    if (isNaN(pidNum) || !pidNum) {
      note = note ? note + '; id_miss' : 'id_miss';
    }

    let tbpgSzn = '';
    let l7tb = '';
    let l7n = '';
    let l7Avg = '';
    if (!isNaN(pidNum) && pidNum) {
      const tb = mlbHittingTbSummary_(pidNum, season);
      tbpgSzn = tb.tbpgSzn;
      l7tb = tb.l7tb;
      l7n = tb.l7n;
      l7Avg = tb.l7Avg;
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
      tbpgSzn,
      note,
      injSt,
      hpUmp,
      gNorm,
    ]);
  });

  let sh = ss.getSheetByName(MLB_BATTER_TB_QUEUE_TAB);
  if (sh) {
    sh.clearContents();
    sh.clearFormats();
  } else {
    sh = ss.insertSheet(MLB_BATTER_TB_QUEUE_TAB);
  }
  sh.setTabColor('#1565c0');
  [72, 200, 150, 88, 56, 64, 64, 64, 44, 52, 220, 88, 140, 160].forEach(function (w, i) {
    sh.setColumnWidth(i + 1, w);
  });

  sh.getRange(1, 1, 1, 14)
    .merge()
    .setValue(
      '📋 Batter total bases queue — FD batter_total_bases + hitting gameLog (L7 / season TB·game) · ' + season
    )
    .setFontWeight('bold')
    .setBackground('#0d47a1')
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center');

  const headers = [
    'gamePk',
    'matchup',
    'batter',
    'batter_id',
    'fd_tb_line',
    'fd_over',
    'fd_under',
    'L7_TB_avg',
    'L7_games',
    'TB_pg_szn',
    'notes',
    'injury_status',
    'hp_umpire',
    'odds_game_norm',
  ];
  sh.getRange(3, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight('bold')
    .setBackground('#1976d2')
    .setFontColor('#ffffff');
  sh.setFrozenRows(3);

  if (out.length) {
    sh.getRange(4, 1, out.length, headers.length).setValues(out);
    try {
      ss.setNamedRange('MLB_BATTER_TB_QUEUE', sh.getRange(4, 1, out.length, headers.length));
    } catch (e) {}
  }

  ss.toast(out.length + ' batter TB rows', 'Batter TB queue', 6);
}

function refreshBatterHitsSlateQueue() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig();
  const season = mlbSlateSeasonYear_(cfg);
  const gamePkMap = mlbBuildOddsGameNormToGamePk_(ss);
  const inj = mlbLoadInjuryLookup_(ss);
  const agg = mlbCollectBatterHitsOddsRows_(ss);

  const out = [];
  const keys = Object.keys(agg);
  keys.forEach(function (key) {
    const entry = agg[key];
    const gNorm = mlbNormalizeGameLabel_(entry.gameLabel);
    let gamePk = mlbResolveGamePkFromFdGameLabel_(ss, entry.gameLabel, gamePkMap);
    let matchup = '';
    let hpUmp = '';
    let note = '';
    if (!gamePk) {
      note = 'schedule_game_miss';
    } else {
      const meta = mlbScheduleMetaForGamePk_(ss, gamePk);
      matchup = meta.matchup;
      hpUmp = meta.hpUmp;
    }

    const pm = entry.pointMap;
    const mainPt = mlbPickMainKPoint_(pm);
    const px = mlbMainKPrices_(pm, mainPt);

    let pidNum = mlbStatsApiResolvePlayerIdFromName_(entry.displayName);
    if (isNaN(pidNum) || !pidNum) {
      note = note ? note + '; id_miss' : 'id_miss';
    }

    let hpgSzn = '';
    let l7Avg = '';
    let l7n = '';
    if (!isNaN(pidNum) && pidNum) {
      const hs = mlbHittingHitsSummary_(pidNum, season);
      hpgSzn = hs.hpgSzn;
      l7n = hs.l7n;
      l7Avg = hs.l7Avg;
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
      hpgSzn,
      note,
      injSt,
      hpUmp,
      gNorm,
    ]);
  });

  let sh = ss.getSheetByName(MLB_BATTER_HITS_QUEUE_TAB);
  if (sh) {
    sh.clearContents();
    sh.clearFormats();
  } else {
    sh = ss.insertSheet(MLB_BATTER_HITS_QUEUE_TAB);
  }
  sh.setTabColor('#0277bd');
  [72, 200, 150, 88, 56, 64, 64, 64, 44, 52, 220, 88, 140, 160].forEach(function (w, i) {
    sh.setColumnWidth(i + 1, w);
  });

  sh.getRange(1, 1, 1, 14)
    .merge()
    .setValue(
      '📋 Batter hits queue — FD batter_hits + hitting gameLog (L7 / season H·game) · ' + season
    )
    .setFontWeight('bold')
    .setBackground('#01579b')
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center');

  const headers = [
    'gamePk',
    'matchup',
    'batter',
    'batter_id',
    'fd_hits_line',
    'fd_over',
    'fd_under',
    'L7_H_avg',
    'L7_games',
    'H_pg_szn',
    'notes',
    'injury_status',
    'hp_umpire',
    'odds_game_norm',
  ];
  sh.getRange(3, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight('bold')
    .setBackground('#0288d1')
    .setFontColor('#ffffff');
  sh.setFrozenRows(3);

  if (out.length) {
    sh.getRange(4, 1, out.length, headers.length).setValues(out);
    try {
      ss.setNamedRange('MLB_BATTER_HITS_QUEUE', sh.getRange(4, 1, out.length, headers.length));
    } catch (e) {}
  }

  ss.toast(out.length + ' batter hits rows', 'Batter Hits queue', 6);
}
