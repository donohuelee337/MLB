// ============================================================
// ⚾ Pipeline Log — funnel + warnings (MLB-BOIZ)
// ============================================================
// Ported from the former mlb-pitcher-k repo; single menu in PipelineMenu.js.

var pipelineLog_ = null;

var MLB_PIPELINE_LOG_TAB = '⚾ Pipeline_Log';

function resetPipelineLog_(window) {
  pipelineLog_ = {
    window: window || 'UNKNOWN',
    timestamp: new Date(),
    steps: [],
    gameCoverage: {},
    nearMisses: [],
    warnings: [],
  };
}

/** Data rows for tabs that use row 1 = title, row 3 = headers, row 4+ = data. */
function mlbTabDataRowsBelowHeader3_(ss, tabName) {
  const sh = ss.getSheetByName(tabName);
  if (!sh) return 0;
  const lr = sh.getLastRow();
  return lr > 3 ? lr - 3 : 0;
}

function logStep_(name, inputCount, outputCount, warningStr) {
  if (!pipelineLog_) return;
  pipelineLog_.steps.push({
    name: name,
    inputCount: inputCount || 0,
    outputCount: outputCount || 0,
    warnings: warningStr || '',
  });
}

function logGameCoverage_(game, awayProps, homeProps, simPicks, cardPicks) {
  if (!pipelineLog_) return;
  const g = String(game).trim();
  if (!g) return;
  if (!pipelineLog_.gameCoverage[g]) {
    pipelineLog_.gameCoverage[g] = {
      awayProps: 0,
      homeProps: 0,
      unknownProps: 0,
      simPicks: 0,
      cardPicks: 0,
    };
  }
  const entry = pipelineLog_.gameCoverage[g];
  if (awayProps !== null && awayProps !== undefined) entry.awayProps = awayProps;
  if (homeProps !== null && homeProps !== undefined) entry.homeProps = homeProps;
  if (simPicks !== null && simPicks !== undefined) entry.simPicks += simPicks;
  if (cardPicks !== null && cardPicks !== undefined) entry.cardPicks += cardPicks;
}

function logNearMiss_(player, game, market, side, score, signals, reason) {
  if (!pipelineLog_) return;
  pipelineLog_.nearMisses.push({
    player: player,
    game: game,
    market: market,
    side: side,
    score: score,
    signals: signals,
    reason: reason,
  });
}

function addPipelineWarning_(msg) {
  if (!pipelineLog_) return;
  pipelineLog_.warnings.push(msg);
}

function buildPipelineToast_() {
  if (!pipelineLog_) return '';
  const warnCount = pipelineLog_.warnings.length;
  let cardStep = null;
  pipelineLog_.steps.forEach(function (s) {
    if (s.name === 'MLB Bet Card') cardStep = s;
  });
  const playCount = cardStep ? cardStep.outputCount : 0;
  let gameCount = 0;
  Object.keys(pipelineLog_.gameCoverage).forEach(function (g) {
    if (pipelineLog_.gameCoverage[g].cardPicks > 0) gameCount++;
  });
  const base = playCount + ' plays across ' + gameCount + ' games';
  if (warnCount > 0) {
    return (
      base +
      ' | ' +
      warnCount +
      ' warning' +
      (warnCount > 1 ? 's' : '') +
      ' — check ' +
      MLB_PIPELINE_LOG_TAB
    );
  }
  return base + ' | No warnings';
}

