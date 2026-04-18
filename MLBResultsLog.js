// ============================================================
// 📋 MLB Results Log — snapshot from 🃏 MLB_Bet_Card
// ============================================================
// Mirrors AI-BOIZ Results.js: append rows after each window so you
// can grade later. Columns include gamePk + pitcher_id for statsapi
// boxscore grading (see MLBResultsGrader.js).
// ============================================================

const MLB_RESULTS_LOG_TAB = '📋 MLB_Results_Log';
const MLB_RESULTS_LOG_NCOL = 18;

const MLB_RESULTS_HEADERS = [
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
  'pitcher_id',
  'actual_K',
  'result',
  'grade_notes',
];

function mlbEnsureResultsLogLayout_(logSh) {
  const HEADER_ROW = 3;
  logSh.getRange(1, 1, 1, MLB_RESULTS_LOG_NCOL)
    .merge()
    .setValue('📋 MLB-BOIZ RESULTS LOG — snapshots + grading (statsapi boxscore)')
    .setFontWeight('bold')
    .setBackground('#1a73e8')
    .setFontColor('#ffffff');
  logSh
    .getRange(HEADER_ROW, 1, 1, MLB_RESULTS_LOG_NCOL)
    .setValues([MLB_RESULTS_HEADERS])
    .setFontWeight('bold')
    .setBackground('#1565C0')
    .setFontColor('#ffffff');
  logSh.setFrozenRows(HEADER_ROW);
}

/**
 * Append current bet card plays to MLB_Results_Log (one row per play).
 * @param {string} windowTag e.g. MORNING | MIDDAY | FINAL
 */
function snapshotMLBBetCardToLog(windowTag) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const bc = ss.getSheetByName(MLB_BET_CARD_TAB);
  if (!bc || bc.getLastRow() < 4) {
    Logger.log('snapshotMLBBetCardToLog: no bet card data');
    return;
  }

  const last = bc.getLastRow();
  const block = bc.getRange(4, 1, last, 18).getValues();
  const window = windowTag || 'UNKNOWN';
  const now = new Date();
  const tz = Session.getScriptTimeZone();
  const loggedAt = Utilities.formatDate(now, tz, 'yyyy-MM-dd HH:mm');
  const cfg = getConfig();
  const slateFallback = getSlateDateString_(cfg);

  let logSh = ss.getSheetByName(MLB_RESULTS_LOG_TAB);
  if (!logSh) {
    logSh = ss.insertSheet(MLB_RESULTS_LOG_TAB);
    logSh.setTabColor('#1a73e8');
  }

  const HEADER_ROW = 3;
  if (logSh.getLastRow() < HEADER_ROW || !String(logSh.getRange(HEADER_ROW, 14).getValue() || '').trim()) {
    mlbEnsureResultsLogLayout_(logSh);
  }

  const out = [];
  block.forEach(function (row) {
    const playText = String(row[4] || '');
    if (!playText || playText.indexOf('No qualifying') !== -1) return;
    const player = String(row[5] || '').trim();
    if (!player) return;

    out.push([
      loggedAt,
      row[0] || slateFallback,
      row[1],
      player,
      String(row[3] || '').trim(),
      String(row[6] || '').trim(),
      row[8],
      String(row[7] || '').trim(),
      row[9],
      row[11],
      row[12],
      window,
      playText,
      row[2],
      row[16],
      '',
      'PENDING',
      '',
    ]);
  });

  if (!out.length) return;

  const startRow = Math.max(logSh.getLastRow(), HEADER_ROW) + 1;
  logSh.getRange(startRow, 1, out.length, MLB_RESULTS_LOG_NCOL).setValues(out);
  try {
    ss.toast('Results log +' + out.length + ' · ' + window, 'MLB-BOIZ', 5);
  } catch (e) {}
}
