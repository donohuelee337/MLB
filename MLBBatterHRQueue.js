// ============================================================
// 💣 Batter HR model — P(HR≥1) ranking for today's slate
// ============================================================
// Runs after 📅 MLB_Schedule is populated. For each team on the
// slate, fetches season hitting stats via /teams/{id}/stats.
// λ = (szn HR / szn PA) × 4.0 PA × park_hr_factor
// P(HR≥1) = 1 − e^(−λ)   — pure model, no FD price needed.
// ============================================================

var MLB_BATTER_HR_MODEL_TAB = '📋 Batter_HR_Model';
var MLB_BATTER_HR_EST_PA    = 4.0;
var MLB_BATTER_HR_MIN_PA    = 30;

function mlbAbbrToTeamId_() {
  var out = {};
  var keys = Object.keys(MLB_TEAM_ABBREV);
  for (var i = 0; i < keys.length; i++) {
    out[MLB_TEAM_ABBREV[keys[i]]] = parseInt(keys[i], 10);
  }
  return out;
}

function mlbFetchTeamHittingStats_(teamId, teamAbbr, season) {
  var url = mlbStatsApiBaseUrl_() +
    '/stats?stats=season&group=hitting&season=' + encodeURIComponent(String(season)) +
    '&teamId=' + teamId + '&playerPool=ALL';
  try {
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return [];
    var payload = JSON.parse(res.getContentText());
    var splits = (payload.stats && payload.stats[0] && payload.stats[0].splits) || [];
    var out = [];
    for (var i = 0; i < splits.length; i++) {
      var sp = splits[i];
      var pl = sp.player || {};
      var st = sp.stat   || {};
      if (!pl.id) continue;
      // Skip pitchers
      var pos = (sp.position) || {};
      var pcode = String(pos.code != null ? pos.code : '').trim();
      if (pcode === '1') continue;
      var ptype = String(pos.type || '').toLowerCase();
      if (ptype.indexOf('pitcher') !== -1) continue;
      out.push({
        playerId: pl.id,
        name:     pl.fullName || '',
        teamAbbr: teamAbbr,
        hr:  parseInt(st.homeRuns, 10)          || 0,
        pa:  parseInt(st.plateAppearances, 10)  || 0,
        games: parseInt(st.gamesPlayed, 10)     || 0,
      });
    }
    return out;
  } catch (e) {
    Logger.log('mlbFetchTeamHittingStats_ ' + teamAbbr + ': ' + e.message);
    return [];
  }
}

/**
 * Read schedule tab and build { abbr → { homeAbbr, matchup, venue } }.
 * Works with both the named range and direct sheet read.
 */
function mlbBuildSlateTeamMap_(ss) {
  var map = {};

  // Find the schedule sheet by scanning names (avoids cross-file const issues)
  var schSheet = null;
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getName().indexOf('MLB_Schedule') !== -1) {
      schSheet = sheets[i];
      break;
    }
  }
  if (!schSheet || schSheet.getLastRow() < 4) return map;

  var nRows = schSheet.getLastRow() - 3;
  if (nRows < 1) return map;
  var nCols = Math.max(schSheet.getLastColumn(), 9);
  var data  = schSheet.getRange(4, 1, nRows, nCols).getValues();

  for (var r = 0; r < data.length; r++) {
    var away    = String(data[r][3] || '').trim().toUpperCase();
    var home    = String(data[r][4] || '').trim().toUpperCase();
    var matchup = String(data[r][5] || '').trim();
    var venue   = data[r].length > 8 ? String(data[r][8] || '').trim() : '';
    if (!away || !home) continue;
    map[away] = { homeAbbr: home, matchup: matchup, venue: venue };
    map[home] = { homeAbbr: home, matchup: matchup, venue: venue };
  }
  return map;
}

