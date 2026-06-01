// ============================================================
// K probability calibration — bucket fit / apply / persist
// ============================================================
// OOS walk-forward samples → bucket actual hit rates → live P(win) adjust.
// Table stored in ScriptProperties K_CALIBRATION_JSON + 🎯 K_Calibration tab.
// ============================================================

const MLB_K_CALIBRATION_TAB = '🎯 K_Calibration';

function mlbKCalibrationBuckets_() {
  return [
    { lo: 0.5, hi: 0.55 },
    { lo: 0.55, hi: 0.6 },
    { lo: 0.6, hi: 0.65 },
    { lo: 0.65, hi: 0.7 },
    { lo: 0.7, hi: 0.75 },
    { lo: 0.75, hi: 0.8 },
    { lo: 0.8, hi: 1.01 },
  ];
}

function mlbFitKCalibration_(samples) {
  const out = { Over: [], Under: [] };
  ['Over', 'Under'].forEach(function (side) {
    const rows = (samples || []).filter(function (s) {
      return s.side === side;
    });
    mlbKCalibrationBuckets_().forEach(function (b) {
      const bucket = rows.filter(function (s) {
        return s.pRaw >= b.lo && s.pRaw < b.hi;
      });
      if (bucket.length < 15) return;
      const hits = bucket.reduce(function (a, s) {
        return a + s.hit;
      }, 0);
      const actual = hits / bucket.length;
      const midRaw = (b.lo + b.hi) / 2;
      out[side].push({ lo: b.lo, hi: b.hi, n: bucket.length, actual: actual, midRaw: midRaw });
    });
  });
  return out;
}

function mlbApplyKCalibration_(pRaw, side, table) {
  const p = parseFloat(pRaw);
  if (isNaN(p) || !table) return p;
  const rows = table[side] || [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (p >= r.lo && p < r.hi) return Math.round(r.actual * 1000) / 1000;
  }
  return p;
}

function mlbWriteKCalibrationTab_(ss, table) {
  let sh = ss.getSheetByName(MLB_K_CALIBRATION_TAB);
  if (!sh) sh = ss.insertSheet(MLB_K_CALIBRATION_TAB);
  sh.clear();
  sh.getRange(1, 1)
    .setValue('🎯 K Probability Calibration — ' + new Date())
    .setFontWeight('bold');
  let row = 3;
  ['Over', 'Under'].forEach(function (side) {
    sh.getRange(row++, 1).setValue(side).setFontWeight('bold');
    sh.getRange(row, 1, 1, 5).setValues([['lo', 'hi', 'n', 'actual_hit_rate', 'mid_raw']]);
    row++;
    (table[side] || []).forEach(function (r) {
      sh.getRange(row, 1, 1, 5).setValues([[r.lo, r.hi, r.n, r.actual, r.midRaw]]);
      row++;
    });
    row++;
  });
  PropertiesService.getScriptProperties().setProperty('K_CALIBRATION_JSON', JSON.stringify(table));
}

function mlbLoadKCalibrationTable_() {
  const raw = PropertiesService.getScriptProperties().getProperty('K_CALIBRATION_JSON');
  if (!raw) return { Over: [], Under: [] };
  try {
    return JSON.parse(raw);
  } catch (e) {
    return { Over: [], Under: [] };
  }
}
