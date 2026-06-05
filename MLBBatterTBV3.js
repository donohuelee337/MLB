// ============================================================
// 🧪 Batter TB v3-power (shadow) — v2 + ISO + opp HR/9 + HR Promo overlap
// ============================================================
// Hypothesis: TB Overs cash on extra-base hits, not singles. v1 lost
// money treating all hits equally; v2 added vs-hand + park + opp TB/9
// shrinkage. v3 stacks three POWER signals on top of v2:
//
//   iso_mult       = batter (TB − H)/PA  ÷  league (TB − H)/PA   (PA-shrunk)
//   hr9_mult       = opposing SP HR/9    ÷  league HR/9          (IP-shrunk)
//   hr_promo_mult  = 1.10 if batter is on 📣 Batter_HR_Promo, else 1.00
//
// Composition:
//   λ_v3 = λ_v2 × iso_mult × hr9_mult × hr_promo_mult
//
// v2 stays untouched. v3 lives at:
//   🧪 Batter_TB_Card_v3-power            (per-batter rows + all mults)
//   🧪 MLB_Results_Log_TB_v3 (snapshot)   (graded separately)
//
// All three new mults are clamped to [0.85, 1.20] safety rails so any
// single feature can move λ ≤ ±20%.
// ============================================================

const MLB_BATTER_TB_V3_CARD_TAB = '🧪 Batter_TB_Card_v3-power';
const MLB_TB_V3_DEFAULT_LEAGUE_ISO_PER_PA = 0.135; // approx MLB (TB - H) / PA
const MLB_TB_V3_DEFAULT_LEAGUE_HR9 = 1.15;
const MLB_TB_V3_DEFAULT_HR_PROMO_OVERLAP_MULT = 1.10;
const MLB_TB_V3_ISO_SHRINK_PA = 100;
const MLB_TB_V3_HR9_SHRINK_IP = 20;
const MLB_TB_V3_MULT_MIN = 0.85;
const MLB_TB_V3_MULT_MAX = 1.20;

var __mlbTbV3HrPromoIdsCacheKey = '';
var __mlbTbV3HrPromoIdsCache = {};

function mlbResetTbV3Caches_() {
  __mlbTbV3HrPromoIdsCacheKey = '';
  __mlbTbV3HrPromoIdsCache = {};
  // NOTE: do NOT wipe the shared batter/pitcher cache here. Slate-start
  // resets happen at the top of runMLBBallWindow_; by the time TB v3
  // runs, TB v2 + Hits v2 have already warmed the shared cache and we
  // want every cache hit we can get.
}

// --- batter ISO multiplier ----------------------------------------------
// (TB − H) / PA is a PA-normalized ISO proxy — same ranking as classic
// ISO. Pulls from the shared v3 season-hitting fetch so h.v3-contact's
// K-rate fetch doesn't duplicate the call.

function mlbTbV3BatterIsoMult_(playerId, season, leagueIsoPerPa) {
  const stat = mlbV3FetchBatterSeasonHitting_(playerId, season);
  if (stat.pa <= 0 || isNaN(stat.h) || isNaN(stat.tb) || stat.tb < stat.h) {
    return { mult: 1, isoPerPa: '', samplePa: 0 };
  }
  const isoPerPa = (stat.tb - stat.h) / stat.pa;
  const k = MLB_TB_V3_ISO_SHRINK_PA;
  const shrunk = (isoPerPa * stat.pa + leagueIsoPerPa * k) / (stat.pa + k);
  let mult = shrunk / leagueIsoPerPa;
  mult = Math.max(MLB_TB_V3_MULT_MIN, Math.min(MLB_TB_V3_MULT_MAX, mult));
  return {
    mult: Math.round(mult * 1000) / 1000,
    isoPerPa: Math.round(isoPerPa * 10000) / 10000,
    samplePa: stat.pa,
  };
}

// --- opposing SP HR/9 multiplier ----------------------------------------
// Pulls from the shared v3 pitcher fetch so h.v3-contact's K/9 lookup
// doesn't re-hit the same endpoint for the same SP.

function mlbTbV3OpposingHr9Mult_(pitcherId, season, leagueHr9, minIp) {
  const stat = mlbV3FetchPitcherSeasonPitching_(pitcherId, season);
  const ipFloor = minIp > 0 ? minIp : 10;
  if (isNaN(stat.hr) || stat.ip < ipFloor) return { mult: 1, hr9: '', ip: '' };
  const rawHr9 = (stat.hr * 9) / stat.ip;
  const k = MLB_TB_V3_HR9_SHRINK_IP;
  // IP-weighted shrinkage toward league HR/9 (mirror v2's TB/9 approach).
  const shrunkHr9 = (stat.hr + leagueHr9 * (k / 9)) / ((stat.ip + k) / 9);
  let mult = shrunkHr9 / leagueHr9;
  mult = Math.max(MLB_TB_V3_MULT_MIN, Math.min(MLB_TB_V3_MULT_MAX, mult));
  return {
    mult: Math.round(mult * 1000) / 1000,
    hr9: Math.round(rawHr9 * 100) / 100,
    ip: Math.round(stat.ip * 10) / 10,
  };
}

