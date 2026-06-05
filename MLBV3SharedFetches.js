// ============================================================
// 🔄 Shared MLB stat fetches — one fetch per (player, season) for the whole pipeline
// ============================================================
// Every batter on the slate gets pulled into Hits v2, Hits v3, HR Promo,
// and GS Promo. (TB models retired from pipeline 2026-05-21.) Pre-consolidation each of these models
// kept its own per-batter cache and made redundant statsapi calls — same
// URL, slightly different parsing. ~600-1000 calls per slate.
//
// This file consolidates everything into ONE call per unique URL per
// player. Module state resets between Apps Script executions, so each
// Morning/Midday/Final starts fresh; within a run, every model reads
// from the same cache.
//
// Why "V3" stays in the filename: clasp+git get confused by renames, so
// the file keeps its original name even though scope is now slate-wide.
// All new public helpers use the mlbShared* prefix.
//
// The mlbV3Fetch* helpers below are thin back-compat wrappers over the
// shared layer so existing v3 callers keep working.
// ============================================================

// --- shared caches -------------------------------------------------------
var __mlbSharedBatterTeamAbbrCache = {};
var __mlbSharedBatterHittingCache = {};       // (id, season) → {vl, vr, szn} of stat objects
var __mlbSharedPitcherThrowsCache = {};
var __mlbSharedPitcherSeasonPitchingCache = {}; // (id, season) → {h, tb, k, hr, ip}

// Legacy v3 caches kept as accessors that go through the shared layer.
var __mlbV3BatterSeasonHittingCache = {};
var __mlbV3PitcherSeasonPitchingCache = {};

function mlbResetV3SharedFetchesCaches_() {
  __mlbSharedBatterTeamAbbrCache = {};
  __mlbSharedBatterHittingCache = {};
  __mlbSharedPitcherThrowsCache = {};
  __mlbSharedPitcherSeasonPitchingCache = {};
  __mlbV3BatterSeasonHittingCache = {};
  __mlbV3PitcherSeasonPitchingCache = {};
}

// --- batter: team affiliation -------------------------------------------
// Primary: extracted as a side-effect inside mlbSharedFetchBatterHittingSplitsAndSeason_
// (the team field on each split row reliably carries the player's current
// team with its abbreviation). The card's computeRow_ pre-warms that call
// before invoking this function, so this is almost always a cache hit.
// Fallback: /people/X (basic endpoint without hydration also returns
// currentTeam with abbreviation for active roster players).

function mlbSharedFetchBatterTeamAbbr_(playerId) {
  const id = parseInt(playerId, 10);
  if (!id) return '';
  if (__mlbSharedBatterTeamAbbrCache[id]) {
    return __mlbSharedBatterTeamAbbrCache[id];
  }
  // hydrate=currentTeam returns team.name even when abbreviation is absent
  // (common in 2026 statsapi). mlbTeamAbbrFromStatsApiTeam_ maps name → abbr.
  const url = mlbStatsApiBaseUrl_() + '/people/' + id + '?hydrate=currentTeam';
  let abbr = '';
  try {
    Utilities.sleep(40);
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() === 200) {
      const payload = JSON.parse(res.getContentText());
      const person = (payload.people && payload.people[0]) || {};
      if (typeof mlbTeamAbbrFromStatsApiTeam_ === 'function') {
        abbr = mlbTeamAbbrFromStatsApiTeam_(person.currentTeam || {});
      }
    }
  } catch (e) {
    Logger.log('mlbSharedFetchBatterTeamAbbr_: ' + e.message);
  }
  if (abbr) __mlbSharedBatterTeamAbbrCache[id] = abbr;
  return abbr;
}

// --- batter: vs-hand splits + season hitting ----------------------------
// /people/X/stats?stats=statSplits,season&group=hitting&sitCodes=vl,vr&season=Y
// Returns the FULL stat objects for vl, vr, and szn — each model picks
// the fields it needs (hits v2 → H, TB v2 → TB, hits v3 → K-rate, TB v3
// → ISO). Same statsapi call serves all four downstream uses.

