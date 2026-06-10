// ============================================================
// 🃏 MLB Bet Card — pitcher K + batter hits (ranked by EV)
// ============================================================
// Pulls ⚡ Sim_Pitcher_K + optional ⚡ Sim_Batter_Hits (authoritative P/EV);
// K_SEGMENT_MODE: legacy = gate-only K; shadow = legacy K + segment audit cols;
// live = segment registry picks only (max K_SEGMENT_MAX_PLAYS, 1/game).
// K_SEGMENT_INCLUDE_H=N skips H merge (default). Refreshes sim before merge.
// TB retired 2026-05-21 — removed from pipeline, odds fetch, and bet card panels.
// VISUAL FORMATTING is in MLBBetCardFormatting.js — DO NOT mix
// rendering code into this file or it will get rolled back with model
// changes (see v0.1.1 commit notes).
// ============================================================

const MLB_BET_CARD_TAB = '🃏 MLB_Bet_Card';
// Deterministic layout: 0–18 base, 19–24 segment audit (blank unless
// K_SEGMENT_MODE is shadow/live), 25 fair %, 26 edge vs fair, 27–28 proj IP.
// Fixed width keeps downstream positional readers (results log) stable in every mode.
const MLB_BET_CARD_NCOL = 29;
const MLB_BET_CARD_AUDIT_NCOL = 29;
const MLB_BET_CARD_DIAG_FUNNEL_TAB = '🔍 BetCard_Diag_Funnel';

/** Set by refreshMLBBetCard — authoritative pick count (excludes tracker panels). */
var __mlbBetCardLastStats_ = null;

function mlbBetCardPlayStats_() {
  if (__mlbBetCardLastStats_) return __mlbBetCardLastStats_;
  return { picks: 0, games: 0, cardBlockRows: 0, sheetLastRow: 0 };
}
/**
 * Bet card filters (a play must clear ALL of these to make 🃏):
 *   1. model P(Win) ≥ per-market floor (Config: MIN_MODEL_PCT_<K|TB|H>,
 *      else MIN_MODEL_PCT_BET_CARD, else 0.60)
 *   2. model P(Win) ≤ MAX_MODEL_PCT_K_OVER (K Over only; 0 = off).
 *      K Over calibration is INVERTED above ~0.65 (audit n=83: -22..-47% ROI).
 *      Same for K Under via MAX_MODEL_PCT_K_UNDER (0 = off): K Under 0.80+
 *      flips to -8% ROI; sweet spot is 0.70-0.80 (graded log 2026-05).
 *   3. |projection − line| ≥ per-market edge floor (Config: MIN_EDGE_<K|TB|H>; 0 = off)
 *   4. EV per $1 > 0
 *   5. EV per $1 ≥ MIN_EV_BET_CARD (K + H; 0 or blank = off)
 *   6. EV per $1 ≤ MAX_EV_BET_CARD (K + H; 0 or blank = off).
 *      Kills the "edge mirage" — high EV correlates with model error not real edge.
 *   7. K odds ≤ MAX_ODDS_K (bans plus-money K — priced for action, not outcome; 0 = off)
 *   8. H odds ≤ MAX_ODDS_H (extreme juice cap; 0 = off). Optional MIN_ODDS_H favorites floor (0 = off).
 * Plus data prereqs: side ∈ {Over,Under}, valid line + FD price, no injury.
 *
 * P/EV come from ⚡ Sim tabs (anchored Poisson/binomial). Gate thresholds are
 * tuned from 📋 MLB_Results_Log via 🎯 Bet_Card_Calibration / 🔬 Gate_Backtest —
 * no letter-grade heuristics.
 */
const MLB_BET_CARD_MIN_MODEL_PCT = 0.60;

/**
 * Per-market threshold lookup. Returns {minP, minEdge} where minP defaults to
 * the global floor and minEdge defaults to 0 (off) if not set.
 */
/** Optional K gate floors: strict = Config only; balanced/research = looser for slate volume. */
function mlbBetCardKGateProfile_(cfg) {
  const mode = String(cfg['K_BET_CARD_GATES'] != null ? cfg['K_BET_CARD_GATES'] : 'balanced')
    .trim()
    .toLowerCase();
  if (mode === 'balanced') return { kOver: 0.58, kUnder: 0.68 };
  if (mode === 'research') return { kOver: 0.55, kUnder: 0.62 };
  return null;
}

function mlbBetCardThresholds_(cfg, marketKey, side) {
  const globalRaw = String(cfg['MIN_MODEL_PCT_BET_CARD'] != null ? cfg['MIN_MODEL_PCT_BET_CARD'] : '').trim();
  const globalNum = parseFloat(globalRaw, 10);
  const globalP = !isNaN(globalNum) && globalNum > 0 ? globalNum : MLB_BET_CARD_MIN_MODEL_PCT;

  // Per-side key (K only for now): MIN_MODEL_PCT_K_OVER / MIN_MODEL_PCT_K_UNDER.
  // Falls back to per-market key (MIN_MODEL_PCT_K), then global, then 0.60.
  let sideKey = '';
  if (marketKey === 'K' && side) {
    sideKey = 'MIN_MODEL_PCT_K_' + String(side).toUpperCase();
  }
  const sideRaw = sideKey ? String(cfg[sideKey] != null ? cfg[sideKey] : '').trim() : '';
  const sideNum = parseFloat(sideRaw, 10);

  const pRaw = String(cfg['MIN_MODEL_PCT_' + marketKey] != null ? cfg['MIN_MODEL_PCT_' + marketKey] : '').trim();
  const pNum = parseFloat(pRaw, 10);
  const marketP = !isNaN(pNum) && pNum > 0 ? pNum : globalP;

  let minP = (!isNaN(sideNum) && sideNum > 0) ? sideNum : marketP;

  if (marketKey === 'K' && side) {
    const prof = mlbBetCardKGateProfile_(cfg);
    if (prof) {
      minP = side === 'Under' ? prof.kUnder : prof.kOver;
    }
  }

  const eRaw = String(cfg['MIN_EDGE_' + marketKey] != null ? cfg['MIN_EDGE_' + marketKey] : '0').trim();
  const eNum = parseFloat(eRaw, 10);
  const minEdge = !isNaN(eNum) && eNum > 0 ? eNum : 0;
  return { minP: minP, minEdge: minEdge };
}

/** Sim P(win), optional calibration, implied, gap — for gates and audit cols. */
function mlbBetCardKProbContext_(r, side, cfg) {
  const pRaw = parseFloat(String(side === 'Over' ? r[10] : r[11]), 10);
  const implied = parseFloat(String(side === 'Over' ? r[12] : r[13]), 10);
  const useCal =
    String(cfg['K_BET_CARD_USE_CALIBRATION'] != null ? cfg['K_BET_CARD_USE_CALIBRATION'] : 'Y').toUpperCase() ===
    'Y';
  let pCal = pRaw;
  if (useCal && !isNaN(pRaw) && typeof mlbApplyKCalibration_ === 'function') {
    const calTable =
      typeof mlbLoadKCalibrationTable_ === 'function' ? mlbLoadKCalibrationTable_() : null;
    pCal = mlbApplyKCalibration_(pRaw, side, calTable);
  }
  const pGap =
    !isNaN(pCal) && !isNaN(implied) ? Math.round((pCal - implied) * 1000) / 1000 : NaN;
  return { pRaw: pRaw, pCal: pCal, implied: implied, pGap: pGap, useCal: useCal };
}

/** Prefer sim tab; fall back to stat card with optional pipeline warning. */
function mlbBetCardSourceSheet_(ss, simTab, cardTab, label) {
  const sim = ss.getSheetByName(simTab);
  if (sim && sim.getLastRow() >= 4) return sim;
  const card = ss.getSheetByName(cardTab);
  if (card && card.getLastRow() >= 4) {
    if (typeof addPipelineWarning_ === 'function') {
      addPipelineWarning_('Bet card: ' + label + ' sim empty — using stat card ' + cardTab);
    }
    return card;
  }
  return null;
}

/**
 * Normalize 🎰 Pitcher_K_Card rows (39-col layout, pitch_team at idx 4) to the
 * ⚡ Sim_Pitcher_K row shape every K reader below expects. Sim rows pass
 * through untouched. Card-only extras the sim lacks (opp_abbr / opp_k_pa /
 * opp_k_pa_vs / hot_cold) ride at idx 38..41, so they are only ever readable
 * when the source really was the card — sim v2 audit cols can no longer
 * masquerade as opponent context. Columns resolve by header name with
 * current-layout fallbacks (root cause of the build-24 zero-K-picks bug was
 * hard-coded indices surviving a column insertion).
 */
