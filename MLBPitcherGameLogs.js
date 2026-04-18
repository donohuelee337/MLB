// ============================================================
// 📒 Pitcher game logs — MLB Stats API (gameLog / pitching)
// ============================================================
// One long-format row per pitcher per recent appearance (default 5).
// Populated from 📅 MLB_Schedule probable IDs. Warms split cache for
// 📋 Pitcher_K_Queue so morning does not double-fetch each arm.
// Optional Script Property: STATSAPI_BASE (default …/api/v1)
// ============================================================

const MLB_PITCHER_GAME_LOGS_TAB = '📒 Pitcher_Game_Logs';
const MLB_PITCHER_GAME_LOG_LOOKBACK = 5;

var __mlbPitchGameLogSplitCache = {};

function mlbResetPitchGameLogFetchCache_() {
  __mlbPitchGameLogSplitCache = {};
}

function mlbStatsApiBaseUrl_() {
  const p = PropertiesService.getScriptProperties().getProperty('STATSAPI_BASE');
  if (p && String(p).trim()) return String(p).trim().replace(/\/$/, '');
  return 'https://statsapi.mlb.com/api/v1';
}

function mlbSortSplitsNewestFirst_(splits) {
  const copy = (splits || []).slice();
  copy.sort(function (a, b) {
    const da = String((a && a.date) || '');
    const db = String((b && b.date) || '');
    return db.localeCompare(da);
  });
  return copy;
}

/**
 * @returns {Array<Object>} pitching gameLog splits for season (newest first), or [].
 */
function mlbStatsApiGetPitchingGameSplits_(playerId, season) {
  const id = parseInt(playerId, 10);
  if (!id) return [];
  const se = String(season);
  const key = id + ':' + se;
  if (__mlbPitchGameLogSplitCache[key]) return __mlbPitchGameLogSplitCache[key];

  const url =
    mlbStatsApiBaseUrl_() +
    '/people/' +
    id +
    '/stats?stats=gameLog&group=pitching&season=' +
    encodeURIComponent(se);
  try {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      __mlbPitchGameLogSplitCache[key] = [];
      return [];
    }
    const payload = JSON.parse(res.getContentText());
    const stats = payload.stats && payload.stats[0] ? payload.stats[0] : {};
    const raw = stats.splits || [];
    const sorted = mlbSortSplitsNewestFirst_(raw);
    __mlbPitchGameLogSplitCache[key] = sorted;
    return sorted;
  } catch (e) {
    Logger.log('mlbStatsApiGetPitchingGameSplits_: ' + e.message);
    __mlbPitchGameLogSplitCache[key] = [];
    return [];
  }
}

function mlbStatsApiPitchingSplitsCached_(playerId, season) {
  const id = parseInt(playerId, 10);
  if (!id) return false;
  const key = id + ':' + String(season);
  return Object.prototype.hasOwnProperty.call(__mlbPitchGameLogSplitCache, key);
}

function mlbSplitToGameLogRow_(slateDate, slateGamePk, pitcherName, pitcherId, startRank, sp) {
  const g = sp.game || {};
  const opp = sp.opponent || {};
  const st = sp.stat || {};
  const ipStr = st.inningsPitched != null ? String(st.inningsPitched) : '';
  const ipDec = ipStr ? mlbParseInningsString_(ipStr) : '';
  return [
    slateDate,
    slateGamePk,
    pitcherId,
    pitcherName,
    startRank,
    g.gamePk != null ? g.gamePk : '',
    sp.date || '',
    opp.name || '',
    sp.isHome === true ? 'Y' : sp.isHome === false ? 'N' : '',
    ipStr,
    ipDec,
    st.strikeOuts != null ? st.strikeOuts : '',
    st.baseOnBalls != null ? st.baseOnBalls : '',
    st.earnedRuns != null ? st.earnedRuns : '',
  ];
}

/**
 * Build 📒 Pitcher_Game_Logs from slate probables + statsapi gameLog.
 * Run after 📅 MLB_Schedule.
 */
function refreshMLBPitcherGameLogs() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig();
  const slateDate = getSlateDateString_(cfg);
  const season = mlbSlateSeasonYear_(cfg);

  const sch = ss.getSheetByName(MLB_SCHEDULE_TAB);
  if (!sch || sch.getLastRow() < 4) {
    safeAlert_('Pitcher game logs', 'Run MLB schedule first.');
    return;
  }

  const last = sch.getLastRow();
  const block = sch.getRange(4, 1, last, 13).getValues();
  const arms = [];
  block.forEach(function (r) {
    const gamePk = r[0];
    const awayName = String(r[6] || '').trim();
    const homeName = String(r[7] || '').trim();
    const awayId = r[11];
    const homeId = r[12];
    if (awayName && parseInt(awayId, 10)) {
      arms.push({ gamePk: gamePk, pid: parseInt(awayId, 10), name: awayName });
    }
    if (homeName && parseInt(homeId, 10)) {
      arms.push({ gamePk: gamePk, pid: parseInt(homeId, 10), name: homeName });
    }
  });

  const seenPid = {};
  const out = [];
  arms.forEach(function (a) {
    if (seenPid[a.pid]) return;
    seenPid[a.pid] = true;
    if (!mlbStatsApiPitchingSplitsCached_(a.pid, season)) {
      Utilities.sleep(100);
    }
    const splits = mlbStatsApiGetPitchingGameSplits_(a.pid, season);
    const take = splits.slice(0, MLB_PITCHER_GAME_LOG_LOOKBACK);
    for (let i = 0; i < take.length; i++) {
      out.push(mlbSplitToGameLogRow_(slateDate, a.gamePk, a.name, a.pid, i + 1, take[i]));
    }
  });

  let sh = ss.getSheetByName(MLB_PITCHER_GAME_LOGS_TAB);
  if (sh) {
    sh.clearContents();
    sh.clearFormats();
  } else {
    sh = ss.insertSheet(MLB_PITCHER_GAME_LOGS_TAB);
  }
  sh.setTabColor('#33691e');
  const headers = [
    'slate_date',
    'slate_gamePk',
    'pitcher_id',
    'pitcher_name',
    'start_rank',
    'log_gamePk',
    'game_date',
    'opponent',
    'is_home',
    'ip',
    'ip_dec',
    'k',
    'bb',
    'er',
  ];
  sh.getRange(1, 1, 1, headers.length)
    .merge()
    .setValue('📒 Pitcher game logs — last ' + MLB_PITCHER_GAME_LOG_LOOKBACK + ' appearances (statsapi) · season ' + season)
    .setFontWeight('bold')
    .setBackground('#1b5e20')
    .setFontColor('#ffffff');
  sh.getRange(3, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#2e7d32').setFontColor('#ffffff');
  sh.setFrozenRows(3);
  if (out.length) {
    sh.getRange(4, 1, out.length, headers.length).setValues(out);
    try {
      ss.setNamedRange('MLB_PITCHER_GAME_LOGS', sh.getRange(4, 1, out.length, headers.length));
    } catch (e) {}
  }
  ss.toast(out.length + ' log rows · ' + Object.keys(seenPid).length + ' pitchers', 'Pitcher game logs', 6);
}
