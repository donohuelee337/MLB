// ============================================================
// 🎴 Game Cards — per-game "quick card" board for building SGPs
// ============================================================
// A read-only display that groups the day's qualifying bets by GAME
// (an SGP lives inside one game), so you can eyeball the strong legs for
// a matchup and stack them for fun. NOT a staking surface — no EV gates,
// no Kelly; just "here are the confident angles per game."
//
// Legs (each gated on confidence, sorted best→worst within a card):
//   🚦 NRFI   — 🌅 NRFI_Card p_nrfi ≥ GS_MIN_P_NRFI
//   ⚾ K      — ⚡ Sim_Pitcher_K max(p_over,p_under) ≥ GS_MIN_P_K
//   🥎 HIT    — 🧪 Hits v3 proj_hits ≥ GS_MIN_PROJ_HITS (Over); ⭐ + gold
//               border when the batter is also on the 🎯 Hit Machine board.
// Rebuilt at the end of the pipeline (after Hit Machine) and on the menu.
// ============================================================

const MLB_GAME_CARDS_TAB = '🎴 Game Cards';

// Heat palette for the confidence chip (p → background). Amber lean → green lock.
function mlbGameCardsHeat_(p) {
  if (!(p > 0)) return { bg: '#ffffff', fg: '#000000' };
  if (p >= 0.75) return { bg: '#1b5e20', fg: '#ffffff' };
  if (p >= 0.70) return { bg: '#43a047', fg: '#ffffff' };
  if (p >= 0.65) return { bg: '#a5d6a7', fg: '#1b3a1d' };
  if (p >= 0.60) return { bg: '#fff59d', fg: '#5b4d00' };
  return { bg: '#fbe9e7', fg: '#6b2b1f' };
}

/** Normalized batter names currently on the 🎯 Hit Machine board (col 2). */
function mlbGameCardsHitMachineSet_(ss) {
  const set = {};
  try {
    const sh = ss.getSheetByName(typeof MLB_HIT_MACHINE_TAB !== 'undefined' ? MLB_HIT_MACHINE_TAB : '🎯 Hit_Machine');
    if (!sh || sh.getLastRow() < 5) return set;
    const names = sh.getRange(5, 2, sh.getLastRow() - 4, 1).getValues();
    names.forEach(function (r) {
      const n = mlbNormalizePersonName_(r[0]);
      if (n) set[n] = true;
    });
  } catch (e) {}
  return set;
}

function mlbGameCardsNum_(v) {
  const x = parseFloat(String(v));
  return isFinite(x) ? x : NaN;
}

