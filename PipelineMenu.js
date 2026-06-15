// ============================================================
// 🕐 MLB-BOIZ pipeline (MVP)
// ============================================================
// Mirrors AI-BOIZ windows: morning = full refresh; midday = odds +
// downstream without re-pulling injuries; final = full refresh + lock snapshot.
// ============================================================

function onOpen() {
  const ui = SpreadsheetApp.getUi();

  // ---- Run windows (the everyday operator path) ----
  const menu = ui.createMenu('⚾ MLB-BOIZ')
    .addItem('⚙️ Build Config tab', 'buildConfigTab')
    .addSeparator()
    .addItem('🌅 Run Morning  (injuries + schedule + odds + pipeline)', 'runMorningWindowMLB')
    .addItem('📆 Run Morning for tomorrow (NY)', 'runMorningForTomorrowNY_')
    .addItem('🌤 Run Midday  (odds + pipeline, injuries unchanged)', 'runMiddayWindowMLB')
    .addItem('🔒 Run Final  (full refresh + snapshot)', 'runFinalWindowMLB')
    .addItem('🚑 Re-check health signals (card players)', 'mlbFlagBetCardHealthSignals_')
    .addItem('🎯 Refresh Hit Machine (shadow parlay)', 'refreshHitMachine_')
    .addItem('🎴 Refresh Game Cards', 'refreshMLBGameCards')
    .addItem('🎴 Open Game Cards (web)', 'mlbOpenGameCardsApp_')
    .addItem('🎴 Open Game Cards (tab)', 'mlbActivateGameCardsTab_')
    .addItem('🔗 Show shareable Game Cards link', 'mlbShowGameCardsWebUrl_')
    .addItem('🧪 Open Hits v4 shadow log', 'mlbActivateHitsV4LogTab_')
    .addItem('🧪 Test Savant arsenal fetch (A vs B)', 'mlbTestArsenalFetch_')
    .addItem('🌙 Night Audit (grade + close-out — no rebuilds)', 'runNightAuditMLB')
    .addSeparator();

  // ---- Calibration & profitability (analytics on graded logs) ----
  menu.addSubMenu(
    ui.createMenu('📊 Calibration & Profit')
      .addItem('▶ Run full calibration suite (in order)', 'mlbRunAllCalibration_')
      .addSeparator()
      .addItem('💰 Refresh profitability report', 'refreshMLBProfitabilityReport')
      .addItem('💰 Open profitability report', 'mlbActivateProfitabilityTab_')
      .addItem('🎯 Refresh Bet Card calibration', 'refreshBetCardCalibration')
      .addItem('🎯 Open Bet Card calibration', 'mlbActivateCalibrationTab_')
      .addItem('🎯 Run K walk-forward (builds K_Calibration)', 'runKWalkForwardBacktest')
      .addItem('✅ Apply calibration → Config', 'mlbApplyCalibrationProposals_')
      .addSeparator()
      .addItem('🔍 Diagnose Bet Card funnel (K + H)', 'diagnoseBetCardFunnel_')
      .addItem('🔍 Diagnose Hits → Bet Card inclusion', 'diagnoseHitsBetCardInclusion')
      .addItem('🔬 Run gate backtest (legacy logged P)', 'runGateBacktest')
      .addItem('🔬 Run sim-era gate backtest', 'runSimGateBacktest')
      .addItem('🔬 Open sim gate backtest', 'mlbActivateSimGateBacktestTab_')
  );

  // ---- Advanced K walk-forward engine ----
  menu.addSubMenu(
    ui.createMenu('🔬 K Walk-Forward (advanced)')
      .addItem('🧪 Run K walk-forward backtest', 'runKWalkForwardBacktest')
      .addItem('🧪 Open K Walk-Forward Report', 'mlbActivateKWalkForwardReportTab_')
      .addItem('🧪 Open K Discrepancy Report', 'mlbActivateKWalkDiscrepancyTab_')
      .addItem('🧪 Open K Segment Miner', 'mlbActivateKWalkSegmentMinerTab_')
      .addItem('🎯 Open K Segment Registry', 'mlbActivateKSegmentRegistryTab_')
      .addSeparator()
      .addItem('🧠 Claude deep dive (discrepancies)', 'runMLBKDeepDiveOnDiscrepancies')
      .addItem('🧠 Claude deep dive (live K card)', 'runMLBKDeepDiveOnLiveKCard')
      .addItem('🧠 Open K Deep Dive tab', 'mlbActivateKDeepDiveTab_')
      .addItem('🔌 Test Anthropic connection', 'mlbTestAnthropicConnection_')
      .addSeparator()
      .addItem('🗄️ Build Pitcher K Logs (slate only)', 'refreshPitcherKLogsDB')
      .addItem('🗄️ Build Pitcher K Cache (league pool)', 'buildPitcherKIdCache')
      .addItem('⏳ Start season K dump (clear + overnight)', 'startPitcherKLogsSeasonDumpClear_')
      .addItem('⏳ Resume season K dump (append)', 'startPitcherKLogsSeasonDumpResume_')
      .addItem('⏹ Stop season K dump triggers', 'stopPitcherKLogsSeasonDump')
      .addItem('📊 Open season K dump status', 'pitcherKLogsDumpStatusMenu_')
      .addItem('🔄 Backfill K Logs context cols', 'mlbBackfillPitcherKLogsContext_')
      .addItem('📏 Backfill K Logs proj IP vs actual', 'backfillPitcherKLogsProjIp')
      .addSeparator()
      .addItem('🎯 Seed registry from miner (disabled)', 'mlbSeedSegmentsFromMiner_')
      .addItem('🎯 Seed segment registry (disabled)', 'mlbSeedKSegmentsFromReport_')
      .addItem('✅ Run K walk-forward self-test', 'mlbKWalkSelfTestMenu_')
      .addItem('✅ Run Savant ingest self-test', 'mlbSavantIngestSelfTestMenu_')
      .addItem('✅ Run Statcast cache self-test', 'mlbStatcastCacheSelfTestMenu_')
  );

  menu.addSeparator();

  // ---- Per-model builders (queue → card → open) ----
  menu.addSubMenu(
    ui.createMenu('🎰 Pitcher models')
      .addItem('📋 Build Pitcher K queue', 'refreshPitcherKSlateQueue')
      .addItem('🎰 Build Pitcher K card', 'refreshPitcherKBetCard')
      .addItem('⚡ Build Pitcher K sim', 'refreshPitcherKSimEngine_')
      .addSeparator()
      .addItem('📋 Build Pitcher Outs queue', 'refreshPitcherOutsSlateQueue')
      .addItem('🔩 Build Pitcher Outs card', 'refreshPitcherOutsBetCard')
      .addItem('🔩 Open Pitcher Outs card', 'mlbActivatePitcherOutsCardTab_')
      .addSeparator()
      .addItem('📋 Build Pitcher ER queue', 'refreshPitcherERSlateQueue')
      .addItem('💧 Build Pitcher ER card', 'refreshPitcherERBetCard')
      .addItem('💧 Open Pitcher ER card', 'mlbActivatePitcherERCardTab_')
      .addSeparator()
      .addItem('📒 Build Pitcher game logs', 'refreshMLBPitcherGameLogs')
      .addItem('📏 Backfill K Logs proj IP vs actual', 'backfillPitcherKLogsProjIp')
      .addItem('🩺 Diagnose pitcher data (schedule → models)', 'runPitcherDataDiagnostic')
  );

  menu.addSubMenu(
    ui.createMenu('🥎 Batter models')
      .addItem('🧪 Build Batter Hits v2 card (LIVE h.v2-full)', 'refreshBatterHitsV2BetCard')
      .addItem('⚡ Build Batter Hits sim (anchored h.v2)', 'refreshBatterHitsSimEngine_')
      .addItem('📋 Build Batter Hits queue', 'refreshBatterHitsSlateQueue')
      .addItem('🎯 Build Batter Hits card (v1 legacy)', 'refreshBatterHitsBetCard')
  );

  menu.addSubMenu(
    ui.createMenu('🌅 Team totals (NRFI / F5 / Early Win)')
      .addItem('📋 Build NRFI queue', 'refreshNrfiSlateQueue')
      .addItem('🌅 Build NRFI card', 'refreshNrfiBetCard')
      .addItem('🌅 Open NRFI card', 'mlbActivateNrfiCardTab_')
      .addSeparator()
      .addItem('📋 Build F5 queue', 'refreshF5SlateQueue')
      .addItem('⚾ Build F5 card', 'refreshF5BetCard')
      .addItem('⚾ Open F5 card', 'mlbActivateF5CardTab_')
      .addSeparator()
      .addItem('🎟️ Build Early Win card', 'refreshMLBEarlyWinCard')
      .addItem('🎟️ Open Early Win card', 'mlbActivateEarlyWinTab_')
  );

  menu.addSubMenu(
    ui.createMenu('🃏 Bet Card & slate')
      .addItem('🃏 Build MLB Bet Card', 'refreshMLBBetCard')
      .addItem('🎯 Build Slate board', 'refreshMLBSlateBoard')
      .addItem('🚑 Build Injury report', 'fetchMLBInjuryReport')
  );

  // ---- Results, grading & dashboards ----
  menu.addSubMenu(
    ui.createMenu('📈 Results & grading')
      .addItem('📊 Grade pending results (boxscore)', 'gradeMLBPendingResults_')
      .addItem('📈 Backfill closing K (Results Log)', 'mlbBackfillClosingMenu_')
      .addItem('📏 Backfill K Logs proj IP vs actual', 'backfillPitcherKLogsProjIp')
      .addItem('💵 Backfill historical stake + P/L', 'mlbBackfillStakesMenu_')
      .addSeparator()
      .addItem('📋 Open Pipeline Log', 'mlbActivatePipelineLog_')
      .addItem('📊 Open Pipeline Timings', 'mlbActivatePipelineTimingsTab_')
      .addItem('📊 Refresh Project Status', 'refreshProjectStatus')
      .addItem('📊 Open Project Status', 'mlbActivateProjectStatusTab_')
      .addItem('🩺 Diagnose HR + Grand Slam tab', 'runHRSlamDiagnostic')
  );

  menu.addSeparator();

  // ---- Shadow models & promos ----
  menu.addSubMenu(
    ui.createMenu('🧪 Shadow: Hits h.v1')
      .addItem('🎯 Build Batter Hits v2 LIVE card', 'refreshBatterHitsV2BetCard')
      .addItem('🧪 Snapshot shadow card → log (MIDDAY)', 'mlbSnapshotHitsV2Midday_')
      .addItem('📊 Grade pending shadow hits rows', 'gradeMLBHitsV2PendingResults_')
      .addItem('🔬 Diagnose shadow Results Log', 'mlbDiagnoseHitsV2Log_')
      .addItem('🧪 Test grade ONE shadow row', 'mlbTestGradeOneHitsV2Row_')
      .addItem('🩺 Run grader self-test (feed/live)', 'mlbGraderSelfTestMenu_')
      .addItem('🔬 Refresh Hits Model Compare', 'refreshHitsModelCompare')
      .addItem('🔬 Open Hits Model Compare', 'mlbActivateHitsCompareTab_')
      .addItem('🧪 Open shadow Results Log', 'mlbActivateHitsV2LogTab_')
      .addSeparator()
      .addItem('🔬 Refresh feature-ablation backtest', 'refreshHitsFeatureAblation')
      .addItem('🔬 Open feature-ablation tab', 'mlbActivateHitsAblationTab_')
  );

  menu.addSubMenu(
    ui.createMenu('🧪 Shadow: Hits h.v3-contact')
      .addItem('🧪 Build Batter Hits v3 card', 'refreshBatterHitsV3BetCard')
      .addItem('🧪 Snapshot Hits v3 card → log (MIDDAY)', 'mlbSnapshotHitsV3Midday_')
      .addItem('📊 Grade pending Hits v3 rows', 'gradeMLBHitsV3PendingResults_')
      .addItem('🧪 Open Hits v3 Results Log', 'mlbActivateHitsV3LogTab_')
  );

  menu.addSubMenu(
    ui.createMenu('📣 HR Promo')
      .addItem('📣 Build HR Promo tab (rebuild picks)', 'refreshBatterHrPromoSheet_')
      .addItem('📋 Snapshot HR picks → log', 'mlbSnapshotHrPromoMidday_')
      .addItem('📊 Grade pending HR promo rows', 'gradeHrPromoPendingResults_')
      .addItem('📋 Open HR Promo tab', 'mlbActivateHrPromoTab_')
      .addItem('📋 Open HR Promo Results Log', 'mlbActivateHrPromoResultsLogTab_')
      .addSeparator()
      .addItem('🔬 Refresh HR promo feature-ablation', 'refreshHrPromoFeatureAblation')
      .addItem('🔬 Open HR promo ablation tab', 'mlbActivateHrPromoAblationTab_')
  );

  menu.addSubMenu(
    ui.createMenu('💎 GS Promo')
      .addItem('💎 Build GS Promo tab (rebuild picks)', 'refreshBatterGsPromoSheet_')
      .addItem('📋 Open GS Promo tab', 'mlbActivateGsPromoTab_')
  );

  menu.addSubMenu(
    ui.createMenu('🔥 Streak Picks')
      .addItem('🔥 Build Streak picks (re-rank v2 + SP K/9)', 'refreshStreakPicks')
      .addItem('📋 Open Streak Picks tab', 'mlbActivateStreakPicksTab_')
  );

  menu.addSubMenu(
    ui.createMenu('🌅 NRFI / ⚾ F5 logs')
      .addItem('📋 Snapshot NRFI picks → log', 'mlbSnapshotNrfiMidday_')
      .addItem('📊 Grade pending NRFI rows', 'gradeNrfiPendingResults_')
      .addItem('📋 Open NRFI Results Log', 'mlbActivateNrfiResultsLogTab_')
      .addSeparator()
      .addItem('📋 Snapshot F5 picks → log', 'mlbSnapshotF5Midday_')
      .addItem('📊 Grade pending F5 rows', 'gradeF5PendingResults_')
      .addItem('📋 Open F5 Results Log', 'mlbActivateF5ResultsLogTab_')
  );

  menu.addToUi();
}

