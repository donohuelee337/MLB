// ============================================================
// MLBHrPromoHelpers — Stats API fetch helpers HR promo depends on
// ============================================================
// These were extracted from the multi-market overhaul branch
// (MLBBatterHRQueue.js / MLBBatterTBQueue.js on `feature/mlb-nba-rules-
// multi-market-prototype`) so that MLBHrPromoRefresh can run on the
// rolled-back tree without that whole branch.
//   Depends on: MLB_TEAM_ABBREV (Config.js), mlbStatsApiBaseUrl_ +
//   mlbSortSplitsNewestFirst_ (MLBPitcherGameLogs.js).
// ============================================================

var __mlbHitGameLogSplitCache = {};
/** Lazy-loaded once per script run: { playerId: { loggedAt, splits[] } } from 🥎 Batter_Game_Logs */
var __mlbHitGameLogTabIndex = null;
/** Player names captured during the run, used when we need to write new tab rows. */
var __mlbHitGameLogPlayerNames = {};
/** Queue of {playerId, playerName, season, loggedAt, splits} pending tab append. */
var __mlbHitGameLogPendingWrites = [];

/** Helper for HR promo to label players when we call the API (so writes get a name). */
function mlbHrPromoRememberPlayerName_(playerId, playerName) {
  const id = parseInt(playerId, 10);
  if (id && playerName) __mlbHitGameLogPlayerNames[id] = String(playerName);
}

function __mlbHitGameLogTabIndex_(ss) {
  if (__mlbHitGameLogTabIndex !== null) return __mlbHitGameLogTabIndex;
  __mlbHitGameLogTabIndex = mlbBatterGameLogsReadIndex_(ss, mlbHrPromoCurrentSeason_());
  return __mlbHitGameLogTabIndex;
}

function mlbHrPromoCurrentSeason_() {
  // Falls back to schedule-derived season if available; HR promo always passes season explicitly,
  // but the cache index needs a default for read-time grouping.
  try {
    return mlbSlateSeasonYear_(getConfig());
  } catch (e) {
    return new Date().getFullYear();
  }
}

/** Called at the end of HR promo refresh to persist all newly-fetched splits. */
function mlbHrPromoFlushBatterGameLogWrites_() {
  if (!__mlbHitGameLogPendingWrites.length) return 0;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const rows = [];
  __mlbHitGameLogPendingWrites.forEach(function (w) {
    const name = w.playerName || __mlbHitGameLogPlayerNames[w.playerId] || '';
    for (let i = 0; i < w.splits.length; i++) {
      rows.push(mlbBatterGameLogsSplitToRow_(w.loggedAt, w.playerId, name, w.season, w.splits[i]));
    }
  });
  mlbBatterGameLogsAppendRows_(ss, rows);
  const n = __mlbHitGameLogPendingWrites.length;
  __mlbHitGameLogPendingWrites = [];
  return n;
}

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

function mlbStatsApiGetHittingGameSplits_(playerId, season) {
  const id = parseInt(playerId, 10);
  if (!id) return [];
  const se = String(season);
  const key = id + ':' + se;
  if (__mlbHitGameLogSplitCache[key]) return __mlbHitGameLogSplitCache[key];

  // Try 🥎 Batter_Game_Logs first — if we already fetched this player today (NY), reuse.
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const today = Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd');
  const tabIndex = __mlbHitGameLogTabIndex_(ss);
  const entry = tabIndex[id];
  if (entry && entry.loggedAt === today && entry.splits && entry.splits.length > 0) {
    __mlbHitGameLogSplitCache[key] = entry.splits;
    return entry.splits;
  }

  const url =
    mlbStatsApiBaseUrl_() +
    '/people/' + id +
    '/stats?stats=gameLog&group=hitting&season=' + encodeURIComponent(se);
  try {
    Utilities.sleep(40);
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      __mlbHitGameLogSplitCache[key] = [];
      return [];
    }
    const payload = JSON.parse(res.getContentText());
    const stats = payload.stats && payload.stats[0] ? payload.stats[0] : {};
    const sorted = mlbSortSplitsNewestFirst_(stats.splits || []);
    __mlbHitGameLogSplitCache[key] = sorted;
    // Queue a tab write so future runs today (and tomorrow as historical) can reuse this.
    if (sorted.length > 0) {
      __mlbHitGameLogPendingWrites.push({
        playerId: id,
        playerName: __mlbHitGameLogPlayerNames[id] || '',
        season: se,
        loggedAt: today,
        splits: sorted,
      });
    }
    return sorted;
  } catch (e) {
    Logger.log('mlbStatsApiGetHittingGameSplits_: ' + e.message);
    __mlbHitGameLogSplitCache[key] = [];
    return [];
  }
}
