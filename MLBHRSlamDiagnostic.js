// ============================================================
// 🩺 HR + Grand Slam tab diagnostic (MLB-BOIZ)
// ============================================================
// Scans the active spreadsheet for tabs whose names look like HR or
// Grand Slam tabs and reports basic health: presence, header row,
// data row count, blank-cell density, freshness, and a sample row.
//
// No assumptions about exact tab names or column schemas — pattern
// matches whatever the user has actually created.

var MLB_HR_SLAM_DIAGNOSTIC_TAB = '🩺 HR_Slam_Diagnostic';

var MLB_HR_SLAM_TAB_PATTERNS_ = [
  { label: 'HR', re: /(^|[^a-z])hr([^a-z]|$)/i },
  { label: 'HomeRun', re: /home\s*runs?/i },
  { label: 'GrandSlam', re: /grand\s*slam/i },
  { label: 'Slam', re: /(^|[^a-z])slam([^a-z]|$)/i },
];

/** Menu entry point. */
function runHRSlamDiagnostic() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const report = buildHRSlamDiagnosticReport_(ss);
  writeHRSlamDiagnosticTab_(ss, report);
  ss.toast(
    'HR/Slam diagnostic: ' + report.rows.length + ' tab(s) checked, ' + report.issueCount + ' issue(s)',
    'MLB-BOIZ',
    8
  );
  try {
    ss.getSheetByName(MLB_HR_SLAM_DIAGNOSTIC_TAB).activate();
  } catch (e) {}
}

/**
 * Pure builder — easy to unit-test against a stub spreadsheet.
 * @return {{rows: !Array<!Object>, issueCount: number, fileLastUpdated: ?Date}}
 */
function buildHRSlamDiagnosticReport_(ss) {
  const sheets = ss.getSheets();
  let fileLastUpdated = null;
  try {
    fileLastUpdated = DriveApp.getFileById(ss.getId()).getLastUpdated();
  } catch (e) {
    // DriveApp scope may be missing; report null and keep going.
  }

  const rows = [];
  let issueCount = 0;

  for (let i = 0; i < sheets.length; i++) {
    const sh = sheets[i];
    const name = sh.getName();
    const match = matchHRSlamPattern_(name);
    if (!match) continue;

    const diag = diagnoseSheet_(sh);
    diag.tabName = name;
    diag.patternLabel = match;
    if (diag.issues.length) issueCount += diag.issues.length;
    rows.push(diag);
  }

  rows.sort(function (a, b) {
    return a.tabName.localeCompare(b.tabName);
  });

  return { rows: rows, issueCount: issueCount, fileLastUpdated: fileLastUpdated };
}

function matchHRSlamPattern_(name) {
  for (let i = 0; i < MLB_HR_SLAM_TAB_PATTERNS_.length; i++) {
    if (MLB_HR_SLAM_TAB_PATTERNS_[i].re.test(name)) return MLB_HR_SLAM_TAB_PATTERNS_[i].label;
  }
  return null;
}

function diagnoseSheet_(sh) {
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  const issues = [];

  if (lastRow === 0 || lastCol === 0) {
    return {
      lastRow: 0,
      lastCol: 0,
      headerRow: 0,
      headers: [],
      dataRows: 0,
      blankRowCount: 0,
      blankCellPct: 0,
      sampleRow: [],
      issues: ['empty sheet'],
    };
  }

  // The project convention is row 1 = title, row 3 = headers, row 4+ = data.
  // Fall back to row 1 headers for tabs that don't follow that pattern.
  const headerRow = guessHeaderRow_(sh, lastCol);
  const headers = headerRow > 0
    ? sh.getRange(headerRow, 1, 1, lastCol).getDisplayValues()[0]
    : [];
  const headerCellCount = headers.filter(function (h) {
    return String(h).trim() !== '';
  }).length;

  if (headerRow === 0) issues.push('no header row found (rows 1–3)');
  if (headerRow > 0 && headerCellCount === 0) issues.push('header row is blank');

  const dataStartRow = headerRow > 0 ? headerRow + 1 : 1;
  const dataRowCount = Math.max(0, lastRow - dataStartRow + 1);

  let blankRowCount = 0;
  let blankCellCount = 0;
  let totalCellCount = 0;
  let sampleRow = [];
  let formulaSummary = '';

  if (dataRowCount > 0) {
    const data = sh.getRange(dataStartRow, 1, dataRowCount, lastCol).getDisplayValues();
    for (let r = 0; r < data.length; r++) {
      let rowHasValue = false;
      for (let c = 0; c < data[r].length; c++) {
        const v = String(data[r][c]).trim();
        if (v === '') blankCellCount += 1;
        else rowHasValue = true;
        totalCellCount += 1;
      }
      if (!rowHasValue) blankRowCount += 1;
      if (rowHasValue && !sampleRow.length) sampleRow = data[r];
    }

    // Sample the first data row's formulas to classify the data source.
    const firstFormulas = sh.getRange(dataStartRow, 1, 1, lastCol).getFormulas()[0];
    formulaSummary = classifyFormulaSource_(firstFormulas);
    if (dataStartRow === 4) {
      // ARRAYFORMULA/IMPORTRANGE typically live in the first data cell only.
      const anchorFormula = sh.getRange(dataStartRow, 1).getFormula();
      if (anchorFormula && /array.?formula|importrange|importdata|query|filter\b/i.test(anchorFormula)) {
        formulaSummary = 'anchor: ' + anchorFormula.substring(0, 80);
      }
    }
  }

  const blankCellPct = totalCellCount > 0 ? blankCellCount / totalCellCount : 0;

  if (dataRowCount === 0) issues.push('no data rows below header');
  if (dataRowCount > 0 && blankRowCount === dataRowCount) issues.push('all data rows blank');
  if (dataRowCount > 0 && blankCellPct >= 0.6) {
    issues.push('blank cells = ' + Math.round(blankCellPct * 100) + '% (≥ 60%)');
  }

  return {
    lastRow: lastRow,
    lastCol: lastCol,
    headerRow: headerRow,
    headers: headers,
    dataRows: dataRowCount,
    blankRowCount: blankRowCount,
    blankCellPct: blankCellPct,
    sampleRow: sampleRow,
    formulaSummary: formulaSummary,
    issues: issues,
  };
}

