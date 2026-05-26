// ============================================================
// 🔥 Streak_Picks — daily picks for FanDuel "MLB The Streak"
// ============================================================
// FanDuel's Streak is a free, sequential pick-1-batter-per-day promo:
// player needs ≥1 H to keep the streak alive. Target = 60 in a row.
//
// This is a Streak-specific re-ranker. It layers SP K/9 + bullpen leverage
// on top of h.v2-full P(≥1 hit). Pitcher/team context comes from 📅
// MLB_Schedule + statsapi (NOT from the v2 card's opp_sp columns).
//
// Candidate batters: reads 🧪 Batter_Hits_Card_v2-full when present (fast);
// otherwise builds from FanDuel hits odds + inline v2 λ compute.
//
// Streak factors on top of P(≥1 hit):
//   • SP K/9 penalty — high-whiff starters remove PAs ([STREAK_K9_*])
//   • Bullpen leverage — pen H/9 × expected SP IP ([STREAK_PEN_*])
//
// Planned (not yet wired):
//   • Lineup spot confirmation (in-game PAs)
//
// Hard constraint: DO NOT modify v2 outputs. Read-only consumer.
// VISUAL FORMATTING is in MLBPromoFormatting.js — DO NOT mix rendering code
// into this file or it will get rolled back with model changes.
// ============================================================

const MLB_STREAK_PICKS_TAB = '🔥 Streak_Picks';
const MLB_STREAK_LEAGUE_K9_DEFAULT = 8.5;
const MLB_STREAK_K9_PENALTY_ALPHA_DEFAULT = 0.15;
const MLB_STREAK_K9_PENALTY_MIN = 0.80;
const MLB_STREAK_K9_PENALTY_MAX = 1.05;
const MLB_STREAK_PICK_COUNT_DEFAULT = 2;

// --- bullpen leverage tuning ----------------------------------------------
// Each PA the SP doesn't see is a PA vs the opposing bullpen. v2's
// opp_sp_mult only captures the SP, so we layer in a small pen adjustment
// scaled by how many PAs the pen actually sees.
const MLB_STREAK_LEAGUE_H9_DEFAULT = 8.5;
const MLB_STREAK_PEN_BETA_DEFAULT = 0.20;
const MLB_STREAK_PEN_MULT_MIN = 0.95;
const MLB_STREAK_PEN_MULT_MAX = 1.05;
const MLB_STREAK_SP_IP_DEFAULT = 5.5; // league avg SP IP/start fallback

// --- dead-PA penalty tuning -----------------------------------------------
// BB and HBP end the PA without a hit-eligible event. SPs that walk or hit
// way more batters than league effectively shrink the hit-eligible PA pool,
// which v2's H/9 mult doesn't fully capture (H/9 normalizes to innings, not
// to PAs faced). dead_pa_rate = (BB + HBP) / BF. League ~ 0.085.
const MLB_STREAK_LEAGUE_DEAD_PA_RATE_DEFAULT = 0.085;
const MLB_STREAK_DEAD_PA_ALPHA_DEFAULT = 0.30;
const MLB_STREAK_DEAD_PA_MULT_MIN = 0.94;
const MLB_STREAK_DEAD_PA_MULT_MAX = 1.04;

// --- BABIP regression flag (notes only — not in pStreak math) -------------
// Surfaces hot/cold luck candidates so we can eyeball before locking a pick.
const MLB_STREAK_BABIP_LOW_THRESHOLD = 0.240;
const MLB_STREAK_BABIP_HIGH_THRESHOLD = 0.380;
const MLB_STREAK_BABIP_MIN_PA = 80;

// Local team caches (per refresh — cleared by mlbStreakResetCaches_).
var __mlbStreakExpSpIpCache = {};
var __mlbStreakPenH9Cache = {};

function mlbStreakResetCaches_() {
  __mlbStreakExpSpIpCache = {};
  __mlbStreakPenH9Cache = {};
}

function mlbStreakAbbrToId_(abbr) {
  const id = mlbTeamIdFromAbbr_(abbr);
  return id || 0;
}

/**
 * Average IP per start for a pitcher this season, from gameLog. Restricts
 * to games where the pitcher was the starter (gamesStarted=1 on the split).
 * Falls back to STREAK_SP_IP_DEFAULT if no qualifying starts found.
 */