function refreshBatterHRQueue() {
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var cfg = getConfig();
  var season = mlbSlateSeasonYear_(cfg);

  // ── 1. Get teams from schedule tab ────────────────────────────
  var gamesByAbbr = mlbBuildSlateTeamMap_(ss);
  var slateAbbrs  = Object.keys(gamesByAbbr);

  if (!slateAbbrs.length) {
    safeAlert_('Batter HR model', 'Schedule tab has no teams with abbreviations. Run Morning pipeline or 📅 MLB schedule first.');
    return;
  }

  // ── 2. Fetch season hitting stats per slate team ──────────────
  var abbrToId   = mlbAbbrToTeamId_();
  var allHitters = [];
  ss.toast('Fetching hitting stats for ' + slateAbbrs.length + ' teams…', 'Batter HR', 15);

  for (var ti = 0; ti < slateAbbrs.length; ti++) {
    var abbr   = slateAbbrs[ti];
    var teamId = abbrToId[abbr];
    if (!teamId) {
      Logger.log('refreshBatterHRQueue: no teamId for ' + abbr);
      continue;
    }
    if (ti > 0) Utilities.sleep(120);
    var players = mlbFetchTeamHittingStats_(teamId, abbr, season);
    for (var pi = 0; pi < players.length; pi++) allHitters.push(players[pi]);
  }

  if (!allHitters.length) {
    safeAlert_('Batter HR model', 'Stats API returned no hitting data for ' + slateAbbrs.length + ' teams.');
    return;
  }

  // ── 3. Compute P(HR≥1) per batter ────────────────────────────
  var rows = [];
  for (var hi = 0; hi < allHitters.length; hi++) {
    var h = allHitters[hi];
    if (h.pa < MLB_BATTER_HR_MIN_PA) continue;
    if (h.hr === 0) continue;
    var game     = gamesByAbbr[h.teamAbbr];
    if (!game) continue;
    var parkMult = mlbParkHrLambdaMultForHomeAbbr_(game.homeAbbr);
    var hrPerPa  = h.hr / h.pa;
    var lambda   = hrPerPa * MLB_BATTER_HR_EST_PA * parkMult;
    var pHr      = 1 - Math.exp(-lambda);
    rows.push({
      name: h.name, teamAbbr: h.teamAbbr, matchup: game.matchup, venue: game.venue,
      parkMult: parkMult, hr: h.hr, pa: h.pa, games: h.games,
      hrPerPa: hrPerPa, lambda: lambda, pHr: pHr,
    });
  }

  rows.sort(function (a, b) { return b.pHr - a.pHr; });

  // ── 4. Write tab ──────────────────────────────────────────────
  var sh = ss.getSheetByName(MLB_BATTER_HR_MODEL_TAB);
  if (sh) {
    try { sh.getRange(1, 1, Math.max(sh.getLastRow(), 3), Math.max(sh.getLastColumn(), 12)).breakApart(); } catch (e) {}
    sh.clearContents();
    sh.clearFormats();
  } else {
    sh = ss.insertSheet(MLB_BATTER_HR_MODEL_TAB);
  }
  sh.setTabColor('#b71c1c');

  [40, 200, 60, 200, 160, 72, 60, 56, 56, 72, 72, 80].forEach(function (w, i) {
    sh.setColumnWidth(i + 1, w);
  });

  sh.getRange(1, 1, 1, 12).merge()
    .setValue('💣 Batter HR model — P(HR≥1) — season ' + season + ' — est. ' + MLB_BATTER_HR_EST_PA + ' PA/game')
    .setFontWeight('bold').setBackground('#b71c1c').setFontColor('#ffffff').setHorizontalAlignment('center');

  sh.getRange(3, 1, 1, 12)
    .setValues([['rank','batter','team','matchup','venue','park_hr_mult','szn_HR','szn_PA','szn_G','HR/PA','λ','P(HR≥1)']])
    .setFontWeight('bold').setBackground('#c62828').setFontColor('#ffffff');

  if (rows.length) {
    var out = [];
    for (var oi = 0; oi < rows.length; oi++) {
      var r = rows[oi];
      out.push([
        oi + 1, r.name, r.teamAbbr, r.matchup, r.venue,
        Math.round(r.parkMult * 1000) / 1000,
        r.hr, r.pa, r.games,
        Math.round(r.hrPerPa * 10000) / 10000,
        Math.round(r.lambda * 10000) / 10000,
        Math.round(r.pHr * 1000) / 1000,
      ]);
    }
    sh.getRange(4, 1, out.length, 12).setValues(out);
    if (out.length >= 20) sh.getRange(4, 1, 20, 12).setBackground('#fff3e0');
    if (out.length >= 5)  sh.getRange(4, 1,  5, 12).setFontWeight('bold');
    sh.getRange(4, 12, out.length, 1).setNumberFormat('0.0%');
    try { ss.setNamedRange('MLB_BATTER_HR_MODEL', sh.getRange(4, 1, out.length, 12)); } catch (e) {}
  }

  sh.setFrozenRows(3);
  ss.toast(
    rows.length + ' batters · #1: ' + (rows[0] ? rows[0].name + ' ' + Math.round(rows[0].pHr * 1000) / 10 + '%' : '—'),
    'Batter HR model', 8
  );
}
