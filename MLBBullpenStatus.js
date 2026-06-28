// ============================================================
// 🩹 MLBBullpenStatus — bullpen availability edge (nimble signal)
// ============================================================
// The least-priced nimble input: which pens are gassed TODAY. Books are slow
// to reprice secondary markets (F5, NRFI, team totals, late-inning props) for
// bullpen usage that only became knowable after yesterday's games. We read
// each slate team's last few games from statsapi, flag relievers who are
// down (back-to-back / heavy pitch count / used yesterday), and score the
// pen RESTED / TIRED / GASSED.
//
// This is a DETECTOR, not a projection — it surfaces a reason ("opp pen
// gassed: 3 arms B2B") that other models add to the signal score. A pick
// still needs the base edge; this just corroborates. Earn its weight in the
// shadow log before trusting it.
//
// Reuses MLBResultsGrader (mlbFetchBoxscoreJson_/mlbBoxscoreTeams_/
// mlbBoxscoreIsFinal_) + MLBSchedule (mlbFetchScheduleJsonForDate_) +
// MLBFormat (house style). Read-only on statsapi.
// ============================================================

const MLB_BULLPEN_STATUS_TAB = '🩹 Bullpen_Status';

// teamId(string) → { status, score, note, armsYest, pitchesYest, b2b, heavy,
//                    oppId, oppName, name, homeAway } — filled per run.
var __mlbBullpenCache = null;
var __mlbBullpenSchedCache = {}; // ymd → schedule JSON (memo: one fetch per date per run)

function mlbResetBullpenCache_() { __mlbBullpenCache = null; __mlbBullpenSchedCache = {}; }

/** Memoized schedule-by-date so a date is fetched once, not once per team. */
function mlbBullpenSched_(ymd) {
  if (Object.prototype.hasOwnProperty.call(__mlbBullpenSchedCache, ymd)) return __mlbBullpenSchedCache[ymd];
  const s = typeof mlbFetchScheduleJsonForDate_ === 'function' ? mlbFetchScheduleJsonForDate_(ymd) : null;
  __mlbBullpenSchedCache[ymd] = s;
  return s;
}

function mlbBullpenCfg_() {
  const cfg = (typeof getConfig === 'function' ? getConfig() : {}) || {};
  function num(k, d) {
    const v = parseFloat(String(cfg[k] != null ? cfg[k] : ''));
    return isFinite(v) && v > 0 ? v : d;
  }
  return {
    lookback: Math.round(num('BULLPEN_LOOKBACK_DAYS', 3)),
    heavy: num('BULLPEN_HEAVY_PITCHES', 30),
    mod: num('BULLPEN_MOD_PITCHES', 20),
    gassedScore: num('BULLPEN_GASSED_SCORE', 3),
  };
}

/** Slate anchor date (yyyy-MM-dd) — the day we're projecting for. */
function mlbBullpenAnchorYmd_() {
  try {
    const cfg = typeof getConfig === 'function' ? getConfig() : {};
    if (typeof getSlateDateString_ === 'function') {
      const s = getSlateDateString_(cfg);
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return s;
    }
  } catch (e) {}
  if (typeof mlbTodayYmdNY_ === 'function') return mlbTodayYmdNY_();
  return Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd');
}

/** N prior dates (most-recent first) before anchor, as yyyy-MM-dd. */
function mlbBullpenPriorDates_(anchorYmd, n) {
  const m = String(anchorYmd).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const base = m ? new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10))
                 : new Date();
  const out = [];
  for (let d = 1; d <= n; d++) {
    const dt = new Date(base.getTime() - d * 86400000);
    out.push(Utilities.formatDate(dt, 'America/New_York', 'yyyy-MM-dd'));
  }
  return out; // [yesterday, day-before, ...]
}

/** Teams on the slate: [{id,name,gamePk,oppId,oppName,homeAway}]. */
function mlbBullpenSlateTeams_(anchorYmd) {
  const out = [];
  const sched = mlbBullpenSched_(anchorYmd);
  const dates = (sched && sched.dates) || [];
  dates.forEach(function (d) {
    (d.games || []).forEach(function (g) {
      const home = g.teams && g.teams.home && g.teams.home.team;
      const away = g.teams && g.teams.away && g.teams.away.team;
      if (!home || !away) return;
      out.push({ id: String(home.id), name: home.name || '', gamePk: g.gamePk, oppId: String(away.id), oppName: away.name || '', homeAway: 'home' });
      out.push({ id: String(away.id), name: away.name || '', gamePk: g.gamePk, oppId: String(home.id), oppName: home.name || '', homeAway: 'away' });
    });
  });
  return out;
}

/**
 * Recent reliever appearances for one team across `dates` (most-recent first).
 * @returns {Object} pid → { name, apps: [{date, pitches, outs}] }
 */
