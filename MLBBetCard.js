// ============================================================
// 🃏 MLB Bet Card — multi-market straights (AI-BOIZ / NBA rules)
// ============================================================
// Merges all model cards, sorts by EV, per-game + total caps.
// Singles filter (NBA-style): main lines only in queue builders; optional
// American band CARD_SINGLES_MIN_AMERICAN..MAX (default -150..+150).
// ============================================================

const MLB_BET_CARD_TAB = '🃏 MLB_Bet_Card';
const MLB_BET_CARD_MAX_PLAYS = 48;
const MLB_BET_CARD_MAX_PER_GAME = 2;

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

  function pushPitcherMirror_(r, marketLabel, pickMid, lambdaIx) {
    const flags = String(r[16] || '');
    const pid = r[17];
    const hpUmp = String(r[18] || '').trim();
    const throws = String(r[19] || '').trim();
    if (flags.indexOf('injury') !== -1) return;
    const bestSide = String(r[14] || '').trim();
    if (bestSide !== 'Over' && bestSide !== 'Under') return;
    const line = r[3];
    if (line === '' || line == null) return;
    const fdOver = r[4];
    const fdUnder = r[5];
    const american = bestSide === 'Over' ? fdOver : fdUnder;
    if (american === '' || american == null || isNaN(parseFloat(String(american)))) return;
    const pitcher = String(r[2] || '').trim();
    if (!pitcher) return;
    const evRaw = r[15];
    const ev = parseFloat(String(evRaw));
    if (isNaN(ev) || ev <= 0) return;
    if (minEvFloor > 0 && ev < minEvFloor) return;
    if (!mlbCardSinglesOddsBandOk_(american, cfg)) return;
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
        'Poisson λ vs FD main line; ⚙️ MIN_EV_BET_CARD & CARD_USE_NBA_ODDS_BAND; not alt markets in builders.',
    });
  }

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
      const ev = parseFloat(String(r[17]));
      if (isNaN(ev) || ev <= 0) return;
      if (minEvFloor > 0 && ev < minEvFloor) return;
      if (!mlbCardSinglesOddsBandOk_(american, cfg)) return;
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
    srcPo.getRange(4, 1, last, 21)
      .getValues()
      .forEach(function (r) {
        pushPitcherMirror_(r, 'Pitcher outs', 'Outs', 6);
      });
  }
  if (srcPbb && srcPbb.getLastRow() >= 4) {
    const last = srcPbb.getLastRow();
    srcPbb.getRange(4, 1, last, 21)
      .getValues()
      .forEach(function (r) {
        pushPitcherMirror_(r, 'Pitcher walks', 'BB', 6);
      });
  }
  if (srcPha && srcPha.getLastRow() >= 4) {
    const last = srcPha.getLastRow();
    srcPha.getRange(4, 1, last, 21)
      .getValues()
      .forEach(function (r) {
        pushPitcherMirror_(r, 'Pitcher hits allowed', 'HA', 6);
      });
  }

  function pushBatterMirror_(r, marketLabel, mid) {
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
    const ev = parseFloat(String(r[15]));
    if (isNaN(ev) || ev <= 0) return;
    if (minEvFloor > 0 && ev < minEvFloor) return;
    if (!mlbCardSinglesOddsBandOk_(american, cfg)) return;
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
    srcTb.getRange(4, 1, srcTb.getLastRow(), 19)
      .getValues()
      .forEach(function (r) {
        pushBatterMirror_(r, 'Batter total bases', 'TB');
      });
  }
  if (srcHits && srcHits.getLastRow() >= 4) {
    srcHits.getRange(4, 1, srcHits.getLastRow(), 19)
      .getValues()
      .forEach(function (r) {
        pushBatterMirror_(r, 'Batter hits', 'H');
      });
  }
  if (srcHr && srcHr.getLastRow() >= 4) {
    srcHr.getRange(4, 1, srcHr.getLastRow(), 19)
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
  for (let i = 0; i < plays.length && top.length < MLB_BET_CARD_MAX_PLAYS; i++) {
    const p = plays[i];
    const gKey = String(p.gamePk != null ? p.gamePk : p.matchup || '').trim() || 'unknown';
    const n = perGame[gKey] || 0;
    if (n >= MLB_BET_CARD_MAX_PER_GAME) continue;
    perGame[gKey] = n + 1;
    top.push(p);
  }

  const rows = top.map(function (p, idx) {
    return [
      slateDate,
      idx + 1,
      p.gamePk,
      p.matchup,
      p.pickLabel,
      p.player,
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
      p.playerId != null && p.playerId !== '' ? p.playerId : '',
      p.disclaimer,
    ];
  });

  if (rows.length === 0) {
    const band =
      String(cfg['CARD_USE_NBA_ODDS_BAND'] || 'true').toLowerCase() === 'false'
        ? ''
        : 'American in ⚙️ CARD_SINGLES_* band, ';
    rows.push([
      slateDate,
      '',
      '',
      '',
      'No qualifying plays — positive EV, ' +
        band +
        'MIN_EV optional, injury-clean, max ' +
        MLB_BET_CARD_MAX_PER_GAME +
        ' straights/game.',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
    ]);
  }

  let sh = ss.getSheetByName(MLB_BET_CARD_TAB);
  if (sh) {
    sh.clearContents();
    sh.clearFormats();
  } else {
    sh = ss.insertSheet(MLB_BET_CARD_TAB);
  }
  sh.setTabColor('#00695c');

  [88, 40, 72, 200, 280, 160, 56, 56, 72, 72, 72, 56, 56, 56, 140, 72, 340].forEach(function (w, i) {
    sh.setColumnWidth(i + 1, w);
  });

  sh.getRange(1, 1, 1, 18)
    .merge()
    .setValue(
      '🃏 MLB BET CARD — multi-market straights · EV rank · NBA-style odds band (⚙️) · max ' +
        MLB_BET_CARD_MAX_PER_GAME +
        '/game · not betting advice.'
    )
    .setFontWeight('bold')
    .setBackground('#004d40')
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center')
    .setWrap(true);
  sh.setRowHeight(1, 44);

  const headers = [
    'slate_date',
    'rank',
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
    'model_lambda',
    'edge_vs_line',
    'flags',
    'player_id',
    'disclaimer',
  ];
  sh.getRange(3, 1, 3, headers.length)
    .setValues([headers])
    .setFontWeight('bold')
    .setBackground('#00897b')
    .setFontColor('#ffffff');
  sh.setFrozenRows(3);

  sh.getRange(4, 1, rows.length, headers.length).setValues(rows);
  if (rows.length > 0 && rows[0][4] && String(rows[0][4]).indexOf('No qualifying') === -1) {
    try {
      ss.setNamedRange('MLB_BET_CARD', sh.getRange(4, 1, rows.length, headers.length));
    } catch (e) {}
  }

  ss.toast(rows.length + ' bet rows · ' + slateDate, 'MLB Bet Card', 6);
}
