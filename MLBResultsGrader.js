// ============================================================
// 📊 MLB Results Grader — statsapi boxscore (pitcher K + batter TB)
// ============================================================
// Grades 📋 MLB_Results_Log rows for past slates where result is empty
// or PENDING. Pitcher K: pitching.strikeOuts. Batter TB: batting.totalBases.
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

/** @returns {number|null} total bases from boxscore batting line */
function mlbBatterTbFromBoxscore_(payload, batterId) {
  const teams = mlbBoxscoreTeams_(payload);
  if (!teams) return null;
  const pid = 'ID' + parseInt(batterId, 10);
  const sides = ['away', 'home'];
  for (let s = 0; s < sides.length; s++) {
    const t = teams[sides[s]];
    const pl = t && t.players && t.players[pid];
    const bat = pl && pl.stats && pl.stats.batting;
    if (!bat) continue;
    if (bat.totalBases != null) return parseInt(bat.totalBases, 10) || 0;
  }
  return null;
}

/** @returns {number|null} hits from boxscore batting line */
function mlbBatterHitsFromBoxscore_(payload, batterId) {
  const teams = mlbBoxscoreTeams_(payload);
  if (!teams) return null;
  const pid = 'ID' + parseInt(batterId, 10);
  const sides = ['away', 'home'];
  for (let s = 0; s < sides.length; s++) {
    const t = teams[sides[s]];
    const pl = t && t.players && t.players[pid];
    const bat = pl && pl.stats && pl.stats.batting;
    if (!bat) continue;
    if (bat.hits != null) return parseInt(bat.hits, 10) || 0;
  }
  return null;
}

/** IP string like "6.1" → total outs recorded (19). */
function mlbOutsFromInningsPitchedString_(s) {
  const t = String(s || '0').trim();
  if (!t) return 0;
  const parts = t.split('.');
  const whole = parseInt(parts[0], 10) || 0;
  const third = parts.length < 2 ? 0 : parseInt(parts[1], 10);
  return whole * 3 + (third === 1 ? 1 : third === 2 ? 2 : 0);
}

/** Pitching stats object or null for this MLB person id. */
function mlbPitchingLineFromBoxscore_(payload, pitcherId) {
  const teams = mlbBoxscoreTeams_(payload);
  if (!teams) return null;
  const pid = 'ID' + parseInt(pitcherId, 10);
  const sides = ['away', 'home'];
  for (let s = 0; s < sides.length; s++) {
    const t = teams[sides[s]];
    const pl = t && t.players && t.players[pid];
    const pit = pl && pl.stats && pl.stats.pitching;
    if (pit && String(pit.inningsPitched || '').trim() !== '') return pit;
  }
  return null;
}

/** @returns {number|null} outs pitched (prefer statsapi outs; else from IP string). */
function mlbPitcherOutsFromBoxscore_(payload, pitcherId) {
  const pit = mlbPitchingLineFromBoxscore_(payload, pitcherId);
  if (!pit) return null;
  if (pit.outs != null && String(pit.outs).trim() !== '') return parseInt(pit.outs, 10) || 0;
  return mlbOutsFromInningsPitchedString_(pit.inningsPitched);
}

function mlbPitcherWalksFromBoxscore_(payload, pitcherId) {
  const pit = mlbPitchingLineFromBoxscore_(payload, pitcherId);
  if (!pit) return null;
  if (pit.baseOnBalls != null) return parseInt(pit.baseOnBalls, 10) || 0;
  return null;
}

function mlbPitcherHitsAllowedFromBoxscore_(payload, pitcherId) {
  const pit = mlbPitchingLineFromBoxscore_(payload, pitcherId);
  if (!pit) return null;
  if (pit.hits != null) return parseInt(pit.hits, 10) || 0;
  return null;
}

