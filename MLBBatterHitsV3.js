// ============================================================
// 🧪 Batter Hits v3-contact (shadow) — v2 + batter K-rate + SP K/9 + Streak overlap
// ============================================================
// Power doesn't drive hits — contact does. Strikeouts are dead-PA: the
// ball never touches a fielder, no hit lottery. v3 stacks three contact
// signals on top of h.v2-full:
//
//   k_rate_mult         = league K/PA  ÷  batter K/PA   (PA-shrunk, INVERSE)
//   opp_sp_k9_mult      = league K/9    ÷  SP K/9       (IP-shrunk, INVERSE)
//   streak_overlap_mult = 1.10 if batter is on 🔥 Streak_Picks today, else 1.00
//
// "Inverse" = high K rate hurts contact, so the multiplier goes DOWN
// (numerator/denominator flip vs v3 TB's power mults). League K/PA ~0.225,
// league K/9 ~8.7.
//
// Composition: λ_v3 = λ_v2 × k_rate_mult × opp_sp_k9_mult × streak_overlap_mult
//
// v2 stays untouched. v3 lives at:
//   🧪 Batter_Hits_Card_v3-contact         (per-batter rows + all mults)
//   🧪 MLB_Results_Log_v3 (snapshot)       (graded separately)
//
// All three new mults clamped to [0.85, 1.20] so any single feature can
// move λ ≤ ±20%.
// ============================================================

const MLB_BATTER_HITS_V3_CARD_TAB = '🧪 Batter_Hits_Card_v3-contact';
const MLB_HITS_V3_DEFAULT_LEAGUE_K_PER_PA = 0.225;
const MLB_HITS_V3_DEFAULT_LEAGUE_K_PER_9 = 8.7;
const MLB_HITS_V3_DEFAULT_STREAK_OVERLAP_MULT = 1.10;
const MLB_HITS_V3_K_PER_PA_SHRINK = 100;
const MLB_HITS_V3_K_PER_9_SHRINK_IP = 20;
const MLB_HITS_V3_MULT_MIN = 0.85;
const MLB_HITS_V3_MULT_MAX = 1.20;
// 🧪 v3.deadpa shadow — opp SP (BB+HBP)/BF mult. Complements opp_sp_k9_mult:
// K/9 captures dead PAs from strikeouts, this captures dead PAs from walks &
// HBPs. Both shrink hit-eligible PAs but via different channels — independent
// signals, no double-count. INVERSE: high SP BB rate → mult < 1.
const MLB_HITS_V3_DEFAULT_LEAGUE_BB_HBP_RATE = 0.085;
const MLB_HITS_V3_BB_HBP_SHRINK_BF = 100;

var __mlbHitsV3StreakIdsCacheKey = '';
var __mlbHitsV3StreakIdsCache = {};

function mlbResetHitsV3Caches_() {
  __mlbHitsV3StreakIdsCacheKey = '';
  __mlbHitsV3StreakIdsCache = {};
  // NOTE: we deliberately do NOT wipe the shared batter/pitcher fetch cache
  // here. Hits v2 runs earlier in the pipeline and warms it; resetting here
  // would re-fetch every batter from scratch. Slate-start reset is in
  // mlbResetV3SharedFetchesCaches_ only.
}

// --- batter K-rate (inverse) multiplier ---------------------------------
// Pulls from the shared v3 season-hitting fetch so tb.v3's ISO calc and
// h.v3's K-rate calc share one statsapi hit per batter.

function mlbHitsV3BatterKRateMult_(playerId, season, leagueKPerPa) {
  const stat = mlbV3FetchBatterSeasonHitting_(playerId, season);
  if (stat.pa <= 0 || isNaN(stat.k)) return { mult: 1, kPerPa: '', samplePa: 0 };
  const kPerPa = stat.k / stat.pa;
  // Shrink batter K/PA toward league prior.
  const k = MLB_HITS_V3_K_PER_PA_SHRINK;
  const shrunk = (kPerPa * stat.pa + leagueKPerPa * k) / (stat.pa + k);
  // INVERSE: low K → high mult.
  let mult = leagueKPerPa / shrunk;
  mult = Math.max(MLB_HITS_V3_MULT_MIN, Math.min(MLB_HITS_V3_MULT_MAX, mult));
  return {
    mult: Math.round(mult * 1000) / 1000,
    kPerPa: Math.round(kPerPa * 10000) / 10000,
    samplePa: stat.pa,
  };
}

// --- opposing SP K/9 (inverse) multiplier --------------------------------
// Pulls from the shared v3 pitcher fetch so tb.v3's HR/9 and h.v3's K/9
// share one statsapi hit per opposing SP.