function mlbBetCardKRowsToSimShape_(srcSheet, rows) {
  if (!srcSheet || srcSheet.getName() !== MLB_PITCHER_K_CARD_TAB) return rows;
  const hdr = typeof mlbHeaderIndexMap_ === 'function' ? mlbHeaderIndexMap_(srcSheet, 3) : {};
  const ci = function (name, fb) { return hdr[name] != null ? hdr[name] : fb; };
  const C = {
    line: ci('fd_k_line', 5), over: ci('fd_over', 6), under: ci('fd_under', 7),
    ip: ci('proj_IP', 8), lambda: ci('proj_K', 9), edge: ci('edge_vs_line', 10),
    pOver: ci('p_over', 11), pUnder: ci('p_under', 12),
    imO: ci('implied_over', 13), imU: ci('implied_under', 14),
    evO: ci('ev_over_$1', 15), evU: ci('ev_under_$1', 16),
    pick: ci('pick', 17), pickEv: ci('pick_ev_$1', 18), flags: ci('flags', 19),
    pid: ci('pitcher_id', 20), ump: ci('hp_umpire', 21), throws: ci('throws', 22),
    oppAbbr: ci('opp_abbr', 23), oppKpa: ci('opp_k_pa', 24), oppKpaVs: ci('opp_k_pa_vs', 25),
    hotCold: ci('hot_cold', 26),
    lV2: ci('lambda_K_v2', 27), games: ci('games', 28), k9V2: ci('k9_eff_v2', 29), ipV2: ci('projIP_v2', 30),
    lV3: ci('lambda_K_v3_bf', 31), sBf: ci('season_bf', 32), kPa: ci('k_per_pa', 33), paBf: ci('proj_pa_bf', 34),
  };
  return rows.map(function (r) {
    const g = function (i) { return r[i] != null ? r[i] : ''; };
    return [
      g(0), g(1), g(2), g(3),
      g(C.line), g(C.over), g(C.under), g(C.ip), g(C.lambda), g(C.edge),
      g(C.pOver), g(C.pUnder), g(C.imO), g(C.imU), g(C.evO), g(C.evU),
      g(C.pick), g(C.pickEv), g(C.flags), g(C.pid), g(C.ump), g(C.throws),
      // Sim audit cols 22..29 (k.v2) / 30..37 (k.v3.bf): the card carries the
      // raw λ + inputs but not the anchored/best-side audit values — blank.
      g(C.lV2), '', '', '', '', g(C.games), g(C.k9V2), g(C.ipV2),
      g(C.lV3), '', '', '', '', g(C.sBf), g(C.kPa), g(C.paBf),
      // Extras 38..41 — card-only opponent context + hot/cold.
      g(C.oppAbbr), g(C.oppKpa), g(C.oppKpaVs), g(C.hotCold),
    ];
  });
}

/** Injury / side / line / FD price — no pWin or EV gates. */
function mlbBetCardKBasicOk_(r) {
  const flags = String(r[18] || '');
  if (flags.indexOf('injury') !== -1) return null;
  const side = String(r[16] || '').trim();
  if (side !== 'Over' && side !== 'Under') return null;
  const line = r[4];
  if (line === '' || line == null) return null;
  const fdOver = r[5];
  const fdUnder = r[6];
  const american = side === 'Over' ? fdOver : fdUnder;
  if (american === '' || american == null || isNaN(parseFloat(String(american)))) return null;
  const pitcher = String(r[3] || '').trim();
  if (!pitcher) return null;
  return { side: side, american: american, pitcher: pitcher };
}

/** Matchup tags for segment registry (HOT/COLD rides at extras idx 41 on card-sourced rows). */
function mlbBetCardKTagsFromRow_(r) {
  const tags = [];
  const hc = String((r.length > 41 && r[41] != null ? r[41] : '') || '').toUpperCase();
  if (hc === 'HOT' || hc === 'COLD') tags.push(hc);
  const flags = String(r[18] || '');
  if (flags.indexOf('opp_k_high') !== -1) tags.push('opp_k_high');
  if (flags.indexOf('opp_k_low') !== -1) tags.push('opp_k_low');
  return tags;
}

/** Opp K context — extras idx 39/40 on card-sourced rows; blank on sim rows (sim omits these). */
function mlbBetCardKOppContextFromRow_(r) {
  const vs = parseFloat(String(r.length > 40 && r[40] != null ? r[40] : ''), 10);
  const all = parseFloat(String(r.length > 39 && r[39] != null ? r[39] : ''), 10);
  const oppKL14 = !isNaN(vs) && vs > 0 ? vs : !isNaN(all) && all > 0 ? all : '';
  const lambdaRaw = r[8];
  return { oppKL14: oppKL14, lambdaRaw: lambdaRaw };
}

/**
 * Build a K play object from a sim/card row (gate checks optional via meta.skipGates).
 * meta: { side, segmentId, pWinRaw, pWinCal, matchupTags, lambdaRaw, oppKL14 }
 */
function mlbBetCardKRowToPlay_(r, cfg, gameTimeIdx, meta) {
  meta = meta || {};
  const basic = mlbBetCardKBasicOk_(r);
  if (!basic) return null;
  const bestSide = meta.side || basic.side;
  const line = r[4];
  const american = bestSide === 'Over' ? r[5] : r[6];
  const pitcher = basic.pitcher;
  const probCtx = mlbBetCardKProbContext_(r, bestSide, cfg);
  const pwNum = probCtx.useCal ? probCtx.pCal : probCtx.pRaw;
  const pWin = !isNaN(pwNum) ? pwNum : bestSide === 'Over' ? r[10] : r[11];
  if (!meta.skipGates) {
    // Plus-money K is priced for action, not outcome: every plus-money K bucket
    // bleeds (K Over +100..+140 = -10.8% flat, K Under +100..+140 = -27.1%).
    // The profit lives in juiced favorites. 0/blank = no cap.
    const maxOddsK = parseFloat(String(cfg['MAX_ODDS_K'] != null ? cfg['MAX_ODDS_K'] : '0')) || 0;
    const amNum = parseFloat(String(american));
    if (maxOddsK > 0 && !isNaN(amNum) && amNum > maxOddsK) return null;
    const kThr = mlbBetCardThresholds_(cfg, 'K', bestSide);
    const minPgap = parseFloat(String(cfg['MIN_PWIN_GAP_K'] != null ? cfg['MIN_PWIN_GAP_K'] : '0.02'), 10);
    const gapRelax =
      !isNaN(minPgap) &&
      minPgap > 0 &&
      !isNaN(probCtx.pGap) &&
      probCtx.pGap >= minPgap &&
      !isNaN(pwNum) &&
      pwNum >= kThr.minP - 0.05;
    if (isNaN(pwNum) || (pwNum < kThr.minP && !gapRelax)) return null;
    if (bestSide === 'Over') {
      const kOverMaxRaw = parseFloat(String(cfg['MAX_MODEL_PCT_K_OVER'] != null ? cfg['MAX_MODEL_PCT_K_OVER'] : '0'));
      if (!isNaN(kOverMaxRaw) && kOverMaxRaw > 0 && kOverMaxRaw < 1 && pwNum > kOverMaxRaw) return null;
    }
    if (bestSide === 'Under') {
      const kUnderMaxRaw = parseFloat(String(cfg['MAX_MODEL_PCT_K_UNDER'] != null ? cfg['MAX_MODEL_PCT_K_UNDER'] : '0'));
      if (!isNaN(kUnderMaxRaw) && kUnderMaxRaw > 0 && kUnderMaxRaw < 1 && pwNum > kUnderMaxRaw) return null;
    }
    const kEdge = parseFloat(String(r[9]));
    if (kThr.minEdge > 0 && (isNaN(kEdge) || Math.abs(kEdge) < kThr.minEdge)) return null;
    const ev = parseFloat(String(r[17]));
    if (isNaN(ev) || ev <= 0) return null;
    const minEvK = parseFloat(String(cfg['MIN_EV_BET_CARD'] != null ? cfg['MIN_EV_BET_CARD'] : '0')) || 0;
    if (minEvK > 0 && ev < minEvK) return null;
    const maxEvCard = parseFloat(String(cfg['MAX_EV_BET_CARD'] != null ? cfg['MAX_EV_BET_CARD'] : '0'));
    if (!isNaN(maxEvCard) && maxEvCard > 0 && ev > maxEvCard) return null;
  }
  const evRaw = r[17];
  const ev = parseFloat(String(evRaw));
  const implied = bestSide === 'Over' ? r[12] : r[13];
  const matchup = r[1];
  const gamePk = r[0];
  const flags = String(r[18] || '');
  const pitcherId = r[19];
  const hpUmp = String(r[20] || '').trim();
  const throws = String(r[21] || '').trim();
  const hotCold = String((r.length > 41 && r[41] != null ? r[41] : '') || '').toUpperCase();
  const hand =
    throws.toUpperCase() === 'R' ? 'RHP' : throws.toUpperCase() === 'L' ? 'LHP' : throws ? throws : '';
  const pickLabel =
    pitcher +
    (hand ? ' (' + hand + ')' : '') +
    ' — K ' +
    bestSide +
    ' ' +
    String(line) +
    (hpUmp ? ' · HP ' + hpUmp : '');
  const gt = gameTimeIdx[parseInt(gamePk, 10)] || {};
  const ctx = mlbBetCardKOppContextFromRow_(r);
  const pWinRaw = meta.pWinRaw != null ? meta.pWinRaw : probCtx.pRaw;
  const pWinCal = meta.pWinCal != null ? meta.pWinCal : probCtx.useCal ? probCtx.pCal : '';
  const tagsArr = meta.matchupTags != null
    ? (Array.isArray(meta.matchupTags) ? meta.matchupTags : String(meta.matchupTags).split(',').filter(Boolean))
    : mlbBetCardKTagsFromRow_(r);
  return {
    kind: 'K',
    gamePk: gamePk,
    matchup: matchup,
    pickLabel: pickLabel,
    player: pitcher,
    playerId: pitcherId,
    side: bestSide,
    line: line,
    american: american,
    pWin: pWin,
    implied: implied,
    impliedOpp: bestSide === 'Over' ? r[13] : r[12],
    ev: isNaN(ev) ? '' : ev,
    lambda: r[8],
    edge: r[9],
    flags: flags,
    market: 'Pitcher strikeouts',
    gameTimeIso: gt.iso || '',
    gameTimeHHmm: gt.hhmm || '',
    hotCold: hotCold === 'HOT' || hotCold === 'COLD' ? hotCold : '',
    segmentId: meta.segmentId != null ? meta.segmentId : '',
    pWinRaw: pWinRaw,
    pWinCal: pWinCal,
    matchupTags: tagsArr.join(','),
    lambdaRaw: meta.lambdaRaw != null ? meta.lambdaRaw : ctx.lambdaRaw,
    oppKL14: meta.oppKL14 != null ? meta.oppKL14 : ctx.oppKL14,
    projIp: r[7] != null && r[7] !== '' ? r[7] : '',
    projIpV2: r.length > 29 && r[29] != null && r[29] !== '' ? r[29] : '',
  };
}

