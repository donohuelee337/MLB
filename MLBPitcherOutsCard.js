// ============================================================
// 🔩 Pitcher Outs card — Poisson λ = proj_IP × 3 + EV vs FanDuel
// ============================================================
// Reads 📋 Pitcher_Outs_Queue. Model: expected outs = proj_IP × 3
// (proj_IP from L3 depth, same clamp as 🎰 K card). P(Over/Under) vs
// half-integer FD outs line; EV from American odds.
// ============================================================

const MLB_PITCHER_OUTS_CARD_TAB = '🔩 Pitcher_Outs_Card';

function mlbFlagsOutsCard_(injuryStatus, notes, hasModel) {
  const f = [];
  const inj = String(injuryStatus || '').toLowerCase();
  if (inj.indexOf('out') !== -1 || inj.indexOf('doubtful') !== -1) f.push('injury');
  const n = String(notes || '');
  if (n.indexOf('fd_outs_miss') !== -1 || n.indexOf('no FD') !== -1) f.push('no_FD_line');
  if (!hasModel) f.push('no_model');
  return f.join('; ');
}

/** Poisson λ for outs from projected innings (3 outs per IP). */
function mlbLambdaOutsFromProjIp_(projIp) {
  const ip = parseFloat(String(projIp), 10);
  if (isNaN(ip) || ip <= 0) return NaN;
  return Math.round(ip * 3 * 100) / 100;
}

