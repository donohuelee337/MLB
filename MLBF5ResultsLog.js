// ============================================================
// 📋 F5 Results Log — snapshots from ⚾ F5_Card (total only)
// ============================================================

const MLB_F5_RESULTS_LOG_TAB = '📋 F5_Results_Log';
const MLB_F5_RESULTS_LOG_NCOL = 25;

const MLB_F5_RESULTS_HEADERS = [
  'Logged At',
  'Slate',
  'Rank',
  'Matchup',
  'gamePk',
  'Side',
  'Line',
  'Odds',
  'p_model',
  'ev_$1',
  'lambda_total',
  'lambda_away',
  'lambda_home',
  'actual_F5_runs',
  'result',
  'grade_notes',
  'stake $',
  'pnl $',
  'bet_key',
  'Window',
  'flags',
  'away_SP',
  'home_SP',
  'close_odds',
  'clv_pp',
];

/** Cols 24/25 close_odds + clv_pp — CLV capture for the F5 market. */
function mlbEnsureF5CloseCols_(sh) {
  if (sh.getMaxColumns() < MLB_F5_RESULTS_LOG_NCOL) {
    sh.insertColumnsAfter(sh.getMaxColumns(), MLB_F5_RESULTS_LOG_NCOL - sh.getMaxColumns());
  }
  if (String(sh.getRange(3, 24).getValue() || '').trim() !== 'close_odds') {
    sh.getRange(3, 24, 1, 2).setValues([['close_odds', 'clv_pp']]);
  }
}

/**
 * Capture the closing FD price for this slate's F5 rows (same line only —
 * price CLV across different totals isn't apples-to-apples). A miss never
 * clobbers a previous capture: when FD pulls the market at first pitch, the
 * last capture stands as the close. Re-runnable after any odds refresh.
 */
function mlbBackfillF5Closing_(ss) {
  const logSh = ss.getSheetByName(MLB_F5_RESULTS_LOG_TAB);
  if (!logSh || logSh.getLastRow() < 4) return 0;
  mlbEnsureF5CloseCols_(logSh);
  const cfg = getConfig();
  const slateWant = getSlateDateString_(cfg);
  const idx = mlbBuildF5OddsIndex_(ss);
  const data = logSh.getRange(4, 1, logSh.getLastRow() - 3, MLB_F5_RESULTS_LOG_NCOL).getValues();
  let n = 0;
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if (mlbDateCellToYmd_(row[1]) !== slateWant) continue;
    const matchup = String(row[3] || '').trim();
    const side = String(row[5] || '').trim().toLowerCase();
    const line = parseFloat(String(row[6]));
    const openOdds = row[7];
    if (!matchup) continue;
    const hit = mlbLookupF5Odds_(idx, mlbCandidateGameKeys_(matchup, '', ''));
    if (!hit) continue;
    const closeLine = parseFloat(String(hit.f5Line));
    if (isNaN(line) || isNaN(closeLine) || closeLine !== line) continue;
    const american = side === 'over' ? hit.f5Over : side === 'under' ? hit.f5Under : '';
    if (american === '' || american == null) continue;
    logSh.getRange(4 + i, 24).setValue(american);
    const clvPp = mlbClvPpFromOpenClose_(openOdds, american);
    if (clvPp !== '') logSh.getRange(4 + i, 25).setValue(clvPp);
    n++;
  }
  return n;
}

function mlbEnsureF5ResultsLogLayout_(sh) {
  sh.getRange(1, 1, 1, MLB_F5_RESULTS_LOG_NCOL)
    .merge()
    .setValue('📋 F5 Results — top EV F5 total picks from ⚾ F5_Card · graded innings 1–5 runs')
    .setFontWeight('bold')
    .setBackground('#0d47a1')
    .setFontColor('#ffffff');
  sh.getRange(3, 1, 1, MLB_F5_RESULTS_LOG_NCOL)
    .setValues([MLB_F5_RESULTS_HEADERS])
    .setFontWeight('bold')
    .setBackground('#1976d2')
    .setFontColor('#ffffff');
  sh.setFrozenRows(3);
}

