// ============================================================
// 📖 Column glossary — hover-note explanations for card headers
// ============================================================
// One place that explains what every column means. mlbApplyHeaderNotes_()
// attaches a Google Sheets note (mouse-over tooltip) to each header cell that
// has a glossary entry, so you can hover any title to see what it is and how to
// read it. Keys are matched case-insensitively against the header text.
// ============================================================

var MLB_COLUMN_GLOSSARY = {
  // — identifiers / context —
  'date': 'Slate date (the day these picks are for).',
  '#': 'Row number within the card (display order).',
  'gamePk': 'MLB Stats API game id — unique key for the game. Used to join odds, lineups, and results.',
  'matchup': 'Away @ Home teams for the game.',
  'start_et': 'First-pitch time, US Eastern (24h).',
  'time': 'First-pitch time (HH:mm) for the game.',
  'play': 'The recommended bet in plain English (player — market side line).',
  'player': 'Player the bet is on.',
  'pitcher': 'Starting pitcher the bet is on.',
  'batter': 'Batter the bet is on.',
  'market': 'What stat is being bet (e.g., pitcher strikeouts, batter hits).',
  'side': 'Which side we back: Over / Under (or NRFI / YRFI).',
  'away_sp': 'Away probable starting pitcher.',
  'home_sp': 'Home probable starting pitcher.',
  'throws': 'Pitcher handedness (R/L).',
  'games': 'Games (starts) of season sample behind the projection — small samples are less trustworthy.',
  'hp_umpire': 'Home-plate umpire (affects called strikes / run environment).',
  'hp_ump': 'Home-plate umpire (affects called strikes / run environment).',
  'lineup_top3': 'Y = both teams\u2019 top-3 hitters are confirmed in the posted lineup (firmer projection).',
  'hot_cold': 'Recent-form flag: HOT = last-5 above season pace, COLD = below.',
  'flags': 'Warnings about this row (injury, no FD line, unconfirmed lineup, no model, etc.). Read these before betting.',
  'player_id': 'MLB Stats API player id (internal join key).',
  'pitcher_id': 'MLB Stats API pitcher id (internal join key).',
  'batter_id': 'MLB Stats API batter id (internal join key).',

  // — the line / book prices —
  'line': 'FanDuel\u2019s posted line (the number you\u2019re betting over/under).',
  'odds': 'FanDuel American odds for the side we back. Negative = favorite (lay juice), positive = underdog.',
  'fd_line': 'FanDuel\u2019s posted line for this market.',
  'fd_f5_line': 'FanDuel first-5-innings total (runs) line.',
  'fd_f5_over': 'FanDuel odds on the F5 Over.',
  'fd_f5_under': 'FanDuel odds on the F5 Under.',
  'fd_f5_ml_away': 'FanDuel first-5-innings moneyline — away team.',
  'fd_f5_ml_home': 'FanDuel first-5-innings moneyline — home team.',
  'fd_er_line': 'FanDuel earned-runs line for the starter.',
  'fd_outs_line': 'FanDuel pitcher-outs (recorded outs) line.',
  'fd_tb_line': 'FanDuel batter total-bases line.',
  'fd_over': 'FanDuel American odds on the Over.',
  'fd_under': 'FanDuel American odds on the Under.',
  'fd_yrfi': 'FanDuel odds that a run scores in the 1st inning (YRFI / Over 0.5).',
  'fd_nrfi': 'FanDuel odds that NO run scores in the 1st inning (NRFI / Under 0.5).',

  // — our projection (the cumulative sanity-check) —
  'proj': 'OUR projection: the model\u2019s expected stat from ALL inputs combined (recent form, matchup, park, weather, umpire, etc.). Sanity-check vs the line — if proj sits far from the line, an input may be off.',
  'our proj': 'OUR projection: the model\u2019s expected stat from ALL inputs combined (recent form, matchup, park, weather, umpire, etc.). Sanity-check vs the line — if proj sits far from the line, an input may be off.',
  'proj \u2212 line': 'Our projection minus the FanDuel line = our raw edge in stat units. Big numbers are a red flag the model is off, not free money.',
  'edge (proj\u2212line)': 'Our projection minus the FanDuel line = our raw edge in stat units. Big numbers are a red flag the model is off, not free money.',
  'edge_vs_line': 'Our projection minus the FanDuel line (raw edge in stat units). Positive = lean Over; negative = lean Under.',
  'proj_K': 'Our projected strikeouts for this start (Poisson λ after park, matchup, ump, etc.).',
  'pick': 'Side we prefer when |proj_K − line| ≥ 0.5 (half-K bracket). Blank + gray row = agree with FD (agree_fd). Respects PICK_BY in Config.',
  'pick_ev_$1': 'Expected value per $1 on the picked side (reference / guardrail). Blank when agree_fd.',
  'best_side': 'Alias for pick — side we recommend when on board (|proj − line| ≥ 0.5).',
  'best_ev_$1': 'Alias for pick_ev_$1 — EV per $1 on the recommended side.',
  'agree_fd': 'Projection within ±0.5 K of the FanDuel line — we agree with the book; no pick (row shaded light gray).',
  'bat_team': 'Tonight\'s team abbreviation for this batter (from statsapi roster).',
  'proj_hits': 'Projected hits (Poisson λ) for this batter start — same as lambda_H on shadow cards.',
  'pick_ev_$1': 'Expected value per $1 on the picked H side (blank when agree_fd).',
  'proj_ip': 'Projected innings pitched for the starter (drives outs/ER/K projections).',
  'proj_ip_v1': 'Walk-forward / OOS projected IP (L3 depth v1 — same as live card proj_IP).',
  'proj_ip_v2': 'Walk-forward / OOS projected IP (v2: divide L3 by actual start count, floor 3).',
  'ip_error_v1': 'Actual IP minus proj_ip_v1 after the start (negative = hooked early vs model).',
  'ip_error_v2': 'Actual IP minus proj_ip_v2.',
  'actual_ip': 'Starter innings pitched from boxscore (decimal: 6.1 → 6.333).',
  'ip_error': 'actual_IP minus proj_IP at bet snapshot (Results Log).',
  'projip_v2': 'Alternate projected innings pitched (shadow v2 model).',
  'away_proj_ip': 'Projected innings for the away starter (first 5).',
  'home_proj_ip': 'Projected innings for the home starter (first 5).',
  'effective_fip': 'Starter\u2019s FIP regressed toward league by sample size — the ER model\u2019s skill input.',
  'season_era': 'Starter\u2019s raw season ERA (for reference vs FIP).',
  'fip_minus_era': 'FIP − ERA: positive = pitcher has been lucky (ERA likely to rise), negative = unlucky.',

  // — model probabilities / expected values —
  'model %': 'OUR model probability the bet WINS. This is what we rank on (outcome-first) — higher = more likely correct.',
  'book %': 'Probability implied by the FanDuel odds (includes the book\u2019s vig). Beat this to have an edge.',
  'lambda_total': 'Expected total (Poisson mean) the model predicts for the game\u2019s 1st inning / first-5 runs.',
  'lambda_top': 'Expected 1st-inning runs for the top half (away bats).',
  'lambda_bot': 'Expected 1st-inning runs for the bottom half (home bats).',
  'lambda_away': 'Expected first-5-inning runs scored against the away staff.',
  'lambda_home': 'Expected first-5-inning runs scored against the home staff.',
  'lambda_er': 'Expected earned runs (Poisson mean) for the starter.',
  'lambda_outs': 'Expected recorded outs (Poisson mean) for the starter.',
  'lambda_outs_v2': 'Alternate expected outs (shadow v2 model).',
  'lambda_tb': 'Expected total bases (Poisson mean) for the batter.',
  'p_over': 'Model probability the Over hits.',
  'p_under': 'Model probability the Under hits.',
  'p_nrfi': 'Model probability of NRFI (no run in the 1st).',
  'p_yrfi': 'Model probability of YRFI (a run in the 1st).',
  'implied_over': 'Over probability implied by FanDuel odds (with vig).',
  'implied_under': 'Under probability implied by FanDuel odds (with vig).',
  'implied_nrfi': 'NRFI probability implied by FanDuel odds (with vig).',
  'implied_yrfi': 'YRFI probability implied by FanDuel odds (with vig).',
  'ev / $1': 'Expected value per $1 risked = model% × payout − (1−model%). Positive = +EV. We treat this as a guardrail, not the goal.',
  'ev_over_$1': 'Expected value per $1 on the Over.',
  'ev_under_$1': 'Expected value per $1 on the Under.',
  'ev_nrfi_$1': 'Expected value per $1 on NRFI.',
  'ev_yrfi_$1': 'Expected value per $1 on YRFI.',
  'stake $': 'Suggested stake from fractional-Kelly sizing on model% and odds.',

  // — K bet card audit / shadow extras —
  'p_win_raw': 'Raw model win probability before calibration.',
  'p_win_cal': 'Calibrated model win probability (mapped to historical hit rate).',
  'segment_id': 'Matched K-segment id from the registry (which historical pattern this play fits).',
  'matchup_tags': 'Tags describing the matchup (used by segment rules).',
  'lambda_raw': 'Raw projected strikeouts before anchoring/clamps.',
  'opp_k_l14': 'Opponent lineup\u2019s strikeout rate over the last 14 days.',
  'sc_ev_allow': 'Statcast season avg exit velocity allowed on contact (mph). Higher = harder contact surrendered.',
  'sc_la_allow': 'Statcast season avg launch angle allowed (degrees).',
  'sc_xba_allow': 'Statcast expected batting average against (xBA) — quality of contact allowed.',
  'savant_link': 'Baseball Savant player page for drill-down charts.',

  // — shared promo —
  'rank': 'Rank within the card (1 = strongest play).',
  'team': 'Team this player/bet belongs to.',
  'batterid': 'MLB Stats API batter id (internal join key).',
  'p_poisson': 'Probability of the event (\u22651) from the Poisson mean.',
  'p_calibrated': 'p_poisson mapped to the historical hit rate — use this when calibration is ON.',
  'calibration_status': 'Whether Platt calibration is active yet (needs enough graded rows; until then = p_poisson).',
  'confidence': 'Model confidence tier (high/medium/low) from sample size & data quality.',
  'reason': 'Why confidence was downgraded (low PA, missing SP, lineup missing, etc.).',
  'lineup_slot': 'Batting-order slot — drives expected plate appearances.',
  'opponent_sp_id': 'Opposing starter id (internal join key).',
  'park_mult_hr': 'Park HR factor — >1 boosts HR (hitter park), <1 suppresses (pitcher park).',
  'pitcher_mult': 'Opposing-pitcher HR environment = HR/9 tendency \u00d7 groundball (GO/AO) tendency.',
  'weather_mult': 'First-pitch weather factor — warm/wind-out boosts HR, cold/wind-in suppresses; 1.0 = dome/neutral.',
  'szn_hr': 'Season home runs.',
  'szn_pa': 'Season plate appearances (sample behind the rate).',
  'l14_hr': 'Home runs over the last 14 days (recent power form).',
  '\u03bb_raw': 'Expected home runs (Poisson mean) from all inputs, before the probability conversion.',
  '\u03bb_gs': 'Expected grand slams (Poisson mean) for this batter.',
  '\u03bb_hr_ref': 'The batter\u2019s HR Poisson mean the GS number is derived from (reference).',
  'gs_\u03bb_mult': 'Grand-slam multiplier on the HR \u03bb (bases-loaded environment from the opposing starter\u2019s walk rate).',

  // — 🔥 Streak —
  'p_hit_v2': 'Model probability the batter gets \u22651 hit (hits v2-full model) — the base Streak input.',
  'season_babip': 'Batting average on balls in play this season (contact-quality / luck indicator).',
  'opp_sp_name': 'Opposing starting pitcher.',
  'opp_sp_k9': 'Opposing starter strikeouts per 9 — high K/9 lowers hit chance.',
  'exp_sp_ip': 'Expected innings for the opposing starter (how long the batter faces him vs the bullpen).',
  'opp_sp_avg_against': 'Opposing starter batting average allowed.',
  'opp_sp_dead_pa_rate': 'Share of the starter\u2019s PAs ending with no ball in play (K/BB/HBP) — fewer hit chances.',
  'opp_team': 'Opponent team.',
  'opp_pen_h9': 'Opponent bullpen hits allowed per 9.',
  'opp_pen_ip': 'Innings the opponent bullpen is expected to cover.',
  'k9_penalty_mult': 'Multiplier docking hit prob vs high-K/9 starters (Streak adjustment).',
  'pen_leverage_mult': 'Multiplier from bullpen quality, weighted by expected bullpen innings.',
  'dead_pa_mult': 'Multiplier from the starter\u2019s dead-PA (no-ball-in-play) rate.',
  'p_streak': 'Final Streak win probability after all adjustments — what we rank Streak picks on.',
  'pick_rank': 'Rank among today\u2019s Streak candidates (1 = top pick).',
  'is_pick': 'TRUE = a recommended Streak pick today (FanDuel allows 2 active streaks).',
  'model_version': 'Which model build produced this row.',
  'notes': 'Diagnostics / warnings for this row.',

  // — 🎟️ Early Win —
  'team_sp': 'Probable starter for the team we\u2019re backing.',
  'opp_sp': 'Opposing probable starter.',
  'ml_american': 'Full-game moneyline (American odds) for the team.',
  'ml_decimal': 'Same moneyline in decimal form.',
  'p_win_novig': 'De-vigged win probability (book hold removed) — our true outcome estimate.',
  'lead_boost': 'Effective "ever leads early" lift applied (scales with how close the game projects).',
  'p_redeem': 'Probability the token cashes (team leads at the cutoff). Early Win is ranked by this.',
  'ev_per_$1': 'Expected value per $1 of the token.',
  'pick': 'Marked when this is the recommended play on the card.',
};

