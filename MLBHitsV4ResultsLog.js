// ============================================================
// 🧪 MLB Results Log Hits v4 — UNANCHORED shadow hits log
// ============================================================
// h.v4-unanchored: same h.v2-full projection, but P(over/under) is
// computed from the UNANCHORED model λ (⚡ Sim_Batter_Hits audit col 35)
// instead of the line-anchored λ the live sim uses. The live anchor pulls
// every batter 65% toward the line — sane for K (the line is the market's
// estimate) but degenerate for hits, where every line is a constant 0.5
// that carries no opinion about the batter (it collapsed P(1+H) toward a
// coin flip; same bug the Hit Machine exposed). This shadow tests whether
// removing the anchor produces better-calibrated, more profitable hits
// picks than live v2-full. Promote ONLY after a holdout-validated graded
// edge (MLB_MODEL_VERSIONS policy) — never on enthusiasm.
//
// Graded by gradeMLBHitsV4PendingResults_ below (clone of the v3 hits
// grader). Sourced from the SIM tab, not a card — no new card to build.
// ============================================================

const MLB_RESULTS_LOG_HITS_V4_TAB = '🧪 MLB_Results_Log_Hits_v4';
const MLB_RESULTS_LOG_HITS_V4_NCOL = 27;

const MLB_RESULTS_HITS_V4_HEADERS = [
  'Logged At', 'Slate', 'Rank', 'Player', 'Game', 'Market', 'Line', 'Side', 'Odds',
  'Model P(Win)', 'EV ($1)', 'Window', 'Play', 'gamePk', 'batter_id',
  'actual_H', 'result', 'grade_notes',
  'close_line', 'close_odds', 'clv_note', 'bet_key', 'open_line', 'open_odds',
  'model_version', 'lambda_unanchored', 'est_pa',
];

function mlbEnsureResultsLogHitsV4Layout_(logSh) {
  logSh.getRange(1, 1, 1, MLB_RESULTS_LOG_HITS_V4_NCOL)
    .merge()
    .setValue('🧪 MLB-BOIZ HITS v4 SHADOW — h.v4-unanchored (model λ, no line anchor) vs live h.v2-full')
    .setFontWeight('bold').setBackground('#4a148c').setFontColor('#ffffff');
  logSh.getRange(3, 1, 1, MLB_RESULTS_LOG_HITS_V4_NCOL)
    .setValues([MLB_RESULTS_HITS_V4_HEADERS])
    .setFontWeight('bold').setBackground('#6a1b9a').setFontColor('#ffffff');
  logSh.setFrozenRows(3);
}

/** Unanchored P(over)/P(under) at a hits line from model λ + est PA. */
function mlbHitsV4Probs_(lamModel, estPa, line, hShrink) {
  if (!(lamModel > 0) || !(estPa > 0)) return null;
  let ba = lamModel / estPa;
  ba = Math.max(0.02, Math.min(0.499, ba));
  const kO = Math.floor(line) + 1;
  const kU = Math.floor(line + 1e-9);
  const pORaw = mlbBinomialPGeqK_(kO, estPa, ba);
  const pURaw = mlbBinomialPLeqK_(kU, estPa, ba);
  const isHalf = Math.abs(line - Math.floor(line) - 0.5) < 1e-6;
  const pO = (hShrink > 0 && hShrink < 1) ? Math.min(pORaw * hShrink, 0.9999) : pORaw;
  // Half lines: Under = exact complement (one-sided shrink, no push).
  // Whole lines: shrink Under independently (complement would absorb push).
  const pU = isHalf
    ? Math.max(0, Math.min(0.9999, 1 - pO))
    : ((hShrink > 0 && hShrink < 1) ? Math.min(pURaw * hShrink, 0.9999) : pURaw);
  return { pOver: pO, pUnder: pU };
}

/**
 * Snapshot the unanchored shadow from ⚡ Sim_Batter_Hits. Same gates as the
 * other shadow logs: pick Over/Under, ev>0, no injury, valid line + price.
 */
