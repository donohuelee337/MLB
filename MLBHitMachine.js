// ============================================================
// 🎯 Hit Machine — 2-leg 1+H parlay (SHADOW: paper stakes only)
// ============================================================
// Singles at -200/-280 are unbettable juice; two high-confidence 1+hit
// legs from DIFFERENT games multiply to near-even odds. A parlay is an
// edge AMPLIFIER, not an edge creator — it only works if per-leg
// probabilities are real, which is exactly what this shadow log measures
// before any real money moves. Promotion bar: HM_PROMOTE_MIN_N graded
// parlays with positive ROI (and per-leg hit rate above break-even).
//
// Selection (from ⚡ Sim_Batter_Hits, line 0.5 Over = P(1+ hit)):
//   gates: p ≥ HM_MIN_P · leg odds ≥ HM_LEG_ODDS_FLOOR · no injury flag ·
//          lineup slot 1–5 when confirmed (absent from confirmed = skip) ·
//          BvP stay-away veto (career PA ≥ HM_BVP_MIN_PA vs tonight's SP
//          and hitless / avg < HM_BVP_MAX_AVG → one-way PRUNE, never boost)
//   rank:  p(1+H) desc, arsenal matchup rv as tiebreak; top 2 from
//          different games form the parlay.
// BvP + arsenal values are LOGGED on every candidate so the graded data
// can vote on whether the veto/tiebreak actually earn their keep.
// ============================================================

const MLB_HIT_MACHINE_TAB = '🎯 Hit_Machine';
const MLB_HIT_MACHINE_LOG_TAB = '📋 HitMachine_Log';
const MLB_HIT_MACHINE_LOG_NCOL = 27;

const MLB_HIT_MACHINE_LOG_HEADERS = [
  'Logged At', 'Slate',
  'leg1_player', 'leg1_id', 'leg1_gamePk', 'leg1_odds', 'leg1_p', 'leg1_arsenal_rv', 'leg1_bvp',
  'leg2_player', 'leg2_id', 'leg2_gamePk', 'leg2_odds', 'leg2_p', 'leg2_arsenal_rv', 'leg2_bvp',
  'parlay_american', 'parlay_p', 'ev_$1', 'stake $',
  'leg_results', 'result', 'pnl $', 'grade_notes', 'bet_key', 'Window', 'flags',
];

var __mlbHmBvpCache = {}; // 'bid|spId' → {pa, h, avg} | null

function mlbResetHitMachineCaches_() {
  __mlbHmBvpCache = {};
}

/** Career batter-vs-pitcher line from statsapi. null = no data / fetch fail. */
function mlbHmBvpCareer_(batterId, spId) {
  const key = String(batterId) + '|' + String(spId);
  if (key in __mlbHmBvpCache) return __mlbHmBvpCache[key];
  let out = null;
  try {
    const url =
      mlbStatsApiBaseUrl_() + '/people/' + parseInt(batterId, 10) +
      '/stats?stats=vsPlayerTotal&group=hitting&opposingPlayerId=' + parseInt(spId, 10);
    const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (resp.getResponseCode() === 200) {
      const json = JSON.parse(resp.getContentText());
      const splits = json && json.stats && json.stats[0] && json.stats[0].splits;
      const st = splits && splits[0] && splits[0].stat;
      if (st) {
        const pa = parseInt(st.plateAppearances, 10) || parseInt(st.atBats, 10) || 0;
        const h = parseInt(st.hits, 10) || 0;
        const ab = parseInt(st.atBats, 10) || 0;
        out = { pa: pa, h: h, avg: ab > 0 ? h / ab : NaN };
      }
    }
    Utilities.sleep(150); // pacing — candidates only, never the whole slate
  } catch (e) {
    Logger.log('mlbHmBvpCareer_: ' + (e.message || e));
  }
  __mlbHmBvpCache[key] = out;
  return out;
}