function mlbHitsV3OpposingK9Mult_(pitcherId, season, leagueK9, minIp) {
  const stat = mlbV3FetchPitcherSeasonPitching_(pitcherId, season);
  const ipFloor = minIp > 0 ? minIp : 10;
  if (isNaN(stat.k) || stat.ip < ipFloor) return { mult: 1, k9: '', ip: '' };
  const rawK9 = (stat.k * 9) / stat.ip;
  const kp = MLB_HITS_V3_K_PER_9_SHRINK_IP;
  // IP-weighted shrinkage to league K/9.
  const shrunkK9 = (stat.k + leagueK9 * (kp / 9)) / ((stat.ip + kp) / 9);
  // INVERSE: high SP K/9 → low mult (fewer balls in play = fewer hits).
  let mult = leagueK9 / shrunkK9;
  mult = Math.max(MLB_HITS_V3_MULT_MIN, Math.min(MLB_HITS_V3_MULT_MAX, mult));
  return {
    mult: Math.round(mult * 1000) / 1000,
    k9: Math.round(rawK9 * 100) / 100,
    ip: Math.round(stat.ip * 10) / 10,
  };
}

// --- opposing SP (BB+HBP)/BF (inverse) multiplier — v3.deadpa shadow ----
// Same shared pitcher fetch as opp_sp_k9_mult (no extra API call).
// Shrinkage in BF units; clamps to v3 mult rails.

function mlbHitsV3OpposingBbHbpMult_(pitcherId, season, leagueRate, minIp) {
  const stat = mlbSharedFetchPitcherSeasonPitching_(pitcherId, season);
  const ipFloor = minIp > 0 ? minIp : 10;
  if (isNaN(stat.bb) || isNaN(stat.bf) || stat.bf <= 0 || stat.ip < ipFloor) {
    return { mult: 1, rate: '', bf: '' };
  }
  const hbp = isNaN(stat.hbp) ? 0 : stat.hbp;
  const rawRate = (stat.bb + hbp) / stat.bf;
  const k = MLB_HITS_V3_BB_HBP_SHRINK_BF;
  // BF-weighted shrinkage to league rate.
  const shrunk = ((stat.bb + hbp) + leagueRate * k) / (stat.bf + k);
  // INVERSE: high SP BB+HBP → mult < 1 (PAs that don't end in a hit chance).
  let mult = leagueRate / shrunk;
  mult = Math.max(MLB_HITS_V3_MULT_MIN, Math.min(MLB_HITS_V3_MULT_MAX, mult));
  return {
    mult: Math.round(mult * 1000) / 1000,
    rate: Math.round(rawRate * 1000) / 1000,
    bf: stat.bf,
  };
}

// --- Streak Picks overlap -----------------------------------------------

function mlbHitsV3LoadStreakBatterIds_(ss) {
  const sh = ss.getSheetByName(typeof MLB_STREAK_PICKS_TAB !== 'undefined' ? MLB_STREAK_PICKS_TAB : '🔥 Streak_Picks');
  if (!sh || sh.getLastRow() < 4) return {};
  const cacheKey = sh.getLastRow() + ':' + sh.getLastColumn();
  if (cacheKey === __mlbHitsV3StreakIdsCacheKey) return __mlbHitsV3StreakIdsCache;

  const ncol = Math.max(1, sh.getLastColumn());
  const headers = sh.getRange(3, 1, 1, ncol).getValues()[0].map(function (h) {
    return String(h || '').trim().toLowerCase();
  });
  let idCol = headers.indexOf('batter_id');
  if (idCol < 0) idCol = headers.indexOf('player_id');
  if (idCol < 0) return {};

  const last = sh.getLastRow();
  const data = sh.getRange(4, idCol + 1, last - 3, 1).getValues();
  const ids = {};
  for (let i = 0; i < data.length; i++) {
    const v = parseInt(data[i][0], 10);
    if (!isNaN(v) && v > 0) ids[v] = true;
  }
  __mlbHitsV3StreakIdsCache = ids;
  __mlbHitsV3StreakIdsCacheKey = cacheKey;
  return ids;
}

function mlbHitsV3StreakOverlapMult_(ss, batterId, overlapMultCfg) {
  const id = parseInt(batterId, 10);
  if (!id) return { mult: 1, onStreak: false };
  const ids = mlbHitsV3LoadStreakBatterIds_(ss);
  if (!ids[id]) return { mult: 1, onStreak: false };
  let m = overlapMultCfg;
  if (isNaN(m) || m <= 0) m = MLB_HITS_V3_DEFAULT_STREAK_OVERLAP_MULT;
  m = Math.max(MLB_HITS_V3_MULT_MIN, Math.min(MLB_HITS_V3_MULT_MAX, m));
  return { mult: Math.round(m * 1000) / 1000, onStreak: true };
}

// --- composer ------------------------------------------------------------

