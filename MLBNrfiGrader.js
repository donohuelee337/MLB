// ============================================================
// 📊 NRFI Grader — grade PENDING rows in 📋 NRFI_Results_Log
// ============================================================
// Uses feed/live linescore inning-1 combined runs. NRFI = Under 0.5,
// YRFI = Over 0.5.
// ============================================================

function mlbNrfiSideToOu_(side) {
  const s = String(side || '').trim().toUpperCase();
  if (s === 'NRFI') return 'Under';
  if (s === 'YRFI') return 'Over';
  return '';
}

function gradeNrfiPendingResults_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logSh = ss.getSheetByName(MLB_NRFI_RESULTS_LOG_TAB);
  if (!logSh || logSh.getLastRow() < 4) return;

  const today = mlbTodayYmdNY_();
  const last = logSh.getLastRow();
  const data = logSh.getRange(4, 1, last - 3, MLB_NRFI_RESULTS_LOG_NCOL).getValues();

  let graded = 0;
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const slateStr = mlbReadSlateYmd_(row[1]);
    if (!slateStr || slateStr >= today) continue;

    const resCell = String(row[17] || '').trim().toUpperCase();
    if (resCell && resCell !== 'PENDING') continue;

    const gamePk = parseInt(row[4], 10);
    const side = String(row[5] || '').trim();
    const line = row[6];
    const odds = row[7];
    const stake = row[19];
    if (!gamePk) {
      logSh.getRange(4 + i, 20).setValue('missing gamePk');
      continue;
    }

    const box = mlbFetchBoxscoreJson_(gamePk);
    if (!box) {
      logSh.getRange(4 + i, 20).setValue('feed/live fetch failed');
      continue;
    }
    if (!mlbBoxscoreIsFinal_(box)) {
      const ageMs = new Date(today + 'T00:00:00').getTime() - new Date(slateStr + 'T00:00:00').getTime();
      const daysOld = Math.floor(ageMs / 86400000);
      if (daysOld >= 2) {
        logSh.getRange(4 + i, 19).setValue('VOID');
        logSh.getRange(4 + i, 20).setValue('Game not played on slate');
        graded++;
      } else {
        logSh.getRange(4 + i, 20).setValue('NOT_FINAL — will retry later');
      }
      continue;
    }

    const runs1 =
      typeof mlbFirstInningTotalRunsFromBoxscore_ === 'function'
        ? mlbFirstInningTotalRunsFromBoxscore_(box)
        : null;
    if (runs1 === null) {
      logSh.getRange(4 + i, 20).setValue('linescore inning 1 missing');
      continue;
    }

    const ouSide = mlbNrfiSideToOu_(side);
    if (!ouSide) {
      logSh.getRange(4 + i, 19).setValue('VOID');
      logSh.getRange(4 + i, 20).setValue('Unknown side: ' + side);
      graded++;
      continue;
    }

    const g = mlbGradePitcherKRow_(line != null && line !== '' ? line : 0.5, ouSide, runs1);
    logSh.getRange(4 + i, 18).setValue(runs1);
    logSh.getRange(4 + i, 19).setValue(g.result);
    logSh.getRange(4 + i, 20).setValue('1st-inning runs=' + runs1 + ' · ' + g.note);

    const pnl = mlbPnlFromResult_(g.result, stake, odds);
    if (stake !== '' && stake != null && !isNaN(parseFloat(stake))) {
      logSh.getRange(4 + i, 22).setValue(pnl);
    }
    graded++;
  }

  if (graded > 0) {
    try {
      ss.toast('Graded ' + graded + ' NRFI row(s)', 'MLB-BOIZ', 6);
    } catch (e) {}
  }
}
