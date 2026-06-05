// ============================================================
// 📋 HR Promo Results Log — snapshots picks from 📣 Batter_HR_Promo
// ============================================================
// Mirrors the bet-card results-log pattern but for the yes/no HR promo:
//   - one row per pick per window (MORNING / MIDDAY / FINAL)
//   - logs base_lambda + each multiplier so we can later replay through
//     any feature-subset (ablation backtest)
//   - graded by checking boxscore HR count per batterId
// No odds tracked — promo is yes/no.
// ============================================================

const MLB_HR_PROMO_RESULTS_LOG_TAB = '📋 HR_Promo_Results_Log';
const MLB_HR_PROMO_RESULTS_LOG_NCOL = 22;

const MLB_HR_PROMO_RESULTS_HEADERS = [
  'Logged At',
  'Slate',
  'Rank',
  'Batter',
  'Team',
  'gamePk',
  'Matchup',
  'batterId',
  'Lineup Slot',
  'Opponent SP',
  'base_lambda',     // hrPerPaEff × expected_PA (no park / SP / weather)
  'lambda_raw',      // full model λ
  'p_poisson',
  'p_calibrated',
  'park_mult',
  'pitcher_mult',
  'weather_mult',
  'confidence',
  'actual_HR',       // boxscore HR count; '' when PENDING
  'result',          // HIT / MISS / VOID / PENDING
  'grade_notes',
  'Window',
];

function mlbEnsureHrPromoResultsLogLayout_(sh) {
  sh.getRange(1, 1, 1, MLB_HR_PROMO_RESULTS_LOG_NCOL)
    .merge()
    .setValue('📋 HR Promo Results — top-N picks per slate · graded HR≥1 per batterId')
    .setFontWeight('bold')
    .setBackground('#e65100')
    .setFontColor('#ffffff');
  sh.getRange(3, 1, 1, MLB_HR_PROMO_RESULTS_LOG_NCOL)
    .setValues([MLB_HR_PROMO_RESULTS_HEADERS])
    .setFontWeight('bold')
    .setBackground('#f57c00')
    .setFontColor('#ffffff');
  sh.setFrozenRows(3);
}

/**
 * Unique key for upserts: (slate, batterId, gamePk).
 */
function mlbHrPromoResultKey_(slate, batterId, gamePk) {
  return [
    String(slate || '').trim(),
    String(batterId != null ? batterId : '').trim(),
    String(gamePk != null ? gamePk : '').trim(),
  ].join('|');
}

function _mlbHrPromoFindLogRow_(logSh, slate, batterId, gamePk) {
  if (logSh.getLastRow() < 4) return -1;
  const data = logSh.getRange(4, 1, logSh.getLastRow() - 3, MLB_HR_PROMO_RESULTS_LOG_NCOL).getValues();
  const wantSlate = String(slate || '').trim();
  const wantBat = parseInt(batterId, 10);
  const wantPk = parseInt(gamePk, 10);
  for (let i = data.length - 1; i >= 0; i--) {
    if (String(data[i][1] || '').trim() !== wantSlate) continue;
    if (parseInt(data[i][7], 10) !== wantBat) continue;
    if (parseInt(data[i][5], 10) !== wantPk) continue;
    return 4 + i;
  }
  return -1;
}

/**
 * Append picks from 📣 Batter_HR_Promo to the results log.
 * Snapshots the top N picks (default 10; configurable via HR_PROMO_SNAPSHOT_TOP_N).
 * Idempotent within a slate — re-runs upsert existing rows by (slate, batterId, gamePk).
 *
 * @param {string} windowTag MORNING | MIDDAY | FINAL
 */
