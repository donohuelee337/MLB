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

// ============================================================
// ⚠️  REGRESSION GUARD — DO NOT CHANGE THE URL BELOW TO /boxscore  ⚠️
// ============================================================
// This URL has been silently reverted to /boxscore THREE times by GAS→git
// syncs (commits 4e7ceb9, f8f38d4, ...). Each time, every past-slate row
// gets "NOT_FINAL — will retry later" because /boxscore (v1) omits
// gameData.status — mlbBoxscoreIsFinal_ then returns false on every payload
// and the results tracker shows only dashes. mlbGraderSelfTest_() runs at
// the start of every pipeline window to catch a regression immediately.
// See: feedback_grader_endpoint.md memory entry.
// ============================================================
const MLB_GRADER_FEED_URL_TEMPLATE = 'https://statsapi.mlb.com/api/v1.1/game/{pk}/feed/live';

/**
 * Fetch game payload for grading. Uses /feed/live (v1.1). Carries both
 * liveData.boxscore.teams (player stats) and the status blocks isFinal needs.
 * Function name kept as ...BoxscoreJson_ so callers don't need to change.
 *
 * Cached by gamePk for the duration of the execution. Six graders run
 * back-to-back (K live, H v2, TB v2, TB v3, H v3, HR promo) and many
 * games have multiple pending rows; without the cache we were re-fetching
 * the same JSON 10-50x per slate. Module state resets between Apps Script
 * executions, so each Morning/Midday/Final run starts with a cold cache.
 *
 * The 120ms throttle now lives INSIDE this function and only fires on
 * cache miss — callers no longer need to sleep after calling.
 */
var __mlbBoxscoreJsonCache = {};

function mlbResetBoxscoreJsonCache_() {
  __mlbBoxscoreJsonCache = {};
}

function mlbFetchBoxscoreJson_(gamePk) {
  const g = parseInt(gamePk, 10);
  if (!g) return null;
  if (Object.prototype.hasOwnProperty.call(__mlbBoxscoreJsonCache, g)) {
    return __mlbBoxscoreJsonCache[g];
  }
  // Throttle the upstream API on cache miss — was previously the caller's job.
  Utilities.sleep(120);
  const url = MLB_GRADER_FEED_URL_TEMPLATE.replace('{pk}', String(g));
  let out = null;
  try {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() === 200) {
      out = JSON.parse(res.getContentText());
    }
  } catch (e) {
    Logger.log('mlbFetchBoxscoreJson_: ' + e.message);
  }
  // Cache null too — a missing game shouldn't be retried 5 more times.
  __mlbBoxscoreJsonCache[g] = out;
  return out;
}

/**
 * Self-test the grader plumbing end-to-end. Picks a known-final game from
 * yesterday's NY schedule and walks the full path: fetch → isFinal → teams.
 * Failures are reported to Pipeline_Log so a silent regression (especially
 * /feed/live → /boxscore on GAS-sync) is impossible to ship unnoticed.
 *
 * @returns {{ ok: boolean, note: string, gamePk: number }}
 */
