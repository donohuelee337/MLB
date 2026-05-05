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
      // Stats API hitting splits often ship empty tm.abbreviation; fall back to id lookup.
      let teamAbbr = String(tm.abbreviation || '').trim().toUpperCase();
      const teamId = parseInt(tm.id, 10);
      if (!teamAbbr && teamId && MLB_TEAM_ABBREV[teamId]) {
        teamAbbr = MLB_TEAM_ABBREV[teamId];
      }
      out.push({
        playerId:  pl.id,
        name:      pl.fullName || '',
        teamAbbr:  teamAbbr,
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
/** Reverse map: full team name (lower-cased) → abbreviation. */
function mlbBuildTeamNameToAbbrIndex_() {
  const idx = {};
  Object.keys(MLB_ABBR_TO_ODDS_TEAM_NAME).forEach(function (a) {
    idx[String(MLB_ABBR_TO_ODDS_TEAM_NAME[a]).toLowerCase()] = a;
  });
  Object.keys(MLB_ABBR_ODDS_TEAM_ALTERNATES).forEach(function (a) {
    (MLB_ABBR_ODDS_TEAM_ALTERNATES[a] || []).forEach(function (alt) {
      idx[String(alt).toLowerCase()] = a;
    });
  });
  return idx;
}

/** Fuzzy: full name first, then any key that contains the side string. */
function mlbAbbrFromMatchupSide_(side, nameIdx) {
  const s = String(side || '').trim().toLowerCase();
  if (!s) return '';
  if (nameIdx[s]) return nameIdx[s];
  const keys = Object.keys(nameIdx);
  for (let i = 0; i < keys.length; i++) {
    if (keys[i].indexOf(s) !== -1 || s.indexOf(keys[i]) !== -1) return nameIdx[keys[i]];
  }
  return '';
}

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
  const numDataRows = Math.max(0, sch.getLastRow() - 3);
  const schRows = numDataRows > 0
    ? sch.getRange(4, 1, numDataRows, 10).getValues()
    : [];

  // Collect { abbr → homeAbbr } — we need to know which team is HOME for park factor.
  // Schedule row cols (0-based): [0]=gamePk [3]=awayAbbr [4]=homeAbbr [5]=matchup [8]=venue
  // Some statsapi rows ship matchup populated but abbreviation empty (newly scheduled,
  // postponed, etc.) — fall back to parsing the matchup string against our team-name map.
  const nameIdx = mlbBuildTeamNameToAbbrIndex_();
  const gamesByAbbr = {};
  let parsedRows = 0;
  let skippedRows = 0;
  schRows.forEach(function (r) {
    let away   = String(r[3] || '').trim().toUpperCase();
    let home   = String(r[4] || '').trim().toUpperCase();
    const matchup = String(r[5] || '').trim();
    const venue   = String(r[8] || '').trim();

    if ((!away || !home) && matchup.indexOf(' @ ') !== -1) {
      const parts = matchup.split(' @ ');
      if (!away && parts.length === 2) away = mlbAbbrFromMatchupSide_(parts[0], nameIdx);
      if (!home && parts.length === 2) home = mlbAbbrFromMatchupSide_(parts[1], nameIdx);
    }

    if (!away || !home) { skippedRows++; return; }
    gamesByAbbr[away] = { homeAbbr: home, matchup: matchup, venue: venue };
    gamesByAbbr[home] = { homeAbbr: home, matchup: matchup, venue: venue };
    parsedRows++;
  });

  const slateTeams = Object.keys(gamesByAbbr);
  if (!slateTeams.length) {
    safeAlert_(
      'Batter HR queue',
      'No teams found in 📅 MLB_Schedule. Read ' + schRows.length + ' data row(s); ' +
      'none had usable away/home (skipped ' + skippedRows + '). ' +
      'Re-run 📅 MLB schedule only — if that returns 0 games, check ⚙️ SLATE_DATE.'
    );
    return;
  }

  // ── 2. Pull season hitting stats ────────────────────────────
  ss.toast('Fetching season hitting stats from Stats API…', 'Batter HR', 10);
  const allHitters = mlbFetchAllHitterSeasonStats_(season);
  if (!allHitters.length) {
    safeAlert_(
      'Batter HR queue',
      'Stats API returned 0 hitters for season ' + season + '. ' +
      'If this is the very first day of the season, wait until after the first game ends. ' +
      'Otherwise check Apps Script logs (View → Executions) for HTTP errors.'
    );
    return;
  }

  // ── 3. Filter to today's slate & compute probability ────────
  // Lower PA threshold dynamically for early-season slates (fewer ABs accumulated).
  const slateMonth = parseInt(getSlateDateString_(cfg).split('-')[1], 10);
  const minPa = slateMonth <= 4 ? 10 : (slateMonth === 5 ? 20 : MLB_BATTER_HR_MIN_PA);
  const rows = [];
  let matchedTeam = 0;
  let passedPa    = 0;
  allHitters.forEach(function (h) {
    if (!gamesByAbbr[h.teamAbbr]) return;          // not playing today
    matchedTeam++;
    if (h.pa < minPa) return;                       // too small a sample
    passedPa++;

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

  if (rows.length === 0) {
    safeAlert_(
      'Batter HR queue',
      'Empty result. Diagnostic:\n' +
      '  • Stats API returned ' + allHitters.length + ' hitters (season ' + season + ')\n' +
      '  • ' + matchedTeam + ' play for one of the ' + slateTeams.length + ' team(s) on this slate\n' +
      '  • ' + passedPa + ' have at least ' + minPa + ' PA\n' +
      'If matchedTeam is 0, Stats API team abbreviations do not line up with the schedule (see schedule cols D/E). ' +
      'If matchedTeam > 0 but passedPa is 0, lower the PA floor — set ⚙️ Config or wait a few games.'
    );
    return;
  }

  ss.toast(rows.length + ' batters ranked · top P(HR≥1): ' +
    (rows[0] ? rows[0].name + ' ' + Math.round(rows[0].pHr * 1000) / 10 + '%' : '—'),
    'Batter HR queue', 8);
}

/**
 * Menu helper: list every existing 📋 Batter_HR_Queue duplicate (the canonical
 * tab is exactly the constant MLB_BATTER_HR_QUEUE_TAB; anything else with a
 * similar name is an old/stale tab the user should remove manually).
 */
function listBatterHRQueueDuplicates_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const wanted = MLB_BATTER_HR_QUEUE_TAB;
  const matches = [];
  ss.getSheets().forEach(function (sh) {
    const n = sh.getName();
    if (n === wanted) return;
    const lower = n.toLowerCase();
    if (lower.indexOf('batter_hr') !== -1 || lower.indexOf('batter hr') !== -1 || lower.indexOf('hr_queue') !== -1) {
      matches.push(n);
    }
  });
  if (matches.length === 0) {
    safeAlert_('HR Queue dupes', 'No duplicate tabs found. Canonical tab: ' + wanted);
  } else {
    safeAlert_(
      'HR Queue dupes',
      'Canonical tab: ' + wanted + '\n\nLikely duplicates (delete manually if stale):\n  • ' +
      matches.join('\n  • ')
    );
  }
}
