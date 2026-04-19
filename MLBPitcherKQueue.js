// ============================================================
// 📋 Pitcher K queue — schedule starters × FanDuel K + quick game log
// ============================================================
// Reads 📅 MLB_Schedule (with probable pitcher IDs) + ✅ FanDuel_MLB_Odds
// (pitcher_strikeouts only). One row per scheduled starter with main line
// (first point that has both Over and Under). Fetches MLB Stats API game
// logs for L3 K / L3 IP / season K/9 (to date).
// ============================================================

const MLB_PITCHER_K_QUEUE_TAB = '📋 Pitcher_K_Queue';

var __mlbPitchHandCache = {};

function mlbResetPitchHandCache_() {
  __mlbPitchHandCache = {};
}

/** R / L from GET /people/{id} (cached per run). */
/** Batch-warm pitchHand.code for many person ids (one HTTP per chunk). */
function mlbPrefetchPitchHandsForIds_(idList) {
  const raw = idList || [];
  const ids = [];
  const seen = {};
  for (let i = 0; i < raw.length; i++) {
    const n = parseInt(raw[i], 10);
    if (!n || seen[n]) continue;
    seen[n] = true;
    ids.push(n);
  }
  const chunk = 45;
  for (let c = 0; c < ids.length; c += chunk) {
    const slice = ids.slice(c, c + chunk);
    if (!slice.length) continue;
    if (c > 0) Utilities.sleep(80);
    const url =
      mlbStatsApiBaseUrl_() +
      '/people?personIds=' +
      slice.join(',') +
      '&fields=people,id,pitchHand';
    try {
      const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      if (res.getResponseCode() !== 200) continue;
      const payload = JSON.parse(res.getContentText());
      const people = payload.people || [];
      for (let p = 0; p < people.length; p++) {
        const person = people[p];
        const pid = person.id;
        const code =
          person.pitchHand && person.pitchHand.code ? String(person.pitchHand.code).trim() : '';
        if (pid != null) __mlbPitchHandCache[String(pid)] = code;
      }
      for (let s = 0; s < slice.length; s++) {
        const k = String(slice[s]);
        if (!Object.prototype.hasOwnProperty.call(__mlbPitchHandCache, k)) {
          __mlbPitchHandCache[k] = '';
        }
      }
    } catch (e) {
      Logger.log('mlbPrefetchPitchHandsForIds_: ' + e.message);
    }
  }
}

function mlbStatsApiGetPitchHand_(playerId) {
  const id = parseInt(playerId, 10);
  if (!id) return '';
  const key = String(id);
  if (Object.prototype.hasOwnProperty.call(__mlbPitchHandCache, key)) {
    return __mlbPitchHandCache[key];
  }
  const url = mlbStatsApiBaseUrl_() + '/people/' + id;
  try {
    Utilities.sleep(40);
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      __mlbPitchHandCache[key] = '';
      return '';
    }
    const payload = JSON.parse(res.getContentText());
    const p = payload.people && payload.people[0] ? payload.people[0] : {};
    const code = p.pitchHand && p.pitchHand.code ? String(p.pitchHand.code).trim() : '';
    __mlbPitchHandCache[key] = code;
    return code;
  } catch (e) {
    Logger.log('mlbStatsApiGetPitchHand_: ' + e.message);
    __mlbPitchHandCache[key] = '';
    return '';
  }
}

/** MLB IP string e.g. "6.0", "5.1", "4.2" → decimal innings. */
function mlbParseInningsString_(s) {
  const t = String(s || '0').trim();
  if (!t) return 0;
  const parts = t.split('.');
  const whole = parseInt(parts[0], 10) || 0;
  if (parts.length < 2) return whole;
  const out = parseInt(parts[1], 10);
  if (out === 1) return whole + 1 / 3;
  if (out === 2) return whole + 2 / 3;
  return whole;
}

/**
 * @returns {Object} keyed by norm(game)||norm(player) → { pt: { Over, Under } }
 */
function mlbBuildPitcherKOddsIndex_(ss) {
  const byPitcherGame = {};
  const sh = ss.getSheetByName(MLB_ODDS_CONFIG.tabName);
  if (!sh || sh.getLastRow() < 4) return byPitcherGame;
  const last = sh.getLastRow();
  const block = sh.getRange(4, 1, last, 6).getValues();
  for (let i = 0; i < block.length; i++) {
    const player = block[i][0];
    const gameLabel = block[i][1];
    const market = String(block[i][2] || '');
    const side = String(block[i][3] || '');
    const lineRaw = block[i][4];
    const price = block[i][5];
    if (market !== 'pitcher_strikeouts') continue;
    const g = mlbNormalizeGameLabel_(gameLabel);
    const p = mlbNormalizePersonName_(player);
    if (!g || !p) continue;
    const pt = parseFloat(lineRaw);
    if (isNaN(pt)) continue;
    const key = g + '||' + p;
    if (!byPitcherGame[key]) byPitcherGame[key] = {};
    if (!byPitcherGame[key][pt]) byPitcherGame[key][pt] = {};
    const sl = side.toLowerCase();
    if (sl.indexOf('over') !== -1) byPitcherGame[key][pt].Over = price;
    if (sl.indexOf('under') !== -1) byPitcherGame[key][pt].Under = price;
  }
  return byPitcherGame;
}

