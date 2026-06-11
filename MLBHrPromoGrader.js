// ============================================================
// 📊 HR Promo Grader — grade PENDING rows in 📋 HR_Promo_Results_Log
// ============================================================
// Yes/no scoring against statsapi boxscore. HIT when the batterId
// recorded ≥1 HR; MISS when batting line exists and HR == 0; VOID
// when DNP / no batting line in the boxscore.
// ============================================================

function _mlbHrCountFromBoxscore_(payload, batterId) {
  // Route through mlbBoxscoreTeams_ — mlbFetchBoxscoreJson_ returns the v1.1
  // /feed/live shape ({gameData, liveData}), not the old v1 /boxscore shape
  // (top-level .teams). Reading payload.teams directly returned null for every
  // game since the /feed/live migration, silently VOIDing the whole HR log.
  const teams = typeof mlbBoxscoreTeams_ === 'function' ? mlbBoxscoreTeams_(payload) : (payload && payload.teams);
  if (!teams) return null;
  const sides = ['home', 'away'];
  const bid = parseInt(batterId, 10);
  for (let s = 0; s < sides.length; s++) {
    const tm = teams[sides[s]];
    if (!tm || !tm.players) continue;
    const pl = tm.players['ID' + bid];
    if (!pl) continue;
    const batting = pl.stats && pl.stats.batting ? pl.stats.batting : null;
    if (!batting) return null;       // listed but DNP
    // feed/live emits a zeroed batting line for defensive subs / pinch
    // runners — 0 plate appearances is a DNP (void), not a MISS.
    const pa = parseInt(batting.plateAppearances, 10);
    if (!isNaN(pa) && pa === 0) return null;
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
    if (typeof mlbGraderBandExpired_ === 'function' && mlbGraderBandExpired_()) {
      Logger.log('gradeHrPromoPendingResults_: grader band budget hit — resuming next window');
      break;
    }
    const row = data[i];
    const slateRaw = row[1];
    const slate = (slateRaw instanceof Date)
      ? Utilities.formatDate(slateRaw, tz, 'yyyy-MM-dd')
      : String(slateRaw || '').trim();
    if (!slate || slate >= today) continue;

    const resCell = String(row[19] || '').trim().toUpperCase();
    // Self-heal: the payload-shape bug VOIDed every row as "DNP / not in
    // boxscore" — regrade those with the fixed parser (real DNPs re-VOID).
    const wasBugVoid =
      resCell === 'VOID' && String(row[20] || '').indexOf('DNP / not in boxscore') !== -1;
    if (resCell && resCell !== 'PENDING' && !wasBugVoid) continue;

    const gamePk = parseInt(row[5], 10);
    const batterId = parseInt(row[7], 10);
    if (!gamePk || !batterId) {
      logSh.getRange(4 + i, 21).setValue('missing gamePk or batterId');
      continue;
    }

    const box = mlbFetchBoxscoreJson_(gamePk);
    if (!box) {
      logSh.getRange(4 + i, 21).setValue('boxscore fetch failed');
      continue;
    }
    if (!mlbBoxscoreIsFinal_(box)) {
      // Postponed/suspended fallback (same policy as the K/NRFI graders):
      // a game still not final 2+ days after its slate did not happen → VOID.
      const ageMs = new Date(today + 'T00:00:00').getTime() - new Date(slate + 'T00:00:00').getTime();
      const daysOld = Math.floor(ageMs / 86400000);
      if (daysOld >= 2) {
        logSh.getRange(4 + i, 19).setValue('');
        logSh.getRange(4 + i, 20).setValue('VOID');
        logSh.getRange(4 + i, 21).setValue('Game not played on slate (postponed)');
        graded++;
      } else {
        logSh.getRange(4 + i, 21).setValue('NOT_FINAL — will retry later');
      }
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
