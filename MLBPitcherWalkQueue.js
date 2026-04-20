// ============================================================
// 📋 Pitcher BB queue — schedule × FanDuel pitcher_walks + gameLog
// ============================================================
// AI-BOIZ spirit: same join machinery as 📋 Pitcher_K_Queue.
// ============================================================

const MLB_PITCHER_BB_QUEUE_TAB = '📋 Pitcher_BB_Queue';

/**
 * Rebuild pitcher walks queue from Schedule + Odds + Stats API.
 */
function refreshPitcherWalkSlateQueue() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  mlbResetPitchHandCache_();
  const cfg = getConfig();
  const season = mlbSlateSeasonYear_(cfg);
  const sch = ss.getSheetByName(MLB_SCHEDULE_TAB);
  if (!sch || sch.getLastRow() < 4) {
    safeAlert_('Pitcher BB queue', 'Run MLB schedule first.');
    return;
  }

  const schLast = sch.getLastRow();
  const schCols = sch.getLastColumn();
  const scheduleRows = sch.getRange(4, 1, schLast, schCols).getValues();
  const pitcherIdsToPrefetch = {};
  scheduleRows.forEach(function (r) {
    [r[11], r[12]].forEach(function (pid) {
      const n = parseInt(pid, 10);
      if (n) pitcherIdsToPrefetch[n] = true;
    });
  });
  mlbPrefetchPitchHandsForIds_(Object.keys(pitcherIdsToPrefetch));

  const oddsIdx = mlbBuildPitcherWalkOddsIndex_(ss);
  const inj = mlbLoadInjuryLookup_(ss);

  const out = [];
  const seenWalk = {};

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
          gamePk,
          matchup,
          sp.side,
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          'no_probable_pitcher',
          '',
          hpUmp,
          '',
        ]);
        return;
      }
      const pNorm = mlbNormalizePersonName_(sp.name);
      let pointMap = mlbOddsPointMapForPitcher_(oddsIdx, gameKeys, pNorm);
      let note = '';
      if (!pointMap || !Object.keys(pointMap).length) {
        note = 'fd_bb_miss';
        pointMap = {};
      }
      const mainPt = mlbPickMainKPoint_(pointMap);
      const px = mlbMainKPrices_(pointMap, mainPt);

      let l3bb = '';
      let l3ip = '';
      let bb9 = '';
      const pidNum = parseInt(sp.pid, 10);
      if (pidNum) {
        if (!seenWalk[pidNum]) {
          if (!mlbStatsApiPitchingSplitsCached_(pidNum, season)) {
            Utilities.sleep(100);
          }
          seenWalk[pidNum] = mlbPitchingWalkSummary_(pidNum, season);
        }
        const lg = seenWalk[pidNum];
        l3bb = lg.l3bb;
        l3ip = lg.l3ip;
        bb9 = lg.bb9;
      } else {
        note = note ? note + '; no_pitcher_id' : 'no_pitcher_id';
      }

      let throws = '';
      if (pidNum) {
        throws = mlbStatsApiGetPitchHand_(pidNum);
      }

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
        l3bb,
        l3ip,
        bb9,
        note,
        injSt,
        hpUmp,
        throws,
      ]);
    });
  });

  let sh = ss.getSheetByName(MLB_PITCHER_BB_QUEUE_TAB);
  if (sh) {
    const cr = Math.max(sh.getLastRow(), 3);
    const cc = Math.max(sh.getLastColumn(), 15);
    try {
      sh.getRange(1, 1, cr, cc).breakApart();
    } catch (e) {
      Logger.log('refreshPitcherWalkSlateQueue breakApart: ' + e.message);
    }
    sh.clearContents();
    sh.clearFormats();
  } else {
    sh = ss.insertSheet(MLB_PITCHER_BB_QUEUE_TAB);
  }
  sh.setTabColor('#1565c0');
  [72, 220, 56, 160, 88, 56, 72, 72, 52, 52, 52, 220, 88, 140, 44].forEach(function (w, i) {
    sh.setColumnWidth(i + 1, w);
  });

  sh.getRange(1, 1, 1, 15)
    .merge()
    .setValue(
      '📋 Pitcher BB queue — FD pitcher_walks (+ alternate merged) + L3 / season BB9 — season ' + season
    )
    .setFontWeight('bold')
    .setBackground('#0d47a1')
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center');

  const headers = [
    'gamePk',
    'matchup',
    'side',
    'pitcher',
    'pitcher_id',
    'fd_bb_line',
    'fd_over',
    'fd_under',
    'L3_BB',
    'L3_IP',
    'BB9_szn',
    'notes',
    'injury_status',
    'hp_umpire',
    'throws',
  ];
  sh.getRange(3, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight('bold')
    .setBackground('#1976d2')
    .setFontColor('#ffffff');

  if (out.length) {
    sh.getRange(4, 1, out.length, headers.length).setValues(out);
    try {
      ss.setNamedRange('MLB_PITCHER_BB_QUEUE', sh.getRange(4, 1, out.length, headers.length));
    } catch (e) {}
  }
  sh.setFrozenRows(3);

  ss.toast(out.length + ' starter rows (walks)', 'Pitcher BB queue', 6);
}
