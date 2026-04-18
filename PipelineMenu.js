// ============================================================
// 🕐 MLB-BOIZ pipeline (MVP)
// ============================================================
// Mirrors AI-BOIZ windows: morning = full refresh; midday = odds +
// downstream without re-pulling injuries; final = full refresh + lock snapshot.
// ============================================================

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('⚾ MLB-BOIZ')
    .addItem('0. Build Config tab', 'buildConfigTab')
    .addSeparator()
    .addItem('🌅 Morning — Injuries + schedule + FanDuel odds', 'runMorningWindowMLB')
    .addItem('📆 Set SLATE_DATE to tomorrow (NY) + Morning', 'runMorningForTomorrowNY_')
    .addItem('🌤 Midday — Odds + slate + K pipeline (injuries unchanged)', 'runMiddayWindowMLB')
    .addItem('🔒 Final — Full refresh + snapshot', 'runFinalWindowMLB')
    .addSeparator()
    .addItem('🚑 MLB injuries only', 'fetchMLBInjuryReport')
    .addItem('🎯 Slate board only (join schedule + FD counts)', 'refreshMLBSlateBoard')
    .addItem('📒 Pitcher game logs only (statsapi, warms cache)', 'refreshMLBPitcherGameLogs')
    .addItem('📋 Pitcher K queue only (schedule + FD K + game logs)', 'refreshPitcherKSlateQueue')
    .addItem('🎰 Pitcher K card only (Poisson + EV)', 'refreshPitcherKBetCard')
    .addItem('🃏 MLB Bet Card only (final plays)', 'refreshMLBBetCard')
    .addItem('📊 Grade pending MLB results (boxscore)', 'gradeMLBPendingResults_')
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
  runMLBBallWindow_('MORNING', false);
}

function runMiddayWindowMLB() {
  runMLBBallWindow_('MIDDAY', true);
}

function runFinalWindowMLB() {
  runMLBBallWindow_('FINAL', false);
}

/**
 * @param {string} windowTag MORNING | MIDDAY | FINAL
 * @param {boolean} skipInjuriesFetch true for midday (AI-BOIZ spirit: lighter pass)
 */
function runMLBBallWindow_(windowTag, skipInjuriesFetch) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const start = Date.now();
  resetPipelineLog_(windowTag);
  try {
    gradeMLBPendingResults_();
  } catch (e) {
    Logger.log('gradeMLBPendingResults_: ' + e);
  }
  mlbResetPitchGameLogFetchCache_();
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

  if (skipInjuriesFetch) {
    step('MLB injuries (unchanged)', function () {});
  } else {
    step('MLB injuries (ESPN)', fetchMLBInjuryReport);
  }

  step('MLB schedule (statsapi)', fetchMLBScheduleForSlate);
  step('Pitcher game logs (statsapi)', refreshMLBPitcherGameLogs);
  step('FanDuel MLB odds', fetchMLBFanDuelOdds);
  step('Slate board (join)', refreshMLBSlateBoard);
  step('Pitcher K queue', refreshPitcherKSlateQueue);
  step('Pitcher K card', refreshPitcherKBetCard);
  step('MLB Bet Card', refreshMLBBetCard);

  const oCfg = outcomes[0] || { ok: true };
  const oInj = outcomes[1] || { ok: true };
  const oSch = outcomes[2] || { ok: true };
  const oGameLogs = outcomes[3] || { ok: true };
  const oOdds = outcomes[4] || { ok: true };
  const oSlate = outcomes[5] || { ok: true };
  const oPk = outcomes[6] || { ok: true };
  const oCard = outcomes[7] || { ok: true };
  const oBet = outcomes[8] || { ok: true };

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
    'Pitcher game logs',
    0,
    oGameLogs.ok ? mlbTabDataRowsBelowHeader3_(ss, MLB_PITCHER_GAME_LOGS_TAB) : 0,
    oGameLogs.ok ? '' : oGameLogs.err || 'failed'
  );
  logStep_(
    'FanDuel MLB odds',
    0,
    oOdds.ok ? mlbTabDataRowsBelowHeader3_(ss, MLB_ODDS_CONFIG.tabName) : 0,
    oOdds.ok ? '' : oOdds.err || 'failed'
  );
  logStep_(
    'Slate board',
    0,
    oSlate.ok ? mlbTabDataRowsBelowHeader3_(ss, MLB_SLATE_BOARD_TAB) : 0,
    oSlate.ok ? '' : oSlate.err || 'failed'
  );
  logStep_(
    'Pitcher K queue',
    0,
    oPk.ok ? mlbTabDataRowsBelowHeader3_(ss, MLB_PITCHER_K_QUEUE_TAB) : 0,
    oPk.ok ? '' : oPk.err || 'failed'
  );
  logStep_(
    'Pitcher K card',
    0,
    oCard.ok ? mlbTabDataRowsBelowHeader3_(ss, MLB_PITCHER_K_CARD_TAB) : 0,
    oCard.ok ? '' : oCard.err || 'failed'
  );
  logStep_(
    'MLB Bet Card',
    0,
    oBet.ok ? mlbTabDataRowsBelowHeader3_(ss, MLB_BET_CARD_TAB) : 0,
    oBet.ok ? '' : oBet.err || 'failed'
  );

  mlbAppendPitcherKNearMisses_(ss);

  if (oBet.ok) {
    try {
      snapshotMLBBetCardToLog(windowTag);
    } catch (e) {
      addPipelineWarning_('Results snapshot: ' + (e.message || e));
    }
  }

  mlbAppendBetCardPipelineCoverage_(ss);

  outcomes.forEach(function (o) {
    if (!o.ok) addPipelineWarning_(o.name + ': ' + (o.err || 'failed'));
  });

  writePipelineLogTab_(ss);

  const msg = outcomes
    .map(function (o) {
      return (o.ok ? 'OK ' : 'FAIL ') + o.name + ' (' + o.sec.toFixed(1) + 's)' + (o.ok ? '' : ': ' + o.err);
    })
    .join('\n');
  Logger.log('MLB window ' + windowTag + ':\n' + msg);
  try {
    const tip = buildPipelineToast_();
    ss.toast('Done ' + windowTag + ' in ' + ((Date.now() - start) / 1000).toFixed(1) + 's — ' + tip, 'MLB-BOIZ', 10);
  } catch (e) {
    ss.toast('Done in ' + ((Date.now() - start) / 1000).toFixed(1) + 's', 'MLB-BOIZ', 8);
  }
  try {
    ss.getSheetByName(MLB_BET_CARD_TAB).activate();
  } catch (e) {}
}
