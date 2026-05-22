// ============================================================
// 🧪 Batter hits v2 (shadow) — vs-hand × est_PA × park_H × opp_SP
// ============================================================
// Independent shadow model. Picks its own best_side per row. Does NOT
// affect the live Bet Card. Writes:
//   - 🧪 Batter_Hits_Card_v2-full           (per-batter rows + multipliers)
//   - 🧪 MLB_Results_Log_v2 (via snapshot)  (graded separately)
// ============================================================
// Composition:
//   base   = H_per_PA_vs_hand × est_PA          (replaces v1 "H/G blend")
//   λ_v2   = base × park_H × opp_SP_mult
// Recorded multipliers (for ablation in the compare panel):
//   park_mult = park_H (BABIP-leaning, see MLBParkFactors.js)
//   opp_mult  = SP H/9 vs league, shrunk toward 1.0
//   hand_mult = vs-hand H/PA ÷ season H/PA   (already inside base; logged for ablation)
//   ab_mult   = est_PA ÷ season PA/G         (already inside base; logged for ablation)
// ============================================================

const MLB_BATTER_HITS_V2_CARD_TAB = '🧪 Batter_Hits_Card_v2-full';
const MLB_HITS_V2_LEAGUE_H_PER_9 = 8.5;
const MLB_HITS_V2_LEAGUE_H_PER_PA = 0.245;
const MLB_HITS_V2_DEFAULT_PA_PER_GAME = 4.2;
// Shrinkage priors (in PA / IP units of the prior).
const MLB_HITS_V2_VS_HAND_SHRINK_PA = 60;
const MLB_HITS_V2_OPP_SP_SHRINK_IP = 20;
// Multiplier safety rails.
const MLB_HITS_V2_OPP_MULT_MIN = 0.85;
const MLB_HITS_V2_OPP_MULT_MAX = 1.15;
const MLB_HITS_V2_HAND_MULT_MIN = 0.8;
const MLB_HITS_V2_HAND_MULT_MAX = 1.25;

// 🧪 v2.avg shadow — swap opp_SP_H/9 mult for opp_SP_BA-against mult.
// H/9 is innings-normalized (includes BB/HBP padding); BA-against is
// AB-normalized — closer to "probability the next AB results in a hit"
// which is what a hit prop actually settles on. Shrinks toward league BA.
const MLB_HITS_V2_LEAGUE_OPP_AVG = 0.252;
const MLB_HITS_V2_OPP_AVG_SHRINK_AB = 100;

var __mlbHitsV2PitcherThrowsCache = {};
var __mlbHitsV2PitcherHitRateCache = {};
var __mlbHitsV2BatterVsHandCache = {};
var __mlbHitsV2BatterPaPerGameCache = {};
var __mlbHitsV2BatterTeamAbbrCache = {};

function mlbResetHitsV2Caches_() {
  __mlbHitsV2PitcherThrowsCache = {};
  __mlbHitsV2PitcherHitRateCache = {};
  __mlbHitsV2BatterVsHandCache = {};
  __mlbHitsV2BatterPaPerGameCache = {};
  __mlbHitsV2BatterTeamAbbrCache = {};
}

// --- batter team affiliation -----------------------------------------------

function mlbHitsV2BatterTeamAbbr_(playerId) {
  // Delegates to shared cache — TB v2 + HR Promo + anyone else needing
  // the same batter's team abbr now reuses this single fetch.
  return mlbSharedFetchBatterTeamAbbr_(playerId);
}

// --- opposing probable starter --------------------------------------------

/**
 * Reads 📅 MLB_Schedule for the gamePk and returns the probable SP on the
 * OPPOSITE side from the batter's team. {id, name, throws} or null.
 * Delegates to the shared cached implementation in MLBSchedule.js.
 */
function mlbHitsV2OpposingProbableSp_(ss, gamePk, batterTeamAbbr) {
  return mlbGetOpposingProbableSp_(ss, gamePk, batterTeamAbbr);
}

function mlbHitsV2PitcherThrows_(pitcherId) {
  return mlbSharedFetchPitcherThrows_(pitcherId);
}

// --- opposing SP H/9 multiplier (shrunk) ----------------------------------

