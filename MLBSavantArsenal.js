// ============================================================
// 📊 Savant arsenal — pitch-type matchup engine (Rung 1)
// ============================================================
// Two Savant "pitch arsenal stats" CSVs (pitcher view + batter view) →
// per-pitch usage/whiff/run-value tables → a batter-vs-pitcher matchup
// score: Σ over the SP's arsenal of usage% × the batter's run value per
// 100 pitches vs that pitch type (whiff version for K work). Each pitch
// term is shrunk toward league average by the batter's sample vs that
// pitch (pa/(pa+SHRINK)) — heat-map logic at a grain with real n.
//
// QUALITY GATE (build 59, SHADOW): the raw score treats the SP as a
// delivery vehicle (how OFTEN he throws pitch T) and ignores how GOOD his
// T is. A hitter's RV vs a pitch TYPE is a quality-weighted average over
// the pitches he has actually seen — overwhelmingly ordinary stuff. So
// "+3.9 RV/100 vs four-seamers" means "vs the MEDIAN four-seamer," and is
// out of sample against a top-percentile one (the Goldschmidt-vs-Tolle
// trap). The gate ranks each SP pitch within its own type league-wide
// (from the pitcher map we already ingest) and scales the batter's term:
//   scale = clamp(1 − K·z),  z = (qualityPctile − 0.5)·2 ∈ [−1,+1]
//   elite pitch (z→+1): edge regresses toward 0 (K=1) or negative (K>1)
//   weak  pitch (z→−1): edge AMPLIFIES — the green-light "feast" case
// rvGated + a plain-English whyNote are returned ALONGSIDE the raw rv.
// Nothing here moves λ yet: rvGated is shadow, graded vs raw rv in the
// 🎯 why column / results log before promotion (same discipline as v3).
//
// Fetch policy matches MLBSavantIngest: two CSV fetches per run, muted,
// best-effort; ARSENAL_*_CSV_URL config overrides the built-in URLs
// (paste an exported CSV URL if Savant ever blocks direct fetches).
// ============================================================

const MLB_ARSENAL_P_TAB = '📊 Savant_Arsenal_P';
const MLB_ARSENAL_B_TAB = '📊 Savant_Arsenal_B';
const MLB_ARSENAL_NCOL = 6;
const MLB_ARSENAL_LEAGUE_WHIFF = 24.5; // league whiff% baseline for shrinkage
const MLB_ARSENAL_SHRINK_PA = 50;      // batter pitches-seen shrink constant
const MLB_ARSENAL_QGATE_REF_MIN_N = 50; // min pitches for an SP pitch to count in the league ref dist

// Pitch-type code → readable name (for the why blurb).
const MLB_PITCH_NAME = {
  FF: '4-seam', FA: 'fastball', SI: 'sinker', FT: '2-seam', FC: 'cutter',
  SL: 'slider', ST: 'sweeper', SV: 'slurve', CU: 'curve', KC: 'knuckle-curve',
  CS: 'slow curve', CH: 'change', FS: 'splitter', FO: 'forkball', SC: 'screwball',
  EP: 'eephus', KN: 'knuckleball',
};
function mlbPitchName_(pt) {
  return MLB_PITCH_NAME[String(pt || '').toUpperCase()] || (pt || 'pitch');
}

/** Ordinal suffix for a whole number: 82 → "82nd", 11 → "11th". */
function mlbOrd_(n) {
  n = Math.round(n);
  const v = n % 100;
  const s = (v >= 11 && v <= 13) ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] || 'th');
  return n + s;
}

var __mlbArsenalPMap = null; // pid → [{pt, usage, whiff, rv100, n}]
var __mlbArsenalBMap = null; // bid → {pt: {rv100, whiff, n}}
var __mlbArsenalQRef = null; // pt → {rv:[sorted], whiff:[sorted]} league ref dist
var __mlbArsenalQCfg = null; // cached quality-gate config
var __mlbArsenalDiag = { pitcher: null, batter: null }; // last-fetch diagnostics

function mlbResetArsenalCaches_() {
  __mlbArsenalPMap = null;
  __mlbArsenalBMap = null;
  __mlbArsenalQRef = null;
  __mlbArsenalQCfg = null;
}

