// ============================================================
// 📅 MLB schedule + probable pitchers — statsapi.mlb.com
// ============================================================
// Free JSON API, no key. Same spirit as AI-BOIZ: one tab of slate context.
// ============================================================

const MLB_SCHEDULE_TAB = '📅 MLB_Schedule';

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
  const sh = ss.getSheetByName(MLB_SCHEDULE_TAB);
  if (!sh || sh.getLastRow() < 4) return '';
  const last = sh.getLastRow();
  const block = sh.getRange(4, 1, last, 5).getValues();
  for (let i = 0; i < block.length; i++) {
    if (parseInt(block[i][0], 10) === g) {
      return String(block[i][4] || '').trim();
    }
  }
  return '';
}

function mlbScheduleMatchupForGamePk_(ss, gamePk) {
  const g = parseInt(gamePk, 10);
  if (!g) return '';
  const sh = ss.getSheetByName(MLB_SCHEDULE_TAB);
  if (!sh || sh.getLastRow() < 4) return '';
  const last = sh.getLastRow();
  const block = sh.getRange(4, 1, last, 6).getValues();
  for (let i = 0; i < block.length; i++) {
    if (parseInt(block[i][0], 10) === g) {
      return String(block[i][5] || '').trim();
    }
  }
  return '';
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
      rows.push([
        g.gamePk,
        Utilities.formatDate(new Date(g.gameDate), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
        g.gameDate,
        away.abbreviation || '',
        home.abbreviation || '',
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