/** Tonight's opposing SP id for a sim row (schedule probables by name). */
function mlbHmSpIdForRow_(ss, gamePk, oppSpName) {
  const want = mlbNormalizePersonName_(oppSpName);
  if (!want) return 0;
  const block = typeof mlbGetScheduleBlock_ === 'function' ? mlbGetScheduleBlock_(ss) : [];
  for (let i = 0; i < block.length; i++) {
    if (parseInt(block[i][0], 10) !== parseInt(gamePk, 10)) continue;
    if (mlbNormalizePersonName_(block[i][6]) === want) return parseInt(block[i][11], 10) || 0;
    if (mlbNormalizePersonName_(block[i][7]) === want) return parseInt(block[i][12], 10) || 0;
    break;
  }
  return 0;
}

function mlbHmDecimalFromAmerican_(american) {
  const b = mlbAmericanToB_(american);
  return isFinite(b) && b > 0 ? 1 + b : NaN;
}

function mlbHmAmericanFromDecimal_(dec) {
  if (!isFinite(dec) || dec <= 1) return '';
  return dec >= 2 ? Math.round((dec - 1) * 100) : -Math.round(100 / (dec - 1));
}

function mlbHmResultKey_(slate, id1, id2) {
  return [String(slate || '').trim(), String(id1 || ''), String(id2 || '')].join('|');
}

/**
 * Build the 🎯 Hit Machine board + upsert today's shadow parlay to the log.
 * Pipeline step (after sims + health signals) and menu item.
 */
