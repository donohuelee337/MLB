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
  if (typeof mlbEnsureNrfiCloseCols_ === 'function') mlbEnsureNrfiCloseCols_(logSh);

  const today = mlbTodayYmdNY_();
  const last = logSh.getLastRow();
  const data = logSh.getRange(4, 1, last - 3, MLB_NRFI_RESULTS_LOG_NCOL).getValues();

  let graded = 0;
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const slateStr = mlbReadSlateYmd_(row[1]);
    if (!slateStr || slateStr >= today) continue;

    // Header contract (1-based cols): 17 actual_1st_runs · 18 result ·
    // 19 grade_notes · 20 stake $ · 21 pnl $ · 22 bet_key. A pre-build-25
    // version of this grader wrote everything one column right (adapted from
    // the F5 grader without re-basing for the extra lineup_top3 column),
    // landing runs in result, WIN/LOSS in notes, notes over stake, and pnl
    // over bet_key. Writes below use the contract columns; the numeric-result
    // check regrades rows the old bug corrupted.
    const resCell = String(row[17] || '').trim().toUpperCase();
    const resIsCorrupt = resCell !== '' && resCell !== 'PENDING' && !isNaN(parseFloat(resCell));
    if (resCell && resCell !== 'PENDING' && !resIsCorrupt) continue;

    const gamePk = parseInt(row[4], 10);
    const side = String(row[5] || '').trim();
    const line = row[6];
    const odds = row[7];
    let stake = row[19];
    // Self-heal: the old bug overwrote stake $ with grade-note text. Clear the
    // junk so pnl math can't run against a string; flag it in grade_notes.
    let stakeLostNote = '';
    if (stake !== '' && stake != null && isNaN(parseFloat(stake))) {
      logSh.getRange(4 + i, 20).setValue('');
      stake = '';
      stakeLostNote = ' · stake lost to col-shift bug (no pnl)';
    }
    if (!gamePk) {
      logSh.getRange(4 + i, 19).setValue('missing gamePk');
      continue;
    }
    // Self-heal: the old bug overwrote bet_key (col 22) with a pnl number.
    if (resIsCorrupt) {
      const bk = String(row[21] != null ? row[21] : '').trim();
      if (bk === '' || !isNaN(parseFloat(bk))) {
        logSh.getRange(4 + i, 22).setValue(mlbNrfiResultKey_(slateStr, gamePk, side));
      }
    }

    const box = mlbFetchBoxscoreJson_(gamePk);
    if (!box) {
      logSh.getRange(4 + i, 19).setValue('feed/live fetch failed');
      continue;
    }
    if (!mlbBoxscoreIsFinal_(box)) {
      const ageMs = new Date(today + 'T00:00:00').getTime() - new Date(slateStr + 'T00:00:00').getTime();
      const daysOld = Math.floor(ageMs / 86400000);
      if (daysOld >= 2) {
        logSh.getRange(4 + i, 18).setValue('VOID');
        logSh.getRange(4 + i, 19).setValue('Game not played on slate' + stakeLostNote);
        graded++;
      } else {
        logSh.getRange(4 + i, 19).setValue('NOT_FINAL — will retry later');
      }
      continue;
    }

    const runs1 =
      typeof mlbFirstInningTotalRunsFromBoxscore_ === 'function'
        ? mlbFirstInningTotalRunsFromBoxscore_(box)
        : null;
    if (runs1 === null) {
      logSh.getRange(4 + i, 19).setValue('linescore inning 1 missing');
      continue;
    }

    const ouSide = mlbNrfiSideToOu_(side);
    if (!ouSide) {
      logSh.getRange(4 + i, 18).setValue('VOID');
      logSh.getRange(4 + i, 19).setValue('Unknown side: ' + side + stakeLostNote);
      graded++;
      continue;
    }

    const g = mlbGradePitcherKRow_(line != null && line !== '' ? line : 0.5, ouSide, runs1);
    logSh.getRange(4 + i, 17).setValue(runs1);
    logSh.getRange(4 + i, 18).setValue(g.result);
    logSh.getRange(4 + i, 19).setValue('1st-inning runs=' + runs1 + ' · ' + g.note + stakeLostNote);

    const pnl = mlbPnlFromResult_(g.result, stake, odds);
    if (stake !== '' && stake != null && !isNaN(parseFloat(stake))) {
      logSh.getRange(4 + i, 21).setValue(pnl);
    }
    graded++;
  }

  if (graded > 0) {
    try {
      ss.toast('Graded ' + graded + ' NRFI row(s)', 'MLB-BOIZ', 6);
    } catch (e) {}
  }
}
