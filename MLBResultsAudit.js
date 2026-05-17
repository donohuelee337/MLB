// ============================================================
// 📊 MLB Results Audit — verification, cache, dashboard
// ============================================================
// Non-destructive verification layer. Flags anomalies, caches
// boxscore stat lines, provides reconciliation dashboard and
// spot-check re-grading. Never modifies graded results.
// ============================================================

const MLB_BOXSCORE_CACHE_TAB = '📦 Boxscore_Cache';
const MLB_BOXSCORE_CACHE_NCOL = 16;
const MLB_BOXSCORE_CACHE_HEADERS = [
  'cached_at', 'slate', 'gamePk', 'player_id', 'player_name',
  'market', 'actual_stat', 'game_status', 'ip', 'k',
  'h', 'ab', 'tb', 'hr', 'bb', 'source',
];

const MLB_AUDIT_TAB = '📊 Results_Audit';

/**
 * Ensure 📦 Boxscore_Cache tab exists with correct headers.
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function mlbEnsureBoxscoreCacheTab_(ss) {
  let sh = ss.getSheetByName(MLB_BOXSCORE_CACHE_TAB);
  if (!sh) {
    sh = ss.insertSheet(MLB_BOXSCORE_CACHE_TAB);
    sh.setTabColor('#6d4c41');
  }
  if (sh.getLastRow() < 3 || String(sh.getRange(3, 1).getValue() || '').trim() !== 'cached_at') {
    sh.getRange(1, 1, 1, MLB_BOXSCORE_CACHE_NCOL)
      .merge()
      .setValue('📦 Boxscore Cache — append-only stat lines from grading + spot-checks')
      .setFontWeight('bold')
      .setBackground('#4e342e')
      .setFontColor('#ffffff');
    sh.getRange(3, 1, 1, MLB_BOXSCORE_CACHE_NCOL)
      .setValues([MLB_BOXSCORE_CACHE_HEADERS])
      .setFontWeight('bold')
      .setBackground('#5d4037')
      .setFontColor('#ffffff');
    sh.setFrozenRows(3);
  }
  return sh;
}

/**
 * Append a stat line to 📦 Boxscore_Cache. Append-only — never overwrites.
 * @param {object} opts - { ss, slate, gamePk, playerId, playerName, market, actualStat, gameStatus, ip, k, h, ab, tb, hr, bb, source }
 */
function mlbWriteBoxscoreCache_(opts) {
  var ss = opts.ss || SpreadsheetApp.getActiveSpreadsheet();
  var sh = mlbEnsureBoxscoreCacheTab_(ss);
  var tz = Session.getScriptTimeZone();
  var now = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss');
  var nextRow = Math.max(sh.getLastRow(), 3) + 1;
  sh.getRange(nextRow, 1, 1, MLB_BOXSCORE_CACHE_NCOL).setValues([[
    now,
    String(opts.slate || ''),
    opts.gamePk || '',
    opts.playerId || '',
    String(opts.playerName || ''),
    String(opts.market || ''),
    opts.actualStat != null ? opts.actualStat : '',
    String(opts.gameStatus || ''),
    opts.ip != null ? opts.ip : '',
    opts.k != null ? opts.k : '',
    opts.h != null ? opts.h : '',
    opts.ab != null ? opts.ab : '',
    opts.tb != null ? opts.tb : '',
    opts.hr != null ? opts.hr : '',
    opts.bb != null ? opts.bb : '',
    String(opts.source || 'grader'),
  ]]);
}

/**
 * Read latest cached stat for a gamePk + player_id combo.
 * Returns the row object or null if not found.
 */
function mlbReadBoxscoreCache_(ss, gamePk, playerId) {
  var sh = ss.getSheetByName(MLB_BOXSCORE_CACHE_TAB);
  if (!sh || sh.getLastRow() < 4) return null;
  var data = sh.getRange(4, 1, sh.getLastRow() - 3, MLB_BOXSCORE_CACHE_NCOL).getValues();
  var gpk = parseInt(gamePk, 10);
  var pid = parseInt(playerId, 10);
  for (var i = data.length - 1; i >= 0; i--) {
    if (parseInt(data[i][2], 10) === gpk && parseInt(data[i][3], 10) === pid) {
      return {
        cachedAt: data[i][0], slate: data[i][1], gamePk: data[i][2],
        playerId: data[i][3], playerName: data[i][4], market: data[i][5],
        actualStat: data[i][6], gameStatus: data[i][7], ip: data[i][8],
        k: data[i][9], h: data[i][10], ab: data[i][11],
        tb: data[i][12], hr: data[i][13], bb: data[i][14], source: data[i][15],
      };
    }
  }
  return null;
}
