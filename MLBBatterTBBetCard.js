// ============================================================
// 🎲 Batter prop cards — TB / Hits / HR (shared Poisson body)
// ============================================================
// All three markets share mlbBatterPropBetCardBody_(meta).
// Queue tab schema (MLB_BATTER_PROP_QUEUE_COLS cols, defined in MLBBatterTBQueue.js):
//   [0] gamePk  [1] matchup  [2] batter  [3] batter_id
//   [4] fd_line  [5] fd_over  [6] fd_under
//   [7] L7_avg  [8] L7_games  [9] stat_pg_szn
//   [10] notes  [11] injury_status  [12] hp_umpire  [13] odds_game_norm
// Card output: MLB_BATTER_PROP_CARD_COLS cols (see constant below).
// ============================================================

const MLB_BATTER_TB_CARD_TAB   = '🎲 Batter_TB_Card';
const MLB_BATTER_HITS_CARD_TAB = '🎯 Batter_Hits_Card';
const MLB_BATTER_HR_CARD_TAB   = '💥 Batter_HR_Card';

/** Column count for every batter prop card output tab. */
const MLB_BATTER_PROP_CARD_COLS = 19;

/**
 * Blend recent and season per-game averages for any batter prop market.
 * Reads TB_BLEND_RECENT_WEIGHT from config (applies to TB, Hits, and HR).
 */
function mlbEffectiveBatterPropLambda_(statPgSznRaw, l7AvgRaw, l7nRaw, cfg) {
  const wRaw =
    cfg && cfg['TB_BLEND_RECENT_WEIGHT'] != null ? String(cfg['TB_BLEND_RECENT_WEIGHT']).trim() : '0.35';
  const w = parseFloat(wRaw, 10);
  const wt = !isNaN(w) ? Math.max(0, Math.min(1, w)) : 0.35;
  const szn = parseFloat(statPgSznRaw, 10);
  const l7a = parseFloat(l7AvgRaw, 10);
  const l7n = parseFloat(l7nRaw, 10);
  if (!isNaN(l7a) && !isNaN(l7n) && l7n >= 1) {
    if (!isNaN(szn) && szn >= 0) {
      return Math.round(((1 - wt) * szn + wt * l7a) * 1000) / 1000;
    }
    return Math.round(l7a * 1000) / 1000;
  }
  if (!isNaN(szn) && szn >= 0) return Math.round(szn * 1000) / 1000;
  return NaN;
}

function mlbFlagsBatterTbCard_(injuryStatus, notes, hasModel) {
  const f = [];
  const inj = String(injuryStatus || '').toLowerCase();
  if (inj.indexOf('out') !== -1 || inj.indexOf('doubtful') !== -1) f.push('injury');
  const n = String(notes || '');
  if (n.indexOf('schedule_game_miss') !== -1 || n.indexOf('fd_') !== -1) f.push('join_risk');
  if (n.indexOf('id_miss') !== -1) f.push('id_miss');
  if (!hasModel) f.push('no_model');
  return f.join('; ');
}

/**
 * Shared Poisson card body for all batter prop markets.
 * Adding a new batter market (RBI, SB, runs, etc.) only requires a new
 * refresh function that calls this with the right meta object.
 *
 * @param {Object} meta
 * @param {string}   meta.queueTab        source queue tab name
 * @param {string}   meta.cardTab         output card tab name
 * @param {string}   meta.cardTitle       row-1 title string
 * @param {string}   meta.tabColor
 * @param {string}   meta.headBg          row-1 background
 * @param {string}   meta.headBg2         row-3 header background
 * @param {string}   meta.fdLineHeader    e.g. 'fd_tb_line'
 * @param {string}   meta.lambdaHeader    e.g. 'lambda_TB'
 * @param {string}   meta.namedRange      e.g. 'MLB_BATTER_TB_CARD'
 * @param {string}   meta.toastLabel
 * @param {string}   [meta.alertTitle]
 * @param {string}   [meta.alertDetail]
 * @param {Function} [meta.parkFactorFn]  default: mlbParkTbLambdaMultForHomeAbbr_
 */
