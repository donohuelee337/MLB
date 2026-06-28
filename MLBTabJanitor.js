// ============================================================
// 🧹 MLBTabJanitor — audit + guarded cleanup of dead tabs
// ============================================================
// "Get to No Fast" for the spreadsheet. Two jobs:
//   1. mlbTabAudit_()        — non-destructive report (🧹 Tab_Audit) that
//      classifies every sheet: DELETE (orphan) · PROTECTED (history/infra) ·
//      REVIEW (everything else — eyeball it).
//   2. mlbTabCleanupDryRun_ / mlbTabCleanupApply_ — delete ONLY the verified
//      orphan list, never a protected tab, and apply only fires when
//      Config TAB_CLEANUP_ARMED = Y. Belt and suspenders so nothing graded
//      ever dies by accident.
//
// ORPHANS were verified against the codebase on 2026-06-27: each tab below
// has ZERO references in any .js/.html (the pipeline will NOT recreate it).
// NOTE the trap we caught: 🎰 Batter_TB_Card LOOKS legacy but is the LIVE
// source MLBSimBatterTB.js reads — it is NOT here. Do not add it.
// ============================================================

const MLB_TAB_AUDIT_TAB = '🧹 Tab_Audit';

// Confirmed dead — abandoned models / superseded one-offs. Safe to delete;
// no code writes them. (Pitcher walks model = 3 tabs; pitcher hits-allowed =
// 2 tabs; old standalone HR card + its orphan queue; a dead tracker-compare;
// a debug tab with no builder.)
const MLB_TAB_ORPHANS = [
  '🔬 MLB_Tracker_Compare',
  '🪶 Pitcher_BB_Card',
  '📋 Pitcher_BB_Queue',
  '🎰 Pitcher_BB_Card',
  '💥 Batter_HR_Card',
  '📋 Pitcher_HA_Queue',
  '🧱 Pitcher_HA_Card',
  '🧪 MLB_Bet_Card_Debug',
  '📋 Batter_HR_Queue',
];

// Holds captured data (no code writer, but it may feed a local notebook) —
// NOT auto-deleted. Shown in the audit as REVIEW so you decide explicitly.
const MLB_TAB_ORPHANS_REVIEW = [
  '🥎 Batter_Game_Logs',
];

// Safety net: anything matching these is PROTECTED — the apply refuses to
// delete it even if it somehow appears on a list. History + infra + sources.
const MLB_TAB_PROTECT_RX = /(results?_log|pipeline_log|pipeline_timings|hitmachine_log|config|schedule|fanduel|odds|injury|_cache|_logs|savant_|lineup_data)/i;

/** Regenerable on demand (diagnostics/backtests) — safe to clear, code
 *  rebuilds them. Flagged in the audit but never auto-deleted. */
const MLB_TAB_REGENERABLE_RX = /(diag|backtest|calibration|deep_dive|segment|discrepanc|walkforward|model_compare|slam_diagnostic|data_diagnostic)/i;

/** @returns {Object} name → true for the union of orphan lists. */
function mlbTabOrphanSet_() {
  const s = {};
  MLB_TAB_ORPHANS.forEach(function (n) { s[n] = 'DELETE'; });
  MLB_TAB_ORPHANS_REVIEW.forEach(function (n) { s[n] = 'REVIEW'; });
  return s;
}

/** Classify a single tab name. */
function mlbTabClassify_(name) {
  const orph = mlbTabOrphanSet_();
  if (MLB_TAB_PROTECT_RX.test(name)) return { tag: 'PROTECTED', why: 'history / infra / data source — never auto-delete' };
  if (orph[name] === 'DELETE') return { tag: 'DELETE', why: 'orphan — no code references it (verified)' };
  if (orph[name] === 'REVIEW') return { tag: 'REVIEW', why: 'no code writer, but holds data — confirm before delete' };
  if (MLB_TAB_REGENERABLE_RX.test(name)) return { tag: 'REGENERABLE', why: 'diagnostic/backtest — code rebuilds on demand' };
  return { tag: 'ACTIVE', why: 'in use / unclassified — leave alone' };
}

