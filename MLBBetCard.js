// ============================================================
// 🃏 MLB Bet Card — pitcher K + batter TB + batter hits (ranked by EV)
// ============================================================
// Pulls 🎰 Pitcher_K_Card + 🎲 Batter_TB_Card + 🎯 Batter_Hits_Card;
// merges, ranks, caps per game + total plays. A+ grades bypass caps.
// VISUAL FORMATTING is in MLBBetCardFormatting.js — DO NOT mix
// rendering code into this file or it will get rolled back with model
// changes (see v0.1.1 commit notes).
// ============================================================

const MLB_BET_CARD_TAB = '🃏 MLB_Bet_Card';
const MLB_BET_CARD_NCOL = 19;
/**
 * Bet card filters (a play must clear ALL of these to make 🃏):
 *   1. model P(Win) ≥ MLB_BET_CARD_MIN_MODEL_PCT
 *   2. EV per $1 > 0
 *   3. mlbGradePlay_(ev, odds) ∈ MLB_BET_CARD_ALLOWED_GRADES
 * Plus data prereqs: side ∈ {Over,Under}, valid line + FD price, no injury.
 */
const MLB_BET_CARD_MIN_MODEL_PCT = 0.60;
const MLB_BET_CARD_ALLOWED_GRADES = { 'A+': true, 'A': true };