function mlbBatterPropBetCardBody_(meta) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig();
  const q = ss.getSheetByName(meta.queueTab);
  if (!q || q.getLastRow() < 4) {
    safeAlert_(meta.alertTitle || meta.cardTab, meta.alertDetail || 'Run the queue step first.');
    return;
  }

  const last = q.getLastRow();
  const raw = q.getRange(4, 1, last, MLB_BATTER_PROP_QUEUE_COLS).getValues();
  const parkFn = meta.parkFactorFn || mlbParkTbLambdaMultForHomeAbbr_;
  const out = [];

  raw.forEach(function (r) {
    const gamePk   = r[0];
    const matchup  = r[1];
    const batter   = r[2];
    const batterId = r[3];
    const line     = r[4];
    const fdOver   = r[5];
    const fdUnder  = r[6];
    const l7Avg    = r[7];
    const l7n      = r[8];
    const statPgSzn = r[9];
    const notes    = r[10];
    const inj      = r[11];
    const hpUmp    = String(r[12] || '').trim();

    if (!String(batter || '').trim()) return;

    let lamNum = mlbEffectiveBatterPropLambda_(statPgSzn, l7Avg, l7n, cfg);
    const homeAbbr = mlbScheduleHomeAbbrForGamePk_(ss, gamePk);
    const pk = parkFn(homeAbbr);
    if (!isNaN(lamNum) && lamNum >= 0) {
      lamNum = Math.round(lamNum * pk * 1000) / 1000;
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
    const pOver  = pu.pOver  === '' ? '' : Math.round(pu.pOver  * 1000) / 1000;
    const pUnder = pu.pUnder === '' ? '' : Math.round(pu.pUnder * 1000) / 1000;

    const imO = mlbAmericanImplied_(fdOver);
    const imU = mlbAmericanImplied_(fdUnder);
    const evO = pOver  !== '' && fdOver  !== '' ? mlbEvPerDollarRisked_(pOver,  fdOver)  : '';
    const evU = pUnder !== '' && fdUnder !== '' ? mlbEvPerDollarRisked_(pUnder, fdUnder) : '';

    const best  = mlbPickBestSide_(evO, evU);
    const flags = mlbFlagsBatterTbCard_(inj, notes, hasModel);

    out.push([
      gamePk, matchup, batter, line,
      fdOver, fdUnder,
      lambdaDisp, edge,
      pOver, pUnder,
      imO, imU, evO, evU,
      best.side, best.ev,
      flags, batterId, hpUmp,
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
  sh.setTabColor(meta.tabColor);

  [72, 200, 150, 56, 64, 64, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 140, 88, 140].forEach(function (w, i) {
    sh.setColumnWidth(i + 1, w);
  });

  sh.getRange(1, 1, 1, MLB_BATTER_PROP_CARD_COLS)
    .merge()
    .setValue(meta.cardTitle)
    .setFontWeight('bold')
    .setBackground(meta.headBg)
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center')
    .setWrap(true);
  sh.setRowHeight(1, 34);

  const headers = [
    'gamePk', 'matchup', 'batter',
    meta.fdLineHeader, 'fd_over', 'fd_under',
    meta.lambdaHeader, 'edge_vs_line',
    'p_over', 'p_under', 'implied_over', 'implied_under',
    'ev_over_$1', 'ev_under_$1',
    'best_side', 'best_ev_$1',
    'flags', 'batter_id', 'hp_umpire',
  ];
  sh.getRange(3, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight('bold')
    .setBackground(meta.headBg2)
    .setFontColor('#ffffff');
  sh.setFrozenRows(3);

  if (out.length) {
    sh.getRange(4, 1, out.length, MLB_BATTER_PROP_CARD_COLS).setValues(out);
    try {
      ss.setNamedRange(meta.namedRange, sh.getRange(4, 1, out.length, MLB_BATTER_PROP_CARD_COLS));
    } catch (e) {}
  }

  ss.toast(out.length + ' rows · sorted by best_ev', meta.toastLabel, 6);
}

function refreshBatterTbBetCard() {
  mlbBatterPropBetCardBody_({
    queueTab:     MLB_BATTER_TB_QUEUE_TAB,
    alertTitle:   'Batter TB card',
    alertDetail:  'Run Batter TB queue first (pipeline or menu).',
    cardTab:      MLB_BATTER_TB_CARD_TAB,
    cardTitle:    '🎲 Batter TB card — λ = blend(TB/game) × park; Poisson vs FD line · sort best_ev desc',
    tabColor:     '#ef6c00',
    headBg:       '#e65100',
    headBg2:      '#fb8c00',
    fdLineHeader: 'fd_tb_line',
    lambdaHeader: 'lambda_TB',
    namedRange:   'MLB_BATTER_TB_CARD',
    toastLabel:   'Batter TB card',
  });
}

function refreshBatterHitsBetCard() {
  mlbBatterPropBetCardBody_({
    queueTab:     MLB_BATTER_HITS_QUEUE_TAB,
    alertTitle:   'Batter Hits card',
    alertDetail:  'Run Batter Hits queue first (pipeline or menu).',
    cardTab:      MLB_BATTER_HITS_CARD_TAB,
    cardTitle:    '🎯 Batter Hits card — λ = blend(H/game) × park; Poisson vs FD line · sort best_ev desc',
    tabColor:     '#00838f',
    headBg:       '#006064',
    headBg2:      '#0097a7',
    fdLineHeader: 'fd_hits_line',
    lambdaHeader: 'lambda_H',
    namedRange:   'MLB_BATTER_HITS_CARD',
    toastLabel:   'Batter Hits card',
  });
}

function refreshBatterHrBetCard() {
  mlbBatterPropBetCardBody_({
    queueTab:     MLB_BATTER_HR_QUEUE_TAB,
    alertTitle:   'Batter HR card',
    alertDetail:  'Run Batter HR queue first (pipeline or menu).',
    cardTab:      MLB_BATTER_HR_CARD_TAB,
    cardTitle:    '💥 Batter HR card — λ HR/game blend × park TB env; Poisson vs FD batter_home_runs',
    tabColor:     '#c2185b',
    headBg:       '#880e4f',
    headBg2:      '#c2185b',
    fdLineHeader: 'fd_hr_line',
    lambdaHeader: 'lambda_HR',
    namedRange:   'MLB_BATTER_HR_CARD',
    toastLabel:   'Batter HR card',
  });
}
