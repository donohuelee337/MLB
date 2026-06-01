// ============================================================
// 📋 NRFI queue — slate games × FanDuel 1st-inning total 0.5
// ============================================================
// Reads 📅 MLB_Schedule + ✅ FanDuel_MLB_Odds (totals_1st_1_innings).
// Under = NRFI, Over = YRFI. Enriches with SP FIP/ER9 and team RPG.
// ============================================================

const MLB_NRFI_QUEUE_TAB = '📋 NRFI_Queue';

function mlbBuildFirstInningTotalsIndex_(ss) {
  const sh = ss.getSheetByName(MLB_ODDS_CONFIG.tabName);
  const byGame = {};
  if (!sh || sh.getLastRow() < 4) return byGame;
  const rows = sh.getRange(4, 1, sh.getLastRow() - 3, 8).getValues();
  rows.forEach(function (r) {
    if (String(r[2] || '').trim() !== 'totals_1st_1_innings') return;
    const gameLabel = String(r[1] || '').trim();
    const side = String(r[3] || '').trim();
    const point = r[4];
    const price = r[5];
    if (!gameLabel) return;
    const gNorm = mlbNormalizeGameLabel_(gameLabel);
    if (!byGame[gNorm]) {
      byGame[gNorm] = { gameLabel: gameLabel, line: point, yrfi: '', nrfi: '' };
    }
    if (side === 'Over') byGame[gNorm].yrfi = price;
    if (side === 'Under') byGame[gNorm].nrfi = price;
    if (point !== '' && point != null) byGame[gNorm].line = point;
  });
  return byGame;
}

function mlbLookupFirstInningOdds_(oddsIdx, gameKeys) {
  for (let i = 0; i < gameKeys.length; i++) {
    const hit = oddsIdx[gameKeys[i]];
    if (hit) return hit;
  }
  return null;
}

/** True when slots 1–3 are filled for both sides in tonight's cached lineups. */
function mlbNrfiLineupTop3Confirmed_(gamePk) {
  if (typeof __mlbLineupsCache === 'undefined' || __mlbLineupsCache === null) return false;
  const gKey = String(parseInt(gamePk, 10) || 0);
  const gameMap = __mlbLineupsCache[gKey];
  if (!gameMap) return false;
  const slots = { away: {}, home: {} };
  Object.keys(gameMap).forEach(function (pid) {
    const entry = gameMap[pid];
    if (!entry || typeof entry !== 'object') return;
    const side = String(entry.side || '').toLowerCase();
    const slot = parseInt(entry.slot, 10);
    if ((side === 'away' || side === 'home') && slot >= 1 && slot <= 3) {
      slots[side][slot] = true;
    }
  });
  return Object.keys(slots.away).length >= 3 && Object.keys(slots.home).length >= 3;
}

function mlbNrfiFormatStartEt_(gameDateRaw) {
  if (!gameDateRaw) return '';
  try {
    const tz = Session.getScriptTimeZone();
    return Utilities.formatDate(new Date(gameDateRaw), tz, 'EEE M/d h:mm a');
  } catch (e) {
    return String(gameDateRaw);
  }
}

function mlbNrfiPitcherAudit_(playerId, season) {
  const szn =
    typeof mlbSharedFetchPitcherSeasonPitching_ === 'function'
      ? mlbSharedFetchPitcherSeasonPitching_(playerId, season)
      : { fip: NaN, er9: NaN, games: 0 };
  const splits =
    typeof mlbStatsApiGetPitchingGameSplits_ === 'function'
      ? mlbStatsApiGetPitchingGameSplits_(playerId, season)
      : [];
  const er9 = parseFloat(String(szn.er9), 10);
  const fip = parseFloat(String(szn.fip), 10);
  const er1Est = !isNaN(er9) && er9 > 0 ? Math.round((er9 / 9) * 1000) / 1000 : '';
  return {
    fip: !isNaN(fip) && fip > 0 ? fip : '',
    er1Est: er1Est,
    games: splits.length || '',
  };
}

