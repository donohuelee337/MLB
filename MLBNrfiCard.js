// ============================================================
// 🌅 NRFI card — Poisson 1st-inning runs + EV vs FanDuel
// ============================================================
// Reads 📋 NRFI_Queue. Model (independent half-innings):
//   λ_top  = LEAGUE_RUNS_1ST_HALF × (home_SP_FIP / LEAGUE_FIP) × (away_RPG / LEAGUE_RPG)
//   λ_bot  = LEAGUE_RUNS_1ST_HALF × (away_SP_FIP / LEAGUE_FIP) × (home_RPG / LEAGUE_RPG)
// FIP regresses to LEAGUE_FIP across 0→8 starts (same as 💧 ER card).
// P(NRFI) = exp(−(λ_top + λ_bot)); P(YRFI) = 1 − P(NRFI).
// Lineup top-3 confirmed → NRFI_LINEUP_MULT on offense side (default 1.02).
// Both λ halves are scaled by the home park run environment (NRFI_PARK_RUN).
// ============================================================

const MLB_NRFI_CARD_TAB = '🌅 NRFI_Card';

function mlbNrfiLeagueRunsFirstHalf_(cfg) {
  const raw = parseFloat(String(cfg && cfg['LEAGUE_RUNS_1ST_HALF'] != null ? cfg['LEAGUE_RUNS_1ST_HALF'] : '0.30').trim(), 10);
  return !isNaN(raw) && raw > 0 ? raw : 0.3;
}

function mlbNrfiLeagueRunsPerGame_(cfg) {
  const raw = parseFloat(
    String(cfg && cfg['LEAGUE_RUNS_PER_GAME'] != null ? cfg['LEAGUE_RUNS_PER_GAME'] : '4.50').trim(),
    10
  );
  return !isNaN(raw) && raw > 0 ? raw : 4.5;
}

function mlbNrfiLineupMult_(lineupTop3, cfg) {
  const confirmed = String(lineupTop3 || '').trim().toUpperCase() === 'Y';
  const raw = parseFloat(
    String(cfg && cfg['NRFI_LINEUP_MULT'] != null ? cfg['NRFI_LINEUP_MULT'] : '1.02').trim(),
    10
  );
  const mult = !isNaN(raw) && raw > 0 ? raw : 1.02;
  return confirmed ? mult : 1;
}

function mlbNrfiLambdaHalf_(spFip, spGames, oppRpg, lineupMult, cfg) {
  const leagueHalf = mlbNrfiLeagueRunsFirstHalf_(cfg);
  const leagueRpg = mlbNrfiLeagueRunsPerGame_(cfg);
  const leagueFipRaw = parseFloat(String(cfg && cfg['LEAGUE_FIP'] != null ? cfg['LEAGUE_FIP'] : '4.20').trim(), 10);
  const leagueFip = !isNaN(leagueFipRaw) && leagueFipRaw > 0 ? leagueFipRaw : 4.2;

  const effFip =
    typeof mlbEffectiveFipForLambda_ === 'function'
      ? mlbEffectiveFipForLambda_(spFip, spGames, cfg)
      : parseFloat(String(spFip), 10);

  let spMult = 1;
  if (!isNaN(effFip) && effFip > 0) {
    spMult = Math.max(0.55, Math.min(1.75, effFip / leagueFip));
  }

  let offMult = 1;
  const rpg = parseFloat(String(oppRpg), 10);
  if (!isNaN(rpg) && rpg > 0) {
    offMult = Math.max(0.65, Math.min(1.45, (rpg / leagueRpg) * lineupMult));
  }

  return Math.round(leagueHalf * spMult * offMult * 1000) / 1000;
}

/**
 * Park run-environment multiplier for 1st-inning λ (applies to both halves —
 * same park). Uses the park hits factor as a run proxy, dampened by
 * NRFI_PARK_RUN_STRENGTH (runs are less sensitive than raw hits). Hitter parks
 * (Coors) → higher λ → more YRFI; pitcher parks the opposite. Neutral 1.0 when
 * off/unknown.
 * @returns {number} multiplier in [0.9, 1.12]
 */
