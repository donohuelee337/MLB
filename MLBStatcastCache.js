// ============================================================
// 📊 Statcast profile cache — Savant CSV / sheet tabs → lookups
// ============================================================
// Phase 1: season EV/LA/xBA profiles for pitchers + batters.
//   • Optional HTTPS CSV URLs (Savant custom leaderboard ?csv=true)
//   • Or manual paste into 📊 Savant_* tabs
//   • mlbStatcastGetPitcherProfile_ / mlbStatcastGetBatterProfile_
//
// Depends: MLBSavantIngest.js (CSV helpers), Config.js
// ============================================================

const MLB_STATCAST_META_TAB = '📊 Savant_Meta';
const MLB_STATCAST_PITCHER_TAB = '📊 Savant_Pitcher_Profile';
const MLB_STATCAST_BATTER_TAB = '📊 Savant_Batter_Profile';

/** @type {Object<string, Object>} player id string → profile */
var __mlbStatcastPitcherProfile = {};
/** @type {Object<string, Object>} player id string → profile */
var __mlbStatcastBatterProfile = {};
/** @type {{ updatedAt: string, season: number, status: string }|null} */
var __mlbStatcastMeta = null;
var __mlbStatcastSheetsLoaded = false;

const MLB_STATCAST_PITCHER_HEADERS = [
  'player_id',
  'name',
  'season',
  'ev_allowed',
  'la_allowed',
  'xba_allowed',
  'xwoba_allowed',
  'whiff_pct',
  'updated_at',
];

const MLB_STATCAST_BATTER_HEADERS = [
  'player_id',
  'name',
  'season',
  'ev_avg',
  'la_avg',
  'xba',
  'xwoba',
  'whiff_pct',
  'updated_at',
];

function mlbResetStatcastCaches_() {
  __mlbStatcastPitcherProfile = {};
  __mlbStatcastBatterProfile = {};
  __mlbStatcastMeta = null;
  __mlbStatcastSheetsLoaded = false;
}

function mlbStatcastIsEnabled_(cfg) {
  const c = cfg || (typeof getConfig === 'function' ? getConfig() : {}) || {};
  const on = String(c['STATCAST_ENABLED'] != null ? c['STATCAST_ENABLED'] : '')
    .trim()
    .toLowerCase();
  return on === 'true' || on === '1' || on === 'yes';
}

/**
 * @param {*} v
 * @returns {number|null}
 */
function mlbStatcastParseNum_(v) {
  if (v == null || v === '') return null;
  let s = String(v).trim();
  if (s.indexOf('.') === 0) s = '0' + s;
  const n = parseFloat(s, 10);
  return isNaN(n) ? null : n;
}

/**
 * @param {*} v
 * @returns {number|null}
 */
function mlbStatcastParseRate_(v) {
  const n = mlbStatcastParseNum_(v);
  if (n == null) return null;
  if (n > 1 && n <= 100) return Math.round((n / 100) * 10000) / 10000;
  return n;
}

/** @param {number|null} n @returns {number|string} */
function mlbStatcastFormatEvLa_(n) {
  if (n == null || isNaN(n)) return '';
  return Math.round(n * 10) / 10;
}

/** @param {number|null} n @returns {number|string} */
function mlbStatcastFormatRate_(n) {
  if (n == null || isNaN(n)) return '';
  return Math.round(n * 1000) / 1000;
}

/**
 * @param {number|string} playerId
 * @param {string} [role] pitcher | batter
 * @returns {string}
 */
function mlbStatcastSavantPlayerUrl_(playerId, role) {
  const id = parseInt(playerId, 10);
  if (!id) return '';
  return 'https://baseballsavant.mlb.com/savant-player/' + id;
}

/**
 * Parse Savant custom leaderboard / expected-stats CSV export.
 * @param {string} text
 * @param {string} role pitcher | batter
 * @returns {{ rows: Object[], warn: string }}
 */
