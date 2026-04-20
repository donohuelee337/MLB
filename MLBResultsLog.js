// ============================================================
// 📋 MLB Results Log — snapshot from 🃏 MLB_Bet_Card
// ============================================================
// Mirrors AI-BOIZ Results.js: append rows after each window so you
// can grade later. Columns include gamePk + pitcher_id for statsapi
// boxscore grading (see MLBResultsGrader.js).
// ============================================================

const MLB_RESULTS_LOG_TAB = '📋 MLB_Results_Log';
const MLB_RESULTS_LOG_NCOL = 24;

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
  'actual_stat',
  'result',
  'grade_notes',
  'close_line',
  'close_odds',
  'clv_note',
  'bet_key',
  'open_line',
  'open_odds',
];

function mlbBetResultKey_(slate, gamePk, pitcherId, side, line, market) {
  const mkt = String(market || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
  return [
    String(slate || '').trim(),
    String(gamePk != null ? gamePk : '').trim(),
    String(pitcherId != null ? pitcherId : '').trim(),
    mkt || 'unknown_market',
    String(side || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ''),
    String(line != null ? line : '').trim(),
  ].join('|');
}

/** Sheet row index (1-based) or -1; prefers latest matching row. */
function mlbFindResultsLogSheetRowForUpsert_(logSh, slateWant, betKey, gamePk, pitcherId, side, line, market) {
  const last = logSh.getLastRow();
  if (last < 4) return -1;
  const nc = Math.max(MLB_RESULTS_LOG_NCOL, logSh.getLastColumn());
  const data = logSh.getRange(4, 1, last, nc).getValues();
  const wantG = parseInt(gamePk, 10);
  const wantP = parseInt(pitcherId, 10);
  const sideN = String(side || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
  const lineS = String(line != null ? line : '').trim();
  const wantM = String(market || '').trim().toLowerCase();
  for (let i = data.length - 1; i >= 0; i--) {
    if (String(data[i][1] || '').trim() !== slateWant) continue;
    const stored = String(data[i][21] || '').trim();
    if (stored && stored === betKey) {
      return 4 + i;
    }
    const g = parseInt(data[i][13], 10);
    const p = parseInt(data[i][14], 10);
    const sd = String(data[i][7] || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '');
    const rowM = String(data[i][5] || '').trim().toLowerCase();
    if (
      g === wantG &&
      !isNaN(g) &&
      p === wantP &&
      !isNaN(p) &&
      sd === sideN &&
      String(data[i][6] != null ? data[i][6] : '').trim() === lineS &&
      (!wantM || rowM === wantM)
    ) {
      return 4 + i;
    }
  }
  return -1;
}

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
  return mlbLookupClosingPitcherProp_(ss, gameStr, playerStr, betSide, gamePk, 'pitcher_strikeouts');
}

function mlbLookupClosingPitcherWalks_(ss, gameStr, playerStr, betSide, gamePk) {
  return mlbLookupClosingPitcherProp_(ss, gameStr, playerStr, betSide, gamePk, 'pitcher_walks');
}

function mlbLookupClosingPitcherProp_(ss, gameStr, playerStr, betSide, gamePk, marketKey) {
  const oddsIdx = mlbBuildPitcherOddsIndexForMarket_(ss, marketKey);
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
 * After FINAL odds refresh: fill close_line / close_odds / clv_note for this slate’s pitcher prop rows.
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
    const player = String(row[3] || '').trim();
    const game = String(row[4] || '').trim();
    const side = String(row[7] || '').trim();
    const openLine = row[22] !== '' && row[22] != null ? row[22] : row[6];
    const openOdds = row[23] !== '' && row[23] != null ? row[23] : row[8];
    const gamePkLog = row[13];
    if (!player) continue;
    if (!String(game || '').trim() && !parseInt(gamePkLog, 10)) continue;

    let cl = null;
    let missNote = 'no FD match at close';
    if (market.indexOf('strikeout') !== -1) {
      cl = mlbLookupClosingPitcherK_(ss, game, player, side, gamePkLog);
      missNote = 'no FD K match at close';
    } else if (market.indexOf('walk') !== -1) {
      cl = mlbLookupClosingPitcherWalks_(ss, game, player, side, gamePkLog);
      missNote = 'no FD BB match at close';
    } else {
      continue;
    }

    if (!cl) {
      logSh.getRange(4 + i, 19, 1, 3).setValues([['', '', missNote]]);
      continue;
    }
    const note = mlbClvNoteFromOpenClose_(openLine, openOdds, cl.line, cl.american, side);
    logSh.getRange(4 + i, 19, 1, 3).setValues([[cl.line, cl.american, note]]);
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
    logSh.getRange(HEADER_ROW, 19, 1, 3).setValues([['close_line', 'close_odds', 'clv_note']]);
  }
  if (String(logSh.getRange(HEADER_ROW, 22).getValue() || '').trim() !== 'bet_key') {
    logSh.getRange(HEADER_ROW, 22, 1, 3).setValues([['bet_key', 'open_line', 'open_odds']]);
  }

  let appended = 0;
  let updated = 0;

  block.forEach(function (row) {
    const playText = String(row[4] || '');
    if (!playText || playText.indexOf('No qualifying') !== -1) return;
    const player = String(row[5] || '').trim();
    if (!player) return;

    const slate = row[0] || slateFallback;
    const line = row[8];
    const odds = row[9];
    const market = String(row[6] || '').trim();
    const betKey = mlbBetResultKey_(slate, row[2], row[16], row[7], line, market);
    const hitRow = mlbFindResultsLogSheetRowForUpsert_(
      logSh,
      slate,
      betKey,
      row[2],
      row[16],
      row[7],
      line,
      market
    );

    if (hitRow > 0) {
      const nc = Math.max(MLB_RESULTS_LOG_NCOL, logSh.getLastColumn());
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
      const clv = mlbClvNoteFromOpenClose_(openL, openO, line, odds, row[7]);
      logSh.getRange(hitRow, 1, 1, 12).setValues([
        [
          loggedAt,
          slate,
          row[1],
          player,
          String(row[3] || '').trim(),
          String(row[6] || '').trim(),
          line,
          String(row[7] || '').trim(),
          odds,
          row[11],
          row[12],
          window,
        ],
      ]);
      logSh.getRange(hitRow, 13).setValue(playText);
      logSh.getRange(hitRow, 14).setValue(row[2]);
      logSh.getRange(hitRow, 15).setValue(row[16]);
      logSh.getRange(hitRow, 19, 1, 3).setValues([[line, odds, clv]]);
      updated++;
      return;
    }

    const nextRow = Math.max(logSh.getLastRow(), HEADER_ROW) + 1;
    logSh
      .getRange(nextRow, 1, 1, MLB_RESULTS_LOG_NCOL)
      .setValues([
        [
          loggedAt,
          slate,
          row[1],
          player,
          String(row[3] || '').trim(),
          String(row[6] || '').trim(),
          line,
          String(row[7] || '').trim(),
          odds,
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
          betKey,
          line,
          odds,
        ],
      ]);
    appended++;
  });

  if (appended === 0 && updated === 0) return;
  try {
    ss.toast('Results log +' + appended + ' new · ' + updated + ' updated · ' + window, 'MLB-BOIZ', 6);
  } catch (e) {}
}
