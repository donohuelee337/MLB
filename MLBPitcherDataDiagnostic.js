// ============================================================
// 🩺 Pitcher data diagnostic — schedule → models → promos
// ============================================================
// Audits whether opposing-SP context is present and used across:
//   📅 MLB_Schedule, 🧪 Batter_Hits_Card_v2-full, 📣 HR/GS Promo, 🔥 Streak_Picks
// Run after Morning/Midday pipeline or when opp_sp_miss / sp_missing warnings spike.
// ============================================================

const MLB_PITCHER_DATA_DIAG_TAB = '🩺 Pitcher_Data_Diagnostic';

function runPitcherDataDiagnostic() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig();
  const season = mlbSlateSeasonYear_(cfg);
  const report = mlbBuildPitcherDataDiagnosticReport_(ss, cfg, season);
  mlbWritePitcherDataDiagnosticTab_(ss, report);
  ss.toast(
    report.issueCount + ' issue(s) · ' + report.sections.length + ' section(s) — see ' + MLB_PITCHER_DATA_DIAG_TAB,
    'Pitcher diagnostic',
    8
  );
  try {
    ss.getSheetByName(MLB_PITCHER_DATA_DIAG_TAB).activate();
  } catch (e) {}
}

/**
 * @returns {{sections: !Array, issueCount: number, season: number}}
 */
