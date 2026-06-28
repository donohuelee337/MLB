// ============================================================
// 🔬 MLBShadowMonitor — standing review surface for shadow models
// ============================================================
// ONE always-present tab to monitor/review every shadow version, so when old
// per-version tabs get retired you never lose the promotion picture. Each
// shadow model is one row: source tab · log tab · graded N · W–L · ROI ·
// last slate · promotion verdict. Reads each log defensively (auto-detects
// result/pnl/stake/slate columns) so it survives schema drift.
//
// ➕ ADD A FUTURE SHADOW: append one entry to MLB_SHADOW_REGISTRY below.
// It then appears here automatically — that's the whole point.
//
// Depends: MLBFormat.js (house style). Read-only on the log tabs.
// ============================================================

const MLB_SHADOW_MONITOR_TAB = '🔬 Shadow_Monitor';

// The shadow roster. tag mirrors the model-version registries; card/log are
// the tabs to review. Leave card '' when a model has no standalone card.
const MLB_SHADOW_REGISTRY = [
  { tag: 'hit_machine',     kind: 'Parlay 1+H (paper)', card: '🎯 Hit_Machine',                log: '📋 HitMachine_Log' },
  { tag: 'h.v3-contact',    kind: 'Hits',               card: '🧪 Batter_Hits_Card_v3-contact', log: '🧪 MLB_Results_Log_Hits_v3' },
  { tag: 'h.v4-unanchored', kind: 'Hits',               card: '⚡ Sim_Batter_Hits',             log: '🧪 MLB_Results_Log_Hits_v4' },
  { tag: 'h.proto (v2log)', kind: 'Hits',               card: '',                               log: '🧪 MLB_Results_Log_v2' },
  { tag: 'tb.v2-full',      kind: 'Total Bases',        card: '🧪 Batter_TB_Card_v2-full',      log: '🧪 MLB_Results_Log_TB_v2' },
  { tag: 'tb.v3-power',     kind: 'Total Bases',        card: '🧪 Batter_TB_Card_v3-power',      log: '🧪 MLB_Results_Log_TB_v3' },
];

function mlbShadowPromoteMinN_() {
  try {
    const cfg = typeof getConfig === 'function' ? getConfig() : {};
    const n = parseInt(String(cfg['SHADOW_PROMOTE_MIN_N'] != null ? cfg['SHADOW_PROMOTE_MIN_N'] : '100'), 10);
    return isFinite(n) && n > 0 ? n : 100;
  } catch (e) { return 100; }
}

/** Find the header row (1..6) of a log: the row that names a result column. */
function mlbShadowFindHeader_(values) {
  for (let r = 0; r < Math.min(6, values.length); r++) {
    const row = values[r].map(function (v) { return String(v || '').trim().toLowerCase(); });
    const hasResult = row.indexOf('result') !== -1 || row.indexOf('grade') !== -1;
    const hasSlate = row.some(function (c) { return c === 'slate' || c === 'date'; });
    if (hasResult || (hasSlate && row.some(function (c) { return c.indexOf('pnl') !== -1; }))) return r;
  }
  return -1;
}

function mlbShadowColIdx_(headerRow, preds) {
  const row = headerRow.map(function (v) { return String(v || '').trim().toLowerCase(); });
  for (let p = 0; p < preds.length; p++) {
    for (let i = 0; i < row.length; i++) {
      if (preds[p](row[i])) return i;
    }
  }
  return -1;
}

/**
 * Best-effort summary of one shadow log tab.
 * @returns {{exists:boolean, totalRows:number, gradedN:number, wins:number,
 *   losses:number, pnl:number, roi:(number|null), lastDate:string, parsed:boolean}}
 */
