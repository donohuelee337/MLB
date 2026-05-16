// ============================================================
// 📋 MLB Results Log — snapshot from 🃏 MLB_Bet_Card
// ============================================================
// Mirrors AI-BOIZ Results.js: append rows after each window so you
// can grade later. Columns include gamePk + pitcher_id for statsapi
// boxscore grading (see MLBResultsGrader.js).
// ============================================================

const MLB_RESULTS_LOG_TAB = '📋 MLB_Results_Log';
const MLB_RESULTS_LOG_NCOL = 26;

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
  'bet_key',
  'open_line',
  'open_odds',
  'stake $',
  'pnl $',
];

/** Profit (in $) for a graded row at this American price. Stake is in $. */
function mlbPnlFromResult_(result, stake, american) {
  const r = String(result || '').trim().toUpperCase();
  const s = parseFloat(String(stake));
  if (!isFinite(s) || s <= 0) return 0;
  if (r === 'WIN') {
    const b = mlbAmericanToB_(american);
    if (!isFinite(b) || b <= 0) return 0;
    return Math.round(s * b * 100) / 100;
  }
  if (r === 'LOSS') return -s;
  return 0; // PUSH / VOID / PENDING
}

function mlbBetResultKey_(slate, gamePk, pitcherId, side, line) {
  return [
    String(slate || '').trim(),
    String(gamePk != null ? gamePk : '').trim(),
    String(pitcherId != null ? pitcherId : '').trim(),
    String(side || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ''),
    String(line != null ? line : '').trim(),
  ].join('|');
}

/** Sheet row index (1-based) or -1; prefers latest matching row. */
function mlbFindResultsLogSheetRowForUpsert_(logSh, slateWant, betKey, gamePk, pitcherId, side, line) {
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
    if (
      g === wantG &&
      !isNaN(g) &&
      p === wantP &&
      !isNaN(p) &&
      sd === sideN &&
      String(data[i][6] != null ? data[i][6] : '').trim() === lineS
    ) {
      return 4 + i;
    }
  }
  return -1;
}

/** American odds → break-even implied prob for that price (0..1); ignores vig. */
function mlbAmericanToImpliedProb_(american) {
  const a = parseInt(String(american != null ? american : '').replace(/[^0-9+-]/g, ''), 10);
  if (isNaN(a) || a === 0) return NaN;
  if (a > 0) return 100 / (a + 100);
  const b = Math.abs(a);
  return b / (b + 100);
}

