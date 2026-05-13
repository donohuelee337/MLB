// ============================================================
// ⚙️ CONFIG — MLB-BOIZ (AI-BOIZ philosophy, MLB data)
// ============================================================
// Secrets: set Script Properties ODDS_API_KEY (the-odds-api.com).
// Optional: STATSAPI_BASE in Script Properties (default https://statsapi.mlb.com/api/v1).
// ============================================================

const CONFIG_TAB_NAME = '⚙️ Config';

function safeAlert_(title, message) {
  try {
    SpreadsheetApp.getActiveSpreadsheet().toast(message || title, title, 8);
  } catch (e) {
    Logger.log('ALERT [' + title + ']: ' + (message || ''));
    try {
      SpreadsheetApp.getUi().alert(title, message || title, SpreadsheetApp.getUi().ButtonSet.OK);
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
  const defaultSlate =
    prevSlate && /^\d{4}-\d{2}-\d{2}$/.test(prevSlate)
      ? prevSlate
      : Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd');

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
  row_('ODDS_REGION', 'us', 'regions param');
  row_('K9_BLEND_L7_WEIGHT', '0.35', '0..1 blend of L3 K/9 vs season K9 for 🎰 λ (needs L3_IP in queue). Practical scan ~0.2–0.5 around default 0.35; tune iteratively after several slates using Pipeline_Log and 🎰 bet card outcomes. If this key is missing, re-run menu "0. Build Config tab".');
  row_(
    'TB_BLEND_RECENT_WEIGHT',
    '0.35',
    '0..1 blend of L7 stat/game vs season stat/game for ALL batter prop cards (TB, Hits, HR). Same spirit as K9_BLEND. Tune after slates.'
  );
  row_('MIN_EV_BET_CARD', '0', 'Min EV per $1 on 🃏 card; 0 = any positive EV (any edge). Optional floor: try ~0.02–0.05 vs 0 to drop thin lines; iterate after several slates using Pipeline_Log and 🃏 outcomes. If this key is missing, re-run menu "0. Build Config tab".');
  row_(
    'CARD_USE_NBA_ODDS_BAND',
    'true',
    'true | false — when true, 🃏 straights only keep American odds in CARD_SINGLES_MIN..MAX (NBA-style band, default ~−150..+150).'
  );
  row_('CARD_SINGLES_MIN_AMERICAN', '-150', 'With CARD_USE_NBA_ODDS_BAND: min American for favorites (e.g. −150 means exclude −160).');
  row_('CARD_SINGLES_MAX_AMERICAN', '150', 'With CARD_USE_NBA_ODDS_BAND: max American for underdogs on the card.');
  row_(
    'MLB_FORCE_PITCHER_WALKS_BET_CARD',
    'true',
    'true | false — when true, 🃏 Pitcher walks skip NBA odds band + MIN_EV_BET_CARD (still need +EV from model), and may add a 3rd straight when 2 non-walk plays already fill the per-game cap.'
  );
  row_(
    'MLB_FORCE_PITCHER_BB_BET_CARD',
    'true',
    'Legacy alias for MLB_FORCE_PITCHER_WALKS_BET_CARD. Keep in sync if you edit manually.'
  );
  row_('HP_UMP_LAMBDA_MULT', '1', 'Multiply 🎰 λ when hp_umpire listed (1=no change; try 1.02–1.05 cautiously)');
  row_('LHP_K_LAMBDA_MULT', '1', 'Extra λ mult when pitcher throws L (1=no change)');
  row_('RHP_K_LAMBDA_MULT', '1', 'Extra λ mult when pitcher throws R (1=no change)');
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
  row_('CARD_ALLOWED_MARKETS', 'Pitcher strikeouts,Batter hits,Batter total bases', 'Comma-separated market labels for 🃏 main card. All other markets are SGP-pool only (see SGP section). Default: K + Hits + TB.');
  row_('SGP_MIN_EV', '0.01', 'Min EV per $1 for SGP 3rd-leg candidates shown below main card. Default 0.01 (B tier). Must be positive EV; market need not be in CARD_ALLOWED_MARKETS.');
  row_('BATTER_TB_OVER_MAX_AMERICAN', '0', 'Cap on American odds for Batter TB Over bets on 🃏 card. Default 0 (even odds): plus-odds TB Overs are soft-rejected (noisy λ at long prices). Set to 150 to restore full band, or -100 to require short favorites only.');
  row_('MLB_INCLUDE_HR_BET_CARD', 'false', 'true | false — include Batter HR in 🃏 merge. Default false: HR park factors and pitcher HR/9 not yet modeled; re-enable when those signals are added.');
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
