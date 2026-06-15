// ============================================================
// 📡 Savant / ABS ingest — optional CSV → per-team λ (MLB-BOIZ)
// ============================================================
// When SAVANT_INGEST_ENABLED:
//   • SAVANT_ABS_CSV_URL — pre-built team_id,abs_k_mult OR Savant ABS
//     leaderboard export (auto-derives abs_k_mult from K-flip columns).
//   • SAVANT_TEAM_WHIFF_CSV_URL — team whiff% / K/PA for lineup fallback.
//
// K card: mlbGetAbsTeamLambdaMult_ → 🎰 λ; mlbGetSavantTeamWhiffKPa_ feeds
// mlbLineupWhiffAvgForGamePk_ when lineups are thin.
// ============================================================

/** @type {Object<string, number>} MLB team id string → ABS λ multiplier */
var __mlbSavantAbsTeamMult = {};

/** @type {Object<string, number>} MLB team id string → SO/PA (0..1) */
var __mlbSavantTeamWhiffKPa = {};

function mlbResetSavantAbsCache_() {
  mlbResetSavantCaches_();
}

function mlbResetSavantCaches_() {
  __mlbSavantAbsTeamMult = {};
  __mlbSavantTeamWhiffKPa = {};
}

/**
 * @param {*} teamId
 * @returns {number|null} multiplier or null if not loaded
 */
function mlbGetAbsTeamLambdaMult_(teamId) {
  const id = parseInt(teamId, 10);
  if (!id) {
    return null;
  }
  const k = String(id);
  if (!Object.prototype.hasOwnProperty.call(__mlbSavantAbsTeamMult, k)) {
    return null;
  }
  const v = __mlbSavantAbsTeamMult[k];
  return typeof v === 'number' && !isNaN(v) ? v : null;
}

/**
 * @param {*} teamId
 * @returns {number|null} SO/PA from Savant team CSV, or null
 */
function mlbGetSavantTeamWhiffKPa_(teamId) {
  const id = parseInt(teamId, 10);
  if (!id) {
    return null;
  }
  const k = String(id);
  if (!Object.prototype.hasOwnProperty.call(__mlbSavantTeamWhiffKPa, k)) {
    return null;
  }
  const v = __mlbSavantTeamWhiffKPa[k];
  return typeof v === 'number' && !isNaN(v) ? v : null;
}

/**
 * Split one CSV record; supports quoted fields and doubled-quote escapes.
 * @param {string} line
 * @returns {string[]}
 */