function mlbGraderSelfTest_() {
  const tz = 'America/New_York';
  const yest = Utilities.formatDate(new Date(Date.now() - 86400000), tz, 'yyyy-MM-dd');
  let sched = null;
  try {
    sched = mlbFetchScheduleJsonForDate_(yest);
  } catch (e) {
    return { ok: false, note: 'self-test: schedule fetch threw: ' + e.message, gamePk: 0 };
  }
  if (!sched || !sched.dates || !sched.dates.length || !sched.dates[0].games || !sched.dates[0].games.length) {
    return { ok: true, note: 'self-test: skipped — no scheduled games on ' + yest + ' (offseason / off-day)', gamePk: 0 };
  }
  // Prefer the first game that statsapi marks as Final on the schedule itself
  // so the test isn't fooled by a postponed game.
  const games = sched.dates[0].games;
  let gamePk = 0;
  for (let i = 0; i < games.length; i++) {
    const st = games[i].status || {};
    const abs = String(st.abstractGameState || '').toLowerCase();
    if (abs === 'final') { gamePk = parseInt(games[i].gamePk, 10); break; }
  }
  if (!gamePk) gamePk = parseInt(games[0].gamePk, 10);
  if (!gamePk) return { ok: false, note: 'self-test: no usable gamePk on ' + yest, gamePk: 0 };

  const box = mlbFetchBoxscoreJson_(gamePk);
  if (!box) {
    return {
      ok: false,
      note: 'self-test: fetch failed for gamePk=' + gamePk + ' — feed/live unreachable or URL regressed',
      gamePk: gamePk,
    };
  }
  if (!mlbBoxscoreIsFinal_(box)) {
    return {
      ok: false,
      note:
        'self-test: isFinal=false on a scheduled-Final game (gamePk=' +
        gamePk +
        '). LIKELY /boxscore REGRESSION — check MLBResultsGrader.js URL must contain /feed/live.',
      gamePk: gamePk,
    };
  }
  if (!mlbBoxscoreTeams_(box)) {
    return { ok: false, note: 'self-test: liveData.boxscore.teams missing on gamePk=' + gamePk, gamePk: gamePk };
  }
  return { ok: true, note: 'self-test: ok (gamePk=' + gamePk + ' isFinal=true, teams present)', gamePk: gamePk };
}

/**
 * Normalize a slate cell (Date or string) to 'yyyy-MM-dd'. Sheets auto-converts
 * yyyy-MM-dd strings to Date on write; reads come back as Date, so
 * `String(date) >= 'yyyy-MM-dd'` puts every slate in the "future" bucket and the
 * grader silently skips every row.
 */
