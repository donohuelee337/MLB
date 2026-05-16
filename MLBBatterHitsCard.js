// ============================================================
// 🎯 Batter Hits card — binomial(estAB, BA × hits-park) vs FanDuel batter_hits
// ============================================================
// Reads 📋 Batter_Hits_Queue; pulls season BA stats from Stats API to compute
// P(≥k hits in estAB at-bats) at the home-park hits multiplier. Writes 19
// columns; MLBBetCard.js reads this tab as the H block.
// ============================================================

const MLB_BATTER_HITS_CARD_TAB = '🎯 Batter_Hits_Card';

var __mlbHitterBatStatsCache = {};
var __mlbHitterBatStatsByIdCache = {};

function mlbResetHitterBatStatsCache_() {
  __mlbHitterBatStatsCache = {};
  __mlbHitterBatStatsByIdCache = {};
}

/**
 * Season hitting stats (BA, AB, hits, PA, games) for all MLB batters, keyed by playerId.
 * NOTE: do NOT sort by a rate stat (battingAverage/slg/etc.) — the MLB stats API silently
 * filters to qualified hitters only (~3.1 PA × team games), which drops every recent
 * call-up and anyone with a partial-season IL stint. Sort by atBats desc to grab everyone
 * who has actually stepped to the plate, up to limit.
 */
function mlbFetchAllHitterBatStats_(season) {
  const key = 'bat_' + String(season);
  if (__mlbHitterBatStatsCache[key]) return __mlbHitterBatStatsCache[key];

  const url =
    mlbStatsApiBaseUrl_() +
    '/stats?stats=season&group=hitting&season=' +
    encodeURIComponent(String(season)) +
    '&sportId=1&gameType=R&limit=1500&sortStat=atBats&order=desc';
  try {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      Logger.log('mlbFetchAllHitterBatStats_ HTTP ' + res.getResponseCode());
      __mlbHitterBatStatsCache[key] = {};
      return {};
    }
    const payload = JSON.parse(res.getContentText());
    const splits = (payload.stats && payload.stats[0] && payload.stats[0].splits) || [];
    const out = {};
    splits.forEach(function (sp) {
      const pl = sp.player || {};
      const tm = sp.team || {};
      const st = sp.stat || {};
      if (!pl.id) return;
      const ab = parseInt(st.atBats, 10) || 0;
      const h  = parseInt(st.hits, 10)   || 0;
      const pa = parseInt(st.plateAppearances, 10) || 0;
      const g  = parseInt(st.gamesPlayed, 10)      || 0;
      const d  = parseInt(st.doubles, 10)  || 0;
      const tr = parseInt(st.triples, 10)  || 0;
      const hr = parseInt(st.homeRuns, 10) || 0;
      const avgStr = String(st.avg || '');
      const slgStr = String(st.slg || '');
      const ba = parseFloat(avgStr) || (ab > 0 ? h / ab : 0);
      const tb = h + d + 2 * tr + 3 * hr;
      const slg = parseFloat(slgStr) || (ab > 0 ? tb / ab : 0);
      let teamAbbr = String(tm.abbreviation || '').trim().toUpperCase();
      const teamId = parseInt(tm.id, 10);
      if (!teamAbbr && teamId && MLB_TEAM_ABBREV[teamId]) teamAbbr = MLB_TEAM_ABBREV[teamId];
      out[pl.id] = {
        playerId: pl.id,
        name: pl.fullName || '',
        teamAbbr: teamAbbr,
        teamId: tm.id || '',
        ba: ba,
        slg: slg,
        ab: ab,
        hits: h,
        tb: tb,
        pa: pa,
        games: g,
      };
    });
    __mlbHitterBatStatsCache[key] = out;
    return out;
  } catch (e) {
    Logger.log('mlbFetchAllHitterBatStats_: ' + e.message);
    __mlbHitterBatStatsCache[key] = {};
    return {};
  }
}

/**
 * Per-player season hitting fallback. Used only when the bulk fetch misses a batter
 * (rare now that we sort by atBats, but keeps us resilient if the limit ever truncates
 * deep call-ups). Cached per season+id so a slate only pays the cost once.
 */
