// ============================================================
// 📋 NRFI Results Log — snapshots from 🌅 NRFI_Card
// ============================================================
// One row per game pick (NRFI or YRFI) per window. Graded via
// statsapi feed/live linescore inning-1 runs total.
// ============================================================

const MLB_NRFI_RESULTS_LOG_TAB = '📋 NRFI_Results_Log';
const MLB_NRFI_RESULTS_LOG_NCOL = 26;

const MLB_NRFI_RESULTS_HEADERS = [
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
  'lambda_top',
  'lambda_bot',
  'fd_yrfi',
  'fd_nrfi',
  'lineup_top3',
  'actual_1st_runs',
  'result',
  'grade_notes',
  'stake $',
  'pnl $',
  'bet_key',
  'Window',
  'flags',
  'close_odds',
  'clv_pp',
];

/** Cols 25/26 close_odds + clv_pp — CLV capture for the NRFI market. */
function mlbEnsureNrfiCloseCols_(sh) {
  if (sh.getMaxColumns() < MLB_NRFI_RESULTS_LOG_NCOL) {
    sh.insertColumnsAfter(sh.getMaxColumns(), MLB_NRFI_RESULTS_LOG_NCOL - sh.getMaxColumns());
  }
  if (String(sh.getRange(3, 25).getValue() || '').trim() !== 'close_odds') {
    sh.getRange(3, 25, 1, 2).setValues([['close_odds', 'clv_pp']]);
  }
}

/**
 * Capture the closing FD price for this slate's NRFI rows (same 0.5 line).
 * Misses never clobber a previous capture — the last capture is the close.
 */
function mlbBackfillNrfiClosing_(ss) {
  const logSh = ss.getSheetByName(MLB_NRFI_RESULTS_LOG_TAB);
  if (!logSh || logSh.getLastRow() < 4) return 0;
  mlbEnsureNrfiCloseCols_(logSh);
  const cfg = getConfig();
  const slateWant = getSlateDateString_(cfg);
  const idx = mlbBuildFirstInningTotalsIndex_(ss);
  const data = logSh.getRange(4, 1, logSh.getLastRow() - 3, MLB_NRFI_RESULTS_LOG_NCOL).getValues();
  let n = 0;
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if (mlbDateCellToYmd_(row[1]) !== slateWant) continue;
    const matchup = String(row[3] || '').trim();
    const side = String(row[5] || '').trim().toUpperCase();
    const openOdds = row[7];
    if (!matchup) continue;
    const hit = mlbLookupFirstInningOdds_(idx, mlbCandidateGameKeys_(matchup, '', ''));
    if (!hit) continue;
    const american = side === 'NRFI' ? hit.nrfi : side === 'YRFI' ? hit.yrfi : '';
    if (american === '' || american == null) continue;
    logSh.getRange(4 + i, 25).setValue(american);
    const clvPp = mlbClvPpFromOpenClose_(openOdds, american);
    if (clvPp !== '') logSh.getRange(4 + i, 26).setValue(clvPp);
    n++;
  }
  return n;
}

function mlbEnsureNrfiResultsLogLayout_(sh) {
  sh.getRange(1, 1, 1, MLB_NRFI_RESULTS_LOG_NCOL)
    .merge()
    .setValue('📋 NRFI Results — top EV picks from 🌅 NRFI_Card · graded on 1st-inning runs')
    .setFontWeight('bold')
    .setBackground('#e65100')
    .setFontColor('#ffffff');
  sh.getRange(3, 1, 1, MLB_NRFI_RESULTS_LOG_NCOL)
    .setValues([MLB_NRFI_RESULTS_HEADERS])
    .setFontWeight('bold')
    .setBackground('#ff6f00')
    .setFontColor('#ffffff');
  sh.setFrozenRows(3);
}

function mlbNrfiResultKey_(slate, gamePk, side) {
  return [
    String(slate || '').trim(),
    String(gamePk != null ? gamePk : '').trim(),
    String(side || '')
      .trim()
      .toUpperCase(),
  ].join('|');
}

function _mlbNrfiFindLogRow_(logSh, slate, gamePk, side) {
  if (logSh.getLastRow() < 4) return -1;
  const data = logSh.getRange(4, 1, logSh.getLastRow() - 3, MLB_NRFI_RESULTS_LOG_NCOL).getValues();
  const wantSlate = String(slate || '').trim();
  const wantPk = parseInt(gamePk, 10);
  const wantSide = String(side || '')
    .trim()
    .toUpperCase();
  for (let i = data.length - 1; i >= 0; i--) {
    const cellSlate =
      data[i][1] instanceof Date
        ? Utilities.formatDate(data[i][1], Session.getScriptTimeZone(), 'yyyy-MM-dd')
        : String(data[i][1] || '').trim();
    if (cellSlate !== wantSlate) continue;
    if (parseInt(data[i][4], 10) !== wantPk) continue;
    if (String(data[i][5] || '').trim().toUpperCase() !== wantSide) continue;
    return 4 + i;
  }
  return -1;
}

function mlbNrfiDefaultStake_(cfg) {
  // Default = the bankroll policy max bet (tier 3, $7.50 of a $500 roll).
  // The old $10 default silently exceeded the staking policy cap.
  const raw = parseFloat(String(cfg && cfg['NRFI_DEFAULT_STAKE'] != null ? cfg['NRFI_DEFAULT_STAKE'] : '7.50').trim());
  return !isNaN(raw) && raw > 0 ? raw : 7.5;
}

