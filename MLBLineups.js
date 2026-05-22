// ============================================================
// 📋 MLB Lineups — confirmed batting order per gamePk
// ============================================================
// Fetches tonight's lineup from statsapi once per pipeline run
// and caches { gamePk → { playerId → slot (1–9) } }.
// Consumers call mlbLineupSlotForBatter_(gamePk, batterId).
// Fallback: returns null when lineup not confirmed yet.
// Called at pipeline start (after schedule fetch).
// ============================================================

const MLB_LINEUP_DATA_TAB = '📋 Lineup_Data';

var __mlbLineupsCache = null;  // null = not yet loaded; {} = loaded (may be empty)

function mlbResetLineupsCache_() {
  __mlbLineupsCache = null;
}

/**
 * Returns confirmed batting order slot (1–9) for a batter in a game,
 * or null if lineup not confirmed / batter not in lineup.
 */
function mlbLineupSlotForBatter_(gamePk, batterId) {
  if (__mlbLineupsCache === null) return null;
  const gKey = String(parseInt(gamePk, 10) || 0);
  const pKey = String(parseInt(batterId, 10) || 0);
  const gameMap = __mlbLineupsCache[gKey];
  if (!gameMap) return null;
  return gameMap[pKey] || null;
}

/**
 * Fetches today's confirmed lineups from statsapi and populates
 * __mlbLineupsCache. Writes a debug tab (📋 Lineup_Data) with all
 * confirmed slots so you can verify the data visually.
 *
 * Statsapi endpoint:
 *   /api/v1/schedule?sportId=1&date=YYYY-MM-DD&hydrate=lineups
 *   Returns lineups[].players[].battingOrder: "100"|"200"…"900"
 *   (100 = slot 1, 900 = slot 9). battingOrder is absent when lineup
 *   is not yet confirmed for that game.
 *
 * Called by runMLBBallWindow_ after fetchMLBScheduleForSlate.
 */
function mlbFetchAndCacheLineups_(ss, cfg) {
  __mlbLineupsCache = {};
  const slateDate = getSlateDateString_(cfg);
  if (!slateDate) return;

  const url =
    mlbStatsApiBaseUrl_() +
    '/schedule?sportId=1&date=' + encodeURIComponent(slateDate) +
    '&hydrate=lineups&gameType=R';

  let payload;
  try {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      Logger.log('mlbFetchAndCacheLineups_ HTTP ' + res.getResponseCode());
      return;
    }
    payload = JSON.parse(res.getContentText());
  } catch (e) {
    Logger.log('mlbFetchAndCacheLineups_ error: ' + e.message);
    return;
  }

  const dates = (payload && payload.dates) || [];
  const tabRows = [['gamePk', 'matchup', 'team', 'slot', 'playerId', 'playerName', 'confirmed']];
  let confirmedGames = 0;

  dates.forEach(function (dateObj) {
    const games = dateObj.games || [];
    games.forEach(function (game) {
      const gamePk = String(parseInt(game.gamePk, 10) || 0);
      if (!gamePk || gamePk === '0') return;
      const matchup = String(game.teams && game.teams.away && game.teams.home
        ? (game.teams.away.team.name || '') + ' @ ' + (game.teams.home.team.name || '')
        : '');

      const lineups = (game.lineups) || {};
      const awayLineup  = (lineups.awayPlayers)  || [];
      const homeLineup  = (lineups.homePlayers)  || [];

      function processTeamLineup(players, teamLabel) {
        var hasAnySlot = false;
        players.forEach(function (p) {
          const pid = String(parseInt(p.id, 10) || 0);
          if (!pid || pid === '0') return;
          const orderStr = String(p.battingOrder || '');
          const orderNum = parseInt(orderStr, 10);
          if (isNaN(orderNum) || orderNum < 100) return;
          const slot = Math.round(orderNum / 100);
          if (slot < 1 || slot > 9) return;
          if (!__mlbLineupsCache[gamePk]) __mlbLineupsCache[gamePk] = {};
          __mlbLineupsCache[gamePk][pid] = slot;
          tabRows.push([gamePk, matchup, teamLabel, slot, pid, p.fullName || '', 'YES']);
          hasAnySlot = true;
        });
        return hasAnySlot;
      }

      const awayOk = processTeamLineup(awayLineup, 'away');
      const homeOk = processTeamLineup(homeLineup, 'home');
      if (awayOk || homeOk) confirmedGames++;

      if (!awayOk) tabRows.push([gamePk, matchup, 'away', '', '', '', 'NO']);
      if (!homeOk) tabRows.push([gamePk, matchup, 'home', '', '', '', 'NO']);
    });
  });

  // Write debug tab.
  var sh = ss.getSheetByName(MLB_LINEUP_DATA_TAB);
  if (!sh) sh = ss.insertSheet(MLB_LINEUP_DATA_TAB);
  else sh.clearContents();
  sh.setTabColor('#7b1fa2');
  sh.getRange(1, 1, tabRows.length, tabRows[0].length).setValues(tabRows);
  sh.getRange(1, 1, 1, tabRows[0].length).setFontWeight('bold').setBackground('#4a148c').setFontColor('#fff');

  Logger.log('mlbFetchAndCacheLineups_: ' + confirmedGames + ' confirmed games cached');
}
