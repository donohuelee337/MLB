// ============================================================
// 🔬 MLB Hits v2 Results Log diagnostics
// ============================================================
// Two read-only menu tools to figure out why gradeMLBHitsV2PendingResults_
// is leaving 🧪 MLB_Results_Log_v2 cells blank (the "only dashes" symptom):
//
//   mlbDiagnoseHitsV2Log_   — one-shot summary popup over the whole log
//   mlbTestGradeOneHitsV2Row_ — walk ONE PENDING past-slate row through
//                              every grader step, reporting each result
//
// Both functions only READ the sheet and call statsapi — they never
// write to the v2 log, so they cannot make anything worse.
// ============================================================

/** Same slate-normalization the v2 grader uses (Date → 'yyyy-MM-dd'). */
function mlbDiagReadSlateYmd_(cell) {
  if (cell == null || cell === '') return '';
  if (Object.prototype.toString.call(cell) === '[object Date]') {
    return Utilities.formatDate(cell, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  const s = String(cell).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return s;
}

/** Compact human description of a cell's runtime type + value. */
function mlbDiagDescribeCell_(v) {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (v === '') return '"" (empty string)';
  const tag = Object.prototype.toString.call(v);
  if (tag === '[object Date]') {
    return 'Date(' + v.toISOString() + ')';
  }
  if (typeof v === 'number') return 'number(' + v + ')';
  if (typeof v === 'string') return 'string("' + v + '")';
  return tag + '(' + String(v) + ')';
}

/**
 * Read-only summary popup for 🧪 MLB_Results_Log_v2. Shows:
 *  - header sanity (column 17 should be "result", 18 "grade_notes")
 *  - what row[1] looks like for the first non-blank data row (Date vs str)
 *  - by-result and slate-bucket histograms
 *  - PENDING past-slate breakdown (missing gamePk vs missing batter_id vs gradeable)
 *  - top grade_notes samples (so you see the reason in bulk)
 */
function mlbDiagnoseHitsV2Log_() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const log = ss.getSheetByName(MLB_RESULTS_LOG_V2_TAB);
  if (!log || log.getLastRow() < 4) {
    ui.alert('Hits v2 diag', 'Tab "' + MLB_RESULTS_LOG_V2_TAB + '" missing or empty.', ui.ButtonSet.OK);
    return;
  }

  const last = log.getLastRow();
  const nCols = Math.max(MLB_RESULTS_LOG_V2_NCOL, log.getLastColumn());
  const data = log.getRange(4, 1, last - 3, nCols).getValues();
  const today = mlbTodayYmdNY_();

  const h17 = String(log.getRange(3, 17).getValue() || '').trim();
  const h18 = String(log.getRange(3, 18).getValue() || '').trim();
  const h2 = String(log.getRange(3, 2).getValue() || '').trim();

  let firstRowProbe = '(no rows)';
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][3] || '').trim()) {
      firstRowProbe =
        'row ' + (4 + i) +
        ' · raw row[1] = ' + mlbDiagDescribeCell_(data[i][1]) +
        ' · normalized = "' + mlbDiagReadSlateYmd_(data[i][1]) + '"' +
        ' · raw row[16] (result col) = ' + mlbDiagDescribeCell_(data[i][16]);
      break;
    }
  }

  let total = 0;
  const byResult = {};
  const slateBuckets = { today: 0, past: 0, future: 0, blank: 0 };
  const noteSamples = {};
  let pendingPastWithIds = 0;
  let pendingPastMissingGp = 0;
  let pendingPastMissingPid = 0;
  let pendingTotal = 0;

  for (let i = 0; i < data.length; i++) {
    const player = String(data[i][3] || '').trim();
    if (!player) continue;
    total++;
    const slate = mlbDiagReadSlateYmd_(data[i][1]);
    const result = String(data[i][16] || '').trim() || '(empty)';
    const note = String(data[i][17] || '').trim();
    const gp = parseInt(data[i][13], 10);
    const pid = parseInt(data[i][14], 10);

    byResult[result] = (byResult[result] || 0) + 1;
    if (!slate) slateBuckets.blank++;
    else if (slate === today) slateBuckets.today++;
    else if (slate < today) slateBuckets.past++;
    else slateBuckets.future++;

    if (note) {
      const tn = note.length > 70 ? note.substring(0, 70) + '…' : note;
      noteSamples[tn] = (noteSamples[tn] || 0) + 1;
    }

    if (result === 'PENDING' || result === '(empty)') {
      pendingTotal++;
      if (slate && slate < today) {
        const noGp = !gp || isNaN(gp);
        const noPid = !pid || isNaN(pid);
        if (noGp) pendingPastMissingGp++;
        if (noPid) pendingPastMissingPid++;
        if (!noGp && !noPid) pendingPastWithIds++;
      }
    }
  }

  let msg = 'V2 LOG: ' + MLB_RESULTS_LOG_V2_TAB + '\n';
  msg += 'TODAY (NY): ' + today + '\n';
  msg += 'TOTAL DATA ROWS: ' + total + '\n\n';

  msg += 'HEADER SANITY (row 3):\n';
  msg += '  col 2 = "' + h2 + '" (expect "Slate")\n';
  msg += '  col 17 = "' + h17 + '" (expect "result")\n';
  msg += '  col 18 = "' + h18 + '" (expect "grade_notes")\n\n';

  msg += 'FIRST DATA ROW PROBE:\n  ' + firstRowProbe + '\n\n';

  msg += 'BY RESULT:\n';
  Object.keys(byResult).sort().forEach(function (k) {
    msg += '  ' + k + ': ' + byResult[k] + '\n';
  });

  msg += '\nSLATE BUCKETS: today=' + slateBuckets.today +
    ' · past=' + slateBuckets.past +
    ' · future=' + slateBuckets.future +
    ' · blank=' + slateBuckets.blank + '\n';

  msg += '\nPENDING / past slate breakdown:\n';
  msg += '  gradeable (gamePk+batter_id both set): ' + pendingPastWithIds + '\n';
  msg += '  missing gamePk: ' + pendingPastMissingGp + '\n';
  msg += '  missing batter_id: ' + pendingPastMissingPid + '\n';
  msg += '  total pending (any slate): ' + pendingTotal + '\n';

  if (Object.keys(noteSamples).length) {
    msg += '\nGRADE NOTES (top 10 by count):\n';
    Object.keys(noteSamples)
      .sort(function (a, b) { return noteSamples[b] - noteSamples[a]; })
      .slice(0, 10)
      .forEach(function (k) {
        msg += '  ' + noteSamples[k] + 'x · ' + k + '\n';
      });
  } else {
    msg += '\nGRADE NOTES: (none) — grader has not written anything yet.\n';
  }

  ui.alert('Hits v2 Results Log diagnosis', msg, ui.ButtonSet.OK);
}

