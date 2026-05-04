// ============================================================
// 📋 Batter HR queue — model P(HR≥1) for today's slate batters
// ============================================================
// Pulls every batter on today's teams via Stats API season hitting
// stats, computes λ = (HR/PA) × 4.0 × park_hr_factor, then ranks
// by Poisson P(HR≥1) = 1 − e^(−λ). No FD price required.
// ============================================================

const MLB_BATTER_HR_QUEUE_TAB = '📋 Batter_HR_Queue';
const MLB_BATTER_HR_EST_PA = 4.0;   // estimated PA per game for a starter
const MLB_BATTER_HR_MIN_PA = 30;    // ignore tiny samples

var __mlbHitterSeasonStatsCache = {};

function mlbResetHitterSeasonStatsCache_() {
  __mlbHitterSeasonStatsCache = {};
}

/**
 * Fetch all season hitting stats in one call.
 * Returns array of { playerId, name, teamAbbr, teamId, hr, pa, games }.
 */
function mlbFetchAllHitterSeasonStats_(season) {
  const key = String(season);
  if (__mlbHitterSeasonStatsCache[key]) return __mlbHitterSeasonStatsCache[key];

  // sortStat=homeRuns puts the interesting players first; limit 1000 covers full league
  const url =
    mlbStatsApiBaseUrl_() +
    '/stats?stats=season&group=hitting&season=' +
    encodeURIComponent(key) +
    '&sportId=1&gameType=R&limit=1000&sortStat=homeRuns&order=desc';
  try {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      Logger.log('mlbFetchAllHitterSeasonStats_ HTTP ' + res.getResponseCode());
      __mlbHitterSeasonStatsCache[key] = [];
      return [];
    }
    const payload = JSON.parse(res.getContentText());
    const splits = (payload.stats && payload.stats[0] && payload.stats[0].splits) || [];
    const out = [];
    splits.forEach(function (sp) {
      const pl  = sp.player || {};
      const tm  = sp.team   || {};
      const st  = sp.stat   || {};
      const pa  = parseInt(st.plateAppearances, 10) || 0;
      const hr  = parseInt(st.homeRuns, 10)         || 0;
      const g   = parseInt(st.gamesPlayed, 10)      || 0;
      if (!pl.id) return;
      out.push({
        playerId:  pl.id,
        name:      pl.fullName || '',
        teamAbbr:  String(tm.abbreviation || '').trim().toUpperCase(),
        teamId:    tm.id || '',
        hr:        hr,
        pa:        pa,
        games:     g,
      });
    });
    __mlbHitterSeasonStatsCache[key] = out;
    return out;
  } catch (e) {
    Logger.log('mlbFetchAllHitterSeasonStats_: ' + e.message);
    __mlbHitterSeasonStatsCache[key] = [];
    return [];
  }
}

/**
 * Build ranked HR probability queue for today's slate.
 * Writes to 📋 Batter_HR_Queue tab, sorted by P(HR≥1) desc.
 */
