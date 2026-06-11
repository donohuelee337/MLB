// ============================================================
// 📊 MLB Results Grader v2 — grades 🧪 MLB_Results_Log_v2 (hits shadow)
// ============================================================
// Parallels gradeMLBPendingResults_() but reads from the v2 log. Hits-only.
// v1 grader is untouched. Idempotent: skips rows whose result is set
// and not PENDING. Boxscore source = same statsapi endpoint v1 uses.
// ============================================================

function gradeMLBHitsV2PendingResults_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logSh = ss.getSheetByName(MLB_RESULTS_LOG_V2_TAB);
  if (!logSh || logSh.getLastRow() < 4) return;

  const today = mlbTodayYmdNY_();
  const last = logSh.getLastRow();
  const data = logSh.getRange(4, 1, last, MLB_RESULTS_LOG_V2_NCOL).getValues();

  let graded = 0;

  for (let i = 0; i < data.length; i++) {
    if (typeof mlbGraderBandExpired_ === 'function' && mlbGraderBandExpired_()) {
      Logger.log('grader band budget hit at row ' + (4 + i) + ' — resuming next window');
      break;
    }
    const row = data[i];
    const slateStr = mlbReadSlateYmd_(row[1]);
    const resCell = String(row[16] || '').trim();
    if (!slateStr || slateStr >= today) continue;
    if (resCell && resCell !== 'PENDING') continue;

    let gamePk = parseInt(row[13], 10);
    let pid = parseInt(row[14], 10);
    const matchup = String(row[4] || '').trim();
    const player = String(row[3] || '').trim();
    const line = row[6];
    const side = row[7];

    if ((!gamePk || isNaN(gamePk)) && slateStr && matchup) {
      gamePk = mlbResolveGamePkFromSchedule_(slateStr, matchup, player);
    }
    if ((!pid || isNaN(pid)) && player) {
      pid = mlbStatsApiResolvePlayerIdFromName_(player);
    }

    if (!gamePk || isNaN(gamePk) || !pid || isNaN(pid)) {
      logSh.getRange(4 + i, 18).setValue('Missing gamePk or player_id — re-run snapshot / check name→id');
      continue;
    }

    let box = mlbFetchBoxscoreJson_(gamePk);
    if (!box) {
      logSh.getRange(4 + i, 18).setValue('Feed/live fetch failed');
      continue;
    }
    if (!mlbBoxscoreIsFinal_(box) && slateStr && matchup) {
      const altPk = mlbResolveGamePkFromSchedule_(slateStr, matchup, player);
      if (altPk && altPk !== gamePk) {
        const box2 = mlbFetchBoxscoreJson_(altPk);
        if (box2 && mlbBoxscoreIsFinal_(box2)) {
          gamePk = altPk;
          box = box2;
        }
      }
    }
    if (!mlbBoxscoreIsFinal_(box)) {
      const ageMs = new Date(today + 'T00:00:00').getTime() - new Date(slateStr + 'T00:00:00').getTime();
      const daysOld = Math.floor(ageMs / 86400000);
      if (daysOld >= 2) {
        logSh.getRange(4 + i, 17).setValue('VOID');
        logSh.getRange(4 + i, 18).setValue('Game not played on this slate (postponed/relocated)');
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
    logSh.getRange(4 + i, 14).setValue(gamePk);
    logSh.getRange(4 + i, 15).setValue(pid);
    logSh.getRange(4 + i, 16).setValue(hActual);
    logSh.getRange(4 + i, 17).setValue(g.result);
    logSh.getRange(4 + i, 18).setValue('statsapi boxscore H (v2) · ' + g.note);
    graded++;
  }

  if (graded > 0) {
    try {
      ss.toast('Graded ' + graded + ' v2 hits row(s)', 'MLB-BOIZ', 6);
    } catch (e) {}
  }
}

// ============================================================
// 📊 TB v2 shadow grader — grades 🧪 MLB_Results_Log_TB_v2
// ============================================================
// Parallels gradeMLBHitsV2PendingResults_ but for total bases. Uses the
// existing mlbBatterTbFromBoxscore_ helper from MLBResultsGrader.js so
// box-score parsing stays in one place. Idempotent.
// ============================================================

function gradeMLBTBV2PendingResults_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (typeof MLB_RESULTS_LOG_TB_V2_TAB === 'undefined') return;
  const logSh = ss.getSheetByName(MLB_RESULTS_LOG_TB_V2_TAB);
  if (!logSh || logSh.getLastRow() < 4) return;

  const today = mlbTodayYmdNY_();
  const last = logSh.getLastRow();
  const data = logSh.getRange(4, 1, last, MLB_RESULTS_LOG_TB_V2_NCOL).getValues();

  let graded = 0;

  for (let i = 0; i < data.length; i++) {
    if (typeof mlbGraderBandExpired_ === 'function' && mlbGraderBandExpired_()) {
      Logger.log('grader band budget hit at row ' + (4 + i) + ' — resuming next window');
      break;
    }
    const row = data[i];
    const slateStr = mlbReadSlateYmd_(row[1]);
    const resCell = String(row[16] || '').trim();
    if (!slateStr || slateStr >= today) continue;
    if (resCell && resCell !== 'PENDING') continue;

    let gamePk = parseInt(row[13], 10);
    let pid = parseInt(row[14], 10);
    const matchup = String(row[4] || '').trim();
    const player = String(row[3] || '').trim();
    const line = row[6];
    const side = row[7];

    if ((!gamePk || isNaN(gamePk)) && slateStr && matchup) {
      gamePk = mlbResolveGamePkFromSchedule_(slateStr, matchup, player);
    }
    if ((!pid || isNaN(pid)) && player) {
      pid = mlbStatsApiResolvePlayerIdFromName_(player);
    }

    if (!gamePk || isNaN(gamePk) || !pid || isNaN(pid)) {
      logSh.getRange(4 + i, 18).setValue('Missing gamePk or player_id — re-run snapshot / check name→id');
      continue;
    }

    let box = mlbFetchBoxscoreJson_(gamePk);
    if (!box) {
      logSh.getRange(4 + i, 18).setValue('Feed/live fetch failed');
      continue;
    }
    if (!mlbBoxscoreIsFinal_(box) && slateStr && matchup) {
      const altPk = mlbResolveGamePkFromSchedule_(slateStr, matchup, player);
      if (altPk && altPk !== gamePk) {
        const box2 = mlbFetchBoxscoreJson_(altPk);
        if (box2 && mlbBoxscoreIsFinal_(box2)) {
          gamePk = altPk;
          box = box2;
        }
      }
    }
    if (!mlbBoxscoreIsFinal_(box)) {
      const ageMs = new Date(today + 'T00:00:00').getTime() - new Date(slateStr + 'T00:00:00').getTime();
      const daysOld = Math.floor(ageMs / 86400000);
      if (daysOld >= 2) {
        logSh.getRange(4 + i, 17).setValue('VOID');
        logSh.getRange(4 + i, 18).setValue('Game not played on this slate (postponed/relocated)');
        graded++;
      } else {
        logSh.getRange(4 + i, 18).setValue('NOT_FINAL — will retry later');
      }
      continue;
    }

    const tbActual = mlbBatterTbFromBoxscore_(box, pid);
    if (tbActual === null) {
      logSh.getRange(4 + i, 16).setValue('');
      logSh.getRange(4 + i, 17).setValue('VOID');
      logSh.getRange(4 + i, 18).setValue('No batting line (DNP?)');
      graded++;
      continue;
    }

    const g = mlbGradePitcherKRow_(line, side, tbActual);
    logSh.getRange(4 + i, 14).setValue(gamePk);
    logSh.getRange(4 + i, 15).setValue(pid);
    logSh.getRange(4 + i, 16).setValue(tbActual);
    logSh.getRange(4 + i, 17).setValue(g.result);
    logSh.getRange(4 + i, 18).setValue('statsapi boxscore TB (v2) · ' + g.note);
    graded++;
  }

  if (graded > 0) {
    try {
      ss.toast('Graded ' + graded + ' v2 TB row(s)', 'MLB-BOIZ', 6);
    } catch (e) {}
  }
}

