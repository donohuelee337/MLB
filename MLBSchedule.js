// ============================================================
// 📅 MLB schedule + probable pitchers — statsapi.mlb.com
// ============================================================
// Free JSON API, no key. Same spirit as AI-BOIZ: one tab of slate context.
// ============================================================

const MLB_SCHEDULE_TAB = '📅 MLB_Schedule';

// ── schedule block cache ──────────────────────────────────────────────────
// The schedule tab has ~15-16 rows per slate. Every batter card (TB v2,
// Hits v2, TB v3, Hits v3) reads this sheet 3+ times per batter, so with
// 270 batters × 4 cards that's 3000+ GAS I/O calls at ~100 ms each ≈ 5 min
// of pure sheet-read overhead. Cache the whole block once per execution.
// ─────────────────────────────────────────────────────────────────────────
var __mlbScheduleBlockCache = null;

function mlbResetScheduleBlockCache_() {
  __mlbScheduleBlockCache = null;
}

/**
 * Returns the schedule data block (2-D array, row-major, 0-based col indices)
 * for the current slate. Reads the sheet exactly once per execution; all
 * subsequent calls return the cached array instantly.
 *
 * Column layout (mirrors fetchMLBScheduleForSlate writer):
 *  [0]  gamePk          [1]  date           [2]  gameDateRaw
 *  [3]  awayAbbr        [4]  homeAbbr       [5]  matchup
 *  [6]  awayProbName    [7]  homeProbName   [8]  venue
 *  [9]  status          [10] series
 *  [11] awayProbId      [12] homeProbId     [13] homePlateUmpire
 */
function mlbGetScheduleBlock_(ss) {
  if (__mlbScheduleBlockCache !== null) return __mlbScheduleBlockCache;
  const sh = ss.getSheetByName(MLB_SCHEDULE_TAB);
  if (!sh || sh.getLastRow() < 4) {
    __mlbScheduleBlockCache = [];
    return __mlbScheduleBlockCache;
  }
  const dataRows = sh.getLastRow() - 3;
  __mlbScheduleBlockCache = sh.getRange(4, 1, dataRows, 14).getValues();
  return __mlbScheduleBlockCache;
}

/**
 * Finds the probable SP on the OPPOSITE side from the batter's team for a
 * given gamePk. Consolidates the identical logic that was duplicated in
 * mlbTbV2OpposingProbableSp_ and mlbHitsV2OpposingProbableSp_.
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @param {number|string} gamePk
 * @param {string} batterTeamAbbr
 * @returns {{ id: number, name: string, throws: string }|null}
 */
function mlbGetOpposingProbableSp_(ss, gamePk, batterTeamAbbr) {
  const g = parseInt(gamePk, 10);
  if (!g) return null;
  const block = mlbGetScheduleBlock_(ss);
  if (!block.length) return null;
  const wantBat = mlbCanonicalTeamAbbr_(batterTeamAbbr);
  for (let i = 0; i < block.length; i++) {
    if (parseInt(block[i][0], 10) !== g) continue;
    const away = mlbCanonicalTeamAbbr_(block[i][3]);
    const home = mlbCanonicalTeamAbbr_(block[i][4]);
    const awayProb = String(block[i][6] || '').trim();
    const homeProb = String(block[i][7] || '').trim();
    const awayProbId = parseInt(block[i][11], 10);
    const homeProbId = parseInt(block[i][12], 10);
    if (wantBat && wantBat === away) {
      let id = homeProbId;
      if (!id && homeProb && typeof mlbStatsApiResolvePlayerIdFromName_ === 'function') {
        id = parseInt(mlbStatsApiResolvePlayerIdFromName_(homeProb), 10) || 0;
      }
      return id ? { id: id, name: homeProb, throws: '' } : null;
    }
    if (wantBat && wantBat === home) {
      let id = awayProbId;
      if (!id && awayProb && typeof mlbStatsApiResolvePlayerIdFromName_ === 'function') {
        id = parseInt(mlbStatsApiResolvePlayerIdFromName_(awayProb), 10) || 0;
      }
      return id ? { id: id, name: awayProb, throws: '' } : null;
    }
    return null;
  }
  return null;
}

/**
 * Opposing team abbreviation for a batter in a game (the team the batter
 * faces — same side as the probable SP). Uses cached schedule block.
 */
