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
  row_('MIN_EV_BET_CARD', '0', 'Min EV per $1 on 🃏 card; 0 = any positive EV (any edge). Optional floor: try ~0.02–0.05 vs 0 to drop thin lines; iterate after several slates using Pipeline_Log and 🃏 outcomes. If this key is missing, re-run menu "0. Build Config tab".');
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
  row_('AUDIT_SPOT_CHECK_N', '10', 'Number of random rows to re-grade during spot-check audit');
  row_('AUDIT_STALE_PENDING_HOURS', '48', 'Hours after slate before a PENDING row is flagged as stale');
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
  warnRange('MIN_EV_BET_CARD', c['MIN_EV_BET_CARD'], 0, 0.5);
  warnRange('OPP_K_RATE_LAMBDA_STRENGTH', c['OPP_K_RATE_LAMBDA_STRENGTH'], 0, 1);
  warnRange('HP_UMP_LAMBDA_MULT', c['HP_UMP_LAMBDA_MULT'], 0.85, 1.15);
  warnRange('LHP_K_LAMBDA_MULT', c['LHP_K_LAMBDA_MULT'], 0.92, 1.12);
  warnRange('RHP_K_LAMBDA_MULT', c['RHP_K_LAMBDA_MULT'], 0.92, 1.12);
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