/** @returns {number|null} HR from batting line */
function mlbBatterHrFromBoxscore_(payload, batterId) {
  const teams = mlbBoxscoreTeams_(payload);
  if (!teams) return null;
  const pid = 'ID' + parseInt(batterId, 10);
  const sides = ['away', 'home'];
  for (let s = 0; s < sides.length; s++) {
    const t = teams[sides[s]];
    const pl = t && t.players && t.players[pid];
    const bat = pl && pl.stats && pl.stats.batting;
    if (!bat) continue;
    if (bat.homeRuns != null) return parseInt(bat.homeRuns, 10) || 0;
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

    const isK = market.indexOf('strikeout') !== -1;
    const isPitcherOuts = market.indexOf('pitcher outs') !== -1;
    const isPitcherWalks = market.indexOf('pitcher walks') !== -1;
    const isPitcherHa = market.indexOf('pitcher hits allowed') !== -1;
    const isTb = market.indexOf('total base') !== -1;
    const isBatterHits = market.indexOf('batter hits') !== -1;
    const isHr = market.indexOf('home run') !== -1;
    if (!isK && !isPitcherOuts && !isPitcherWalks && !isPitcherHa && !isTb && !isBatterHits && !isHr) {
      continue;
    }

    const isPitcherSide = isK || isPitcherOuts || isPitcherWalks || isPitcherHa;
    if (isPitcherSide) {
      if ((!pid || isNaN(pid)) && slateStr && matchup && player) {
        pid = mlbResolvePitcherIdFromSchedule_(slateStr, matchup, player);
      }
    } else {
      if ((!pid || isNaN(pid)) && player) {
        pid = mlbStatsApiResolvePlayerIdFromName_(player);
      }
    }

    if (!gamePk || isNaN(gamePk) || !pid || isNaN(pid)) {
      logSh.getRange(4 + i, 18).setValue('Missing gamePk or player_id — re-run snapshot / check name→id');
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

    if (isK) {
      const kActual = mlbPitcherKsFromBoxscore_(box, pid);
      if (kActual === null) {
        logSh.getRange(4 + i, 16).setValue('');
        logSh.getRange(4 + i, 17).setValue('VOID');
        logSh.getRange(4 + i, 18).setValue('No pitching line (DNP / bullpen-only?)');
        graded++;
        continue;
      }

      const g = mlbGradePitcherKRow_(line, side, kActual);
      logSh.getRange(4 + i, 14).setValue(gamePk);
      logSh.getRange(4 + i, 15).setValue(pid);
      logSh.getRange(4 + i, 16).setValue(kActual);
      logSh.getRange(4 + i, 17).setValue(g.result);
      logSh.getRange(4 + i, 18).setValue('statsapi boxscore · ' + g.note);
      graded++;
      continue;
    }

    if (isPitcherOuts) {
      const act = mlbPitcherOutsFromBoxscore_(box, pid);
      if (act === null) {
        logSh.getRange(4 + i, 16).setValue('');
        logSh.getRange(4 + i, 17).setValue('VOID');
        logSh.getRange(4 + i, 18).setValue('No pitching outs line');
        graded++;
        continue;
      }
      const g = mlbGradePitcherKRow_(line, side, act);
      logSh.getRange(4 + i, 14).setValue(gamePk);
      logSh.getRange(4 + i, 15).setValue(pid);
      logSh.getRange(4 + i, 16).setValue(act);
      logSh.getRange(4 + i, 17).setValue(g.result);
      logSh.getRange(4 + i, 18).setValue('statsapi outs · ' + g.note);
      graded++;
      continue;
    }

    if (isPitcherWalks) {
      const act = mlbPitcherWalksFromBoxscore_(box, pid);
      if (act === null) {
        logSh.getRange(4 + i, 16).setValue('');
        logSh.getRange(4 + i, 17).setValue('VOID');
        logSh.getRange(4 + i, 18).setValue('No pitching walks line');
        graded++;
        continue;
      }
      const g = mlbGradePitcherKRow_(line, side, act);
      logSh.getRange(4 + i, 14).setValue(gamePk);
      logSh.getRange(4 + i, 15).setValue(pid);
      logSh.getRange(4 + i, 16).setValue(act);
      logSh.getRange(4 + i, 17).setValue(g.result);
      logSh.getRange(4 + i, 18).setValue('statsapi BB · ' + g.note);
      graded++;
      continue;
    }

    if (isPitcherHa) {
      const act = mlbPitcherHitsAllowedFromBoxscore_(box, pid);
      if (act === null) {
        logSh.getRange(4 + i, 16).setValue('');
        logSh.getRange(4 + i, 17).setValue('VOID');
        logSh.getRange(4 + i, 18).setValue('No pitching hits line');
        graded++;
        continue;
      }
      const g = mlbGradePitcherKRow_(line, side, act);
      logSh.getRange(4 + i, 14).setValue(gamePk);
      logSh.getRange(4 + i, 15).setValue(pid);
      logSh.getRange(4 + i, 16).setValue(act);
      logSh.getRange(4 + i, 17).setValue(g.result);
      logSh.getRange(4 + i, 18).setValue('statsapi pitcher H · ' + g.note);
      graded++;
      continue;
    }

    if (isTb) {
      const tbActual = mlbBatterTbFromBoxscore_(box, pid);
      if (tbActual === null) {
        logSh.getRange(4 + i, 16).setValue('');
        logSh.getRange(4 + i, 17).setValue('VOID');
        logSh.getRange(4 + i, 18).setValue('No batting line (DNP?)');
        graded++;
        continue;
      }

      const gt = mlbGradePitcherKRow_(line, side, tbActual);
      logSh.getRange(4 + i, 14).setValue(gamePk);
      logSh.getRange(4 + i, 15).setValue(pid);
      logSh.getRange(4 + i, 16).setValue(tbActual);
      logSh.getRange(4 + i, 17).setValue(gt.result);
      logSh.getRange(4 + i, 18).setValue('statsapi boxscore TB · ' + gt.note);
      graded++;
      continue;
    }

    if (isHr) {
      const hrAct = mlbBatterHrFromBoxscore_(box, pid);
      if (hrAct === null) {
        logSh.getRange(4 + i, 16).setValue('');
        logSh.getRange(4 + i, 17).setValue('VOID');
        logSh.getRange(4 + i, 18).setValue('No batting HR line');
        graded++;
        continue;
      }
      const gh = mlbGradePitcherKRow_(line, side, hrAct);
      logSh.getRange(4 + i, 14).setValue(gamePk);
      logSh.getRange(4 + i, 15).setValue(pid);
      logSh.getRange(4 + i, 16).setValue(hrAct);
      logSh.getRange(4 + i, 17).setValue(gh.result);
      logSh.getRange(4 + i, 18).setValue('statsapi HR · ' + gh.note);
      graded++;
      continue;
    }

    const hActual = mlbBatterHitsFromBoxscore_(box, pid);
    if (hActual === null) {
      logSh.getRange(4 + i, 16).setValue('');
      logSh.getRange(4 + i, 17).setValue('VOID');
      logSh.getRange(4 + i, 18).setValue('No batting line (DNP?)');
      graded++;
      continue;
    }

    const gh = mlbGradePitcherKRow_(line, side, hActual);
    logSh.getRange(4 + i, 14).setValue(gamePk);
    logSh.getRange(4 + i, 15).setValue(pid);
    logSh.getRange(4 + i, 16).setValue(hActual);
    logSh.getRange(4 + i, 17).setValue(gh.result);
    logSh.getRange(4 + i, 18).setValue('statsapi boxscore H · ' + gh.note);
    graded++;
  }

  if (graded > 0) {
    try {
      ss.toast('Graded ' + graded + ' MLB result row(s)', 'MLB-BOIZ', 6);
    } catch (e) {}
  }
}
