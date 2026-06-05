// ============================================================
// 🗄️ Pitcher_K_Logs — season DB for walk-forward backtest
// ============================================================
// One row per pitcher start (statsapi gameLog). Probable pitcher IDs
// from 📅 MLB_Schedule; context columns via mlbBackfillPitcherKLogsContext_.
// Depends: MLBPitcherGameLogs.js, MLBPitcherKQueue.js, MLBSchedule.js
// ============================================================

const MLB_PITCHER_K_LOGS_TAB = '🗄️ Pitcher_K_Logs';
const MLB_PITCHER_K_LOGS_NCOL = 26;

const MLB_PITCHER_K_LOGS_HEADERS = [
  'date',
  'game_pk',
  'pitcher_id',
  'pitcher_name',
  'throws',
  'k',
  'ip',
  'bf',
  'opp_abbr',
  'opp_team_id',
  'home_away',
  'opp_k_pa_season',
  'opp_k_pa_vs_hand',
  'opp_k_pa_l14',
  'park_k_mult',
  'park_hr_mult',
  'hp_umpire',
  'lineup_whiff_avg',
  'proxy_k_line',
  'lambda_raw',
  'p_over_raw',
  'p_under_raw',
  'proj_ip_v1',
  'proj_ip_v2',
  'ip_error_v1',
  'ip_error_v2',
];

/** Extend header row when tab predates proj IP audit cols (no data wipe). */
function mlbEnsurePitcherKLogsProjIpHeaders_(sh) {
  if (!sh) return;
  const h23 = String(sh.getRange(1, 23).getValue() || '').trim();
  if (h23 === MLB_PITCHER_K_LOGS_HEADERS[22]) return;
  sh.getRange(1, 23, 1, 4)
    .setValues([['proj_ip_v1', 'proj_ip_v2', 'ip_error_v1', 'ip_error_v2']])
    .setFontWeight('bold');
}

/**
 * L3 IP sum + start count from prior log rows (0-indexed row arrays).
 * @param {Array<Array>} priorRows
 * @returns {{l3ip: number, games: number}}
 */
function mlbL3IpGamesFromPriorLogRows_(priorRows) {
  const l3 = (priorRows || []).slice(-3);
  let l3ip = 0;
  let games = 0;
  for (let i = 0; i < l3.length; i++) {
    const ip = parseFloat(String(l3[i][6]));
    if (!isNaN(ip) && ip > 0) {
      l3ip += ip;
      games++;
    }
  }
  return { l3ip: l3ip, games: games };
}

/** actual − projected (decimal IP); blank if either side missing. */
function mlbIpError_(actualIp, projIp) {
  const a = parseFloat(String(actualIp));
  const p = parseFloat(String(projIp));
  if (isNaN(a) || isNaN(p)) return '';
  return Math.round((a - p) * 1000) / 1000;
}

/**
 * Walk-forward proj IP + error cols (23–26) from prior starts in the log.
 * Uses same helpers as the live K card (mlbProjIpFromQueueRow_*).
 */
function mlbBackfillPitcherKLogsProjIp_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(MLB_PITCHER_K_LOGS_TAB);
  if (!sh || sh.getLastRow() < 2) return 0;
  mlbEnsurePitcherKLogsProjIpHeaders_(sh);
  const last = sh.getLastRow();
  const ncol = Math.max(MLB_PITCHER_K_LOGS_NCOL, sh.getLastColumn());
  const data = sh.getRange(2, 1, last - 1, ncol).getValues();
  const byPitcher = {};
  data.forEach(function (r, idx) {
    const pid = String(r[2]);
    if (!pid) return;
    if (!byPitcher[pid]) byPitcher[pid] = [];
    byPitcher[pid].push({ idx: idx, row: r });
  });
  Object.keys(byPitcher).forEach(function (pid) {
    byPitcher[pid].sort(function (a, b) {
      return String(a.row[0]).localeCompare(String(b.row[0]));
    });
  });

  const projCols = [];
  for (let i = 0; i < data.length; i++) {
    projCols.push(['', '', '', '']);
  }
  let n = 0;
  Object.keys(byPitcher).forEach(function (pid) {
    const entries = byPitcher[pid];
    for (let g = 0; g < entries.length; g++) {
      const cur = entries[g];
      const prior = entries.slice(0, g).map(function (e) {
        return e.row;
      });
      const inputs = mlbL3IpGamesFromPriorLogRows_(prior);
      const projV1 =
        typeof mlbProjIpFromQueueRow_ === 'function'
          ? mlbProjIpFromQueueRow_(inputs.l3ip)
          : '';
      const projV2 =
        typeof mlbProjIpFromQueueRowV2_ === 'function'
          ? mlbProjIpFromQueueRowV2_(inputs.l3ip, inputs.games)
          : projV1;
      const actualIp = parseFloat(String(cur.row[6]));
      const errV1 = mlbIpError_(actualIp, projV1);
      const errV2 = mlbIpError_(actualIp, projV2);
      projCols[cur.idx] = [projV1, projV2, errV1, errV2];
      n++;
    }
  });

  if (projCols.length) {
    sh.getRange(2, 23, projCols.length, 4).setValues(projCols);
  }
  return n;
}

