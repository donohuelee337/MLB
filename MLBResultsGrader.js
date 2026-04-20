// ============================================================
// 📊 MLB Results Grader — statsapi boxscore (pitcher K)
// ============================================================
// Grades 📋 MLB_Results_Log rows for past slates where result is empty
// or PENDING. Uses GET /game/{gamePk}/boxscore and pitching.strikeOuts.
// Run automatically at the start of each pipeline window (NBA-style),
// or from the menu.
// ============================================================

function mlbTodayYmdNY_() {
  return Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd');
}

function mlbBoxscoreTeams_(payload) {
  if (!payload) return null;
  if (payload.teams) return payload.teams;
  if (payload.liveData && payload.liveData.boxscore && payload.liveData.boxscore.teams) {
    return payload.liveData.boxscore.teams;
  }
  return null;
}

function mlbBoxscoreIsFinal_(payload) {
  const blocks = [
    payload.status,
    payload.gameData && payload.gameData.status,
    payload.liveData && payload.liveData.game && payload.liveData.game.status,
  ];
  for (let b = 0; b < blocks.length; b++) {
    const st = blocks[b] || {};
    const abs = String(st.abstractGameState || '').toLowerCase();
    if (abs === 'final') return true;
    const det = String(st.detailedState || '').toLowerCase();
    if (det.indexOf('final') !== -1 || det.indexOf('game over') !== -1) return true;
  }
  return false;
}

function mlbFetchBoxscoreJson_(gamePk) {
  const g = parseInt(gamePk, 10);
  if (!g) return null;
  const url = mlbStatsApiBaseUrl_() + '/game/' + g + '/boxscore';
  try {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return null;
    return JSON.parse(res.getContentText());
  } catch (e) {
    Logger.log('mlbFetchBoxscoreJson_: ' + e.message);
    return null;
  }
}

/** @returns {number|null} strikeouts in this game for MLB person id */
function mlbPitcherKsFromBoxscore_(payload, pitcherId) {
  const teams = mlbBoxscoreTeams_(payload);
  if (!teams) return null;
  const pid = 'ID' + parseInt(pitcherId, 10);
  const sides = ['away', 'home'];
  for (let s = 0; s < sides.length; s++) {
    const t = teams[sides[s]];
    const pl = t && t.players && t.players[pid];
    const pit = pl && pl.stats && pl.stats.pitching;
    if (pit && pit.strikeOuts != null && String(pit.inningsPitched || '').trim() !== '') {
      return parseInt(pit.strikeOuts, 10) || 0;
    }
  }
  return null;
}

/** @returns {number|null} walks (BB) allowed in this game for MLB person id */
function mlbPitcherWalksFromBoxscore_(payload, pitcherId) {
  const teams = mlbBoxscoreTeams_(payload);
  if (!teams) return null;
  const pid = 'ID' + parseInt(pitcherId, 10);
  const sides = ['away', 'home'];
  for (let s = 0; s < sides.length; s++) {
    const t = teams[sides[s]];
    const pl = t && t.players && t.players[pid];
    const pit = pl && pl.stats && pl.stats.pitching;
    if (pit && pit.baseOnBalls != null && String(pit.inningsPitched || '').trim() !== '') {
      return parseInt(pit.baseOnBalls, 10) || 0;
    }
  }
  return null;
}

function mlbResolveGamePkFromSchedule_(slateYmd, matchupStr, playerName) {
  const payload = mlbFetchScheduleJsonForDate_(slateYmd);
  if (!payload) return null;
  const wantG = mlbNormalizeGameLabel_(matchupStr);
  const wantP = mlbNormalizePersonName_(playerName);
  const dates = payload.dates || [];
  for (let d = 0; d < dates.length; d++) {
    const games = dates[d].games || [];
    for (let i = 0; i < games.length; i++) {
      const g = games[i];
      const away = g.teams && g.teams.away && g.teams.away.team ? g.teams.away.team : {};
      const home = g.teams && g.teams.home && g.teams.home.team ? g.teams.home.team : {};
      const awayProb = g.teams && g.teams.away && g.teams.away.probablePitcher ? g.teams.away.probablePitcher : {};
      const homeProb = g.teams && g.teams.home && g.teams.home.probablePitcher ? g.teams.home.probablePitcher : {};
      const m =
        (away.name || '') +
        ' @ ' +
        (home.name || '');
      if (mlbNormalizeGameLabel_(m) !== wantG) continue;
      const aN = mlbNormalizePersonName_(awayProb.fullName || '');
      const hN = mlbNormalizePersonName_(homeProb.fullName || '');
      if (wantP && (wantP === aN || wantP === hN)) return parseInt(g.gamePk, 10) || null;
    }
  }
  for (let d = 0; d < dates.length; d++) {
    const games = dates[d].games || [];
    for (let i = 0; i < games.length; i++) {
      const g = games[i];
      const away = g.teams && g.teams.away && g.teams.away.team ? g.teams.away.team : {};
      const home = g.teams && g.teams.home && g.teams.home.team ? g.teams.home.team : {};
      const m =
        (away.name || '') +
        ' @ ' +
        (home.name || '');
      if (mlbNormalizeGameLabel_(m) === wantG) return parseInt(g.gamePk, 10) || null;
    }
  }
  return null;
}

