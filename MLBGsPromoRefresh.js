// ============================================================
// 📣 Batter Grand Slam promo — same inputs as HR promo, scaled λ
// ============================================================
// Grand slams are extremely rare; this sheet is for promo scanning only.
// Model: start from HR promo λ_HR, then λ_GS = λ_HR × (GS/HR)_league × w_order.
// P(≥1 GS) ≈ 1 − exp(−λ_GS) (illustrative Poisson tail, not a calibrated prop).
// Reuses: mlbHrPromoRowForBatter_ + lineup/boxscore flow from MLBHrPromoRefresh.js
// ============================================================

var MLB_BATTER_GS_PROMO_TAB = '📣 Batter_GS_Promo';
var MLB_BATTER_GS_PROMO_NAMED_RANGE = 'MLB_BATTER_GS_PROMO';

/** @returns {number[]} length-9 weights for batting orders 1..9 */
function mlbGsPromoDefaultOrderWeights_() {
  return [1, 1, 1.06, 1.1, 1.1, 1.06, 1, 0.98, 0.98];
}

/**
 * @param {string} jsonRaw
 * @returns {number[]|null}
 */
function mlbGsPromoOrderWeightsFromConfigJson_(jsonRaw) {
  const s = String(jsonRaw || '').trim();
  if (!s) return null;
  try {
    const arr = JSON.parse(s);
    if (!arr || arr.length !== 9) return null;
    const out = [];
    for (let i = 0; i < 9; i++) {
      const x = parseFloat(arr[i], 10);
      if (isNaN(x) || x <= 0) return null;
      out.push(x);
    }
    return out;
  } catch (e) {
    return null;
  }
}

/**
 * @param {number} slot1Based 0 = unknown / roster fallback → neutral 1
 * @param {number[]|null} weights
 */
function mlbGsPromoOrderWeightForSlot_(slot1Based, weights) {
  const w = weights && weights.length === 9 ? weights : mlbGsPromoDefaultOrderWeights_();
  const slot = parseInt(slot1Based, 10);
  if (isNaN(slot) || slot < 1 || slot > 9) return 1;
  return w[slot - 1];
}

/**
 * @param {Object} hrRow from mlbHrPromoRowForBatter_
 * @param {Object} cfg
 * @returns {Object} row for GS sheet
 */
function mlbGsPromoRowFromHrRow_(hrRow, cfg) {
  const k = mlbHrPromoParseConfigNum_(cfg, 'GS_PROMO_LEAGUE_GS_PER_HR', 0.027);
  const orderW = mlbGsPromoOrderWeightForSlot_(
    hrRow.lineupSlot,
    mlbGsPromoOrderWeightsFromConfigJson_(cfg['GS_PROMO_ORDER_WEIGHT_JSON'])
  );
  const mult = Math.max(0, k) * orderW;
  const lambdaHr = Math.max(0, Number(hrRow.lambdaRaw) || 0);
  const lambdaGs = lambdaHr * mult;
  const pPoisson = mlbHrPromoPoissonPHrGe1_(lambdaGs);
  return {
    gamePk: hrRow.gamePk,
    matchup: hrRow.matchup,
    batter: hrRow.batter,
    batterId: hrRow.batterId,
    team: hrRow.team,
    lambdaGs: lambdaGs,
    lambdaHrRef: lambdaHr,
    pPoisson: pPoisson,
    pCalibrated: pPoisson,
    calibrationStatus: 'none',
    confidence: hrRow.confidence,
    reason: hrRow.reason,
    lineupSlot: hrRow.lineupSlot,
    opponentSpId: hrRow.opponentSpId,
    parkMult: hrRow.parkMult,
    pitcherMult: hrRow.pitcherMult,
    weatherMult: hrRow.weatherMult,
    sznHr: hrRow.sznHr,
    sznPa: hrRow.sznPa,
    l14Hr: hrRow.l14Hr,
    gsMult: mult,
  };
}

function refreshBatterGsPromoSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig();
  const season = mlbSlateSeasonYear_(cfg);
  const fb = String(cfg['HR_PROMO_LINEUP_FALLBACK'] || 'roster')
    .trim()
    .toLowerCase();
  const abbrToId = mlbAbbrToTeamId_();

  const sch = ss.getSheetByName(MLB_SCHEDULE_TAB);
  if (!sch || sch.getLastRow() < 4) {
    safeAlert_('Batter GS promo', 'Run 📅 MLB schedule first.');
    return;
  }
  const lastS = sch.getLastRow();
  const schedRows = sch.getRange(4, 1, lastS, 14).getValues();

  const teamCaches = {};
  function cacheFor(abbr) {
    const a = String(abbr || '').trim().toUpperCase();
    if (!a) return {};
    if (!teamCaches[a]) teamCaches[a] = mlbHrPromoBuildTeamHittingMap_(a, season, abbrToId);
    return teamCaches[a];
  }

  const rowsOut = [];

  function processTeam(ctx2, teamAbbr, isHome, opponentSpCell) {
    const sideKey = isHome ? 'home' : 'away';
    const t = ctx2.teams && ctx2.teams[sideKey] ? ctx2.teams[sideKey] : null;
    const players = t && t.players ? t.players : null;
    const order = mlbHrPromoBattingOrderFromPlayers_(players);
    const hitMap = cacheFor(teamAbbr);

    if (order.length >= 9) {
      for (let i = 0; i < order.length; i++) {
        const o = order[i];
        const hrRow = mlbHrPromoRowForBatter_({
          cfg: ctx2.cfg,
          season: ctx2.season,
          gamePk: ctx2.gamePk,
          matchup: ctx2.matchup,
          teamAbbr: teamAbbr,
          homeAbbr: ctx2.home,
          batterId: o.batterId,
          nameFallback: o.name,
          lineupSlot: o.order,
          opponentSpId: opponentSpCell,
          baseConfidence: 'high',
          baseReason: '',
          teamHitMap: hitMap,
        });
        rowsOut.push(mlbGsPromoRowFromHrRow_(hrRow, ctx2.cfg));
      }
      return;
    }
    if (fb === 'skip') {
      addPipelineWarning_('GS promo: lineup_missing skip · ' + ctx2.matchup + ' · ' + teamAbbr);
      return;
    }
    const ids = Object.keys(hitMap);
    for (let j = 0; j < ids.length; j++) {
      const bid = parseInt(ids[j], 10);
      const h0 = hitMap[ids[j]];
      if (!bid || !h0 || (parseInt(h0.pa, 10) || 0) < 30) continue;
      if ((parseInt(h0.hr, 10) || 0) === 0) continue;
      const hrRow = mlbHrPromoRowForBatter_({
        cfg: ctx2.cfg,
        season: ctx2.season,
        gamePk: ctx2.gamePk,
        matchup: ctx2.matchup,
        teamAbbr: teamAbbr,
        homeAbbr: ctx2.home,
        batterId: bid,
        nameFallback: h0.name,
        lineupSlot: 0,
        expectedPaOverride: 4,
        opponentSpId: opponentSpCell,
        baseConfidence: 'low',
        baseReason: 'lineup_missing',
        teamHitMap: hitMap,
      });
      rowsOut.push(mlbGsPromoRowFromHrRow_(hrRow, ctx2.cfg));
    }
  }

  for (let r = 0; r < schedRows.length; r++) {
    const gamePk = parseInt(schedRows[r][0], 10);
    if (!gamePk) continue;
    const away = String(schedRows[r][3] || '').trim().toUpperCase();
    const home = String(schedRows[r][4] || '').trim().toUpperCase();
    const matchup = String(schedRows[r][5] || '').trim();
    const awaySp = schedRows[r][11];
    const homeSp = schedRows[r][12];

    cacheFor(away);
    cacheFor(home);

    if (r > 0) Utilities.sleep(120);
    const box = mlbFetchBoxscoreJson_(gamePk);
    const teams = mlbBoxscoreTeams_(box);
    const ctxLoop = {
      cfg: cfg,
      season: season,
      gamePk: gamePk,
      matchup: matchup,
      home: home,
      teams: teams,
    };

    processTeam(ctxLoop, away, false, homeSp);
    if (schedRows.length > 1) Utilities.sleep(60);
    processTeam(ctxLoop, home, true, awaySp);
  }

  rowsOut.sort(function (a, b) {
    if (b.pPoisson !== a.pPoisson) return b.pPoisson - a.pPoisson;
    if (b.lambdaGs !== a.lambdaGs) return b.lambdaGs - a.lambdaGs;
    return String(a.batter).localeCompare(String(b.batter));
  });

  const headers = [
    'rank',
    'gamePk',
    'matchup',
    'batter',
    'batterId',
    'team',
    'λ_GS',
    'λ_HR_ref',
    'p_poisson',
    'p_calibrated',
    'calibration_status',
    'confidence',
    'reason',
    'lineup_slot',
    'opponent_sp_id',
    'park_mult_hr',
    'pitcher_mult',
    'weather_mult',
    'szn_HR',
    'szn_PA',
    'L14_HR',
    'gs_λ_mult',
  ];

  let sh = ss.getSheetByName(MLB_BATTER_GS_PROMO_TAB);
  if (sh) {
    try {
      sh.getRange(1, 1, Math.max(sh.getLastRow(), 3), Math.max(sh.getLastColumn(), headers.length)).breakApart();
    } catch (e) {}
    sh.clearContents();
    sh.clearFormats();
  } else {
    sh = ss.insertSheet(MLB_BATTER_GS_PROMO_TAB);
  }
  sh.setTabColor('#4a148c');
  sh.getRange(1, 1, 1, headers.length)
    .merge()
    .setValue(
      '📣 Grand Slam promo — λ_GS = λ_HR × league GS/HR × order weight · illustrative P(≥1); no odds'
    )
    .setFontWeight('bold')
    .setBackground('#4a148c')
    .setFontColor('#ffffff');
  sh.getRange(3, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight('bold')
    .setBackground('#7b1fa2')
    .setFontColor('#ffffff');

  if (rowsOut.length) {
    const grid = [];
    for (let i = 0; i < rowsOut.length; i++) {
      const o = rowsOut[i];
      grid.push([
        i + 1,
        o.gamePk,
        o.matchup,
        o.batter,
        o.batterId,
        o.team,
        Math.round(o.lambdaGs * 1e6) / 1e6,
        Math.round(o.lambdaHrRef * 10000) / 10000,
        Math.round(o.pPoisson * 1e6) / 1e6,
        Math.round(o.pCalibrated * 1e6) / 1e6,
        o.calibrationStatus,
        o.confidence,
        o.reason,
        o.lineupSlot,
        o.opponentSpId,
        Math.round(o.parkMult * 1000) / 1000,
        Math.round(o.pitcherMult * 1000) / 1000,
        o.weatherMult,
        o.sznHr,
        o.sznPa,
        o.l14Hr,
        Math.round(o.gsMult * 10000) / 10000,
      ]);
    }
    sh.getRange(4, 1, grid.length, headers.length).setValues(grid);
    sh.getRange(4, 9, grid.length, 2).setNumberFormat('0.0000%');
    try {
      ss.setNamedRange(MLB_BATTER_GS_PROMO_NAMED_RANGE, sh.getRange(4, 1, grid.length, headers.length));
    } catch (e) {}
  }
  sh.setFrozenRows(3);
  ss.toast(rowsOut.length + ' promo GS rows', 'Batter GS promo', 8);
}