var __mlbGlossaryLowerIndex = null;

function mlbGlossaryLookup_(headerText) {
  const raw = String(headerText == null ? '' : headerText).trim();
  if (!raw) return '';
  if (Object.prototype.hasOwnProperty.call(MLB_COLUMN_GLOSSARY, raw)) {
    return MLB_COLUMN_GLOSSARY[raw];
  }
  if (!__mlbGlossaryLowerIndex) {
    __mlbGlossaryLowerIndex = {};
    for (const k in MLB_COLUMN_GLOSSARY) {
      if (Object.prototype.hasOwnProperty.call(MLB_COLUMN_GLOSSARY, k)) {
        __mlbGlossaryLowerIndex[k.toLowerCase()] = MLB_COLUMN_GLOSSARY[k];
      }
    }
  }
  const lower = raw.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(__mlbGlossaryLowerIndex, lower)) {
    return __mlbGlossaryLowerIndex[lower];
  }
  // Dynamic 'ev_$N' header (N = promo max stake) → EV at that stake.
  if (lower.indexOf('ev_$') === 0) {
    return 'Expected value in dollars at the promo max stake (' + raw.slice(4) + ').';
  }
  return '';
}

/**
 * Attach hover notes to header cells from the glossary. Best-effort and silent
 * for headers without an entry.
 * @param {Sheet} sheet
 * @param {number} headerRow 1-based row holding the header labels
 * @param {string[]} headers the header labels written to that row
 */
function mlbApplyHeaderNotes_(sheet, headerRow, headers) {
  if (!sheet || !headers || !headers.length) return;
  try {
    for (let i = 0; i < headers.length; i++) {
      const note = mlbGlossaryLookup_(headers[i]);
      if (note) sheet.getRange(headerRow, i + 1).setNote(note);
    }
  } catch (e) {
    Logger.log('mlbApplyHeaderNotes_: ' + (e && e.message ? e.message : e));
  }
}
