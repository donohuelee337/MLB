// ============================================================
// 🔩 Pitcher outs / BB / hits allowed — queues + Poisson cards
// ============================================================
// Schedule-driven + FD main lines (non-alt market keys). Uses same L3_IP / K9
// cache path as Pitcher K where helpful; outs λ ≈ proj_IP×3; BB & HA λ from
// season BB/9 & H/9 × proj_IP.
// ============================================================

const MLB_PITCHER_OUTS_QUEUE_TAB = '📋 Pitcher_Outs_Queue';
const MLB_PITCHER_OUTS_CARD_TAB  = '🔩 Pitcher_Outs_Card';
const MLB_PITCHER_BB_QUEUE_TAB   = '📋 Pitcher_BB_Queue';
const MLB_PITCHER_BB_CARD_TAB    = '🪶 Pitcher_BB_Card';
const MLB_PITCHER_HA_QUEUE_TAB   = '📋 Pitcher_HA_Queue';
const MLB_PITCHER_HA_CARD_TAB    = '🧱 Pitcher_HA_Card';

/** Column counts — keep in sync with mlbPitcherSecondaryBetCardBody_ output and queue writers. */
const MLB_PITCHER_SEC_QUEUE_COLS = 21;
const MLB_PITCHER_SEC_CARD_COLS  = 21;

/** Season BB/9 and H/9 from pitching gameLog splits. */
function mlbPitchingBbHSeasonRates_(playerId, season) {
  const splits = mlbStatsApiGetPitchingGameSplits_(playerId, season);
  let bb = 0;
  let h = 0;
  let ip = 0;
  for (let i = 0; i < splits.length; i++) {
    const st = splits[i].stat || {};
    bb += parseInt(st.baseOnBalls, 10) || 0;
    h += parseInt(st.hits, 10) || 0;
    ip += mlbParseInningsString_(st.inningsPitched);
  }
  const bb9 = ip > 0 ? Math.round((bb / ip) * 900) / 100 : NaN;
  const h9 = ip > 0 ? Math.round((h / ip) * 900) / 100 : NaN;
  return { bb9: bb9, h9: h9, games: splits.length };
}

function mlbPitcherSecondaryFlags_(injuryStatus, notes, hasModel) {
  const f = [];
  const inj = String(injuryStatus || '').toLowerCase();
  if (inj.indexOf('out') !== -1 || inj.indexOf('doubtful') !== -1) f.push('injury');
  const n = String(notes || '');
  if (n.indexOf('fd_') !== -1) f.push('no_FD_line');
  if (!hasModel) f.push('no_model');
  return f.join('; ');
}

/**
 * @param {string} marketKey pitcher_outs | pitcher_walks | pitcher_hits_allowed
 */