function mlbHitsV3ComputeRow_(ss, gamePk, batterId, season, cfg) {
  const v2 = mlbHitsV2ComputeRow_(ss, gamePk, batterId, season, cfg);

  const leagueKPerPa = parseFloat(String(
    cfg['HITS_V3_LEAGUE_K_PER_PA'] != null ? cfg['HITS_V3_LEAGUE_K_PER_PA'] : MLB_HITS_V3_DEFAULT_LEAGUE_K_PER_PA
  ), 10);
  const lKpa = !isNaN(leagueKPerPa) && leagueKPerPa > 0 ? leagueKPerPa : MLB_HITS_V3_DEFAULT_LEAGUE_K_PER_PA;

  const leagueK9 = parseFloat(String(
    cfg['HITS_V3_LEAGUE_K_PER_9'] != null ? cfg['HITS_V3_LEAGUE_K_PER_9'] : MLB_HITS_V3_DEFAULT_LEAGUE_K_PER_9
  ), 10);
  const lK9 = !isNaN(leagueK9) && leagueK9 > 0 ? leagueK9 : MLB_HITS_V3_DEFAULT_LEAGUE_K_PER_9;

  const streakCfg = parseFloat(String(
    cfg['HITS_V3_STREAK_OVERLAP_MULT'] != null ? cfg['HITS_V3_STREAK_OVERLAP_MULT'] : MLB_HITS_V3_DEFAULT_STREAK_OVERLAP_MULT
  ), 10);

  const kr = mlbHitsV3BatterKRateMult_(batterId, season, lKpa);
  const sk = v2.oppSpId
    ? mlbHitsV3OpposingK9Mult_(v2.oppSpId, season, lK9, mlbOppSpMinIp_(cfg))
    : { mult: 1, k9: '', ip: '' };
  const streak = mlbHitsV3StreakOverlapMult_(ss, batterId, streakCfg);

  // 🧪 v3.deadpa shadow — opp SP (BB+HBP)/BF multiplier. Computed alongside
  // K/9 mult (same shared pitcher fetch). Not applied to live v3 λ — audit-only
  // so we can grade λ_v3 vs λ_v3.deadpa side-by-side before promoting.
  const leagueBbHbpCfg = parseFloat(String(
    cfg['HITS_V3_LEAGUE_BB_HBP_RATE'] != null ? cfg['HITS_V3_LEAGUE_BB_HBP_RATE'] : MLB_HITS_V3_DEFAULT_LEAGUE_BB_HBP_RATE
  ), 10);
  const lgBbHbp = !isNaN(leagueBbHbpCfg) && leagueBbHbpCfg > 0
    ? leagueBbHbpCfg
    : MLB_HITS_V3_DEFAULT_LEAGUE_BB_HBP_RATE;
  const sbb = v2.oppSpId
    ? mlbHitsV3OpposingBbHbpMult_(v2.oppSpId, season, lgBbHbp, mlbOppSpMinIp_(cfg))
    : { mult: 1, rate: '', bf: '' };

  const out = {
    v2: v2,
    lambda: NaN,
    kRateMult: kr.mult,
    batterKPerPa: kr.kPerPa,
    kRateSamplePa: kr.samplePa,
    oppK9Mult: sk.mult,
    oppK9: sk.k9,
    oppK9Ip: sk.ip,
    streakMult: streak.mult,
    onStreak: streak.onStreak,
    // 🧪 v3.deadpa shadow audit fields.
    oppBbHbpMult: sbb.mult,
    oppBbHbpRate: sbb.rate,
    oppBbHbpBf: sbb.bf,
    lambdaDeadpa: NaN,
  };

  if (!isNaN(v2.lambda) && v2.lambda > 0) {
    const lam = v2.lambda * kr.mult * sk.mult * streak.mult;
    out.lambda = Math.round(lam * 1000) / 1000;
    // Shadow λ = same composition × extra BB+HBP mult.
    out.lambdaDeadpa = Math.round(lam * sbb.mult * 1000) / 1000;
  }
  return out;
}

// --- card builder --------------------------------------------------------

