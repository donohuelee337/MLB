// ============================================================
// 🃏 MLB Bet Card — actionable plays (from Pitcher K card)
// ============================================================
// Pulls ranked pitcher-K props: FanDuel line, chosen side, price, naive EV.
// Drops rows flagged injury (Out/Doubtful path in queue → card flags).
// Cap: MLB_BET_CARD_MAX_PLAYS. Extend later with more markets via source col.
// ============================================================

const MLB_BET_CARD_TAB = '🃏 MLB_Bet_Card';
const MLB_BET_CARD_MAX_PLAYS = 24;
/** Same spirit as AI-BOIZ: cap how many straights surface per game on the card. */
const MLB_BET_CARD_MAX_PER_GAME = 2;

function refreshMLBBetCard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig();
  const minEvCfg = parseFloat(String(cfg['MIN_EV_BET_CARD'] != null ? cfg['MIN_EV_BET_CARD'] : '0').trim(), 10);
  const minEvFloor = !isNaN(minEvCfg) && minEvCfg > 0 ? minEvCfg : 0;
  const slateDate = getSlateDateString_(cfg);
  const src = ss.getSheetByName(MLB_PITCHER_K_CARD_TAB);
  if (!src || src.getLastRow() < 4) {
    safeAlert_('MLB Bet Card', 'Run Pitcher K card first (Morning includes it).');
    return;
  }

  const last = src.getLastRow();
  const vals = src.getRange(4, 1, last, 24).getValues();
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

    const pWin = bestSide === 'Over' ? r[10] : r[11];
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
    });
  });

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
      p.pitcher,
      'Pitcher strikeouts',
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
      'Model: Poisson on λ=blended K/9×proj_IP; EV vs list; MIN_EV_BET_CARD from ⚙️ Config; not devigged.',
    ];
  });

  if (rows.length === 0) {
    const evHint =
      minEvFloor > 0
        ? 'EV≥' + minEvFloor + ' per $1 (⚙️ MIN_EV_BET_CARD), '
        : 'positive EV, ';
    rows.push([
      slateDate,
      '',
      '',
      '',
      'No qualifying plays — need 🎰 Pitcher_K_Card with ' +
        evHint +
        'both FD prices, no injury flag (max ' +
        MLB_BET_CARD_MAX_PER_GAME +
        ' per game).',
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

  [88, 40, 72, 200, 280, 140, 130, 56, 56, 72, 72, 72, 56, 56, 56, 140, 72, 340].forEach(function (w, i) {
    sh.setColumnWidth(i + 1, w);
  });

  sh.getRange(1, 1, 1, 18)
    .merge()
    .setValue(
      '🃏 MLB BET CARD — FanDuel pitcher K — ranked by EV ($1 risk). Injury-flagged plays omitted. Not betting advice.'
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
    'lambda_K',
    'edge_vs_line',
    'flags',
    'pitcher_id',
    'disclaimer',
  ];
  sh.getRange(3, 1, 1, headers.length)
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