function mlbHitsV2OpposingHitRateMult_(pitcherId, season, minIp) {
  // Read from the shared pitcher season cache — TB v2, v3 models, and HR
  // Promo all pull the same fetch. We derive H/9 + shrink locally.
  const stat = mlbSharedFetchPitcherSeasonPitching_(pitcherId, season);
  const ipFloor = minIp > 0 ? minIp : 10;
  if (isNaN(stat.h) || stat.ip < ipFloor) return { mult: 1, h9: '', ip: '' };
  const rawH9 = (stat.h * 9) / stat.ip;
  const k = MLB_HITS_V2_OPP_SP_SHRINK_IP;
  const shrunkH9 = (stat.h + MLB_HITS_V2_LEAGUE_H_PER_9 * (k / 9)) / ((stat.ip + k) / 9);
  let mult = shrunkH9 / MLB_HITS_V2_LEAGUE_H_PER_9;
  mult = Math.max(MLB_HITS_V2_OPP_MULT_MIN, Math.min(MLB_HITS_V2_OPP_MULT_MAX, mult));
  return {
    mult: Math.round(mult * 1000) / 1000,
    h9: Math.round(rawH9 * 100) / 100,
    ip: Math.round(stat.ip * 10) / 10,
  };
}

/**
 * 🧪 v2.avg shadow — BA-against multiplier vs league, shrunk in AB.
 * Reuses the same shared pitcher cache (no extra API call). AB derived as
 * BF − BB − HBP (SF unavailable on the pitching line, but ≤2% of denom).
 * Returns mult=1 when sample is below the IP floor or fields are missing.
 *
 * @returns {{ mult: number, oppAvg: (number|string), ab: (number|string) }}
 */
function mlbHitsV2OpposingAvgMult_(pitcherId, season, minIp) {
  const stat = mlbSharedFetchPitcherSeasonPitching_(pitcherId, season);
  const ipFloor = minIp > 0 ? minIp : 10;
  if (isNaN(stat.h) || isNaN(stat.bf) || stat.ip < ipFloor || stat.bf <= 0) {
    return { mult: 1, oppAvg: '', ab: '' };
  }
  const hbpSafe = isNaN(stat.hbp) ? 0 : stat.hbp;
  const bbSafe = isNaN(stat.bb) ? 0 : stat.bb;
  const ab = stat.bf - bbSafe - hbpSafe;
  if (ab <= 0) return { mult: 1, oppAvg: '', ab: '' };
  const k = MLB_HITS_V2_OPP_AVG_SHRINK_AB;
  const lg = MLB_HITS_V2_LEAGUE_OPP_AVG;
  const shrunk = (stat.h + lg * k) / (ab + k);
  let mult = shrunk / lg;
  mult = Math.max(MLB_HITS_V2_OPP_MULT_MIN, Math.min(MLB_HITS_V2_OPP_MULT_MAX, mult));
  const rawAvg = stat.h / ab;
  return {
    mult: Math.round(mult * 1000) / 1000,
    oppAvg: Math.round(rawAvg * 1000) / 1000,
    ab: ab,
  };
}

// --- batter vs-hand H/PA (shrunk to season) -------------------------------

