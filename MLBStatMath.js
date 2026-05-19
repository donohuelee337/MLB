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

/** Expected profit per $1 risked at this American price (decimal odds payout style). */
function mlbEvPerDollarRisked_(p, american) {
  const o = parseFloat(american, 10);
  if (isNaN(o) || isNaN(p)) return '';
  let winUnits;
  if (o > 0) winUnits = o / 100;
  else winUnits = 100 / Math.abs(o);
  return Math.round((p * winUnits - (1 - p)) * 1000) / 1000;
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
