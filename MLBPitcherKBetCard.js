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
  const season = typeof mlbSlateSeasonYear_ === 'function' ? mlbSlateSeasonYear_(cfg) : new Date().getFullYear();
  if (typeof mlbStatcastEnsureLoaded_ === 'function') {
    mlbStatcastEnsureLoaded_(ss);
  }
  const q = ss.getSheetByName(MLB_PITCHER_K_QUEUE_TAB);
  if (!q || q.getLastRow() < 4) {
    safeAlert_('Pitcher K card', 'Run Pitcher K queue first.');
    return;
  }

  const last = q.getLastRow();
  // Data is rows 4..last → (last - 3) rows. Reading `last` rows from row 4
  // over-reads 3 phantom rows past the data (harmless today since blank-pitcher
  // rows are skipped below, but it risks an out-of-bounds read if the queue
  // ever fills to the grid edge).
  const raw = q.getRange(4, 1, last - 3, 20).getValues();
  const rows = []; // each: { data: [34 cols], hot: 'HOT'|'COLD'|'' }

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
    const k9effV2 = mlbEffectiveK9ForLambdaV2_(k9raw, l3k, l3ip, gamesRaw, cfg);
    const projIpV2 = mlbProjIpFromQueueRowV2_(l3ip, gamesRaw);
    const oppKpaVs = parseFloat(String(oppKpaVsRaw != null ? oppKpaVsRaw : '').trim(), 10);
    const oppKpaAll = parseFloat(String(oppKpaRaw != null ? oppKpaRaw : '').trim(), 10);
    const usingVsHand = !isNaN(oppKpaVs) && oppKpaVs > 0;
    let lambdaDisp = '';
    let lamNum = NaN;
    let edge = '';
    const built = mlbBuildPitcherKLambda_({
      cfg: cfg,
      k9raw: k9raw,
      l3k: l3k,
      l3ip: l3ip,
      gamesRaw: gamesRaw,
      homeAbbr: mlbScheduleHomeAbbrForGamePk_(ss, gamePk),
      oppKVsHand: usingVsHand ? oppKpaVs : oppKpaAll,
      lineupWhiff:
        typeof mlbLineupWhiffAvgForGamePk_ === 'function'
          ? mlbLineupWhiffAvgForGamePk_(gamePk, oppAbbr, throws)
          : NaN,
    });
    if (!isNaN(built.lambda) && built.lambda > 0) {
      lamNum = built.lambda;
      // Live-only multipliers (not in walk-forward core until ablation moves them).
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
      // Re-apply the plausibility cap AFTER the live-only multipliers
      // (hand / Savant-ABS / ump). The core clamps to K_LAMBDA_MAX, but those
      // multipliers run here on top of it (up to ~1.39× combined), so without
      // this a data-error row capped at the max could be pushed back over it.
      // Same key + semantics as MLBPitcherKLambdaCore.js (0/blank = off).
      const lamMaxCard = parseFloat(
        String(cfg['K_LAMBDA_MAX'] != null ? cfg['K_LAMBDA_MAX'] : '13')
      );
      if (!isNaN(lamMaxCard) && lamMaxCard > 0 && lamNum > lamMaxCard) {
        lamNum = lamMaxCard;
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

    // 🧪 v3.bf shadow lambda — K% × league PA/IP × proj_IP. Strips PA-per-IP
    // inflation from walk-prone arms (high-walk SPs face more BF/IP, which
    // K/9 reads as "more K opportunity" even when K skill is league-average).
    // Uses shared pitcher season fetch (BF, K) — no extra API call.
    let lambdaV3Bf = '';
    let seasonBf = '';
    let kPerPa = '';
    let projPaBf = '';
    const pidNum = parseInt(pitcherId, 10);
    if (pidNum && typeof mlbSharedFetchPitcherSeasonPitching_ === 'function') {
      const sznStat = mlbSharedFetchPitcherSeasonPitching_(pidNum, season);
      if (!isNaN(sznStat.k) && !isNaN(sznStat.bf) && sznStat.bf > 0) {
        seasonBf = sznStat.bf;
        const kpa = sznStat.k / sznStat.bf;
        kPerPa = Math.round(kpa * 1000) / 1000;
        const leaguePaPerIpRaw = parseFloat(
          String(cfg['LEAGUE_PA_PER_IP'] != null ? cfg['LEAGUE_PA_PER_IP'] : '4.3').trim(),
          10
        );
        const lgPaIp = !isNaN(leaguePaPerIpRaw) && leaguePaPerIpRaw > 0 ? leaguePaPerIpRaw : 4.3;
        const projPa = projIp * lgPaIp;
        projPaBf = Math.round(projPa * 100) / 100;
        const v3Base = kpa * projPa;
        const v1Base = !isNaN(k9eff) && k9eff > 0 ? (k9eff / 9) * projIp : NaN;
        // Apply v1's effective multiplier stack so the comparison is rate-only.
        const multV3 = !isNaN(v1Base) && v1Base > 0 && !isNaN(lamNum) && lamNum > 0 ? lamNum / v1Base : 1;
        lambdaV3Bf = Math.round(v3Base * multV3 * 100) / 100;
      }
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

    const pick = (typeof mlbChooseSideOutcomeFirst_ === 'function')
      ? mlbChooseSideOutcomeFirst_('Over', pOver, evO, 'Under', pUnder, evU, cfg)
      : { side: '', p: NaN, ev: NaN, rank: -1e9 };
    const board = typeof mlbKPickOnBoard_ === 'function'
      ? mlbKPickOnBoard_(lamNum, lineNum)
      : { onBoard: true };
    let pickSide = pick.side;
    let pickEv = isNaN(pick.ev) ? '' : Math.round(pick.ev * 1000) / 1000;
    let sortKey = pick.rank;
    if (hasModel && !board.onBoard) {
      pickSide = '';
      pickEv = '';
      sortKey = -1e9;
    }

    let flags = mlbFlagsCard_(inj, notes, hasModel);
    if (hasModel && !board.onBoard) {
      flags = flags ? flags + '; agree_fd' : 'agree_fd';
    }

    let pitchTeam = '';
    if (pidNum && typeof mlbSharedFetchBatterTeamAbbr_ === 'function') {
      pitchTeam = mlbCanonicalTeamAbbr_(mlbSharedFetchBatterTeamAbbr_(pidNum)) || '';
    }

    let scEv = '';
    let scLa = '';
    let scXba = '';
    let scLink = '';
    if (pidNum && typeof mlbStatcastGetPitcherProfile_ === 'function') {
      const scProf = mlbStatcastGetPitcherProfile_(pidNum);
      if (scProf) {
        scEv = mlbStatcastFormatEvLa_(scProf.ev);
        scLa = mlbStatcastFormatEvLa_(scProf.la);
        scXba = mlbStatcastFormatRate_(scProf.xba);
      }
      if (typeof mlbStatcastSavantPlayerUrl_ === 'function') {
        scLink = mlbStatcastSavantPlayerUrl_(pidNum, 'pitcher');
      }
    }

    rows.push({
      data: [
        gamePk,
        matchup,
        side,
        pitcher,
        pitchTeam,
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
        pickSide,
        pickEv,
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
        // 🧪 k.v3.bf audit cols (31..34). K% × league PA/IP shadow.
        lambdaV3Bf,
        seasonBf,
        kPerPa,
        projPaBf,
        scEv,
        scLa,
        scXba,
        scLink,
      ],
      hot: hotCold,
      sortKey: sortKey,
      offBoard: hasModel && !board.onBoard,
    });
  });

  rows.sort(function (a, b) {
    const be = parseFloat(b.sortKey, 10);
    const ae = parseFloat(a.sortKey, 10);
    if (isNaN(be) && isNaN(ae)) return 0;
    if (isNaN(be)) return -1;
    if (isNaN(ae)) return 1;
    return be - ae;
  });
  const out = rows.map(function (r) { return r.data; });
  const sortedHot = rows.map(function (r) { return r.hot; });
  const sortedOffBoard = rows.map(function (r) { return r.offBoard; });

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
  // 🧪 k.v2 + k.v3.bf audit cols 27..34 push total width past the default
  // 26-col sheet — expand FIRST or setColumnWidth(27..) throws and the
  // writer leaves the sheet empty (auto-memory: apps_script_column_expansion).
  const NEED_COLS_K_CARD = 39;
  if (sh.getMaxColumns() < NEED_COLS_K_CARD) {
    sh.insertColumnsAfter(sh.getMaxColumns(), NEED_COLS_K_CARD - sh.getMaxColumns());
  }
  [72, 200, 52, 150, 44, 56, 64, 64, 52, 52, 52, 52, 52, 52, 52, 52, 52, 64, 52, 140, 88, 140, 44, 56, 72, 72, 56, 64, 44, 56, 56, 64, 56, 56, 64, 52, 52, 52, 200].forEach(
    function (w, i) {
      sh.setColumnWidth(i + 1, w);
    }
  );

  sh.getRange(1, 1, 1, NEED_COLS_K_CARD)
    .merge()
    .setValue(
      '🎰 Pitcher K card — proj_K from K9 blend × park × L/R × opp K% × ABS × HP ump. ' +
      'pick = side we prefer when |proj_K − line| ≥ 0.5 (else agree_fd — gray row, no pick). ' +
      'Cols 27..30 = 🧪 k.v2 · 31..34 = 🧪 k.v3.bf · 35..38 = Statcast contact allowed (EV/LA/xBA). Sort: pick confidence desc.'
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
    'pitch_team',
    'fd_k_line',
    'fd_over',
    'fd_under',
    'proj_IP',
    'proj_K',
    'edge_vs_line',
    'p_over',
    'p_under',
    'implied_over',
    'implied_under',
    'ev_over_$1',
    'ev_under_$1',
    'pick',
    'pick_ev_$1',
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
    'lambda_K_v3_bf',
    'season_bf',
    'k_per_pa',
    'proj_pa_bf',
    'sc_ev_allow',
    'sc_la_allow',
    'sc_xba_allow',
    'savant_link',
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
    if (typeof mlbApplyPropCardFormatting_ === 'function') {
      mlbApplyPropCardFormatting_(sh, out, headers, {
        hotColdFlags: sortedHot,
        offBoardFlags: sortedOffBoard,
        startRow: 4,
        headerRow: 3,
        skipHeaderNotes: true,
        cols: {
          line: 'fd_k_line',
          proj: 'proj_K',
          pick: 'pick',
          pickEv: 'pick_ev_$1',
          player: 'pitcher',
          team: 'pitch_team',
          pOver: 'p_over',
          pUnder: 'p_under',
          batterId: 'pitcher_id',
        },
      });
    } else {
      mlbApplyHotColdBorders_(sh, 4, sortedHot, headers.length);
      if (typeof mlbApplyOffBoardRowShading_ === 'function') {
        mlbApplyOffBoardRowShading_(sh, 4, sortedOffBoard, headers.length);
      }
    }
  }

  ss.toast(out.length + ' rows · sorted by pick confidence', 'Pitcher K card', 6);
}
