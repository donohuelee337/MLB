// ============================================================
// 🎰 Pitcher K card — Poisson stub + EV vs FanDuel (prototype)
// ============================================================
// Reads 📋 Pitcher_K_Queue. Model: λ = (K9_szn / 9) × proj_IP,
// proj_IP = clamp(mean depth from L3_IP/3, 4–7) or 5.5 if missing.
// P(Over) / P(Under) vs half-integer FD line; naive EV from American odds.
// ============================================================

const MLB_PITCHER_K_CARD_TAB = '🎰 Pitcher_K_Card';

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

/** Expected profit per $1 risked at this American price (decimal odds payout style). */
function mlbEvPerDollarRisked_(p, american) {
  const o = parseFloat(american, 10);
  if (isNaN(o) || isNaN(p)) return '';
  let winUnits;
  if (o > 0) winUnits = o / 100;
  else winUnits = 100 / Math.abs(o);
  return Math.round((p * winUnits - (1 - p)) * 1000) / 1000;
}

function mlbProjIpFromQueueRow_(l3ipRaw) {
  const x = parseFloat(l3ipRaw, 10);
  if (!isNaN(x) && x > 0) {
    const avg = x / 3;
    return Math.min(7, Math.max(4, Math.round(avg * 100) / 100));
  }
  return 5.5;
}

// ─── 🧪 k.v2 shadow helpers ───────────────────────────────────────────────
// v2 fixes two structural overstatements vs v1 for low-sample arms:
//   1) v1 trusts pitcher K9 from any sample (even 1 start). v2 regresses
//      pitcher K9 toward LEAGUE_PITCHING_K9 with weight = min(games/8, 1).
//   2) v1 divides L3_IP by 3 even when starts<3 then floors at 4 → a 1-start
//      / 3-IP arm gets projected for 4 IP. v2 divides by actual starts in L3
//      and floors at 3.
// Both helpers fall through to league defaults when sample is empty.
function mlbProjIpFromQueueRowV2_(l3ipRaw, gamesRaw) {
  const games = parseInt(gamesRaw, 10);
  const x = parseFloat(l3ipRaw, 10);
  const startsInL3 = !isNaN(games) && games > 0 ? Math.max(1, Math.min(3, games)) : 3;
  if (!isNaN(x) && x > 0) {
    const avg = x / startsInL3;
    return Math.min(7, Math.max(3, Math.round(avg * 100) / 100));
  }
  return 5.0;
}

