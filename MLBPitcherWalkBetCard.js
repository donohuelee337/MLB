// ============================================================
// 🎰 Pitcher BB card — Poisson + EV (pitcher_walks)
// ============================================================
// Mirrors 🎰 Pitcher_K_Card: λ = (BB9 / 9) × proj_IP; no park table v1.
// ============================================================

const MLB_PITCHER_BB_CARD_TAB = '🎰 Pitcher_BB_Card';

function mlbEffectiveBB9ForLambda_(bb9raw, l3bbRaw, l3ipRaw, cfg) {
  let wRaw =
    cfg && cfg['BB9_BLEND_L3_WEIGHT'] != null ? String(cfg['BB9_BLEND_L3_WEIGHT']).trim() : '';
  if (!wRaw) {
    wRaw =
      cfg && cfg['K9_BLEND_L7_WEIGHT'] != null ? String(cfg['K9_BLEND_L7_WEIGHT']).trim() : '0.35';
  }
  if (!wRaw) wRaw = '0.35';
  const w = parseFloat(wRaw, 10);
  const wt = !isNaN(w) ? Math.max(0, Math.min(1, w)) : 0.35;
  const b9 = parseFloat(bb9raw, 10);
  const lbb = parseFloat(l3bbRaw, 10);
  const lip = parseFloat(l3ipRaw, 10);
  if (!isNaN(lbb) && !isNaN(lip) && lip > 0.51) {
    const b9l = (lbb / lip) * 9;
    if (!isNaN(b9) && b9 > 0) {
      return Math.round(((1 - wt) * b9 + wt * b9l) * 100) / 100;
    }
    if (!isNaN(b9l) && b9l > 0) return Math.round(b9l * 100) / 100;
  }
  if (!isNaN(b9) && b9 > 0) return Math.round(b9 * 100) / 100;
  return NaN;
}

function mlbFlagsWalkCard_(injuryStatus, notes, hasModel) {
  const f = [];
  const inj = String(injuryStatus || '').toLowerCase();
  if (inj.indexOf('out') !== -1 || inj.indexOf('doubtful') !== -1) f.push('injury');
  const n = String(notes || '');
  if (n.indexOf('fd_bb_miss') !== -1) f.push('no_FD_line');
  if (!hasModel) f.push('no_model');
  return f.join('; ');
}

