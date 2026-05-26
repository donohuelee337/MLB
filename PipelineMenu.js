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
    .addItem('⚡ Pitcher K Sim only (anchored λ)', 'refreshPitcherKSimEngine_')
    .addItem('🧪 Batter Hits v2 card only (LIVE h.v2-full)', 'refreshBatterHitsV2BetCard')
    .addItem('⚡ Batter Hits Sim only (anchored h.v2)', 'refreshBatterHitsSimEngine_')
    .addItem('📋 Batter Hits queue only (FD hits + hitting logs)', 'refreshBatterHitsSlateQueue')
    .addItem('🎯 Batter Hits card only (Poisson + EV)', 'refreshBatterHitsBetCard')
    .addItem('🃏 MLB Bet Card only (final plays)', 'refreshMLBBetCard')
    .addItem('🎯 Refresh Bet Card Calibration panel', 'refreshBetCardCalibration')
    .addItem('🎯 Open Calibration panel', 'mlbActivateCalibrationTab_')
    .addItem('🔍 Diagnose Bet Card funnel (K + H)', 'diagnoseBetCardFunnel_')
    .addItem('🔍 Diagnose Hits → BetCard inclusion', 'diagnoseHitsBetCardInclusion')
    .addItem('📊 Grade pending MLB results (boxscore)', 'gradeMLBPendingResults_')
    .addItem('📈 Backfill closing K (Results Log)', 'mlbBackfillClosingMenu_')
    .addItem('💵 Backfill historical stake + P/L (legacy unit)', 'mlbBackfillStakesMenu_')
    .addItem('📋 Open Pipeline Log', 'mlbActivatePipelineLog_')
    .addItem('📊 Open Pipeline Timings (live)', 'mlbActivatePipelineTimingsTab_')
    .addItem('📊 Refresh Project Status dashboard', 'refreshProjectStatus')
    .addItem('📊 Open Project Status dashboard', 'mlbActivateProjectStatusTab_')
    .addItem('🩺 HR + Grand Slam tab diagnostic', 'runHRSlamDiagnostic')
    .addItem('🩺 Pitcher data diagnostic (schedule → models)', 'runPitcherDataDiagnostic')
    .addItem('💰 Refresh profitability report', 'refreshMLBProfitabilityReport')
    .addItem('🔬 Run gate backtest', 'runGateBacktest')
    .addItem('✅ Apply calibration → Config', 'mlbApplyCalibrationProposals_')
    .addItem('💰 Open profitability report', 'mlbActivateProfitabilityTab_')
    .addSeparator()
    .addSubMenu(
      SpreadsheetApp.getUi()
        .createMenu('🧪 Hits shadow (h.v1)')
        .addItem('🎯 Rebuild Batter Hits v2 LIVE card', 'refreshBatterHitsV2BetCard')
        .addItem('🧪 Snapshot shadow card → log (MIDDAY tag)', 'mlbSnapshotHitsV2Midday_')
        .addItem('📊 Grade pending shadow hits rows', 'gradeMLBHitsV2PendingResults_')
        .addItem('🔬 Diagnose shadow Results Log', 'mlbDiagnoseHitsV2Log_')
        .addItem('🧪 Test grade ONE shadow row', 'mlbTestGradeOneHitsV2Row_')
        .addItem('🩺 Run grader self-test (feed/live)', 'mlbGraderSelfTestMenu_')
        .addItem('🔬 Refresh Hits Model Compare panel', 'refreshHitsModelCompare')
        .addItem('🔬 Open Compare panel', 'mlbActivateHitsCompareTab_')
        .addItem('🧪 Open shadow Results Log', 'mlbActivateHitsV2LogTab_')
        .addSeparator()
        .addItem('🔬 Refresh feature-ablation backtest', 'refreshHitsFeatureAblation')
        .addItem('🔬 Open feature-ablation tab', 'mlbActivateHitsAblationTab_')
    )
    .addSubMenu(
      SpreadsheetApp.getUi()
        .createMenu('🧪 Hits shadow (h.v3-contact)')
        .addItem('🧪 Rebuild Batter Hits v3 card', 'refreshBatterHitsV3BetCard')
        .addItem('🧪 Snapshot Hits v3 card → log (MIDDAY tag)', 'mlbSnapshotHitsV3Midday_')
        .addItem('📊 Grade pending Hits v3 rows', 'gradeMLBHitsV3PendingResults_')
        .addItem('🧪 Open Hits v3 Results Log', 'mlbActivateHitsV3LogTab_')
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
    .addSubMenu(
      SpreadsheetApp.getUi()
        .createMenu('🔥 Streak Picks')
        .addItem('🔥 Rebuild Streak picks (re-rank v2 + SP K/9)', 'refreshStreakPicks')
        .addItem('📋 Open Streak Picks tab', 'mlbActivateStreakPicksTab_')
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
  // Per-step timings flush to 📊 Pipeline_Timings as the pipeline runs,
  // so a timeout still leaves a trail showing exactly which step died.
  if (typeof mlbBeginPipelineTimings_ === 'function') mlbBeginPipelineTimings_(windowTag);

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

  // Time each grader so the 📊 Pipeline_Timings tab tells us if grading
  // (boxscore fetches per pending row) is what's blowing the budget.
  function timedGrader(name, fn) {
    const tg = Date.now();
    let okFlag = true;
    let errMsg = '';
    try {
      if (typeof fn === 'function') fn();
    } catch (e) {
      okFlag = false;
      errMsg = String(e.message);
      Logger.log(name + ': ' + e);
    }
    const s = (Date.now() - tg) / 1000;
    if (typeof mlbFlushPipelineStepTiming_ === 'function') {
      mlbFlushPipelineStepTiming_('grader: ' + name, s, okFlag, errMsg);
    }
  }
  timedGrader('K (live)',       typeof gradeMLBPendingResults_       === 'function' ? gradeMLBPendingResults_       : null);
  timedGrader('H v2 (shadow)',  typeof gradeMLBHitsV2PendingResults_ === 'function' ? gradeMLBHitsV2PendingResults_ : null);
  timedGrader('H v3 (shadow)',  typeof gradeMLBHitsV3PendingResults_ === 'function' ? gradeMLBHitsV3PendingResults_ : null);
  timedGrader('HR promo',       typeof gradeHrPromoPendingResults_   === 'function' ? gradeHrPromoPendingResults_   : null);
  mlbResetPitchGameLogFetchCache_();
  mlbResetPitchHandCache_();
  mlbResetTeamHittingSeasonCache_();
  mlbResetSavantAbsCache_();
  // Shared batter/pitcher fetch cache reset ONCE per slate. Individual
  // model resets must NOT wipe this (Hits v2 → Hits v3 share the cache).
  if (typeof mlbResetV3SharedFetchesCaches_ === 'function') mlbResetV3SharedFetchesCaches_();
  if (typeof mlbResetBoxscoreJsonCache_ === 'function') mlbResetBoxscoreJsonCache_();
  // Schedule block cache — read once after fetchMLBScheduleForSlate writes
  // the tab. All per-batter card lookups (home abbr, matchup, opp SP) hit
  // this in-memory array instead of re-reading the sheet hundreds of times.
  if (typeof mlbResetScheduleBlockCache_ === 'function') mlbResetScheduleBlockCache_();
  if (typeof mlbResetLineupsCache_ === 'function') mlbResetLineupsCache_();
  let savantTeamCount = -1;
  const outcomes = [];
  const cfg = getConfig();

  function step(name, fn) {
    const t0 = Date.now();
    ss.toast('Running: ' + name, 'MLB-BOIZ', 8);
    let okFlag = true;
    let errMsg = '';
    try {
      fn();
    } catch (e) {
      okFlag = false;
      errMsg = String(e.message);
      Logger.log(e.stack);
    }
    const sec = (Date.now() - t0) / 1000;
    outcomes.push(okFlag
      ? { name: name, ok: true, sec: sec }
      : { name: name, ok: false, sec: sec, err: errMsg });
    if (typeof mlbFlushPipelineStepTiming_ === 'function') {
      mlbFlushPipelineStepTiming_(name, sec, okFlag, errMsg);
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
  step('Lineups (statsapi)', function () {
    if (typeof mlbFetchAndCacheLineups_ === 'function') mlbFetchAndCacheLineups_(ss, cfg);
  });
  step('Pitcher game logs (statsapi)', refreshMLBPitcherGameLogs);
  step('FanDuel MLB odds', fetchMLBFanDuelOdds);
  step('Savant ingest (optional)', function () {
    savantTeamCount = mlbSavantAbsIngestBestEffort_();
  });
  step('Slate board (join)', refreshMLBSlateBoard);
  step('Pitcher K queue', refreshPitcherKSlateQueue);
  step('Pitcher K card', refreshPitcherKBetCard);
  step('Sim Engine (Pitcher K)', refreshPitcherKSimEngine_);
  // TB v1/v2/v3 retired from pipeline 2026-05-21 (losing market + API budget).
  // Source files remain for manual rebuild via Apps Script editor if needed.
  step('Batter Hits v2 card (LIVE h.v2-full)', refreshBatterHitsV2BetCard);
  step('Sim Engine (Batter Hits)', refreshBatterHitsSimEngine_);
  // --- Band D publish (broker): streak + bet card must succeed for operator ---
  // Streak picks must run BEFORE the Bet Card so the formatter can read 🔥
  // Streak_Picks to drive the yellow Streak highlight.
  step('Streak picks (streak.v1)', refreshStreakPicks);
  step('MLB Bet Card', refreshMLBBetCard);
  // --- Band E workers (shadow/promo/analytics) — isolated try/catch below ---
  step('Batter HR Promo refresh', refreshBatterHrPromoSheet_);
  // Hits v3 must run AFTER Streak (already built above) for its streak overlap mult.
  step('Batter Hits v3 card (shadow h.v3-contact)', refreshBatterHitsV3BetCard);
  // GS Promo reuses the HR-promo row builder, so it must run AFTER the HR refresh.
  step('Batter GS Promo refresh', refreshBatterGsPromoSheet_);

  // Fixed indices for logStep_ rows below — if you add/remove steps, update these
  // or switch to name-based lookup (see oHitsV3 below).
  const oCfg = outcomes[0] || { ok: true };
  const oInj = outcomes[1] || { ok: true };
  const oSch = outcomes[2] || { ok: true };
  const oGameLogs = outcomes[4] || { ok: true };
  const oOdds = outcomes[5] || { ok: true };
  const oSavant = outcomes[6] || { ok: true };
  const oSlate = outcomes[7] || { ok: true };
  const oPk = outcomes[8] || { ok: true };
  const oCard = outcomes[9] || { ok: true };
  const oKSim = outcomes[10] || { ok: true };
  const oHitsV2 = outcomes[11] || { ok: true };
  const oHSim = outcomes[12] || { ok: true };
  const oStreak = outcomes[13] || { ok: true };
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
    'Sim Engine (Pitcher K)',
    0,
    oKSim.ok ? mlbTabDataRowsBelowHeader3_(ss, MLB_PITCHER_K_SIM_TAB) : 0,
    oKSim.ok ? '' : oKSim.err || 'failed'
  );
  logStep_(
    'Batter Hits v2 card (LIVE h.v2-full)',
    0,
    oHitsV2.ok ? mlbTabDataRowsBelowHeader3_(ss, MLB_BATTER_HITS_V2_CARD_TAB) : 0,
    oHitsV2.ok ? '' : oHitsV2.err || 'failed'
  );
  logStep_(
    'Sim Engine (Batter Hits)',
    0,
    oHSim.ok ? mlbTabDataRowsBelowHeader3_(ss, MLB_BATTER_HITS_SIM_TAB) : 0,
    oHSim.ok ? '' : oHSim.err || 'failed'
  );
  logStep_(
    'Streak picks (streak.v1)',
    0,
    oStreak.ok ? mlbTabDataRowsBelowHeader3_(ss, MLB_STREAK_PICKS_TAB) : 0,
    oStreak.ok ? '' : oStreak.err || 'failed'
  );
  logStep_(
    'MLB Bet Card',
    0,
    oBet.ok
      ? (typeof mlbBetCardPlayStats_ === 'function' ? mlbBetCardPlayStats_().picks : mlbTabDataRowsBelowHeader3_(ss, MLB_BET_CARD_TAB))
      : 0,
    oBet.ok ? '' : oBet.err || 'failed'
  );

  mlbAppendPitcherKNearMisses_(ss);

  // Band D broker: snapshot durable even when Band E workers fail.
  if (oBet.ok) {
    try {
      snapshotMLBBetCardToLog(windowTag);
    } catch (e) {
      addPipelineWarning_('Results snapshot: ' + (e.message || e));
    }
  }

  // h.v1 shadow snapshot retired 2026-05-20 along with the v1 hits card.
  // The historical 🧪 MLB_Results_Log_v2 rows remain readable; no new
  // rows will be appended. Compare panels for h.v1 will freeze accordingly.

  // Hits v3 shadow snapshot — reads the h.v3-contact card, writes 🧪 MLB_Results_Log_Hits_v3.
  const oHitsV3 = outcomes.filter(function (o) { return o.name.indexOf('Hits v3') !== -1; })[0] || { ok: false };
  if (oHitsV3.ok && typeof snapshotMLBHitsV3BetCardToLog === 'function') {
    try {
      snapshotMLBHitsV3BetCardToLog(windowTag);
    } catch (e) {
      addPipelineWarning_('Hits v3 shadow snapshot: ' + (e.message || e));
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

  // Band E workers — analytics / calibration (non-blocking).
  try {
    refreshBetCardCalibration();
  } catch (e) {
    addPipelineWarning_('Bet card calibration: ' + (e.message || e));
  }

  if (windowTag === 'FINAL' && oOdds.ok) {
    try {
      mlbBackfillResultsLogClosingK_(ss);
    } catch (e) {
      addPipelineWarning_('Closing K backfill: ' + (e.message || e));
    }
  }

  mlbAppendBetCardPipelineCoverage_(ss);

  // Auto-refresh the 📊 Project_Status dashboard so it always reflects
  // the latest snapshot / grading state without a manual click.
  try {
    if (typeof refreshProjectStatus === 'function') refreshProjectStatus();
  } catch (e) {
    addPipelineWarning_('Project Status refresh: ' + (e.message || e));
  }

  if (windowTag === 'FINAL' && typeof runPitcherDataDiagnostic === 'function') {
    try {
      runPitcherDataDiagnostic();
    } catch (e) {
      addPipelineWarning_('Pitcher diagnostic: ' + (e.message || e));
    }
  }

  if (windowTag === 'FINAL' && typeof refreshMLBProfitabilityReport === 'function') {
    try {
      refreshMLBProfitabilityReport();
    } catch (e) {
      addPipelineWarning_('Profitability report: ' + (e.message || e));
    }
  }

  if (windowTag === 'FINAL' && typeof mlbWriteCalibrationProposals_ === 'function') {
    try {
      mlbWriteCalibrationProposals_(ss, getConfig());
    } catch (e) {
      addPipelineWarning_('Calibration proposals: ' + (e.message || e));
    }
  }

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
    const build =
      typeof mlbAppsScriptBuild_ === 'function' ? mlbAppsScriptBuild_() : '';
    const buildSuffix = build !== '' && build != null ? ' · build ' + build : '';
    ss.toast(
      'Done ' + windowTag + ' in ' + ((Date.now() - start) / 1000).toFixed(1) + 's — ' + tip + buildSuffix,
      'MLB-BOIZ',
      10
    );
  } catch (e) {
    ss.toast('Done in ' + ((Date.now() - start) / 1000).toFixed(1) + 's', 'MLB-BOIZ', 8);
  }
  try {
    ss.getSheetByName(MLB_BET_CARD_TAB).activate();
  } catch (e) {}
}