function mlbStreakExpectedSpIp_(pitcherId, season) {
  const id = parseInt(pitcherId, 10);
  if (!id) return NaN;
  const key = id + ':' + String(season);
  if (Object.prototype.hasOwnProperty.call(__mlbStreakExpSpIpCache, key)) {
    return __mlbStreakExpSpIpCache[key];
  }
  const splits = mlbStatsApiGetPitchingGameSplits_(id, season);
  let totIp = 0;
  let nStarts = 0;
  for (let i = 0; i < splits.length; i++) {
    const st = splits[i].stat || {};
    const gs = parseInt(st.gamesStarted, 10);
    if (!gs) continue; // only count actual starts
    const ip = mlbParseInningsString_(st.inningsPitched);
    if (!isNaN(ip) && ip > 0) {
      totIp += ip;
      nStarts += 1;
    }
  }
  const out = nStarts > 0 ? Math.round((totIp / nStarts) * 100) / 100 : NaN;
  __mlbStreakExpSpIpCache[key] = out;
  return out;
}

/**
 * Opposing team bullpen H/9 this season. Uses /teams/{id}/stats with
 * sitCode=rp (relief appearances).
 */
function mlbStreakOpposingPenH9_(teamAbbr, season) {
  const id = mlbStreakAbbrToId_(teamAbbr);
  if (!id) return { h9: NaN, ip: NaN };
  const key = id + ':' + String(season);
  if (Object.prototype.hasOwnProperty.call(__mlbStreakPenH9Cache, key)) {
    return __mlbStreakPenH9Cache[key];
  }
  const url =
    mlbStatsApiBaseUrl_() +
    '/teams/' +
    id +
    '/stats?stats=statSplits&group=pitching&sitCodes=rp&season=' +
    encodeURIComponent(String(season));
  let h9 = NaN;
  let ipDec = NaN;
  try {
    Utilities.sleep(50);
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() === 200) {
      const payload = JSON.parse(res.getContentText());
      const groups = payload.stats || [];
      let hits = 0;
      let ip = 0;
      groups.forEach(function (grp) {
        const splits = (grp && grp.splits) || [];
        splits.forEach(function (sp) {
          const code = String((sp.split && sp.split.code) || '').toLowerCase();
          if (code !== 'rp') return;
          const st = sp.stat || {};
          const h = parseInt(st.hits, 10);
          const ipStr = String(st.inningsPitched || '0').trim();
          const parts = ipStr.split('.');
          const whole = parseInt(parts[0], 10) || 0;
          const outs = parts.length > 1 ? parseInt(parts[1], 10) || 0 : 0;
          const dec = whole + outs / 3;
          if (!isNaN(h) && dec > 0) {
            hits += h;
            ip += dec;
          }
        });
      });
      if (ip > 0) {
        h9 = (hits * 9) / ip;
        ipDec = ip;
      }
    }
  } catch (e) {
    Logger.log('mlbStreakOpposingPenH9_: ' + e.message);
  }
  const out = {
    h9: isNaN(h9) ? NaN : Math.round(h9 * 100) / 100,
    ip: isNaN(ipDec) ? NaN : Math.round(ipDec * 10) / 10,
  };
  __mlbStreakPenH9Cache[key] = out;
  return out;
}

/**
 * gamePk → { away, home, awaySpId, homeSpId, awaySpName, homeSpName, matchup }
 * Built once per refresh from cached schedule block.
 */
function mlbStreakBuildScheduleGameMap_(ss) {
  const map = {};
  const block = mlbGetScheduleBlock_(ss);
  for (let i = 0; i < block.length; i++) {
    const g = parseInt(block[i][0], 10);
    if (!g) continue;
    map[g] = {
      away: mlbCanonicalTeamAbbr_(block[i][3]),
      home: mlbCanonicalTeamAbbr_(block[i][4]),
      matchup: String(block[i][5] || '').trim(),
      awaySpId: parseInt(block[i][11], 10) || 0,
      homeSpId: parseInt(block[i][12], 10) || 0,
      awaySpName: String(block[i][6] || '').trim(),
      homeSpName: String(block[i][7] || '').trim(),
    };
  }
  return map;
}

/**
 * Opposing SP + team for a batter — lineup side (when confirmed), then batter
 * team abbr, then v2 opp_sp_name. Does not read the v2 card directly; callers
 * pass v2OppSpName when available.
 */