function mlbSharedFetchBatterHittingSplitsAndSeason_(playerId, season) {
  const id = parseInt(playerId, 10);
  if (!id) return { vl: {}, vr: {}, szn: {} };
  const key = id + ':' + String(season);
  if (Object.prototype.hasOwnProperty.call(__mlbSharedBatterHittingCache, key)) {
    return __mlbSharedBatterHittingCache[key];
  }
  const url =
    mlbStatsApiBaseUrl_() +
    '/people/' +
    id +
    '/stats?stats=statSplits,season&group=hitting&sitCodes=vl,vr&season=' +
    encodeURIComponent(String(season));
  let vl = {};
  let vr = {};
  let szn = {};
  try {
    Utilities.sleep(40);
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() === 200) {
      const payload = JSON.parse(res.getContentText());
      const groups = payload.stats || [];
      // Side-channel: each split row carries the player's current team. Extract
      // it here so mlbSharedFetchBatterTeamAbbr_ reads from cache instead of
      // making a separate /people?hydrate=currentTeam call that may omit the
      // abbreviation field depending on API hydration depth.
      if (!__mlbSharedBatterTeamAbbrCache[id]) {
        var teamAbbr = '';
        for (var gi = 0; gi < groups.length && !teamAbbr; gi++) {
          var gSplits = (groups[gi] && groups[gi].splits) || [];
          for (var si = 0; si < gSplits.length && !teamAbbr; si++) {
            var t = (gSplits[si] && gSplits[si].team) || {};
            if (typeof mlbTeamAbbrFromStatsApiTeam_ === 'function') {
              teamAbbr = mlbTeamAbbrFromStatsApiTeam_(t);
            }
          }
        }
        if (teamAbbr) __mlbSharedBatterTeamAbbrCache[id] = teamAbbr;
      }
      groups.forEach(function (grp) {
        const ty = String((grp && grp.type && grp.type.displayName) || '').toLowerCase();
        const splits = (grp && grp.splits) || [];
        if (ty.indexOf('statsplits') !== -1) {
          splits.forEach(function (sp) {
            const code = String((sp.split && sp.split.code) || '').toLowerCase();
            const st = sp.stat || {};
            if (code === 'vl') vl = st;
            else if (code === 'vr') vr = st;
          });
        } else if (ty.indexOf('season') !== -1 && splits.length) {
          szn = splits[0].stat || {};
        }
      });
    }
  } catch (e) {
    Logger.log('mlbSharedFetchBatterHittingSplitsAndSeason_: ' + e.message);
  }
  const out = { vl: vl, vr: vr, szn: szn };
  __mlbSharedBatterHittingCache[key] = out;
  return out;
}

// --- pitcher: throws (L/R) ----------------------------------------------

function mlbSharedFetchPitcherThrows_(pitcherId) {
  const id = parseInt(pitcherId, 10);
  if (!id) return '';
  if (Object.prototype.hasOwnProperty.call(__mlbSharedPitcherThrowsCache, id)) {
    return __mlbSharedPitcherThrowsCache[id];
  }
  const url = mlbStatsApiBaseUrl_() + '/people/' + id;
  let out = '';
  try {
    Utilities.sleep(40);
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() === 200) {
      const payload = JSON.parse(res.getContentText());
      const person = (payload.people && payload.people[0]) || {};
      const code = String((person.pitchHand && person.pitchHand.code) || '').trim().toUpperCase();
      if (code === 'L' || code === 'R') out = code;
    }
  } catch (e) {
    Logger.log('mlbSharedFetchPitcherThrows_: ' + e.message);
  }
  __mlbSharedPitcherThrowsCache[id] = out;
  return out;
}

// --- pitcher: season pitching line --------------------------------------
// One fetch returns hits, total bases, strikeouts, home runs, and IP.
// Previously hits v2, TB v2, v3, and HR Promo each fetched this URL and
// parsed a different field — now they all read from one cached struct.