// ============================================================
// 📊 TB v3 shadow grader — grades 🧪 MLB_Results_Log_TB_v3
// ============================================================
// Same column layout as v2 for indices 0..23, so the boxscore-parsing
// and pid/gamePk fallback logic stays identical. Only the log tab and
// the column count change.
// ============================================================

function gradeMLBTBV3PendingResults_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (typeof MLB_RESULTS_LOG_TB_V3_TAB === 'undefined') return;
  const logSh = ss.getSheetByName(MLB_RESULTS_LOG_TB_V3_TAB);
  if (!logSh || logSh.getLastRow() < 4) return;

  const today = mlbTodayYmdNY_();
  const last = logSh.getLastRow();
  const data = logSh.getRange(4, 1, last, MLB_RESULTS_LOG_TB_V3_NCOL).getValues();

  let graded = 0;

  for (let i = 0; i < data.length; i++) {
    if (typeof mlbGraderBandExpired_ === 'function' && mlbGraderBandExpired_()) {
      Logger.log('grader band budget hit at row ' + (4 + i) + ' — resuming next window');
      break;
    }
    const row = data[i];
    const slateStr = mlbReadSlateYmd_(row[1]);
    const resCell = String(row[16] || '').trim();
    if (!slateStr || slateStr >= today) continue;
    if (resCell && resCell !== 'PENDING') continue;

    let gamePk = parseInt(row[13], 10);
    let pid = parseInt(row[14], 10);
    const matchup = String(row[4] || '').trim();
    const player = String(row[3] || '').trim();
    const line = row[6];
    const side = row[7];

    if ((!gamePk || isNaN(gamePk)) && slateStr && matchup) {
      gamePk = mlbResolveGamePkFromSchedule_(slateStr, matchup, player);
    }
    if ((!pid || isNaN(pid)) && player) {
      pid = mlbStatsApiResolvePlayerIdFromName_(player);
    }

    if (!gamePk || isNaN(gamePk) || !pid || isNaN(pid)) {
      logSh.getRange(4 + i, 18).setValue('Missing gamePk or player_id — re-run snapshot / check name→id');
      continue;
    }

    let box = mlbFetchBoxscoreJson_(gamePk);
    if (!box) {
      logSh.getRange(4 + i, 18).setValue('Feed/live fetch failed');
      continue;
    }
    if (!mlbBoxscoreIsFinal_(box) && slateStr && matchup) {
      const altPk = mlbResolveGamePkFromSchedule_(slateStr, matchup, player);
      if (altPk && altPk !== gamePk) {
        const box2 = mlbFetchBoxscoreJson_(altPk);
        if (box2 && mlbBoxscoreIsFinal_(box2)) {
          gamePk = altPk;
          box = box2;
        }
      }
    }
    if (!mlbBoxscoreIsFinal_(box)) {
      const ageMs = new Date(today + 'T00:00:00').getTime() - new Date(slateStr + 'T00:00:00').getTime();
      const daysOld = Math.floor(ageMs / 86400000);
      if (daysOld >= 2) {
        logSh.getRange(4 + i, 17).setValue('VOID');
        logSh.getRange(4 + i, 18).setValue('Game not played on this slate (postponed/relocated)');
        graded++;
      } else {
        logSh.getRange(4 + i, 18).setValue('NOT_FINAL — will retry later');
      }
      continue;
    }

    const tbActual = mlbBatterTbFromBoxscore_(box, pid);
    if (tbActual === null) {
      logSh.getRange(4 + i, 16).setValue('');
      logSh.getRange(4 + i, 17).setValue('VOID');
      logSh.getRange(4 + i, 18).setValue('No batting line (DNP?)');
      graded++;
      continue;
    }

    const g = mlbGradePitcherKRow_(line, side, tbActual);
    logSh.getRange(4 + i, 14).setValue(gamePk);
    logSh.getRange(4 + i, 15).setValue(pid);
    logSh.getRange(4 + i, 16).setValue(tbActual);
    logSh.getRange(4 + i, 17).setValue(g.result);
    logSh.getRange(4 + i, 18).setValue('statsapi boxscore TB (v3) · ' + g.note);
    graded++;
  }

  if (graded > 0) {
    try {
      ss.toast('Graded ' + graded + ' v3 TB row(s)', 'MLB-BOIZ', 6);
    } catch (e) {}
  }
}

