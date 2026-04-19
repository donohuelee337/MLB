// ============================================================
// 📡 Savant / ABS ingest — optional CSV → per-team λ (MLB-BOIZ)
// ============================================================
// When SAVANT_INGEST_ENABLED and SAVANT_ABS_CSV_URL are set, fetches CSV
// and fills __mlbSavantAbsTeamMult (teamId → multiplier). K card uses
// mlbGetAbsTeamLambdaMult_ before falling back to ⚙️ ABS_K_LAMBDA_MULT.
//
// CSV (simple comma-separated, no quoted commas in cells):
//   team_id,abs_k_mult
//   121,1.02
// or
//   abbr,factor
//   NYM,0.99
// ============================================================

/** @type {Object<string, number>} MLB team id string → ABS λ multiplier */
var __mlbSavantAbsTeamMult = {};

function mlbResetSavantAbsCache_() {
  __mlbSavantAbsTeamMult = {};
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

function mlbCsvSplitSimple_(line) {
  return String(line || '')
    .replace(/^\uFEFF/, '')
    .split(',')
    .map(function (c) {
      return String(c || '').trim();
    });
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

  const firstCells = mlbCsvSplitSimple_(lines[0]);
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
    const cells = mlbCsvSplitSimple_(lines[r]);
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
function mlbSavantAbsIngestBestEffort_() {
  if (!pipelineLog_) {
    return;
  }
  const cfg = getConfig() || {};
  const on = String(cfg['SAVANT_INGEST_ENABLED'] != null ? cfg['SAVANT_INGEST_ENABLED'] : '')
    .trim()
    .toLowerCase();
  if (on !== 'true' && on !== '1' && on !== 'yes') {
    return;
  }
  const url = String(cfg['SAVANT_ABS_CSV_URL'] != null ? cfg['SAVANT_ABS_CSV_URL'] : '').trim();
  if (!url) {
    addPipelineWarning_('Savant: SAVANT_INGEST_ENABLED is on but SAVANT_ABS_CSV_URL is empty.');
    return;
  }
  if (url.indexOf('http://') !== 0 && url.indexOf('https://') !== 0) {
    addPipelineWarning_('Savant: SAVANT_ABS_CSV_URL must start with http:// or https://');
    return;
  }
  try {
    const res = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      followRedirects: true,
    });
    const code = res.getResponseCode();
    if (code !== 200) {
      addPipelineWarning_('Savant ABS CSV: HTTP ' + code + ' for URL');
      return;
    }
    const text = res.getContentText() || '';
    if (text.length < 10) {
      addPipelineWarning_('Savant ABS CSV: body too short to be useful');
      return;
    }
    const parsed = mlbParseSavantAbsCsv_(text);
    if (parsed.count < 1) {
      addPipelineWarning_('Savant ABS CSV: parsed 0 teams (' + (parsed.warn || 'check columns') + ')');
      return;
    }
    if (parsed.warn) {
      addPipelineWarning_('Savant ABS CSV: loaded ' + parsed.count + ' teams — ' + parsed.warn);
    }
  } catch (e) {
    addPipelineWarning_('Savant ABS CSV fetch failed: ' + (e.message || e));
  }
}
