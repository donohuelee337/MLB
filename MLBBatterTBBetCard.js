// ============================================================
// 🎲 Batter TB card — Poisson λ vs FanDuel batter_total_bases
// ============================================================
// Reads 📋 Batter_TB_Queue. λ = blend(season TB/game, L7 TB/game) × park TB.
// ============================================================

const MLB_BATTER_TB_CARD_TAB = '🎲 Batter_TB_Card';
const MLB_BATTER_HITS_CARD_TAB = '🎯 Batter_Hits_Card';
const MLB_BATTER_HR_CARD_TAB = '💥 Batter_HR_Card';

function mlbEffectiveTbPerGameLambda_(tbpgSznRaw, l7AvgRaw, l7nRaw, cfg) {
  const wRaw =
    cfg && cfg['TB_BLEND_RECENT_WEIGHT'] != null ? String(cfg['TB_BLEND_RECENT_WEIGHT']).trim() : '0.35';
  const w = parseFloat(wRaw, 10);
  const wt = !isNaN(w) ? Math.max(0, Math.min(1, w)) : 0.35;
  const szn = parseFloat(tbpgSznRaw, 10);
  const l7a = parseFloat(l7AvgRaw, 10);
  const l7n = parseFloat(l7nRaw, 10);
  if (!isNaN(l7a) && !isNaN(l7n) && l7n >= 1) {
    if (!isNaN(szn) && szn >= 0) {
      return Math.round(((1 - wt) * szn + wt * l7a) * 1000) / 1000;
    }
    return Math.round(l7a * 1000) / 1000;
  }
  if (!isNaN(szn) && szn >= 0) return Math.round(szn * 1000) / 1000;
  return NaN;
}

function mlbFlagsBatterTbCard_(injuryStatus, notes, hasModel) {
  const f = [];
  const inj = String(injuryStatus || '').toLowerCase();
  if (inj.indexOf('out') !== -1 || inj.indexOf('doubtful') !== -1) f.push('injury');
  const n = String(notes || '');
  if (n.indexOf('schedule_game_miss') !== -1 || n.indexOf('fd_') !== -1) f.push('join_risk');
  if (n.indexOf('id_miss') !== -1) f.push('id_miss');
  if (!hasModel) f.push('no_model');
  return f.join('; ');
}

function refreshBatterTbBetCard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig();
  const q = ss.getSheetByName(MLB_BATTER_TB_QUEUE_TAB);
  if (!q || q.getLastRow() < 4) {
    safeAlert_('Batter TB card', 'Run Batter TB queue first (pipeline or menu).');
    return;
  }

  const last = q.getLastRow();
  const raw = q.getRange(4, 1, last, 14).getValues();
  const out = [];

  raw.forEach(function (r) {
    const gamePk = r[0];
    const matchup = r[1];
    const batter = r[2];
    const batterId = r[3];
    const line = r[4];
    const fdOver = r[5];
    const fdUnder = r[6];
    const l7Avg = r[7];
    const l7n = r[8];
    const tbpgSzn = r[9];
    const notes = r[10];
    const inj = r[11];
    const hpUmp = String(r[12] || '').trim();

    if (!String(batter || '').trim()) return;

    let lamNum = mlbEffectiveTbPerGameLambda_(tbpgSzn, l7Avg, l7n, cfg);
    const homeAbbr = mlbScheduleHomeAbbrForGamePk_(ss, gamePk);
    const pk = mlbParkTbLambdaMultForHomeAbbr_(homeAbbr);
    if (!isNaN(lamNum) && lamNum >= 0) {
      lamNum = Math.round(lamNum * pk * 1000) / 1000;
    }

    let lambdaDisp = '';
    let edge = '';
    if (!isNaN(lamNum) && lamNum >= 0) {
      lambdaDisp = lamNum;
      const lv = parseFloat(line, 10);
      if (!isNaN(lv)) edge = Math.round((lamNum - lv) * 1000) / 1000;
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

    const flags = mlbFlagsBatterTbCard_(inj, notes, hasModel);

    out.push([
      gamePk,
      matchup,
      batter,
      line,
      fdOver,
      fdUnder,
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
      batterId,
      hpUmp,
    ]);
  });

  out.sort(function (a, b) {
    const be = parseFloat(b[15], 10);
    const ae = parseFloat(a[15], 10);
    if (isNaN(be) && isNaN(ae)) return 0;
    if (isNaN(be)) return -1;
    if (isNaN(ae)) return 1;
    return be - ae;
  });

  let sh = ss.getSheetByName(MLB_BATTER_TB_CARD_TAB);
  if (sh) {
    sh.clearContents();
    sh.clearFormats();
  } else {
    sh = ss.insertSheet(MLB_BATTER_TB_CARD_TAB);
  }
  sh.setTabColor('#ef6c00');

  [72, 200, 150, 56, 64, 64, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 140, 88, 140].forEach(function (w, i) {
    sh.setColumnWidth(i + 1, w);
  });

  sh.getRange(1, 1, 1, 19)
    .merge()
    .setValue(
      '🎲 Batter TB card — λ = blend(TB/game) × park; Poisson vs FD line · sort best_ev desc'
    )
    .setFontWeight('bold')
    .setBackground('#e65100')
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center')
    .setWrap(true);
  sh.setRowHeight(1, 34);

  const headers = [
    'gamePk',
    'matchup',
    'batter',
    'fd_tb_line',
    'fd_over',
    'fd_under',
    'lambda_TB',
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
    'batter_id',
    'hp_umpire',
  ];
  sh.getRange(3, 1, 3, headers.length)
    .setValues([headers])
    .setFontWeight('bold')
    .setBackground('#fb8c00')
    .setFontColor('#ffffff');
  sh.setFrozenRows(3);

  if (out.length) {
    sh.getRange(4, 1, out.length, headers.length).setValues(out);
    try {
      ss.setNamedRange('MLB_BATTER_TB_CARD', sh.getRange(4, 1, out.length, headers.length));
    } catch (e) {}
  }

  ss.toast(out.length + ' rows · sorted by best_ev', 'Batter TB card', 6);
}