function mlbParseStatcastProfileCsv_(text, role) {
  const lines = mlbSavantCsvLines_(text);
  if (!lines.length) {
    return { rows: [], warn: 'no non-empty lines' };
  }
  const head = mlbSavantHeadNorm_(mlbCsvSplitRow_(lines[0]));
  function col(names) {
    return mlbSavantColIdx_(head, names);
  }
  const iPid = col(['player_id', 'playerid', 'mlbam_id', 'key_mlbam']);
  const iSeason = col(['year', 'season']);
  const iEv = col(['exit_velocity_avg', 'exit_velocity', 'ev_avg', 'ev', 'avg_hit_speed']);
  const iLa = col(['launch_angle_avg', 'launch_angle', 'la_avg', 'la', 'avg_hit_angle']);
  const iXba = col(['xba', 'est_ba', 'estimated_ba', 'ba']);
  const iXwoba = col(['xwoba', 'est_woba', 'estimated_woba']);
  const iWhiff = col(['whiff_percent', 'whiff_pct', 'whiff']);
  const iFirst = col(['first_name', 'firstname']);
  const iLast = col(['last_name', 'lastname']);
  const iFull = col(['player_name', 'name']);

  if (iPid < 0) {
    return { rows: [], warn: 'CSV missing player_id column' };
  }

  const out = [];
  let bad = 0;
  for (let r = 1; r < lines.length; r++) {
    const cells = mlbCsvSplitRow_(lines[r]);
    if (!cells.length) continue;
    const pid = parseInt(cells[iPid], 10);
    if (isNaN(pid) || pid <= 0) {
      bad++;
      continue;
    }
    let name = '';
    if (iFull >= 0) {
      name = String(cells[iFull] || '').trim();
    } else if (iLast >= 0 || iFirst >= 0) {
      const ln = iLast >= 0 ? String(cells[iLast] || '').trim() : '';
      const fn = iFirst >= 0 ? String(cells[iFirst] || '').trim() : '';
      name = (fn + ' ' + ln).trim();
    }
    const season = iSeason >= 0 ? parseInt(cells[iSeason], 10) : NaN;
    const ev = mlbStatcastParseNum_(iEv >= 0 ? cells[iEv] : '');
    const la = mlbStatcastParseNum_(iLa >= 0 ? cells[iLa] : '');
    const xba = mlbStatcastParseRate_(iXba >= 0 ? cells[iXba] : '');
    const xwoba = mlbStatcastParseRate_(iXwoba >= 0 ? cells[iXwoba] : '');
    const whiff = mlbStatcastParseRate_(iWhiff >= 0 ? cells[iWhiff] : '');
    out.push({
      playerId: pid,
      name: name,
      season: !isNaN(season) ? season : '',
      role: role,
      ev: ev,
      la: la,
      xba: xba,
      xwoba: xwoba,
      whiffPct: whiff,
    });
  }
  let warn = '';
  if (bad > 0) warn = bad + ' row(s) skipped (bad player_id)';
  if (!out.length && !warn) warn = '0 profile rows parsed';
  return { rows: out, warn: warn };
}

/**
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @param {string} tabName
 * @param {string} title
 * @param {string[]} headers
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function mlbStatcastEnsureTab_(ss, tabName, title, headers) {
  let sh = ss.getSheetByName(tabName);
  if (!sh) sh = ss.insertSheet(tabName);
  sh.setTabColor('#1565c0');
  if (sh.getMaxColumns() < headers.length) {
    sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
  }
  sh.getRange(1, 1, 1, headers.length)
    .merge()
    .setValue(title)
    .setFontWeight('bold')
    .setBackground('#0d47a1')
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center')
    .setWrap(true);
  sh.setRowHeight(1, 28);
  sh.getRange(3, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight('bold')
    .setBackground('#1976d2')
    .setFontColor('#ffffff');
  sh.setFrozenRows(3);
  return sh;
}

/**
 * @param {Object} row profile row from parser
 * @param {string} updatedAt
 * @returns {Array}
 */
function mlbStatcastPitcherSheetRow_(row, updatedAt) {
  return [
    row.playerId,
    row.name || '',
    row.season || '',
    row.ev != null ? row.ev : '',
    row.la != null ? row.la : '',
    row.xba != null ? row.xba : '',
    row.xwoba != null ? row.xwoba : '',
    row.whiffPct != null ? row.whiffPct : '',
    updatedAt,
  ];
}

function mlbStatcastBatterSheetRow_(row, updatedAt) {
  return mlbStatcastPitcherSheetRow_(row, updatedAt);
}

/**
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @param {string} tabName
 * @param {string} title
 * @param {string[]} headers
 * @param {Object[]} profileRows
 * @param {function} rowFn
 */
