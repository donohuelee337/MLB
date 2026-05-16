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
  'player_id',
  'actual',
  'result',
  'grade_notes',
  'close_line',
  'close_odds',
  'clv_note',
  'bet_key',
  'open_line',
  'open_odds',
];

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
 * Map a log market label (lowercase) to the FanDuel Odds API market key(s).
 * Returns { main: string, alt: string } — alt is '' when no alternate market exists.
 * @param {string} marketLower  row[5].toLowerCase()
 * @returns {{ main: string, alt: string }|null}
 */
function mlbMarketLabelToFdKey_(marketLower) {
  const m = marketLower;
  if (m.indexOf('strikeout') !== -1)    return { main: 'pitcher_strikeouts',   alt: '' };
  if (m.indexOf('pitcher outs') !== -1) return { main: 'pitcher_outs',          alt: '' };
  if (m.indexOf('pitcher walks') !== -1 || m.indexOf('walk') !== -1)
                                         return { main: 'pitcher_walks',         alt: 'pitcher_walks_alternate' };
  if (m.indexOf('hits allowed') !== -1) return { main: 'pitcher_hits_allowed',  alt: 'pitcher_hits_allowed_alternate' };
  if (m.indexOf('total base') !== -1)   return { main: 'batter_total_bases',    alt: '' };
  if (m.indexOf('batter hits') !== -1)  return { main: 'batter_hits',           alt: '' };
  if (m.indexOf('home run') !== -1)     return { main: 'batter_home_runs',      alt: '' };
  return null;
}

/**
 * Look up the current FanDuel line + price for any supported market.
 * Tries log `Game` text first, then schedule matchup for gamePk (label drift).
 * @returns {{ line: *, american: * }|null}
 */
function mlbLookupClosingLine_(ss, gameStr, playerStr, betSide, gamePk, fdKeys) {
  const oddsIdx = fdKeys.alt
    ? mlbBuildPersonPropOddsIndexMerged_(ss, fdKeys.main, fdKeys.alt)
    : mlbBuildPersonPropOddsIndex_(ss, fdKeys.main);
  const pNorm = mlbNormalizePersonName_(playerStr);
  const labels = [];
  const a = String(gameStr || '').trim();
  if (a) labels.push(a);
  const fromSch = mlbScheduleMatchupForGamePk_(ss, gamePk);
  if (fromSch && labels.indexOf(fromSch) === -1) labels.push(fromSch);
  const sl = String(betSide || '').toLowerCase();
  for (let t = 0; t < labels.length; t++) {
    const gKeys = mlbCandidateGameKeys_(labels[t], '', '');
    const pointMap = mlbOddsPointMapForPerson_(oddsIdx, gKeys, pNorm);
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

/** Backward-compat wrapper kept for mlbBackfillClosingMenu_ (K-only menu item). */
function mlbLookupClosingPitcherK_(ss, gameStr, playerStr, betSide, gamePk) {
  return mlbLookupClosingLine_(ss, gameStr, playerStr, betSide, gamePk, { main: 'pitcher_strikeouts', alt: '' });
}

/**
 * After FINAL odds refresh: fill close_line / close_odds / clv_note for all 7 markets
 * on the current slate. Overwrites prior close columns when re-run.
 * @returns {number} rows updated
 */
function mlbBackfillResultsLogClosingK_(ss) {
  const logSh = ss.getSheetByName(MLB_RESULTS_LOG_TAB);
  if (!logSh || logSh.getLastRow() < 4) return 0;

  const cfg = getConfig();
  const slateWant = getSlateDateString_(cfg);
  const last = logSh.getLastRow();
  const data = logSh.getRange(4, 1, last, MLB_RESULTS_LOG_NCOL).getValues();

  // Build one odds index per market key that actually appears in the log (avoid duplicate fetches).
  const indexCache = {};
  function getOddsIdx_(fdKeys) {
    const cacheKey = fdKeys.main + '|' + fdKeys.alt;
    if (!indexCache[cacheKey]) {
      indexCache[cacheKey] = fdKeys.alt
        ? mlbBuildPersonPropOddsIndexMerged_(ss, fdKeys.main, fdKeys.alt)
        : mlbBuildPersonPropOddsIndex_(ss, fdKeys.main);
    }
    return indexCache[cacheKey];
  }

  let n = 0;
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const slateStr = String(row[1] || '').trim();
    if (slateStr !== slateWant) continue;
    const marketRaw = String(row[5] || '').toLowerCase();
    const fdKeys = mlbMarketLabelToFdKey_(marketRaw);
    if (!fdKeys) continue;
    const player = String(row[3] || '').trim();
    const game = String(row[4] || '').trim();
    const side = String(row[7] || '').trim();
    const openLine = row[22] !== '' && row[22] != null ? row[22] : row[6];
    const openOdds = row[23] !== '' && row[23] != null ? row[23] : row[8];
    const gamePkLog = row[13];
    if (!player) continue;
    if (!game && !parseInt(gamePkLog, 10)) continue;

    const oddsIdx = getOddsIdx_(fdKeys);
    const pNorm = mlbNormalizePersonName_(player);
    const labels = [];
    if (game) labels.push(game);
    const fromSch = mlbScheduleMatchupForGamePk_(ss, gamePkLog);
    if (fromSch && labels.indexOf(fromSch) === -1) labels.push(fromSch);
    const sl = side.toLowerCase();
    let cl = null;
    for (let t = 0; t < labels.length; t++) {
      const gKeys = mlbCandidateGameKeys_(labels[t], '', '');
      const pointMap = mlbOddsPointMapForPerson_(oddsIdx, gKeys, pNorm);
      if (!pointMap || !Object.keys(pointMap).length) continue;
      const mainPt = mlbPickMainKPoint_(pointMap);
      if (mainPt == null) continue;
      const px = mlbMainKPrices_(pointMap, mainPt);
      const american = sl.indexOf('over') !== -1 ? px.over : sl.indexOf('under') !== -1 ? px.under : '';
      if (american === '' || american == null) continue;
      cl = { line: mainPt, american: american };
      break;
    }
    if (!cl) {
      logSh.getRange(4 + i, 19, 1, 3).setValues([['', '', 'no FD match at close (' + fdKeys.main + ')']]);
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
  const block = bc.getRange(4, 1, last, 21).getValues();
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
    // Skip game-header rows (play col empty) and honorable-mention rows (rank col empty).
    const rank = row[1];
    if (rank === '' || rank == null) return;

    const slate = row[0] || slateFallback;
    const line = row[8];
    const odds = row[9];
    const betKey = mlbBetResultKey_(slate, row[2], row[16], row[7], line);
    const hitRow = mlbFindResultsLogSheetRowForUpsert_(logSh, slate, betKey, row[2], row[16], row[7], line);

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