function mlbF5ResultKey_(slate, gamePk, side, line) {
  return [
    String(slate || '').trim(),
    String(gamePk != null ? gamePk : '').trim(),
    String(side || '')
      .trim()
      .toLowerCase(),
    String(line != null ? line : '').trim(),
  ].join('|');
}

function _mlbF5FindLogRow_(logSh, slate, gamePk, side, line) {
  if (logSh.getLastRow() < 4) return -1;
  const data = logSh.getRange(4, 1, logSh.getLastRow() - 3, MLB_F5_RESULTS_LOG_NCOL).getValues();
  const wantSlate = String(slate || '').trim();
  const wantPk = parseInt(gamePk, 10);
  const wantSide = String(side || '')
    .trim()
    .toLowerCase();
  const wantLine = String(line != null ? line : '').trim();
  for (let i = data.length - 1; i >= 0; i--) {
    const cellSlate =
      data[i][1] instanceof Date
        ? Utilities.formatDate(data[i][1], Session.getScriptTimeZone(), 'yyyy-MM-dd')
        : String(data[i][1] || '').trim();
    if (cellSlate !== wantSlate) continue;
    if (parseInt(data[i][4], 10) !== wantPk) continue;
    if (
      String(data[i][5] || '')
        .trim()
        .toLowerCase() !== wantSide
    ) {
      continue;
    }
    if (String(data[i][6] != null ? data[i][6] : '').trim() !== wantLine) continue;
    return 4 + i;
  }
  return -1;
}

function mlbF5DefaultStake_(cfg) {
  // Default = the bankroll policy max bet (tier 3, $7.50 of a $500 roll).
  // The old $10 default silently exceeded the staking policy cap.
  const raw = parseFloat(String(cfg && cfg['F5_DEFAULT_STAKE'] != null ? cfg['F5_DEFAULT_STAKE'] : '7.50').trim());
  return !isNaN(raw) && raw > 0 ? raw : 7.5;
}