function refreshHitMachine_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig();
  if (String(cfg['HM_ENABLED'] != null ? cfg['HM_ENABLED'] : 'Y').toUpperCase() !== 'Y') return;
  // HM_MIN_P gates PARLAY LEGS only — the candidate list always shows the
  // top-N most-likely hitters regardless. Post-shrink scale (× 0.82).
  const minP = parseFloat(String(cfg['HM_MIN_P'] != null ? cfg['HM_MIN_P'] : '0.65')) || 0.65;
  const listN = parseInt(String(cfg['HM_LIST_N'] != null ? cfg['HM_LIST_N'] : '10'), 10) || 10;
  const oddsFloor = parseFloat(String(cfg['HM_LEG_ODDS_FLOOR'] != null ? cfg['HM_LEG_ODDS_FLOOR'] : '-350')) || -350;
  const bvpMinPa = parseInt(String(cfg['HM_BVP_MIN_PA'] != null ? cfg['HM_BVP_MIN_PA'] : '12'), 10) || 12;
  const bvpMaxAvg = parseFloat(String(cfg['HM_BVP_MAX_AVG'] != null ? cfg['HM_BVP_MAX_AVG'] : '0.10')) || 0.10;
  const paperStake = parseFloat(String(cfg['HM_PAPER_STAKE'] != null ? cfg['HM_PAPER_STAKE'] : '2.50')) || 2.5;

  const src = ss.getSheetByName(MLB_BATTER_HITS_SIM_TAB);
  if (!src || src.getLastRow() < 4) {
    mlbHmWriteBoard_(ss, [], null, 'Run the Hits sim first (Morning pipeline builds it).', '');
    return;
  }
  // Read through the audit block (col 35 = lambda_hits_model, the UNANCHORED
  // model λ). The sim's own p_over anchors λ 65% toward the betting line —
  // sane for K where the line IS the market's estimate, degenerate for hits
  // where every line is the constant 0.5: it dragged every batter toward
  // ~0.8 expected hits and every P(1+H) toward a coin flip, so no one could
  // ever clear the floor. The Machine answers the actual question — "is this
  // guy going to get a hit?" — from the unanchored model.
  const rows = src.getRange(4, 1, src.getLastRow() - 3, Math.min(40, src.getLastColumn())).getValues();
  const hShrinkRaw = parseFloat(String(cfg['H_MODEL_P_SHRINK'] != null ? cfg['H_MODEL_P_SHRINK'] : '0.82'));
  const hShrink = (!isNaN(hShrinkRaw) && hShrinkRaw > 0 && hShrinkRaw <= 1) ? hShrinkRaw : 0.82;

  // Pass 1 — probability-first pool. ODDS ARE NOT AN ENTRY REQUIREMENT:
  // the list is "the N batters most likely to get a hit"; price/EV attach
  // when FD still posts the market. Every rejection is tallied.
  const tally = { scanned: 0, noModel: 0, injury: 0, noIds: 0, scratched: 0, slot6plus: 0, noOdds: 0 };
  let bestP = NaN;
  const pool = [];
  rows.forEach(function (r) {
    const batter = String(r[2] || '').trim();
    if (!batter) return;
    tally.scanned++;
    const lamModel = parseFloat(String(r.length > 34 && r[34] != null ? r[34] : ''));
    const estPa = parseFloat(String(r[25]));
    let p = NaN;
    if (isFinite(lamModel) && lamModel > 0 && isFinite(estPa) && estPa > 0 &&
        typeof mlbBinomialPGeqK_ === 'function') {
      let ba = lamModel / estPa;
      ba = Math.max(0.02, Math.min(0.499, ba));
      // One-sided shrink on the Over — same calibration treatment as the
      // live h.v2-full-sim-os path, applied to the unanchored λ.
      p = Math.min(0.9999, mlbBinomialPGeqK_(1, estPa, ba) * hShrink);
    }
    if (isNaN(p)) { tally.noModel++; return; }
    if (isNaN(bestP) || p > bestP) bestP = p;
    const flags = String(r[16] || '');
    if (flags.indexOf('injury') !== -1) { tally.injury++; return; }
    const gamePk = parseInt(r[0], 10);
    const batterId = parseInt(r[17], 10);
    if (!gamePk || !batterId) { tally.noIds++; return; }
    // Lineup: confirmed-absent = scratch (skip); confirmed slot 6+ = skip
    // (PA count is half the battle for 1+H); unconfirmed = flag only.
    let lineupNote = '';
    if (typeof mlbInjuryLineupConfirmed_ === 'function' && mlbInjuryLineupConfirmed_(gamePk)) {
      const slot = typeof mlbLineupSlotForBatter_ === 'function' ? mlbLineupSlotForBatter_(gamePk, batterId) : null;
      if (slot == null) { tally.scratched++; return; }
      if (slot > 5) { tally.slot6plus++; return; }
      lineupNote = 'slot ' + slot;
    } else {
      lineupNote = 'lineup_unconfirmed';
    }
    // Odds attach when present (line 0.5 only) — absence just means the leg
    // can't be priced into the parlay, not exclusion from the list.
    const line = parseFloat(String(r[3]));
    let odds = parseFloat(String(r[4]));
    if (isNaN(line) || Math.abs(line - 0.5) > 1e-9 || isNaN(odds) || odds < oddsFloor) {
      odds = NaN;
      tally.noOdds++;
    }
    pool.push({
      batter: batter, batterId: batterId, gamePk: gamePk,
      matchup: String(r[1] || ''), odds: isNaN(odds) ? '' : odds, p: Math.round(p * 1000) / 1000,
      lam: Math.round(lamModel * 100) / 100, estPa: estPa,
      oppSpName: String(r[27] || ''), lineupNote: lineupNote, flags: isNaN(odds) ? 'no_price' : '',
    });
  });
  pool.sort(function (a, b) { return b.p - a.p; });
  const cands = pool.slice(0, listN);

  // Pass 2 — expensive context for the short list only: SP id, arsenal, BvP.
  cands.forEach(function (c) {
    const spId = mlbHmSpIdForRow_(ss, c.gamePk, c.oppSpName);
    c.spId = spId;
    const ars = spId && typeof mlbArsenalMatchupScore_ === 'function'
      ? mlbArsenalMatchupScore_(spId, c.batterId)
      : { rv: null, whiff: null, cover: null };
    c.arsRv = ars.rv;
    c.arsCover = ars.cover;
    const bvp = spId ? mlbHmBvpCareer_(c.batterId, spId) : null;
    c.bvp = bvp ? bvp.h + '-' + bvp.pa : '';
    // One-way stay-away veto: enough career PA and basically hitless.
    c.bvpCold = !!(bvp && bvp.pa >= bvpMinPa && (bvp.h === 0 || (isFinite(bvp.avg) && bvp.avg < bvpMaxAvg)));
    if (c.bvpCold) c.flags = 'bvp_cold';
  });

  // Rank: p desc, arsenal rv as tiebreak (only a NUDGE — never promotes a
  // lower-p batter past a clearly higher one).
  cands.sort(function (a, b) {
    if (Math.abs(b.p - a.p) > 0.015) return b.p - a.p;
    return (b.arsRv != null ? b.arsRv : -99) - (a.arsRv != null ? a.arsRv : -99);
  });

  // Top 2 eligible = the parlay. Cross-game pairs are preferred (honest
  // multiplication); same-game pairs (SGP) are allowed when HM_ALLOW_SGP=Y —
  // e.g. only one game left on the slate. SGP legs are positively
  // correlated (same lineup turnover, same opposing pitcher), so:
  //   P(both) = p1·p2 + ρ·σ1·σ2  (correlation bump, HM_SGP_RHO)
  //   payout  = multiplied price × (1 − HM_SGP_HAIRCUT) — FD's SGP engine
  //   quotes LESS than straight multiplication for correlated legs; we log
  //   the haircut price so shadow P/L can't flatter itself.
  const allowSgp = String(cfg['HM_ALLOW_SGP'] != null ? cfg['HM_ALLOW_SGP'] : 'Y').toUpperCase() === 'Y';
  const sgpRho = parseFloat(String(cfg['HM_SGP_RHO'] != null ? cfg['HM_SGP_RHO'] : '0.08')) || 0.08;
  const sgpHaircut = parseFloat(String(cfg['HM_SGP_HAIRCUT'] != null ? cfg['HM_SGP_HAIRCUT'] : '0.10')) || 0.10;

  // Parlay legs need everything the list doesn't: a live 0.5-line price,
  // the p floor, and no BvP veto.
  const eligible = cands.filter(function (c) {
    return !c.bvpCold && c.odds !== '' && c.p >= minP;
  });
  let legs = [];
  // Pass A: best cross-game pair (anchored on the top candidate).
  for (let i = 0; i < eligible.length && legs.length < 2; i++) {
    if (legs.length === 1 && legs[0].gamePk === eligible[i].gamePk) continue;
    legs.push(eligible[i]);
  }
  // Pass B: no cross-game pair possible → best same-game pair (SGP).
  if (legs.length < 2 && allowSgp && eligible.length >= 2) {
    legs = [eligible[0], eligible[1]];
  }

  let parlay = null;
  if (legs.length === 2) {
    const d1 = mlbHmDecimalFromAmerican_(legs[0].odds);
    const d2 = mlbHmDecimalFromAmerican_(legs[1].odds);
    if (isFinite(d1) && isFinite(d2)) {
      const sgp = legs[0].gamePk === legs[1].gamePk;
      const p1 = legs[0].p;
      const p2 = legs[1].p;
      let dec = d1 * d2;
      let pBoth = p1 * p2;
      if (sgp) {
        pBoth = Math.min(0.999, p1 * p2 + sgpRho * Math.sqrt(p1 * (1 - p1) * p2 * (1 - p2)));
        dec = 1 + (dec - 1) * (1 - sgpHaircut);
      }
      parlay = {
        legs: legs,
        sgp: sgp,
        decimal: Math.round(dec * 1000) / 1000,
        american: mlbHmAmericanFromDecimal_(dec),
        p: Math.round(pBoth * 1000) / 1000,
        ev: Math.round((pBoth * (dec - 1) - (1 - pBoth)) * 1000) / 1000,
        stake: paperStake,
      };
    }
  }

  // Staleness check: the board is only as fresh as the last pipeline window.
  // A 7 AM manual refresh reads YESTERDAY's sim rows (odds pulled at first
  // pitch) and correctly finds nothing — say so instead of looking broken.
  let staleNote = '';
  try {
    const todaySlate = getSlateDateString_(cfg);
    if (typeof mlbOddsTabIsForSlate_ === 'function' && !mlbOddsTabIsForSlate_(ss, todaySlate)) {
      staleNote = '⚠️ STALE DATA: the ✅ odds tab is not for ' + todaySlate +
        ' — this board was built from old sim rows. Run a pipeline window (Morning/Midday/Final) first.  ·  ';
    }
  } catch (e) {}

  const diag = staleNote +
    'Tally: scanned ' + tally.scanned +
    ' · no model ' + tally.noModel + (isFinite(bestP) ? ' (best model p ' + Math.round(bestP * 1000) / 10 + '%)' : '') +
    ' · injury ' + tally.injury +
    ' · scratched ' + tally.scratched +
    ' · slot 6+ ' + tally.slot6plus +
    ' · no ids ' + tally.noIds +
    ' · unpriced ' + tally.noOdds + ' (still listed — just not parlay-eligible)' +
    '  →  list ' + cands.length + ' of pool ' + pool.length +
    '  ·  parlay legs need p≥' + minP + ' + a live 0.5-line price';
  // The tally goes EVERYWHERE — sheet, execution log, toast — so a thin
  // board can never again fail to explain itself ("No logs available").
  Logger.log('Hit Machine: ' + diag);
  mlbHmWriteBoard_(ss, cands, parlay, null, diag);
  mlbHmMarkSourceTabs_(ss, cands, parlay);
  if (parlay) mlbHmUpsertLog_(ss, parlay);
  try {
    ss.toast(
      (parlay ? '🎟️ parlay set · ' : 'no parlay · ') + cands.length + ' candidate(s) · ' +
      (staleNote ? 'STALE DATA — run a window first' : 'pool ' + pool.length + ' of ' + tally.scanned + ' scanned'),
      '🎯 Hit Machine',
      10
    );
  } catch (e) {}
}

