// ============================================================
// 📊 MLB-BOIZ Project Status — auto-tracked workstream dashboard
// ============================================================
// One row per market / promo / experiment. Auto-fills from existing
// tabs and result logs after every pipeline run, so we never have to
// remember "what stage is TB v2 in" or "when did GS promo last write
// picks." Stage / model-version / notes are declared in the manifest
// below — everything else is computed.
//
// Conventions used here are the same as every other MLB-BOIZ writer:
//   row 1 = merged title bar
//   row 3 = headers
//   row 4+ = data
//
// Adding a new workstream = one entry in MLB_PROJECT_STATUS_MANIFEST.

const MLB_PROJECT_STATUS_TAB = '📊 Project_Status';

/**
 * Declared truth for every active workstream. Edit `stage`, `modelVersion`,
 * and `notes` as work progresses — the writer computes the rest.
 *
 * Stages:
 *   idea     — designed but no code yet
 *   shadow   — running but not on the live Bet Card / not bet
 *   live     — on Bet Card / being bet
 *   retired  — turned off (kept here for history)
 */
const MLB_PROJECT_STATUS_MANIFEST = [
  // ---- Core markets we bet ----
  {
    id: 'k',
    label: '⚾ Pitcher K',
    category: 'Core',
    stage: 'live',
    modelVersion: 'k.v1',
    mainTab: typeof MLB_PITCHER_K_CARD_TAB !== 'undefined' ? MLB_PITCHER_K_CARD_TAB : '🎰 Pitcher_K_Card',
    logTab: typeof MLB_RESULTS_LOG_TAB !== 'undefined' ? MLB_RESULTS_LOG_TAB : '📋 MLB_Results_Log',
    notes: 'Live on Bet Card. Closing K backfilled at FINAL.',
  },
  {
    id: 'tb',
    label: '🎲 Batter TB v1',
    category: 'Core',
    stage: 'retired',
    modelVersion: 'tb.v1',
    mainTab: typeof MLB_BATTER_TB_CARD_TAB !== 'undefined' ? MLB_BATTER_TB_CARD_TAB : '🎲 Batter_TB_Card',
    logTab: typeof MLB_RESULTS_LOG_TAB !== 'undefined' ? MLB_RESULTS_LOG_TAB : '📋 MLB_Results_Log',
    notes: 'Retired 2026-05-20. Was losing; pulled from Bet Card, then dropped from pipeline. Menu item still rebuilds on demand. Historical rows frozen.',
  },
  {
    id: 'h',
    label: '🎯 Batter Hits',
    category: 'Core',
    stage: 'shadow',
    modelVersion: 'h.v2-full',
    mainTab:
      typeof MLB_BATTER_HITS_V2_CARD_TAB !== 'undefined' ? MLB_BATTER_HITS_V2_CARD_TAB : '🧪 Batter_Hits_Card_v2-full',
    logTab: typeof MLB_RESULTS_LOG_TAB !== 'undefined' ? MLB_RESULTS_LOG_TAB : '📋 MLB_Results_Log',
    notes:
      'h.v2-full is the promoted hits MODEL, but currently GATED OFF the 🃏 Bet Card ' +
      '(K_SEGMENT_INCLUDE_H=N → K-only card). Sim computes every window and can snapshot to ' +
      'the shadow log, but it is NOT a live unified-card bet. Benched after ~-9% ROI. ' +
      'Re-activate via K_SEGMENT_INCLUDE_H=Y once an edge is proven — candidates: one-sided-shrink ' +
      'shadow (⚡ Sim_Batter_Hits cols 37-40) or h.v3-contact.',
  },

  // ---- Shadow models (running but not bet) ----
  {
    id: 'tb-v2',
    label: '🧪 Batter TB v2',
    category: 'Shadow',
    stage: 'retired',
    modelVersion: 'tb.v2-full',
    mainTab:
      typeof MLB_BATTER_TB_V2_CARD_TAB !== 'undefined' ? MLB_BATTER_TB_V2_CARD_TAB : '🧪 Batter_TB_Card_v2-full',
    logTab: typeof MLB_RESULTS_LOG_TB_V2_TAB !== 'undefined' ? MLB_RESULTS_LOG_TB_V2_TAB : '🧪 MLB_Results_Log_TB_v2',
    notes: 'Retired 2026-05-21. Dropped from pipeline + odds fetch (losing market). Re-enable manually in Apps Script if revisiting.',
  },
  {
    id: 'tb-v3',
    label: '🧪 Batter TB v3-power',
    category: 'Shadow',
    stage: 'retired',
    modelVersion: 'tb.v3-power',
    mainTab:
      typeof MLB_BATTER_TB_V3_CARD_TAB !== 'undefined' ? MLB_BATTER_TB_V3_CARD_TAB : '🧪 Batter_TB_Card_v3-power',
    logTab: typeof MLB_RESULTS_LOG_TB_V3_TAB !== 'undefined' ? MLB_RESULTS_LOG_TB_V3_TAB : '🧪 MLB_Results_Log_TB_v3',
    notes: 'Retired 2026-05-21 with TB v2. Historical shadow log rows remain readable.',
  },
  {
    id: 'h-v1',
    label: '🧪 Batter Hits v1',
    category: 'Shadow',
    stage: 'retired',
    modelVersion: 'h.v1',
    mainTab: typeof MLB_BATTER_HITS_CARD_TAB !== 'undefined' ? MLB_BATTER_HITS_CARD_TAB : '🎯 Batter_Hits_Card',
    logTab: typeof MLB_RESULTS_LOG_V2_TAB !== 'undefined' ? MLB_RESULTS_LOG_V2_TAB : '🧪 MLB_Results_Log_v2',
    notes: 'Retired 2026-05-20. Dropped from pipeline to recover budget; shadow comparison frozen at this slate. Menu item still rebuilds on demand.',
  },
  {
    id: 'h-v3',
    label: '🧪 Batter Hits v3-contact (shadow)',
    category: 'Shadow',
    stage: 'shadow',
    modelVersion: 'h.v3-contact',
    mainTab:
      typeof MLB_BATTER_HITS_V3_CARD_TAB !== 'undefined' ? MLB_BATTER_HITS_V3_CARD_TAB : '🧪 Batter_Hits_Card_v3-contact',
    logTab:
      typeof MLB_RESULTS_LOG_HITS_V3_TAB !== 'undefined' ? MLB_RESULTS_LOG_HITS_V3_TAB : '🧪 MLB_Results_Log_Hits_v3',
    notes: 'v2 + batter K-rate (inv) + opp SP K/9 (inv) + Streak overlap. Promote if it beats v2 over 100+ graded.',
  },

  // ---- Promos ----
  {
    id: 'hr-promo',
    label: '📣 HR Promo',
    category: 'Promo',
    stage: 'shadow',
    modelVersion: 'hr-promo.v1',
    mainTab: typeof MLB_BATTER_HR_PROMO_TAB !== 'undefined' ? MLB_BATTER_HR_PROMO_TAB : '📣 Batter_HR_Promo',
    logTab:
      typeof MLB_HR_PROMO_RESULTS_LOG_TAB !== 'undefined' ? MLB_HR_PROMO_RESULTS_LOG_TAB : '📋 HR_Promo_Results_Log',
    notes: 'Snapshotting + grading. Not on Bet Card yet.',
  },
  {
    id: 'gs-promo',
    label: '💎 GS Promo',
    category: 'Promo',
    stage: 'shadow',
    modelVersion: 'gs-promo.v0',
    mainTab: typeof MLB_BATTER_GS_PROMO_TAB !== 'undefined' ? MLB_BATTER_GS_PROMO_TAB : '📣 Batter_GS_Promo',
    logTab: null,
    notes: 'Inherits HR promo λ + pitcher_mult; picks tab built; no results log / grading yet.',
  },
  {
    id: 'streak',
    label: '🔥 Streak Picks',
    category: 'Promo',
    stage: 'live',
    modelVersion: 'streak.v1',
    mainTab: typeof MLB_STREAK_PICKS_TAB !== 'undefined' ? MLB_STREAK_PICKS_TAB : '🔥 Streak_Picks',
    logTab: null,
    notes: 'Drives the yellow Streak highlight on the Bet Card. No standalone log.',
  },
];