function mlbArsenalDefaultUrl_(type, season) {
  return (
    'https://baseballsavant.mlb.com/leaderboard/pitch-arsenal-stats?type=' +
    type + '&year=' + season + '&min=5&csv=true'
  );
}

/** Fetch + write one arsenal tab. Returns row count (0 on any failure). */
function mlbArsenalIngestOne_(ss, cfg, type, tabName, urlKey) {
  const season = typeof mlbSlateSeasonYear_ === 'function'
    ? mlbSlateSeasonYear_()
    : new Date().getFullYear();
  const urlCfg = String(cfg[urlKey] != null ? cfg[urlKey] : '').trim();
  const url = urlCfg || mlbArsenalDefaultUrl_(type, season);
  const src = urlCfg ? 'override URL' : 'live Savant CSV';
  const setDiag = function (rows, code, reason) {
    __mlbArsenalDiag[type] = { rows: rows, code: code, reason: reason, src: src };
  };
  const res = mlbSavantFetchCsvText_(url);
  if (!res.ok) {
    Logger.log('Arsenal ingest (' + type + '): HTTP ' + res.code + ' (' + src + ')');
    setDiag(0, res.code, 'fetch blocked/failed — HTTP ' + res.code);
    return 0;
  }
  const lines = mlbSavantCsvLines_(res.text);
  if (lines.length < 2) { setDiag(0, res.code, 'empty/short CSV'); return 0; }
  const head = mlbSavantHeadNorm_(mlbCsvSplitRow_(lines[0]));
  const iId = mlbSavantColIdx_(head, ['player_id', 'pitcher_id', 'batter_id', 'mlbam_id']);
  const iName = mlbSavantColIdx_(head, ['player_name', 'name', 'last_name, first_name']);
  const iPt = mlbSavantColIdx_(head, ['pitch_type', 'pitch']);
  const iUsage = mlbSavantColIdx_(head, ['pitch_usage', 'usage', 'n_percent', 'usage_percent']);
  const iWhiff = mlbSavantColIdx_(head, ['whiff_percent', 'whiff_pct', 'whiffs_percent']);
  const iRv = mlbSavantColIdx_(head, ['run_value_per_100', 'rv_100', 'run_value_per100']);
  const iN = mlbSavantColIdx_(head, ['pitches', 'pa', 'n']);
  if (iId < 0 || iPt < 0 || iRv < 0) {
    Logger.log('Arsenal ingest (' + type + '): CSV missing player_id/pitch_type/run_value cols');
    setDiag(0, res.code, 'CSV columns not recognized (format changed?)');
    return 0;
  }
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const c = mlbCsvSplitRow_(lines[i]);
    const pid = parseInt(c[iId], 10);
    const pt = String(c[iPt] || '').trim();
    if (!pid || !pt) continue;
    out.push([
      pid,
      iName >= 0 ? String(c[iName] || '').trim() : '',
      pt,
      iUsage >= 0 ? parseFloat(c[iUsage]) : '',
      iWhiff >= 0 ? parseFloat(c[iWhiff]) : '',
      parseFloat(c[iRv]),
    ].map(function (v) { return v != null && v === v ? v : ''; }).concat([iN >= 0 ? (parseFloat(c[iN]) || '') : '']).slice(0, 7));
  }
  if (!out.length) { setDiag(0, res.code, 'no parseable rows'); return 0; }
  setDiag(out.length, res.code, 'ok');

  let sh = ss.getSheetByName(tabName);
  if (sh) {
    sh.clearContents();
  } else {
    sh = ss.insertSheet(tabName);
  }
  sh.setTabColor('#6a1b9a');
  sh.getRange(1, 1, 1, 7)
    .setValues([['player_id', 'player_name', 'pitch_type', 'usage_pct', 'whiff_pct', 'rv_per_100', 'n']])
    .setFontWeight('bold')
    .setBackground('#4a148c')
    .setFontColor('#ffffff');
  sh.getRange(2, 1, out.length, 7).setValues(out);
  sh.setFrozenRows(1);
  return out.length;
}

