// ============================================================
// 🧪 K Segment Miner — find OOS +EV pockets in walk-forward data
// ============================================================
// Evaluates Over and Under *separately* at realistic juice (not
// "pick higher raw P" only). Run after runKWalkForwardBacktest().
// ============================================================

const MLB_K_WF_SEGMENTS_TAB = '🧪 K_Segment_Miner';

function mlbWalkForwardOddsProxy_(side, cfg) {
  const overRaw = String(cfg['K_WF_OVER_ODDS_PROXY'] != null ? cfg['K_WF_OVER_ODDS_PROXY'] : '-115');
  const underRaw = String(cfg['K_WF_UNDER_ODDS_PROXY'] != null ? cfg['K_WF_UNDER_ODDS_PROXY'] : '105');
  if (side === 'Under') return parseFloat(underRaw, 10) || 105;
  return parseFloat(overRaw, 10) || -115;
}

function mlbWalkForwardRoiUnit_(hit, american) {
  const o = parseFloat(american, 10);
  if (!hit || isNaN(o)) return -1;
  if (o > 0) return o / 100;
  return 100 / Math.abs(o);
}

function mlbWalkForwardBandLabel_(value, cuts, labels) {
  for (let i = 0; i < cuts.length; i++) {
    if (value >= cuts[i].lo && value < cuts[i].hi) return labels[i];
  }
  return 'other';
}

/**
 * One walk-forward start → two side-records (Over bet + Under bet).
 */
function mlbWalkForwardBothSides_(cur, cfg, calTable) {
  const priorKs = cur.priorKs;
  const l3 = cur.l3;
  const l3k = l3.reduce(function (a, x) {
    return a + (x.k || 0);
  }, 0);
  const l3ip = l3.reduce(function (a, x) {
    return a + (x.ip || 0);
  }, 0);
  const k9est = l3ip > 0 ? (l3k / l3ip) * 9 : 8.2;
  const built = mlbBuildPitcherKLambda_({
    cfg: cfg,
    k9raw: k9est,
    l3k: l3k,
    l3ip: l3ip,
    gamesRaw: cur.prior.length,
    homeAbbr: '',
    oppKVsHand: cur.oppKVsHand,
    lineupWhiff: NaN,
  });
  let lambda = built.lambda;
  if (!isNaN(built.lambdaPitcher) && built.lambdaPitcher > 0) {
    lambda =
      Math.round(built.lambdaPitcher * built.mMatchup * (cur.parkKMult || 1) * 100) / 100;
  }
  const line = mlbProxyKLineFromPriorStarts_(priorKs);
  const probs = mlbProbOverUnderK_(line, lambda);
  const pOver = parseFloat(probs.pOver);
  const pUnder = parseFloat(probs.pUnder);
  if (isNaN(pOver) || isNaN(pUnder)) return [];

  const leagueK =
    parseFloat(String(cfg['LEAGUE_HITTING_K_PA'] != null ? cfg['LEAGUE_HITTING_K_PA'] : '0.225')) || 0.225;
  const edge = lambda - line;
  const oppHigh = !isNaN(cur.oppKVsHand) && cur.oppKVsHand > leagueK * 1.02;
  const oppLow = !isNaN(cur.oppKVsHand) && cur.oppKVsHand < leagueK * 0.98;

  const out = [];
  ['Over', 'Under'].forEach(function (side) {
    const pRaw = side === 'Over' ? pOver : pUnder;
    const pCal = mlbApplyKCalibration_(pRaw, side, calTable);
    const american = mlbWalkForwardOddsProxy_(side, cfg);
    const hit = mlbGradeKSide_(cur.k, line, side) === 'WIN' ? 1 : 0;
    const ev = parseFloat(String(mlbEvPerDollarRisked_(pCal, american)), 10);
    out.push({
      side: side,
      pRaw: pRaw,
      pCal: pCal,
      line: line,
      edge: edge,
      hit: hit,
      american: american,
      ev: isNaN(ev) ? 0 : ev,
      lambda: lambda,
      oppHigh: oppHigh,
      oppLow: oppLow,
    });
  });
  return out;
}

/**
 * Aggregate segment stats from flat bet rows.
 */
function mlbAggregateWalkSegments_(bets, keyFn) {
  const segs = {};
  (bets || []).forEach(function (b) {
    const key = keyFn(b);
    if (!key) return;
    if (!segs[key]) segs[key] = { n: 0, wins: 0, roiSum: 0, evSum: 0 };
    segs[key].n++;
    segs[key].wins += b.hit;
    segs[key].roiSum += mlbWalkForwardRoiUnit_(b.hit, b.american);
    segs[key].evSum += b.ev;
  });
  return segs;
}

