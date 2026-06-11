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
  // NOTE: HM_MIN_P is on the POST-SHRINK scale (sim p = raw × H_MODEL_P_SHRINK
  // 0.82). 0.65 here ≈ 0.79 raw. The original 0.75 default demanded a ~91%
  // raw hitter — mathematically empty board every slate.
  const minP = parseFloat(String(cfg['HM_MIN_P'] != null ? cfg['HM_MIN_P'] : '0.65')) || 0.65;
  const listN = parseInt(String(cfg['HM_LIST_N'] != null ? cfg['HM_LIST_N'] : '8'), 10) || 8;
  const oddsFloor = parseFloat(String(cfg['HM_LEG_ODDS_FLOOR'] != null ? cfg['HM_LEG_ODDS_FLOOR'] : '-350')) || -350;
  const bvpMinPa = parseInt(String(cfg['HM_BVP_MIN_PA'] != null ? cfg['HM_BVP_MIN_PA'] : '12'), 10) || 12;
  const bvpMaxAvg = parseFloat(String(cfg['HM_BVP_MAX_AVG'] != null ? cfg['HM_BVP_MAX_AVG'] : '0.10')) || 0.10;
  const paperStake = parseFloat(String(cfg['HM_PAPER_STAKE'] != null ? cfg['HM_PAPER_STAKE'] : '2.50')) || 2.5;

  const src = ss.getSheetByName(MLB_BATTER_HITS_SIM_TAB);
  if (!src || src.getLastRow() < 4) {
    mlbHmWriteBoard_(ss, [], null, 'Run the Hits sim first (Morning pipeline builds it).', '');
    return;
  }
  const rows = src.getRange(4, 1, src.getLastRow() - 3, 34).getValues();

  // Pass 1 — cheap gates, build candidate pool sorted by p. Every rejection
  // is TALLIED so an empty board can always explain itself on the tab.
  const tally = { scanned: 0, not05: 0, noP: 0, pBelow: 0, juiced: 0, injury: 0, noIds: 0, scratched: 0, slot6plus: 0 };
  let bestP = NaN;
  const pool = [];
  rows.forEach(function (r) {
    const batter = String(r[2] || '').trim();
    if (!batter) return;
    tally.scanned++;
    const line = parseFloat(String(r[3]));
    if (isNaN(line) || Math.abs(line - 0.5) > 1e-9) { tally.not05++; return; } // 1+ hit only
    const p = parseFloat(String(r[8]));
    if (isNaN(p)) { tally.noP++; return; }
    if (isNaN(bestP) || p > bestP) bestP = p;
    if (p < minP) { tally.pBelow++; return; }
    const odds = parseFloat(String(r[4]));
    if (isNaN(odds) || odds < oddsFloor) { tally.juiced++; return; }
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
    pool.push({
      batter: batter, batterId: batterId, gamePk: gamePk,
      matchup: String(r[1] || ''), odds: odds, p: p,
      lam: parseFloat(String(r[6])), estPa: parseFloat(String(r[25])),
      oppSpName: String(r[27] || ''), lineupNote: lineupNote, flags: '',
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

  // Top 2 eligible from different games = the parlay.
  const legs = [];
  for (let i = 0; i < cands.length && legs.length < 2; i++) {
    const c = cands[i];
    if (c.bvpCold) continue;
    if (legs.length === 1 && legs[0].gamePk === c.gamePk) continue; // cross-game only
    legs.push(c);
  }

  let parlay = null;
  if (legs.length === 2) {
    const d1 = mlbHmDecimalFromAmerican_(legs[0].odds);
    const d2 = mlbHmDecimalFromAmerican_(legs[1].odds);
    if (isFinite(d1) && isFinite(d2)) {
      const dec = d1 * d2;
      const pBoth = legs[0].p * legs[1].p;
      parlay = {
        legs: legs,
        decimal: Math.round(dec * 1000) / 1000,
        american: mlbHmAmericanFromDecimal_(dec),
        p: Math.round(pBoth * 1000) / 1000,
        ev: Math.round((pBoth * (dec - 1) - (1 - pBoth)) * 1000) / 1000,
        stake: paperStake,
      };
    }
  }

  const diag =
    'Gate tally: scanned ' + tally.scanned +
    ' · line≠0.5 ' + tally.not05 +
    ' · no model p ' + tally.noP +
    ' · p<' + minP + ' ' + tally.pBelow + (isFinite(bestP) ? ' (best p seen ' + Math.round(bestP * 1000) / 10 + '%)' : '') +
    ' · odds<' + oddsFloor + ' ' + tally.juiced +
    ' · injury ' + tally.injury +
    ' · scratched ' + tally.scratched +
    ' · slot 6+ ' + tally.slot6plus +
    ' · no ids ' + tally.noIds +
    '  →  pool ' + pool.length + ' / list ' + cands.length;
  mlbHmWriteBoard_(ss, cands, parlay, null, diag);
  if (parlay) mlbHmUpsertLog_(ss, parlay);
}

/**
 * Plain-English rationale per candidate — what the math is signaling, for
 * the operator's manual process check. Computed strictly from the fields
 * the gates/ranking actually used.
 */
function mlbHmWhyForCandidate_(c) {
  const lines = [];
  if (isFinite(c.lam) && isFinite(c.estPa)) {
    lines.push('λ ' + c.lam + ' expected hits over ~' + c.estPa + ' PA (' + c.lineupNote + ')');
  }
  const imp = mlbAmericanImplied_(c.odds);
  const impN = parseFloat(String(imp));
  if (isFinite(impN) && isFinite(c.p)) {
    const gap = Math.round((c.p - impN) * 1000) / 10;
    lines.push(
      'P(1+H) ' + Math.round(c.p * 1000) / 10 + '% vs ' + Math.round(impN * 1000) / 10 +
      '% implied at ' + c.odds + ' → ' + (gap >= 0 ? '+' : '') + gap + 'pp'
    );
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
  sh.getRange(1, 1, 1, 12)
    .merge()
    .setValue(
      '🎯 Hit Machine — 2-leg 1+H parlay · SHADOW (paper $) · legs = top-2 cross-game by P(1+H), arsenal rv tiebreak, BvP-cold vetoed · promote only after graded ROI > 0'
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
    ? '🎟️ ' + parlay.legs[0].batter + ' + ' + parlay.legs[1].batter + '  ·  ' +
      (parlay.american > 0 ? '+' : '') + parlay.american + '  ·  P(both) ' +
      Math.round(parlay.p * 1000) / 10 + '%  ·  EV $' + parlay.ev + '/$1  ·  paper stake $' + parlay.stake +
      '  ·  hover for why'
    : '🎟️ No qualifying parlay (need 2 cross-game legs past the gates)';
  const banner = sh.getRange(2, 1, 1, 12).merge().setValue(parlayLine).setFontWeight('bold')
    .setBackground(parlay ? '#fff8e1' : '#fbe9e7');
  if (parlay) {
    banner.setNote(
      'WHY THIS PARLAY\n' +
      'Two juiced singles multiply into a near-even price; the edge (if real) compounds, and so does the variance. ' +
      'Cross-game legs only, so the multiplication is honest (no same-game correlation the book reprices).\n\n' +
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
    '', 'PENDING', '', '', betKey, '', 'SHADOW(paper)',
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
      const dec = mlbHmDecimalFromAmerican_(row[5]) * mlbHmDecimalFromAmerican_(row[12]);
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
