// ============================================================
// 🔬 HR Promo feature-ablation backtest
// ============================================================
// Reads 📋 HR_Promo_Results_Log; replays each graded slate as if the
// HR model had used only a subset of multipliers, then scores top-K
// picks per slate per subset.
//
// Features (binary mask 0..7 = 8 subsets):
//   bit 0 → park_mult     (park HR factor)
//   bit 1 → pitcher_mult  (opposing SP HR/9 vs league)
//   bit 2 → weather_mult  (placeholder; currently always 1 — kept for
//                          future air-density / wind feature)
//
// Picking rule per subset:
//   1. Compute λ_subset = base_lambda × (selected multipliers)
//   2. Rank batters within each slate by λ_subset desc
//   3. Take top-K per slate (default 3; configurable via HR_PROMO_ABLATION_TOPK)
//   4. Score: HIT if any HR by that batter; MISS otherwise
//
// Output: 🔬 HR_Promo_Feature_Ablation tab, sorted by hit %.
// ============================================================

const MLB_HR_PROMO_ABLATION_TAB = '🔬 HR_Promo_Feature_Ablation';

function refreshHrPromoFeatureAblation() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logSh = ss.getSheetByName(MLB_HR_PROMO_RESULTS_LOG_TAB);
  if (!logSh || logSh.getLastRow() < 4) {
    safeAlert_('HR Promo Ablation', 'No HR promo log rows yet — let the snapshots accumulate.');
    return;
  }

  const cfg = getConfig();
  const topK = parseInt(String(cfg['HR_PROMO_ABLATION_TOPK'] != null ? cfg['HR_PROMO_ABLATION_TOPK'] : '3').trim(), 10) || 3;
  const tz = Session.getScriptTimeZone();
  const data = logSh.getRange(4, 1, logSh.getLastRow() - 3, MLB_HR_PROMO_RESULTS_LOG_NCOL).getValues();

  // Build graded picks indexed by slate
  const slates = {};
  data.forEach(function (row) {
    const result = String(row[19] || '').trim().toUpperCase();
    if (result !== 'HIT' && result !== 'MISS') return;
    const slateRaw = row[1];
    const slate = (slateRaw instanceof Date)
      ? Utilities.formatDate(slateRaw, tz, 'yyyy-MM-dd')
      : String(slateRaw || '').trim();
    if (!slate) return;
    const base = parseFloat(String(row[10]));
    if (isNaN(base) || base <= 0) return;
    if (!slates[slate]) slates[slate] = [];
    slates[slate].push({
      slate: slate,
      batter: String(row[3] || ''),
      gamePk: row[5],
      baseLambda: base,
      parkMult: parseFloat(String(row[14])) || 1,
      pitcherMult: parseFloat(String(row[15])) || 1,
      weatherMult: parseFloat(String(row[16])) || 1,
      hit: result === 'HIT' ? 1 : 0,
    });
  });

  const slateKeys = Object.keys(slates).sort();
  if (slateKeys.length === 0) {
    safeAlert_('HR Promo Ablation', 'No graded HR promo picks yet.');
    return;
  }

  const featNames = ['park', 'pitcher', 'weather'];
  function featMult(pick, idx) {
    if (idx === 0) return pick.parkMult;
    if (idx === 1) return pick.pitcherMult;
    if (idx === 2) return pick.weatherMult;
    return 1;
  }
  function maskLabel(mask) {
    if (mask === 0)  return 'baseline (no features)';
    if (mask === 7)  return 'full (all features)';
    const parts = [];
    for (let i = 0; i < 3; i++) if (mask & (1 << i)) parts.push(featNames[i]);
    return parts.join(' + ');
  }

  // Score each subset
  const results = [];
  for (let mask = 0; mask < 8; mask++) {
    let hits = 0;
    let picks = 0;
    slateKeys.forEach(function (slate) {
      const picksForSlate = slates[slate].slice();
      picksForSlate.forEach(function (p) {
        let lam = p.baseLambda;
        for (let i = 0; i < 3; i++) if (mask & (1 << i)) lam *= featMult(p, i);
        p._lam = lam;
      });
      picksForSlate.sort(function (a, b) { return b._lam - a._lam; });
      const top = picksForSlate.slice(0, topK);
      top.forEach(function (p) {
        hits += p.hit;
        picks++;
      });
    });
    results.push({
      mask: mask,
      label: maskLabel(mask),
      n: picks,
      hits: hits,
      miss: picks - hits,
      pct: picks > 0 ? hits / picks : 0,
    });
  }

  const baselinePct = results.filter(function (r) { return r.mask === 0; })[0].pct;
  results.sort(function (a, b) {
    if (b.pct !== a.pct) return b.pct - a.pct;
    return b.n - a.n;
  });

  // ---- write tab --------------------------------------------------------
  let sh = ss.getSheetByName(MLB_HR_PROMO_ABLATION_TAB);
  if (sh) { sh.clearContents(); sh.clearFormats(); }
  else    { sh = ss.insertSheet(MLB_HR_PROMO_ABLATION_TAB); }
  sh.setTabColor('#e65100');

  sh.getRange(1, 1, 1, 6)
    .merge()
    .setValue('🔬 HR promo feature-ablation — top-' + topK + ' picks/slate · ' + slateKeys.length + ' graded slates')
    .setFontFamily('Inter').setFontSize(11).setFontWeight('bold')
    .setBackground('#000000').setFontColor('#ffffff')
    .setHorizontalAlignment('center');
  sh.setRowHeight(1, 28);

  sh.getRange(3, 1, 1, 6)
    .setValues([['Rank', 'Features included', 'Picks', 'HIT-MISS', 'Hit %', 'vs baseline']])
    .setFontFamily('Inter').setFontWeight('bold')
    .setBackground('#000000').setFontColor('#ffffff')
    .setHorizontalAlignment('center');
  sh.setFrozenRows(3);

  const out = results.map(function (r, idx) {
    return [idx + 1, r.label, r.n, r.hits + '-' + r.miss, r.pct, r.pct - baselinePct];
  });
  sh.getRange(4, 1, out.length, 6).setValues(out).setFontFamily('Inter');
  sh.getRange(4, 5, out.length, 1).setNumberFormat('0.0%').setHorizontalAlignment('center');
  sh.getRange(4, 6, out.length, 1).setNumberFormat('+0.0%;-0.0%').setHorizontalAlignment('center');
  [1, 3, 4].forEach(function (c) { sh.getRange(4, c, out.length, 1).setHorizontalAlignment('center'); });

  for (let i = 0; i < out.length; i++) {
    if (typeof _bcHeat_ === 'function') {
      const heat = _bcHeat_(out[i][4]);
      sh.getRange(4 + i, 5).setBackground(heat.bg).setFontColor(heat.fg);
    }
    const delta = out[i][5];
    if (delta > 0.005)      sh.getRange(4 + i, 6).setBackground('#15803d').setFontColor('#ffffff');
    else if (delta < -0.005) sh.getRange(4 + i, 6).setBackground('#991b1b').setFontColor('#ffffff');
  }

  sh.setColumnWidth(1, 60);
  sh.setColumnWidth(2, 240);
  sh.setColumnWidth(3, 80);
  sh.setColumnWidth(4, 100);
  sh.setColumnWidth(5, 90);
  sh.setColumnWidth(6, 110);

  ss.toast('HR promo ablation: ' + slateKeys.length + ' slates · top-' + topK + ' per slate', 'MLB-BOIZ', 6);
}

function mlbActivateHrPromoAblationTab_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(MLB_HR_PROMO_ABLATION_TAB);
  if (sh) sh.activate();
}
