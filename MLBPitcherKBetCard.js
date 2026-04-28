// ============================================================
// 🎰 Pitcher K card — Poisson stub + EV vs FanDuel (prototype)
// ============================================================
// Reads 📋 Pitcher_K_Queue. Model: λ = (K9_szn / 9) × proj_IP,
// proj_IP = clamp(mean depth from L3_IP/3, 4–7) or 5.5 if missing.
// P(Over) / P(Under) vs half-integer FD line; naive EV from American odds.
// ============================================================

const MLB_PITCHER_K_CARD_TAB  = '🎰 Pitcher_K_Card';
const MLB_PITCHER_K_CARD_COLS = 25;

function mlbPoissonCdf_(maxK, lambda) {
  if (maxK < 0) return 0;
  if (lambda <= 0) return 1;
  let sum = 0;
  let pmf = Math.exp(-lambda);
  sum += pmf;
  for (let k = 1; k <= maxK; k++) {
    pmf *= lambda / k;
    sum += pmf;
    if (sum >= 0.999999 && k >= lambda) break;
  }
  return Math.min(1, sum);
}

function mlbProbOverUnderK_(line, lambda) {
  const L = parseFloat(line, 10);
  if (isNaN(L) || lambda <= 0) return { pOver: '', pUnder: '' };
  const kMinOver = Math.floor(L) + 1;
  const kMaxUnder = Math.floor(L + 1e-9);
  const pOver = 1 - mlbPoissonCdf_(kMinOver - 1, lambda);
  const pUnder = mlbPoissonCdf_(kMaxUnder, lambda);
  return { pOver: pOver, pUnder: pUnder };
}

function mlbAmericanImplied_(odds) {
  const o = parseFloat(odds, 10);
  if (isNaN(o)) return '';
  if (o > 0) return Math.round((100 / (o + 100)) * 1000) / 1000;
  return Math.round((Math.abs(o) / (Math.abs(o) + 100)) * 1000) / 1000;
}

/** Returns {side, ev} for the better EV option; prefers Over on a tie. */
function mlbPickBestSide_(evO, evU) {
  if (evO !== '' && evU !== '') {
    if (evO >= evU && evO > 0) return { side: 'Over', ev: evO };
    if (evU > evO && evU > 0) return { side: 'Under', ev: evU };
    return evO >= evU ? { side: 'Over', ev: evO } : { side: 'Under', ev: evU };
  }
  if (evO !== '') return { side: 'Over', ev: evO };
  if (evU !== '') return { side: 'Under', ev: evU };
  return { side: '', ev: '' };
}

/** Expected profit per $1 risked at this American price (decimal odds payout style). */
function mlbEvPerDollarRisked_(p, american) {
  const o = parseFloat(american, 10);
  if (isNaN(o) || isNaN(p)) return '';
  let winUnits;
  if (o > 0) winUnits = o / 100;
  else winUnits = 100 / Math.abs(o);
  return Math.round((p * winUnits - (1 - p)) * 1000) / 1000;
}

/**
 * Confidence tier from EV per $1 risked.
 * A+ = MAX edge (≥5%), A = SHARP (≥3%), B = CONTEXT (≥1%), C = LEAN (>0%).
 */
function mlbConfidenceTier_(ev) {
  const e = parseFloat(ev);
  if (isNaN(e) || e <= 0) return '';
  if (e >= 0.05) return 'A+';
  if (e >= 0.03) return 'A';
  if (e >= 0.01) return 'B';
  return 'C';
}

/**
 * Full Kelly fraction: f* = p - (1-p)/b, where b = win units at the given American price.
 * Returns 0 if Kelly is negative (no edge), '' on bad inputs.
 */
function mlbKellyFull_(pWin, american) {
  const p = parseFloat(pWin);
  const o = parseFloat(american);
  if (isNaN(p) || p <= 0 || p >= 1 || isNaN(o)) return '';
  const b = o >= 0 ? o / 100 : 100 / Math.abs(o);
  const f = p - (1 - p) / b;
  return f > 0 ? Math.round(f * 10000) / 10000 : 0;
}