function mlbBullpenTeamRelievers_(teamId, dates) {
  const tid = String(teamId);
  const relievers = {};
  // Map date → that team's gamePk(s). One schedule fetch per date (cached
  // upstream by date). Doubleheaders: include all of the team's games.
  for (let di = 0; di < dates.length; di++) {
    const ymd = dates[di];
    const sched = mlbBullpenSched_(ymd);
    const sdates = (sched && sched.dates) || [];
    const pks = [];
    sdates.forEach(function (d) {
      (d.games || []).forEach(function (g) {
        const h = g.teams && g.teams.home && g.teams.home.team;
        const a = g.teams && g.teams.away && g.teams.away.team;
        if ((h && String(h.id) === tid) || (a && String(a.id) === tid)) pks.push(g.gamePk);
      });
    });
    pks.forEach(function (pk) {
      const box = typeof mlbFetchBoxscoreJson_ === 'function' ? mlbFetchBoxscoreJson_(pk) : null;
      if (!box || (typeof mlbBoxscoreIsFinal_ === 'function' && !mlbBoxscoreIsFinal_(box))) return;
      const teams = typeof mlbBoxscoreTeams_ === 'function' ? mlbBoxscoreTeams_(box) : null;
      if (!teams) return;
      const side = (teams.home && teams.home.team && String(teams.home.team.id) === tid) ? teams.home
                 : (teams.away && teams.away.team && String(teams.away.team.id) === tid) ? teams.away : null;
      if (!side) return;
      const order = side.pitchers || []; // appearance order; [0] = starter
      order.forEach(function (rawId, idx) {
        const pl = side.players && side.players['ID' + rawId];
        const pit = pl && pl.stats && pl.stats.pitching;
        if (!pit) return;
        const gs = parseInt(pit.gamesStarted, 10);
        const isStarter = (isFinite(gs) ? gs >= 1 : idx === 0);
        if (isStarter) return; // pen only
        const pitches = parseInt(pit.numberOfPitches, 10);
        const pc = isFinite(pitches) ? pitches : (parseInt(pit.pitchesThrown, 10) || 0);
        const outs = parseInt(pit.outs, 10) || 0;
        const pid = String(rawId);
        if (!relievers[pid]) relievers[pid] = { name: (pl.person && pl.person.fullName) || pid, apps: [] };
        relievers[pid].apps.push({ date: ymd, pitches: pc, outs: outs });
      });
    });
  }
  return relievers;
}

/** Classify a team's pen from its reliever appearance map. */
function mlbBullpenClassifyTeam_(relievers, dates, cfg) {
  const yDate = dates[0];
  const y2Date = dates[1];
  let armsYest = 0, pitchesYest = 0, b2b = 0, heavy = 0;
  Object.keys(relievers).forEach(function (pid) {
    const apps = relievers[pid].apps;
    const onY = apps.some(function (a) { return a.date === yDate; });
    const onY2 = y2Date && apps.some(function (a) { return a.date === y2Date; });
    const pY = apps.filter(function (a) { return a.date === yDate; }).reduce(function (s, a) { return s + (a.pitches || 0); }, 0);
    if (onY) { armsYest++; pitchesYest += pY; }
    if (onY && onY2) b2b++;
    if (onY && pY >= cfg.heavy) heavy++;
  });
  const score = b2b * 2 + heavy + (armsYest >= 4 ? 1 : 0);
  const status = score >= cfg.gassedScore ? 'GASSED' : (score >= 1 ? 'TIRED' : 'RESTED');
  let note;
  if (status === 'GASSED') note = 'pen depleted (' + b2b + ' B2B, ' + heavy + ' heavy) — lean opponent Over / late runs';
  else if (status === 'TIRED') note = 'some arms down (' + armsYest + ' used yest) — verify high-leverage availability';
  else note = 'full pen';
  return { status: status, score: score, note: note, armsYest: armsYest, pitchesYest: pitchesYest, b2b: b2b, heavy: heavy };
}

/** Build the per-team status for the whole slate (cached per run). */
function mlbBullpenComputeAll_() {
  if (__mlbBullpenCache) return __mlbBullpenCache;
  const cfg = mlbBullpenCfg_();
  const anchor = mlbBullpenAnchorYmd_();
  const dates = mlbBullpenPriorDates_(anchor, cfg.lookback);
  const teams = mlbBullpenSlateTeams_(anchor);
  const cache = {};
  teams.forEach(function (t) {
    if (cache[t.id]) return; // a team appears once per slate
    const relievers = mlbBullpenTeamRelievers_(t.id, dates);
    const cls = mlbBullpenClassifyTeam_(relievers, dates, cfg);
    cache[t.id] = {
      name: t.name, oppId: t.oppId, oppName: t.oppName, homeAway: t.homeAway,
      status: cls.status, score: cls.score, note: cls.note,
      armsYest: cls.armsYest, pitchesYest: cls.pitchesYest, b2b: cls.b2b, heavy: cls.heavy,
    };
  });
  __mlbBullpenCache = { anchor: anchor, teams: cache };
  return __mlbBullpenCache;
}

/**
 * Consumer API: this team's own pen status.
 * @returns {{status,score,note,armsYest,b2b,heavy}|null}
 */
function mlbBullpenEdgeForTeam_(teamId) {
  const all = mlbBullpenComputeAll_();
  return all.teams[String(teamId)] || null;
}

