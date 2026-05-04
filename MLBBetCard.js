// ============================================================
// 🃏 MLB Bet Card — single ranked sheet (NBA-style product)
// ============================================================
// Staging tabs 🎰 Pitcher_K_Card / 🎰 Batter_Hits_Card are rebuilt
// automatically when you run this from the menu. Pipeline calls
// merge-only to avoid double work.
// ============================================================

const MLB_BET_CARD_TAB = '🃏 MLB_Bet_Card';
const MLB_BET_CARD_MAX_PLAYS = 30;
/** Same spirit as AI-BOIZ: cap straights per game across all markets on this card. */
const MLB_BET_CARD_MAX_PER_GAME = 2;
/** Total column count on the 🃏 sheet (slate..game_time). Snapshot mirrors this. */
const MLB_BET_CARD_NCOL = 20;

/**
 * Grade rubric — favors small +EV bites at low variance over speculative +odds plays.
 *  A+ : EV ≥ 0.05 AND odds ≤ +130   (high edge, low variance — bypass card caps)
 *  A  : EV ≥ 0.04 AND odds ≤ +180
 *  B+ : EV ≥ 0.025
 *  B  : EV ≥ 0.015
 *  C  : EV > 0
 */
function mlbGradePlay_(ev, american) {
  const e = parseFloat(String(ev));
  const o = parseFloat(String(american));
  if (isNaN(e) || e <= 0) return '';
  if (isNaN(o)) return '';
  if (e >= 0.05  && o <= 130) return 'A+';
  if (e >= 0.04  && o <= 180) return 'A';
  if (e >= 0.025)             return 'B+';
  if (e >= 0.015)             return 'B';
  return 'C';
}

/**
 * Fractional-Kelly stake in dollars at this American price for the model probability.
 * f* = (p*b - q)/b where b = decimal-odds-minus-one. Returns 0 if EV <= 0.
 */
function mlbKellyStake_(p, american, bankroll, fraction) {
  const pn = parseFloat(String(p));
  const o  = parseFloat(String(american));
  const bk = parseFloat(String(bankroll));
  const fr = parseFloat(String(fraction));
  if (isNaN(pn) || isNaN(o) || isNaN(bk) || bk <= 0) return '';
  const frac = !isNaN(fr) && fr > 0 ? Math.min(1, fr) : 0.25;
  const b = o > 0 ? o / 100 : 100 / Math.abs(o);
  if (b <= 0) return '';
  const q = 1 - pn;
  const fStar = (pn * b - q) / b;
  if (!isFinite(fStar) || fStar <= 0) return 0;
  return Math.round(bk * frac * fStar);
}

/** gamePk → { iso, hhmm } map from the 📅 MLB_Schedule tab (gameDateRaw at col 3). */
function mlbScheduleGameTimeIndex_(ss) {
  const idx = {};
  const sh = ss.getSheetByName(MLB_SCHEDULE_TAB);
  if (!sh || sh.getLastRow() < 4) return idx;
  const tz = Session.getScriptTimeZone();
  const block = sh.getRange(4, 1, sh.getLastRow(), 3).getValues();
  for (let i = 0; i < block.length; i++) {
    const g   = parseInt(block[i][0], 10);
    const iso = String(block[i][2] || '').trim();
    if (!g || !iso) continue;
    let hhmm = '';
    try { hhmm = Utilities.formatDate(new Date(iso), tz, 'h:mm a'); } catch (e) {}
    idx[g] = { iso: iso, hhmm: hhmm };
  }
  return idx;
}

/**
 * Rebuild K queue + Poisson card + batter hits card when schedule + odds exist.
 * @returns {boolean} false if prerequisites missing
 */
function mlbRebuildStagingForBetCard_(ss) {
  const sch  = ss.getSheetByName(MLB_SCHEDULE_TAB);
  const odds = ss.getSheetByName(MLB_ODDS_CONFIG.tabName);
  if (!sch || sch.getLastRow() < 4) {
    safeAlert_('MLB Bet Card', 'Need 📅 MLB_Schedule — run Morning or 📅 MLB schedule only first.');
    return false;
  }
  if (!odds || odds.getLastRow() < 4) {
    safeAlert_('MLB Bet Card', 'Need ✅ FanDuel_MLB_Odds — run FanDuel MLB odds first.');
    return false;
  }
  refreshPitcherKSlateQueue();
  refreshPitcherKBetCard();
  refreshBatterHitsCard();
  return true;
}