/**
 * Snapshot positive-EV picks from 🌅 NRFI_Card.
 * @param {string} windowTag MORNING | MIDDAY | FINAL
 */
function snapshotNrfiToLog(windowTag) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const card = ss.getSheetByName(MLB_NRFI_CARD_TAB);
  if (!card || card.getLastRow() < 4) {
    Logger.log('snapshotNrfiToLog: no NRFI card rows');
    return;
  }

  const cfg = getConfig();
  const slate = getSlateDateString_(cfg);
  const topN = parseInt(String(cfg['NRFI_SNAPSHOT_TOP_N'] != null ? cfg['NRFI_SNAPSHOT_TOP_N'] : '10').trim(), 10) || 10;
  const minEv = parseFloat(String(cfg['NRFI_SNAPSHOT_MIN_EV'] != null ? cfg['NRFI_SNAPSHOT_MIN_EV'] : '0.03').trim());
  const minEvCut = !isNaN(minEv) ? minEv : 0.03;
  const stake = mlbNrfiDefaultStake_(cfg);
  const tz = Session.getScriptTimeZone();
  const loggedAt = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm');
  const window = windowTag || 'UNKNOWN';

  const rows = card.getRange(4, 1, card.getLastRow() - 3, 22).getValues();
  const picks = [];
  rows.forEach(function (r) {
    // Re-derive the pick from probabilities/EV so the snapshot honors the
    // outcome-first rule (win prob + guardrail), not raw EV. r[11]=p_nrfi,
    // r[12]=p_yrfi, r[15]=ev_n, r[16]=ev_y.
    const sel = mlbNrfiChooseSide_(r[11], r[12], r[15], r[16], cfg);
    if (sel.side !== 'NRFI' && sel.side !== 'YRFI') return;
    if (!mlbNrfiPickEligible_(sel, cfg)) return;
    picks.push({ row: r, bestSide: sel.side, bestEv: sel.ev, rank: sel.rank });
  });
  picks.sort(function (a, b) {
    return b.rank - a.rank;
  });

  let logSh = ss.getSheetByName(MLB_NRFI_RESULTS_LOG_TAB);
  if (!logSh) {
    logSh = ss.insertSheet(MLB_NRFI_RESULTS_LOG_TAB);
    logSh.setTabColor('#ff6f00');
  }
  if (logSh.getLastRow() < 3 || !String(logSh.getRange(3, 1).getValue() || '').trim()) {
    mlbEnsureNrfiResultsLogLayout_(logSh);
  }
  mlbEnsureNrfiCloseCols_(logSh);

  let appended = 0;
  let updated = 0;

  for (let i = 0; i < picks.length && i < topN; i++) {
    const r = picks[i].row;
    const rank = i + 1;
    const gamePk = r[0];
    const matchup = String(r[1] || '').trim();
    const side = picks[i].bestSide;
    const line = r[5];
    const odds = side === 'NRFI' ? r[7] : r[6];
    const pModel = side === 'NRFI' ? r[11] : r[12];
    const ev = picks[i].bestEv;
    const lambdaTotal = r[10];
    const lambdaTop = r[8];
    const lambdaBot = r[9];
    const fdYrfi = r[6];
    const fdNrfi = r[7];
    const lineupTop3 = r[21];
    const flags = String(r[19] || '').trim();
    const betKey = mlbNrfiResultKey_(slate, gamePk, side);

    const hit = _mlbNrfiFindLogRow_(logSh, slate, gamePk, side);
    if (hit > 0) {
      logSh.getRange(hit, 1, 1, 6).setValues([[loggedAt, slate, rank, matchup, gamePk, side]]);
      // Line/Odds (cols 7/8) keep their FIRST-logged values — that's the bet
      // as struck. Refreshing them each window made the grader settle every
      // bet at closing prices. Latest both-sides prices still refresh in
      // fd_yrfi/fd_nrfi (cols 14/15) for reference.
      logSh.getRange(hit, 9, 1, 8).setValues([[
        pModel, ev, lambdaTotal, lambdaTop, lambdaBot, fdYrfi, fdNrfi, lineupTop3,
      ]]);
      // Stake: only fill when blank/non-numeric — never overwrite an entry.
      const prevStake = logSh.getRange(hit, 20).getValue();
      if (prevStake === '' || prevStake == null || isNaN(parseFloat(prevStake))) {
        logSh.getRange(hit, 20).setValue(stake);
      }
      logSh.getRange(hit, 22).setValue(betKey);
      logSh.getRange(hit, 23).setValue(window);
      logSh.getRange(hit, 24).setValue(flags);
      updated++;
      continue;
    }

    const nextRow = Math.max(logSh.getLastRow(), 3) + 1;
    logSh.getRange(nextRow, 1, 1, MLB_NRFI_RESULTS_LOG_NCOL).setValues([[
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
      lambdaTop,
      lambdaBot,
      fdYrfi,
      fdNrfi,
      lineupTop3,
      '',
      'PENDING',
      '',
      stake,
      '',
      betKey,
      window,
      flags,
    ]]);
    appended++;
  }

  if (appended + updated > 0) {
    try {
      ss.toast('NRFI log: +' + appended + ' new · ' + updated + ' updated · ' + window, 'MLB-BOIZ', 6);
    } catch (e) {}
  }
}

function mlbActivateNrfiResultsLogTab_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(MLB_NRFI_RESULTS_LOG_TAB);
  if (sh) sh.activate();
}
