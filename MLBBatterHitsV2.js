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
  const id = parseInt(playerId, 10);
  if (!id) return '';
  if (Object.prototype.hasOwnProperty.call(__mlbHitsV2BatterTeamAbbrCache, id)) {
    return __mlbHitsV2BatterTeamAbbrCache[id];
  }
  const url = mlbStatsApiBaseUrl_() + '/people/' + id + '?hydrate=currentTeam';
  try {
    Utilities.sleep(40);
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      __mlbHitsV2BatterTeamAbbrCache[id] = '';
      return '';
    }
    const payload = JSON.parse(res.getContentText());
    const person = (payload.people && payload.people[0]) || {};
    const team = person.currentTeam || {};
    const abbr = String(team.abbreviation || '').trim().toUpperCase();
    __mlbHitsV2BatterTeamAbbrCache[id] = abbr;
    return abbr;
  } catch (e) {
    Logger.log('mlbHitsV2BatterTeamAbbr_: ' + e.message);
    __mlbHitsV2BatterTeamAbbrCache[id] = '';
    return '';
  }
}

// --- opposing probable starter --------------------------------------------

/**
 * Reads 📅 MLB_Schedule for the gamePk and returns the probable SP on the
 * OPPOSITE side from the batter's team. {id, name, throws} or null.
 */
function mlbHitsV2OpposingProbableSp_(ss, gamePk, batterTeamAbbr) {
  const g = parseInt(gamePk, 10);
  if (!g) return null;
  const sh = ss.getSheetByName(MLB_SCHEDULE_TAB);
  if (!sh || sh.getLastRow() < 4) return null;
  const last = sh.getLastRow();
  const block = sh.getRange(4, 1, last, 13).getValues();
  const wantBat = String(batterTeamAbbr || '').trim().toUpperCase();
  for (let i = 0; i < block.length; i++) {
    if (parseInt(block[i][0], 10) !== g) continue;
    const away = String(block[i][3] || '').trim().toUpperCase();
    const home = String(block[i][4] || '').trim().toUpperCase();
    const awayProb = String(block[i][6] || '').trim();
    const homeProb = String(block[i][7] || '').trim();
    const awayProbId = parseInt(block[i][11], 10);
    const homeProbId = parseInt(block[i][12], 10);
    if (wantBat && wantBat === away) {
      return homeProbId ? { id: homeProbId, name: homeProb, throws: '' } : null;
    }
    if (wantBat && wantBat === home) {
      return awayProbId ? { id: awayProbId, name: awayProb, throws: '' } : null;
    }
    return null;
  }
  return null;
}

function mlbHitsV2PitcherThrows_(pitcherId) {
  const id = parseInt(pitcherId, 10);
  if (!id) return '';
  if (Object.prototype.hasOwnProperty.call(__mlbHitsV2PitcherThrowsCache, id)) {
    return __mlbHitsV2PitcherThrowsCache[id];
  }
  const url = mlbStatsApiBaseUrl_() + '/people/' + id;
  try {
    Utilities.sleep(40);
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      __mlbHitsV2PitcherThrowsCache[id] = '';
      return '';
    }
    const payload = JSON.parse(res.getContentText());
    const person = (payload.people && payload.people[0]) || {};
    const code = String((person.pitchHand && person.pitchHand.code) || '').trim().toUpperCase();
    const out = code === 'L' || code === 'R' ? code : '';
    __mlbHitsV2PitcherThrowsCache[id] = out;
    return out;
  } catch (e) {
    Logger.log('mlbHitsV2PitcherThrows_: ' + e.message);
    __mlbHitsV2PitcherThrowsCache[id] = '';
    return '';
  }
}

// --- opposing SP H/9 multiplier (shrunk) ----------------------------------

function mlbHitsV2OpposingHitRateMult_(pitcherId, season) {
  const id = parseInt(pitcherId, 10);
  if (!id) return { mult: 1, h9: '', ip: '' };
  const key = id + ':' + String(season);
  if (Object.prototype.hasOwnProperty.call(__mlbHitsV2PitcherHitRateCache, key)) {
    return __mlbHitsV2PitcherHitRateCache[key];
  }
  const url =
    mlbStatsApiBaseUrl_() +
    '/people/' +
    id +
    '/stats?stats=season&group=pitching&season=' +
    encodeURIComponent(String(season));
  let mult = 1;
  let h9 = '';
  let ip = '';
  try {
    Utilities.sleep(40);
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() === 200) {
      const payload = JSON.parse(res.getContentText());
      const splits = (payload.stats && payload.stats[0] && payload.stats[0].splits) || [];
      if (splits.length) {
        const stat = splits[0].stat || {};
        const hits = parseInt(stat.hits, 10);
        const ipStr = String(stat.inningsPitched || '0').trim();
        // inningsPitched is "X.Y" where Y is outs (0/1/2). Convert to decimal IP.
        let ipDec = 0;
        if (ipStr) {
          const parts = ipStr.split('.');
          const whole = parseInt(parts[0], 10) || 0;
          const outs = parts.length > 1 ? parseInt(parts[1], 10) || 0 : 0;
          ipDec = whole + outs / 3;
        }
        if (!isNaN(hits) && ipDec > 0) {
          const rawH9 = (hits * 9) / ipDec;
          const k = MLB_HITS_V2_OPP_SP_SHRINK_IP;
          // Shrink toward league H/9 using IP-weighted prior.
          const shrunkH9 = (hits + MLB_HITS_V2_LEAGUE_H_PER_9 * (k / 9)) / ((ipDec + k) / 9);
          h9 = Math.round(rawH9 * 100) / 100;
          ip = Math.round(ipDec * 10) / 10;
          mult = shrunkH9 / MLB_HITS_V2_LEAGUE_H_PER_9;
          mult = Math.max(MLB_HITS_V2_OPP_MULT_MIN, Math.min(MLB_HITS_V2_OPP_MULT_MAX, mult));
          mult = Math.round(mult * 1000) / 1000;
        }
      }
    }
  } catch (e) {
    Logger.log('mlbHitsV2OpposingHitRateMult_: ' + e.message);
  }
  const out = { mult: mult, h9: h9, ip: ip };
  __mlbHitsV2PitcherHitRateCache[key] = out;
  return out;
}

