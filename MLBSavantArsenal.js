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
// SHADOW ONLY this build: scores feed the 🎯 Hit Machine ranking/audit
// columns. Nothing on the live 🃏 card reads them.
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

var __mlbArsenalPMap = null; // pid → [{pt, usage, whiff, rv100, n}]
var __mlbArsenalBMap = null; // bid → {pt: {rv100, whiff, n}}

function mlbResetArsenalCaches_() {
  __mlbArsenalPMap = null;
  __mlbArsenalBMap = null;
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
  const res = mlbSavantFetchCsvText_(url);
  if (!res.ok) {
    Logger.log('Arsenal ingest (' + type + '): HTTP ' + res.code);
    return 0;
  }
  const lines = mlbSavantCsvLines_(res.text);
  if (lines.length < 2) return 0;
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
  if (!out.length) return 0;

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
    return { p: p, b: b };
  } catch (e) {
    Logger.log('mlbArsenalIngestBestEffort_: ' + (e.message || e));
    return { p: 0, b: 0 };
  }
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
 * Batter-vs-arsenal matchup score.
 * rv:    usage-weighted batter run value per 100 pitches vs this SP's mix,
 *        shrunk toward 0 (league avg RV is 0 by construction). + = batter edge.
 * whiff: usage-weighted batter whiff% vs the mix, shrunk toward league 24.5.
 * cover: fraction of the SP's usage the batter has data for (low cover =
 *        score is mostly prior — treat as weak signal).
 * Returns nulls when either side is missing from the tables.
 */
function mlbArsenalMatchupScore_(spId, batterId) {
  const pMap = mlbArsenalPitcherMap_();
  const bMap = mlbArsenalBatterMap_();
  const arsenal = pMap[String(parseInt(spId, 10) || 0)];
  const bat = bMap[String(parseInt(batterId, 10) || 0)];
  if (!arsenal || !arsenal.length || !bat) return { rv: null, whiff: null, cover: null };
  let rvSum = 0;
  let whiffSum = 0;
  let usageSum = 0;
  let coverSum = 0;
  arsenal.forEach(function (p) {
    if (!p.usage || p.usage <= 0) return;
    usageSum += p.usage;
    const b = bat[p.pt];
    const n = b ? b.n : 0;
    const w = n / (n + MLB_ARSENAL_SHRINK_PA); // shrink weight toward league
    const rvB = b && isFinite(b.rv100) ? b.rv100 : 0;
    const whB = b && isFinite(b.whiff) ? b.whiff : MLB_ARSENAL_LEAGUE_WHIFF;
    rvSum += p.usage * (w * rvB);
    whiffSum += p.usage * (w * whB + (1 - w) * MLB_ARSENAL_LEAGUE_WHIFF);
    if (b) coverSum += p.usage * w;
  });
  if (usageSum <= 0) return { rv: null, whiff: null, cover: null };
  return {
    rv: Math.round((rvSum / usageSum) * 100) / 100,
    whiff: Math.round((whiffSum / usageSum) * 10) / 10,
    cover: Math.round((coverSum / usageSum) * 100) / 100,
  };
}
