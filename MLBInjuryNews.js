// ============================================================
// 🚑 Health signals — soft-injury news + scratch detection for 🃏 picks
// ============================================================
// Confirmed lineups catch "not playing"; they CANNOT catch "playing hurt".
// This pass runs after the Bet Card builds and, for card players only:
//   1. SCRATCH: batter missing from a confirmed lineup, or a K-prop pitcher
//      no longer the scheduled probable → near-certain void/dead bet.
//   2. SOFT NEWS: Google News RSS sweep (team sites / blogs / beat writers
//      surface there) for injury-flavored headlines in the lookback window.
// SIGNAL ONLY — stakes are NOT auto-zeroed. The operator is the NLP layer:
// flagged rows get ambulance styling (red cell, white text, 🚑 in flags)
// and the headlines attached as a hover note on the player's name.
// Fetch budget: ≤ INJURY_NEWS_MAX_FETCH players, 250ms pacing, every fetch
// muted + try/caught — this step can never break or stall the pipeline.
// ============================================================

function mlbInjuryNewsTerms_() {
  return '(injury OR injured OR sore OR soreness OR tightness OR scratched OR "day to day" OR "day-to-day" OR resting OR "left the game" OR discomfort OR MRI)';
}

/** Google News RSS sweep for one player. Returns array of {title, source, age} (≤3). */
function mlbInjuryNewsForPlayer_(playerName, lookbackH) {
  const out = [];
  try {
    const q = '"' + playerName + '" ' + mlbInjuryNewsTerms_();
    const url =
      'https://news.google.com/rss/search?q=' + encodeURIComponent(q) + '&hl=en-US&gl=US&ceid=US:en';
    const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) return out;
    const root = XmlService.parse(resp.getContentText()).getRootElement();
    const channel = root.getChild('channel');
    if (!channel) return out;
    const items = channel.getChildren('item');
    const cutoffMs = Date.now() - (lookbackH > 0 ? lookbackH : 48) * 3600 * 1000;
    // Require the player's last name in the headline — the RSS search is
    // fuzzy and team-news roundups would otherwise flag everyone.
    const lastName = String(playerName).trim().split(/\s+/).pop().toLowerCase();
    for (let i = 0; i < items.length && out.length < 3; i++) {
      const title = String(items[i].getChildText('title') || '');
      if (title.toLowerCase().indexOf(lastName) === -1) continue;
      const pubMs = new Date(String(items[i].getChildText('pubDate') || '')).getTime();
      if (!isFinite(pubMs) || pubMs < cutoffMs) continue;
      const srcEl = items[i].getChild('source');
      const ageH = Math.round((Date.now() - pubMs) / 3600000);
      out.push({
        title: title,
        source: srcEl ? String(srcEl.getText() || '') : '',
        age: ageH + 'h ago',
      });
    }
  } catch (e) {
    Logger.log('mlbInjuryNewsForPlayer_(' + playerName + '): ' + (e.message || e));
  }
  return out;
}

/** True when this game's lineup is confirmed in tonight's cache (any entries). */
function mlbInjuryLineupConfirmed_(gamePk) {
  if (typeof __mlbLineupsCache === 'undefined' || __mlbLineupsCache === null) return false;
  const gameMap = __mlbLineupsCache[String(parseInt(gamePk, 10) || 0)];
  return !!gameMap && Object.keys(gameMap).length >= 9;
}

