// ============================================================
// 💧 Pitcher ER card — FIP-based Poisson λ + EV vs FanDuel
// ============================================================
// Reads 📋 Pitcher_ER_Queue. Model: λ_ER = (effective_FIP / 9) × proj_IP
// where effective_FIP regresses season FIP toward LEAGUE_FIP across 0→8
// starts (same ramp as k.v2). P(Over/Under) vs half-integer FD ER line.
// fip_minus_ERA > 0 → ERA worse than skill → Under bias (Bill James edge).
// ============================================================

const MLB_PITCHER_ER_CARD_TAB = '💧 Pitcher_ER_Card';

function mlbFlagsERCard_(injuryStatus, notes, hasModel) {
  const f = [];
  const inj = String(injuryStatus || '').toLowerCase();
  if (inj.indexOf('out') !== -1 || inj.indexOf('doubtful') !== -1) f.push('injury');
  const n = String(notes || '');
  if (n.indexOf('fd_er_miss') !== -1 || n.indexOf('no FD') !== -1) f.push('no_FD_line');
  if (!hasModel) f.push('no_model');
  return f.join('; ');
}

function mlbEffectiveFipForLambda_(fipRaw, gamesRaw, cfg) {
  const leagueRaw = parseFloat(
    String(cfg && cfg['LEAGUE_FIP'] != null ? cfg['LEAGUE_FIP'] : '4.20').trim(),
    10
  );
  const leagueFip = !isNaN(leagueRaw) && leagueRaw > 0 ? leagueRaw : 4.2;
  const fip = parseFloat(String(fipRaw), 10);
  const games = parseInt(gamesRaw, 10);
  if (isNaN(fip) || fip <= 0) return leagueFip;
  if (isNaN(games) || games <= 0) return leagueFip;
  const w = Math.max(0, Math.min(1, games / 8));
  return Math.round((w * fip + (1 - w) * leagueFip) * 100) / 100;
}

/** Poisson λ for earned runs from FIP and projected IP. */
function mlbLambdaErFromFipProjIp_(fip, projIp) {
  const f = parseFloat(String(fip), 10);
  const ip = parseFloat(String(projIp), 10);
  if (isNaN(f) || f <= 0 || isNaN(ip) || ip <= 0) return NaN;
  return Math.round((f / 9) * ip * 100) / 100;
}

function refreshPitcherERBetCard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig();
  const q = ss.getSheetByName(MLB_PITCHER_ER_QUEUE_TAB);
  if (!q || q.getLastRow() < 4) {
    safeAlert_('Pitcher ER card', 'Run Pitcher ER queue first.');
    return;
  }

  const last = q.getLastRow();
  const raw = q.getRange(4, 1, last, 20).getValues();
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
    const era = r[11];
    const fip = r[12];
    const fipMinusEra = r[13];
    const notes = r[14];
    const inj = r[15];
    const hpUmp = String(r[16] || '').trim();
    const throws = String(r[17] || '').trim();
    const hotCold = String(r[18] || '').toUpperCase();
    const gamesRaw = r[19];

    if (!String(pitcher || '').trim()) return;

    const projIp = mlbProjIpFromQueueRow_(l3ip);
    const effFip = mlbEffectiveFipForLambda_(fip, gamesRaw, cfg);
    let lamNum = mlbLambdaErFromFipProjIp_(effFip, projIp);

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

    const flags = mlbFlagsERCard_(inj, notes, hasModel);

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
        effFip,
        era,
        fipMinusEra,
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

  let sh = ss.getSheetByName(MLB_PITCHER_ER_CARD_TAB);
  if (sh) {
    const cr = Math.max(sh.getLastRow(), 3);
    const cc = Math.min(Math.max(sh.getLastColumn(), 25), sh.getMaxColumns());
    try { sh.getRange(1, 1, cr, cc).breakApart(); } catch (e) {}
    sh.clearContents();
    sh.clearFormats();
  } else {
    sh = ss.insertSheet(MLB_PITCHER_ER_CARD_TAB);
  }
  sh.setTabColor('#5e35b1');

  const NEED_COLS = 26;
  if (sh.getMaxColumns() < NEED_COLS) {
    sh.insertColumnsAfter(sh.getMaxColumns(), NEED_COLS - sh.getMaxColumns());
  }
  [72, 200, 52, 150, 56, 64, 64, 52, 52, 52, 72, 56, 52, 52, 52, 52, 52, 52, 64, 52, 140, 88, 140, 44, 44, 48].forEach(function (w, i) {
    sh.setColumnWidth(i + 1, w);
  });

  sh.getRange(1, 1, 1, NEED_COLS)
    .merge()
    .setValue(
      '💧 Pitcher ER card — λ = effective_FIP/9 × proj_IP (Poisson); FIP regresses to LEAGUE_FIP. Sort: best_ev desc.'
    )
    .setFontWeight('bold')
    .setBackground('#4527a0')
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center')
    .setWrap(true);
  sh.setRowHeight(1, 36);

  const headers = [
    'gamePk',
    'matchup',
    'side',
    'pitcher',
    'fd_er_line',
    'fd_over',
    'fd_under',
    'proj_IP',
    'effective_FIP',
    'season_ERA',
    'fip_minus_ERA',
    'lambda_ER',
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
    'games',
  ];
  sh.getRange(3, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight('bold')
    .setBackground('#5e35b1')
    .setFontColor('#ffffff');
  if (typeof mlbApplyHeaderNotes_ === 'function') mlbApplyHeaderNotes_(sh, 3, headers);
  sh.setFrozenRows(3);

  if (out.length) {
    sh.getRange(4, 1, out.length, headers.length).setValues(out);
    try {
      ss.setNamedRange('MLB_PITCHER_ER_CARD', sh.getRange(4, 1, out.length, headers.length));
    } catch (e) {}
    if (typeof mlbApplyHotColdBorders_ === 'function') {
      mlbApplyHotColdBorders_(sh, 4, sortedHot, headers.length);
    }
  }

  ss.toast(out.length + ' rows · sorted by best_ev', 'Pitcher ER card', 6);
}

function mlbActivatePitcherERCardTab_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(MLB_PITCHER_ER_CARD_TAB);
  if (sh) sh.activate();
  else safeAlert_('Pitcher ER card', 'Run "💧 Pitcher ER card only" first.');
}
