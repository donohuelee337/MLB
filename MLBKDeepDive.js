// ============================================================
// 🧠 K Deep Dive — Claude (Anthropic) soft-news / truth test
// ============================================================
// API key: Script Properties → ANTHROPIC_API_KEY (never in ⚙️ Config cells).
// Model id: ⚙️ ANTHROPIC_MODEL (default claude-sonnet-4-6).
// ============================================================

const MLB_K_DEEP_DIVE_TAB = '🧠 K_Deep_Dive';
const MLB_K_DD_MODEL_FALLBACK = 'claude-sonnet-4-6';
const MLB_K_DD_MAX_TOKENS = 1024;
const MLB_K_DD_COOLDOWN_MS = 1800;

function getAnthropicApiKey_() {
  const key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (key && String(key).trim()) return String(key).trim();
  return '';
}

function mlbAnthropicModelFromCfg_(cfg) {
  const m = String(cfg['ANTHROPIC_MODEL'] != null ? cfg['ANTHROPIC_MODEL'] : '').trim();
  return m || MLB_K_DD_MODEL_FALLBACK;
}

/**
 * @return {{ ok: boolean, text: string, err: string }}
 */
function mlbClaudeComplete_(prompt, apiKey, modelId) {
  const model = String(modelId || MLB_K_DD_MODEL_FALLBACK).trim() || MLB_K_DD_MODEL_FALLBACK;
  const response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    payload: JSON.stringify({
      model: model,
      max_tokens: MLB_K_DD_MAX_TOKENS,
      messages: [{ role: 'user', content: prompt }],
    }),
    muteHttpExceptions: true,
  });
  const code = response.getResponseCode();
  const body = response.getContentText();
  if (code !== 200) {
    return { ok: false, text: '', err: 'Anthropic HTTP ' + code + ': ' + body.substring(0, 320) };
  }
  const json = JSON.parse(body);
  const text =
    json.content && json.content[0] && json.content[0].text ? String(json.content[0].text) : '';
  return { ok: true, text: text, err: '' };
}

function mlbParseClaudeKVerdict_(text) {
  const t = String(text || '');
  const upper = t.toUpperCase();
  let verdict = 'REVIEW';
  if (upper.indexOf('VERDICT: PASS') !== -1 || upper.indexOf('FINAL: PASS') !== -1) {
    verdict = 'PASS';
  } else if (upper.indexOf('VERDICT: REJECT') !== -1 || upper.indexOf('FINAL: REJECT') !== -1) {
    verdict = 'REJECT';
  } else if (upper.indexOf('VERDICT: REVIEW') !== -1) {
    verdict = 'REVIEW';
  }
  const note = t.length > 480 ? t.substring(0, 477) + '…' : t;
  return { verdict: verdict, note: note.replace(/\n/g, ' ').trim() };
}

function mlbBuildKDeepDivePrompt_(facts) {
  return (
    'You are a sharp MLB pitching analyst. This is a TRUTH TEST on a single pitcher K prop.\n' +
    'The math engine already found a discrepancy vs a typical FanDuel-style line (we may not have the exact historical price).\n\n' +
    'Respond in this exact format:\n' +
    'VERDICT: PASS | REVIEW | REJECT\n' +
    'REASON: (2-4 sentences — matchup, form, park, bullpen risk, weather if relevant; no roster lists)\n\n' +
    'PASS = you agree the model side is plausible +EV.\n' +
    'REVIEW = mixed signals; human should decide.\n' +
    'REJECT = narrative strongly disagrees with the model side.\n\n' +
    'FACTS:\n' +
    '- Date: ' +
    facts.date +
    '\n' +
    '- Pitcher: ' +
    facts.pitcher +
    ' (' +
    facts.throws +
    'HP) vs ' +
    facts.opp +
    '\n' +
    '- Model λ (expected K): ' +
    facts.lambda +
    '\n' +
    '- Fair K line (50/50 Poisson): ' +
    facts.fairLine +
    '\n' +
    '- Market proxy line: ' +
    facts.marketLine +
    ' (gap fair−market: ' +
    facts.lineGap +
    ')\n' +
    '- Model side: ' +
    facts.modelSide +
    ' @ ~' +
    facts.odds +
    '\n' +
    '- P(model win) calibrated: ' +
    facts.pCal +
    ' vs P(market implied): ' +
    facts.pMarket +
    ' → gap ' +
    facts.pGap +
    '\n' +
    '- Opp K rate (context): ' +
    (facts.oppK || 'n/a') +
    ' · Park K mult: ' +
    (facts.parkMult || '1') +
    '\n' +
    (facts.injuryNote ? '- Injury intel: ' + facts.injuryNote + '\n' : '') +
    (facts.live ? '- LIVE SLATE play (today).\n' : '- Historical walk-forward row.\n')
  );
}