/** Rebuild ⚾ MLB-BOIZ menu after clasp push (run once from Apps Script if menu looks stale). */
function refreshMLBBoizMenu() {
  onOpen();
}

/**
 * One-click calibration refresh — runs the full analytics/calibration suite in
 * order against the current graded logs. Each step is independent and wrapped so
 * one failure does not abort the rest; a summary dialog shows OK/FAIL per step.
 *
 * Order:
 *   1. Grade pending results            → 📋 MLB_Results_Log up to date
 *   2. Profitability report             → 💰 Profitability_Report
 *   3. Bet Card calibration             → 🎯 Bet_Card_Calibration
 *   4. K walk-forward backtest          → 🎯 K_Calibration + 🧪 K_Discrepancy_Report
 *                                          + 🧪 K_Segment_Miner + 🧪 K_WalkForward_Report
 *   5. Claude deep dive (discrepancies) → 🧠 K_Deep_Dive (skipped if no API key)
 */
function mlbRunAllCalibration_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();
  const results = [];

  function stepCal_(label, fn) {
    const t0 = Date.now();
    try {
      ss.toast('Calibration: ' + label, 'MLB-BOIZ', 8);
    } catch (e) {}
    try {
      fn();
      results.push('OK   ' + label + '  (' + ((Date.now() - t0) / 1000).toFixed(1) + 's)');
    } catch (e) {
      results.push('FAIL ' + label + ' — ' + (e && e.message ? e.message : e));
    }
  }

  stepCal_('1. Grade pending results', function () {
    if (typeof gradeMLBPendingResults_ === 'function') gradeMLBPendingResults_();
  });
  stepCal_('2. Profitability report', function () {
    if (typeof refreshMLBProfitabilityReport === 'function') refreshMLBProfitabilityReport();
  });
  stepCal_('3. Bet Card calibration', function () {
    if (typeof refreshBetCardCalibration === 'function') refreshBetCardCalibration();
  });
  stepCal_('4. K walk-forward (K_Calibration + Discrepancy + Segment Miner)', function () {
    if (typeof runKWalkForwardBacktest === 'function') runKWalkForwardBacktest();
  });
  stepCal_('5. Claude deep dive (discrepancies)', function () {
    const key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
    if (!key || !String(key).trim()) {
      throw new Error('skipped — ANTHROPIC_API_KEY not set in Script Properties');
    }
    if (typeof runMLBKDeepDiveOnDiscrepancies === 'function') runMLBKDeepDiveOnDiscrepancies();
  });

  try {
    ui.alert('🎯 Calibration suite complete', results.join('\n'), ui.ButtonSet.OK);
  } catch (e) {
    Logger.log('Calibration suite:\n' + results.join('\n'));
  }
}