/** Inspects a row's formulas and returns a short data-source classification. */
function classifyFormulaSource_(formulas) {
  if (!formulas || !formulas.length) return 'literal values';
  let formulaCount = 0;
  let arrayFormula = false;
  let importRange = false;
  let importData = false;
  let firstFormula = '';
  for (let i = 0; i < formulas.length; i++) {
    const f = formulas[i];
    if (!f) continue;
    formulaCount += 1;
    if (!firstFormula) firstFormula = f;
    if (/^=array.?formula/i.test(f.replace(/\s/g, ''))) arrayFormula = true;
    if (/importrange/i.test(f)) importRange = true;
    if (/importdata/i.test(f)) importData = true;
  }
  if (formulaCount === 0) return 'literal values (manual or written by GAS)';
  const tags = [];
  if (arrayFormula) tags.push('ARRAYFORMULA');
  if (importRange) tags.push('IMPORTRANGE');
  if (importData) tags.push('IMPORTDATA');
  const tagStr = tags.length ? ' [' + tags.join(',') + ']' : '';
  return formulaCount + '/' + formulas.length + ' formula cells' + tagStr +
    (firstFormula ? ' — ' + firstFormula.substring(0, 60) : '');
}

/** Prefer row 3 (project convention); fall back to row 1 if row 3 is empty. */
function guessHeaderRow_(sh, lastCol) {
  const candidates = [3, 1, 2];
  for (let i = 0; i < candidates.length; i++) {
    const r = candidates[i];
    if (r > sh.getLastRow()) continue;
    const vals = sh.getRange(r, 1, 1, lastCol).getDisplayValues()[0];
    const filled = vals.filter(function (v) {
      return String(v).trim() !== '';
    }).length;
    if (filled >= 2) return r;
  }
  return 0;
}

function writeHRSlamDiagnosticTab_(ss, report) {
  let sh = ss.getSheetByName(MLB_HR_SLAM_DIAGNOSTIC_TAB);
  if (!sh) sh = ss.insertSheet(MLB_HR_SLAM_DIAGNOSTIC_TAB);
  sh.clear();

  const tz = ss.getSpreadsheetTimeZone() || 'America/New_York';
  const stamp = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm');
  const lastUpd = report.fileLastUpdated
    ? Utilities.formatDate(report.fileLastUpdated, tz, 'yyyy-MM-dd HH:mm')
    : '(unknown)';

  sh.getRange(1, 1).setValue(
    '🩺 HR + Grand Slam tab diagnostic — ' + stamp + ' — file last edit: ' + lastUpd
  );
  sh.getRange(1, 1).setFontWeight('bold');

  const headers = [
    'Tab',
    'Pattern',
    'Header row',
    '# headers',
    'Data rows',
    'Blank rows',
    'Blank %',
    'Data source',
    'Issues',
    'Sample row (first 6 cells)',
  ];
  sh.getRange(3, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');

  if (!report.rows.length) {
    sh.getRange(4, 1).setValue('No tabs matched HR / Grand Slam patterns.');
    sh.autoResizeColumns(1, headers.length);
    return;
  }

  const out = report.rows.map(function (r) {
    const headerCount = r.headers
      ? r.headers.filter(function (v) {
          return String(v).trim() !== '';
        }).length
      : 0;
    return [
      r.tabName,
      r.patternLabel,
      r.headerRow || '',
      headerCount,
      r.dataRows,
      r.blankRowCount,
      r.dataRows > 0 ? Math.round(r.blankCellPct * 100) + '%' : '',
      r.formulaSummary || '',
      r.issues.length ? r.issues.join('; ') : 'OK',
      (r.sampleRow || []).slice(0, 6).join(' | '),
    ];
  });
  sh.getRange(4, 1, out.length, headers.length).setValues(out);

  // Highlight rows that have issues.
  for (let i = 0; i < report.rows.length; i++) {
    if (report.rows[i].issues.length) {
      sh.getRange(4 + i, 1, 1, headers.length).setBackground('#fde2e2');
    }
  }

  sh.autoResizeColumns(1, headers.length);
}
