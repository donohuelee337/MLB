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

    const pWin = bestSide === 'Over' ? r[10] : r[11];
    const matchup = r[1];
    const gamePk = r[0];
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
      book: 'fanduel',
      pWin: pWin,
      ev: isNaN(ev) ? '' : ev,
      lambda: r[8],
      edge: r[9],
      flags: flags,
      market: marketLabel,
      disclaimer: disclaimer,
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
  const slateDate = getSlateDateString_(cfg);

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
    return [
      slateDate,
      idx + 1,
      p.grade || '',
      p.gamePk,
      p.matchup,
      p.pickLabel,
      p.pitcher,
      p.market,
      p.side,
      p.line,
      p.american,
      p.book,
      p.pWin,
      p.ev,
      p.lambda,
      p.edge,
      p.flags,
      p.pitcherId != null && p.pitcherId !== '' ? p.pitcherId : '',
      p.disclaimer,
      p.gameTimeHHmm || '',
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

  [88, 40, 44, 72, 200, 280, 140, 130, 56, 56, 72, 72, 72, 56, 56, 56, 140, 72, 280, 72]
    .forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });

  sh.getRange(1, 1, 1, MLB_BET_CARD_NCOL)
    .merge()
    .setValue(
      '🃏 MLB BET CARD — Pitcher K + Batter Hits — by game time, then EV. A+ plays bypass card caps. Not betting advice.'
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
    'american_odds',
    'book',
    'model_prob',
    'ev_per_$1',
    'lambda',
    'edge_vs_line',
    'flags',
    'pitcher_id',
    'disclaimer',
    'game_time',
  ];
  sh.getRange(3, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight('bold')
    .setBackground('#00897b')
    .setFontColor('#ffffff');

  sh.getRange(4, 1, rows.length, headers.length).setValues(rows);
  if (rows.length > 0 && rows[0][5] && String(rows[0][5]).indexOf('No qualifying') === -1) {
    try {
      ss.setNamedRange('MLB_BET_CARD', sh.getRange(4, 1, rows.length, headers.length));
    } catch (e) {}
  }

  // Visually highlight A+ rows (col 3 = grade) so they jump out of the card.
  if (rows.length > 0 && rows[0][5] && String(rows[0][5]).indexOf('No qualifying') === -1) {
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][2]) === 'A+') {
        sh.getRange(4 + i, 1, 1, headers.length).setBackground('#e8f5e9').setFontWeight('bold');
      }
    }
  }

  sh.setFrozenRows(3);

  const aPlus = rows.filter(function (r) { return String(r[2]) === 'A+'; }).length;
  ss.toast(rows.length + ' bet rows · ' + aPlus + ' A+ · ' + slateDate, 'MLB Bet Card', 6);
}
