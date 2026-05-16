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
const MLB_BET_CARD_NCOL = 20;
const MLB_BET_CARD_MAX_PLAYS = 30;
/** Same spirit as AI-BOIZ: cap how many straights surface per game on the card. */
const MLB_BET_CARD_MAX_PER_GAME = 2;

function refreshMLBBetCard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig();
  const minEvCfg = parseFloat(String(cfg['MIN_EV_BET_CARD'] != null ? cfg['MIN_EV_BET_CARD'] : '0').trim(), 10);
  const minEvFloor = !isNaN(minEvCfg) && minEvCfg > 0 ? minEvCfg : 0;
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

      const evRaw = r[17];
      const ev = parseFloat(String(evRaw));
      if (isNaN(ev) || ev <= 0) return;
      if (minEvFloor > 0 && ev < minEvFloor) return;

      const pWin = bestSide === 'Over' ? r[10] : r[11];
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
        grade: mlbGradePlay_(ev, american),
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

      const evRaw = r[15];
      const ev = parseFloat(String(evRaw));
      if (isNaN(ev) || ev <= 0) return;
      if (minEvFloor > 0 && ev < minEvFloor) return;

      const pWin = bestSide === 'Over' ? r[8] : r[9];
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
        grade: mlbGradePlay_(ev, american),
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

      const evRaw = r[15];
      const ev = parseFloat(String(evRaw));
      if (isNaN(ev) || ev <= 0) return;
      if (minEvFloor > 0 && ev < minEvFloor) return;

      const pWin = bestSide === 'Over' ? r[8] : r[9];
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
        grade: mlbGradePlay_(ev, american),
        lambda: r[6],
        edge: r[7],
        flags: flags,
        market: 'Batter hits',
        gameTimeIso: gt.iso || '',
        gameTimeHHmm: gt.hhmm || '',
      });
    });
  }

  // EV desc — used for ordering before A+ bypass + cap selection.
  plays.sort(function (a, b) {
    const be = parseFloat(String(b.ev));
    const ae = parseFloat(String(a.ev));
    if (isNaN(be) && isNaN(ae)) return 0;
    if (isNaN(be)) return 1;
    if (isNaN(ae)) return -1;
    return be - ae;
  });

  // Pass 1: every A+ play bypasses caps.
  // Pass 2: fill remaining slots under per-game and total caps. A+ plays count.
  const selected = [];
  const perGame = {};
  plays.forEach(function (p) {
    if (p.grade !== 'A+') return;
    const gKey = String(p.gamePk != null ? p.gamePk : p.matchup || '').trim() || 'unknown';
    perGame[gKey] = (perGame[gKey] || 0) + 1;
    selected.push(p);
  });
  let nonAPlus = 0;
  for (let i = 0; i < plays.length && nonAPlus < MLB_BET_CARD_MAX_PLAYS; i++) {
    const p = plays[i];
    if (p.grade === 'A+') continue;
    const gKey = String(p.gamePk != null ? p.gamePk : p.matchup || '').trim() || 'unknown';
    if ((perGame[gKey] || 0) >= MLB_BET_CARD_MAX_PER_GAME) continue;
    perGame[gKey] = (perGame[gKey] || 0) + 1;
    selected.push(p);
    nonAPlus++;
  }

  // Display order: game start time asc, then EV desc within game.
  selected.sort(function (a, b) {
    const ta = a.gameTimeIso || '';
    const tb = b.gameTimeIso || '';
    if (ta && tb && ta !== tb) return ta < tb ? -1 : 1;
    if (ta && !tb) return -1;
    if (!ta && tb) return 1;
    const be = parseFloat(String(b.ev));
    const ae = parseFloat(String(a.ev));
    if (isNaN(be) && isNaN(ae)) return 0;
    if (isNaN(be)) return 1;
    if (isNaN(ae)) return -1;
    return be - ae;
  });

  const rows = selected.map(function (p, idx) {
    const kelly = mlbKellyStake_(p.pWin, p.american, bankroll, kellyFrac, cfg);
    return [
      slateDate,                                                  // 0  date
      idx + 1,                                                    // 1  #
      p.grade || '',                                              // 2  grade
      p.gamePk,                                                   // 3  gamePk
      p.matchup,                                                  // 4  matchup
      p.pickLabel,                                                // 5  play
      p.player,                                                   // 6  player
      p.market,                                                   // 7  market
      p.side,                                                     // 8  side
      p.line,                                                     // 9  line
      p.american,                                                 // 10 odds
      p.pWin,                                                     // 11 model %
      p.implied !== '' && p.implied != null ? p.implied : '',     // 12 book %
      p.ev,                                                       // 13 ev / $1
      kelly,                                                      // 14 kelly $
      p.lambda,                                                   // 15 proj
      p.edge,                                                     // 16 proj − line
      p.flags,                                                    // 17 flags
      p.playerId != null && p.playerId !== '' ? p.playerId : '',  // 18 player_id
      p.gameTimeHHmm || '',                                       // 19 time
    ];
  });

  if (rows.length === 0) {
    const evHint =
      minEvFloor > 0
        ? 'EV≥' + minEvFloor + ' per $1 (⚙️ MIN_EV_BET_CARD), '
        : 'positive EV, ';
    const blank = new Array(MLB_BET_CARD_NCOL).fill('');
    blank[0] = slateDate;
    blank[5] =
      'No qualifying plays — build 🎰 Pitcher_K_Card / 🎲 Batter_TB_Card / 🎯 Batter_Hits_Card with ' +
      evHint +
      'both FD prices, no injury flag (max ' +
      MLB_BET_CARD_MAX_PER_GAME +
      ' per game; A+ plays bypass).';
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
    'grade',
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
    mlbAppendBetTrackerSection_(ss, sh, trackerStart, slateDate);
  }

  sh.setFrozenRows(3);
  sh.setHiddenGridlines(true);

  const aPlus = rows.filter(function (r) { return String(r[2]) === 'A+'; }).length;
  ss.toast(rows.length + ' bet rows · ' + aPlus + ' A+ · ' + slateDate, 'MLB Bet Card', 6);
}