/** Menu wrapper — snapshot HR promo picks with MIDDAY tag. */
function mlbSnapshotHrPromoMidday_() {
  if (typeof snapshotHrPromoToLog === 'function') snapshotHrPromoToLog('MIDDAY');
}

/** Menu wrapper — snapshot NRFI picks with MIDDAY tag. */
function mlbSnapshotNrfiMidday_() {
  if (typeof snapshotNrfiToLog === 'function') snapshotNrfiToLog('MIDDAY');
}

/** Menu wrapper — snapshot F5 picks with MIDDAY tag. */
function mlbSnapshotF5Midday_() {
  if (typeof snapshotF5ToLog === 'function') snapshotF5ToLog('MIDDAY');
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

/**
 * 🌙 Night Audit — POST-LOCK rules: grade and close out the day; never build.
 * - NO ingestion, NO card/queue rebuilds, NO tab clears — late-night markets
 *   are pulled, so a rebuild can only produce ghost boards.
 * - All graders (incl. Hit Machine) under a LARGE budget
 *   (NIGHT_GRADER_BUDGET_SEC, default 1200s): nothing competes for runtime
 *   at night, so this is when the regrade backlog drains fastest.
 * - Closing backfills are no-clobber by design — with markets pulled they
 *   simply leave the last pre-pitch capture standing as the close.
 * - Ends with profitability + calibration + proposals + Project Status and
 *   a day-summary toast.
 * Run from the menu late evening, or attach a time-driven trigger
 * (~11:30 PM NY) to runNightAuditMLB in the Apps Script UI.
 */
function runNightAuditMLB() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const nightLock = LockService.getScriptLock();
  if (!nightLock.tryLock(30000)) {
    try { ss.toast('Another pipeline run is still active — night audit skipped', 'MLB-BOIZ', 8); } catch (e) {}
    return;
  }
  const start = Date.now();
  resetPipelineLog_('NIGHT');
  if (typeof mlbBeginPipelineTimings_ === 'function') mlbBeginPipelineTimings_('NIGHT');
  try {
    const selfTest = mlbGraderSelfTest_();
    if (!selfTest.ok) addPipelineWarning_('GRADER SELF-TEST FAILED — ' + selfTest.note);
  } catch (e) {
    addPipelineWarning_('Grader self-test threw: ' + (e.message || e));
  }
  if (typeof mlbResetBoxscoreJsonCache_ === 'function') mlbResetBoxscoreJsonCache_();

  function timedNight(name, fn) {
    const t0 = Date.now();
    let okFlag = true;
    let errMsg = '';
    try {
      if (typeof fn === 'function') fn();
    } catch (e) {
      okFlag = false;
      errMsg = String(e.message || e);
      addPipelineWarning_('🌙 ' + name + ': ' + errMsg);
    }
    if (typeof mlbFlushPipelineStepTiming_ === 'function') {
      mlbFlushPipelineStepTiming_('night: ' + name, (Date.now() - t0) / 1000, okFlag, errMsg);
    }
  }

  const cfg = getConfig();
  const budget = parseFloat(String(cfg['NIGHT_GRADER_BUDGET_SEC'] != null ? cfg['NIGHT_GRADER_BUDGET_SEC'] : '1200')) || 1200;
  if (typeof mlbArmGraderBandDeadline_ === 'function') mlbArmGraderBandDeadline_(budget);
  timedNight('K (live)',       typeof gradeMLBPendingResults_       === 'function' ? gradeMLBPendingResults_       : null);
  timedNight('H v2 (shadow)',  typeof gradeMLBHitsV2PendingResults_ === 'function' ? gradeMLBHitsV2PendingResults_ : null);
  timedNight('H v3 (shadow)',  typeof gradeMLBHitsV3PendingResults_ === 'function' ? gradeMLBHitsV3PendingResults_ : null);
  timedNight('H v4 (shadow)',  typeof gradeMLBHitsV4PendingResults_ === 'function' ? gradeMLBHitsV4PendingResults_ : null);
  timedNight('TB v2 (shadow)', typeof gradeMLBTBV2PendingResults_   === 'function' ? gradeMLBTBV2PendingResults_   : null);
  timedNight('TB v3 (shadow)', typeof gradeMLBTBV3PendingResults_   === 'function' ? gradeMLBTBV3PendingResults_   : null);
  timedNight('HR promo',       typeof gradeHrPromoPendingResults_   === 'function' ? gradeHrPromoPendingResults_   : null);
  timedNight('NRFI',           typeof gradeNrfiPendingResults_      === 'function' ? gradeNrfiPendingResults_      : null);
  timedNight('F5',             typeof gradeF5PendingResults_        === 'function' ? gradeF5PendingResults_        : null);
  timedNight('Hit Machine',    typeof gradeHitMachinePendingResults_ === 'function' ? gradeHitMachinePendingResults_ : null);
  if (typeof mlbDisarmGraderBandDeadline_ === 'function') mlbDisarmGraderBandDeadline_();

  timedNight('Closing backfills', function () {
    mlbBackfillResultsLogClosingK_(ss);
    if (typeof mlbBackfillNrfiClosing_ === 'function') mlbBackfillNrfiClosing_(ss);
    if (typeof mlbBackfillF5Closing_ === 'function') mlbBackfillF5Closing_(ss);
  });
  timedNight('Profitability report', typeof refreshMLBProfitabilityReport === 'function' ? refreshMLBProfitabilityReport : null);
  timedNight('Bet card calibration', typeof refreshBetCardCalibration === 'function' ? refreshBetCardCalibration : null);
  timedNight('Calibration proposals', function () {
    if (typeof mlbWriteCalibrationProposals_ === 'function') mlbWriteCalibrationProposals_(ss, getConfig());
  });
  timedNight('Project status', typeof refreshProjectStatus === 'function' ? refreshProjectStatus : null);

  writePipelineLogTab_(ss);
  try {
    const build = typeof mlbAppsScriptBuild_ === 'function' ? mlbAppsScriptBuild_() : '';
    ss.toast(
      '🌙 Night audit done in ' + ((Date.now() - start) / 1000).toFixed(1) +
      's — day graded + closed out. See 💰 Profitability_Report.' + (build !== '' ? ' · build ' + build : ''),
      'MLB-BOIZ',
      10
    );
  } catch (e) {}
  try {
    nightLock.releaseLock();
  } catch (e) {}
}