function mlbScheduleOppTeamAbbrForBatter_(ss, gamePk, batterTeamAbbr) {
  const g = parseInt(gamePk, 10);
  const want = mlbCanonicalTeamAbbr_(batterTeamAbbr);
  if (!g || !want) return '';
  const block = mlbGetScheduleBlock_(ss);
  for (let i = 0; i < block.length; i++) {
    if (parseInt(block[i][0], 10) !== g) continue;
    const away = mlbCanonicalTeamAbbr_(block[i][3]);
    const home = mlbCanonicalTeamAbbr_(block[i][4]);
    if (want === away) return home;
    if (want === home) return away;
    return '';
  }
  return '';
}

/**
 * Resolve probable SP context from gamePk + SP name (e.g. opp_sp_name off the
 * v2 hits card). Fallback when batter-team lookup fails but v2 already matched
 * the opposing starter.
 *
 * @returns {{ spId: number, spName: string, oppAbbr: string, batAbbr: string }|null}
 */
function mlbScheduleSpContextByName_(ss, gamePk, spName) {
  const g = parseInt(gamePk, 10);
  const want = mlbNormalizePersonName_(spName);
  if (!g || !want) return null;
  const block = mlbGetScheduleBlock_(ss);
  for (let i = 0; i < block.length; i++) {
    if (parseInt(block[i][0], 10) !== g) continue;
    const awayProb = String(block[i][6] || '').trim();
    const homeProb = String(block[i][7] || '').trim();
    const awayProbId = parseInt(block[i][11], 10);
    const homeProbId = parseInt(block[i][12], 10);
    const away = mlbCanonicalTeamAbbr_(block[i][3]);
    const home = mlbCanonicalTeamAbbr_(block[i][4]);
    if (mlbNormalizePersonName_(awayProb) === want) {
      let spId = awayProbId;
      if (!spId && typeof mlbStatsApiResolvePlayerIdFromName_ === 'function') {
        spId = parseInt(mlbStatsApiResolvePlayerIdFromName_(awayProb), 10) || 0;
      }
      if (spId) {
        return { spId: spId, spName: awayProb, oppAbbr: away, batAbbr: home };
      }
    }
    if (mlbNormalizePersonName_(homeProb) === want) {
      let spId = homeProbId;
      if (!spId && typeof mlbStatsApiResolvePlayerIdFromName_ === 'function') {
        spId = parseInt(mlbStatsApiResolvePlayerIdFromName_(homeProb), 10) || 0;
      }
      if (spId) {
        return { spId: spId, spName: homeProb, oppAbbr: home, batAbbr: away };
      }
    }
    return null;
  }
  return null;
}

/** Home plate official from schedule `officials` hydrate (empty if TBA). */
function mlbHomePlateFromScheduleGame_(g) {
  const list = (g && g.officials) || [];
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    const typ = String((item && item.officialType) || '').toLowerCase();
    if (typ.indexOf('home') !== -1 && typ.indexOf('plate') !== -1) {
      const off = item.official || {};
      const id = off.id != null ? off.id : '';
      const name =
        off.fullName ||
        [off.firstName, off.lastName]
          .filter(function (x) {
            return !!x;
          })
          .join(' ') ||
        '';
      return { id: id, name: name };
    }
  }
  return { id: '', name: '' };
}

/** @returns {Object|null} raw schedule JSON for yyyy-MM-dd (statsapi). */
function mlbFetchScheduleJsonForDate_(dateStr) {
  const url =
    'https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=' +
    encodeURIComponent(String(dateStr || '').trim()) +
    '&hydrate=probablePitcher(note),venue,officials';
  try {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return null;
    return JSON.parse(res.getContentText());
  } catch (e) {
    Logger.log('mlbFetchScheduleJsonForDate_: ' + e.message);
    return null;
  }
}

/** Matchup string from 📅 MLB_Schedule for a gamePk (for odds joins / CLV backfill). */
/** Home team abbreviation from schedule row (col `home`). */
function mlbScheduleHomeAbbrForGamePk_(ss, gamePk) {
  const g = parseInt(gamePk, 10);
  if (!g) return '';
  const block = mlbGetScheduleBlock_(ss);
  for (let i = 0; i < block.length; i++) {
    if (parseInt(block[i][0], 10) === g) return String(block[i][4] || '').trim();
  }
  return '';
}