/** 'scratched?' reasons for one card row, [] when clean. */
function mlbInjuryScratchReasons_(ss, gamePk, playerId, market) {
  const reasons = [];
  const pid = parseInt(playerId, 10);
  if (!pid) return reasons;
  const m = String(market || '').toLowerCase();
  const isPitcher = m.indexOf('strikeout') !== -1 || m.indexOf('earned run') !== -1 || m.indexOf('outs') !== -1;
  if (isPitcher) {
    // Probable changed since the card was built → K/ER/Outs bet is dead.
    try {
      const block = typeof mlbGetScheduleBlock_ === 'function' ? mlbGetScheduleBlock_(ss) : [];
      for (let i = 0; i < block.length; i++) {
        if (parseInt(block[i][0], 10) !== parseInt(gamePk, 10)) continue;
        const aId = parseInt(block[i][11], 10);
        const hId = parseInt(block[i][12], 10);
        if ((aId || hId) && pid !== aId && pid !== hId) {
          reasons.push('no longer the scheduled probable');
        }
        break;
      }
    } catch (e) {}
  } else {
    // Batter absent from a CONFIRMED lineup → scratch / rest day.
    if (mlbInjuryLineupConfirmed_(gamePk)) {
      const slot = typeof mlbLineupSlotForBatter_ === 'function' ? mlbLineupSlotForBatter_(gamePk, pid) : null;
      if (slot == null) reasons.push('not in the confirmed lineup');
    }
  }
  return reasons;
}

/**
 * Main pass — flag 🃏 Bet Card rows with health signals. Pipeline step;
 * also runnable from the menu after late lineup posts.
 */
function mlbFlagBetCardHealthSignals_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig();
  if (String(cfg['INJURY_NEWS_ENABLED'] != null ? cfg['INJURY_NEWS_ENABLED'] : 'Y').toUpperCase() !== 'Y') return;
  const maxFetch = parseInt(String(cfg['INJURY_NEWS_MAX_FETCH'] != null ? cfg['INJURY_NEWS_MAX_FETCH'] : '15'), 10) || 15;
  const lookbackH = parseInt(String(cfg['INJURY_NEWS_LOOKBACK_H'] != null ? cfg['INJURY_NEWS_LOOKBACK_H'] : '48'), 10) || 48;

  const sh = ss.getSheetByName(MLB_BET_CARD_TAB);
  if (!sh || sh.getLastRow() < 4) return;
  const last = sh.getLastRow();
  const rows = sh.getRange(4, 1, last - 3, 19).getValues();

  let flagged = 0;
  let fetched = 0;
  const newsCache = {}; // player name → news[] (same player can have 2 rows)

  for (let i = 0; i < rows.length; i++) {
    const player = String(rows[i][5] || '').trim();
    if (!player) continue; // spacer row
    const gamePk = rows[i][2];
    const market = rows[i][6];
    const playerId = rows[i][17];

    const reasons = mlbInjuryScratchReasons_(ss, gamePk, playerId, market);

    let news = newsCache[player];
    if (news == null && fetched < maxFetch) {
      news = mlbInjuryNewsForPlayer_(player, lookbackH);
      newsCache[player] = news;
      fetched++;
      Utilities.sleep(250); // respectful pacing — never hammer the feed
    }
    news = news || [];

    if (!reasons.length && !news.length) continue;

    // 🚑 Ambulance treatment: red cell, white bold name, flags note.
    flagged++;
    const r = 4 + i;
    sh.getRange(r, 6).setBackground('#d32f2f').setFontColor('#ffffff').setFontWeight('bold');
    const noteLines = []
      .concat(reasons.map(function (x) { return '🚑 SCRATCH RISK: ' + x; }))
      .concat(news.map(function (n) { return '🚑 ' + n.age + ' · ' + (n.source ? n.source + ': ' : '') + n.title; }));
    sh.getRange(r, 6).setNote(noteLines.join('\n'));
    const flagsCell = sh.getRange(r, 17);
    const prevFlags = String(flagsCell.getValue() || '');
    const tag = reasons.length ? '🚑 scratch_risk' : '🚑 inj_news';
    if (prevFlags.indexOf('🚑') === -1) {
      flagsCell.setValue(prevFlags ? prevFlags + '; ' + tag : tag);
    }
  }

  if (flagged > 0) {
    try {
      ss.toast(
        '🚑 ' + flagged + ' card row(s) carry health signals — hover the red player cell for headlines. Your call, not auto-gated.',
        '🚑 Health signals',
        10
      );
    } catch (e) {}
    if (typeof addPipelineWarning_ === 'function') {
      addPipelineWarning_('🚑 ' + flagged + ' Bet Card row(s) flagged with scratch/injury-news signals (manual review)');
    }
  }
}