/** One-line CLV summary: line move vs open + price at close (FanDuel tab) + implied Δ. */
function mlbClvNoteFromOpenClose_(openLine, openOdds, closeLine, closeOdds, side) {
  const oL = parseFloat(String(openLine), 10);
  const cL = parseFloat(String(closeLine), 10);
  const sl = String(side || '').toLowerCase();
  let hint = '';
  if (isNaN(oL) || isNaN(cL)) {
    hint = 'close lookup ok; line compare n/a';
  } else {
    const d = Math.round((cL - oL) * 100) / 100;
    if (sl.indexOf('over') !== -1) {
      hint = d > 0 ? 'line rose vs open (harder Over)' : d < 0 ? 'line fell vs open (easier Over)' : 'line flat';
    } else if (sl.indexOf('under') !== -1) {
      hint = d > 0 ? 'line rose vs open (easier Under)' : d < 0 ? 'line fell vs open (harder Under)' : 'line flat';
    } else {
      hint = 'Δline ' + (d >= 0 ? '+' : '') + d;
    }
  }
  const pO = mlbAmericanToImpliedProb_(openOdds);
  const pC = mlbAmericanToImpliedProb_(closeOdds);
  let priceBit = '';
  if (!isNaN(pO) && !isNaN(pC)) {
    const dpp = Math.round((pC - pO) * 1000) / 10;
    priceBit = ' · implied Δ' + (dpp >= 0 ? '+' : '') + dpp + 'pp (this side @ FD)';
  }
  return (
    hint +
    ' · open ' +
    String(openLine) +
    '@' +
    String(openOdds) +
    ' → close ' +
    String(closeLine) +
    '@' +
    String(closeOdds) +
    priceBit
  );
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
    const openLine = row[22] !== '' && row[22] != null ? row[22] : row[6];
    const openOdds = row[23] !== '' && row[23] != null ? row[23] : row[8];
    const gamePkLog = row[13];
    if (!player) continue;
    if (!String(game || '').trim() && !parseInt(gamePkLog, 10)) continue;

    const cl = mlbLookupClosingPitcherK_(ss, game, player, side, gamePkLog);
    if (!cl) {
      logSh.getRange(4 + i, 19, 1, 3).setValues([['', '', 'no FD K match at close']]);
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
  // Bet card column layout (0-indexed) — keep in sync with MLBBetCard.js headers:
  //  0:date 1:# 2:grade 3:gamePk 4:matchup 5:play 6:player 7:market
  //  8:side 9:line 10:odds 11:model% 12:book% 13:ev 14:stake$
  //  15:proj 16:proj−line 17:flags 18:player_id 19:time
  // Note: col 14 was historically labeled "kelly $" but now writes the
  // tier-snapped stake ($2.50/$5/$7.50). Old comments in other files may
  // still say "kelly$" — same column, same value.
  const block = bc.getRange(4, 1, last, MLB_BET_CARD_NCOL).getValues();
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
  if (String(logSh.getRange(HEADER_ROW, 25).getValue() || '').trim() !== 'stake $') {
    logSh.getRange(HEADER_ROW, 25, 1, 2)
      .setValues([['stake $', 'pnl $']])
      .setFontWeight('bold')
      .setBackground('#1565C0')
      .setFontColor('#ffffff');
    logSh.getRange(4, 25, Math.max(logSh.getLastRow() - 3, 1), 1).setNumberFormat('$0.00');
    logSh.getRange(4, 26, Math.max(logSh.getLastRow() - 3, 1), 1).setNumberFormat('+$0.00;-$0.00');
  }

  let appended = 0;
  let updated = 0;

  block.forEach(function (row) {
    const playText = String(row[5] || '');
    if (!playText || playText.indexOf('No qualifying') !== -1) return;
    const player = String(row[6] || '').trim();
    if (!player) return;

    const slate = row[0] || slateFallback;
    const gamePk = row[3];
    const matchup = String(row[4] || '').trim();
    const market = String(row[7] || '').trim();
    const side = String(row[8] || '').trim();
    const line = row[9];
    const odds = row[10];
    const modelProb = row[11];
    const ev = row[13];
    const stake = row[14];
    const playerId = row[18];
    const betKey = mlbBetResultKey_(slate, gamePk, playerId, side, line);
    const hitRow = mlbFindResultsLogSheetRowForUpsert_(logSh, slate, betKey, gamePk, playerId, side, line);

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
      const clv = mlbClvNoteFromOpenClose_(openL, openO, line, odds, side);
      logSh.getRange(hitRow, 1, 1, 12).setValues([
        [
          loggedAt,
          slate,
          row[1],
          player,
          matchup,
          market,
          line,
          side,
          odds,
          modelProb,
          ev,
          window,
        ],
      ]);
      logSh.getRange(hitRow, 13).setValue(playText);
      logSh.getRange(hitRow, 14).setValue(gamePk);
      logSh.getRange(hitRow, 15).setValue(playerId);
      logSh.getRange(hitRow, 19, 1, 3).setValues([[line, odds, clv]]);
      // Only fill stake if currently blank — don't overwrite a manually-edited stake.
      const prevStake = prev[24];
      if ((prevStake === '' || prevStake == null) && stake !== '' && stake != null) {
        logSh.getRange(hitRow, 25).setValue(stake);
      }
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
          matchup,
          market,
          line,
          side,
          odds,
          modelProb,
          ev,
          window,
          playText,
          gamePk,
          playerId,
          '',
          'PENDING',
          '',
          '',
          '',
          '',
          betKey,
          line,
          odds,
          stake !== '' && stake != null ? stake : '',
          '',
        ],
      ]);
    appended++;
  });

  if (appended === 0 && updated === 0) return;
  try {
    ss.toast('Results log +' + appended + ' new · ' + updated + ' updated · ' + window, 'MLB-BOIZ', 6);
  } catch (e) {}
}