function mlbHitsV2BatterVsHandHPerPa_(playerId, season, throwsHand) {
  const id = parseInt(playerId, 10);
  if (!id) {
    return { hpPaVsHand: NaN, hpPaSzn: NaN, samplePa: 0, hand: '' };
  }
  const hand = String(throwsHand || '').trim().toUpperCase();
  // Shared cache: same URL as TB v2's vs-hand fetch (different parsed
  // fields). Extract H + PA from the raw stat objects.
  const data = mlbSharedFetchBatterHittingSplitsAndSeason_(id, season);
  const vlH  = parseInt(data.vl.hits, 10) || 0;
  const vlPa = parseInt(data.vl.plateAppearances, 10) || 0;
  const vrH  = parseInt(data.vr.hits, 10) || 0;
  const vrPa = parseInt(data.vr.plateAppearances, 10) || 0;
  const sznH  = parseInt(data.szn.hits, 10) || 0;
  const sznPa = parseInt(data.szn.plateAppearances, 10) || 0;

  const hpPaSzn = sznPa > 0 ? sznH / sznPa : NaN;
  let split = null;
  if (hand === 'L')      split = { h: vlH, pa: vlPa };
  else if (hand === 'R') split = { h: vrH, pa: vrPa };
  if (!split || split.pa <= 0) {
    return { hpPaVsHand: hpPaSzn, hpPaSzn: hpPaSzn, samplePa: 0, hand: hand };
  }
  // Shrink split H/PA toward season H/PA (or league as last resort).
  const priorHpPa = !isNaN(hpPaSzn) ? hpPaSzn : MLB_HITS_V2_LEAGUE_H_PER_PA;
  const k = MLB_HITS_V2_VS_HAND_SHRINK_PA;
  const hpPaVsHand = (split.h + priorHpPa * k) / (split.pa + k);
  return { hpPaVsHand: hpPaVsHand, hpPaSzn: hpPaSzn, samplePa: split.pa, hand: hand };
}

// --- est_PA per game ------------------------------------------------------

function mlbHitsV2BatterPaPerGame_(playerId, season) {
  const id = parseInt(playerId, 10);
  if (!id) return MLB_HITS_V2_DEFAULT_PA_PER_GAME;
  const key = id + ':' + String(season);
  if (Object.prototype.hasOwnProperty.call(__mlbHitsV2BatterPaPerGameCache, key)) {
    return __mlbHitsV2BatterPaPerGameCache[key];
  }
  // Reuse v1 gameLog cache.
  const splits = mlbStatsApiGetHittingGameSplits_(id, season);
  let totPa = 0;
  let n = 0;
  for (let i = 0; i < splits.length; i++) {
    const st = splits[i].stat || {};
    const pa = parseInt(st.plateAppearances, 10);
    if (!isNaN(pa) && pa > 0) {
      totPa += pa;
      n++;
    }
  }
  const out = n > 0 ? totPa / n : MLB_HITS_V2_DEFAULT_PA_PER_GAME;
  __mlbHitsV2BatterPaPerGameCache[key] = out;
  return out;
}

// --- composer -------------------------------------------------------------

/**
 * Build the λ_v2 and the per-feature multipliers for one batter row.
 * @returns {Object} { lambda, base, parkMult, oppMult, handMult, abMult,
 *                     hpPaVsHand, hpPaSzn, samplePa, estPa, paPerGameSzn,
 *                     oppSpId, oppSpName, oppSpThrows, oppH9, oppIp }
 */