function mlbReadSlateYmd_(cell) {
  if (cell == null || cell === '') return '';
  if (Object.prototype.toString.call(cell) === '[object Date]') {
    return Utilities.formatDate(cell, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  const s = String(cell).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return s;
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

/** @returns {number|null} decimal IP from boxscore pitching line */
function mlbPitcherIpFromBoxscore_(payload, pitcherId) {
  const teams = mlbBoxscoreTeams_(payload);
  if (!teams) return null;
  const pid = 'ID' + parseInt(pitcherId, 10);
  const sides = ['away', 'home'];
  for (let s = 0; s < sides.length; s++) {
    const t = teams[sides[s]];
    const pl = t && t.players && t.players[pid];
    const pit = pl && pl.stats && pl.stats.pitching;
    if (pit && String(pit.inningsPitched || '').trim() !== '') {
      const ip =
        typeof mlbParseInningsString_ === 'function'
          ? mlbParseInningsString_(pit.inningsPitched)
          : parseFloat(pit.inningsPitched);
      return isNaN(ip) ? null : Math.round(ip * 1000) / 1000;
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

/** @returns {Array|null} innings array from feed/live linescore */
function mlbLinescoreInningsFromPayload_(payload) {
  if (!payload) return null;
  const live = payload.liveData && payload.liveData.linescore;
  if (live && live.innings && live.innings.length) return live.innings;
  const teams = mlbBoxscoreTeams_(payload);
  if (teams && teams.home && teams.home.linescore && teams.home.linescore.innings) {
    return teams.home.linescore.innings;
  }
  return null;
}

/**
 * Sum runs through inning `maxInning` (inclusive). Returns null when linescore
 * is missing or the game did not reach `maxInning`.
 */
function mlbLinescoreRunsThroughInning_(payload, maxInning) {
  const innings = mlbLinescoreInningsFromPayload_(payload);
  const max = parseInt(maxInning, 10);
  if (!innings || !innings.length || isNaN(max) || max < 1) return null;
  let away = 0;
  let home = 0;
  let sawMax = false;
  for (let i = 0; i < innings.length; i++) {
    const inn = innings[i];
    const num = parseInt(inn.num, 10);
    if (isNaN(num) || num > max) continue;
    if (num === max) sawMax = true;
    away += parseInt(inn.away && inn.away.runs, 10) || 0;
    home += parseInt(inn.home && inn.home.runs, 10) || 0;
  }
  if (!sawMax) return null;
  return { away: away, home: home, total: away + home };
}

/** Combined runs in the 1st inning only (NRFI/YRFI). */
function mlbFirstInningTotalRunsFromBoxscore_(payload) {
  const r = mlbLinescoreRunsThroughInning_(payload, 1);
  return r ? r.total : null;
}

/** Combined runs innings 1–5 inclusive (F5 totals). */
function mlbFirstFiveInningsTotalRunsFromBoxscore_(payload) {
  const r = mlbLinescoreRunsThroughInning_(payload, 5);
  return r ? r.total : null;
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
  // Grader runs before the snapshot each window — make sure the grid is wide
  // enough for the NCOL-wide read after the model_version column (39) landed.
  if (typeof mlbEnsureResultsLogModelVersionCol_ === 'function') {
    mlbEnsureResultsLogModelVersionCol_(logSh);
  }

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
    if (resCell && resCell !== 'PENDING') continue;

    let gamePk = parseInt(row[13], 10);
    let pid = parseInt(row[14], 10);
    const matchup = String(row[4] || '').trim();
    const player = String(row[3] || '').trim();
    // Grade the bet AS STRUCK: the snapshot upsert refreshes Line/Odds (cols
    // 7/9) every window, so by grading time they hold the CLOSING values.
    // open_line/open_odds (cols 23/24) are frozen at first log — that's the
    // executed bet. Fall back to current only for legacy rows logged before
    // the open_* columns existed.
    const openLine = row[22];
    const line = openLine !== '' && openLine != null ? openLine : row[6];
    const side = row[7];

    if ((!gamePk || isNaN(gamePk)) && slateStr && matchup) {
      gamePk = mlbResolveGamePkFromSchedule_(slateStr, matchup, player);
    }

    const isK = market.indexOf('strikeout') !== -1;
    const isTb = market.indexOf('total base') !== -1;
    const isHits = market.indexOf('batter hits') !== -1;
    if (!isK && !isTb && !isHits) continue;

    if (isK) {
      if ((!pid || isNaN(pid)) && slateStr && matchup && player) {
        pid = mlbResolvePitcherIdFromSchedule_(slateStr, matchup, player);
      }
    } else if (isTb || isHits) {
      if ((!pid || isNaN(pid)) && player) {
        pid = mlbStatsApiResolvePlayerIdFromName_(player);
      }
    }

    if (!gamePk || isNaN(gamePk) || !pid || isNaN(pid)) {
      logSh.getRange(4 + i, 18).setValue('Missing gamePk or player_id — re-run snapshot / check name→id');
      continue;
    }

    // mlbFetchBoxscoreJson_ caches by gamePk and self-throttles on miss
    // (was 120ms here per call — removed; cache hits now return instantly).
    let box = mlbFetchBoxscoreJson_(gamePk);
    if (!box) {
      logSh.getRange(4 + i, 18).setValue('Feed/live fetch failed');
      continue;
    }
    // Past-slate row reports not-final: stored gamePk may point at a
    // rescheduled/relocated game (esp. doubleheaders). Re-resolve from
    // schedule for this slate and retry once.
    if (!mlbBoxscoreIsFinal_(box) && slateStr && matchup) {
      const altPk = mlbResolveGamePkFromSchedule_(slateStr, matchup, player);
      if (altPk && altPk !== gamePk) {
        const box2 = mlbFetchBoxscoreJson_(altPk);
        if (box2 && mlbBoxscoreIsFinal_(box2)) {
          gamePk = altPk;
          box = box2;
        }
      }
    }
    if (!mlbBoxscoreIsFinal_(box)) {
      // ≥2 days old + still not final = postponed/relocated. VOID it so it stops
      // being retried forever; otherwise leave PENDING for a later window.
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

    const stake = row[24];
    const openOdds = row[23];
    const odds = openOdds !== '' && openOdds != null ? openOdds : row[8];

    function writePnl(result) {
      const pnl = mlbPnlFromResult_(result, stake, odds);
      if (stake !== '' && stake != null && !isNaN(parseFloat(stake))) {
        logSh.getRange(4 + i, 26).setValue(pnl);
      }
    }

    if (isK) {
      const kActual = mlbPitcherKsFromBoxscore_(box, pid);
      if (kActual === null) {
        logSh.getRange(4 + i, 16).setValue('');
        logSh.getRange(4 + i, 17).setValue('VOID');
        logSh.getRange(4 + i, 18).setValue('No pitching line (DNP / bullpen-only?)');
        writePnl('VOID');
        graded++;
        continue;
      }

      const g = mlbGradePitcherKRow_(line, side, kActual);
      const ipActual = mlbPitcherIpFromBoxscore_(box, pid);
      const projIpStored = row[34];
      const ipErr =
        ipActual != null && typeof mlbIpError_ === 'function'
          ? mlbIpError_(ipActual, projIpStored)
          : '';
      logSh.getRange(4 + i, 14).setValue(gamePk);
      logSh.getRange(4 + i, 15).setValue(pid);
      logSh.getRange(4 + i, 16).setValue(kActual);
      logSh.getRange(4 + i, 17).setValue(g.result);
      let gradeNote = 'statsapi boxscore · ' + g.note;
      if (ipActual != null) {
        gradeNote += ' · IP ' + ipActual;
        if (ipErr !== '') gradeNote += ' (ΔIP ' + ipErr + ')';
      }
      logSh.getRange(4 + i, 18).setValue(gradeNote);
      if (ipActual != null) {
        logSh.getRange(4 + i, 37).setValue(ipActual);
        if (ipErr !== '') logSh.getRange(4 + i, 38).setValue(ipErr);
      }
      writePnl(g.result);
      graded++;
      continue;
    }

    if (isTb) {
      const tbActual = mlbBatterTbFromBoxscore_(box, pid);
      if (tbActual === null) {
        logSh.getRange(4 + i, 16).setValue('');
        logSh.getRange(4 + i, 17).setValue('VOID');
        logSh.getRange(4 + i, 18).setValue('No batting line (DNP?)');
        writePnl('VOID');
        graded++;
        continue;
      }

      const gt = mlbGradePitcherKRow_(line, side, tbActual);
      logSh.getRange(4 + i, 14).setValue(gamePk);
      logSh.getRange(4 + i, 15).setValue(pid);
      logSh.getRange(4 + i, 16).setValue(tbActual);
      logSh.getRange(4 + i, 17).setValue(gt.result);
      logSh.getRange(4 + i, 18).setValue('statsapi boxscore TB · ' + gt.note);
      writePnl(gt.result);
      graded++;
      continue;
    }

    const hActual = mlbBatterHitsFromBoxscore_(box, pid);
    if (hActual === null) {
      logSh.getRange(4 + i, 16).setValue('');
      logSh.getRange(4 + i, 17).setValue('VOID');
      logSh.getRange(4 + i, 18).setValue('No batting line (DNP?)');
      writePnl('VOID');
      graded++;
      continue;
    }

    const gh = mlbGradePitcherKRow_(line, side, hActual);
    logSh.getRange(4 + i, 14).setValue(gamePk);
    logSh.getRange(4 + i, 15).setValue(pid);
    logSh.getRange(4 + i, 16).setValue(hActual);
    logSh.getRange(4 + i, 17).setValue(gh.result);
    logSh.getRange(4 + i, 18).setValue('statsapi boxscore H · ' + gh.note);
    writePnl(gh.result);
    graded++;
  }

  if (graded > 0) {
    try {
      ss.toast('Graded ' + graded + ' MLB result row(s)', 'MLB-BOIZ', 6);
    } catch (e) {}
  }
}