function mlbFlagsHitsV3Card_(injuryStatus, notes, hasModel) {
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

function refreshBatterHitsV3BetCard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig();
  const season = mlbSlateSeasonYear_(cfg);
  // v2 caches drive base-λ. v3 caches drive extras. Reset both.
  mlbResetHitsV2Caches_();
  mlbResetHitsV3Caches_();

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
      row = mlbHitsV3ComputeRow_(ss, gamePk, pidNum, season, cfg);
      if (!row.v2.oppSpId) {
        note = note ? note + '; opp_sp_miss' : 'opp_sp_miss';
      }
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
      if (evO >= evU) { bestSide = 'Over';  bestEv = evO; }
      else            { bestSide = 'Under'; bestEv = evU; }
    } else if (evO !== '') { bestSide = 'Over';  bestEv = evO; }
    else if (evU !== '')   { bestSide = 'Under'; bestEv = evU; }

    const flags = mlbFlagsHitsV3Card_(
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
      // v2 audit
      row ? row.v2.base : '',
      row ? row.v2.parkMult : '',
      row ? row.v2.oppMult : '',
      row ? row.v2.handMult : '',
      row ? row.v2.abMult : '',
      // v3 add-on mults
      row ? row.kRateMult : '',
      row ? row.oppK9Mult : '',
      row ? row.streakMult : '',
      // v3 audit
      row ? row.batterKPerPa : '',
      row ? row.kRateSamplePa : '',
      row ? row.oppK9 : '',
      row ? row.oppK9Ip : '',
      row && row.onStreak ? 'Y' : 'N',
      row ? row.v2.oppSpName : '',
      row ? row.v2.oppSpThrows : '',
      'h.v3-contact',
      hpUmp,
      hotCold,
      // 🧪 v3.deadpa shadow audit (4 cols).
      row && !isNaN(row.lambdaDeadpa) ? row.lambdaDeadpa : '',
      row ? row.oppBbHbpMult : '',
      row ? row.oppBbHbpRate : '',
      row ? row.oppBbHbpBf : '',
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

  let sh = ss.getSheetByName(MLB_BATTER_HITS_V3_CARD_TAB);
  if (sh) {
    sh.clearContents();
    sh.clearFormats();
  } else {
    sh = ss.insertSheet(MLB_BATTER_HITS_V3_CARD_TAB);
  }
  sh.setTabColor('#0d47a1');

  const headers = [
    'gamePk', 'matchup', 'batter', 'fd_hits_line', 'fd_over', 'fd_under',
    'lambda_H_v3', 'edge_vs_line', 'p_over', 'p_under', 'implied_over', 'implied_under',
    'ev_over_$1', 'ev_under_$1', 'best_side', 'best_ev_$1', 'flags', 'batter_id',
    // v2 audit
    'base_lambda', 'park_mult', 'opp_sp_h9_mult', 'hand_mult', 'ab_mult',
    // v3 mults (inverse — high = boost, low = penalty)
    'k_rate_mult', 'opp_sp_k9_mult', 'streak_overlap_mult',
    // v3 audit
    'batter_k_per_pa', 'k_rate_sample_pa', 'opp_sp_k9', 'opp_sp_k9_ip', 'on_streak',
    'opp_sp_name', 'opp_sp_throws',
    'model_version', 'hp_umpire', 'hot_cold',
    // 🧪 v3.deadpa shadow audit (opp SP BB+HBP rate channel)
    'lambda_H_v3_deadpa', 'opp_sp_bb_hbp_mult', 'opp_sp_bb_hbp_rate', 'opp_sp_bf',
  ];
  const NEED_COLS = headers.length;
  if (sh.getMaxColumns() < NEED_COLS) {
    sh.insertColumnsAfter(sh.getMaxColumns(), NEED_COLS - sh.getMaxColumns());
  }

  // Same widths schema as TB v3 for visual consistency. Tail 4 widths = v3.deadpa shadow.
  const widths = [
    72, 200, 150, 56, 64, 64, 56, 56, 52, 52, 52, 52, 56, 56, 56, 56, 140, 88,
    56, 52, 64, 52, 52,
    56, 64, 64,
    64, 56, 56, 52, 60,
    130, 44,
    80, 56, 56,
    64, 64, 64, 56,
  ];
  widths.forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });

  sh.getRange(1, 1, 1, NEED_COLS)
    .merge()
    .setValue(
      '🧪 Batter Hits v3-contact (shadow) — λ_v3 = λ_v2 × batter_K-rate(inv) × opp_SP_K/9(inv) × Streak overlap; mults audited per row. Tail 4 cols = 🧪 v3.deadpa (opp SP BB+HBP rate; audit only).'
    )
    .setFontWeight('bold')
    .setBackground('#1565c0')
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center')
    .setWrap(true);
  sh.setRowHeight(1, 34);

  sh.getRange(3, 1, 1, NEED_COLS)
    .setValues([headers])
    .setFontWeight('bold')
    .setBackground('#0d47a1')
    .setFontColor('#ffffff');
  sh.setFrozenRows(3);

  if (out.length) {
    sh.getRange(4, 1, out.length, NEED_COLS).setValues(out);
    try {
      ss.setNamedRange('MLB_BATTER_HITS_V3_CARD', sh.getRange(4, 1, out.length, NEED_COLS));
    } catch (e) {}
  }

  ss.toast(out.length + ' Hits v3 rows · sorted by best_ev', 'Batter Hits v3 (shadow)', 6);
}