function snapshotMLBHitsV4ToLog(windowTag) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig();
  if (String(cfg['HITS_V4_SHADOW_ENABLED'] != null ? cfg['HITS_V4_SHADOW_ENABLED'] : 'Y').toUpperCase() !== 'Y') return;
  const src = ss.getSheetByName(MLB_BATTER_HITS_SIM_TAB);
  if (!src || src.getLastRow() < 4) {
    Logger.log('snapshotMLBHitsV4ToLog: no sim rows');
    return;
  }
  const hShrinkRaw = parseFloat(String(cfg['H_MODEL_P_SHRINK'] != null ? cfg['H_MODEL_P_SHRINK'] : '0.82'));
  const hShrink = (!isNaN(hShrinkRaw) && hShrinkRaw > 0 && hShrinkRaw <= 1) ? hShrinkRaw : 0.82;
  const minEvCfg = parseFloat(String(cfg['MIN_EV_BET_CARD'] != null ? cfg['MIN_EV_BET_CARD'] : '0').trim());
  const minEvFloor = !isNaN(minEvCfg) && minEvCfg > 0 ? minEvCfg : 0;
  const slate = getSlateDateString_(cfg);
  const window = windowTag || 'UNKNOWN';
  const tz = Session.getScriptTimeZone();
  const loggedAt = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm');

  let logSh = ss.getSheetByName(MLB_RESULTS_LOG_HITS_V4_TAB);
  if (!logSh) {
    logSh = ss.insertSheet(MLB_RESULTS_LOG_HITS_V4_TAB);
    logSh.setTabColor('#6a1b9a');
  }
  if (logSh.getLastRow() < 3 || !String(logSh.getRange(3, 14).getValue() || '').trim()) {
    mlbEnsureResultsLogHitsV4Layout_(logSh);
  }

  const last = src.getLastRow();
  const rows = src.getRange(4, 1, last - 3, Math.min(40, src.getLastColumn())).getValues();
  let appended = 0;
  let updated = 0;
  let rank = 0;

  rows.forEach(function (r) {
    const batter = String(r[2] || '').trim();
    if (!batter) return;
    if (String(r[16] || '').indexOf('injury') !== -1) return;
    const line = parseFloat(String(r[3]));
    const fdOver = r[4];
    const fdUnder = r[5];
    const lamModel = parseFloat(String(r.length > 34 ? r[34] : ''));
    const estPa = parseFloat(String(r[25]));
    const gamePk = r[0];
    const batterId = r[17];
    if (isNaN(line) || fdOver === '' || fdUnder === '') return;

    const pu = mlbHitsV4Probs_(lamModel, estPa, line, hShrink);
    if (!pu) return;
    const evO = mlbEvPerDollarRisked_(pu.pOver, fdOver);
    const evU = mlbEvPerDollarRisked_(pu.pUnder, fdUnder);
    let side = '';
    let pWin = '';
    let odds = '';
    let ev = '';
    // Outcome-first: back the higher-probability side; EV must clear the floor.
    if (pu.pOver >= pu.pUnder) { side = 'Over'; pWin = pu.pOver; odds = fdOver; ev = evO; }
    else { side = 'Under'; pWin = pu.pUnder; odds = fdUnder; ev = evU; }
    const evNum = parseFloat(String(ev));
    if (isNaN(evNum) || evNum <= 0) return;
    if (minEvFloor > 0 && evNum < minEvFloor) return;

    rank += 1;
    const pWinR = Math.round(pWin * 1000) / 1000;
    const lamR = Math.round(lamModel * 100) / 100;
    const playText = batter + ' — H ' + side + ' ' + line + ' [shadow:h.v4-unanchored]';
    const betKey = mlbBetResultKey_(slate, gamePk, batterId, side, line) + '|h.v4';
    const hitRow = _mlbHitsV4FindRow_(logSh, slate, betKey, gamePk, batterId, side, line);

    if (hitRow > 0) {
      const prev = logSh.getRange(hitRow, 1, 1, MLB_RESULTS_LOG_HITS_V4_NCOL).getValues()[0];
      if (prev[22] === '' || prev[22] == null) {
        logSh.getRange(hitRow, 23, 1, 2).setValues([[line, odds]]); // open_line, open_odds
      }
      logSh.getRange(hitRow, 1, 1, 12).setValues([[
        loggedAt, slate, rank, batter, String(r[1] || ''),
        'Batter hits (shadow v4)', line, side, odds, pWinR, evNum, window,
      ]]);
      logSh.getRange(hitRow, 13, 1, 3).setValues([[playText, gamePk, batterId]]);
      logSh.getRange(hitRow, 25, 1, 3).setValues([['h.v4-unanchored', lamR, estPa]]);
      updated++;
      return;
    }
    logSh.getRange(Math.max(logSh.getLastRow(), 3) + 1, 1, 1, MLB_RESULTS_LOG_HITS_V4_NCOL).setValues([[
      loggedAt, slate, rank, batter, String(r[1] || ''),
      'Batter hits (shadow v4)', line, side, odds, pWinR, evNum, window,
      playText, gamePk, batterId, '', 'PENDING', '',
      '', '', '', betKey, line, odds, 'h.v4-unanchored', lamR, estPa,
    ]]);
    appended++;
  });

  if (appended + updated > 0) {
    try { ss.toast('Hits v4 shadow +' + appended + ' new · ' + updated + ' updated · ' + window, 'MLB-BOIZ', 6); } catch (e) {}
  }
}