function mlbInjurySnippetForTeam_(ss, teamAbbr) {
  try {
    const sh = ss.getSheetByName('🚑 MLB_Injury_Report');
    if (!sh || sh.getLastRow() < 4) return '';
    const ab = String(teamAbbr || '').trim().toUpperCase();
    if (!ab) return '';
    const data = sh.getRange(4, 1, Math.min(sh.getLastRow() - 3, 200), 6).getValues();
    const hits = [];
    data.forEach(function (r) {
      const team = String(r[0] || '').toUpperCase();
      if (team.indexOf(ab) !== -1 || ab.indexOf(team) !== -1) {
        hits.push(String(r[1] || '') + ' ' + String(r[2] || ''));
      }
    });
    return hits.slice(0, 4).join('; ');
  } catch (e) {
    return '';
  }
}

function mlbWriteKDeepDiveResultsTab_(ss, results) {
  let sh = ss.getSheetByName(MLB_K_DEEP_DIVE_TAB);
  if (!sh) sh = ss.insertSheet(MLB_K_DEEP_DIVE_TAB);
  sh.clear();
  sh.getRange(1, 1)
    .setValue('🧠 K Deep Dive (Claude) — ' + new Date())
    .setFontWeight('bold');
  const headers = [
    'source',
    'date',
    'pitcher',
    'side',
    'line',
    'p_gap',
    'verdict',
    'note',
    'model',
  ];
  sh.getRange(3, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  if (results.length) {
    sh.getRange(4, 1, results.length, headers.length).setValues(
      results.map(function (r) {
        return [
          r.source,
          r.date,
          r.pitcher,
          r.side,
          r.line,
          r.pGap,
          r.verdict,
          r.note,
          r.model,
        ];
      })
    );
  }
  sh.setTabColor('#4527a0');
}

/**
 * Claude review of flagged rows on 🧪 K_Discrepancy_Report.
 */
function runMLBKDeepDiveOnDiscrepancies() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const apiKey = getAnthropicApiKey_();
  if (!apiKey) {
    safeAlert_(
      'K Deep Dive',
      'Add ANTHROPIC_API_KEY in Apps Script → Project Settings → Script properties.\n' +
        '(Same key as AI-BOIZ / console.anthropic.com)'
    );
    return;
  }
  const discSh = ss.getSheetByName(MLB_K_WF_DISCREPANCY_TAB);
  if (!discSh || discSh.getLastRow() < 5) {
    safeAlert_('K Deep Dive', 'Run 🧪 K walk-forward backtest first (builds discrepancy tab).');
    return;
  }

  const cfg = getConfig();
  const model = mlbAnthropicModelFromCfg_(cfg);
  const maxN = parseInt(String(cfg['K_DEEP_DIVE_MAX_PLAYS'] || '8'), 10) || 8;
  const lastRow = discSh.getLastRow();
  const data = discSh.getRange(5, 1, lastRow - 4, 19).getValues();

  const targets = [];
  data.forEach(function (r, idx) {
    if (!r[0] || String(r[0]).indexOf('total_') === 0 || String(r[0]).indexOf('flagged') === 0) return;
    if (String(r[16]).toUpperCase() !== 'Y') return;
    if (String(r[17]).trim()) return;
    targets.push({ sheetRow: 5 + idx, r: r });
  });

  if (!targets.length) {
    safeAlert_('K Deep Dive', 'No flagged rows without claude_verdict. Lower K_WF_MIN_* or re-run walk-forward.');
    return;
  }

  const batch = targets.slice(0, maxN);
  ss.toast('Claude K deep dive: ' + batch.length + ' plays…', 'MLB-BOIZ', 8);

  const results = [];
  let errors = 0;

  batch.forEach(function (t, i) {
    if (i > 0) Utilities.sleep(MLB_K_DD_COOLDOWN_MS);
    const r = t.r;
    const opp = String(r[2] || '');
    const facts = {
      date: r[0],
      pitcher: r[1],
      opp: opp,
      throws: r[3],
      lambda: r[4],
      fairLine: r[5],
      marketLine: r[6],
      lineGap: r[7],
      modelSide: r[8],
      pCal: r[10],
      pMarket: r[11],
      pGap: r[12],
      odds: r[13],
      oppK: '',
      parkMult: '1',
      injuryNote: mlbInjurySnippetForTeam_(ss, opp),
      live: false,
    };
    const prompt = mlbBuildKDeepDivePrompt_(facts);
    const resp = mlbClaudeComplete_(prompt, apiKey, model);
    let verdict = 'ERR';
    let note = resp.err || '';
    if (resp.ok) {
      const parsed = mlbParseClaudeKVerdict_(resp.text);
      verdict = parsed.verdict;
      note = parsed.note;
    } else {
      errors++;
    }
    discSh.getRange(t.sheetRow, 18, 1, 2).setValues([[verdict, note]]);
    results.push({
      source: 'discrepancy',
      date: facts.date,
      pitcher: facts.pitcher,
      side: facts.modelSide,
      line: facts.marketLine,
      pGap: facts.pGap,
      verdict: verdict,
      note: note,
      model: model,
    });
  });

  mlbWriteKDeepDiveResultsTab_(ss, results);
  const msg =
    'Claude done: ' +
    results.length +
    ' reviewed' +
    (errors ? ' (' + errors + ' errors)' : '');
  ss.toast(msg, 'MLB-BOIZ', 8);
  safeAlert_('K Deep Dive', msg + '\n\nSee 🧠 K_Deep_Dive and discrepancy cols R–S.');
}

