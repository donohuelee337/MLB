// ============================================================
// 📣 Batter HR promo — lineup + SP + park λ (no odds)
// ============================================================
// Spec: docs/superpowers/specs/2026-05-12-batter-hr-promo-predictive-model-design.md
// Depends: MLBResultsGrader.js, MLBBatterHRQueue.js, MLBBatterTBQueue.js,
//   MLBParkFactors.js, MLBPitcherKQueue.js (mlbSlateSeasonYear_),
//   MLBPitcherGameLogs.js (mlbStatsApiBaseUrl_), Config.js, MLBPipelineLog.js
// ============================================================

var MLB_BATTER_HR_PROMO_TAB = '📣 Batter_HR_Promo';
var MLB_BATTER_HR_PROMO_NAMED_RANGE = 'MLB_BATTER_HR_PROMO';

function mlbHrPromoParseConfigNum_(cfg, key, def) {
  const x = parseFloat(String(cfg[key] != null ? cfg[key] : def).trim(), 10);
  return isNaN(x) ? def : x;
}

function mlbHrPromoBattingOrderFromPlayers_(players) {
  const line = [];
  if (!players) return line;
  for (const k in players) {
    if (!Object.prototype.hasOwnProperty.call(players, k)) continue;
    const p = players[k];
    const pers = p && p.person ? p.person : {};
    const id = parseInt(pers.id, 10);
    if (!id) continue;
    const boRaw = p.battingOrder;
    if (boRaw == null || String(boRaw).trim() === '') continue;
    const boNum = parseInt(boRaw, 10);
    if (isNaN(boNum)) continue;
    const ord = boNum >= 100 ? Math.floor(boNum / 100) : boNum;
    if (ord < 1 || ord > 9) continue;
    line.push({
      order: ord,
      batterId: id,
      name: String(pers.fullName || '').trim(),
    });
  }
  line.sort(function (a, b) {
    return a.order - b.order;
  });
  return line;
}

function mlbHrPromoFetchPitcherSeasonHr9_(pitcherId, season) {
  const id = parseInt(pitcherId, 10);
  if (!id) return null;
  const url =
    mlbStatsApiBaseUrl_() +
    '/people/' +
    id +
    '/stats?stats=season&group=pitching&season=' +
    encodeURIComponent(String(season));
  try {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return null;
    const payload = JSON.parse(res.getContentText());
    const splits = payload.stats && payload.stats[0] && payload.stats[0].splits;
    const st = splits && splits[0] && splits[0].stat;
    if (!st) return null;
    const hr = parseInt(st.homeRuns, 10) || 0;
    const ipStr = String(st.inningsPitched || '').trim();
    const ip = ipStr ? mlbParseInningsString_(ipStr) : NaN;
    if (isNaN(ip) || ip <= 0) return null;
    return (9 * hr) / ip;
  } catch (e) {
    Logger.log('mlbHrPromoFetchPitcherSeasonHr9_: ' + e.message);
    return null;
  }
}

function mlbHrPromoL14HrFromSplits_(playerId, season) {
  const splits = mlbStatsApiGetHittingGameSplits_(playerId, season);
  const n = splits.length;
  const lg = Math.min(14, n);
  let h = 0;
  for (let i = 0; i < lg; i++) {
    h += parseInt((splits[i].stat || {}).homeRuns, 10) || 0;
  }
  return { l14hr: h, l14g: lg };
}

function mlbHrPromoBuildTeamHittingMap_(abbr, season, abbrToId) {
  const teamId = abbrToId[String(abbr || '').trim().toUpperCase()];
  const out = {};
  if (!teamId) return out;
  const players = mlbFetchTeamHittingStats_(teamId, abbr, season) || [];
  for (let i = 0; i < players.length; i++) {
    const pl = players[i];
    const id = parseInt(pl.playerId, 10);
    if (!id) continue;
    out[String(id)] = { hr: pl.hr, pa: pl.pa, name: pl.name };
  }
  return out;
}

/**
 * @returns {Object} one output row object
 */