/** Menu: fill close_line / close_odds / clv_note from current ✅ tab for this slate’s log rows. */
function mlbBackfillClosingMenu_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const n = mlbBackfillResultsLogClosingK_(ss);
  const nN = typeof mlbBackfillNrfiClosing_ === 'function' ? mlbBackfillNrfiClosing_(ss) : 0;
  const nF = typeof mlbBackfillF5Closing_ === 'function' ? mlbBackfillF5Closing_(ss) : 0;
  try {
    ss.toast('Close capture: ' + n + ' prop · ' + nN + ' NRFI · ' + nF + ' F5 row(s)', 'MLB-BOIZ', 7);
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
  // One window at a time. Overlapping runs (slow morning run + midday
  // trigger, two operators, etc.) interleave clearContents()+rebuild on
  // shared tabs and trample the per-run caches. Wait up to 30s, then bail
  // loudly rather than corrupt tabs mid-rebuild. GAS auto-releases the lock
  // when the execution ends, so a crashed run can't wedge the pipeline.
  const windowLock = LockService.getScriptLock();
  if (!windowLock.tryLock(30000)) {
    try {
      ss.toast('Another pipeline window is still running — skipped ' + windowTag, 'MLB-BOIZ', 10);
    } catch (eToast) {}
    Logger.log('runMLBBallWindow_(' + windowTag + '): script lock busy — skipped');
    return;
  }
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
  // Band-wide time budget — K (live) runs first so the live market always
  // grades before shadow backlogs; whatever doesn't fit resumes next window.
  if (typeof mlbArmGraderBandDeadline_ === 'function') {
    mlbArmGraderBandDeadline_(getConfig()['GRADER_BAND_BUDGET_SEC']);
  }
  timedGrader('K (live)',       typeof gradeMLBPendingResults_       === 'function' ? gradeMLBPendingResults_       : null);
  timedGrader('H v2 (shadow)',  typeof gradeMLBHitsV2PendingResults_ === 'function' ? gradeMLBHitsV2PendingResults_ : null);
  timedGrader('H v3 (shadow)',  typeof gradeMLBHitsV3PendingResults_ === 'function' ? gradeMLBHitsV3PendingResults_ : null);
  timedGrader('H v4 (shadow)',  typeof gradeMLBHitsV4PendingResults_ === 'function' ? gradeMLBHitsV4PendingResults_ : null);
  // TB graders were never wired in — the TB shadow logs sat PENDING forever,
  // so the "promote shadow after 100+ graded" bar could never be met. Cheap
  // once backlog clears: graders skip rows that already hold a final result.
  timedGrader('TB v2 (shadow)', typeof gradeMLBTBV2PendingResults_   === 'function' ? gradeMLBTBV2PendingResults_   : null);
  timedGrader('TB v3 (shadow)', typeof gradeMLBTBV3PendingResults_   === 'function' ? gradeMLBTBV3PendingResults_   : null);
  timedGrader('HR promo',       typeof gradeHrPromoPendingResults_   === 'function' ? gradeHrPromoPendingResults_   : null);
  timedGrader('NRFI',         typeof gradeNrfiPendingResults_     === 'function' ? gradeNrfiPendingResults_     : null);
  timedGrader('F5',           typeof gradeF5PendingResults_       === 'function' ? gradeF5PendingResults_       : null);
  timedGrader('Hit Machine (shadow)', typeof gradeHitMachinePendingResults_ === 'function' ? gradeHitMachinePendingResults_ : null);
  if (typeof mlbDisarmGraderBandDeadline_ === 'function') mlbDisarmGraderBandDeadline_();
  mlbResetPitchGameLogFetchCache_();
  mlbResetPitchHandCache_();
  mlbResetTeamHittingSeasonCache_();
  if (typeof mlbResetSavantCaches_ === 'function') {
    mlbResetSavantCaches_();
  } else {
    mlbResetSavantAbsCache_();
  }
  if (typeof mlbResetStatcastCaches_ === 'function') {
    mlbResetStatcastCaches_();
  }
  // Shared batter/pitcher fetch cache reset ONCE per slate. Individual
  // model resets must NOT wipe this (Hits v2 → Hits v3 share the cache).
  if (typeof mlbResetV3SharedFetchesCaches_ === 'function') mlbResetV3SharedFetchesCaches_();
  if (typeof mlbResetBoxscoreJsonCache_ === 'function') mlbResetBoxscoreJsonCache_();
  // Schedule block cache — read once after fetchMLBScheduleForSlate writes
  // the tab. All per-batter card lookups (home abbr, matchup, opp SP) hit
  // this in-memory array instead of re-reading the sheet hundreds of times.
  if (typeof mlbResetScheduleBlockCache_ === 'function') mlbResetScheduleBlockCache_();
  if (typeof mlbResetLineupsCache_ === 'function') mlbResetLineupsCache_();
  if (typeof mlbResetArsenalCaches_ === 'function') mlbResetArsenalCaches_();
  if (typeof mlbResetHitMachineCaches_ === 'function') mlbResetHitMachineCaches_();
  let savantTeamCount = -1;
  let statcastProfileCounts = { pitchers: 0, batters: 0, skipped: true };
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
  // Staleness guard: if the odds fetch failed/returned nothing, the ✅ tab
  // still holds a previous slate — and in a 3-4 game series those matchup
  // labels join today's queues perfectly, pricing bets against lines that no
  // longer exist. Clearing is the honest state: no odds → fd_*_miss flags and
  // zero picks this window; the next successful window repopulates.
  step('Odds staleness guard', function () {
    // FRESH config read — the window-start `cfg` snapshot predates the
    // Config step, which can rewrite SLATE_DATE (it reset a stale Date cell
    // to today on 6/11 while this guard still held the 6/10 snapshot and
    // cleared the morning's perfectly fresh tabs).
    const slate = getSlateDateString_(getConfig());
    if (typeof mlbOddsTabIsForSlate_ === 'function' && !mlbOddsTabIsForSlate_(ss, slate)) {
      const oddsSh = ss.getSheetByName(MLB_ODDS_CONFIG.tabName);
      if (oddsSh && oddsSh.getLastRow() >= 4) {
        oddsSh.clearContents();
        addPipelineWarning_(
          '✅ odds tab held a different slate than ' + slate +
          ' — CLEARED so stale series prices cannot join today\'s queues (no odds = no picks this window)'
        );
      } else {
        addPipelineWarning_('✅ odds tab empty for ' + slate + ' — queues will flag fd_*_miss');
      }
    }
    if (typeof mlbScheduleTabIsForSlate_ === 'function' && !mlbScheduleTabIsForSlate_(ss, slate)) {
      const schSh = ss.getSheetByName(MLB_SCHEDULE_TAB);
      if (schSh && schSh.getLastRow() >= 4) {
        schSh.clearContents();
        if (typeof mlbResetScheduleBlockCache_ === 'function') mlbResetScheduleBlockCache_();
        addPipelineWarning_(
          '📅 schedule tab held a different slate than ' + slate +
          ' — CLEARED so queues cannot build bets against finished games'
        );
      }
    }
  });
  step('Savant ingest (optional)', function () {
    savantTeamCount = mlbSavantAbsIngestBestEffort_();
    if (typeof mlbStatcastIngestProfilesBestEffort_ === 'function') {
      statcastProfileCounts = mlbStatcastIngestProfilesBestEffort_();
    }
  });
  // Arsenal CSVs (2 fetches, best-effort) — feeds 🎯 Hit Machine matchup
  // scores. Failure degrades to blank scores; never blocks the window.
  step('Arsenal ingest (Savant)', function () {
    if (typeof mlbArsenalIngestBestEffort_ !== 'function') return;
    const res = mlbArsenalIngestBestEffort_();
    if (res.p === 0 || res.b === 0) {
      const d = res.diag || {};
      const why = (d.pitcher ? 'P:HTTP' + d.pitcher.code + '/' + d.pitcher.reason : '') +
        (d.batter ? ' B:HTTP' + d.batter.code + '/' + d.batter.reason : '');
      addPipelineWarning_('Arsenal ingest: pitcher=' + res.p + ' batter=' + res.b + ' rows — ' + why +
        ' — 🎯 matchup scores blank; if blocked use hosted CSV (ARSENAL_*_CSV_URL)');
    }
  });
  step('Slate board (join)', refreshMLBSlateBoard);
  step('Pitcher K queue', refreshPitcherKSlateQueue);
  step('Pitcher K card', refreshPitcherKBetCard);
  step('Sim Engine (Pitcher K)', refreshPitcherKSimEngine_);
  step('Pitcher Outs queue', refreshPitcherOutsSlateQueue);
  step('Pitcher Outs card', refreshPitcherOutsBetCard);
  step('Pitcher ER queue', refreshPitcherERSlateQueue);
  step('Pitcher ER card', refreshPitcherERBetCard);
  step('NRFI queue', refreshNrfiSlateQueue);
  step('NRFI card', refreshNrfiBetCard);
  step('F5 queue', refreshF5SlateQueue);
  step('F5 card', refreshF5BetCard);
  // TB v1/v2/v3 retired from pipeline 2026-05-21 (losing market + API budget).
  // Source files remain for manual rebuild via Apps Script editor if needed.
  step('Batter Hits v2 card (LIVE h.v2-full)', refreshBatterHitsV2BetCard);
  step('Sim Engine (Batter Hits)', refreshBatterHitsSimEngine_);
  // --- Band D publish (broker): streak + bet card must succeed for operator ---
  // Streak picks must run BEFORE the Bet Card so the formatter can read 🔥
  // Streak_Picks to drive the yellow Streak highlight.
  step('Streak picks (streak.v1)', refreshStreakPicks);
  step('MLB Bet Card', refreshMLBBetCard);
  // Funnel diagnostic must run AFTER the Bet Card so it can compare its own
  // gate tally against mlbBetCardPlayStats_() and surface miscount drift.
  // Outcome lookups below are name-based, so step insertions here are safe.
  step('Bet Card funnel diagnostic', diagnoseBetCardFunnel_);
  // 🚑 Health signals AFTER the card builds: scratch detection (batter out of
  // a confirmed lineup / probable changed) + soft-injury news sweep for card
  // players. Signal-only — red cell + 🚑 flag + hover note; never auto-gates.
  step('Health signals (🚑)', function () {
    if (typeof mlbFlagBetCardHealthSignals_ === 'function') mlbFlagBetCardHealthSignals_();
  });
  // 🎯 Hit Machine (SHADOW): 2-leg 1+H parlay board + paper log. Runs after
  // health signals so lineup-confirmed state is as fresh as possible.
  step('Hit Machine (shadow)', function () {
    if (typeof refreshHitMachine_ === 'function') refreshHitMachine_();
  });
  // 🎴 Game Cards reads NRFI + K sim + Hits v3 + the Hit Machine board, so it
  // runs last. Display-only; failure can't affect any bet surface.
  step('Game Cards', function () {
    if (typeof refreshMLBGameCards === 'function') refreshMLBGameCards();
  });
  // Early Win card reads ✅ FanDuel_MLB_Odds (h2h) + 📅 MLB_Schedule, both
  // already built above. Cheap (~1s) and runs daily even when card is empty,
  // because the DK token resets every morning regardless of slate.
  step('Early Win card', refreshMLBEarlyWinCard);
  // --- Band E workers (shadow/promo/analytics) — isolated try/catch below ---
  step('Batter HR Promo refresh', refreshBatterHrPromoSheet_);
  // Hits v3 must run AFTER Streak (already built above) for its streak overlap mult.
  step('Batter Hits v3 card (shadow h.v3-contact)', refreshBatterHitsV3BetCard);
  // GS Promo reuses the HR-promo row builder, so it must run AFTER the HR refresh.
  step('Batter GS Promo refresh', refreshBatterGsPromoSheet_);

  // Name-based outcome lookup. The old fixed outcomes[N] indices silently
  // broke when the Outs/ER/NRFI/F5 steps were inserted (everything ≥11
  // shifted by 8): four Pipeline_Log rows reported the wrong step's OK/FAIL
  // and the Results Log snapshot below was gated on the *Pitcher ER card*
  // instead of the Bet Card. Prefix match so suffixed variants
  // ("MLB injuries (ESPN)" / "(unchanged)") resolve to one lookup name.
  function outcomeByName(prefix) {
    const hit = outcomes.filter(function (o) { return String(o.name).indexOf(prefix) === 0; })[0];
    return hit || { ok: true };
  }
  const oCfg = outcomeByName('Config');
  const oInj = outcomeByName('MLB injuries');
  const oSch = outcomeByName('MLB schedule');
  const oGameLogs = outcomeByName('Pitcher game logs');
  const oOdds = outcomeByName('FanDuel MLB odds');
  const oSavant = outcomeByName('Savant ingest');
  const oSlate = outcomeByName('Slate board');
  const oPk = outcomeByName('Pitcher K queue');
  const oCard = outcomeByName('Pitcher K card');
  const oKSim = outcomeByName('Sim Engine (Pitcher K)');
  const oHitsV2 = outcomeByName('Batter Hits v2 card');
  const oHSim = outcomeByName('Sim Engine (Batter Hits)');
  const oStreak = outcomeByName('Streak picks');
  const oBet = outcomeByName('MLB Bet Card');

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
  if (!statcastProfileCounts.skipped) {
    logStep_(
      'Statcast profiles (optional)',
      1,
      (statcastProfileCounts.pitchers || 0) + (statcastProfileCounts.batters || 0),
      'pitchers=' +
        (statcastProfileCounts.pitchers || 0) +
        ' batters=' +
        (statcastProfileCounts.batters || 0)
    );
  }
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
    if (typeof mlbSnapshotSlateProjIpFromQueue_ === 'function') {
      try {
        mlbSnapshotSlateProjIpFromQueue_();
      } catch (eIp) {
        addPipelineWarning_('K Logs proj IP snapshot: ' + (eIp.message || eIp));
      }
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

  // Hits v4 UNANCHORED shadow — recomputes P from the sim's unanchored λ
  // (gated on the Hits SIM, which oHSim tracks) and writes 🧪 …_Hits_v4.
  const oHSimV4 = outcomes.filter(function (o) { return o.name.indexOf('Sim Engine (Batter Hits)') !== -1; })[0] || { ok: false };
  if (oHSimV4.ok && typeof snapshotMLBHitsV4ToLog === 'function') {
    try {
      snapshotMLBHitsV4ToLog(windowTag);
    } catch (e) {
      addPipelineWarning_('Hits v4 shadow snapshot: ' + (e.message || e));
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

  if (typeof snapshotNrfiToLog === 'function' && ss.getSheetByName(MLB_NRFI_CARD_TAB)) {
    try {
      snapshotNrfiToLog(windowTag);
    } catch (e) {
      addPipelineWarning_('NRFI snapshot: ' + (e.message || e));
    }
  }

  if (typeof snapshotF5ToLog === 'function' && ss.getSheetByName(MLB_F5_CARD_TAB)) {
    try {
      snapshotF5ToLog(windowTag);
    } catch (e) {
      addPipelineWarning_('F5 snapshot: ' + (e.message || e));
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

  // Closing-line capture runs EVERY window with fresh odds (was FINAL-only):
  // each successful lookup overwrites toward the truest close, and misses
  // never clobber a prior capture — so the last odds refresh before first
  // pitch is what stands as the close. FINAL-only meant night games were
  // "closed" at mid-afternoon prices.
  if (oOdds.ok) {
    try {
      mlbBackfillResultsLogClosingK_(ss);
    } catch (e) {
      addPipelineWarning_('Closing backfill (K/H): ' + (e.message || e));
    }
    try {
      if (typeof mlbBackfillNrfiClosing_ === 'function') mlbBackfillNrfiClosing_(ss);
    } catch (e) {
      addPipelineWarning_('Closing backfill (NRFI): ' + (e.message || e));
    }
    try {
      if (typeof mlbBackfillF5Closing_ === 'function') mlbBackfillF5Closing_(ss);
    } catch (e) {
      addPipelineWarning_('Closing backfill (F5): ' + (e.message || e));
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
  try {
    windowLock.releaseLock();
  } catch (e) {}
}