function mlbStreakPitcherContextForBatter_(ss, gamePk, batterId, gameMap, v2OppSpName) {
  const g = parseInt(gamePk, 10);
  const id = parseInt(batterId, 10);
  const game = gameMap[g];
  if (!game || !id) return null;

  // Confirmed lineup side is the most reliable team signal (avoids stale
  // statsapi currentTeam mismatches vs tonight's game).
  if (typeof mlbLineupSideForBatter_ === 'function') {
    const side = mlbLineupSideForBatter_(g, id);
    if (side === 'away') {
      return {
        spId: game.homeSpId,
        oppAbbr: game.home,
        oppSpName: game.homeSpName,
        batAbbr: game.away,
      };
    }
    if (side === 'home') {
      return {
        spId: game.awaySpId,
        oppAbbr: game.away,
        oppSpName: game.awaySpName,
        batAbbr: game.home,
      };
    }
  }

  if (typeof mlbSharedFetchBatterHittingSplitsAndSeason_ === 'function') {
    mlbSharedFetchBatterHittingSplitsAndSeason_(id, mlbSlateSeasonYear_(getConfig()));
  }
  let batAbbr = mlbCanonicalTeamAbbr_(mlbHitsV2BatterTeamAbbr_(id));
  if (batAbbr) {
    const oppSp = mlbGetOpposingProbableSp_(ss, g, batAbbr);
    if (oppSp && oppSp.id) {
      return {
        spId: oppSp.id,
        oppAbbr: mlbScheduleOppTeamAbbrForBatter_(ss, g, batAbbr),
        oppSpName: oppSp.name || '',
        batAbbr: batAbbr,
      };
    }
    if (batAbbr === game.away) {
      return {
        spId: game.homeSpId,
        oppAbbr: game.home,
        oppSpName: game.homeSpName,
        batAbbr: batAbbr,
      };
    }
    if (batAbbr === game.home) {
      return {
        spId: game.awaySpId,
        oppAbbr: game.away,
        oppSpName: game.awaySpName,
        batAbbr: batAbbr,
      };
    }
  }

  // Last resort: v2 already matched opp_sp_name — recover SP id from schedule
  // or statsapi people search even when batter-team lookup failed.
  const nameHint = String(v2OppSpName || '').trim();
  if (nameHint) {
    if (typeof mlbScheduleSpContextByName_ === 'function') {
      const fb = mlbScheduleSpContextByName_(ss, g, nameHint);
      if (fb && fb.spId) {
        return {
          spId: fb.spId,
          oppAbbr: fb.oppAbbr || '',
          oppSpName: fb.spName || nameHint,
          batAbbr: fb.batAbbr || '',
        };
      }
    }
    const spFromName = mlbStatsApiResolvePlayerIdFromName_(nameHint);
    if (spFromName && !isNaN(spFromName)) {
      return {
        spId: spFromName,
        oppAbbr: '',
        oppSpName: nameHint,
        batAbbr: batAbbr || '',
      };
    }
  }
  return null;
}

function mlbStreakFillPitcherStats_(spId, season) {
  const out = { spK9: '', expSpIp: '', deadPaRate: '', oppAvg: '' };
  const pid = parseInt(spId, 10);
  if (!pid) return out;
  // Season K/9 + dead-PA rate from shared pitcher cache (same fetch as Hits v3 / HR promo).
  if (typeof mlbSharedFetchPitcherSeasonPitching_ === 'function') {
    const stat = mlbSharedFetchPitcherSeasonPitching_(pid, season);
    if (!isNaN(stat.k) && stat.ip > 0) {
      out.spK9 = Math.round((stat.k * 9) / stat.ip * 100) / 100;
    }
    if (!isNaN(stat.bb) && !isNaN(stat.bf) && stat.bf > 0) {
      const hbp = isNaN(stat.hbp) ? 0 : stat.hbp;
      out.deadPaRate = Math.round(((stat.bb + hbp) / stat.bf) * 1000) / 1000;
    }
    if (!isNaN(stat.oppAvg)) {
      out.oppAvg = Math.round(stat.oppAvg * 1000) / 1000;
    }
  }
  const ipNum = mlbStreakExpectedSpIp_(pid, season);
  if (!isNaN(ipNum) && ipNum > 0) out.expSpIp = ipNum;
  // Fallback: game-log walk (needs 📒 Pitcher_Game_Logs warmed).
  if (out.spK9 === '') {
    const psum = mlbPitchingLogSummary_(pid, season);
    if (psum && psum.k9 !== '' && !isNaN(parseFloat(psum.k9))) {
      out.spK9 = parseFloat(psum.k9);
    }
  }
  return out;
}