function mlbNrfiParkRunMult_(homeAbbr, cfg) {
  const on = String(cfg && cfg['NRFI_PARK_RUN'] != null ? cfg['NRFI_PARK_RUN'] : 'Y')
    .trim()
    .toUpperCase();
  if (!(on === 'Y' || on === 'TRUE' || on === '1')) return 1;
  if (typeof mlbParkHitsLambdaMultForHomeAbbr_ !== 'function') return 1;
  const hitsMult = mlbParkHitsLambdaMultForHomeAbbr_(homeAbbr);
  if (isNaN(hitsMult) || hitsMult <= 0) return 1;
  let s = parseFloat(
    String(cfg && cfg['NRFI_PARK_RUN_STRENGTH'] != null ? cfg['NRFI_PARK_RUN_STRENGTH'] : '0.5').trim(),
    10
  );
  if (isNaN(s) || s < 0) s = 0.5;
  return Math.max(0.9, Math.min(1.12, 1 + (hitsMult - 1) * s));
}

/** 'outcome' (default) = pick the most-likely side; 'ev' = legacy highest-EV. */
function mlbNrfiPickBy_(cfg) {
  const m = String(cfg && cfg['NRFI_PICK_BY'] != null ? cfg['NRFI_PICK_BY'] : 'outcome')
    .trim()
    .toLowerCase();
  return m === 'ev' ? 'ev' : 'outcome';
}

/**
 * Choose which side to back. Bankroll is finite, so being correct beats chasing
 * value: in 'outcome' mode we back the side with the higher MODEL probability
 * (the side we think actually happens) and treat EV only as a price guardrail.
 * In legacy 'ev' mode we back the higher positive-EV side.
 * @returns {{side:string, p:number, ev:number, rank:number}} rank = sort key
 *   (win prob in outcome mode, EV in ev mode); side '' when no model.
 */
function mlbNrfiChooseSide_(pNrfi, pYrfi, evN, evY, cfg) {
  const pN = pNrfi === '' || pNrfi == null ? NaN : parseFloat(pNrfi);
  const pY = pYrfi === '' || pYrfi == null ? NaN : parseFloat(pYrfi);
  const eN = evN === '' || evN == null ? NaN : parseFloat(evN);
  const eY = evY === '' || evY == null ? NaN : parseFloat(evY);
  const mode = mlbNrfiPickBy_(cfg);

  let side = '';
  let p = NaN;
  let ev = NaN;
  if (mode === 'ev') {
    if (!isNaN(eN) && !isNaN(eY)) {
      if (eN >= eY) { side = 'NRFI'; p = pN; ev = eN; }
      else { side = 'YRFI'; p = pY; ev = eY; }
    } else if (!isNaN(eN)) { side = 'NRFI'; p = pN; ev = eN; }
    else if (!isNaN(eY)) { side = 'YRFI'; p = pY; ev = eY; }
  } else {
    if (!isNaN(pN) || !isNaN(pY)) {
      if (isNaN(pY) || (!isNaN(pN) && pN >= pY)) { side = 'NRFI'; p = pN; ev = eN; }
      else { side = 'YRFI'; p = pY; ev = eY; }
    }
  }
  const rank = mode === 'ev' ? (isNaN(ev) ? -1e9 : ev) : (isNaN(p) ? -1e9 : p);
  return { side: side, p: p, ev: ev, rank: rank };
}

/**
 * Is a chosen side actionable? Confidence floor (NRFI_MIN_CONFIDENCE) is the
 * "pick winners" gate; EV floor (NRFI_PICK_MIN_EV, negative-tolerant) only
 * blocks egregiously bad prices. In legacy 'ev' mode, falls back to the EV
 * snapshot floor.
 */
function mlbNrfiPickEligible_(sel, cfg) {
  if (!sel || !sel.side) return false;
  if (mlbNrfiPickBy_(cfg) === 'ev') {
    const minEvLegacy = parseFloat(
      String(cfg && cfg['NRFI_SNAPSHOT_MIN_EV'] != null ? cfg['NRFI_SNAPSHOT_MIN_EV'] : '0.03').trim()
    );
    const cut = isNaN(minEvLegacy) ? 0.03 : minEvLegacy;
    return !isNaN(sel.ev) && sel.ev >= cut;
  }
  let minConf = parseFloat(
    String(cfg && cfg['NRFI_MIN_CONFIDENCE'] != null ? cfg['NRFI_MIN_CONFIDENCE'] : '0.58').trim()
  );
  if (isNaN(minConf)) minConf = 0.58;
  let minEv = parseFloat(
    String(cfg && cfg['NRFI_PICK_MIN_EV'] != null ? cfg['NRFI_PICK_MIN_EV'] : '-0.05').trim()
  );
  if (isNaN(minEv)) minEv = -0.05;
  if (isNaN(sel.p) || sel.p < minConf) return false;
  if (isNaN(sel.ev)) return false; // no posted price → can't bet it
  if (sel.ev < minEv) return false;
  return true;
}