function mlbWalkForwardCollectBets_(gameSamples, cfg, calTable) {
  const pCalCuts = [
    { lo: 0, hi: 0.35, label: 'pCal<35' },
    { lo: 0.35, hi: 0.4, label: 'pCal35-40' },
    { lo: 0.4, hi: 0.45, label: 'pCal40-45' },
    { lo: 0.45, hi: 0.5, label: 'pCal45-50' },
    { lo: 0.5, hi: 0.55, label: 'pCal50-55' },
    { lo: 0.55, hi: 1.01, label: 'pCal55+' },
  ];
  const pRawCuts = [
    { lo: 0, hi: 0.55, label: 'pRaw<55' },
    { lo: 0.55, hi: 0.6, label: 'pRaw55-60' },
    { lo: 0.6, hi: 0.65, label: 'pRaw60-65' },
    { lo: 0.65, hi: 0.7, label: 'pRaw65-70' },
    { lo: 0.7, hi: 0.75, label: 'pRaw70-75' },
    { lo: 0.75, hi: 1.01, label: 'pRaw75+' },
  ];
  const edgeCuts = [
    { lo: -999, hi: -0.5, label: 'edge<-0.5' },
    { lo: -0.5, hi: 0.5, label: 'edge±0.5' },
    { lo: 0.5, hi: 1.0, label: 'edge0.5-1' },
    { lo: 1.0, hi: 999, label: 'edge1+' },
  ];

  const bets = [];
  (gameSamples || []).forEach(function (g) {
    const sides = mlbWalkForwardBothSides_(g, cfg, calTable);
    sides.forEach(function (b) {
      bets.push(b);
    });
  });

  const minN = parseInt(String(cfg['K_WF_SEGMENT_MIN_N'] != null ? cfg['K_WF_SEGMENT_MIN_N'] : '40'), 10) || 40;
  const minRoi = parseFloat(String(cfg['K_WF_SEGMENT_MIN_ROI'] != null ? cfg['K_WF_SEGMENT_MIN_ROI'] : '0.03')) || 0.03;

  const aggregators = [
    {
      name: 'side_only',
      fn: function (b) {
        return b.side;
      },
    },
    {
      name: 'side_pCal',
      fn: function (b) {
        const band = mlbWalkForwardBandLabel_(b.pCal, pCalCuts, pCalCuts.map(function (c) {
          return c.label;
        }));
        return b.side + '|' + band;
      },
    },
    {
      name: 'side_pRaw',
      fn: function (b) {
        const band = mlbWalkForwardBandLabel_(b.pRaw, pRawCuts, pRawCuts.map(function (c) {
          return c.label;
        }));
        return b.side + '|' + band;
      },
    },
    {
      name: 'side_pCal_oppHigh',
      fn: function (b) {
        const band = mlbWalkForwardBandLabel_(b.pCal, pCalCuts, pCalCuts.map(function (c) {
          return c.label;
        }));
        const tag = b.oppHigh ? 'oppK_high' : b.oppLow ? 'oppK_low' : 'oppK_mid';
        return b.side + '|' + band + '|' + tag;
      },
    },
    {
      name: 'side_pCal_edge',
      fn: function (b) {
        const pBand = mlbWalkForwardBandLabel_(b.pCal, pCalCuts, pCalCuts.map(function (c) {
          return c.label;
        }));
        const eBand = mlbWalkForwardBandLabel_(b.edge, edgeCuts, edgeCuts.map(function (c) {
          return c.label;
        }));
        return b.side + '|' + pBand + '|' + eBand;
      },
    },
    {
      name: 'pos_ev_cal',
      fn: function (b) {
        if (b.ev <= 0) return '';
        const band = mlbWalkForwardBandLabel_(b.pCal, pCalCuts, pCalCuts.map(function (c) {
          return c.label;
        }));
        return b.side + '|ev+|' + band;
      },
    },
  ];

  const rows = [];
  aggregators.forEach(function (agg) {
    const segs = mlbAggregateWalkSegments_(bets, agg.fn);
    Object.keys(segs).forEach(function (key) {
      const s = segs[key];
      if (!s.n) return;
      const hr = s.wins / s.n;
      const roi = s.roiSum / s.n;
      const sideKey = String(key).split('|')[0];
      const american = mlbWalkForwardOddsProxy_(sideKey === 'Under' ? 'Under' : 'Over', cfg);
      const breakeven = mlbAmericanImplied_(american);
      const candidate = s.n >= minN && roi >= minRoi && hr > breakeven;
      rows.push([
        agg.name,
        key,
        s.n,
        Math.round(hr * 1000) / 1000,
        Math.round(breakeven * 1000) / 1000,
        Math.round(roi * 1000) / 1000,
        Math.round((s.evSum / s.n) * 1000) / 1000,
        candidate ? 'Y' : 'N',
      ]);
    });
  });

  rows.sort(function (a, b) {
    const roiDiff = parseFloat(b[5]) - parseFloat(a[5]);
    if (Math.abs(roiDiff) > 1e-6) return roiDiff > 0 ? 1 : -1;
    return parseFloat(b[2]) - parseFloat(a[2]);
  });

  return { bets: bets, rows: rows, minN: minN, minRoi: minRoi };
}

