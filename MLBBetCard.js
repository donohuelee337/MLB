// ============================================================
// 🃏 MLB Bet Card — multi-market straights (AI-BOIZ / NBA rules)
// ============================================================
// Merges all model cards, sorts by EV, per-game + total caps.
// Singles filter (NBA-style): main lines only in queue builders; optional
// American band CARD_SINGLES_MIN_AMERICAN..MAX (default -150..+150).
// ============================================================

const MLB_BET_CARD_TAB = '🃏 MLB_Bet_Card';
const MLB_BET_CARD_REJECTS_TAB = '🧪 MLB_Bet_Card_Debug';
const MLB_BET_CARD_MAX_PLAYS = 48;
const MLB_BET_CARD_MAX_PER_GAME = 2;
const MLB_BET_CARD_BUILD_STAMP = '2026-04-26-bc1';

/** When true: Pitcher walks skip NBA odds band + MIN_EV_BET_CARD, and may use 1 extra slot per game (see refreshMLBBetCard). */
function mlbBetCardForcePitcherBb_(cfg) {
  const c = cfg || {};
  // Prefer the walks-named key; keep legacy BB key for backward compatibility.
  const v =
    c['MLB_FORCE_PITCHER_WALKS_BET_CARD'] != null
      ? c['MLB_FORCE_PITCHER_WALKS_BET_CARD']
      : c['MLB_FORCE_PITCHER_BB_BET_CARD'];
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) return true;
  if (v === true || v === 1) return true;
  const s = String(v)
    .trim()
    .toLowerCase();
  if (s === 'false' || s === '0' || s === 'no') return false;
  return s === 'true' || s === '1' || s === 'yes';
}

/** AI-BOIZ bet card spirit: straights American in [min, max] (e.g. -150 .. +150). */
function mlbCardSinglesOddsBandOk_(american, cfg) {
  const c = cfg || {};
  const off = String(c['CARD_USE_NBA_ODDS_BAND'] != null ? c['CARD_USE_NBA_ODDS_BAND'] : 'true')
    .trim()
    .toLowerCase();
  if (off === 'false' || off === '0' || off === 'no') return true;
  const lo = parseFloat(String(c['CARD_SINGLES_MIN_AMERICAN'] != null ? c['CARD_SINGLES_MIN_AMERICAN'] : '-150'), 10);
  const hi = parseFloat(String(c['CARD_SINGLES_MAX_AMERICAN'] != null ? c['CARD_SINGLES_MAX_AMERICAN'] : '150'), 10);
  const o = parseFloat(String(american), 10);
  if (isNaN(o)) return false;
  if (o >= 0) return !isNaN(hi) && o <= hi;
  return !isNaN(lo) && o >= lo;
}

