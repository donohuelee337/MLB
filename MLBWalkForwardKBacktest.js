// ============================================================
// K walk-forward backtest — OOS replay from 🗄️ Pitcher_K_Logs
// ============================================================
// Depends: MLBPitcherKLogsDB.js, MLBPitcherKLambdaCore.js,
//          MLBPitcherKBetCard.js, MLBKProbCalibration.js,
//          MLBKWalkSegmentMiner.js, MLBKWalkDiscrepancy.js, Config.js
// ============================================================

const MLB_K_WF_REPORT_TAB = '🧪 K_WalkForward_Report';
const MLB_K_WF_TIMEOUT_MS = 240000;

function runKWalkForwardBacktest() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const db = ss.getSheetByName(MLB_PITCHER_K_LOGS_TAB);
  if (!db || db.getLastRow() < 100) {
    safeAlert_('K Walk-Forward', 'Run 🗄️ Build Pitcher K Logs first (need 100+ rows).');
    return;
  }
  const cfg = getConfig();
  const minPrior = parseInt(String(cfg['K_WF_MIN_PRIOR_STARTS'] || '8'), 10) || 8;
  ss.toast('Running K walk-forward…', 'MLB-BOIZ', 15);

  const lastRow = db.getLastRow();
  const numDataRows = lastRow - 1;
  const rows = db.getRange(2, 1, numDataRows, MLB_PITCHER_K_LOGS_NCOL).getValues();
  const byPitcher = {};
  rows.forEach(function (r) {
    const pid = String(r[2]);
    if (!byPitcher[pid]) byPitcher[pid] = [];
    const oppL14 = parseFloat(r[13]);
    const oppVs = parseFloat(r[12]);
    const oppSeason = parseFloat(r[11]);
    const oppK =
      !isNaN(oppL14) && oppL14 > 0
        ? oppL14
        : !isNaN(oppVs) && oppVs > 0
          ? oppVs
          : oppSeason;
    byPitcher[pid].push({
      // Normalized so the strictly-before-asOf filter and chronological sort
      // survive Date-coerced cells (lexicographic Date strings sort by weekday).
      date: mlbDateCellToYmd_(r[0]),
      gamePk: r[1],
      pitcherName: r[3],
      k: parseInt(r[5], 10),
      ip: parseFloat(r[6]),
      bf: parseFloat(r[7]),
      oppKVsHand: oppK,
      parkKMult: parseFloat(r[14]) || 1,
      homeAbbr: '',
      oppAbbr: r[8],
      throws: r[4],
    });
  });

  Object.keys(byPitcher).forEach(function (pid) {
    byPitcher[pid].sort(function (a, b) {
      return String(a.date).localeCompare(String(b.date));
    });
  });

  const gameSamples = [];
  const startMs = Date.now();
  const pitcherIds = Object.keys(byPitcher);
  let timedOut = false;

  for (let pi = 0; pi < pitcherIds.length; pi++) {
    if (Date.now() - startMs > MLB_K_WF_TIMEOUT_MS) {
      timedOut = true;
      break;
    }
    if (pi > 0 && pi % 25 === 0) {
      ss.toast('K walk-forward… ' + gameSamples.length + ' samples', 'MLB-BOIZ', 5);
    }
    const logs = byPitcher[pitcherIds[pi]];
    for (let g = minPrior; g < logs.length; g++) {
      if (Date.now() - startMs > MLB_K_WF_TIMEOUT_MS) {
        timedOut = true;
        break;
      }
      const cur = logs[g];
      const prior = logs.slice(0, g);
      const priorKs = prior.map(function (x) {
        return x.k;
      });
      const l3 = prior.slice(-3);
      gameSamples.push({
        priorKs: priorKs,
        prior: prior,
        l3: l3,
        k: cur.k,
        oppKVsHand: cur.oppKVsHand,
        parkKMult: cur.parkKMult || 1,
        date: cur.date,
        pitcherId: pitcherIds[pi],
        pitcherName: cur.pitcherName || '',
        oppAbbr: cur.oppAbbr || '',
        throws: cur.throws || '',
      });
    }
    if (timedOut) break;
  }

  if (!gameSamples.length) {
    safeAlert_('K Walk-Forward', 'No walk-forward samples produced. Check logs DB.');
    return;
  }

  const calSamples = [];
  const samples = [];
  gameSamples.forEach(function (g) {
    const sides = mlbWalkForwardBothSides_(g, cfg, null);
    if (!sides.length) return;
    sides.forEach(function (b) {
      calSamples.push({ side: b.side, pRaw: b.pRaw, hit: b.hit, date: g.date });
    });
    const best = sides[0].pRaw >= sides[1].pRaw ? sides[0] : sides[1];
    samples.push({
      side: best.side,
      pRaw: best.pRaw,
      hit: best.hit,
      line: best.line,
      actual: g.k,
      lambda: best.lambda,
      date: g.date,
    });
  });

  // Honest reporting: the per-band hit rates used to judge calibration are
  // computed on a HOLDOUT (newest 30% of sample dates) with a table fit only
  // on the older 70% — a table can't look well-calibrated on samples it was
  // fit to. The PERSISTED table (live path) is still fit on ALL samples:
  // more data makes the live table better; only the report must be split.
  const wfDates = {};
  gameSamples.forEach(function (g) {
    const d = String(g.date || '');
    if (d) wfDates[d] = true;
  });
  const wfDateList = Object.keys(wfDates).sort();
  const wfCanSplit = wfDateList.length >= 10;
  const wfCutoff = wfCanSplit ? wfDateList[Math.max(0, Math.floor(wfDateList.length * 0.7) - 1)] : '';
  const calTuneSamples = wfCanSplit
    ? calSamples.filter(function (s) { return String(s.date) <= wfCutoff; })
    : calSamples;
  const reportSamples = wfCanSplit
    ? samples.filter(function (s) { return String(s.date) > wfCutoff; })
    : samples;

  const calTable = mlbFitKCalibration_(calSamples);
  mlbWriteKCalibrationTab_(ss, calTable);

  const calTableTune = wfCanSplit ? mlbFitKCalibration_(calTuneSamples) : calTable;
  const report = mlbBuildKWalkForwardReport_(reportSamples, calTableTune, cfg);
  report.holdoutNote = wfCanSplit
    ? 'OUT-OF-SAMPLE: bands = slates after ' + wfCutoff + ' scored with a table fit on slates ≤ ' + wfCutoff
    : 'IN-SAMPLE (fewer than 10 distinct dates — no split)';
  mlbWriteKWalkForwardReport_(ss, report);
  const disc = mlbWriteKWalkDiscrepancyReport_(ss, gameSamples, calTable, cfg);
  const flaggedOnly = mlbFilterDiscrepancyGameSamples_(gameSamples, cfg, calTable);
  const mined = mlbWriteKWalkSegmentMiner_(ss, flaggedOnly.length ? flaggedOnly : gameSamples, calTable, cfg);
  const nCand = (mined.rows || []).filter(function (r) {
    return r[7] === 'Y';
  }).length;

  let projIpNote = '';
  if (typeof mlbBackfillPitcherKLogsProjIp_ === 'function') {
    const nIp = mlbBackfillPitcherKLogsProjIp_();
    projIpNote = ', proj_IP rows=' + nIp;
  }

  const msg =
    'K walk-forward done: n=' +
    samples.length +
    ', discrepancies=' +
    disc.nFlag +
    ', miner candidates=' +
    nCand +
    projIpNote +
    (flaggedOnly.length ? ' (miner on flagged only)' : '') +
    (timedOut ? ' (partial — 4 min timeout)' : '');
  ss.toast(msg, 'MLB-BOIZ', 8);
}

