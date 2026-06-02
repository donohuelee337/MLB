// ============================================================
// 🎟️ Early Win — DraftKings "Up 2 Early Win" token (daily ML promo)
// ============================================================
// Promo: pre-match moneyline; redeems on TEAM_LEADS_BY_2 ∪ TEAM_WINS.
// One single-use token per day, max bet $10, applied to one MLB game
// whose first pitch is at or before EARLY_WIN_CUTOFF_ET (default 4:10 PM ET).
//
// Math:
//   p_redeem(p_win) = p_win + (1 - p_win) * LEAD_BOOST
//   EV/$1 = p_redeem * (decimal - 1) - (1 - p_redeem)
// LEAD_BOOST default 0.20 — empirically: "team ever leads by 2+" runs
// roughly ML implied + 7..12 pp on heavy chalks, widening to +12..20 pp
// on near-pick'em games. 0.20 is the additive lift applied to losing-team
// probability mass; tune lower if redemption rate underperforms.
//
// Sources read:
//   ✅ FanDuel_MLB_Odds (market='h2h') — pulled by FetchMLBOdds.js
//   📅 MLB_Schedule    — start times in UTC, converted to ET for cutoff
// Writes:
//   🎟️ Early_Win_Card  — one row per team in each eligible game, sorted by EV
// ============================================================

const MLB_EARLY_WIN_TAB = '🎟️ Early_Win_Card';

// Defaults — Config rows override.
const MLB_EARLY_WIN_LEAD_BOOST_DEFAULT = 0.20;
const MLB_EARLY_WIN_CUTOFF_ET_DEFAULT = '16:10';
const MLB_EARLY_WIN_MAX_BET_DEFAULT = 10;

function mlbEarlyWinAmericanImplied_(odds) {
  const o = parseFloat(String(odds == null ? '' : odds).trim(), 10);
  if (isNaN(o)) return NaN;
  if (o > 0) return 100 / (o + 100);
  return Math.abs(o) / (Math.abs(o) + 100);
}

function mlbEarlyWinDecimalFromAmerican_(odds) {
  const o = parseFloat(String(odds == null ? '' : odds).trim(), 10);
  if (isNaN(o)) return NaN;
  if (o > 0) return 1 + o / 100;
  return 1 + 100 / Math.abs(o);
}

/** p_redeem = p_win + (1 - p_win) * leadBoost. Clamps both p_win and result to [0,1]. */
function mlbEarlyWinPRedeem_(pWin, leadBoost) {
  const p = Math.max(0, Math.min(1, pWin));
  const b = Math.max(0, Math.min(1, leadBoost));
  return Math.min(1, p + (1 - p) * b);
}

function mlbEarlyWinEvPerDollar_(pRedeem, decimal) {
  if (isNaN(pRedeem) || isNaN(decimal) || decimal <= 1) return NaN;
  return pRedeem * (decimal - 1) - (1 - pRedeem);
}