/**
 * Dead-PA penalty: SPs that walk + HBP more batters than league shrink the
 * hit-eligible PA pool. Symmetric small bonus for strike-throwers.
 * @param {number|string} deadPaRate — observed (BB+HBP)/BF
 * @param {number} leagueRate
 * @param {number} alpha
 * @returns {number} multiplier in [STREAK_DEAD_PA_MULT_MIN, STREAK_DEAD_PA_MULT_MAX]
 */
function mlbStreakDeadPaPenaltyMult_(deadPaRate, leagueRate, alpha) {
  const r = parseFloat(deadPaRate, 10);
  if (isNaN(r) || r < 0) return 1;
  const league = leagueRate > 0 ? leagueRate : MLB_STREAK_LEAGUE_DEAD_PA_RATE_DEFAULT;
  const a = alpha >= 0 ? alpha : MLB_STREAK_DEAD_PA_ALPHA_DEFAULT;
  const excess = (r - league) / league;
  let m = 1 - a * excess;
  m = Math.max(MLB_STREAK_DEAD_PA_MULT_MIN, Math.min(MLB_STREAK_DEAD_PA_MULT_MAX, m));
  return Math.round(m * 1000) / 1000;
}

/**
 * Batter season BABIP for regression flagging. Reads from the shared batter
 * splits+season cache (no extra fetch). Returns NaN below MIN_PA threshold.
 */
function mlbStreakBatterBabip_(batterId, season) {
  const id = parseInt(batterId, 10);
  if (!id || typeof mlbSharedFetchBatterHittingSplitsAndSeason_ !== 'function') return NaN;
  const data = mlbSharedFetchBatterHittingSplitsAndSeason_(id, season);
  const szn = (data && data.szn) || {};
  const pa = parseInt(szn.plateAppearances, 10) || 0;
  if (pa < MLB_STREAK_BABIP_MIN_PA) return NaN;
  // Prefer statsapi's `babip` field; fall back to (H - HR) / (AB - K - HR + SF).
  const raw = szn.babip != null ? parseFloat(szn.babip) : NaN;
  if (!isNaN(raw) && raw >= 0 && raw <= 1) return raw;
  const h = parseInt(szn.hits, 10);
  const hr = parseInt(szn.homeRuns, 10) || 0;
  const ab = parseInt(szn.atBats, 10);
  const k = parseInt(szn.strikeOuts, 10) || 0;
  const sf = parseInt(szn.sacFlies, 10) || 0;
  if (isNaN(h) || isNaN(ab)) return NaN;
  const denom = ab - k - hr + sf;
  if (denom <= 0) return NaN;
  return (h - hr) / denom;
}

/**
 * Candidate rows for Streak ranking. Prefers v2 card (λ + est_PA already
 * computed). Falls back to FanDuel hits odds + inline v2 compute when the
 * v2 tab is missing or stale.
 */
function mlbStreakCollectCandidates_(ss, cfg, season) {
  const out = [];
  const src = ss.getSheetByName(MLB_BATTER_HITS_V2_CARD_TAB);
  if (src && src.getLastRow() >= 4) {
    const last = src.getLastRow();
    const nRows = last - 3;
    const nCols = Math.max(34, Math.min(src.getLastColumn(), 38));
    const data = src.getRange(4, 1, nRows, nCols).getValues();
    data.forEach(function (r) {
      out.push({
        gamePk: r[0],
        matchup: r[1],
        batter: r[2],
        batterId: r[17],
        lambdaV2: r[6],
        estPa: r[25],
        oppSpName: String(r[27] || '').trim(),
        v2OppSpIp: r[30],
        v2OppAvg: nCols > 37 ? r[37] : '',
        flagsV2: String(r[16] || ''),
        hotCold: nCols > 33 ? String(r[33] || '').trim().toUpperCase() : '',
      });
    });
    return out;
  }

  const agg = mlbCollectBatterHitsOddsRows_(ss);
  const gamePkMap = mlbBuildOddsGameNormToGamePk_(ss);
  Object.keys(agg).forEach(function (key) {
    const entry = agg[key];
    const gamePk = mlbResolveGamePkFromFdGameLabel_(ss, entry.gameLabel, gamePkMap);
    let matchup = '';
    if (gamePk) {
      matchup = mlbScheduleMetaForGamePk_(ss, gamePk).matchup;
    }
    const pidNum = mlbStatsApiResolvePlayerIdFromName_(entry.displayName);
    let lambdaV2 = '';
    let estPa = '';
    let flagsV2 = '';
    if (!gamePk) flagsV2 = 'schedule_game_miss';
    if (isNaN(pidNum) || !pidNum) {
      flagsV2 = flagsV2 ? flagsV2 + '; id_miss' : 'id_miss';
    }
    if (gamePk && !isNaN(pidNum) && pidNum && typeof mlbHitsV2ComputeRow_ === 'function') {
      const row = mlbHitsV2ComputeRow_(ss, gamePk, pidNum, season, cfg);
      if (row && !isNaN(row.lambda)) lambdaV2 = row.lambda;
      if (row && !isNaN(row.estPa)) estPa = row.estPa;
    }
    out.push({
      gamePk: gamePk || '',
      matchup: matchup,
      batter: entry.displayName,
      batterId: pidNum && !isNaN(pidNum) ? pidNum : '',
      lambdaV2: lambdaV2,
      estPa: estPa,
      flagsV2: flagsV2,
    });
  });
  return out;
}