// --- batter vs-hand H/PA (shrunk to season) -------------------------------

function mlbHitsV2BatterVsHandHPerPa_(playerId, season, throwsHand) {
  const id = parseInt(playerId, 10);
  if (!id) {
    return { hpPaVsHand: NaN, hpPaSzn: NaN, samplePa: 0, hand: '' };
  }
  const hand = String(throwsHand || '').trim().toUpperCase();
  const key = id + ':' + String(season);
  let cached = __mlbHitsV2BatterVsHandCache[key];
  if (!cached) {
    const url =
      mlbStatsApiBaseUrl_() +
      '/people/' +
      id +
      '/stats?stats=statSplits,season&group=hitting&sitCodes=vl,vr&season=' +
      encodeURIComponent(String(season));
    let vl = { h: 0, pa: 0 };
    let vr = { h: 0, pa: 0 };
    let szn = { h: 0, pa: 0 };
    try {
      Utilities.sleep(40);
      const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      if (res.getResponseCode() === 200) {
        const payload = JSON.parse(res.getContentText());
        const groups = payload.stats || [];
        groups.forEach(function (grp) {
          const ty = String((grp && grp.type && grp.type.displayName) || '').toLowerCase();
          const splits = (grp && grp.splits) || [];
          if (ty.indexOf('statsplits') !== -1) {
            splits.forEach(function (sp) {
              const code = String((sp.split && sp.split.code) || '').toLowerCase();
              const st = sp.stat || {};
              const h = parseInt(st.hits, 10) || 0;
              const pa = parseInt(st.plateAppearances, 10) || 0;
              if (code === 'vl') vl = { h: h, pa: pa };
              else if (code === 'vr') vr = { h: h, pa: pa };
            });
          } else if (ty.indexOf('season') !== -1 && splits.length) {
            const st = splits[0].stat || {};
            szn = {
              h: parseInt(st.hits, 10) || 0,
              pa: parseInt(st.plateAppearances, 10) || 0,
            };
          }
        });
      }
    } catch (e) {
      Logger.log('mlbHitsV2BatterVsHandHPerPa_: ' + e.message);
    }
    cached = { vl: vl, vr: vr, szn: szn };
    __mlbHitsV2BatterVsHandCache[key] = cached;
  }
  const sznPa = cached.szn.pa;
  const sznH = cached.szn.h;
  const hpPaSzn = sznPa > 0 ? sznH / sznPa : NaN;
  let split = null;
  if (hand === 'L') split = cached.vl;
  else if (hand === 'R') split = cached.vr;
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
  };

  // Park (BABIP-leaning hits).
  const homeAbbr = mlbScheduleHomeAbbrForGamePk_(ss, gamePk);
  out.parkMult = mlbParkHitsLambdaMultForHomeAbbr_(homeAbbr);

  // Opposing SP via batter team affiliation.
  const batterAbbr = mlbHitsV2BatterTeamAbbr_(batterId);
  const oppSp = batterAbbr ? mlbHitsV2OpposingProbableSp_(ss, gamePk, batterAbbr) : null;
  if (oppSp) {
    out.oppSpId = oppSp.id || '';
    out.oppSpName = oppSp.name || '';
    out.oppSpThrows = mlbHitsV2PitcherThrows_(oppSp.id);
    const opp = mlbHitsV2OpposingHitRateMult_(oppSp.id, season);
    out.oppMult = opp.mult;
    out.oppH9 = opp.h9;
    out.oppIp = opp.ip;
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
    out.lambda = Math.round(out.lambda * 1000) / 1000;
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
    let note = '';
    if (!gamePk) {
      note = 'schedule_game_miss';
    } else {
      const meta = mlbScheduleMetaForGamePk_(ss, gamePk);
      matchup = meta.matchup;
    }

    const pm = entry.pointMap;
    const mainPt = mlbPickMainKPoint_(pm);
    const px = mlbMainKPrices_(pm, mainPt);

    const pidNum = mlbStatsApiResolvePlayerIdFromName_(entry.displayName);
    if (isNaN(pidNum) || !pidNum) {
      note = note ? note + '; id_miss' : 'id_miss';
    }

    let row = null;
    if (gamePk && !isNaN(pidNum) && pidNum) {
      row = mlbHitsV2ComputeRow_(ss, gamePk, pidNum, season, cfg);
      if (!row.oppSpId) {
        note = note ? note + '; opp_sp_miss' : 'opp_sp_miss';
      }
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

  const widths = [
    72, 200, 150, 56, 64, 64, 56, 56, 52, 52, 52, 52, 56, 56, 56, 56, 140, 88,
    56, 52, 52, 52, 52, 64, 64, 56, 56, 130, 44, 52, 44, 80,
  ];
  widths.forEach(function (w, i) {
    sh.setColumnWidth(i + 1, w);
  });

  sh.getRange(1, 1, 1, 32)
    .merge()
    .setValue(
      '🧪 Batter Hits v2 (shadow) — λ = H/PA(vs hand) × est_PA × park_H × opp_SP_H/9; ablation mults logged per row'
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