/** Best-effort double ingest; called from the pipeline (never throws). */
function mlbArsenalIngestBestEffort_() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const cfg = getConfig();
    if (String(cfg['ARSENAL_INGEST_ENABLED'] != null ? cfg['ARSENAL_INGEST_ENABLED'] : 'Y').toUpperCase() !== 'Y') {
      return { p: -1, b: -1 };
    }
    const p = mlbArsenalIngestOne_(ss, cfg, 'pitcher', MLB_ARSENAL_P_TAB, 'ARSENAL_P_CSV_URL');
    Utilities.sleep(400);
    const b = mlbArsenalIngestOne_(ss, cfg, 'batter', MLB_ARSENAL_B_TAB, 'ARSENAL_B_CSV_URL');
    mlbResetArsenalCaches_();
    return { p: p, b: b, diag: { pitcher: __mlbArsenalDiag.pitcher, batter: __mlbArsenalDiag.batter } };
  } catch (e) {
    Logger.log('mlbArsenalIngestBestEffort_: ' + (e.message || e));
    return { p: 0, b: 0 };
  }
}

/**
 * One-time setup: point the Statcast + arsenal CSV config keys at the
 * operator's published Drive CSVs (Path B), enable both ingests, then run
 * them and toast the row counts. File IDs are the savant_export.py outputs
 * in the shared Drive folder; replace the SAME files weekly to keep these
 * URLs stable. uc?export=download is read by UrlFetchApp (followRedirects),
 * no Drive scope / re-auth needed since the files are "anyone with link".
 */
function mlbApplySavantCsvSetup_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const base = 'https://drive.google.com/uc?export=download&id=';
  const ids = {
    pitcherProfile: '1DstWui1Ihlja7WccaP1pNqJZqgezh1k0',
    batterProfile: '1oVCCzjq5MzyUaUHk71kQsfb8pflCMl0K',
    arsenalPitcher: '14bOf0f0fVoKS6BjExK2uqxl_gtivf2u_',
    arsenalBatter: '1lOfvgxLHStownlpQIu1Hn0Rb-b1JpobC',
  };
  setConfigValue_('STATCAST_ENABLED', 'true');
  setConfigValue_('STATCAST_PITCHER_PROFILE_CSV_URL', base + ids.pitcherProfile);
  setConfigValue_('STATCAST_BATTER_PROFILE_CSV_URL', base + ids.batterProfile);
  setConfigValue_('ARSENAL_INGEST_ENABLED', 'Y');
  setConfigValue_('ARSENAL_P_CSV_URL', base + ids.arsenalPitcher);
  setConfigValue_('ARSENAL_B_CSV_URL', base + ids.arsenalBatter);
  SpreadsheetApp.flush();

  const parts = [];
  try {
    if (typeof mlbStatcastIngestProfilesBestEffort_ === 'function') {
      const s = mlbStatcastIngestProfilesBestEffort_(true); // force — menu run has no pipelineLog_
      parts.push('Statcast P=' + (s.pitchers || 0) + ' B=' + (s.batters || 0) + (s.skipped ? ' (skipped)' : ''));
    }
  } catch (e) { parts.push('Statcast ERR ' + (e.message || e)); }
  try {
    if (typeof mlbArsenalIngestBestEffort_ === 'function') {
      const a = mlbArsenalIngestBestEffort_();
      parts.push('Arsenal P=' + a.p + ' B=' + a.b);
    }
  } catch (e) { parts.push('Arsenal ERR ' + (e.message || e)); }
  const msg = 'Savant CSV setup: ' + parts.join(' · ');
  Logger.log(msg);
  try { ss.toast(msg + ' — open Game Cards to see EV/LA', '🔧 Savant CSV setup', 15); } catch (e) {}
}

/**
 * Menu: run the arsenal ingest once and report the result, so we can settle
 * Path A (live Savant CSV) vs Path B (hosted CSV override) in one click.
 */
function mlbTestArsenalFetch_() {
  const res = mlbArsenalIngestBestEffort_();
  const d = (res && res.diag) || {};
  function line(label, x) {
    if (!x) return label + ': n/a';
    return label + ': ' + x.rows + ' rows · HTTP ' + x.code + ' · ' + x.src + ' · ' + x.reason;
  }
  const full = 'Savant arsenal fetch test\n' + line('Pitcher', d.pitcher) + '\n' + line('Batter', d.batter) +
    '\n\nrows>0 = Path A works (logos/out-pitch can use it). HTTP 403/blocked or 0 rows = use Path B: ' +
    'download the arsenal CSV, publish it (Google Sheet → CSV, or Drive), set ARSENAL_P_CSV_URL / ARSENAL_B_CSV_URL.';
  Logger.log(full);
  const okP = d.pitcher && d.pitcher.rows > 0;
  const okB = d.batter && d.batter.rows > 0;
  const summary = (okP && okB)
    ? '✅ Path A works — P ' + d.pitcher.rows + ' / B ' + d.batter.rows + ' rows'
    : '⚠️ Path A blocked — P ' + (d.pitcher ? 'HTTP ' + d.pitcher.code : 'n/a') +
      ' / B ' + (d.batter ? 'HTTP ' + d.batter.code : 'n/a') + ' → use hosted CSV (see log)';
  try {
    SpreadsheetApp.getActiveSpreadsheet().toast(summary, '🧪 Arsenal fetch', 12);
  } catch (e) {}
}

