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
    .addItem('📋 Batter TB queue only (FD TB + hitting logs)', 'refreshBatterTbSlateQueue')
    .addItem('🎲 Batter TB card only (Poisson + EV)', 'refreshBatterTbBetCard')
    .addItem('📋 Batter Hits queue only (FD hits + hitting logs)', 'refreshBatterHitsSlateQueue')
    .addItem('🎯 Batter Hits card only (Poisson + EV)', 'refreshBatterHitsBetCard')
    .addItem('🃏 MLB Bet Card only (final plays)', 'refreshMLBBetCard')
    .addItem('🔍 Diagnose Hits → BetCard inclusion', 'diagnoseHitsBetCardInclusion')
    .addItem('📊 Grade pending MLB results (boxscore)', 'gradeMLBPendingResults_')
    .addItem('📈 Backfill closing K (Results Log)', 'mlbBackfillClosingMenu_')
    .addItem('💵 Backfill historical stake + P/L (legacy unit)', 'mlbBackfillStakesMenu_')
    .addItem('📋 Open Pipeline Log', 'mlbActivatePipelineLog_')
    .addItem('🩺 HR + Grand Slam tab diagnostic', 'runHRSlamDiagnostic')
    .addSeparator()
    .addSubMenu(
      SpreadsheetApp.getUi()
        .createMenu('🧪 Hits v2 (shadow)')
        .addItem('🧪 Rebuild Batter Hits v2 card', 'refreshBatterHitsV2BetCard')
        .addItem('🧪 Snapshot v2 card → log (MIDDAY tag)', 'mlbSnapshotHitsV2Midday_')
        .addItem('📊 Grade pending v2 hits rows', 'gradeMLBHitsV2PendingResults_')
        .addItem('🔬 Diagnose v2 Results Log', 'mlbDiagnoseHitsV2Log_')
        .addItem('🧪 Test grade ONE v2 row', 'mlbTestGradeOneHitsV2Row_')
        .addItem('🩺 Run grader self-test (feed/live)', 'mlbGraderSelfTestMenu_')
        .addItem('🔬 Refresh Hits Model Compare panel', 'refreshHitsModelCompare')
        .addItem('🔬 Open Compare panel', 'mlbActivateHitsCompareTab_')
        .addItem('🧪 Open v2 Results Log', 'mlbActivateHitsV2LogTab_')
        .addSeparator()
        .addItem('🔬 Refresh feature-ablation backtest', 'refreshHitsFeatureAblation')
        .addItem('🔬 Open feature-ablation tab', 'mlbActivateHitsAblationTab_')
    )
    .addSubMenu(
      SpreadsheetApp.getUi()
        .createMenu('📣 HR Promo')
        .addItem('📣 Refresh HR Promo tab (rebuild picks)', 'refreshBatterHrPromoSheet_')
        .addItem('📋 Snapshot HR picks → log', 'mlbSnapshotHrPromoMidday_')
        .addItem('📊 Grade pending HR promo rows', 'gradeHrPromoPendingResults_')
        .addItem('📋 Open HR Promo tab', 'mlbActivateHrPromoTab_')
        .addItem('📋 Open HR Promo Results Log', 'mlbActivateHrPromoResultsLogTab_')
        .addSeparator()
        .addItem('🔬 Refresh HR promo feature-ablation', 'refreshHrPromoFeatureAblation')
        .addItem('🔬 Open HR promo ablation tab', 'mlbActivateHrPromoAblationTab_')
    )
    .addSubMenu(
      SpreadsheetApp.getUi()
        .createMenu('💎 GS Promo')
        .addItem('💎 Refresh GS Promo tab (rebuild picks)', 'refreshBatterGsPromoSheet_')
        .addItem('📋 Open GS Promo tab', 'mlbActivateGsPromoTab_')
    )
    .addToUi();
}

/** Menu wrapper — snapshot HR promo picks with MIDDAY tag. */
function mlbSnapshotHrPromoMidday_() {
  if (typeof snapshotHrPromoToLog === 'function') snapshotHrPromoToLog('MIDDAY');
}

