// ============================================================
// 📅 MLB schedule + probable pitchers — statsapi.mlb.com
// ============================================================
// Free JSON API, no key. Same spirit as AI-BOIZ: one tab of slate context.
// ============================================================

const MLB_SCHEDULE_TAB = '📅 MLB_Schedule';

function fetchMLBScheduleForSlate() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig();
  const dateStr = getSlateDateString_(cfg);
  const url =
    'https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=' +
    encodeURIComponent(dateStr) +
    '&hydrate=probablePitcher(note),venue';
  let payload;
  try {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      safeAlert_('Schedule failed', 'HTTP ' + res.getResponseCode());
      return;
    }
    payload = JSON.parse(res.getContentText());
  } catch (e) {
    safeAlert_('Schedule error', e.message);
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
