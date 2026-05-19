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

// BABIP-leaning hits factor (singles + doubles weighted, HR contribution stripped).
// Differs from TB: Coors still tops but the spread is narrower; big foul-territory
// parks (Oakland legacy, SD) suppress singles less than they suppress TB.
const MLB_HOME_PARK_HITS_MULT = {
  COL: 1.05,
  BOS: 1.025,
  CIN: 1.02,
  ARI: 1.02,
  TEX: 1.015,
  KC:  1.015,
  PIT: 1.01,
  MIN: 1.01,
  CHC: 1.005,
  NYY: 1.0,
  LAD: 1.0,
  ATL: 1.0,
  HOU: 0.995,
  PHI: 1.0,
  WSH: 0.995,
  BAL: 1.0,
  CLE: 0.995,
  TOR: 1.0,
  STL: 0.995,
  MIL: 0.99,
  CWS: 0.99,
  DET: 0.985,
  TB:  0.985,
  ATH: 0.98,
  SEA: 0.975,
  SF:  0.97,
  SD:  0.97,
  MIA: 0.965,
  NYM: 0.985,
  LAA: 0.99,
};

function mlbParkHitsLambdaMultForHomeAbbr_(abbr) {
  const a = String(abbr || '').trim().toUpperCase();
  if (!a) return 1;
  const m = MLB_HOME_PARK_HITS_MULT[a];
  if (m == null || isNaN(m)) return 1;
  return Math.max(0.92, Math.min(1.08, m));
}

// HR-specific park factor (multi-year public park factors averaged, rounded).
// Wider spread than TB/Hits — Coors vs Oracle differ by ~40% on HR rate, so
// the clamp here is 0.80..1.25 (vs 0.9..1.1 for the others). Tune annually.
// Used by MLBHrPromoRefresh.js (HR promo λ) and MLBBatterHRQueue.js.
const MLB_HOME_PARK_HR_MULT = {
  COL: 1.22,  // Coors — altitude
  CIN: 1.15,  // GABP — short porches both sides
  NYY: 1.13,  // Yankee Stadium — short RF
  TEX: 1.08,  // Globe Life — neutral roof, slight boost
  CWS: 1.07,  // Rate Field — hitter-friendly
  BAL: 1.05,  // Camden — short LF after the wall move still mid-tier
  PHI: 1.04,  // CBP — slight boost
  ARI: 1.04,  // Chase
  MIL: 1.04,  // American Family
  CHC: 1.02,  // Wrigley — wind dependent
  ATL: 1.02,  // Truist
  BOS: 1.02,  // Fenway — Monster compresses some HR
  HOU: 1.00,  // Minute Maid
  MIN: 1.00,  // Target Field
  STL: 0.96,
  CLE: 0.95,
  TOR: 0.97,  // Rogers Centre
  WSH: 0.98,
  PIT: 0.95,  // PNC — deep LF
  LAA: 0.95,  // Big A
  LAD: 0.96,  // Dodger Stadium — slight suppress
  KC:  0.94,  // Kauffman — deep alleys
  TB:  0.95,
  ATH: 0.93,  // Oakland legacy / Vegas Athletics
  DET: 0.92,  // Comerica
  SEA: 0.90,  // T-Mobile
  NYM: 0.94,  // Citi Field
  MIA: 0.87,  // loanDepot — large dimensions
  SD:  0.87,  // Petco
  SF:  0.83,  // Oracle — largest HR suppressor
};

function mlbParkHrLambdaMultForHomeAbbr_(abbr) {
  const a = String(abbr || '').trim().toUpperCase();
  if (!a) return 1;
  const m = MLB_HOME_PARK_HR_MULT[a];
  if (m == null || isNaN(m)) return 1;
  return Math.max(0.80, Math.min(1.25, m));
}
