// ============================================================
// 🎰 Batter Hits card — binomial P(≥k hits) × FanDuel batter_hits
// ============================================================
// Model: P(≥1 hit) = 1 − (1−BA)^estAB using season BA from Stats API.
// Uses same 22-column output format as 🎰 Pitcher_K_Card so the
// Bet Card merge (mlbCollectPlaysFromPitcherOddsCard_) works unchanged.
//
// Column mapping (shared with K card):
//  0  gamePk        8  lambda (BA×estAB)   16 best_side
//  1  matchup       9  edge_vs_line        17 best_ev_$1
//  2  side          10 p_over              18 flags
//  3  batter name   11 p_under             19 batter_id
//  4  fd_hits_line  12 implied_over        20 '' (unused)
//  5  fd_over       13 implied_under       21 team_abbr
//  6  fd_under      14 ev_over_$1
//  7  est_AB        15 ev_under_$1
// ============================================================

const MLB_BATTER_HITS_CARD_TAB = '🎰 Batter_Hits_Card';

var __mlbHitterBatStatsCache = {};

function mlbResetHitterBatStatsCache_() {
  __mlbHitterBatStatsCache = {};
}

/**
 * Season hitting stats (BA, AB, hits, PA, games) for all MLB batters.
 * Returns an object keyed by playerId.
 */