function mlbArsenalReadTab_(tabName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(tabName);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 7).getValues();
}

function mlbArsenalPitcherMap_() {
  if (__mlbArsenalPMap !== null) return __mlbArsenalPMap;
  __mlbArsenalPMap = {};
  mlbArsenalReadTab_(MLB_ARSENAL_P_TAB).forEach(function (r) {
    const pid = String(parseInt(r[0], 10) || 0);
    if (pid === '0') return;
    if (!__mlbArsenalPMap[pid]) __mlbArsenalPMap[pid] = [];
    __mlbArsenalPMap[pid].push({
      pt: String(r[2] || ''),
      usage: parseFloat(r[3]) || 0,
      whiff: parseFloat(r[4]),
      rv100: parseFloat(r[5]),
      n: parseFloat(r[6]) || 0,
    });
  });
  return __mlbArsenalPMap;
}

function mlbArsenalBatterMap_() {
  if (__mlbArsenalBMap !== null) return __mlbArsenalBMap;
  __mlbArsenalBMap = {};
  mlbArsenalReadTab_(MLB_ARSENAL_B_TAB).forEach(function (r) {
    const bid = String(parseInt(r[0], 10) || 0);
    if (bid === '0') return;
    if (!__mlbArsenalBMap[bid]) __mlbArsenalBMap[bid] = {};
    __mlbArsenalBMap[bid][String(r[2] || '')] = {
      whiff: parseFloat(r[4]),
      rv100: parseFloat(r[5]),
      n: parseFloat(r[6]) || 0,
    };
  });
  return __mlbArsenalBMap;
}

/**
 * Quality-gate config (cached). All keys are optional — defaults make the
 * gate behave conservatively (elite stuff REGRESSES a hitter's type-edge
 * to ~0 at K=1; it does not punish unless K>1). Tune from the 🎯 why
 * column + results log before raising K or promoting rvGated into λ.
 */
function mlbArsenalQCfg_() {
  if (__mlbArsenalQCfg !== null) return __mlbArsenalQCfg;
  let c = {};
  try { c = (typeof getConfig === 'function') ? getConfig() : {}; } catch (e) { c = {}; }
  function num(k, d) { const v = parseFloat(String(c[k])); return isFinite(v) ? v : d; }
  __mlbArsenalQCfg = {
    enabled: String(c['ARSENAL_QGATE_ENABLED'] != null ? c['ARSENAL_QGATE_ENABLED'] : 'Y').toUpperCase() === 'Y',
    k:       num('ARSENAL_QGATE_K', 1.0),        // overall gate strength multiplier
    qscale:  num('ARSENAL_QGATE_QSCALE', 3.0),   // RV/100 swing across the full quality range (worst→best pitch of the type)
    wRv:     num('ARSENAL_QGATE_W_RV', 0.6),     // blend weight: pitch run-value percentile
    wWhiff:  num('ARSENAL_QGATE_W_WHIFF', 0.4),  // blend weight: pitch whiff percentile
    refMinN: num('ARSENAL_QGATE_REF_MIN_N', MLB_ARSENAL_QGATE_REF_MIN_N),
    alarmQ:  num('ARSENAL_QGATE_ALARM_Q', 0.70), // pitch-quality pctile that triggers an alarm/edge note
    strong:  num('ARSENAL_QGATE_STRONG_RV', 0.5), // |batter RV/100 vs type| to count as a real read
  };
  return __mlbArsenalQCfg;
}

