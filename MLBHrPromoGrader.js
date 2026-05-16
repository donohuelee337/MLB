// ============================================================
// 📊 HR Promo Grader — grade PENDING rows in 📋 HR_Promo_Results_Log
// ============================================================
// Yes/no scoring against statsapi boxscore. HIT when the batterId
// recorded ≥1 HR; MISS when batting line exists and HR == 0; VOID
// when DNP / no batting line in the boxscore.
// ============================================================

function _mlbHrCountFromBoxscore_(payload, batterId) {
  if (!payload || !payload.teams) return null;
  const sides = ['home', 'away'];
  const bid = parseInt(batterId, 10);
  for (let s = 0; s < sides.length; s++) {
    const tm = payload.teams[sides[s]];
    if (!tm || !tm.players) continue;
    const pl = tm.players['ID' + bid];
    if (!pl) continue;
    const batting = pl.stats && pl.stats.batting ? pl.stats.batting : null;
    if (!batting) return null;       // listed but DNP
    const hr = parseInt(batting.homeRuns, 10);
    return isNaN(hr) ? 0 : hr;
  }
  return null;                       // not in either side's roster
}

function gradeHrPromoPendingResults_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logSh = ss.getSheetByName(MLB_HR_PROMO_RESULTS_LOG_TAB);
  if (!logSh || logSh.getLastRow() < 4) return;

  const today = mlbTodayYmdNY_();
  const last = logSh.getLastRow();
  const data = logSh.getRange(4, 1, last - 3, MLB_HR_PROMO_RESULTS_LOG_NCOL).getValues();
  const tz = Session.getScriptTimeZone();

  let graded = 0;
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const slateRaw = row[1];
    const slate = (slateRaw instanceof Date)
      ? Utilities.formatDate(slateRaw, tz, 'yyyy-MM-dd')
      : String(slateRaw || '').trim();
    if (!slate || slate >= today) continue;

    const resCell = String(row[19] || '').trim().toUpperCase();
    if (resCell && resCell !== 'PENDING') continue;

    const gamePk = parseInt(row[5], 10);
    const batterId = parseInt(row[7], 10);
    if (!gamePk || !batterId) {
      logSh.getRange(4 + i, 21).setValue('missing gamePk or batterId');
      continue;
    }

    const box = mlbFetchBoxscoreJson_(gamePk);
    Utilities.sleep(120);
    if (!box) {
      logSh.getRange(4 + i, 21).setValue('boxscore fetch failed');
      continue;
    }
    if (!mlbBoxscoreIsFinal_(box)) {
      logSh.getRange(4 + i, 21).setValue('NOT_FINAL — will retry later');
      continue;
    }

    const hr = _mlbHrCountFromBoxscore_(box, batterId);
    if (hr === null) {
      logSh.getRange(4 + i, 19).setValue('');
      logSh.getRange(4 + i, 20).setValue('VOID');
      logSh.getRange(4 + i, 21).setValue('DNP / not in boxscore');
      graded++;
      continue;
    }
    logSh.getRange(4 + i, 19).setValue(hr);
    logSh.getRange(4 + i, 20).setValue(hr >= 1 ? 'HIT' : 'MISS');
    logSh.getRange(4 + i, 21).setValue('statsapi boxscore HR=' + hr);
    graded++;
  }

  if (graded > 0) {
    try { ss.toast('Graded ' + graded + ' HR promo row(s)', 'MLB-BOIZ', 6); } catch (e) {}
  }
}
