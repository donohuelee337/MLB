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
  const entry = gameMap[pKey];
  if (entry == null || entry === '') return null;
  if (typeof entry === 'object') return entry.slot || null;
  return entry;
}

/** 'away' | 'home' when tonight's lineup is confirmed; else null. */
function mlbLineupSideForBatter_(gamePk, batterId) {
  if (__mlbLineupsCache === null) return null;
  const gKey = String(parseInt(gamePk, 10) || 0);
  const pKey = String(parseInt(batterId, 10) || 0);
  const gameMap = __mlbLineupsCache[gKey];
  if (!gameMap) return null;
  const entry = gameMap[pKey];
  if (!entry || typeof entry !== 'object') return null;
  const side = String(entry.side || '').trim().toLowerCase();
  return side === 'away' || side === 'home' ? side : null;
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
          __mlbLineupsCache[gamePk][pid] = { slot: slot, side: teamLabel };
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

/**
 * Confirmed lineup batter ids for one side (`away` | `home`).
 * @returns {number[]}
 */
function mlbLineupBatterIdsForSide_(gamePk, side) {
  if (__mlbLineupsCache === null) {
    return [];
  }
  const wantSide = String(side || '').trim().toLowerCase();
  if (wantSide !== 'away' && wantSide !== 'home') {
    return [];
  }
  const gKey = String(parseInt(gamePk, 10) || 0);
  const gameMap = __mlbLineupsCache[gKey];
  if (!gameMap) {
    return [];
  }
  const out = [];
  for (const pid in gameMap) {
    if (!Object.prototype.hasOwnProperty.call(gameMap, pid)) {
      continue;
    }
    const entry = gameMap[pid];
    const s =
      entry && typeof entry === 'object'
        ? String(entry.side || '').trim().toLowerCase()
        : '';
    if (s === wantSide) {
      const id = parseInt(pid, 10);
      if (id > 0) {
        out.push(id);
      }
    }
  }
  return out;
}

function mlbKPaFromHittingStat_(st) {
  const pa = parseInt((st && st.plateAppearances) || 0, 10) || 0;
  const k = parseInt((st && st.strikeOuts) || 0, 10) || 0;
  if (pa <= 0) {
    return NaN;
  }
  return Math.round((k / pa) * 10000) / 10000;
}

/**
 * Average opponent lineup SO/PA when lineups are confirmed; else Savant team
 * whiff CSV; else NaN. Uses vs-hand split when pitcherThrows is L or R.
 *
 * @param {number|string} gamePk
 * @param {string} oppAbbr batting team abbr (team facing tonight's SP)
 * @param {string} [pitcherThrows] L | R
 * @returns {number}
 */
function mlbLineupWhiffAvgForGamePk_(gamePk, oppAbbr, pitcherThrows) {
  const cfg = typeof getConfig === 'function' ? getConfig() || {} : {};
  const minPa = parseInt(
    String(cfg['K_LINEUP_WHIFF_MIN_PA'] != null ? cfg['K_LINEUP_WHIFF_MIN_PA'] : '20'),
    10
  );
  const minPaGate = minPa > 0 ? minPa : 20;
  const season = parseInt(
    String(cfg['MLB_SEASON'] != null ? cfg['MLB_SEASON'] : new Date().getFullYear()),
    10
  );

  let side = '';
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const opp = typeof mlbCanonicalTeamAbbr_ === 'function' ? mlbCanonicalTeamAbbr_(oppAbbr) : String(oppAbbr || '').trim().toUpperCase();
    const home =
      typeof mlbScheduleHomeAbbrForGamePk_ === 'function'
        ? mlbCanonicalTeamAbbr_(mlbScheduleHomeAbbrForGamePk_(ss, gamePk))
        : '';
    const away =
      typeof mlbScheduleAwayAbbrForGamePk_ === 'function'
        ? mlbCanonicalTeamAbbr_(mlbScheduleAwayAbbrForGamePk_(ss, gamePk))
        : '';
    if (opp && opp === home) {
      side = 'home';
    } else if (opp && opp === away) {
      side = 'away';
    }
  } catch (e) {
    Logger.log('mlbLineupWhiffAvgForGamePk_ schedule: ' + e.message);
  }

  const tw = String(pitcherThrows || '').trim().toUpperCase();
  const ids =
    side && typeof mlbLineupBatterIdsForSide_ === 'function'
      ? mlbLineupBatterIdsForSide_(gamePk, side)
      : [];

  if (ids.length && typeof mlbSharedFetchBatterHittingSplitsAndSeason_ === 'function') {
    let sum = 0;
    let n = 0;
    ids.forEach(function (bid) {
      const data = mlbSharedFetchBatterHittingSplitsAndSeason_(bid, season);
      let st = (data && data.szn) || {};
      if (tw === 'L' && data && data.vl && data.vl.plateAppearances) {
        st = data.vl;
      } else if (tw === 'R' && data && data.vr && data.vr.plateAppearances) {
        st = data.vr;
      }
      const pa = parseInt(st.plateAppearances, 10) || 0;
      if (pa < minPaGate) {
        return;
      }
      const kpa = mlbKPaFromHittingStat_(st);
      if (!isNaN(kpa)) {
        sum += kpa;
        n++;
      }
    });
    if (n >= 5) {
      return Math.round((sum / n) * 10000) / 10000;
    }
  }

  if (typeof mlbGetSavantTeamWhiffKPa_ === 'function' && typeof mlbTeamIdFromAbbr_ === 'function') {
    const tid = mlbTeamIdFromAbbr_(oppAbbr);
    const teamK = mlbGetSavantTeamWhiffKPa_(tid);
    if (teamK != null && !isNaN(teamK)) {
      return teamK;
    }
  }

  return NaN;
}
