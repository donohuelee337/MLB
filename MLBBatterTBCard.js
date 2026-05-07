// ============================================================
// 🎰 Batter TB card — Poisson P(≥k TB) × FanDuel batter_total_bases
// ============================================================
// Model: λ = SLG × est_AB ≈ expected total bases per game.
// Poisson on λ gives P(≥k) and P(≤k); simple v1 — a richer model
// would condition on opp pitcher hand & park, see project_bet_types.md.
//
// Uses the same 22-column output format as 🎰 Pitcher_K_Card so the
// Bet Card merge (mlbCollectPlaysFromPitcherOddsCard_) works unchanged.
//
// Column mapping (shared with K / Hits cards):
//  0  gamePk        8  lambda (SLG×estAB)  16 best_side
//  1  matchup       9  edge_vs_line        17 best_ev_$1
//  2  side          10 p_over              18 flags
//  3  batter name   11 p_under             19 batter_id
//  4  fd_tb_line    12 implied_over        20 '' (unused)
//  5  fd_over       13 implied_under       21 team_abbr
//  6  fd_under      14 ev_over_$1
//  7  est_AB        15 ev_under_$1
// ============================================================

const MLB_BATTER_TB_CARD_TAB = '🎰 Batter_TB_Card';

/** Odds index for batter_total_bases + batter_total_bases_alternate from the FD tab. */
function mlbBuildBatterTbOddsIndex_(ss) {
  return mlbBuildPitcherOddsIndexForMarkets_(ss, ['batter_total_bases', 'batter_total_bases_alternate']);
}

/**
 * Build batter TB card from today's FD batter_total_bases lines + season SLG stats.
 * Writes 🎰 Batter_TB_Card in the same 22-column format as Pitcher_K_Card.
 */