/** Collect qualifying legs keyed by gamePk. */
function mlbGameCardsCollect_(ss, cfg) {
  const minNrfi = mlbGameCardsNum_(cfg['GS_MIN_P_NRFI']) || 0.60;
  const minK = mlbGameCardsNum_(cfg['GS_MIN_P_K']) || 0.60;
  const minProjH = mlbGameCardsNum_(cfg['GS_MIN_PROJ_HITS']) || 1.00;
  const hmSet = mlbGameCardsHitMachineSet_(ss);
  const byGame = {};
  function bucket(pk) {
    const k = String(parseInt(pk, 10) || 0);
    if (!byGame[k]) byGame[k] = [];
    return byGame[k];
  }

  // 🚦 NRFI
  const nrfi = ss.getSheetByName(MLB_NRFI_CARD_TAB);
  if (nrfi && nrfi.getLastRow() >= 4) {
    nrfi.getRange(4, 1, nrfi.getLastRow() - 3, 20).getValues().forEach(function (r) {
      const p = mlbGameCardsNum_(r[11]); // p_nrfi
      if (!(p >= minNrfi)) return;
      bucket(r[0]).push({
        chip: '🚦 NRFI', who: 'NRFI', pick: 'Under 0.5 runs (1st inn)',
        p: p, odds: r[7], note: '', hm: false, team: '', ltot: mlbGameCardsNum_(r[10]),
      });
    });
  }

  // ⚾ Pitcher K — read the 🎰 card (UNANCHORED model p), not the anchored
  // sim. This is the view the operator actually uses for K, and it carries
  // more conviction (bigger market disagreements). Card cols: 3 pitcher,
  // 5 fd_k_line, 6 fd_over, 7 fd_under, 11 p_over, 12 p_under, 18 flags.
  const kcard = ss.getSheetByName(typeof MLB_PITCHER_K_CARD_TAB !== 'undefined' ? MLB_PITCHER_K_CARD_TAB : '🎰 Pitcher_K_Card');
  if (kcard && kcard.getLastRow() >= 4) {
    kcard.getRange(4, 1, kcard.getLastRow() - 3, 19).getValues().forEach(function (r) {
      const pitcher = String(r[3] || '').trim();
      if (!pitcher) return;
      if (String(r[18] || '').indexOf('injury') !== -1) return;
      const pO = mlbGameCardsNum_(r[11]);
      const pU = mlbGameCardsNum_(r[12]);
      const overBest = !(pU > pO);
      const p = overBest ? pO : pU;
      const line = r[5];
      const projK = mlbGameCardsNum_(r[9]);
      const team = String(r[4] || '').trim();
      if (p >= minK) {
        // Edge: we disagree with the book enough to pick a side.
        bucket(r[0]).push({
          chip: '⚾ K', who: pitcher, pick: (overBest ? 'Over ' : 'Under ') + line + ' K',
          p: p, odds: overBest ? r[6] : r[7], note: 'unanchored', hm: false,
          team: team, kproj: projK,
        });
        return;
      }
      // Agreement: model ≈ book on the K level → no main-line edge, but a
      // high-confidence LEVEL → flag for an alt X+ play (not an over/under).
      const lineN = mlbGameCardsNum_(line);
      const agreeBand = mlbGameCardsNum_(cfg['GS_K_AGREE_BAND']) || 0.5;
      const agreeMinProj = mlbGameCardsNum_(cfg['GS_K_AGREE_MIN_PROJ']) || 4;
      if (isFinite(projK) && isFinite(lineN) && Math.abs(projK - lineN) < agreeBand && projK >= agreeMinProj) {
        bucket(r[0]).push({
          chip: '⚾ K', who: pitcher, pick: '', p: null, odds: '', note: '', hm: false,
          team: team, kproj: projK, agree: true, kline: lineN,
        });
      }
    });
  }

  // 🥎 Batter hits v3 (proj_hits ≥ threshold, Over)
  const hv3 = ss.getSheetByName(typeof MLB_BATTER_HITS_V3_CARD_TAB !== 'undefined' ? MLB_BATTER_HITS_V3_CARD_TAB : '🧪 Batter_Hits_Card_v3-contact');
  if (hv3 && hv3.getLastRow() >= 4) {
    hv3.getRange(4, 1, hv3.getLastRow() - 3, 19).getValues().forEach(function (r) {
      const batter = String(r[2] || '').trim();
      if (!batter) return;
      if (String(r[17] || '').indexOf('injury') !== -1) return;
      const proj = mlbGameCardsNum_(r[7]); // proj_hits
      if (!(proj >= minProjH)) return;
      const onHm = !!hmSet[mlbNormalizePersonName_(batter)];
      bucket(r[0]).push({
        chip: '🥎 HIT', who: batter, pick: 'Over ' + r[4] + ' (proj ' + (Math.round(proj * 100) / 100) + ')',
        p: mlbGameCardsNum_(r[9]), odds: r[5], note: onHm ? '⭐ Hit Machine' : '', hm: onHm,
        team: String(r[3] || '').trim(), bid: parseInt(r[18], 10) || 0, // bat_team, batter_id
      });
    });
  }

  // HR is NOT a leg/section — it rides as an icon on the batter's HIT row.
  // The HR map (batterId → signal) is built in mlbGameCardsData_.
  return byGame;
}