/** Estimate last-touched date by scanning the title row for an ISO date. */
function mlbTabDateHint_(sh) {
  try {
    const v = String(sh.getRange(1, 1).getValue() || '');
    const m = v.match(/\d{4}-\d{2}-\d{2}/) || v.match(/[A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d{4}/);
    return m ? m[0] : '';
  } catch (e) { return ''; }
}

/**
 * Non-destructive audit → writes the 🧹 Tab_Audit report and toasts a count.
 */
function mlbTabAudit_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets();
  const rows = [];
  let del = 0, rev = 0;
  sheets.forEach(function (sh) {
    const name = sh.getName();
    if (name === MLB_TAB_AUDIT_TAB) return;
    const c = mlbTabClassify_(name);
    if (c.tag === 'DELETE') del++;
    if (c.tag === 'REVIEW') rev++;
    let rowsN = '';
    try { rowsN = Math.max(0, sh.getLastRow()); } catch (e) {}
    rows.push([
      name,
      sh.isSheetHidden() ? 'hidden' : 'visible',
      rowsN,
      mlbTabDateHint_(sh),
      c.tag,
      c.why,
    ]);
  });
  // DELETE first, then REVIEW, REGENERABLE, ACTIVE, PROTECTED.
  const order = { DELETE: 0, REVIEW: 1, REGENERABLE: 2, ACTIVE: 3, PROTECTED: 4 };
  rows.sort(function (a, b) {
    const d = (order[a[4]] || 9) - (order[b[4]] || 9);
    return d !== 0 ? d : String(a[0]).localeCompare(String(b[0]));
  });

  let sh = ss.getSheetByName(MLB_TAB_AUDIT_TAB);
  if (sh) { sh.clearContents(); sh.clearFormats(); }
  else { sh = ss.insertSheet(MLB_TAB_AUDIT_TAB); }
  sh.setTabColor('#9e9e9e');
  const armed = mlbTabCleanupArmed_() ? 'ARMED' : 'safe (dry-run only)';
  mlbFmtTitle_(
    sh,
    '🧹 Tab Audit — ' + sheets.length + ' tabs · ' + del + ' orphan(s) to DELETE · ' + rev +
      ' to REVIEW · cleanup is ' + armed + ' · built ' +
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'EEE M/d h:mm a'),
    6,
    { accent: '#616161' }
  );
  mlbFmtHeader_(sh, 2, ['tab', 'state', 'rows', 'date hint', 'verdict', 'why'], { accent: '#616161' });
  if (rows.length) {
    sh.getRange(3, 1, rows.length, 6).setValues(rows);
    mlbFmtBody_(sh, 3, rows.length, 6);
    // Tint the DELETE rows red-ish, REVIEW amber.
    for (let i = 0; i < rows.length; i++) {
      if (rows[i][4] === 'DELETE') sh.getRange(3 + i, 1, 1, 6).setBackground('#fdecea');
      else if (rows[i][4] === 'REVIEW') sh.getRange(3 + i, 1, 1, 6).setBackground('#fff8e1');
      else if (rows[i][4] === 'PROTECTED') sh.getRange(3 + i, 5, 1, 1).setFontColor('#1b5e20');
    }
  }
  sh.setColumnWidth(1, 230);
  sh.setColumnWidth(6, 360);
  mlbFmtFreeze_(sh, 2);
  try { sh.activate(); } catch (e) {}
  try { ss.toast(del + ' orphan(s) flagged · ' + rev + ' to review · see 🧹 Tab_Audit', '🧹 Tab Audit', 8); } catch (e) {}
  return { sheets: sheets.length, del: del, rev: rev };
}

/** @returns {boolean} TAB_CLEANUP_ARMED config gate. */
function mlbTabCleanupArmed_() {
  try {
    const cfg = typeof getConfig === 'function' ? getConfig() : {};
    return String(cfg['TAB_CLEANUP_ARMED'] != null ? cfg['TAB_CLEANUP_ARMED'] : 'N').trim().toUpperCase() === 'Y';
  } catch (e) { return false; }
}

