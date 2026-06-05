// ============================================================
// 🧪 Batter TB v2 (shadow) — vs-hand × est_PA × park_TB × opp_SP_TB/9
// ============================================================
// Independent shadow model. Picks its own best_side per row. Does NOT
// affect the live Bet Card. Writes:
//   - 🧪 Batter_TB_Card_v2-full           (per-batter rows + multipliers)
//   - 🧪 MLB_Results_Log_TB_v2 (via snapshot) (graded separately)
// ============================================================
// Composition (mirror of Hits v2):
//   base   = TB_per_PA_vs_hand × est_PA
//   λ_v2   = base × park_TB × opp_SP_mult
// Recorded multipliers (for ablation in a future compare panel):
//   park_mult = park_TB (BABIP+SLG-leaning, see MLBParkFactors.js)
//   opp_mult  = SP TB/9 vs league, IP-shrunk toward 1.0
//   hand_mult = vs-hand TB/PA ÷ season TB/PA   (already inside base; logged)
//   ab_mult   = est_PA ÷ season PA/G           (already inside base; logged)
// ============================================================

const MLB_BATTER_TB_V2_CARD_TAB = '🧪 Batter_TB_Card_v2-full';
const MLB_TB_V2_DEFAULT_LEAGUE_TB_PER_9 = 2.65;
const MLB_TB_V2_DEFAULT_LEAGUE_TB_PER_PA = 0.40;
const MLB_TB_V2_DEFAULT_PA_PER_GAME = 4.2;
// Shrinkage priors (in PA / IP units of the prior).
const MLB_TB_V2_VS_HAND_SHRINK_PA = 60;
const MLB_TB_V2_OPP_SP_SHRINK_IP = 20;
// Multiplier safety rails.
const MLB_TB_V2_OPP_MULT_MIN = 0.85;
const MLB_TB_V2_OPP_MULT_MAX = 1.15;
const MLB_TB_V2_HAND_MULT_MIN = 0.8;
const MLB_TB_V2_HAND_MULT_MAX = 1.25;

var __mlbTbV2PitcherThrowsCache = {};
var __mlbTbV2PitcherTbRateCache = {};
var __mlbTbV2BatterVsHandCache = {};
var __mlbTbV2BatterTeamAbbrCache = {};

function mlbResetTbV2Caches_() {
  __mlbTbV2PitcherThrowsCache = {};
  __mlbTbV2PitcherTbRateCache = {};
  __mlbTbV2BatterVsHandCache = {};
  __mlbTbV2BatterTeamAbbrCache = {};
}

// --- batter team affiliation ----------------------------------------------

function mlbTbV2BatterTeamAbbr_(playerId) {
  return mlbSharedFetchBatterTeamAbbr_(playerId);
}

// --- opposing probable starter -------------------------------------------

function mlbTbV2OpposingProbableSp_(ss, gamePk, batterTeamAbbr) {
  return mlbGetOpposingProbableSp_(ss, gamePk, batterTeamAbbr);
}

function mlbTbV2PitcherThrows_(pitcherId) {
  return mlbSharedFetchPitcherThrows_(pitcherId);
}

// --- opposing SP TB/9 multiplier (shrunk) --------------------------------

/**
 * Stat API exposes stat.totalBases on pitcher season splits. We trust it when
 * present; if blank, derive from hits + extra-base hits inline so we don't
 * silently fall back to neutral on every row when the API gap appears.
 */
function mlbTbV2DerivedSpTotalBases_(stat) {
  const h  = parseInt(stat.hits, 10);
  if (isNaN(h) || h < 0) return NaN;
  const d  = parseInt(stat.doubles, 10) || 0;
  const t  = parseInt(stat.triples, 10) || 0;
  const hr = parseInt(stat.homeRuns, 10) || 0;
  const singles = Math.max(0, h - d - t - hr);
  return singles + 2 * d + 3 * t + 4 * hr;
}