function mlbBuildPitcherSecondaryQueue_(ss, marketKey, fdMissToken) {
  const cfg = getConfig();
  const season = mlbSlateSeasonYear_(cfg);
  mlbResetPitchHandCache_();
  mlbResetTeamHittingSeasonCache_();

  const sch = ss.getSheetByName(MLB_SCHEDULE_TAB);
  if (!sch || sch.getLastRow() < 4) {
    return { rows: [], season: season, err: 'no_schedule' };
  }

  const schLast = sch.getLastRow();
  const schCols = sch.getLastColumn();
  const scheduleRows = sch.getRange(4, 1, schLast, schCols).getValues();
  const pitcherIdsToPrefetch = {};
  scheduleRows.forEach(function (r) {
    [r[11], r[12]].forEach(function (pid) {
      const n = parseInt(pid, 10);
      if (n) pitcherIdsToPrefetch[n] = true;
    });
  });
  mlbPrefetchPitchHandsForIds_(Object.keys(pitcherIdsToPrefetch));

  const oddsIdx =
    marketKey === 'pitcher_walks'
      ? mlbBuildPersonPropOddsIndexMerged_(ss, 'pitcher_walks', 'pitcher_walks_alternate')
      : marketKey === 'pitcher_hits_allowed'
        ? mlbBuildPersonPropOddsIndexMerged_(ss, 'pitcher_hits_allowed', 'pitcher_hits_allowed_alternate')
        : mlbBuildPersonPropOddsIndex_(ss, marketKey);
  const inj = mlbLoadInjuryLookup_(ss);
  const out = [];
  const seenIds = {};

  scheduleRows.forEach(function (r) {
    const gamePk = r[0];
    const matchup = r[5];
    const awayAbbr = String(r[3] || '').trim();
    const homeAbbr = String(r[4] || '').trim();
    const awayP = String(r[6] || '').trim();
    const homeP = String(r[7] || '').trim();
    const awayId = r[11];
    const homeId = r[12];
    const hpUmp = String(r[13] || '').trim();
    if (!gamePk || !matchup) return;

    const gameKeys = mlbCandidateGameKeys_(matchup, awayAbbr, homeAbbr);
    const sides = [
      { side: 'Away', name: awayP, pid: awayId },
      { side: 'Home', name: homeP, pid: homeId },
    ];

    sides.forEach(function (sp) {
      if (!sp.name) {
        out.push([
          gamePk,
          matchup,
          sp.side,
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          'no_probable_pitcher',
          '',
          hpUmp,
          '',
          '',
          '',
          '',
        ]);
        return;
      }
      const pNorm = mlbNormalizePersonName_(sp.name);
      let pointMap = mlbOddsPointMapForPerson_(oddsIdx, gameKeys, pNorm);
      let note = '';
      if (!pointMap || !Object.keys(pointMap).length) {
        note = fdMissToken;
        pointMap = {};
      }
      const mainPt = mlbPickMainKPoint_(pointMap);
      const px = mlbMainKPrices_(pointMap, mainPt);

      let l3k = '';
      let l3ip = '';
      let l3bb = '';
      let k9 = '';
      let bb9 = '';
      let h9 = '';
      const pidNum = parseInt(sp.pid, 10);
      if (pidNum) {
        if (!seenIds[pidNum]) {
          if (!mlbStatsApiPitchingSplitsCached_(pidNum, season)) {
            Utilities.sleep(100);
          }
          const lg = mlbPitchingLogSummary_(pidNum, season);
          const rh = mlbPitchingBbHSeasonRates_(pidNum, season);
          seenIds[pidNum] = {
            l3k: lg.l3k,
            l3ip: lg.l3ip,
            k9: lg.k9,
            bb9: rh.bb9,
            h9: rh.h9,
            l3bb: mlbPitchingL3Bb_(pidNum, season),
          };
        }
        const z = seenIds[pidNum];
        l3k = z.l3k;
        l3ip = z.l3ip;
        l3bb = z.l3bb !== undefined ? z.l3bb : '';
        k9 = z.k9;
        bb9 = z.bb9;
        h9 = z.h9;
      } else {
        note = note ? note + '; no_pitcher_id' : 'no_pitcher_id';
      }

      let throws = '';
      if (pidNum) throws = mlbStatsApiGetPitchHand_(pidNum);
      const injSt = inj[mlbNormalizePersonName_(sp.name)] || '';
      const oppAbbr = sp.side === 'Away' ? homeAbbr : awayAbbr;
      const oppTeamId = mlbTeamIdFromAbbr_(oppAbbr);
      let oppKpa = '';
      let oppKpaVs = '';
      if (!isNaN(oppTeamId)) {
        const kpa = mlbTeamSeasonHittingKPerPa_(oppTeamId, season);
        oppKpa = !isNaN(kpa) ? kpa : '';
        const tw0 = String(throws || '')
          .trim()
          .toUpperCase()
          .slice(0, 1);
        if (tw0 === 'L' || tw0 === 'R') {
          const kv = mlbTeamHittingKPerPaVsPitcherHand_(oppTeamId, season, tw0);
          oppKpaVs = !isNaN(kv) ? kv : '';
        }
      }

      out.push([
        gamePk,
        matchup,
        sp.side,
        sp.name,
        sp.pid || '',
        mainPt != null ? mainPt : '',
        px.over,
        px.under,
        l3k,
        l3ip,
        k9,
        bb9,
        h9,
        note,
        injSt,
        hpUmp,
        throws,
        oppAbbr,
        oppKpa,
        oppKpaVs,
        l3bb,
      ]);
    });
  });

  return { rows: out, season: season, err: '' };
}