/**
 * Fractional Kelly dollar amount from config KELLY_BANKROLL / KELLY_FRACTION / KELLY_MAX_BET_PCT.
 * Returns '' on bad inputs, 0 if no edge.
 */
function mlbKellyDollars_(pWin, american, cfg) {
  const full = mlbKellyFull_(pWin, american);
  if (full === '' || full <= 0) return full === '' ? '' : 0;
  const c = cfg || {};
  const bankroll = parseFloat(String(c['KELLY_BANKROLL'] != null ? c['KELLY_BANKROLL'] : '1000').trim());
  const frac     = parseFloat(String(c['KELLY_FRACTION']    != null ? c['KELLY_FRACTION']    : '0.25').trim());
  const capPct   = parseFloat(String(c['KELLY_MAX_BET_PCT'] != null ? c['KELLY_MAX_BET_PCT'] : '0.05').trim());
  if (isNaN(bankroll) || bankroll <= 0) return '';
  const fraction = !isNaN(frac) && frac > 0 ? Math.min(frac, 1) : 0.25;
  const cap      = !isNaN(capPct) && capPct > 0 ? Math.min(capPct, 1) : 0.05;
  const betPct   = Math.min(full * fraction, cap);
  return Math.round(bankroll * betPct * 100) / 100;
}

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
  const raw = q.getRange(4, 1, last, 18).getValues();
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
    const oppAbbr = String(r[15] || '').trim();
    const oppKpaRaw = r[16];
    const oppKpaVsRaw = r[17];

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
      const baseLeagueK = parseFloat(
        String(cfg['LEAGUE_HITTING_K_PA'] != null ? cfg['LEAGUE_HITTING_K_PA'] : '0.225').trim(),
        10
      );
      const leagueVsL = parseFloat(
        String(cfg['LEAGUE_HITTING_K_PA_VS_L'] != null ? cfg['LEAGUE_HITTING_K_PA_VS_L'] : '').trim(),
        10
      );
      const leagueVsR = parseFloat(
        String(cfg['LEAGUE_HITTING_K_PA_VS_R'] != null ? cfg['LEAGUE_HITTING_K_PA_VS_R'] : '').trim(),
        10
      );
      const oppKpaVs = parseFloat(String(oppKpaVsRaw != null ? oppKpaVsRaw : '').trim(), 10);
      const oppKpaAll = parseFloat(String(oppKpaRaw != null ? oppKpaRaw : '').trim(), 10);
      const usingVsHand = !isNaN(oppKpaVs) && oppKpaVs > 0;
      const oppKpa =
        usingVsHand ? oppKpaVs : !isNaN(oppKpaAll) && oppKpaAll > 0 ? oppKpaAll : NaN;
      let leagueK = !isNaN(baseLeagueK) && baseLeagueK > 0 ? baseLeagueK : NaN;
      if (usingVsHand) {
        if (tw === 'L' && !isNaN(leagueVsL) && leagueVsL > 0) {
          leagueK = leagueVsL;
        } else if (tw === 'R' && !isNaN(leagueVsR) && leagueVsR > 0) {
          leagueK = leagueVsR;
        }
      }
      const oppStr = parseFloat(
        String(cfg['OPP_K_RATE_LAMBDA_STRENGTH'] != null ? cfg['OPP_K_RATE_LAMBDA_STRENGTH'] : '0').trim(),
        10
      );
      if (
        !isNaN(lamNum) &&
        lamNum > 0 &&
        !isNaN(oppKpa) &&
        oppKpa > 0 &&
        !isNaN(leagueK) &&
        leagueK > 0 &&
        !isNaN(oppStr) &&
        oppStr > 0
      ) {
        const ratio = oppKpa / leagueK - 1;
        const bump = oppStr * ratio;
        const capped = Math.max(-0.12, Math.min(0.12, bump));
        lamNum = Math.round(lamNum * (1 + capped) * 100) / 100;
      }
      const oppTeamId = mlbTeamIdFromAbbr_(oppAbbr);
      const savMult = !isNaN(oppTeamId) ? mlbGetAbsTeamLambdaMult_(oppTeamId) : null;
      let appliedAbs = false;
      if (!isNaN(lamNum) && lamNum > 0 && savMult != null && !isNaN(savMult) && savMult > 0) {
        const sm = Math.max(0.92, Math.min(1.08, savMult));
        lamNum = Math.round(lamNum * sm * 100) / 100;
        appliedAbs = true;
      }
      if (!appliedAbs) {
        const absRaw = parseFloat(
          String(cfg['ABS_K_LAMBDA_MULT'] != null ? cfg['ABS_K_LAMBDA_MULT'] : '1').trim(),
          10
        );
        if (!isNaN(lamNum) && lamNum > 0 && !isNaN(absRaw) && absRaw > 0) {
          const am = Math.max(0.95, Math.min(1.05, absRaw));
          if (Math.abs(am - 1) > 1e-6) {
            lamNum = Math.round(lamNum * am * 100) / 100;
          }
        }
      }
      // Per-pitcher ABS shadow mult: how dependent this pitcher is on borderline
      // called strikes. CSV source: SAVANT_PITCHER_ABS_CSV_URL (pitcher_id, abs_k_mult).
      // Falls back to ABS_PITCHER_K_LAMBDA_MULT config key (default 1 = neutral).
      const pitcherAbsMult = mlbGetAbsPitcherLambdaMult_(pitcherId);
      if (!isNaN(lamNum) && lamNum > 0 && pitcherAbsMult != null) {
        const pm = Math.max(0.85, Math.min(1.08, pitcherAbsMult));
        lamNum = Math.round(lamNum * pm * 100) / 100;
      } else {
        const absPRaw = parseFloat(
          String(cfg['ABS_PITCHER_K_LAMBDA_MULT'] != null ? cfg['ABS_PITCHER_K_LAMBDA_MULT'] : '1').trim(), 10
        );
        if (!isNaN(lamNum) && lamNum > 0 && !isNaN(absPRaw) && absPRaw > 0) {
          const apm = Math.max(0.90, Math.min(1.08, absPRaw));
          if (Math.abs(apm - 1) > 1e-6) lamNum = Math.round(lamNum * apm * 100) / 100;
        }
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

    const best = mlbPickBestSide_(evO, evU);
    const bestSide = best.side;
    const bestEv = best.ev;

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
      oppAbbr,
      oppKpaRaw === '' || oppKpaRaw == null ? '' : oppKpaRaw,
      oppKpaVsRaw === '' || oppKpaVsRaw == null ? '' : oppKpaVsRaw,
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
    sh.clearContents();
    sh.clearFormats();
  } else {
    sh = ss.insertSheet(MLB_PITCHER_K_CARD_TAB);
  }
  sh.setTabColor('#c62828');
  [72, 200, 52, 150, 56, 64, 64, 52, 52, 52, 52, 52, 52, 52, 52, 52, 64, 52, 140, 88, 140, 44, 56, 72, 72].forEach(function (w, i) {
    sh.setColumnWidth(i + 1, w);
  });

  sh.getRange(1, 1, 1, 25)
    .merge()
    .setValue(
      '🎰 Pitcher K card — λ: K9 blend × park × L/R × opp K% (vs-hand if present) × ABS × HP ump; EV naive. Sort: best_ev desc.'
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
    'opp_abbr',
    'opp_k_pa',
    'opp_k_pa_vs',
  ];
  sh.getRange(3, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight('bold')
    .setBackground('#e53935')
    .setFontColor('#ffffff');
  sh.setFrozenRows(3);

  if (out.length) {
    sh.getRange(4, 1, out.length, headers.length).setValues(out);
    try {
      ss.setNamedRange('MLB_PITCHER_K_CARD', sh.getRange(4, 1, out.length, headers.length));
    } catch (e) {}
  }

  ss.toast(out.length + ' rows · sorted by best_ev', 'Pitcher K card', 6);
}