/**
 * Plain-English rationale per candidate — what the math is signaling, for
 * the operator's manual process check. Computed strictly from the fields
 * the gates/ranking actually used.
 */
function mlbHmWhyForCandidate_(c) {
  const lines = [];
  if (isFinite(c.lam) && isFinite(c.estPa)) {
    lines.push('model λ ' + c.lam + ' expected hits over ~' + c.estPa + ' PA (' + c.lineupNote + ') — unanchored model, one-sided shrink');
  }
  const imp = mlbAmericanImplied_(c.odds);
  const impN = parseFloat(String(imp));
  if (isFinite(impN) && isFinite(c.p)) {
    const gap = Math.round((c.p - impN) * 1000) / 10;
    lines.push(
      'P(1+H) ' + Math.round(c.p * 1000) / 10 + '% vs ' + Math.round(impN * 1000) / 10 +
      '% implied at ' + c.odds + ' → ' + (gap >= 0 ? '+' : '') + gap + 'pp'
    );
  } else if (isFinite(c.p)) {
    lines.push('P(1+H) ' + Math.round(c.p * 1000) / 10 + '% — no live 0.5-line price (list-only, not parlay-eligible)');
  }
  if (c.arsRv != null) {
    lines.push(
      'arsenal ' + (c.arsRv >= 0 ? '+' : '') + c.arsRv + ' RV/100 vs ' + (c.oppSpName || 'SP') + '’s mix' +
      (c.arsCover != null
        ? ' (cover ' + Math.round(c.arsCover * 100) + '%' + (c.arsCover < 0.4 ? ' — mostly prior, weak signal' : '') + ')'
        : '')
    );
  } else {
    lines.push('arsenal: no data — ranked on P alone');
  }
  if (c.bvp) {
    lines.push('BvP ' + c.bvp + (c.bvpCold ? ' → STAY-AWAY (cold at sample, one-way veto)' : ' career vs this SP'));
  }
  return lines.join('  ·  ');
}

