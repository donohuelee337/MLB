// ============================================================
// 📋 Pitcher Outs queue — schedule starters × FanDuel outs + game log
// ============================================================
// Reads 📅 MLB_Schedule + ✅ FanDuel_MLB_Odds (pitcher_outs /
// pitcher_outs_alternate). One row per probable starter with main line
// (first point with both Over and Under). L3 IP / season IP from statsapi
// (outs = IP × 3 implied).
// ============================================================

const MLB_PITCHER_OUTS_QUEUE_TAB = '📋 Pitcher_Outs_Queue';

function mlbBuildPitcherOutsOddsIndex_(ss) {
  return mlbBuildPersonPropOddsIndexMerged_(ss, 'pitcher_outs', 'pitcher_outs_alternate');
}

function mlbPickMainOutsPoint_(pointMap) {
  return mlbPickMainKPoint_(pointMap);
}

function mlbMainOutsPrices_(pointMap, point) {
  return mlbMainKPrices_(pointMap, point);
}

function mlbPitchingLogSummaryOuts_(playerId, season) {
  const base = mlbPitchingLogSummary_(playerId, season);
  const l3ip = parseFloat(String(base.l3ip), 10);
  const splits = mlbStatsApiGetPitchingGameSplits_(playerId, season);
  let totIp = 0;
  for (let i = 0; i < splits.length; i++) {
    totIp += mlbParseInningsString_((splits[i].stat || {}).inningsPitched);
  }
  const seasonIp = totIp > 0 ? Math.round(totIp * 100) / 100 : '';
  const l3outs = !isNaN(l3ip) && l3ip > 0 ? Math.round(l3ip * 3) : '';
  let outsPerStart = '';
  if (seasonIp !== '' && base.games > 0) {
    outsPerStart = Math.round((totIp / base.games) * 3 * 10) / 10;
  }
  return {
    l3ip: base.l3ip,
    l3outs: l3outs,
    seasonIp: seasonIp,
    outsPerStart: outsPerStart,
    games: base.games,
    hotCold: base.hotCold,
  };
}

/**
 * Rebuild pitcher outs queue from Schedule + Odds + Stats API (no odds refetch).
 */