function mlbTbV2OpposingTbRateMult_(pitcherId, season, leagueTbPer9, minIp) {
  // Shared pitcher cache — Hits v2's H/9 calc, v3 K/9 + HR/9, and HR
  // Promo's HR/9 all read from this single fetch.
  const stat = mlbSharedFetchPitcherSeasonPitching_(pitcherId, season);
  const ipFloor = minIp > 0 ? minIp : 10;
  if (isNaN(stat.tb) || stat.ip < ipFloor) return { mult: 1, tb9: '', ip: '' };
  const rawTb9 = (stat.tb * 9) / stat.ip;
  const k = MLB_TB_V2_OPP_SP_SHRINK_IP;
  const shrunkTb9 = (stat.tb + leagueTbPer9 * (k / 9)) / ((stat.ip + k) / 9);
  let mult = shrunkTb9 / leagueTbPer9;
  mult = Math.max(MLB_TB_V2_OPP_MULT_MIN, Math.min(MLB_TB_V2_OPP_MULT_MAX, mult));
  return {
    mult: Math.round(mult * 1000) / 1000,
    tb9: Math.round(rawTb9 * 100) / 100,
    ip: Math.round(stat.ip * 10) / 10,
  };
}

// --- batter vs-hand TB/PA (shrunk to season) -----------------------------

function mlbTbV2BatterVsHandTbPerPa_(playerId, season, throwsHand, leagueTbPerPa) {
  const id = parseInt(playerId, 10);
  if (!id) {
    return { tbPaVsHand: NaN, tbPaSzn: NaN, samplePa: 0, hand: '' };
  }
  const hand = String(throwsHand || '').trim().toUpperCase();
  // Shared cache: same URL as Hits v2's vs-hand fetch (one statsapi call
  // per batter serves both H and TB derivations).
  const data = mlbSharedFetchBatterHittingSplitsAndSeason_(id, season);
  function tbOf(st) {
    let tb = st && st.totalBases != null ? parseInt(st.totalBases, 10) : NaN;
    if (isNaN(tb) && st) tb = mlbTbV2DerivedSpTotalBases_(st);
    return tb || 0;
  }
  const vlTb = tbOf(data.vl);
  const vlPa = parseInt(data.vl.plateAppearances, 10) || 0;
  const vrTb = tbOf(data.vr);
  const vrPa = parseInt(data.vr.plateAppearances, 10) || 0;
  const sznTb = tbOf(data.szn);
  const sznPa = parseInt(data.szn.plateAppearances, 10) || 0;

  const tbPaSzn = sznPa > 0 ? sznTb / sznPa : NaN;
  let split = null;
  if (hand === 'L')      split = { tb: vlTb, pa: vlPa };
  else if (hand === 'R') split = { tb: vrTb, pa: vrPa };
  if (!split || split.pa <= 0) {
    return { tbPaVsHand: tbPaSzn, tbPaSzn: tbPaSzn, samplePa: 0, hand: hand };
  }
  const priorTbPa = !isNaN(tbPaSzn) ? tbPaSzn : leagueTbPerPa;
  const k = MLB_TB_V2_VS_HAND_SHRINK_PA;
  const tbPaVsHand = (split.tb + priorTbPa * k) / (split.pa + k);
  return { tbPaVsHand: tbPaVsHand, tbPaSzn: tbPaSzn, samplePa: split.pa, hand: hand };
}

// --- est_PA per game -----------------------------------------------------
// Reuses Hits v2's per-batter PA/game (cached). If Hits v2 hasn't been touched
// in this run, the gameLog cache primes here.

function mlbTbV2BatterPaPerGame_(playerId, season) {
  // mlbHitsV2BatterPaPerGame_ lives in MLBBatterHitsV2.js — both v2 models
  // share the same per-batter PA/G; no need to duplicate.
  return mlbHitsV2BatterPaPerGame_(playerId, season);
}

// --- hot/cold (inline calc — independent of live TB queue) ---------------

function mlbTbV2HotColdForBatter_(playerId, season) {
  const id = parseInt(playerId, 10);
  if (!id) return '';
  try {
    const splits = mlbStatsApiGetHittingGameSplits_(id, season);
    if (!splits || splits.length < 10) return '';
    let totTb = 0;
    let l5tb = 0;
    const l5n = Math.min(5, splits.length);
    for (let i = 0; i < splits.length; i++) {
      const st = splits[i].stat || {};
      let tb = st.totalBases != null ? parseInt(st.totalBases, 10) : NaN;
      if (isNaN(tb)) tb = mlbTbV2DerivedSpTotalBases_(st);
      tb = tb || 0;
      totTb += tb;
      if (i < l5n) l5tb += tb;
    }
    if (l5n < 5) return '';
    const sznAvg = splits.length > 0 ? totTb / splits.length : 0;
    const l5Avg = l5tb / l5n;
    return mlbHotColdFlag_(l5Avg, sznAvg);
  } catch (e) {
    return '';
  }
}