function mlbEarlyWinCutoffMinutes_(cfg) {
  const raw = String(cfg && cfg['EARLY_WIN_CUTOFF_ET'] ? cfg['EARLY_WIN_CUTOFF_ET'] : MLB_EARLY_WIN_CUTOFF_ET_DEFAULT).trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (!m) return 16 * 60 + 10;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function mlbEarlyWinLeadBoost_(cfg) {
  const raw = parseFloat(String(cfg && cfg['EARLY_WIN_LEAD_BOOST'] != null ? cfg['EARLY_WIN_LEAD_BOOST'] : '').trim());
  if (!isNaN(raw) && raw >= 0 && raw <= 1) return raw;
  return MLB_EARLY_WIN_LEAD_BOOST_DEFAULT;
}

/** Pick'em-end boost. "Ever leads by 2+" lift widens as the game nears a coin
 *  flip (more lead changes / higher combined variance) and shrinks on heavy
 *  chalk (favorite is already winning, the marginal 2-run lead is mostly
 *  baked into p_win). Blank/absent → falls back to flat base boost. */
function mlbEarlyWinLeadBoostPickem_(cfg) {
  const raw = parseFloat(String(cfg && cfg['EARLY_WIN_LEAD_BOOST_PICKEM'] != null ? cfg['EARLY_WIN_LEAD_BOOST_PICKEM'] : '').trim());
  if (!isNaN(raw) && raw >= 0 && raw <= 1) return raw;
  return NaN; // signal: use flat base boost
}

/**
 * Closeness-scaled lead boost. closeness = 1 - |2·pWin - 1| (1 at pick'em, 0 at
 * a lock). Interpolates base → pickem boost. Falls back to flat base when no
 * pickem key configured. Keeps EARLY_WIN_LEAD_BOOST as the chalk/base anchor.
 */
function mlbEarlyWinEffectiveBoost_(pWin, baseBoost, pickemBoost) {
  if (isNaN(pickemBoost)) return baseBoost;
  const p = Math.max(0, Math.min(1, pWin));
  const closeness = 1 - Math.abs(2 * p - 1);
  return baseBoost + (pickemBoost - baseBoost) * closeness;
}

/**
 * De-vig two-way moneyline. Returns each side's no-vig win probability by
 * normalizing the raw implied probs to sum to 1 (proportional / "multiplicative"
 * method). This strips the book's hold so EV reflects OUTCOME, not the priced
 * action. Returns {away, home, hold} or null when a price is missing.
 */
function mlbEarlyWinDevig_(awayAmerican, homeAmerican) {
  const ai = mlbEarlyWinAmericanImplied_(awayAmerican);
  const hi = mlbEarlyWinAmericanImplied_(homeAmerican);
  if (isNaN(ai) || isNaN(hi) || ai <= 0 || hi <= 0) return null;
  const sum = ai + hi;
  if (sum <= 0) return null;
  return { away: ai / sum, home: hi / sum, hold: sum - 1 };
}

function mlbEarlyWinMaxBet_(cfg) {
  const raw = parseFloat(String(cfg && cfg['EARLY_WIN_MAX_BET'] != null ? cfg['EARLY_WIN_MAX_BET'] : '').trim());
  if (!isNaN(raw) && raw > 0) return raw;
  return MLB_EARLY_WIN_MAX_BET_DEFAULT;
}

/**
 * Reads ✅ FanDuel_MLB_Odds h2h rows. Keyed by normalized game label (same as K/NRFI queues).
 */
function mlbEarlyWinReadH2HFromFD_(ss) {
  const sh = ss.getSheetByName(MLB_ODDS_CONFIG.tabName);
  if (!sh || sh.getLastRow() < 4) return {};
  const nRows = Math.max(0, sh.getLastRow() - 3);
  if (!nRows) return {};
  const rows = sh.getRange(4, 1, nRows, 8).getValues();
  const byGameNorm = {};
  rows.forEach(function (r) {
    if (String(r[2] || '').trim() !== 'h2h') return;
    const gameLabel = String(r[1] || '').trim();
    const teamName = String(r[3] || r[0] || '').trim();
    const price = r[5];
    if (!gameLabel || !teamName) return;
    const gNorm = mlbNormalizeGameLabel_(gameLabel);
    if (!byGameNorm[gNorm]) byGameNorm[gNorm] = { teams: [], label: gameLabel };
    byGameNorm[gNorm].teams.push({ name: teamName, price: price });
  });
  return byGameNorm;
}

/** Resolve h2h prices for a schedule row (tries label variants like other queues). */
function mlbEarlyWinLookupH2H_(h2hByGameNorm, matchup, awayAbbr, homeAbbr) {
  if (!h2hByGameNorm) return null;
  const keys =
    typeof mlbCandidateGameKeys_ === 'function'
      ? mlbCandidateGameKeys_(matchup, awayAbbr, homeAbbr)
      : [mlbNormalizeGameLabel_(matchup)];
  for (let i = 0; i < keys.length; i++) {
    if (h2hByGameNorm[keys[i]]) return h2hByGameNorm[keys[i]];
  }
  return null;
}

function refreshMLBEarlyWinCard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig();
  const slate = getSlateDateString_(cfg);
  const cutoffMin = mlbEarlyWinCutoffMinutes_(cfg);
  const leadBoost = mlbEarlyWinLeadBoost_(cfg);
  const leadBoostPickem = mlbEarlyWinLeadBoostPickem_(cfg);
  const maxBet = mlbEarlyWinMaxBet_(cfg);

  const schedSh = ss.getSheetByName(MLB_SCHEDULE_TAB);
  if (!schedSh || schedSh.getLastRow() < 4) {
    mlbEarlyWinWriteTab_(ss, slate, cutoffMin, leadBoost, maxBet, [], 'no schedule rows — run MLB schedule first');
    return;
  }
  const sched = schedSh.getRange(4, 1, schedSh.getLastRow() - 3, 14).getValues();
  const h2hByGameNorm = mlbEarlyWinReadH2HFromFD_(ss);
  const now = new Date();

  const out = [];
  let eligibleGames = 0;
  sched.forEach(function (r) {
    const gamePk = r[0];
    const gameDateRaw = r[2];
    const awayAbbr = mlbCanonicalTeamAbbr_(r[3]);
    const homeAbbr = mlbCanonicalTeamAbbr_(r[4]);
    const matchup = String(r[5] || '');
    const awayProb = String(r[6] || '');
    const homeProb = String(r[7] || '');
    if (!gameDateRaw) return;
    const dt = new Date(gameDateRaw);
    if (isNaN(dt.getTime())) return;
    const startEt = Utilities.formatDate(dt, 'America/New_York', 'HH:mm');
    const startEtMin = parseInt(startEt.slice(0, 2), 10) * 60 + parseInt(startEt.slice(3), 10);
    if (startEtMin > cutoffMin) return;
    eligibleGames++;

    const flagsBase = [];
    if (dt.getTime() < now.getTime()) flagsBase.push('already_started');

    const h2h = mlbEarlyWinLookupH2H_(h2hByGameNorm, matchup, awayAbbr, homeAbbr);
    let awayPrice = '';
    let homePrice = '';
    if (h2h && h2h.teams && h2h.teams.length) {
      h2h.teams.forEach(function (t) {
        const abbr = mlbAbbrFromTeamName_(t.name);
        const canon = mlbCanonicalTeamAbbr_(abbr || '');
        if (canon === awayAbbr) awayPrice = t.price;
        else if (canon === homeAbbr) homePrice = t.price;
      });
    }

    // De-vig the two-way ML once per game so p_win reflects true outcome, not
    // the book's hold. Falls back to raw implied per side when only one price.
    const devig = mlbEarlyWinDevig_(awayPrice, homePrice);

    [
      { side: 'Away', abbr: awayAbbr, sp: awayProb, oppSp: homeProb, price: awayPrice, devigP: devig ? devig.away : NaN },
      { side: 'Home', abbr: homeAbbr, sp: homeProb, oppSp: awayProb, price: homePrice, devigP: devig ? devig.home : NaN },
    ].forEach(function (s) {
      const flags = flagsBase.slice();
      const american = parseFloat(String(s.price == null ? '' : s.price).trim());
      let decimal = NaN;
      let pWin = NaN;
      let pRedeem = NaN;
      let evPerDollar = NaN;
      let evMaxBet = NaN;
      let effBoost = leadBoost;
      if (isNaN(american)) {
        flags.push('no_ml_price');
      } else {
        decimal = mlbEarlyWinDecimalFromAmerican_(american);
        // Prefer the de-vigged (no-hold) win prob; fall back to raw implied.
        if (!isNaN(s.devigP)) {
          pWin = s.devigP;
        } else {
          pWin = mlbEarlyWinAmericanImplied_(american);
          flags.push('vig_in_pwin');
        }
        effBoost = mlbEarlyWinEffectiveBoost_(pWin, leadBoost, leadBoostPickem);
        pRedeem = mlbEarlyWinPRedeem_(pWin, effBoost);
        evPerDollar = mlbEarlyWinEvPerDollar_(pRedeem, decimal);
        if (!isNaN(evPerDollar)) evMaxBet = evPerDollar * maxBet;
      }
      out.push({
        gamePk: gamePk,
        matchup: matchup,
        startEt: startEt,
        team: s.abbr,
        side: s.side,
        teamSp: s.sp,
        oppSp: s.oppSp,
        ml: isNaN(american) ? '' : american,
        decimal: isNaN(decimal) ? '' : Math.round(decimal * 1000) / 1000,
        pWin: isNaN(pWin) ? '' : Math.round(pWin * 1000) / 1000,
        leadBoost: Math.round(effBoost * 1000) / 1000,
        pRedeem: isNaN(pRedeem) ? '' : Math.round(pRedeem * 1000) / 1000,
        ev1: isNaN(evPerDollar) ? '' : Math.round(evPerDollar * 1000) / 1000,
        evMax: isNaN(evMaxBet) ? '' : Math.round(evMaxBet * 100) / 100,
        evNum: isNaN(evPerDollar) ? -Infinity : evPerDollar,
        redeemNum: isNaN(pRedeem) ? -Infinity : pRedeem,
        startMin: startEtMin,
        flags: flags.join('; '),
      });
    });
  });

  // Outcome-first: the promo cashes when the team is leading early, so rank by
  // redeem probability (most likely to cash), not EV. Legacy 'ev' mode ranks by
  // EV. EV is kept as a guardrail when picking the recommended play.
  const pickMode = mlbPickBy_(cfg);
  out.sort(function (a, b) {
    const ka = pickMode === 'ev' ? a.evNum : a.redeemNum;
    const kb = pickMode === 'ev' ? b.evNum : b.redeemNum;
    if (ka === kb) return a.startMin - b.startMin;
    return kb - ka;
  });

  let evGuard = parseFloat(
    String(cfg && cfg['EARLY_WIN_PICK_MIN_EV'] != null ? cfg['EARLY_WIN_PICK_MIN_EV'] : '0').trim()
  );
  if (isNaN(evGuard)) evGuard = 0;
  let bestIdx = -1;
  for (let i = 0; i < out.length; i++) {
    if (out[i].ev1 === '' || out[i].flags.indexOf('already_started') !== -1) continue;
    // 'ev' mode keeps the strict positive-EV rule; outcome mode honors the
    // configurable guardrail so we recommend the most-likely-to-cash side.
    const pass = pickMode === 'ev' ? out[i].evNum > 0 : out[i].evNum >= evGuard;
    if (pass) {
      bestIdx = i;
      break;
    }
  }

  const rows = out.map(function (o, i) {
    return [
      o.gamePk,
      o.matchup,
      o.startEt,
      o.team,
      o.side,
      o.teamSp,
      o.oppSp,
      o.ml,
      o.decimal,
      o.pWin,
      o.leadBoost,
      o.pRedeem,
      o.ev1,
      o.evMax,
      i === bestIdx ? 'PICK' : '',
      o.flags,
    ];
  });

  let tabNote = '';
  if (!eligibleGames) {
    tabNote = 'no games at or before cutoff ET — raise EARLY_WIN_CUTOFF_ET or check slate';
  } else if (!Object.keys(h2hByGameNorm).length) {
    tabNote = 'no h2h rows on FanDuel odds tab — run Fetch MLB Odds';
  } else if (!out.length) {
    tabNote = 'no team-rows built — check schedule + odds join';
  }

  mlbEarlyWinWriteTab_(ss, slate, cutoffMin, leadBoost, maxBet, rows, tabNote);
  ss.toast(
    out.length + ' team-rows · ' + (bestIdx >= 0 ? 'pick=' + out[bestIdx].team + ' ' + out[bestIdx].matchup : 'no pick'),
    'Early Win',
    6
  );
}