// --- HR Promo overlap ---------------------------------------------------
// Reads 📣 Batter_HR_Promo (built earlier in the pipeline) and returns a
// set of batter IDs currently on the promo card. Cached for the duration
// of one slate's refresh keyed by tab last-row.

function mlbTbV3LoadHrPromoBatterIds_(ss) {
  const sh = ss.getSheetByName(typeof MLB_BATTER_HR_PROMO_TAB !== 'undefined' ? MLB_BATTER_HR_PROMO_TAB : '📣 Batter_HR_Promo');
  if (!sh || sh.getLastRow() < 4) return {};
  const cacheKey = sh.getLastRow() + ':' + sh.getLastColumn();
  if (cacheKey === __mlbTbV3HrPromoIdsCacheKey) return __mlbTbV3HrPromoIdsCache;

  const ncol = Math.max(1, sh.getLastColumn());
  const headers = sh.getRange(3, 1, 1, ncol).getValues()[0].map(function (h) {
    return String(h || '').trim().toLowerCase();
  });
  // Header on the HR promo tab is 'batter_id' (per MLBHrPromoRefresh.js writer).
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
  __mlbTbV3HrPromoIdsCache = ids;
  __mlbTbV3HrPromoIdsCacheKey = cacheKey;
  return ids;
}

function mlbTbV3HrPromoOverlapMult_(ss, batterId, overlapMultCfg) {
  const id = parseInt(batterId, 10);
  if (!id) return { mult: 1, onPromo: false };
  const ids = mlbTbV3LoadHrPromoBatterIds_(ss);
  if (!ids[id]) return { mult: 1, onPromo: false };
  let m = overlapMultCfg;
  if (isNaN(m) || m <= 0) m = MLB_TB_V3_DEFAULT_HR_PROMO_OVERLAP_MULT;
  m = Math.max(MLB_TB_V3_MULT_MIN, Math.min(MLB_TB_V3_MULT_MAX, m));
  return { mult: Math.round(m * 1000) / 1000, onPromo: true };
}

// --- composer ------------------------------------------------------------

function mlbTbV3ComputeRow_(ss, gamePk, batterId, season, cfg) {
  // Reuse v2's row computation in full — that's our base λ.
  const v2 = mlbTbV2ComputeRow_(ss, gamePk, batterId, season, cfg);

  const leagueIsoPerPa = parseFloat(String(
    cfg['TB_V3_LEAGUE_ISO_PER_PA'] != null ? cfg['TB_V3_LEAGUE_ISO_PER_PA'] : MLB_TB_V3_DEFAULT_LEAGUE_ISO_PER_PA
  ), 10);
  const lIso = !isNaN(leagueIsoPerPa) && leagueIsoPerPa > 0 ? leagueIsoPerPa : MLB_TB_V3_DEFAULT_LEAGUE_ISO_PER_PA;

  const leagueHr9 = parseFloat(String(
    cfg['TB_V3_LEAGUE_HR9'] != null ? cfg['TB_V3_LEAGUE_HR9'] : MLB_TB_V3_DEFAULT_LEAGUE_HR9
  ), 10);
  const lHr9 = !isNaN(leagueHr9) && leagueHr9 > 0 ? leagueHr9 : MLB_TB_V3_DEFAULT_LEAGUE_HR9;

  const overlapCfg = parseFloat(String(
    cfg['TB_V3_HR_PROMO_OVERLAP_MULT'] != null ? cfg['TB_V3_HR_PROMO_OVERLAP_MULT'] : MLB_TB_V3_DEFAULT_HR_PROMO_OVERLAP_MULT
  ), 10);

  const iso = mlbTbV3BatterIsoMult_(batterId, season, lIso);
  const hr9 = v2.oppSpId
    ? mlbTbV3OpposingHr9Mult_(v2.oppSpId, season, lHr9, mlbOppSpMinIp_(cfg))
    : { mult: 1, hr9: '', ip: '' };
  const promo = mlbTbV3HrPromoOverlapMult_(ss, batterId, overlapCfg);

  const out = {
    v2: v2,
    lambda: NaN,
    isoMult: iso.mult,
    isoPerPa: iso.isoPerPa,
    isoSamplePa: iso.samplePa,
    hr9Mult: hr9.mult,
    oppHr9: hr9.hr9,
    oppHr9Ip: hr9.ip,
    hrPromoMult: promo.mult,
    onHrPromo: promo.onPromo,
  };

  if (!isNaN(v2.lambda) && v2.lambda > 0) {
    const lam = v2.lambda * iso.mult * hr9.mult * promo.mult;
    out.lambda = Math.round(lam * 1000) / 1000;
  }
  return out;
}