const MLB_PROJECT_STATUS_HEADERS = [
  'Workstream',
  'Category',
  'Stage',
  'Model',
  'Main tab',
  'Main rows',
  'Log tab',
  'Log rows',
  'Last snapshot',
  'Graded rows',
  'Last graded',
  'Notes',
];

/** Public entry point — refresh the dashboard. */
function refreshProjectStatus() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tz = Session.getScriptTimeZone() || 'America/New_York';
  const rows = MLB_PROJECT_STATUS_MANIFEST.map(function (entry) {
    return mlbProjectStatusComputeRow_(ss, entry, tz);
  });
  mlbProjectStatusWriteTab_(ss, rows, tz);
}

/** Menu wrapper — open the tab (or toast if it does not exist yet). */
function mlbActivateProjectStatusTab_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(MLB_PROJECT_STATUS_TAB);
  if (sh) sh.activate();
  else ss.toast('Run any pipeline window (or "Refresh Project Status") to create ' + MLB_PROJECT_STATUS_TAB, 'MLB-BOIZ', 5);
}

/** Compute the auto-derived fields for one manifest entry. */
function mlbProjectStatusComputeRow_(ss, entry, tz) {
  const mainSh = entry.mainTab ? ss.getSheetByName(entry.mainTab) : null;
  const mainRows = mainSh ? Math.max(0, mainSh.getLastRow() - 3) : null;

  let logRows = null;
  let lastSnapshot = null;
  let gradedCount = null;
  let lastGraded = null;

  if (entry.logTab) {
    const logSh = ss.getSheetByName(entry.logTab);
    if (logSh && logSh.getLastRow() >= 4) {
      const ncol = Math.max(1, logSh.getLastColumn());
      const headers = logSh.getRange(3, 1, 1, ncol).getValues()[0].map(function (h) {
        return String(h || '').trim().toLowerCase();
      });
      const slateIdx = mlbProjectStatusFindHeaderIdx_(headers, ['slate', 'slate_date', 'date']);
      const loggedAtIdx = mlbProjectStatusFindHeaderIdx_(headers, ['logged at', 'logged_at', 'timestamp']);
      const resultIdx = mlbProjectStatusFindHeaderIdx_(headers, ['result', 'graded', 'outcome', 'win/loss', 'win_loss']);

      const last = logSh.getLastRow();
      const data = logSh.getRange(4, 1, last - 3, ncol).getValues();
      logRows = data.length;

      let snapMs = 0;
      let gradeCount = 0;
      let gradeMs = 0;
      for (let i = 0; i < data.length; i++) {
        const row = data[i];

        // Snapshot recency — prefer 'Logged At' (datetime); fallback to 'Slate' (yyyy-mm-dd).
        const tsCell = loggedAtIdx >= 0 ? row[loggedAtIdx] : slateIdx >= 0 ? row[slateIdx] : null;
        const tsMs = mlbProjectStatusParseDateMs_(tsCell);
        if (tsMs > snapMs) snapMs = tsMs;

        // Graded?
        if (resultIdx >= 0) {
          const r = String(row[resultIdx] || '').trim().toUpperCase();
          if (r && r !== 'PENDING' && r !== '-' && r !== 'N/A') {
            gradeCount++;
            const slateMs = slateIdx >= 0 ? mlbProjectStatusParseDateMs_(row[slateIdx]) : tsMs;
            if (slateMs > gradeMs) gradeMs = slateMs;
          }
        }
      }
      if (snapMs > 0) lastSnapshot = mlbProjectStatusFmtDate_(new Date(snapMs), tz);
      if (resultIdx >= 0) gradedCount = gradeCount;
      if (gradeMs > 0) lastGraded = mlbProjectStatusFmtDate_(new Date(gradeMs), tz);
    } else {
      logRows = 0;
    }
  }

  return {
    entry: entry,
    mainExists: !!mainSh,
    mainRows: mainRows,
    logExists: entry.logTab ? !!ss.getSheetByName(entry.logTab) : null,
    logRows: logRows,
    lastSnapshot: lastSnapshot,
    gradedCount: gradedCount,
    lastGraded: lastGraded,
  };
}

