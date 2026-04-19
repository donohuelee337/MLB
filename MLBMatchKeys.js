// ============================================================
// 🔗 MLB match keys — schedule ↔ FanDuel (The Odds API) joins
// ============================================================
// Normalizes game + person strings and builds candidate game keys
// (statsapi matchup vs odds-style team names) so K queue / slate
// board miss fewer rows on label drift.
// ============================================================

/** Odds API home_team / away_team style names by statsapi schedule abbr. */
const MLB_ABBR_TO_ODDS_TEAM_NAME = {
  ARI: 'Arizona Diamondbacks',
  ATL: 'Atlanta Braves',
  BAL: 'Baltimore Orioles',
  BOS: 'Boston Red Sox',
  CHC: 'Chicago Cubs',
  CIN: 'Cincinnati Reds',
  CLE: 'Cleveland Guardians',
  COL: 'Colorado Rockies',
  CWS: 'Chicago White Sox',
  DET: 'Detroit Tigers',
  HOU: 'Houston Astros',
  KC: 'Kansas City Royals',
  LAA: 'Los Angeles Angels',
  LAD: 'Los Angeles Dodgers',
  MIA: 'Miami Marlins',
  MIL: 'Milwaukee Brewers',
  MIN: 'Minnesota Twins',
  NYM: 'New York Mets',
  NYY: 'New York Yankees',
  OAK: 'Oakland Athletics',
  PHI: 'Philadelphia Phillies',
  PIT: 'Pittsburgh Pirates',
  SD: 'San Diego Padres',
  SEA: 'Seattle Mariners',
  SF: 'San Francisco Giants',
  STL: 'St. Louis Cardinals',
  TB: 'Tampa Bay Rays',
  TEX: 'Texas Rangers',
  TOR: 'Toronto Blue Jays',
  WSN: 'Washington Nationals',
};

/** Extra odds-style strings for the same club (relocation / branding). */
const MLB_ABBR_ODDS_TEAM_ALTERNATES = {
  OAK: ['Las Vegas Athletics', 'Athletics'],
};

function mlbNormalizeGameLabel_(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*@\s*/g, ' @ ')
    .trim();
}

function mlbNormalizePersonName_(s) {
  let t = String(s || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/\./g, '')
    .replace(/[-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  t = t.replace(/\b(jr|sr|ii|iii|iv)\b\.?$/i, '').trim();
  return t;
}

function mlbOddsTeamLabelVariants_(abbr) {
  const a = String(abbr || '').trim().toUpperCase();
  const list = [];
  const primary = MLB_ABBR_TO_ODDS_TEAM_NAME[a];
  const alts = MLB_ABBR_ODDS_TEAM_ALTERNATES[a] || [];
  if (primary) list.push(primary);
  for (let i = 0; i < alts.length; i++) {
    if (alts[i]) list.push(alts[i]);
  }
  if (!list.length && a) list.push(a);
  return list;
}

/**
 * Unique normalized "away @ home" strings to try against FanDuel odds rows.
 * @param {string} matchup statsapi-style "Away @ Home"
 * @param {string} awayAbbr schedule col away
 * @param {string} homeAbbr schedule col home
 */
function mlbCandidateGameKeys_(matchup, awayAbbr, homeAbbr) {
  const seen = {};
  const out = [];
  function push(str) {
    const g = mlbNormalizeGameLabel_(str);
    if (!g || seen[g]) return;
    seen[g] = true;
    out.push(g);
  }
  if (matchup) push(matchup);
  const parts = String(matchup || '').split(/\s*@\s*/);
  const an = (parts[0] || '').trim();
  const hn = (parts[1] || '').trim();
  if (an && hn) push(an + ' @ ' + hn);

  const va = mlbOddsTeamLabelVariants_(awayAbbr);
  const vh = mlbOddsTeamLabelVariants_(homeAbbr);
  for (let i = 0; i < va.length; i++) {
    for (let j = 0; j < vh.length; j++) {
      push(va[i] + ' @ ' + vh[j]);
    }
  }
  return out;
}

/**
 * @param {Object} oddsIdx from mlbBuildPitcherKOddsIndex_
 * @param {string[]} gameKeys from mlbCandidateGameKeys_
 * @param {string} pitcherNorm mlbNormalizePersonName_(fullName)
 */
function mlbOddsPointMapForPitcher_(oddsIdx, gameKeys, pitcherNorm) {
  for (let i = 0; i < gameKeys.length; i++) {
    const k = gameKeys[i] + '||' + pitcherNorm;
    const pm = oddsIdx[k];
    if (pm && Object.keys(pm).length) return pm;
  }
  return null;
}
