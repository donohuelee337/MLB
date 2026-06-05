// ============================================================
// 📋 Pitcher ER queue — schedule starters × FanDuel ER + FIP/ERA
// ============================================================
// Reads 📅 MLB_Schedule + ✅ FanDuel_MLB_Odds (pitcher_earned_runs /
// pitcher_earned_runs_alternate). One row per probable starter with main
// line. L3 ER/IP + season ERA/FIP from statsapi (shared fetch).
// ============================================================

const MLB_PITCHER_ER_QUEUE_TAB = '📋 Pitcher_ER_Queue';

function mlbBuildPitcherEROddsIndex_(ss) {
  return mlbBuildPersonPropOddsIndexMerged_(
    ss,
    'pitcher_earned_runs',
    'pitcher_earned_runs_alternate'
  );
}

function mlbPickMainERPoint_(pointMap) {
  return mlbPickMainKPoint_(pointMap);
}

function mlbMainERPrices_(pointMap, point) {
  return mlbMainKPrices_(pointMap, point);
}

function mlbPitchingLogSummaryER_(playerId, season, cfg) {
  const splits = mlbStatsApiGetPitchingGameSplits_(playerId, season);
  let l3er = 0;
  let l3ip = 0;
  let totEr = 0;
  let totIp = 0;
  const nL = Math.min(3, splits.length);
  for (let i = 0; i < splits.length; i++) {
    const st = splits[i].stat || {};
    const er = parseInt(st.earnedRuns, 10) || 0;
    const ip = mlbParseInningsString_(st.inningsPitched);
    totEr += er;
    totIp += ip;
    if (i < nL) {
      l3er += er;
      l3ip += ip;
    }
  }
  const games = splits.length;
  const szn =
    typeof mlbSharedFetchPitcherSeasonPitching_ === 'function'
      ? mlbSharedFetchPitcherSeasonPitching_(playerId, season)
      : { era: NaN, fip: NaN, er9: NaN, er: NaN, ip: 0 };

  const fipConstRaw = parseFloat(
    String(cfg && cfg['LEAGUE_FIP_CONSTANT'] != null ? cfg['LEAGUE_FIP_CONSTANT'] : '3.10').trim(),
    10
  );
  const fipConst = !isNaN(fipConstRaw) ? fipConstRaw : 3.1;

  let seasonFip = szn.fip;
  if ((isNaN(seasonFip) || seasonFip <= 0) && szn.ip > 0) {
    seasonFip = mlbComputeFipFromCountingStats_(szn.hr, szn.bb, szn.hbp, szn.k, szn.ip, fipConst);
  }

  const era = !isNaN(szn.era) ? szn.era : '';
  const fip = !isNaN(seasonFip) ? seasonFip : '';
  let fipMinusEra = '';
  if (fip !== '' && era !== '') {
    fipMinusEra = Math.round((parseFloat(fip, 10) - parseFloat(era, 10)) * 100) / 100;
  }

  let erPerStart = '';
  if (games > 0 && !isNaN(szn.er)) {
    erPerStart = Math.round((szn.er / games) * 100) / 100;
  }

  let hotCold = '';
  const l3ipNum = l3ip;
  const seasonEr9 = !isNaN(szn.er9) ? szn.er9 : NaN;
  if (games >= 5 && nL >= 3 && l3ipNum >= 6 && !isNaN(seasonEr9)) {
    const er9L3 = (l3er / l3ipNum) * 9;
    hotCold = mlbHotColdFlag_(er9L3, seasonEr9);
  }

  return {
    l3er: nL ? l3er : '',
    l3ip: nL ? Math.round(l3ip * 100) / 100 : '',
    erPerStart: erPerStart,
    era: era,
    fip: fip,
    fipMinusEra: fipMinusEra,
    games: games,
    hotCold: hotCold,
  };
}