// ============================================================
// 📊 Hits v3 shadow grader — grades 🧪 MLB_Results_Log_Hits_v3
// ============================================================
// Same column layout as v2 logs for indices 0..23. Reuses
// mlbBatterHitsFromBoxscore_ from MLBResultsGrader.js.
// ============================================================

function gradeMLBHitsV3PendingResults_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (typeof MLB_RESULTS_LOG_HITS_V3_TAB === 'undefined') return;
  const logSh = ss.getSheetByName(MLB_RESULTS_LOG_HITS_V3_TAB);
  if (!logSh || logSh.getLastRow() < 4) return;

  const today = mlbTodayYmdNY_();
  const last = logSh.getLastRow();
  const data = logSh.getRange(4, 1, last, MLB_RESULTS_LOG_HITS_V3_NCOL).getValues();

  let graded = 0;

  for (let i = 0; i < data.length; i++) {
    if (typeof mlbGraderBandExpired_ === 'function' && mlbGraderBandExpired_()) {
      Logger.log('grader band budget hit at row ' + (4 + i) + ' — resuming next window');
      break;
    }
    const row = data[i];
    const slateStr = mlbReadSlateYmd_(row[1]);
    const resCell = String(row[16] || '').trim();
    if (!slateStr || slateStr >= today) continue;
    if (resCell && resCell !== 'PENDING') continue;

    let gamePk = parseInt(row[13], 10);
    let pid = parseInt(row[14], 10);
    const matchup = String(row[4] || '').trim();
    const player = String(row[3] || '').trim();
    const line = row[6];
    const side = row[7];

    if ((!gamePk || isNaN(gamePk)) && slateStr && matchup) {
      gamePk = mlbResolveGamePkFromSchedule_(slateStr, matchup, player);
    }
    if ((!pid || isNaN(pid)) && player) {
      pid = mlbStatsApiResolvePlayerIdFromName_(player);
    }

    if (!gamePk || isNaN(gamePk) || !pid || isNaN(pid)) {
      logSh.getRange(4 + i, 18).setValue('Missing gamePk or player_id — re-run snapshot / check name→id');
      continue;
    }

    let box = mlbFetchBoxscoreJson_(gamePk);
    if (!box) {
      logSh.getRange(4 + i, 18).setValue('Feed/live fetch failed');
      continue;
    }
    if (!mlbBoxscoreIsFinal_(box) && slateStr && matchup) {
      const altPk = mlbResolveGamePkFromSchedule_(slateStr, matchup, player);
      if (altPk && altPk !== gamePk) {
        const box2 = mlbFetchBoxscoreJson_(altPk);
        if (box2 && mlbBoxscoreIsFinal_(box2)) {
          gamePk = altPk;
          box = box2;
        }
      }
    }
    if (!mlbBoxscoreIsFinal_(box)) {
      const ageMs = new Date(today + 'T00:00:00').getTime() - new Date(slateStr + 'T00:00:00').getTime();
      const daysOld = Math.floor(ageMs / 86400000);
      if (daysOld >= 2) {
        logSh.getRange(4 + i, 17).setValue('VOID');
        logSh.getRange(4 + i, 18).setValue('Game not played on this slate (postponed/relocated)');
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
    logSh.getRange(4 + i, 14).setValue(gamePk);
    logSh.getRange(4 + i, 15).setValue(pid);
    logSh.getRange(4 + i, 16).setValue(hActual);
    logSh.getRange(4 + i, 17).setValue(g.result);
    logSh.getRange(4 + i, 18).setValue('statsapi boxscore H (v3) · ' + g.note);
    graded++;
  }

  if (graded > 0) {
    try {
      ss.toast('Graded ' + graded + ' v3 hits row(s)', 'MLB-BOIZ', 6);
    } catch (e) {}
  }
}
