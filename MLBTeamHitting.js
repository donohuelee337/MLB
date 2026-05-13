// ============================================================
// ⚾ Team season hitting — K/PA (MLB Stats API)
// ============================================================
// Season-level team hitting from GET /teams/{id}/stats
// (stats=season, group=hitting). Exposes SO/PA for a team-year.
// Base URL: mlbStatsApiBaseUrl_() in MLBPitcherGameLogs.js
// Optional Script Property: STATSAPI_BASE (default …/api/v1)
// ============================================================

var __mlbTeamHittingSeasonCache = {};
/** Key teamId:season:vsL or :vsR — aggregated SO/PA vs opposing pitcher hand (stats /stats). */
var __mlbTeamHittingVsHandCache = {};

function mlbResetTeamHittingSeasonCache_() {
  __mlbTeamHittingSeasonCache = {};
  __mlbTeamHittingVsHandCache = {};
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

/**
 * Team hitting SO/PA vs opposing pitchers of the given throw hand (L|R).
 * Sums non-pitcher rows from GET /stats?stats=season&group=hitting&teamId=&pitcherHand=&playerPool=ALL.
 * @param {*} teamId
 * @param {*} season
 * @param {string} pitchHand pitcher throw hand faced by this lineup: L or R
 * @returns {number} SO/PA rounded 4 decimals, or NaN if sample too thin or fetch fails
 */
function mlbTeamHittingKPerPaVsPitcherHand_(teamId, season, pitchHand) {
  var ph = String(pitchHand || '')
    .trim()
    .toUpperCase()
    .slice(0, 1);
  if (ph !== 'L' && ph !== 'R') {
    return NaN;
  }
  var id = parseInt(teamId, 10);
  if (!id) {
    return NaN;
  }
  var se = String(season);
  var key = id + ':' + se + ':vs' + ph;
  if (Object.prototype.hasOwnProperty.call(__mlbTeamHittingVsHandCache, key)) {
    return __mlbTeamHittingVsHandCache[key];
  }

  var url =
    mlbStatsApiBaseUrl_() +
    '/stats?stats=season&group=hitting&season=' +
    encodeURIComponent(se) +
    '&teamId=' +
    id +
    '&pitcherHand=' +
    ph +
    '&playerPool=ALL';

  try {
    Utilities.sleep(50);
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      Logger.log('mlbTeamHittingKPerPaVsPitcherHand_: HTTP ' + res.getResponseCode() + ' ' + url);
      __mlbTeamHittingVsHandCache[key] = NaN;
      return NaN;
    }
    var payload = JSON.parse(res.getContentText());
    var statsArr = payload.stats || [];
    var firstStat = statsArr[0] || {};
    var splits = firstStat.splits || [];
    var totSo = 0;
    var totPa = 0;
    for (var i = 0; i < splits.length; i++) {
      var sp = splits[i];
      var pos = (sp && sp.position) || {};
      var pcode = String(pos.code != null ? pos.code : '').trim();
      if (pcode === '1') {
        continue;
      }
      var ptype = String(pos.type || '').toLowerCase();
      if (ptype.indexOf('pitcher') !== -1) {
        continue;
      }
      var st = sp.stat || {};
      var paN = Number(st.plateAppearances);
      if (!isFinite(paN) || paN < 1) {
        continue;
      }
      var soN = Number(st.strikeOuts);
      if (!isFinite(soN) || soN < 0) {
        soN = 0;
      }
      totSo += soN;
      totPa += paN;
    }
    var minPa = 40;
    if (totPa < minPa) {
      __mlbTeamHittingVsHandCache[key] = NaN;
      return NaN;
    }
    var out = Math.round((totSo / totPa) * 10000) / 10000;
    __mlbTeamHittingVsHandCache[key] = out;
    return out;
  } catch (e) {
    Logger.log('mlbTeamHittingKPerPaVsPitcherHand_: ' + e.message);
    __mlbTeamHittingVsHandCache[key] = NaN;
    return NaN;
  }
}
