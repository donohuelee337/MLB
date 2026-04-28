// ============================================================
// 📡 Savant / ABS ingest — optional CSV → per-team λ (MLB-BOIZ)
// ============================================================
// When SAVANT_INGEST_ENABLED and SAVANT_ABS_CSV_URL are set, fetches CSV
// and fills __mlbSavantAbsTeamMult (teamId → multiplier). K card uses
// mlbGetAbsTeamLambdaMult_ before falling back to ⚙️ ABS_K_LAMBDA_MULT.
//
// CSV: comma-separated; cells may be quoted (RFC 4180–style) so commas inside
// a field are allowed. UTF-8 body expected (BOM stripped).
//   team_id,abs_k_mult
//   121,1.02
// or
//   abbr,factor
//   NYM,0.99
// ============================================================

/** @type {Object<string, number>} MLB team id string → ABS λ multiplier */
var __mlbSavantAbsTeamMult = {};

/** @type {Object<string, number>} MLB pitcher id string → per-pitcher ABS shadow K mult */
var __mlbSavantAbsPitcherMult = {};

function mlbResetSavantAbsCache_() {
  __mlbSavantAbsTeamMult = {};
  __mlbSavantAbsPitcherMult = {};
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

/**
 * @param {string} text raw CSV body
 * @returns {{ count: number, warn: string }}
 */
function mlbParseSavantAbsCsv_(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map(function (l) {
      return String(l || '').trim();
    })
    .filter(function (l) {
      return l && l.indexOf('#') !== 0;
    });
  if (!lines.length) {
    return { count: 0, warn: 'no non-empty lines' };
  }

  function colIdx(headNorm, names) {
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

  const firstCells = mlbCsvSplitRow_(lines[0]);
  const firstId = parseInt(firstCells[0], 10);
  const looksHeader = isNaN(firstId) || firstCells.length < 2;

  let iTeam = -1;
  let iAbbr = -1;
  let iMult = -1;
  let dataStart = 0;

  if (looksHeader) {
    const headNorm = firstCells.map(function (h) {
      return String(h || '')
        .toLowerCase()
        .replace(/\s+/g, '_');
    });
    iTeam = colIdx(headNorm, ['team_id', 'teamid', 'mlb_team_id', 'team']);
    iAbbr = colIdx(headNorm, ['abbr', 'team_abbr', 'abbreviation']);
    iMult = colIdx(headNorm, ['abs_k_mult', 'abs_k_lambda_mult', 'factor', 'mult', 'k_mult', 'lambda_mult']);
    if (iMult < 0) {
      return { count: 0, warn: 'header missing mult column (abs_k_mult | factor | mult)' };
    }
    if (iTeam < 0 && iAbbr < 0) {
      return { count: 0, warn: 'header needs team_id or abbr column' };
    }
    dataStart = 1;
  } else {
    iMult = 1;
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
      mult = parseFloat(iMult < cells.length ? cells[iMult] : '', 10);
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
  return { count: count, warn: warn };
}

/**
 * Optional fetch + parse of ABS team CSV. Requires pipelineLog_.
 */
/**
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
  const url = String(cfg['SAVANT_ABS_CSV_URL'] != null ? cfg['SAVANT_ABS_CSV_URL'] : '').trim();
  if (!url) {
    addPipelineWarning_('Savant: SAVANT_INGEST_ENABLED is on but SAVANT_ABS_CSV_URL is empty.');
    return 0;
  }
  if (url.indexOf('http://') !== 0 && url.indexOf('https://') !== 0) {
    addPipelineWarning_('Savant: SAVANT_ABS_CSV_URL must start with http:// or https://');
    return 0;
  }
  try {
    const res = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      followRedirects: true,
    });
    const code = res.getResponseCode();
    if (code !== 200) {
      addPipelineWarning_('Savant ABS CSV: HTTP ' + code + ' for URL');
      return 0;
    }
    const text = res.getContentText('UTF-8') || '';
    if (text.length < 10) {
      addPipelineWarning_('Savant ABS CSV: body too short to be useful');
      return 0;
    }
    const parsed = mlbParseSavantAbsCsv_(text);
    if (parsed.count < 1) {
      addPipelineWarning_('Savant ABS CSV: parsed 0 teams (' + (parsed.warn || 'check columns') + ')');
      return 0;
    }
    if (parsed.warn) {
      addPipelineWarning_('Savant ABS CSV: loaded ' + parsed.count + ' teams — ' + parsed.warn);
    }
    return parsed.count;
  } catch (e) {
    addPipelineWarning_('Savant ABS CSV fetch failed: ' + (e.message || e));
    return 0;
  }
}

// ── Per-pitcher ABS shadow multiplier ─────────────────────────────────────────
// CSV format: pitcher_id,abs_k_mult  (e.g. 592789,0.93)
// Represents how dependent a pitcher is on borderline/shadow-zone calls for Ks.
// < 1 = high shadow dependency → loses Ks to ABS challenges (suppress K lambda).
// Loaded when SAVANT_INGEST_ENABLED=true and SAVANT_PITCHER_ABS_CSV_URL is set.

function mlbGetAbsPitcherLambdaMult_(pitcherId) {
  const id = parseInt(pitcherId, 10);
  if (!id) return null;
  const k = String(id);
  if (!Object.prototype.hasOwnProperty.call(__mlbSavantAbsPitcherMult, k)) return null;
  const v = __mlbSavantAbsPitcherMult[k];
  return typeof v === 'number' && !isNaN(v) ? v : null;
}

function mlbParseSavantAbsPitcherCsv_(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map(function (l) { return String(l || '').trim(); })
    .filter(function (l) { return l && l.indexOf('#') !== 0; });
  if (!lines.length) return { count: 0, warn: 'no non-empty lines' };

  const firstCells = mlbCsvSplitRow_(lines[0]);
  const firstId = parseInt(firstCells[0], 10);
  const looksHeader = isNaN(firstId) || firstCells.length < 2;

  let iPid = 0;
  let iMult = 1;
  let dataStart = 0;

  if (looksHeader) {
    const headNorm = firstCells.map(function (h) {
      return String(h || '').toLowerCase().replace(/\s+/g, '_');
    });
    iPid = -1;
    iMult = -1;
    for (let i = 0; i < headNorm.length; i++) {
      if (['pitcher_id', 'player_id', 'mlbam_id', 'id'].indexOf(headNorm[i]) !== -1) iPid = i;
      if (['abs_k_mult', 'abs_shadow_mult', 'factor', 'mult', 'k_mult'].indexOf(headNorm[i]) !== -1) iMult = i;
    }
    if (iPid < 0) return { count: 0, warn: 'header missing pitcher_id column' };
    if (iMult < 0) return { count: 0, warn: 'header missing abs_k_mult column' };
    dataStart = 1;
  }

  let count = 0;
  let bad = 0;
  for (let r = dataStart; r < lines.length; r++) {
    const cells = mlbCsvSplitRow_(lines[r]);
    if (!cells.length || (cells.length === 1 && !cells[0])) continue;
    const pid = parseInt(cells[iPid] || '', 10);
    const mult = parseFloat(cells[iMult] || '');
    if (isNaN(pid) || pid <= 0 || isNaN(mult) || mult <= 0) { bad++; continue; }
    __mlbSavantAbsPitcherMult[String(pid)] = mult;
    count++;
  }

  return { count: count, warn: bad > 0 ? bad + ' row(s) skipped' : '' };
}

function mlbSavantAbsPitcherIngestBestEffort_() {
  if (!pipelineLog_) return -1;
  const cfg = getConfig() || {};
  const on = String(cfg['SAVANT_INGEST_ENABLED'] != null ? cfg['SAVANT_INGEST_ENABLED'] : '').trim().toLowerCase();
  if (on !== 'true' && on !== '1' && on !== 'yes') return -1;
  const url = String(cfg['SAVANT_PITCHER_ABS_CSV_URL'] != null ? cfg['SAVANT_PITCHER_ABS_CSV_URL'] : '').trim();
  if (!url) return -1;
  if (url.indexOf('http://') !== 0 && url.indexOf('https://') !== 0) {
    addPipelineWarning_('Savant pitcher ABS: SAVANT_PITCHER_ABS_CSV_URL must start with http:// or https://');
    return 0;
  }
  try {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
    const code = res.getResponseCode();
    if (code !== 200) {
      addPipelineWarning_('Savant pitcher ABS CSV: HTTP ' + code);
      return 0;
    }
    const text = res.getContentText('UTF-8') || '';
    if (text.length < 10) {
      addPipelineWarning_('Savant pitcher ABS CSV: body too short');
      return 0;
    }
    const parsed = mlbParseSavantAbsPitcherCsv_(text);
    if (parsed.count < 1) {
      addPipelineWarning_('Savant pitcher ABS CSV: parsed 0 pitchers (' + (parsed.warn || 'check columns') + ')');
      return 0;
    }
    if (parsed.warn) addPipelineWarning_('Savant pitcher ABS CSV: loaded ' + parsed.count + ' pitchers — ' + parsed.warn);
    return parsed.count;
  } catch (e) {
    addPipelineWarning_('Savant pitcher ABS CSV fetch failed: ' + (e.message || e));
    return 0;
  }
}