/**
 * League reference distribution per pitch type, built from the pitcher map
 * we already ingest (every qualified SP's per-pitch row). One pass, cached.
 * Pitches under refMinN are excluded so a 6-pitch sample can't define the
 * league. Arrays are sorted so percentile lookups are a binary search.
 */
function mlbArsenalQRef_() {
  if (__mlbArsenalQRef !== null) return __mlbArsenalQRef;
  __mlbArsenalQRef = {};
  const cfg = mlbArsenalQCfg_();
  const pMap = mlbArsenalPitcherMap_();
  Object.keys(pMap).forEach(function (pid) {
    pMap[pid].forEach(function (p) {
      if (!p.pt || !(p.n >= cfg.refMinN)) return;
      if (!__mlbArsenalQRef[p.pt]) __mlbArsenalQRef[p.pt] = { rv: [], whiff: [] };
      if (isFinite(p.rv100)) __mlbArsenalQRef[p.pt].rv.push(p.rv100);
      if (isFinite(p.whiff)) __mlbArsenalQRef[p.pt].whiff.push(p.whiff);
    });
  });
  Object.keys(__mlbArsenalQRef).forEach(function (pt) {
    __mlbArsenalQRef[pt].rv.sort(function (a, b) { return a - b; });
    __mlbArsenalQRef[pt].whiff.sort(function (a, b) { return a - b; });
  });
  return __mlbArsenalQRef;
}

/** Percentile of v within a SORTED array: fraction of entries ≤ v (0..1). */
function mlbArsenalPctile_(sortedArr, v) {
  if (!sortedArr || !sortedArr.length || !isFinite(v)) return null;
  let lo = 0, hi = sortedArr.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sortedArr[mid] <= v) lo = mid + 1; else hi = mid; }
  return lo / sortedArr.length;
}

/**
 * Blended league quality percentile (0..1) for ONE of an SP's pitches.
 * Higher = nastier: high run-value-saved AND high whiff both push it up.
 * Returns null when the pitch type has no usable league reference.
 */
function mlbArsenalPitchQuality_(p) {
  const cfg = mlbArsenalQCfg_();
  const ref = mlbArsenalQRef_()[p.pt];
  if (!ref) return null;
  const qRv = mlbArsenalPctile_(ref.rv, p.rv100);    // higher rv100 = better pitch for the SP
  const qWh = mlbArsenalPctile_(ref.whiff, p.whiff); // higher whiff = more misses
  let acc = 0, wsum = 0;
  if (qRv != null) { acc += cfg.wRv * qRv; wsum += cfg.wRv; }
  if (qWh != null) { acc += cfg.wWhiff * qWh; wsum += cfg.wWhiff; }
  if (wsum <= 0) return null;
  return acc / wsum;
}

/**
 * Plain-English signal for the 🎯 why column from the single most decisive
 * pitch (where batter type-strength meets an extreme-quality SP pitch).
 * Fires three ways: 🚨 strong batter into an ELITE pitch (edge out of
 * sample — the Goldschmidt/Tolle trap), 🟢 strong batter into a WEAK,
 * high-usage pitch (real, repeatable edge), ⚠️ weak batter into an elite
 * pitch (stuff + matchup both against). Neutral → ''.
 */
function mlbArsenalWhyNote_(best, cfg) {
  if (!best || best.q == null) return '';
  const pctile = mlbOrd_(best.q * 100);
  const name = mlbPitchName_(best.pt);
  const usage = Math.round(best.usage);
  const rvB = Math.round(best.rvB * 10) / 10;
  const strong = best.rvB >= cfg.strong;
  const weakBat = best.rvB <= -cfg.strong;
  const elite = best.q >= cfg.alarmQ;
  const soft = best.q <= (1 - cfg.alarmQ);
  if (strong && elite) {
    return '🚨 ' + name + ' (' + usage + '% usage) grades ' + pctile + '-pctile league-wide — batter +' +
      rvB + ' RV/100 vs ' + name + ' is mostly off lesser stuff; edge likely out of sample';
  }
  if (strong && soft) {
    return '🟢 ' + name + ' (' + usage + '% usage) only ' + pctile + '-pctile quality — batter +' +
      rvB + ' RV/100 vs it; real, repeatable edge';
  }
  if (weakBat && elite) {
    return '⚠️ ' + name + ' (' + usage + '% usage) grades ' + pctile + '-pctile and batter is ' +
      rvB + ' RV/100 vs ' + name + ' — stuff and matchup both against';
  }
  return '';
}

