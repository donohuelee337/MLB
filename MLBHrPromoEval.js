// ============================================================
// 📈 HR promo — Platt calibration from 📋 MLB_Results_Log
// ============================================================
// Uses existing column "Model P(Win)" (index 9) = bet card model_prob for the play.
// Labels y: WIN on graded Over → 1; LOSS → 0 (skip PUSH/blank/PENDING).
// Market filter: column index 5 contains "home run" (case-insensitive).
// Requires ≥ HR_PROMO_CALIB_MIN_ROWS graded rows (Config).
// Promo-only picks not on 🃏 are out of scope until a dedicated logger exists.
// ============================================================

function mlbHrPromoLoadPlattFromScriptProperties_() {
  const p = PropertiesService.getScriptProperties();
  const a = parseFloat(String(p.getProperty('HR_PROMO_PLATT_A') || '').trim(), 10);
  const b = parseFloat(String(p.getProperty('HR_PROMO_PLATT_B') || '').trim(), 10);
  return { a: isNaN(a) ? null : a, b: isNaN(b) ? null : b };
}

function mlbHrPromoSavePlattToScriptProperties_(a, b) {
  PropertiesService.getScriptProperties().setProperties({
    HR_PROMO_PLATT_A: String(a),
    HR_PROMO_PLATT_B: String(b),
  });
}

/** Simple 2-D Newton on logistic NLL for (a,b); small data only. */
function mlbHrPromoFitPlattNewton_(pairs, maxIt) {
  let a = 1;
  let b = 0;
  const n = pairs.length;
  const IT = maxIt || 40;
  for (let it = 0; it < IT; it++) {
    let ga = 0,
      gb = 0,
      haa = 0,
      hab = 0,
      hbb = 0;
    for (let i = 0; i < n; i++) {
      const p0 = pairs[i].p0;
      const y = pairs[i].y;
      const p = Math.max(1e-6, Math.min(1 - 1e-6, p0));
      const z = Math.log(p / (1 - p));
      const t = a * z + b;
      const q = 1 / (1 + Math.exp(-t));
      const d = q - y;
      const dqdt = q * (1 - q);
      ga += d * dqdt * z;
      gb += d * dqdt * 1;
      haa += dqdt * dqdt * z * z + d * dqdt * (1 - 2 * q) * z * z;
      hab += dqdt * dqdt * z + d * dqdt * (1 - 2 * q) * z;
      hbb += dqdt * dqdt + d * dqdt * (1 - 2 * q);
    }
    const det = haa * hbb - hab * hab;
    if (Math.abs(det) < 1e-8) break;
    const da = (-ga * hbb + gb * hab) / det;
    const db = (ga * hab - gb * haa) / det;
    a -= da;
    b -= db;
    if (Math.abs(da) < 1e-6 && Math.abs(db) < 1e-6) break;
  }
  return { a: a, b: b };
}

function mlbHrPromoFitPlattFromResultsLogBestEffort_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig();
  const minN = parseInt(String(cfg['HR_PROMO_CALIB_MIN_ROWS'] != null ? cfg['HR_PROMO_CALIB_MIN_ROWS'] : '500').trim(), 10) || 500;
  const logSh = ss.getSheetByName(MLB_RESULTS_LOG_TAB);
  if (!logSh || logSh.getLastRow() < 4) {
    safeAlert_('HR promo calibration', 'No results log rows.');
    return;
  }
  const last = logSh.getLastRow();
  const data = logSh.getRange(4, 1, last, MLB_RESULTS_LOG_NCOL).getValues();
  const pairs = [];
  for (let i = 0; i < data.length; i++) {
    const market = String(data[i][5] || '').toLowerCase();
    if (market.indexOf('home run') === -1) continue;
    const res = String(data[i][16] || '').trim().toUpperCase();
    if (res !== 'WIN' && res !== 'LOSS') continue;
    const p0 = parseFloat(data[i][9], 10);
    if (isNaN(p0) || p0 <= 0 || p0 >= 1) continue;
    pairs.push({ p0: p0, y: res === 'WIN' ? 1 : 0 });
  }
  if (pairs.length < minN) {
    safeAlert_(
      'HR promo calibration',
      'Only ' + pairs.length + ' graded HR rows (need ' + minN + '). No coefficients written.'
    );
    return;
  }
  const coef = mlbHrPromoFitPlattNewton_(pairs, 50);
  mlbHrPromoSavePlattToScriptProperties_(coef.a, coef.b);
  safeAlert_('HR promo calibration', 'Platt saved: a=' + coef.a + ' b=' + coef.b + ' (n=' + pairs.length + ')');
}

function runMlbHrPromoBacktestMenu_() {
  safeAlert_(
    'HR promo backtest',
    'v1: fit Platt on graded HR rows (menu item). Rolling Brier vs baseline: export results log + notebook, or extend MLBHrPromoEval.js once snapshot density is high enough.'
  );
}
