// ============================================================
// 🃏 MLB Bet Card — pitcher K + batter TB + batter hits (ranked by EV)
// ============================================================
// Pulls 🎰 Pitcher_K_Card + 🎲 Batter_TB_Card + 🎯 Batter_Hits_Card;
// merges, sorts by EV, caps per game + total plays.
// ============================================================

const MLB_BET_CARD_TAB = '🃏 MLB_Bet_Card';
const MLB_BET_CARD_MAX_PLAYS = 30;
/** Same spirit as AI-BOIZ: cap how many straights surface per game on the card. */
const MLB_BET_CARD_MAX_PER_GAME = 2;

function refreshMLBBetCard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig();
  const minEvCfg = parseFloat(String(cfg['MIN_EV_BET_CARD'] != null ? cfg['MIN_EV_BET_CARD'] : '0').trim(), 10);
  const minEvFloor = !isNaN(minEvCfg) && minEvCfg > 0 ? minEvCfg : 0;
  const slateDate = getSlateDateString_(cfg);

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
        kind: 'K',
        gamePk: gamePk,
        matchup: matchup,
        pickLabel: pickLabel,
        player: pitcher,
        playerId: pitcherId,
        side: bestSide,
        line: line,
        american: american,
        book: 'fanduel',
        pWin: pWin,
        ev: isNaN(ev) ? '' : ev,
        lambda: r[8],
        edge: r[9],
        flags: flags,
        market: 'Pitcher strikeouts',
        disclaimer:
          'Model: Poisson λ K/9×IP; EV vs list; MIN_EV from ⚙️; merged with 🎲 TB / 🎯 Hits when built.',
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
      const matchup = r[1];
      const gamePk = r[0];
      const pickLabel =
        batter + ' — TB ' + bestSide + ' ' + String(line) + (hpUmp ? ' · HP ' + hpUmp : '');

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
        book: 'fanduel',
        pWin: pWin,
        ev: isNaN(ev) ? '' : ev,
        lambda: r[6],
        edge: r[7],
        flags: flags,
        market: 'Batter total bases',
        disclaimer:
          'Model: Poisson λ TB/game blend × park; EV vs list; ⚙️ TB_BLEND_RECENT_WEIGHT · MIN_EV_BET_CARD.',
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
      const matchup = r[1];
      const gamePk = r[0];
      const pickLabel =
        batter + ' — H ' + bestSide + ' ' + String(line) + (hpUmp ? ' · HP ' + hpUmp : '');

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
        book: 'fanduel',
        pWin: pWin,
        ev: isNaN(ev) ? '' : ev,
        lambda: r[6],
        edge: r[7],
        flags: flags,
        market: 'Batter hits',
        disclaimer:
          'Model: Poisson λ H/game blend × park (⚙️ TB_BLEND_RECENT_WEIGHT); EV vs list; MIN_EV_BET_CARD.',
      });
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
    const evHint =
      minEvFloor > 0
        ? 'EV≥' + minEvFloor + ' per $1 (⚙️ MIN_EV_BET_CARD), '
        : 'positive EV, ';
    rows.push([
      slateDate,
      '',
      '',
      '',
      'No qualifying plays — build 🎰 Pitcher_K_Card / 🎲 Batter_TB_Card / 🎯 Batter_Hits_Card with ' +
        evHint +
        'both FD prices where needed, no injury flag (max ' +
        MLB_BET_CARD_MAX_PER_GAME +
        ' plays per game).',
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

  [88, 40, 72, 200, 280, 140, 140, 56, 56, 72, 72, 72, 56, 56, 56, 140, 72, 340].forEach(function (w, i) {
    sh.setColumnWidth(i + 1, w);
  });

  sh.getRange(1, 1, 1, 18)
    .merge()
    .setValue(
      '🃏 MLB BET CARD — FanDuel pitcher K + batter TB + batter H — ranked by EV ($1 risk). Injury-flagged omitted. Not betting advice.'
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
    'model_lambda',
    'edge_vs_line',
    'flags',
    'player_id',
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