function snapshotF5ToLog(windowTag) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const card = ss.getSheetByName(MLB_F5_CARD_TAB);
  if (!card || card.getLastRow() < 4) {
    Logger.log('snapshotF5ToLog: no F5 card rows');
    return;
  }

  const cfg = getConfig();
  const slate = getSlateDateString_(cfg);
  const topN = parseInt(String(cfg['F5_SNAPSHOT_TOP_N'] != null ? cfg['F5_SNAPSHOT_TOP_N'] : '8').trim(), 10) || 8;
  const minEv = parseFloat(String(cfg['F5_SNAPSHOT_MIN_EV'] != null ? cfg['F5_SNAPSHOT_MIN_EV'] : '0.03').trim());
  const minEvCut = !isNaN(minEv) ? minEv : 0.03;
  const stake = mlbF5DefaultStake_(cfg);
  const tz = Session.getScriptTimeZone();
  const loggedAt = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm');
  const window = windowTag || 'UNKNOWN';

  // Outcome-first snapshot: rank/select by model win probability (most likely
  // winners), EV only a guardrail. Legacy 'ev' mode = rank/gate by EV.
  const pickMode = mlbPickBy_(cfg);
  const minConf = mlbPickMinConfidence_(cfg);
  const minEvGuard = mlbPickMinEvGuard_(cfg);
  const rows = card.getRange(4, 1, card.getLastRow() - 3, 26).getValues();
  const picks = [];
  rows.forEach(function (r) {
    const bestSide = String(r[22] || '').trim();
    if (bestSide !== 'Over' && bestSide !== 'Under') return;
    const bestEv = parseFloat(String(r[23]));
    const conf = parseFloat(String(bestSide === 'Over' ? r[16] : r[17])); // p_over / p_under
    let rank;
    if (pickMode === 'ev') {
      if (isNaN(bestEv) || bestEv < minEvCut) return;
      rank = bestEv;
    } else {
      if (isNaN(conf) || conf < minConf) return;
      if (isNaN(bestEv) || bestEv < minEvGuard) return; // need a posted price + not awful
      rank = conf;
    }
    picks.push({ row: r, bestSide: bestSide, bestEv: isNaN(bestEv) ? '' : bestEv, rank: rank });
  });
  picks.sort(function (a, b) {
    return b.rank - a.rank;
  });

  let logSh = ss.getSheetByName(MLB_F5_RESULTS_LOG_TAB);
  if (!logSh) {
    logSh = ss.insertSheet(MLB_F5_RESULTS_LOG_TAB);
    logSh.setTabColor('#1976d2');
  }
  if (logSh.getLastRow() < 3 || !String(logSh.getRange(3, 1).getValue() || '').trim()) {
    mlbEnsureF5ResultsLogLayout_(logSh);
  }
  mlbEnsureF5CloseCols_(logSh);

  let appended = 0;
  let updated = 0;

  for (let i = 0; i < picks.length && i < topN; i++) {
    const r = picks[i].row;
    const rank = i + 1;
    const gamePk = r[0];
    const matchup = String(r[1] || '').trim();
    const awaySp = r[3];
    const homeSp = r[4];
    const side = picks[i].bestSide;
    const line = r[5];
    const odds = side === 'Over' ? r[6] : r[7];
    const pModel = side === 'Over' ? r[16] : r[17];
    const ev = picks[i].bestEv;
    const lambdaTotal = r[14];
    const lambdaAway = r[12];
    const lambdaHome = r[13];
    const flags = String(r[24] || '').trim();
    const betKey = mlbF5ResultKey_(slate, gamePk, side, line);

    const hit = _mlbF5FindLogRow_(logSh, slate, gamePk, side, line);
    if (hit > 0) {
      logSh.getRange(hit, 1, 1, 6).setValues([[loggedAt, slate, rank, matchup, gamePk, side]]);
      // Line/Odds (cols 7/8) keep their FIRST-logged values — the bet as
      // struck. Refreshing them every window made the grader settle at
      // closing prices instead of the entry price.
      logSh.getRange(hit, 9, 1, 5).setValues([[pModel, ev, lambdaTotal, lambdaAway, lambdaHome]]);
      // Stake: only fill when blank/non-numeric — never overwrite an entry.
      const prevStake = logSh.getRange(hit, 17).getValue();
      if (prevStake === '' || prevStake == null || isNaN(parseFloat(prevStake))) {
        logSh.getRange(hit, 17).setValue(stake);
      }
      logSh.getRange(hit, 19).setValue(betKey);
      logSh.getRange(hit, 20).setValue(window);
      logSh.getRange(hit, 21).setValue(flags);
      logSh.getRange(hit, 22).setValue(awaySp);
      logSh.getRange(hit, 23).setValue(homeSp);
      updated++;
      continue;
    }

    const nextRow = Math.max(logSh.getLastRow(), 3) + 1;
    logSh.getRange(nextRow, 1, 1, MLB_F5_RESULTS_LOG_NCOL).setValues([[
      loggedAt,
      slate,
      rank,
      matchup,
      gamePk,
      side,
      line,
      odds,
      pModel,
      ev,
      lambdaTotal,
      lambdaAway,
      lambdaHome,
      '',
      'PENDING',
      '',
      stake,
      '',
      betKey,
      window,
      flags,
      awaySp,
      homeSp,
      '',  // close_odds — filled by mlbBackfillF5Closing_
      '',  // clv_pp
    ]]);
    appended++;
  }

  if (appended + updated > 0) {
    try {
      ss.toast('F5 log: +' + appended + ' new · ' + updated + ' updated · ' + window, 'MLB-BOIZ', 6);
    } catch (e) {}
  }
}

function mlbActivateF5ResultsLogTab_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(MLB_F5_RESULTS_LOG_TAB);
  if (sh) sh.activate();
}