/**
 * Batter-vs-arsenal matchup score.
 * rv:      usage-weighted batter run value per 100 pitches vs this SP's mix,
 *          shrunk toward 0 (league avg RV is 0 by construction). + = batter edge.
 * rvGated: rv after the pitch-QUALITY gate (shadow) — the batter's edge on
 *          each pitch is scaled by where that SP's pitch ranks in its type
 *          league-wide. Equals rv when the gate is disabled.
 * whiff:   usage-weighted batter whiff% vs the mix, shrunk toward league 24.5.
 * cover:   fraction of the SP's usage the batter has data for (low cover =
 *          score is mostly prior — treat as weak signal).
 * whyNote: plain-English alarm/edge string for the why column ('' = neutral).
 * Returns nulls when either side is missing from the tables.
 */
function mlbArsenalMatchupScore_(spId, batterId) {
  const pMap = mlbArsenalPitcherMap_();
  const bMap = mlbArsenalBatterMap_();
  const arsenal = pMap[String(parseInt(spId, 10) || 0)];
  const bat = bMap[String(parseInt(batterId, 10) || 0)];
  if (!arsenal || !arsenal.length || !bat) {
    return { rv: null, whiff: null, cover: null, rvGated: null, whyNote: '' };
  }
  const qcfg = mlbArsenalQCfg_();
  let rvSum = 0;
  let rvGatedSum = 0;
  let whiffSum = 0;
  let usageSum = 0;
  let coverSum = 0;
  let best = null; // most decisive gated pitch, for the why blurb
  arsenal.forEach(function (p) {
    if (!p.usage || p.usage <= 0) return;
    usageSum += p.usage;
    const b = bat[p.pt];
    const n = b ? b.n : 0;
    const w = n / (n + MLB_ARSENAL_SHRINK_PA); // shrink weight toward league
    const rvB = b && isFinite(b.rv100) ? b.rv100 : 0;
    const whB = b && isFinite(b.whiff) ? b.whiff : MLB_ARSENAL_LEAGUE_WHIFF;
    const term = w * rvB; // batter edge on this pitch, sample-shrunk
    rvSum += p.usage * term;
    whiffSum += p.usage * (w * whB + (1 - w) * MLB_ARSENAL_LEAGUE_WHIFF);
    if (b) coverSum += p.usage * w;

    // --- pitch-quality gate (shadow, additive & sign-safe) ---
    // Quality-adjusted batter rate vs THIS pitch = his vs-type rate minus the
    // pitch's quality premium (in RV/100). z>0 (elite specimen) drags it down,
    // z<0 (weak specimen) lifts it — correct whether his type-rate is + or −.
    // Shrunk by the same batter-sample weight w, so a pitch he has no read on
    // (w→0) gets no fabricated shift.
    let gTerm = term;
    let q = null;
    if (qcfg.enabled) {
      q = mlbArsenalPitchQuality_(p); // 0..1 league pctile of THIS pitch's quality
      if (q != null) {
        const z = (q - 0.5) * 2; // -1 worst … +1 elite specimen of the type
        gTerm = w * (rvB - qcfg.k * z * qcfg.qscale);
      }
    }
    rvGatedSum += p.usage * gTerm;

    // Most decisive pitch = largest swing the gate applied to a real read
    // (batter has data on this pitch). Surfaces both 🚨 traps and 🟢 edges.
    if (q != null && b) {
      const moved = Math.abs(p.usage * (term - gTerm));
      if (!best || moved > best.moved) {
        best = { pt: p.pt, usage: p.usage, q: q, rvB: rvB, moved: moved };
      }
    }
  });
  if (usageSum <= 0) return { rv: null, whiff: null, cover: null, rvGated: null, whyNote: '' };
  const rv = Math.round((rvSum / usageSum) * 100) / 100;
  const rvGated = qcfg.enabled ? Math.round((rvGatedSum / usageSum) * 100) / 100 : rv;
  return {
    rv: rv,
    whiff: Math.round((whiffSum / usageSum) * 10) / 10,
    cover: Math.round((coverSum / usageSum) * 100) / 100,
    rvGated: rvGated,
    whyNote: qcfg.enabled ? mlbArsenalWhyNote_(best, qcfg) : '',
  };
}