function mlbResolvePitcherIdFromSchedule_(slateYmd, matchupStr, playerName) {
  const payload = mlbFetchScheduleJsonForDate_(slateYmd);
  if (!payload) return null;
  const wantG = mlbNormalizeGameLabel_(matchupStr);
  const wantP = mlbNormalizePersonName_(playerName);
  const dates = payload.dates || [];
  for (let d = 0; d < dates.length; d++) {
    const games = dates[d].games || [];
    for (let i = 0; i < games.length; i++) {
      const g = games[i];
      const away = g.teams && g.teams.away && g.teams.away.team ? g.teams.away.team : {};
      const home = g.teams && g.teams.home && g.teams.home.team ? g.teams.home.team : {};
      const awayProb = g.teams && g.teams.away && g.teams.away.probablePitcher ? g.teams.away.probablePitcher : {};
      const homeProb = g.teams && g.teams.home && g.teams.home.probablePitcher ? g.teams.home.probablePitcher : {};
      const m =
        (away.name || '') +
        ' @ ' +
        (home.name || '');
      if (mlbNormalizeGameLabel_(m) !== wantG) continue;
      if (wantP === mlbNormalizePersonName_(awayProb.fullName || '')) return parseInt(awayProb.id, 10) || null;
      if (wantP === mlbNormalizePersonName_(homeProb.fullName || '')) return parseInt(homeProb.id, 10) || null;
    }
  }
  return null;
}

function mlbGradePitcherKRow_(line, side, actualK) {
  const L = parseFloat(String(line));
  if (isNaN(L)) return { result: 'VOID', note: 'Bad line' };
  const s = String(side || '').toLowerCase();
  const k = actualK;
  if (s.indexOf('over') !== -1) {
    if (k > L) return { result: 'WIN', note: 'Over: ' + k + ' vs ' + L };
    if (k < L) return { result: 'LOSS', note: 'Over: ' + k + ' vs ' + L };
    return { result: 'PUSH', note: 'Over push ' + k + ' vs ' + L };
  }
  if (s.indexOf('under') !== -1) {
    if (k < L) return { result: 'WIN', note: 'Under: ' + k + ' vs ' + L };
    if (k > L) return { result: 'LOSS', note: 'Under: ' + k + ' vs ' + L };
    return { result: 'PUSH', note: 'Under push ' + k + ' vs ' + L };
  }
  return { result: 'VOID', note: 'Unknown side' };
}

/**
 * Grade pitcher strikeout rows in MLB_Results_Log for slates before today (NY).
 * Idempotent: skips rows that already have a non-empty result (not PENDING).
 */
function gradeMLBPendingResults_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logSh = ss.getSheetByName(MLB_RESULTS_LOG_TAB);
  if (!logSh || logSh.getLastRow() < 4) return;

  const today = mlbTodayYmdNY_();
  const last = logSh.getLastRow();
  const data = logSh.getRange(4, 1, last, MLB_RESULTS_LOG_NCOL).getValues();

  let graded = 0;

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const slateStr = String(row[1] || '').trim();
    const market = String(row[5] || '').toLowerCase();
    const resCell = String(row[16] || '').trim();
    if (!slateStr || slateStr >= today) {
      continue;
    }
    const isK = market.indexOf('strikeout') !== -1;
    const isBb = market.indexOf('walk') !== -1;
    if (!isK && !isBb) continue;
    if (resCell && resCell !== 'PENDING') continue;

    let gamePk = parseInt(row[13], 10);
    let pid = parseInt(row[14], 10);
    const matchup = String(row[4] || '').trim();
    const player = String(row[3] || '').trim();
    const line = row[6];
    const side = row[7];

    if ((!gamePk || isNaN(gamePk)) && slateStr && matchup) {
      gamePk = mlbResolveGamePkFromSchedule_(slateStr, matchup, player);
    }
    if ((!pid || isNaN(pid)) && slateStr && matchup && player) {
      pid = mlbResolvePitcherIdFromSchedule_(slateStr, matchup, player);
    }
    if (!gamePk || isNaN(gamePk) || !pid || isNaN(pid)) {
      logSh.getRange(4 + i, 18).setValue('Missing gamePk or pitcher_id — re-run snapshot after refresh');
      continue;
    }

    const box = mlbFetchBoxscoreJson_(gamePk);
    Utilities.sleep(120);
    if (!box) {
      logSh.getRange(4 + i, 18).setValue('Boxscore fetch failed');
      continue;
    }
    if (!mlbBoxscoreIsFinal_(box)) {
      logSh.getRange(4 + i, 18).setValue('NOT_FINAL — will retry later');
      continue;
    }

    const actualStat = isK
      ? mlbPitcherKsFromBoxscore_(box, pid)
      : mlbPitcherWalksFromBoxscore_(box, pid);
    if (actualStat === null) {
      logSh.getRange(4 + i, 16).setValue('');
      logSh.getRange(4 + i, 17).setValue('VOID');
      logSh.getRange(4 + i, 18).setValue('No pitching line (DNP / bullpen-only?)');
      graded++;
      continue;
    }

    const g = mlbGradePitcherKRow_(line, side, actualStat);
    logSh.getRange(4 + i, 14).setValue(gamePk);
    logSh.getRange(4 + i, 15).setValue(pid);
    logSh.getRange(4 + i, 16).setValue(actualStat);
    logSh.getRange(4 + i, 17).setValue(g.result);
    logSh.getRange(4 + i, 18).setValue('statsapi boxscore · ' + g.note);
    graded++;
  }

  if (graded > 0) {
    try {
      ss.toast('Graded ' + graded + ' MLB result row(s)', 'MLB-BOIZ', 6);
    } catch (e) {}
  }
}
