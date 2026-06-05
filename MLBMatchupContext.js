// ============================================================
// Matchup context — fast-decay opponent / park / lineup signals
// ============================================================
// Used by MLBPitcherKLambdaCore.js (live + walk-forward) and
// mlbBackfillPitcherKLogsContext_ in MLBPitcherKLogsDB.js.
// Depends: MLBParkFactors.js, Config.js
// ============================================================

function mlbTeamKPaFromGameLogRows_(teamRows, throwsFilter) {
  let so = 0;
  let pa = 0;
  (teamRows || []).forEach(function (r) {
    const bf = parseFloat(r.bf) || 0;
    const k = parseFloat(r.kAgainst) || 0;
    if (bf <= 0) return;
    if (throwsFilter && r.pitcherThrows !== throwsFilter) return;
    so += k;
    pa += bf;
  });
  if (pa <= 0) return NaN;
  return Math.round((so / pa) * 10000) / 10000;
}

/**
 * Opponent K/PA known strictly before asOfDate (YYYY-MM-DD).
 * teamOffenseRows: rows where this team batted (opponent perspective).
 */
function mlbOppKRatesAsOf_(teamOffenseRows, asOfDate, pitcherThrows, cfg) {
  const cutoff = String(asOfDate);
  const prior = (teamOffenseRows || []).filter(function (r) {
    return String(r.date) < cutoff;
  });
  const l14Cut = new Date(cutoff);
  l14Cut.setDate(l14Cut.getDate() - 14);
  const l14Str = Utilities.formatDate(l14Cut, 'America/New_York', 'yyyy-MM-dd');
  const seasonRows = prior;
  const l14Rows = prior.filter(function (r) {
    return String(r.date) >= l14Str;
  });

  const seasonAll = mlbTeamKPaFromGameLogRows_(seasonRows, null);
  const seasonVs = mlbTeamKPaFromGameLogRows_(seasonRows, pitcherThrows);
  const l14All = mlbTeamKPaFromGameLogRows_(l14Rows, null);
  const l14Vs = mlbTeamKPaFromGameLogRows_(l14Rows, pitcherThrows);

  const blend = parseFloat(String(cfg['K_OPP_L14_BLEND'] != null ? cfg['K_OPP_L14_BLEND'] : '0.5')) || 0.5;
  function blendRates(season, l14) {
    if (isNaN(season) && isNaN(l14)) return NaN;
    if (isNaN(l14)) return season;
    if (isNaN(season)) return l14;
    return Math.round(((1 - blend) * season + blend * l14) * 10000) / 10000;
  }
  return {
    oppKSeason: seasonAll,
    oppKVsHand: !isNaN(seasonVs) ? seasonVs : seasonAll,
    oppKL14: blendRates(seasonVs, l14Vs),
  };
}

function mlbMatchupMultiplier_(oppKVsHand, leagueK, strength, cap) {
  if (isNaN(oppKVsHand) || isNaN(leagueK) || leagueK <= 0 || strength <= 0) return 1;
  const ratio = oppKVsHand / leagueK - 1;
  const bump = strength * ratio;
  const capped = Math.max(-cap, Math.min(cap, bump));
  return Math.round((1 + capped) * 1000) / 1000;
}

function mlbBuildMatchupMultiplier_(params) {
  const cfg = params.cfg || getConfig();
  const cap = parseFloat(String(cfg['K_MATCHUP_COMBINED_CAP'] != null ? cfg['K_MATCHUP_COMBINED_CAP'] : '0.25')) || 0.25;
  const leagueK = parseFloat(String(cfg['LEAGUE_HITTING_K_PA'] != null ? cfg['LEAGUE_HITTING_K_PA'] : '0.225')) || 0.225;
  const oppStr = parseFloat(String(cfg['K_OPP_K_STRENGTH'] != null ? cfg['K_OPP_K_STRENGTH'] : '0')) || 0;
  const hrStr = parseFloat(String(cfg['K_HR_PARK_STRENGTH'] != null ? cfg['K_HR_PARK_STRENGTH'] : '0')) || 0;
  const whiffStr = parseFloat(String(cfg['K_LINEUP_WHIFF_STRENGTH'] != null ? cfg['K_LINEUP_WHIFF_STRENGTH'] : '0')) || 0;

  let m = 1;
  m *= mlbMatchupMultiplier_(params.oppKVsHand, leagueK, oppStr, cap);
  if (hrStr > 0 && params.homeAbbr) {
    const hrContact = mlbParkHrKContactMultForHomeAbbr_(params.homeAbbr);
    const hrBump = hrStr * (hrContact - 1);
    m *= Math.round((1 + Math.max(-cap, Math.min(cap, hrBump))) * 1000) / 1000;
  }
  if (whiffStr > 0 && !isNaN(params.lineupWhiff) && !isNaN(leagueK)) {
    m *= mlbMatchupMultiplier_(params.lineupWhiff, leagueK, whiffStr, cap);
  }
  const lo = 1 - cap;
  const hi = 1 + cap;
  return Math.max(lo, Math.min(hi, Math.round(m * 1000) / 1000));
}