function mlbStatcastWriteProfileTab_(ss, tabName, title, headers, profileRows, rowFn) {
  const sh = mlbStatcastEnsureTab_(ss, tabName, title, headers);
  const last = Math.max(sh.getLastRow(), 3);
  if (last > 3) {
    sh.getRange(4, 1, last - 3, headers.length).clearContent();
  }
  const updatedAt = Utilities.formatDate(new Date(), 'America/New_York', "yyyy-MM-dd'T'HH:mm:ss");
  if (!profileRows.length) return 0;
  const out = profileRows.map(function (row) {
    return rowFn(row, updatedAt);
  });
  sh.getRange(4, 1, out.length, headers.length).setValues(out);
  return out.length;
}

function mlbStatcastWriteMetaTab_(ss, season, pitcherCount, batterCount, status) {
  const headers = ['season', 'updated_at', 'pitcher_count', 'batter_count', 'status'];
  const sh = mlbStatcastEnsureTab_(
    ss,
    MLB_STATCAST_META_TAB,
    '📊 Statcast cache meta — freshness + row counts',
    headers
  );
  const updatedAt = Utilities.formatDate(new Date(), 'America/New_York', "yyyy-MM-dd'T'HH:mm:ss");
  sh.getRange(4, 1, 1, headers.length).setValues([
    [season, updatedAt, pitcherCount, batterCount, status || 'ok'],
  ]);
  __mlbStatcastMeta = {
    season: season,
    updatedAt: updatedAt,
    status: status || 'ok',
  };
}

/**
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @param {string} tabName
 * @param {string} role pitcher | batter
 */
function mlbStatcastLoadProfileTab_(ss, tabName, role) {
  const sh = ss.getSheetByName(tabName);
  if (!sh || sh.getLastRow() < 4) return 0;
  const headers = sh.getRange(3, 1, 1, sh.getLastColumn()).getValues()[0];
  const headNorm = mlbSavantHeadNorm_(headers);
  const iPid = mlbSavantColIdx_(headNorm, ['player_id', 'playerid']);
  const iName = mlbSavantColIdx_(headNorm, ['name', 'player_name']);
  const iSeason = mlbSavantColIdx_(headNorm, ['season', 'year']);
  const iEv = mlbSavantColIdx_(headNorm, ['ev_allowed', 'ev_avg', 'exit_velocity_avg']);
  const iLa = mlbSavantColIdx_(headNorm, ['la_allowed', 'la_avg', 'launch_angle_avg']);
  const iXba = mlbSavantColIdx_(headNorm, ['xba_allowed', 'xba', 'est_ba']);
  const iXwoba = mlbSavantColIdx_(headNorm, ['xwoba_allowed', 'xwoba', 'est_woba']);
  const iWhiff = mlbSavantColIdx_(headNorm, ['whiff_pct', 'whiff_percent']);
  if (iPid < 0) return 0;

  const nRows = sh.getLastRow() - 3;
  const block = sh.getRange(4, 1, nRows, sh.getLastColumn()).getValues();
  const dest = role === 'batter' ? __mlbStatcastBatterProfile : __mlbStatcastPitcherProfile;
  let count = 0;
  block.forEach(function (cells) {
    const pid = parseInt(cells[iPid], 10);
    if (isNaN(pid) || pid <= 0) return;
    dest[String(pid)] = {
      playerId: pid,
      name: iName >= 0 ? String(cells[iName] || '').trim() : '',
      season: iSeason >= 0 ? cells[iSeason] : '',
      role: role,
      ev: mlbStatcastParseNum_(iEv >= 0 ? cells[iEv] : ''),
      la: mlbStatcastParseNum_(iLa >= 0 ? cells[iLa] : ''),
      xba: mlbStatcastParseRate_(iXba >= 0 ? cells[iXba] : ''),
      xwoba: mlbStatcastParseRate_(iXwoba >= 0 ? cells[iXwoba] : ''),
      whiffPct: mlbStatcastParseRate_(iWhiff >= 0 ? cells[iWhiff] : ''),
    };
    count++;
  });
  return count;
}

/**
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @returns {{ pitchers: number, batters: number }}
 */
