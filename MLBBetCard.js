// ============================================================
// 🃏 MLB Bet Card — pitcher K + batter hits (ranked by EV)
// ============================================================
// Pulls ⚡ Sim_Pitcher_K + ⚡ Sim_Batter_Hits (authoritative P/EV);
// stat cards (🎰 / 🧪 v2-full) are upstream audit only. Refreshes sim
// before merge so menu "Bet Card only" stays coherent.
// TB retired 2026-05-21 — removed from pipeline, odds fetch, and bet card panels.
// VISUAL FORMATTING is in MLBBetCardFormatting.js — DO NOT mix
// rendering code into this file or it will get rolled back with model
// changes (see v0.1.1 commit notes).
// ============================================================

const MLB_BET_CARD_TAB = '🃏 MLB_Bet_Card';
const MLB_BET_CARD_NCOL = 19;
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
 *   2. |projection − line| ≥ per-market edge floor (Config: MIN_EDGE_<K|TB|H>; 0 = off)
 *   3. EV per $1 > 0
 *   4. EV per $1 ≥ MIN_EV_BET_CARD (K + H; 0 or blank = off)
 *   5. American odds ≤ MAX_ODDS_H (H plays only; 0 or blank = off)
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

  const minP = (!isNaN(sideNum) && sideNum > 0) ? sideNum : marketP;

  const eRaw = String(cfg['MIN_EDGE_' + marketKey] != null ? cfg['MIN_EDGE_' + marketKey] : '0').trim();
  const eNum = parseFloat(eRaw, 10);
  const minEdge = !isNaN(eNum) && eNum > 0 ? eNum : 0;
  return { minP: minP, minEdge: minEdge };
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

  const plays = [];

  if (srcK && srcK.getLastRow() >= 4) {
    const lastK = srcK.getLastRow();
    const vals = srcK.getRange(4, 1, lastK, 26).getValues();
    vals.forEach(function (r) {
      const flags = String(r[18] || '');
      const pitcherId = r[19];
      const hpUmp = String(r[20] || '').trim();
      const throws = String(r[21] || '').trim();
      const hotCold = String(r[25] || '').toUpperCase();
      if (flags.indexOf('injury') !== -1) return;

      const bestSide = String(r[16] || '').trim();
      if (bestSide !== 'Over' && bestSide !== 'Under') return;

      const line = r[4];
      if (line === '' || line == null) return;

      const fdOver = r[5];
      const fdUnder = r[6];
      const american = bestSide === 'Over' ? fdOver : fdUnder;
      if (american === '' || american == null || isNaN(parseFloat(String(american)))) return;

      const pitcher = String(r[3] || '').trim();
      if (!pitcher) return;

      const pWin = bestSide === 'Over' ? r[10] : r[11];
      const pwNum = parseFloat(String(pWin));
      const kThr = mlbBetCardThresholds_(cfg, 'K', bestSide);
      if (isNaN(pwNum) || pwNum < kThr.minP) return;
      const kEdge = parseFloat(String(r[9]));
      if (kThr.minEdge > 0 && (isNaN(kEdge) || Math.abs(kEdge) < kThr.minEdge)) return;

      const evRaw = r[17];
      const ev = parseFloat(String(evRaw));
      if (isNaN(ev) || ev <= 0) return;
      const minEvK = parseFloat(String(cfg['MIN_EV_BET_CARD'] != null ? cfg['MIN_EV_BET_CARD'] : '0')) || 0;
      if (minEvK > 0 && ev < minEvK) return;
      const implied = bestSide === 'Over' ? r[12] : r[13];
      const matchup = r[1];
      const gamePk = r[0];
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

      plays.push({
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
        ev: isNaN(ev) ? '' : ev,
        lambda: r[8],
        edge: r[9],
        flags: flags,
        market: 'Pitcher strikeouts',
        gameTimeIso: gt.iso || '',
        gameTimeHHmm: gt.hhmm || '',
        hotCold: hotCold,
      });
    });
  }

  if (srcHits && srcHits.getLastRow() >= 4) {
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
      const maxOddsH = parseFloat(String(cfg['MAX_ODDS_H'] != null ? cfg['MAX_ODDS_H'] : '0')) || 0;
      if (maxOddsH < 0 && parseFloat(String(american)) < maxOddsH) return;

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
      const implied = bestSide === 'Over' ? r[10] : r[11];
      const matchup = r[1];
      const gamePk = r[0];
      const pickLabel =
        batter + ' — H ' + bestSide + ' ' + String(line) + (hpUmp ? ' · HP ' + hpUmp : '');
      const gt = gameTimeIdx[parseInt(gamePk, 10)] || {};

      plays.push({
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

  // EV desc — used for ordering before cap selection.
  plays.sort(function (a, b) {
    const be = parseFloat(String(b.ev));
    const ae = parseFloat(String(a.ev));
    if (isNaN(be) && isNaN(ae)) return 0;
    if (isNaN(be)) return 1;
    if (isNaN(ae)) return -1;
    return be - ae;
  });

  // Filters applied above per market: pWin ≥ per-market floor, optional |edge| ≥ MIN_EDGE_*,
  // EV > 0, MIN_EV_BET_CARD, MAX_ODDS_H (H). See mlbBetCardThresholds_().
  const selected = plays;

  // Display order: game start time asc, then by gamePk (keep same-time games
  // grouped), then EV desc within a game.
  selected.sort(function (a, b) {
    const ta = a.gameTimeIso || '';
    const tb = b.gameTimeIso || '';
    if (ta && tb && ta !== tb) return ta < tb ? -1 : 1;
    if (ta && !tb) return -1;
    if (!ta && tb) return 1;
    const ga = String(a.gamePk != null ? a.gamePk : '');
    const gb = String(b.gamePk != null ? b.gamePk : '');
    if (ga !== gb) return ga < gb ? -1 : 1;
    const be = parseFloat(String(b.ev));
    const ae = parseFloat(String(a.ev));
    if (isNaN(be) && isNaN(ae)) return 0;
    if (isNaN(be)) return 1;
    if (isNaN(ae)) return -1;
    return be - ae;
  });

  // Build rows; insert a blank spacer row between game groups for visual separation.
  const rows = [];
  const hotColdByRow = []; // parallel to rows, '' for spacers
  let lastGamePk = null;
  let visibleIdx = 0;
  selected.forEach(function (p) {
    const gKey = String(p.gamePk != null ? p.gamePk : '');
    if (lastGamePk !== null && gKey !== lastGamePk) {
      rows.push(new Array(MLB_BET_CARD_NCOL).fill(''));  // spacer row
      hotColdByRow.push('');
    }
    lastGamePk = gKey;
    visibleIdx++;
    const stake = mlbKellyStake_(p.pWin, p.american, bankroll, kellyFrac, cfg);
    rows.push([
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
      p.pWin,                                                     // 10 model %
      p.implied !== '' && p.implied != null ? p.implied : '',     // 11 book %
      p.ev,                                                       // 12 ev / $1
      stake,                                                      // 13 stake $
      p.lambda,                                                   // 14 proj
      p.edge,                                                     // 15 proj − line
      p.flags,                                                    // 16 flags
      p.playerId != null && p.playerId !== '' ? p.playerId : '',  // 17 player_id
      p.gameTimeHHmm || '',                                       // 18 time
    ]);
    hotColdByRow.push(p.hotCold || '');
  });

  if (rows.length === 0) {
    const blank = new Array(MLB_BET_CARD_NCOL).fill('');
    blank[0] = slateDate;
    blank[4] =
      'No qualifying plays — build ⚡ Sim_Pitcher_K / ⚡ Sim_Batter_Hits with ' +
      'Config gates (MIN_MODEL_PCT_*, MIN_EV_BET_CARD, MAX_ODDS_H), ev > 0, valid FD price, no injury flag.';
    rows.push(blank);
  }

  let sh = ss.getSheetByName(MLB_BET_CARD_TAB);
  if (sh) {
    const cr = Math.max(sh.getLastRow(), 3);
    const cc = Math.max(sh.getLastColumn(), MLB_BET_CARD_NCOL);
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
    'model %',
    'book %',
    'ev / $1',
    'stake $',
    'proj',
    'proj − line',
    'flags',
    'player_id',
    'time',
  ];

  sh.getRange(3, 1, 1, headers.length).setValues([headers]);
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
  ss.toast(
    selected.length + ' picks · ' + Object.keys(gameSet).filter(function (k) { return k !== ''; }).length +
      ' games · ' + slateDate,
    'MLB Bet Card',
    6
  );
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
  const srcTab =
    typeof MLB_BATTER_HITS_SIM_TAB !== 'undefined' ? MLB_BATTER_HITS_SIM_TAB : '⚡ Sim_Batter_Hits';
  const src = ss.getSheetByName(srcTab);
  const diagTab = '🔍 BetCard_Diag_Hits';
  const log = [];
  log.push('Source tab: ' + srcTab + ' (fallback: v2 stat card if sim empty on live merge)');
  log.push(
    'Gates (besides data prereqs): pWin ≥ ' + hThr.minP +
    (hThr.minEdge > 0 ? ' AND |edge| ≥ ' + hThr.minEdge : '') +
    ' AND ev > 0 AND ev ≥ MIN_EV_BET_CARD (Config)'
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
    blank_batter: 0,
    injury_flag: 0,
    bad_best_side: 0,
    blank_line: 0,
    blank_or_nan_price: 0,
    blank_or_nan_pwin: 0,
    pwin_below_floor: 0,
    ev_not_positive: 0,
    ev_below_min_ev: 0,
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
    const flags = String(r[16] || '');

    function rej(reason, detail) {
      tally[reason]++;
      if (rejectExamples.length < 40) {
        rejectExamples.push([rowNum, batter, matchup, reason, detail]);
      }
    }

    if (!batter) { rej('blank_batter', ''); return; }
    if (flags.indexOf('injury') !== -1) { rej('injury_flag', flags); return; }
    if (bestSide !== 'Over' && bestSide !== 'Under') {
      rej('bad_best_side', 'bestSide="' + bestSide + '"'); return;
    }
    if (line === '' || line == null) { rej('blank_line', ''); return; }

    const american = bestSide === 'Over' ? fdOver : fdUnder;
    if (american === '' || american == null || isNaN(parseFloat(String(american)))) {
      rej('blank_or_nan_price', 'side=' + bestSide + ' price="' + american + '"'); return;
    }

    const pWin = bestSide === 'Over' ? pOver : pUnder;
    const pwNum = parseFloat(String(pWin));
    if (isNaN(pwNum)) {
      rej('blank_or_nan_pwin', 'side=' + bestSide + ' pWin="' + pWin + '"'); return;
    }
    if (pwNum < hThr.minP) {
      rej('pwin_below_floor', 'side=' + bestSide + ' pWin=' + pwNum + ' floor=' + hThr.minP); return;
    }

    const evNum = parseFloat(String(r[15]));
    if (isNaN(evNum) || evNum <= 0) {
      rej('ev_not_positive', 'side=' + bestSide + ' ev=' + r[15]); return;
    }
    const minEv = parseFloat(String(cfg['MIN_EV_BET_CARD'] != null ? cfg['MIN_EV_BET_CARD'] : '0')) || 0;
    if (minEv > 0 && evNum < minEv) {
      rej('ev_below_min_ev', 'side=' + bestSide + ' ev=' + evNum + ' min=' + minEv); return;
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
    'Gates: pWin ≥ ' + hThr.minP +
    (hThr.minEdge > 0 ? ' AND |edge| ≥ ' + hThr.minEdge : '') +
    ' AND ev > 0 AND ev ≥ MIN_EV_BET_CARD. Plus data prereqs: non-blank batter, no injury flag, bestSide ∈ {Over,Under}, line set, valid FD price for that side, parseable pWin.'
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
  const kOverFloor = mlbBetCardThresholds_(cfg, 'K', 'Over').minP;
  const kUnderFloor = mlbBetCardThresholds_(cfg, 'K', 'Under').minP;
  const hFloor = mlbBetCardThresholds_(cfg, 'H').minP;

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
        if (rejects.length < 40) rejects.push([rowNum, res.label, res.matchup, res.reason, res.detail || '']);
      }
    });
    return { tally: tally, rejects: rejects, passes: passes, scanned: rows.length };
  }

  function checkK(r) {
    const flags = String(r[18] || '');
    const pitcher = String(r[3] || '').trim();
    const matchup = String(r[1] || '');
    const bestSide = String(r[16] || '').trim();
    const line = r[4];
    const fdOver = r[5];
    const fdUnder = r[6];
    const label = pitcher || '(blank)';
    if (flags.indexOf('injury') !== -1) return { ok: false, reason: 'injury_flag', label: label, matchup: matchup };
    if (bestSide !== 'Over' && bestSide !== 'Under') return { ok: false, reason: 'bad_best_side', label: label, matchup: matchup, detail: bestSide };
    if (line === '' || line == null) return { ok: false, reason: 'blank_line', label: label, matchup: matchup };
    const american = bestSide === 'Over' ? fdOver : fdUnder;
    if (american === '' || american == null || isNaN(parseFloat(String(american)))) {
      return { ok: false, reason: 'bad_price', label: label, matchup: matchup };
    }
    if (!pitcher) return { ok: false, reason: 'blank_pitcher', label: label, matchup: matchup };
    const pWin = bestSide === 'Over' ? r[10] : r[11];
    const pwNum = parseFloat(String(pWin));
    const kThr = mlbBetCardThresholds_(cfg, 'K', bestSide);
    if (isNaN(pwNum)) return { ok: false, reason: 'bad_pwin', label: label, matchup: matchup };
    if (pwNum < kThr.minP) {
      return { ok: false, reason: 'pwin_below_floor', label: label, matchup: matchup, detail: 'p=' + pwNum + ' floor=' + kThr.minP };
    }
    const kEdge = parseFloat(String(r[9]));
    if (kThr.minEdge > 0 && (isNaN(kEdge) || Math.abs(kEdge) < kThr.minEdge)) {
      return { ok: false, reason: 'edge_below_floor', label: label, matchup: matchup };
    }
    const ev = parseFloat(String(r[17]));
    if (isNaN(ev) || ev <= 0) return { ok: false, reason: 'ev_not_positive', label: label, matchup: matchup, detail: String(r[17]) };
    if (minEv > 0 && ev < minEv) return { ok: false, reason: 'ev_below_min_ev', label: label, matchup: matchup, detail: 'ev=' + ev + ' min=' + minEv };
    return {
      ok: true,
      passRow: [pitcher, matchup, bestSide, line, american, pwNum, ev],
    };
  }

  function checkH(r) {
    const flags = String(r[16] || '');
    const batter = String(r[2] || '').trim();
    const matchup = String(r[1] || '');
    const bestSide = String(r[14] || '').trim();
    const line = r[3];
    const fdOver = r[4];
    const fdUnder = r[5];
    const label = batter || '(blank)';
    if (flags.indexOf('injury') !== -1) return { ok: false, reason: 'injury_flag', label: label, matchup: matchup };
    if (bestSide !== 'Over' && bestSide !== 'Under') return { ok: false, reason: 'bad_best_side', label: label, matchup: matchup, detail: bestSide };
    if (line === '' || line == null) return { ok: false, reason: 'blank_line', label: label, matchup: matchup };
    const american = bestSide === 'Over' ? fdOver : fdUnder;
    if (american === '' || american == null || isNaN(parseFloat(String(american)))) {
      return { ok: false, reason: 'bad_price', label: label, matchup: matchup };
    }
    if (maxOddsH < 0 && parseFloat(String(american)) < maxOddsH) {
      return { ok: false, reason: 'h_odds_too_juiced', label: label, matchup: matchup, detail: String(american) };
    }
    if (!batter) return { ok: false, reason: 'blank_batter', label: label, matchup: matchup };
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
    return {
      ok: true,
      passRow: [batter, matchup, bestSide, line, american, pwNum, ev],
    };
  }

  const kRows = srcK && srcK.getLastRow() >= 4
    ? srcK.getRange(4, 1, srcK.getLastRow(), Math.min(26, srcK.getLastColumn())).getValues()
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
    ' · K Under pWin ≥ ' + kUnderFloor +
    ' · H pWin ≥ ' + hFloor +
    ' · MIN_EV_BET_CARD=' + minEv +
    (maxOddsH < 0 ? ' · MAX_ODDS_H=' + maxOddsH : '')
  );
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