/** Shadow/live segment path: rank, cap, attach audit or replace K plays. */
function mlbBetCardApplyKSegmentMode_(kPlays, kRows, cfg, ss, segmentMode) {
  const calTable =
    typeof mlbLoadKCalibrationTable_ === 'function' ? mlbLoadKCalibrationTable_() : null;
  const registry =
    typeof mlbLoadKSegmentRegistry_ === 'function' ? mlbLoadKSegmentRegistry_(ss) : [];
  const kCandidates = [];
  (kRows || []).forEach(function (r) {
    const basic = mlbBetCardKBasicOk_(r);
    if (!basic) return;
    const pRaw = parseFloat(String(basic.side === 'Over' ? r[10] : r[11]));
    if (isNaN(pRaw)) return;
    const pCal =
      typeof mlbApplyKCalibration_ === 'function'
        ? mlbApplyKCalibration_(pRaw, basic.side, calTable)
        : pRaw;
    kCandidates.push({
      row: r,
      side: basic.side,
      pCal: pCal,
      pRaw: pRaw,
      odds: parseFloat(String(basic.american)),
      tags: mlbBetCardKTagsFromRow_(r),
      gamePk: r[0],
    });
  });
  const ranked =
    typeof mlbRankKSegmentPicks_ === 'function'
      ? mlbRankKSegmentPicks_(kCandidates, registry)
      : [];
  const maxPlays = parseInt(String(cfg['K_SEGMENT_MAX_PLAYS'] || '5'), 10) || 5;
  const seenGames = {};
  const segmentPicks = [];
  ranked.forEach(function (p) {
    const gk = String(p.gamePk != null ? p.gamePk : '');
    if (seenGames[gk]) return;
    if (segmentPicks.length >= maxPlays) return;
    seenGames[gk] = true;
    segmentPicks.push(p);
  });

  const segByKey = {};
  ranked.forEach(function (sp) {
    const key =
      String(sp.gamePk != null ? sp.gamePk : '') +
      '|' +
      sp.side +
      '|' +
      String(sp.row[3] || '').trim();
    if (!segByKey[key]) segByKey[key] = sp;
  });

  if (segmentMode === 'live') {
    const gameTimeIdx = mlbScheduleGameTimeIndex_(ss);
    const out = [];
    segmentPicks.forEach(function (sp) {
      const segId = sp.segment && sp.segment.seg ? sp.segment.seg.id : '';
      const play = mlbBetCardKRowToPlay_(sp.row, cfg, gameTimeIdx, {
        side: sp.side,
        skipGates: true,
        segmentId: segId,
        pWinRaw: sp.pRaw,
        pWinCal: sp.pCal,
        matchupTags: sp.tags,
      });
      if (play) out.push(play);
    });
    if (
      out.length === 0 &&
      kPlays.length > 0 &&
      String(cfg['K_LIVE_FALLBACK_LEGACY'] != null ? cfg['K_LIVE_FALLBACK_LEGACY'] : 'Y').toUpperCase() === 'Y'
    ) {
      try {
        if (typeof addPipelineWarning_ === 'function') {
          addPipelineWarning_(
            'K_SEGMENT_MODE=live: 0 enabled registry matches — using legacy gate picks (K_LIVE_FALLBACK_LEGACY=Y)'
          );
        }
      } catch (eWarn) {}
      return {
        kPlays: kPlays,
        segmentMode: segmentMode,
        segmentPickCount: 0,
        liveFallback: true,
      };
    }
    return { kPlays: out, segmentMode: segmentMode, segmentPickCount: out.length };
  }

  // shadow: keep legacy K plays; attach segment audit when a registry segment matched.
  (kPlays || []).forEach(function (p) {
    const key = String(p.gamePk != null ? p.gamePk : '') + '|' + p.side + '|' + p.player;
    const sp = segByKey[key];
    if (!sp || !sp.segment || !sp.segment.seg) return;
    p.segmentId = sp.segment.seg.id;
    p.pWinRaw = sp.pRaw;
    p.pWinCal = sp.pCal;
    p.matchupTags = (sp.tags || []).join(',');
    const ctx = mlbBetCardKOppContextFromRow_(sp.row);
    p.lambdaRaw = ctx.lambdaRaw;
    p.oppKL14 = ctx.oppKL14;
  });
  return { kPlays: kPlays, segmentMode: segmentMode, segmentPickCount: segmentPicks.length };
}

/**
 * When 🃏 has 0 K picks, explain top sim gate rejections (for toast / alert).
 */
function mlbKBetCardZeroPickSummary_(kRows, cfg, segmentMode, kPassedLegacy) {
  const lines = [];
  const mode = String(segmentMode || 'shadow').toLowerCase();
  if (mode === 'live' && (!kPassedLegacy || kPassedLegacy === 0)) {
    lines.push('K_SEGMENT_MODE=live but no enabled registry segments matched.');
    lines.push('Fix: enable a row on 🎯 K_Segment_Registry, or set K_SEGMENT_MODE=shadow/legacy.');
  }
  const prof = mlbBetCardKGateProfile_(cfg);
  if (prof) {
    lines.push('K_BET_CARD_GATES=' + String(cfg['K_BET_CARD_GATES'] || 'balanced') + ' (Over≥' + prof.kOver + ', Under≥' + prof.kUnder + ')');
  } else {
    lines.push('K_BET_CARD_GATES=strict (Under floor often 0.75 — very few pass).');
  }
  if (!kRows || !kRows.length) {
    lines.push('No ⚡ Sim_Pitcher_K / 🎰 Pitcher_K_Card rows — run Morning pipeline.');
    return lines.join('\n');
  }
  const tally = {};
  kRows.forEach(function (r) {
    const res = { ok: false, reason: 'unknown' };
    const flags = String(r[18] || '');
    const bestSide = String(r[16] || '').trim();
    if (flags.indexOf('injury') !== -1) {
      res.reason = 'injury_flag';
    } else if (bestSide !== 'Over' && bestSide !== 'Under') {
      const board =
        typeof mlbKPickOnBoard_ === 'function' ? mlbKPickOnBoard_(r[8], r[4]) : { onBoard: true };
      res.reason =
        flags.indexOf('agree_fd') !== -1 || (board && !board.onBoard) ? 'agree_fd' : 'no_pick';
    } else {
      const probCtx = mlbBetCardKProbContext_(r, bestSide, cfg);
      const pwNum = probCtx.useCal ? probCtx.pCal : probCtx.pRaw;
      const kThr = mlbBetCardThresholds_(cfg, 'K', bestSide);
      const maxPctKOver =
        parseFloat(String(cfg['MAX_MODEL_PCT_K_OVER'] != null ? cfg['MAX_MODEL_PCT_K_OVER'] : '0'), 10) || 0;
      const maxPctKUnder =
        parseFloat(String(cfg['MAX_MODEL_PCT_K_UNDER'] != null ? cfg['MAX_MODEL_PCT_K_UNDER'] : '0'), 10) || 0;
      const ev = parseFloat(String(r[17]), 10);
      const minEv = parseFloat(String(cfg['MIN_EV_BET_CARD'] != null ? cfg['MIN_EV_BET_CARD'] : '0')) || 0;
      const maxEv = parseFloat(String(cfg['MAX_EV_BET_CARD'] != null ? cfg['MAX_EV_BET_CARD'] : '0')) || 0;
      const maxOddsK = parseFloat(String(cfg['MAX_ODDS_K'] != null ? cfg['MAX_ODDS_K'] : '0')) || 0;
      const amK = parseFloat(String(bestSide === 'Over' ? r[5] : r[6]));
      if (isNaN(pwNum)) res.reason = 'bad_pwin';
      else if (maxOddsK > 0 && !isNaN(amK) && amK > maxOddsK) res.reason = 'k_odds_plus_money';
      else if (pwNum < kThr.minP) res.reason = 'pwin_below_floor';
      else if (bestSide === 'Over' && maxPctKOver > 0 && maxPctKOver < 1 && pwNum > maxPctKOver) {
        res.reason = 'k_over_too_confident';
      } else if (bestSide === 'Under' && maxPctKUnder > 0 && maxPctKUnder < 1 && pwNum > maxPctKUnder) {
        res.reason = 'k_under_too_confident';
      } else if (isNaN(ev) || ev <= 0) res.reason = 'ev_not_positive';
      else if (minEv > 0 && ev < minEv) res.reason = 'ev_below_min';
      else if (maxEv > 0 && ev > maxEv) res.reason = 'ev_above_max';
      else res.reason = 'passed';
    }
    if (res.reason !== 'passed') {
      tally[res.reason] = (tally[res.reason] || 0) + 1;
    }
  });
  const sorted = Object.keys(tally).sort(function (a, b) {
    return tally[b] - tally[a];
  });
  if (sorted.length) {
    lines.push('Top blocks: ' + sorted.slice(0, 4).map(function (k) {
      return k + '=' + tally[k];
    }).join(', '));
  }
  lines.push('Run 🔍 Diagnose Bet Card funnel for full detail.');
  return lines.join('\n');
}