/** Orphans that actually exist in this spreadsheet right now. */
function mlbTabDeletableNow_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const present = {};
  ss.getSheets().forEach(function (sh) { present[sh.getName()] = true; });
  return MLB_TAB_ORPHANS.filter(function (n) {
    return present[n] && !MLB_TAB_PROTECT_RX.test(n);
  });
}

/** Dry-run: report exactly what apply WOULD delete. Never deletes. */
function mlbTabCleanupDryRun_() {
  const list = mlbTabDeletableNow_();
  const msg = list.length
    ? 'DRY-RUN — would delete ' + list.length + ' orphan tab(s): ' + list.join(', ') +
      '. Set Config TAB_CLEANUP_ARMED = Y, then run "Cleanup APPLY".'
    : 'DRY-RUN — no orphan tabs present. Nothing to delete.';
  Logger.log(msg);
  try { SpreadsheetApp.getActiveSpreadsheet().toast(msg, '🧹 Cleanup dry-run', 12); } catch (e) {}
  return list;
}

/**
 * Apply: delete the verified orphan tabs. Guards:
 *   • TAB_CLEANUP_ARMED must be Y (else no-op + toast)
 *   • only names on MLB_TAB_ORPHANS
 *   • never a name matching MLB_TAB_PROTECT_RX
 * Logs every deletion. Run mlbTabAudit_ afterward to confirm.
 */
function mlbTabCleanupApply_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!mlbTabCleanupArmed_()) {
    const m = 'Cleanup is NOT armed. Set Config TAB_CLEANUP_ARMED = Y first (then re-run). Dry-run is always safe.';
    Logger.log(m);
    try { ss.toast(m, '🧹 Cleanup blocked', 10); } catch (e) {}
    return { deleted: [], blocked: true };
  }
  const list = mlbTabDeletableNow_();
  const deleted = [];
  list.forEach(function (name) {
    if (MLB_TAB_PROTECT_RX.test(name)) return; // double-guard
    try {
      const sh = ss.getSheetByName(name);
      if (sh) { ss.deleteSheet(sh); deleted.push(name); Logger.log('🧹 deleted tab: ' + name); }
    } catch (e) {
      Logger.log('🧹 could not delete ' + name + ': ' + (e.message || e));
    }
  });
  const msg = deleted.length
    ? 'Deleted ' + deleted.length + ' orphan tab(s): ' + deleted.join(', ')
    : 'No orphan tabs deleted (none present).';
  Logger.log(msg);
  try { ss.toast(msg, '🧹 Cleanup applied', 12); } catch (e) {}
  return { deleted: deleted, blocked: false };
}

/** Self-test (no sheet I/O): classification + guard wiring. */
function mlbTabJanitorSelfTest_() {
  if (mlbTabClassify_('🪶 Pitcher_BB_Card').tag !== 'DELETE') throw new Error('orphan classify');
  if (mlbTabClassify_('🧪 MLB_Results_Log_TB_v2').tag !== 'PROTECTED') throw new Error('protect classify');
  if (mlbTabClassify_('🥎 Batter_Game_Logs').tag !== 'REVIEW') throw new Error('review classify');
  if (mlbTabClassify_('⚡ Sim_Batter_Hits').tag !== 'ACTIVE') throw new Error('active classify');
  if (MLB_TAB_PROTECT_RX.test('🎰 Batter_TB_Card')) throw new Error('legacy TB must NOT match protect-rx (it is active, not orphan)');
  return 'OK orphans=' + MLB_TAB_ORPHANS.length + ' review=' + MLB_TAB_ORPHANS_REVIEW.length;
}

function mlbTabJanitorSelfTestMenu_() {
  try { safeAlert_('Tab janitor self-test', mlbTabJanitorSelfTest_()); }
  catch (e) { safeAlert_('Tab janitor self-test', String(e.message || e)); }
}