function _mlbHitsV4FindRow_(logSh, slate, betKey, gamePk, batterId, side, line) {
  const last = logSh.getLastRow();
  if (last < 4) return -1;
  const data = logSh.getRange(4, 1, last - 3, MLB_RESULTS_LOG_HITS_V4_NCOL).getValues();
  const wantG = parseInt(gamePk, 10);
  const wantP = parseInt(batterId, 10);
  const sideN = String(side || '').trim().toLowerCase().replace(/\s+/g, '');
  const lineS = String(line != null ? line : '').trim();
  for (let i = data.length - 1; i >= 0; i--) {
    const rowSlate = typeof mlbDateCellToYmd_ === 'function' ? mlbDateCellToYmd_(data[i][1]) : String(data[i][1] || '').trim();
    if (rowSlate !== slate) continue;
    if (String(data[i][21] || '').trim() === betKey) return 4 + i;
    if (parseInt(data[i][13], 10) === wantG && parseInt(data[i][14], 10) === wantP &&
        String(data[i][7] || '').trim().toLowerCase().replace(/\s+/g, '') === sideN &&
        String(data[i][6] != null ? data[i][6] : '').trim() === lineS) {
      return 4 + i;
    }
  }
  return -1;
}

/** Grade pending h.v4 shadow rows — batter hits at the line. Clone of v3. */
function gradeMLBHitsV4PendingResults_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logSh = ss.getSheetByName(MLB_RESULTS_LOG_HITS_V4_TAB);
  if (!logSh || logSh.getLastRow() < 4) return;
  const today = mlbTodayYmdNY_();
  const data = logSh.getRange(4, 1, logSh.getLastRow() - 3, MLB_RESULTS_LOG_HITS_V4_NCOL).getValues();
  let graded = 0;

  for (let i = 0; i < data.length; i++) {
    if (typeof mlbGraderBandExpired_ === 'function' && mlbGraderBandExpired_()) {
      Logger.log('gradeMLBHitsV4PendingResults_: grader band budget hit — resuming next window');
      break;
    }
    const row = data[i];
    const slateStr = mlbReadSlateYmd_(row[1]);
    if (!slateStr || slateStr >= today) continue;
    if (String(row[16] || '').trim() && String(row[16] || '').trim() !== 'PENDING') continue;

    let gamePk = parseInt(row[13], 10);
    let pid = parseInt(row[14], 10);
    const matchup = String(row[4] || '').trim();
    const player = String(row[3] || '').trim();
    const line = row[6];
    const side = row[7];
    if ((!gamePk || isNaN(gamePk)) && slateStr && matchup) gamePk = mlbResolveGamePkFromSchedule_(slateStr, matchup, player);
    if ((!pid || isNaN(pid)) && player) pid = mlbStatsApiResolvePlayerIdFromName_(player);
    if (!gamePk || isNaN(gamePk) || !pid || isNaN(pid)) {
      logSh.getRange(4 + i, 18).setValue('Missing gamePk or player_id');
      continue;
    }
    let box = mlbFetchBoxscoreJson_(gamePk);
    if (!box) { logSh.getRange(4 + i, 18).setValue('Feed/live fetch failed'); continue; }
    if (!mlbBoxscoreIsFinal_(box) && slateStr && matchup) {
      const altPk = mlbResolveGamePkFromSchedule_(slateStr, matchup, player);
      if (altPk && altPk !== gamePk) {
        const box2 = mlbFetchBoxscoreJson_(altPk);
        if (box2 && mlbBoxscoreIsFinal_(box2)) { gamePk = altPk; box = box2; }
      }
    }
    if (!mlbBoxscoreIsFinal_(box)) {
      const daysOld = Math.floor((new Date(today + 'T00:00:00') - new Date(slateStr + 'T00:00:00')) / 86400000);
      if (daysOld >= 2) {
        logSh.getRange(4 + i, 17).setValue('VOID');
        logSh.getRange(4 + i, 18).setValue('Game not played on slate (postponed)');
        graded++;
      } else {
        logSh.getRange(4 + i, 18).setValue('NOT_FINAL — will retry later');
      }
      continue;
    }
    const hActual = mlbBatterHitsFromBoxscore_(box, pid);
    if (hActual === null) {
      logSh.getRange(4 + i, 16).setValue('');
      logSh.getRange(4 + i, 17).setValue('VOID');
      logSh.getRange(4 + i, 18).setValue('No batting line (DNP?)');
      graded++;
      continue;
    }
    const g = mlbGradePitcherKRow_(line, side, hActual);
    logSh.getRange(4 + i, 14, 1, 5).setValues([[gamePk, pid, hActual, g.result, 'statsapi boxscore H (v4) · ' + g.note]]);
    graded++;
  }
  if (graded > 0) {
    try { ss.toast('Graded ' + graded + ' Hits v4 shadow row(s)', 'MLB-BOIZ', 6); } catch (e) {}
  }
}

function mlbActivateHitsV4LogTab_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(MLB_RESULTS_LOG_HITS_V4_TAB);
  if (sh) sh.activate();
  else ss.toast('Run the pipeline once to create ' + MLB_RESULTS_LOG_HITS_V4_TAB, 'MLB-BOIZ', 5);
}