function mlbHitsV2ComputeRow_(ss, gamePk, batterId, season, cfg) {
  const out = {
    lambda: NaN,
    base: NaN,
    parkMult: 1,
    oppMult: 1,
    handMult: 1,
    abMult: 1,
    hpPaVsHand: NaN,
    hpPaSzn: NaN,
    samplePa: 0,
    estPa: NaN,
    paPerGameSzn: NaN,
    oppSpId: '',
    oppSpName: '',
    oppSpThrows: '',
    oppH9: '',
    oppIp: '',
    // 🧪 v2.avg shadow audit fields.
    oppAvgMult: 1,
    oppAvg: '',
    oppAb: '',
    lambdaAvg: NaN,
  };

  // Park (BABIP-leaning hits).
  const homeAbbr = mlbScheduleHomeAbbrForGamePk_(ss, gamePk);
  out.parkMult = mlbParkHitsLambdaMultForHomeAbbr_(homeAbbr);

  // Pre-warm hitting splits — the response carries the player's team
  // abbreviation as a side-effect in mlbSharedFetchBatterHittingSplitsAndSeason_,
  // so the team-abbr lookup below reads from cache instead of making a
  // separate /people?hydrate=currentTeam call that may not return abbreviation.
  mlbSharedFetchBatterHittingSplitsAndSeason_(batterId, season);

  // Opposing SP via batter team affiliation.
  const batterAbbr = mlbHitsV2BatterTeamAbbr_(batterId);
  const oppSp = batterAbbr ? mlbHitsV2OpposingProbableSp_(ss, gamePk, batterAbbr) : null;
  if (oppSp) {
    out.oppSpId = oppSp.id || '';
    out.oppSpName = oppSp.name || '';
    out.oppSpThrows = mlbHitsV2PitcherThrows_(oppSp.id);
    const opp = mlbHitsV2OpposingHitRateMult_(oppSp.id, season, mlbOppSpMinIp_(cfg));
    out.oppMult = opp.mult;
    out.oppH9 = opp.h9;
    out.oppIp = opp.ip;
    // 🧪 v2.avg shadow — same pitcher, BA-against denominator.
    const oppA = mlbHitsV2OpposingAvgMult_(oppSp.id, season, mlbOppSpMinIp_(cfg));
    out.oppAvgMult = oppA.mult;
    out.oppAvg = oppA.oppAvg;
    out.oppAb = oppA.ab;
  }

  // vs-hand H/PA (falls back to season if hand unknown or sample thin).
  const vh = mlbHitsV2BatterVsHandHPerPa_(batterId, season, out.oppSpThrows);
  out.hpPaVsHand = vh.hpPaVsHand;
  out.hpPaSzn = vh.hpPaSzn;
  out.samplePa = vh.samplePa;

  // est_PA — start with season PA/game; refine with lineup spot later.
  out.paPerGameSzn = mlbHitsV2BatterPaPerGame_(batterId, season);
  out.estPa = out.paPerGameSzn;

  // Compose base + λ. base already encodes vs-hand and est_PA.
  if (!isNaN(out.hpPaVsHand) && out.hpPaVsHand > 0 && out.estPa > 0) {
    out.base = out.hpPaVsHand * out.estPa;
    out.lambda = out.base * out.parkMult * out.oppMult;
    // 🧪 v2.avg shadow λ — same composition with oppMult swapped for oppAvgMult.
    out.lambdaAvg = out.base * out.parkMult * out.oppAvgMult;
    out.lambda = Math.round(out.lambda * 1000) / 1000;
    out.lambdaAvg = Math.round(out.lambdaAvg * 1000) / 1000;
    out.base = Math.round(out.base * 1000) / 1000;
  }

  // Ablation multipliers (already inside base; logged so panel can back them out).
  if (!isNaN(out.hpPaSzn) && out.hpPaSzn > 0 && !isNaN(out.hpPaVsHand) && out.hpPaVsHand > 0) {
    let hm = out.hpPaVsHand / out.hpPaSzn;
    hm = Math.max(MLB_HITS_V2_HAND_MULT_MIN, Math.min(MLB_HITS_V2_HAND_MULT_MAX, hm));
    out.handMult = Math.round(hm * 1000) / 1000;
  }
  if (!isNaN(out.paPerGameSzn) && out.paPerGameSzn > 0 && !isNaN(out.estPa)) {
    out.abMult = Math.round((out.estPa / out.paPerGameSzn) * 1000) / 1000;
  }

  return out;
}

// --- card builder ---------------------------------------------------------

function mlbFlagsHitsV2Card_(injuryStatus, notes, hasModel) {
  const f = [];
  const inj = String(injuryStatus || '').toLowerCase();
  if (inj.indexOf('out') !== -1 || inj.indexOf('doubtful') !== -1) f.push('injury');
  const n = String(notes || '');
  if (n.indexOf('schedule_game_miss') !== -1) f.push('join_risk');
  if (n.indexOf('id_miss') !== -1) f.push('id_miss');
  if (n.indexOf('opp_sp_miss') !== -1) f.push('no_opp_sp');
  if (!hasModel) f.push('no_model');
  return f.join('; ');
}