function writePipelineLogTab_(ss) {
  if (!pipelineLog_) return;
  const log = pipelineLog_;
  const tz = Session.getScriptTimeZone();
  const dateStr = Utilities.formatDate(log.timestamp, tz, 'EEEE M/d/yyyy h:mm a');

  const logLines = [];
  logLines.push('===== ' + MLB_PIPELINE_LOG_TAB + ' — ' + log.window + ' ' + dateStr + ' =====');
  logLines.push('');
  logLines.push('FUNNEL:');
  log.steps.forEach(function (s) {
    const dropped = s.inputCount - s.outputCount;
    logLines.push(
      '  ' +
        s.name +
        ':  ' +
        s.inputCount +
        ' → ' +
        s.outputCount +
        (dropped > 0 ? ' (' + dropped + ' dropped)' : '') +
        (s.warnings ? ' — ' + s.warnings : '')
    );
  });
  logLines.push('');
  logLines.push('GAME COVERAGE:');
  Object.keys(log.gameCoverage).forEach(function (g) {
    const c = log.gameCoverage[g];
    logLines.push(
      '  ' + g + ':  away ' + c.awayProps + ' / home ' + c.homeProps + ' / sim ' + c.simPicks + ' / card ' + c.cardPicks
    );
  });
  if (log.nearMisses.length > 0) {
    logLines.push('');
    logLines.push('NEAR MISSES (top ' + Math.min(log.nearMisses.length, 5) + '):');
    log.nearMisses
      .sort(function (a, b) {
        return b.score - a.score;
      })
      .slice(0, 5)
      .forEach(function (m) {
        logLines.push(
          '  ' + m.player + ' | ' + m.game + ' | ' + m.market + ' ' + m.side + ' | Score ' + m.score + ' | ' + m.reason
        );
      });
  }
  if (log.warnings.length > 0) {
    logLines.push('');
    logLines.push('WARNINGS:');
    log.warnings.forEach(function (w) {
      logLines.push('  ' + w);
    });
  }
  Logger.log(logLines.join('\n'));

  let sh = ss.getSheetByName(MLB_PIPELINE_LOG_TAB);
  if (sh) {
    sh.clearContents();
    sh.clearFormats();
  } else {
    sh = ss.insertSheet(MLB_PIPELINE_LOG_TAB);
  }
  sh.setTabColor('#0D47A1');

  let row = 1;
  sh.getRange(row, 1, 1, 7)
    .merge()
    .setValue('⚾ PIPELINE LOG — ' + log.window + ' — ' + dateStr)
    .setFontSize(11)
    .setFontWeight('bold')
    .setBackground('#0D47A1')
    .setFontColor('#FFFFFF')
    .setHorizontalAlignment('center');
  sh.setRowHeight(row, 36);
  row += 2;

  sh.getRange(row, 1, 1, 5)
    .merge()
    .setValue('FUNNEL SUMMARY')
    .setFontWeight('bold')
    .setBackground('#1565C0')
    .setFontColor('#FFF')
    .setFontSize(10);
  sh.setRowHeight(row, 28);
  row++;
  sh.getRange(row, 1, 1, 5)
    .setValues([['Step', 'Input', 'Output', 'Dropped', 'Notes']])
    .setFontWeight('bold')
    .setBackground('#E3F2FD');
  row++;

  log.steps.forEach(function (s) {
    const dropped = s.inputCount - s.outputCount;
    sh.getRange(row, 1, 1, 5).setValues([[s.name, s.inputCount, s.outputCount, dropped, s.warnings]]);
    if (dropped > s.inputCount * 0.9 && s.inputCount > 0) {
      sh.getRange(row, 4).setBackground('#FFCDD2').setFontWeight('bold');
    }
    row++;
  });

  row++;
  sh.getRange(row, 1, 1, 7)
    .merge()
    .setValue('GAME COVERAGE')
    .setFontWeight('bold')
    .setBackground('#1565C0')
    .setFontColor('#FFF')
    .setFontSize(10);
  sh.setRowHeight(row, 28);
  row++;
  sh.getRange(row, 1, 1, 7)
    .setValues([['Game', 'First pitch', 'Away props', 'Home props', 'Sim picks', 'On card', 'Flags']])
    .setFontWeight('bold')
    .setBackground('#E3F2FD');
  row++;

  Object.keys(log.gameCoverage).forEach(function (g) {
    const c = log.gameCoverage[g];
    const flags = [];
    if (c.awayProps === 0 && c.homeProps > 0) flags.push('ONE-SIDED: 0 away');
    if (c.homeProps === 0 && c.awayProps > 0) flags.push('ONE-SIDED: 0 home');
    if (c.simPicks > 0 && c.cardPicks === 0) flags.push('NO CARD PLAYS');
    const flagStr = flags.length > 0 ? flags.join(', ') : 'OK';

    sh.getRange(row, 1, 1, 7).setValues([[g, '', c.awayProps, c.homeProps, c.simPicks, c.cardPicks, flagStr]]);
    if (c.cardPicks > 0) {
      sh.getRange(row, 6).setBackground('#C8E6C9').setFontWeight('bold');
    }
    row++;
  });

  row++;
  sh.getRange(row, 1, 1, 7)
    .merge()
    .setValue('NEAR MISSES')
    .setFontWeight('bold')
    .setBackground('#1565C0')
    .setFontColor('#FFF')
    .setFontSize(10);
  sh.setRowHeight(row, 28);
  row++;
  sh.getRange(row, 1, 1, 7)
    .setValues([['Player', 'Game', 'Market', 'Side', 'Score', 'Signals', 'Reason']])
    .setFontWeight('bold')
    .setBackground('#E3F2FD');
  row++;

  const misses = log.nearMisses
    .sort(function (a, b) {
      return b.score - a.score;
    })
    .slice(0, 15);
  misses.forEach(function (m) {
    sh.getRange(row, 1, 1, 7).setValues([[m.player, m.game, m.market, m.side, m.score, m.signals, m.reason]]);
    row++;
  });

  if (log.warnings.length > 0) {
    row++;
    sh.getRange(row, 1, 1, 7)
      .merge()
      .setValue('WARNINGS (' + log.warnings.length + ')')
      .setFontWeight('bold')
      .setBackground('#B71C1C')
      .setFontColor('#FFF')
      .setFontSize(10);
    sh.setRowHeight(row, 28);
    row++;
    log.warnings.forEach(function (w) {
      sh.getRange(row, 1, 1, 7).merge().setValue(String(w)).setBackground('#FFCDD2');
      row++;
    });
  }

  [250, 100, 80, 80, 80, 80, 300].forEach(function (w, i) {
    sh.setColumnWidth(i + 1, w);
  });
}

