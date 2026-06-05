// ============================================================
// 🧪 MLB Results Log TB v2 — shadow TB log
// ============================================================
// Parallel to 🧪 MLB_Results_Log_v2 (which tracks shadow hits). This one
// tracks tb.v2-full alongside the live 🎲 Batter_TB_Card / 📋 MLB_Results_Log.
// Same 24 base columns + 6 v2-specific columns (model_version + four
// feature multipliers + base λ). Graded by gradeMLBTBV2PendingResults_
// in MLBResultsGraderV2.js.
// ============================================================

const MLB_RESULTS_LOG_TB_V2_TAB = '🧪 MLB_Results_Log_TB_v2';
const MLB_RESULTS_LOG_TB_V2_NCOL = 30;

const MLB_RESULTS_TB_V2_HEADERS = [
  'Logged At',
  'Slate',
  'Rank',
  'Player',
  'Game',
  'Market',
  'Line',
  'Side',
  'Odds',
  'Model P(Win)',
  'EV ($1)',
  'Window',
  'Play',
  'gamePk',
  'batter_id',
  'actual_TB',
  'result',
  'grade_notes',
  'close_line',
  'close_odds',
  'clv_note',
  'bet_key',
  'open_line',
  'open_odds',
  'model_version',
  'base_lambda',
  'park_mult',
  'opp_sp_mult',
  'hand_mult',
  'ab_mult',
];

function mlbEnsureResultsLogTbV2Layout_(logSh) {
  const HEADER_ROW = 3;
  logSh.getRange(1, 1, 1, MLB_RESULTS_LOG_TB_V2_NCOL)
    .merge()
    .setValue('🧪 MLB-BOIZ TB SHADOW LOG — tracks tb.v2-full alongside the live TB Bet Card')
    .setFontWeight('bold')
    .setBackground('#6a1b9a')
    .setFontColor('#ffffff');
  logSh
    .getRange(HEADER_ROW, 1, 1, MLB_RESULTS_LOG_TB_V2_NCOL)
    .setValues([MLB_RESULTS_TB_V2_HEADERS])
    .setFontWeight('bold')
    .setBackground('#4a148c')
    .setFontColor('#ffffff');
  logSh.setFrozenRows(HEADER_ROW);
}

function mlbFindResultsLogTbV2RowForUpsert_(logSh, slateWant, betKey, gamePk, batterId, side, line) {
  const last = logSh.getLastRow();
  if (last < 4) return -1;
  const nc = Math.max(MLB_RESULTS_LOG_TB_V2_NCOL, logSh.getLastColumn());
  const data = logSh.getRange(4, 1, last, nc).getValues();
  const wantG = parseInt(gamePk, 10);
  const wantP = parseInt(batterId, 10);
  const sideN = String(side || '').trim().toLowerCase().replace(/\s+/g, '');
  const lineS = String(line != null ? line : '').trim();
  for (let i = data.length - 1; i >= 0; i--) {
    if (String(data[i][1] || '').trim() !== slateWant) continue;
    const stored = String(data[i][21] || '').trim();
    if (stored && stored === betKey) return 4 + i;
    const g = parseInt(data[i][13], 10);
    const p = parseInt(data[i][14], 10);
    const sd = String(data[i][7] || '').trim().toLowerCase().replace(/\s+/g, '');
    if (
      g === wantG && !isNaN(g) &&
      p === wantP && !isNaN(p) &&
      sd === sideN &&
      String(data[i][6] != null ? data[i][6] : '').trim() === lineS
    ) {
      return 4 + i;
    }
  }
  return -1;
}

/**
 * Append the TB v2 shadow card to 🧪 MLB_Results_Log_TB_v2.
 * Filters: best_side present, best_ev > 0, no 'injury' flag. Mirrors live's
 * effective gating so the shadow tracker stays apples-to-apples.
 * @param {string} windowTag MORNING | MIDDAY | FINAL
 */
