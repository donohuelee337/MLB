// ============================================================
// 🧪 MLB Results Log Hits v3 — shadow Hits log (contact-stack model)
// ============================================================
// Parallel to 🧪 MLB_Results_Log_v2 (which now tracks h.v1 shadow). This
// log tracks h.v3-contact alongside the live h.v2-full. Same 24 base
// cols + v2's six (model_version + base λ + 4 mults) + v3's three
// (k_rate, opp_sp_k9, streak_overlap).
// Graded by gradeMLBHitsV3PendingResults_ in MLBResultsGraderV2.js.
// ============================================================

const MLB_RESULTS_LOG_HITS_V3_TAB = '🧪 MLB_Results_Log_Hits_v3';
const MLB_RESULTS_LOG_HITS_V3_NCOL = 33;

const MLB_RESULTS_HITS_V3_HEADERS = [
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
  'actual_H',
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
  'opp_sp_h9_mult',
  'hand_mult',
  'ab_mult',
  'k_rate_mult',
  'opp_sp_k9_mult',
  'streak_overlap_mult',
];

function mlbEnsureResultsLogHitsV3Layout_(logSh) {
  const HEADER_ROW = 3;
  logSh.getRange(1, 1, 1, MLB_RESULTS_LOG_HITS_V3_NCOL)
    .merge()
    .setValue('🧪 MLB-BOIZ HITS v3 SHADOW LOG — tracks h.v3-contact alongside live h.v2-full')
    .setFontWeight('bold')
    .setBackground('#0d47a1')
    .setFontColor('#ffffff');
  logSh
    .getRange(HEADER_ROW, 1, 1, MLB_RESULTS_LOG_HITS_V3_NCOL)
    .setValues([MLB_RESULTS_HITS_V3_HEADERS])
    .setFontWeight('bold')
    .setBackground('#1565c0')
    .setFontColor('#ffffff');
  logSh.setFrozenRows(HEADER_ROW);
}