function mlbActivatePipelineLog_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(MLB_PIPELINE_LOG_TAB);
  if (sh) sh.activate();
  else ss.toast('Run the morning pipeline once to create ' + MLB_PIPELINE_LOG_TAB, 'MLB-BOIZ', 5);
}

/** After 🎰 Pitcher_K_Card is built: injury scratches that still had +EV on a side. */
function mlbAppendPitcherKNearMisses_(ss) {
  if (!pipelineLog_) return;
  const sh = ss.getSheetByName(MLB_PITCHER_K_CARD_TAB);
  if (!sh || sh.getLastRow() < 4) return;
  const vals = sh.getRange(4, 1, sh.getLastRow(), 25).getValues();
  vals.forEach(function (r) {
    const flags = String(r[18] || '');
    if (flags.indexOf('injury') === -1) return;
    const pitcher = String(r[3] || '').trim();
    const matchup = String(r[1] || '').trim();
    if (!pitcher || !matchup) return;
    const evO = parseFloat(String(r[14]));
    const evU = parseFloat(String(r[15]));
    let bestSide = '';
    let score = 0;
    if (!isNaN(evO) && evO > score) {
      score = evO;
      bestSide = 'Over';
    }
    if (!isNaN(evU) && evU > score) {
      score = evU;
      bestSide = 'Under';
    }
    if (score > 0) {
      logNearMiss_(pitcher, matchup, 'pitcher_strikeouts', bestSide, score, flags, 'Injury — model still liked a side');
    }
  });
}

/** After 🃏 MLB_Bet_Card: fill GAME COVERAGE cardPicks counts (AI-BOIZ-style funnel). */
function mlbAppendBetCardPipelineCoverage_(ss) {
  if (!pipelineLog_) return;
  const sh = ss.getSheetByName(MLB_BET_CARD_TAB);
  if (!sh || sh.getLastRow() < 4) return;
  // Bet card 0-indexed: 4=matchup, 5=play. See MLBBetCard.js headers.
  const data = sh.getRange(4, 1, sh.getLastRow(), 6).getValues();
  data.forEach(function (r) {
    const matchup = String(r[4] || '').trim();
    const play = String(r[5] || '');
    if (!matchup || play.indexOf('No qualifying') !== -1) return;
    logGameCoverage_(matchup, undefined, undefined, 0, 1);
  });
}