/**
 * Walk a single PENDING past-slate v2 row through every grader step and
 * pop a transcript. Picks the first qualifying row (PENDING/empty result
 * + slate < today). Does NOT mutate the sheet.
 */
function mlbTestGradeOneHitsV2Row_() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const log = ss.getSheetByName(MLB_RESULTS_LOG_V2_TAB);
  if (!log || log.getLastRow() < 4) {
    ui.alert('No v2 log.');
    return;
  }

  const today = mlbTodayYmdNY_();
  const last = log.getLastRow();
  const nCols = Math.max(MLB_RESULTS_LOG_V2_NCOL, log.getLastColumn());
  const data = log.getRange(4, 1, last - 3, nCols).getValues();
  const steps = [];
  steps.push('TODAY (NY): ' + today);
  steps.push('Rows scanned: ' + data.length);

  let pick = -1;
  let scanned = 0;
  for (let i = 0; i < data.length; i++) {
    const player = String(data[i][3] || '').trim();
    if (!player) continue;
    scanned++;
    const slate = mlbDiagReadSlateYmd_(data[i][1]);
    const result = String(data[i][16] || '').trim();
    if (!slate) continue;
    if (slate >= today) continue;
    if (result && result !== 'PENDING') continue;
    pick = i;
    break;
  }
  steps.push('Non-empty rows scanned: ' + scanned);

  if (pick < 0) {
    steps.push('NO qualifying row found (need: player set, slate<today, result PENDING/empty).');
    steps.push('If you expected one — check the diagnose popup for slate buckets + by-result.');
    ui.alert('mlbTestGradeOneHitsV2Row_', steps.join('\n'), ui.ButtonSet.OK);
    return;
  }

  const row = data[pick];
  const rawSlate = row[1];
  const slate = mlbDiagReadSlateYmd_(rawSlate);
  const player = String(row[3] || '').trim();
  const matchup = String(row[4] || '').trim();
  const line = row[6];
  const side = row[7];
  let gamePk = parseInt(row[13], 10);
  let pid = parseInt(row[14], 10);

  steps.push('');
  steps.push('PICKED sheet row ' + (4 + pick) + ': ' + player);
  steps.push('  raw row[1] (Slate): ' + mlbDiagDescribeCell_(rawSlate));
  steps.push('  normalized slate: "' + slate + '"');
  steps.push('  matchup: "' + matchup + '"');
  steps.push('  line: ' + line + ' · side: ' + side);
  steps.push('  initial gamePk: ' + (isNaN(gamePk) ? 'EMPTY' : gamePk));
  steps.push('  initial batter_id: ' + (isNaN(pid) ? 'EMPTY' : pid));

  if ((!gamePk || isNaN(gamePk)) && slate && matchup) {
    try {
      gamePk = mlbResolveGamePkFromSchedule_(slate, matchup, player);
      steps.push('  resolveGamePkFromSchedule → ' + gamePk);
    } catch (e) {
      steps.push('  resolveGamePkFromSchedule THREW: ' + e.message);
    }
  }
  if ((!pid || isNaN(pid)) && player) {
    try {
      pid = mlbStatsApiResolvePlayerIdFromName_(player);
      steps.push('  resolvePlayerIdFromName → ' + pid);
    } catch (e) {
      steps.push('  resolvePlayerIdFromName THREW: ' + e.message);
    }
  }

  if (!gamePk || isNaN(gamePk)) {
    steps.push('STOP: still no gamePk → grader would write "Missing gamePk…"');
    ui.alert('mlbTestGradeOneHitsV2Row_', steps.join('\n'), ui.ButtonSet.OK);
    return;
  }
  if (!pid || isNaN(pid)) {
    steps.push('STOP: still no batter_id → grader would write "Missing… player_id"');
    ui.alert('mlbTestGradeOneHitsV2Row_', steps.join('\n'), ui.ButtonSet.OK);
    return;
  }

  let box = null;
  try {
    box = mlbFetchFeedLiveJsonV2_(gamePk);
    steps.push('feed/live fetch (gamePk=' + gamePk + '): ' + (box ? 'OK' : 'NULL'));
  } catch (e) {
    steps.push('feed/live fetch THREW: ' + e.message);
  }
  if (!box) {
    steps.push('STOP: no payload → grader would write "Boxscore fetch failed"');
    ui.alert('mlbTestGradeOneHitsV2Row_', steps.join('\n'), ui.ButtonSet.OK);
    return;
  }

  let isFinal = false;
  try {
    isFinal = mlbBoxscoreIsFinal_(box);
  } catch (e) {
    steps.push('isFinal THREW: ' + e.message);
  }
  steps.push('mlbBoxscoreIsFinal_ → ' + isFinal);
  try {
    const gd = box.gameData && box.gameData.status ? box.gameData.status : null;
    const ld = box.liveData && box.liveData.game && box.liveData.game.status ? box.liveData.game.status : null;
    const st = box.status || null;
    steps.push('  status blocks present: gameData.status=' + (!!gd) + ', liveData.game.status=' + (!!ld) + ', payload.status=' + (!!st));
    if (gd) steps.push('  gameData.status: abs="' + (gd.abstractGameState || '') + '" det="' + (gd.detailedState || '') + '"');
    if (ld) steps.push('  liveData.game.status: abs="' + (ld.abstractGameState || '') + '" det="' + (ld.detailedState || '') + '"');
    if (st) steps.push('  payload.status: abs="' + (st.abstractGameState || '') + '" det="' + (st.detailedState || '') + '"');
  } catch (e) {
    steps.push('  status probe THREW: ' + e.message);
  }

  if (!isFinal) {
    steps.push('STOP: not final → grader would write "NOT_FINAL — will retry later"');
    ui.alert('mlbTestGradeOneHitsV2Row_', steps.join('\n'), ui.ButtonSet.OK);
    return;
  }

  let hActual = null;
  try {
    hActual = mlbBatterHitsFromBoxscore_(box, pid);
    steps.push('mlbBatterHitsFromBoxscore_ → ' + (hActual === null ? 'NULL (no batting line)' : hActual));
  } catch (e) {
    steps.push('hits extract THREW: ' + e.message);
  }
  if (hActual === null) {
    steps.push('  → grader would write VOID (DNP?)');
  } else {
    try {
      const g = mlbGradePitcherKRow_(line, side, hActual);
      steps.push('  → grade: ' + g.result + ' · ' + g.note);
    } catch (e) {
      steps.push('  gradePitcherKRow THREW: ' + e.message);
    }
  }

  ui.alert('mlbTestGradeOneHitsV2Row_', steps.join('\n'), ui.ButtonSet.OK);
}