function mlbNrfiProbabilities_(lambdaTop, lambdaBot) {
  const lt = parseFloat(String(lambdaTop), 10);
  const lb = parseFloat(String(lambdaBot), 10);
  if (isNaN(lt) || isNaN(lb) || lt < 0 || lb < 0) return { pNrfi: '', pYrfi: '', lambdaTotal: '' };
  const lambdaTotal = lt + lb;
  const pNrfi = Math.exp(-lambdaTotal);
  const pYrfi = 1 - pNrfi;
  return {
    pNrfi: Math.round(pNrfi * 1000) / 1000,
    pYrfi: Math.round(pYrfi * 1000) / 1000,
    lambdaTotal: Math.round(lambdaTotal * 1000) / 1000,
  };
}

function mlbFlagsNrfiCard_(notes, hasModel, lineupTop3) {
  const f = [];
  const n = String(notes || '');
  if (n.indexOf('fd_1st_miss') !== -1 || n.indexOf('no FD') !== -1) f.push('no_FD_line');
  if (n.indexOf('no_away_sp') !== -1 || n.indexOf('no_home_sp') !== -1) f.push('missing_SP');
  if (String(lineupTop3 || '').toUpperCase() !== 'Y') f.push('lineup_unconfirmed');
  if (!hasModel) f.push('no_model');
  return f.join('; ');
}

