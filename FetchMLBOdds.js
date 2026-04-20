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
  marketBatches: [
    // FanDuel often posts props on main and/or alternate keys — fetch both for joins.
    [
      'pitcher_strikeouts',
      'pitcher_strikeouts_alternate',
      'pitcher_walks',
      'pitcher_walks_alternate',
    ],
    ['pitcher_outs', 'pitcher_hits_allowed', 'pitcher_earned_runs', 'pitcher_record_a_win'],
    [
      'batter_hits',
      'batter_total_bases',
      'batter_home_runs',
      'batter_rbis',
      'batter_runs_scored',
      'batter_stolen_bases',
      'batter_walks',
      'batter_strikeouts',
      'batter_hits_runs_rbis',
    ],
    [
      'batter_singles',
      'batter_doubles',
      'batter_triples',
      'batter_first_home_run',
    ],
    [
      'pitcher_hits_allowed_alternate',
      'batter_total_bases_alternate',
      'batter_hits_alternate',
      'batter_home_runs_alternate',
      'batter_rbis_alternate',
      'batter_runs_scored_alternate',
      'batter_walks_alternate',
      'batter_strikeouts_alternate',
    ],
    ['h2h', 'spreads', 'totals', 'team_totals'],
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
      fetchMLEventMarkets_(apiKey, region, book, event.id, event.label, batch).forEach(function (r) {
        allRows.push(r);
      });
      Utilities.sleep(350);
    });
  });

  if (allRows.length === 0) {
    safeAlert_('No odds rows', 'FanDuel may not have posted MLB markets yet for this slate.');
    return;
  }

  buildMLBFanDuelOddsTab_(ss, allRows, slateDate);
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

/** Player label for prop row: Odds API usually puts O/U in name and player in description (but not always). */
function mlbOddsPlayerLabelFromOutcome_(outcome) {
  const nm = String((outcome && outcome.name) || '').trim();
  const desc = String((outcome && outcome.description) || '').trim();
  const low = nm.toLowerCase();
  if (low === 'over' || low === 'under' || low === 'yes' || low === 'no') {
    return desc || nm;
  }
  const dlow = desc.toLowerCase();
  if (dlow === 'over' || dlow === 'under') {
    return nm || desc;
  }
  return desc || nm;
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
  try {
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) return rows;
    const data = JSON.parse(response.getContentText());
    if (!data.bookmakers || data.bookmakers.length === 0) return rows;
    const fdBook = data.bookmakers.find(function (b) {
      return b.key === bookmaker;
    });
    if (!fdBook) return rows;
    fdBook.markets.forEach(function (market) {
      market.outcomes.forEach(function (outcome) {
        rows.push([
          mlbOddsPlayerLabelFromOutcome_(outcome),
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
  return rows;
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