function mlbBuildPitcherDataDiagnosticReport_(ss, cfg, season) {
  const sections = [];
  let issueCount = 0;

  function addSection(title, rows, issues) {
    const iss = issues || [];
    issueCount += iss.length;
    sections.push({ title: title, rows: rows, issues: iss });
  }

  // --- Schedule probables -------------------------------------------------
  const sched = ss.getSheetByName(MLB_SCHEDULE_TAB);
  if (!sched || sched.getLastRow() < 4) {
    addSection('📅 MLB_Schedule', [], ['tab missing or no data rows — run schedule first']);
  } else {
    const data = sched.getRange(4, 1, sched.getLastRow() - 3, 14).getValues();
    let games = 0;
    let missAwayId = 0;
    let missHomeId = 0;
    let missBoth = 0;
    data.forEach(function (r) {
      const g = parseInt(r[0], 10);
      if (!g) return;
      games++;
      const awayId = parseInt(r[11], 10);
      const homeId = parseInt(r[12], 10);
      if (!awayId) missAwayId++;
      if (!homeId) missHomeId++;
      if (!awayId && !homeId) missBoth++;
    });
    const rows = [
      ['games', games],
      ['missing away_prob_id', missAwayId],
      ['missing home_prob_id', missHomeId],
      ['missing both probables', missBoth],
    ];
    const issues = [];
    if (games === 0) issues.push('no games on slate');
    if (missBoth > 0) issues.push(missBoth + ' game(s) have no probable pitcher IDs — HR/GS/Streak opp SP will be neutral');
    addSection('📅 MLB_Schedule (probable SP IDs)', rows, issues);
  }

  const minIp = mlbOppSpMinIp_(cfg);

  // --- Hits v2 card -------------------------------------------------------
  const hits = ss.getSheetByName(MLB_BATTER_HITS_V2_CARD_TAB);
  if (!hits || hits.getLastRow() < 4) {
    addSection('🧪 Batter_Hits_Card_v2-full', [], ['tab missing or empty']);
  } else {
    const data = hits.getRange(4, 1, hits.getLastRow() - 3, 34).getValues();
    let n = 0;
    let noSp = 0;
    let lowIp = 0;
    let neutralMult = 0;
    let hasLambda = 0;
    data.forEach(function (r) {
      const batter = String(r[2] || '').trim();
      if (!batter) return;
      n++;
      const spName = String(r[27] || '').trim();
      const oppMult = parseFloat(String(r[20]));
      const oppIp = parseFloat(String(r[30]));
      const flags = String(r[16] || '');
      const lam = parseFloat(String(r[6]));
      if (!isNaN(lam) && lam > 0) hasLambda++;
      if (!spName && flags.indexOf('no_opp_sp') !== -1) noSp++;
      else if (!spName) noSp++;
      if (!isNaN(oppMult) && Math.abs(oppMult - 1) < 0.001) neutralMult++;
      if (!isNaN(oppIp) && oppIp > 0 && oppIp < minIp) lowIp++;
    });
    const rows = [
      ['batter rows', n],
      ['rows w/ λ', hasLambda],
      ['missing opp_sp_name / no_opp_sp', noSp],
      ['opp_sp_mult ≈ 1.0', neutralMult],
      ['opp_sp_ip < ' + minIp + ' (thin SP sample)', lowIp],
    ];
    const issues = [];
    if (n > 0 && noSp / n > 0.15) {
      issues.push(Math.round((100 * noSp) / n) + '% missing opp SP — check batter team abbr + schedule IDs');
    }
    if (n > 0 && lowIp / n > 0.2) {
      issues.push(Math.round((100 * lowIp) / n) + '% rows have SP IP below OPP_SP_MIN_IP — mult should be gated');
    }
    addSection('🧪 Batter_Hits_Card_v2-full (opp SP used in λ)', rows, issues);
  }

  // --- HR promo -----------------------------------------------------------
  const hr = ss.getSheetByName(MLB_BATTER_HR_PROMO_TAB);
  if (!hr || hr.getLastRow() < 4) {
    addSection('📣 Batter_HR_Promo', [], ['tab missing or empty — run HR promo refresh']);
  } else {
    const data = hr.getRange(4, 1, hr.getLastRow() - 3, 19).getValues();
    let n = 0;
    let spMissing = 0;
    let pmNeutral = 0;
    let lowConf = 0;
    data.forEach(function (r) {
      const batter = String(r[3] || '').trim();
      if (!batter) return;
      n++;
      const spId = parseInt(r[13], 10);
      const pm = parseFloat(String(r[15]));
      const conf = String(r[10] || '').toLowerCase();
      const reason = String(r[11] || '');
      if (!spId || reason.indexOf('sp_missing') !== -1) spMissing++;
      if (!isNaN(pm) && Math.abs(pm - 1) < 0.001) pmNeutral++;
      if (conf === 'low') lowConf++;
    });
    const rows = [
      ['promo rows', n],
      ['sp_missing / no opponent_sp_id', spMissing],
      ['pitcher_mult ≈ 1.0', pmNeutral],
      ['confidence=low', lowConf],
    ];
    const issues = [];
    if (n > 0 && spMissing / n > 0.1) {
      issues.push(Math.round((100 * spMissing) / n) + '% rows lack SP — pitcher_mult stuck at 1');
    }
    addSection('📣 Batter_HR_Promo', rows, issues);
  }

  // --- GS promo (inherits HR λ + pitcher_mult) ----------------------------
  const gs = ss.getSheetByName(MLB_BATTER_GS_PROMO_TAB);
  if (!gs || gs.getLastRow() < 4) {
    addSection('💎 Batter_GS_Promo', [], ['tab missing or empty — runs after HR promo']);
  } else {
    const data = gs.getRange(4, 1, gs.getLastRow() - 3, 20).getValues();
    let n = 0;
    let spMissing = 0;
    data.forEach(function (r) {
      const batter = String(r[3] || '').trim();
      if (!batter) return;
      n++;
      const spId = parseInt(r[13], 10);
      if (!spId) spMissing++;
    });
    addSection(
      '💎 Batter_GS_Promo (inherits HR pitcher_mult)',
      [
        ['promo rows', n],
        ['missing opponent_sp_id', spMissing],
      ],
      n > 0 && spMissing / n > 0.1 ? ['GS inherits HR SP gaps — fix schedule/HR first'] : []
    );
  }

  // --- Streak picks -------------------------------------------------------
  const streak = ss.getSheetByName(MLB_STREAK_PICKS_TAB);
  if (!streak || streak.getLastRow() < 4) {
    addSection('🔥 Streak_Picks', [], ['tab missing or empty']);
  } else {
    const data = streak.getRange(4, 1, streak.getLastRow() - 3, 18).getValues();
    let n = 0;
    let noSp = 0;
    let noK9 = 0;
    let noPen = 0;
    let picks = 0;
    data.forEach(function (r) {
      const batter = String(r[2] || '').trim();
      if (!batter) return;
      n++;
      if (r[15] === true) picks++;
      const notes = String(r[17] || '');
      if (notes.indexOf('no_opp_sp') !== -1) noSp++;
      if (notes.indexOf('no_sp_k9') !== -1) noK9++;
      if (notes.indexOf('no_pen_h9') !== -1) noPen++;
    });
    addSection(
      '🔥 Streak_Picks (schedule + shared K/9 + pen H/9)',
      [
        ['candidates', n],
        ['is_pick=TRUE', picks],
        ['notes: no_opp_sp', noSp],
        ['notes: no_sp_k9', noK9],
        ['notes: no_pen_h9', noPen],
      ],
      (function () {
        const issues = [];
        if (n > 0 && noSp / n > 0.15) issues.push('many rows missing opp SP — Streak K/9/pen adjustments skipped');
        if (n > 0 && noK9 / n > 0.2) issues.push('SP K/9 often blank — warm pitcher game logs or rely on shared season pitching');
        return issues;
      })()
    );
  }

  // --- Bet card (reads pre-built cards; no direct SP λ) -------------------
  const card = ss.getSheetByName(MLB_BET_CARD_TAB);
  if (!card || card.getLastRow() < 4) {
    addSection('🃏 MLB_Bet_Card', [], ['no bet rows — models may not have qualified plays']);
  } else {
    const data = card.getRange(4, 1, card.getLastRow() - 3, 19).getValues();
    let n = 0;
    let hits = 0;
    data.forEach(function (r) {
      const player = String(r[5] || '').trim();
      if (!player || player.indexOf('No qualifying') !== -1) return;
      n++;
      if (String(r[6] || '').indexOf('hit') !== -1) hits++;
    });
    addSection(
      '🃏 MLB_Bet_Card',
      [
        ['qualifying plays', n],
        ['batter hits plays', hits],
        ['note', 'Hits λ already includes opp SP via v2 card; K card uses opp team K% not batter opp SP'],
      ],
      []
    );
  }

  return { sections: sections, issueCount: issueCount, season: season };
}