function mlbLoadStatcastCacheFromSheets_(ss) {
  __mlbStatcastPitcherProfile = {};
  __mlbStatcastBatterProfile = {};
  const p = mlbStatcastLoadProfileTab_(ss, MLB_STATCAST_PITCHER_TAB, 'pitcher');
  const b = mlbStatcastLoadProfileTab_(ss, MLB_STATCAST_BATTER_TAB, 'batter');
  __mlbStatcastSheetsLoaded = true;
  return { pitchers: p, batters: b };
}

/**
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 */
function mlbStatcastEnsureLoaded_(ss) {
  if (__mlbStatcastSheetsLoaded) return;
  const spreadsheet = ss || SpreadsheetApp.getActiveSpreadsheet();
  mlbLoadStatcastCacheFromSheets_(spreadsheet);
}

/**
 * @param {*} playerId
 * @returns {Object|null}
 */
function mlbStatcastGetPitcherProfile_(playerId) {
  const id = parseInt(playerId, 10);
  if (!id) return null;
  const p = __mlbStatcastPitcherProfile[String(id)];
  return p || null;
}

/**
 * @param {*} playerId
 * @returns {Object|null}
 */
function mlbStatcastGetBatterProfile_(playerId) {
  const id = parseInt(playerId, 10);
  if (!id) return null;
  const p = __mlbStatcastBatterProfile[String(id)];
  return p || null;
}

/**
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} [ss]
 * @returns {boolean}
 */
function mlbStatcastIsFresh_(ss) {
  const spreadsheet = ss || SpreadsheetApp.getActiveSpreadsheet();
  const sh = spreadsheet.getSheetByName(MLB_STATCAST_META_TAB);
  if (!sh || sh.getLastRow() < 4) return false;
  const cfg = typeof getConfig === 'function' ? getConfig() || {} : {};
  const maxH = parseFloat(
    String(cfg['STATCAST_MAX_AGE_HOURS'] != null ? cfg['STATCAST_MAX_AGE_HOURS'] : '168'),
    10
  );
  const maxMs = (!isNaN(maxH) && maxH > 0 ? maxH : 168) * 3600000;
  const updatedRaw = sh.getRange(4, 2).getValue();
  let updated = null;
  if (updatedRaw instanceof Date) {
    updated = updatedRaw.getTime();
  } else {
    const s = String(updatedRaw || '').trim();
    if (s) {
      try {
        updated = new Date(s).getTime();
      } catch (e) {
        updated = NaN;
      }
    }
  }
  if (!updated || isNaN(updated)) return false;
  return Date.now() - updated <= maxMs;
}

function mlbStatcastIngestUrlToTab_(url, label, role, ss, tabName, title, headers, rowFn) {
  const u = String(url || '').trim();
  if (!u) return { count: 0, skipped: true };
  if (u.indexOf('http://') !== 0 && u.indexOf('https://') !== 0) {
    if (typeof addPipelineWarning_ === 'function') {
      addPipelineWarning_('Statcast ' + label + ': URL must start with http:// or https://');
    }
    return { count: 0, skipped: false };
  }
  try {
    const got = mlbSavantFetchCsvText_(u);
    if (!got.ok) {
      if (typeof addPipelineWarning_ === 'function') {
        addPipelineWarning_('Statcast ' + label + ': HTTP ' + got.code);
      }
      return { count: 0, skipped: false };
    }
    const parsed = mlbParseStatcastProfileCsv_(got.text, role);
    if (!parsed.rows.length) {
      if (typeof addPipelineWarning_ === 'function') {
        addPipelineWarning_(
          'Statcast ' + label + ': 0 rows (' + (parsed.warn || 'check CSV columns') + ')'
        );
      }
      return { count: 0, skipped: false };
    }
    if (parsed.warn && typeof addPipelineWarning_ === 'function') {
      addPipelineWarning_('Statcast ' + label + ': ' + parsed.warn);
    }
    const count = mlbStatcastWriteProfileTab_(ss, tabName, title, headers, parsed.rows, rowFn);
    return { count: count, skipped: false };
  } catch (e) {
    if (typeof addPipelineWarning_ === 'function') {
      addPipelineWarning_('Statcast ' + label + ' fetch failed: ' + (e.message || e));
    }
    return { count: 0, skipped: false };
  }
}

/**
 * Fetch optional CSV URLs, write profile tabs, reload in-memory cache.
 * @returns {{ pitchers: number, batters: number, skipped: boolean }}
 */