function mlbScheduleMatchupForGamePk_(ss, gamePk) {
  const g = parseInt(gamePk, 10);
  if (!g) return '';
  const block = mlbGetScheduleBlock_(ss);
  for (let i = 0; i < block.length; i++) {
    if (parseInt(block[i][0], 10) === g) return String(block[i][5] || '').trim();
  }
  return '';
}

/** @returns {{ matchup: string, away: string, home: string, hpUmp: string }} */
function mlbScheduleMetaForGamePk_(ss, gamePk) {
  const g = parseInt(gamePk, 10);
  const empty = { matchup: '', away: '', home: '', hpUmp: '' };
  if (!g) return empty;
  const block = mlbGetScheduleBlock_(ss);
  for (let i = 0; i < block.length; i++) {
    if (parseInt(block[i][0], 10) === g) {
      return {
        matchup: String(block[i][5] || '').trim(),
        away: String(block[i][3] || '').trim(),
        home: String(block[i][4] || '').trim(),
        hpUmp: String(block[i][13] || '').trim(),
      };
    }
  }
  return empty;
}

function fetchMLBScheduleForSlate() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig();
  const dateStr = getSlateDateString_(cfg);
  const payload = mlbFetchScheduleJsonForDate_(dateStr);
  if (!payload) {
    safeAlert_('Schedule failed', 'HTTP or parse error for ' + dateStr);
    return;
  }

  const rows = [];
  const dates = payload.dates || [];
  dates.forEach(function (d) {
    (d.games || []).forEach(function (g) {
      const away = g.teams && g.teams.away && g.teams.away.team ? g.teams.away.team : {};
      const home = g.teams && g.teams.home && g.teams.home.team ? g.teams.home.team : {};
      const awayProb = g.teams && g.teams.away && g.teams.away.probablePitcher ? g.teams.away.probablePitcher : {};
      const homeProb = g.teams && g.teams.home && g.teams.home.probablePitcher ? g.teams.home.probablePitcher : {};
      const venue = g.venue && g.venue.name ? g.venue.name : '';
      const status = g.status && g.status.detailedState ? g.status.detailedState : '';
      const hp = mlbHomePlateFromScheduleGame_(g);
      const awayAbbr = away.abbreviation || mlbAbbrFromTeamName_(away.name || '') || '';
      const homeAbbr = home.abbreviation || mlbAbbrFromTeamName_(home.name || '') || '';
      rows.push([
        g.gamePk,
        Utilities.formatDate(new Date(g.gameDate), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
        g.gameDate,
        awayAbbr,
        homeAbbr,
        (away.name || '') + ' @ ' + (home.name || ''),
        awayProb.fullName || '',
        homeProb.fullName || '',
        venue,
        status,
        g.seriesDescription || '',
        awayProb.id || '',
        homeProb.id || '',
        hp.name || '',
        hp.id || '',
      ]);
    });
  });

  let sh = ss.getSheetByName(MLB_SCHEDULE_TAB);
  if (!sh) sh = ss.insertSheet(MLB_SCHEDULE_TAB);
  sh.clearContents();
  sh.clearFormats();
  sh.setTabColor('#37474f');
  const headers = [
    'gamePk',
    'date',
    'gameDateRaw',
    'away',
    'home',
    'matchup',
    'awayProbablePitcher',
    'homeProbablePitcher',
    'venue',
    'status',
    'series',
    'awayProbablePitcherId',
    'homeProbablePitcherId',
    'homePlateUmpire',
    'homePlateUmpireId',
  ];
  sh.getRange(1, 1, 1, headers.length).merge().setValue('📅 MLB schedule — ' + dateStr).setFontWeight('bold');
  sh.getRange(3, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sh.setFrozenRows(3);
  if (rows.length) {
    sh.getRange(4, 1, rows.length, headers.length).setValues(rows);
    try {
      ss.setNamedRange('MLB_SCHEDULE', sh.getRange(4, 1, rows.length, headers.length));
    } catch (e) {}
  }
  ss.toast(rows.length + ' games loaded', 'MLB Schedule', 5);
}
