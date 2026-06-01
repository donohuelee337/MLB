// ============================================================
// ⚾ F5 card — Poisson F5 total runs + EV vs FanDuel
// ============================================================
// Reads 📋 F5_Queue. Model:
//   λ_away = (home_SP_FIP / 9) × min(home_proj_IP, 5)
//   λ_home = (away_SP_FIP / 9) × min(away_proj_IP, 5)
// FIP regresses to LEAGUE_FIP (0→8 starts). P(Over/Under) on fd_f5_line.
// F5 ML/spread shown for reference; EV computed on total only (v1).
// ============================================================

const MLB_F5_CARD_TAB = '⚾ F5_Card';

function mlbF5CapIp_(projIp) {
  const ip = parseFloat(String(projIp), 10);
  if (isNaN(ip) || ip <= 0) return 5;
  return Math.min(5, ip);
}

function mlbF5LambdaRunsAllowed_(spFip, spGames, projIp, cfg) {
  const effFip =
    typeof mlbEffectiveFipForLambda_ === 'function'
      ? mlbEffectiveFipForLambda_(spFip, spGames, cfg)
      : parseFloat(String(spFip), 10);
  const ip = mlbF5CapIp_(projIp);
  if (isNaN(effFip) || effFip <= 0 || ip <= 0) return NaN;
  return Math.round((effFip / 9) * ip * 1000) / 1000;
}

function mlbFlagsF5Card_(notes, hasModel) {
  const f = [];
  const n = String(notes || '');
  if (n.indexOf('fd_f5_total_miss') !== -1 || n.indexOf('no FD') !== -1) f.push('no_FD_line');
  if (!hasModel) f.push('no_model');
  return f.join('; ');
}

function refreshF5BetCard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig();
  const q = ss.getSheetByName(MLB_F5_QUEUE_TAB);
  if (!q || q.getLastRow() < 4) {
    safeAlert_('F5 card', 'Run F5 queue first.');
    return;
  }

  const last = q.getLastRow();
  const raw = q.getRange(4, 1, last, 25).getValues();
  const rows = [];

  raw.forEach(function (r) {
    const gamePk = r[0];
    const matchup = r[1];
    const startEt = r[2];
    const awaySp = r[5];
    const homeSp = r[6];
    const line = r[9];
    const fdOver = r[10];
    const fdUnder = r[11];
    const fdMlAway = r[12];
    const fdMlHome = r[13];
    const awayProjIp = r[17];
    const homeProjIp = r[18];
    const awaySpFip = r[19];
    const homeSpFip = r[20];
    const awaySpGames = r[21];
    const homeSpGames = r[22];
    const notes = r[23];
    const hpUmp = String(r[24] || '').trim();

    const lambdaAway = mlbF5LambdaRunsAllowed_(homeSpFip, homeSpGames, homeProjIp, cfg);
    const lambdaHome = mlbF5LambdaRunsAllowed_(awaySpFip, awaySpGames, awayProjIp, cfg);
    let lambdaTotal = '';
    if (!isNaN(lambdaAway) && !isNaN(lambdaHome)) {
      lambdaTotal = Math.round((lambdaAway + lambdaHome) * 1000) / 1000;
    }

    const lineNum = parseFloat(line, 10);
    const hasModel = lambdaTotal !== '' && !isNaN(lineNum);
    const pu = hasModel ? mlbProbOverUnderK_(lineNum, lambdaTotal) : { pOver: '', pUnder: '' };
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
    if (lambdaTotal !== '' && !isNaN(lineNum)) {
      edge = Math.round((lambdaTotal - lineNum) * 100) / 100;
    }

    const flags = mlbFlagsF5Card_(notes, hasModel);

    rows.push({
      sortKey: bestRank,
      data: [
        gamePk,
        matchup,
        startEt,
        awaySp,
        homeSp,
        line,
        fdOver,
        fdUnder,
        fdMlAway,
        fdMlHome,
        awayProjIp,
        homeProjIp,
        lambdaAway === '' || isNaN(lambdaAway) ? '' : lambdaAway,
        lambdaHome === '' || isNaN(lambdaHome) ? '' : lambdaHome,
        lambdaTotal,
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
        hpUmp,
      ],
    });
  });

  // Rank by win probability (outcome mode) or EV (legacy) — most-likely
  // winners on top, not juiciest prices.
  rows.sort(function (a, b) {
    const bv = typeof b.sortKey === 'number' && !isNaN(b.sortKey) ? b.sortKey : -1e9;
    const av = typeof a.sortKey === 'number' && !isNaN(a.sortKey) ? a.sortKey : -1e9;
    return bv - av;
  });

  const out = rows.map(function (x) {
    return x.data;
  });

  let sh = ss.getSheetByName(MLB_F5_CARD_TAB);
  if (sh) {
    const cr = Math.max(sh.getLastRow(), 3);
    const cc = Math.min(Math.max(sh.getLastColumn(), 25), sh.getMaxColumns());
    try {
      sh.getRange(1, 1, cr, cc).breakApart();
    } catch (e) {}
    sh.clearContents();
    sh.clearFormats();
  } else {
    sh = ss.insertSheet(MLB_F5_CARD_TAB);
  }
  sh.setTabColor('#1976d2');

  const NEED_COLS = 26;
  if (sh.getMaxColumns() < NEED_COLS) {
    sh.insertColumnsAfter(sh.getMaxColumns(), NEED_COLS - sh.getMaxColumns());
  }
  [72, 220, 120, 130, 130, 48, 64, 64, 64, 64, 52, 52, 56, 56, 56, 52, 52, 52, 52, 52, 52, 52, 56, 52, 160, 120].forEach(function (w, i) {
    if (i < NEED_COLS) sh.setColumnWidth(i + 1, w);
  });

  sh.getRange(1, 1, 1, NEED_COLS)
    .merge()
    .setValue(
      '⚾ F5 card — λ_total = home_SP runs allowed + away_SP runs allowed through min(proj_IP,5). Sort: best_ev desc.'
    )
    .setFontWeight('bold')
    .setBackground('#0d47a1')
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center')
    .setWrap(true);
  sh.setRowHeight(1, 36);

  const headers = [
    'gamePk',
    'matchup',
    'start_ET',
    'away_SP',
    'home_SP',
    'fd_f5_line',
    'fd_f5_over',
    'fd_f5_under',
    'fd_f5_ml_away',
    'fd_f5_ml_home',
    'away_proj_IP',
    'home_proj_IP',
    'lambda_away',
    'lambda_home',
    'lambda_total',
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
    'hp_umpire',
  ];
  sh.getRange(3, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight('bold')
    .setBackground('#1976d2')
    .setFontColor('#ffffff');
  if (typeof mlbApplyHeaderNotes_ === 'function') mlbApplyHeaderNotes_(sh, 3, headers);
  sh.setFrozenRows(3);

  if (out.length) {
    sh.getRange(4, 1, out.length, headers.length).setValues(out);
    try {
      ss.setNamedRange('MLB_F5_CARD', sh.getRange(4, 1, out.length, headers.length));
    } catch (e) {}
    for (let i = 0; i < out.length; i++) {
      if (parseFloat(out[i][23], 10) > 0) {
        sh.getRange(4 + i, 1, 1, headers.length).setBackground('#e3f2fd');
      }
    }
  }

  ss.toast(out.length + ' games · sorted by best_ev', 'F5 card', 6);
}

function mlbActivateF5CardTab_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(MLB_F5_CARD_TAB);
  if (sh) sh.activate();
  else safeAlert_('F5 card', 'Run "⚾ F5 card only" first.');
}