function mlbFetchHitterBatStatsById_(playerId, season) {
  const idNum = parseInt(playerId, 10);
  if (isNaN(idNum) || !idNum) return null;
  const ck = String(season) + ':' + idNum;
  if (Object.prototype.hasOwnProperty.call(__mlbHitterBatStatsByIdCache, ck)) {
    return __mlbHitterBatStatsByIdCache[ck];
  }
  const url =
    mlbStatsApiBaseUrl_() +
    '/people/' + idNum +
    '/stats?stats=season&group=hitting&season=' + encodeURIComponent(String(season)) +
    '&sportId=1&gameType=R';
  try {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      __mlbHitterBatStatsByIdCache[ck] = null;
      return null;
    }
    const payload = JSON.parse(res.getContentText());
    const splits = (payload.stats && payload.stats[0] && payload.stats[0].splits) || [];
    if (!splits.length) { __mlbHitterBatStatsByIdCache[ck] = null; return null; }
    const sp = splits[0];
    const st = sp.stat || {};
    const tm = sp.team || {};
    const ab = parseInt(st.atBats, 10) || 0;
    const h  = parseInt(st.hits, 10)   || 0;
    const pa = parseInt(st.plateAppearances, 10) || 0;
    const g  = parseInt(st.gamesPlayed, 10)      || 0;
    const d  = parseInt(st.doubles, 10)  || 0;
    const tr = parseInt(st.triples, 10)  || 0;
    const hr = parseInt(st.homeRuns, 10) || 0;
    const avgStr = String(st.avg || '');
    const slgStr = String(st.slg || '');
    const ba = parseFloat(avgStr) || (ab > 0 ? h / ab : 0);
    const tb = h + d + 2 * tr + 3 * hr;
    const slg = parseFloat(slgStr) || (ab > 0 ? tb / ab : 0);
    const stats = {
      playerId: idNum,
      name: '',
      teamAbbr: String(tm.abbreviation || '').toUpperCase(),
      teamId: tm.id || '',
      ba: ba, slg: slg, ab: ab, hits: h, tb: tb, pa: pa, games: g,
    };
    __mlbHitterBatStatsByIdCache[ck] = stats;
    return stats;
  } catch (e) {
    Logger.log('mlbFetchHitterBatStatsById_(' + idNum + '): ' + e.message);
    __mlbHitterBatStatsByIdCache[ck] = null;
    return null;
  }
}

/** normalizedName → stats. When names collide, keeps the one with the most ABs. */
function mlbHitterBatStatsByName_(statsById) {
  const byName = {};
  Object.keys(statsById).forEach(function (id) {
    const p = statsById[id];
    const norm = mlbNormalizePersonName_(p.name);
    if (!norm) return;
    const prev = byName[norm];
    if (!prev || p.ab > prev.ab) byName[norm] = p;
  });
  return byName;
}

