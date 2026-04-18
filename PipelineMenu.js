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
    .addItem('📋 Open Pipeline Log', 'mlbActivatePipelineLog_')
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
  resetPipelineLog_('MORNING');
  const outcomes = [];
  function step(name, fn) {
    const t0 = Date.now();
    ss.toast('Running: ' + name, 'MLB-BOIZ', 8);
    try {
      fn();
      outcomes.push({ name: name, ok: true, sec: (Date.now() - t0) / 1000 });
    } catch (e) {
      outcomes.push({ name: name, ok: false, sec: (Date.now() - t0) / 1000, err: String(e.message) });
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

  const oCfg = outcomes[0] || { ok: true };
  const oInj = outcomes[1] || { ok: true };
  const oSch = outcomes[2] || { ok: true };
  const oOdds = outcomes[3] || { ok: true };

  logStep_('Config', 1, oCfg.ok ? 1 : 0, oCfg.ok ? '' : oCfg.err || 'failed');
  logStep_(
    'MLB injuries',
    0,
    oInj.ok ? mlbTabDataRowsBelowHeader3_(ss, MLB_INJURY_CONFIG.tabName) : 0,
    oInj.ok ? '' : oInj.err || 'failed'
  );
  logStep_(
    'MLB schedule',
    0,
    oSch.ok ? mlbTabDataRowsBelowHeader3_(ss, MLB_SCHEDULE_TAB) : 0,
    oSch.ok ? '' : oSch.err || 'failed'
  );
  logStep_(
    'FanDuel MLB odds',
    0,
    oOdds.ok ? mlbTabDataRowsBelowHeader3_(ss, MLB_ODDS_CONFIG.tabName) : 0,
    oOdds.ok ? '' : oOdds.err || 'failed'
  );

  outcomes.forEach(function (o) {
    if (!o.ok) addPipelineWarning_(o.name + ': ' + (o.err || 'failed'));
  });

  writePipelineLogTab_(ss);

  const msg = outcomes
    .map(function (o) {
      return (o.ok ? 'OK ' : 'FAIL ') + o.name + ' (' + o.sec.toFixed(1) + 's)' + (o.ok ? '' : ': ' + o.err);
    })
    .join('\n');
  Logger.log('Morning MLB window:\n' + msg);
  ss.toast('Done in ' + ((Date.now() - start) / 1000).toFixed(1) + 's', 'MLB-BOIZ', 8);
  try {
    ss.getSheetByName('✅ FanDuel_MLB_Odds').activate();
  } catch (e) {}
}
