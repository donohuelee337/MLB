// ============================================================
// 🥎 Batter Game Logs — local per-game stat store
// ============================================================
// Persistent sheet of MLB Stats API hitting gameLog splits, captured
// once per player per day (America/New_York). Subsequent fetches for
// the same (player, season) within the same day read from this tab
// instead of hitting the API.
//
// Schema is intentionally wide for downstream Pandas analysis.
// ============================================================

const MLB_BATTER_GAME_LOGS_TAB = '🥎 Batter_Game_Logs';
const MLB_BATTER_GAME_LOGS_HEADERS = [
  'logged_at',     // NY date we fetched this split
  'player_id',
  'player_name',
  'team_abbr',     // team at time of game (from split)
  'season',
  'game_date',     // YYYY-MM-DD of the game
  'game_pk',
  'opp_id',
  'opp_abbr',
  'is_home',       // Y / N / ''
  'pa',
  'ab',
  'hits',
  'doubles',
  'triples',
  'hr',
  'rbi',
  'runs',
  'bb',
  'k',
  'sb',
  'tb',
];

/** Lazy: ensures the sheet exists with title + header rows. Returns the Sheet. */
function mlbBatterGameLogsEnsureSheet_(ss) {
  let sh = ss.getSheetByName(MLB_BATTER_GAME_LOGS_TAB);
  if (sh) return sh;
  sh = ss.insertSheet(MLB_BATTER_GAME_LOGS_TAB);
  sh.setTabColor('#0d47a1');
  sh.getRange(1, 1, 1, MLB_BATTER_GAME_LOGS_HEADERS.length)
    .merge()
    .setValue('🥎 Batter game logs — captured locally for speed + Pandas analysis')
    .setFontWeight('bold')
    .setBackground('#0d47a1')
    .setFontColor('#ffffff');
  sh.getRange(3, 1, 1, MLB_BATTER_GAME_LOGS_HEADERS.length)
    .setValues([MLB_BATTER_GAME_LOGS_HEADERS])
    .setFontWeight('bold')
    .setBackground('#1565c0')
    .setFontColor('#ffffff');
  sh.setFrozenRows(3);
  return sh;
}

/**
 * Read the tab and build a per-player index:
 *   { playerId: { loggedAt: 'YYYY-MM-DD', splits: [ {date, stat:{...}} , ... ] } }
 *
 * Splits are returned in the shape mlbStatsApiGetHittingGameSplits_ produces
 * (date string + stat object), so HR promo's L14 math works unchanged.
 * Only the rows with the **most recent logged_at** for each player are returned.
 */
function mlbBatterGameLogsReadIndex_(ss, season) {
  const sh = ss.getSheetByName(MLB_BATTER_GAME_LOGS_TAB);
  if (!sh || sh.getLastRow() < 4) return {};
  const last = sh.getLastRow();
  const vals = sh.getRange(4, 1, last - 3, MLB_BATTER_GAME_LOGS_HEADERS.length).getValues();
  const se = String(season);

  // First pass: per playerId, find the most recent logged_at for this season.
  const latestLoggedAt = {};
  for (let i = 0; i < vals.length; i++) {
    const row = vals[i];
    if (String(row[4]) !== se) continue;
    const pid = parseInt(row[1], 10);
    if (!pid) continue;
    const logged = String(row[0] || '');
    if (!latestLoggedAt[pid] || logged > latestLoggedAt[pid]) {
      latestLoggedAt[pid] = logged;
    }
  }

  // Second pass: collect splits only for the latest logged_at per player.
  const out = {};
  for (let i = 0; i < vals.length; i++) {
    const row = vals[i];
    if (String(row[4]) !== se) continue;
    const pid = parseInt(row[1], 10);
    if (!pid) continue;
    const logged = String(row[0] || '');
    if (logged !== latestLoggedAt[pid]) continue;
    if (!out[pid]) out[pid] = { loggedAt: logged, splits: [] };
    out[pid].splits.push({
      date: String(row[5] || ''),
      isHome: row[9] === 'Y' ? true : row[9] === 'N' ? false : null,
      game: { gamePk: row[6] || '' },
      opponent: { id: row[7] || '', name: row[8] || '' },
      team: { abbreviation: row[3] || '' },
      stat: {
        plateAppearances: row[10],
        atBats: row[11],
        hits: row[12],
        doubles: row[13],
        triples: row[14],
        homeRuns: row[15],
        rbi: row[16],
        runs: row[17],
        baseOnBalls: row[18],
        strikeOuts: row[19],
        stolenBases: row[20],
        totalBases: row[21],
      },
    });
  }

  // Splits are stored newest-first when we write them; the read loop preserves order.
  return out;
}

/** Turn an API split into a tab row. */
function mlbBatterGameLogsSplitToRow_(loggedAt, playerId, playerName, season, sp) {
  const g = sp.game || {};
  const opp = sp.opponent || {};
  const team = sp.team || {};
  const st = sp.stat || {};
  return [
    loggedAt,
    playerId,
    playerName || '',
    String(team.abbreviation || ''),
    String(season),
    sp.date || '',
    g.gamePk != null ? g.gamePk : '',
    opp.id != null ? opp.id : '',
    String(opp.abbreviation || opp.name || ''),
    sp.isHome === true ? 'Y' : sp.isHome === false ? 'N' : '',
    st.plateAppearances != null ? st.plateAppearances : '',
    st.atBats != null ? st.atBats : '',
    st.hits != null ? st.hits : '',
    st.doubles != null ? st.doubles : '',
    st.triples != null ? st.triples : '',
    st.homeRuns != null ? st.homeRuns : '',
    st.rbi != null ? st.rbi : '',
    st.runs != null ? st.runs : '',
    st.baseOnBalls != null ? st.baseOnBalls : '',
    st.strikeOuts != null ? st.strikeOuts : '',
    st.stolenBases != null ? st.stolenBases : '',
    st.totalBases != null ? st.totalBases : '',
  ];
}

/**
 * Append a batch of tab rows. Buffered + flushed by the helper module —
 * callers should not invoke directly.
 */
function mlbBatterGameLogsAppendRows_(ss, rows) {
  if (!rows || !rows.length) return;
  const sh = mlbBatterGameLogsEnsureSheet_(ss);
  const startRow = Math.max(sh.getLastRow() + 1, 4);
  sh.getRange(startRow, 1, rows.length, MLB_BATTER_GAME_LOGS_HEADERS.length).setValues(rows);
}

/** Menu: read-only tally of how many player-game rows are stored (for sanity-checking). */
function mlbBatterGameLogsStats_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(MLB_BATTER_GAME_LOGS_TAB);
  if (!sh || sh.getLastRow() < 4) {
    safeAlert_('Batter game logs', 'No rows yet — run a Morning window with HR promo.');
    return;
  }
  const n = sh.getLastRow() - 3;
  ss.toast(n + ' game-log rows stored', 'Batter game logs', 6);
}