function refreshBatterHitsBetCard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig();
  const q = ss.getSheetByName(MLB_BATTER_HITS_QUEUE_TAB);
  if (!q || q.getLastRow() < 4) {
    safeAlert_('Batter Hits card', 'Run Batter Hits queue first (pipeline or menu).');
    return;
  }

  const season = mlbSlateSeasonYear_(cfg);
  const statsById = mlbFetchAllHitterBatStats_(season) || {};
  const statsByName = mlbHitterBatStatsByName_(statsById);

  const estAbCfg = parseFloat(String(cfg['EST_AB_PER_GAME'] != null ? cfg['EST_AB_PER_GAME'] : '3.5').trim());
  const globalEstAb = !isNaN(estAbCfg) && estAbCfg > 0 ? estAbCfg : 3.5;
  const MIN_AB_FOR_BA = 30;

  const last = q.getLastRow();
  const raw = q.getRange(4, 1, Math.max(0, last - 3), 14).getValues();
  const out = [];

  raw.forEach(function (r) {
    const gamePk = r[0];
    const matchup = r[1];
    const batter = r[2];
    const batterId = r[3];
    const line = r[4];
    const fdOver = r[5];
    const fdUnder = r[6];
    const notes = r[10];
    const inj = r[11];
    const hpUmp = String(r[12] || '').trim();

    if (!String(batter || '').trim()) return;

    let stats = null;
    const idNum = parseInt(batterId, 10);
    if (!isNaN(idNum) && idNum && statsById[idNum]) stats = statsById[idNum];
    if (!stats) {
      const norm = mlbNormalizePersonName_(batter);
      if (norm && statsByName[norm]) stats = statsByName[norm];
    }
    // Fallback: if the bulk fetch missed this batter (limit truncation, partial-season,
    // mid-slate call-up), look the player up directly by ID. Cached per season+id.
    if (!stats && !isNaN(idNum) && idNum) {
      stats = mlbFetchHitterBatStatsById_(idNum, season);
    }
    const hasStats = !!(stats && stats.ab >= MIN_AB_FOR_BA);
    const baRaw = hasStats ? stats.ba : NaN;
    const estAb = hasStats && stats.games > 0
      ? Math.min(4.2, Math.max(2.5, Math.round((stats.ab / stats.games) * 100) / 100))
      : globalEstAb;

    const homeAbbr = mlbScheduleHomeAbbrForGamePk_(ss, gamePk);
    const parkMult = mlbParkHitsLambdaMultForHomeAbbr_(homeAbbr);
    const ba = !isNaN(baRaw) ? Math.max(0, Math.min(0.5, baRaw * parkMult)) : NaN;

    const lineNum = parseFloat(line, 10);
    const hasModel = hasStats && !isNaN(ba) && ba > 0 && !isNaN(lineNum);
    let lambdaDisp = '';
    let edge = '';
    let pOver = '';
    let pUnder = '';
    if (hasModel) {
      const lam = Math.round(ba * estAb * 1000) / 1000;
      lambdaDisp = lam;
      edge = Math.round((lam - lineNum) * 1000) / 1000;
      const kO = Math.floor(lineNum) + 1;
      const kU = Math.floor(lineNum + 1e-9);
      pOver = Math.round(mlbBinomialPGeqK_(kO, estAb, ba) * 1000) / 1000;
      pUnder = Math.round(mlbBinomialPLeqK_(kU, estAb, ba) * 1000) / 1000;
    }

    const imO = mlbAmericanImplied_(fdOver);
    const imU = mlbAmericanImplied_(fdUnder);
    const evO = pOver !== '' && fdOver !== '' ? mlbEvPerDollarRisked_(pOver, fdOver) : '';
    const evU = pUnder !== '' && fdUnder !== '' ? mlbEvPerDollarRisked_(pUnder, fdUnder) : '';

    let bestSide = '';
    let bestEv = '';
    if (evO !== '' && evU !== '') {
      if (evO >= evU && evO > 0) { bestSide = 'Over';  bestEv = evO; }
      else if (evU > evO && evU > 0) { bestSide = 'Under'; bestEv = evU; }
      else if (evO >= evU) { bestSide = 'Over';  bestEv = evO; }
      else { bestSide = 'Under'; bestEv = evU; }
    } else if (evO !== '') { bestSide = 'Over';  bestEv = evO; }
    else if (evU !== '') { bestSide = 'Under'; bestEv = evU; }

    const flags = mlbFlagsBatterTbCard_(inj, notes, hasModel);

    out.push([
      gamePk, matchup, batter, line, fdOver, fdUnder,
      lambdaDisp, edge, pOver, pUnder, imO, imU,
      evO, evU, bestSide, bestEv, flags, batterId, hpUmp,
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

  let sh = ss.getSheetByName(MLB_BATTER_HITS_CARD_TAB);
  if (sh) {
    sh.clearContents();
    sh.clearFormats();
  } else {
    sh = ss.insertSheet(MLB_BATTER_HITS_CARD_TAB);
  }
  sh.setTabColor('#00838f');

  [72, 200, 150, 56, 64, 64, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 140, 88, 140].forEach(function (w, i) {
    sh.setColumnWidth(i + 1, w);
  });

  sh.getRange(1, 1, 1, 19)
    .merge()
    .setValue('🎯 Batter Hits card — Binomial(estAB, BA×hits-park); vs FD batter_hits line')
    .setFontWeight('bold')
    .setBackground('#006064')
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center')
    .setWrap(true);
  sh.setRowHeight(1, 34);

  const headers = [
    'gamePk', 'matchup', 'batter', 'fd_hits_line', 'fd_over', 'fd_under',
    'lambda_H', 'edge_vs_line', 'p_over', 'p_under', 'implied_over', 'implied_under',
    'ev_over_$1', 'ev_under_$1', 'best_side', 'best_ev_$1', 'flags', 'batter_id', 'hp_umpire',
  ];
  sh.getRange(3, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight('bold')
    .setBackground('#0097a7')
    .setFontColor('#ffffff');
  sh.setFrozenRows(3);

  if (out.length) {
    sh.getRange(4, 1, out.length, headers.length).setValues(out);
    try {
      ss.setNamedRange('MLB_BATTER_HITS_CARD', sh.getRange(4, 1, out.length, headers.length));
    } catch (e) {}
  }

  ss.toast(out.length + ' rows · sorted by best_ev', 'Batter Hits card', 6);
}