function refreshPitcherOutsBetCard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig();
  const q = ss.getSheetByName(MLB_PITCHER_OUTS_QUEUE_TAB);
  if (!q || q.getLastRow() < 4) {
    safeAlert_('Pitcher Outs card', 'Run Pitcher Outs queue first.');
    return;
  }

  const last = q.getLastRow();
  const raw = q.getRange(4, 1, last, 17).getValues();
  const rows = [];

  raw.forEach(function (r) {
    const gamePk = r[0];
    const matchup = r[1];
    const side = r[2];
    const pitcher = r[3];
    const pitcherId = r[4];
    const line = r[5];
    const fdOver = r[6];
    const fdUnder = r[7];
    const l3ip = r[9];
    const notes = r[11];
    const inj = r[12];
    const hpUmp = String(r[13] || '').trim();
    const throws = String(r[14] || '').trim();
    const hotCold = String(r[15] || '').toUpperCase();
    const gamesRaw = r[16];

    if (!String(pitcher || '').trim()) return;

    const projIp = mlbProjIpFromQueueRow_(l3ip);
    const projIpV2 =
      typeof mlbProjIpFromQueueRowV2_ === 'function'
        ? mlbProjIpFromQueueRowV2_(l3ip, gamesRaw)
        : projIp;

    let lamNum = mlbLambdaOutsFromProjIp_(projIp);
    let lamV2 = mlbLambdaOutsFromProjIp_(projIpV2);

    const lineNum = parseFloat(line, 10);
    const hasModel = !isNaN(lamNum) && lamNum > 0 && !isNaN(lineNum);
    const pu = hasModel ? mlbProbOverUnderK_(line, lamNum) : { pOver: '', pUnder: '' };
    const pOver = pu.pOver === '' ? '' : Math.round(pu.pOver * 1000) / 1000;
    const pUnder = pu.pUnder === '' ? '' : Math.round(pu.pUnder * 1000) / 1000;

    const imO = mlbAmericanImplied_(fdOver);
    const imU = mlbAmericanImplied_(fdUnder);
    const evO = pOver !== '' && fdOver !== '' ? mlbEvPerDollarRisked_(pOver, fdOver) : '';
    const evU = pUnder !== '' && fdUnder !== '' ? mlbEvPerDollarRisked_(pUnder, fdUnder) : '';

    // Outcome-first: back the more-likely side (higher win prob), not the
    // juicier price. EV stays on the card for reference.
    const sel = mlbChooseSideOutcomeFirst_('Over', pOver, evO, 'Under', pUnder, evU, cfg);
    const bestSide = sel.side;
    const bestEv = sel.side ? (isNaN(sel.ev) ? '' : sel.ev) : '';
    const bestRank = sel.rank;

    let edge = '';
    if (!isNaN(lamNum) && !isNaN(lineNum)) {
      edge = Math.round((lamNum - lineNum) * 100) / 100;
    }

    const flags = mlbFlagsOutsCard_(inj, notes, hasModel);

    rows.push({
      sortKey: bestRank,
      data: [
        gamePk,
        matchup,
        side,
        pitcher,
        line,
        fdOver,
        fdUnder,
        projIp,
        lamNum === '' || isNaN(lamNum) ? '' : lamNum,
        edge,
        pOver,
        pUnder,
        imO,
        imU,
        evO,
        evU,
        bestSide,
        bestEv,
        flags,
        pitcherId,
        hpUmp,
        throws,
        lamV2 === '' || isNaN(lamV2) ? '' : lamV2,
        projIpV2,
        gamesRaw === '' || gamesRaw == null ? '' : gamesRaw,
      ],
      hot: hotCold,
    });
  });

  // Rank by win probability (outcome mode) or EV (legacy) — most-likely
  // winners on top, not juiciest prices.
  rows.sort(function (a, b) {
    const be = typeof b.sortKey === 'number' && !isNaN(b.sortKey) ? b.sortKey : -1e9;
    const ae = typeof a.sortKey === 'number' && !isNaN(a.sortKey) ? a.sortKey : -1e9;
    if (isNaN(be) && isNaN(ae)) return 0;
    if (isNaN(be)) return -1;
    if (isNaN(ae)) return 1;
    return be - ae;
  });

  const out = rows.map(function (r) { return r.data; });
  const sortedHot = rows.map(function (r) { return r.hot; });

  let sh = ss.getSheetByName(MLB_PITCHER_OUTS_CARD_TAB);
  if (sh) {
    const cr = Math.max(sh.getLastRow(), 3);
    const cc = Math.min(Math.max(sh.getLastColumn(), 24), sh.getMaxColumns());
    try { sh.getRange(1, 1, cr, cc).breakApart(); } catch (e) {}
    sh.clearContents();
    sh.clearFormats();
  } else {
    sh = ss.insertSheet(MLB_PITCHER_OUTS_CARD_TAB);
  }
  sh.setTabColor('#00897b');

  const NEED_COLS = 25;
  if (sh.getMaxColumns() < NEED_COLS) {
    sh.insertColumnsAfter(sh.getMaxColumns(), NEED_COLS - sh.getMaxColumns());
  }
  [72, 200, 52, 150, 56, 64, 64, 52, 56, 52, 52, 52, 52, 52, 52, 52, 64, 52, 140, 88, 140, 44, 56, 56, 48].forEach(function (w, i) {
    sh.setColumnWidth(i + 1, w);
  });

  sh.getRange(1, 1, 1, NEED_COLS)
    .merge()
    .setValue(
      '🔩 Pitcher Outs card — λ = proj_IP × 3 (Poisson); EV vs FD. Cols 22..24 = IP v2 audit. Sort: best_ev desc.'
    )
    .setFontWeight('bold')
    .setBackground('#00695c')
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center')
    .setWrap(true);
  sh.setRowHeight(1, 36);

  const headers = [
    'gamePk',
    'matchup',
    'side',
    'pitcher',
    'fd_outs_line',
    'fd_over',
    'fd_under',
    'proj_IP',
    'lambda_outs',
    'edge_vs_line',
    'p_over',
    'p_under',
    'implied_over',
    'implied_under',
    'ev_over_$1',
    'ev_under_$1',
    'best_side',
    'best_ev_$1',
    'flags',
    'pitcher_id',
    'hp_umpire',
    'throws',
    'lambda_outs_v2',
    'projIP_v2',
    'games',
  ];
  sh.getRange(3, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight('bold')
    .setBackground('#00897b')
    .setFontColor('#ffffff');
  if (typeof mlbApplyHeaderNotes_ === 'function') mlbApplyHeaderNotes_(sh, 3, headers);
  sh.setFrozenRows(3);

  if (out.length) {
    sh.getRange(4, 1, out.length, headers.length).setValues(out);
    try {
      ss.setNamedRange('MLB_PITCHER_OUTS_CARD', sh.getRange(4, 1, out.length, headers.length));
    } catch (e) {}
    if (typeof mlbApplyHotColdBorders_ === 'function') {
      mlbApplyHotColdBorders_(sh, 4, sortedHot, headers.length);
    }
  }

  ss.toast(out.length + ' rows · sorted by best_ev', 'Pitcher Outs card', 6);
}

function mlbActivatePitcherOutsCardTab_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(MLB_PITCHER_OUTS_CARD_TAB);
  if (sh) sh.activate();
  else safeAlert_('Pitcher Outs card', 'Run "🔩 Pitcher Outs card only" first.');
}
