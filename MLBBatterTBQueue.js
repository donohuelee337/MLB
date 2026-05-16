// ============================================================
// 📋 Batter TB queue — FanDuel batter_total_bases × statsapi hitting
// ============================================================
// Odds-driven: each distinct (game, batter) with a main FD line gets a row.
// Name → MLB player id via statsapi /people/search; L7 + season TB/game from
// hitting gameLog. Join gamePk via MLBMatchKeys odds→schedule map.
// ============================================================

const MLB_BATTER_TB_QUEUE_TAB = '📋 Batter_TB_Queue';
// FanDuel posts batter props on main and/or _alternate keys — accept either, merge on (game, batter, line).
const MLB_BATTER_TB_MARKETS = ['batter_total_bases', 'batter_total_bases_alternate'];

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

/** Thin wrapper around the canonical FD odds reader in MLBMatchKeys.js. */
function mlbCollectBatterTbOddsRows_(ss) {
  return mlbBuildPropOddsIndex_(ss, MLB_BATTER_TB_MARKETS);
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
