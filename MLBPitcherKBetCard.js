// ============================================================
// 🎰 Pitcher K card — Poisson stub + EV vs FanDuel (prototype)
// ============================================================
// Reads 📋 Pitcher_K_Queue. Model: λ = (K9_szn / 9) × proj_IP,
// proj_IP = clamp(mean depth from L3_IP/3, 4–7) or 5.5 if missing.
// P(Over) / P(Under) vs half-integer FD line; naive EV from American odds.
// ============================================================

const MLB_PITCHER_K_CARD_TAB = '🎰 Pitcher_K_Card';

function mlbProjIpFromQueueRow_(l3ipRaw) {
  const x = parseFloat(l3ipRaw, 10);
  if (!isNaN(x) && x > 0) {
    const avg = x / 3;
    return Math.min(7, Math.max(4, Math.round(avg * 100) / 100));
  }
  return 5.5;
}

/** Season K/9 blended with L3 K/9 when recent IP sample is usable. */
function mlbEffectiveK9ForLambda_(k9raw, l3kRaw, l3ipRaw, cfg) {
  const k9 = parseFloat(k9raw, 10);
  const wRaw = cfg && cfg['K9_BLEND_L7_WEIGHT'] != null ? String(cfg['K9_BLEND_L7_WEIGHT']).trim() : '0.35';
  const w = parseFloat(wRaw, 10);
  const wt = !isNaN(w) ? Math.max(0, Math.min(1, w)) : 0.35;
  const lk = parseFloat(l3kRaw, 10);
  const lip = parseFloat(l3ipRaw, 10);
  if (!isNaN(lk) && !isNaN(lip) && lip > 0.51) {
    const k9l = (lk / lip) * 9;
    if (!isNaN(k9) && k9 > 0) {
      return Math.round(((1 - wt) * k9 + wt * k9l) * 100) / 100;
    }
    if (!isNaN(k9l) && k9l > 0) return Math.round(k9l * 100) / 100;
  }
  if (!isNaN(k9) && k9 > 0) return Math.round(k9 * 100) / 100;
  return NaN;
}

function mlbFlagsCard_(injuryStatus, notes, hasModel) {
  const f = [];
  const inj = String(injuryStatus || '').toLowerCase();
  if (inj.indexOf('out') !== -1 || inj.indexOf('doubtful') !== -1) f.push('injury');
  const n = String(notes || '');
  if (n.indexOf('fd_k_miss') !== -1 || n.indexOf('no FD') !== -1) f.push('no_FD_line');
  if (!hasModel) f.push('no_model');
  return f.join('; ');
}

/**
 * Build bet card from current Pitcher K queue (run queue first).
 */
function refreshPitcherKBetCard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig();
  const q = ss.getSheetByName(MLB_PITCHER_K_QUEUE_TAB);
  if (!q || q.getLastRow() < 4) {
    safeAlert_('Pitcher K card', 'Run Pitcher K queue first.');
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
    const l3k = r[8];
    const l3ip = r[9];
    const k9raw = r[10];
    const notes = r[11];
    const inj = r[12];
    const hpUmp = String(r[13] || '').trim();
    const throws = String(r[14] || '').trim();

    if (!String(pitcher || '').trim()) return;

    const k9eff = mlbEffectiveK9ForLambda_(k9raw, l3k, l3ip, cfg);
    const projIp = mlbProjIpFromQueueRow_(l3ip);
    let lambdaDisp = '';
    let lamNum = NaN;
    let edge = '';
    if (!isNaN(k9eff) && k9eff > 0) {
      lamNum = Math.round(((k9eff / 9) * projIp) * 100) / 100;
      const homeAbbr = mlbScheduleHomeAbbrForGamePk_(ss, gamePk);
      const pk = mlbParkKLambdaMultForHomeAbbr_(homeAbbr);
      lamNum = Math.round(lamNum * pk * 100) / 100;
      const tw = String(throws || '').trim().toUpperCase();
      const lhpM = parseFloat(
        String(cfg['LHP_K_LAMBDA_MULT'] != null ? cfg['LHP_K_LAMBDA_MULT'] : '1').trim(),
        10
      );
      const rhpM = parseFloat(
        String(cfg['RHP_K_LAMBDA_MULT'] != null ? cfg['RHP_K_LAMBDA_MULT'] : '1').trim(),
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
      const umpMultRaw = parseFloat(
        String(cfg['HP_UMP_LAMBDA_MULT'] != null ? cfg['HP_UMP_LAMBDA_MULT'] : '1').trim(),
        10
      );
      let umm = !isNaN(umpMultRaw) && umpMultRaw > 0 ? umpMultRaw : 1;
      umm = Math.max(0.85, Math.min(1.15, umm));
      if (hpUmp && Math.abs(umm - 1) > 1e-6) {
        lamNum = Math.round(lamNum * umm * 100) / 100;
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

    const flags = mlbFlagsCard_(inj, notes, hasModel);

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

  let sh = ss.getSheetByName(MLB_PITCHER_K_CARD_TAB);
  if (sh) {
    const cr = Math.max(sh.getLastRow(), 3);
    const cc = Math.max(sh.getLastColumn(), 22);
    try {
      sh.getRange(1, 1, cr, cc).breakApart();
    } catch (e) {
      Logger.log('refreshPitcherKBetCard breakApart: ' + e.message);
    }
    sh.clearContents();
    sh.clearFormats();
  } else {
    sh = ss.insertSheet(MLB_PITCHER_K_CARD_TAB);
  }
  sh.setTabColor('#c62828');
  [72, 200, 52, 150, 56, 64, 64, 52, 52, 52, 52, 52, 52, 52, 52, 52, 64, 52, 140, 88, 140, 44].forEach(function (w, i) {
    sh.setColumnWidth(i + 1, w);
  });

  sh.getRange(1, 1, 1, 22)
    .merge()
    .setValue(
      '🎰 Pitcher K card — λ: K9 blend × park(home) × L/R (⚙️) × HP ump; EV naive. Sort: best_ev desc.'
    )
    .setFontWeight('bold')
    .setBackground('#b71c1c')
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center')
    .setWrap(true);
  sh.setRowHeight(1, 36);

  const headers = [
    'gamePk',
    'matchup',
    'side',
    'pitcher',
    'fd_k_line',
    'fd_over',
    'fd_under',
    'proj_IP',
    'lambda_K',
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
    .setBackground('#e53935')
    .setFontColor('#ffffff');

  if (out.length) {
    sh.getRange(4, 1, out.length, headers.length).setValues(out);
    try {
      ss.setNamedRange('MLB_PITCHER_K_CARD', sh.getRange(4, 1, out.length, headers.length));
    } catch (e) {}
  }
  sh.setFrozenRows(3);

  ss.toast(out.length + ' rows · sorted by best_ev', 'Pitcher K card', 6);
}