function refreshPitcherWalkBetCard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig();
  const q = ss.getSheetByName(MLB_PITCHER_BB_QUEUE_TAB);
  if (!q || q.getLastRow() < 4) {
    safeAlert_('Pitcher BB card', 'Run Pitcher BB queue first.');
    return;
  }

  const last = q.getLastRow();
  const raw = q.getRange(4, 1, last, 15).getValues();
  const out = [];

  raw.forEach(function (r) {
    const gamePk = r[0];
    const matchup = r[1];
    const side = r[2];
    const pitcher = r[3];
    const pitcherId = r[4];
    const line = r[5];
    const fdOver = r[6];
    const fdUnder = r[7];
    const l3bb = r[8];
    const l3ip = r[9];
    const bb9raw = r[10];
    const notes = r[11];
    const inj = r[12];
    const hpUmp = String(r[13] || '').trim();
    const throws = String(r[14] || '').trim();

    if (!String(pitcher || '').trim()) return;

    const bb9eff = mlbEffectiveBB9ForLambda_(bb9raw, l3bb, l3ip, cfg);
    const projIp = mlbProjIpFromQueueRow_(l3ip);
    let lambdaDisp = '';
    let lamNum = NaN;
    let edge = '';
    if (!isNaN(bb9eff) && bb9eff > 0) {
      lamNum = Math.round(((bb9eff / 9) * projIp) * 100) / 100;
      const tw = String(throws || '').trim().toUpperCase();
      const lhpM = parseFloat(
        String(cfg['LHP_BB_LAMBDA_MULT'] != null ? cfg['LHP_BB_LAMBDA_MULT'] : '1').trim(),
        10
      );
      const rhpM = parseFloat(
        String(cfg['RHP_BB_LAMBDA_MULT'] != null ? cfg['RHP_BB_LAMBDA_MULT'] : '1').trim(),
        10
      );
      let handMult = 1;
      if (tw === 'L' && !isNaN(lhpM)) {
        handMult *= Math.max(0.92, Math.min(1.12, lhpM));
      }
      if (tw === 'R' && !isNaN(rhpM)) {
        handMult *= Math.max(0.92, Math.min(1.12, rhpM));
      }
      if (Math.abs(handMult - 1) > 1e-9) {
        lamNum = Math.round(lamNum * handMult * 100) / 100;
      }
      lambdaDisp = lamNum;
      const lv = parseFloat(line, 10);
      if (!isNaN(lv)) edge = Math.round((lamNum - lv) * 100) / 100;
    }

    const lineNum = parseFloat(line, 10);
    const hasModel = !isNaN(lamNum) && lamNum > 0 && !isNaN(lineNum);
    const pu = hasModel ? mlbProbOverUnderK_(line, lamNum) : { pOver: '', pUnder: '' };
    const pOver = pu.pOver === '' ? '' : Math.round(pu.pOver * 1000) / 1000;
    const pUnder = pu.pUnder === '' ? '' : Math.round(pu.pUnder * 1000) / 1000;

    const imO = mlbAmericanImplied_(fdOver);
    const imU = mlbAmericanImplied_(fdUnder);
    const evO = pOver !== '' && fdOver !== '' ? mlbEvPerDollarRisked_(pOver, fdOver) : '';
    const evU = pUnder !== '' && fdUnder !== '' ? mlbEvPerDollarRisked_(pUnder, fdUnder) : '';

    let bestSide = '';
    let bestEv = '';
    if (evO !== '' && evU !== '') {
      if (evO >= evU && evO > 0) {
        bestSide = 'Over';
        bestEv = evO;
      } else if (evU > evO && evU > 0) {
        bestSide = 'Under';
        bestEv = evU;
      } else if (evO >= evU) {
        bestSide = 'Over';
        bestEv = evO;
      } else {
        bestSide = 'Under';
        bestEv = evU;
      }
    } else if (evO !== '') {
      bestSide = 'Over';
      bestEv = evO;
    } else if (evU !== '') {
      bestSide = 'Under';
      bestEv = evU;
    }

    const flags = mlbFlagsWalkCard_(inj, notes, hasModel);

    out.push([
      gamePk,
      matchup,
      side,
      pitcher,
      line,
      fdOver,
      fdUnder,
      projIp,
      lambdaDisp,
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
    ]);
  });

  out.sort(function (a, b) {
    const be = parseFloat(b[17], 10);
    const ae = parseFloat(a[17], 10);
    if (isNaN(be) && isNaN(ae)) return 0;
    if (isNaN(be)) return -1;
    if (isNaN(ae)) return 1;
    return be - ae;
  });

  let sh = ss.getSheetByName(MLB_PITCHER_BB_CARD_TAB);
  if (sh) {
    const cr = Math.max(sh.getLastRow(), 3);
    const cc = Math.max(sh.getLastColumn(), 22);
    try {
      sh.getRange(1, 1, cr, cc).breakApart();
    } catch (e) {
      Logger.log('refreshPitcherWalkBetCard breakApart: ' + e.message);
    }
    sh.clearContents();
    sh.clearFormats();
  } else {
    sh = ss.insertSheet(MLB_PITCHER_BB_CARD_TAB);
  }
  sh.setTabColor('#0277bd');
  [72, 200, 52, 150, 56, 64, 64, 52, 52, 52, 52, 52, 52, 52, 52, 52, 64, 52, 140, 88, 140, 44].forEach(function (w, i) {
    sh.setColumnWidth(i + 1, w);
  });

  sh.getRange(1, 1, 1, 22)
    .merge()
    .setValue(
      '🎰 Pitcher BB card — λ: blended BB9×proj_IP (+ optional L/R ⚙️); Poisson vs FD pitcher_walks. Sort: best_ev desc.'
    )
    .setFontWeight('bold')
    .setBackground('#01579b')
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center')
    .setWrap(true);
  sh.setRowHeight(1, 36);

  const headers = [
    'gamePk',
    'matchup',
    'side',
    'pitcher',
    'fd_bb_line',
    'fd_over',
    'fd_under',
    'proj_IP',
    'lambda_BB',
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
  ];
  sh.getRange(3, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight('bold')
    .setBackground('#0288d1')
    .setFontColor('#ffffff');

  if (out.length) {
    sh.getRange(4, 1, out.length, headers.length).setValues(out);
    try {
      ss.setNamedRange('MLB_PITCHER_BB_CARD', sh.getRange(4, 1, out.length, headers.length));
    } catch (e) {}
  }
  sh.setFrozenRows(3);

  ss.toast(out.length + ' rows · walks · sorted by best_ev', 'Pitcher BB card', 6);
}