function mlbSharedFetchPitcherSeasonPitching_(pitcherId, season) {
  const id = parseInt(pitcherId, 10);
  if (!id) {
    return {
      h: NaN, tb: NaN, k: NaN, hr: NaN, ip: 0, bb: NaN, hbp: NaN, bf: NaN, oppAvg: NaN,
      er: NaN, era: NaN, fip: NaN, er9: NaN, go: NaN, ao: NaN,
    };
  }
  const key = id + ':' + String(season);
  if (Object.prototype.hasOwnProperty.call(__mlbSharedPitcherSeasonPitchingCache, key)) {
    return __mlbSharedPitcherSeasonPitchingCache[key];
  }
  const url =
    mlbStatsApiBaseUrl_() +
    '/people/' +
    id +
    '/stats?stats=season&group=pitching&season=' +
    encodeURIComponent(String(season));
  let out = {
    h: NaN, tb: NaN, k: NaN, hr: NaN, ip: 0, bb: NaN, hbp: NaN, bf: NaN, oppAvg: NaN,
    er: NaN, era: NaN, fip: NaN, er9: NaN, go: NaN, ao: NaN,
  };
  try {
    Utilities.sleep(40);
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() === 200) {
      const payload = JSON.parse(res.getContentText());
      const splits = (payload.stats && payload.stats[0] && payload.stats[0].splits) || [];
      if (splits.length) {
        const stat = splits[0].stat || {};
        const h = parseInt(stat.hits, 10);
        const k = parseInt(stat.strikeOuts, 10);
        const hr = parseInt(stat.homeRuns, 10);
        const bb = parseInt(stat.baseOnBalls, 10);
        const hbp = parseInt(stat.hitBatsmen, 10);
        const bf = parseInt(stat.battersFaced, 10);
        const er = parseInt(stat.earnedRuns, 10);
        const go = parseInt(stat.groundOuts, 10);
        const ao = parseInt(stat.airOuts, 10);
        const eraRaw = stat.era != null ? parseFloat(stat.era) : NaN;
        let tb = stat.totalBases != null ? parseInt(stat.totalBases, 10) : NaN;
        if (isNaN(tb) && !isNaN(h)) {
          const d = parseInt(stat.doubles, 10) || 0;
          const t = parseInt(stat.triples, 10) || 0;
          const hrx = parseInt(stat.homeRuns, 10) || 0;
          const singles = Math.max(0, h - d - t - hrx);
          tb = singles + 2 * d + 3 * t + 4 * hrx;
        }
        let oppAvg = NaN;
        const rawAvg = stat.avg != null ? parseFloat(stat.avg) : NaN;
        if (!isNaN(rawAvg) && rawAvg >= 0 && rawAvg <= 1) {
          oppAvg = rawAvg;
        } else if (!isNaN(h) && !isNaN(bf) && !isNaN(bb) && bf > 0) {
          const hbpSafe = isNaN(hbp) ? 0 : hbp;
          const ab = bf - bb - hbpSafe;
          if (ab > 0) oppAvg = h / ab;
        }
        const ipStr = String(stat.inningsPitched || '0').trim();
        let ipDec = 0;
        if (ipStr) {
          const parts = ipStr.split('.');
          const whole = parseInt(parts[0], 10) || 0;
          const outs = parts.length > 1 ? parseInt(parts[1], 10) || 0 : 0;
          ipDec = whole + outs / 3;
        }
        let fip = stat.fip != null ? parseFloat(stat.fip) : NaN;
        if ((isNaN(fip) || fip <= 0) && ipDec > 0 && !isNaN(k) && !isNaN(bb)) {
          fip = mlbComputeFipFromCountingStats_(hr, bb, hbp, k, ipDec, 3.1);
        }
        const er9 = ipDec > 0 && !isNaN(er) ? Math.round((er / ipDec) * 900) / 100 : NaN;
        out = {
          h: isNaN(h) ? NaN : h,
          tb: isNaN(tb) ? NaN : tb,
          k: isNaN(k) ? NaN : k,
          hr: isNaN(hr) ? NaN : hr,
          ip: ipDec,
          bb: isNaN(bb) ? NaN : bb,
          hbp: isNaN(hbp) ? NaN : hbp,
          bf: isNaN(bf) ? NaN : bf,
          oppAvg: isNaN(oppAvg) ? NaN : oppAvg,
          er: isNaN(er) ? NaN : er,
          era: isNaN(eraRaw) ? NaN : Math.round(eraRaw * 100) / 100,
          fip: isNaN(fip) ? NaN : Math.round(fip * 100) / 100,
          er9: isNaN(er9) ? NaN : er9,
          go: isNaN(go) ? NaN : go,
          ao: isNaN(ao) ? NaN : ao,
        };
      }
    }
  } catch (e) {
    Logger.log('mlbSharedFetchPitcherSeasonPitching_: ' + e.message);
  }
  __mlbSharedPitcherSeasonPitchingCache[key] = out;
  return out;
}

