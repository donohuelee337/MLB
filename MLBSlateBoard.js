// ============================================================
// 🎯 MLB Slate Board — schedule + FanDuel line density (prototype)
// ============================================================
// Joins 📅 MLB_Schedule to ✅ FanDuel_MLB_Odds so you can sanity-check
// games on a slate without scanning thousands of prop rows.
// Game labels: exact match, then normalized (case/spacing) match.
// ============================================================

const MLB_SLATE_BOARD_TAB = '🎯 MLB_Slate_Board';

function mlbNormalizeGameLabel_(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*@\s*/g, ' @ ')
    .trim();
}

function mlbLineCountMapsFromOddsTab_(ss) {
  const byExact = {};
  const byNorm = {};
  const sh = ss.getSheetByName(MLB_ODDS_CONFIG.tabName);
  if (!sh || sh.getLastRow() < 4) return { byExact: byExact, byNorm: byNorm };
  const last = sh.getLastRow();
  const colB = sh.getRange(4, 2, last, 2).getValues();
  for (let i = 0; i < colB.length; i++) {
    const g = String(colB[i][0] || '').trim();
    if (!g) continue;
    byExact[g] = (byExact[g] || 0) + 1;
    const n = mlbNormalizeGameLabel_(g);
    byNorm[n] = (byNorm[n] || 0) + 1;
  }
  return { byExact: byExact, byNorm: byNorm };
}

function mlbLookupLineCount_(maps, matchup) {
  const m = String(matchup || '').trim();
  if (maps.byExact[m] != null) return maps.byExact[m];
  const n = mlbNormalizeGameLabel_(m);
  return maps.byNorm[n] || 0;
}

/**
 * Rebuilds slate board from existing Schedule + Odds tabs (no extra HTTP).
 */
function refreshMLBSlateBoard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig();
  const slateDate = getSlateDateString_(cfg);
  const sch = ss.getSheetByName(MLB_SCHEDULE_TAB);
  if (!sch || sch.getLastRow() < 4) {
    safeAlert_('Slate board', 'No schedule data — run Morning or 📅 MLB schedule first.');
    return;
  }

  const schLast = sch.getLastRow();
  const schCols = sch.getLastColumn();
  const scheduleRows = sch.getRange(4, 1, schLast, schCols).getValues();
  const maps = mlbLineCountMapsFromOddsTab_(ss);
  const tz = Session.getScriptTimeZone();

  const out = [];
  scheduleRows.forEach(function (r) {
    const gamePk = r[0];
    const matchup = r[5];
    if (!matchup && !gamePk) return;
    let firstPitch = '';
    try {
      if (r[2]) firstPitch = Utilities.formatDate(new Date(r[2]), tz, 'EEE M/d h:mm a');
    } catch (e) {
      firstPitch = String(r[2] || '');
    }
    const lineCount = mlbLookupLineCount_(maps, matchup);
    let matchNote = '';
    if (lineCount === 0 && (maps.byExact && Object.keys(maps.byExact).length > 0)) {
      matchNote = 'no FD rows matched label';
    }
    out.push([
      gamePk,
      firstPitch,
      matchup,
      r[3],
      r[4],
      r[6],
      r[7],
      r[8],
      r[9],
      lineCount,
      matchNote,
    ]);
  });

  let sh = ss.getSheetByName(MLB_SLATE_BOARD_TAB);
  if (sh) {
    sh.clearContents();
    sh.clearFormats();
  } else {
    sh = ss.insertSheet(MLB_SLATE_BOARD_TAB);
  }
  sh.setTabColor('#2e7d32');
  [72, 130, 260, 52, 52, 160, 160, 180, 120, 72, 200].forEach(function (w, i) {
    sh.setColumnWidth(i + 1, w);
  });

  sh.getRange(1, 1, 1, 11)
    .merge()
    .setValue('🎯 MLB Slate Board — ' + slateDate + ' — one row per game (FD line counts from ✅ tab)')
    .setFontWeight('bold')
    .setBackground('#1b5e20')
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center');

  const headers = [
    'gamePk',
    'first_pitch',
    'matchup',
    'away',
    'home',
    'away_probable_pitcher',
    'home_probable_pitcher',
    'venue',
    'status',
    'fanduel_lines',
    'notes',
  ];
  sh.getRange(3, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight('bold')
    .setBackground('#43a047')
    .setFontColor('#ffffff');
  sh.setFrozenRows(3);

  if (out.length) {
    sh.getRange(4, 1, out.length, headers.length).setValues(out);
    try {
      ss.setNamedRange('MLB_SLATE_BOARD', sh.getRange(4, 1, out.length, headers.length));
    } catch (e) {}
  }

  ss.toast(out.length + ' games · slate ' + slateDate, 'MLB Slate Board', 6);
}
