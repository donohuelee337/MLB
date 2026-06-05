// ============================================================
// 🗄️ Pitcher K Logs — overnight season dump (NBA Game_Logs style)
// ============================================================
// Bulk-build 🗄️ Pitcher_K_Logs for the current MLB season via chunked
// time-based triggers. Uses league-wide pitching stats (not slate probables).
// Depends: MLBPitcherKLogsDB.js, MLBPitcherGameLogs.js, Config.js
// ============================================================

const MLB_PITCHER_K_CACHE_TAB = '🗄️ Pitcher_K_Cache';
const MLB_PITCHER_K_DUMP_INDEX_KEY = 'PITCHER_K_DUMP_INDEX';
const MLB_PITCHER_K_DUMP_SEASON_KEY = 'PITCHER_K_DUMP_SEASON';
const MLB_PITCHER_K_DUMP_HANDLER = 'processPitcherKLogsChunk';
const MLB_PITCHER_K_CHUNK_MS = 5 * 60 * 1000;

/**
 * Parse inningsPitched string to decimal IP (6.1 → 6.333).
 */
function mlbParseInningsPitched_(ipStr) {
  const s = String(ipStr || '').trim();
  if (!s) return 0;
  const parts = s.split('.');
  const whole = parseInt(parts[0], 10) || 0;
  const outs = parts.length > 1 ? parseInt(parts[1], 10) || 0 : 0;
  return Math.round((whole + outs / 3) * 1000) / 1000;
}

/**
 * All pitchers with season IP ≥ minIp (regular season, sportId=1).
 * @returns {Array<{id:number,name:string,ip:number,games:number,gs:number}>}
 */
function mlbFetchPitcherSeasonPool_(season, minIp) {
  const se = String(season);
  const floor = parseFloat(String(minIp)) || 20;
  const url =
    mlbStatsApiBaseUrl_() +
    '/stats?stats=season&group=pitching&season=' +
    encodeURIComponent(se) +
    '&sportId=1&gameType=R&limit=1500&sortStat=inningsPitched&order=desc';
  try {
    Utilities.sleep(80);
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      Logger.log('mlbFetchPitcherSeasonPool_ HTTP ' + res.getResponseCode());
      return [];
    }
    const payload = JSON.parse(res.getContentText());
    const splits = (payload.stats && payload.stats[0] && payload.stats[0].splits) || [];
    const out = [];
    splits.forEach(function (sp) {
      const pl = sp.player || {};
      const st = sp.stat || {};
      const id = parseInt(pl.id, 10);
      if (!id) return;
      const ip = mlbParseInningsPitched_(st.inningsPitched);
      if (ip < floor) return;
      const games = parseInt(st.gamesPlayed, 10) || 0;
      const gs = parseInt(st.gamesStarted, 10) || 0;
      out.push({
        id: id,
        name: pl.fullName || String(id),
        ip: ip,
        games: games,
        gs: gs,
      });
    });
    Logger.log('mlbFetchPitcherSeasonPool_: ' + out.length + ' pitchers (minIp=' + floor + ')');
    return out;
  } catch (e) {
    Logger.log('mlbFetchPitcherSeasonPool_: ' + e.message);
    return [];
  }
}

function mlbEnsurePitcherKCacheSheet_(ss) {
  let sh = ss.getSheetByName(MLB_PITCHER_K_CACHE_TAB);
  if (!sh) sh = ss.insertSheet(MLB_PITCHER_K_CACHE_TAB);
  sh.getRange(1, 1, 1, 5)
    .setValues([['pitcher_id', 'name', 'season_ip', 'games', 'games_started']])
    .setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.setTabColor('#546e7a');
  return sh;
}

/**
 * One HTTP call → 🗄️ Pitcher_K_Cache tab (run before overnight dump).
 */
function buildPitcherKIdCache() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig();
  const season =
    typeof mlbSlateSeasonYear_ === 'function'
      ? mlbSlateSeasonYear_(cfg)
      : new Date().getFullYear();
  const minIp = parseFloat(String(cfg['K_LOGS_DUMP_MIN_IP'] != null ? cfg['K_LOGS_DUMP_MIN_IP'] : '20')) || 20;

  ss.toast('Fetching league pitcher pool for ' + season + '…', 'MLB-BOIZ', 15);
  const pool = mlbFetchPitcherSeasonPool_(season, minIp);
  if (!pool.length) {
    safeAlert_('Pitcher K Cache', 'No pitchers returned from stats API. Check season / min IP.');
    return;
  }

  const sh = mlbEnsurePitcherKCacheSheet_(ss);
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
  }
  const rows = pool.map(function (p) {
    return [p.id, p.name, p.ip, p.games, p.gs];
  });
  sh.getRange(2, 1, rows.length, 5).setValues(rows);
  PropertiesService.getScriptProperties().setProperty(MLB_PITCHER_K_DUMP_SEASON_KEY, String(season));
  ss.toast('Pitcher K Cache: ' + rows.length + ' arms (≥' + minIp + ' IP)', 'MLB-BOIZ', 8);
}

function mlbDeletePitcherKDumpTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === MLB_PITCHER_K_DUMP_HANDLER) ScriptApp.deleteTrigger(t);
  });
}

function mlbPitcherKDumpIntervalMin_(cfg) {
  const n = parseInt(String(cfg['K_LOGS_DUMP_INTERVAL_MIN'] != null ? cfg['K_LOGS_DUMP_INTERVAL_MIN'] : '10'), 10);
  return !isNaN(n) && n >= 5 ? n : 10;
}

/**
 * Start overnight dump: optional clear, rebuild cache, 10-min triggers + first chunk.
 */
function startPitcherKLogsSeasonDump(clearFirst) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig();
  const season =
    typeof mlbSlateSeasonYear_ === 'function'
      ? mlbSlateSeasonYear_(cfg)
      : new Date().getFullYear();

  buildPitcherKIdCache();

  const cache = ss.getSheetByName(MLB_PITCHER_K_CACHE_TAB);
  if (!cache || cache.getLastRow() < 2) {
    safeAlert_('Pitcher K Dump', 'Cache empty after build. Aborting.');
    return;
  }

  if (clearFirst) {
    mlbEnsurePitcherKLogsSheet_(ss, true);
  } else {
    mlbEnsurePitcherKLogsSheet_(ss, false);
  }

  const props = PropertiesService.getScriptProperties();
  props.setProperty(MLB_PITCHER_K_DUMP_INDEX_KEY, '0');
  props.setProperty(MLB_PITCHER_K_DUMP_SEASON_KEY, String(season));

  mlbDeletePitcherKDumpTriggers_();
  const interval = mlbPitcherKDumpIntervalMin_(cfg);
  ScriptApp.newTrigger(MLB_PITCHER_K_DUMP_HANDLER).timeBased().everyMinutes(interval).create();

  ss.toast(
    '⏳ Pitcher K season dump started (' + interval + ' min chunks). Leave sheet open overnight.',
    'MLB-BOIZ',
    10
  );
  processPitcherKLogsChunk();
}

function stopPitcherKLogsSeasonDump() {
  mlbDeletePitcherKDumpTriggers_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.toast('Pitcher K season dump stopped (triggers removed).', 'MLB-BOIZ', 6);
}

function mlbAppendPitcherKLogRows_(sh, rows) {
  if (!rows || !rows.length) return 0;
  const startRow = Math.max(2, sh.getLastRow() + 1);
  sh.getRange(startRow, 1, rows.length, MLB_PITCHER_K_LOGS_NCOL).setValues(rows);
  SpreadsheetApp.flush();
  return rows.length;
}

/**
 * Build log rows for one pitcher (full season gameLog).
 */
function mlbPitcherKLogRowsForPitcher_(pid, name, throws, season) {
  const splits = mlbStatsApiGetPitchingGameSplits_(pid, season);
  const out = [];
  for (let j = 0; j < splits.length; j++) {
    const sp = splits[j];
    const team = sp.team || {};
    const opp = sp.opponent || {};
    const teamAbbr = String(team.abbreviation || '').trim().toUpperCase();
    const oppAbbr = String(opp.abbreviation || '').trim().toUpperCase();
    const homeAbbr = sp.isHome ? teamAbbr : oppAbbr;
    const row = mlbPitcherKLogRowFromSplit_(null, name, pid, throws, sp, {
      homeAbbr: homeAbbr,
      oppAbbr: oppAbbr,
      oppTeamId: opp.id,
      homeAway: sp.isHome ? 'H' : 'A',
      oppKSeason: '',
      oppKVsHand: '',
      oppKL14: '',
      parkKMult: mlbParkKLambdaMultForHomeAbbr_(homeAbbr),
      parkHrMult: mlbParkHrLambdaMultForHomeAbbr_(homeAbbr),
      hpUmpire: '',
      lineupWhiff: '',
    });
    if (row) out.push(row);
  }
  return out;
}

/**
 * Time-based chunk: process pitchers from cache until ~5 min elapsed.
 */
