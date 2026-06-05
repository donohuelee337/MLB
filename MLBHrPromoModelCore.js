// ============================================================
// 📐 HR promo model — pure math (no UrlFetchApp)
// ============================================================
// Spec: docs/superpowers/specs/2026-05-12-batter-hr-promo-predictive-model-design.md
// ============================================================

/**
 * Default expected PA by batting order (1..9). Tune only via backtest + config override.
 * @returns {number[]}
 */
function mlbHrPromoDefaultPaTable_() {
  return [4.65, 4.55, 4.45, 4.35, 4.2, 4.05, 3.9, 3.75, 3.6];
}

/**
 * Parse optional JSON array of 9 positive numbers from config HR_PROMO_EXPECTED_PA_JSON.
 * @param {string} jsonRaw
 * @returns {number[]|null}
 */
function mlbHrPromoPaTableFromConfigJson_(jsonRaw) {
  const s = String(jsonRaw || '').trim();
  if (!s) return null;
  try {
    const arr = JSON.parse(s);
    if (!arr || arr.length !== 9) return null;
    const out = [];
    for (let i = 0; i < 9; i++) {
      const x = parseFloat(arr[i], 10);
      if (isNaN(x) || x <= 0) return null;
      out.push(x);
    }
    return out;
  } catch (e) {
    return null;
  }
}

/**
 * @param {number} slot1Based batting order 1..9
 * @param {number[]|null} paTable optional length-9 table
 * @returns {number}
 */
function mlbHrPromoExpectedPaForOrder_(slot1Based, paTable) {
  const t = paTable && paTable.length === 9 ? paTable : mlbHrPromoDefaultPaTable_();
  const slot = parseInt(slot1Based, 10);
  const idx = (isNaN(slot) ? 5 : Math.max(1, Math.min(9, slot))) - 1;
  return t[idx];
}