function snapshotMLBTBV2BetCardToLog(windowTag) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const card = ss.getSheetByName(MLB_BATTER_TB_V2_CARD_TAB);
  if (!card || card.getLastRow() < 4) {
    Logger.log('snapshotMLBTBV2BetCardToLog: no TB v2 card data');
    return;
  }

  const cfg = getConfig();
  const minEvCfg = parseFloat(String(cfg['MIN_EV_BET_CARD'] != null ? cfg['MIN_EV_BET_CARD'] : '0').trim(), 10);
  const minEvFloor = !isNaN(minEvCfg) && minEvCfg > 0 ? minEvCfg : 0;
  const slateFallback = getSlateDateString_(cfg);
  const window = windowTag || 'UNKNOWN';
  const tz = Session.getScriptTimeZone();
  const loggedAt = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm');

  let logSh = ss.getSheetByName(MLB_RESULTS_LOG_TB_V2_TAB);
  if (!logSh) {
    logSh = ss.insertSheet(MLB_RESULTS_LOG_TB_V2_TAB);
    logSh.setTabColor('#6a1b9a');
  }
  if (logSh.getLastRow() < 3 || !String(logSh.getRange(3, 14).getValue() || '').trim()) {
    mlbEnsureResultsLogTbV2Layout_(logSh);
  }

  const last = card.getLastRow();
  const block = card.getRange(4, 1, last, 34).getValues();
  let appended = 0;
  let updated = 0;
  let rank = 0;

  block.forEach(function (row) {
    const gamePk = row[0];
    const matchup = row[1];
    const batter = String(row[2] || '').trim();
    const line = row[3];
    const fdOver = row[4];
    const fdUnder = row[5];
    const pOver = row[8];
    const pUnder = row[9];
    const bestSide = String(row[14] || '').trim();
    const bestEv = row[15];
    const flags = String(row[16] || '');
    const batterId = row[17];
    const baseLam = row[18];
    const parkMult = row[19];
    const oppMult = row[20];
    const handMult = row[21];
    const abMult = row[22];
    const modelVer = String(row[31] || 'tb.v2-full').trim() || 'tb.v2-full';

    if (!batter) return;
    if (flags.indexOf('injury') !== -1) return;
    if (bestSide !== 'Over' && bestSide !== 'Under') return;
    if (line === '' || line == null) return;
    const odds = bestSide === 'Over' ? fdOver : fdUnder;
    if (odds === '' || odds == null) return;
    const pWin = bestSide === 'Over' ? pOver : pUnder;
    const ev = parseFloat(String(bestEv));
    if (isNaN(ev) || ev <= 0) return;
    if (minEvFloor > 0 && ev < minEvFloor) return;

    rank += 1;
    const playText =
      batter + ' — TB ' + bestSide + ' ' + String(line) + ' [shadow:' + modelVer + ']';

    const slate = slateFallback;
    const betKey = mlbBetResultKey_(slate, gamePk, batterId, bestSide, line) + '|' + modelVer;
    const hitRow = mlbFindResultsLogTbV2RowForUpsert_(logSh, slate, betKey, gamePk, batterId, bestSide, line);

    if (hitRow > 0) {
      const nc = Math.max(MLB_RESULTS_LOG_TB_V2_NCOL, logSh.getLastColumn());
      const prev = logSh.getRange(hitRow, 1, 1, nc).getValues()[0];
      let openL = prev[22];
      let openO = prev[23];
      if (openL === '' || openL == null) {
        openL = prev[6];
        openO = prev[8];
        logSh.getRange(hitRow, 23).setValue(openL);
        logSh.getRange(hitRow, 24).setValue(openO);
      }
      if (!String(prev[21] || '').trim()) {
        logSh.getRange(hitRow, 22).setValue(betKey);
      }
      logSh.getRange(hitRow, 1, 1, 12).setValues([
        [
          loggedAt, slate, rank, batter, matchup,
          'Batter total bases (shadow)',
          line, bestSide, odds, pWin, ev, window,
        ],
      ]);
      logSh.getRange(hitRow, 13).setValue(playText);
      logSh.getRange(hitRow, 14).setValue(gamePk);
      logSh.getRange(hitRow, 15).setValue(batterId);
      logSh.getRange(hitRow, 25, 1, 6).setValues([[modelVer, baseLam, parkMult, oppMult, handMult, abMult]]);
      updated++;
      return;
    }

    const nextRow = Math.max(logSh.getLastRow(), 3) + 1;
    logSh
      .getRange(nextRow, 1, 1, MLB_RESULTS_LOG_TB_V2_NCOL)
      .setValues([
        [
          loggedAt, slate, rank, batter, matchup,
          'Batter total bases (shadow)',
          line, bestSide, odds, pWin, ev, window,
          playText, gamePk, batterId,
          '', 'PENDING', '',
          '', '', '',
          betKey, line, odds,
          modelVer, baseLam, parkMult, oppMult, handMult, abMult,
        ],
      ]);
    appended++;
  });

  if (appended === 0 && updated === 0) return;
  try {
    ss.toast(
      'TB Shadow +' + appended + ' new · ' + updated + ' updated · ' + window,
      'MLB-BOIZ',
      6
    );
  } catch (e) {}
}

function mlbSnapshotTBV2Midday_() {
  snapshotMLBTBV2BetCardToLog('MIDDAY');
}

function mlbActivateTBV2LogTab_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(MLB_RESULTS_LOG_TB_V2_TAB);
  if (sh) sh.activate();
  else ss.toast('Run the pipeline once to create ' + MLB_RESULTS_LOG_TB_V2_TAB, 'MLB-BOIZ', 5);
}