function mlbCsvSplitRow_(line) {
  const s = String(line || '').replace(/^\uFEFF/, '');
  const out = [];
  let cur = '';
  let i = 0;
  let inQuotes = false;
  while (i < s.length) {
    const c = s.charAt(i);
    if (inQuotes) {
      if (c === '"') {
        if (s.charAt(i + 1) === '"') {
          cur += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cur += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ',') {
      out.push(cur.trim());
      cur = '';
      i++;
      continue;
    }
    cur += c;
    i++;
  }
  out.push(cur.trim());
  return out;
}

function mlbSavantCsvLines_(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map(function (l) {
      return String(l || '').trim();
    })
    .filter(function (l) {
      return l && l.indexOf('#') !== 0;
    });
}

function mlbSavantColIdx_(headNorm, names) {
  for (let n = 0; n < names.length; n++) {
    const want = names[n];
    for (let i = 0; i < headNorm.length; i++) {
      if (headNorm[i] === want) {
        return i;
      }
    }
  }
  return -1;
}

function mlbSavantHeadNorm_(cells) {
  return cells.map(function (h) {
    return String(h || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  });
}

/** @param {string} cell */
function mlbSavantResolveTeamId_(cell) {
  const raw = String(cell || '').trim();
  if (!raw) {
    return NaN;
  }
  const asId = parseInt(raw, 10);
  if (!isNaN(asId) && asId > 0) {
    return asId;
  }
  let abbr = raw.toUpperCase();
  if (abbr.length > 4 && typeof mlbAbbrFromTeamName_ === 'function') {
    abbr = mlbAbbrFromTeamName_(raw) || abbr;
  }
  if (typeof mlbCanonicalTeamAbbr_ === 'function') {
    abbr = mlbCanonicalTeamAbbr_(abbr);
  }
  if (typeof mlbTeamIdFromAbbr_ === 'function') {
    return mlbTeamIdFromAbbr_(abbr);
  }
  return NaN;
}

/**
 * Map Savant ABS K-flip signal → λ multiplier (~±3% across league).
 * @param {number} kFlipPerGame
 * @param {number} leagueMean
 * @param {number} sens per extra K-flip/game vs mean
 */
function mlbDeriveAbsKMultFromKFlip_(kFlipPerGame, leagueMean, sens) {
  const kpg = parseFloat(kFlipPerGame, 10);
  const mean = parseFloat(leagueMean, 10);
  const s = sens > 0 ? sens : 0.012;
  if (isNaN(kpg) || isNaN(mean)) {
    return 1;
  }
  const bump = (kpg - mean) * s;
  return Math.round(Math.max(0.92, Math.min(1.08, 1 + bump)) * 1000) / 1000;
}

/**
 * @param {string} text raw CSV body
 * @returns {{ count: number, warn: string, mode: string }}
 */
function mlbParseSavantAbsCsv_(text) {
  const lines = mlbSavantCsvLines_(text);
  if (!lines.length) {
    return { count: 0, warn: 'no non-empty lines', mode: 'empty' };
  }

  const firstCells = mlbCsvSplitRow_(lines[0]);
  const firstId = parseInt(firstCells[0], 10);
  const looksHeader = isNaN(firstId) || firstCells.length < 2;
  const headNorm = looksHeader ? mlbSavantHeadNorm_(firstCells) : [];

  const iKFlip = looksHeader
    ? mlbSavantColIdx_(headNorm, [
        'k_minus',
        'k_flips',
        'k_flip',
        'minus_k',
        'k_flip_minus',
        'k_flips_minus',
      ])
    : -1;

  if (looksHeader && iKFlip >= 0) {
    return mlbParseSavantAbsLeaderboardCsv_(text);
  }

  function colIdx(names) {
    return mlbSavantColIdx_(headNorm, names);
  }

  let iTeam = -1;
  let iAbbr = -1;
  let iMultCol = -1;
  let dataStart = 0;

  if (looksHeader) {
    iTeam = colIdx(['team_id', 'teamid', 'mlb_team_id', 'team']);
    iAbbr = colIdx(['abbr', 'team_abbr', 'abbreviation']);
    iMultCol = colIdx(['abs_k_mult', 'abs_k_lambda_mult', 'factor', 'mult', 'k_mult', 'lambda_mult']);
    if (iMultCol < 0) {
      return { count: 0, warn: 'header missing mult column (abs_k_mult | factor | mult)', mode: 'mult' };
    }
    if (iTeam < 0 && iAbbr < 0) {
      return { count: 0, warn: 'header needs team_id or abbr column', mode: 'mult' };
    }
    dataStart = 1;
  } else {
    iMultCol = 1;
    iTeam = 0;
    dataStart = 0;
  }

  let count = 0;
  let bad = 0;

  for (let r = dataStart; r < lines.length; r++) {
    const cells = mlbCsvSplitRow_(lines[r]);
    if (!cells.length || (cells.length === 1 && !cells[0])) {
      continue;
    }
    let tid = NaN;
    let mult = NaN;

    if (looksHeader) {
      mult = parseFloat(iMultCol < cells.length ? cells[iMultCol] : '', 10);
      if (iTeam >= 0) {
        tid = parseInt(iTeam < cells.length ? cells[iTeam] : '', 10);
      } else {
        const ab = iAbbr < cells.length ? String(cells[iAbbr] || '').trim().toUpperCase() : '';
        tid = mlbTeamIdFromAbbr_(ab);
      }
    } else {
      if (cells.length < 2) {
        bad++;
        continue;
      }
      tid = parseInt(cells[0], 10);
      mult = parseFloat(cells[1], 10);
    }

    if (isNaN(tid) || tid <= 0 || isNaN(mult) || mult <= 0) {
      bad++;
      continue;
    }
    __mlbSavantAbsTeamMult[String(tid)] = mult;
    count++;
  }

  let warn = '';
  if (bad > 0) {
    warn = bad + ' row(s) skipped (bad id/mult)';
  }
  return { count: count, warn: warn, mode: 'mult' };
}

/**
 * Savant ABS challenge leaderboard export → per-team abs_k_mult.
 * @param {string} text
 * @returns {{ count: number, warn: string, mode: string }}
 */
function mlbParseSavantAbsLeaderboardCsv_(text) {
  const lines = mlbSavantCsvLines_(text);
  if (!lines.length) {
    return { count: 0, warn: 'no lines', mode: 'leaderboard' };
  }
  const head = mlbSavantHeadNorm_(mlbCsvSplitRow_(lines[0]));
  const iTeam = mlbSavantColIdx_(head, ['team_id', 'teamid', 'mlb_team_id']);
  const iTeamName = mlbSavantColIdx_(head, ['team', 'team_name', 'name', 'club']);
  const iAbbr = mlbSavantColIdx_(head, ['abbr', 'team_abbr', 'abbreviation']);
  const iKFlip = mlbSavantColIdx_(head, [
    'k_minus',
    'k_flips',
    'k_flip',
    'minus_k',
    'k_flip_minus',
    'k_flips_minus',
  ]);
  const iGames = mlbSavantColIdx_(head, ['games', 'g', 'team_games', 'game']);
  const iChallenges = mlbSavantColIdx_(head, ['challenges', 'total_challenges', 'challenge']);

  if (iKFlip < 0) {
    return { count: 0, warn: 'leaderboard CSV missing K-flip column', mode: 'leaderboard' };
  }
  if (iTeam < 0 && iTeamName < 0 && iAbbr < 0) {
    return { count: 0, warn: 'leaderboard CSV needs team_id, team name, or abbr', mode: 'leaderboard' };
  }

  const cfg = typeof getConfig === 'function' ? getConfig() || {} : {};
  const sens = parseFloat(
    String(cfg['SAVANT_ABS_K_FLIP_SENSITIVITY'] != null ? cfg['SAVANT_ABS_K_FLIP_SENSITIVITY'] : '0.012'),
    10
  );

  const rows = [];
  for (let r = 1; r < lines.length; r++) {
    const cells = mlbCsvSplitRow_(lines[r]);
    if (!cells.length) {
      continue;
    }
    let tid = NaN;
    if (iTeam >= 0) {
      tid = parseInt(cells[iTeam], 10);
    } else if (iAbbr >= 0) {
      tid = mlbTeamIdFromAbbr_(cells[iAbbr]);
    } else if (iTeamName >= 0) {
      tid = mlbSavantResolveTeamId_(cells[iTeamName]);
    }
    const kFlip = parseFloat(cells[iKFlip], 10);
    let games = iGames >= 0 ? parseFloat(cells[iGames], 10) : NaN;
    if (isNaN(games) || games <= 0) {
      games = iChallenges >= 0 ? parseFloat(cells[iChallenges], 10) / 4 : 50;
    }
    if (isNaN(tid) || tid <= 0 || isNaN(kFlip)) {
      continue;
    }
    const kpg = kFlip / Math.max(1, games);
    rows.push({ tid: tid, kpg: kpg });
  }

  if (!rows.length) {
    return { count: 0, warn: 'no parseable leaderboard rows', mode: 'leaderboard' };
  }

  let sum = 0;
  rows.forEach(function (row) {
    sum += row.kpg;
  });
  const mean = sum / rows.length;

  let count = 0;
  rows.forEach(function (row) {
    const mult = mlbDeriveAbsKMultFromKFlip_(row.kpg, mean, sens);
    __mlbSavantAbsTeamMult[String(row.tid)] = mult;
    count++;
  });

  return {
    count: count,
    warn: 'derived abs_k_mult from K-flip (mean ' + Math.round(mean * 1000) / 1000 + '/g)',
    mode: 'leaderboard',
  };
}

/**
 * Team whiff / K% CSV: team_id + whiff_pct (0–100) or k_pa / so_pa (0–1).
 * @param {string} text
 * @returns {{ count: number, warn: string }}
 */
function mlbParseSavantTeamWhiffCsv_(text) {
  const lines = mlbSavantCsvLines_(text);
  if (!lines.length) {
    return { count: 0, warn: 'no lines' };
  }
  const head = mlbSavantHeadNorm_(mlbCsvSplitRow_(lines[0]));
  const iTeam = mlbSavantColIdx_(head, ['team_id', 'teamid', 'mlb_team_id']);
  const iAbbr = mlbSavantColIdx_(head, ['abbr', 'team_abbr', 'abbreviation']);
  const iTeamName = mlbSavantColIdx_(head, ['team', 'team_name', 'name']);
  const iWhiff = mlbSavantColIdx_(head, [
    'whiff_pct',
    'whiff_percent',
    'whiff',
    'whiff_rate',
    'k_percent',
    'k_pct',
  ]);
  const iKPa = mlbSavantColIdx_(head, ['k_pa', 'so_pa', 'strikeout_rate', 'k_rate']);

  if (iWhiff < 0 && iKPa < 0) {
    return { count: 0, warn: 'whiff CSV needs whiff_pct or k_pa column' };
  }

  let count = 0;
  let bad = 0;
  for (let r = 1; r < lines.length; r++) {
    const cells = mlbCsvSplitRow_(lines[r]);
    let tid = NaN;
    if (iTeam >= 0) {
      tid = parseInt(cells[iTeam], 10);
    } else if (iAbbr >= 0) {
      tid = mlbTeamIdFromAbbr_(cells[iAbbr]);
    } else if (iTeamName >= 0) {
      tid = mlbSavantResolveTeamId_(cells[iTeamName]);
    }
    if (isNaN(tid) || tid <= 0) {
      bad++;
      continue;
    }
    let kpa = NaN;
    if (iKPa >= 0) {
      kpa = parseFloat(cells[iKPa], 10);
      if (!isNaN(kpa) && kpa > 1) {
        kpa = kpa / 100;
      }
    } else {
      const w = parseFloat(cells[iWhiff], 10);
      if (!isNaN(w)) {
        kpa = w > 1 ? w / 100 : w;
      }
    }
    if (isNaN(kpa) || kpa <= 0 || kpa > 0.5) {
      bad++;
      continue;
    }
    __mlbSavantTeamWhiffKPa[String(tid)] = Math.round(kpa * 10000) / 10000;
    count++;
  }
  let warn = bad > 0 ? bad + ' whiff row(s) skipped' : '';
  return { count: count, warn: warn };
}

/** Extract a Google Drive file ID from common URL forms (or '' if none). */
function mlbExtractDriveFileId_(url) {
  const s = String(url || '');
  const m = s.match(/\/file\/d\/([A-Za-z0-9_-]{20,})/) ||
            s.match(/[?&]id=([A-Za-z0-9_-]{20,})/) ||
            s.match(/\/d\/([A-Za-z0-9_-]{20,})/);
  return m ? m[1] : '';
}

function mlbSavantFetchCsvText_(url) {
  // Drive-hosted CSV (the Path B published files)? Read directly via DriveApp
  // by file ID. uc?export=download 302-redirects to a content host and
  // returns an HTML interstitial to UrlFetchApp for some files → 0 rows.
  // Reading the blob is bulletproof for files the script owner owns, and
  // independent of share settings. Falls back to UrlFetch on any failure.
  try {
    const driveId = mlbExtractDriveFileId_(url);
    if (driveId) {
      const t = DriveApp.getFileById(driveId).getBlob().getDataAsString('UTF-8') || '';
      if (t.length >= 10) return { ok: true, code: 200, text: t };
    }
  } catch (e) {
    Logger.log('mlbSavantFetchCsvText_: Drive read failed (' + (e.message || e) + ') — falling back to UrlFetch');
  }
  // Browser-like headers — Baseball Savant has no official API; its CSV
  // endpoints can refuse header-less automated (UrlFetchApp) requests. A
  // real User-Agent + Accept makes the scrape-style fetch look like a
  // browser download and is far less likely to be blocked.
  const res = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    followRedirects: true,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Accept': 'text/csv,text/plain,*/*',
    },
  });
  const code = res.getResponseCode();
  if (code !== 200) {
    return { ok: false, code: code, text: '' };
  }
  const text = res.getContentText('UTF-8') || '';
  if (text.length < 10) {
    return { ok: false, code: code, text: '' };
  }
  return { ok: true, code: code, text: text };
}

function mlbSavantIngestUrl_(url, label, parserFn) {
  const u = String(url || '').trim();
  if (!u) {
    return { count: 0, skipped: true };
  }
  if (u.indexOf('http://') !== 0 && u.indexOf('https://') !== 0) {
    addPipelineWarning_('Savant ' + label + ': URL must start with http:// or https://');
    return { count: 0, skipped: false };
  }
  try {
    const got = mlbSavantFetchCsvText_(u);
    if (!got.ok) {
      addPipelineWarning_('Savant ' + label + ': HTTP ' + got.code);
      return { count: 0, skipped: false };
    }
    const parsed = parserFn(got.text);
    if (parsed.count < 1) {
      addPipelineWarning_(
        'Savant ' + label + ': parsed 0 rows (' + (parsed.warn || 'check columns') + ')'
      );
      return { count: 0, skipped: false };
    }
    if (parsed.warn) {
      addPipelineWarning_('Savant ' + label + ': ' + parsed.count + ' teams — ' + parsed.warn);
    }
    return { count: parsed.count, skipped: false, mode: parsed.mode || '' };
  } catch (e) {
    addPipelineWarning_('Savant ' + label + ' fetch failed: ' + (e.message || e));
    return { count: 0, skipped: false };
  }
}

/**
 * Optional fetch + parse of ABS team CSV. Requires pipelineLog_.
 * @returns {number} teams loaded into __mlbSavantAbsTeamMult; -1 = skipped (off / no pipelineLog)
 */
function mlbSavantAbsIngestBestEffort_() {
  if (!pipelineLog_) {
    return -1;
  }
  const cfg = getConfig() || {};
  const on = String(cfg['SAVANT_INGEST_ENABLED'] != null ? cfg['SAVANT_INGEST_ENABLED'] : '')
    .trim()
    .toLowerCase();
  if (on !== 'true' && on !== '1' && on !== 'yes') {
    return -1;
  }

  const absUrl = String(cfg['SAVANT_ABS_CSV_URL'] != null ? cfg['SAVANT_ABS_CSV_URL'] : '').trim();
  const whiffUrl = String(
    cfg['SAVANT_TEAM_WHIFF_CSV_URL'] != null ? cfg['SAVANT_TEAM_WHIFF_CSV_URL'] : ''
  ).trim();

  if (!absUrl && !whiffUrl) {
    addPipelineWarning_(
      'Savant: SAVANT_INGEST_ENABLED is on but SAVANT_ABS_CSV_URL and SAVANT_TEAM_WHIFF_CSV_URL are empty.'
    );
    return 0;
  }

  let absCount = 0;
  if (absUrl) {
    const absRes = mlbSavantIngestUrl_(absUrl, 'ABS CSV', mlbParseSavantAbsCsv_);
    absCount = absRes.count || 0;
  }

  if (whiffUrl) {
    mlbSavantIngestUrl_(whiffUrl, 'team whiff CSV', mlbParseSavantTeamWhiffCsv_);
  }

  return absCount;
}

/**
 * Self-test: mult CSV + leaderboard derivation (no HTTP).
 * @returns {string}
 */
function mlbSavantIngestSelfTest_() {
  mlbResetSavantCaches_();
  const multCsv =
    'team_id,abs_k_mult\n121,1.02\n144,0.98\n';
  const m1 = mlbParseSavantAbsCsv_(multCsv);
  if (m1.count !== 2 || mlbGetAbsTeamLambdaMult_(121) !== 1.02) {
    throw new Error('mult CSV parse failed');
  }
  mlbResetSavantCaches_();
  const lbCsv =
    'team_name,team_id,k_minus,games\n' +
    'New York Mets,121,20,50\n' +
    'Atlanta Braves,144,10,50\n';
  const m2 = mlbParseSavantAbsLeaderboardCsv_(lbCsv);
  if (m2.count !== 2) {
    throw new Error('leaderboard parse failed count=' + m2.count);
  }
  const hi = mlbGetAbsTeamLambdaMult_(121);
  const lo = mlbGetAbsTeamLambdaMult_(144);
  if (!(hi > lo)) {
    throw new Error('leaderboard derive ordering failed hi=' + hi + ' lo=' + lo);
  }
  mlbResetSavantCaches_();
  const wCsv = 'abbr,whiff_pct\nNYM,24.5\nATL,22.0\n';
  const w1 = mlbParseSavantTeamWhiffCsv_(wCsv);
  if (w1.count !== 2) {
    throw new Error('whiff CSV parse failed');
  }
  const wNym = mlbGetSavantTeamWhiffKPa_(121);
  if (isNaN(wNym) || wNym < 0.2 || wNym > 0.3) {
    throw new Error('whiff value unexpected ' + wNym);
  }
  return 'OK mult=' + m1.count + ' lb=' + m2.count + ' whiff=' + w1.count;
}

function mlbSavantIngestSelfTestMenu_() {
  try {
    safeAlert_('Savant ingest self-test', mlbSavantIngestSelfTest_());
  } catch (e) {
    safeAlert_('Savant ingest self-test', String(e.message || e));
  }
}
