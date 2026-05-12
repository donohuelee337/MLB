// ============================================================
// ⚙️ CONFIG — MLB-BOIZ (AI-BOIZ philosophy, MLB data)
// ============================================================
// Secrets: set Script Properties ODDS_API_KEY (the-odds-api.com).
// Optional: STATSAPI_BASE in Script Properties (default https://statsapi.mlb.com/api/v1).
// ============================================================

const CONFIG_TAB_NAME = '⚙️ Config';

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

/** @returns {number} MLB team id or NaN if abbreviation is unknown. */
function mlbTeamIdFromAbbr_(abbr) {
  const a = String(abbr || '').trim().toUpperCase();
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
  const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const defaultSlate =
    prevSlate && /^\d{4}-\d{2}-\d{2}$/.test(prevSlate) && prevSlate >= today
      ? prevSlate
      : today;

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
  row_('RUN_WINDOW', 'MORNING', 'MORNING | MIDDAY | FINAL');
  row_('SLATE_DATE', defaultSlate, 'yyyy-MM-dd — slate for schedule + odds; auto can advance (see next row)');
  row_(
    'SLATE_AUTO_ADVANCE_WHEN_COMPLETE',
    'true',
    'true | false — when SLATE_DATE is today (America/New_York) and every MLB game that day is final/postponed/cancelled (or zero games), advance SLATE_DATE to tomorrow before fetch — prep next slate before midnight.'
  );
  row_('ODDS_BOOK', 'fanduel', 'the-odds-api bookmaker key');
  row_('ODDS_REGION', 'us', 'regions param (try us2 if FD player props sparse in ✅ tab)');
  row_('K9_BLEND_L7_WEIGHT', '0.35', '0..1 blend of L3 K/9 vs season K9 for 🎰 λ (needs L3_IP in queue)');
  row_('BB9_BLEND_L3_WEIGHT', '', 'Optional; blank = use K9_BLEND for 🎰 Pitcher BB λ (L3 BB9 vs season)');
  row_(
    'HR_PROMO_BLEND_L14_WEIGHT',
    '0.25',
    '0..1 — blend L14 HR/game-derived rate with season HR/PA for 📣 Batter_HR_Promo only.'
  );
  row_('HR_PROMO_PITCHER_MULT_MIN', '0.85', 'Clamp floor for opponent SP HR-environment λ multiplier.');
  row_('HR_PROMO_PITCHER_MULT_MAX', '1.15', 'Clamp ceiling for opponent SP HR-environment λ multiplier.');
  row_('LEAGUE_PITCHING_HR9', '1.15', 'League average HR/9 prior for SP mult (seasonal tune yearly).');
  row_('HR_PROMO_SHRINK_MIN_PA', '50', 'Minimum PA for full trust in HR/PA; below this, shrink toward LEAGUE_HITTING_HR_PER_PA.');
  row_('LEAGUE_HITTING_HR_PER_PA', '0.032', 'League HR/PA prior for batter shrinkage (tune yearly).');
  row_('HR_PROMO_CALIB_MIN_ROWS', '500', 'Minimum graded 📋 MLB_Results_Log rows with batter HR market before Platt calibration is applied.');
  row_('HR_PROMO_EXPECTED_PA_JSON', '', 'Optional: JSON array of 9 expected PA for batting orders 1..9; blank = built-in defaults.');
  row_(
    'HR_PROMO_LINEUP_FALLBACK',
    'roster',
    'roster | skip — when boxscore has no batting order: roster = include all team hitters from mlbFetchTeamHittingStats_ with low confidence; skip = omit those games batters.'
  );
  row_('HR_PROMO_WEATHER_ENABLED', 'false', 'Reserved: phase-1 code keeps weather mult at 1. When true + parks allowlisted, future version applies bounded wind/temp mult.');
  row_('HR_PROMO_WEATHER_PARKS', 'CHC,BOS', 'Comma abbrev list — only used when HR_PROMO_WEATHER_ENABLED is true (phase 2).');
  row_('MIN_EV_BET_CARD', '0', 'Min EV per $1 on 🃏 card; 0 = any positive EV; e.g. 0.03 for 3¢ floor');
  row_('MAX_ODDS_BET_CARD', '', 'Max American odds on 🃏 card; blank = no cap; e.g. 130 to exclude bets over +130');
  row_('MIN_ODDS_BET_CARD', '-250', 'Min American odds on 🃏 card (heavy-chalk floor); blank = no floor; e.g. -250 to exclude -260 and worse');
  row_('EST_AB_PER_GAME', '3.5', 'Estimated AB per game for 🎰 Batter Hits model (fallback when season AB/G unavailable)');
  row_('BANKROLL', '1000', 'Total bankroll in $ — used to size kelly_$ on the 🃏 card');
  row_('KELLY_FRACTION', '0.25', 'Fraction of full Kelly to wager (0.25 = quarter-Kelly; safer for sports)');
  row_('HP_UMP_LAMBDA_MULT', '1', 'Multiply 🎰 λ when hp_umpire listed (1=no change; try 1.02–1.05 cautiously)');
  row_('LHP_K_LAMBDA_MULT', '1', 'Extra λ mult when pitcher throws L (1=no change)');
  row_('RHP_K_LAMBDA_MULT', '1', 'Extra λ mult when pitcher throws R (1=no change)');
  row_('LHP_BB_LAMBDA_MULT', '1', 'Pitcher walks 🎰: LHP λ mult (1=no change)');
  row_('RHP_BB_LAMBDA_MULT', '1', 'Pitcher walks 🎰: RHP λ mult (1=no change)');
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
  row_('ABS_K_LAMBDA_MULT', '1', 'Per-team ABS opponent K environment fallback mult; 1 = neutral. Overridden per-team by SAVANT_ABS_CSV_URL when loaded.');
  row_('ABS_PITCHER_K_LAMBDA_MULT', '1', 'Per-pitcher ABS shadow-zone fallback mult when SAVANT_PITCHER_ABS_CSV_URL not loaded; 1 = neutral. < 1 suppresses K λ for pitchers reliant on borderline calls.');
  row_('BB9_BLEND_L7_WEIGHT', '0.35', '0..1 blend of L3 BB/9 vs season BB9 for 🪶 walks λ. 0 = season only; 1 = L3 only. Default 0.35 mirrors K9_BLEND_L7_WEIGHT — captures ABS-driven walk trend in recent starts.');
  row_('BB9_BLEND_L3_WEIGHT', '', 'Optional; blank = use BB9_BLEND_L7_WEIGHT for 🎰 Pitcher BB λ (L3 BB9 vs season)');
  row_('SAVANT_INGEST_ENABLED', 'false', 'true | false — when true, pipeline probes SAVANT_ABS_CSV_URL and SAVANT_PITCHER_ABS_CSV_URL (best-effort; see MLBSavantIngest.js)');
  row_(
    'SAVANT_ABS_CSV_URL',
    '',
    'Public CSV: columns team_id + abs_k_mult (or abbr + factor). Example row: 121,1.02 — loads per-team λ mult when SAVANT_INGEST_ENABLED is true.'
  );
  row_(
    'SAVANT_PITCHER_ABS_CSV_URL',
    '',
    'CSV: columns pitcher_id + abs_k_mult. Per-pitcher shadow-zone K dependency mult (< 1 = loses Ks to ABS challenges). Loaded when SAVANT_INGEST_ENABLED is true.'
  );
  row_('KELLY_BANKROLL', '1000', 'Total bankroll in dollars used for Kelly sizing on 🃏 bet card. Set to your actual roll; Kelly $ scales proportionally.');
  row_('KELLY_FRACTION', '0.25', 'Fractional Kelly multiplier (0..1). 0.25 = quarter-Kelly (recommended for props). Full Kelly (1.0) is theoretically optimal but high-variance.');
  row_('KELLY_MAX_BET_PCT', '0.05', 'Hard cap: max bet as fraction of bankroll regardless of Kelly output (default 0.05 = 5%). Prevents runaway sizing on thin samples.');
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
  const fromCfg = cfg && cfg['SLATE_DATE'] ? String(cfg['SLATE_DATE']).trim() : '';
  if (fromCfg && /^\d{4}-\d{2}-\d{2}$/.test(fromCfg)) return fromCfg;
  return Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd');
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
  warnRange('HR_PROMO_BLEND_L14_WEIGHT', c['HR_PROMO_BLEND_L14_WEIGHT'], 0, 1);
  warnRange('HR_PROMO_PITCHER_MULT_MIN', c['HR_PROMO_PITCHER_MULT_MIN'], 0.7, 1);
  warnRange('HR_PROMO_PITCHER_MULT_MAX', c['HR_PROMO_PITCHER_MULT_MAX'], 1, 1.35);
  warnRange('LEAGUE_PITCHING_HR9', c['LEAGUE_PITCHING_HR9'], 0.5, 2.5);
  warnRange('HR_PROMO_SHRINK_MIN_PA', c['HR_PROMO_SHRINK_MIN_PA'], 1, 200);
  warnRange('LEAGUE_HITTING_HR_PER_PA', c['LEAGUE_HITTING_HR_PER_PA'], 0.01, 0.08);
  warnRange('HR_PROMO_CALIB_MIN_ROWS', c['HR_PROMO_CALIB_MIN_ROWS'], 50, 50000);
  warnRange('MIN_EV_BET_CARD', c['MIN_EV_BET_CARD'], 0, 0.5);
  warnRange('OPP_K_RATE_LAMBDA_STRENGTH', c['OPP_K_RATE_LAMBDA_STRENGTH'], 0, 1);
  warnRange('HP_UMP_LAMBDA_MULT', c['HP_UMP_LAMBDA_MULT'], 0.85, 1.15);
  warnRange('LHP_K_LAMBDA_MULT', c['LHP_K_LAMBDA_MULT'], 0.92, 1.12);
  warnRange('RHP_K_LAMBDA_MULT', c['RHP_K_LAMBDA_MULT'], 0.92, 1.12);
  const amin = parseFloat(String(c['CARD_SINGLES_MIN_AMERICAN'] != null ? c['CARD_SINGLES_MIN_AMERICAN'] : '').trim(), 10);
  const amax = parseFloat(String(c['CARD_SINGLES_MAX_AMERICAN'] != null ? c['CARD_SINGLES_MAX_AMERICAN'] : '').trim(), 10);
  if (!isNaN(amin) && !isNaN(amax) && amin > amax) {
    addPipelineWarning_('⚙️ CARD_SINGLES_MIN_AMERICAN > CARD_SINGLES_MAX_AMERICAN (band inverted)');
  }
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