/**
 * Bullpen leverage multiplier — extra adjustment on top of v2's opp_sp_mult.
 * Captures the PA share that *will* face the bullpen (1 - sp_share) blended
 * with the pen H/9 deviation from league.
 *
 *   pen_share = max(0, min(1, 1 - exp_sp_ip / 9))
 *   pen_excess = (pen_h9 - league_h9) / league_h9
 *   pen_mult = 1 + pen_share * beta * pen_excess  (clamped)
 *
 * Returns 1.0 when any input is missing (no penalty if we can't verify).
 */
function mlbStreakBullpenLeverageMult_(expSpIp, penH9, leagueH9, beta) {
  const ip = parseFloat(expSpIp, 10);
  const h9 = parseFloat(penH9, 10);
  if (isNaN(ip) || isNaN(h9) || h9 <= 0) return 1;
  const league = leagueH9 > 0 ? leagueH9 : MLB_STREAK_LEAGUE_H9_DEFAULT;
  const b = beta >= 0 ? beta : MLB_STREAK_PEN_BETA_DEFAULT;
  const penShare = Math.max(0, Math.min(1, 1 - ip / 9));
  const penExcess = (h9 - league) / league;
  let m = 1 + penShare * b * penExcess;
  m = Math.max(MLB_STREAK_PEN_MULT_MIN, Math.min(MLB_STREAK_PEN_MULT_MAX, m));
  return Math.round(m * 1000) / 1000;
}

/**
 * Convert v2 inputs into P(≥1 hit) using the binomial (1 - (1-p)^n).
 * @param {number} lambdaV2 — expected H from v2 (h_per_pa × est_pa × multipliers)
 * @param {number} estPa
 * @returns {number} probability in [0, 1), or NaN if inputs invalid
 */
function mlbStreakPhitFromV2_(lambdaV2, estPa) {
  const lam = parseFloat(lambdaV2, 10);
  const pa = parseFloat(estPa, 10);
  if (isNaN(lam) || isNaN(pa) || lam <= 0 || pa <= 0) return NaN;
  const hPerPa = Math.max(0, Math.min(0.499, lam / pa));
  if (hPerPa <= 0) return 0;
  const p = 1 - Math.pow(1 - hPerPa, pa);
  return Math.max(0, Math.min(0.999, p));
}

/**
 * Streak-specific SP K/9 penalty. Higher K/9 → smaller multiplier
 * (fewer balls-in-play PAs). Symmetric small bonus for soft-contact SP.
 * @returns {number} multiplier in [STREAK_K9_PENALTY_MIN, STREAK_K9_PENALTY_MAX]
 */
function mlbStreakK9PenaltyMult_(spK9, leagueK9, alpha) {
  const k = parseFloat(spK9, 10);
  if (isNaN(k) || k <= 0) return 1; // unknown SP → no adjustment
  const league = leagueK9 > 0 ? leagueK9 : MLB_STREAK_LEAGUE_K9_DEFAULT;
  const a = alpha >= 0 ? alpha : MLB_STREAK_K9_PENALTY_ALPHA_DEFAULT;
  const excess = (k - league) / league;
  let m = 1 - a * excess;
  m = Math.max(MLB_STREAK_K9_PENALTY_MIN, Math.min(MLB_STREAK_K9_PENALTY_MAX, m));
  return Math.round(m * 1000) / 1000;
}

/**
 * Build 🔥 Streak_Picks. λ/est_PA from v2 card (or odds fallback); SP/team
 * from 📅 schedule + statsapi.
 */