function refreshBatterHitsBetCard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig();
  const q = ss.getSheetByName(MLB_BATTER_HITS_QUEUE_TAB);
  if (!q || q.getLastRow() < 4) {
    safeAlert_('Batter Hits card', 'Run Batter Hits queue first (pipeline or menu).');
    return;
  }

  const last = q.getLastRow();
  const raw = q.getRange(4, 1, last, 14).getValues();
  const out = [];

  raw.forEach(function (r) {
    const gamePk = r[0];
    const matchup = r[1];
    const batter = r[2];
    const batterId = r[3];
    const line = r[4];
    const fdOver = r[5];
    const fdUnder = r[6];
    const l7Avg = r[7];
    const l7n = r[8];
    const hpgSzn = r[9];
    const notes = r[10];
    const inj = r[11];
    const hpUmp = String(r[12] || '').trim();

    if (!String(batter || '').trim()) return;

    let lamNum = mlbEffectiveTbPerGameLambda_(hpgSzn, l7Avg, l7n, cfg);
    const homeAbbr = mlbScheduleHomeAbbrForGamePk_(ss, gamePk);
    const pk = mlbParkTbLambdaMultForHomeAbbr_(homeAbbr);
    if (!isNaN(lamNum) && lamNum >= 0) {
      lamNum = Math.round(lamNum * pk * 1000) / 1000;
    }

    let lambdaDisp = '';
    let edge = '';
    if (!isNaN(lamNum) && lamNum >= 0) {
      lambdaDisp = lamNum;
      const lv = parseFloat(line, 10);
      if (!isNaN(lv)) edge = Math.round((lamNum - lv) * 1000) / 1000;
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

    const flags = mlbFlagsBatterTbCard_(inj, notes, hasModel);

    out.push([
      gamePk,
      matchup,
      batter,
      line,
      fdOver,
      fdUnder,
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
      batterId,
      hpUmp,
    ]);
  });

  out.sort(function (a, b) {
    const be = parseFloat(b[15], 10);
    const ae = parseFloat(a[15], 10);
    if (isNaN(be) && isNaN(ae)) return 0;
    if (isNaN(be)) return -1;
    if (isNaN(ae)) return 1;
    return be - ae;
  });

  let sh = ss.getSheetByName(MLB_BATTER_HITS_CARD_TAB);
  if (sh) {
    sh.clearContents();
    sh.clearFormats();
  } else {
    sh = ss.insertSheet(MLB_BATTER_HITS_CARD_TAB);
  }
  sh.setTabColor('#00838f');

  [72, 200, 150, 56, 64, 64, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 140, 88, 140].forEach(function (w, i) {
    sh.setColumnWidth(i + 1, w);
  });

  sh.getRange(1, 1, 1, 19)
    .merge()
    .setValue(
      '🎯 Batter Hits card — λ = blend(H/game) × park (same blend weight as TB); Poisson vs FD line'
    )
    .setFontWeight('bold')
    .setBackground('#006064')
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center')
    .setWrap(true);
  sh.setRowHeight(1, 34);

  const headers = [
    'gamePk',
    'matchup',
    'batter',
    'fd_hits_line',
    'fd_over',
    'fd_under',
    'lambda_H',
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
    'batter_id',
    'hp_umpire',
  ];
  sh.getRange(3, 1, 3, headers.length)
    .setValues([headers])
    .setFontWeight('bold')
    .setBackground('#0097a7')
    .setFontColor('#ffffff');
  sh.setFrozenRows(3);

  if (out.length) {
    sh.getRange(4, 1, out.length, headers.length).setValues(out);
    try {
      ss.setNamedRange('MLB_BATTER_HITS_CARD', sh.getRange(4, 1, out.length, headers.length));
    } catch (e) {}
  }

  ss.toast(out.length + ' rows · sorted by best_ev', 'Batter Hits card', 6);
}

