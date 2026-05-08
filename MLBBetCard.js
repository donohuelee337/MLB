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
 * Rebuild K queue + Poisson card + batter hits + batter TB cards when
 * schedule + odds exist.
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
  refreshBatterTBCard();
  return true;
}

/**
 * @param {string} srcTab MLB_PITCHER_K_CARD_TAB | MLB_BATTER_HITS_CARD_TAB
 * @param {string} marketLabel e.g. Pitcher strikeouts
 * @param {string} statVerb short label in pick text (K | BB)
 * @param {string} disclaimer row note
 */
function mlbCollectPlaysFromPitcherOddsCard_(ss, cfg, srcTab, marketLabel, statVerb, disclaimer, minEvFloor, maxOddsCap, minOddsFloor) {
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
    if (minOddsFloor != null && parseFloat(String(american)) < minOddsFloor) return;

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
  const minOddsCfg = parseFloat(String(cfg['MIN_ODDS_BET_CARD'] != null ? cfg['MIN_ODDS_BET_CARD'] : '-250').trim());
  const minOddsFloor = !isNaN(minOddsCfg) ? minOddsCfg : null;
  const bankrollCfg = parseFloat(String(cfg['BANKROLL'] != null ? cfg['BANKROLL'] : '1000').trim());
  const bankroll    = !isNaN(bankrollCfg) && bankrollCfg > 0 ? bankrollCfg : 1000;
  const kellyFracCfg = parseFloat(String(cfg['KELLY_FRACTION'] != null ? cfg['KELLY_FRACTION'] : '0.25').trim());
  const kellyFrac    = !isNaN(kellyFracCfg) && kellyFracCfg > 0 ? Math.min(1, kellyFracCfg) : 0.25;
  const slateDate    = getSlateDateString_(cfg);

  const kTab   = ss.getSheetByName(MLB_PITCHER_K_CARD_TAB);
  const hitTab = ss.getSheetByName(MLB_BATTER_HITS_CARD_TAB);
  const tbTab  = ss.getSheetByName(MLB_BATTER_TB_CARD_TAB);
  if (
    (!kTab   || kTab.getLastRow()   < 4) &&
    (!hitTab || hitTab.getLastRow() < 4) &&
    (!tbTab  || tbTab.getLastRow()  < 4)
  ) {
    safeAlert_(
      'MLB Bet Card',
      'No 🎰 staging rows — run Morning (or Pitcher K + Batter Hits + Batter TB cards) first.'
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
      maxOddsCap,
      minOddsFloor
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
      maxOddsCap,
      minOddsFloor
    )
  );
  plays = plays.concat(
    mlbCollectPlaysFromPitcherOddsCard_(
      ss,
      cfg,
      MLB_BATTER_TB_CARD_TAB,
      'Batter total bases',
      'TB',
      'Model: Poisson P(≥k TB) on λ=SLG×est_AB; season SLG from Stats API; not devigged.',
      minEvFloor,
      maxOddsCap,
      minOddsFloor
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

  // Display order: game start time asc → group by gamePk when times tie → EV desc within game
  selected.sort(function (a, b) {
    // 1. Game start time ascending (empty/unknown times sink to bottom)
    const ta = a.gameTimeIso || '';
    const tb = b.gameTimeIso || '';
    if (ta && tb && ta !== tb) return ta < tb ? -1 : 1;
    if (ta && !tb) return -1;
    if (!ta && tb) return 1;
    // 2. Same start time → keep games grouped (sort by gamePk so same game stays together)
    const ga = String(a.gamePk != null ? a.gamePk : a.matchup || '');
    const gb = String(b.gamePk != null ? b.gamePk : b.matchup || '');
    if (ga !== gb) return ga < gb ? -1 : 1;
    // 3. Within the same game: EV descending (best bet first)
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
  sh.setTabColor('#1a2332');

  // ── Card-back aesthetic ──────────────────────────────────────
  // Inspired by Topps stat-blocks + The Show overlays:
  // ivory paper, navy ink, monospace for numbers, condensed serif for labels.
  const PAPER       = '#faf7f0';      // very pale ivory (subtler than parchment)
  const PAPER_ALT   = '#f4efe2';      // band stripe (still subtle)
  const INK         = '#1a2332';      // dark navy
  const INK_SOFT    = '#56627a';      // muted slate for de-emphasized cells
  const RULE        = '#d4cdb8';      // light warm gray
  const HEADER_BG   = '#1a2332';      // navy header
  const HEADER_TEXT = '#faf7f0';
  const BODY_FONT   = 'Source Sans Pro'; // body labels
  const NUM_FONT    = 'Roboto Mono';      // tabular numbers (Topps stat block)
  const TITLE_FONT  = 'Playfair Display'; // title only

  // Column widths (20 cols)
  [76, 36, 42, 64, 168, 280, 130, 96, 46, 44, 56, 60, 60, 64, 56, 50, 60, 130, 64, 56]
    .forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });

  // Title bar — small, restrained: serif italic on ivory with a thin navy rule.
  sh.getRange(1, 1, 1, MLB_BET_CARD_NCOL)
    .merge()
    .setValue(
      'MLB Card · ' + slateDate + ' · sorted by game time, EV within game · A+ plays bypass caps'
    )
    .setFontFamily(TITLE_FONT)
    .setFontSize(11)
    .setFontStyle('italic')
    .setFontWeight('normal')
    .setBackground(PAPER)
    .setFontColor(INK)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setWrap(true);
  sh.setRowHeight(1, 26);
  sh.getRange(1, 1, 1, MLB_BET_CARD_NCOL)
    .setBorder(null, null, true, null, null, null, INK, SpreadsheetApp.BorderStyle.SOLID);

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
    'kelly $',
    'proj',
    'proj − line',
    'flags',
    'player_id',
    'time',
  ];
  sh.getRange(3, 1, 1, headers.length)
    .setValues([headers])
    .setFontFamily(BODY_FONT)
    .setFontSize(9)
    .setFontWeight('normal')
    .setBackground(HEADER_BG)
    .setFontColor(HEADER_TEXT)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  sh.setRowHeight(3, 22);

  sh.getRange(4, 1, rows.length, headers.length).setValues(rows);

  const hasRealRows = rows.length > 0 && rows[0][5] && String(rows[0][5]).indexOf('No qualifying') === -1;
  if (hasRealRows) {
    try { ss.setNamedRange('MLB_BET_CARD', sh.getRange(4, 1, rows.length, headers.length)); } catch (e) {}

    // Body styling: clean sans body on ivory, light-gray hairline rules.
    const body = sh.getRange(4, 1, rows.length, headers.length);
    body.setFontFamily(BODY_FONT)
        .setFontSize(10)
        .setFontWeight('normal')
        .setFontColor(INK)
        .setBackground(PAPER)
        .setVerticalAlignment('middle')
        .setBorder(true, true, true, true, true, true, RULE, SpreadsheetApp.BorderStyle.SOLID);
    sh.setRowHeights(4, rows.length, 21);

    // Numeric columns get tabular monospace (Topps stat-block feel)
    const numCols = [10, 11, 12, 13, 14, 15, 16, 17];  // line, odds, model%, book%, ev, kelly, proj, proj-line
    numCols.forEach(function (c) {
      sh.getRange(4, c, rows.length, 1).setFontFamily(NUM_FONT).setFontSize(9.5);
    });

    // Number formats
    sh.getRange(4, 10, rows.length, 1).setNumberFormat('0.0').setHorizontalAlignment('right');     // line
    sh.getRange(4, 11, rows.length, 1).setNumberFormat('+0;-0').setHorizontalAlignment('right');   // odds
    sh.getRange(4, 12, rows.length, 1).setNumberFormat('0.0%').setHorizontalAlignment('right');    // model %
    sh.getRange(4, 13, rows.length, 1).setNumberFormat('0.0%').setHorizontalAlignment('right');    // book %
    sh.getRange(4, 14, rows.length, 1).setNumberFormat('+0.000;-0.000').setHorizontalAlignment('right'); // ev
    sh.getRange(4, 15, rows.length, 1).setNumberFormat('$0').setHorizontalAlignment('right');      // kelly
    sh.getRange(4, 16, rows.length, 1).setNumberFormat('0.00').setHorizontalAlignment('right');    // proj
    sh.getRange(4, 17, rows.length, 1).setNumberFormat('+0.00;-0.00').setHorizontalAlignment('right'); // proj − line
    sh.getRange(4,  9, rows.length, 1).setHorizontalAlignment('center'); // side

    // Subtle alternating row band within each game group
    let bandToggle = false;
    let prevPkBand = String(rows[0][3] || '');
    for (let i = 0; i < rows.length; i++) {
      const pk = String(rows[i][3] || '');
      if (pk !== prevPkBand) { bandToggle = false; prevPkBand = pk; }
      if (bandToggle) sh.getRange(4 + i, 1, 1, headers.length).setBackground(PAPER_ALT);
      bandToggle = !bandToggle;
    }

    // Grade cell — small muted block, condensed-feel sans
    const gradeBg = {
      'A+': '#5d8a3a',  // muted forest (Topps card-back green)
      'A':  '#9bb56b',
      'B+': '#e6c955',
      'B':  '#d99a4a',
      'C':  '#c47670',
    };
    for (let i = 0; i < rows.length; i++) {
      const g  = String(rows[i][2] || '');
      const bg = gradeBg[g];
      if (bg) {
        sh.getRange(4 + i, 3)
          .setBackground(bg)
          .setFontFamily(BODY_FONT)
          .setFontWeight('bold')
          .setFontColor(g === 'A+' || g === 'C' ? PAPER : INK)
          .setHorizontalAlignment('center');
      }
    }

    // Model % color cue — well-above-coin-flip green, coin-flip-zone amber
    for (let i = 0; i < rows.length; i++) {
      const mp = parseFloat(String(rows[i][11]));
      if (isNaN(mp)) continue;
      let color = INK;
      if (mp >= 0.62)      color = '#2e6b1f';
      else if (mp >= 0.55) color = INK;
      else                 color = '#b56807';   // amber — basically coin flip
      sh.getRange(4 + i, 12).setFontColor(color);
    }

    // EV color cue: green for strong, slate for marginal
    for (let i = 0; i < rows.length; i++) {
      const ev = parseFloat(String(rows[i][13]));
      if (isNaN(ev)) continue;
      sh.getRange(4 + i, 14).setFontColor(ev >= 0.05 ? '#2e6b1f' : ev >= 0.02 ? INK : INK_SOFT);
    }

    // Game dividers: hairline solid in navy ink (subtle, not a bar)
    let prevPk = String(rows[0][3] || '');
    for (let i = 1; i < rows.length; i++) {
      const pk = String(rows[i][3] || '');
      if (pk !== prevPk) {
        sh.getRange(4 + i - 1, 1, 1, headers.length)
          .setBorder(null, null, true, null, null, null, INK, SpreadsheetApp.BorderStyle.SOLID);
        prevPk = pk;
      }
    }

    // De-emphasize technical columns
    sh.getRange(4, 4, rows.length, 1).setFontColor(INK_SOFT).setFontFamily(NUM_FONT).setFontSize(9); // gamePk
    sh.getRange(4, 19, rows.length, 1).setFontColor(INK_SOFT).setFontFamily(NUM_FONT).setFontSize(9); // player_id

    // Time column — small italic serif, right-aligned
    sh.getRange(4, 20, rows.length, 1)
      .setFontFamily(TITLE_FONT)
      .setFontStyle('italic')
      .setFontSize(10)
      .setHorizontalAlignment('right');
  }

  // Bet tracker section below the main card
  const palette = {
    paper: PAPER, paperAlt: PAPER_ALT, ink: INK, inkSoft: INK_SOFT,
    rule: RULE, headerBg: HEADER_BG, headerText: HEADER_TEXT,
    bodyFont: BODY_FONT, numFont: NUM_FONT, titleFont: TITLE_FONT,
  };
  const trackerStart = 4 + rows.length + 2;  // 2 spacer rows after main card
  mlbAppendBetTrackerSection_(ss, sh, trackerStart, slateDate, palette);

  sh.setFrozenRows(3);
  sh.setHiddenGridlines(true);

  const aPlus = rows.filter(function (r) { return String(r[2]) === 'A+'; }).length;
  ss.toast(rows.length + ' bet rows · ' + aPlus + ' A+ · ' + slateDate, 'MLB Bet Card', 6);
}

/**
 * Append a hit-rate-by-model-probability tracker below the main bet card.
 * Reads 📋 MLB_Results_Log, groups graded rows by market × time window × bucket,
 * and writes a small results panel using the same lineup-card palette.
 */
function mlbAppendBetTrackerSection_(ss, sh, startRow, slateDate, p) {
  const log = ss.getSheetByName(MLB_RESULTS_LOG_TAB);
  if (!log || log.getLastRow() < 4) return startRow;

  const tz   = Session.getScriptTimeZone();
  const data = log.getRange(4, 1, log.getLastRow(), MLB_RESULTS_LOG_NCOL).getValues();

  // Build cutoff date strings (yyyy-MM-dd) — string compare works since format is ISO.
  const slateD = new Date(slateDate + 'T12:00:00');
  const ymd = function (offsetDays) {
    return Utilities.formatDate(new Date(slateD.getTime() + offsetDays * 86400000), tz, 'yyyy-MM-dd');
  };
  const yest  = ymd(-1);
  const cut7  = ymd(-7);
  const cut30 = ymd(-30);

  const markets = [
    { key: 'K',  label: 'STRIKEOUTS',  test: function (m) { return m.indexOf('strikeout')  !== -1; } },
    { key: 'H',  label: 'HITS',        test: function (m) { return m.indexOf('batter hit') !== -1; } },
    { key: 'TB', label: 'TOTAL BASES', test: function (m) { return m.indexOf('total base') !== -1; } },
  ];
  const buckets = [
    { lo: 0.50, hi: 0.60, label: '50–60%' },
    { lo: 0.60, hi: 0.70, label: '60–70%' },
    { lo: 0.70, hi: 0.80, label: '70–80%' },
    { lo: 0.80, hi: 0.90, label: '80–90%' },
    { lo: 0.90, hi: 1.001, label: '90–100%' },
  ];
  const windows = ['yesterday', 'last7', 'last30', 'lifetime'];

  // stats[marketKey][window][bucketLabel] = { w, l, p }
  const stats = {};
  markets.forEach(function (m) {
    stats[m.key] = {};
    windows.forEach(function (w) {
      stats[m.key][w] = {};
      buckets.forEach(function (b) { stats[m.key][w][b.label] = { w: 0, l: 0, p: 0 }; });
    });
  });

  // Aggregate
  data.forEach(function (row) {
    const slate = String(row[1] || '').trim();
    if (!slate || slate >= slateDate) return;
    const market = String(row[5] || '').toLowerCase();
    const result = String(row[16] || '').trim().toUpperCase();
    if (result !== 'WIN' && result !== 'LOSS' && result !== 'PUSH') return;
    const mp = parseFloat(String(row[9]));
    if (isNaN(mp) || mp < 0.5) return;

    let mKey = null;
    for (let i = 0; i < markets.length; i++) {
      if (markets[i].test(market)) { mKey = markets[i].key; break; }
    }
    if (!mKey) return;

    let bKey = null;
    for (let i = 0; i < buckets.length; i++) {
      if (mp >= buckets[i].lo && mp < buckets[i].hi) { bKey = buckets[i].label; break; }
    }
    if (!bKey) return;

    function bump(w) {
      const s = stats[mKey][w][bKey];
      if      (result === 'WIN')  s.w++;
      else if (result === 'LOSS') s.l++;
      else                        s.p++;
    }
    if (slate === yest)   bump('yesterday');
    if (slate >= cut7)    bump('last7');
    if (slate >= cut30)   bump('last30');
    bump('lifetime');
  });

  function fmtCell(s) {
    const n = s.w + s.l;
    if (n === 0) return '—';
    return s.w + '-' + s.l + '  ' + Math.round((s.w / n) * 100) + '%';
  }

  let r = startRow;

  // Title row — italic serif on paper, navy underline
  sh.getRange(r, 1, 1, MLB_BET_CARD_NCOL)
    .merge()
    .setValue('Bet Tracker  ·  hit rate by model probability bucket  ·  graded slates only')
    .setFontFamily(p.titleFont)
    .setFontSize(11)
    .setFontStyle('italic')
    .setFontColor(p.ink)
    .setBackground(p.paper)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setBorder(true, null, true, null, null, null, p.ink, SpreadsheetApp.BorderStyle.SOLID);
  sh.setRowHeight(r, 28);
  r++;

  // Window-header row (blank label cell + 4 window headers)
  sh.getRange(r, 1, 1, MLB_BET_CARD_NCOL).setBackground(p.paper);
  sh.getRange(r, 1, 1, 5)
    .setValues([['', 'YESTERDAY', 'LAST 7', 'LAST 30', 'LIFETIME']])
    .setFontFamily(p.bodyFont)
    .setFontSize(9)
    .setFontColor(p.ink)
    .setBackground(p.paperAlt)
    .setHorizontalAlignment('center');
  sh.setColumnWidth(2, 96);
  sh.setColumnWidth(3, 96);
  sh.setColumnWidth(4, 96);
  sh.setColumnWidth(5, 96);
  r++;

  markets.forEach(function (m) {
    // Market subtitle row
    sh.getRange(r, 1, 1, MLB_BET_CARD_NCOL).setBackground(p.paper);
    sh.getRange(r, 1, 1, 5).merge()
      .setValue(m.label + '  (' + m.key + ')')
      .setFontFamily(p.titleFont)
      .setFontSize(10)
      .setFontStyle('italic')
      .setFontColor(p.ink)
      .setBackground(p.paper)
      .setHorizontalAlignment('left')
      .setBorder(null, null, true, null, null, null, p.rule, SpreadsheetApp.BorderStyle.SOLID);
    sh.setRowHeight(r, 22);
    r++;

    // Bucket rows
    buckets.forEach(function (b) {
      const cells = [b.label];
      windows.forEach(function (w) { cells.push(fmtCell(stats[m.key][w][b.label])); });
      sh.getRange(r, 1, 1, MLB_BET_CARD_NCOL).setBackground(p.paper);
      sh.getRange(r, 1, 1, 5)
        .setValues([cells])
        .setFontFamily(p.bodyFont)
        .setFontSize(10)
        .setFontColor(p.ink)
        .setBackground(p.paper)
        .setHorizontalAlignment('center')
        .setVerticalAlignment('middle');
      // Bucket label: light italic, left-aligned
      sh.getRange(r, 1)
        .setFontFamily(p.titleFont)
        .setFontStyle('italic')
        .setHorizontalAlignment('right')
        .setFontColor(p.inkSoft);
      // Stat cells: tabular monospace
      sh.getRange(r, 2, 1, 4)
        .setFontFamily(p.numFont)
        .setFontSize(9.5);
      sh.setRowHeight(r, 20);
      r++;
    });

    // Spacer between markets
    sh.getRange(r, 1, 1, MLB_BET_CARD_NCOL).setBackground(p.paper);
    sh.setRowHeight(r, 8);
    r++;
  });

  return r;
}