/**
 * @param {string} srcTab MLB_PITCHER_K_CARD_TAB | MLB_BATTER_HITS_CARD_TAB
 * @param {string} marketLabel e.g. Pitcher strikeouts
 * @param {string} statVerb short label in pick text (K | BB)
 * @param {string} disclaimer row note
 */
function mlbCollectPlaysFromPitcherOddsCard_(ss, cfg, srcTab, marketLabel, statVerb, disclaimer, minEvFloor, maxOddsCap) {
  const src = ss.getSheetByName(srcTab);
  if (!src || src.getLastRow() < 4) return [];
  const last = src.getLastRow();
  const vals = src.getRange(4, 1, last, 22).getValues();
  const plays = [];

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
    if (maxOddsCap != null && parseFloat(String(american)) > maxOddsCap) return;

    const pWin    = bestSide === 'Over' ? r[10] : r[11];
    const implied = bestSide === 'Over' ? r[12] : r[13];
    const matchup = r[1];
    const gamePk  = r[0];
    const hand =
      throws.toUpperCase() === 'R' ? 'RHP' : throws.toUpperCase() === 'L' ? 'LHP' : throws ? throws : '';
    const pickLabel =
      pitcher +
      (hand ? ' (' + hand + ')' : '') +
      ' — ' +
      statVerb +
      ' ' +
      bestSide +
      ' ' +
      String(line) +
      (hpUmp ? ' · HP ' + hpUmp : '');

    plays.push({
      gamePk: gamePk,
      matchup: matchup,
      pickLabel: pickLabel,
      pitcher: pitcher,
      pitcherId: pitcherId,
      side: bestSide,
      line: line,
      american: american,
      pWin: pWin,
      implied: implied,
      ev: isNaN(ev) ? '' : ev,
      lambda: r[8],
      edge: r[9],
      flags: flags,
      market: marketLabel,
    });
  });

  return plays;
}

/** Menu + manual: refresh staging, then write the single 🃏 sheet. */
function refreshMLBBetCard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!mlbRebuildStagingForBetCard_(ss)) return;
  refreshMLBBetCardMergeOnly_();
}