function refreshBatterHrBetCard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig();
  const q = ss.getSheetByName(MLB_BATTER_HR_QUEUE_TAB);
  if (!q || q.getLastRow() < 4) {
    safeAlert_('Batter HR card', 'Run Batter HR queue first (pipeline or menu).');
    return;
  }

  const last = q.getLastRow();
  const raw = q.getRange(4, 1, last, 14).getValues();
  const out = [];

  raw.forEach(function (r) {
    const gamePk = r[0];
    const matchup = r[1];
    const batter = r[2];
    const batterId = r[3];
    const line = r[4];
    const fdOver = r[5];
    const fdUnder = r[6];
    const l7Avg = r[7];
    const l7n = r[8];
    const hrpgSzn = r[9];
    const notes = r[10];
    const inj = r[11];
    const hpUmp = String(r[12] || '').trim();

    if (!String(batter || '').trim()) return;

    let lamNum = mlbEffectiveTbPerGameLambda_(hrpgSzn, l7Avg, l7n, cfg);
    const homeAbbr = mlbScheduleHomeAbbrForGamePk_(ss, gamePk);
    const pk = mlbParkTbLambdaMultForHomeAbbr_(homeAbbr);
    if (!isNaN(lamNum) && lamNum >= 0) {
      lamNum = Math.round(lamNum * pk * 1000) / 1000;
    }

    let lambdaDisp = '';
    let edge = '';
    if (!isNaN(lamNum) && lamNum >= 0) {
      lambdaDisp = lamNum;
      const lv = parseFloat(line, 10);
      if (!isNaN(lv)) edge = Math.round((lamNum - lv) * 1000) / 1000;
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

    const flags = mlbFlagsBatterTbCard_(inj, notes, hasModel);

    out.push([
      gamePk,
      matchup,
      batter,
      line,
      fdOver,
      fdUnder,
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
      batterId,
      hpUmp,
    ]);
  });

  out.sort(function (a, b) {
    const be = parseFloat(b[15], 10);
    const ae = parseFloat(a[15], 10);
    if (isNaN(be) && isNaN(ae)) return 0;
    if (isNaN(be)) return -1;
    if (isNaN(ae)) return 1;
    return be - ae;
  });

  let sh = ss.getSheetByName(MLB_BATTER_HR_CARD_TAB);
  if (sh) {
    sh.clearContents();
    sh.clearFormats();
  } else {
    sh = ss.insertSheet(MLB_BATTER_HR_CARD_TAB);
  }
  sh.setTabColor('#c2185b');

  [72, 200, 150, 56, 64, 64, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 140, 88, 140].forEach(function (w, i) {
    sh.setColumnWidth(i + 1, w);
  });

  sh.getRange(1, 1, 1, 19)
    .merge()
    .setValue(
      '💥 Batter HR card — λ HR/game blend × park TB env; Poisson vs FD batter_home_runs'
    )
    .setFontWeight('bold')
    .setBackground('#880e4f')
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center')
    .setWrap(true);
  sh.setRowHeight(1, 34);

  const headers = [
    'gamePk',
    'matchup',
    'batter',
    'fd_hr_line',
    'fd_over',
    'fd_under',
    'lambda_HR',
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
    'batter_id',
    'hp_umpire',
  ];
  sh.getRange(3, 1, 3, headers.length)
    .setValues([headers])
    .setFontWeight('bold')
    .setBackground('#c2185b')
    .setFontColor('#ffffff');
  sh.setFrozenRows(3);

  if (out.length) {
    sh.getRange(4, 1, out.length, headers.length).setValues(out);
    try {
      ss.setNamedRange('MLB_BATTER_HR_CARD', sh.getRange(4, 1, out.length, headers.length));
    } catch (e) {}
  }

  ss.toast(out.length + ' rows · sorted by best_ev', 'Batter HR card', 6);
}