function refreshBatterHRQueue() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig();
  const season = mlbSlateSeasonYear_(cfg);

  // ── 1. Get today's teams from schedule ──────────────────────
  const sch = ss.getSheetByName(MLB_SCHEDULE_TAB);
  if (!sch || sch.getLastRow() < 4) {
    safeAlert_('Batter HR queue', 'Run MLB schedule first (📅 MLB schedule only).');
    return;
  }
  const schRows = sch.getRange(4, 1, sch.getLastRow(), 10).getValues();

  // Collect { abbr → homeAbbr } — we need to know which team is HOME for park factor
  // Row cols (0-based): [0]=gamePk [3]=awayAbbr [4]=homeAbbr [5]=matchup [8]=venue
  const gamesByAbbr = {};   // abbr → { homeAbbr, matchup, venue }
  schRows.forEach(function (r) {
    const away = String(r[3] || '').trim().toUpperCase();
    const home = String(r[4] || '').trim().toUpperCase();
    const matchup = String(r[5] || '').trim();
    const venue   = String(r[8] || '').trim();
    if (!away || !home) return;
    gamesByAbbr[away] = { homeAbbr: home, matchup: matchup, venue: venue };
    gamesByAbbr[home] = { homeAbbr: home, matchup: matchup, venue: venue };
  });

  const slateTeams = Object.keys(gamesByAbbr);
  if (!slateTeams.length) {
    safeAlert_('Batter HR queue', 'No teams found in schedule tab.');
    return;
  }

  // ── 2. Pull season hitting stats ────────────────────────────
  ss.toast('Fetching season hitting stats from Stats API…', 'Batter HR', 10);
  const allHitters = mlbFetchAllHitterSeasonStats_(season);
  if (!allHitters.length) {
    safeAlert_('Batter HR queue', 'Could not fetch season hitting stats from Stats API.');
    return;
  }

  // ── 3. Filter to today's slate & compute probability ────────
  const rows = [];
  allHitters.forEach(function (h) {
    if (!gamesByAbbr[h.teamAbbr]) return;          // not playing today
    if (h.pa < MLB_BATTER_HR_MIN_PA) return;       // too small a sample

    const game = gamesByAbbr[h.teamAbbr];
    const parkMult = mlbParkHrLambdaMultForHomeAbbr_(game.homeAbbr);
    const hrPerPa  = h.hr / h.pa;
    const lambda   = hrPerPa * MLB_BATTER_HR_EST_PA * parkMult;
    const pHr      = lambda > 0 ? 1 - Math.exp(-lambda) : 0;

    rows.push({
      name:     h.name,
      teamAbbr: h.teamAbbr,
      matchup:  game.matchup,
      venue:    game.venue,
      homeAbbr: game.homeAbbr,
      parkMult: parkMult,
      hr:       h.hr,
      pa:       h.pa,
      games:    h.games,
      hrPerPa:  hrPerPa,
      lambda:   lambda,
      pHr:      pHr,
    });
  });

  // Sort by P(HR≥1) descending
  rows.sort(function (a, b) { return b.pHr - a.pHr; });

  // ── 4. Write tab ─────────────────────────────────────────────
  let sh = ss.getSheetByName(MLB_BATTER_HR_QUEUE_TAB);
  if (sh) {
    try { sh.getRange(1, 1, Math.max(sh.getLastRow(), 3), Math.max(sh.getLastColumn(), 12)).breakApart(); } catch (e) {}
    sh.clearContents();
    sh.clearFormats();
  } else {
    sh = ss.insertSheet(MLB_BATTER_HR_QUEUE_TAB);
  }
  sh.setTabColor('#b71c1c');

  const colWidths = [40, 200, 60, 200, 160, 72, 60, 56, 56, 72, 72, 80];
  colWidths.forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });

  sh.getRange(1, 1, 1, colWidths.length)
    .merge()
    .setValue('📋 Batter HR queue — P(HR≥1) model — season ' + season + ' — est. ' + MLB_BATTER_HR_EST_PA + ' PA/game')
    .setFontWeight('bold')
    .setBackground('#b71c1c')
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center');

  const headers = [
    'rank', 'batter', 'team', 'matchup', 'venue', 'park_hr_mult',
    'szn_HR', 'szn_PA', 'szn_G', 'HR/PA', 'λ', 'P(HR≥1)',
  ];
  sh.getRange(3, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight('bold')
    .setBackground('#c62828')
    .setFontColor('#ffffff');

  if (rows.length) {
    const out = rows.map(function (r, i) {
      return [
        i + 1,
        r.name,
        r.teamAbbr,
        r.matchup,
        r.venue,
        Math.round(r.parkMult * 1000) / 1000,
        r.hr,
        r.pa,
        r.games,
        Math.round(r.hrPerPa * 10000) / 10000,
        Math.round(r.lambda * 10000) / 10000,
        Math.round(r.pHr * 1000) / 1000,
      ];
    });
    sh.getRange(4, 1, out.length, headers.length).setValues(out);

    // Highlight top 20 in a warm amber
    if (out.length >= 20) {
      sh.getRange(4, 1, 20, headers.length).setBackground('#fff3e0');
    }

    // Bold top 5
    if (out.length >= 5) {
      sh.getRange(4, 1, 5, headers.length).setFontWeight('bold');
    }

    // Format P(HR≥1) column as percentage
    sh.getRange(4, 12, out.length, 1).setNumberFormat('0.0%');

    try {
      ss.setNamedRange('MLB_BATTER_HR_QUEUE', sh.getRange(4, 1, out.length, headers.length));
    } catch (e) {}
  }

  sh.setFrozenRows(3);
  ss.toast(rows.length + ' batters ranked · top P(HR≥1): ' +
    (rows[0] ? rows[0].name + ' ' + Math.round(rows[0].pHr * 1000) / 10 + '%' : '—'),
    'Batter HR queue', 8);
}