/**
 * For today's slate queue rows, stamp proj_ip_v1/v2 onto matching K Log rows
 * (same game_pk + pitcher_id) when the start row already exists post-game.
 */
function mlbSnapshotSlateProjIpFromQueue_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logSh = ss.getSheetByName(MLB_PITCHER_K_LOGS_TAB);
  const qTab =
    typeof MLB_PITCHER_K_QUEUE_TAB !== 'undefined' ? MLB_PITCHER_K_QUEUE_TAB : '📋 Pitcher_K_Queue';
  const qSh = ss.getSheetByName(qTab);
  if (!logSh || logSh.getLastRow() < 2 || !qSh || qSh.getLastRow() < 4) return 0;
  mlbEnsurePitcherKLogsProjIpHeaders_(logSh);
  const qData = qSh.getRange(4, 1, qSh.getLastRow(), 20).getValues();
  const last = logSh.getLastRow();
  const ncol = Math.max(MLB_PITCHER_K_LOGS_NCOL, logSh.getLastColumn());
  const logData = logSh.getRange(2, 1, last - 1, ncol).getValues();
  const index = {};
  logData.forEach(function (r, i) {
    const key = String(r[1]) + '|' + String(r[2]);
    index[key] = i;
  });
  let updated = 0;
  qData.forEach(function (qr) {
    const gamePk = String(qr[0] || '').trim();
    const pid = String(qr[4] || '').trim();
    if (!gamePk || !pid) return;
    const hit = index[gamePk + '|' + pid];
    if (hit == null) return;
    const l3ip = qr[9];
    const games = qr[19];
    const projV1 =
      typeof mlbProjIpFromQueueRow_ === 'function' ? mlbProjIpFromQueueRow_(l3ip) : '';
    const projV2 =
      typeof mlbProjIpFromQueueRowV2_ === 'function'
        ? mlbProjIpFromQueueRowV2_(l3ip, games)
        : projV1;
    const rowNum = 2 + hit;
    const actualIp = logData[hit][6];
    logSh.getRange(rowNum, 23, 1, 4).setValues([
      [projV1, projV2, mlbIpError_(actualIp, projV1), mlbIpError_(actualIp, projV2)],
    ]);
    updated++;
  });
  return updated;
}

function mlbBackfillPitcherKLogsProjIpMenu_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const n = mlbBackfillPitcherKLogsProjIp_();
  try {
    ss.toast('Proj IP backfill: ' + n + ' start row(s)', 'MLB-BOIZ', 8);
  } catch (e) {}
}

/** Apps Script editor / menu entry point — backfill proj_ip_v1/v2 on 🗄️ Pitcher_K_Logs. */
function backfillPitcherKLogsProjIp() {
  mlbBackfillPitcherKLogsProjIpMenu_();
}

/**
 * @param {boolean} clearData - true = wipe tab (slate refresh); false = headers only if new
 */
function mlbEnsurePitcherKLogsSheet_(ss, clearData) {
  let sh = ss.getSheetByName(MLB_PITCHER_K_LOGS_TAB);
  if (!sh) sh = ss.insertSheet(MLB_PITCHER_K_LOGS_TAB);
  if (clearData) {
    sh.clearContents();
  } else if (sh.getLastRow() < 1 || String(sh.getRange(1, 1).getValue()) !== MLB_PITCHER_K_LOGS_HEADERS[0]) {
    sh.clearContents();
  }
  if (sh.getLastRow() < 1) {
    sh.getRange(1, 1, 1, MLB_PITCHER_K_LOGS_NCOL)
      .setValues([MLB_PITCHER_K_LOGS_HEADERS])
      .setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.setTabColor('#37474f');
  } else {
    mlbEnsurePitcherKLogsProjIpHeaders_(sh);
  }
  return sh;
}