function refreshMLBBetCard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (typeof refreshPitcherKSimEngine_ === 'function') refreshPitcherKSimEngine_();
  if (typeof refreshBatterHitsSimEngine_ === 'function') refreshBatterHitsSimEngine_();

  const cfg = getConfig();
  const bankroll = parseFloat(String(cfg['BANKROLL'] != null ? cfg['BANKROLL'] : '1000').trim(), 10) || 1000;
  const kellyFrac = parseFloat(String(cfg['KELLY_FRACTION'] != null ? cfg['KELLY_FRACTION'] : '0.25').trim(), 10) || 0.25;
  const slateDate = getSlateDateString_(cfg);
  const gameTimeIdx = mlbScheduleGameTimeIndex_(ss);

  const srcK = mlbBetCardSourceSheet_(ss, MLB_PITCHER_K_SIM_TAB, MLB_PITCHER_K_CARD_TAB, 'K');
  const srcHits = mlbBetCardSourceSheet_(
    ss,
    MLB_BATTER_HITS_SIM_TAB,
    typeof MLB_BATTER_HITS_V2_CARD_TAB !== 'undefined'
      ? MLB_BATTER_HITS_V2_CARD_TAB
      : '🧪 Batter_Hits_Card_v2-full',
    'H'
  );

  if (!srcK && !srcHits) {
    safeAlert_(
      'MLB Bet Card',
      'Run at least one sim chain first (🎰 Pitcher_K_Card → ⚡ Sim_Pitcher_K and/or 🧪 Batter_Hits_Card_v2-full → ⚡ Sim_Batter_Hits). Morning pipeline builds all.'
    );
    return;
  }

  const segmentMode = String(cfg['K_SEGMENT_MODE'] != null ? cfg['K_SEGMENT_MODE'] : 'shadow')
    .trim()
    .toLowerCase();
  const segmentAudit = segmentMode === 'shadow' || segmentMode === 'live';
  let kPlays = [];
  let kRows = [];
  let kPlaysLegacy = 0;

  if (srcK && srcK.getLastRow() >= 4) {
    const lastK = srcK.getLastRow();
    // Full width + sim-shape normalization (card fallback rows get re-mapped).
    // Data is rows 4..lastK → (lastK - 3) rows.
    kRows = mlbBetCardKRowsToSimShape_(
      srcK,
      srcK.getRange(4, 1, lastK - 3, srcK.getLastColumn()).getValues()
    );
    kRows.forEach(function (r) {
      const play = mlbBetCardKRowToPlay_(r, cfg, gameTimeIdx);
      if (play) {
        kPlays.push(play);
        kPlaysLegacy++;
      }
    });
  }
  const hPlays = [];
  if (segmentMode === 'shadow' || segmentMode === 'live') {
    const segRes = mlbBetCardApplyKSegmentMode_(kPlays, kRows, cfg, ss, segmentMode);
    kPlays = segRes.kPlays;
  }

  const includeHitsOnCard =
    String(cfg['K_SEGMENT_INCLUDE_H'] != null ? cfg['K_SEGMENT_INCLUDE_H'] : 'N').toUpperCase() === 'Y';

  if (includeHitsOnCard && srcHits && srcHits.getLastRow() >= 4) {
    const lastH = srcHits.getLastRow();
    // v2 card column layout (34 cols): cols 0..17 mirror v1 (gamePk..batter_id),
    // cols 18..31 carry v2 ablation/diagnostic fields, col 32=hp_umpire, 33=hot_cold.
    const valsH = srcHits.getRange(4, 1, lastH, 34).getValues();
    valsH.forEach(function (r) {
      const flags = String(r[16] || '');
      const batterId = r[17];
      const hpUmp = String(r[32] || '').trim();
      const hotCold = String(r[33] || '').toUpperCase();
      if (flags.indexOf('injury') !== -1) return;

      const bestSide = String(r[14] || '').trim();
      if (bestSide !== 'Over' && bestSide !== 'Under') return;

      const line = r[3];
      if (line === '' || line == null) return;

      const fdOver = r[4];
      const fdUnder = r[5];
      const american = bestSide === 'Over' ? fdOver : fdUnder;
      if (american === '' || american == null || isNaN(parseFloat(String(american)))) return;
      // H is an OUTCOME market: bet favorites, not action. Favorites-only band
      // [MIN_ODDS_H, MAX_ODDS_H] = 62% hit / -5.4% flat vs plus-money H = -45.7%.
      const amH = parseFloat(String(american));
      const maxOddsH = parseFloat(String(cfg['MAX_ODDS_H'] != null ? cfg['MAX_ODDS_H'] : '0')) || 0;
      if (maxOddsH < 0 && !isNaN(amH) && amH < maxOddsH) return; // block extreme juice (beyond -300)
      const minOddsH = parseFloat(String(cfg['MIN_ODDS_H'] != null ? cfg['MIN_ODDS_H'] : '0')) || 0;
      if (minOddsH < 0 && !isNaN(amH) && amH > minOddsH) return; // block skinny favs & plus-money (longer than -140)

      const batter = String(r[2] || '').trim();
      if (!batter) return;

      const pWin = bestSide === 'Over' ? r[8] : r[9];
      const pwNum = parseFloat(String(pWin));
      const hThr = mlbBetCardThresholds_(cfg, 'H');
      if (isNaN(pwNum) || pwNum < hThr.minP) return;
      const hEdge = parseFloat(String(r[7]));
      if (hThr.minEdge > 0 && (isNaN(hEdge) || Math.abs(hEdge) < hThr.minEdge)) return;

      const evRaw = r[15];
      const ev = parseFloat(String(evRaw));
      if (isNaN(ev) || ev <= 0) return;
      const minEvH = parseFloat(String(cfg['MIN_EV_BET_CARD'] != null ? cfg['MIN_EV_BET_CARD'] : '0')) || 0;
      if (minEvH > 0 && ev < minEvH) return;
      // MAX_EV_BET_CARD: ceiling on EV per $1 — H EV ≥0.5 hit only 16.7% (n=48,
      // -55.9% ROI). When the model claims a massive edge it's overestimating P.
      const maxEvCardH = parseFloat(String(cfg['MAX_EV_BET_CARD'] != null ? cfg['MAX_EV_BET_CARD'] : '0'));
      if (!isNaN(maxEvCardH) && maxEvCardH > 0 && ev > maxEvCardH) return;
      const implied = bestSide === 'Over' ? r[10] : r[11];
      const matchup = r[1];
      const gamePk = r[0];
      const pickLabel =
        batter + ' — H ' + bestSide + ' ' + String(line) + (hpUmp ? ' · HP ' + hpUmp : '');
      const gt = gameTimeIdx[parseInt(gamePk, 10)] || {};

      hPlays.push({
        kind: 'H',
        gamePk: gamePk,
        matchup: matchup,
        pickLabel: pickLabel,
        player: batter,
        playerId: batterId,
        side: bestSide,
        line: line,
        american: american,
        pWin: pWin,
        implied: implied,
        impliedOpp: bestSide === 'Over' ? r[11] : r[10],
        ev: isNaN(ev) ? '' : ev,
        lambda: r[6],
        edge: r[7],
        flags: flags,
        market: 'Batter hits',
        gameTimeIso: gt.iso || '',
        gameTimeHHmm: gt.hhmm || '',
        hotCold: hotCold,
      });
    });
  }

  const allPlays = kPlays.concat(hPlays);

  // Outcome-first ranking: order by model win probability (most likely winners)
  // unless PICK_BY=ev (legacy). Bankroll is finite — being correct beats chasing
  // theoretical value. This is the order used before any per-game cap selection.
  const pickMode = typeof mlbPickBy_ === 'function' ? mlbPickBy_(cfg) : 'ev';
  function mlbBetCardPlayRank_(p) {
    return pickMode === 'ev' ? parseFloat(String(p.ev)) : parseFloat(String(p.pWin));
  }
  allPlays.sort(function (a, b) {
    const be = mlbBetCardPlayRank_(b);
    const ae = mlbBetCardPlayRank_(a);
    if (isNaN(be) && isNaN(ae)) return 0;
    if (isNaN(be)) return 1;
    if (isNaN(ae)) return -1;
    return be - ae;
  });

  // Filters applied above per market: pWin ≥ per-market floor, optional |edge| ≥ MIN_EDGE_*,
  // EV > 0, MIN_EV_BET_CARD, MAX_ODDS_H (H). See mlbBetCardThresholds_().
  const selected = allPlays;

  // Display order: game start time asc, then by gamePk (keep same-time games
  // grouped), then by rank (win prob in outcome mode, EV in legacy) within a game.
  selected.sort(function (a, b) {
    const ta = a.gameTimeIso || '';
    const tb = b.gameTimeIso || '';
    if (ta && tb && ta !== tb) return ta < tb ? -1 : 1;
    if (ta && !tb) return -1;
    if (!ta && tb) return 1;
    const ga = String(a.gamePk != null ? a.gamePk : '');
    const gb = String(b.gamePk != null ? b.gamePk : '');
    if (ga !== gb) return ga < gb ? -1 : 1;
    const be = mlbBetCardPlayRank_(b);
    const ae = mlbBetCardPlayRank_(a);
    if (isNaN(be) && isNaN(ae)) return 0;
    if (isNaN(be)) return 1;
    if (isNaN(ae)) return -1;
    return be - ae;
  });

  const betCardNcol = segmentAudit ? MLB_BET_CARD_AUDIT_NCOL : MLB_BET_CARD_NCOL;

  // Build rows; insert a blank spacer row between game groups for visual separation.
  const rows = [];
  const hotColdByRow = []; // parallel to rows, '' for spacers
  let lastGamePk = null;
  let visibleIdx = 0;
  selected.forEach(function (p) {
    const gKey = String(p.gamePk != null ? p.gamePk : '');
    if (lastGamePk !== null && gKey !== lastGamePk) {
      rows.push(new Array(betCardNcol).fill(''));  // spacer row
      hotColdByRow.push('');
    }
    lastGamePk = gKey;
    visibleIdx++;
    const stake = mlbKellyStake_(p.pWin, p.american, bankroll, kellyFrac, cfg);
    const rowOut = [
      slateDate,                                                  // 0  date
      visibleIdx,                                                 // 1  #
      p.gamePk,                                                   // 2  gamePk
      p.matchup,                                                  // 3  matchup
      p.pickLabel,                                                // 4  play
      p.player,                                                   // 5  player
      p.market,                                                   // 6  market
      p.side,                                                     // 7  side
      p.line,                                                     // 8  line
      p.american,                                                 // 9  odds
      p.lambda,                                                   // 10 proj (OUR projection — next to the line for a quick sanity check)
      p.edge,                                                     // 11 proj − line
      p.pWin,                                                     // 12 model %
      p.implied !== '' && p.implied != null ? p.implied : '',     // 13 book %
      p.ev,                                                       // 14 ev / $1
      stake,                                                      // 15 stake $
      p.flags,                                                    // 16 flags
      p.playerId != null && p.playerId !== '' ? p.playerId : '',  // 17 player_id
      p.gameTimeHHmm || '',                                       // 18 time
    ];
    // Segment-audit slots (19–24): real values in shadow/live, blank otherwise.
    // Always written so column positions stay fixed for downstream readers.
    rowOut.push(
      segmentAudit && p.pWinRaw !== '' && p.pWinRaw != null ? p.pWinRaw : '',
      segmentAudit && p.pWinCal !== '' && p.pWinCal != null ? p.pWinCal : '',
      segmentAudit ? (p.segmentId || '') : '',
      segmentAudit ? (p.matchupTags || '') : '',
      segmentAudit && p.lambdaRaw !== '' && p.lambdaRaw != null ? p.lambdaRaw : '',
      segmentAudit && p.oppKL14 !== '' && p.oppKL14 != null ? p.oppKL14 : ''
    );
    // No-vig "fair %" the book really implies, and our edge vs that fair number.
    // Raw "book %" (col 13) still shown for transparency; it's vig-inflated.
    const fair = mlbDevigTwoWay_(p.implied, p.impliedOpp);
    const pWinNum = parseFloat(String(p.pWin));
    const edgeVsFair =
      fair.fairSide !== '' && !isNaN(pWinNum)
        ? Math.round((pWinNum - fair.fairSide) * 1000) / 1000
        : '';
    rowOut.push(fair.fairSide, edgeVsFair);
    if (p.kind === 'K') {
      rowOut.push(p.projIp != null ? p.projIp : '', p.projIpV2 != null ? p.projIpV2 : '');
    } else {
      rowOut.push('', '');
    }
    rows.push(rowOut);
    hotColdByRow.push(p.hotCold || '');
  });

  if (rows.length === 0) {
    const blank = new Array(betCardNcol).fill('');
    blank[0] = slateDate;
    blank[4] =
      'No qualifying plays — build ⚡ Sim_Pitcher_K / ⚡ Sim_Batter_Hits with ' +
      'Config gates (MIN_MODEL_PCT_*, MIN_EV_BET_CARD, MAX_ODDS_H), ev > 0, valid FD price, no injury flag.';
    rows.push(blank);
  }

  let sh = ss.getSheetByName(MLB_BET_CARD_TAB);
  if (sh) {
    const cr = Math.max(sh.getLastRow(), 3);
    const cc = Math.max(sh.getLastColumn(), betCardNcol);
    try {
      sh.getRange(1, 1, cr, cc).breakApart();
    } catch (e) {}
    sh.clearContents();
    sh.clearFormats();
  } else {
    sh = ss.insertSheet(MLB_BET_CARD_TAB);
  }
  sh.setTabColor('#1a2332');

  const headers = [
    'date',
    '#',
    'gamePk',
    'matchup',
    'play',
    'player',
    'market',
    'side',
    'line',
    'odds',
    'proj',
    'proj − line',
    'model %',
    'book %',
    'ev / $1',
    'stake $',
    'flags',
    'player_id',
    'time',
  ];
  headers.push('p_win_raw', 'p_win_cal', 'segment_id', 'matchup_tags', 'lambda_raw', 'opp_k_l14');
  headers.push('fair %', 'edge vs fair');
  headers.push('proj_IP', 'projIP_v2');

  sh.getRange(3, 1, 1, headers.length).setValues([headers]);
  if (typeof mlbApplyHeaderNotes_ === 'function') mlbApplyHeaderNotes_(sh, 3, headers);
  sh.getRange(4, 1, rows.length, headers.length).setValues(rows);

  const hasRealRows =
    rows.length > 0 && rows[0][5] && String(rows[0][5]).indexOf('No qualifying') === -1;
  if (hasRealRows) {
    try {
      ss.setNamedRange('MLB_BET_CARD', sh.getRange(4, 1, rows.length, headers.length));
    } catch (e) {}
  }

  // All visual rendering lives in MLBBetCardFormatting.js — keep it that way.
  mlbApplyBetCardFormatting_(sh, hasRealRows ? rows : [], headers, slateDate);

  // Hot/Cold: orange (HOT) or blue (COLD) medium border around the player-name
  // cell. Applied after the global formatter so the default hairline rule on the
  // body range doesn't overwrite it. Player name is column 6 (1-indexed).
  if (hasRealRows) {
    const playerCol = 6;
    const hotStyle = SpreadsheetApp.BorderStyle.SOLID_MEDIUM;
    for (let i = 0; i < hotColdByRow.length; i++) {
      const f = String(hotColdByRow[i] || '').toUpperCase();
      if (f !== 'HOT' && f !== 'COLD') continue;
      const color = f === 'HOT' ? MLB_HOT_BORDER_COLOR : MLB_COLD_BORDER_COLOR;
      sh.getRange(4 + i, playerCol).setBorder(
        true, true, true, true, false, false, color, hotStyle
      );
    }
  }

  if (hasRealRows) {
    const trackerStart = 4 + rows.length + 2;
    const afterV1 = mlbAppendBetTrackerSection_(ss, sh, trackerStart, slateDate);
    let afterV2 = afterV1;
    if (typeof mlbAppendBetTrackerSectionV2_ === 'function') {
      afterV2 = mlbAppendBetTrackerSectionV2_(ss, sh, afterV1 + 1, slateDate);
    }
    let afterHitsV3 = afterV2;
    if (typeof mlbAppendBetTrackerSectionHitsV3_ === 'function') {
      afterHitsV3 = mlbAppendBetTrackerSectionHitsV3_(ss, sh, afterV2 + 1, slateDate);
    }
    if (typeof mlbAppendBetTrackerByEdgeSection_ === 'function') {
      mlbAppendBetTrackerByEdgeSection_(ss, sh, afterHitsV3 + 1, slateDate);
    }
  }

  sh.setFrozenRows(3);
  sh.setHiddenGridlines(true);

  const gameSet = {};
  selected.forEach(function (p) {
    gameSet[String(p.gamePk != null ? p.gamePk : '')] = true;
  });
  __mlbBetCardLastStats_ = {
    picks: selected.length,
    games: Object.keys(gameSet).filter(function (k) { return k !== ''; }).length,
    cardBlockRows: rows.length,
    sheetLastRow: sh.getLastRow(),
  };
  const segNote =
    segmentMode === 'live'
      ? ' · K live segments'
      : segmentMode === 'shadow'
        ? ' · K shadow audit'
        : '';
  const kCount = selected.filter(function (p) {
    return p.kind === 'K';
  }).length;
  if (kCount === 0 && kRows.length > 0) {
    const why = mlbKBetCardZeroPickSummary_(kRows, cfg, segmentMode, kPlaysLegacy);
    try {
      if (typeof addPipelineWarning_ === 'function') {
        addPipelineWarning_('🃏 0 K picks — ' + why.split('\n')[0]);
      }
    } catch (eW) {}
    ss.toast('0 K picks on card — see alert', 'MLB Bet Card', 8);
    safeAlert_('MLB Bet Card — 0 K picks', why);
  } else {
    ss.toast(
      selected.length + ' picks (' + kCount + ' K) · ' +
        Object.keys(gameSet).filter(function (k) {
          return k !== '';
        }).length +
        ' games · ' +
        slateDate +
        segNote,
      'MLB Bet Card',
      6
    );
  }
}