function refreshStreakPicks() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig();
  const season = mlbSlateSeasonYear_(cfg);
  const slateDate = getSlateDateString_(cfg) || '';
  mlbStreakResetCaches_();

  const cfgNum_ = function (key, fallback, min) {
    const raw = String(cfg[key] != null ? cfg[key] : '').trim();
    const n = parseFloat(raw, 10);
    if (isNaN(n)) return fallback;
    if (min != null && n < min) return fallback;
    return n;
  };
  const leagueK9 = cfgNum_('STREAK_K9_LEAGUE', MLB_STREAK_LEAGUE_K9_DEFAULT, 0.1);
  const alpha = cfgNum_('STREAK_K9_PENALTY_ALPHA', MLB_STREAK_K9_PENALTY_ALPHA_DEFAULT, 0);
  const leagueH9 = cfgNum_('STREAK_PEN_LEAGUE_H9', MLB_STREAK_LEAGUE_H9_DEFAULT, 0.1);
  const penBeta = cfgNum_('STREAK_PEN_BETA', MLB_STREAK_PEN_BETA_DEFAULT, 0);
  const spIpDefault = cfgNum_('STREAK_SP_IP_DEFAULT', MLB_STREAK_SP_IP_DEFAULT, 1);
  const leagueDeadPa = cfgNum_('STREAK_LEAGUE_DEAD_PA_RATE', MLB_STREAK_LEAGUE_DEAD_PA_RATE_DEFAULT, 0.001);
  const deadPaAlpha = cfgNum_('STREAK_DEAD_PA_ALPHA', MLB_STREAK_DEAD_PA_ALPHA_DEFAULT, 0);
  const pickCountRaw = String(cfg['STREAK_PICK_COUNT'] != null ? cfg['STREAK_PICK_COUNT'] : '').trim();
  const pickCount = (function () {
    const n = parseInt(pickCountRaw, 10);
    return !isNaN(n) && n > 0 ? n : MLB_STREAK_PICK_COUNT_DEFAULT;
  })();

  let candidates = mlbStreakCollectCandidates_(ss, cfg, season);
  if (mlbPromoExcludeColdEnabled_(cfg)) {
    candidates = candidates.filter(function (c) {
      if (!c.batterId) return true;
      return !mlbPromoDropColdBatter_(c.batterId, season, cfg, c.hotCold);
    });
  }
  if (!candidates.length) {
    mlbStreakWriteEmpty_(ss, 'No streak candidates — run schedule + hits v2 (or check PROMO_EXCLUDE_COLD).');
    return;
  }

  const gameMap = mlbStreakBuildScheduleGameMap_(ss);
  const out = [];

  candidates.forEach(function (c) {
    const pHitV2 = mlbStreakPhitFromV2_(c.lambdaV2, c.estPa);

    let oppSpName = '';
    let spK9 = '';
    let expSpIp = '';
    let oppAbbr = '';
    let deadPaRate = '';
    let oppAvg = '';
    if (c.gamePk && c.batterId) {
      let ctx = mlbStreakPitcherContextForBatter_(ss, c.gamePk, c.batterId, gameMap, c.oppSpName);
      let spId = ctx ? ctx.spId : 0;
      if (ctx) {
        oppSpName = ctx.oppSpName || c.oppSpName || '';
        oppAbbr = ctx.oppAbbr || '';
      } else if (c.oppSpName) {
        oppSpName = c.oppSpName;
      }
      if (spId) {
        const stats = mlbStreakFillPitcherStats_(spId, season);
        spK9 = stats.spK9;
        expSpIp = stats.expSpIp;
        deadPaRate = stats.deadPaRate;
        oppAvg = stats.oppAvg;
      }
      if (expSpIp === '' && c.v2OppSpIp !== '' && c.v2OppSpIp != null) {
        const ipV2 = parseFloat(String(c.v2OppSpIp));
        if (!isNaN(ipV2) && ipV2 > 0) expSpIp = Math.round(ipV2 * 10) / 10;
      }
      if (oppAvg === '' && c.v2OppAvg !== '' && c.v2OppAvg != null) {
        const avgV2 = parseFloat(String(c.v2OppAvg));
        if (!isNaN(avgV2) && avgV2 > 0) oppAvg = Math.round(avgV2 * 1000) / 1000;
      }
      if (oppAbbr === '' && ctx && ctx.batAbbr && typeof mlbScheduleOppTeamAbbrForBatter_ === 'function') {
        oppAbbr = mlbScheduleOppTeamAbbrForBatter_(ss, c.gamePk, ctx.batAbbr);
      }
    }

    let penH9 = '';
    let penIp = '';
    if (oppAbbr) {
      const pen = mlbStreakOpposingPenH9_(oppAbbr, season);
      if (!isNaN(pen.h9)) penH9 = pen.h9;
      if (!isNaN(pen.ip)) penIp = pen.ip;
    }

    const k9Mult = mlbStreakK9PenaltyMult_(spK9, leagueK9, alpha);
    const ipForLeverage = expSpIp !== '' ? expSpIp : spIpDefault;
    const penMult = mlbStreakBullpenLeverageMult_(ipForLeverage, penH9, leagueH9, penBeta);
    const deadPaMult = mlbStreakDeadPaPenaltyMult_(deadPaRate, leagueDeadPa, deadPaAlpha);

    let pStreak = '';
    if (!isNaN(pHitV2)) {
      pStreak = pHitV2 * k9Mult * penMult * deadPaMult;
      pStreak = Math.max(0, Math.min(0.999, pStreak));
      pStreak = Math.round(pStreak * 10000) / 10000;
    }

    // BABIP regression flag — surface only, not in pStreak math.
    const babip = c.batterId ? mlbStreakBatterBabip_(c.batterId, season) : NaN;
    const babipDisplay = isNaN(babip) ? '' : Math.round(babip * 1000) / 1000;

    const notes = [];
    if (c.flagsV2) notes.push('v2:' + c.flagsV2);
    if (oppSpName === '') notes.push('no_opp_sp');
    if (spK9 === '') notes.push('no_sp_k9');
    if (expSpIp === '') notes.push('no_sp_ip');
    if (penH9 === '') notes.push('no_pen_h9');
    if (deadPaRate === '') notes.push('no_dead_pa');
    if (isNaN(pHitV2)) notes.push('no_v2_lambda');
    if (!isNaN(babip) && babip < MLB_STREAK_BABIP_LOW_THRESHOLD) notes.push('babip_low');
    if (!isNaN(babip) && babip > MLB_STREAK_BABIP_HIGH_THRESHOLD) notes.push('babip_high');

    out.push({
      gamePk: c.gamePk || '',
      matchup: c.matchup || '',
      batter: c.batter || '',
      batterId: c.batterId || '',
      pHitV2: isNaN(pHitV2) ? '' : Math.round(pHitV2 * 10000) / 10000,
      babip: babipDisplay,
      oppSpName: oppSpName,
      spK9: spK9 === '' ? '' : Math.round(spK9 * 100) / 100,
      expSpIp: expSpIp === '' ? '' : expSpIp,
      oppAvg: oppAvg === '' ? '' : oppAvg,
      deadPaRate: deadPaRate === '' ? '' : deadPaRate,
      oppAbbr: oppAbbr || '',
      penH9: penH9 === '' ? '' : penH9,
      penIp: penIp === '' ? '' : penIp,
      k9Mult: k9Mult,
      penMult: penMult,
      deadPaMult: deadPaMult,
      pStreak: pStreak,
      hotCold: String(c.hotCold || '').trim().toUpperCase(),
      notes: notes.join('; '),
    });
  });

  // Rank by pStreak desc; ties broken by pHitV2.
  out.sort(function (a, b) {
    const bp = parseFloat(b.pStreak);
    const ap = parseFloat(a.pStreak);
    if (isNaN(bp) && isNaN(ap)) return 0;
    if (isNaN(bp)) return -1;
    if (isNaN(ap)) return 1;
    if (bp !== ap) return bp - ap;
    return (parseFloat(b.pHitV2) || 0) - (parseFloat(a.pHitV2) || 0);
  });

  // Dedupe by batter name (keep highest pStreak) before picking top N.
  const seenPlayer = {};
  const deduped = [];
  out.forEach(function (row) {
    const key = String(row.batter || '').trim().toLowerCase();
    if (!key) return;
    if (seenPlayer[key]) return;
    seenPlayer[key] = true;
    deduped.push(row);
  });

  // Pick top N — but only if pStreak is computable (non-empty).
  let pickIdx = 0;
  const hotColdFlags = [];
  const ranked = deduped.map(function (row) {
    hotColdFlags.push(row.hotCold || '');
    const havePstreak = row.pStreak !== '' && !isNaN(parseFloat(row.pStreak));
    let rank = '';
    let isPick = '';
    if (havePstreak && pickIdx < pickCount) {
      pickIdx += 1;
      rank = pickIdx;
      isPick = true;
    }
    return [
      row.gamePk,
      row.matchup,
      row.batter,
      row.batterId,
      row.pHitV2,
      row.babip,
      row.oppSpName,
      row.spK9,
      row.expSpIp,
      row.oppAvg,
      row.deadPaRate,
      row.oppAbbr,
      row.penH9,
      row.penIp,
      row.k9Mult,
      row.penMult,
      row.deadPaMult,
      row.pStreak,
      rank,
      isPick,
      'streak.v2',
      row.notes,
    ];
  });

  mlbStreakWriteSheet_(ss, ranked, slateDate, hotColdFlags);
}

