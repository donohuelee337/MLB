// ============================================================
// 🔬 Hits feature ablation — backtest every multiplier subset
// ============================================================
// Reads 🧪 MLB_Results_Log_v2 (which records base_lambda + 4 ablation
// multipliers per graded play). For each of 2^4 = 16 feature subsets,
// recomputes the model's preferred side via Poisson at the actual line,
// scores against the recorded actual hit count, and ranks subsets by
// historical hit %. No new model runs — pure replay over logged data.
//
// Features:
//   bit 0 → park_mult     (park hit factor)
//   bit 1 → opp_sp_mult   (opposing starter H/9 vs league)
//   bit 2 → hand_mult     (batter H/PA vs pitcher hand)
//   bit 3 → ab_mult       (est PA ÷ season PA/G)
// ============================================================

const MLB_HITS_ABLATION_TAB = '🔬 Hits_Feature_Ablation';

function refreshHitsFeatureAblation() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const v2 = mlbHitsCompareReadV2Rows_(ss);

  const graded = v2.filter(function (r) {
    const res = String(r.result || '').toUpperCase();
    const base = parseFloat(String(r.baseLam));
    const actual = parseFloat(String(r.actualH));
    const line = parseFloat(String(r.line));
    return (res === 'WIN' || res === 'LOSS' || res === 'PUSH') &&
           !isNaN(base) && base > 0 &&
           !isNaN(actual) && !isNaN(line);
  });

  if (graded.length === 0) {
    safeAlert_('Hits Feature Ablation', 'No graded v2 rows yet — let the v2 shadow accumulate, then re-run.');
    return;
  }

  const featNames = ['park', 'opp', 'hand', 'ab'];
  function featMult(r, idx) {
    let m = NaN;
    if (idx === 0) m = parseFloat(String(r.parkMult));
    if (idx === 1) m = parseFloat(String(r.oppMult));
    if (idx === 2) m = parseFloat(String(r.handMult));
    if (idx === 3) m = parseFloat(String(r.abMult));
    return isNaN(m) || m <= 0 ? 1 : m;
  }
  function maskLabel(mask) {
    if (mask === 0)  return 'baseline (no features)';
    if (mask === 15) return 'full v2 (all features)';
    const parts = [];
    for (let i = 0; i < 4; i++) if (mask & (1 << i)) parts.push(featNames[i]);
    return parts.join(' + ');
  }

  // For each subset, replay every graded play.
  const results = [];
  for (let mask = 0; mask < 16; mask++) {
    let w = 0, l = 0, p = 0;
    graded.forEach(function (r) {
      const base = parseFloat(String(r.baseLam));
      const line = parseFloat(String(r.line));
      const actual = parseFloat(String(r.actualH));
      let lam = base;
      for (let i = 0; i < 4; i++) if (mask & (1 << i)) lam *= featMult(r, i);
      const probs = mlbProbOverUnderK_(line, lam);
      const pOver = parseFloat(String(probs.pOver));
      const pUnder = parseFloat(String(probs.pUnder));
      if (isNaN(pOver) || isNaN(pUnder)) return;
      const wantOver = pOver >= pUnder;
      // Push if exactly on the line (rare with half-lines, but guard anyway).
      if (actual === line)              { p++; return; }
      if (wantOver && actual > line)    { w++; return; }
      if (!wantOver && actual < line)   { w++; return; }
      l++;
    });
    const n = w + l;
    results.push({
      mask: mask,
      label: maskLabel(mask),
      n: n,
      w: w,
      l: l,
      p: p,
      pct: n > 0 ? w / n : 0,
    });
  }

  const baselinePct = results.filter(function (r) { return r.mask === 0; })[0].pct;

  // Sort by hit rate desc; samples as tiebreak.
  results.sort(function (a, b) {
    if (b.pct !== a.pct) return b.pct - a.pct;
    return b.n - a.n;
  });

  // ---- write tab ---------------------------------------------------------
  let sh = ss.getSheetByName(MLB_HITS_ABLATION_TAB);
  if (sh) { sh.clearContents(); sh.clearFormats(); }
  else    { sh = ss.insertSheet(MLB_HITS_ABLATION_TAB); }
  sh.setTabColor('#6a1b9a');

  sh.getRange(1, 1, 1, 6)
    .merge()
    .setValue('🔬 Hits feature-ablation backtest — hit % per multiplier subset · ' + graded.length + ' graded plays')
    .setFontFamily('Inter').setFontSize(11).setFontWeight('bold')
    .setBackground('#000000').setFontColor('#ffffff')
    .setHorizontalAlignment('center');
  sh.setRowHeight(1, 28);

  sh.getRange(3, 1, 1, 6)
    .setValues([['Rank', 'Features included', 'N', 'W-L-P', 'Hit %', 'vs baseline']])
    .setFontFamily('Inter').setFontWeight('bold')
    .setBackground('#000000').setFontColor('#ffffff')
    .setHorizontalAlignment('center');
  sh.setFrozenRows(3);

  const out = results.map(function (r, idx) {
    return [idx + 1, r.label, r.n, r.w + '-' + r.l + (r.p ? '-' + r.p : ''), r.pct, r.pct - baselinePct];
  });
  sh.getRange(4, 1, out.length, 6).setValues(out).setFontFamily('Inter');
  sh.getRange(4, 5, out.length, 1).setNumberFormat('0.0%').setHorizontalAlignment('center');
  sh.getRange(4, 6, out.length, 1).setNumberFormat('+0.0%;-0.0%').setHorizontalAlignment('center');
  sh.getRange(4, 1, out.length, 1).setHorizontalAlignment('center');
  sh.getRange(4, 3, out.length, 1).setHorizontalAlignment('center');
  sh.getRange(4, 4, out.length, 1).setHorizontalAlignment('center');

  // Heat-map the Hit % cell using the shared palette.
  for (let i = 0; i < out.length; i++) {
    const pct = out[i][4];
    if (typeof _bcHeat_ === 'function') {
      const heat = _bcHeat_(pct);
      sh.getRange(4 + i, 5).setBackground(heat.bg).setFontColor(heat.fg);
    }
    // Green/red shade for vs-baseline delta
    const delta = out[i][5];
    if (delta > 0.005) sh.getRange(4 + i, 6).setBackground('#15803d').setFontColor('#ffffff');
    else if (delta < -0.005) sh.getRange(4 + i, 6).setBackground('#991b1b').setFontColor('#ffffff');
  }

  sh.setColumnWidth(1, 60);
  sh.setColumnWidth(2, 260);
  sh.setColumnWidth(3, 70);
  sh.setColumnWidth(4, 100);
  sh.setColumnWidth(5, 90);
  sh.setColumnWidth(6, 110);

  ss.toast('Ablation: ' + graded.length + ' plays · 16 subsets ranked', 'Hits v2', 6);
}

function mlbActivateHitsAblationTab_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(MLB_HITS_ABLATION_TAB);
  if (sh) sh.activate();
}