function refreshBatterTBCard() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig();
  const season = mlbSlateSeasonYear_(cfg);

  // ── 1. Schedule → gamePk / homeAbbr / awayAbbr lookup ───────
  const sch = ss.getSheetByName(MLB_SCHEDULE_TAB);
  if (!sch || sch.getLastRow() < 4) {
    safeAlert_('Batter TB card', 'Run MLB schedule first.');
    return;
  }
  const schCols = Math.max(sch.getLastColumn(), 6);
  const schRows = sch.getRange(4, 1, sch.getLastRow(), schCols).getValues();

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

  // ── 2. FD batter_total_bases odds index ──────────────────────
  const oddsIdx = mlbBuildBatterTbOddsIndex_(ss);
  if (!Object.keys(oddsIdx).length) {
    safeAlert_('Batter TB card', 'No batter_total_bases lines in FanDuel odds tab — run FanDuel odds first.');
    return;
  }

  // ── 3. Season hitting stats (shared cache with 🎰 Hits card) ─
  ss.toast('Fetching hitter stats from Stats API…', 'Batter TB', 10);
  const statsById   = mlbFetchAllHitterBatStats_(season);
  const statsByName = mlbHitterBatStatsByName_(statsById);
  const inj         = mlbLoadInjuryLookup_(ss);

  // ── 4. Config: estimated ABs per game ────────────────────────
  const estAbCfg = parseFloat(String(cfg['EST_AB_PER_GAME'] != null ? cfg['EST_AB_PER_GAME'] : '3.5').trim());
  const globalEstAb = !isNaN(estAbCfg) && estAbCfg > 0 ? estAbCfg : 3.5;

  const MIN_AB = 30; // minimum season ABs before trusting SLG
  const out = [];

  // ── 5. Build card rows ────────────────────────────────────────
  Object.keys(oddsIdx).forEach(function (compositeKey) {
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

    const stats    = statsByName[normPlayer];
    const hasStats = !!(stats && stats.ab >= MIN_AB && stats.slg > 0);
    const slg      = hasStats ? stats.slg : NaN;
    const batterId = hasStats ? stats.playerId : '';
    const teamAbbr = hasStats ? stats.teamAbbr : '';
    const displayName = stats ? stats.name : normPlayer;

    // Per-player est ABs from season AB/G, clamped to [2.5, 4.2].
    const estAbPerGame = hasStats && stats.games > 0
      ? Math.min(4.2, Math.max(2.5, Math.round((stats.ab / stats.games) * 100) / 100))
      : globalEstAb;

    const flagArr = [];
    const injSt   = inj[normPlayer] || '';
    if (injSt) {
      const il = injSt.toLowerCase();
      if (il.indexOf('out') !== -1 || il.indexOf('doubtful') !== -1) flagArr.push('injury');
    }
    if (!hasStats) flagArr.push('no_stats');

    let lamNum    = NaN;
    let edge      = '';
    let pOverDisp = '';
    let pUndrDisp = '';
    let evO = '', evU = '', bestSide = '', bestEv = '';

    if (hasStats && !isNaN(slg) && slg > 0) {
      lamNum = Math.round(slg * estAbPerGame * 1000) / 1000;
      const lineNum = parseFloat(mainPt);
      if (!isNaN(lineNum)) {
        edge = Math.round((lamNum - lineNum) * 100) / 100;
        // mlbProbOverUnderK_ handles half-lines (most TB lines are .5) via
        // P(over X.5) = 1 - PoissonCDF(floor(X.5), λ); P(under X.5) = PoissonCDF(floor(X.5), λ).
        const probs = mlbProbOverUnderK_(lineNum, lamNum);
        pOverDisp = Math.round(probs.pOver  * 1000) / 1000;
        pUndrDisp = Math.round(probs.pUnder * 1000) / 1000;
        if (px.over  !== '') evO = mlbEvPerDollarRisked_(probs.pOver,  px.over);
        if (px.under !== '') evU = mlbEvPerDollarRisked_(probs.pUnder, px.under);
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

    const batSide =
      teamAbbr && teamAbbr === schedEntry.awayAbbr ? 'Away' :
      teamAbbr && teamAbbr === schedEntry.homeAbbr ? 'Home' : '';

    out.push([
      schedEntry.gamePk,                                          // 0  gamePk
      schedEntry.matchup,                                         // 1  matchup
      batSide,                                                    // 2  side
      displayName,                                                // 3  batter
      mainPt,                                                     // 4  fd_tb_line
      px.over,                                                    // 5  fd_over
      px.under,                                                   // 6  fd_under
      Math.round(estAbPerGame * 100) / 100,                       // 7  est_AB
      isNaN(lamNum) ? '' : lamNum,                                // 8  lambda_TB
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
      '',                                                         // 20 (unused)
      teamAbbr,                                                   // 21 team_abbr
    ]);
  });

  out.sort(function (a, b) {
    const be = parseFloat(b[17]);
    const ae = parseFloat(a[17]);
    if (isNaN(be) && isNaN(ae)) return 0;
    if (isNaN(be)) return -1;
    if (isNaN(ae)) return 1;
    return be - ae;
  });

  // ── 6. Write tab ──────────────────────────────────────────────
  let sh = ss.getSheetByName(MLB_BATTER_TB_CARD_TAB);
  if (sh) {
    const cr = Math.max(sh.getLastRow(), 3);
    const cc = Math.max(sh.getLastColumn(), 22);
    try { sh.getRange(1, 1, cr, cc).breakApart(); } catch (e) {}
    sh.clearContents();
    sh.clearFormats();
  } else {
    sh = ss.insertSheet(MLB_BATTER_TB_CARD_TAB);
  }
  sh.setTabColor('#6a1b9a');

  [72, 200, 52, 160, 68, 72, 72, 56, 56, 56, 56, 56, 60, 60, 60, 60, 64, 56, 160, 88, 40, 56]
    .forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });

  sh.getRange(1, 1, 1, 22)
    .merge()
    .setValue('🎰 Batter TB card — λ = SLG × est_AB (Poisson); FD batter_total_bases / alternate. Sort: best_ev desc.')
    .setFontWeight('bold')
    .setBackground('#4a148c')
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center')
    .setWrap(true);
  sh.setRowHeight(1, 36);

  sh.getRange(3, 1, 1, 22)
    .setValues([[
      'gamePk', 'matchup', 'side', 'batter', 'fd_tb_line',
      'fd_over', 'fd_under', 'est_AB', 'lambda_TB', 'edge_vs_line',
      'p_over', 'p_under', 'implied_over', 'implied_under',
      'ev_over_$1', 'ev_under_$1', 'best_side', 'best_ev_$1',
      'flags', 'batter_id', '(unused)', 'team_abbr',
    ]])
    .setFontWeight('bold')
    .setBackground('#6a1b9a')
    .setFontColor('#ffffff');

  if (out.length) {
    sh.getRange(4, 1, out.length, 22).setValues(out);
    try { ss.setNamedRange('MLB_BATTER_TB_CARD', sh.getRange(4, 1, out.length, 22)); } catch (e) {}
  }
  sh.setFrozenRows(3);
  ss.toast(out.length + ' batter rows · season ' + season, 'Batter TB card', 6);
}