function mlbWritePitcherSecondaryQueueSheet_(ss, rows, season, tabName, title, headers) {
  let sh = ss.getSheetByName(tabName);
  if (sh) {
    sh.clearContents();
    sh.clearFormats();
  } else {
    sh = ss.insertSheet(tabName);
  }
  sh.setTabColor('#455a64');
  sh.getRange(1, 1, 1, headers.length)
    .merge()
    .setValue(title + ' — season ' + season)
    .setFontWeight('bold')
    .setBackground('#37474f')
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center');
  sh.getRange(3, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight('bold')
    .setBackground('#546e7a')
    .setFontColor('#ffffff');
  sh.setFrozenRows(3);
  if (rows.length) {
    sh.getRange(4, 1, rows.length, headers.length).setValues(rows);
  }
}

const MLB_PITCHER_SEC_QUEUE_HEADERS = [
  'gamePk',
  'matchup',
  'side',
  'pitcher',
  'pitcher_id',
  'fd_line',
  'fd_over',
  'fd_under',
  'L3_K',
  'L3_IP',
  'K9_szn',
  'BB9_szn',
  'H9_szn',
  'notes',
  'injury_status',
  'hp_umpire',
  'throws',
  'opp_abbr',
  'opp_k_pa',
  'opp_k_pa_vs',
  'L3_BB',
];

function refreshPitcherOutsSlateQueue() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const pack = mlbBuildPitcherSecondaryQueue_(ss, 'pitcher_outs', 'fd_outs_miss');
  if (pack.err === 'no_schedule') {
    safeAlert_('Pitcher Outs queue', 'Run MLB schedule first.');
    return;
  }
  mlbWritePitcherSecondaryQueueSheet_(
    ss,
    pack.rows,
    pack.season,
    MLB_PITCHER_OUTS_QUEUE_TAB,
    '📋 Pitcher outs queue — FD pitcher_outs',
    MLB_PITCHER_SEC_QUEUE_HEADERS
  );
  ss.toast(pack.rows.length + ' rows', 'Pitcher Outs queue', 5);
}

function refreshPitcherWalksSlateQueue() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const pack = mlbBuildPitcherSecondaryQueue_(ss, 'pitcher_walks', 'fd_walks_miss');
  if (pack.err === 'no_schedule') {
    safeAlert_('Pitcher Walks queue', 'Run MLB schedule first.');
    return;
  }
  mlbWritePitcherSecondaryQueueSheet_(
    ss,
    pack.rows,
    pack.season,
    MLB_PITCHER_BB_QUEUE_TAB,
    '📋 Pitcher walks queue — FD pitcher_walks',
    MLB_PITCHER_SEC_QUEUE_HEADERS
  );
  ss.toast(pack.rows.length + ' rows', 'Pitcher Walks queue', 5);
}

function refreshPitcherHitsAllowedSlateQueue() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const pack = mlbBuildPitcherSecondaryQueue_(ss, 'pitcher_hits_allowed', 'fd_ha_miss');
  if (pack.err === 'no_schedule') {
    safeAlert_('Pitcher HA queue', 'Run MLB schedule first.');
    return;
  }
  mlbWritePitcherSecondaryQueueSheet_(
    ss,
    pack.rows,
    pack.season,
    MLB_PITCHER_HA_QUEUE_TAB,
    '📋 Pitcher hits allowed queue — FD pitcher_hits_allowed',
    MLB_PITCHER_SEC_QUEUE_HEADERS
  );
  ss.toast(pack.rows.length + ' rows', 'Pitcher HA queue', 5);
}

/** λ outs ≈ proj_IP × 3 (batters faced proxy). */
function mlbLambdaPitcherOuts_(l3ipRaw, cfg) {
  const projIp = mlbProjIpFromQueueRow_(l3ipRaw);
  return Math.round(projIp * 3 * 100) / 100;
}