function mlbHrPromoClamp_(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

/**
 * Pitcher HR environment multiplier for the BATTER's HR projection:
 * spHr9 / leagueAvg, clamped. Multiplies into lambdaRaw alongside parkMult
 * (matching its semantics — higher = HR-friendlier environment for the batter).
 *
 * REGRESSION GUARD: until 2026-05-16 this returned lg/sp (inverted). That made
 * a 2.4 HR9 pitcher (HR-prone, batter-friendly) produce a 0.85 multiplier and
 * the batter's HR lambda went DOWN — opposite of the multiplicative-env model
 * the lambda formula expects. The model self-test below now asserts the
 * correct direction; don't flip it back without flipping the test too.
 *
 * Missing or non-positive inputs → 1 (neutral).
 * @param {number} spHr9
 * @param {number} leagueHr9
 * @param {number} lo
 * @param {number} hi
 */
function mlbHrPromoPitcherMultFromHrPer9_(spHr9, leagueHr9, lo, hi) {
  const sp = parseFloat(spHr9, 10);
  const lg = parseFloat(leagueHr9, 10);
  if (isNaN(sp) || sp <= 0 || isNaN(lg) || lg <= 0) return 1;
  return mlbHrPromoClamp_(sp / lg, lo, hi);
}

/**
 * Shrink observed HR/PA toward prior when PA is below minPa (linear weight pa/minPa).
 * @param {number} hr
 * @param {number} pa
 * @param {number} priorHrPerPa
 * @param {number} minPa
 */
function mlbHrPromoShrinkHrPerPa_(hr, pa, priorHrPerPa, minPa) {
  const m = parseInt(minPa, 10) || 30;
  const p = parseInt(pa, 10) || 0;
  const h = parseInt(hr, 10) || 0;
  const prior = parseFloat(priorHrPerPa, 10);
  const pr = !isNaN(prior) && prior >= 0 ? prior : 0.03;
  if (p <= 0) return pr;
  if (p >= m) return h / p;
  const w = p / m;
  return w * (h / p) + (1 - w) * pr;
}

/**
 * Blend season HR/PA with recent HR/PA (e.g. last 14 games as HR/game converted to /PA using expected PA).
 * @param {number} sznHrPerPa
 * @param {number} recentHrPerPa
 * @param {number} weightRecent 0..1
 */
function mlbHrPromoBlendHrPerPa_(sznHrPerPa, recentHrPerPa, weightRecent) {
  const w = Math.max(0, Math.min(1, parseFloat(weightRecent)));
  const a = parseFloat(sznHrPerPa, 10);
  const b = parseFloat(recentHrPerPa, 10);
  if (isNaN(a) || a < 0) return isNaN(b) || b < 0 ? 0 : b;
  if (isNaN(b) || b < 0) return a;
  return (1 - w) * a + w * b;
}

/** @param {number} lambda non-negative */
function mlbHrPromoPoissonPHrGe1_(lambda) {
  const L = Math.max(0, Number(lambda) || 0);
  return 1 - Math.exp(-L);
}

/**
 * Platt scaling on logit(p0). Coefficients from calibration fit.
 * @param {number} p0
 * @param {number} a
 * @param {number} b
 */
function mlbHrPromoPlattP_(p0, a, b) {
  const p = Math.max(1e-6, Math.min(1 - 1e-6, p0));
  const z = Math.log(p / (1 - p));
  const aa = parseFloat(a, 10);
  const bb = parseFloat(b, 10);
  if (isNaN(aa) || isNaN(bb)) return p0;
  const t = aa * z + bb;
  return 1 / (1 + Math.exp(-t));
}

/**
 * Run from Apps Script editor: must not throw.
 * @returns {string}
 */
function mlbHrPromoModelSelfTest_() {
  const t = mlbHrPromoDefaultPaTable_();
  if (t.length !== 9) throw new Error('PA table length');
  if (Math.abs(mlbHrPromoExpectedPaForOrder_(1, t) - 4.65) > 1e-9) throw new Error('slot1 PA');
  if (Math.abs(mlbHrPromoExpectedPaForOrder_(9, t) - 3.6) > 1e-9) throw new Error('slot9 PA');
  if (Math.abs(mlbHrPromoPitcherMultFromHrPer9_(1.2, 1.2, 0.85, 1.15) - 1) > 1e-9) throw new Error('pitcher neutral');
  // HR-prone pitcher (sp/lg = 2.0) should clamp to hi (1.15) so the batter's
  // HR lambda goes UP, not down. The previous test asserted 0.85 — that was
  // the inversion bug. See the doc on mlbHrPromoPitcherMultFromHrPer9_.
  if (Math.abs(mlbHrPromoPitcherMultFromHrPer9_(2.4, 1.2, 0.85, 1.15) - 1.15) > 1e-9) throw new Error('pitcher clamp high (HR-prone)');
  // HR-suppressing pitcher (sp/lg = 0.5) should clamp to lo (0.85).
  if (Math.abs(mlbHrPromoPitcherMultFromHrPer9_(0.6, 1.2, 0.85, 1.15) - 0.85) > 1e-9) throw new Error('pitcher clamp low (HR-suppressing)');
  if (Math.abs(mlbHrPromoShrinkHrPerPa_(5, 50, 0.03, 100) - 0.1) > 1e-9) throw new Error('shrink no shrink');
  const sh0 = mlbHrPromoShrinkHrPerPa_(0, 10, 0.03, 100);
  if (Math.abs(sh0 - 0.03) > 1e-9) throw new Error('shrink all prior');
  const p = mlbHrPromoPoissonPHrGe1_(1);
  if (Math.abs(p - (1 - Math.exp(-1))) > 1e-9) throw new Error('poisson');
  const json = '[4,4,4,4,4,4,4,4,4]';
  const custom = mlbHrPromoPaTableFromConfigJson_(json);
  if (!custom || Math.abs(mlbHrPromoExpectedPaForOrder_(2, custom) - 4) > 1e-9) throw new Error('config PA table');
  return 'mlbHrPromoModelSelfTest_: OK';
}
