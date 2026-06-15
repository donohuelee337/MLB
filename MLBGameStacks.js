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
        chip: '🚦 NRFI', who: 'NRFI — 1st inning', pick: 'Under 0.5 runs',
        p: p, odds: r[7], note: '', hm: false,
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
      if (!(p >= minK)) return;
      const line = r[5];
      bucket(r[0]).push({
        chip: '⚾ K', who: pitcher, pick: (overBest ? 'Over ' : 'Under ') + line + ' K',
        p: p, odds: overBest ? r[6] : r[7], note: 'unanchored', hm: false,
      });
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
      });
    });
  }

  return byGame;
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
  const games = Object.keys(byGame).filter(function (pk) { return byGame[pk].length > 0; });
  games.sort(function (a, b) {
    const ia = (timeIdx[a] && timeIdx[a].iso) || '';
    const ib = (timeIdx[b] && timeIdx[b].iso) || '';
    if (ia && ib && ia !== ib) return ia < ib ? -1 : 1;
    if (ia && !ib) return -1;
    if (!ia && ib) return 1;
    return 0;
  });
  const out = games.map(function (pk) {
    const m = meta[pk] || {};
    const t = timeIdx[pk] || {};
    const legs = byGame[pk].slice().sort(function (x, y) {
      return (mlbGameCardsNum_(y.p) || 0) - (mlbGameCardsNum_(x.p) || 0);
    }).map(function (leg) {
      const p = mlbGameCardsNum_(leg.p);
      return {
        kind: kindFromChip(leg.chip),
        who: String(leg.who || ''),
        pick: String(leg.pick || ''),
        p: isFinite(p) ? Math.round(p * 1000) / 10 : null,
        odds: leg.odds != null && leg.odds !== '' ? String(leg.odds) : '',
        note: String(leg.note || ''),
        hm: !!leg.hm,
      };
    });
    return {
      pk: pk,
      teams: m.away && m.home ? m.away + ' @ ' + m.home : (m.matchup || 'Game ' + pk),
      matchup: m.matchup || '',
      when: t.hhmm ? t.hhmm + ' ET' : 'TBD',
      iso: t.iso || '',
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
  const html = t.evaluate().setWidth(940).setHeight(780);
  SpreadsheetApp.getUi().showModalDialog(html, '🎴 Game Cards');
}

function mlbActivateGameCardsTab_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(MLB_GAME_CARDS_TAB);
  if (sh) sh.activate();
  else ss.toast('Run a pipeline window or "🎴 Refresh Game Cards" first', 'MLB-BOIZ', 5);
}
