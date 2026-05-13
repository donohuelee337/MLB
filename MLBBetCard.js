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
  const includeHr = String(cfg['MLB_INCLUDE_HR_BET_CARD'] != null ? cfg['MLB_INCLUDE_HR_BET_CARD'] : 'false').trim().toLowerCase();
  const srcHr = includeHr === 'true' || includeHr === '1' || includeHr === 'yes'
    ? ss.getSheetByName(MLB_BATTER_HR_CARD_TAB) : null;

  const anyCard =
    (srcK && srcK.getLastRow() >= 4) ||
    (srcPo && srcPo.getLastRow() >= 4) ||
    (srcPbb && srcPbb.getLastRow() >= 4) ||
    (srcPha && srcPha.getLastRow() >= 4) ||
    (srcTb && srcTb.getLastRow() >= 4) ||
    (srcHits && srcHits.getLastRow() >= 4);

  if (!anyCard) {
    safeAlert_(
      'MLB Bet Card',
      'Run the pipeline or individual model cards first (pitcher props + batter cards).'
    );
    return;
  }

  // CARD_ALLOWED_MARKETS: comma-separated market labels for main card (default: K + Hits).
  const allowedMarketsRaw = String(cfg['CARD_ALLOWED_MARKETS'] != null
    ? cfg['CARD_ALLOWED_MARKETS'] : 'Pitcher strikeouts,Batter hits').trim();
  const allowedMarkets = allowedMarketsRaw.split(',').reduce(function (m, s) {
    m[s.trim().toLowerCase()] = true; return m;
  }, {});

  const sgpMinEvCfg = parseFloat(String(cfg['SGP_MIN_EV'] != null ? cfg['SGP_MIN_EV'] : '0.01').trim());
  const sgpMinEv = !isNaN(sgpMinEvCfg) && sgpMinEvCfg >= 0 ? sgpMinEvCfg : 0.01;

  // plays[]    — passed all filters + allowed market → main card candidates
  // sgpPool[]  — passed hard filters (positive EV, valid data, no injury) → SGP 3rd-leg candidates
  const plays = [];
  const sgpPool = [];
  const rejects = [];

  // softPlays retained for TB-over cap routing (logged to debug, not used elsewhere).
  const softPlays = [];

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
    var pmPlayObj = {
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
      disclaimer: 'Poisson λ vs FD main line; ⚙️ CARD_ALLOWED_MARKETS, MIN_EV_BET_CARD, CARD_USE_NBA_ODDS_BAND.',
    };
    // Always add to SGP pool if positive EV.
    sgpPool.push(pmPlayObj);
    // Only add to main card if market is allowed and passes band + EV floor.
    const inAllowed = allowedMarkets[marketLabel.toLowerCase()];
    var pmSoftReason = '';
    if (!inAllowed) pmSoftReason = 'market_not_in_card_allowed';
    if (inAllowed && !relaxWalks && minEvFloor > 0 && ev < minEvFloor) pmSoftReason = 'below_min_ev_floor';
    if (inAllowed && !relaxWalks && !mlbCardSinglesOddsBandOk_(american, cfg)) {
      pmSoftReason = pmSoftReason ? pmSoftReason + '+outside_odds_band' : 'outside_odds_band';
    }
    if (pmSoftReason) {
      pmPlayObj.softReason = pmSoftReason;
      softPlays.push(pmPlayObj);
      logReject_({ stage: 'soft-reject', reason: pmSoftReason, market: marketLabel, gamePk: gamePk, matchup: matchup, player: pitcher, side: bestSide, line: line, american: american, ev: ev, flags: flags });
    } else {
      plays.push(pmPlayObj);
    }
  }

  if (srcK && srcK.getLastRow() >= 4) {
    const lastK = srcK.getLastRow();
    const vals = srcK.getRange(4, 1, lastK - 3, MLB_PITCHER_K_CARD_COLS).getValues();
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
      var kPlayObj = {
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
        disclaimer: 'Poisson λ K/9×IP; ⚙️ CARD_ALLOWED_MARKETS, MIN_EV, odds band.',
      };
      sgpPool.push(kPlayObj);
      var kSoftReason = '';
      const kAllowed = allowedMarkets['pitcher strikeouts'];
      if (!kAllowed) kSoftReason = 'market_not_in_card_allowed';
      if (kAllowed && minEvFloor > 0 && ev < minEvFloor) kSoftReason = 'below_min_ev_floor';
      if (kAllowed && !mlbCardSinglesOddsBandOk_(american, cfg)) {
        kSoftReason = kSoftReason ? kSoftReason + '+outside_odds_band' : 'outside_odds_band';
      }
      if (kSoftReason) {
        kPlayObj.softReason = kSoftReason;
        softPlays.push(kPlayObj);
        logReject_({ stage: 'soft-reject', reason: kSoftReason, market: 'Pitcher strikeouts', gamePk: gamePk, matchup: matchup, player: pitcher, side: bestSide, line: line, american: american, ev: ev, flags: flags });
      } else {
        plays.push(kPlayObj);
      }
    });
  }

  if (srcPo && srcPo.getLastRow() >= 4) {
    const last = srcPo.getLastRow();
    srcPo.getRange(4, 1, last - 3, MLB_PITCHER_SEC_CARD_COLS)
      .getValues()
      .forEach(function (r) {
        pushPitcherMirror_(r, 'Pitcher outs', 'Outs', 6);
      });
  }
  if (srcPbb && srcPbb.getLastRow() >= 4) {
    const last = srcPbb.getLastRow();
    srcPbb.getRange(4, 1, last - 3, MLB_PITCHER_SEC_CARD_COLS)
      .getValues()
      .forEach(function (r) {
        pushPitcherMirror_(r, 'Pitcher walks', 'BB', 6);
      });
  }
  if (srcPha && srcPha.getLastRow() >= 4) {
    const last = srcPha.getLastRow();
    srcPha.getRange(4, 1, last - 3, MLB_PITCHER_SEC_CARD_COLS)
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
    const pWin = bestSide === 'Over' ? r[8] : r[9];
    const pickLabel =
      batter + ' — ' + mid + ' ' + bestSide + ' ' + String(line) + (hpUmp ? ' · HP ' + hpUmp : '');
    var bmPlayObj = {
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
      disclaimer: 'Batter Poisson λ; ⚙️ CARD_ALLOWED_MARKETS, TB_BLEND, odds band.',
    };
    // Always add to SGP pool if positive EV.
    sgpPool.push(bmPlayObj);
    // Route to main card only if market is allowed and passes band + EV floor.
    const bmAllowed = allowedMarkets[marketLabel.toLowerCase()];
    var bmSoftReason = '';
    if (!bmAllowed) bmSoftReason = 'market_not_in_card_allowed';
    if (bmAllowed && minEvFloor > 0 && ev < minEvFloor) bmSoftReason = 'below_min_ev_floor';
    if (bmAllowed && !mlbCardSinglesOddsBandOk_(american, cfg)) {
      bmSoftReason = bmSoftReason ? bmSoftReason + '+outside_odds_band' : 'outside_odds_band';
    }
    if (bmAllowed && marketLabel === 'Batter total bases' && bestSide === 'Over') {
      const tbOverMax = parseFloat(String(cfg['BATTER_TB_OVER_MAX_AMERICAN'] != null ? cfg['BATTER_TB_OVER_MAX_AMERICAN'] : '0').trim());
      const amer = parseFloat(String(american));
      if (!isNaN(amer) && !isNaN(tbOverMax) && amer > tbOverMax) {
        bmSoftReason = bmSoftReason ? bmSoftReason + '+tb_over_plus_odds' : 'tb_over_plus_odds';
      }
    }
    if (bmSoftReason) {
      bmPlayObj.softReason = bmSoftReason;
      softPlays.push(bmPlayObj);
      logReject_({ stage: 'soft-reject', reason: bmSoftReason, market: marketLabel, gamePk: gamePk, matchup: matchup, player: batter, side: bestSide, line: line, american: american, ev: ev, flags: flags });
    } else {
      plays.push(bmPlayObj);
    }
  }

  if (srcTb && srcTb.getLastRow() >= 4) {
    srcTb.getRange(4, 1, srcTb.getLastRow() - 3, MLB_BATTER_PROP_CARD_COLS)
      .getValues()
      .forEach(function (r) {
        pushBatterMirror_(r, 'Batter total bases', 'TB');
      });
  }
  if (srcHits && srcHits.getLastRow() >= 4) {
    srcHits.getRange(4, 1, srcHits.getLastRow() - 3, MLB_BATTER_PROP_CARD_COLS)
      .getValues()
      .forEach(function (r) {
        pushBatterMirror_(r, 'Batter hits', 'H');
      });
  }
  if (srcHr && srcHr.getLastRow() >= 4) {
    srcHr.getRange(4, 1, srcHr.getLastRow() - 3, MLB_BATTER_PROP_CARD_COLS)
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

  // No per-game cap: all A/A+ plays from allowed markets make the card.
  // Only the total card cap (MLB_BET_CARD_MAX_PLAYS=48) applies.
  const top = [];
  const perGame = {};
  for (let i = 0; i < plays.length && top.length < MLB_BET_CARD_MAX_PLAYS; i++) {
    const p = plays[i];
    const gKey = String(p.gamePk != null ? p.gamePk : p.matchup || '').trim() || 'unknown';
    perGame[gKey] = (perGame[gKey] || 0) + 1;
    top.push(p);
  }

  // ── SGP candidates: best additional play per game (any market, EV ≥ SGP_MIN_EV),
  //    only for games that have exactly 2 main card plays — gives 3rd leg for SGP/parlay.
  const topSet = new Set(top);
  const sgpByGame = {};
  sgpPool.sort(function (a, b) {
    return parseFloat(String(b.ev)) - parseFloat(String(a.ev));
  });
  sgpPool.forEach(function (p) {
    if (topSet.has(p)) return;
    if (parseFloat(String(p.ev)) < sgpMinEv) return;
    const gKey = String(p.gamePk != null ? p.gamePk : p.matchup || '').trim() || 'unknown';
    if ((perGame[gKey] || 0) < 1) return; // game must have at least 1 main card play
    if (!sgpByGame[gKey]) sgpByGame[gKey] = p; // pool is EV-sorted, first wins
  });

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

  // Build gamePk → startTime lookup. Mirror MLBSlateBoard: read schLast rows (not schLast-3)
  // and skip blank rows via guard — same pattern proven to work there.
  const gameStartTime = {};
  const schSh = ss.getSheetByName(MLB_SCHEDULE_TAB);
  if (schSh && schSh.getLastRow() >= 4) {
    const schLast = schSh.getLastRow();
    schSh.getRange(4, 1, schLast, 3).getValues().forEach(function (r) {
      const pk = r[0];
      const rawVal = r[2]; // gameDateRaw — may be Date object or ISO string
      if (!pk || !rawVal) return;
      const t = rawVal instanceof Date ? rawVal.getTime() : new Date(String(rawVal)).getTime();
      if (!isNaN(t)) gameStartTime[String(pk)] = t;
    });
  }

  // Group plays by matchup, then sort groups by game start time.
  const gameOrder = [];
  const gameMap = {};
  top.forEach(function (p) {
    const gKey = p.matchup || String(p.gamePk || '') || 'unknown';
    if (!gameMap[gKey]) { gameMap[gKey] = []; gameOrder.push(gKey); }
    gameMap[gKey].push(p);
  });
  gameOrder.sort(function (a, b) {
    const pA = gameMap[a][0] || {};
    const pB = gameMap[b][0] || {};
    const pkA = pA.gamePk != null ? String(pA.gamePk) : '';
    const pkB = pB.gamePk != null ? String(pB.gamePk) : '';
    const tA = (pkA && gameStartTime[pkA]) ? gameStartTime[pkA] : 0;
    const tB = (pkB && gameStartTime[pkB]) ? gameStartTime[pkB] : 0;
    return tA - tB;
  });

  const totalGames = gameOrder.length;
  const totalPlays = top.length;

  // Row 1: title
  sh.getRange(1, 1, 1, BC_COL).merge()
    .setValue(
      '🃏 MLB BET CARD — ' + slateDate +
      '  ·  ' + totalPlays + ' plays · ' + totalGames + ' games' +
      '  ·  markets: ' + allowedMarketsRaw +
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

    // ── SGP candidates: 3rd-leg suggestions grouped by game ──
    const sgpGames = gameOrder.filter(function (gKey) { return !!sgpByGame[gKey]; });
    if (sgpGames.length > 0) {
      sh.getRange(sheetRow, 1, 1, BC_COL).merge()
        .setValue(
          '🎯 SGP / 3-LEG CANDIDATES — best qualifying 3rd leg per game (EV ≥ ' + sgpMinEv + ', any market) · not Kelly-sized · use to build SGP'
        )
        .setBackground('#1565C0')
        .setFontColor('#ffffff')
        .setFontWeight('bold')
        .setFontSize(9);
      sh.setRowHeight(sheetRow, 24);
      sheetRow++;

      sgpGames.forEach(function (gKey) {
        const p = sgpByGame[gKey];
        const sConf = mlbConfidenceTier_(p.ev);
        const playFull = String(p.pickLabel || '');
        const playDisplay = playFull.length > 60 ? playFull.substring(0, 57) + '…' : playFull;
        sh.getRange(sheetRow, 1, 1, BC_COL).setValues([[
          slateDate, 'SGP', p.gamePk, p.matchup,
          playDisplay, p.player, p.market, p.side,
          p.line, p.american, p.book, p.pWin, p.ev,
          p.lambda, p.edge, p.flags,
          p.playerId != null && p.playerId !== '' ? p.playerId : '',
          p.disclaimer,
          sConf, '', '',
        ]]).setBackground('#E3F2FD').setFontSize(9).setWrap(false);
        if (playFull.length > 60) sh.getRange(sheetRow, 5).setNote(playFull);
        sh.setRowHeight(sheetRow, 22);
        sheetRow++;
      });
    }

    // ── FD Pick'Em Top 10 — players most likely to hit a HR today ──
    // Always reads HR card regardless of MLB_INCLUDE_HR_BET_CARD flag (free pick, not a bet).
    // Ranked by p_over (probability of going Over HR line, i.e. actually hitting a HR).
    const srcHrPickEm = ss.getSheetByName(MLB_BATTER_HR_CARD_TAB);
    const hrPickEmPool = [];
    if (srcHrPickEm && srcHrPickEm.getLastRow() >= 4) {
      srcHrPickEm.getRange(4, 1, srcHrPickEm.getLastRow() - 3, MLB_BATTER_PROP_CARD_COLS)
        .getValues()
        .forEach(function (r) {
          const batter = String(r[2] || '').trim();
          if (!batter) return;
          const flags = String(r[16] || '');
          if (flags.indexOf('injury') !== -1) return;
          const lambda = parseFloat(String(r[6]));
          if (isNaN(lambda) || lambda <= 0) return;
          // P(hits at least 1 HR) = 1 - e^(-λ), regardless of FD line
          const pHitHr = 1 - Math.exp(-lambda);
          const fdOver = r[4];
          const evOver = parseFloat(String(r[12]));
          hrPickEmPool.push({
            gamePk:   r[0],
            matchup:  r[1],
            batter:   batter,
            line:     r[3],
            american: fdOver,
            pHitHr:   Math.round(pHitHr * 10000) / 10000,
            lambda:   lambda,
            ev:       isNaN(evOver) ? 0 : evOver,
            flags:    flags,
            batterId: r[17],
          });
        });
    }
    hrPickEmPool.sort(function (a, b) { return b.pHitHr - a.pHitHr; });
    const pickEm = hrPickEmPool.slice(0, 10);

    if (pickEm.length > 0) {
      // Spacer
      sh.setRowHeight(sheetRow, 8);
      sheetRow++;

      sh.getRange(sheetRow, 1, 1, BC_COL).merge()
        .setValue(
          '🎁 FD PICK\'EM TOP 10 — most likely to hit a HR today (ranked by model p_over) · free Pick\'Em bonus · not a straight bet'
        )
        .setBackground('#E65100')
        .setFontColor('#ffffff')
        .setFontWeight('bold')
        .setFontSize(9);
      sh.setRowHeight(sheetRow, 24);
      sheetRow++;

      pickEm.forEach(function (p, idx) {
        const pHrPct = Math.round(p.pHitHr * 1000) / 10 + '%';
        const playFull = p.batter + ' — hits a HR (P≥1: ' + pHrPct + ')';
        const bg = p.pHitHr >= 0.18 ? '#A5D6A7' :
                   p.pHitHr >= 0.14 ? '#C8E6C9' :
                   p.pHitHr >= 0.10 ? '#E8F5E9' : '#FFF8E1';
        sh.getRange(sheetRow, 1, 1, BC_COL).setValues([[
          slateDate, '#' + (idx + 1), p.gamePk, p.matchup,
          playFull, p.batter, 'Batter home runs', 'Over',
          p.line, p.american, 'fanduel', pHrPct, p.ev,
          p.lambda, '', p.flags,
          p.batterId != null && p.batterId !== '' ? p.batterId : '',
          'P(≥1 HR) = 1−e^(−λ); free Pick\'Em only; HR model lacks park/hand splits',
          '', '', '',
        ]]).setBackground(bg).setFontSize(9).setWrap(false);
        sh.setRowHeight(sheetRow, 22);
        sheetRow++;
      });
    }
  }

  ss.toast(totalPlays + ' plays · ' + totalGames + ' games · ' + slateDate, 'MLB Bet Card', 6);
}
