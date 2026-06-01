// ============================================================
// 📋 F5 queue — slate games × FanDuel 5-inning lines
// ============================================================
// Reads 📅 MLB_Schedule + ✅ FanDuel_MLB_Odds (totals_1st_5_innings,
// h2h_1st_5_innings, spreads_1st_5_innings). Model inputs: SP FIP +
// proj_IP capped at 5 for λ runs allowed through F5.
// ============================================================

const MLB_F5_QUEUE_TAB = '📋 F5_Queue';

function mlbBuildF5OddsIndex_(ss) {
  const sh = ss.getSheetByName(MLB_ODDS_CONFIG.tabName);
  const byGame = {};
  if (!sh || sh.getLastRow() < 4) return byGame;
  const rows = sh.getRange(4, 1, sh.getLastRow() - 3, 8).getValues();
  rows.forEach(function (r) {
    const market = String(r[2] || '').trim();
    const gameLabel = String(r[1] || '').trim();
    const teamOrSide = String(r[0] || r[3] || '').trim();
    const side = String(r[3] || '').trim();
    const point = r[4];
    const price = r[5];
    if (!gameLabel) return;
    const gNorm = mlbNormalizeGameLabel_(gameLabel);
    if (!byGame[gNorm]) {
      byGame[gNorm] = { gameLabel: gameLabel, ml: {}, spread: {} };
    }
    const g = byGame[gNorm];
    if (market === 'totals_1st_5_innings') {
      if (side === 'Over') g.f5Over = price;
      if (side === 'Under') g.f5Under = price;
      if (point !== '' && point != null) g.f5Line = point;
    } else if (market === 'h2h_1st_5_innings') {
      const team = teamOrSide || side;
      if (team) g.ml[mlbNormalizeGameLabel_(team)] = price;
    } else if (market === 'spreads_1st_5_innings') {
      const team = teamOrSide || side;
      if (team) {
        g.spread[mlbNormalizeGameLabel_(team)] = { point: point, price: price };
      }
    }
  });
  return byGame;
}

function mlbLookupF5Odds_(oddsIdx, gameKeys) {
  for (let i = 0; i < gameKeys.length; i++) {
    const hit = oddsIdx[gameKeys[i]];
    if (hit) return hit;
  }
  return null;
}

function mlbF5LookupTeamPrice_(map, abbr) {
  if (!map) return '';
  const variants = mlbOddsTeamLabelVariants_(abbr);
  for (let i = 0; i < variants.length; i++) {
    const k = mlbNormalizeGameLabel_(variants[i]);
    if (map[k] != null && map[k] !== '') return map[k];
  }
  return '';
}

function mlbF5PitcherSummary_(playerId, season) {
  const szn =
    typeof mlbSharedFetchPitcherSeasonPitching_ === 'function'
      ? mlbSharedFetchPitcherSeasonPitching_(playerId, season)
      : { fip: NaN, l3ip: NaN, games: 0 };
  const splits =
    typeof mlbStatsApiGetPitchingGameSplits_ === 'function'
      ? mlbStatsApiGetPitchingGameSplits_(playerId, season)
      : [];
  let l3ip = 0;
  const nL = Math.min(3, splits.length);
  for (let i = 0; i < nL; i++) {
    l3ip += mlbParseInningsString_((splits[i].stat || {}).inningsPitched);
  }
  const fip = parseFloat(String(szn.fip), 10);
  return {
    fip: !isNaN(fip) && fip > 0 ? fip : '',
    l3ip: l3ip > 0 ? Math.round(l3ip * 100) / 100 : '',
    games: splits.length || '',
  };
}