function refreshMLBBetCard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig();
  const bankroll = parseFloat(String(cfg['BANKROLL'] != null ? cfg['BANKROLL'] : '1000').trim(), 10) || 1000;
  const kellyFrac = parseFloat(String(cfg['KELLY_FRACTION'] != null ? cfg['KELLY_FRACTION'] : '0.25').trim(), 10) || 0.25;
  const slateDate = getSlateDateString_(cfg);
  const gameTimeIdx = mlbScheduleGameTimeIndex_(ss);

  const srcK = ss.getSheetByName(MLB_PITCHER_K_CARD_TAB);
  const srcTb = ss.getSheetByName(MLB_BATTER_TB_CARD_TAB);
  const srcHits = ss.getSheetByName(MLB_BATTER_HITS_CARD_TAB);

  if (
    (!srcK || srcK.getLastRow() < 4) &&
    (!srcTb || srcTb.getLastRow() < 4) &&
    (!srcHits || srcHits.getLastRow() < 4)
  ) {
    safeAlert_(
      'MLB Bet Card',
      'Run at least one model card first (🎰 Pitcher_K_Card / 🎲 Batter_TB_Card / 🎯 Batter_Hits_Card). Morning pipeline builds all.'
    );
    return;
  }

  const plays = [];

  if (srcK && srcK.getLastRow() >= 4) {
    const lastK = srcK.getLastRow();
    const vals = srcK.getRange(4, 1, lastK, 25).getValues();
    vals.forEach(function (r) {
      const flags = String(r[18] || '');
      const pitcherId = r[19];
      const hpUmp = String(r[20] || '').trim();
      const throws = String(r[21] || '').trim();
      if (flags.indexOf('injury') !== -1) return;

      const bestSide = String(r[16] || '').trim();
      if (bestSide !== 'Over' && bestSide !== 'Under') return;

      const line = r[4];
      if (line === '' || line == null) return;

      const fdOver = r[5];
      const fdUnder = r[6];
      const american = bestSide === 'Over' ? fdOver : fdUnder;
      if (american === '' || american == null || isNaN(parseFloat(String(american)))) return;

      const pitcher = String(r[3] || '').trim();
      if (!pitcher) return;

      const pWin = bestSide === 'Over' ? r[10] : r[11];
      const pwNum = parseFloat(String(pWin));
      if (isNaN(pwNum) || pwNum < MLB_BET_CARD_MIN_MODEL_PCT) return;

      const evRaw = r[17];
      const ev = parseFloat(String(evRaw));
      if (isNaN(ev) || ev <= 0) return;
      const grade = mlbGradePlay_(ev, american);
      if (!MLB_BET_CARD_ALLOWED_GRADES[grade]) return;
      const implied = bestSide === 'Over' ? r[12] : r[13];
      const matchup = r[1];
      const gamePk = r[0];
      const hand =
        throws.toUpperCase() === 'R' ? 'RHP' : throws.toUpperCase() === 'L' ? 'LHP' : throws ? throws : '';
      const pickLabel =
        pitcher +
        (hand ? ' (' + hand + ')' : '') +
        ' — K ' +
        bestSide +
        ' ' +
        String(line) +
        (hpUmp ? ' · HP ' + hpUmp : '');
      const gt = gameTimeIdx[parseInt(gamePk, 10)] || {};

      plays.push({
        kind: 'K',
        gamePk: gamePk,
        matchup: matchup,
        pickLabel: pickLabel,
        player: pitcher,
        playerId: pitcherId,
        side: bestSide,
        line: line,
        american: american,
        pWin: pWin,
        implied: implied,
        ev: isNaN(ev) ? '' : ev,
        grade: grade,
        lambda: r[8],
        edge: r[9],
        flags: flags,
        market: 'Pitcher strikeouts',
        gameTimeIso: gt.iso || '',
        gameTimeHHmm: gt.hhmm || '',
      });
    });
  }

  if (srcTb && srcTb.getLastRow() >= 4) {
    const lastT = srcTb.getLastRow();
    const vals = srcTb.getRange(4, 1, lastT, 19).getValues();
    vals.forEach(function (r) {
      const flags = String(r[16] || '');
      const batterId = r[17];
      const hpUmp = String(r[18] || '').trim();
      if (flags.indexOf('injury') !== -1) return;

      const bestSide = String(r[14] || '').trim();
      if (bestSide !== 'Over' && bestSide !== 'Under') return;

      const line = r[3];
      if (line === '' || line == null) return;

      const fdOver = r[4];
      const fdUnder = r[5];
      const american = bestSide === 'Over' ? fdOver : fdUnder;
      if (american === '' || american == null || isNaN(parseFloat(String(american)))) return;

      const batter = String(r[2] || '').trim();
      if (!batter) return;

      const pWin = bestSide === 'Over' ? r[8] : r[9];
      const pwNum = parseFloat(String(pWin));
      if (isNaN(pwNum) || pwNum < MLB_BET_CARD_MIN_MODEL_PCT) return;

      const evRaw = r[15];
      const ev = parseFloat(String(evRaw));
      if (isNaN(ev) || ev <= 0) return;
      const grade = mlbGradePlay_(ev, american);
      if (!MLB_BET_CARD_ALLOWED_GRADES[grade]) return;
      const implied = bestSide === 'Over' ? r[10] : r[11];
      const matchup = r[1];
      const gamePk = r[0];
      const pickLabel =
        batter + ' — TB ' + bestSide + ' ' + String(line) + (hpUmp ? ' · HP ' + hpUmp : '');
      const gt = gameTimeIdx[parseInt(gamePk, 10)] || {};

      plays.push({
        kind: 'TB',
        gamePk: gamePk,
        matchup: matchup,
        pickLabel: pickLabel,
        player: batter,
        playerId: batterId,
        side: bestSide,
        line: line,
        american: american,
        pWin: pWin,
        implied: implied,
        ev: isNaN(ev) ? '' : ev,
        grade: grade,
        lambda: r[6],
        edge: r[7],
        flags: flags,
        market: 'Batter total bases',
        gameTimeIso: gt.iso || '',
        gameTimeHHmm: gt.hhmm || '',
      });
    });
  }

  if (srcHits && srcHits.getLastRow() >= 4) {
    const lastH = srcHits.getLastRow();
    const valsH = srcHits.getRange(4, 1, lastH, 19).getValues();
    valsH.forEach(function (r) {
      const flags = String(r[16] || '');
      const batterId = r[17];
      const hpUmp = String(r[18] || '').trim();
      if (flags.indexOf('injury') !== -1) return;

      const bestSide = String(r[14] || '').trim();
      if (bestSide !== 'Over' && bestSide !== 'Under') return;

      const line = r[3];
      if (line === '' || line == null) return;

      const fdOver = r[4];
      const fdUnder = r[5];
      const american = bestSide === 'Over' ? fdOver : fdUnder;
      if (american === '' || american == null || isNaN(parseFloat(String(american)))) return;

      const batter = String(r[2] || '').trim();
      if (!batter) return;

      const pWin = bestSide === 'Over' ? r[8] : r[9];
      const pwNum = parseFloat(String(pWin));
      if (isNaN(pwNum) || pwNum < MLB_BET_CARD_MIN_MODEL_PCT) return;

      const evRaw = r[15];
      const ev = parseFloat(String(evRaw));
      if (isNaN(ev) || ev <= 0) return;
      const grade = mlbGradePlay_(ev, american);
      if (!MLB_BET_CARD_ALLOWED_GRADES[grade]) return;
      const implied = bestSide === 'Over' ? r[10] : r[11];
      const matchup = r[1];
      const gamePk = r[0];
      const pickLabel =
        batter + ' — H ' + bestSide + ' ' + String(line) + (hpUmp ? ' · HP ' + hpUmp : '');
      const gt = gameTimeIdx[parseInt(gamePk, 10)] || {};

      plays.push({
        kind: 'H',
        gamePk: gamePk,
        matchup: matchup,
        pickLabel: pickLabel,
        player: batter,
        playerId: batterId,
        side: bestSide,
        line: line,
        american: american,
        pWin: pWin,
        implied: implied,
        ev: isNaN(ev) ? '' : ev,
        grade: grade,
        lambda: r[6],
        edge: r[7],
        flags: flags,
        market: 'Batter hits',
        gameTimeIso: gt.iso || '',
        gameTimeHHmm: gt.hhmm || '',
      });
    });
  }

  // EV desc — used for ordering before cap selection.
  plays.sort(function (a, b) {
    const be = parseFloat(String(b.ev));
    const ae = parseFloat(String(a.ev));
    if (isNaN(be) && isNaN(ae)) return 0;
    if (isNaN(be)) return 1;
    if (isNaN(ae)) return -1;
    return be - ae;
  });

  // Filters: pWin ≥ MLB_BET_CARD_MIN_MODEL_PCT AND ev > 0 AND grade ∈ MLB_BET_CARD_ALLOWED_GRADES.
  const selected = plays;

  // Display order: game start time asc, then by gamePk (keep same-time games
  // grouped), then EV desc within a game.
  selected.sort(function (a, b) {
    const ta = a.gameTimeIso || '';
    const tb = b.gameTimeIso || '';
    if (ta && tb && ta !== tb) return ta < tb ? -1 : 1;
    if (ta && !tb) return -1;
    if (!ta && tb) return 1;
    const ga = String(a.gamePk != null ? a.gamePk : '');
    const gb = String(b.gamePk != null ? b.gamePk : '');
    if (ga !== gb) return ga < gb ? -1 : 1;
    const be = parseFloat(String(b.ev));
    const ae = parseFloat(String(a.ev));
    if (isNaN(be) && isNaN(ae)) return 0;
    if (isNaN(be)) return 1;
    if (isNaN(ae)) return -1;
    return be - ae;
  });

  // Build rows; insert a blank spacer row between game groups for visual separation.
  const rows = [];
  let lastGamePk = null;
  let visibleIdx = 0;
  selected.forEach(function (p) {
    const gKey = String(p.gamePk != null ? p.gamePk : '');
    if (lastGamePk !== null && gKey !== lastGamePk) {
      rows.push(new Array(MLB_BET_CARD_NCOL).fill(''));  // spacer row
    }
    lastGamePk = gKey;
    visibleIdx++;
    const stake = mlbKellyStake_(p.pWin, p.american, bankroll, kellyFrac, cfg);
    rows.push([
      slateDate,                                                  // 0  date
      visibleIdx,                                                 // 1  #
      p.gamePk,                                                   // 2  gamePk
      p.matchup,                                                  // 3  matchup
      p.pickLabel,                                                // 4  play
      p.player,                                                   // 5  player
      p.market,                                                   // 6  market
      p.side,                                                     // 7  side
      p.line,                                                     // 8  line
      p.american,                                                 // 9  odds
      p.pWin,                                                     // 10 model %
      p.implied !== '' && p.implied != null ? p.implied : '',     // 11 book %
      p.ev,                                                       // 12 ev / $1
      stake,                                                      // 13 stake $
      p.lambda,                                                   // 14 proj
      p.edge,                                                     // 15 proj − line
      p.flags,                                                    // 16 flags
      p.playerId != null && p.playerId !== '' ? p.playerId : '',  // 17 player_id
      p.gameTimeHHmm || '',                                       // 18 time
    ]);
  });

  if (rows.length === 0) {
    const blank = new Array(MLB_BET_CARD_NCOL).fill('');
    blank[0] = slateDate;
    const allowed = Object.keys(MLB_BET_CARD_ALLOWED_GRADES).join('/');
    blank[4] =
      'No qualifying plays — build 🎰 Pitcher_K_Card / 🎲 Batter_TB_Card / 🎯 Batter_Hits_Card with ' +
      'model % ≥ ' + Math.round(MLB_BET_CARD_MIN_MODEL_PCT * 100) + '%, ev > 0, grade ∈ {' + allowed + '}, valid FD price, no injury flag.';
    rows.push(blank);
  }

  let sh = ss.getSheetByName(MLB_BET_CARD_TAB);
  if (sh) {
    const cr = Math.max(sh.getLastRow(), 3);
    const cc = Math.max(sh.getLastColumn(), MLB_BET_CARD_NCOL);
    try {
      sh.getRange(1, 1, cr, cc).breakApart();
    } catch (e) {}
    sh.clearContents();
    sh.clearFormats();
  } else {
    sh = ss.insertSheet(MLB_BET_CARD_TAB);
  }
  sh.setTabColor('#1a2332');

  const headers = [
    'date',
    '#',
    'gamePk',
    'matchup',
    'play',
    'player',
    'market',
    'side',
    'line',
    'odds',
    'model %',
    'book %',
    'ev / $1',
    'stake $',
    'proj',
    'proj − line',
    'flags',
    'player_id',
    'time',
  ];

  sh.getRange(3, 1, 1, headers.length).setValues([headers]);
  sh.getRange(4, 1, rows.length, headers.length).setValues(rows);

  const hasRealRows =
    rows.length > 0 && rows[0][5] && String(rows[0][5]).indexOf('No qualifying') === -1;
  if (hasRealRows) {
    try {
      ss.setNamedRange('MLB_BET_CARD', sh.getRange(4, 1, rows.length, headers.length));
    } catch (e) {}
  }

  // All visual rendering lives in MLBBetCardFormatting.js — keep it that way.
  mlbApplyBetCardFormatting_(sh, hasRealRows ? rows : [], headers, slateDate);

  if (hasRealRows) {
    const trackerStart = 4 + rows.length + 2;
    const afterV1 = mlbAppendBetTrackerSection_(ss, sh, trackerStart, slateDate);
    let afterV2 = afterV1;
    if (typeof mlbAppendBetTrackerSectionV2_ === 'function') {
      afterV2 = mlbAppendBetTrackerSectionV2_(ss, sh, afterV1 + 1, slateDate);
    }
    if (typeof mlbAppendBetTrackerByEdgeSection_ === 'function') {
      mlbAppendBetTrackerByEdgeSection_(ss, sh, afterV2 + 1, slateDate);
    }
  }

  sh.setFrozenRows(3);
  sh.setHiddenGridlines(true);

  const aPlus = selected.filter(function (p) { return p.grade === 'A+'; }).length;
  ss.toast(rows.length + ' bet rows · ' + aPlus + ' A+ · ' + slateDate, 'MLB Bet Card', 6);
}

