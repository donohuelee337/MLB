// ============================================================
// ✅ MLB FanDuel odds — The Odds API (baseball_mlb)
// ============================================================
// Philosophy: mirror AI-BOIZ FetchOddsToZebra — events for slate date,
// batched markets, one tab for raw lines.
// API: https://the-odds-api.com/liveapi/guides/v4/
// ============================================================

const MLB_ODDS_CONFIG = {
  sport: 'baseball_mlb',
  region: 'us',
  bookmaker: 'fanduel',
  tabName: '✅ FanDuel_MLB_Odds',
  tabColor: '#0d47a1',
  // Only markets consumed downstream (H, TB, K). FanDuel posts batter props on main and/or
  // _alternate keys; the queues merge both, so we fetch both.
  marketBatches: [
    [
      'batter_hits',
      'batter_hits_alternate',
      'batter_total_bases',
      'batter_total_bases_alternate',
      'pitcher_strikeouts',
    ],
  ],
};

function fetchMLBFanDuelOdds() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const apiKey = getOddsApiKey_();
  if (!apiKey) return;

  const cfg = getConfig();
  const slateDate = getSlateDateString_(cfg);
  const eventIds = getMLEventIdsForDate_(apiKey, slateDate);
  if (!eventIds || eventIds.length === 0) {
    safeAlert_('No MLB events', 'No games for ' + slateDate + ' from The Odds API.');
    return;
  }

  const region = (cfg['ODDS_REGION'] || MLB_ODDS_CONFIG.region || 'us').toString().trim();
  const book = (cfg['ODDS_BOOK'] || MLB_ODDS_CONFIG.bookmaker || 'fanduel').toString().trim();

  const allRows = [];
  eventIds.forEach(function (event) {
    MLB_ODDS_CONFIG.marketBatches.forEach(function (batch) {
      const batchRes = fetchMLEventMarkets_(apiKey, region, book, event.id, event.label, batch);
      batchRes.rows.forEach(function (r) { allRows.push(r); });
      Utilities.sleep(350);
      // If the whole batch was rejected (e.g. one bad market in the comma list), retry markets one at a time
      // so a single invalid market can't suppress the rest of the batch.
      if (batchRes.status >= 400 && batch.length > 1) {
        batch.forEach(function (mkt) {
          fetchMLEventMarkets_(apiKey, region, book, event.id, event.label, [mkt]).rows.forEach(function (r) {
            allRows.push(r);
          });
          Utilities.sleep(250);
        });
      }
    });
  });

  if (allRows.length === 0) {
    safeAlert_('No odds rows', 'FanDuel may not have posted MLB markets yet for this slate.');
    return;
  }

  buildMLBFanDuelOddsTab_(ss, allRows, slateDate);

  // Per-market row counts — scream early if a market we depend on came back empty.
  const counts = {};
  allRows.forEach(function (r) {
    const k = String(r[2] || '');
    counts[k] = (counts[k] || 0) + 1;
  });
  Logger.log('MLB odds market counts: ' + JSON.stringify(counts));
  const requiredFamilies = [
    { label: 'batter_hits',          keys: ['batter_hits', 'batter_hits_alternate'] },
    { label: 'batter_total_bases',   keys: ['batter_total_bases', 'batter_total_bases_alternate'] },
    { label: 'pitcher_strikeouts',   keys: ['pitcher_strikeouts'] },
  ];
  const missing = requiredFamilies.filter(function (m) {
    return m.keys.every(function (k) { return !counts[k]; });
  }).map(function (m) { return m.label; });
  if (missing.length) {
    safeAlert_(
      'MLB Odds — markets missing',
      'FanDuel returned 0 rows for: ' + missing.join(', ') +
      '. Downstream queues will be empty. See View → Executions in Apps Script for HTTP details.'
    );
  }

  ss.toast(eventIds.length + ' games · ' + allRows.length + ' lines · ' + slateDate, 'MLB Odds', 6);
}

/**
 * Events whose calendar commence date (script TZ) equals slateDate.
 */
