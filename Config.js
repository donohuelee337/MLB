// ============================================================
// ⚙️ CONFIG — MLB-BOIZ (AI-BOIZ philosophy, MLB data)
// ============================================================
// Secrets: set Script Properties ODDS_API_KEY (the-odds-api.com).
// Optional: STATSAPI_BASE in Script Properties (default https://statsapi.mlb.com/api/v1).
// ============================================================

const CONFIG_TAB_NAME = '⚙️ Config';

/** Incremented by scripts/clasp-deploy.ps1 on each Apps Script push (visible on ⚙️ Config). */
const MLB_APPS_SCRIPT_BUILD = 5;

function mlbAppsScriptBuild_() {
  return typeof MLB_APPS_SCRIPT_BUILD !== 'undefined' ? MLB_APPS_SCRIPT_BUILD : '';
}

function safeAlert_(title, message) {
  try {
    SpreadsheetApp.getUi().alert(title, message || title, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {
    Logger.log('ALERT [' + title + ']: ' + (message || ''));
    try {
      SpreadsheetApp.getActiveSpreadsheet().toast((title + ' — ' + (message || '').slice(0, 80)), 'Notice', 8);
    } catch (_) {}
  }
}

/** MLB team id → common abbreviation (30 teams). */
const MLB_TEAM_ABBREV = {
  108: 'LAA', 109: 'ARI', 110: 'BAL', 111: 'BOS', 112: 'CHC', 113: 'CIN', 114: 'CLE',
  115: 'COL', 116: 'DET', 117: 'HOU', 118: 'KC', 119: 'LAD', 120: 'WSN', 121: 'NYM',
  133: 'OAK', 134: 'PIT', 135: 'SD', 136: 'SEA', 137: 'SF', 138: 'STL', 139: 'TB',
  140: 'TEX', 141: 'TOR', 142: 'MIN', 143: 'PHI', 144: 'ATL', 145: 'CWS', 146: 'MIA',
  147: 'NYY', 158: 'MIL',
};

/** Common team-name → abbreviation map. Used when statsapi ships empty abbreviation. */
const MLB_TEAM_NAME_TO_ABBR = {
  'los angeles angels': 'LAA', 'arizona diamondbacks': 'ARI', 'baltimore orioles': 'BAL',
  'boston red sox': 'BOS', 'chicago cubs': 'CHC', 'cincinnati reds': 'CIN',
  'cleveland guardians': 'CLE', 'colorado rockies': 'COL', 'detroit tigers': 'DET',
  'houston astros': 'HOU', 'kansas city royals': 'KC', 'los angeles dodgers': 'LAD',
  'washington nationals': 'WSN', 'new york mets': 'NYM', 'athletics': 'OAK',
  'oakland athletics': 'OAK', 'pittsburgh pirates': 'PIT', 'san diego padres': 'SD',
  'seattle mariners': 'SEA', 'san francisco giants': 'SF', 'st. louis cardinals': 'STL',
  'tampa bay rays': 'TB', 'texas rangers': 'TEX', 'toronto blue jays': 'TOR',
  'minnesota twins': 'MIN', 'philadelphia phillies': 'PHI', 'atlanta braves': 'ATL',
  'chicago white sox': 'CWS', 'miami marlins': 'MIA', 'new york yankees': 'NYY',
  'milwaukee brewers': 'MIL',
};

function mlbAbbrFromTeamName_(name) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return '';
  return MLB_TEAM_NAME_TO_ABBR[n] || '';
}

/** Resolve canonical team abbr from a statsapi team object (splits / currentTeam). */
function mlbTeamAbbrFromStatsApiTeam_(team) {
  const t = team || {};
  let abbr = String(t.abbreviation || t.teamCode || '').trim().toUpperCase();
  if (abbr && typeof mlbCanonicalTeamAbbr_ === 'function') {
    abbr = mlbCanonicalTeamAbbr_(abbr);
  }
  if (!abbr && typeof mlbAbbrFromTeamName_ === 'function') {
    abbr = mlbAbbrFromTeamName_(t.name);
    if (abbr && typeof mlbCanonicalTeamAbbr_ === 'function') {
      abbr = mlbCanonicalTeamAbbr_(abbr);
    }
  }
  return abbr || '';
}

/** Map statsapi / schedule abbreviation variants → Config canonical abbr. */
const MLB_ABBR_ALIASES = {
  AZ: 'ARI',
  WSH: 'WSN',
  WAS: 'WSN',
  ATH: 'OAK',
  LV: 'OAK',
  LAA: 'LAA',
  LA: 'LAA',
};

function mlbCanonicalTeamAbbr_(abbr) {
  const a = String(abbr || '').trim().toUpperCase();
  if (!a) return '';
  if (Object.prototype.hasOwnProperty.call(MLB_ABBR_ALIASES, a)) {
    return MLB_ABBR_ALIASES[a];
  }
  return a;
}

/** @returns {number} MLB team id or NaN if abbreviation is unknown. */
function mlbTeamIdFromAbbr_(abbr) {
  const a = mlbCanonicalTeamAbbr_(abbr);
  if (!a) return NaN;
  for (const tid in MLB_TEAM_ABBREV) {
    if (!Object.prototype.hasOwnProperty.call(MLB_TEAM_ABBREV, tid)) continue;
    if (String(MLB_TEAM_ABBREV[tid]).toUpperCase() === a) return parseInt(tid, 10);
  }
  return NaN;
}

function buildConfigTab() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG_TAB_NAME);
  let prevSlate = '';
  try {
    const nr = ss.getRangeByName('CONFIG');
    if (nr) {
      nr.getValues().forEach(function (r) {
        if (String(r[0]).trim() === 'SLATE_DATE' && r[1]) prevSlate = String(r[1]).trim();
      });
    }
  } catch (e) {}
  const tz = Session.getScriptTimeZone();
  const defaultSlate =
    prevSlate && /^\d{4}-\d{2}-\d{2}$/.test(prevSlate)
      ? prevSlate
      : Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');

  if (!sheet) sheet = ss.insertSheet(CONFIG_TAB_NAME);
  sheet.clearContents().clearFormats();
  sheet.getRange(1, 1, 1, 3).merge()
    .setValue('⚙️ MLB-BOIZ — Configuration (no API keys in cells — use Script Properties)')
    .setBackground('#1b5e20').setFontColor('#ffffff').setFontWeight('bold');
  let row = 3;
  function row_(k, v, note) {
    sheet.getRange(row, 1).setValue(k).setFontWeight('bold');
    sheet.getRange(row, 2).setValue(v);
    sheet.getRange(row, 3).setValue(note || '');
    row++;
  }
  row_(
    'APPS_SCRIPT_BUILD',
    String(typeof MLB_APPS_SCRIPT_BUILD !== 'undefined' ? MLB_APPS_SCRIPT_BUILD : ''),
    'Deployed code build — auto-bumped by scripts/clasp-deploy.ps1 each clasp push. Re-run "0. Build Config tab" to refresh.'
  );
  row_('RUN_WINDOW', 'MORNING', 'MORNING | MIDDAY | FINAL');
  row_('SLATE_DATE', defaultSlate, 'yyyy-MM-dd in script TZ — use menu "tomorrow" or set manually');
  row_('ODDS_BOOK', 'fanduel', 'the-odds-api bookmaker key');
  row_('ODDS_REGION', 'us', 'regions param');
  row_('K9_BLEND_L7_WEIGHT', '0.35', '0..1 blend of L3 K/9 vs season K9 for 🎰 λ (needs L3_IP in queue). Practical scan ~0.2–0.5 around default 0.35; tune iteratively after several slates using Pipeline_Log and 🎰 bet card outcomes. If this key is missing, re-run menu "0. Build Config tab".');
  row_(
    'TB_BLEND_RECENT_WEIGHT',
    '0.35',
    '0..1 blend of last-7 games TB/game vs season TB/game for 🎲 Batter_TB_Card λ (same spirit as K9_BLEND). Tune after slates.'
  );
  row_('TB_V2_LEAGUE_TB_PER_9',  '2.65', 'League SP TB-allowed per 9 IP — denominator for opp_SP_TB_mult in 🧪 tb.v2-full shadow. Update at season start.');
  row_('TB_V2_LEAGUE_TB_PER_PA', '0.40', 'League batter TB per PA — fallback prior when vs-hand split sample is thin in 🧪 tb.v2-full shadow.');
  row_('MIN_EV_BET_CARD', '0.03', 'Min EV per $1 on 🃏 card; 0 = any positive EV (any edge). 0.03 gates thin-positive noise while keeping real edge plays. Tune from 💰 Profitability_Report. If this key is missing, re-run menu "0. Build Config tab".');
  row_('MIN_MODEL_PCT_BET_CARD', '0.60', 'Global default model P(Win) floor on 🃏 card. Per-market overrides below take precedence. Blank or 0 falls back to 0.60.');
  row_('MIN_MODEL_PCT_K',  '', 'Per-market model% floor for STRIKEOUTS plays. Blank = use MIN_MODEL_PCT_BET_CARD. Tune from 🎯 Bet_Card_Calibration (recommended_min_model_pct column).');
  row_('MIN_MODEL_PCT_TB', '', 'Per-market model% floor for TOTAL BASES plays. Blank = use MIN_MODEL_PCT_BET_CARD.');
  row_('MIN_MODEL_PCT_H',  '', 'Per-market model% floor for BATTER HITS plays. Blank = use MIN_MODEL_PCT_BET_CARD.');
  row_('MIN_EDGE_K',  '0', 'Min |projection − line| for STRIKEOUTS plays on 🃏 card. 0 = off. Tune from 🎯 Bet_Card_Calibration.');
  row_('MIN_EDGE_TB', '0', 'Min |projection − line| for TOTAL BASES plays on 🃏 card. 0 = off.');
  row_('MIN_EDGE_H',  '0', 'Min |projection − line| for BATTER HITS plays on 🃏 card. 0 = off.');
  row_('MIN_MODEL_PCT_K_OVER',  '0.60', 'Model P(Win) floor for K OVER plays on 🃏 card. Blank = use MIN_MODEL_PCT_K → MIN_MODEL_PCT_BET_CARD → 0.60. Data: K Over ≥0.60 shows +3.5pp edge (n=309 graded).');
  row_('MIN_MODEL_PCT_K_UNDER', '0.75', 'Model P(Win) floor for K UNDER plays on 🃏 card. Higher than Over floor — K Unders below 0.75 show -14% ROI (n≈378). Blank falls back to MIN_MODEL_PCT_K.');
  row_('MAX_ODDS_H', '-130', 'Max juice (American) for BATTER HITS plays on 🃏 card. H at -155 to -130 shows -34.4% ROI (n=178). 0 or blank = no cap. Example: -130 gates out -140, -155, -200 etc.');
  // --- Lineup PA-per-slot table (Phase 2A) ---
  row_('LINEUP_PA_SLOT_1', '4.4', 'Estimated PA/game for batting order slot 1. Used when lineup is confirmed; falls back to season PA/game when not. League avg 2024–2025.');
  row_('LINEUP_PA_SLOT_2', '4.3', 'Estimated PA/game for batting order slot 2.');
  row_('LINEUP_PA_SLOT_3', '4.1', 'Estimated PA/game for batting order slot 3.');
  row_('LINEUP_PA_SLOT_4', '4.0', 'Estimated PA/game for batting order slot 4.');
  row_('LINEUP_PA_SLOT_5', '3.9', 'Estimated PA/game for batting order slot 5.');
  row_('LINEUP_PA_SLOT_6', '3.7', 'Estimated PA/game for batting order slot 6.');
  row_('LINEUP_PA_SLOT_7', '3.6', 'Estimated PA/game for batting order slot 7.');
  row_('LINEUP_PA_SLOT_8', '3.4', 'Estimated PA/game for batting order slot 8.');
  row_('LINEUP_PA_SLOT_9', '3.2', 'Estimated PA/game for batting order slot 9.');
  // --- H calibration shrink (Phase 2B) ---
  row_('H_MODEL_P_SHRINK', '0.94', 'Multiplicative shrink on H P(win) before EV calculation. Closes empirical ~6pp calibration gap (model overestimates vs actual hit rate). 1.0 = off. Tune up toward 1.0 as lineup-hydration improves lambda accuracy. If this key is missing, re-run "0. Build Config tab".');
  // --- Sim anchor weights (⚡ tabs → 🃏) — tune via 🔬 Sim_Gate_Backtest ---
  row_('ANCHOR_WEIGHT_K', '0.35', '0..1 weight on model λ vs FD K line in ⚡ Sim_Pitcher_K (anchored Poisson). 0.35 = 65% line / 35% model. Tune with 🔬 Sim_Gate_Backtest on graded 📋 MLB_Results_Log.');
  row_('ANCHOR_WEIGHT_BATTER_HITS', '0.35', '0..1 weight on model λ vs FD H line in ⚡ Sim_Batter_Hits. Tune with 🔬 Sim_Gate_Backtest.');
  row_('BANKROLL', '500', 'Bankroll in $ for Kelly stake column on 🃏 card. Default $500 = max bet $7.50 ≈ 1.5% of roll. Edit to your actual roll as it grows.');
  row_('KELLY_FRACTION', '0.25', 'Fractional-Kelly multiplier (0..1). Default 0.25 = quarter-Kelly (conservative, survives model overconfidence). Full-Kelly (1) is aggressive.');
  row_('STAKE_TIER_1_USD', '2.50', '1u stake size in $. With $7.50 cap and 1:2:3 ladder → 1u/2u/3u = $2.50/$5/$7.50.');
  row_('STAKE_TIER_2_USD', '5.00', '2u stake size in $. Edit together with TIER_1 / TIER_3 as your cap grows.');
  row_('STAKE_TIER_3_USD', '7.50', '3u stake size in $ — your effective max bet. Raise as bankroll grows and your model proves +EV.');
  row_('STAKE_TIER_1_KELLY_PCT', '0.5', 'Kelly% of bankroll → 1u tier. Default 0.5%: if quarter-Kelly says risk ≥0.5% of roll, place 1u. Below this floor → no bet.');
  row_('STAKE_TIER_2_KELLY_PCT', '1.0', 'Kelly% of bankroll → 2u tier. Default 1.0%.');
  row_('STAKE_TIER_3_KELLY_PCT', '1.5', 'Kelly% of bankroll → 3u tier. Default 1.5%: any Kelly recommendation ≥1.5% of roll is a max-bet conviction play.');
  row_('LEGACY_UNIT_USD', '2.50', 'Flat $ assumed for pre-tier historical bets when running "Backfill historical stakes". Set to what you were actually averaging before the Kelly system.');
  row_('HP_UMP_LAMBDA_MULT', '1', 'Multiply 🎰 λ when hp_umpire listed (1=no change; try 1.02–1.05 cautiously)');
  row_('LHP_K_LAMBDA_MULT', '1', 'Extra λ mult when pitcher throws L (1=no change)');
  row_('RHP_K_LAMBDA_MULT', '1', 'Extra λ mult when pitcher throws R (1=no change)');
  row_('LEAGUE_PITCHING_K9', '8.2', 'Prior league SP K/9 for 🧪 k.v2 shadow regression — pitcher K9 ramps from this toward own K9 across 0→8 starts. Tune yearly.');
  row_('LEAGUE_HITTING_K_PA', '0.225', 'League prior SO/PA (all PA); fallback when vs-hand priors blank or when using season opp_k_pa only.');
  row_(
    'LEAGUE_HITTING_K_PA_VS_L',
    '0.226',
    'League SO/PA for hitters vs LHP (tune yearly). Used for OPP_K ratio when opp_k_pa_vs is present and starter throws L; else falls back to LEAGUE_HITTING_K_PA.'
  );
  row_(
    'LEAGUE_HITTING_K_PA_VS_R',
    '0.224',
    'League SO/PA for hitters vs RHP (tune yearly). Used when opp_k_pa_vs is present and starter throws R; else falls back to LEAGUE_HITTING_K_PA.'
  );
  row_('OPP_K_RATE_LAMBDA_STRENGTH', '0', '0 = off. Try 0.15–0.35: scales 🎰 λ from opponent team season K% vs LEAGUE_HITTING_K_PA (whiff-heavier lineups → higher λ). Tune with Pipeline_Log.');
  row_('ABS_K_LAMBDA_MULT', '1', 'reserved for future Savant/ABS team K environment; 1 = neutral until wired.');
  row_('SAVANT_INGEST_ENABLED', 'false', 'true | false — when true, pipeline probes SAVANT_ABS_CSV_URL (best-effort; see MLBSavantIngest.js)');
  row_(
    'SAVANT_ABS_CSV_URL',
    '',
    'Public CSV: columns team_id + abs_k_mult (or abbr + factor). Example row: 121,1.02 — loads per-team λ mult when SAVANT_INGEST_ENABLED is true.'
  );
  // HR promo tuning (📣 Batter_HR_Promo). Defaults match the in-code fallbacks
  // — edit here to tune from the sheet instead of changing source.
  row_('HR_PROMO_LINEUP_FALLBACK', 'roster', 'When boxscore lineup is missing: "roster" = score every batter w/ ≥HR_PROMO_MIN_PA & ≥1 HR; "skip" = drop the game and warn.');
  row_('HR_PROMO_MIN_PA', '30', 'Hard gate: exclude batters below this season PA from 📣 HR/GS promo (confirmed lineups too). Stops 1-HR-in-6-AB call-ups from topping the list.');
  row_('HR_PROMO_BLEND_L14_WEIGHT', '0.25', '0..1 blend of last-14-day HR/PA vs season HR/PA. Higher = more reactive to hot/cold streaks; lower = more season-anchored.');
  row_('HR_PROMO_SHRINK_MIN_PA', '50', 'Bayesian shrink min-PA toward season prior. Lower (~25) trusts small samples; higher (~100) needs full season before deviating.');
  row_(
    'OPP_SP_MIN_IP',
    '10',
    'Min season IP on opposing SP before opp_SP mult / HR9 / K9 adjustments apply (Hits/TB v2/v3, HR promo). Below this → neutral mult 1.0 — avoids April call-up traps.'
  );
  row_('HR_PROMO_PITCHER_MULT_MIN', '0.85', 'Floor for SP HR9/league_HR9 multiplier (caps the boost vs HR-prone pitchers).');
  row_('HR_PROMO_PITCHER_MULT_MAX', '1.15', 'Ceiling for SP HR9 multiplier.');
  row_('HR_PROMO_CALIB_MIN_ROWS', '500', 'Min graded rows before Platt calibration fits — until then p_calibrated == p_poisson.');
  row_('HR_PROMO_EXPECTED_PA_JSON', '', 'Optional: JSON array of 9 positive numbers — expected PA per lineup slot 1..9. Empty = built-in default [4.65, 4.55, ..., 3.6].');
  row_('PROMO_EXCLUDE_COLD', 'TRUE', 'When TRUE, drop COLD batters (L5 H/game ≤85% of season) from 🔥 Streak_Picks, 📣 HR promo, and 📣 GS promo lists entirely. Set FALSE to include slumping hitters.');
  // 🔥 Streak picks (FanDuel MLB The Streak) — Streak-only adjustments on top of h.v2-full P(≥1 hit).
  row_('STREAK_K9_LEAGUE', '8.5', 'League SP K/9 baseline for 🔥 Streak_Picks K-rate penalty. Update yearly. Pitchers above this are penalized; below get a small bonus.');
  row_('STREAK_K9_PENALTY_ALPHA', '0.15', 'Sensitivity of Streak K-rate penalty (0 = off). penalty_mult = 1 − α × (sp_k9 − league)/league, clamped 0.80–1.05. Higher α = trust K/9 more.');
  row_('STREAK_PICK_COUNT', '2', 'Number of daily 🔥 Streak picks marked is_pick=TRUE (FanDuel allows 2 active streaks).');
  row_('STREAK_PEN_LEAGUE_H9', '8.5', 'League bullpen H/9 baseline for 🔥 Streak_Picks bullpen leverage. Update yearly.');
  row_('STREAK_PEN_BETA', '0.20', 'Sensitivity of bullpen leverage (0 = off). pen_mult = 1 + pen_share × β × (pen_h9 − league)/league, clamped 0.95–1.05. pen_share = max(0, 1 − exp_sp_ip/9).');
  row_('STREAK_SP_IP_DEFAULT', '5.5', 'Fallback expected SP IP/start when the probable starter has no logged starts this season (early season / spot starter). Used only for bullpen leverage.');
  ss.getNamedRanges().forEach(function (nr) {
    if (nr.getName() === 'CONFIG') nr.remove();
  });
  const start = 3;
  const n = row - start;
  if (n > 0) ss.setNamedRange('CONFIG', sheet.getRange(start, 1, n, 2));
  SpreadsheetApp.flush();
}

