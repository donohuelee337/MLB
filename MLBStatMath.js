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
