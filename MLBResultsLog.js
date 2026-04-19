// ============================================================
// 📋 MLB Results Log — snapshot from 🃏 MLB_Bet_Card
// ============================================================
// Mirrors AI-BOIZ Results.js: append rows after each window so you
// can grade later. Columns include gamePk + pitcher_id for statsapi
// boxscore grading (see MLBResultsGrader.js).
// ============================================================

const MLB_RESULTS_LOG_TAB = '📋 MLB_Results_Log';
const MLB_RESULTS_LOG_NCOL = 21;

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
  'close_line',
  'close_odds',
  'clv_note',
];

/** One-line CLV summary: line move vs open + price at close (FanDuel tab). */
function mlbClvNoteFromOpenClose_(openLine, openOdds, closeLine, closeOdds, side) {
  const oL = parseFloat(String(openLine), 10);
  const cL = parseFloat(String(closeLine), 10);
  const sl = String(side || '').toLowerCase();
  if (isNaN(oL) || isNaN(cL)) return 'close lookup ok; line compare n/a';
  const d = Math.round((cL - oL) * 100) / 100;
  let hint = '';
  if (sl.indexOf('over') !== -1) {
    hint = d > 0 ? 'line rose vs open (harder Over)' : d < 0 ? 'line fell vs open (easier Over)' : 'line flat';
  } else if (sl.indexOf('under') !== -1) {
    hint = d > 0 ? 'line rose vs open (easier Under)' : d < 0 ? 'line fell vs open (harder Under)' : 'line flat';
  } else {
    hint = 'Δline ' + (d >= 0 ? '+' : '') + d;
  }
  return hint + ' · open ' + String(openLine) + '@' + String(openOdds) + ' → close ' + String(closeLine) + '@' + String(closeOdds);
}

/**
 * Current FanDuel main pitcher_strikeouts line + price for side from ✅ tab.
 * Tries log `Game` text first, then schedule matchup for gamePk (label drift).
 * @returns {{ line: *, american: * }|null}
 */
function mlbLookupClosingPitcherK_(ss, gameStr, playerStr, betSide, gamePk) {
  const oddsIdx = mlbBuildPitcherKOddsIndex_(ss);
  const pNorm = mlbNormalizePersonName_(playerStr);
  const labels = [];
  const a = String(gameStr || '').trim();
  if (a) labels.push(a);
  const fromSch = mlbScheduleMatchupForGamePk_(ss, gamePk);
  if (fromSch && labels.indexOf(fromSch) === -1) {
    labels.push(fromSch);
  }
  const sl = String(betSide || '').toLowerCase();
  for (let t = 0; t < labels.length; t++) {
    const gKeys = mlbCandidateGameKeys_(labels[t], '', '');
    const pointMap = mlbOddsPointMapForPitcher_(oddsIdx, gKeys, pNorm);
    if (!pointMap || !Object.keys(pointMap).length) continue;
    const mainPt = mlbPickMainKPoint_(pointMap);
    if (mainPt == null) continue;
    const px = mlbMainKPrices_(pointMap, mainPt);
    const american = sl.indexOf('over') !== -1 ? px.over : sl.indexOf('under') !== -1 ? px.under : '';
    if (american === '' || american == null) continue;
    return { line: mainPt, american: american };
  }
  return null;
}

/**
 * After FINAL odds refresh: fill close_line / close_odds / clv_note for this slate’s K rows.
 * Overwrites prior close columns when re-run (latest tab = “close” proxy).
 */
function mlbBackfillResultsLogClosingK_(ss) {
  const logSh = ss.getSheetByName(MLB_RESULTS_LOG_TAB);
  if (!logSh || logSh.getLastRow() < 4) return 0;

  const cfg = getConfig();
  const slateWant = getSlateDateString_(cfg);
  const last = logSh.getLastRow();
  const data = logSh.getRange(4, 1, last, MLB_RESULTS_LOG_NCOL).getValues();
  let n = 0;

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const slateStr = String(row[1] || '').trim();
    if (slateStr !== slateWant) continue;
    const market = String(row[5] || '').toLowerCase();
    if (market.indexOf('strikeout') === -1) continue;
    const player = String(row[3] || '').trim();
    const game = String(row[4] || '').trim();
    const side = String(row[7] || '').trim();
    const openLine = row[6];
    const openOdds = row[8];
    const gamePkLog = row[13];
    if (!player) continue;
    if (!String(game || '').trim() && !parseInt(gamePkLog, 10)) continue;

    const cl = mlbLookupClosingPitcherK_(ss, game, player, side, gamePkLog);
    if (!cl) {
      logSh.getRange(4 + i, 19, 4 + i, 21).setValues([['', '', 'no FD K match at close']]);
      continue;
    }
    const note = mlbClvNoteFromOpenClose_(openLine, openOdds, cl.line, cl.american, side);
    logSh.getRange(4 + i, 19, 4 + i, 21).setValues([[cl.line, cl.american, note]]);
    n++;
  }
  return n;
}

function mlbEnsureResultsLogLayout_(logSh) {
  const HEADER_ROW = 3;
  logSh.getRange(1, 1, 1, MLB_RESULTS_LOG_NCOL)
    .merge()
    .setValue('📋 MLB-BOIZ RESULTS LOG — snapshots + grading + close-line (FINAL backfill)')
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
  } else if (String(logSh.getRange(HEADER_ROW, 19).getValue() || '').trim() !== 'close_line') {
    logSh.getRange(HEADER_ROW, 19, HEADER_ROW, MLB_RESULTS_LOG_NCOL).setValues([['close_line', 'close_odds', 'clv_note']]);
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
      '',
      '',
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
