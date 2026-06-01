// ============================================================
// MLBStatMath — shared distribution + odds helpers (Apps Script)
// ============================================================
// Used by 🎰 Pitcher_K_Card and ⚡ Sim_Pitcher_K. Keep in sync
// with docs/2026-04-11-mlb-pitcher-k-pipeline-design.md.
// ============================================================

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

/**
 * Two-way no-vig (fair) probabilities. Takes the two single-side implied
 * probabilities (which each include the book's hold) and normalizes them to
 * sum to 1, removing the vig proportionally (multiplicative method).
 *
 * The raw single-side implied is biased HIGH by ~half the hold, so comparing a
 * model probability to it understates the real edge. fairSide is the honest
 * "what the market thinks" number to measure edge against.
 *
 * @param {number|string} impliedSide  implied prob of the side we're pricing
 * @param {number|string} impliedOpp   implied prob of the opposite side
 * @returns {{fairSide:(number|''), fairOpp:(number|''), hold:(number|'')}}
 */
function mlbDevigTwoWay_(impliedSide, impliedOpp) {
  const a = parseFloat(impliedSide, 10);
  const b = parseFloat(impliedOpp, 10);
  if (isNaN(a) || isNaN(b) || a <= 0 || b <= 0) return { fairSide: '', fairOpp: '', hold: '' };
  const s = a + b;
  if (s <= 0) return { fairSide: '', fairOpp: '', hold: '' };
  return {
    fairSide: Math.round((a / s) * 1000) / 1000,
    fairOpp: Math.round((b / s) * 1000) / 1000,
    hold: Math.round((s - 1) * 1000) / 1000,
  };
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
 * Global betting philosophy. 'outcome' (default) = back the side we think
 * actually happens (higher model win probability) and rank by confidence —
 * bankroll is finite, so being correct beats chasing theoretical value.
 * 'ev' = legacy: back the higher positive-EV side and rank by EV.
 */
function mlbPickBy_(cfg) {
  const m = String(cfg && cfg['PICK_BY'] != null ? cfg['PICK_BY'] : 'outcome')
    .trim()
    .toLowerCase();
  return m === 'ev' ? 'ev' : 'outcome';
}

/**
 * Choose which of two sides (A vs B) to back for any market.
 * In 'outcome' mode → the side with the higher model probability (EV kept for
 * reference). In 'ev' mode → the higher EV side (legacy). Empty/'' inputs are
 * treated as missing.
 * @param {string} labelA  e.g. 'Over' | 'NRFI'
 * @param {number|string} pA  model win prob for side A
 * @param {number|string} evA EV/$1 for side A
 * @param {string} labelB  e.g. 'Under' | 'YRFI'
 * @param {number|string} pB
 * @param {number|string} evB
 * @param {Object} cfg
 * @returns {{side:string, p:number, ev:number, rank:number}} rank = sort key
 *   (win prob in outcome mode, EV in ev mode); side '' when nothing to pick.
 */
function mlbChooseSideOutcomeFirst_(labelA, pA, evA, labelB, pB, evB, cfg) {
  const paN = pA === '' || pA == null ? NaN : parseFloat(pA);
  const pbN = pB === '' || pB == null ? NaN : parseFloat(pB);
  const eaN = evA === '' || evA == null ? NaN : parseFloat(evA);
  const ebN = evB === '' || evB == null ? NaN : parseFloat(evB);
  const mode = mlbPickBy_(cfg);

  let side = '';
  let p = NaN;
  let ev = NaN;
  if (mode === 'ev') {
    if (!isNaN(eaN) && !isNaN(ebN)) {
      if (eaN >= ebN) { side = labelA; p = paN; ev = eaN; }
      else { side = labelB; p = pbN; ev = ebN; }
    } else if (!isNaN(eaN)) { side = labelA; p = paN; ev = eaN; }
    else if (!isNaN(ebN)) { side = labelB; p = pbN; ev = ebN; }
  } else {
    if (!isNaN(paN) || !isNaN(pbN)) {
      if (isNaN(pbN) || (!isNaN(paN) && paN >= pbN)) { side = labelA; p = paN; ev = eaN; }
      else { side = labelB; p = pbN; ev = ebN; }
    }
  }
  const rank = mode === 'ev' ? (isNaN(ev) ? -1e9 : ev) : (isNaN(p) ? -1e9 : p);
  return { side: side, p: p, ev: ev, rank: rank };
}

/** Outcome-mode confidence floor for snapshotting a pick (global default). */
function mlbPickMinConfidence_(cfg) {
  const x = parseFloat(String(cfg && cfg['PICK_MIN_CONFIDENCE'] != null ? cfg['PICK_MIN_CONFIDENCE'] : '0.55').trim());
  return isNaN(x) ? 0.55 : x;
}

/** Outcome-mode EV price guardrail (negative-tolerant) for snapshotting. */
function mlbPickMinEvGuard_(cfg) {
  const x = parseFloat(String(cfg && cfg['PICK_MIN_EV'] != null ? cfg['PICK_MIN_EV'] : '-0.05').trim());
  return isNaN(x) ? -0.05 : x;
}

/** Half-strikeout band: |proj_K − line| below this → we agree with FD (no pick). */
const MLB_K_AGREE_FD_BAND = 0.5;

/** Same half-point bracket for batter H/TB props (0.5 / 1.5 / 2.5 lines). */
const MLB_H_AGREE_FD_BAND = 0.5;

/** Signed projection minus FanDuel K line (same units as edge_vs_line). */
function mlbKProjLineEdge_(projK, line) {
  const p = parseFloat(projK, 10);
  const l = parseFloat(line, 10);
  if (isNaN(p) || isNaN(l)) return NaN;
  return Math.round((p - l) * 100) / 100;
}

/**
 * K prop pick eligibility from projection vs line. We only take a side when
 * proj is at least half a K away from the line (the next half-point bracket).
 * Inside that band we treat it as agreement with FanDuel — off the board.
 * @returns {{onBoard:boolean, lean:string, edge:number|string}}
 */
function mlbKPickOnBoard_(projK, line, minEdge) {
  const band = minEdge != null && minEdge > 0 ? minEdge : MLB_K_AGREE_FD_BAND;
  const edge = mlbKProjLineEdge_(projK, line);
  if (isNaN(edge)) return { onBoard: false, lean: '', edge: '' };
  if (Math.abs(edge) < band) return { onBoard: false, lean: '', edge: edge };
  return {
    onBoard: true,
    lean: edge >= band ? 'Over' : 'Under',
    edge: edge,
  };
}

/** Batter hits (and similar half-point props) — same bracket as K. */
function mlbHitsPickOnBoard_(projH, line, minEdge) {
  const band = minEdge != null && minEdge > 0 ? minEdge : MLB_H_AGREE_FD_BAND;
  return mlbKPickOnBoard_(projH, line, band);
}

/** Light gray background on rows where we have no K pick (agree_fd band). */
function mlbApplyOffBoardRowShading_(sh, startRow, offBoardFlags, ncol, bgColor) {
  if (!sh || !offBoardFlags || !offBoardFlags.length) return;
  const nc = ncol || sh.getLastColumn();
  const bg = bgColor || '#f0f0f0';
  for (let i = 0; i < offBoardFlags.length; i++) {
    if (!offBoardFlags[i]) continue;
    sh.getRange(startRow + i, 1, 1, nc).setBackground(bg);
  }
}

function mlbBinomCoeff_(n, k) {
  if (k < 0 || k > n) return 0;
  if (k > n - k) k = n - k;
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return r;
}

/** P(X ≥ k) for Binomial(n, p); n is rounded to the nearest integer. */
function mlbBinomialPGeqK_(k, n, p) {
  const nInt = Math.round(n);
  if (k <= 0) return 1;
  if (p <= 0 || nInt <= 0) return 0;
  if (p >= 1) return 1;
  let pLess = 0;
  const q = 1 - p;
  for (let i = 0; i < k && i <= nInt; i++) {
    pLess += mlbBinomCoeff_(nInt, i) * Math.pow(p, i) * Math.pow(q, nInt - i);
  }
  return Math.max(0, Math.min(1, 1 - pLess));
}

/** P(X ≤ k) for Binomial(n, p). */
function mlbBinomialPLeqK_(k, n, p) {
  return 1 - mlbBinomialPGeqK_(k + 1, n, p);
}

/** Orange (HOT) and blue (COLD) medium-thickness row borders for bet cards. */
const MLB_HOT_BORDER_COLOR = '#f97316';
const MLB_COLD_BORDER_COLOR = '#1d4ed8';

/**
 * Apply HOT/COLD borders to bet-card body rows.
 *   sh       : sheet
 *   startRow : 1-based row index of the first data row (typically 4)
 *   flags    : parallel array, one entry per row, value 'HOT' | 'COLD' | ''
 *   ncol     : number of columns spanned by each row
 */
function mlbApplyHotColdBorders_(sh, startRow, flags, ncol) {
  if (!sh || !flags || !flags.length) return;
  const style = SpreadsheetApp.BorderStyle.SOLID_MEDIUM;
  for (let i = 0; i < flags.length; i++) {
    const f = String(flags[i] || '').toUpperCase();
    if (f !== 'HOT' && f !== 'COLD') continue;
    const color = f === 'HOT' ? MLB_HOT_BORDER_COLOR : MLB_COLD_BORDER_COLOR;
    sh.getRange(startRow + i, 1, 1, ncol).setBorder(
      true, true, true, true, false, false, color, style
    );
  }
}

/**
 * Hot/Cold streak flag.
 * Compares a recent-window mean to the player's season mean.
 *   recent ≥ (1 + threshold) × season → 'HOT'
 *   recent ≤ (1 - threshold) × season → 'COLD'
 *   otherwise → ''
 * Requires both inputs numeric and season > 0. Default threshold = 0.15 (±15%).
 */
function mlbHotColdFlag_(recentAvg, seasonAvg, threshold) {
  const r = parseFloat(recentAvg, 10);
  const s = parseFloat(seasonAvg, 10);
  if (isNaN(r) || isNaN(s) || s <= 0) return '';
  const t = typeof threshold === 'number' && threshold > 0 ? threshold : 0.15;
  const ratio = r / s;
  if (ratio >= 1 + t) return 'HOT';
  if (ratio <= 1 - t) return 'COLD';
  return '';
}

/** Config truthy — default TRUE when key missing (PROMO_EXCLUDE_COLD). */
function mlbPromoExcludeColdEnabled_(cfg) {
  const raw = cfg && cfg['PROMO_EXCLUDE_COLD'] != null ? cfg['PROMO_EXCLUDE_COLD'] : 'TRUE';
  const v = String(raw).trim().toUpperCase();
  return v !== 'FALSE' && v !== '0' && v !== 'NO' && v !== 'OFF';
}

/**
 * Precomputed HOT/COLD by batter_id from 🧪 Batter_Hits_Card_v2-full and
 * 📋 Batter_Hits_Queue — same source as 🃏 MLB_Bet_Card borders.
 * @returns {Object<string, string>} id → 'HOT'|'COLD'
 */
function mlbBuildBatterHotColdMap_(ss) {
  const map = {};
  if (!ss) return map;

  function put(id, flag) {
    const key = String(parseInt(id, 10) || '');
    if (!key) return;
    const f = String(flag || '').trim().toUpperCase();
    if (f === 'HOT' || f === 'COLD') map[key] = f;
  }

  const v2Tab =
    typeof MLB_BATTER_HITS_V2_CARD_TAB !== 'undefined'
      ? MLB_BATTER_HITS_V2_CARD_TAB
      : '🧪 Batter_Hits_Card_v2-full';
  const v2 = ss.getSheetByName(v2Tab);
  if (v2 && v2.getLastRow() >= 4) {
    const nRows = v2.getLastRow() - 3;
    const data = v2.getRange(4, 1, nRows, 34).getValues();
    for (let i = 0; i < data.length; i++) {
      put(data[i][17], data[i][33]);
    }
  }

  const qTab =
    typeof MLB_BATTER_HITS_QUEUE_TAB !== 'undefined'
      ? MLB_BATTER_HITS_QUEUE_TAB
      : '📋 Batter_Hits_Queue';
  const q = ss.getSheetByName(qTab);
  if (q && q.getLastRow() >= 4) {
    const nRows = q.getLastRow() - 3;
    const data = q.getRange(4, 1, nRows, 16).getValues();
    for (let i = 0; i < data.length; i++) {
      const key = String(parseInt(data[i][3], 10) || '');
      if (!key || map[key]) continue;
      put(data[i][3], data[i][15]);
    }
  }

  return map;
}

/**
 * Hits hot/cold (L5 H/game vs season) — same semantics as 🃏 bet-card borders.
 * @returns {'HOT'|'COLD'|''}
 */
function mlbBatterHitsHotColdFlag_(batterId, season, hotColdMap) {
  const id = parseInt(batterId, 10);
  if (!id) return '';
  const key = String(id);
  if (hotColdMap && hotColdMap[key]) {
    return hotColdMap[key];
  }
  if (typeof mlbHittingHitsSummary_ !== 'function') return '';
  try {
    return String((mlbHittingHitsSummary_(id, season) || {}).hotCold || '').trim().toUpperCase();
  } catch (e) {
    return '';
  }
}

/**
 * Drop COLD batters from promo candidate pools (Streak / HR / GS).
 * @param {string} [hotColdCached] optional precomputed flag from hits v2 card
 */
function mlbPromoDropColdBatter_(batterId, season, cfg, hotColdCached) {
  if (!mlbPromoExcludeColdEnabled_(cfg)) return false;
  const cached = String(hotColdCached || '').trim().toUpperCase();
  const flag = cached || mlbBatterHitsHotColdFlag_(batterId, season);
  return flag === 'COLD';
}
