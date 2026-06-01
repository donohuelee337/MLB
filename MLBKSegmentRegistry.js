// ============================================================
// K segment registry — OOS-proven buckets for live K picks
// ============================================================
// Pick shape: { side, pCal, odds, tags (array), gamePk, passRow, row }
// Depends: MLBWalkForwardKBacktest.js (report tab), Config.js
// ============================================================

const MLB_K_SEGMENT_REGISTRY_TAB = '🎯 K_Segment_Registry';

const MLB_K_SEGMENT_HEADERS = [
  'segment_id',
  'enabled',
  'side',
  'p_win_lo',
  'p_win_hi',
  'odds_lo',
  'odds_hi',
  'matchup_tag',
  'min_n_oos',
  'oos_roi',
  'notes',
];

function mlbEnsureKSegmentRegistrySheet_(ss) {
  let sh = ss.getSheetByName(MLB_K_SEGMENT_REGISTRY_TAB);
  if (!sh) sh = ss.insertSheet(MLB_K_SEGMENT_REGISTRY_TAB);
  if (sh.getLastRow() < 1) {
    sh.getRange(1, 1, 1, MLB_K_SEGMENT_HEADERS.length)
      .setValues([MLB_K_SEGMENT_HEADERS])
      .setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.setTabColor('#4527a0');
  }
  return sh;
}

function mlbLoadKSegmentRegistry_(ss) {
  const sh = ss.getSheetByName(MLB_K_SEGMENT_REGISTRY_TAB);
  if (!sh || sh.getLastRow() < 2) return [];
  const data = sh.getRange(2, 1, sh.getLastRow() - 1, MLB_K_SEGMENT_HEADERS.length).getValues();
  return data
    .map(function (r) {
      return {
        id: String(r[0]),
        enabled: String(r[1]).toUpperCase() === 'Y',
        side: String(r[2]),
        pLo: parseFloat(r[3]),
        pHi: parseFloat(r[4]),
        oddsLo: parseFloat(r[5]),
        oddsHi: parseFloat(r[6]),
        tag: String(r[7] || ''),
        minN: parseInt(r[8], 10) || 0,
        oosRoi: parseFloat(r[9]) || 0,
        notes: String(r[10] || ''),
      };
    })
    .filter(function (s) {
      return s.id;
    });
}

function mlbMatchKSegment_(seg, pick) {
  if (!seg.enabled) return false;
  if (seg.side !== pick.side) return false;
  if (pick.pCal < seg.pLo || pick.pCal >= seg.pHi) return false;
  if (pick.odds < seg.oddsLo || pick.odds > seg.oddsHi) return false;
  if (seg.tag && pick.tags.indexOf(seg.tag) === -1) return false;
  return true;
}

function mlbRankKSegmentPicks_(picks, registry) {
  return picks
    .map(function (p) {
      let best = null;
      (registry || []).forEach(function (seg) {
        if (!mlbMatchKSegment_(seg, p)) return;
        const conf = seg.oosRoi * Math.min(1, (seg.minN || 1) / 100);
        if (!best || conf > best.conf) best = { seg: seg, conf: conf };
      });
      return Object.assign({}, p, { segment: best });
    })
    .filter(function (p) {
      return p.segment;
    })
    .sort(function (a, b) {
      return b.segment.conf - a.segment.conf;
    });
}

function mlbSeedKSegmentsFromReport_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = mlbEnsureKSegmentRegistrySheet_(ss);
  const seeds = [
    [
      'K_OVER_62_68',
      'N',
      'Over',
      0.62,
      0.68,
      -160,
      100,
      '',
      40,
      0.03,
      'Enable after report confirms n≥40 and roi≥0.03',
    ],
    [
      'K_UNDER_78_PLUS',
      'N',
      'Under',
      0.78,
      1.01,
      -160,
      200,
      '',
      40,
      0.03,
      'Enable after report confirms',
    ],
  ];
  sh.getRange(2, 1, seeds.length, seeds[0].length).setValues(seeds);
  ss.toast('Segment registry seeded (disabled)', 'MLB-BOIZ', 5);
}

function mlbActivateKSegmentRegistryTab_(ss) {
  const book = ss || SpreadsheetApp.getActiveSpreadsheet();
  const sh = book.getSheetByName(MLB_K_SEGMENT_REGISTRY_TAB);
  if (sh) sh.activate();
  else mlbEnsureKSegmentRegistrySheet_(book).activate();
}