/**
 * Pick-column rejection (before pWin/EV/odds gates). Aligns diag with 🃏 card semantics.
 * @returns {{reason:string, detail:string}} reason '' = Over/Under pick present.
 */
function mlbBetCardPickReject_(market, row, pick) {
  const labelIdx = market === 'K' ? 3 : 2;
  const flagsIdx = market === 'K' ? 18 : 16;
  const projIdx = market === 'K' ? 8 : 6;
  const lineIdx = market === 'K' ? 4 : 3;
  const player = String(row[labelIdx] || '').trim();
  if (!player) return { reason: 'blank_row', detail: '' };
  const flags = String(row[flagsIdx] || '');
  const side = String(pick || '').trim();
  if (flags.indexOf('injury') !== -1) return { reason: 'injury_flag', detail: flags };
  if (flags.indexOf('no_model') !== -1) return { reason: 'no_model', detail: '' };
  if (flags.indexOf('agree_fd') !== -1) {
    return { reason: 'agree_fd', detail: '|proj − line| < 0.5 — off board' };
  }
  if (side === 'Over' || side === 'Under') return { reason: '', detail: '' };
  const onBoardFn = market === 'K' ? mlbKPickOnBoard_ : mlbHitsPickOnBoard_;
  if (typeof onBoardFn === 'function') {
    const board = onBoardFn(row[projIdx], row[lineIdx]);
    if (board && !board.onBoard) {
      return { reason: 'agree_fd', detail: '|proj − line| < 0.5 — off board' };
    }
  }
  if (!side) return { reason: 'no_pick', detail: 'pick blank — no Over/Under on card' };
  return { reason: 'invalid_side', detail: 'pick="' + side + '"' };
}