/** Sum BBs from the last 3 logged starts. Returns number or '' if no splits. */
function mlbPitchingL3Bb_(playerId, season) {
  const splits = mlbStatsApiGetPitchingGameSplits_(playerId, season);
  const n = Math.min(3, splits.length);
  if (n === 0) return '';
  let bb = 0;
  for (let i = 0; i < n; i++) {
    bb += parseInt((splits[i].stat || {}).baseOnBalls, 10) || 0;
  }
  return bb;
}

/**
 * Blend season BB/9 with L3 BB/9 (same spirit as mlbEffectiveK9ForLambda_ for Ks).
 * Config key BB9_BLEND_L7_WEIGHT (default 0.35): weight on the L3 figure.
 */
function mlbEffectiveBb9ForLambda_(bb9raw, l3bbRaw, l3ipRaw, cfg) {
  const bb9 = parseFloat(bb9raw, 10);
  const wRaw = cfg && cfg['BB9_BLEND_L7_WEIGHT'] != null
    ? String(cfg['BB9_BLEND_L7_WEIGHT']).trim() : '0.35';
  const w = parseFloat(wRaw, 10);
  const wt = !isNaN(w) ? Math.max(0, Math.min(1, w)) : 0.35;
  const lbb = parseFloat(l3bbRaw, 10);
  const lip = parseFloat(l3ipRaw, 10);
  if (!isNaN(lbb) && !isNaN(lip) && lip > 0.51) {
    const bb9l = (lbb / lip) * 9;
    if (!isNaN(bb9) && bb9 > 0) {
      return Math.round(((1 - wt) * bb9 + wt * bb9l) * 100) / 100;
    }
    if (!isNaN(bb9l) && bb9l >= 0) return Math.round(bb9l * 100) / 100;
  }
  if (!isNaN(bb9) && bb9 > 0) return Math.round(bb9 * 100) / 100;
  return NaN;
}

function mlbLambdaPitcherBb_(bb9raw, l3ipRaw, l3bbRaw, cfg) {
  const projIp = mlbProjIpFromQueueRow_(l3ipRaw);
  const bb9eff = mlbEffectiveBb9ForLambda_(bb9raw, l3bbRaw, l3ipRaw, cfg);
  if (isNaN(bb9eff) || isNaN(projIp) || projIp <= 0) return NaN;
  return Math.round(((bb9eff / 9) * projIp) * 1000) / 1000;
}

function mlbLambdaPitcherHa_(h9raw, l3ipRaw, cfg) {
  const projIp = mlbProjIpFromQueueRow_(l3ipRaw);
  const h9 = parseFloat(h9raw, 10);
  if (isNaN(h9) || isNaN(projIp) || projIp <= 0) return NaN;
  return Math.round(((h9 / 9) * projIp) * 1000) / 1000;
}

