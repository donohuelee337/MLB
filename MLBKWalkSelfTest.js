// ============================================================
// K walk-forward self-test — no-lookahead on mlbOppKRatesAsOf_
// ============================================================

/**
 * Verify opponent K rates use only games strictly before asOfDate.
 * @returns {string} 'OK …' on success
 */
function mlbKWalkSelfTest_() {
  const samples = [
    { date: '2026-05-01', bf: 20, kAgainst: 5, pitcherThrows: 'R' },
    { date: '2026-05-10', bf: 22, kAgainst: 6, pitcherThrows: 'R' },
    { date: '2026-05-15', bf: 18, kAgainst: 4, pitcherThrows: 'L' },
  ];
  const rates = mlbOppKRatesAsOf_(samples, '2026-05-15', 'R', getConfig());
  if (rates.oppKL14 === '' || isNaN(rates.oppKL14)) {
    throw new Error('lookahead self-test failed: oppKL14 missing');
  }
  const futureOnly = mlbOppKRatesAsOf_(samples, '2026-05-01', 'R', getConfig());
  if (!isNaN(futureOnly.oppKL14) && futureOnly.oppKL14 > 0) {
    throw new Error('lookahead self-test failed: rates computed with no prior games');
  }
  return 'OK n=' + samples.length + ' oppKL14=' + rates.oppKL14;
}

function mlbKWalkSelfTestMenu_() {
  try {
    const msg = mlbKWalkSelfTest_();
    safeAlert_('K walk-forward self-test', msg);
  } catch (e) {
    safeAlert_('K walk-forward self-test', String(e.message || e));
  }
}