function refreshPitcherERSlateQueue() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  mlbResetPitchHandCache_();
  const cfg = getConfig();
  const season = mlbSlateSeasonYear_(cfg);
  const sch = ss.getSheetByName(MLB_SCHEDULE_TAB);
  if (!sch || sch.getLastRow() < 4) {
    safeAlert_('Pitcher ER queue', 'Run MLB schedule first.');
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

  const oddsIdx = mlbBuildPitcherEROddsIndex_(ss);
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
        out.push([
          gamePk, matchup, sp.side, '', '', '', '', '', '', '', '', '', '', '', 'no_probable_pitcher', '', hpUmp, '', '', '',
        ]);
        return;
      }

      const pNorm = mlbNormalizePersonName_(sp.name);
      let pointMap = mlbOddsPointMapForPitcher_(oddsIdx, gameKeys, pNorm);
      let note = '';
      if (!pointMap || !Object.keys(pointMap).length) {
        note = 'fd_er_miss';
        pointMap = {};
      }
      const mainPt = mlbPickMainERPoint_(pointMap);
      const px = mlbMainERPrices_(pointMap, mainPt);

      let l3er = '';
      let l3ip = '';
      let erPerStart = '';
      let era = '';
      let fip = '';
      let fipMinusEra = '';
      let hotCold = '';
      let games = '';
      const pidNum = parseInt(sp.pid, 10);
      if (pidNum) {
        if (!seenIds[pidNum]) {
          if (!mlbStatsApiPitchingSplitsCached_(pidNum, season)) {
            Utilities.sleep(100);
          }
          seenIds[pidNum] = mlbPitchingLogSummaryER_(pidNum, season, cfg);
        }
        const lg = seenIds[pidNum];
        l3er = lg.l3er;
        l3ip = lg.l3ip;
        erPerStart = lg.erPerStart;
        era = lg.era;
        fip = lg.fip;
        fipMinusEra = lg.fipMinusEra;
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
        l3er,
        l3ip,
        erPerStart,
        era,
        fip,
        fipMinusEra,
        note,
        injSt,
        hpUmp,
        throws,
        hotCold,
        games,
      ]);
    });
  });

  let sh = ss.getSheetByName(MLB_PITCHER_ER_QUEUE_TAB);
  if (sh) {
    sh.clearContents();
    sh.clearFormats();
  } else {
    sh = ss.insertSheet(MLB_PITCHER_ER_QUEUE_TAB);
  }
  sh.setTabColor('#4527a0');
  [72, 220, 56, 160, 88, 56, 72, 72, 52, 52, 64, 52, 52, 72, 220, 88, 140, 44, 56, 48].forEach(function (w, i) {
    sh.setColumnWidth(i + 1, w);
  });

  sh.getRange(1, 1, 1, 20)
    .merge()
    .setValue(
      '📋 Pitcher ER queue — FD earned runs + L3/season ERA/FIP (statsapi) — season ' + season
    )
    .setFontWeight('bold')
    .setBackground('#311b92')
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center');

  const headers = [
    'gamePk',
    'matchup',
    'side',
    'pitcher',
    'pitcher_id',
    'fd_er_line',
    'fd_over',
    'fd_under',
    'L3_ER',
    'L3_IP',
    'er_per_start',
    'season_ERA',
    'season_FIP',
    'fip_minus_ERA',
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
    .setBackground('#512da8')
    .setFontColor('#ffffff');
  sh.setFrozenRows(3);

  if (out.length) {
    sh.getRange(4, 1, out.length, headers.length).setValues(out);
    try {
      ss.setNamedRange('MLB_PITCHER_ER_QUEUE', sh.getRange(4, 1, out.length, headers.length));
    } catch (e) {}
  }

  ss.toast(out.length + ' starter rows', 'Pitcher ER queue', 6);
}

function mlbActivatePitcherERQueueTab_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(MLB_PITCHER_ER_QUEUE_TAB);
  if (sh) sh.activate();
  else safeAlert_('Pitcher ER queue', 'Run "📋 Pitcher ER queue only" first.');
}
