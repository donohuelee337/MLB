// ============================================================
// 🚑 MLB INJURY REPORT — ESPN API (AI-BOIZ pattern)
// ============================================================
// Same JSON shape as NBA injuries; tab + named range for downstream use.
// ============================================================

const MLB_INJURY_CONFIG = {
  tabName: '🚑 MLB_Injury_Report',
  tabColor: '#b71c1c',
  espnUrl: 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/injuries',
};

function fetchMLBInjuryReport() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.toast('Fetching MLB injuries…', 'MLB-BOIZ', 3);
  let data;
  try {
    const res = UrlFetchApp.fetch(MLB_INJURY_CONFIG.espnUrl, { muteHttpExceptions: true });
    const code = res.getResponseCode();
    if (code !== 200) {
      safeAlert_('MLB injuries failed', 'ESPN returned HTTP ' + code);
      return;
    }
    data = JSON.parse(res.getContentText());
  } catch (e) {
    safeAlert_('MLB injuries error', String(e.message));
    return;
  }

  const teamGroups = data.injuries || [];
  if (teamGroups.length === 0) {
    safeAlert_('MLB injuries empty', 'ESPN returned 0 injury groups.');
    return;
  }

  const injuries = [];
  teamGroups.forEach(function (teamObj) {
    const teamAbb = teamObj.injuries && teamObj.injuries[0] && teamObj.injuries[0].athlete && teamObj.injuries[0].athlete.team
      ? teamObj.injuries[0].athlete.team.abbreviation
      : '—';
    (teamObj.injuries || []).forEach(function (inj) {
      const athlete = inj.athlete || {};
      const rawStatus =
        typeof inj.status === 'string' ? inj.status : inj.type && inj.type.description ? inj.type.description : 'Unknown';
      const detail =
        inj.shortComment || inj.longComment || (inj.details && inj.details.type) || (inj.type && inj.type.description) || '—';
      injuries.push({
        player: athlete.displayName || athlete.shortName || '—',
        team: teamAbb,
        pos: athlete.position && athlete.position.abbreviation ? athlete.position.abbreviation : '—',
        status: normalizeInjuryStatusMLB_(rawStatus),
        detail: detail,
        date: inj.date ? inj.date.split('T')[0] : '—',
      });
    });
  });

  if (injuries.length === 0) {
    safeAlert_('MLB injuries empty', 'No player rows parsed from ESPN.');
    return;
  }

  const statusRank = { Out: 1, Doubtful: 2, Questionable: 3, 'Day-To-Day': 4 };
  injuries.sort(function (a, b) {
    const ra = statusRank[a.status] || 99;
    const rb = statusRank[b.status] || 99;
    return ra !== rb ? ra - rb : a.player.localeCompare(b.player);
  });

  buildMLBInjuryTab_(ss, injuries);
  Logger.log('MLB injuries: ' + injuries.length + ' players');
  ss.toast(injuries.length + ' players / ' + teamGroups.length + ' teams', 'MLB injuries', 6);
}

function normalizeInjuryStatusMLB_(raw) {
  const s = (raw || '').toLowerCase().trim();
  if (s === 'out') return 'Out';
  if (s === 'doubtful') return 'Doubtful';
  if (s === 'questionable' || s === 'probable') return 'Questionable';
  if (s.indexOf('day-to-day') !== -1 || s === 'dtd') return 'Day-To-Day';
  if (s.indexOf('day') !== -1) return 'Day-To-Day';
  if (s.indexOf('il') !== -1 && s.indexOf('60') !== -1) return 'Out';
  if (s.indexOf('il') !== -1) return 'Out';
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : 'Unknown';
}

function buildMLBInjuryTab_(ss, injuries) {
  let sh = ss.getSheetByName(MLB_INJURY_CONFIG.tabName);
  if (sh) {
    sh.clearContents();
    sh.clearFormats();
  } else {
    sh = ss.insertSheet(MLB_INJURY_CONFIG.tabName);
  }
  sh.setTabColor(MLB_INJURY_CONFIG.tabColor);
  [200, 60, 60, 260, 100, 100, 180].forEach(function (w, i) {
    sh.setColumnWidth(i + 1, w);
  });
  sh.getRange(1, 1, 1, 7)
    .merge()
    .setValue('🚑 MLB INJURY REPORT — ESPN')
    .setBackground('#1a1a2e')
    .setFontColor('#ff5252')
    .setFontWeight('bold')
    .setHorizontalAlignment('center');
  sh.getRange(3, 1, 1, 7)
    .setValues([['Player', 'Team', 'Pos', 'Injury / Reason', 'Status', 'Date', 'Flag']])
    .setFontWeight('bold')
    .setBackground('#37474f')
    .setFontColor('#ffffff');
  sh.setFrozenRows(3);
  const writeRows = injuries.map(function (inj) {
    const s = inj.status.toLowerCase();
    const flag =
      s === 'out'
        ? 'OUT'
        : s === 'doubtful'
          ? 'DOUBTFUL'
          : s === 'questionable'
            ? 'QUESTIONABLE'
            : s.indexOf('day') !== -1
              ? 'DTD'
              : inj.status;
    return [inj.player, inj.team, inj.pos, inj.detail, inj.status, inj.date, flag];
  });
  sh.getRange(4, 1, writeRows.length, 7).setValues(writeRows);
  try {
    ss.setNamedRange('INJURY_DATA_MLB', sh.getRange(4, 1, writeRows.length, 7));
  } catch (e) {}
}
