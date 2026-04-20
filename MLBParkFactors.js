// ============================================================
// 🏟️ Park factors — λ multiplier by home team (K environment)
// ============================================================
// Coarse v1 table: multiply model λ when this team is HOME (where the
// game is played). Tune annually; default unknown = 1.
// ============================================================

const MLB_HOME_PARK_K_MULT = {
  COL: 1.04,
  ARI: 1.03,
  CIN: 1.025,
  TEX: 1.02,
  NYY: 1.015,
  SEA: 0.985,
  SF: 0.98,
  SD: 0.975,
  MIA: 0.97,
};

function mlbParkKLambdaMultForHomeAbbr_(abbr) {
  const a = String(abbr || '').trim().toUpperCase();
  if (!a) return 1;
  const m = MLB_HOME_PARK_K_MULT[a];
  if (m == null || isNaN(m)) return 1;
  return Math.max(0.92, Math.min(1.08, m));
}

/** Coarse batter TB environment by home team (ballpark). Unknown = 1. */
const MLB_HOME_PARK_TB_MULT = {
  COL: 1.08,
  ARI: 1.04,
  CIN: 1.03,
  TEX: 1.025,
  BAL: 1.02,
  NYY: 1.015,
  LAD: 1.01,
  ATL: 1.01,
  MIA: 0.97,
  SD: 0.98,
  SF: 0.97,
  SEA: 0.985,
};

function mlbParkTbLambdaMultForHomeAbbr_(abbr) {
  const a = String(abbr || '').trim().toUpperCase();
  if (!a) return 1;
  const m = MLB_HOME_PARK_TB_MULT[a];
  if (m == null || isNaN(m)) return 1;
  return Math.max(0.9, Math.min(1.1, m));
}