/**
 * @param {Object} ctx homeAbbr, oppAbbr, oppTeamId, homeAway, oppKSeason, oppKVsHand, oppKL14, parkKMult, parkHrMult, hpUmpire, lineupWhiff
 * @returns {Array|null}
 */
function mlbPitcherKLogRowFromSplit_(sl, pitcherName, pitcherId, throws, sp, ctx) {
  const g = sp.game || {};
  const opp = sp.opponent || {};
  const st = sp.stat || {};
  const k = parseInt(st.strikeOuts, 10);
  const ip =
    typeof mlbParseInningsString_ === 'function'
      ? mlbParseInningsString_(st.inningsPitched)
      : parseFloat(st.inningsPitched) || 0;
  const bf = parseInt(st.battersFaced, 10) || 0;
  const gamePk = g.gamePk != null ? g.gamePk : '';
  const gameDate = g.gameDate || sp.date || '';
  if (!gamePk || !gameDate) return null;
  return [
    gameDate,
    gamePk,
    pitcherId,
    pitcherName,
    throws,
    isNaN(k) ? '' : k,
    ip || '',
    bf || '',
    String(opp.abbreviation || (ctx && ctx.oppAbbr) || '').toUpperCase(),
    opp.id || (ctx && ctx.oppTeamId) || '',
    (ctx && ctx.homeAway) || '',
    (ctx && ctx.oppKSeason) || '',
    (ctx && ctx.oppKVsHand) || '',
    (ctx && ctx.oppKL14) || '',
    ctx && ctx.parkKMult != null ? ctx.parkKMult : 1,
    ctx && ctx.parkHrMult != null ? ctx.parkHrMult : 1,
    (ctx && ctx.hpUmpire) || '',
    (ctx && ctx.lineupWhiff) || '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
  ];
}

/**
 * Build / refresh 🗄️ Pitcher_K_Logs for the slate season (full gameLog per probable SP).
 */
function refreshPitcherKLogsDB() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig();
  const season =
    typeof mlbSlateSeasonYear_ === 'function'
      ? mlbSlateSeasonYear_(cfg)
      : new Date().getFullYear();
  const sh = mlbEnsurePitcherKLogsSheet_(ss, true);
  ss.toast('Building Pitcher K Logs (slate probables) for ' + season + '…', 'MLB-BOIZ', 30);

  if (typeof mlbResetPitchHandCache_ === 'function') mlbResetPitchHandCache_();

  const scheduleTab =
    typeof MLB_SCHEDULE_TAB !== 'undefined' ? MLB_SCHEDULE_TAB : '📅 MLB_Schedule';
  const schedule = ss.getSheetByName(scheduleTab);
  const pitcherIds = {};
  const pitcherNames = {};

  if (schedule && schedule.getLastRow() >= 4) {
    const schLast = schedule.getLastRow();
    const schCols = Math.max(14, schedule.getLastColumn());
    const srows = schedule.getRange(4, 1, schLast, schCols).getValues();
    srows.forEach(function (r) {
      const awayId = parseInt(r[11], 10);
      const homeId = parseInt(r[12], 10);
      const awayName = String(r[6] || '').trim();
      const homeName = String(r[7] || '').trim();
      if (awayId) {
        pitcherIds[awayId] = true;
        if (awayName) pitcherNames[awayId] = awayName;
      }
      if (homeId) {
        pitcherIds[homeId] = true;
        if (homeName) pitcherNames[homeId] = homeName;
      }
    });
  }

  const ids = Object.keys(pitcherIds).map(function (x) {
    return parseInt(x, 10);
  });
  if (!ids.length) {
    safeAlert_('Pitcher K Logs', 'No probable pitcher IDs on schedule. Run schedule first.');
    return;
  }

  mlbPrefetchPitchHandsForIds_(ids);
  const out = [];
  const startMs = Date.now();

  for (let i = 0; i < ids.length; i++) {
    if (Date.now() - startMs > 240000) break;
    const pid = ids[i];
    const splits = mlbStatsApiGetPitchingGameSplits_(pid, season);
    const throws = mlbStatsApiGetPitchHand_(pid) || '';
    const name = pitcherNames[pid] || String(pid);
    for (let j = 0; j < splits.length; j++) {
      const sp = splits[j];
      const row = mlbPitcherKLogRowFromSplit_(null, name, pid, throws, sp, {
        homeAbbr: '',
        oppAbbr: (sp.opponent && sp.opponent.abbreviation) || '',
        oppTeamId: sp.opponent && sp.opponent.id,
        homeAway: sp.isHome ? 'H' : 'A',
        oppKSeason: '',
        oppKVsHand: '',
        oppKL14: '',
        parkKMult: 1,
        parkHrMult: 1,
        hpUmpire: '',
        lineupWhiff: '',
      });
      if (row) out.push(row);
    }
    if (i % 10 === 9) Utilities.sleep(100);
  }

  out.sort(function (a, b) {
    const da = String(a[0]);
    const db = String(b[0]);
    if (da !== db) return da.localeCompare(db);
    return String(a[1]).localeCompare(String(b[1]));
  });

  if (out.length) {
    sh.getRange(2, 1, out.length, MLB_PITCHER_K_LOGS_NCOL).setValues(out);
  }
  mlbBackfillPitcherKLogsContext_();
  mlbBackfillPitcherKLogsProjIp_();
  ss.toast('Pitcher K Logs: ' + out.length + ' rows (+ proj IP)', 'MLB-BOIZ', 8);
}