function mlbPickMainKPoint_(pointMap) {
  const pts = Object.keys(pointMap)
    .map(Number)
    .filter(function (x) {
      return !isNaN(x);
    })
    .sort(function (a, b) {
      return a - b;
    });
  for (let i = 0; i < pts.length; i++) {
    const o = pointMap[pts[i]];
    if (o && o.Over != null && o.Under != null) return pts[i];
  }
  if (pts.length) return pts[0];
  return null;
}

function mlbMainKPrices_(pointMap, point) {
  if (point == null || !pointMap[point]) return { over: '', under: '' };
  return {
    over: pointMap[point].Over != null ? pointMap[point].Over : '',
    under: pointMap[point].Under != null ? pointMap[point].Under : '',
  };
}

function mlbLoadInjuryLookup_(ss) {
  const byNorm = {};
  const sh = ss.getSheetByName(MLB_INJURY_CONFIG.tabName);
  if (!sh || sh.getLastRow() < 4) return byNorm;
  const data = sh.getRange(4, 1, sh.getLastRow(), 5).getValues();
  for (let i = 0; i < data.length; i++) {
    const nm = mlbNormalizePersonName_(data[i][0]);
    if (!nm) continue;
    const st = String(data[i][4] || '').trim();
    byNorm[nm] = st || 'Listed';
  }
  return byNorm;
}

function mlbPitchingLogSummary_(playerId, season) {
  const id = parseInt(playerId, 10);
  if (!id) return { l3k: '', l3ip: '', k9: '', games: 0 };
  const splits = mlbStatsApiGetPitchingGameSplits_(playerId, season);
  let totK = 0;
  let totIp = 0;
  let l3k = 0;
  let l3ip = 0;
  const nL = Math.min(3, splits.length);
  try {
    for (let i = 0; i < splits.length; i++) {
      const st = splits[i].stat || {};
      const k = parseInt(st.strikeOuts, 10) || 0;
      const ip = mlbParseInningsString_(st.inningsPitched);
      totK += k;
      totIp += ip;
      if (i < nL) {
        l3k += k;
        l3ip += ip;
      }
    }
    const k9 = totIp > 0 ? Math.round((totK / totIp) * 900) / 100 : '';
    return {
      l3k: nL ? l3k : '',
      l3ip: nL ? Math.round(l3ip * 100) / 100 : '',
      k9: k9,
      games: splits.length,
    };
  } catch (e) {
    Logger.log('mlbPitchingLogSummary_: ' + e.message);
    return { l3k: '', l3ip: '', k9: '', games: 0 };
  }
}

function mlbSlateSeasonYear_(cfg) {
  const ymd = getSlateDateString_(cfg);
  const y = parseInt(ymd.split('-')[0], 10);
  return isNaN(y) ? new Date().getFullYear() : y;
}

/**
 * Rebuild pitcher K queue from Schedule + Odds + Stats API (no odds refetch).
 */