/** Menu wrapper — pop a dialog with the grader self-test result. */
function mlbGraderSelfTestMenu_() {
  const ui = SpreadsheetApp.getUi();
  let r;
  try {
    r = mlbGraderSelfTest_();
  } catch (e) {
    ui.alert('Grader self-test', 'Threw: ' + (e.message || e), ui.ButtonSet.OK);
    return;
  }
  const head = r.ok ? '✅ Grader OK' : '❌ GRADER BROKEN';
  ui.alert(head, r.note, ui.ButtonSet.OK);
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

/** Menu: fill blank stake $ at LEGACY_UNIT_USD + (re)compute pnl $ for graded rows. */
function mlbBackfillStakesMenu_() {
  mlbBackfillHistoricalStakes_();
}

/**
 * @param {string} windowTag MORNING | MIDDAY | FINAL
 * @param {boolean} skipInjuriesFetch true for midday (AI-BOIZ spirit: lighter pass)
 */
function runMLBBallWindow_(windowTag, skipInjuriesFetch) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const start = Date.now();
  resetPipelineLog_(windowTag);

  // Grader self-test runs FIRST so a regressed /feed/live URL or broken
  // boxscore plumbing surfaces as a loud Pipeline_Log warning even when no
  // past-slate rows happen to be in the log. Result column on Bet Card and
  // Results Tracker depends on this — never silently skip.
  try {
    const selfTest = mlbGraderSelfTest_();
    if (!selfTest.ok) {
      addPipelineWarning_('GRADER SELF-TEST FAILED — ' + selfTest.note);
      ss.toast('⚠️ Grader self-test failed: ' + selfTest.note, 'MLB-BOIZ', 12);
    }
  } catch (e) {
    addPipelineWarning_('Grader self-test threw: ' + (e.message || e));
  }

  try {
    gradeMLBPendingResults_();
  } catch (e) {
    Logger.log('gradeMLBPendingResults_: ' + e);
  }
  try {
    gradeMLBHitsV2PendingResults_();
  } catch (e) {
    Logger.log('gradeMLBHitsV2PendingResults_: ' + e);
  }
  try {
    if (typeof gradeHrPromoPendingResults_ === 'function') gradeHrPromoPendingResults_();
  } catch (e) {
    Logger.log('gradeHrPromoPendingResults_: ' + e);
  }
  mlbResetPitchGameLogFetchCache_();
  mlbResetPitchHandCache_();
  mlbResetTeamHittingSeasonCache_();
  mlbResetSavantAbsCache_();
  mlbResetBatterTbCaches_();
  let savantTeamCount = -1;
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
  });
  step('Slate board (join)', refreshMLBSlateBoard);
  step('Pitcher K queue', refreshPitcherKSlateQueue);
  step('Pitcher K card', refreshPitcherKBetCard);
  step('Batter TB queue', refreshBatterTbSlateQueue);
  step('Batter TB card', refreshBatterTbBetCard);
  step('Batter Hits queue', refreshBatterHitsSlateQueue);
  step('Batter Hits card', refreshBatterHitsBetCard);
  step('Batter Hits v2 card (shadow)', refreshBatterHitsV2BetCard);
  step('MLB Bet Card', refreshMLBBetCard);
  // HR Promo built last so the snapshot block (after this) can read it.
  // Appended (not inserted) so the existing outcomes[] indices stay stable.
  step('Batter HR Promo refresh', refreshBatterHrPromoSheet_);
  // GS Promo reuses the HR-promo row builder, so it must run AFTER the HR refresh.
  step('Batter GS Promo refresh', refreshBatterGsPromoSheet_);

  const oCfg = outcomes[0] || { ok: true };
  const oInj = outcomes[1] || { ok: true };
  const oSch = outcomes[2] || { ok: true };
  const oGameLogs = outcomes[3] || { ok: true };
  const oOdds = outcomes[4] || { ok: true };
  const oSavant = outcomes[5] || { ok: true };
  const oSlate = outcomes[6] || { ok: true };
  const oPk = outcomes[7] || { ok: true };
  const oCard = outcomes[8] || { ok: true };
  const oTbQ = outcomes[9] || { ok: true };
  const oTbCard = outcomes[10] || { ok: true };
  const oHitsQ = outcomes[11] || { ok: true };
  const oHitsCard = outcomes[12] || { ok: true };
  const oHitsV2 = outcomes[13] || { ok: true };
  const oBet = outcomes[14] || { ok: true };

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
        : savantTeamCount > 0
          ? 'teams=' + savantTeamCount
          : 'no rows parsed — see warnings'
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
    'Batter Hits v2 card (shadow)',
    0,
    oHitsV2.ok ? mlbTabDataRowsBelowHeader3_(ss, MLB_BATTER_HITS_V2_CARD_TAB) : 0,
    oHitsV2.ok ? '' : oHitsV2.err || 'failed'
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

  if (oHitsV2.ok) {
    try {
      snapshotMLBHitsV2BetCardToLog(windowTag);
    } catch (e) {
      addPipelineWarning_('Hits v2 snapshot: ' + (e.message || e));
    }
  }

  // HR promo snapshot — picks live on the promo sheet built earlier in the
  // pipeline (separate flow). Snapshot only if the tab is populated.
  if (typeof snapshotHrPromoToLog === 'function' && ss.getSheetByName(MLB_BATTER_HR_PROMO_TAB)) {
    try {
      snapshotHrPromoToLog(windowTag);
    } catch (e) {
      addPipelineWarning_('HR promo snapshot: ' + (e.message || e));
    }
  }

  try {
    refreshHitsModelCompare();
  } catch (e) {
    addPipelineWarning_('Hits compare panel: ' + (e.message || e));
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