function mlbPitcherSecondaryBetCardBody_(queueTab, lambdaFn, meta) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig();
  const q = ss.getSheetByName(queueTab);
  if (!q || q.getLastRow() < 4) {
    safeAlert_(meta.alertTitle, meta.alertDetail);
    return;
  }
  const last = q.getLastRow();
  const raw = q.getRange(4, 1, last, MLB_PITCHER_SEC_QUEUE_COLS).getValues();
  const out = [];

  raw.forEach(function (r) {
    const gamePk = r[0];
    const matchup = r[1];
    const pitcher = r[3];
    const pitcherId = r[4];
    const line = r[5];
    const fdOver = r[6];
    const fdUnder = r[7];
    const l3ip = r[9];
    const bb9 = r[11];
    const h9 = r[12];
    const notes = r[13];
    const inj = r[14];
    const hpUmp = String(r[15] || '').trim();
    const throws = String(r[16] || '').trim();

    if (!String(pitcher || '').trim()) return;

    let lamNum = lambdaFn(l3ip, bb9, h9, cfg, r);
    const homeAbbr = mlbScheduleHomeAbbrForGamePk_(ss, gamePk);
    const parkFn = meta.parkFactorFn || mlbParkKLambdaMultForHomeAbbr_;
    const pk = parkFn(homeAbbr);
    if (!isNaN(lamNum) && lamNum >= 0) {
      lamNum = Math.round(lamNum * pk * 1000) / 1000;
    }
    // Per-pitcher ABS shadow mult — transform direction is market-dependent (see meta.absPitcherMultTransform).
    // Walks/HA invert the K-shadow dependency: losing borderline Ks → more BBs / more balls in play.
    if (meta.absPitcherMultTransform && !isNaN(lamNum) && lamNum > 0) {
      const rawMult = mlbGetAbsPitcherLambdaMult_(pitcherId);
      let apm;
      if (rawMult != null) {
        apm = meta.absPitcherMultTransform(rawMult);
      } else {
        const cfgRaw = parseFloat(
          String(cfg['ABS_PITCHER_K_LAMBDA_MULT'] != null ? cfg['ABS_PITCHER_K_LAMBDA_MULT'] : '1').trim(), 10
        );
        if (!isNaN(cfgRaw) && cfgRaw > 0) apm = meta.absPitcherMultTransform(cfgRaw);
      }
      if (apm != null && !isNaN(apm) && Math.abs(apm - 1) > 1e-6) {
        lamNum = Math.round(lamNum * apm * 1000) / 1000;
      }
    }

    let lambdaDisp = '';
    let edge = '';
    if (!isNaN(lamNum) && lamNum >= 0) {
      lambdaDisp = lamNum;
      const lv = parseFloat(line, 10);
      if (!isNaN(lv)) edge = Math.round((lamNum - lv) * 1000) / 1000;
    }

    const lineNum = parseFloat(line, 10);
    const hasModel = !isNaN(lamNum) && lamNum > 0 && !isNaN(lineNum);
    const pu = hasModel ? mlbProbOverUnderK_(line, lamNum) : { pOver: '', pUnder: '' };
    const pOver = pu.pOver === '' ? '' : Math.round(pu.pOver * 1000) / 1000;
    const pUnder = pu.pUnder === '' ? '' : Math.round(pu.pUnder * 1000) / 1000;

    const imO = mlbAmericanImplied_(fdOver);
    const imU = mlbAmericanImplied_(fdUnder);
    const evO = pOver !== '' && fdOver !== '' ? mlbEvPerDollarRisked_(pOver, fdOver) : '';
    const evU = pUnder !== '' && fdUnder !== '' ? mlbEvPerDollarRisked_(pUnder, fdUnder) : '';

    const best = mlbPickBestSide_(evO, evU);
    const bestSide = best.side;
    const bestEv = best.ev;

    const flags = mlbPitcherSecondaryFlags_(inj, notes, hasModel);

    out.push([
      gamePk,
      matchup,
      pitcher,
      line,
      fdOver,
      fdUnder,
      lambdaDisp,
      edge,
      pOver,
      pUnder,
      imO,
      imU,
      evO,
      evU,
      bestSide,
      bestEv,
      flags,
      pitcherId,
      hpUmp,
      throws,
      meta.lambdaShort || '',
    ]);
  });

  out.sort(function (a, b) {
    const be = parseFloat(b[15], 10);
    const ae = parseFloat(a[15], 10);
    if (isNaN(be) && isNaN(ae)) return 0;
    if (isNaN(be)) return -1;
    if (isNaN(ae)) return 1;
    return be - ae;
  });

  let sh = ss.getSheetByName(meta.cardTab);
  if (sh) {
    sh.clearContents();
    sh.clearFormats();
  } else {
    sh = ss.insertSheet(meta.cardTab);
  }
  sh.setTabColor(meta.tabColor || '#546e7a');
  const headers = [
    'gamePk',
    'matchup',
    'pitcher',
    'fd_line',
    'fd_over',
    'fd_under',
    'lambda',
    'edge_vs_line',
    'p_over',
    'p_under',
    'implied_over',
    'implied_under',
    'ev_over_$1',
    'ev_under_$1',
    'best_side',
    'best_ev_$1',
    'flags',
    'pitcher_id',
    'hp_umpire',
    'throws',
    'stat',
  ];
  sh.getRange(1, 1, 1, headers.length)
    .merge()
    .setValue(meta.cardTitle)
    .setFontWeight('bold')
    .setBackground(meta.headBg || '#37474f')
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center')
    .setWrap(true);
  sh.setRowHeight(1, 34);
  sh.getRange(3, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight('bold')
    .setBackground(meta.headBg2 || '#607d8b')
    .setFontColor('#ffffff');
  sh.setFrozenRows(3);
  if (out.length) {
    sh.getRange(4, 1, out.length, headers.length).setValues(out);
  }
  ss.toast(out.length + ' rows', meta.toastLabel, 5);
}

