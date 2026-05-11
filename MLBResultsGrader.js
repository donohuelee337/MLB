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

/**
 * Fetch game data for grading. Uses /feed/live (not /boxscore) because
 * /boxscore omits game status — without it mlbBoxscoreIsFinal_ always
 * returns false and the grader marks every row "NOT_FINAL". The live
 * feed has both player stats (liveData.boxscore.teams) AND game status
 * (gameData.status / liveData.game.status), already handled by
 * mlbBoxscoreTeams_ / mlbBoxscoreIsFinal_.
 */
function mlbFetchBoxscoreJson_(gamePk) {
  const g = parseInt(gamePk, 10);
  if (!g) return null;
  // /feed/live lives on v1.1 (not v1) — going through mlbStatsApiBaseUrl_()
  // would point at /api/v1/... and return 404. Hardcode the host here.
  const url = 'https://statsapi.mlb.com/api/v1.1/game/' + g + '/feed/live';
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

/**
 * @returns {number|null} hits recorded in this game for MLB batter person id.
 * Returns null if the player did not bat (no batting line in boxscore).
 */
function mlbBatterHitsFromBoxscore_(payload, batterId) {
  const teams = mlbBoxscoreTeams_(payload);
  if (!teams) return null;
  const pid   = 'ID' + parseInt(batterId, 10);
  const sides = ['away', 'home'];
  for (let s = 0; s < sides.length; s++) {
    const t  = teams[sides[s]];
    const pl = t && t.players && t.players[pid];
    const bat = pl && pl.stats && pl.stats.batting;
    // atBats presence confirms batter actually played
    if (bat && bat.hits != null && bat.atBats != null) {
      return parseInt(bat.hits, 10) || 0;
    }
  }
  return null;
}

/** @returns {number|null} total bases for this batter in this game */
function mlbBatterTotalBasesFromBoxscore_(payload, batterId) {
  const teams = mlbBoxscoreTeams_(payload);
  if (!teams) return null;
  const pid   = 'ID' + parseInt(batterId, 10);
  const sides = ['away', 'home'];
  for (let s = 0; s < sides.length; s++) {
    const t  = teams[sides[s]];
    const pl = t && t.players && t.players[pid];
    const bat = pl && pl.stats && pl.stats.batting;
    if (bat && bat.atBats != null) {
      // Prefer direct totalBases when shipped; else derive from hit components.
      if (bat.totalBases != null && bat.totalBases !== '') {
        return parseInt(bat.totalBases, 10) || 0;
      }
      const h  = parseInt(bat.hits, 10)      || 0;
      const d  = parseInt(bat.doubles, 10)   || 0;
      const tr = parseInt(bat.triples, 10)   || 0;
      const hr = parseInt(bat.homeRuns, 10)  || 0;
      return h + d + 2 * tr + 3 * hr;
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

/**
 * Resolve a batter's MLB person ID from name + slate, using the cached
 * season hitting stats (filled by mlbFetchAllHitterBatStats_). Lets the
 * grader retroactively fill empty player_id on historical batter rows.
 * @returns {number|null}
 */
function mlbResolveBatterIdFromStats_(slateYmd, playerName) {
  const yr = parseInt(String(slateYmd).slice(0, 4), 10) || new Date().getFullYear();
  const statsById = mlbFetchAllHitterBatStats_(yr);
  if (!statsById) return null;
  const byName = mlbHitterBatStatsByName_(statsById);
  const norm = mlbNormalizePersonName_(playerName);
  const hit = byName[norm];
  return hit && hit.playerId ? parseInt(hit.playerId, 10) || null : null;
}

/**
 * Convert a slate cell (string or Date) into a 'yyyy-MM-dd' string.
 * Sheets auto-converts strings that look like dates into Date objects on
 * write, so reads come back as Date — string compares against today (a
 * 'yyyy-MM-dd' string) silently fail unless we normalize here.
 */
function mlbReadSlateYmd_(v) {
  if (v === '' || v == null) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(v).trim();
}

/**
 * Walk through grading a SINGLE past-slate PENDING row and report every
 * step. Used to diagnose why bulk grading is silently failing. Picks the
 * first row matching: past slate, K/H/TB market, PENDING result.
 */
function mlbTestGradeOneRow_() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logSh = ss.getSheetByName(MLB_RESULTS_LOG_TAB);
  if (!logSh || logSh.getLastRow() < 4) { ui.alert('No log.'); return; }

  const today = mlbTodayYmdNY_();
  const data = logSh.getRange(4, 1, logSh.getLastRow(), MLB_RESULTS_LOG_NCOL).getValues();
  const steps = [];
  steps.push('TODAY: ' + today);

  // Find a candidate row
  let pick = -1;
  for (let i = 0; i < data.length; i++) {
    const slate = mlbReadSlateYmd_(data[i][1]);
    const market = String(data[i][5] || '').toLowerCase();
    const result = String(data[i][16] || '').trim();
    if (!slate || slate >= today) continue;
    const isK   = market.indexOf('strikeout')  !== -1;
    const isHit = market.indexOf('batter hit') !== -1;
    const isTb  = market.indexOf('total base') !== -1;
    if (!isK && !isHit && !isTb) continue;
    if (result && result !== 'PENDING') continue;
    pick = i;
    break;
  }
  if (pick < 0) {
    ui.alert('No qualifying row to test (need past slate, K/H/TB market, PENDING).');
    return;
  }

  const row = data[pick];
  const slate   = mlbReadSlateYmd_(row[1]);
  const player  = String(row[3] || '').trim();
  const matchup = String(row[4] || '').trim();
  const market  = String(row[5] || '').toLowerCase();
  const line    = row[6];
  const side    = row[7];
  let   gamePk  = parseInt(row[13], 10);
  let   pid     = parseInt(row[14], 10);

  steps.push('ROW (sheet row ' + (4 + pick) + '): ' + player + ' · ' + market + ' · slate ' + slate);
  steps.push('  initial gamePk=' + (isNaN(gamePk) ? 'EMPTY' : gamePk) + ' · pid=' + (isNaN(pid) ? 'EMPTY' : pid));

  const isHit = market.indexOf('batter hit') !== -1;
  const isTb  = market.indexOf('total base') !== -1;
  const isBatter = isHit || isTb;

  // Resolution
  if ((!gamePk || isNaN(gamePk)) && slate && matchup) {
    try {
      gamePk = mlbResolveGamePkFromSchedule_(slate, matchup, player);
      steps.push('  resolved gamePk from schedule: ' + gamePk);
    } catch (e) {
      steps.push('  resolveGamePk THREW: ' + e.message);
    }
  }
  if (!isBatter && (!pid || isNaN(pid)) && slate && matchup && player) {
    try {
      pid = mlbResolvePitcherIdFromSchedule_(slate, matchup, player);
      steps.push('  resolved pitcher pid: ' + pid);
    } catch (e) {
      steps.push('  resolvePitcherId THREW: ' + e.message);
    }
  }
  if (isBatter && (!pid || isNaN(pid)) && player) {
    try {
      pid = mlbResolveBatterIdFromStats_(slate, player);
      steps.push('  resolved batter pid: ' + pid);
    } catch (e) {
      steps.push('  resolveBatterId THREW: ' + e.message);
    }
  }
  if (!gamePk || isNaN(gamePk)) {
    steps.push('  STOP: still missing gamePk');
    ui.alert('mlbTestGradeOneRow_', steps.join('\n'), ui.ButtonSet.OK);
    return;
  }
  if (!pid || isNaN(pid)) {
    steps.push('  STOP: still missing pid');
    ui.alert('mlbTestGradeOneRow_', steps.join('\n'), ui.ButtonSet.OK);
    return;
  }

  // Fetch
  const fetchUrl = 'https://statsapi.mlb.com/api/v1.1/game/' + gamePk + '/feed/live';
  steps.push('FETCH: ' + fetchUrl);
  let resCode = 'n/a';
  let box = null;
  try {
    const res = UrlFetchApp.fetch(fetchUrl, { muteHttpExceptions: true });
    resCode = res.getResponseCode();
    steps.push('  HTTP ' + resCode);
    if (resCode === 200) box = JSON.parse(res.getContentText());
  } catch (e) {
    steps.push('  fetch THREW: ' + e.message);
  }
  if (!box) {
    ui.alert('mlbTestGradeOneRow_', steps.join('\n'), ui.ButtonSet.OK);
    return;
  }

  // Status check
  const abs1 = box.gameData && box.gameData.status && box.gameData.status.abstractGameState;
  const det1 = box.gameData && box.gameData.status && box.gameData.status.detailedState;
  const abs2 = box.liveData && box.liveData.game && box.liveData.game.status && box.liveData.game.status.abstractGameState;
  steps.push('STATUS: gameData.status.abstract=' + abs1 + ' · detailed=' + det1 + ' · liveData.game.status.abstract=' + abs2);
  const isFinal = mlbBoxscoreIsFinal_(box);
  steps.push('  mlbBoxscoreIsFinal_() = ' + isFinal);
  if (!isFinal) {
    // Try re-resolving gamePk from schedule
    steps.push('  retrying with schedule-resolved gamePk for slate ' + slate);
    let altPk = null;
    try {
      altPk = mlbResolveGamePkFromSchedule_(slate, matchup, player);
      steps.push('    altPk = ' + altPk);
    } catch (e) {
      steps.push('    resolve THREW: ' + e.message);
    }
    if (altPk && altPk !== gamePk) {
      try {
        const res2 = UrlFetchApp.fetch('https://statsapi.mlb.com/api/v1.1/game/' + altPk + '/feed/live', { muteHttpExceptions: true });
        steps.push('    retry HTTP ' + res2.getResponseCode());
        if (res2.getResponseCode() === 200) {
          const box2 = JSON.parse(res2.getContentText());
          const isFinal2 = mlbBoxscoreIsFinal_(box2);
          const det2 = box2.gameData && box2.gameData.status && box2.gameData.status.detailedState;
          steps.push('    retry status detailed=' + det2 + ' · isFinal=' + isFinal2);
          if (isFinal2) {
            steps.push('    RETRY SUCCESS — would grade against altPk ' + altPk);
            box = box2;
            gamePk = altPk;
          }
        }
      } catch (e) {
        steps.push('    retry THREW: ' + e.message);
      }
    } else {
      steps.push('    no alternate gamePk available');
    }
    if (!mlbBoxscoreIsFinal_(box)) {
      steps.push('  STOP: still NOT_FINAL after retry — would VOID if past slate ≥2 days');
      ui.alert('mlbTestGradeOneRow_', steps.join('\n'), ui.ButtonSet.OK);
      return;
    }
  }

  // Stat extraction
  let actual = null;
  try {
    actual = isHit
      ? mlbBatterHitsFromBoxscore_(box, pid)
      : isTb
        ? mlbBatterTotalBasesFromBoxscore_(box, pid)
        : mlbPitcherKsFromBoxscore_(box, pid);
    steps.push('STAT EXTRACTION: actual=' + actual);
  } catch (e) {
    steps.push('STAT EXTRACTION THREW: ' + e.message);
  }
  if (actual === null) {
    steps.push('  → would write VOID (DNP / inactive)');
  } else {
    const g = mlbGradePitcherKRow_(line, side, actual);
    steps.push('  → grade = ' + g.result + ' · ' + g.note);
  }

  ui.alert('mlbTestGradeOneRow_', steps.join('\n'), ui.ButtonSet.OK);
}

/**
 * One-shot read-only diagnostic over MLB_Results_Log: shows total rows,
 * breakdown by result + market, slate buckets, and how many rows are
 * missing gamePk / player_id. Helps explain why grader is skipping rows.
 */
function mlbDiagnoseResultsLog_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const log = ss.getSheetByName(MLB_RESULTS_LOG_TAB);
  if (!log || log.getLastRow() < 4) {
    SpreadsheetApp.getUi().alert('Results Log', 'No rows.', SpreadsheetApp.getUi().ButtonSet.OK);
    return;
  }
  const data = log.getRange(4, 1, log.getLastRow(), MLB_RESULTS_LOG_NCOL).getValues();
  const today = mlbTodayYmdNY_();

  let total = 0;
  const byResult = {};
  const byMarket = {};
  const slateBuckets = { today: 0, past: 0, future: 0, blank: 0 };
  const noteSamples = {};
  let pendingTotal = 0;
  let pendingPastWithIds = 0;
  let pendingPastMissingGp = 0;
  let pendingPastMissingPid = 0;

  for (let i = 0; i < data.length; i++) {
    total++;
    const slate  = mlbReadSlateYmd_(data[i][1]);
    const market = String(data[i][5] || '').toLowerCase();
    const result = String(data[i][16] || '').trim() || '(empty)';
    const note   = String(data[i][17] || '').trim();
    const gp     = parseInt(data[i][13], 10);
    const pid    = parseInt(data[i][14], 10);

    byResult[result] = (byResult[result] || 0) + 1;
    byMarket[market || '(empty)'] = (byMarket[market || '(empty)'] || 0) + 1;

    if (!slate)             slateBuckets.blank++;
    else if (slate === today) slateBuckets.today++;
    else if (slate <  today)  slateBuckets.past++;
    else                      slateBuckets.future++;

    if (note) {
      const trimNote = note.length > 60 ? note.substring(0, 60) + '…' : note;
      noteSamples[trimNote] = (noteSamples[trimNote] || 0) + 1;
    }

    if (result === 'PENDING' || result === '(empty)') {
      pendingTotal++;
      if (slate && slate < today) {
        const noGp = !gp || isNaN(gp);
        const noPid = !pid || isNaN(pid);
        if (noGp) pendingPastMissingGp++;
        if (noPid) pendingPastMissingPid++;
        if (!noGp && !noPid) pendingPastWithIds++;
      }
    }
  }

  let msg = 'TOTAL ROWS: ' + total + '\n';
  msg += 'TODAY: ' + today + '\n\n';

  msg += 'BY RESULT:\n';
  Object.keys(byResult).sort().forEach(function (k) { msg += '  ' + k + ': ' + byResult[k] + '\n'; });

  msg += '\nBY MARKET:\n';
  Object.keys(byMarket).sort().forEach(function (k) { msg += '  ' + k + ': ' + byMarket[k] + '\n'; });

  msg += '\nSLATE BUCKETS:  today=' + slateBuckets.today
       + ' · past=' + slateBuckets.past
       + ' · future=' + slateBuckets.future
       + ' · blank=' + slateBuckets.blank + '\n';

  msg += '\nPENDING / past slate breakdown (what the grader works on):\n';
  msg += '  with both IDs (gradeable): ' + pendingPastWithIds + '\n';
  msg += '  missing gamePk: ' + pendingPastMissingGp + '\n';
  msg += '  missing player_id: ' + pendingPastMissingPid + '\n';
  msg += '  total pending (any slate): ' + pendingTotal + '\n';

  if (Object.keys(noteSamples).length) {
    msg += '\nGRADE NOTES (sample, top 10):\n';
    Object.keys(noteSamples)
      .sort(function (a, b) { return noteSamples[b] - noteSamples[a]; })
      .slice(0, 10)
      .forEach(function (k) { msg += '  ' + noteSamples[k] + 'x · ' + k + '\n'; });
  }

  SpreadsheetApp.getUi().alert('MLB Results Log diagnosis', msg, SpreadsheetApp.getUi().ButtonSet.OK);
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
    const slateStr = mlbReadSlateYmd_(row[1]);
    const market = String(row[5] || '').toLowerCase();
    const resCell = String(row[16] || '').trim();
    if (!slateStr || slateStr >= today) {
      continue;
    }
    const isK   = market.indexOf('strikeout')   !== -1;
    const isHit = market.indexOf('batter hit')  !== -1;
    const isTb  = market.indexOf('total base')  !== -1;
    if (!isK && !isHit && !isTb) continue;
    if (resCell && resCell !== 'PENDING') continue;

    let gamePk = parseInt(row[13], 10);
    let pid    = parseInt(row[14], 10);
    const matchup = String(row[4] || '').trim();
    const player  = String(row[3] || '').trim();
    const line    = row[6];
    const side    = row[7];

    if ((!gamePk || isNaN(gamePk)) && slateStr && matchup) {
      gamePk = mlbResolveGamePkFromSchedule_(slateStr, matchup, player);
    }
    // For pitcher markets: resolve pitcher ID if missing
    // For batter markets (hits, total bases): resolve batter ID from cached
    // season hitting stats (Stats API)
    const isBatter = isHit || isTb;
    if (!isBatter && (!pid || isNaN(pid)) && slateStr && matchup && player) {
      pid = mlbResolvePitcherIdFromSchedule_(slateStr, matchup, player);
    }
    if (isBatter && (!pid || isNaN(pid)) && player) {
      pid = mlbResolveBatterIdFromStats_(slateStr, player);
    }
    if (!gamePk || isNaN(gamePk)) {
      logSh.getRange(4 + i, 18).setValue('Missing gamePk — re-run snapshot after refresh');
      continue;
    }
    if (!pid || isNaN(pid)) {
      logSh.getRange(4 + i, 18).setValue('Missing player_id — re-run snapshot after refresh');
      continue;
    }

    let box = mlbFetchBoxscoreJson_(gamePk);
    Utilities.sleep(120);
    if (!box) {
      logSh.getRange(4 + i, 18).setValue('Boxscore fetch failed');
      continue;
    }
    // If feed shows not-final for a past slate, the stored gamePk may
    // point at a rescheduled/relocated future game. Re-resolve gamePk
    // from the schedule for this slate's actual date and retry once.
    if (!mlbBoxscoreIsFinal_(box) && slateStr && matchup) {
      const altPk = mlbResolveGamePkFromSchedule_(slateStr, matchup, player);
      if (altPk && altPk !== gamePk) {
        const box2 = mlbFetchBoxscoreJson_(altPk);
        Utilities.sleep(120);
        if (box2 && mlbBoxscoreIsFinal_(box2)) {
          gamePk = altPk;
          box = box2;
        }
      }
    }
    if (!mlbBoxscoreIsFinal_(box)) {
      // Past-slate row that still can't find a finished game: most likely
      // the game was postponed and never played on this date. VOID it
      // (≥2 days old) so it stops getting retried; otherwise leave PENDING.
      const ageMs = new Date(today + 'T00:00:00').getTime() - new Date(slateStr + 'T00:00:00').getTime();
      const daysOld = Math.floor(ageMs / 86400000);
      if (daysOld >= 2) {
        logSh.getRange(4 + i, 17).setValue('VOID');
        logSh.getRange(4 + i, 18).setValue('Game not played on this slate (postponed/relocated)');
        graded++;
      } else {
        logSh.getRange(4 + i, 18).setValue('NOT_FINAL — will retry later');
      }
      continue;
    }

    const actualStat = isHit
      ? mlbBatterHitsFromBoxscore_(box, pid)
      : isTb
        ? mlbBatterTotalBasesFromBoxscore_(box, pid)
        : mlbPitcherKsFromBoxscore_(box, pid);
    if (actualStat === null) {
      logSh.getRange(4 + i, 16).setValue('');
      logSh.getRange(4 + i, 17).setValue('VOID');
      logSh.getRange(4 + i, 18).setValue(
        isBatter ? 'No batting line (DNP / inactive?)' : 'No pitching line (DNP / bullpen-only?)'
      );
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