/** batterId → HR-promo signal {rank, p, sznHR, sznPA, l14}. One tab read, cheap. */
function mlbGameCardsHrMap_(ss) {
  const map = {};
  const hr = ss.getSheetByName(typeof MLB_BATTER_HR_PROMO_TAB !== 'undefined' ? MLB_BATTER_HR_PROMO_TAB : '📣 Batter_HR_Promo');
  if (!hr || hr.getLastRow() < 4) return map;
  hr.getRange(4, 1, hr.getLastRow() - 3, 20).getValues().forEach(function (r) {
    const bid = parseInt(r[4], 10) || 0;
    if (!bid) return;
    const pc = mlbGameCardsNum_(r[8]); // p_calibrated
    const pp = mlbGameCardsNum_(r[7]); // p_poisson
    map[bid] = {
      rank: parseInt(r[0], 10) || 0, // HR-promo rank (1 = best)
      p: isFinite(pc) && pc > 0 ? pc : pp,
      sznHR: mlbGameCardsNum_(r[17]),
      sznPA: mlbGameCardsNum_(r[18]),
      l14: mlbGameCardsNum_(r[19]),
    };
  });
  return map;
}

/** Opposing probable {id,name} for a batter's team in a game (from schedule block). */
function mlbGameCardsOppSp_(block, gamePk, teamAbbr) {
  const want = typeof mlbCanonicalTeamAbbr_ === 'function' ? mlbCanonicalTeamAbbr_(teamAbbr) : String(teamAbbr || '');
  for (let i = 0; i < block.length; i++) {
    if (parseInt(block[i][0], 10) !== parseInt(gamePk, 10)) continue;
    const away = typeof mlbCanonicalTeamAbbr_ === 'function' ? mlbCanonicalTeamAbbr_(block[i][3]) : String(block[i][3] || '');
    const home = typeof mlbCanonicalTeamAbbr_ === 'function' ? mlbCanonicalTeamAbbr_(block[i][4]) : String(block[i][4] || '');
    if (want === away) return { id: parseInt(block[i][12], 10) || 0, name: String(block[i][7] || '').trim() };
    if (want === home) return { id: parseInt(block[i][11], 10) || 0, name: String(block[i][6] || '').trim() };
    return null;
  }
  return null;
}

function refreshMLBGameCards() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig();
  const byGame = mlbGameCardsCollect_(ss, cfg);

  // Game metadata: matchup + first pitch, from the schedule block + time index.
  const timeIdx = typeof mlbScheduleGameTimeIndex_ === 'function' ? mlbScheduleGameTimeIndex_(ss) : {};
  const block = typeof mlbGetScheduleBlock_ === 'function' ? mlbGetScheduleBlock_(ss) : [];
  const meta = {};
  block.forEach(function (r) {
    const pk = String(parseInt(r[0], 10) || 0);
    meta[pk] = {
      matchup: String(r[5] || '').trim(),
      away: String(r[3] || '').trim(),
      home: String(r[4] || '').trim(),
    };
  });

  const games = Object.keys(byGame).filter(function (pk) { return byGame[pk].length > 0; });
  games.sort(function (a, b) {
    const ia = (timeIdx[a] && timeIdx[a].iso) || '';
    const ib = (timeIdx[b] && timeIdx[b].iso) || '';
    if (ia && ib && ia !== ib) return ia < ib ? -1 : 1;
    if (ia && !ib) return -1;
    if (!ia && ib) return 1;
    return 0;
  });
  games.forEach(function (pk) {
    byGame[pk].sort(function (x, y) { return (mlbGameCardsNum_(y.p) || 0) - (mlbGameCardsNum_(x.p) || 0); });
  });

  mlbGameCardsRender_(ss, games, byGame, meta, timeIdx);
  // Publish the structured snapshot for the shared web app (read-only friends).
  try { mlbGameCardsPublishData_(ss); } catch (e) { Logger.log('publish: ' + (e.message || e)); }
}