function snapshotHrPromoToLog(windowTag) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const pr = ss.getSheetByName(MLB_BATTER_HR_PROMO_TAB);
  if (!pr || pr.getLastRow() < 4) {
    Logger.log('snapshotHrPromoToLog: no promo sheet rows');
    return;
  }

  const cfg = getConfig();
  const slate = getSlateDateString_(cfg);
  const topN = parseInt(String(cfg['HR_PROMO_SNAPSHOT_TOP_N'] != null ? cfg['HR_PROMO_SNAPSHOT_TOP_N'] : '10').trim(), 10) || 10;
  const tz = Session.getScriptTimeZone();
  const now = new Date();
  const loggedAt = Utilities.formatDate(now, tz, 'yyyy-MM-dd HH:mm');
  const window = windowTag || 'UNKNOWN';

  // Promo sheet column layout (1-indexed; see MLBHrPromoRefresh.js):
  //  1:rank 2:gamePk 3:matchup 4:batter 5:batterId 6:team 7:λ_raw
  //  8:p_poisson 9:p_calibrated 10:calibration_status 11:confidence
  //  12:reason 13:lineup_slot 14:opponent_sp_id 15:park_mult_hr
  //  16:pitcher_mult 17:weather_mult 18:szn_HR 19:szn_PA 20:L14_HR
  const last = pr.getLastRow();
  const rows = pr.getRange(4, 1, last - 3, 20).getValues();

  let logSh = ss.getSheetByName(MLB_HR_PROMO_RESULTS_LOG_TAB);
  if (!logSh) {
    logSh = ss.insertSheet(MLB_HR_PROMO_RESULTS_LOG_TAB);
    logSh.setTabColor('#e65100');
  }
  if (logSh.getLastRow() < 3 || !String(logSh.getRange(3, 1).getValue() || '').trim()) {
    mlbEnsureHrPromoResultsLogLayout_(logSh);
  }

  let appended = 0;
  let updated = 0;

  for (let i = 0; i < rows.length && i < topN; i++) {
    const r = rows[i];
    const rank = parseInt(r[0], 10) || (i + 1);
    const gamePk = r[1];
    const matchup = String(r[2] || '').trim();
    const batter = String(r[3] || '').trim();
    const batterId = r[4];
    const team = String(r[5] || '').trim();
    const lamRaw = parseFloat(String(r[6]));
    const pPois = parseFloat(String(r[7]));
    const pCal = parseFloat(String(r[8]));
    const confidence = String(r[10] || '').trim();
    const slot = r[12];
    const oppSp = r[13];
    const parkMult = parseFloat(String(r[14]));
    const pitcherMult = parseFloat(String(r[15]));
    const weatherMult = parseFloat(String(r[16])) || 1;
    if (!batter || !batterId) continue;

    // Derive base λ (no multipliers) so ablation can replay any subset.
    const denom = (isNaN(parkMult) ? 1 : parkMult) * (isNaN(pitcherMult) ? 1 : pitcherMult) * (isNaN(weatherMult) ? 1 : weatherMult);
    const baseLambda = denom > 0 && !isNaN(lamRaw) ? lamRaw / denom : '';

    const hit = _mlbHrPromoFindLogRow_(logSh, slate, batterId, gamePk);
    if (hit > 0) {
      // Refresh predictive fields + window tag; keep prior result/actual_HR.
      logSh.getRange(hit, 1, 1, 18).setValues([[
        loggedAt, slate, rank, batter, team, gamePk, matchup, batterId, slot, oppSp,
        baseLambda, lamRaw, pPois, pCal, parkMult, pitcherMult, weatherMult, confidence,
      ]]);
      logSh.getRange(hit, 22).setValue(window);
      updated++;
      continue;
    }

    const nextRow = Math.max(logSh.getLastRow(), 3) + 1;
    logSh.getRange(nextRow, 1, 1, MLB_HR_PROMO_RESULTS_LOG_NCOL).setValues([[
      loggedAt, slate, rank, batter, team, gamePk, matchup, batterId, slot, oppSp,
      baseLambda, lamRaw, pPois, pCal, parkMult, pitcherMult, weatherMult, confidence,
      '', 'PENDING', '', window,
    ]]);
    appended++;
  }

  if (appended + updated > 0) {
    try { ss.toast('HR promo log: +' + appended + ' new · ' + updated + ' updated · ' + window, 'MLB-BOIZ', 6); } catch (e) {}
  }
}

function mlbActivateHrPromoResultsLogTab_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(MLB_HR_PROMO_RESULTS_LOG_TAB);
  if (sh) sh.activate();
}
