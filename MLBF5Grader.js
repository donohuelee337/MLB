// ============================================================
// 📊 F5 Grader — grade PENDING rows in 📋 F5_Results_Log
// ============================================================

function gradeF5PendingResults_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logSh = ss.getSheetByName(MLB_F5_RESULTS_LOG_TAB);
  if (!logSh || logSh.getLastRow() < 4) return;
  if (typeof mlbEnsureF5CloseCols_ === 'function') mlbEnsureF5CloseCols_(logSh);

  const today = mlbTodayYmdNY_();
  const last = logSh.getLastRow();
  const data = logSh.getRange(4, 1, last - 3, MLB_F5_RESULTS_LOG_NCOL).getValues();

  let graded = 0;
  for (let i = 0; i < data.length; i++) {
    if (typeof mlbGraderBandExpired_ === 'function' && mlbGraderBandExpired_()) {
      Logger.log('gradeF5PendingResults_: grader band budget hit — resuming next window');
      break;
    }
    const row = data[i];
    const slateStr = mlbReadSlateYmd_(row[1]);
    if (!slateStr || slateStr >= today) continue;

    const resCell = String(row[14] || '').trim().toUpperCase();
    if (resCell && resCell !== 'PENDING') continue;

    const gamePk = parseInt(row[4], 10);
    const side = row[5];
    const line = row[6];
    const odds = row[7];
    const stake = row[16];
    if (!gamePk) {
      logSh.getRange(4 + i, 16).setValue('missing gamePk');
      continue;
    }

    const box = mlbFetchBoxscoreJson_(gamePk);
    if (!box) {
      logSh.getRange(4 + i, 16).setValue('feed/live fetch failed');
      continue;
    }
    if (!mlbBoxscoreIsFinal_(box)) {
      const ageMs = new Date(today + 'T00:00:00').getTime() - new Date(slateStr + 'T00:00:00').getTime();
      const daysOld = Math.floor(ageMs / 86400000);
      if (daysOld >= 2) {
        logSh.getRange(4 + i, 15).setValue('VOID');
        logSh.getRange(4 + i, 16).setValue('Game not played on slate');
        graded++;
      } else {
        logSh.getRange(4 + i, 16).setValue('NOT_FINAL — will retry later');
      }
      continue;
    }

    const runs5 =
      typeof mlbFirstFiveInningsTotalRunsFromBoxscore_ === 'function'
        ? mlbFirstFiveInningsTotalRunsFromBoxscore_(box)
        : null;
    if (runs5 === null) {
      logSh.getRange(4 + i, 16).setValue('linescore through inning 5 missing');
      continue;
    }

    const g = mlbGradePitcherKRow_(line, side, runs5);
    logSh.getRange(4 + i, 14).setValue(runs5);
    logSh.getRange(4 + i, 15).setValue(g.result);
    logSh.getRange(4 + i, 16).setValue('F5 runs=' + runs5 + ' · ' + g.note);

    const pnl = mlbPnlFromResult_(g.result, stake, odds);
    if (stake !== '' && stake != null && !isNaN(parseFloat(stake))) {
      logSh.getRange(4 + i, 18).setValue(pnl);
    }
    graded++;
  }

  if (graded > 0) {
    try {
      ss.toast('Graded ' + graded + ' F5 row(s)', 'MLB-BOIZ', 6);
    } catch (e) {}
  }
}