function getConfig() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const map = {};
  try {
    const range = ss.getRangeByName('CONFIG');
    if (range) {
      range.getValues().forEach(function (r) {
        if (r[0]) map[String(r[0]).trim()] = r[1];
      });
    }
  } catch (e) {}
  return map;
}

function getOddsApiKey_() {
  const key = PropertiesService.getScriptProperties().getProperty('ODDS_API_KEY');
  if (key && String(key).trim()) return String(key).trim();
  safeAlert_('Missing ODDS_API_KEY', 'Project Settings → Script properties → Add ODDS_API_KEY (the-odds-api.com).');
  return '';
}

function getSlateDateString_(cfg) {
  const tz = Session.getScriptTimeZone();
  const fromCfg = cfg && cfg['SLATE_DATE'] ? String(cfg['SLATE_DATE']).trim() : '';
  if (fromCfg && /^\d{4}-\d{2}-\d{2}$/.test(fromCfg)) return fromCfg;
  return Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
}

/** Soft validation for tuning keys — logs pipeline warnings only (does not block). */
function validateMlbPipelineConfig_(cfg) {
  if (!pipelineLog_) return;
  const c = cfg || {};
  function warnRange(label, raw, lo, hi) {
    const x = parseFloat(String(raw != null ? raw : '').trim(), 10);
    if (isNaN(x)) return;
    if (x < lo || x > hi) {
      addPipelineWarning_('⚙️ ' + label + '=' + x + ' (expected ' + lo + '..' + hi + ')');
    }
  }
  warnRange('K9_BLEND_L7_WEIGHT', c['K9_BLEND_L7_WEIGHT'], 0, 1);
  warnRange('TB_BLEND_RECENT_WEIGHT', c['TB_BLEND_RECENT_WEIGHT'], 0, 1);
  warnRange('TB_V2_LEAGUE_TB_PER_9',  c['TB_V2_LEAGUE_TB_PER_9'],  1.5, 4.0);
  warnRange('TB_V2_LEAGUE_TB_PER_PA', c['TB_V2_LEAGUE_TB_PER_PA'], 0.30, 0.55);
  warnRange('MIN_EV_BET_CARD', c['MIN_EV_BET_CARD'], 0, 0.5);
  warnRange('MIN_MODEL_PCT_K_OVER',  c['MIN_MODEL_PCT_K_OVER'],  0.50, 0.90);
  warnRange('MIN_MODEL_PCT_K_UNDER', c['MIN_MODEL_PCT_K_UNDER'], 0.50, 0.95);
  warnRange('MAX_ODDS_H', c['MAX_ODDS_H'], -300, 0);
  warnRange('ANCHOR_WEIGHT_K', c['ANCHOR_WEIGHT_K'], 0, 1);
  warnRange('ANCHOR_WEIGHT_BATTER_HITS', c['ANCHOR_WEIGHT_BATTER_HITS'], 0, 1);
  warnRange('H_MODEL_P_SHRINK', c['H_MODEL_P_SHRINK'], 0.85, 1.0);
  warnRange('OPP_K_RATE_LAMBDA_STRENGTH', c['OPP_K_RATE_LAMBDA_STRENGTH'], 0, 1);
  warnRange('HP_UMP_LAMBDA_MULT', c['HP_UMP_LAMBDA_MULT'], 0.85, 1.15);
  warnRange('LHP_K_LAMBDA_MULT', c['LHP_K_LAMBDA_MULT'], 0.92, 1.12);
  warnRange('RHP_K_LAMBDA_MULT', c['RHP_K_LAMBDA_MULT'], 0.92, 1.12);
  warnRange('HR_PROMO_MIN_PA', c['HR_PROMO_MIN_PA'], 1, 200);
  warnRange('HR_PROMO_SHRINK_MIN_PA', c['HR_PROMO_SHRINK_MIN_PA'], 1, 200);
  warnRange('HR_PROMO_BLEND_L14_WEIGHT', c['HR_PROMO_BLEND_L14_WEIGHT'], 0, 1);
}

function setConfigValue_(key, value) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  try {
    const range = ss.getRangeByName('CONFIG');
    if (!range) {
      buildConfigTab();
    }
    const r2 = ss.getRangeByName('CONFIG');
    if (!r2) return;
    const vals = r2.getValues();
    for (let i = 0; i < vals.length; i++) {
      if (String(vals[i][0]).trim() === key) {
        r2.getCell(i + 1, 2).setValue(value);
        SpreadsheetApp.flush();
        return;
      }
    }
  } catch (e) {}
}
