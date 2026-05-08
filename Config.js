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
  row_('SLATE_DATE', defaultSlate, 'yyyy-MM-dd in script TZ — use menu "tomorrow" or set manually');
  row_('ODDS_BOOK', 'fanduel', 'the-odds-api bookmaker key');
  row_('ODDS_REGION', 'us', 'regions param (try us2 if FD player props sparse in ✅ tab)');
  row_('K9_BLEND_L7_WEIGHT', '0.35', '0..1 blend of L3 K/9 vs season K9 for 🎰 λ (needs L3_IP in queue)');
  row_('BB9_BLEND_L3_WEIGHT', '', 'Optional; blank = use K9_BLEND for 🎰 Pitcher BB λ (L3 BB9 vs season)');
  row_('MIN_EV_BET_CARD', '0', 'Min EV per $1 on 🃏 card; 0 = any positive EV; e.g. 0.03 for 3¢ floor');
  row_('MAX_ODDS_BET_CARD', '', 'Max American odds on 🃏 card; blank = no cap; e.g. 130 to exclude bets over +130');
  row_('MIN_ODDS_BET_CARD', '-250', 'Min American odds on 🃏 card (heavy-chalk floor); blank = no floor; e.g. -250 to exclude -260 and worse');
  row_('EST_AB_PER_GAME', '3.5', 'Estimated AB per game for 🎰 Batter Hits model (fallback when season AB/G unavailable)');
  row_('BANKROLL', '1000', 'Total bankroll in $ — used to size kelly_$ on the 🃏 card');
  row_('KELLY_FRACTION', '0.25', 'Fraction of full Kelly to wager (0.25 = quarter-Kelly; safer for sports)');
  row_('HP_UMP_LAMBDA_MULT', '1', 'Multiply 🎰 λ when hp_umpire listed (1=no change; try 1.02–1.05 cautiously)');
  row_('LHP_K_LAMBDA_MULT', '1', 'Extra λ mult when pitcher throws L (1=no change)');
  row_('RHP_K_LAMBDA_MULT', '1', 'Extra λ mult when pitcher throws R (1=no change)');
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