function mlbStatcastIngestProfilesBestEffort_(force) {
  // The pipelineLog_ guard skips this during non-window executions so a
  // stray call can't fire mid-edit. The one-time menu setup passes
  // force=true to ingest on demand (menu runs have no pipelineLog_).
  if (!force && !pipelineLog_) {
    return { pitchers: 0, batters: 0, skipped: true };
  }
  const cfg = getConfig() || {};
  if (!mlbStatcastIsEnabled_(cfg)) {
    return { pitchers: 0, batters: 0, skipped: true };
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const season =
    typeof mlbSlateSeasonYear_ === 'function' ? mlbSlateSeasonYear_(cfg) : new Date().getFullYear();
  const pitcherUrl = String(
    cfg['STATCAST_PITCHER_PROFILE_CSV_URL'] != null ? cfg['STATCAST_PITCHER_PROFILE_CSV_URL'] : ''
  ).trim();
  const batterUrl = String(
    cfg['STATCAST_BATTER_PROFILE_CSV_URL'] != null ? cfg['STATCAST_BATTER_PROFILE_CSV_URL'] : ''
  ).trim();

  let pCount = 0;
  let bCount = 0;

  if (pitcherUrl) {
    const pr = mlbStatcastIngestUrlToTab_(
      pitcherUrl,
      'pitcher profile CSV',
      'pitcher',
      ss,
      MLB_STATCAST_PITCHER_TAB,
      '📊 Savant pitcher profiles — contact allowed (EV/LA/xBA)',
      MLB_STATCAST_PITCHER_HEADERS,
      mlbStatcastPitcherSheetRow_
    );
    pCount = pr.count || 0;
  }

  if (batterUrl) {
    const br = mlbStatcastIngestUrlToTab_(
      batterUrl,
      'batter profile CSV',
      'batter',
      ss,
      MLB_STATCAST_BATTER_TAB,
      '📊 Savant batter profiles — contact quality (EV/LA/xBA)',
      MLB_STATCAST_BATTER_HEADERS,
      mlbStatcastBatterSheetRow_
    );
    bCount = br.count || 0;
  }

  const loaded = mlbLoadStatcastCacheFromSheets_(ss);
  pCount = loaded.pitchers;
  bCount = loaded.batters;

  const status = pCount + bCount > 0 ? 'ok' : 'empty';
  mlbStatcastWriteMetaTab_(ss, season, pCount, bCount, status);

  if (pCount + bCount < 1 && typeof addPipelineWarning_ === 'function') {
    addPipelineWarning_(
      'Statcast: no profile rows — set STATCAST_*_PROFILE_CSV_URL or paste CSV into 📊 Savant_* tabs.'
    );
  }

  return { pitchers: pCount, batters: bCount, skipped: false };
}

/**
 * Self-test: CSV parse + sheet round-trip (no HTTP).
 * @returns {string}
 */
function mlbStatcastCacheSelfTest_() {
  mlbResetStatcastCaches_();
  const csv =
    '"last_name, first_name","player_id","year","exit_velocity_avg","launch_angle_avg","xba"\n' +
    '"Test, Pitcher",694297,2025,"90.3","14.8",".271"\n';
  const parsed = mlbParseStatcastProfileCsv_(csv, 'pitcher');
  if (parsed.rows.length !== 1 || parsed.rows[0].playerId !== 694297) {
    throw new Error('profile CSV parse failed');
  }
  if (parsed.rows[0].ev !== 90.3 || parsed.rows[0].xba == null) {
    throw new Error('profile field parse failed ev/xba');
  }
  const prof = mlbStatcastGetPitcherProfile_(694297);
  if (prof) {
    throw new Error('cache should be empty before load');
  }
  __mlbStatcastPitcherProfile[String(694297)] = parsed.rows[0];
  const got = mlbStatcastGetPitcherProfile_(694297);
  if (!got || got.ev !== 90.3) {
    throw new Error('cache lookup failed');
  }
  return 'OK parse=1 ev=' + got.ev + ' xba=' + got.xba;
}

function mlbStatcastCacheSelfTestMenu_() {
  try {
    safeAlert_('Statcast cache self-test', mlbStatcastCacheSelfTest_());
  } catch (e) {
    safeAlert_('Statcast cache self-test', String(e.message || e));
  }
}