function mlbWriteKWalkSegmentMiner_(ss, gameSamples, calTable, cfg) {
  const mined = mlbWalkForwardCollectBets_(gameSamples, cfg, calTable);
  let sh = ss.getSheetByName(MLB_K_WF_SEGMENTS_TAB);
  if (!sh) sh = ss.insertSheet(MLB_K_WF_SEGMENTS_TAB);
  sh.clear();
  sh.getRange(1, 1)
    .setValue('🧪 K Segment Miner — ' + new Date())
    .setFontWeight('bold');
  sh.getRange(2, 1).setValue(
    'Each row = OOS bucket (Over & Under separately at proxy odds). ' +
      'Input: discrepancy-flagged starts when available, else all walk-forward starts. ' +
      'Candidate=Y when n≥' +
      mined.minN +
      ', roi≥' +
      mined.minRoi +
      ', hit_rate>break_even.'
  );
  sh.getRange(4, 1, 1, 8)
    .setValues([
      ['slice', 'segment', 'n', 'hit_rate', 'breakeven', 'roi_proxy', 'avg_ev', 'candidate'],
    ])
    .setFontWeight('bold');

  if (mined.rows.length) {
    sh.getRange(5, 1, mined.rows.length, 8).setValues(mined.rows);
    const candidates = mined.rows.filter(function (r) {
      return r[7] === 'Y';
    });
    let row = 5 + mined.rows.length + 2;
    sh.getRange(row++, 1).setValue('Candidates (enable in registry after review):').setFontWeight('bold');
    if (candidates.length) {
      sh.getRange(row, 1, candidates.length, 2).setValues(
        candidates.map(function (r) {
          return [r[1], 'roi=' + r[5] + ' n=' + r[2]];
        })
      );
    } else {
      sh.getRange(row, 1).setValue('(none met n/roi floors — market may still have pockets at other odds bands)');
    }
  }

  sh.setTabColor('#4a148c');
  return mined;
}

function mlbSeedSegmentsFromMiner_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const miner = ss.getSheetByName(MLB_K_WF_SEGMENTS_TAB);
  if (!miner || miner.getLastRow() < 5) {
    safeAlert_('Segment Miner', 'Run walk-forward backtest first (builds miner tab).');
    return;
  }
  const data = miner.getRange(5, 1, miner.getLastRow() - 4, 8).getValues();
  const picks = data.filter(function (r) {
    return String(r[7]).toUpperCase() === 'Y';
  });
  if (!picks.length) {
    safeAlert_('Segment Miner', 'No candidate=Y rows in miner. Review negative-ROI slices or lower K_WF_SEGMENT_MIN_N.');
    return;
  }

  const sh = mlbEnsureKSegmentRegistrySheet_(ss);
  const rows = picks.slice(0, 12).map(function (r, i) {
    const seg = String(r[1]);
    const parts = seg.split('|');
    const side = parts[0] === 'Under' ? 'Under' : 'Over';
    return [
      'MINER_' + (i + 1) + '_' + seg.replace(/\|/g, '_').substring(0, 24),
      'N',
      side,
      0.35,
      0.55,
      side === 'Over' ? -160 : -100,
      side === 'Over' ? 100 : 200,
      '',
      parseInt(r[2], 10) || 40,
      parseFloat(r[5]) || 0,
      'From miner: ' + seg + ' — tune p_win_lo/hi manually',
    ];
  });
  const start = sh.getLastRow() < 2 ? 2 : sh.getLastRow() + 1;
  sh.getRange(start, 1, rows.length, rows[0].length).setValues(rows);
  ss.toast('Added ' + rows.length + ' miner candidates to registry (disabled)', 'MLB-BOIZ', 8);
}

function mlbActivateKWalkSegmentMinerTab_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(MLB_K_WF_SEGMENTS_TAB);
  if (sh) sh.activate();
  else ss.toast('Run K walk-forward backtest first', 'MLB-BOIZ', 5);
}