/** Standard FIP: ((13*HR + 3*(BB+HBP) - 2*K) / IP) + constant. */
function mlbComputeFipFromCountingStats_(hr, bb, hbp, k, ip, fipConstant) {
  const ipNum = parseFloat(ip, 10);
  if (isNaN(ipNum) || ipNum <= 0) return NaN;
  const hrN = isNaN(hr) ? 0 : hr;
  const bbN = isNaN(bb) ? 0 : bb;
  const hbpN = isNaN(hbp) ? 0 : hbp;
  const kN = isNaN(k) ? 0 : k;
  const c = parseFloat(fipConstant, 10);
  const constant = !isNaN(c) ? c : 3.1;
  return Math.round((((13 * hrN + 3 * (bbN + hbpN) - 2 * kN) / ipNum) + constant) * 100) / 100;
}

// --- v3 back-compat thin wrappers ---------------------------------------
// Previously made their own statsapi calls. Now delegate to the shared
// layer — the splits+season URL is a superset of the season-only URL we
// used to hit for v3, so the szn portion is identical.

function mlbV3FetchBatterSeasonHitting_(playerId, season) {
  const data = mlbSharedFetchBatterHittingSplitsAndSeason_(playerId, season);
  const stat = data.szn || {};
  const h = parseInt(stat.hits, 10);
  let tb = stat.totalBases != null ? parseInt(stat.totalBases, 10) : NaN;
  if (isNaN(tb) && !isNaN(h)) {
    const d = parseInt(stat.doubles, 10) || 0;
    const t = parseInt(stat.triples, 10) || 0;
    const hr = parseInt(stat.homeRuns, 10) || 0;
    const singles = Math.max(0, h - d - t - hr);
    tb = singles + 2 * d + 3 * t + 4 * hr;
  }
  const pa = parseInt(stat.plateAppearances, 10) || 0;
  const ab = parseInt(stat.atBats, 10) || 0;
  const k = parseInt(stat.strikeOuts, 10);
  return {
    h: isNaN(h) ? NaN : h,
    tb: isNaN(tb) ? NaN : tb,
    pa: pa,
    ab: ab,
    k: isNaN(k) ? NaN : k,
  };
}

/** Season PA + AB from the shared hitting cache (no extra statsapi call). */
function mlbSharedBatterSeasonPaAb_(playerId, season) {
  const data = mlbSharedFetchBatterHittingSplitsAndSeason_(playerId, season);
  const szn = (data && data.szn) || {};
  return {
    pa: parseInt(szn.plateAppearances, 10) || 0,
    ab: parseInt(szn.atBats, 10) || 0,
  };
}

function mlbV3FetchPitcherSeasonPitching_(pitcherId, season) {
  const s = mlbSharedFetchPitcherSeasonPitching_(pitcherId, season);
  return { hr: s.hr, k: s.k, ip: s.ip };
}