function mlbWritePitcherDataDiagnosticTab_(ss, report) {
  let sh = ss.getSheetByName(MLB_PITCHER_DATA_DIAG_TAB);
  if (!sh) sh = ss.insertSheet(MLB_PITCHER_DATA_DIAG_TAB);
  sh.clear();
  sh.setTabColor('#5d4037');

  const tz = ss.getSpreadsheetTimeZone() || 'America/New_York';
  const stamp = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm');
  sh.getRange(1, 1)
    .setValue(
      '🩺 Pitcher data diagnostic — ' +
        stamp +
        ' · season ' +
        report.season +
        ' · ' +
        report.issueCount +
        ' issue(s)'
    )
    .setFontWeight('bold');

  let row = 3;
  report.sections.forEach(function (sec) {
    sh.getRange(row, 1).setValue(sec.title).setFontWeight('bold').setBackground('#4e342e').setFontColor('#fff');
    row++;
    if (sec.issues.length) {
      sh.getRange(row, 1, 1, 2).setValues([['⚠ issues', sec.issues.join(' · ')]]);
      sh.getRange(row, 1, 1, 2).setBackground('#ffebee');
      row++;
    }
    if (sec.rows.length) {
      sec.rows.forEach(function (r) {
        sh.getRange(row, 1, 1, 2).setValues([[r[0], r[1]]]);
        row++;
      });
    } else {
      sh.getRange(row, 1).setValue('(no data)');
      row++;
    }
    row++;
  });

  sh.setColumnWidth(1, 320);
  sh.setColumnWidth(2, 200);
}

/** Min IP on opposing SP season line before opp mult / HR9 is trusted. */
function mlbOppSpMinIp_(cfg) {
  const raw = String(cfg && cfg['OPP_SP_MIN_IP'] != null ? cfg['OPP_SP_MIN_IP'] : '10').trim();
  const n = parseFloat(raw, 10);
  return !isNaN(n) && n > 0 ? n : 10;
}