function refreshPitcherOutsSlateQueue() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  mlbResetPitchHandCache_();
  const cfg = getConfig();
  const season = mlbSlateSeasonYear_(cfg);
  const sch = ss.getSheetByName(MLB_SCHEDULE_TAB);
  if (!sch || sch.getLastRow() < 4) {
    safeAlert_('Pitcher Outs queue', 'Run MLB schedule first.');
    return;
  }

  const schLast = sch.getLastRow();
  const scheduleRows = sch.getRange(4, 1, schLast, sch.getLastColumn()).getValues();
  const pitcherIdsToPrefetch = {};
  scheduleRows.forEach(function (r) {
    [r[11], r[12]].forEach(function (pid) {
      const n = parseInt(pid, 10);
      if (n) pitcherIdsToPrefetch[n] = true;
    });
  });
  mlbPrefetchPitchHandsForIds_(Object.keys(pitcherIdsToPrefetch));

  const oddsIdx = mlbBuildPitcherOutsOddsIndex_(ss);
  const inj = mlbLoadInjuryLookup_(ss);

  const out = [];
  const seenIds = {};

  scheduleRows.forEach(function (r) {
    const gamePk = r[0];
    const matchup = r[5];
    const awayAbbr = String(r[3] || '').trim();
    const homeAbbr = String(r[4] || '').trim();
    const awayP = String(r[6] || '').trim();
    const homeP = String(r[7] || '').trim();
    const awayId = r[11];
    const homeId = r[12];
    const hpUmp = String(r[13] || '').trim();
    if (!gamePk || !matchup) return;

    const gameKeys = mlbCandidateGameKeys_(matchup, awayAbbr, homeAbbr);
    const sides = [
      { side: 'Away', name: awayP, pid: awayId },
      { side: 'Home', name: homeP, pid: homeId },
    ];

    sides.forEach(function (sp) {
      if (!sp.name) {
        // 17 cells to match the header contract — an 18-cell row here crashed
        // the whole queue write the first time a slate had a TBD probable
        // (6/11). Note belongs in `notes` (col 12), not injury_status.
        out.push([
          gamePk, matchup, sp.side, '', '', '', '', '', '', '', '', 'no_probable_pitcher', '', hpUmp, '', '', '',
        ]);
        return;
      }

      const pNorm = mlbNormalizePersonName_(sp.name);
      let pointMap = mlbOddsPointMapForPitcher_(oddsIdx, gameKeys, pNorm);
      let note = '';
      if (!pointMap || !Object.keys(pointMap).length) {
        note = 'fd_outs_miss';
        pointMap = {};
      }
      const mainPt = mlbPickMainOutsPoint_(pointMap);
      const px = mlbMainOutsPrices_(pointMap, mainPt);

      let l3outs = '';
      let l3ip = '';
      let outsPerStart = '';
      let hotCold = '';
      let games = '';
      const pidNum = parseInt(sp.pid, 10);
      if (pidNum) {
        if (!seenIds[pidNum]) {
          if (!mlbStatsApiPitchingSplitsCached_(pidNum, season)) {
            Utilities.sleep(100);
          }
          seenIds[pidNum] = mlbPitchingLogSummaryOuts_(pidNum, season);
        }
        const lg = seenIds[pidNum];
        l3outs = lg.l3outs;
        l3ip = lg.l3ip;
        outsPerStart = lg.outsPerStart;
        hotCold = lg.hotCold || '';
        games = lg.games != null && lg.games !== '' ? lg.games : '';
      } else {
        note = note ? note + '; no_pitcher_id' : 'no_pitcher_id';
      }

      let throws = '';
      if (pidNum) throws = mlbStatsApiGetPitchHand_(pidNum);

      const injSt = inj[mlbNormalizePersonName_(sp.name)] || '';

      out.push([
        gamePk,
        matchup,
        sp.side,
        sp.name,
        sp.pid || '',
        mainPt != null ? mainPt : '',
        px.over,
        px.under,
        l3outs,
        l3ip,
        outsPerStart,
        note,
        injSt,
        hpUmp,
        throws,
        hotCold,
        games,
      ]);
    });
  });

  let sh = ss.getSheetByName(MLB_PITCHER_OUTS_QUEUE_TAB);
  if (sh) {
    sh.clearContents();
    sh.clearFormats();
  } else {
    sh = ss.insertSheet(MLB_PITCHER_OUTS_QUEUE_TAB);
  }
  sh.setTabColor('#00695c');
  [72, 220, 56, 160, 88, 56, 72, 72, 52, 52, 72, 220, 88, 140, 44, 56, 48].forEach(function (w, i) {
    sh.setColumnWidth(i + 1, w);
  });

  sh.getRange(1, 1, 1, 17)
    .merge()
    .setValue(
      '📋 Pitcher Outs queue — FD outs + L3/season IP→outs (statsapi) — season ' + season
    )
    .setFontWeight('bold')
    .setBackground('#004d40')
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center');

  const headers = [
    'gamePk',
    'matchup',
    'side',
    'pitcher',
    'pitcher_id',
    'fd_outs_line',
    'fd_over',
    'fd_under',
    'L3_outs',
    'L3_IP',
    'outs_per_start',
    'notes',
    'injury_status',
    'hp_umpire',
    'throws',
    'hot_cold',
    'games',
  ];
  sh.getRange(3, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight('bold')
    .setBackground('#00796b')
    .setFontColor('#ffffff');
  sh.setFrozenRows(3);

  if (out.length) {
    sh.getRange(4, 1, out.length, headers.length).setValues(out);
    try {
      ss.setNamedRange('MLB_PITCHER_OUTS_QUEUE', sh.getRange(4, 1, out.length, headers.length));
    } catch (e) {}
  }

  ss.toast(out.length + ' starter rows', 'Pitcher Outs queue', 6);
}

function mlbActivatePitcherOutsQueueTab_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(MLB_PITCHER_OUTS_QUEUE_TAB);
  if (sh) sh.activate();
  else safeAlert_('Pitcher Outs queue', 'Run "📋 Pitcher Outs queue only" first.');
}