/** Render the 🎯 board. */
function mlbHmWriteBoard_(ss, cands, parlay, hint, diag) {
  let sh = ss.getSheetByName(MLB_HIT_MACHINE_TAB);
  if (sh) {
    sh.clearContents();
    sh.clearFormats();
    sh.clearNotes();
  } else {
    sh = ss.insertSheet(MLB_HIT_MACHINE_TAB);
  }
  sh.setTabColor('#f9a825');
  const builtAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'EEE M/d h:mm a');
  sh.getRange(1, 1, 1, 12)
    .merge()
    .setValue(
      '🎯 Hit Machine — 2-leg 1+H parlay · SHADOW (paper $) · legs = top-2 by P(1+H) (cross-game preferred, SGP fallback), arsenal rv tiebreak, BvP-cold vetoed · built ' + builtAt
    )
    .setFontWeight('bold')
    .setBackground('#f57f17')
    .setFontColor('#ffffff')
    .setWrap(true);
  sh.setRowHeight(1, 34);

  if (hint) {
    sh.getRange(2, 1).setValue(hint);
    return;
  }
  const parlayLine = parlay
    ? '🎟️ ' + parlay.legs[0].batter + ' + ' + parlay.legs[1].batter +
      (parlay.sgp ? '  ·  SGP (same game — verify FD quote)' : '') + '  ·  ' +
      (parlay.american > 0 ? '+' : '') + parlay.american + '  ·  P(both) ' +
      Math.round(parlay.p * 1000) / 10 + '%  ·  EV $' + parlay.ev + '/$1  ·  paper stake $' + parlay.stake +
      '  ·  hover for why'
    : '🎟️ No qualifying parlay (need 2 eligible legs past the gates)';
  const banner = sh.getRange(2, 1, 1, 12).merge().setValue(parlayLine).setFontWeight('bold')
    .setBackground(parlay ? '#fff8e1' : '#fbe9e7');
  if (parlay) {
    banner.setNote(
      'WHY THIS PARLAY\n' +
      'Two juiced singles multiply into a near-even price; the edge (if real) compounds, and so does the variance. ' +
      (parlay.sgp
        ? 'SAME-GAME pair: the legs are positively correlated (shared lineup turnover / opposing pitcher), so P(both) ' +
          'includes a correlation bump, and the logged price takes a haircut because FD\'s SGP engine quotes less than ' +
          'straight multiplication — CHECK THE ACTUAL FD SGP QUOTE before any real bet.'
        : 'Cross-game legs, so the multiplication is honest (no same-game correlation the book reprices).') + '\n\n' +
      'LEG 1 — ' + parlay.legs[0].batter + ':\n' + mlbHmWhyForCandidate_(parlay.legs[0]) + '\n\n' +
      'LEG 2 — ' + parlay.legs[1].batter + ':\n' + mlbHmWhyForCandidate_(parlay.legs[1]) + '\n\n' +
      'P(both) = p1 × p2 = ' + Math.round(parlay.p * 1000) / 10 + '% vs ' +
      Math.round((1 / parlay.decimal) * 1000) / 10 + '% break-even at the multiplied price → EV $' + parlay.ev + '/$1. ' +
      'SHADOW: paper $' + parlay.stake + ' until graded ROI earns promotion.'
    );
  }

  // Diag row: the board can never be silently blank — the gate tally always
  // says what was scanned and where every row fell out.
  sh.getRange(3, 1, 1, 12).merge()
    .setValue(diag || '')
    .setFontSize(9)
    .setFontColor('#616161');

  sh.getRange(4, 1, 1, 12)
    .setValues([['rank', 'batter', 'matchup', 'opp SP', 'odds', 'p_1H', 'arsenal_rv', 'arsenal_cover', 'bvp (H-PA)', 'lineup', 'flags', 'why (what the math is signaling)']])
    .setFontWeight('bold')
    .setBackground('#f9a825')
    .setFontColor('#000000');
  const out = cands.map(function (c, i) {
    return [
      i + 1, c.batter, c.matchup, c.oppSpName, c.odds, c.p,
      c.arsRv != null ? c.arsRv : '', c.arsCover != null ? c.arsCover : '',
      c.bvp, c.lineupNote, c.flags, mlbHmWhyForCandidate_(c),
    ];
  });
  if (out.length) {
    sh.getRange(5, 1, out.length, 12).setValues(out);
    sh.getRange(5, 12, out.length, 1).setWrap(true).setFontSize(9);
    for (let i = 0; i < out.length; i++) {
      if (String(out[i][10]).indexOf('bvp_cold') !== -1) {
        sh.getRange(5 + i, 1, 1, 12).setBackground('#eceff1').setFontColor('#90a4ae');
      }
    }
  }
  sh.setColumnWidth(12, 460);
  sh.setFrozenRows(4);
}