function mlbFetchAllHitterBatStats_(season) {
  const key = 'bat_' + String(season);
  if (__mlbHitterBatStatsCache[key]) return __mlbHitterBatStatsCache[key];

  const url =
    mlbStatsApiBaseUrl_() +
    '/stats?stats=season&group=hitting&season=' +
    encodeURIComponent(String(season)) +
    '&sportId=1&gameType=R&limit=1000&sortStat=battingAverage&order=desc';
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
      // Stats API returns avg as string ".285"; fallback to computed ratio
      const avgStr = String(st.avg || '');
      const ba = parseFloat(avgStr) || (ab > 0 ? h / ab : 0);
      // Hitting splits often ship empty tm.abbreviation — fall back to id lookup.
      let teamAbbr = String(tm.abbreviation || '').trim().toUpperCase();
      const teamId = parseInt(tm.id, 10);
      if (!teamAbbr && teamId && MLB_TEAM_ABBREV[teamId]) {
        teamAbbr = MLB_TEAM_ABBREV[teamId];
      }
      out[pl.id] = {
        playerId: pl.id,
        name:     pl.fullName || '',
        teamAbbr: teamAbbr,
        teamId:   tm.id || '',
        ba:       ba,
        ab:       ab,
        hits:     h,
        pa:       pa,
        games:    g,
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
 * Secondary name-based lookup: normalizedName → stats.
 * When multiple players share a name, keeps the one with the most ABs.
 */
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

/** Odds index for batter_hits + batter_hits_alternate from the FD tab. */
function mlbBuildBatterHitsOddsIndex_(ss) {
  return mlbBuildPitcherOddsIndexForMarkets_(ss, ['batter_hits', 'batter_hits_alternate']);
}

// ── Binomial helpers ─────────────────────────────────────────────────────────

function mlbBinomCoeff_(n, k) {
  if (k > n - k) k = n - k;
  let r = 1;
  for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1);
  return r;
}

/**
 * P(X >= k) for Binomial(n, ba) where n is rounded to the nearest integer.
 * For hit props: P(≥k hits in estAB at-bats with per-AB hit rate ba).
 */
function mlbBinomialPGeqK_(k, n, ba) {
  const nInt = Math.round(n);
  if (k <= 0) return 1;
  if (ba <= 0 || nInt <= 0) return 0;
  if (ba >= 1) return 1;
  // Sum P(X=0) … P(X=k-1) then subtract from 1
  let pLess = 0;
  const q = 1 - ba;
  for (let i = 0; i < k && i <= nInt; i++) {
    pLess += mlbBinomCoeff_(nInt, i) * Math.pow(ba, i) * Math.pow(q, nInt - i);
  }
  return Math.max(0, Math.min(1, 1 - pLess));
}

/**
 * P(X <= k) for Binomial(n, ba). Complement of P(X >= k+1).
 */
function mlbBinomialPLeqK_(k, n, ba) {
  return 1 - mlbBinomialPGeqK_(k + 1, n, ba);
}

// ── Main card builder ─────────────────────────────────────────────────────────

/**
 * Build batter hits card from today's FD batter_hits lines + season BA stats.
 * Writes 🎰 Batter_Hits_Card in the same 22-column format as Pitcher_K_Card.
 */
function refreshBatterHitsCard() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig();
  const season = mlbSlateSeasonYear_(cfg);

  // ── 1. Schedule → gamePk / homeAbbr / awayAbbr lookup ───────
  const sch = ss.getSheetByName(MLB_SCHEDULE_TAB);
  if (!sch || sch.getLastRow() < 4) {
    safeAlert_('Batter Hits card', 'Run MLB schedule first.');
    return;
  }
  const schCols = Math.max(sch.getLastColumn(), 6);
  const schRows = sch.getRange(4, 1, sch.getLastRow(), schCols).getValues();

  // normGameKey → { gamePk, homeAbbr, awayAbbr, matchup }
  const schedByKey = {};
  schRows.forEach(function (r) {
    const gamePk   = r[0];
    const awayAbbr = String(r[3] || '').trim().toUpperCase();
    const homeAbbr = String(r[4] || '').trim().toUpperCase();
    const matchup  = String(r[5] || '').trim();
    if (!gamePk || !matchup) return;
    mlbCandidateGameKeys_(matchup, awayAbbr, homeAbbr).forEach(function (k) {
      if (!schedByKey[k]) schedByKey[k] = { gamePk: gamePk, homeAbbr: homeAbbr, awayAbbr: awayAbbr, matchup: matchup };
    });
  });

  // ── 2. FD batter_hits odds index ─────────────────────────────
  const oddsIdx = mlbBuildBatterHitsOddsIndex_(ss);
  if (!Object.keys(oddsIdx).length) {
    safeAlert_('Batter Hits card', 'No batter_hits lines in FanDuel odds tab — run FanDuel odds first.');
    return;
  }

  // ── 3. Season BA stats ────────────────────────────────────────
  ss.toast('Fetching hitter BA stats from Stats API…', 'Batter Hits', 10);
  const statsById   = mlbFetchAllHitterBatStats_(season);
  const statsByName = mlbHitterBatStatsByName_(statsById);
  const inj         = mlbLoadInjuryLookup_(ss);

  // ── 4. Config: estimated ABs per game ────────────────────────
  const estAbCfg = parseFloat(String(cfg['EST_AB_PER_GAME'] != null ? cfg['EST_AB_PER_GAME'] : '3.5').trim());
  const globalEstAb = !isNaN(estAbCfg) && estAbCfg > 0 ? estAbCfg : 3.5;

  const MIN_AB = 30; // minimum season ABs before trusting BA
  const out = [];

  // ── 5. Build card rows ────────────────────────────────────────
  Object.keys(oddsIdx).forEach(function (compositeKey) {
    // compositeKey = normGameKey + '||' + normPlayerName
    const sep = compositeKey.lastIndexOf('||');
    if (sep < 0) return;
    const normGame   = compositeKey.substring(0, sep);
    const normPlayer = compositeKey.substring(sep + 2);

    const schedEntry = schedByKey[normGame];
    if (!schedEntry) return; // not today's slate

    const pointMap = oddsIdx[compositeKey];
    if (!pointMap || !Object.keys(pointMap).length) return;

    const mainPt = mlbPickMainKPoint_(pointMap);
    if (mainPt == null) return;
    const px = mlbMainKPrices_(pointMap, mainPt);
    if (px.over === '' && px.under === '') return;

    // Player stats
    const stats    = statsByName[normPlayer];
    const hasStats = !!(stats && stats.ab >= MIN_AB);
    const ba       = hasStats ? stats.ba : NaN;
    const batterId = hasStats ? stats.playerId : '';
    const teamAbbr = hasStats ? stats.teamAbbr : '';
    const displayName = stats ? stats.name : normPlayer;

    // Per-player est ABs from season AB/G, clamped to [2.5, 4.2]
    const estAbPerGame = hasStats && stats.games > 0
      ? Math.min(4.2, Math.max(2.5, Math.round((stats.ab / stats.games) * 100) / 100))
      : globalEstAb;

    // Flags
    const flagArr = [];
    const injSt   = inj[normPlayer] || '';
    if (injSt) {
      const il = injSt.toLowerCase();
      if (il.indexOf('out') !== -1 || il.indexOf('doubtful') !== -1) flagArr.push('injury');
    }
    if (!hasStats) flagArr.push('no_stats');

    // Model
    let lamNum    = NaN;
    let edge      = '';
    let pOverDisp = '';
    let pUndrDisp = '';
    let evO = '', evU = '', bestSide = '', bestEv = '';

    if (hasStats && !isNaN(ba) && ba > 0) {
      lamNum = Math.round(ba * estAbPerGame * 1000) / 1000;
      const lineNum = parseFloat(mainPt);
      if (!isNaN(lineNum)) {
        edge      = Math.round((lamNum - lineNum) * 100) / 100;
        const kO  = Math.floor(lineNum) + 1;           // P(≥kO hits)
        const kU  = Math.floor(lineNum + 1e-9);        // P(≤kU hits)
        const pO  = mlbBinomialPGeqK_(kO, estAbPerGame, ba);
        const pU  = mlbBinomialPLeqK_(kU, estAbPerGame, ba);
        pOverDisp = Math.round(pO * 1000) / 1000;
        pUndrDisp = Math.round(pU * 1000) / 1000;
        if (px.over  !== '') evO = mlbEvPerDollarRisked_(pO, px.over);
        if (px.under !== '') evU = mlbEvPerDollarRisked_(pU, px.under);
        if (evO !== '' && evU !== '') {
          if      (evO >= evU && evO > 0) { bestSide = 'Over';  bestEv = evO; }
          else if (evU > evO  && evU > 0) { bestSide = 'Under'; bestEv = evU; }
          else if (evO >= evU)            { bestSide = 'Over';  bestEv = evO; }
          else                            { bestSide = 'Under'; bestEv = evU; }
        } else if (evO !== '') { bestSide = 'Over';  bestEv = evO; }
        else if (evU !== '') { bestSide = 'Under'; bestEv = evU; }
      } else {
        flagArr.push('bad_line');
      }
    }

    // Side (Away/Home) — useful for display, not for model
    const batSide =
      teamAbbr && teamAbbr === schedEntry.awayAbbr ? 'Away' :
      teamAbbr && teamAbbr === schedEntry.homeAbbr ? 'Home' : '';

    out.push([
      schedEntry.gamePk,                                          // 0  gamePk
      schedEntry.matchup,                                         // 1  matchup
      batSide,                                                    // 2  side
      displayName,                                                // 3  batter
      mainPt,                                                     // 4  fd_hits_line
      px.over,                                                    // 5  fd_over
      px.under,                                                   // 6  fd_under
      Math.round(estAbPerGame * 100) / 100,                       // 7  est_AB
      isNaN(lamNum) ? '' : lamNum,                                // 8  lambda
      edge,                                                       // 9  edge_vs_line
      pOverDisp,                                                  // 10 p_over
      pUndrDisp,                                                  // 11 p_under
      px.over  !== '' ? mlbAmericanImplied_(px.over)  : '',       // 12 implied_over
      px.under !== '' ? mlbAmericanImplied_(px.under) : '',       // 13 implied_under
      evO,                                                        // 14 ev_over_$1
      evU,                                                        // 15 ev_under_$1
      bestSide,                                                   // 16 best_side
      bestEv,                                                     // 17 best_ev_$1
      flagArr.join('; '),                                         // 18 flags
      batterId,                                                   // 19 batter_id
      '',                                                         // 20 (unused — no umpire)
      teamAbbr,                                                   // 21 team_abbr
    ]);
  });

  // Sort by best_ev desc
  out.sort(function (a, b) {
    const be = parseFloat(b[17]);
    const ae = parseFloat(a[17]);
    if (isNaN(be) && isNaN(ae)) return 0;
    if (isNaN(be)) return -1;
    if (isNaN(ae)) return 1;
    return be - ae;
  });

  // ── 6. Write tab ──────────────────────────────────────────────
  let sh = ss.getSheetByName(MLB_BATTER_HITS_CARD_TAB);
  if (sh) {
    const cr = Math.max(sh.getLastRow(), 3);
    const cc = Math.max(sh.getLastColumn(), 22);
    try { sh.getRange(1, 1, cr, cc).breakApart(); } catch (e) {}
    sh.clearContents();
    sh.clearFormats();
  } else {
    sh = ss.insertSheet(MLB_BATTER_HITS_CARD_TAB);
  }
  sh.setTabColor('#1565c0');

  [72, 200, 52, 160, 68, 72, 72, 56, 56, 56, 56, 56, 60, 60, 60, 60, 64, 56, 160, 88, 40, 56]
    .forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });

  sh.getRange(1, 1, 1, 22)
    .merge()
    .setValue('🎰 Batter Hits card — λ = BA × est_AB (binomial); FD batter_hits / alternate. Sort: best_ev desc.')
    .setFontWeight('bold')
    .setBackground('#0d47a1')
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center')
    .setWrap(true);
  sh.setRowHeight(1, 36);

  sh.getRange(3, 1, 1, 22)
    .setValues([[
      'gamePk', 'matchup', 'side', 'batter', 'fd_hits_line',
      'fd_over', 'fd_under', 'est_AB', 'lambda_H', 'edge_vs_line',
      'p_over', 'p_under', 'implied_over', 'implied_under',
      'ev_over_$1', 'ev_under_$1', 'best_side', 'best_ev_$1',
      'flags', 'batter_id', '(unused)', 'team_abbr',
    ]])
    .setFontWeight('bold')
    .setBackground('#1565c0')
    .setFontColor('#ffffff');

  if (out.length) {
    sh.getRange(4, 1, out.length, 22).setValues(out);
    try { ss.setNamedRange('MLB_BATTER_HITS_CARD', sh.getRange(4, 1, out.length, 22)); } catch (e) {}
  }
  sh.setFrozenRows(3);
  ss.toast(out.length + ' batter rows · season ' + season, 'Batter Hits card', 6);
}