/**
 * Backfill opp K rates + park context columns (cols 12–18) from log history.
 * homeAbbr: schedule game_pk → home col when on slate tab; else park mult 1.
 */
function mlbBackfillPitcherKLogsContext_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(MLB_PITCHER_K_LOGS_TAB);
  if (!sh || sh.getLastRow() < 2) return;
  const cfg = getConfig();
  const last = sh.getLastRow();
  const data = sh.getRange(2, 1, last - 1, MLB_PITCHER_K_LOGS_NCOL).getValues();

  const homeByGamePk = {};
  if (typeof mlbGetScheduleBlock_ === 'function') {
    const block = mlbGetScheduleBlock_(ss);
    for (let i = 0; i < block.length; i++) {
      const pk = parseInt(block[i][0], 10);
      if (pk) homeByGamePk[pk] = String(block[i][4] || '').trim().toUpperCase();
    }
  }

  const teamBattingIndex = {};
  data.forEach(function (r) {
    const opp = String(r[8] || '').toUpperCase();
    if (!opp) return;
    if (!teamBattingIndex[opp]) teamBattingIndex[opp] = [];
    teamBattingIndex[opp].push({
      date: r[0],
      bf: r[7],
      kAgainst: r[5],
      pitcherThrows: String(r[4] || '').toUpperCase(),
    });
  });

  const ctxCols = [];
  for (let i = 0; i < data.length; i++) {
    const r = data[i];
    const gamePk = parseInt(r[1], 10);
    const oppAbbr = String(r[8] || '').toUpperCase();
    const throws = String(r[4] || '').toUpperCase();
    const rates = mlbOppKRatesAsOf_(teamBattingIndex[oppAbbr] || [], r[0], throws, cfg);
    const homeAbbr = gamePk && homeByGamePk[gamePk] ? homeByGamePk[gamePk] : '';
    const existingParkK = parseFloat(String(r[14]));
    const existingParkHr = parseFloat(String(r[15]));
    const parkK = homeAbbr
      ? mlbParkKLambdaMultForHomeAbbr_(homeAbbr)
      : !isNaN(existingParkK) && existingParkK > 0
        ? existingParkK
        : 1;
    const parkHr = homeAbbr
      ? mlbParkHrLambdaMultForHomeAbbr_(homeAbbr)
      : !isNaN(existingParkHr) && existingParkHr > 0
        ? existingParkHr
        : 1;
    ctxCols.push([
      rates.oppKSeason || '',
      rates.oppKVsHand || '',
      rates.oppKL14 || '',
      parkK,
      parkHr,
      '',
      '',
    ]);
  }
  if (ctxCols.length) {
    sh.getRange(2, 12, ctxCols.length, 7).setValues(ctxCols);
  }
  mlbBackfillPitcherKLogsProjIp_();
}
