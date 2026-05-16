// ============================================================
// 📋 Batter Hits queue — FanDuel batter_hits × statsapi hitting
// ============================================================
// Odds-driven: each distinct (game, batter) with a main FD line gets a row.
// FD posts hits props on main and/or _alternate keys — we accept either.
// Shared caches and hittingGameSplits live in MLBBatterTBQueue.js.
// ============================================================

const MLB_BATTER_HITS_QUEUE_TAB = '📋 Batter_Hits_Queue';
const MLB_BATTER_HITS_MARKETS = ['batter_hits', 'batter_hits_alternate'];

function mlbCollectBatterHitsOddsRows_(ss) {
  return mlbBuildPropOddsIndex_(ss, MLB_BATTER_HITS_MARKETS);
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
    if (i < 7) l7h += h;
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

function refreshBatterHitsSlateQueue() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig();
  const season = mlbSlateSeasonYear_(cfg);
  const gamePkMap = mlbBuildOddsGameNormToGamePk_(ss);
  const inj = mlbLoadInjuryLookup_(ss);
  const agg = mlbCollectBatterHitsOddsRows_(ss);

  const out = [];
  Object.keys(agg).forEach(function (key) {
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