function mlbEarlyWinWriteTab_(ss, slate, cutoffMin, leadBoost, maxBet, rows, note) {
  let sh = ss.getSheetByName(MLB_EARLY_WIN_TAB);
  if (sh) {
    const cr = Math.max(sh.getLastRow(), 3);
    const cc = Math.min(Math.max(sh.getLastColumn(), 16), sh.getMaxColumns());
    try { sh.getRange(1, 1, cr, cc).breakApart(); } catch (e) {}
    sh.clearContents();
    sh.clearFormats();
  } else {
    sh = ss.insertSheet(MLB_EARLY_WIN_TAB);
  }
  sh.setTabColor('#6a1b9a');
  const NEED_COLS = 16;
  if (sh.getMaxColumns() < NEED_COLS) {
    sh.insertColumnsAfter(sh.getMaxColumns(), NEED_COLS - sh.getMaxColumns());
  }
  [72, 220, 64, 56, 56, 140, 140, 64, 64, 64, 64, 64, 72, 72, 64, 220].forEach(function (w, i) {
    sh.setColumnWidth(i + 1, w);
  });

  const cutH = Math.floor(cutoffMin / 60);
  const cutM = cutoffMin % 60;
  const cutLabel = (cutH > 12 ? cutH - 12 : cutH) + ':' + (cutM < 10 ? '0' + cutM : cutM) + (cutH >= 12 ? ' PM' : ' AM');
  sh.getRange(1, 1, 1, NEED_COLS)
    .merge()
    .setValue(
      '🎟️ Early Win Card · slate ' + slate +
      ' · cutoff ' + cutLabel + ' ET' +
      ' · lead_boost=' + leadBoost +
      ' · max_bet=$' + maxBet +
      (note ? '  ⚠ ' + note : '') +
      '   h2h join uses normalized game keys (schedule ↔ FanDuel). Sort: p_redeem (outcome) or EV (legacy).'
    )
    .setFontWeight('bold')
    .setBackground('#4a148c')
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center')
    .setWrap(true);
  sh.setRowHeight(1, 40);

  const headers = [
    'gamePk',
    'matchup',
    'start_ET',
    'team',
    'side',
    'team_SP',
    'opp_SP',
    'ml_american',
    'ml_decimal',
    'p_win_novig',
    'lead_boost',
    'p_redeem',
    'ev_per_$1',
    'ev_$' + maxBet,
    'pick',
    'flags',
  ];
  sh.getRange(3, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight('bold')
    .setBackground('#8e24aa')
    .setFontColor('#ffffff');
  if (typeof mlbApplyHeaderNotes_ === 'function') mlbApplyHeaderNotes_(sh, 3, headers);
  sh.setFrozenRows(3);

  if (rows.length) {
    const n = rows.length;
    sh.getRange(4, 1, n, headers.length).setValues(rows);
    sh.getRange(4, 9, n, 1).setNumberFormat('0.000');
    sh.getRange(4, 10, n, 1).setNumberFormat('0.0%');
    sh.getRange(4, 11, n, 1).setNumberFormat('0.000');
    sh.getRange(4, 12, n, 1).setNumberFormat('0.0%');
    sh.getRange(4, 13, n, 1).setNumberFormat('+0.000;-0.000');
    sh.getRange(4, 14, n, 1).setNumberFormat('+$0.00;-$0.00');
    try {
      ss.setNamedRange('MLB_EARLY_WIN_CARD', sh.getRange(4, 1, n, headers.length));
    } catch (e) {}
    if (typeof mlbApplyPropCardFormatting_ === 'function') {
      mlbApplyPropCardFormatting_(sh, rows, headers, {
        startRow: 4,
        headerRow: 3,
        skipHeaderNotes: true,
        cols: { team: 'team', pick: 'pick', proj: 'p_redeem' },
      });
    }
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][15] || '').indexOf('already_started') !== -1) {
        sh.getRange(4 + i, 1, 1, headers.length).setBackground('#eeeeee').setFontColor('#9e9e9e');
      }
    }
  }
}

/** Menu wrapper. */
function mlbActivateEarlyWinTab_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(MLB_EARLY_WIN_TAB);
  if (sh) sh.activate();
  else safeAlert_('Early Win', 'Run "🎟️ Early Win card only" first.');
}
