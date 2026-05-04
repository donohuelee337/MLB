// ============================================================
// 🏟️ Park factors — λ multiplier by home team
// ============================================================
// Coarse v1 table: multiply model λ when this team is HOME (where the
// game is played). Tune annually; default unknown = 1.
// ============================================================

// HR park factors (2024-25 multi-year averages; 1.00 = league average)
const MLB_HOME_PARK_HR_MULT = {
  COL: 1.15,  // Coors — altitude, thin air
  CIN: 1.12,  // GABP — short dimensions, hitter-friendly
  BAL: 1.10,  // Camden Yards — post-2022 reno, CF moved in
  NYY: 1.10,  // Yankee Stadium — short right porch
  ATH: 1.08,  // Athletics ballpark — ran hot in debut season
  PHI: 1.07,  // Citizens Bank — right-center gap
  LAD: 1.06,  // Dodger Stadium — rising trend
  TEX: 1.05,  // Globe Life — warm/dry air
  BOS: 1.03,  // Fenway — Green Monster suppresses some fly balls but LHB pop
  MIL: 1.02,  // American Family — slight hitter lean
  DET: 1.01,
  MIN: 1.00,
  CHC: 1.00,  // Wrigley — highly wind-dependent; neutral baseline
  NYM: 0.99,  // Citi Field
  WSN: 0.98,
  ATL: 0.97,  // Truist Park
  STL: 0.97,  // Busch Stadium
  CLE: 0.96,  // Progressive Field
  TB:  0.96,  // Tropicana
  LAA: 0.96,  // Angel Stadium
  PIT: 0.95,  // PNC Park — deepest CF in NL
  CWS: 0.95,
  HOU: 0.95,  // Minute Maid — Crawford Boxes help LHB, but deep RF
  TOR: 0.95,  // Rogers Centre — turf, average HR park
  KC:  0.94,  // Kauffman Stadium — spacious
  SEA: 0.92,  // T-Mobile Park — marine layer suppresses
  ARI: 0.90,  // Chase Field — humidor since 2018
  MIA: 0.90,  // loanDepot — significant suppressor
  SD:  0.88,  // Petco Park — marine layer, deep dimensions
  SF:  0.87,  // Oracle Park — deepest park in majors
};

function mlbParkHrLambdaMultForHomeAbbr_(abbr) {
  const a = String(abbr || '').trim().toUpperCase();
  if (!a) return 1;
  const m = MLB_HOME_PARK_HR_MULT[a];
  if (m == null || isNaN(m)) return 1;
  return Math.max(0.80, Math.min(1.20, m));
}

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