// ============================================================
// 🔍 Diagnose why Hits rows are/aren't making the bet card.
// Writes results to a 🔍 BetCard_Diag_Hits tab + Logger.
// Run from script editor or add a menu entry. Idempotent.
// ============================================================
function diagnoseHitsBetCardInclusion() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig();
  const hThr = mlbBetCardThresholds_(cfg, 'H');
  const minEv = parseFloat(String(cfg['MIN_EV_BET_CARD'] != null ? cfg['MIN_EV_BET_CARD'] : '0')) || 0;
  const maxEvCard = parseFloat(String(cfg['MAX_EV_BET_CARD'] != null ? cfg['MAX_EV_BET_CARD'] : '0')) || 0;
  const maxOddsH = parseFloat(String(cfg['MAX_ODDS_H'] != null ? cfg['MAX_ODDS_H'] : '0')) || 0;
  const minOddsH = parseFloat(String(cfg['MIN_ODDS_H'] != null ? cfg['MIN_ODDS_H'] : '0')) || 0;
  const srcTab =
    typeof MLB_BATTER_HITS_SIM_TAB !== 'undefined' ? MLB_BATTER_HITS_SIM_TAB : '⚡ Sim_Batter_Hits';
  const src = ss.getSheetByName(srcTab);
  const diagTab = '🔍 BetCard_Diag_Hits';
  const log = [];
  log.push('Source tab: ' + srcTab + ' (fallback: v2 stat card if sim empty on live merge)');
  log.push(
    'Gates: pWin ≥ ' + hThr.minP +
    (hThr.minEdge > 0 ? ' AND |edge| ≥ ' + hThr.minEdge : '') +
    ' AND ev > 0 AND ev ≥ MIN_EV_BET_CARD' +
    (maxEvCard > 0 ? ' AND ev ≤ MAX_EV_BET_CARD' : '') +
    (maxOddsH < 0 ? ' AND odds ≥ MAX_ODDS_H (' + maxOddsH + ')' : '') +
    (minOddsH < 0 ? ' AND odds ≤ MIN_ODDS_H (' + minOddsH + ')' : '')
  );

  if (!src) {
    log.push('FAIL: tab not found');
    Logger.log(log.join('\n'));
    safeAlert_('Hits diag', log.join('\n'));
    return;
  }
  const lastRow = src.getLastRow();
  log.push('lastRow=' + lastRow);
  if (lastRow < 4) {
    log.push('FAIL: no data rows below header (lastRow<4)');
    Logger.log(log.join('\n'));
    safeAlert_('Hits diag', log.join('\n'));
    return;
  }

  const vals = src.getRange(4, 1, lastRow, 17).getValues();
  log.push('Scanned ' + vals.length + ' card rows.');

  const tally = {
    blank_row: 0,
    injury_flag: 0,
    agree_fd: 0,
    no_model: 0,
    no_pick: 0,
    invalid_side: 0,
    blank_line: 0,
    bad_price: 0,
    h_odds_too_juiced: 0,
    h_odds_too_long: 0,
    bad_pwin: 0,
    pwin_below_floor: 0,
    edge_below_floor: 0,
    ev_not_positive: 0,
    ev_below_min_ev: 0,
    ev_above_max_ev: 0,
    passed: 0,
  };
  const rejectExamples = [];
  const passList = [];

  vals.forEach(function (r, i) {
    const rowNum = i + 4;
    const gamePk = r[0];
    const matchup = r[1];
    const batter = String(r[2] || '').trim();
    const line = r[3];
    const fdOver = r[4];
    const fdUnder = r[5];
    const pOver = r[8];
    const pUnder = r[9];
    const bestSide = String(r[14] || '').trim();

    function rej(reason, detail) {
      tally[reason]++;
      if (rejectExamples.length < 40) {
        rejectExamples.push([rowNum, batter, matchup, reason, detail]);
      }
    }

    const pickRej = mlbBetCardPickReject_('H', r, bestSide);
    if (pickRej.reason) {
      rej(pickRej.reason, pickRej.detail);
      return;
    }
    if (line === '' || line == null) { rej('blank_line', ''); return; }

    const american = bestSide === 'Over' ? fdOver : fdUnder;
    if (american === '' || american == null || isNaN(parseFloat(String(american)))) {
      rej('bad_price', 'side=' + bestSide + ' price="' + american + '"'); return;
    }
    const amNum = parseFloat(String(american));
    if (maxOddsH < 0 && !isNaN(amNum) && amNum < maxOddsH) {
      rej('h_odds_too_juiced', String(american) + ' < MAX_ODDS_H ' + maxOddsH); return;
    }
    if (minOddsH < 0 && !isNaN(amNum) && amNum > minOddsH) {
      rej('h_odds_too_long', String(american) + ' > MIN_ODDS_H ' + minOddsH); return;
    }

    const pWin = bestSide === 'Over' ? pOver : pUnder;
    const pwNum = parseFloat(String(pWin));
    if (isNaN(pwNum)) {
      rej('bad_pwin', 'side=' + bestSide + ' pWin="' + pWin + '"'); return;
    }
    if (pwNum < hThr.minP) {
      rej('pwin_below_floor', 'side=' + bestSide + ' pWin=' + pwNum + ' floor=' + hThr.minP); return;
    }
    const hEdge = parseFloat(String(r[7]));
    if (hThr.minEdge > 0 && (isNaN(hEdge) || Math.abs(hEdge) < hThr.minEdge)) {
      rej('edge_below_floor', '|edge|=' + hEdge + ' floor=' + hThr.minEdge); return;
    }

    const evNum = parseFloat(String(r[15]));
    if (isNaN(evNum) || evNum <= 0) {
      rej('ev_not_positive', 'side=' + bestSide + ' ev=' + r[15]); return;
    }
    if (minEv > 0 && evNum < minEv) {
      rej('ev_below_min_ev', 'side=' + bestSide + ' ev=' + evNum + ' min=' + minEv); return;
    }
    if (maxEvCard > 0 && evNum > maxEvCard) {
      rej('ev_above_max_ev', 'side=' + bestSide + ' ev=' + evNum + ' max=' + maxEvCard); return;
    }

    tally.passed++;
    if (passList.length < 200) {
      passList.push([rowNum, batter, matchup, bestSide, line, american, pwNum, r[15]]);
    }
  });

  log.push('--- tally ---');
  Object.keys(tally).forEach(function (k) { log.push(k + ': ' + tally[k]); });

  let sh = ss.getSheetByName(diagTab);
  if (sh) { sh.clearContents(); sh.clearFormats(); }
  else { sh = ss.insertSheet(diagTab); }
  sh.setTabColor('#b71c1c');

  sh.getRange(1, 1).setValue('🔍 Hits → BetCard inclusion diagnostic — ' + new Date()).setFontWeight('bold');
  sh.getRange(2, 1).setValue(
    'Gates match 🃏 H merge. agree_fd / no_pick = no bet (not errors). MIN_ODDS_H=0 = no favorites-only band.'
  );
  sh.getRange(2, 1).setWrap(true);

  const tallyRows = Object.keys(tally).map(function (k) { return [k, tally[k]]; });
  sh.getRange(4, 1, 1, 2).setValues([['gate', 'count']]).setFontWeight('bold').setBackground('#37474f').setFontColor('#fff');
  sh.getRange(5, 1, tallyRows.length, 2).setValues(tallyRows);

  const startRej = 5 + tallyRows.length + 2;
  sh.getRange(startRej - 1, 1).setValue('Reject examples (first 40)').setFontWeight('bold');
  sh.getRange(startRej, 1, 1, 5).setValues([['row', 'batter', 'matchup', 'reason', 'detail']])
    .setFontWeight('bold').setBackground('#455a64').setFontColor('#fff');
  if (rejectExamples.length) {
    sh.getRange(startRej + 1, 1, rejectExamples.length, 5).setValues(rejectExamples);
  }

  const startPass = startRej + 1 + Math.max(rejectExamples.length, 1) + 2;
  sh.getRange(startPass - 1, 1).setValue('Passed rows (first 200) — these should appear on 🃏 MLB_Bet_Card').setFontWeight('bold');
  sh.getRange(startPass, 1, 1, 8).setValues([['row', 'batter', 'matchup', 'side', 'line', 'price', 'pWin', 'best_ev']])
    .setFontWeight('bold').setBackground('#1b5e20').setFontColor('#fff');
  if (passList.length) {
    sh.getRange(startPass + 1, 1, passList.length, 8).setValues(passList);
  }

  sh.setColumnWidth(1, 60);
  sh.setColumnWidth(2, 160);
  sh.setColumnWidth(3, 220);
  sh.setColumnWidth(4, 140);
  sh.setColumnWidth(5, 260);

  Logger.log(log.join('\n'));
  ss.toast('passed=' + tally.passed + ' · see ' + diagTab, 'Hits diag', 8);
}

