// ============================================================
// ⚾ Team season hitting — K/PA (MLB Stats API)
// ============================================================
// Season-level team hitting from GET /teams/{id}/stats
// (stats=season, group=hitting). Exposes SO/PA for a team-year.
// Base URL: mlbStatsApiBaseUrl_() in MLBPitcherGameLogs.js
// Optional Script Property: STATSAPI_BASE (default …/api/v1)
// ============================================================

var __mlbTeamHittingSeasonCache = {};

function mlbResetTeamHittingSeasonCache_() {
  __mlbTeamHittingSeasonCache = {};
}

/**
 * @param {*} teamId
 * @param {*} season
 * @returns {number} Strikeouts per plate appearance (4 decimals), or NaN.
 */
function mlbTeamSeasonHittingKPerPa_(teamId, season) {
  var id = parseInt(teamId, 10);
  if (!id) {
    return NaN;
  }
  var se = String(season);
  var key = id + ':' + se;
  if (Object.prototype.hasOwnProperty.call(__mlbTeamHittingSeasonCache, key)) {
    return __mlbTeamHittingSeasonCache[key];
  }

  var url =
    mlbStatsApiBaseUrl_() +
    '/teams/' +
    id +
    '/stats?stats=season&season=' +
    encodeURIComponent(se) +
    '&group=hitting';

  try {
    Utilities.sleep(50);
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      Logger.log('mlbTeamSeasonHittingKPerPa_: HTTP ' + res.getResponseCode() + ' ' + url);
      __mlbTeamHittingSeasonCache[key] = NaN;
      return NaN;
    }
    var payload = JSON.parse(res.getContentText());
    var statsArr = payload.stats || [];
    var firstStat = statsArr[0] || {};
    var splits = firstStat.splits || [];
    var first = splits[0];
    if (!first || !first.stat) {
      Logger.log('mlbTeamSeasonHittingKPerPa_: missing split/stat ' + url);
      __mlbTeamHittingSeasonCache[key] = NaN;
      return NaN;
    }
    var st = first.stat;
    var so = st.strikeOuts;
    var pa = st.plateAppearances;
    if (so == null || pa == null) {
      Logger.log('mlbTeamSeasonHittingKPerPa_: missing strikeOuts/plateAppearances ' + url);
      __mlbTeamHittingSeasonCache[key] = NaN;
      return NaN;
    }
    var soN = Number(so);
    var paN = Number(pa);
    if (!isFinite(soN) || !(paN > 0)) {
      __mlbTeamHittingSeasonCache[key] = NaN;
      return NaN;
    }
    var out = Math.round((soN / paN) * 10000) / 10000;
    __mlbTeamHittingSeasonCache[key] = out;
    return out;
  } catch (e) {
    Logger.log('mlbTeamSeasonHittingKPerPa_: ' + e.message);
    __mlbTeamHittingSeasonCache[key] = NaN;
    return NaN;
  }
}