// --- composer ------------------------------------------------------------

function mlbTbV2ComputeRow_(ss, gamePk, batterId, season, cfg) {
  const out = {
    lambda: NaN, base: NaN,
    parkMult: 1, oppMult: 1, handMult: 1, abMult: 1,
    tbPaVsHand: NaN, tbPaSzn: NaN, samplePa: 0,
    estPa: NaN, paPerGameSzn: NaN,
    oppSpId: '', oppSpName: '', oppSpThrows: '',
    oppTb9: '', oppIp: '',
  };

  const leagueTb9 = parseFloat(String(cfg['TB_V2_LEAGUE_TB_PER_9'] != null ? cfg['TB_V2_LEAGUE_TB_PER_9'] : MLB_TB_V2_DEFAULT_LEAGUE_TB_PER_9), 10);
  const leagueTbPa = parseFloat(String(cfg['TB_V2_LEAGUE_TB_PER_PA'] != null ? cfg['TB_V2_LEAGUE_TB_PER_PA'] : MLB_TB_V2_DEFAULT_LEAGUE_TB_PER_PA), 10);
  const lTb9 = !isNaN(leagueTb9) && leagueTb9 > 0 ? leagueTb9 : MLB_TB_V2_DEFAULT_LEAGUE_TB_PER_9;
  const lTbPa = !isNaN(leagueTbPa) && leagueTbPa > 0 ? leagueTbPa : MLB_TB_V2_DEFAULT_LEAGUE_TB_PER_PA;

  // Park (TB).
  const homeAbbr = mlbScheduleHomeAbbrForGamePk_(ss, gamePk);
  out.parkMult = mlbParkTbLambdaMultForHomeAbbr_(homeAbbr);

  // Pre-warm hitting splits — populates team-abbr cache as a side-effect so
  // the team-abbr lookup below reads from cache (no extra API call needed).
  mlbSharedFetchBatterHittingSplitsAndSeason_(batterId, season);

  // Opposing SP via batter team affiliation.
  const batterAbbr = mlbTbV2BatterTeamAbbr_(batterId);
  const oppSp = batterAbbr ? mlbTbV2OpposingProbableSp_(ss, gamePk, batterAbbr) : null;
  if (oppSp) {
    out.oppSpId = oppSp.id || '';
    out.oppSpName = oppSp.name || '';
    out.oppSpThrows = mlbTbV2PitcherThrows_(oppSp.id);
    const opp = mlbTbV2OpposingTbRateMult_(oppSp.id, season, lTb9, mlbOppSpMinIp_(cfg));
    out.oppMult = opp.mult;
    out.oppTb9 = opp.tb9;
    out.oppIp = opp.ip;
  }

  // vs-hand TB/PA.
  const vh = mlbTbV2BatterVsHandTbPerPa_(batterId, season, out.oppSpThrows, lTbPa);
  out.tbPaVsHand = vh.tbPaVsHand;
  out.tbPaSzn = vh.tbPaSzn;
  out.samplePa = vh.samplePa;

  // est_PA.
  out.paPerGameSzn = mlbTbV2BatterPaPerGame_(batterId, season);
  out.estPa = out.paPerGameSzn;

  // Compose.
  if (!isNaN(out.tbPaVsHand) && out.tbPaVsHand > 0 && out.estPa > 0) {
    out.base = out.tbPaVsHand * out.estPa;
    out.lambda = out.base * out.parkMult * out.oppMult;
    out.lambda = Math.round(out.lambda * 1000) / 1000;
    out.base = Math.round(out.base * 1000) / 1000;
  }

  if (!isNaN(out.tbPaSzn) && out.tbPaSzn > 0 && !isNaN(out.tbPaVsHand) && out.tbPaVsHand > 0) {
    let hm = out.tbPaVsHand / out.tbPaSzn;
    hm = Math.max(MLB_TB_V2_HAND_MULT_MIN, Math.min(MLB_TB_V2_HAND_MULT_MAX, hm));
    out.handMult = Math.round(hm * 1000) / 1000;
  }
  if (!isNaN(out.paPerGameSzn) && out.paPerGameSzn > 0 && !isNaN(out.estPa)) {
    out.abMult = Math.round((out.estPa / out.paPerGameSzn) * 1000) / 1000;
  }

  return out;
}