/**
 * 🎯 cross-reference on the hits tabs: amber border + tint on the batter
 * cell for every Hit Machine candidate (thick border = actual parlay leg).
 * FORMATS ONLY — each tab rebuild clears formats, so this can never go
 * stale on shifted rows (the trap notes fell into in v0.6.0).
 */
function mlbHmMarkSourceTabs_(ss, cands, parlay) {
  if (!cands || !cands.length) return;
  const rankById = {};
  cands.forEach(function (c, i) { rankById[String(c.batterId)] = i + 1; });
  const legIds = {};
  if (parlay) {
    legIds[String(parlay.legs[0].batterId)] = true;
    legIds[String(parlay.legs[1].batterId)] = true;
  }
  const tabs = [
    MLB_BATTER_HITS_SIM_TAB,
    typeof MLB_BATTER_HITS_V2_CARD_TAB !== 'undefined' ? MLB_BATTER_HITS_V2_CARD_TAB : '🧪 Batter_Hits_Card_v2-full',
  ];
  tabs.forEach(function (tabName) {
    try {
      const sh = ss.getSheetByName(tabName);
      if (!sh || sh.getLastRow() < 4) return;
      const ids = sh.getRange(4, 18, sh.getLastRow() - 3, 1).getValues(); // batter_id col 18
      for (let i = 0; i < ids.length; i++) {
        const key = String(parseInt(ids[i][0], 10) || 0);
        if (!rankById[key]) continue;
        const cell = sh.getRange(4 + i, 3); // batter name col 3
        cell.setBackground('#fff3cd');
        cell.setBorder(
          true, true, true, true, false, false,
          '#f9a825',
          legIds[key] ? SpreadsheetApp.BorderStyle.SOLID_THICK : SpreadsheetApp.BorderStyle.SOLID_MEDIUM
        );
      }
    } catch (e) {
      Logger.log('mlbHmMarkSourceTabs_(' + tabName + '): ' + (e.message || e));
    }
  });
}