function mlbEffectiveK9ForLambdaV2_(k9raw, l3kRaw, l3ipRaw, gamesRaw, cfg) {
  const leagueRaw = parseFloat(
    String(cfg && cfg['LEAGUE_PITCHING_K9'] != null ? cfg['LEAGUE_PITCHING_K9'] : '8.2').trim(),
    10
  );
  const leagueK9 = !isNaN(leagueRaw) && leagueRaw > 0 ? leagueRaw : 8.2;
  const pitcherK9 = mlbEffectiveK9ForLambda_(k9raw, l3kRaw, l3ipRaw, cfg);
  const games = parseInt(gamesRaw, 10);
  if (isNaN(pitcherK9) || pitcherK9 <= 0) return leagueK9;
  if (isNaN(games) || games <= 0) return leagueK9;
  // Ramp pitcher weight from 0 → 1 across [0, 8] starts.
  const w = Math.max(0, Math.min(1, games / 8));
  return Math.round((w * pitcherK9 + (1 - w) * leagueK9) * 100) / 100;
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
  const raw = q.getRange(4, 1, last, 20).getValues();
  const rows = []; // each: { data: [30 cols], hot: 'HOT'|'COLD'|'' }

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
    const hotCold = String(r[18] || '').toUpperCase();
    const gamesRaw = r[19];

    if (!String(pitcher || '').trim()) return;

    const k9eff = mlbEffectiveK9ForLambda_(k9raw, l3k, l3ip, cfg);
    const projIp = mlbProjIpFromQueueRow_(l3ip);
    // v2 baseline values (regressed K9 + true-per-start projIp). We apply the
    // SAME multiplier stack as v1 to keep the audit comparison clean.
    const k9effV2 = mlbEffectiveK9ForLambdaV2_(k9raw, l3k, l3ip, gamesRaw, cfg);
    const projIpV2 = mlbProjIpFromQueueRowV2_(l3ip, gamesRaw);
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

    // 🧪 v2 shadow lambda — apply v1's effective multiplier stack to v2 base.
    // mult = (v1 final λ) / (v1 base λ). When v1 has no model, mult defaults to 1.
    let lambdaV2 = '';
    if (!isNaN(k9effV2) && k9effV2 > 0) {
      const v2Base = (k9effV2 / 9) * projIpV2;
      const v1Base = !isNaN(k9eff) && k9eff > 0 ? (k9eff / 9) * projIp : NaN;
      const mult = !isNaN(v1Base) && v1Base > 0 && !isNaN(lamNum) && lamNum > 0 ? lamNum / v1Base : 1;
      lambdaV2 = Math.round(v2Base * mult * 100) / 100;
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

    rows.push({
      data: [
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
        hotCold,
        // 🧪 k.v2 audit cols (27..30). v1 cols 1..26 above are live.
        lambdaV2,
        gamesRaw === '' || gamesRaw == null ? '' : gamesRaw,
        !isNaN(k9effV2) ? k9effV2 : '',
        projIpV2,
      ],
      hot: hotCold,
    });
  });

  rows.sort(function (a, b) {
    const be = parseFloat(b.data[17], 10);
    const ae = parseFloat(a.data[17], 10);
    if (isNaN(be) && isNaN(ae)) return 0;
    if (isNaN(be)) return -1;
    if (isNaN(ae)) return 1;
    return be - ae;
  });
  const out = rows.map(function (r) { return r.data; });
  const sortedHot = rows.map(function (r) { return r.hot; });

  let sh = ss.getSheetByName(MLB_PITCHER_K_CARD_TAB);
  if (sh) {
    // Break apart any lingering merges from prior layouts before clearing —
    // otherwise a re-run can hit "Those columns are out of bounds" when the
    // old banner merge spans cols that no longer match the new layout.
    // Capped at maxColumns so the guard itself can't throw out-of-bounds.
    const cr = Math.max(sh.getLastRow(), 3);
    const cc = Math.min(Math.max(sh.getLastColumn(), 26), sh.getMaxColumns());
    try { sh.getRange(1, 1, cr, cc).breakApart(); } catch (e) {}
    sh.clearContents();
    sh.clearFormats();
  } else {
    sh = ss.insertSheet(MLB_PITCHER_K_CARD_TAB);
  }
  sh.setTabColor('#c62828');
  // 🧪 k.v2 audit cols 27..30 push total width past the default 26-col sheet
  // size — expand FIRST or setColumnWidth(27..) throws and the writer leaves
  // the sheet empty.
  const NEED_COLS_K_CARD = 30;
  if (sh.getMaxColumns() < NEED_COLS_K_CARD) {
    sh.insertColumnsAfter(sh.getMaxColumns(), NEED_COLS_K_CARD - sh.getMaxColumns());
  }
  [72, 200, 52, 150, 56, 64, 64, 52, 52, 52, 52, 52, 52, 52, 52, 52, 64, 52, 140, 88, 140, 44, 56, 72, 72, 56, 64, 44, 56, 56].forEach(function (w, i) {
    sh.setColumnWidth(i + 1, w);
  });

  sh.getRange(1, 1, 1, 30)
    .merge()
    .setValue(
      '🎰 Pitcher K card — λ: K9 blend × park × L/R × opp K% (vs-hand if present) × ABS × HP ump; EV naive. Cols 27..30 = 🧪 k.v2 shadow (audit only). Sort: best_ev desc.'
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
    'hot_cold',
    'lambda_K_v2',
    'games',
    'k9_eff_v2',
    'projIP_v2',
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
    mlbApplyHotColdBorders_(sh, 4, sortedHot, headers.length);
  }

  ss.toast(out.length + ' rows · sorted by best_ev', 'Pitcher K card', 6);
}