function mlbActivateBetCardDiagFunnelTab_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(MLB_BET_CARD_DIAG_FUNNEL_TAB);
  if (sh) sh.activate();
  else safeAlert_('Bet Card funnel diag', 'Run 🔍 Diagnose Bet Card funnel first.');
}

/**
 * Full K + H funnel: sim row counts, gate rejection tallies, passed picks,
 * and sheet vs toast miscount explanation. Writes 🔍 BetCard_Diag_Funnel.
 */
function diagnoseBetCardFunnel_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig();
  const minEv = parseFloat(String(cfg['MIN_EV_BET_CARD'] != null ? cfg['MIN_EV_BET_CARD'] : '0')) || 0;
  const maxOddsH = parseFloat(String(cfg['MAX_ODDS_H'] != null ? cfg['MAX_ODDS_H'] : '0')) || 0;
  const minOddsH = parseFloat(String(cfg['MIN_ODDS_H'] != null ? cfg['MIN_ODDS_H'] : '0')) || 0;
  const maxOddsK = parseFloat(String(cfg['MAX_ODDS_K'] != null ? cfg['MAX_ODDS_K'] : '0')) || 0;
  const segmentMode = String(cfg['K_SEGMENT_MODE'] != null ? cfg['K_SEGMENT_MODE'] : 'shadow')
    .trim()
    .toLowerCase();
  const kOverFloor = mlbBetCardThresholds_(cfg, 'K', 'Over').minP;
  const kUnderFloor = mlbBetCardThresholds_(cfg, 'K', 'Under').minP;
  const hFloor = mlbBetCardThresholds_(cfg, 'H').minP;
  const includeHitsOnCard =
    String(cfg['K_SEGMENT_INCLUDE_H'] != null ? cfg['K_SEGMENT_INCLUDE_H'] : 'N').toUpperCase() === 'Y';

  const srcK = mlbBetCardSourceSheet_(ss, MLB_PITCHER_K_SIM_TAB, MLB_PITCHER_K_CARD_TAB, 'K');
  const srcH = mlbBetCardSourceSheet_(
    ss,
    MLB_BATTER_HITS_SIM_TAB,
    typeof MLB_BATTER_HITS_V2_CARD_TAB !== 'undefined' ? MLB_BATTER_HITS_V2_CARD_TAB : '🧪 Batter_Hits_Card_v2-full',
    'H'
  );

  function tallyMarket(kind, rows, checkFn) {
    const tally = { passed: 0 };
    const rejects = [];
    const passes = [];
    rows.forEach(function (r, i) {
      const rowNum = i + 4;
      const res = checkFn(r, rowNum);
      if (res.ok) {
        tally.passed++;
        if (passes.length < 50) passes.push(res.passRow);
      } else {
        tally[res.reason] = (tally[res.reason] || 0) + 1;
        if (rejects.length < 40 && res.reason !== 'blank_row') {
          rejects.push([rowNum, res.label, res.matchup, res.reason, res.detail || '']);
        }
      }
    });
    return { tally: tally, rejects: rejects, passes: passes, scanned: rows.length };
  }

  const maxEvCard = parseFloat(String(cfg['MAX_EV_BET_CARD'] != null ? cfg['MAX_EV_BET_CARD'] : '0')) || 0;
  const maxPctKOver = parseFloat(String(cfg['MAX_MODEL_PCT_K_OVER'] != null ? cfg['MAX_MODEL_PCT_K_OVER'] : '0')) || 0;
  const maxPctKUnder = parseFloat(String(cfg['MAX_MODEL_PCT_K_UNDER'] != null ? cfg['MAX_MODEL_PCT_K_UNDER'] : '0')) || 0;

  function checkK(r) {
    const pitcher = String(r[3] || '').trim();
    const matchup = String(r[1] || '');
    const pick = String(r[16] || '').trim();
    const line = r[4];
    const fdOver = r[5];
    const fdUnder = r[6];
    const label = pitcher || '(blank)';
    const pickRej = mlbBetCardPickReject_('K', r, pick);
    if (pickRej.reason) {
      return {
        ok: false,
        reason: pickRej.reason,
        label: label,
        matchup: matchup,
        detail: pickRej.detail || '',
      };
    }
    const bestSide = pick;
    if (line === '' || line == null) return { ok: false, reason: 'blank_line', label: label, matchup: matchup };
    const american = bestSide === 'Over' ? fdOver : fdUnder;
    if (american === '' || american == null || isNaN(parseFloat(String(american)))) {
      return { ok: false, reason: 'bad_price', label: label, matchup: matchup };
    }
    if (maxOddsK > 0 && parseFloat(String(american)) > maxOddsK) {
      return { ok: false, reason: 'k_odds_plus_money', label: label, matchup: matchup, detail: String(american) + ' > +' + maxOddsK };
    }
    const pWin = bestSide === 'Over' ? r[10] : r[11];
    const pwNum = parseFloat(String(pWin));
    const kThr = mlbBetCardThresholds_(cfg, 'K', bestSide);
    if (isNaN(pwNum)) return { ok: false, reason: 'bad_pwin', label: label, matchup: matchup };
    if (pwNum < kThr.minP) {
      return { ok: false, reason: 'pwin_below_floor', label: label, matchup: matchup, detail: 'p=' + pwNum + ' floor=' + kThr.minP };
    }
    if (bestSide === 'Over' && maxPctKOver > 0 && maxPctKOver < 1 && pwNum > maxPctKOver) {
      return { ok: false, reason: 'pwin_above_max_k_over', label: label, matchup: matchup, detail: 'p=' + pwNum + ' max=' + maxPctKOver };
    }
    if (bestSide === 'Under' && maxPctKUnder > 0 && maxPctKUnder < 1 && pwNum > maxPctKUnder) {
      return { ok: false, reason: 'pwin_above_max_k_under', label: label, matchup: matchup, detail: 'p=' + pwNum + ' max=' + maxPctKUnder };
    }
    const kEdge = parseFloat(String(r[9]));
    if (kThr.minEdge > 0 && (isNaN(kEdge) || Math.abs(kEdge) < kThr.minEdge)) {
      return { ok: false, reason: 'edge_below_floor', label: label, matchup: matchup };
    }
    const ev = parseFloat(String(r[17]));
    if (isNaN(ev) || ev <= 0) return { ok: false, reason: 'ev_not_positive', label: label, matchup: matchup, detail: String(r[17]) };
    if (minEv > 0 && ev < minEv) return { ok: false, reason: 'ev_below_min_ev', label: label, matchup: matchup, detail: 'ev=' + ev + ' min=' + minEv };
    if (maxEvCard > 0 && ev > maxEvCard) return { ok: false, reason: 'ev_above_max_ev', label: label, matchup: matchup, detail: 'ev=' + ev + ' max=' + maxEvCard };
    return {
      ok: true,
      passRow: [pitcher, matchup, bestSide, line, american, pwNum, ev],
    };
  }

  function checkH(r) {
    const batter = String(r[2] || '').trim();
    const matchup = String(r[1] || '');
    const pick = String(r[14] || '').trim();
    const line = r[3];
    const fdOver = r[4];
    const fdUnder = r[5];
    const label = batter || '(blank)';
    const pickRej = mlbBetCardPickReject_('H', r, pick);
    if (pickRej.reason) {
      return {
        ok: false,
        reason: pickRej.reason,
        label: label,
        matchup: matchup,
        detail: pickRej.detail || '',
      };
    }
    const bestSide = pick;
    if (line === '' || line == null) return { ok: false, reason: 'blank_line', label: label, matchup: matchup };
    const american = bestSide === 'Over' ? fdOver : fdUnder;
    if (american === '' || american == null || isNaN(parseFloat(String(american)))) {
      return { ok: false, reason: 'bad_price', label: label, matchup: matchup };
    }
    if (maxOddsH < 0 && parseFloat(String(american)) < maxOddsH) {
      return { ok: false, reason: 'h_odds_too_juiced', label: label, matchup: matchup, detail: String(american) };
    }
    if (minOddsH < 0 && parseFloat(String(american)) > minOddsH) {
      return {
        ok: false,
        reason: 'h_odds_too_long',
        label: label,
        matchup: matchup,
        detail: String(american) + ' > MIN_ODDS_H ' + minOddsH,
      };
    }
    const pWin = bestSide === 'Over' ? r[8] : r[9];
    const pwNum = parseFloat(String(pWin));
    const hThr = mlbBetCardThresholds_(cfg, 'H');
    if (isNaN(pwNum)) return { ok: false, reason: 'bad_pwin', label: label, matchup: matchup };
    if (pwNum < hThr.minP) {
      return { ok: false, reason: 'pwin_below_floor', label: label, matchup: matchup, detail: 'p=' + pwNum + ' floor=' + hThr.minP };
    }
    const hEdge = parseFloat(String(r[7]));
    if (hThr.minEdge > 0 && (isNaN(hEdge) || Math.abs(hEdge) < hThr.minEdge)) {
      return { ok: false, reason: 'edge_below_floor', label: label, matchup: matchup };
    }
    const ev = parseFloat(String(r[15]));
    if (isNaN(ev) || ev <= 0) return { ok: false, reason: 'ev_not_positive', label: label, matchup: matchup };
    if (minEv > 0 && ev < minEv) return { ok: false, reason: 'ev_below_min_ev', label: label, matchup: matchup, detail: 'ev=' + ev };
    if (maxEvCard > 0 && ev > maxEvCard) return { ok: false, reason: 'ev_above_max_ev', label: label, matchup: matchup, detail: 'ev=' + ev + ' max=' + maxEvCard };
    return {
      ok: true,
      passRow: [batter, matchup, bestSide, line, american, pwNum, ev],
    };
  }

  const kRows = srcK && srcK.getLastRow() >= 4
    ? mlbBetCardKRowsToSimShape_(
        srcK,
        srcK.getRange(4, 1, srcK.getLastRow() - 3, srcK.getLastColumn()).getValues()
      )
    : [];
  const hRows = srcH && srcH.getLastRow() >= 4
    ? srcH.getRange(4, 1, srcH.getLastRow(), Math.min(34, srcH.getLastColumn())).getValues()
    : [];

  const kRes = tallyMarket('K', kRows, checkK);
  const hRes = tallyMarket('H', hRows, checkH);
  const stats = typeof mlbBetCardPlayStats_ === 'function' ? mlbBetCardPlayStats_() : {};
  const sheetSh = ss.getSheetByName(MLB_BET_CARD_TAB);
  const sheetMiscount = sheetSh && sheetSh.getLastRow() > 3 ? sheetSh.getLastRow() - 3 : 0;

  let sh = ss.getSheetByName(MLB_BET_CARD_DIAG_FUNNEL_TAB);
  if (sh) { sh.clearContents(); sh.clearFormats(); }
  else { sh = ss.insertSheet(MLB_BET_CARD_DIAG_FUNNEL_TAB); }
  sh.setTabColor('#1565c0');

  let row = 1;
  sh.getRange(row++, 1).setValue('🔍 Bet Card funnel diagnostic — ' + new Date()).setFontWeight('bold');
  sh.getRange(row++, 1).setValue(
    'Sources: K=' + (srcK ? srcK.getName() : 'missing') + ' (' + kRows.length + ' rows) · H=' +
    (srcH ? srcH.getName() : 'missing') + ' (' + hRows.length + ' rows)'
  );
  sh.getRange(row++, 1).setValue(
    'Gates (from Config / backtest): K Over pWin ≥ ' + kOverFloor +
    (maxPctKOver > 0 ? ' AND ≤ ' + maxPctKOver : '') +
    ' · K Under pWin ≥ ' + kUnderFloor +
    (maxPctKUnder > 0 ? ' AND ≤ ' + maxPctKUnder : '') +
    ' · H pWin ≥ ' + hFloor +
    ' · MIN_EV_BET_CARD=' + minEv +
    (maxEvCard > 0 ? ' · MAX_EV_BET_CARD=' + maxEvCard : '') +
    (maxOddsK > 0 ? ' · MAX_ODDS_K=' + maxOddsK + ' (no plus-money K)' : '') +
    (maxOddsH < 0 ? ' · MAX_ODDS_H=' + maxOddsH : '') +
    (minOddsH < 0 ? ' · MIN_ODDS_H=' + minOddsH : ' · MIN_ODDS_H=off') +
    ' · K_SEGMENT_MODE=' + segmentMode +
    ' · K_BET_CARD_GATES=' + String(cfg['K_BET_CARD_GATES'] || 'balanced') +
    (includeHitsOnCard ? '' : ' · H merge OFF (K_SEGMENT_INCLUDE_H=N)')
  );
  sh.getRange(row++, 1).setValue(
    'Pick column: agree_fd = |proj − line| < 0.5 (off board, gray on K card). no_pick = blank pick on board. ' +
    'invalid_side = malformed pick text. no_model = no λ. blank_row = empty sim row (ignored). ' +
    'h_odds_too_long = price longer than MIN_ODDS_H (0=off in Config template).'
  ).setWrap(true);
  row++;
  sh.getRange(row++, 1).setValue('Summary').setFontWeight('bold');
  const summaryRows = [
    ['K passed (sim/source)', kRes.tally.passed + ' / ' + kRes.scanned],
    ['H passed (sim/source)', hRes.tally.passed + ' / ' + hRes.scanned],
    ['Total passed (K+H)', String(kRes.tally.passed + hRes.tally.passed)],
    ['Last refresh picks (authoritative)', stats.picks != null ? String(stats.picks) : '(run Bet Card first)'],
    ['Sheet rows below header (old toast bug)', String(sheetMiscount)],
    ['Card block rows only (incl spacers)', stats.cardBlockRows != null ? String(stats.cardBlockRows) : ''],
    ['Note', 'Toast now counts picks only — not Bet Tracker panels appended below.'],
  ];
  sh.getRange(row, 1, summaryRows.length, 2).setValues(summaryRows);
  row += summaryRows.length + 1;

  function writeTally(title, res, startRow) {
    sh.getRange(startRow, 1).setValue(title).setFontWeight('bold');
    const keys = Object.keys(res.tally).filter(function (k) { return k !== 'passed'; });
    const rows = keys.map(function (k) { return [k, res.tally[k]]; });
    rows.unshift(['passed', res.tally.passed]);
    sh.getRange(startRow + 1, 1, 1, 2).setValues([['gate', 'count']]).setFontWeight('bold');
    if (rows.length) sh.getRange(startRow + 2, 1, rows.length, 2).setValues(rows);
    return startRow + 2 + rows.length + 1;
  }

  row = writeTally('K rejection tally', kRes, row);
  row = writeTally('H rejection tally', hRes, row);

  sh.getRange(row++, 1).setValue('Passed picks (should match 🃏)').setFontWeight('bold');
  sh.getRange(row, 1, 1, 7).setValues([['player', 'matchup', 'side', 'line', 'odds', 'pWin', 'ev']])
    .setFontWeight('bold');
  const allPasses = kRes.passes.map(function (p) { return ['K'].concat(p); })
    .concat(hRes.passes.map(function (p) { return ['H'].concat(p); }));
  if (allPasses.length) {
    sh.getRange(row + 1, 1, allPasses.length, 7).setValues(
      allPasses.map(function (p) { return p.slice(1); })
    );
    row += 1 + allPasses.length;
  } else {
    row += 2;
  }

  sh.getRange(row++, 1).setValue('Sample rejections (first 40 per market)').setFontWeight('bold');
  const rejHdr = [['row', 'player', 'matchup', 'reason', 'detail']];
  sh.getRange(row, 1, 1, 5).setValues(rejHdr).setFontWeight('bold');
  const rejAll = kRes.rejects.concat(hRes.rejects);
  if (rejAll.length) sh.getRange(row + 1, 1, rejAll.length, 5).setValues(rejAll);

  sh.setColumnWidth(1, 200);
  sh.setColumnWidth(2, 220);
  sh.setColumnWidth(5, 280);
  sh.activate();

  const msg =
    'K pass=' + kRes.tally.passed + '/' + kRes.scanned +
    ' · H pass=' + hRes.tally.passed + '/' + hRes.scanned +
    ' · see ' + MLB_BET_CARD_DIAG_FUNNEL_TAB;
  Logger.log(msg);
  ss.toast(msg, 'Bet Card funnel diag', 10);
}