function mlbBuildKWalkForwardReport_(samples, calTable, cfg) {
  const segs = {};
  (samples || []).forEach(function (s) {
    const pCal = mlbApplyKCalibration_(s.pRaw, s.side, calTable);
    const band =
      s.side +
      '|' +
      (pCal >= 0.75 ? '75+' : pCal >= 0.68 ? '68-75' : pCal >= 0.62 ? '62-68' : '<62');
    if (!segs[band]) segs[band] = { n: 0, wins: 0, roiSum: 0 };
    segs[band].n++;
    segs[band].wins += s.hit;
    const american = mlbWalkForwardOddsProxy_(s.side, cfg);
    segs[band].roiSum += mlbWalkForwardRoiUnit_(s.hit, american);
  });
  return { segments: segs, n: (samples || []).length };
}

function mlbWriteKWalkForwardReport_(ss, report) {
  let sh = ss.getSheetByName(MLB_K_WF_REPORT_TAB);
  if (!sh) sh = ss.insertSheet(MLB_K_WF_REPORT_TAB);
  sh.clear();
  sh.getRange(1, 1)
    .setValue('🧪 K Walk-Forward Report — ' + new Date())
    .setFontWeight('bold');
  sh.getRange(3, 1, 1, 4)
    .setValues([['segment', 'n', 'hit_rate', 'roi_proxy']])
    .setFontWeight('bold');
  const segRows = [];
  Object.keys(report.segments)
    .sort()
    .forEach(function (k) {
      const s = report.segments[k];
      const hr = s.n ? Math.round((s.wins / s.n) * 1000) / 1000 : 0;
      const roi = s.n ? Math.round((s.roiSum / s.n) * 1000) / 1000 : 0;
      segRows.push([k, s.n, hr, roi]);
    });
  if (segRows.length) {
    sh.getRange(4, 1, segRows.length, 4).setValues(segRows);
  }
  let foot = 4 + segRows.length + 1;
  sh.getRange(foot++, 1).setValue('total_samples: ' + report.n);
  if (report.holdoutNote) {
    sh.getRange(foot++, 1).setValue(report.holdoutNote).setFontWeight('bold');
  }
  sh.getRange(foot++, 1).setValue(
    'Coarse = higher-raw-P side. See 🧪 K_Discrepancy_Report (model vs FD ladder) → 🧠 Claude deep dive on flag=Y.'
  );
  sh.setTabColor('#6a1b9a');
}

function mlbActivateKWalkForwardReportTab_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(MLB_K_WF_REPORT_TAB);
  if (sh) sh.activate();
  else ss.toast('Run K walk-forward backtest first', 'MLB-BOIZ', 5);
}
