// ============================================================
// Shared pitcher K λ — used by live card + walk-forward backtest
// ============================================================
// Depends: MLBPitcherKBetCard.js (k9/ip helpers), MLBMatchupContext.js,
//          MLBParkFactors.js, Config.js
// ============================================================

function mlbBuildPitcherKLambda_(input) {
  const cfg = input.cfg || getConfig();
  const k9eff =
    typeof mlbEffectiveK9ForLambdaV2_ === 'function'
      ? mlbEffectiveK9ForLambdaV2_(input.k9raw, input.l3k, input.l3ip, input.gamesRaw, cfg)
      : mlbEffectiveK9ForLambda_(input.k9raw, input.l3k, input.l3ip, cfg);
  const projIp =
    typeof mlbProjIpFromQueueRowV2_ === 'function'
      ? mlbProjIpFromQueueRowV2_(input.l3ip, input.gamesRaw)
      : mlbProjIpFromQueueRow_(input.l3ip);
  if (isNaN(k9eff) || k9eff <= 0) {
    return { lambda: NaN, lambdaPitcher: NaN, mMatchup: 1, mPark: 1, projIp: projIp, k9eff: k9eff };
  }

  let lambdaPitcher = Math.round(((k9eff / 9) * projIp) * 100) / 100;
  const homeAbbr = input.homeAbbr || '';
  const mPark = mlbParkKLambdaMultForHomeAbbr_(homeAbbr);
  lambdaPitcher = Math.round(lambdaPitcher * mPark * 100) / 100;

  const mMatchup = mlbBuildMatchupMultiplier_({
    cfg: cfg,
    oppKVsHand: input.oppKVsHand,
    homeAbbr: homeAbbr,
    lineupWhiff: input.lineupWhiff,
  });

  const lambdaUncapped = Math.round(lambdaPitcher * mMatchup * 100) / 100;

  // Plausibility clamp — DATA-ERROR GUARD, not a reliever ban. No single MLB
  // start realistically projects above ~13 K, so a higher λ means a bad input
  // row (e.g. a reliever mis-tagged with starter innings, or a corrupt IP/K9).
  // Legitimate openers / short spot-starts are untouched: their small projIp
  // yields a small λ well under the cap, so role is never inspected. Clamping
  // here protects BOTH the live card and the walk-forward calibration samples
  // that feed 🎯 K_Calibration. K_LAMBDA_MAX = 0 or blank disables the clamp.
  const lamMaxRaw = parseFloat(String(cfg['K_LAMBDA_MAX'] != null ? cfg['K_LAMBDA_MAX'] : '13'));
  const lamMax = !isNaN(lamMaxRaw) && lamMaxRaw > 0 ? lamMaxRaw : Infinity;
  const lambda = lambdaUncapped > lamMax ? lamMax : lambdaUncapped;
  const lambdaPitcherCapped = lambdaPitcher > lamMax ? lamMax : lambdaPitcher;

  return {
    lambda: lambda,
    lambdaPitcher: lambdaPitcherCapped,
    lambdaUncapped: lambdaUncapped,
    lambdaClamped: lambdaUncapped > lamMax,
    mMatchup: mMatchup,
    mPark: mPark,
    projIp: projIp,
    k9eff: k9eff,
  };
}

function mlbProxyKLineFromPriorStarts_(priorKs) {
  const arr = (priorKs || []).filter(function (x) {
    return !isNaN(x);
  });
  if (!arr.length) return 5.5;
  arr.sort(function (a, b) {
    return a - b;
  });
  const mid = arr[Math.floor(arr.length / 2)];
  return Math.round((Math.round(mid * 2) / 2) * 10) / 10;
}

function mlbGradeKSide_(actualK, line, side) {
  const k = parseInt(actualK, 10);
  const L = parseFloat(line);
  if (isNaN(k) || isNaN(L)) return 'VOID';
  const isHalf = Math.abs(L * 2 - Math.round(L * 2)) > 1e-6;
  if (isHalf) {
    if (k === Math.floor(L)) return 'PUSH';
  }
  if (side === 'Over') return k > L ? 'WIN' : k < L ? 'LOSS' : 'PUSH';
  if (side === 'Under') return k < L ? 'WIN' : k > L ? 'LOSS' : 'PUSH';
  return 'VOID';
}