function refreshPitcherOutsBetCard() {
  mlbPitcherSecondaryBetCardBody_(MLB_PITCHER_OUTS_QUEUE_TAB, function (l3ip, bb9, h9, cfg, row) {
    return mlbLambdaPitcherOuts_(l3ip, cfg);
  }, {
    alertTitle: 'Pitcher Outs card',
    alertDetail: 'Run Pitcher Outs queue first.',
    cardTab: MLB_PITCHER_OUTS_CARD_TAB,
    cardTitle: '🔩 Pitcher Outs card — λ ≈ proj_IP×3 × park K-env; Poisson vs FD pitcher_outs',
    lambdaShort: 'outs',
    toastLabel: 'Pitcher Outs card',
    tabColor: '#455a64',
    headBg: '#37474f',
    headBg2: '#546e7a',
    parkFactorFn: mlbParkKLambdaMultForHomeAbbr_,
  });
}

function refreshPitcherWalksBetCard() {
  mlbPitcherSecondaryBetCardBody_(MLB_PITCHER_BB_QUEUE_TAB, function (l3ip, bb9, h9, cfg, row) {
    return mlbLambdaPitcherBb_(bb9, l3ip, row[20], cfg);
  }, {
    alertTitle: 'Pitcher Walks card',
    alertDetail: 'Run Pitcher Walks queue first.',
    cardTab: MLB_PITCHER_BB_CARD_TAB,
    cardTitle: '🪶 Pitcher walks card — λ = BB9×proj_IP/9 (no park adj)',
    lambdaShort: 'BB',
    toastLabel: 'Pitcher Walks card',
    tabColor: '#5d4037',
    headBg: '#4e342e',
    headBg2: '#6d4c41',
    parkFactorFn: function () { return 1; },
    // Shadow-dependent pitchers lose borderline Ks → more walks; invert the K-shadow mult.
    absPitcherMultTransform: function (m) {
      return Math.max(0.92, Math.min(1.12, 1 / Math.max(0.85, Math.min(1, m))));
    },
  });
}

function refreshPitcherHaBetCard() {
  mlbPitcherSecondaryBetCardBody_(MLB_PITCHER_HA_QUEUE_TAB, function (l3ip, bb9, h9, cfg, row) {
    return mlbLambdaPitcherHa_(h9, l3ip, cfg);
  }, {
    alertTitle: 'Pitcher HA card',
    alertDetail: 'Run Pitcher HA queue first.',
    cardTab: MLB_PITCHER_HA_CARD_TAB,
    cardTitle: '🧱 Pitcher hits allowed card — λ = H9×proj_IP/9 × park (TB env)',
    lambdaShort: 'HA',
    toastLabel: 'Pitcher HA card',
    tabColor: '#263238',
    headBg: '#212121',
    headBg2: '#424242',
    parkFactorFn: mlbParkTbLambdaMultForHomeAbbr_,
    // Shadow-dependent pitchers lose Ks → more balls in play → mild HA increase; 50% of the K effect.
    absPitcherMultTransform: function (m) {
      return Math.max(0.96, Math.min(1.06, 1 + (1 - Math.max(0.85, Math.min(1, m))) * 0.5));
    },
  });
}