/**
 * Claude review of top EV rows on 🎰 Pitcher_K_Card (live slate).
 */
function runMLBKDeepDiveOnLiveKCard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const apiKey = getAnthropicApiKey_();
  if (!apiKey) {
    safeAlert_('K Deep Dive', 'Set Script property ANTHROPIC_API_KEY first.');
    return;
  }
  const card = ss.getSheetByName(MLB_PITCHER_K_CARD_TAB);
  if (!card || card.getLastRow() < 4) {
    safeAlert_('K Deep Dive', 'Build 🎰 Pitcher K card first.');
    return;
  }

  const cfg = getConfig();
  const model = mlbAnthropicModelFromCfg_(cfg);
  const maxN = parseInt(String(cfg['K_DEEP_DIVE_MAX_PLAYS'] || '8'), 10) || 8;
  const minEv = parseFloat(String(cfg['K_DEEP_DIVE_MIN_EV'] || '0.03'), 10) || 0.03;
  const minPgap = parseFloat(String(cfg['K_DEEP_DIVE_MIN_PWIN_GAP'] || '0.02'), 10) || 0.02;

  const lastRow = card.getLastRow();
  const data = card.getRange(4, 1, lastRow - 3, 25).getValues();
  const candidates = [];

  data.forEach(function (r) {
    const bestEv = parseFloat(r[17], 10);
    const bestSide = String(r[16] || '');
    if (isNaN(bestEv) || bestEv < minEv || !bestSide) return;
    const line = parseFloat(r[4], 10);
    const lambda = parseFloat(r[8], 10);
    const pOver = parseFloat(r[10], 10);
    const pUnder = parseFloat(r[11], 10);
    const imO = parseFloat(r[12], 10);
    const imU = parseFloat(r[13], 10);
    if (isNaN(line) || isNaN(lambda)) return;
    const side = bestSide === 'Under' ? 'Under' : 'Over';
    const pModel = side === 'Over' ? pOver : pUnder;
    const pMarket = side === 'Over' ? imO : imU;
    if (isNaN(pModel) || isNaN(pMarket)) return;
    const pGap = Math.round((pModel - pMarket) * 1000) / 1000;
    if (pGap < minPgap) return;
    const fairLine = mlbFairKLineFromLambda_(lambda);
    candidates.push({
      r: r,
      pGap: pGap,
      fairLine: fairLine,
      side: side,
      pModel: pModel,
      pMarket: pMarket,
    });
  });

  candidates.sort(function (a, b) {
    return parseFloat(b.r[17], 10) - parseFloat(a.r[17], 10);
  });
  const batch = candidates.slice(0, maxN);
  if (!batch.length) {
    safeAlert_(
      'K Deep Dive',
      'No live rows with best_ev≥' + minEv + ' and p_gap≥' + minPgap + '. Tune K_DEEP_DIVE_MIN_* in Config.'
    );
    return;
  }

  ss.toast('Claude live K review: ' + batch.length + '…', 'MLB-BOIZ', 8);
  const results = [];
  let errors = 0;

  batch.forEach(function (c, i) {
    if (i > 0) Utilities.sleep(MLB_K_DD_COOLDOWN_MS);
    const r = c.r;
    const opp = String(r[22] || '');
    const side = c.side;
    const odds = side === 'Over' ? r[5] : r[6];
    const facts = {
      date: getSlateDateString_(cfg),
      pitcher: r[3],
      opp: opp,
      throws: r[21],
      lambda: r[8],
      fairLine: c.fairLine,
      marketLine: r[4],
      lineGap: Math.round((c.fairLine - parseFloat(r[4], 10)) * 10) / 10,
      modelSide: side,
      pCal: c.pModel,
      pMarket: c.pMarket,
      pGap: c.pGap,
      odds: odds,
      oppK: r[23],
      parkMult: '1',
      injuryNote: mlbInjurySnippetForTeam_(ss, opp),
      live: true,
    };
    const resp = mlbClaudeComplete_(mlbBuildKDeepDivePrompt_(facts), apiKey, model);
    let verdict = 'ERR';
    let note = resp.err || '';
    if (resp.ok) {
      const parsed = mlbParseClaudeKVerdict_(resp.text);
      verdict = parsed.verdict;
      note = parsed.note;
    } else {
      errors++;
    }
    results.push({
      source: 'live_k_card',
      date: facts.date,
      pitcher: facts.pitcher,
      side: side,
      line: facts.marketLine,
      pGap: facts.pGap,
      verdict: verdict,
      note: note,
      model: model,
    });
  });

  mlbWriteKDeepDiveResultsTab_(ss, results);
  safeAlert_(
    'K Deep Dive (live)',
    'Reviewed ' + results.length + ' K card plays' + (errors ? ' (' + errors + ' API errors)' : '') + '.\nSee 🧠 K_Deep_Dive.'
  );
}

function mlbActivateKDeepDiveTab_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(MLB_K_DEEP_DIVE_TAB);
  if (sh) sh.activate();
  else ss.toast('Run K Deep Dive first', 'MLB-BOIZ', 5);
}

function mlbTestAnthropicConnection_() {
  const apiKey = getAnthropicApiKey_();
  if (!apiKey) {
    safeAlert_('Anthropic test', 'Missing ANTHROPIC_API_KEY script property.');
    return;
  }
  const cfg = getConfig();
  const model = mlbAnthropicModelFromCfg_(cfg);
  const resp = mlbClaudeComplete_('Reply with exactly: MLB-BOIZ OK', apiKey, model);
  if (resp.ok) {
    safeAlert_('Anthropic test', 'OK — model ' + model + '\n' + resp.text.substring(0, 120));
  } else {
    safeAlert_('Anthropic test', resp.err);
  }
}