// ============================================================
// 🔍 Diagnose why Hits rows are/aren't making the bet card.
// Writes results to a 🔍 BetCard_Diag_Hits tab + Logger.
// Run from script editor or add a menu entry. Idempotent.
// ============================================================
function diagnoseHitsBetCardInclusion() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const src = ss.getSheetByName(MLB_BATTER_HITS_CARD_TAB);
  const diagTab = '🔍 BetCard_Diag_Hits';
  const log = [];
  log.push('Source tab: ' + MLB_BATTER_HITS_CARD_TAB);
  const allowedGradesStr = Object.keys(MLB_BET_CARD_ALLOWED_GRADES).join('/');
  log.push('Gates (besides data prereqs): pWin ≥ ' + MLB_BET_CARD_MIN_MODEL_PCT + ' AND ev > 0 AND grade ∈ {' + allowedGradesStr + '}');

  if (!src) {
    log.push('FAIL: tab not found');
    Logger.log(log.join('\n'));
    safeAlert_('Hits diag', log.join('\n'));
    return;
  }
  const lastRow = src.getLastRow();
  log.push('lastRow=' + lastRow);
  if (lastRow < 4) {
    log.push('FAIL: no data rows below header (lastRow<4)');
    Logger.log(log.join('\n'));
    safeAlert_('Hits diag', log.join('\n'));
    return;
  }

  const vals = src.getRange(4, 1, lastRow - 3, 19).getValues();
  log.push('Scanned ' + vals.length + ' card rows.');

  const tally = {
    blank_batter: 0,
    injury_flag: 0,
    bad_best_side: 0,
    blank_line: 0,
    blank_or_nan_price: 0,
    blank_or_nan_pwin: 0,
    pwin_below_floor: 0,
    ev_not_positive: 0,
    grade_below_floor: 0,
    passed: 0,
  };
  const rejectExamples = [];
  const passList = [];

  vals.forEach(function (r, i) {
    const rowNum = i + 4;
    const gamePk = r[0];
    const matchup = r[1];
    const batter = String(r[2] || '').trim();
    const line = r[3];
    const fdOver = r[4];
    const fdUnder = r[5];
    const pOver = r[8];
    const pUnder = r[9];
    const bestSide = String(r[14] || '').trim();
    const flags = String(r[16] || '');

    function rej(reason, detail) {
      tally[reason]++;
      if (rejectExamples.length < 40) {
        rejectExamples.push([rowNum, batter, matchup, reason, detail]);
      }
    }

    if (!batter) { rej('blank_batter', ''); return; }
    if (flags.indexOf('injury') !== -1) { rej('injury_flag', flags); return; }
    if (bestSide !== 'Over' && bestSide !== 'Under') {
      rej('bad_best_side', 'bestSide="' + bestSide + '"'); return;
    }
    if (line === '' || line == null) { rej('blank_line', ''); return; }

    const american = bestSide === 'Over' ? fdOver : fdUnder;
    if (american === '' || american == null || isNaN(parseFloat(String(american)))) {
      rej('blank_or_nan_price', 'side=' + bestSide + ' price="' + american + '"'); return;
    }

    const pWin = bestSide === 'Over' ? pOver : pUnder;
    const pwNum = parseFloat(String(pWin));
    if (isNaN(pwNum)) {
      rej('blank_or_nan_pwin', 'side=' + bestSide + ' pWin="' + pWin + '"'); return;
    }
    if (pwNum < MLB_BET_CARD_MIN_MODEL_PCT) {
      rej('pwin_below_floor', 'side=' + bestSide + ' pWin=' + pwNum); return;
    }

    const evNum = parseFloat(String(r[15]));
    if (isNaN(evNum) || evNum <= 0) {
      rej('ev_not_positive', 'side=' + bestSide + ' ev=' + r[15]); return;
    }

    const grade = mlbGradePlay_(evNum, american);
    if (!MLB_BET_CARD_ALLOWED_GRADES[grade]) {
      rej('grade_below_floor', 'grade=' + (grade || '(blank)') + ' ev=' + evNum + ' odds=' + american); return;
    }

    tally.passed++;
    if (passList.length < 200) {
      passList.push([rowNum, batter, matchup, bestSide, line, american, pwNum, r[15]]);
    }
  });

  log.push('--- tally ---');
  Object.keys(tally).forEach(function (k) { log.push(k + ': ' + tally[k]); });

  let sh = ss.getSheetByName(diagTab);
  if (sh) { sh.clearContents(); sh.clearFormats(); }
  else { sh = ss.insertSheet(diagTab); }
  sh.setTabColor('#b71c1c');

  sh.getRange(1, 1).setValue('🔍 Hits → BetCard inclusion diagnostic — ' + new Date()).setFontWeight('bold');
  sh.getRange(2, 1).setValue('Gates: pWin ≥ ' + MLB_BET_CARD_MIN_MODEL_PCT + ' AND ev > 0 AND grade ∈ {' + allowedGradesStr + '}. Plus data prereqs: non-blank batter, no injury flag, bestSide ∈ {Over,Under}, line set, valid FD price for that side, parseable pWin.');
  sh.getRange(2, 1).setWrap(true);

  const tallyRows = Object.keys(tally).map(function (k) { return [k, tally[k]]; });
  sh.getRange(4, 1, 1, 2).setValues([['gate', 'count']]).setFontWeight('bold').setBackground('#37474f').setFontColor('#fff');
  sh.getRange(5, 1, tallyRows.length, 2).setValues(tallyRows);

  const startRej = 5 + tallyRows.length + 2;
  sh.getRange(startRej - 1, 1).setValue('Reject examples (first 40)').setFontWeight('bold');
  sh.getRange(startRej, 1, 1, 5).setValues([['row', 'batter', 'matchup', 'reason', 'detail']])
    .setFontWeight('bold').setBackground('#455a64').setFontColor('#fff');
  if (rejectExamples.length) {
    sh.getRange(startRej + 1, 1, rejectExamples.length, 5).setValues(rejectExamples);
  }

  const startPass = startRej + 1 + Math.max(rejectExamples.length, 1) + 2;
  sh.getRange(startPass - 1, 1).setValue('Passed rows (first 200) — these should appear on 🃏 MLB_Bet_Card').setFontWeight('bold');
  sh.getRange(startPass, 1, 1, 8).setValues([['row', 'batter', 'matchup', 'side', 'line', 'price', 'pWin', 'best_ev']])
    .setFontWeight('bold').setBackground('#1b5e20').setFontColor('#fff');
  if (passList.length) {
    sh.getRange(startPass + 1, 1, passList.length, 8).setValues(passList);
  }

  sh.setColumnWidth(1, 60);
  sh.setColumnWidth(2, 160);
  sh.setColumnWidth(3, 220);
  sh.setColumnWidth(4, 140);
  sh.setColumnWidth(5, 260);

  Logger.log(log.join('\n'));
  ss.toast('passed=' + tally.passed + ' · see ' + diagTab, 'Hits diag', 8);
}