function mlbHrPromoRowForBatter_(ctx) {
  const cfg = ctx.cfg;
  const season = ctx.season;
  const paTable = mlbHrPromoPaTableFromConfigJson_(cfg['HR_PROMO_EXPECTED_PA_JSON']);
  const wL14 = mlbHrPromoParseConfigNum_(cfg, 'HR_PROMO_BLEND_L14_WEIGHT', 0.25);
  const shrinkMin = parseInt(String(cfg['HR_PROMO_SHRINK_MIN_PA'] != null ? cfg['HR_PROMO_SHRINK_MIN_PA'] : '50').trim(), 10) || 50;
  const prior = mlbHrPromoParseConfigNum_(cfg, 'LEAGUE_HITTING_HR_PER_PA', 0.032);
  const lgHr9 = mlbHrPromoParseConfigNum_(cfg, 'LEAGUE_PITCHING_HR9', 1.15);
  const pmLo = mlbHrPromoParseConfigNum_(cfg, 'HR_PROMO_PITCHER_MULT_MIN', 0.85);
  const pmHi = mlbHrPromoParseConfigNum_(cfg, 'HR_PROMO_PITCHER_MULT_MAX', 1.15);

  const slot = ctx.lineupSlot;
  const exPa = ctx.expectedPaOverride != null ? ctx.expectedPaOverride : mlbHrPromoExpectedPaForOrder_(slot, paTable);

  const hit = ctx.teamHitMap[String(ctx.batterId)] || { hr: 0, pa: 0, name: '' };
  const sznHr = parseInt(hit.hr, 10) || 0;
  const sznPa = parseInt(hit.pa, 10) || 0;
  const shrunk = mlbHrPromoShrinkHrPerPa_(sznHr, sznPa, prior, shrinkMin);

  mlbHrPromoRememberPlayerName_(ctx.batterId, hit.name || ctx.nameFallback || '');
  const l14 = mlbHrPromoL14HrFromSplits_(ctx.batterId, season);
  const denomRecent = Math.max(1, l14.l14g) * exPa;
  const recentHrPerPa = l14.l14hr / denomRecent;
  const hrPerPaEff = mlbHrPromoBlendHrPerPa_(shrunk, recentHrPerPa, wL14);

  let pitcherMult = 1;
  let conf = ctx.baseConfidence || 'high';
  let reason = ctx.baseReason || '';
  const spId = parseInt(ctx.opponentSpId, 10);
  if (!spId) {
    pitcherMult = 1;
    conf = 'low';
    reason = reason ? reason + ';sp_missing' : 'sp_missing';
  } else {
    const hr9 = mlbHrPromoFetchPitcherSeasonHr9_(spId, season);
    if (hr9 == null) {
      addPipelineWarning_('HR promo: missing SP HR/9 for pitcher ' + spId);
    } else {
      pitcherMult = mlbHrPromoPitcherMultFromHrPer9_(hr9, lgHr9, pmLo, pmHi);
    }
  }

  if (sznPa > 0 && sznPa < shrinkMin && conf === 'high') {
    conf = 'medium';
    reason = reason ? reason + ';low_pa' : 'low_pa';
  }

  const parkMult = mlbParkHrLambdaMultForHomeAbbr_(ctx.homeAbbr);
  const lambdaRaw = hrPerPaEff * exPa * parkMult * pitcherMult;
  const pPoisson = mlbHrPromoPoissonPHrGe1_(lambdaRaw);

  const props = PropertiesService.getScriptProperties();
  const a = parseFloat(String(props.getProperty('HR_PROMO_PLATT_A') || '').trim(), 10);
  const b = parseFloat(String(props.getProperty('HR_PROMO_PLATT_B') || '').trim(), 10);
  let pCal = pPoisson;
  let calStatus = 'none';
  if (!isNaN(a) && !isNaN(b)) {
    pCal = mlbHrPromoPlattP_(pPoisson, a, b);
    calStatus = 'calibrated';
  }

  const name = String(hit.name || ctx.nameFallback || '').trim();
  return {
    gamePk: ctx.gamePk,
    matchup: ctx.matchup,
    batter: name,
    batterId: ctx.batterId,
    team: ctx.teamAbbr,
    lambdaRaw: lambdaRaw,
    pPoisson: pPoisson,
    pCalibrated: pCal,
    calibrationStatus: calStatus,
    confidence: conf,
    reason: reason,
    lineupSlot: slot,
    opponentSpId: spId || '',
    parkMult: parkMult,
    pitcherMult: pitcherMult,
    weatherMult: 1,
    sznHr: sznHr,
    sznPa: sznPa,
    l14Hr: l14.l14hr,
  };
}

function refreshBatterHrPromoSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig();
  const season = mlbSlateSeasonYear_(cfg);
  const fb = String(cfg['HR_PROMO_LINEUP_FALLBACK'] || 'roster')
    .trim()
    .toLowerCase();
  const abbrToId = mlbAbbrToTeamId_();

  const sch = ss.getSheetByName(MLB_SCHEDULE_TAB);
  if (!sch || sch.getLastRow() < 4) {
    safeAlert_('Batter HR promo', 'Run 📅 MLB schedule first.');
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
        rowsOut.push(
          mlbHrPromoRowForBatter_({
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
          })
        );
      }
      return;
    }
    if (fb === 'skip') {
      addPipelineWarning_('HR promo: lineup_missing skip · ' + ctx2.matchup + ' · ' + teamAbbr);
      return;
    }
    const ids = Object.keys(hitMap);
    for (let j = 0; j < ids.length; j++) {
      const bid = parseInt(ids[j], 10);
      const h0 = hitMap[ids[j]];
      if (!bid || !h0 || (parseInt(h0.pa, 10) || 0) < 30) continue;
      if ((parseInt(h0.hr, 10) || 0) === 0) continue;
      rowsOut.push(
        mlbHrPromoRowForBatter_({
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
        })
      );
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
    if (b.pCalibrated !== a.pCalibrated) return b.pCalibrated - a.pCalibrated;
    if (b.lambdaRaw !== a.lambdaRaw) return b.lambdaRaw - a.lambdaRaw;
    return String(a.batter).localeCompare(String(b.batter));
  });

  const headers = [
    'rank',
    'gamePk',
    'matchup',
    'batter',
    'batterId',
    'team',
    'λ_raw',
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
  ];

  let sh = ss.getSheetByName(MLB_BATTER_HR_PROMO_TAB);
  if (sh) {
    try {
      sh.getRange(1, 1, Math.max(sh.getLastRow(), 3), Math.max(sh.getLastColumn(), headers.length)).breakApart();
    } catch (e) {}
    sh.clearContents();
    sh.clearFormats();
  } else {
    sh = ss.insertSheet(MLB_BATTER_HR_PROMO_TAB);
  }
  sh.setTabColor('#e65100');
  sh.getRange(1, 1, 1, headers.length)
    .merge()
    .setValue('📣 Batter HR promo — lineup λ × park_HR × SP · Poisson + optional Platt')
    .setFontWeight('bold')
    .setBackground('#e65100')
    .setFontColor('#ffffff');
  sh.getRange(3, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight('bold')
    .setBackground('#f57c00')
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
        Math.round(o.lambdaRaw * 10000) / 10000,
        Math.round(o.pPoisson * 1000) / 1000,
        Math.round(o.pCalibrated * 1000) / 1000,
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
      ]);
    }
    sh.getRange(4, 1, grid.length, headers.length).setValues(grid);
    sh.getRange(4, 9, grid.length, 1).setNumberFormat('0.0%');
    sh.getRange(4, 10, grid.length, 1).setNumberFormat('0.0%');
    try {
      ss.setNamedRange(MLB_BATTER_HR_PROMO_NAMED_RANGE, sh.getRange(4, 1, grid.length, headers.length));
    } catch (e) {}
  }
  sh.setFrozenRows(3);

  try {
    const flushed = mlbHrPromoFlushBatterGameLogWrites_();
    if (flushed) Logger.log('Batter_Game_Logs: persisted splits for ' + flushed + ' players');
  } catch (e) {
    Logger.log('mlbHrPromoFlushBatterGameLogWrites_: ' + (e.message || e));
  }

  ss.toast(rowsOut.length + ' promo HR rows', 'Batter HR promo', 8);
}