function refreshF5SlateQueue() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig();
  const season = mlbSlateSeasonYear_(cfg);
  const sch = ss.getSheetByName(MLB_SCHEDULE_TAB);
  if (!sch || sch.getLastRow() < 4) {
    safeAlert_('F5 queue', 'Run MLB schedule first.');
    return;
  }

  const oddsIdx = mlbBuildF5OddsIndex_(ss);
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
    const fd = mlbLookupF5Odds_(oddsIdx, gameKeys);
    let note = '';
    if (!fd || (fd.f5Over === '' && fd.f5Under === '')) note = 'fd_f5_total_miss';

    function audit(pid) {
      if (!pid) return { fip: '', l3ip: '', games: '' };
      if (!pitcherCache[pid]) {
        if (
          typeof mlbStatsApiPitchingSplitsCached_ === 'function' &&
          !mlbStatsApiPitchingSplitsCached_(pid, season)
        ) {
          Utilities.sleep(80);
        }
        pitcherCache[pid] = mlbF5PitcherSummary_(pid, season);
      }
      return pitcherCache[pid];
    }

    const awayAudit = audit(awaySpId);
    const homeAudit = audit(homeSpId);
    const awayProjIp =
      typeof mlbProjIpFromQueueRow_ === 'function' ? mlbProjIpFromQueueRow_(awayAudit.l3ip) : awayAudit.l3ip;
    const homeProjIp =
      typeof mlbProjIpFromQueueRow_ === 'function' ? mlbProjIpFromQueueRow_(homeAudit.l3ip) : homeAudit.l3ip;

    const spreadAway = fd && fd.spread ? mlbF5LookupTeamPrice_(fd.spread, awayAbbr) : '';
    const spreadHome = fd && fd.spread ? mlbF5LookupTeamPrice_(fd.spread, homeAbbr) : '';
    let spreadLine = '';
    let spreadAwayPx = '';
    let spreadHomePx = '';
    if (spreadAway && typeof spreadAway === 'object') {
      spreadLine = spreadAway.point;
      spreadAwayPx = spreadAway.price;
    }
    if (spreadHome && typeof spreadHome === 'object') {
      if (spreadLine === '' && spreadHome.point !== '') spreadLine = spreadHome.point;
      spreadHomePx = spreadHome.price;
    }

    out.push([
      gamePk,
      matchup,
      typeof mlbNrfiFormatStartEt_ === 'function' ? mlbNrfiFormatStartEt_(gameDateRaw) : gameDateRaw,
      awayAbbr,
      homeAbbr,
      awaySp,
      homeSp,
      awaySpId || '',
      homeSpId || '',
      fd && fd.f5Line != null && fd.f5Line !== '' ? fd.f5Line : '',
      fd ? fd.f5Over : '',
      fd ? fd.f5Under : '',
      fd ? mlbF5LookupTeamPrice_(fd.ml, awayAbbr) : '',
      fd ? mlbF5LookupTeamPrice_(fd.ml, homeAbbr) : '',
      spreadLine,
      spreadAwayPx,
      spreadHomePx,
      awayProjIp,
      homeProjIp,
      awayAudit.fip,
      homeAudit.fip,
      awayAudit.games,
      homeAudit.games,
      note,
      hpUmp,
    ]);
  });

  let sh = ss.getSheetByName(MLB_F5_QUEUE_TAB);
  if (sh) {
    sh.clearContents();
    sh.clearFormats();
  } else {
    sh = ss.insertSheet(MLB_F5_QUEUE_TAB);
  }
  sh.setTabColor('#1565c0');
  [72, 220, 120, 44, 44, 130, 130, 72, 72, 48, 64, 64, 64, 64, 48, 64, 64, 52, 52, 52, 52, 44, 44, 180, 120].forEach(function (w, i) {
    sh.setColumnWidth(i + 1, w);
  });

  sh.getRange(1, 1, 1, 25)
    .merge()
    .setValue('📋 F5 queue — FD 5-inning total/ML/spread + SP FIP/proj_IP — season ' + season)
    .setFontWeight('bold')
    .setBackground('#0d47a1')
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
    'fd_f5_line',
    'fd_f5_over',
    'fd_f5_under',
    'fd_f5_ml_away',
    'fd_f5_ml_home',
    'fd_f5_spread_line',
    'fd_f5_spread_away',
    'fd_f5_spread_home',
    'away_proj_IP',
    'home_proj_IP',
    'away_sp_FIP',
    'home_sp_FIP',
    'away_sp_games',
    'home_sp_games',
    'notes',
    'hp_umpire',
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
      ss.setNamedRange('MLB_F5_QUEUE', sh.getRange(4, 1, out.length, headers.length));
    } catch (e) {}
  }

  ss.toast(out.length + ' games', 'F5 queue', 5);
}

function mlbActivateF5QueueTab_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(MLB_F5_QUEUE_TAB);
  if (sh) sh.activate();
  else safeAlert_('F5 queue', 'Run "📋 F5 queue only" first.');
}