/** One parlay row per slate, upserted until graded. */
function mlbHmUpsertLog_(ss, parlay) {
  const cfg = getConfig();
  const slate = getSlateDateString_(cfg);
  const tz = Session.getScriptTimeZone();
  const loggedAt = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm');
  let logSh = ss.getSheetByName(MLB_HIT_MACHINE_LOG_TAB);
  if (!logSh) {
    logSh = ss.insertSheet(MLB_HIT_MACHINE_LOG_TAB);
    logSh.setTabColor('#f9a825');
  }
  if (String(logSh.getRange(3, 1).getValue() || '').trim() !== 'Logged At') {
    logSh.getRange(1, 1, 1, MLB_HIT_MACHINE_LOG_NCOL).merge()
      .setValue('📋 Hit Machine log — one shadow parlay per slate · graded on 1+ hit per leg · VOID leg reduces to single')
      .setFontWeight('bold').setBackground('#f57f17').setFontColor('#ffffff');
    logSh.getRange(3, 1, 1, MLB_HIT_MACHINE_LOG_NCOL)
      .setValues([MLB_HIT_MACHINE_LOG_HEADERS])
      .setFontWeight('bold').setBackground('#f9a825');
    logSh.setFrozenRows(3);
  }

  const l1 = parlay.legs[0];
  const l2 = parlay.legs[1];
  const betKey = mlbHmResultKey_(slate, l1.batterId, l2.batterId);
  const rowVals = [
    loggedAt, slate,
    l1.batter, l1.batterId, l1.gamePk, l1.odds, l1.p, l1.arsRv != null ? l1.arsRv : '', l1.bvp,
    l2.batter, l2.batterId, l2.gamePk, l2.odds, l2.p, l2.arsRv != null ? l2.arsRv : '', l2.bvp,
    parlay.american, parlay.p, parlay.ev, parlay.stake,
    '', 'PENDING', '', '', betKey, '', 'SHADOW(paper)' + (parlay.sgp ? '·SGP' : ''),
  ];

  // Find today's row (PENDING only — never disturb a graded parlay).
  const last = logSh.getLastRow();
  if (last >= 4) {
    const data = logSh.getRange(4, 1, last - 3, MLB_HIT_MACHINE_LOG_NCOL).getValues();
    for (let i = data.length - 1; i >= 0; i--) {
      const rowSlate = typeof mlbDateCellToYmd_ === 'function' ? mlbDateCellToYmd_(data[i][1]) : String(data[i][1] || '');
      if (rowSlate !== slate) continue;
      if (String(data[i][21] || '').trim().toUpperCase() !== 'PENDING') return;
      logSh.getRange(4 + i, 1, 1, MLB_HIT_MACHINE_LOG_NCOL).setValues([rowVals]);
      return;
    }
  }
  logSh.getRange(Math.max(logSh.getLastRow(), 3) + 1, 1, 1, MLB_HIT_MACHINE_LOG_NCOL).setValues([rowVals]);
}