function mlbFindResultsLogHitsV3RowForUpsert_(logSh, slateWant, betKey, gamePk, batterId, side, line) {
  const last = logSh.getLastRow();
  if (last < 4) return -1;
  const nc = Math.max(MLB_RESULTS_LOG_HITS_V3_NCOL, logSh.getLastColumn());
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
 * Append the Hits v3 shadow card to 🧪 MLB_Results_Log_Hits_v3.
 * Filters: pick Over/Under (not agree_fd), pick_ev > 0, no 'injury' flag. Mirrors v2.
 * @param {string} windowTag MORNING | MIDDAY | FINAL
 */
function snapshotMLBHitsV3BetCardToLog(windowTag) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const card = ss.getSheetByName(MLB_BATTER_HITS_V3_CARD_TAB);
  if (!card || card.getLastRow() < 4) {
    Logger.log('snapshotMLBHitsV3BetCardToLog: no Hits v3 card data');
    return;
  }

  const cfg = getConfig();
  const minEvCfg = parseFloat(String(cfg['MIN_EV_BET_CARD'] != null ? cfg['MIN_EV_BET_CARD'] : '0').trim(), 10);
  const minEvFloor = !isNaN(minEvCfg) && minEvCfg > 0 ? minEvCfg : 0;
  const slateFallback = getSlateDateString_(cfg);
  const window = windowTag || 'UNKNOWN';
  const tz = Session.getScriptTimeZone();
  const loggedAt = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm');

  let logSh = ss.getSheetByName(MLB_RESULTS_LOG_HITS_V3_TAB);
  if (!logSh) {
    logSh = ss.insertSheet(MLB_RESULTS_LOG_HITS_V3_TAB);
    logSh.setTabColor('#0d47a1');
  }
  if (logSh.getLastRow() < 3 || !String(logSh.getRange(3, 14).getValue() || '').trim()) {
    mlbEnsureResultsLogHitsV3Layout_(logSh);
  }

  const last = card.getLastRow();
  const ncolCard = Math.max(36, card.getLastColumn());
  const block = card.getRange(4, 1, last, ncolCard).getValues();
  let appended = 0;
  let updated = 0;
  let rank = 0;

  block.forEach(function (row) {
    const gamePk = row[0];
    const matchup = row[1];
    const batter = String(row[2] || '').trim();
    const line = row[4];
    const fdOver = row[5];
    const fdUnder = row[6];
    const pOver = row[9];
    const pUnder = row[10];
    const pick = String(row[15] || '').trim();
    const pickEv = row[16];
    const flags = String(row[17] || '');
    const batterId = row[18];
    // v2 audit 19..23, v3 mults 24..26, audit 27..31, sp 32..33, model_version 34.
    const baseLam  = row[19];
    const parkMult = row[20];
    const h9Mult   = row[21];
    const handMult = row[22];
    const abMult   = row[23];
    const kRateMult     = row[24];
    const oppK9Mult     = row[25];
    const streakOverlap = row[26];
    const modelVer = String(row[34] || 'h.v3-contact').trim() || 'h.v3-contact';

    if (!batter) return;
    if (flags.indexOf('injury') !== -1) return;
    if (pick !== 'Over' && pick !== 'Under') return;
    if (line === '' || line == null) return;
    const odds = pick === 'Over' ? fdOver : fdUnder;
    if (odds === '' || odds == null) return;
    const pWin = pick === 'Over' ? pOver : pUnder;
    const ev = parseFloat(String(pickEv));
    if (isNaN(ev) || ev <= 0) return;
    if (minEvFloor > 0 && ev < minEvFloor) return;

    rank += 1;
    const playText =
      batter + ' — H ' + pick + ' ' + String(line) + ' [shadow:' + modelVer + ']';

    const slate = slateFallback;
    const betKey = mlbBetResultKey_(slate, gamePk, batterId, pick, line) + '|' + modelVer;
    const hitRow = mlbFindResultsLogHitsV3RowForUpsert_(logSh, slate, betKey, gamePk, batterId, pick, line);

    if (hitRow > 0) {
      const nc = Math.max(MLB_RESULTS_LOG_HITS_V3_NCOL, logSh.getLastColumn());
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
          'Batter hits (shadow v3)',
          line, pick, odds, pWin, ev, window,
        ],
      ]);
      logSh.getRange(hitRow, 13).setValue(playText);
      logSh.getRange(hitRow, 14).setValue(gamePk);
      logSh.getRange(hitRow, 15).setValue(batterId);
      logSh.getRange(hitRow, 25, 1, 9).setValues([[
        modelVer, baseLam, parkMult, h9Mult, handMult, abMult,
        kRateMult, oppK9Mult, streakOverlap,
      ]]);
      updated++;
      return;
    }

    const nextRow = Math.max(logSh.getLastRow(), 3) + 1;
    logSh
      .getRange(nextRow, 1, 1, MLB_RESULTS_LOG_HITS_V3_NCOL)
      .setValues([
        [
          loggedAt, slate, rank, batter, matchup,
          'Batter hits (shadow v3)',
          line, pick, odds, pWin, ev, window,
          playText, gamePk, batterId,
          '', 'PENDING', '',
          '', '', '',
          betKey, line, odds,
          modelVer, baseLam, parkMult, h9Mult, handMult, abMult,
          kRateMult, oppK9Mult, streakOverlap,
        ],
      ]);
    appended++;
  });

  if (appended === 0 && updated === 0) return;
  try {
    ss.toast(
      'Hits v3 Shadow +' + appended + ' new · ' + updated + ' updated · ' + window,
      'MLB-BOIZ',
      6
    );
  } catch (e) {}
}

function mlbSnapshotHitsV3Midday_() {
  snapshotMLBHitsV3BetCardToLog('MIDDAY');
}

function mlbActivateHitsV3LogTab_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(MLB_RESULTS_LOG_HITS_V3_TAB);
  if (sh) sh.activate();
  else ss.toast('Run the pipeline once to create ' + MLB_RESULTS_LOG_HITS_V3_TAB, 'MLB-BOIZ', 5);
}