// ============================================================
// 🔗 Shared Web App — read-only friends open a URL, no sheet access.
// doGet runs AS THE OWNER and serves a CACHED snapshot (refreshed each
// pipeline run / menu refresh), so many friends loading it never re-fetch
// BvP or burn statsapi/quota. Deploy: clasp deploy (manifest webapp =
// executeAs owner, access anyone). Share ScriptApp.getService().getUrl().
// ============================================================
var MLB_GC_CACHE_KEY = 'GC_DATA_V1';
var MLB_GC_SS_PROP = 'GC_SS_ID';
var MLB_GC_DATA_TAB = '🎴_GC_Data';

/** Build the structured data once and stash it (cache + durable cell). */
function mlbGameCardsPublishData_(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  const data = mlbGameCardsData_(ss, getConfig());
  const json = JSON.stringify(data);
  try { PropertiesService.getScriptProperties().setProperty(MLB_GC_SS_PROP, ss.getId()); } catch (e) {}
  // Durable store on a hidden helper tab (survives the 6h cache window).
  let sh = ss.getSheetByName(MLB_GC_DATA_TAB);
  if (!sh) { sh = ss.insertSheet(MLB_GC_DATA_TAB); try { sh.hideSheet(); } catch (e) {} }
  sh.getRange(1, 1).setValue(json);
  // Fast path: script cache (≤100KB), refreshed every window.
  try { if (json.length < 100000) CacheService.getScriptCache().put(MLB_GC_CACHE_KEY, json, 21600); } catch (e) {}
  return data.games ? data.games.length : 0;
}

/** Read the published snapshot JSON (cache → durable cell). '' if none. */
function mlbGameCardsPublishedJson_() {
  try { const c = CacheService.getScriptCache().get(MLB_GC_CACHE_KEY); if (c) return c; } catch (e) {}
  try {
    const id = PropertiesService.getScriptProperties().getProperty(MLB_GC_SS_PROP);
    if (id) {
      const sh = SpreadsheetApp.openById(id).getSheetByName(MLB_GC_DATA_TAB);
      if (sh) { const v = String(sh.getRange(1, 1).getValue() || ''); if (v) return v; }
    }
  } catch (e) {}
  return '';
}