function refreshMLBBetCard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig();
  const minEvCfg = parseFloat(String(cfg['MIN_EV_BET_CARD'] != null ? cfg['MIN_EV_BET_CARD'] : '0').trim(), 10);
  const minEvFloor = !isNaN(minEvCfg) && minEvCfg > 0 ? minEvCfg : 0;
  const slateDate = getSlateDateString_(cfg);

  const srcK = ss.getSheetByName(MLB_PITCHER_K_CARD_TAB);
  const srcPo = ss.getSheetByName(MLB_PITCHER_OUTS_CARD_TAB);
  const srcPbb = ss.getSheetByName(MLB_PITCHER_BB_CARD_TAB);
  const srcPha = ss.getSheetByName(MLB_PITCHER_HA_CARD_TAB);
  const srcTb = ss.getSheetByName(MLB_BATTER_TB_CARD_TAB);
  const srcHits = ss.getSheetByName(MLB_BATTER_HITS_CARD_TAB);
  const srcHr = ss.getSheetByName(MLB_BATTER_HR_CARD_TAB);

  const anyCard =
    (srcK && srcK.getLastRow() >= 4) ||
    (srcPo && srcPo.getLastRow() >= 4) ||
    (srcPbb && srcPbb.getLastRow() >= 4) ||
    (srcPha && srcPha.getLastRow() >= 4) ||
    (srcTb && srcTb.getLastRow() >= 4) ||
    (srcHits && srcHits.getLastRow() >= 4) ||
    (srcHr && srcHr.getLastRow() >= 4);

  if (!anyCard) {
    safeAlert_(
      'MLB Bet Card',
      'Run the pipeline or individual model cards first (pitcher props + batter cards).'
    );
    return;
  }

  const plays = [];
  const rejects = [];

  function logReject_(obj) {
    rejects.push([
      slateDate,
      obj.stage || '',
      obj.reason || '',
      obj.market || '',
      obj.gamePk != null ? obj.gamePk : '',
      obj.matchup || '',
      obj.player || '',
      obj.side || '',
      obj.line != null ? obj.line : '',
      obj.american != null ? obj.american : '',
      obj.ev != null ? obj.ev : '',
      obj.flags || '',
    ]);
  }

  function pushPitcherMirror_(r, marketLabel, pickMid, lambdaIx) {
    const relaxWalks = mlbBetCardForcePitcherBb_(cfg) && marketLabel === 'Pitcher walks';
    const flags = String(r[16] || '');
    const pid = r[17];
    const hpUmp = String(r[18] || '').trim();
    const throws = String(r[19] || '').trim();
    const gamePk = r[0];
    const matchup = r[1];
    const pitcher = String(r[2] || '').trim();
    const line = r[3];
    const fdOver = r[4];
    const fdUnder = r[5];
    if (flags.indexOf('injury') !== -1) {
      logReject_({ stage: 'input-filter', reason: 'injury_flag', market: marketLabel, gamePk: gamePk, matchup: matchup, player: pitcher, flags: flags });
      return;
    }
    const bestSide = String(r[14] || '').trim();
    if (bestSide !== 'Over' && bestSide !== 'Under') {
      logReject_({ stage: 'input-filter', reason: 'no_best_side', market: marketLabel, gamePk: gamePk, matchup: matchup, player: pitcher, flags: flags });
      return;
    }
    if (line === '' || line == null) {
      logReject_({ stage: 'input-filter', reason: 'missing_line', market: marketLabel, gamePk: gamePk, matchup: matchup, player: pitcher, side: bestSide, flags: flags });
      return;
    }
    const american = bestSide === 'Over' ? fdOver : fdUnder;
    if (american === '' || american == null || isNaN(parseFloat(String(american)))) {
      logReject_({ stage: 'input-filter', reason: 'invalid_american', market: marketLabel, gamePk: gamePk, matchup: matchup, player: pitcher, side: bestSide, line: line, american: american, flags: flags });
      return;
    }
    if (!pitcher) {
      logReject_({ stage: 'input-filter', reason: 'missing_player', market: marketLabel, gamePk: gamePk, matchup: matchup, side: bestSide, line: line, american: american, flags: flags });
      return;
    }
    const evRaw = r[15];
    const ev = parseFloat(String(evRaw));
    if (isNaN(ev) || ev <= 0) {
      logReject_({ stage: 'edge-filter', reason: 'non_positive_ev', market: marketLabel, gamePk: gamePk, matchup: matchup, player: pitcher, side: bestSide, line: line, american: american, ev: evRaw, flags: flags });
      return;
    }
    if (!relaxWalks && minEvFloor > 0 && ev < minEvFloor) {
      logReject_({ stage: 'edge-filter', reason: 'below_min_ev_floor', market: marketLabel, gamePk: gamePk, matchup: matchup, player: pitcher, side: bestSide, line: line, american: american, ev: ev, flags: flags });
      return;
    }
    if (!relaxWalks && !mlbCardSinglesOddsBandOk_(american, cfg)) {
      logReject_({ stage: 'odds-filter', reason: 'outside_odds_band', market: marketLabel, gamePk: gamePk, matchup: matchup, player: pitcher, side: bestSide, line: line, american: american, ev: ev, flags: flags });
      return;
    }
    const pWin = bestSide === 'Over' ? r[8] : r[9];
    const hand =
      throws.toUpperCase() === 'R' ? 'RHP' : throws.toUpperCase() === 'L' ? 'LHP' : throws ? throws : '';
    const pickLabel =
      pitcher +
      (hand ? ' (' + hand + ')' : '') +
      ' — ' +
      pickMid +
      ' ' +
      bestSide +
      ' ' +
      String(line) +
      (hpUmp ? ' · HP ' + hpUmp : '');
    plays.push({
      gamePk: r[0],
      matchup: r[1],
      pickLabel: pickLabel,
      player: pitcher,
      playerId: pid,
      side: bestSide,
      line: line,
      american: american,
      book: 'fanduel',
      pWin: pWin,
      ev: ev,
      lambda: r[lambdaIx],
      edge: r[7],
      flags: flags,
      market: marketLabel,
      disclaimer:
        'Poisson λ vs FD main line; ⚙️ MIN_EV_BET_CARD & CARD_USE_NBA_ODDS_BAND; not alt markets in builders.' +
        (relaxWalks
          ? ' MLB_FORCE_PITCHER_WALKS_BET_CARD: band+min-EV floor waived for walks.'
          : ''),
    });
  }

  if (srcK && srcK.getLastRow() >= 4) {
    const lastK = srcK.getLastRow();
    const vals = srcK.getRange(4, 1, lastK, MLB_PITCHER_K_CARD_COLS).getValues();
    vals.forEach(function (r) {
      const flags = String(r[18] || '');
      const pitcherId = r[19];
      const hpUmp = String(r[20] || '').trim();
      const throws = String(r[21] || '').trim();
      const gamePk = r[0];
      const matchup = r[1];
      const pitcher = String(r[3] || '').trim();
      if (flags.indexOf('injury') !== -1) {
        logReject_({ stage: 'input-filter', reason: 'injury_flag', market: 'Pitcher strikeouts', gamePk: gamePk, matchup: matchup, player: pitcher, flags: flags });
        return;
      }
      const bestSide = String(r[16] || '').trim();
      if (bestSide !== 'Over' && bestSide !== 'Under') {
        logReject_({ stage: 'input-filter', reason: 'no_best_side', market: 'Pitcher strikeouts', gamePk: gamePk, matchup: matchup, player: pitcher, flags: flags });
        return;
      }
      const line = r[4];
      if (line === '' || line == null) {
        logReject_({ stage: 'input-filter', reason: 'missing_line', market: 'Pitcher strikeouts', gamePk: gamePk, matchup: matchup, player: pitcher, side: bestSide, flags: flags });
        return;
      }
      const fdOver = r[5];
      const fdUnder = r[6];
      const american = bestSide === 'Over' ? fdOver : fdUnder;
      if (american === '' || american == null || isNaN(parseFloat(String(american)))) {
        logReject_({ stage: 'input-filter', reason: 'invalid_american', market: 'Pitcher strikeouts', gamePk: gamePk, matchup: matchup, player: pitcher, side: bestSide, line: line, american: american, flags: flags });
        return;
      }
      if (!pitcher) {
        logReject_({ stage: 'input-filter', reason: 'missing_player', market: 'Pitcher strikeouts', gamePk: gamePk, matchup: matchup, side: bestSide, line: line, american: american, flags: flags });
        return;
      }
      const ev = parseFloat(String(r[17]));
      if (isNaN(ev) || ev <= 0) {
        logReject_({ stage: 'edge-filter', reason: 'non_positive_ev', market: 'Pitcher strikeouts', gamePk: gamePk, matchup: matchup, player: pitcher, side: bestSide, line: line, american: american, ev: r[17], flags: flags });
        return;
      }
      if (minEvFloor > 0 && ev < minEvFloor) {
        logReject_({ stage: 'edge-filter', reason: 'below_min_ev_floor', market: 'Pitcher strikeouts', gamePk: gamePk, matchup: matchup, player: pitcher, side: bestSide, line: line, american: american, ev: ev, flags: flags });
        return;
      }
      if (!mlbCardSinglesOddsBandOk_(american, cfg)) {
        logReject_({ stage: 'odds-filter', reason: 'outside_odds_band', market: 'Pitcher strikeouts', gamePk: gamePk, matchup: matchup, player: pitcher, side: bestSide, line: line, american: american, ev: ev, flags: flags });
        return;
      }
      const pWin = bestSide === 'Over' ? r[10] : r[11];
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
      plays.push({
        gamePk: r[0],
        matchup: r[1],
        pickLabel: pickLabel,
        player: pitcher,
        playerId: pitcherId,
        side: bestSide,
        line: line,
        american: american,
        book: 'fanduel',
        pWin: pWin,
        ev: ev,
        lambda: r[8],
        edge: r[9],
        flags: flags,
        market: 'Pitcher strikeouts',
        disclaimer: 'Poisson λ K/9×IP; ⚙️ MIN_EV & NBA-style odds band on card.',
      });
    });
  }

  if (srcPo && srcPo.getLastRow() >= 4) {
    const last = srcPo.getLastRow();
    srcPo.getRange(4, 1, last, MLB_PITCHER_SEC_CARD_COLS)
      .getValues()
      .forEach(function (r) {
        pushPitcherMirror_(r, 'Pitcher outs', 'Outs', 6);
      });
  }
  if (srcPbb && srcPbb.getLastRow() >= 4) {
    const last = srcPbb.getLastRow();
    srcPbb.getRange(4, 1, last, MLB_PITCHER_SEC_CARD_COLS)
      .getValues()
      .forEach(function (r) {
        pushPitcherMirror_(r, 'Pitcher walks', 'BB', 6);
      });
  }
  if (srcPha && srcPha.getLastRow() >= 4) {
    const last = srcPha.getLastRow();
    srcPha.getRange(4, 1, last, MLB_PITCHER_SEC_CARD_COLS)
      .getValues()
      .forEach(function (r) {
        pushPitcherMirror_(r, 'Pitcher hits allowed', 'HA', 6);
      });
  }

  function pushBatterMirror_(r, marketLabel, mid) {
    const flags = String(r[16] || '');
    const batterId = r[17];
    const hpUmp = String(r[18] || '').trim();
    const gamePk = r[0];
    const matchup = r[1];
    const batter = String(r[2] || '').trim();
    if (flags.indexOf('injury') !== -1) {
      logReject_({ stage: 'input-filter', reason: 'injury_flag', market: marketLabel, gamePk: gamePk, matchup: matchup, player: batter, flags: flags });
      return;
    }
    const bestSide = String(r[14] || '').trim();
    if (bestSide !== 'Over' && bestSide !== 'Under') {
      logReject_({ stage: 'input-filter', reason: 'no_best_side', market: marketLabel, gamePk: gamePk, matchup: matchup, player: batter, flags: flags });
      return;
    }
    const line = r[3];
    if (line === '' || line == null) {
      logReject_({ stage: 'input-filter', reason: 'missing_line', market: marketLabel, gamePk: gamePk, matchup: matchup, player: batter, side: bestSide, flags: flags });
      return;
    }
    const fdOver = r[4];
    const fdUnder = r[5];
    const american = bestSide === 'Over' ? fdOver : fdUnder;
    if (american === '' || american == null || isNaN(parseFloat(String(american)))) {
      logReject_({ stage: 'input-filter', reason: 'invalid_american', market: marketLabel, gamePk: gamePk, matchup: matchup, player: batter, side: bestSide, line: line, american: american, flags: flags });
      return;
    }
    if (!batter) {
      logReject_({ stage: 'input-filter', reason: 'missing_player', market: marketLabel, gamePk: gamePk, matchup: matchup, side: bestSide, line: line, american: american, flags: flags });
      return;
    }
    const ev = parseFloat(String(r[15]));
    if (isNaN(ev) || ev <= 0) {
      logReject_({ stage: 'edge-filter', reason: 'non_positive_ev', market: marketLabel, gamePk: gamePk, matchup: matchup, player: batter, side: bestSide, line: line, american: american, ev: r[15], flags: flags });
      return;
    }
    if (minEvFloor > 0 && ev < minEvFloor) {
      logReject_({ stage: 'edge-filter', reason: 'below_min_ev_floor', market: marketLabel, gamePk: gamePk, matchup: matchup, player: batter, side: bestSide, line: line, american: american, ev: ev, flags: flags });
      return;
    }
    if (!mlbCardSinglesOddsBandOk_(american, cfg)) {
      logReject_({ stage: 'odds-filter', reason: 'outside_odds_band', market: marketLabel, gamePk: gamePk, matchup: matchup, player: batter, side: bestSide, line: line, american: american, ev: ev, flags: flags });
      return;
    }
    const pWin = bestSide === 'Over' ? r[8] : r[9];
    const pickLabel =
      batter + ' — ' + mid + ' ' + bestSide + ' ' + String(line) + (hpUmp ? ' · HP ' + hpUmp : '');
    plays.push({
      gamePk: r[0],
      matchup: r[1],
      pickLabel: pickLabel,
      player: batter,
      playerId: batterId,
      side: bestSide,
      line: line,
      american: american,
      book: 'fanduel',
      pWin: pWin,
      ev: ev,
      lambda: r[6],
      edge: r[7],
      flags: flags,
      market: marketLabel,
      disclaimer: 'Batter Poisson λ; ⚙️ TB_BLEND & odds band.',
    });
  }

  if (srcTb && srcTb.getLastRow() >= 4) {
    srcTb.getRange(4, 1, srcTb.getLastRow(), MLB_BATTER_PROP_CARD_COLS)
      .getValues()
      .forEach(function (r) {
        pushBatterMirror_(r, 'Batter total bases', 'TB');
      });
  }
  if (srcHits && srcHits.getLastRow() >= 4) {
    srcHits.getRange(4, 1, srcHits.getLastRow(), MLB_BATTER_PROP_CARD_COLS)
      .getValues()
      .forEach(function (r) {
        pushBatterMirror_(r, 'Batter hits', 'H');
      });
  }
  if (srcHr && srcHr.getLastRow() >= 4) {
    srcHr.getRange(4, 1, srcHr.getLastRow(), MLB_BATTER_PROP_CARD_COLS)
      .getValues()
      .forEach(function (r) {
        pushBatterMirror_(r, 'Batter home runs', 'HR');
      });
  }

  plays.sort(function (a, b) {
    const be = parseFloat(String(b.ev));
    const ae = parseFloat(String(a.ev));
    if (isNaN(be) && isNaN(ae)) return 0;
    if (isNaN(be)) return 1;
    if (isNaN(ae)) return -1;
    return be - ae;
  });

  const top = [];
  const perGame = {};
  /** Count of non–Pitcher-walks plays already on the card for this game (for bonus BB slot). */
  const nonWalksInGame = {};
  const forceBb = mlbBetCardForcePitcherBb_(cfg);
  for (let i = 0; i < plays.length && top.length < MLB_BET_CARD_MAX_PLAYS; i++) {
    const p = plays[i];
    const gKey = String(p.gamePk != null ? p.gamePk : p.matchup || '').trim() || 'unknown';
    const n = perGame[gKey] || 0;
    const nw = nonWalksInGame[gKey] || 0;
    const atCap = n >= MLB_BET_CARD_MAX_PER_GAME;
    const bbExtra =
      forceBb &&
      p.market === 'Pitcher walks' &&
      n === MLB_BET_CARD_MAX_PER_GAME &&
      nw > 0;
    if (atCap && !bbExtra) {
      logReject_({
        stage: 'portfolio-cap',
        reason: 'per_game_cap_reached',
        market: p.market,
        gamePk: p.gamePk,
        matchup: p.matchup,
        player: p.player,
        side: p.side,
        line: p.line,
        american: p.american,
        ev: p.ev,
        flags: p.flags,
      });
      continue;
    }
    if (p.market !== 'Pitcher walks') nonWalksInGame[gKey] = nw + 1;
    perGame[gKey] = n + 1;
    top.push(p);
  }

  // Honorable mentions: next-best plays cut by per-game cap or total cap (up to 5).
  const honorable = [];
  const topSet = new Set(top);
  for (let i = 0; i < plays.length && honorable.length < 5; i++) {
    if (!topSet.has(plays[i])) honorable.push(plays[i]);
  }

  // ── Debug rejects tab ──────────────────────────────────────────

  let dbg = ss.getSheetByName(MLB_BET_CARD_REJECTS_TAB);
  if (dbg) {
    dbg.clearContents();
    dbg.clearFormats();
  } else {
    dbg = ss.insertSheet(MLB_BET_CARD_REJECTS_TAB);
  }
  dbg.setTabColor('#8e24aa');
  const rejectHeaders = [
    'slate_date',
    'stage',
    'reason',
    'market',
    'gamePk',
    'matchup',
    'player',
    'side',
    'line',
    'american_odds',
    'ev_per_$1',
    'flags',
  ];
  dbg.getRange(1, 1, 1, rejectHeaders.length)
    .merge()
    .setValue('🧪 MLB BET CARD DEBUG — rejected plays with reason')
    .setFontWeight('bold')
    .setBackground('#6a1b9a')
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center');
  dbg.getRange(3, 1, 1, rejectHeaders.length)
    .setValues([rejectHeaders])
    .setFontWeight('bold')
    .setBackground('#8e24aa')
    .setFontColor('#ffffff');
  dbg.setFrozenRows(3);
  if (rejects.length > 0) {
    dbg.getRange(4, 1, rejects.length, rejectHeaders.length).setValues(rejects);
  } else {
    dbg.getRange(4, 1, 1, rejectHeaders.length).setValues([[
      slateDate, '', 'No rejected rows in this run', '', '', '', '', '', '', '', '', '',
    ]]);
  }

  // ── Main bet card tab ──────────────────────────────────────────

  const BC_COL = 21;
  const headers = [
    'slate_date', 'rank', 'gamePk', 'matchup', 'play', 'player',
    'market', 'side', 'line', 'american_odds', 'book', 'model_prob',
    'ev_per_$1', 'model_lambda', 'edge_vs_line', 'flags', 'player_id', 'disclaimer',
    'confidence', 'kelly_pct', 'kelly_$',
  ];

  let sh = ss.getSheetByName(MLB_BET_CARD_TAB);
  if (sh) {
    sh.clearContents();
    sh.clearFormats();
  } else {
    sh = ss.insertSheet(MLB_BET_CARD_TAB);
  }
  sh.setTabColor('#00695c');

  [88, 40, 72, 200, 280, 160, 56, 56, 72, 72, 72, 56, 56, 56, 140, 72, 100, 340, 52, 64, 64].forEach(function (w, i) {
    sh.setColumnWidth(i + 1, w);
  });

  // Kelly fraction — hoisted; same for every play in this run.
  const kellyFracRaw = parseFloat(String(cfg && cfg['KELLY_FRACTION'] != null ? cfg['KELLY_FRACTION'] : '0.25').trim());
  const kellyFrac    = !isNaN(kellyFracRaw) && kellyFracRaw > 0 ? Math.min(kellyFracRaw, 1) : 0.25;

  // Group plays by matchup (preserving EV-rank order across games).
  const gameOrder = [];
  const gameMap = {};
  top.forEach(function (p) {
    const gKey = p.matchup || String(p.gamePk || '') || 'unknown';
    if (!gameMap[gKey]) { gameMap[gKey] = []; gameOrder.push(gKey); }
    gameMap[gKey].push(p);
  });

  const totalGames = gameOrder.length;
  const totalPlays = top.length;

  // Row 1: title
  sh.getRange(1, 1, 1, BC_COL).merge()
    .setValue(
      '🃏 MLB BET CARD — ' + slateDate +
      '  ·  ' + totalPlays + ' plays · ' + totalGames + ' games' +
      '  ·  NBA-style odds band (⚙️)  ·  max ' + MLB_BET_CARD_MAX_PER_GAME + '/game' +
      '  ·  build ' + MLB_BET_CARD_BUILD_STAMP
    )
    .setFontWeight('bold')
    .setBackground('#004d40')
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center')
    .setWrap(true);
  sh.setRowHeight(1, 44);
  sh.setRowHeight(2, 4);

  // Row 3: column headers
  sh.getRange(3, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight('bold')
    .setBackground('#00897b')
    .setFontColor('#ffffff');
  sh.setFrozenRows(3);

  var sheetRow = 4;

  if (totalPlays === 0) {
    const band =
      String(cfg['CARD_USE_NBA_ODDS_BAND'] || 'true').toLowerCase() === 'false'
        ? ''
        : 'American in ⚙️ CARD_SINGLES_* band, ';
    sh.getRange(sheetRow, 1, 1, BC_COL).merge()
      .setValue(
        'No qualifying plays — positive EV, ' + band +
        'MIN_EV optional, injury-clean, max ' + MLB_BET_CARD_MAX_PER_GAME + ' straights/game.'
      )
      .setBackground('#FFF9C4')
      .setFontSize(9)
      .setWrap(true);
    sh.setRowHeight(sheetRow, 36);
    sheetRow++;
  } else {
    // ── Game-grouped play rows ──
    gameOrder.forEach(function (gKey) {
      const gamePlays = gameMap[gKey];
      const gamePkDisplay = gamePlays[0].gamePk || '';

      // Game header row (merged, dark) — col 5 empty so snapshot skips it
      sh.getRange(sheetRow, 1, 1, BC_COL).merge()
        .setValue(
          '⚾  ' + gKey +
          (gamePkDisplay ? '  ·  pk ' + gamePkDisplay : '') +
          '  (' + gamePlays.length + (gamePlays.length === 1 ? ' play' : ' plays') + ')'
        )
        .setBackground('#37474F')
        .setFontColor('#ffffff')
        .setFontWeight('bold')
        .setFontSize(9);
      sh.setRowHeight(sheetRow, 24);
      sheetRow++;

      gamePlays.forEach(function (p) {
        const rank = top.indexOf(p) + 1;
        const ev = parseFloat(String(p.ev)) || 0;
        // EV tier color bands (mirroring NBA MAX / SHARP / CONTEXT / LEAN)
        const bg = ev >= 0.05 ? '#A5D6A7' :
                   ev >= 0.03 ? '#C8E6C9' :
                   ev >= 0.01 ? '#E8F5E9' : '#FFF9C4';
        const conf      = mlbConfidenceTier_(p.ev);
        const kellyFull = mlbKellyFull_(p.pWin, p.american);
        const kellyPct  = kellyFull !== '' && kellyFull > 0
          ? Math.round(kellyFull * kellyFrac * 10000) / 10000
          : (kellyFull === 0 ? 0 : '');
        const kellyAmt  = mlbKellyDollars_(p.pWin, p.american, cfg);
        const playFull = String(p.pickLabel || '');
        const playDisplay = playFull.length > 60 ? playFull.substring(0, 57) + '…' : playFull;
        sh.getRange(sheetRow, 1, 1, BC_COL).setValues([[
          slateDate, rank, p.gamePk, p.matchup,
          playDisplay, p.player, p.market, p.side,
          p.line, p.american, p.book, p.pWin, p.ev,
          p.lambda, p.edge, p.flags,
          p.playerId != null && p.playerId !== '' ? p.playerId : '',
          p.disclaimer,
          conf, kellyPct, kellyAmt,
        ]]).setBackground(bg).setFontSize(9).setWrap(false);
        if (playFull.length > 60) sh.getRange(sheetRow, 5).setNote(playFull);
        sh.setRowHeight(sheetRow, 22);
        sheetRow++;
      });

      // Spacer between games
      sh.setRowHeight(sheetRow, 6);
      sheetRow++;
    });

    // ── Honorable mentions ──
    if (honorable.length > 0) {
      sh.getRange(sheetRow, 1, 1, BC_COL).merge()
        .setValue(
          '⭐ HONORABLE MENTIONS — next-best plays cut by per-game cap or total cap (' +
          honorable.length + ')'
        )
        .setBackground('#E65100')
        .setFontColor('#ffffff')
        .setFontWeight('bold')
        .setFontSize(9);
      sh.setRowHeight(sheetRow, 24);
      sheetRow++;

      honorable.forEach(function (p) {
        const hConf    = mlbConfidenceTier_(p.ev);
        const hKellyAmt = mlbKellyDollars_(p.pWin, p.american, cfg);
        const playFull = String(p.pickLabel || '');
        const playDisplay = playFull.length > 60 ? playFull.substring(0, 57) + '…' : playFull;
        // rank is '' — snapshot skips these rows (no rank = not a card play)
        sh.getRange(sheetRow, 1, 1, BC_COL).setValues([[
          slateDate, '', p.gamePk, p.matchup,
          playDisplay, p.player, p.market, p.side,
          p.line, p.american, p.book, p.pWin, p.ev,
          p.lambda, p.edge, p.flags,
          p.playerId != null && p.playerId !== '' ? p.playerId : '',
          p.disclaimer,
          hConf, '', hKellyAmt,
        ]]).setBackground('#FFF3E0').setFontSize(9).setWrap(false);
        if (playFull.length > 60) sh.getRange(sheetRow, 5).setNote(playFull);
        sh.setRowHeight(sheetRow, 22);
        sheetRow++;
      });
    }
  }

  ss.toast(totalPlays + ' plays · ' + totalGames + ' games · ' + slateDate, 'MLB Bet Card', 6);
}