function refreshPitcherKSlateQueue() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  mlbResetPitchHandCache_();
  mlbResetTeamHittingSeasonCache_();
  const cfg = getConfig();
  const season = mlbSlateSeasonYear_(cfg);
  const sch = ss.getSheetByName(MLB_SCHEDULE_TAB);
  if (!sch || sch.getLastRow() < 4) {
    safeAlert_('Pitcher K queue', 'Run MLB schedule first.');
    return;
  }

  const schLast = sch.getLastRow();
  const schCols = sch.getLastColumn();
  const scheduleRows = sch.getRange(4, 1, schLast, schCols).getValues();
  const pitcherIdsToPrefetch = {};
  scheduleRows.forEach(function (r) {
    [r[11], r[12]].forEach(function (pid) {
      const n = parseInt(pid, 10);
      if (n) pitcherIdsToPrefetch[n] = true;
    });
  });
  mlbPrefetchPitchHandsForIds_(Object.keys(pitcherIdsToPrefetch));

  const oddsIdx = mlbBuildPitcherKOddsIndex_(ss);
  const inj = mlbLoadInjuryLookup_(ss);

  const out = [];
  const seenIds = {};

  scheduleRows.forEach(function (r) {
    const gamePk = r[0];
    const matchup = r[5];
    const awayAbbr = String(r[3] || '').trim();
    const homeAbbr = String(r[4] || '').trim();
    const awayP = String(r[6] || '').trim();
    const homeP = String(r[7] || '').trim();
    const awayId = r[11];
    const homeId = r[12];
    const hpUmp = String(r[13] || '').trim();
    if (!gamePk || !matchup) return;

    const gameKeys = mlbCandidateGameKeys_(matchup, awayAbbr, homeAbbr);

    const sides = [
      { side: 'Away', name: awayP, pid: awayId },
      { side: 'Home', name: homeP, pid: homeId },
    ];
    sides.forEach(function (sp) {
      if (!sp.name) {
        out.push([
          gamePk,
          matchup,
          sp.side,
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          'no_probable_pitcher',
          '',
          hpUmp,
          '',
          '',
          '',
        ]);
        return;
      }
      const pNorm = mlbNormalizePersonName_(sp.name);
      let pointMap = mlbOddsPointMapForPitcher_(oddsIdx, gameKeys, pNorm);
      let note = '';
      if (!pointMap || !Object.keys(pointMap).length) {
        note = 'fd_k_miss';
        pointMap = {};
      }
      const mainPt = mlbPickMainKPoint_(pointMap);
      const px = mlbMainKPrices_(pointMap, mainPt);

      let l3k = '';
      let l3ip = '';
      let k9 = '';
      const pidNum = parseInt(sp.pid, 10);
      if (pidNum) {
        if (!seenIds[pidNum]) {
          if (!mlbStatsApiPitchingSplitsCached_(pidNum, season)) {
            Utilities.sleep(100);
          }
          seenIds[pidNum] = mlbPitchingLogSummary_(pidNum, season);
        }
        const lg = seenIds[pidNum];
        l3k = lg.l3k;
        l3ip = lg.l3ip;
        k9 = lg.k9;
      } else {
        note = note ? note + '; no_pitcher_id' : 'no_pitcher_id';
      }

      let throws = '';
      if (pidNum) {
        throws = mlbStatsApiGetPitchHand_(pidNum);
      }

      const injSt = inj[mlbNormalizePersonName_(sp.name)] || '';

      const oppAbbr = sp.side === 'Away' ? homeAbbr : awayAbbr;
      const oppTeamId = mlbTeamIdFromAbbr_(oppAbbr);
      let oppKpa = '';
      if (!isNaN(oppTeamId)) {
        const kpa = mlbTeamSeasonHittingKPerPa_(oppTeamId, season);
        oppKpa = !isNaN(kpa) ? kpa : '';
      }

      out.push([
        gamePk,
        matchup,
        sp.side,
        sp.name,
        sp.pid || '',
        mainPt != null ? mainPt : '',
        px.over,
        px.under,
        l3k,
        l3ip,
        k9,
        note,
        injSt,
        hpUmp,
        throws,
        oppAbbr,
        oppKpa,
      ]);
    });
  });

  let sh = ss.getSheetByName(MLB_PITCHER_K_QUEUE_TAB);
  if (sh) {
    sh.clearContents();
    sh.clearFormats();
  } else {
    sh = ss.insertSheet(MLB_PITCHER_K_QUEUE_TAB);
  }
  sh.setTabColor('#6a1b9a');
  [72, 220, 56, 160, 88, 56, 72, 72, 52, 52, 52, 220, 88, 140, 44, 56, 72].forEach(function (w, i) {
    sh.setColumnWidth(i + 1, w);
  });

  sh.getRange(1, 1, 1, 17)
    .merge()
    .setValue(
      '📋 Pitcher K queue — FD K + L3/season K9 + opp team SO/PA (statsapi) — season ' + season
    )
    .setFontWeight('bold')
    .setBackground('#4a148c')
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center');

  const headers = [
    'gamePk',
    'matchup',
    'side',
    'pitcher',
    'pitcher_id',
    'fd_k_line',
    'fd_over',
    'fd_under',
    'L3_K',
    'L3_IP',
    'K9_szn',
    'notes',
    'injury_status',
    'hp_umpire',
    'throws',
    'opp_abbr',
    'opp_k_pa',
  ];
  sh.getRange(3, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight('bold')
    .setBackground('#7b1fa2')
    .setFontColor('#ffffff');
  sh.setFrozenRows(3);

  if (out.length) {
    sh.getRange(4, 1, out.length, headers.length).setValues(out);
    try {
      ss.setNamedRange('MLB_PITCHER_K_QUEUE', sh.getRange(4, 1, out.length, headers.length));
    } catch (e) {}
  }

  ss.toast(out.length + ' starter rows', 'Pitcher K queue', 6);
}