/**
 * One-shot: fill blank `stake $` cells in the results log with LEGACY_UNIT_USD
 * (default $2.50) for every historical row, and (re)compute `pnl $` for any
 * row that already has a graded result. Does NOT overwrite a stake you've
 * manually edited. Safe to re-run.
 *
 * Why this exists: the 1x/2x/3x tier system was introduced after some slates
 * had already been graded; historical rows have no recorded stake, so ROI
 * can't be measured. User chose "Backfill at fixed unit" in onboarding —
 * this assumes a flat $2.50 (one unit) per pre-tier bet.
 *
 * @returns {{ stakeFilled: number, pnlFilled: number }}
 */
function mlbBackfillHistoricalStakes_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logSh = ss.getSheetByName(MLB_RESULTS_LOG_TAB);
  if (!logSh || logSh.getLastRow() < 4) return { stakeFilled: 0, pnlFilled: 0 };

  // Make sure the new columns exist + are formatted.
  const HEADER_ROW = 3;
  if (String(logSh.getRange(HEADER_ROW, 25).getValue() || '').trim() !== 'stake $') {
    logSh.getRange(HEADER_ROW, 25, 1, 2)
      .setValues([['stake $', 'pnl $']])
      .setFontWeight('bold')
      .setBackground('#1565C0')
      .setFontColor('#ffffff');
  }
  const dataRows = logSh.getLastRow() - 3;
  logSh.getRange(4, 25, dataRows, 1).setNumberFormat('$0.00');
  logSh.getRange(4, 26, dataRows, 1).setNumberFormat('+$0.00;-$0.00');

  const cfg = getConfig();
  const legacyUnit = parseFloat(String(cfg['LEGACY_UNIT_USD'] != null ? cfg['LEGACY_UNIT_USD'] : '2.50').trim(), 10) || 2.50;

  const last = logSh.getLastRow();
  const ncol = Math.max(MLB_RESULTS_LOG_NCOL, logSh.getLastColumn());
  const data = logSh.getRange(4, 1, last - 3, ncol).getValues();

  const stakeUpdates = [];
  const pnlUpdates = [];

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const result = String(row[16] || '').trim().toUpperCase();
    const odds = row[8];
    let stake = row[24];

    // Fill stake if blank
    if (stake === '' || stake == null) {
      stake = legacyUnit;
      stakeUpdates.push({ r: 4 + i, v: legacyUnit });
    }

    // Compute pnl if we have a final result and stake
    if (result === 'WIN' || result === 'LOSS' || result === 'PUSH' || result === 'VOID') {
      const pnl = mlbPnlFromResult_(result, stake, odds);
      const prevPnl = row[25];
      if (prevPnl === '' || prevPnl == null || parseFloat(prevPnl) !== pnl) {
        pnlUpdates.push({ r: 4 + i, v: pnl });
      }
    }
  }

  stakeUpdates.forEach(function (u) { logSh.getRange(u.r, 25).setValue(u.v); });
  pnlUpdates.forEach(function (u) { logSh.getRange(u.r, 26).setValue(u.v); });

  try {
    ss.toast(
      'Backfilled stake: ' + stakeUpdates.length + ' · pnl: ' + pnlUpdates.length + ' (unit $' + legacyUnit.toFixed(2) + ')',
      'MLB-BOIZ',
      7
    );
  } catch (e) {}
  return { stakeFilled: stakeUpdates.length, pnlFilled: pnlUpdates.length };
}