function mlbStreakWriteSheet_(ss, rows, slateDate, hotColdFlags) {
  let sh = ss.getSheetByName(MLB_STREAK_PICKS_TAB);
  if (sh) {
    sh.clearContents();
    sh.clearFormats();
  } else {
    sh = ss.insertSheet(MLB_STREAK_PICKS_TAB);
  }
  sh.setTabColor('#f59e0b');

  const NEED_COLS = 22;
  if (sh.getMaxColumns() < NEED_COLS) {
    sh.insertColumnsAfter(sh.getMaxColumns(), NEED_COLS - sh.getMaxColumns());
  }

  const headers = [
    'gamePk',
    'matchup',
    'batter',
    'batter_id',
    'p_hit_v2',
    'season_babip',
    'opp_sp_name',
    'opp_sp_k9',
    'exp_sp_ip',
    'opp_sp_avg_against',
    'opp_sp_dead_pa_rate',
    'opp_team',
    'opp_pen_h9',
    'opp_pen_ip',
    'k9_penalty_mult',
    'pen_leverage_mult',
    'dead_pa_mult',
    'p_streak',
    'pick_rank',
    'is_pick',
    'model_version',
    'notes',
  ];
  sh.getRange(3, 1, 1, headers.length).setValues([headers]);

  const widths = [72, 200, 150, 72, 64, 72, 130, 64, 64, 72, 80, 60, 72, 64, 72, 80, 72, 64, 56, 56, 80, 220];
  widths.forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });

  if (rows.length) {
    sh.getRange(4, 1, rows.length, headers.length).setValues(rows);
    try {
      ss.setNamedRange('MLB_STREAK_PICKS', sh.getRange(4, 1, rows.length, headers.length));
    } catch (e) {}
  }

  // Visual rendering lives in MLBPromoFormatting.js — keep it that way.
  mlbApplyStreakPromoFormatting_(sh, rows.length ? rows : [], headers, slateDate, hotColdFlags);
  sh.setHiddenGridlines(true);

  try {
    ss.toast(rows.length + ' candidates · top picks marked', 'Streak Picks', 6);
  } catch (e) {}
}

