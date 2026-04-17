// ============================================================
// 🕐 MLB-BOIZ pipeline (MVP)
// ============================================================
// Mirrors AI-BOIZ windows in spirit: morning = full refresh for slate date.
// ============================================================

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('⚾ MLB-BOIZ')
    .addItem('0. Build Config tab', 'buildConfigTab')
    .addSeparator()
    .addItem('🌅 Morning — Injuries + schedule + FanDuel odds', 'runMorningWindowMLB')
    .addItem('📆 Set SLATE_DATE to tomorrow (NY) + Morning', 'runMorningForTomorrowNY_')
    .addSeparator()
    .addItem('🚑 MLB injuries only', 'fetchMLBInjuryReport')
    .addToUi();
}

/**
 * Sets Config SLATE_DATE to calendar tomorrow in America/New_York, then runs morning.
 */
function runMorningForTomorrowNY_() {
  const tz = 'America/New_York';
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const ymd = Utilities.formatDate(d, tz, 'yyyy-MM-dd');
  setConfigValue_('SLATE_DATE', ymd);
  runMorningWindowMLB();
}

function runMorningWindowMLB() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const start = Date.now();
  const log = [];
  function step(name, fn) {
    const t0 = Date.now();
    ss.toast('Running: ' + name, 'MLB-BOIZ', 8);
    try {
      fn();
      log.push('OK ' + name + ' (' + ((Date.now() - t0) / 1000).toFixed(1) + 's)');
    } catch (e) {
      log.push('FAIL ' + name + ': ' + e.message);
      Logger.log(e.stack);
    }
  }

  step('Config', function () {
    try {
      buildConfigTab();
    } catch (e) {}
  });
  step('MLB injuries (ESPN)', fetchMLBInjuryReport);
  step('MLB schedule (statsapi)', fetchMLBScheduleForSlate);
  step('FanDuel MLB odds', fetchMLBFanDuelOdds);

  const msg = log.join('\n');
  Logger.log('Morning MLB window:\n' + msg);
  ss.toast('Done in ' + ((Date.now() - start) / 1000).toFixed(1) + 's', 'MLB-BOIZ', 8);
  try {
    ss.getSheetByName('✅ FanDuel_MLB_Odds').activate();
  } catch (e) {}
}