function mlbProjectStatusFindHeaderIdx_(headersLower, candidates) {
  for (let i = 0; i < candidates.length; i++) {
    const idx = headersLower.indexOf(candidates[i]);
    if (idx >= 0) return idx;
  }
  return -1;
}

function mlbProjectStatusParseDateMs_(cell) {
  if (cell == null || cell === '') return 0;
  if (cell instanceof Date) return cell.getTime();
  const s = String(cell).trim();
  if (!s) return 0;
  const ms = Date.parse(s);
  return isNaN(ms) ? 0 : ms;
}

function mlbProjectStatusFmtDate_(d, tz) {
  // If only the date part is meaningful (midnight), show date only.
  if (d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0) {
    return Utilities.formatDate(d, tz, 'yyyy-MM-dd');
  }
  return Utilities.formatDate(d, tz, 'yyyy-MM-dd HH:mm');
}

function mlbProjectStatusStageColor_(stage) {
  switch (String(stage || '').toLowerCase()) {
    case 'live':
      return '#C8E6C9'; // green
    case 'shadow':
      return '#FFF9C4'; // yellow
    case 'idea':
      return '#E3F2FD'; // light blue
    case 'retired':
      return '#ECEFF1'; // grey
    default:
      return '#FFFFFF';
  }
}