function processPitcherKLogsChunk() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig();
  const props = PropertiesService.getScriptProperties();
  const cache = ss.getSheetByName(MLB_PITCHER_K_CACHE_TAB);
  if (!cache || cache.getLastRow() < 2) {
    Logger.log('processPitcherKLogsChunk: cache missing');
    return;
  }

  const seasonRaw = props.getProperty(MLB_PITCHER_K_DUMP_SEASON_KEY);
  const season =
    seasonRaw ||
    (typeof mlbSlateSeasonYear_ === 'function'
      ? String(mlbSlateSeasonYear_(cfg))
      : String(new Date().getFullYear()));

  let currentIndex = parseInt(props.getProperty(MLB_PITCHER_K_DUMP_INDEX_KEY) || '0', 10);
  const players = cache.getRange(2, 1, cache.getLastRow() - 1, 2).getValues();

  if (currentIndex >= players.length) {
    mlbDeletePitcherKDumpTriggers_();
    props.deleteProperty(MLB_PITCHER_K_DUMP_INDEX_KEY);
    const logSh = ss.getSheetByName(MLB_PITCHER_K_LOGS_TAB);
    const nRows = logSh && logSh.getLastRow() > 1 ? logSh.getLastRow() - 1 : 0;
    if (typeof mlbBackfillPitcherKLogsContext_ === 'function') mlbBackfillPitcherKLogsContext_();
    if (typeof mlbBackfillPitcherKLogsProjIp_ === 'function') mlbBackfillPitcherKLogsProjIp_();
    ss.toast(
      '✅ Pitcher K season dump complete — ' + nRows + ' starts. Context + proj IP backfilled. Run walk-forward.',
      'MLB-BOIZ',
      12
    );
    Logger.log('✅ processPitcherKLogsChunk: complete nRows=' + nRows);
    return;
  }

  const logSh = mlbEnsurePitcherKLogsSheet_(ss, false);
  if (typeof mlbResetPitchHandCache_ === 'function') mlbResetPitchHandCache_();

  const idsToPrefetch = [];
  for (let i = currentIndex; i < Math.min(currentIndex + 45, players.length); i++) {
    const pid = parseInt(players[i][0], 10);
    if (pid) idsToPrefetch.push(pid);
  }
  if (idsToPrefetch.length) mlbPrefetchPitchHandsForIds_(idsToPrefetch);

  const startMs = Date.now();
  let appended = 0;

  while (currentIndex < players.length && Date.now() - startMs < MLB_PITCHER_K_CHUNK_MS) {
    const pid = parseInt(players[currentIndex][0], 10);
    const name = String(players[currentIndex][1] || pid).trim();
    if (!pid) {
      currentIndex++;
      continue;
    }
    try {
      const throws = mlbStatsApiGetPitchHand_(pid) || '';
      const rows = mlbPitcherKLogRowsForPitcher_(pid, name, throws, season);
      appended += mlbAppendPitcherKLogRows_(logSh, rows);
    } catch (e) {
      Logger.log('processPitcherKLogsChunk: pitcher ' + pid + ' — ' + e.message);
    }
    currentIndex++;
    Utilities.sleep(120);
  }

  props.setProperty(MLB_PITCHER_K_DUMP_INDEX_KEY, String(currentIndex));
  Logger.log(
    'processPitcherKLogsChunk: index ' + currentIndex + '/' + players.length + ' appended=' + appended
  );
  ss.toast(
    'K Logs dump: ' + currentIndex + '/' + players.length + ' pitchers · +' + appended + ' starts',
    'MLB-BOIZ',
    6
  );
}

function startPitcherKLogsSeasonDumpClear_() {
  startPitcherKLogsSeasonDump(true);
}

function startPitcherKLogsSeasonDumpResume_() {
  startPitcherKLogsSeasonDump(false);
}

function pitcherKLogsDumpStatusMenu_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const props = PropertiesService.getScriptProperties();
  const idx = props.getProperty(MLB_PITCHER_K_DUMP_INDEX_KEY);
  const season = props.getProperty(MLB_PITCHER_K_DUMP_SEASON_KEY) || '(unset)';
  const cache = ss.getSheetByName(MLB_PITCHER_K_CACHE_TAB);
  const logSh = ss.getSheetByName(MLB_PITCHER_K_LOGS_TAB);
  const cacheN = cache && cache.getLastRow() > 1 ? cache.getLastRow() - 1 : 0;
  const logN = logSh && logSh.getLastRow() > 1 ? logSh.getLastRow() - 1 : 0;
  let triggers = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === MLB_PITCHER_K_DUMP_HANDLER) triggers++;
  });
  const msg =
    'Season: ' +
    season +
    '\nCache pitchers: ' +
    cacheN +
    '\nLog starts: ' +
    logN +
    '\nDump index: ' +
    (idx != null ? idx + ' / ' + cacheN : '(not running)') +
    '\nActive triggers: ' +
    triggers;
  safeAlert_('🗄️ Pitcher K Dump Status', msg);
}