// --- card builder --------------------------------------------------------

function mlbFlagsTbV3Card_(injuryStatus, notes, hasModel) {
  // Same flag taxonomy as v2 so downstream tracker filters match.
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

function refreshBatterTBV3BetCard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig();
  const season = mlbSlateSeasonYear_(cfg);
  // v2 caches drive base-λ. v3 caches drive the extra mults. Reset both.
  mlbResetTbV2Caches_();
  mlbResetTbV3Caches_();

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
      row = mlbTbV3ComputeRow_(ss, gamePk, pidNum, season, cfg);
      if (!row.v2.oppSpId) {
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

    const flags = mlbFlagsTbV3Card_(
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
      // v2 base + v2 mults (same indices as v2 card so log/grader code stays parallel)
      row ? row.v2.base : '',
      row ? row.v2.parkMult : '',
      row ? row.v2.oppMult : '',
      row ? row.v2.handMult : '',
      row ? row.v2.abMult : '',
      // v3 add-on mults
      row ? row.isoMult : '',
      row ? row.hr9Mult : '',
      row ? row.hrPromoMult : '',
      // v3 audit fields
      row ? row.isoPerPa : '',
      row ? row.isoSamplePa : '',
      row ? row.oppHr9 : '',
      row ? row.oppHr9Ip : '',
      row && row.onHrPromo ? 'Y' : 'N',
      row ? row.v2.oppSpName : '',
      row ? row.v2.oppSpThrows : '',
      'tb.v3-power',
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

  let sh = ss.getSheetByName(MLB_BATTER_TB_V3_CARD_TAB);
  if (sh) {
    sh.clearContents();
    sh.clearFormats();
  } else {
    sh = ss.insertSheet(MLB_BATTER_TB_V3_CARD_TAB);
  }
  sh.setTabColor('#1b5e20');

  const headers = [
    'gamePk', 'matchup', 'batter', 'fd_tb_line', 'fd_over', 'fd_under',
    'lambda_TB_v3', 'edge_vs_line', 'p_over', 'p_under', 'implied_over', 'implied_under',
    'ev_over_$1', 'ev_under_$1', 'best_side', 'best_ev_$1', 'flags', 'batter_id',
    // v2 audit
    'base_lambda', 'park_mult', 'opp_sp_tb9_mult', 'hand_mult', 'ab_mult',
    // v3 add-on mults
    'iso_mult', 'opp_sp_hr9_mult', 'hr_promo_mult',
    // v3 audit
    'iso_per_pa', 'iso_sample_pa', 'opp_sp_hr9', 'opp_sp_hr9_ip', 'on_hr_promo',
    'opp_sp_name', 'opp_sp_throws',
    'model_version', 'hp_umpire', 'hot_cold',
  ];
  const NEED_COLS = headers.length;
  if (sh.getMaxColumns() < NEED_COLS) {
    sh.insertColumnsAfter(sh.getMaxColumns(), NEED_COLS - sh.getMaxColumns());
  }

  // Column widths — match v2 conventions, slimmer for the new audit cols.
  const widths = [
    72, 200, 150, 56, 64, 64, 56, 56, 52, 52, 52, 52, 56, 56, 56, 56, 140, 88,
    // v2 audit
    56, 52, 64, 52, 52,
    // v3 mults
    56, 64, 64,
    // v3 audit
    64, 56, 56, 52, 60,
    130, 44,
    80, 56, 56,
  ];
  widths.forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });

  sh.getRange(1, 1, 1, NEED_COLS)
    .merge()
    .setValue(
      '🧪 Batter TB v3-power (shadow) — λ_v3 = λ_v2 × iso × opp_HR/9 × HR-promo overlap; mults audited per row'
    )
    .setFontWeight('bold')
    .setBackground('#2e7d32')
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center')
    .setWrap(true);
  sh.setRowHeight(1, 34);

  sh.getRange(3, 1, 1, NEED_COLS)
    .setValues([headers])
    .setFontWeight('bold')
    .setBackground('#1b5e20')
    .setFontColor('#ffffff');
  sh.setFrozenRows(3);

  if (out.length) {
    sh.getRange(4, 1, out.length, NEED_COLS).setValues(out);
    try {
      ss.setNamedRange('MLB_BATTER_TB_V3_CARD', sh.getRange(4, 1, out.length, NEED_COLS));
    } catch (e) {}
  }

  ss.toast(out.length + ' TB v3 rows · sorted by best_ev', 'Batter TB v3 (shadow)', 6);
}