/** Called from PipelineMenu after queues/cards already ran. */
function refreshMLBBetCardMergeOnly_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig();
  const minEvCfg = parseFloat(String(cfg['MIN_EV_BET_CARD'] != null ? cfg['MIN_EV_BET_CARD'] : '0').trim(), 10);
  const minEvFloor = !isNaN(minEvCfg) && minEvCfg > 0 ? minEvCfg : 0;
  const maxOddsCfg = parseFloat(String(cfg['MAX_ODDS_BET_CARD'] != null ? cfg['MAX_ODDS_BET_CARD'] : '').trim());
  const maxOddsCap = !isNaN(maxOddsCfg) ? maxOddsCfg : null;
  const bankrollCfg = parseFloat(String(cfg['BANKROLL'] != null ? cfg['BANKROLL'] : '1000').trim());
  const bankroll    = !isNaN(bankrollCfg) && bankrollCfg > 0 ? bankrollCfg : 1000;
  const kellyFracCfg = parseFloat(String(cfg['KELLY_FRACTION'] != null ? cfg['KELLY_FRACTION'] : '0.25').trim());
  const kellyFrac    = !isNaN(kellyFracCfg) && kellyFracCfg > 0 ? Math.min(1, kellyFracCfg) : 0.25;
  const slateDate    = getSlateDateString_(cfg);

  const kTab   = ss.getSheetByName(MLB_PITCHER_K_CARD_TAB);
  const hitTab = ss.getSheetByName(MLB_BATTER_HITS_CARD_TAB);
  if ((!kTab || kTab.getLastRow() < 4) && (!hitTab || hitTab.getLastRow() < 4)) {
    safeAlert_(
      'MLB Bet Card',
      'No 🎰 staging rows — run Morning (or Pitcher K queue + card + Batter Hits card) first.'
    );
    return;
  }

  let plays = [];
  plays = plays.concat(
    mlbCollectPlaysFromPitcherOddsCard_(
      ss,
      cfg,
      MLB_PITCHER_K_CARD_TAB,
      'Pitcher strikeouts',
      'K',
      'Model: Poisson on λ=blended K/9×proj_IP×park×L/R×optional HP; not devigged.',
      minEvFloor,
      maxOddsCap
    )
  );
  plays = plays.concat(
    mlbCollectPlaysFromPitcherOddsCard_(
      ss,
      cfg,
      MLB_BATTER_HITS_CARD_TAB,
      'Batter hits',
      'H',
      'Model: Binomial P(≥k hits) on λ=BA×est_AB; season BA from Stats API; not devigged.',
      minEvFloor,
      maxOddsCap
    )
  );

  // Tag every play with grade + game start time
  const timeIdx = mlbScheduleGameTimeIndex_(ss);
  plays.forEach(function (p) {
    p.grade = mlbGradePlay_(p.ev, p.american);
    const t  = timeIdx[parseInt(p.gamePk, 10)] || { iso: '', hhmm: '' };
    p.gameTimeIso  = t.iso;
    p.gameTimeHHmm = t.hhmm;
  });

  // Pre-sort by EV desc so cap-fill takes the strongest plays first
  plays.sort(function (a, b) {
    const be = parseFloat(String(b.ev));
    const ae = parseFloat(String(a.ev));
    if (isNaN(be) && isNaN(ae)) return 0;
    if (isNaN(be)) return 1;
    if (isNaN(ae)) return -1;
    return be - ae;
  });

  // Selection: A+ plays bypass both the per-game cap and the total cap.
  // Non-A+ plays still respect MLB_BET_CARD_MAX_PER_GAME and MLB_BET_CARD_MAX_PLAYS,
  // counted against the same game buckets that A+ plays already filled.
  const selected = [];
  const perGame  = {};
  // Pass 1: take every A+ play
  plays.forEach(function (p) {
    if (p.grade !== 'A+') return;
    const gKey = String(p.gamePk != null ? p.gamePk : p.matchup || '').trim() || 'unknown';
    perGame[gKey] = (perGame[gKey] || 0) + 1;
    selected.push(p);
  });
  // Pass 2: fill remaining slots with non-A+ plays under existing caps.
  // A+ plays already counted in perGame[] count against MAX_PER_GAME for non-A+ fills.
  let nonAPlus = 0;
  for (let i = 0; i < plays.length; i++) {
    const p = plays[i];
    if (p.grade === 'A+') continue;
    if (nonAPlus >= MLB_BET_CARD_MAX_PLAYS) break;
    const gKey = String(p.gamePk != null ? p.gamePk : p.matchup || '').trim() || 'unknown';
    if ((perGame[gKey] || 0) >= MLB_BET_CARD_MAX_PER_GAME) continue;
    perGame[gKey] = (perGame[gKey] || 0) + 1;
    selected.push(p);
    nonAPlus++;
  }

  // Display order: game start time asc, then EV desc within game
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
    const kelly = mlbKellyStake_(p.pWin, p.american, bankroll, kellyFrac);
    return [
      slateDate,                                                              // 0  slate_date
      idx + 1,                                                                // 1  rank
      p.grade || '',                                                          // 2  grade
      p.gamePk,                                                               // 3  gamePk
      p.matchup,                                                              // 4  matchup
      p.pickLabel,                                                            // 5  play
      p.pitcher,                                                              // 6  player
      p.market,                                                               // 7  market
      p.side,                                                                 // 8  side
      p.line,                                                                 // 9  line
      p.american,                                                             // 10 american_odds
      p.pWin,                                                                 // 11 model_prob
      p.implied !== '' && p.implied != null ? p.implied : '',                 // 12 implied_prob
      p.ev,                                                                   // 13 ev_per_$1
      kelly,                                                                  // 14 kelly_$
      p.lambda,                                                               // 15 lambda
      p.edge,                                                                 // 16 edge_vs_line
      p.flags,                                                                // 17 flags
      p.pitcherId != null && p.pitcherId !== '' ? p.pitcherId : '',           // 18 pitcher_id
      p.gameTimeHHmm || '',                                                   // 19 game_time
    ];
  });

  if (rows.length === 0) {
    const evHint =
      minEvFloor > 0
        ? 'EV≥' + minEvFloor + ' per $1 (⚙️ MIN_EV_BET_CARD), '
        : 'positive EV, ';
    const oddsHint = maxOddsCap != null ? 'odds≤+' + maxOddsCap + ' (⚙️ MAX_ODDS_BET_CARD), ' : '';
    const blank = new Array(MLB_BET_CARD_NCOL).fill('');
    blank[0] = slateDate;
    blank[5] = 'No qualifying plays — need 🎰 K and/or Hits cards with ' +
      evHint + oddsHint +
      'both FD prices, no injury flag (max ' + MLB_BET_CARD_MAX_PER_GAME + ' per game; A+ plays bypass).';
    rows.push(blank);
  }

  let sh = ss.getSheetByName(MLB_BET_CARD_TAB);
  if (sh) {
    const cr = Math.max(sh.getLastRow(), 3);
    const cc = Math.max(sh.getLastColumn(), MLB_BET_CARD_NCOL);
    try {
      sh.getRange(1, 1, cr, cc).breakApart();
    } catch (e) {
      Logger.log('refreshMLBBetCard breakApart: ' + e.message);
    }
    sh.clearContents();
    sh.clearFormats();
  } else {
    sh = ss.insertSheet(MLB_BET_CARD_TAB);
  }
  sh.setTabColor('#00695c');

  // Column widths (20 cols)
  [80, 40, 48, 72, 180, 280, 140, 110, 50, 48, 64, 64, 64, 64, 64, 56, 56, 140, 72, 64]
    .forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });

  sh.getRange(1, 1, 1, MLB_BET_CARD_NCOL)
    .merge()
    .setValue(
      '🃏 MLB BET CARD — Pitcher K + Batter Hits — by game time, then EV. A+ plays bypass caps. ' +
      'kelly_$ = bankroll × KELLY_FRACTION × Kelly. Not betting advice.'
    )
    .setFontWeight('bold')
    .setBackground('#004d40')
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center')
    .setWrap(true);
  sh.setRowHeight(1, 40);

  const headers = [
    'slate_date',
    'rank',
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
    'implied %',
    'ev / $1',
    'kelly $',
    'lambda',
    'edge_vs_line',
    'flags',
    'pitcher_id',
    'game_time',
  ];
  sh.getRange(3, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight('bold')
    .setBackground('#00897b')
    .setFontColor('#ffffff');

  sh.getRange(4, 1, rows.length, headers.length).setValues(rows);

  const hasRealRows = rows.length > 0 && rows[0][5] && String(rows[0][5]).indexOf('No qualifying') === -1;
  if (hasRealRows) {
    try { ss.setNamedRange('MLB_BET_CARD', sh.getRange(4, 1, rows.length, headers.length)); } catch (e) {}

    // Number formats: probabilities as %, EV with sign, Kelly $ as currency.
    sh.getRange(4, 12, rows.length, 1).setNumberFormat('0.0%');   // model %
    sh.getRange(4, 13, rows.length, 1).setNumberFormat('0.0%');   // implied %
    sh.getRange(4, 14, rows.length, 1).setNumberFormat('+0.000;-0.000'); // ev/$1
    sh.getRange(4, 15, rows.length, 1).setNumberFormat('$0');     // kelly $

    // Grade cell color coding (col 3 = grade)
    const gradeBg = { 'A+': '#66bb6a', 'A': '#a5d6a7', 'B+': '#fff59d', 'B': '#ffcc80', 'C': '#ef9a9a' };
    for (let i = 0; i < rows.length; i++) {
      const g  = String(rows[i][2] || '');
      const bg = gradeBg[g];
      if (bg) sh.getRange(4 + i, 3).setBackground(bg).setFontWeight('bold').setHorizontalAlignment('center');
      // A+ rows: highlight the entire row light green for at-a-glance scan
      if (g === 'A+') {
        sh.getRange(4 + i, 1, 1, headers.length).setBackground('#e8f5e9').setFontWeight('bold');
        sh.getRange(4 + i, 3).setBackground('#66bb6a'); // re-set grade cell darker after row paint
      }
    }

    // Game dividers: thick bottom border on the last row of each game group
    let prevPk = String(rows[0][3] || '');
    for (let i = 1; i < rows.length; i++) {
      const pk = String(rows[i][3] || '');
      if (pk !== prevPk) {
        sh.getRange(4 + i - 1, 1, 1, headers.length)
          .setBorder(null, null, true, null, null, null, '#37474f', SpreadsheetApp.BorderStyle.SOLID_THICK);
        prevPk = pk;
      }
    }
  }

  sh.setFrozenRows(3);

  const aPlus = rows.filter(function (r) { return String(r[2]) === 'A+'; }).length;
  ss.toast(rows.length + ' bet rows · ' + aPlus + ' A+ · ' + slateDate, 'MLB Bet Card', 6);
}