/** Grade pending parlays: 1+ hit per leg; VOID leg reduces to single. */
function gradeHitMachinePendingResults_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logSh = ss.getSheetByName(MLB_HIT_MACHINE_LOG_TAB);
  if (!logSh || logSh.getLastRow() < 4) return;
  const today = mlbTodayYmdNY_();
  const data = logSh.getRange(4, 1, logSh.getLastRow() - 3, MLB_HIT_MACHINE_LOG_NCOL).getValues();
  let graded = 0;

  for (let i = 0; i < data.length; i++) {
    if (typeof mlbGraderBandExpired_ === 'function' && mlbGraderBandExpired_()) {
      Logger.log('gradeHitMachinePendingResults_: grader band budget hit — resuming next window');
      break;
    }
    const row = data[i];
    const slate = typeof mlbDateCellToYmd_ === 'function' ? mlbDateCellToYmd_(row[1]) : String(row[1] || '');
    if (!slate || slate >= today) continue;
    if (String(row[21] || '').trim().toUpperCase() !== 'PENDING') continue;

    function gradeLeg(gamePk, pid) {
      const box = mlbFetchBoxscoreJson_(parseInt(gamePk, 10));
      if (!box) return { r: 'PENDING', note: 'fetch failed' };
      if (!mlbBoxscoreIsFinal_(box)) {
        const ageDays = Math.floor((new Date(today + 'T00:00:00') - new Date(slate + 'T00:00:00')) / 86400000);
        return ageDays >= 2 ? { r: 'VOID', note: 'postponed' } : { r: 'PENDING', note: 'not final' };
      }
      const hits = mlbBatterHitsFromBoxscore_(box, parseInt(pid, 10));
      if (hits === null) return { r: 'VOID', note: 'DNP' };
      return hits >= 1 ? { r: 'WIN', note: 'H=' + hits } : { r: 'LOSS', note: 'H=0' };
    }

    const g1 = gradeLeg(row[4], row[3]);
    const g2 = gradeLeg(row[11], row[10]);
    if (g1.r === 'PENDING' || g2.r === 'PENDING') {
      logSh.getRange(4 + i, 24).setValue('waiting: ' + g1.note + ' / ' + g2.note);
      continue;
    }

    let result;
    let pnl = 0;
    const stake = parseFloat(String(row[19])) || 0;
    if (g1.r === 'LOSS' || g2.r === 'LOSS') {
      result = 'LOSS';
      pnl = -stake;
    } else if (g1.r === 'VOID' && g2.r === 'VOID') {
      result = 'VOID';
    } else if (g1.r === 'VOID' || g2.r === 'VOID') {
      // Book behavior: void leg drops, parlay reduces to a single.
      const liveOdds = g1.r === 'VOID' ? row[12] : row[5];
      result = 'WIN';
      pnl = Math.round(stake * mlbAmericanToB_(liveOdds) * 100) / 100;
    } else {
      result = 'WIN';
      // Settle at the LOGGED parlay price (col 17) — for SGP rows that price
      // already carries the repricing haircut; recomputing from leg odds
      // would overpay the shadow book. Leg-product fallback for legacy rows.
      const decLogged = mlbHmDecimalFromAmerican_(row[16]);
      const dec = isFinite(decLogged) && decLogged > 1
        ? decLogged
        : mlbHmDecimalFromAmerican_(row[5]) * mlbHmDecimalFromAmerican_(row[12]);
      pnl = Math.round(stake * (dec - 1) * 100) / 100;
    }
    logSh.getRange(4 + i, 21).setValue(g1.r + '/' + g2.r);
    logSh.getRange(4 + i, 22).setValue(result);
    logSh.getRange(4 + i, 23).setValue(result === 'VOID' ? 0 : pnl);
    logSh.getRange(4 + i, 24).setValue(g1.note + ' / ' + g2.note + ' · paper');
    graded++;
  }
  if (graded > 0) {
    try { ss.toast('Graded ' + graded + ' Hit Machine parlay(s)', 'MLB-BOIZ', 6); } catch (e) {}
  }
}