function mlbShadowSummarizeLog_(ss, tabName) {
  const out = { exists: false, totalRows: 0, gradedN: 0, wins: 0, losses: 0, pnl: 0, roi: null, lastDate: '', parsed: false };
  const sh = tabName ? ss.getSheetByName(tabName) : null;
  if (!sh) return out;
  out.exists = true;
  const lastRow = sh.getLastRow();
  const lastCol = Math.min(40, Math.max(1, sh.getLastColumn()));
  if (lastRow < 2) return out;
  const values = sh.getRange(1, 1, lastRow, lastCol).getValues();
  const hRow = mlbShadowFindHeader_(values);
  if (hRow < 0) { out.totalRows = Math.max(0, lastRow - 1); return out; }
  const header = values[hRow];
  const iResult = mlbShadowColIdx_(header, [function (c) { return c === 'result'; }, function (c) { return c === 'grade'; }, function (c) { return c.indexOf('result') !== -1; }]);
  const iPnl = mlbShadowColIdx_(header, [function (c) { return c.indexOf('pnl') !== -1; }, function (c) { return c.indexOf('profit') !== -1; }, function (c) { return c === 'p/l' || c === 'p&l'; }]);
  const iStake = mlbShadowColIdx_(header, [function (c) { return c.indexOf('stake') !== -1; }, function (c) { return c.indexOf('risk') !== -1; }]);
  const iDate = mlbShadowColIdx_(header, [function (c) { return c === 'slate'; }, function (c) { return c === 'date'; }, function (c) { return c.indexOf('slate') !== -1; }, function (c) { return c.indexOf('date') !== -1; }]);
  let stakeSum = 0;
  for (let r = hRow + 1; r < values.length; r++) {
    const row = values[r];
    if (!row || row.every(function (v) { return v === '' || v == null; })) continue;
    out.totalRows++;
    if (iResult >= 0) {
      const res = String(row[iResult] || '').trim().toUpperCase();
      if (res === 'WIN' || res === 'W') { out.gradedN++; out.wins++; }
      else if (res === 'LOSS' || res === 'L') { out.gradedN++; out.losses++; }
      else if (res === 'PUSH' || res === 'VOID') { out.gradedN++; }
    }
    if (iPnl >= 0) { const p = parseFloat(String(row[iPnl])); if (isFinite(p)) out.pnl += p; }
    if (iStake >= 0) { const s = parseFloat(String(row[iStake])); if (isFinite(s)) stakeSum += s; }
    if (iDate >= 0) { const d = String(row[iDate] || '').trim(); if (d && d > out.lastDate) out.lastDate = d; }
  }
  out.parsed = iResult >= 0 || iPnl >= 0;
  out.pnl = Math.round(out.pnl * 100) / 100;
  if (stakeSum > 0) out.roi = Math.round((out.pnl / stakeSum) * 1000) / 10; // % to 1dp
  else if (out.gradedN > 0 && iPnl >= 0) out.roi = Math.round((out.pnl / out.gradedN) * 100) / 100; // $/bet fallback
  return out;
}

function mlbShadowVerdict_(s, minN) {
  if (!s.exists) return 'no log yet';
  if (!s.parsed) return 'review in tab (schema n/a)';
  if (s.gradedN < minN) return 'collecting (' + s.gradedN + '/' + minN + ')';
  if (s.roi != null && s.roi > 0) return 'PROMOTE-READY ✅';
  return 'underperforming ⚠️';
}

/** Build the 🔬 Shadow_Monitor dashboard. */
function refreshShadowMonitor_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const minN = mlbShadowPromoteMinN_();
  const rows = [];
  const verdicts = [];
  MLB_SHADOW_REGISTRY.forEach(function (m) {
    const s = mlbShadowSummarizeLog_(ss, m.log);
    const verdict = mlbShadowVerdict_(s, minN);
    verdicts.push(verdict);
    const wl = s.gradedN ? (s.wins + '–' + s.losses + (s.gradedN > s.wins + s.losses ? ' (+' + (s.gradedN - s.wins - s.losses) + ' void/push)' : '')) : '';
    const roiDisp = s.roi == null ? '' : (s.roi > 0 ? '+' : '') + s.roi + (s.parsed && s.roi != null ? '' : '');
    rows.push([
      m.tag, m.kind, m.card || '—', m.log,
      s.gradedN || (s.totalRows ? s.totalRows + ' raw' : 0),
      wl, roiDisp, s.lastDate || '', verdict,
    ]);
  });

  let sh = ss.getSheetByName(MLB_SHADOW_MONITOR_TAB);
  if (sh) { sh.clearContents(); sh.clearFormats(); }
  else { sh = ss.insertSheet(MLB_SHADOW_MONITOR_TAB); }
  sh.setTabColor('#6a1b9a');
  mlbFmtTitle_(
    sh,
    '🔬 Shadow Monitor — promotion watch for every shadow model · ROI = paper P/L ÷ staked · promote bar N≥' + minN +
      ' with ROI>0 · built ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'EEE M/d h:mm a'),
    9,
    { accent: '#4a148c' }
  );
  mlbFmtHeader_(sh, 2, ['shadow model', 'market', 'source tab', 'log tab', 'graded N', 'W–L', 'ROI %', 'last slate', 'verdict'], { accent: '#6a1b9a' });
  if (rows.length) {
    sh.getRange(3, 1, rows.length, 9).setValues(rows);
    mlbFmtBody_(sh, 3, rows.length, 9);
    for (let i = 0; i < rows.length; i++) {
      const v = verdicts[i];
      const cell = sh.getRange(3 + i, 9);
      if (v.indexOf('PROMOTE-READY') !== -1) cell.setBackground('#15803d').setFontColor('#ffffff');
      else if (v.indexOf('underperforming') !== -1) cell.setBackground('#b91c1c').setFontColor('#ffffff');
      else if (v.indexOf('collecting') !== -1) cell.setBackground('#fff8e1');
    }
  }
  sh.setColumnWidth(3, 200);
  sh.setColumnWidth(4, 200);
  sh.setColumnWidth(9, 190);
  mlbFmtFreeze_(sh, 2);
  try { ss.toast(rows.length + ' shadow model(s) summarized · see 🔬 Shadow_Monitor', '🔬 Shadow Monitor', 8); } catch (e) {}
}

function mlbActivateShadowMonitorTab_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(MLB_SHADOW_MONITOR_TAB);
  if (!sh) { refreshShadowMonitor_(); sh = ss.getSheetByName(MLB_SHADOW_MONITOR_TAB); }
  if (sh) sh.activate();
}