function refreshBatterHitsV2BetCard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig();
  const season = mlbSlateSeasonYear_(cfg);
  mlbResetHitsV2Caches_();

  const inj = mlbLoadInjuryLookup_(ss);
  const agg = mlbCollectBatterHitsOddsRows_(ss);
  const gamePkMap = mlbBuildOddsGameNormToGamePk_(ss);

  const out = [];

  Object.keys(agg).forEach(function (key) {
    const entry = agg[key];
    const gamePk = mlbResolveGamePkFromFdGameLabel_(ss, entry.gameLabel, gamePkMap);
    let matchup = '';
    let hpUmp = '';
    let note = '';
    if (!gamePk) {
      note = 'schedule_game_miss';
    } else {
      const meta = mlbScheduleMetaForGamePk_(ss, gamePk);
      matchup = meta.matchup;
      hpUmp = meta.hpUmp;
    }

    const pm = entry.pointMap;
    const mainPt = mlbPickMainKPoint_(pm);
    const px = mlbMainKPrices_(pm, mainPt);

    const pidNum = mlbStatsApiResolvePlayerIdFromName_(entry.displayName);
    if (isNaN(pidNum) || !pidNum) {
      note = note ? note + '; id_miss' : 'id_miss';
    }

    let row = null;
    let hotCold = '';
    if (gamePk && !isNaN(pidNum) && pidNum) {
      row = mlbHitsV2ComputeRow_(ss, gamePk, pidNum, season, cfg);
      if (!row.oppSpId) {
        note = note ? note + '; opp_sp_miss' : 'opp_sp_miss';
      }
      // Reuse v1 queue's hot/cold logic so BetCard borders match v1 semantics.
      try {
        const hs = mlbHittingHitsSummary_(pidNum, season);
        hotCold = hs.hotCold || '';
      } catch (e) {}
    }

    const lambdaDisp = row && !isNaN(row.lambda) ? row.lambda : '';
    const edge =
      lambdaDisp !== '' && !isNaN(parseFloat(mainPt))
        ? Math.round((lambdaDisp - parseFloat(mainPt)) * 1000) / 1000
        : '';

    const lineNum = parseFloat(mainPt, 10);
    const hasModel = lambdaDisp !== '' && lambdaDisp > 0 && !isNaN(lineNum);
    const pu = hasModel ? mlbProbOverUnderK_(mainPt, lambdaDisp) : { pOver: '', pUnder: '' };
    const pOver = pu.pOver === '' ? '' : Math.round(pu.pOver * 1000) / 1000;
    const pUnder = pu.pUnder === '' ? '' : Math.round(pu.pUnder * 1000) / 1000;

    const imO = mlbAmericanImplied_(px.over);
    const imU = mlbAmericanImplied_(px.under);
    const evO = pOver !== '' && px.over !== '' ? mlbEvPerDollarRisked_(pOver, px.over) : '';
    const evU = pUnder !== '' && px.under !== '' ? mlbEvPerDollarRisked_(pUnder, px.under) : '';

    let bestSide = '';
    let bestEv = '';
    if (evO !== '' && evU !== '') {
      if (evO >= evU) {
        bestSide = 'Over';
        bestEv = evO;
      } else {
        bestSide = 'Under';
        bestEv = evU;
      }
    } else if (evO !== '') {
      bestSide = 'Over';
      bestEv = evO;
    } else if (evU !== '') {
      bestSide = 'Under';
      bestEv = evU;
    }

    const flags = mlbFlagsHitsV2Card_(
      inj[mlbNormalizePersonName_(entry.displayName)] || '',
      note,
      hasModel
    );

    out.push([
      gamePk || '',
      matchup,
      entry.displayName,
      mainPt != null ? mainPt : '',
      px.over,
      px.under,
      lambdaDisp,
      edge,
      pOver,
      pUnder,
      imO,
      imU,
      evO,
      evU,
      bestSide,
      bestEv,
      flags,
      pidNum && !isNaN(pidNum) ? pidNum : '',
      row ? row.base : '',
      row ? row.parkMult : '',
      row ? row.oppMult : '',
      row ? row.handMult : '',
      row ? row.abMult : '',
      row ? row.hpPaVsHand !== '' && !isNaN(row.hpPaVsHand) ? Math.round(row.hpPaVsHand * 10000) / 10000 : '' : '',
      row ? row.hpPaSzn !== '' && !isNaN(row.hpPaSzn) ? Math.round(row.hpPaSzn * 10000) / 10000 : '' : '',
      row ? Math.round((row.estPa || 0) * 100) / 100 : '',
      row ? row.samplePa : '',
      row ? row.oppSpName : '',
      row ? row.oppSpThrows : '',
      row ? row.oppH9 : '',
      row ? row.oppIp : '',
      'h.v2-full',
      hpUmp,
      hotCold,
      // 🧪 v2.avg shadow audit (cols 35..38). Live cols 1..34 above are untouched.
      row && !isNaN(row.lambdaAvg) ? row.lambdaAvg : '',
      row ? row.oppAvgMult : '',
      row ? row.oppAvg : '',
      row ? row.oppAb : '',
    ]);
  });

  out.sort(function (a, b) {
    const be = parseFloat(b[15], 10);
    const ae = parseFloat(a[15], 10);
    if (isNaN(be) && isNaN(ae)) return 0;
    if (isNaN(be)) return -1;
    if (isNaN(ae)) return 1;
    return be - ae;
  });

  let sh = ss.getSheetByName(MLB_BATTER_HITS_V2_CARD_TAB);
  if (sh) {
    sh.clearContents();
    sh.clearFormats();
  } else {
    sh = ss.insertSheet(MLB_BATTER_HITS_V2_CARD_TAB);
  }
  sh.setTabColor('#6a1b9a');
  // Default new sheets ship with 26 columns; this layout writes through col 38.
  // Cols 33-34 (hp_umpire, hot_cold) feed 🃏 MLB_Bet_Card. Cols 35-38 are the
  // 🧪 v2.avg shadow audit (BA-against denominator swap; not consumed downstream).
  // Expand BEFORE setColumnWidth(35..) or writer clears the sheet then crashes.
  const NEED_COLS = 38;
  if (sh.getMaxColumns() < NEED_COLS) {
    sh.insertColumnsAfter(sh.getMaxColumns(), NEED_COLS - sh.getMaxColumns());
  }

  const widths = [
    72, 200, 150, 56, 64, 64, 56, 56, 52, 52, 52, 52, 56, 56, 56, 56, 140, 88,
    56, 52, 52, 52, 52, 64, 64, 56, 56, 130, 44, 52, 44, 80, 140, 56,
    56, 52, 52, 56,
  ];
  widths.forEach(function (w, i) {
    sh.setColumnWidth(i + 1, w);
  });

  sh.getRange(1, 1, 1, NEED_COLS)
    .merge()
    .setValue(
      '🎯 Batter Hits v2 (LIVE) — λ = H/PA(vs hand) × est_PA × park_H × opp_SP_H/9; feeds 🃏 MLB_Bet_Card. Cols 35..38 = 🧪 v2.avg shadow (BA-against swap, audit only).'
    )
    .setFontWeight('bold')
    .setBackground('#4a148c')
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center')
    .setWrap(true);
  sh.setRowHeight(1, 34);

  const headers = [
    'gamePk',
    'matchup',
    'batter',
    'fd_hits_line',
    'fd_over',
    'fd_under',
    'lambda_H_v2',
    'edge_vs_line',
    'p_over',
    'p_under',
    'implied_over',
    'implied_under',
    'ev_over_$1',
    'ev_under_$1',
    'best_side',
    'best_ev_$1',
    'flags',
    'batter_id',
    'base_lambda',
    'park_mult',
    'opp_sp_mult',
    'hand_mult',
    'ab_mult',
    'h_per_pa_vs_hand',
    'h_per_pa_szn',
    'est_pa',
    'vs_hand_sample_pa',
    'opp_sp_name',
    'opp_sp_throws',
    'opp_sp_h9',
    'opp_sp_ip',
    'model_version',
    'hp_umpire',
    'hot_cold',
    'lambda_H_v2_avg',
    'opp_sp_avg_mult',
    'opp_sp_avg',
    'opp_sp_ab',
  ];
  sh.getRange(3, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight('bold')
    .setBackground('#7b1fa2')
    .setFontColor('#ffffff');
  sh.setFrozenRows(3);

  if (out.length) {
    sh.getRange(4, 1, out.length, headers.length).setValues(out);
    try {
      ss.setNamedRange('MLB_BATTER_HITS_V2_CARD', sh.getRange(4, 1, out.length, headers.length));
    } catch (e) {}
  }

  ss.toast(out.length + ' v2 rows · sorted by best_ev', 'Batter Hits v2 card', 6);
}