/** Web app entry — serves the Game Cards UI from the published snapshot. */
function doGet(e) {
  const json = mlbGameCardsPublishedJson_() || '{"builtAt":"","games":[]}';
  const t = HtmlService.createTemplateFromFile('GameCardsApp');
  t.dataJson = json;
  return t.evaluate()
    .setTitle('MLB Game Cards')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Menu: toast + log the shareable web-app URL (null until deployed). */
function mlbShowGameCardsWebUrl_() {
  let url = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (e) {}
  const msg = url
    ? 'Shareable Game Cards link (read-only, no sign-in):\n' + url
    : 'Not deployed yet — Deploy ▸ New deployment ▸ Web app (or clasp deploy) first.';
  Logger.log(msg);
  try { SpreadsheetApp.getActiveSpreadsheet().toast(url || 'Web app not deployed yet', '🔗 Game Cards link', 15); } catch (e) {}
}

function mlbGameCardsRender_(ss, games, byGame, meta, timeIdx) {
  let sh = ss.getSheetByName(MLB_GAME_CARDS_TAB);
  if (sh) {
    sh.clear();
    sh.clearNotes();
  } else {
    sh = ss.insertSheet(MLB_GAME_CARDS_TAB);
  }
  sh.setTabColor('#00838f');
  sh.setHiddenGridlines(true);
  // Columns: A gutter · B chip · C who+pick · D conf · E odds · F note · G gutter
  const widths = [26, 92, 270, 78, 74, 150, 26];
  widths.forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  const tz = Session.getScriptTimeZone();
  const builtAt = Utilities.formatDate(new Date(), tz, 'EEE M/d · h:mm a');

  // Page background wash (B..F down a generous range).
  sh.getRange(1, 1, Math.max(60, 6 + games.length * 8), 7).setBackground('#eceff1')
    .setFontFamily('Inter');

  // Title.
  sh.getRange(1, 2, 1, 5).merge()
    .setValue('🎴 Game Cards — best angles per game · build SGPs for fun · ' + builtAt)
    .setFontSize(13).setFontWeight('bold').setFontColor('#ffffff').setBackground('#006064')
    .setVerticalAlignment('middle').setHorizontalAlignment('left');
  sh.setRowHeight(1, 38);
  sh.getRange(2, 2, 1, 5).merge()
    .setValue('🚦 NRFI p≥.60   ⚾ K p≥.60 (unanchored 🎰 card)   🥎 HIT proj≥1.00   ·   ⭐ gold = also on Hit Machine   ·   confidence amber→green   ·   NOT staking advice')
    .setFontSize(9).setFontColor('#37474f').setVerticalAlignment('middle');
  sh.setRowHeight(2, 22);

  let row = 4;
  if (!games.length) {
    sh.getRange(row, 2, 1, 5).merge()
      .setValue('No qualifying legs yet — run a pipeline window (NRFI / K sim / Hits v3 feed this board).')
      .setFontColor('#6b2b1f').setBackground('#fff8e1');
    sh.setFrozenRows(2);
    try { ss.toast('Game Cards: 0 games with qualifying legs', '🎴 Game Cards', 6); } catch (e) {}
    return;
  }

  games.forEach(function (pk) {
    const m = meta[pk] || {};
    const t = timeIdx[pk] || {};
    const teams = m.away && m.home ? m.away + ' @ ' + m.home : (m.matchup || 'Game ' + pk);
    const when = t.hhmm ? t.hhmm + ' ET' : 'TBD';

    // Card header band.
    sh.getRange(row, 2, 1, 5).merge()
      .setValue('  ' + when + '   ·   ' + teams + (m.matchup && m.away ? '   (' + m.matchup + ')' : ''))
      .setFontSize(11).setFontWeight('bold').setFontColor('#ffffff').setBackground('#263238')
      .setVerticalAlignment('middle');
    sh.setRowHeight(row, 28);
    row++;

    // Column sub-labels.
    sh.getRange(row, 2, 1, 5)
      .setValues([['type', 'pick', 'conf', 'odds', 'note']])
      .setFontSize(8).setFontColor('#78909c').setBackground('#ffffff').setFontWeight('bold');
    sh.setRowHeight(row, 16);
    row++;

    byGame[pk].forEach(function (leg) {
      const p = mlbGameCardsNum_(leg.p);
      const heat = mlbGameCardsHeat_(p);
      sh.getRange(row, 2, 1, 5).setBackground('#ffffff');
      sh.getRange(row, 2).setValue(leg.chip).setFontSize(10).setVerticalAlignment('middle');
      sh.getRange(row, 3).setValue(leg.who + '  —  ' + leg.pick).setFontSize(10).setVerticalAlignment('middle');
      sh.getRange(row, 4).setValue(isFinite(p) ? Math.round(p * 1000) / 10 + '%' : '')
        .setBackground(heat.bg).setFontColor(heat.fg).setFontWeight('bold')
        .setHorizontalAlignment('center').setVerticalAlignment('middle');
      sh.getRange(row, 5).setValue(leg.odds != null ? leg.odds : '')
        .setHorizontalAlignment('center').setVerticalAlignment('middle').setFontColor('#37474f');
      sh.getRange(row, 6).setValue(leg.note || '').setFontSize(9).setVerticalAlignment('middle');
      if (leg.hm) {
        sh.getRange(row, 3).setBorder(true, true, true, true, false, false, '#f9a825', SpreadsheetApp.BorderStyle.SOLID_THICK);
        sh.getRange(row, 6).setFontColor('#e65100').setFontWeight('bold');
      }
      sh.setRowHeight(row, 24);
      row++;
    });

    // Thin frame around the whole card (header + body) + spacer.
    row++; // spacer
  });

  sh.setFrozenRows(2);
  try {
    ss.toast(games.length + ' game(s) · ' +
      games.reduce(function (s, pk) { return s + byGame[pk].length; }, 0) + ' legs', '🎴 Game Cards', 8);
  } catch (e) {}
}

/**
 * Structured per-game data for the HTML web app (and reusable elsewhere).
 * Shares the same gates/collection as the sheet renderer (mlbGameCardsCollect_).
 * Returns { builtAt, games: [{ pk, teams, matchup, when, iso, legs: [...] }] }.
 */
function mlbGameCardsData_(ss, cfg) {
  const byGame = mlbGameCardsCollect_(ss, cfg);
  const timeIdx = typeof mlbScheduleGameTimeIndex_ === 'function' ? mlbScheduleGameTimeIndex_(ss) : {};
  const block = typeof mlbGetScheduleBlock_ === 'function' ? mlbGetScheduleBlock_(ss) : [];
  const meta = {};
  block.forEach(function (r) {
    const pk = String(parseInt(r[0], 10) || 0);
    meta[pk] = { matchup: String(r[5] || '').trim(), away: String(r[3] || '').trim(), home: String(r[4] || '').trim() };
  });
  const kindFromChip = function (chip) {
    if (chip.indexOf('NRFI') !== -1) return 'NRFI';
    if (chip.indexOf('K') !== -1) return 'K';
    return 'HIT';
  };
  // HR signal map (icon + blurb) and BvP context budget.
  const hrMap = mlbGameCardsHrMap_(ss);
  const hrTopN = parseInt(String(cfg['GS_HR_ICON_TOP_N'] != null ? cfg['GS_HR_ICON_TOP_N'] : '10'), 10) || 10;
  const bvpOn = String(cfg['GS_BVP_BLURB'] != null ? cfg['GS_BVP_BLURB'] : 'Y').toUpperCase() === 'Y';
  let bvpBudget = bvpOn ? (parseInt(String(cfg['GS_BVP_MAX_FETCH'] != null ? cfg['GS_BVP_MAX_FETCH'] : '40'), 10) || 40) : 0;
  const games = Object.keys(byGame).filter(function (pk) { return byGame[pk].length > 0; });
  games.sort(function (a, b) {
    const ia = (timeIdx[a] && timeIdx[a].iso) || '';
    const ib = (timeIdx[b] && timeIdx[b].iso) || '';
    if (ia && ib && ia !== ib) return ia < ib ? -1 : 1;
    if (ia && !ib) return -1;
    if (!ia && ib) return 1;
    return 0;
  });
  const wxOn = typeof mlbWeatherEnabled_ === 'function' ? mlbWeatherEnabled_(cfg) : true;
  const out = games.map(function (pk) {
    const m = meta[pk] || {};
    const t = timeIdx[pk] || {};
    const awayC = typeof mlbCanonicalTeamAbbr_ === 'function' ? mlbCanonicalTeamAbbr_(m.away) : String(m.away || '');
    const homeC = typeof mlbCanonicalTeamAbbr_ === 'function' ? mlbCanonicalTeamAbbr_(m.home) : String(m.home || '');
    const legs = byGame[pk].slice().map(function (leg) {
      const p = mlbGameCardsNum_(leg.p);
      const kind = kindFromChip(leg.chip);
      const teamAb = typeof mlbCanonicalTeamAbbr_ === 'function' ? mlbCanonicalTeamAbbr_(leg.team) : String(leg.team || '');
      // HR icon + context blurb — HIT legs only (batter rows).
      let hrFlag = false;
      let blurbParts = [];
      if (kind === 'HIT' && leg.bid) {
        const sig = hrMap[leg.bid];
        if (sig) {
          if (sig.rank > 0 && sig.rank <= hrTopN) hrFlag = true; // top-N of the HR tab
          if (isFinite(sig.sznHR)) {
            blurbParts.push(sig.sznHR + ' HR' + (isFinite(sig.l14) && sig.l14 > 0 ? ' (' + sig.l14 + ' L14)' : '') +
              (isFinite(sig.sznPA) ? ' / ' + sig.sznPA + ' PA' : ''));
          }
        }
        // BvP vs tonight's SP — expensive per-player fetch, capped + best-effort.
        if (bvpBudget > 0) {
          const opp = mlbGameCardsOppSp_(block, pk, teamAb);
          if (opp && opp.id && typeof mlbHmBvpCareer_ === 'function') {
            bvpBudget--;
            try {
              const bvp = mlbHmBvpCareer_(leg.bid, opp.id);
              if (bvp && bvp.pa >= 1) {
                const last = opp.name ? opp.name.split(/\s+/).pop() : 'SP';
                blurbParts.unshift('BvP ' + bvp.h + '-' + (bvp.ab || bvp.pa) +
                  (bvp.hr > 0 ? ', ' + bvp.hr + ' HR' : '') + ' vs ' + last);
              }
            } catch (e) {}
          }
        }
      } else if (kind === 'K' && leg.agree) {
        // Agreement → alt X+ ladder from the unanchored λ (proj_K). Highest
        // threshold still ≥ GS_K_AGREE_ALT_MIN_P is the "safe alt".
        const lam = mlbGameCardsNum_(leg.kproj);
        const altMinP = mlbGameCardsNum_(cfg['GS_K_AGREE_ALT_MIN_P']) || 0.70;
        const pAtLeast = function (k) {
          if (typeof mlbProbOverUnderK_ !== 'function') return NaN;
          const r2 = mlbProbOverUnderK_(k - 0.5, lam);
          return r2 && r2.pOver !== '' ? r2.pOver : NaN;
        };
        let safeAlt = null, safeP = null;
        for (let k = 1; k <= 12; k++) {
          const pk = pAtLeast(k);
          if (isFinite(pk) && pk >= altMinP) { safeAlt = k; safeP = pk; }
        }
        const lo = Math.max(1, Math.floor(lam) - 1);
        const ladder = [];
        for (let k = lo; k <= lo + 3; k++) {
          const pk = pAtLeast(k);
          if (isFinite(pk)) ladder.push(k + '+ ' + Math.round(pk * 100) + '%');
        }
        leg._agreeP = safeP != null ? Math.round(safeP * 1000) / 10 : null;
        leg._agreePick = '≈' + (Math.round(lam * 10) / 10) + ' K (agree)' +
          (safeAlt ? ' → ' + safeAlt + '+ alt' : '');
        blurbParts.push(ladder.join(' · '));
      } else if (kind === 'K' && isFinite(mlbGameCardsNum_(leg.kproj))) {
        blurbParts.push('proj ' + (Math.round(mlbGameCardsNum_(leg.kproj) * 10) / 10) + ' K');
      } else if (kind === 'NRFI' && isFinite(mlbGameCardsNum_(leg.ltot))) {
        blurbParts.push('λ ' + (Math.round(mlbGameCardsNum_(leg.ltot) * 100) / 100) + ' runs (1st)');
      }
      const isAgree = !!(kind === 'K' && leg.agree);
      return {
        kind: kind,
        who: String(leg.who || ''),
        pick: isAgree ? String(leg._agreePick || '') : String(leg.pick || ''),
        p: isAgree ? (leg._agreeP != null ? leg._agreeP : null) : (isFinite(p) ? Math.round(p * 1000) / 10 : null),
        odds: leg.odds != null && leg.odds !== '' ? String(leg.odds) : '',
        note: String(leg.note || ''),
        hm: !!leg.hm,
        hr: hrFlag,
        agree: isAgree,
        blurb: blurbParts.join(' · '),
        team: teamAb,
        side: teamAb && teamAb === awayC ? 0 : teamAb && teamAb === homeC ? 1 : 9,
      };
    });
    // By-game order: NRFI → K → H, away before home within K/H, conf desc.
    const segRank = { NRFI: 0, K: 1, HIT: 2 };
    legs.sort(function (a, b) {
      const sr = (segRank[a.kind] != null ? segRank[a.kind] : 3) - (segRank[b.kind] != null ? segRank[b.kind] : 3);
      if (sr) return sr;
      if (a.side !== b.side) return a.side - b.side;
      return (b.p || 0) - (a.p || 0);
    });
    // Weather at first pitch (home park) — best-effort, never throws.
    let wx = null;
    if (wxOn && m.home && t.iso && typeof mlbWeatherParkForAbbr_ === 'function' && typeof mlbWeatherFetchAtFirstPitch_ === 'function') {
      try {
        const park = mlbWeatherParkForAbbr_(m.home);
        const fp = new Date(t.iso);
        const w = park ? mlbWeatherFetchAtFirstPitch_(park, fp) : null;
        if (w && (isFinite(w.tempF) || isFinite(w.windMph))) {
          // Wind in/out: project wind onto the park's CF axis (same math the
          // HR multiplier uses). +out toward CF, −in from CF. ≥+2 mph = out
          // (green, helps offense), ≤−2 = in (red, suppresses), else cross.
          let dir = 'cross';
          let outMph = null;
          let arrowDeg = null;
          if (isFinite(w.windFromDeg) && isFinite(w.windMph) && park && park.cf != null) {
            const toward = (w.windFromDeg + 180) % 360;
            const diff = (((toward - park.cf) % 360) + 360) % 360;
            const align = Math.cos((diff * Math.PI) / 180);
            outMph = Math.round(w.windMph * align);
            dir = outMph >= 2 ? 'out' : outMph <= -2 ? 'in' : 'cross';
            // Arrow rotation on a field drawn CF-up: 0° = straight out to CF
            // (up), 180° = straight in to the plate (down), 90/270 = cross.
            arrowDeg = Math.round(diff);
          }
          wx = {
            tempF: isFinite(w.tempF) ? Math.round(w.tempF) : null,
            windMph: isFinite(w.windMph) ? Math.round(w.windMph) : null,
            windFromDeg: isFinite(w.windFromDeg) ? Math.round(w.windFromDeg) : null,
            dir: dir,
            outMph: outMph,
            arrowDeg: arrowDeg,
            dome: !!(park && (park.dome || park.roof === 'dome')),
          };
        }
      } catch (e) {}
    }
    return {
      pk: pk,
      away: typeof mlbCanonicalTeamAbbr_ === 'function' ? mlbCanonicalTeamAbbr_(m.away) : String(m.away || ''),
      home: typeof mlbCanonicalTeamAbbr_ === 'function' ? mlbCanonicalTeamAbbr_(m.home) : String(m.home || ''),
      teams: m.away && m.home ? m.away + ' @ ' + m.home : (m.matchup || 'Game ' + pk),
      matchup: m.matchup || '',
      when: t.hhmm ? t.hhmm + ' ET' : 'TBD',
      iso: t.iso || '',
      wx: wx,
      legs: legs,
    };
  });
  const builtAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'EEE M/d · h:mm a');
  return { builtAt: builtAt, games: out };
}

/** Open the dark "sportsbook" Game Cards web app in a modal dialog. */
function mlbOpenGameCardsApp_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const data = mlbGameCardsData_(ss, getConfig());
  const t = HtmlService.createTemplateFromFile('GameCardsApp');
  t.dataJson = JSON.stringify(data);
  const html = t.evaluate().setWidth(1040).setHeight(800);
  SpreadsheetApp.getUi().showModalDialog(html, '🎴 Game Cards');
}

function mlbActivateGameCardsTab_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(MLB_GAME_CARDS_TAB);
  if (sh) sh.activate();
  else ss.toast('Run a pipeline window or "🎴 Refresh Game Cards" first', 'MLB-BOIZ', 5);
}