/** Consumer API: the status of THIS team's opponent pen (the exploitable side). */
function mlbBullpenOppEdge_(teamId) {
  const all = mlbBullpenComputeAll_();
  const me = all.teams[String(teamId)];
  if (!me) return null;
  return all.teams[String(me.oppId)] || null;
}

/** Build/refresh the 🩹 Bullpen_Status review tab. */
function refreshBullpenStatus_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  mlbResetBullpenCache_();
  const all = mlbBullpenComputeAll_();
  const ids = Object.keys(all.teams);
  const rank = { GASSED: 0, TIRED: 1, RESTED: 2 };
  ids.sort(function (a, b) {
    const d = (rank[all.teams[a].status] || 9) - (rank[all.teams[b].status] || 9);
    return d !== 0 ? d : String(all.teams[a].name).localeCompare(String(all.teams[b].name));
  });
  const rows = ids.map(function (id) {
    const t = all.teams[id];
    return [t.name, t.homeAway, t.oppName, t.armsYest, t.pitchesYest, t.b2b, t.heavy, t.status, t.note];
  });

  let sh = ss.getSheetByName(MLB_BULLPEN_STATUS_TAB);
  if (sh) { sh.clearContents(); sh.clearFormats(); }
  else { sh = ss.insertSheet(MLB_BULLPEN_STATUS_TAB); }
  sh.setTabColor('#00897b');
  mlbFmtTitle_(
    sh,
    '🩹 Bullpen Status — ' + all.anchor + ' · GASSED = lean the OPPONENT Over/late · detector only, add to signal score · built ' +
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'EEE M/d h:mm a'),
    9,
    { accent: '#00695c' }
  );
  mlbFmtHeader_(sh, 2, ['team', 'H/A', 'opponent', 'arms used yest', 'pitches yest', 'B2B arms', 'heavy arms', 'status', 'edge note'], { accent: '#00897b' });
  if (rows.length) {
    sh.getRange(3, 1, rows.length, 9).setValues(rows);
    mlbFmtBody_(sh, 3, rows.length, 9);
    for (let i = 0; i < rows.length; i++) {
      const st = rows[i][7];
      const cell = sh.getRange(3 + i, 8);
      if (st === 'GASSED') cell.setBackground('#b91c1c').setFontColor('#ffffff');
      else if (st === 'TIRED') cell.setBackground('#fff8e1');
      else if (st === 'RESTED') cell.setBackground('#86efac');
    }
  } else {
    sh.getRange(3, 1).setValue('No slate teams resolved for ' + all.anchor + ' — run a Morning window first (needs 📅 schedule + final boxscores from prior days).');
  }
  sh.setColumnWidth(1, 150);
  sh.setColumnWidth(3, 150);
  sh.setColumnWidth(9, 380);
  mlbFmtFreeze_(sh, 2);
  try { sh.activate(); } catch (e) {}
  const gassed = rows.filter(function (r) { return r[7] === 'GASSED'; }).length;
  try { ss.toast(rows.length + ' teams · ' + gassed + ' GASSED pen(s) · see 🩹 Bullpen_Status', '🩹 Bullpen', 8); } catch (e) {}
}

function mlbActivateBullpenStatusTab_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(MLB_BULLPEN_STATUS_TAB);
  if (!sh) { refreshBullpenStatus_(); sh = ss.getSheetByName(MLB_BULLPEN_STATUS_TAB); }
  if (sh) sh.activate();
}

/** Self-test (no API): classifier thresholds on a synthetic pen. */
function mlbBullpenSelfTest_() {
  const cfg = { lookback: 3, heavy: 30, mod: 20, gassedScore: 3 };
  const dates = ['2026-06-26', '2026-06-25', '2026-06-24'];
  const relievers = {
    A: { name: 'A', apps: [{ date: '2026-06-26', pitches: 34, outs: 3 }, { date: '2026-06-25', pitches: 18, outs: 2 }] }, // B2B + heavy
    B: { name: 'B', apps: [{ date: '2026-06-26', pitches: 12, outs: 3 }] }, // used yest, light
    C: { name: 'C', apps: [{ date: '2026-06-24', pitches: 20, outs: 3 }] }, // rested
  };
  const cls = mlbBullpenClassifyTeam_(relievers, dates, cfg);
  // A: B2B(+2) + heavy(+1) = 3 ; armsYest=2 (A,B) → no +1 ; score=3 → GASSED
  if (cls.b2b !== 1 || cls.heavy !== 1) throw new Error('b2b/heavy detect: ' + JSON.stringify(cls));
  if (cls.score !== 3 || cls.status !== 'GASSED') throw new Error('score/status: ' + JSON.stringify(cls));
  const rested = mlbBullpenClassifyTeam_({ C: relievers.C }, dates, cfg);
  if (rested.status !== 'RESTED') throw new Error('rested case: ' + JSON.stringify(rested));
  return 'OK GASSED score=' + cls.score + ' · RESTED ok';
}

function mlbBullpenSelfTestMenu_() {
  try { safeAlert_('Bullpen self-test', mlbBullpenSelfTest_()); }
  catch (e) { safeAlert_('Bullpen self-test', String(e.message || e)); }
}
