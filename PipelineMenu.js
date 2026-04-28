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
    .addItem('📋 Pitcher Outs queue / card', 'runPitcherOutsQueueAndCard_')
    .addItem('📋 Pitcher Walks queue / card', 'runPitcherBbQueueAndCard_')
    .addItem('📋 Pitcher HA queue / card', 'runPitcherHaQueueAndCard_')
    .addItem('📋 Batter TB queue only (FD TB + hitting logs)', 'refreshBatterTbSlateQueue')
    .addItem('🎲 Batter TB card only (Poisson + EV)', 'refreshBatterTbBetCard')
    .addItem('📋 Batter Hits queue only (FD hits + hitting logs)', 'refreshBatterHitsSlateQueue')
    .addItem('🎯 Batter Hits card only (Poisson + EV)', 'refreshBatterHitsBetCard')
    .addItem('📋 Batter HR queue / card', 'runBatterHrQueueAndCard_')
    .addItem('🃏 MLB Bet Card only (final plays)', 'refreshMLBBetCard')
    .addItem('📊 Grade pending MLB results (boxscore)', 'gradeMLBPendingResults_')
    .addItem('📈 Backfill closing K (Results Log)', 'mlbBackfillClosingMenu_')
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

/** Menu: fill close_line / close_odds / clv_note from current ✅ tab for this slate’s log rows. */
function mlbBackfillClosingMenu_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const n = mlbBackfillResultsLogClosingK_(ss);
  try {
    ss.toast('Results log: updated ' + n + ' row(s) from FanDuel K tab', 'MLB-BOIZ', 7);
  } catch (e) {}
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
  try {
    ensureMlbPipelineSlateDateAdvanced_(getConfig());
  } catch (e) {
    Logger.log('ensureMlbPipelineSlateDateAdvanced_: ' + e);
  }
  mlbResetPitchGameLogFetchCache_();
  mlbResetPitchHandCache_();
  mlbResetTeamHittingSeasonCache_();
  mlbResetSavantAbsCache_();
  mlbResetBatterTbCaches_();
  let savantTeamCount = -1;
  let savantPitcherCount = -1;
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
      validateMlbPipelineConfig_(getConfig());
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
  step('Savant ingest (optional)', function () {
    savantTeamCount = mlbSavantAbsIngestBestEffort_();
    savantPitcherCount = mlbSavantAbsPitcherIngestBestEffort_();
  });
  step('Slate board (join)', refreshMLBSlateBoard);
  step('Pitcher K queue', refreshPitcherKSlateQueue);
  step('Pitcher K card', refreshPitcherKBetCard);
  step('Pitcher Outs queue', refreshPitcherOutsSlateQueue);
  step('Pitcher Outs card', refreshPitcherOutsBetCard);
  step('Pitcher Walks queue', refreshPitcherWalksSlateQueue);
  step('Pitcher Walks card', refreshPitcherWalksBetCard);
  step('Pitcher HA queue', refreshPitcherHitsAllowedSlateQueue);
  step('Pitcher HA card', refreshPitcherHaBetCard);
  step('Batter TB queue', refreshBatterTbSlateQueue);
  step('Batter TB card', refreshBatterTbBetCard);
  step('Batter Hits queue', refreshBatterHitsSlateQueue);
  step('Batter Hits card', refreshBatterHitsBetCard);
  step('Batter HR queue', refreshBatterHrSlateQueue);
  step('Batter HR card', refreshBatterHrBetCard);
  step('MLB Bet Card', refreshMLBBetCard);

  const oCfg = outcomes[0] || { ok: true };
  const oInj = outcomes[1] || { ok: true };
  const oSch = outcomes[2] || { ok: true };
  const oGameLogs = outcomes[3] || { ok: true };
  const oOdds = outcomes[4] || { ok: true };
  const oSavant = outcomes[5] || { ok: true };
  const oSlate = outcomes[6] || { ok: true };
  const oPk = outcomes[7] || { ok: true };
  const oCard = outcomes[8] || { ok: true };
  const oOutsQ = outcomes[9] || { ok: true };
  const oOutsC = outcomes[10] || { ok: true };
  const oBbQ = outcomes[11] || { ok: true };
  const oBbC = outcomes[12] || { ok: true };
  const oHaQ = outcomes[13] || { ok: true };
  const oHaC = outcomes[14] || { ok: true };
  const oTbQ = outcomes[15] || { ok: true };
  const oTbCard = outcomes[16] || { ok: true };
  const oHitsQ = outcomes[17] || { ok: true };
  const oHitsCard = outcomes[18] || { ok: true };
  const oHrQ = outcomes[19] || { ok: true };
  const oHrC = outcomes[20] || { ok: true };
  const oBet = outcomes[21] || { ok: true };

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
    'Savant ingest (optional)',
    savantTeamCount >= 0 ? 1 : 0,
    savantTeamCount > 0 ? savantTeamCount : oSavant.ok ? 0 : 0,
    !oSavant.ok
      ? oSavant.err || 'failed'
      : savantTeamCount < 0
        ? 'skipped (disabled)'
        : (savantTeamCount > 0 ? 'teams=' + savantTeamCount : 'no team rows — see warnings') +
          (savantPitcherCount > 0 ? ' · pitchers=' + savantPitcherCount : '')
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
    'Pitcher Outs queue',
    0,
    oOutsQ.ok ? mlbTabDataRowsBelowHeader3_(ss, MLB_PITCHER_OUTS_QUEUE_TAB) : 0,
    oOutsQ.ok ? '' : oOutsQ.err || 'failed'
  );
  logStep_(
    'Pitcher Outs card',
    0,
    oOutsC.ok ? mlbTabDataRowsBelowHeader3_(ss, MLB_PITCHER_OUTS_CARD_TAB) : 0,
    oOutsC.ok ? '' : oOutsC.err || 'failed'
  );
  logStep_(
    'Pitcher Walks queue',
    0,
    oBbQ.ok ? mlbTabDataRowsBelowHeader3_(ss, MLB_PITCHER_BB_QUEUE_TAB) : 0,
    oBbQ.ok ? '' : oBbQ.err || 'failed'
  );
  logStep_(
    'Pitcher Walks card',
    0,
    oBbC.ok ? mlbTabDataRowsBelowHeader3_(ss, MLB_PITCHER_BB_CARD_TAB) : 0,
    oBbC.ok ? '' : oBbC.err || 'failed'
  );
  logStep_(
    'Pitcher HA queue',
    0,
    oHaQ.ok ? mlbTabDataRowsBelowHeader3_(ss, MLB_PITCHER_HA_QUEUE_TAB) : 0,
    oHaQ.ok ? '' : oHaQ.err || 'failed'
  );
  logStep_(
    'Pitcher HA card',
    0,
    oHaC.ok ? mlbTabDataRowsBelowHeader3_(ss, MLB_PITCHER_HA_CARD_TAB) : 0,
    oHaC.ok ? '' : oHaC.err || 'failed'
  );
  logStep_(
    'Batter TB queue',
    0,
    oTbQ.ok ? mlbTabDataRowsBelowHeader3_(ss, MLB_BATTER_TB_QUEUE_TAB) : 0,
    oTbQ.ok ? '' : oTbQ.err || 'failed'
  );
  logStep_(
    'Batter TB card',
    0,
    oTbCard.ok ? mlbTabDataRowsBelowHeader3_(ss, MLB_BATTER_TB_CARD_TAB) : 0,
    oTbCard.ok ? '' : oTbCard.err || 'failed'
  );
  logStep_(
    'Batter Hits queue',
    0,
    oHitsQ.ok ? mlbTabDataRowsBelowHeader3_(ss, MLB_BATTER_HITS_QUEUE_TAB) : 0,
    oHitsQ.ok ? '' : oHitsQ.err || 'failed'
  );
  logStep_(
    'Batter Hits card',
    0,
    oHitsCard.ok ? mlbTabDataRowsBelowHeader3_(ss, MLB_BATTER_HITS_CARD_TAB) : 0,
    oHitsCard.ok ? '' : oHitsCard.err || 'failed'
  );
  logStep_(
    'Batter HR queue',
    0,
    oHrQ.ok ? mlbTabDataRowsBelowHeader3_(ss, MLB_BATTER_HR_QUEUE_TAB) : 0,
    oHrQ.ok ? '' : oHrQ.err || 'failed'
  );
  logStep_(
    'Batter HR card',
    0,
    oHrC.ok ? mlbTabDataRowsBelowHeader3_(ss, MLB_BATTER_HR_CARD_TAB) : 0,
    oHrC.ok ? '' : oHrC.err || 'failed'
  );
  logStep_(
    'MLB Bet Card',
    0,
    oBet.ok ? mlbTabDataRowsBelowHeader3_(ss, MLB_BET_CARD_TAB) : 0,
    oBet.ok ? '' : oBet.err || 'failed'
  );

  mlbAppendAllMarketNearMisses_(ss);

  if (oBet.ok) {
    try {
      snapshotMLBBetCardToLog(windowTag);
    } catch (e) {
      addPipelineWarning_('Results snapshot: ' + (e.message || e));
    }
  }

  if (windowTag === 'FINAL' && oOdds.ok) {
    try {
      mlbBackfillResultsLogClosingK_(ss);
    } catch (e) {
      addPipelineWarning_('Closing K backfill: ' + (e.message || e));
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

function runPitcherOutsQueueAndCard_() {
  refreshPitcherOutsSlateQueue();
  refreshPitcherOutsBetCard();
}

function runPitcherBbQueueAndCard_() {
  refreshPitcherWalksSlateQueue();
  refreshPitcherWalksBetCard();
}

function runPitcherHaQueueAndCard_() {
  refreshPitcherHitsAllowedSlateQueue();
  refreshPitcherHaBetCard();
}

function runBatterHrQueueAndCard_() {
  refreshBatterHrSlateQueue();
  refreshBatterHrBetCard();
}
