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

/** Extra odds-style strings for the same club (relocation, legacy names, abbreviations). */
const MLB_ABBR_ODDS_TEAM_ALTERNATES = {
  ARI: ['Arizona D-backs', 'Arizona Dbacks'],
  CHC: ['Chi Cubs'],
  CLE: ['Cleveland Indians'],
  CWS: ['Chi White Sox', 'Chi Sox'],
  KC: ['KC Royals'],
  LAA: ['LA Angels', 'Los Angeles Angels of Anaheim', 'Anaheim Angels'],
  LAD: ['LA Dodgers'],
  MIA: ['Florida Marlins'],
  NYM: ['NY Mets'],
  NYY: ['NY Yankees'],
  OAK: [
    'Las Vegas Athletics',
    'Athletics',
    'Oakland A\'s',
    'Oakland As',
    'Las Vegas A\'s',
  ],
  SD: ['SD Padres'],
  SF: ['SF Giants'],
  STL: ['St Louis Cardinals', 'Saint Louis Cardinals'],
  TB: ['Tampa Bay Devil Rays', 'Devil Rays'],
  WSN: ['Washington Nats', 'Washington DC Nationals'],
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
/**
 * Canonical FanDuel-odds reader. Accepts one market key or a list (e.g. main + _alternate).
 * Returns: { "gameNorm||personNorm": { gameLabel, displayName, pointMap: { pt: { Over, Under } } } }.
 *
 * All downstream queues/cards should go through this — single place to fix sheet-shape bugs.
 */
function mlbBuildPropOddsIndex_(ss, marketKeys) {
  const keysArr = Array.isArray(marketKeys) ? marketKeys : [marketKeys];
  const wanted = {};
  keysArr.forEach(function (k) {
    const t = String(k || '').trim();
    if (t) wanted[t] = true;
  });
  const byKey = {};
  const sh = ss.getSheetByName(MLB_ODDS_CONFIG.tabName);
  if (!sh || sh.getLastRow() < 4 || !Object.keys(wanted).length) return byKey;
  const last = sh.getLastRow();
  const block = sh.getRange(4, 1, Math.max(0, last - 3), 6).getValues();
  for (let i = 0; i < block.length; i++) {
    const player = block[i][0];
    const gameLabel = block[i][1];
    const market = String(block[i][2] || '');
    const side = String(block[i][3] || '');
    const lineRaw = block[i][4];
    const price = block[i][5];
    if (!wanted[market]) continue;
    const g = mlbNormalizeGameLabel_(gameLabel);
    const p = mlbNormalizePersonName_(player);
    if (!g || !p) continue;
    const pt = parseFloat(lineRaw);
    if (isNaN(pt)) continue;
    const key = g + '||' + p;
    if (!byKey[key]) {
      byKey[key] = {
        gameLabel: gameLabel,
        displayName: String(player || '').trim(),
        pointMap: {},
      };
    }
    if (!byKey[key].pointMap[pt]) byKey[key].pointMap[pt] = {};
    const sl = side.toLowerCase();
    if (sl.indexOf('over') !== -1) byKey[key].pointMap[pt].Over = price;
    if (sl.indexOf('under') !== -1) byKey[key].pointMap[pt].Under = price;
  }
  return byKey;
}

/** Back-compat: returns just the pointMap shape used by the K queue. */
function mlbBuildPersonPropOddsIndex_(ss, marketKey) {
  const rich = mlbBuildPropOddsIndex_(ss, marketKey);
  const out = {};
  Object.keys(rich).forEach(function (k) { out[k] = rich[k].pointMap; });
  return out;
}

/** Back-compat: main+alternate merged into the pointMap shape. */
function mlbBuildPersonPropOddsIndexMerged_(ss, mainKey, altKey) {
  const rich = mlbBuildPropOddsIndex_(ss, [mainKey, altKey]);
  const out = {};
  Object.keys(rich).forEach(function (k) { out[k] = rich[k].pointMap; });
  return out;
}

function mlbOddsPointMapForPerson_(oddsIdx, gameKeys, personNorm) {
  for (let i = 0; i < gameKeys.length; i++) {
    const k = gameKeys[i] + '||' + personNorm;
    const pm = oddsIdx[k];
    if (pm && Object.keys(pm).length) return pm;
  }
  return null;
}

function mlbOddsPointMapForPitcher_(oddsIdx, gameKeys, pitcherNorm) {
  return mlbOddsPointMapForPerson_(oddsIdx, gameKeys, pitcherNorm);
}

/**
 * Normalized Odds API game labels → statsapi gamePk (from 📅 MLB_Schedule).
 */
function mlbBuildOddsGameNormToGamePk_(ss) {
  const map = {};
  const sch = ss.getSheetByName(MLB_SCHEDULE_TAB);
  if (!sch || sch.getLastRow() < 4) return map;
  const last = sch.getLastRow();
  const block = sch.getRange(4, 1, Math.max(0, last - 3), 6).getValues();
  for (let i = 0; i < block.length; i++) {
    const gamePk = block[i][0];
    const matchup = block[i][5];
    const awayAbbr = block[i][3];
    const homeAbbr = block[i][4];
    const keys = mlbCandidateGameKeys_(matchup, awayAbbr, homeAbbr);
    for (let k = 0; k < keys.length; k++) {
      map[keys[k]] = gamePk;
    }
  }
  return map;
}

/**
 * Map FanDuel / Odds API game string → statsapi gamePk.
 * Uses label variants first, then exact normalized 📅 matchup.
 */
function mlbResolveGamePkFromFdGameLabel_(ss, fdGameLabel, gamePkMap) {
  const map = gamePkMap || {};
  const g = mlbNormalizeGameLabel_(fdGameLabel);
  if (map[g] != null && map[g] !== '') return map[g];
  const sch = ss.getSheetByName(MLB_SCHEDULE_TAB);
  if (!sch || sch.getLastRow() < 4) return '';
  const last = sch.getLastRow();
  const block = sch.getRange(4, 1, Math.max(0, last - 3), 6).getValues();
  for (let i = 0; i < block.length; i++) {
    const m = mlbNormalizeGameLabel_(block[i][5]);
    if (m === g) return block[i][0];
  }
  return '';
}