// --- card builder --------------------------------------------------------

function mlbFlagsTbV2Card_(injuryStatus, notes, hasModel) {
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

function refreshBatterTBV2BetCard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig();
  const season = mlbSlateSeasonYear_(cfg);
  mlbResetTbV2Caches_();

  const inj = mlbLoadInjuryLookup_(ss);
  const agg = mlbCollectBatterTbOddsRows_(ss);
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
      row = mlbTbV2ComputeRow_(ss, gamePk, pidNum, season, cfg);
      if (!row.oppSpId) {
        note = note ? note + '; opp_sp_miss' : 'opp_sp_miss';
      }
      hotCold = mlbTbV2HotColdForBatter_(pidNum, season);
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

    const flags = mlbFlagsTbV2Card_(
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
      row && !isNaN(row.tbPaVsHand) ? Math.round(row.tbPaVsHand * 10000) / 10000 : '',
      row && !isNaN(row.tbPaSzn)    ? Math.round(row.tbPaSzn * 10000) / 10000 : '',
      row ? Math.round((row.estPa || 0) * 100) / 100 : '',
      row ? row.samplePa : '',
      row ? row.oppSpName : '',
      row ? row.oppSpThrows : '',
      row ? row.oppTb9 : '',
      row ? row.oppIp : '',
      'tb.v2-full',
      hpUmp,
      hotCold,
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

  let sh = ss.getSheetByName(MLB_BATTER_TB_V2_CARD_TAB);
  if (sh) {
    sh.clearContents();
    sh.clearFormats();
  } else {
    sh = ss.insertSheet(MLB_BATTER_TB_V2_CARD_TAB);
  }
  sh.setTabColor('#6a1b9a');
  const NEED_COLS = 34;
  if (sh.getMaxColumns() < NEED_COLS) {
    sh.insertColumnsAfter(sh.getMaxColumns(), NEED_COLS - sh.getMaxColumns());
  }

  const widths = [
    72, 200, 150, 56, 64, 64, 56, 56, 52, 52, 52, 52, 56, 56, 56, 56, 140, 88,
    56, 52, 52, 52, 52, 64, 64, 56, 56, 130, 44, 52, 44, 80, 140, 56,
  ];
  widths.forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });

  sh.getRange(1, 1, 1, 34)
    .merge()
    .setValue(
      '🧪 Batter TB v2 (shadow) — λ = TB/PA(vs hand) × est_PA × park_TB × opp_SP_TB/9; ablation mults logged per row'
    )
    .setFontWeight('bold')
    .setBackground('#4a148c')
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center')
    .setWrap(true);
  sh.setRowHeight(1, 34);

  const headers = [
    'gamePk', 'matchup', 'batter', 'fd_tb_line', 'fd_over', 'fd_under',
    'lambda_TB_v2', 'edge_vs_line', 'p_over', 'p_under', 'implied_over', 'implied_under',
    'ev_over_$1', 'ev_under_$1', 'best_side', 'best_ev_$1', 'flags', 'batter_id',
    'base_lambda', 'park_mult', 'opp_sp_mult', 'hand_mult', 'ab_mult',
    'tb_per_pa_vs_hand', 'tb_per_pa_szn', 'est_pa', 'vs_hand_sample_pa',
    'opp_sp_name', 'opp_sp_throws', 'opp_sp_tb9', 'opp_sp_ip',
    'model_version', 'hp_umpire', 'hot_cold',
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
      ss.setNamedRange('MLB_BATTER_TB_V2_CARD', sh.getRange(4, 1, out.length, headers.length));
    } catch (e) {}
  }

  ss.toast(out.length + ' TB v2 rows · sorted by best_ev', 'Batter TB v2 card', 6);
}