function refreshNrfiSlateQueue() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig();
  const season = mlbSlateSeasonYear_(cfg);
  const sch = ss.getSheetByName(MLB_SCHEDULE_TAB);
  if (!sch || sch.getLastRow() < 4) {
    safeAlert_('NRFI queue', 'Run MLB schedule first.');
    return;
  }

  const oddsIdx = mlbBuildFirstInningTotalsIndex_(ss);
  const scheduleRows = sch.getRange(4, 1, sch.getLastRow() - 3, 14).getValues();
  const pitcherCache = {};
  const out = [];

  scheduleRows.forEach(function (r) {
    const gamePk = r[0];
    const gameDateRaw = r[2];
    const awayAbbr = String(r[3] || '').trim();
    const homeAbbr = String(r[4] || '').trim();
    const matchup = String(r[5] || '');
    const awaySp = String(r[6] || '').trim();
    const homeSp = String(r[7] || '').trim();
    const awaySpId = parseInt(r[11], 10);
    const homeSpId = parseInt(r[12], 10);
    const hpUmp = String(r[13] || '').trim();
    if (!gamePk || !matchup) return;

    const gameKeys = mlbCandidateGameKeys_(matchup, awayAbbr, homeAbbr);
    const fd = mlbLookupFirstInningOdds_(oddsIdx, gameKeys);
    let note = '';
    if (!fd || (fd.yrfi === '' && fd.nrfi === '')) note = 'fd_1st_miss';

    const awayTeamId = mlbTeamIdFromAbbr_(awayAbbr);
    const homeTeamId = mlbTeamIdFromAbbr_(homeAbbr);
    const awayRpg =
      awayTeamId && typeof mlbTeamSeasonRunsPerGame_ === 'function'
        ? mlbTeamSeasonRunsPerGame_(awayTeamId, season)
        : NaN;
    const homeRpg =
      homeTeamId && typeof mlbTeamSeasonRunsPerGame_ === 'function'
        ? mlbTeamSeasonRunsPerGame_(homeTeamId, season)
        : NaN;

    function pitcherRow(pid) {
      if (!pid) return { fip: '', er1Est: '', games: '' };
      if (!pitcherCache[pid]) {
        if (
          typeof mlbStatsApiPitchingSplitsCached_ === 'function' &&
          !mlbStatsApiPitchingSplitsCached_(pid, season)
        ) {
          Utilities.sleep(80);
        }
        pitcherCache[pid] = mlbNrfiPitcherAudit_(pid, season);
      }
      return pitcherCache[pid];
    }

    const awayAudit = pitcherRow(awaySpId);
    const homeAudit = pitcherRow(homeSpId);
    const lineupOk = mlbNrfiLineupTop3Confirmed_(gamePk) ? 'Y' : 'N';

    if (!awaySp) note = note ? note + '; no_away_sp' : 'no_away_sp';
    if (!homeSp) note = note ? note + '; no_home_sp' : 'no_home_sp';

    out.push([
      gamePk,
      matchup,
      mlbNrfiFormatStartEt_(gameDateRaw),
      awayAbbr,
      homeAbbr,
      awaySp,
      homeSp,
      awaySpId || '',
      homeSpId || '',
      fd && fd.line !== '' && fd.line != null ? fd.line : 0.5,
      fd ? fd.yrfi : '',
      fd ? fd.nrfi : '',
      awayAudit.fip,
      homeAudit.fip,
      awayAudit.er1Est,
      homeAudit.er1Est,
      awayAudit.games,
      homeAudit.games,
      !isNaN(awayRpg) ? awayRpg : '',
      !isNaN(homeRpg) ? homeRpg : '',
      lineupOk,
      note,
      hpUmp,
    ]);
  });

  let sh = ss.getSheetByName(MLB_NRFI_QUEUE_TAB);
  if (sh) {
    sh.clearContents();
    sh.clearFormats();
  } else {
    sh = ss.insertSheet(MLB_NRFI_QUEUE_TAB);
  }
  sh.setTabColor('#e65100');
  [72, 220, 120, 44, 44, 140, 140, 72, 72, 48, 64, 64, 52, 52, 56, 56, 44, 44, 52, 52, 56, 180, 120].forEach(function (w, i) {
    sh.setColumnWidth(i + 1, w);
  });

  sh.getRange(1, 1, 1, 23)
    .merge()
    .setValue(
      '📋 NRFI queue — FD totals_1st_1_innings (Under=NRFI, Over=YRFI) + SP FIP + team RPG — season ' +
        season
    )
    .setFontWeight('bold')
    .setBackground('#bf360c')
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center')
    .setWrap(true);
  sh.setRowHeight(1, 36);

  const headers = [
    'gamePk',
    'matchup',
    'start_ET',
    'away_abbr',
    'home_abbr',
    'away_SP',
    'home_SP',
    'away_sp_id',
    'home_sp_id',
    'fd_line',
    'fd_yrfi',
    'fd_nrfi',
    'away_sp_FIP',
    'home_sp_FIP',
    'away_sp_ER1_est',
    'home_sp_ER1_est',
    'away_sp_games',
    'home_sp_games',
    'away_team_rpg',
    'home_team_rpg',
    'lineup_top3',
    'notes',
    'hp_umpire',
  ];
  sh.getRange(3, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight('bold')
    .setBackground('#e65100')
    .setFontColor('#ffffff');
  sh.setFrozenRows(3);

  if (out.length) {
    sh.getRange(4, 1, out.length, headers.length).setValues(out);
    try {
      ss.setNamedRange('MLB_NRFI_QUEUE', sh.getRange(4, 1, out.length, headers.length));
    } catch (e) {}
  }

  ss.toast(out.length + ' games', 'NRFI queue', 5);
}

function mlbActivateNrfiQueueTab_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(MLB_NRFI_QUEUE_TAB);
  if (sh) sh.activate();
  else safeAlert_('NRFI queue', 'Run "📋 NRFI queue only" first.');
}