function refreshNrfiBetCard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig();
  const q = ss.getSheetByName(MLB_NRFI_QUEUE_TAB);
  if (!q || q.getLastRow() < 4) {
    safeAlert_('NRFI card', 'Run NRFI queue first.');
    return;
  }

  const last = q.getLastRow();
  const nRows = Math.max(0, last - 3);
  const raw = nRows > 0 ? q.getRange(4, 1, nRows, 23).getValues() : [];
  const rows = [];

  raw.forEach(function (r) {
    const gamePk = r[0];
    const matchup = r[1];
    if (!gamePk && !matchup) return;
    const startEt = r[2];
    const awaySp = r[5];
    const homeSp = r[6];
    const line = r[9];
    const fdYrfi = r[10];
    const fdNrfi = r[11];
    const awaySpFip = r[12];
    const homeSpFip = r[13];
    const awaySpGames = r[16];
    const homeSpGames = r[17];
    const awayRpg = r[18];
    const homeRpg = r[19];
    const lineupTop3 = r[20];
    const notes = r[21];
    const hpUmp = String(r[22] || '').trim();

    const lineupMult = mlbNrfiLineupMult_(lineupTop3, cfg);
    const parkRunMult = mlbNrfiParkRunMult_(r[4], cfg);
    const lambdaTop = Math.round(mlbNrfiLambdaHalf_(homeSpFip, homeSpGames, awayRpg, lineupMult, cfg) * parkRunMult * 1000) / 1000;
    const lambdaBot = Math.round(mlbNrfiLambdaHalf_(awaySpFip, awaySpGames, homeRpg, lineupMult, cfg) * parkRunMult * 1000) / 1000;
    const probs = mlbNrfiProbabilities_(lambdaTop, lambdaBot);

    const lineNum = parseFloat(line, 10);
    const hasModel = probs.pNrfi !== '' && !isNaN(lineNum);
    // Poisson on λ_total vs fd_line (usually 0.5) — same as direct P(NRFI)=exp(−λ_total).
    const pu = hasModel ? mlbProbOverUnderK_(lineNum, probs.lambdaTotal) : { pOver: '', pUnder: '' };
    const pYrfi = pu.pOver === '' ? probs.pYrfi : Math.round(pu.pOver * 1000) / 1000;
    const pNrfi = pu.pUnder === '' ? probs.pNrfi : Math.round(pu.pUnder * 1000) / 1000;

    const imY = mlbAmericanImplied_(fdYrfi);
    const imN = mlbAmericanImplied_(fdNrfi);
    const evY = pYrfi !== '' && fdYrfi !== '' ? mlbEvPerDollarRisked_(pYrfi, fdYrfi) : '';
    const evN = pNrfi !== '' && fdNrfi !== '' ? mlbEvPerDollarRisked_(pNrfi, fdNrfi) : '';

    // Outcome-first: back the side we think actually happens (higher win prob),
    // not the higher-EV side. EV is kept as a guardrail only (see snapshot).
    // Do NOT use the K/H agree_fd half-point band here — fd_line is always 0.5 while
    // λ_total is ~0.5–0.7, so |λ−line| < 0.5 would gray out the entire slate.
    const sel = mlbNrfiChooseSide_(pNrfi, pYrfi, evN, evY, cfg);
    const pick = sel.side;
    const pickEv = sel.side ? (isNaN(sel.ev) ? '' : Math.round(sel.ev * 1000) / 1000) : '';
    const sortKey = sel.rank;

    const flags = mlbFlagsNrfiCard_(notes, hasModel, lineupTop3);

    rows.push({
      sortKey: sortKey,
      data: [
        gamePk,
        matchup,
        startEt,
        awaySp,
        homeSp,
        line,
        fdYrfi,
        fdNrfi,
        lambdaTop,
        lambdaBot,
        probs.lambdaTotal,
        pNrfi,
        pYrfi,
        imN,
        imY,
        evN,
        evY,
        pick,
        pickEv,
        flags,
        hpUmp,
        lineupTop3,
      ],
    });
  });

  // Rank the card by our sort key: win probability (outcome mode) or EV (legacy
  // mode) — most-likely winners surface at the top, not the juiciest prices.
  rows.sort(function (a, b) {
    const be = typeof b.sortKey === 'number' ? b.sortKey : parseFloat(b.sortKey, 10);
    const ae = typeof a.sortKey === 'number' ? a.sortKey : parseFloat(a.sortKey, 10);
    const bv = isNaN(be) ? -1e9 : be;
    const av = isNaN(ae) ? -1e9 : ae;
    return bv - av;
  });

  const out = rows.map(function (r) {
    return r.data;
  });

  let sh = ss.getSheetByName(MLB_NRFI_CARD_TAB);
  if (sh) {
    const cr = Math.max(sh.getLastRow(), 3);
    const cc = Math.min(Math.max(sh.getLastColumn(), 22), sh.getMaxColumns());
    try {
      sh.getRange(1, 1, cr, cc).breakApart();
    } catch (e) {}
    sh.clearContents();
    sh.clearFormats();
  } else {
    sh = ss.insertSheet(MLB_NRFI_CARD_TAB);
  }
  sh.setTabColor('#ff6f00');

  const NEED_COLS = 22;
  if (sh.getMaxColumns() < NEED_COLS) {
    sh.insertColumnsAfter(sh.getMaxColumns(), NEED_COLS - sh.getMaxColumns());
  }
  [72, 220, 120, 130, 130, 48, 64, 64, 56, 56, 56, 52, 52, 52, 52, 52, 52, 56, 52, 160, 120, 56].forEach(function (w, i) {
    sh.setColumnWidth(i + 1, w);
  });

  sh.getRange(1, 1, 1, NEED_COLS)
    .merge()
    .setValue(
      '🌅 NRFI card — pick = higher win-prob side (NRFI_PICK_BY). Sort by pick confidence. Gray only when no model / missing FD.'
    )
    .setFontWeight('bold')
    .setBackground('#e65100')
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
    'fd_line',
    'fd_yrfi',
    'fd_nrfi',
    'lambda_top',
    'lambda_bot',
    'lambda_total',
    'p_nrfi',
    'p_yrfi',
    'implied_nrfi',
    'implied_yrfi',
    'ev_nrfi_$1',
    'ev_yrfi_$1',
    'pick',
    'pick_ev_$1',
    'flags',
    'hp_umpire',
    'lineup_top3',
  ];
  sh.getRange(3, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight('bold')
    .setBackground('#ff6f00')
    .setFontColor('#ffffff');
  if (typeof mlbApplyHeaderNotes_ === 'function') mlbApplyHeaderNotes_(sh, 3, headers);
  sh.setFrozenRows(3);

  if (out.length) {
    sh.getRange(4, 1, out.length, headers.length).setValues(out);
    try {
      ss.setNamedRange('MLB_NRFI_CARD', sh.getRange(4, 1, out.length, headers.length));
    } catch (e) {}
    if (typeof mlbApplyPropCardFormatting_ === 'function') {
      mlbApplyPropCardFormatting_(sh, out, headers, {
        startRow: 4,
        headerRow: 3,
        skipHeaderNotes: true,
        cols: {
          line: 'fd_line',
          proj: 'lambda_total',
          pick: 'pick',
          pickEv: 'pick_ev_$1',
          pOver: 'p_yrfi',
          pUnder: 'p_nrfi',
        },
      });
    }
  }

  ss.toast(out.length + ' games · sorted by pick confidence', 'NRFI card', 6);
}

function mlbActivateNrfiCardTab_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(MLB_NRFI_CARD_TAB);
  if (sh) sh.activate();
  else safeAlert_('NRFI card', 'Run "🌅 NRFI card only" first.');
}