function getMLEventIdsForDate_(apiKey, slateDate) {
  const url =
    'https://api.the-odds-api.com/v4/sports/' +
    MLB_ODDS_CONFIG.sport +
    '/events?apiKey=' +
    encodeURIComponent(apiKey) +
    '&dateFormat=iso';
  try {
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) {
      Logger.log('Odds API events HTTP ' + response.getResponseCode());
      return [];
    }
    const events = JSON.parse(response.getContentText());
    const tz = Session.getScriptTimeZone();
    return events
      .filter(function (e) {
        const gameDate = Utilities.formatDate(new Date(e.commence_time), tz, 'yyyy-MM-dd');
        return gameDate === slateDate;
      })
      .map(function (e) {
        return {
          id: e.id,
          label: (e.away_team || '') + ' @ ' + (e.home_team || ''),
          commenceTime: e.commence_time,
        };
      });
  } catch (err) {
    Logger.log('getMLEventIdsForDate_: ' + err.message);
    return [];
  }
}

function fetchMLEventMarkets_(apiKey, region, bookmaker, eventId, gameLabel, markets) {
  const marketsStr = markets.join(',');
  const url =
    'https://api.the-odds-api.com/v4/sports/' +
    MLB_ODDS_CONFIG.sport +
    '/events/' +
    encodeURIComponent(eventId) +
    '/odds?apiKey=' +
    encodeURIComponent(apiKey) +
    '&regions=' +
    encodeURIComponent(region) +
    '&markets=' +
    encodeURIComponent(marketsStr) +
    '&bookmakers=' +
    encodeURIComponent(bookmaker) +
    '&dateFormat=iso&oddsFormat=american';
  const rows = [];
  let status = 0;
  try {
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    status = response.getResponseCode();
    if (status !== 200) {
      Logger.log('fetchMLEventMarkets_ HTTP ' + status + ' for [' + marketsStr + '] on ' + gameLabel);
      return { rows: rows, status: status };
    }
    const data = JSON.parse(response.getContentText());
    if (!data.bookmakers || data.bookmakers.length === 0) return { rows: rows, status: status };
    const fdBook = data.bookmakers.find(function (b) {
      return b.key === bookmaker;
    });
    if (!fdBook) return { rows: rows, status: status };
    fdBook.markets.forEach(function (market) {
      market.outcomes.forEach(function (outcome) {
        rows.push([
          outcome.description || outcome.name || '',
          gameLabel,
          market.key,
          outcome.name,
          outcome.point !== undefined ? outcome.point : '',
          outcome.price,
          bookmaker,
          new Date(),
        ]);
      });
    });
  } catch (err) {
    Logger.log('fetchMLEventMarkets_: ' + err.message);
  }
  return { rows: rows, status: status };
}

function buildMLBFanDuelOddsTab_(ss, allRows, slateDate) {
  let sh = ss.getSheetByName(MLB_ODDS_CONFIG.tabName);
  if (sh) {
    sh.clearContents();
    sh.clearFormats();
  } else {
    sh = ss.insertSheet(MLB_ODDS_CONFIG.tabName);
  }
  sh.setTabColor(MLB_ODDS_CONFIG.tabColor);
  [220, 200, 220, 100, 80, 100, 100, 160].forEach(function (w, i) {
    sh.setColumnWidth(i + 1, w);
  });
  sh.getRange(1, 1, 1, 8)
    .merge()
    .setValue('✅ MLB FanDuel — The Odds API — slate ' + slateDate)
    .setFontSize(11)
    .setFontWeight('bold')
    .setBackground('#0d47a1')
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center');
  sh.setRowHeight(3, 28);
  sh.getRange(3, 1, 1, 8)
    .setValues([['Player / Team', 'Game', 'Market', 'Over/Under', 'Line', 'Price (US)', 'Book', 'Fetched At']])
    .setFontWeight('bold')
    .setBackground('#1565c0')
    .setFontColor('#ffffff');
  sh.setFrozenRows(3);
  if (allRows.length > 0) {
    sh.getRange(4, 1, allRows.length, 8).setValues(allRows);
    sh.getRange(4, 8, allRows.length, 1).setNumberFormat('h:mm am/pm');
    try {
      ss.setNamedRange('FD_MLB_ODDS', sh.getRange(4, 1, allRows.length, 8));
    } catch (e) {}
  }
}