function mlbProjectStatusWriteTab_(ss, rows, tz) {
  const NCOL = MLB_PROJECT_STATUS_HEADERS.length;
  let sh = ss.getSheetByName(MLB_PROJECT_STATUS_TAB);
  if (sh) {
    sh.clearContents();
    sh.clearFormats();
  } else {
    sh = ss.insertSheet(MLB_PROJECT_STATUS_TAB);
  }
  sh.setTabColor('#0D47A1');

  // Row 1 — title bar with refresh timestamp baked in.
  const refreshed = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm');
  sh.getRange(1, 1, 1, NCOL)
    .merge()
    .setValue('📊 MLB-BOIZ PROJECT STATUS — last refreshed ' + refreshed)
    .setFontSize(11)
    .setFontWeight('bold')
    .setBackground('#0D47A1')
    .setFontColor('#FFFFFF')
    .setHorizontalAlignment('center');
  sh.setRowHeight(1, 32);

  // Row 3 — headers.
  sh.getRange(3, 1, 1, NCOL)
    .setValues([MLB_PROJECT_STATUS_HEADERS])
    .setFontWeight('bold')
    .setBackground('#1565C0')
    .setFontColor('#FFFFFF');
  sh.setFrozenRows(3);

  // Rows 4+ — data.
  const values = rows.map(function (r) {
    const e = r.entry;
    return [
      e.label,
      e.category,
      e.stage,
      e.modelVersion,
      e.mainTab + (r.mainExists ? '' : '  ❌ missing'),
      r.mainRows == null ? '' : r.mainRows,
      e.logTab ? e.logTab + (r.logExists ? '' : '  ❌ missing') : '—',
      r.logRows == null ? '' : r.logRows,
      r.lastSnapshot || '',
      r.gradedCount == null ? '' : r.gradedCount,
      r.lastGraded || '',
      e.notes || '',
    ];
  });
  if (values.length > 0) {
    sh.getRange(4, 1, values.length, NCOL).setValues(values);
    // Stage column color-coding.
    for (let i = 0; i < rows.length; i++) {
      sh.getRange(4 + i, 3).setBackground(mlbProjectStatusStageColor_(rows[i].entry.stage)).setFontWeight('bold');
      if (!rows[i].mainExists) sh.getRange(4 + i, 5).setBackground('#FFCDD2');
      if (rows[i].entry.logTab && !rows[i].logExists) sh.getRange(4 + i, 7).setBackground('#FFCDD2');
    }
  }

  // Column widths — Workstream | Cat | Stage | Model | Main | # | Log | # | Last snap | Graded | Last grade | Notes
  [200, 90, 80, 100, 260, 70, 260, 70, 130, 80, 110, 360].forEach(function (w, i) {
    sh.setColumnWidth(i + 1, w);
  });
}