function mlbStreakWriteEmpty_(ss, message) {
  let sh = ss.getSheetByName(MLB_STREAK_PICKS_TAB);
  if (!sh) sh = ss.insertSheet(MLB_STREAK_PICKS_TAB);
  sh.clear();
  sh.getRange(1, 1).setValue('🔥 Streak_Picks — ' + (message || 'no data'));
}

/**
 * Returns the set of player names currently flagged as Streak picks,
 * lowercased + trimmed for case-insensitive matching. Consumed by the
 * Bet Card formatter so the yellow-highlight stays in sync with this
 * sheet instead of recomputing top-2 inline.
 * @returns {Object<string, {rank: number}>}
 */
function mlbActivateStreakPicksTab_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(MLB_STREAK_PICKS_TAB);
  if (sh) sh.activate();
  else ss.toast('Run the pipeline (or 🔥 Rebuild Streak picks) to create ' + MLB_STREAK_PICKS_TAB, 'MLB-BOIZ', 5);
}

function mlbStreakPicksByPlayer_(ss) {
  const out = {};
  const sh = ss.getSheetByName(MLB_STREAK_PICKS_TAB);
  if (!sh || sh.getLastRow() < 4) return out;
  const last = sh.getLastRow();
  // Schema (1-indexed): col 3 = batter, col 18 = p_streak, col 19 = pick_rank,
  // col 20 = is_pick. Read first 20 columns.
  const vals = sh.getRange(4, 1, last - 3, 20).getValues();
  for (let i = 0; i < vals.length; i++) {
    if (vals[i][19] !== true) continue;
    const name = String(vals[i][2] || '').trim().toLowerCase();
    if (!name) continue;
    const rank = parseInt(vals[i][18], 10) || 0;
    const pStreak = parseFloat(vals[i][17]);
    out[name] = { rank: rank, pStreak: isNaN(pStreak) ? null : pStreak };
  }
  return out;
}
