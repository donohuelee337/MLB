// ============================================================
// ⚙️ CONFIG — MLB-BOIZ (AI-BOIZ philosophy, MLB data)
// ============================================================
// Secrets: Script Properties — ODDS_API_KEY (the-odds-api.com), ANTHROPIC_API_KEY (Claude K deep dive).
// Optional: STATSAPI_BASE in Script Properties (default https://statsapi.mlb.com/api/v1).
// ============================================================

const CONFIG_TAB_NAME = '⚙️ Config';

/** Incremented by scripts/clasp-deploy.ps1 on each Apps Script push (visible on ⚙️ Config). */
const MLB_APPS_SCRIPT_BUILD = 37;

function mlbAppsScriptBuild_() {
  return typeof MLB_APPS_SCRIPT_BUILD !== 'undefined' ? MLB_APPS_SCRIPT_BUILD : '';
}

function safeAlert_(title, message) {
  // TOAST-ONLY by design (2026-06-10). Ui.alert() is a MODAL that blocks
  // script execution until a human dismisses it — in a menu-launched window
  // run, one mid-pipeline alert froze the run for ~27 minutes and killed it
  // at the max-execution-time ceiling. Toasts never block. Full text always
  // lands in the log (toasts truncate).
  Logger.log('ALERT [' + title + ']: ' + (message || ''));
  try {
    SpreadsheetApp.getActiveSpreadsheet().toast(
      String(message || title).slice(0, 200),
      '⚠️ ' + String(title || 'Notice').slice(0, 60),
      10
    );
  } catch (_) {}
}

/** MLB team id → common abbreviation (30 teams). */
const MLB_TEAM_ABBREV = {
  108: 'LAA', 109: 'ARI', 110: 'BAL', 111: 'BOS', 112: 'CHC', 113: 'CIN', 114: 'CLE',
  115: 'COL', 116: 'DET', 117: 'HOU', 118: 'KC', 119: 'LAD', 120: 'WSN', 121: 'NYM',
  133: 'OAK', 134: 'PIT', 135: 'SD', 136: 'SEA', 137: 'SF', 138: 'STL', 139: 'TB',
  140: 'TEX', 141: 'TOR', 142: 'MIN', 143: 'PHI', 144: 'ATL', 145: 'CWS', 146: 'MIA',
  147: 'NYY', 158: 'MIL',
};

/** Common team-name → abbreviation map. Used when statsapi ships empty abbreviation. */
const MLB_TEAM_NAME_TO_ABBR = {
  'los angeles angels': 'LAA', 'arizona diamondbacks': 'ARI', 'baltimore orioles': 'BAL',
  'boston red sox': 'BOS', 'chicago cubs': 'CHC', 'cincinnati reds': 'CIN',
  'cleveland guardians': 'CLE', 'colorado rockies': 'COL', 'detroit tigers': 'DET',
  'houston astros': 'HOU', 'kansas city royals': 'KC', 'los angeles dodgers': 'LAD',
  'washington nationals': 'WSN', 'new york mets': 'NYM', 'athletics': 'OAK',
  'oakland athletics': 'OAK', 'pittsburgh pirates': 'PIT', 'san diego padres': 'SD',
  'seattle mariners': 'SEA', 'san francisco giants': 'SF', 'st. louis cardinals': 'STL',
  'tampa bay rays': 'TB', 'texas rangers': 'TEX', 'toronto blue jays': 'TOR',
  'minnesota twins': 'MIN', 'philadelphia phillies': 'PHI', 'atlanta braves': 'ATL',
  'chicago white sox': 'CWS', 'miami marlins': 'MIA', 'new york yankees': 'NYY',
  'milwaukee brewers': 'MIL',
};

function mlbAbbrFromTeamName_(name) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return '';
  return MLB_TEAM_NAME_TO_ABBR[n] || '';
}

/** Resolve canonical team abbr from a statsapi team object (splits / currentTeam). */
function mlbTeamAbbrFromStatsApiTeam_(team) {
  const t = team || {};
  let abbr = String(t.abbreviation || t.teamCode || '').trim().toUpperCase();
  if (abbr && typeof mlbCanonicalTeamAbbr_ === 'function') {
    abbr = mlbCanonicalTeamAbbr_(abbr);
  }
  if (!abbr && typeof mlbAbbrFromTeamName_ === 'function') {
    abbr = mlbAbbrFromTeamName_(t.name);
    if (abbr && typeof mlbCanonicalTeamAbbr_ === 'function') {
      abbr = mlbCanonicalTeamAbbr_(abbr);
    }
  }
  return abbr || '';
}

/** Map statsapi / schedule abbreviation variants → Config canonical abbr. */
const MLB_ABBR_ALIASES = {
  AZ: 'ARI',
  WSH: 'WSN',
  WAS: 'WSN',
  ATH: 'OAK',
  LV: 'OAK',
  LAA: 'LAA',
  LA: 'LAA',
};

function mlbCanonicalTeamAbbr_(abbr) {
  const a = String(abbr || '').trim().toUpperCase();
  if (!a) return '';
  if (Object.prototype.hasOwnProperty.call(MLB_ABBR_ALIASES, a)) {
    return MLB_ABBR_ALIASES[a];
  }
  return a;
}

/** @returns {number} MLB team id or NaN if abbreviation is unknown. */
function mlbTeamIdFromAbbr_(abbr) {
  const a = mlbCanonicalTeamAbbr_(abbr);
  if (!a) return NaN;
  for (const tid in MLB_TEAM_ABBREV) {
    if (!Object.prototype.hasOwnProperty.call(MLB_TEAM_ABBREV, tid)) continue;
    if (String(MLB_TEAM_ABBREV[tid]).toUpperCase() === a) return parseInt(tid, 10);
  }
  return NaN;
}

function buildConfigTab() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG_TAB_NAME);
  let prevSlate = '';
  try {
    const nr = ss.getRangeByName('CONFIG');
    if (nr) {
      nr.getValues().forEach(function (r) {
        if (String(r[0]).trim() === 'SLATE_DATE' && r[1]) prevSlate = String(r[1]).trim();
      });
    }
  } catch (e) {}
  const tz = Session.getScriptTimeZone();
  const defaultSlate =
    prevSlate && /^\d{4}-\d{2}-\d{2}$/.test(prevSlate)
      ? prevSlate
      : Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');

  if (!sheet) sheet = ss.insertSheet(CONFIG_TAB_NAME);
  sheet.clearContents().clearFormats();
  sheet.getRange(1, 1, 1, 3).merge()
    .setValue('⚙️ MLB-BOIZ — Configuration (no API keys in cells — use Script Properties)')
    .setBackground('#1b5e20').setFontColor('#ffffff').setFontWeight('bold');
  let row = 3;
  function row_(k, v, note) {
    sheet.getRange(row, 1).setValue(k).setFontWeight('bold');
    sheet.getRange(row, 2).setValue(v);
    sheet.getRange(row, 3).setValue(note || '');
    row++;
  }
  row_(
    'APPS_SCRIPT_BUILD',
    String(typeof MLB_APPS_SCRIPT_BUILD !== 'undefined' ? MLB_APPS_SCRIPT_BUILD : ''),
    'Deployed code build — auto-bumped by scripts/clasp-deploy.ps1 each clasp push. Re-run "0. Build Config tab" to refresh.'
  );
  row_('RUN_WINDOW', 'MORNING', 'MORNING | MIDDAY | FINAL');
  row_('SLATE_DATE', defaultSlate, 'yyyy-MM-dd in script TZ — use menu "tomorrow" or set manually');
  row_('ODDS_BOOK', 'fanduel', 'the-odds-api bookmaker key');
  row_('ODDS_REGION', 'us', 'regions param');
  row_('K9_BLEND_L7_WEIGHT', '0.35', '0..1 blend of L3 K/9 vs season K9 for 🎰 λ (needs L3_IP in queue). Practical scan ~0.2–0.5 around default 0.35; tune iteratively after several slates using Pipeline_Log and 🎰 bet card outcomes. If this key is missing, re-run menu "0. Build Config tab".');
  row_(
    'TB_BLEND_RECENT_WEIGHT',
    '0.35',
    '0..1 blend of last-7 games TB/game vs season TB/game for 🎲 Batter_TB_Card λ (same spirit as K9_BLEND). Tune after slates.'
  );
  row_('TB_V2_LEAGUE_TB_PER_9',  '2.65', 'League SP TB-allowed per 9 IP — denominator for opp_SP_TB_mult in 🧪 tb.v2-full shadow. Update at season start.');
  row_('TB_V2_LEAGUE_TB_PER_PA', '0.40', 'League batter TB per PA — fallback prior when vs-hand split sample is thin in 🧪 tb.v2-full shadow.');
  row_('PICK_BY', 'outcome', "GLOBAL betting philosophy for two-sided cards (🌅 NRFI, 🅰️ F5, 💧 ER, 🔩 Outs, 📊 TB, 🎟️ Early Win): 'outcome' (default) backs the side most likely to WIN and ranks cards by win probability — bankroll is finite, so being correct beats chasing theoretical value. 'ev' = legacy: back the higher-EV side and rank by EV. (🌅 NRFI also honors its own NRFI_PICK_BY override.)");
  row_('PICK_MIN_CONFIDENCE', '0.55', "Outcome mode: minimum model win probability on the chosen side before a pick is snapshotted to a results log (currently 🅰️ F5). Raise to track only stronger winners. (🌅 NRFI uses NRFI_MIN_CONFIDENCE.)");
  row_('PICK_MIN_EV', '-0.05', "Outcome mode: EV/$1 price guardrail for snapshotted picks — skip only when EV is below this even if confidence clears the floor. Negative-tolerant so we lay modest juice on strong winners but won't light money on fire. (🌅 NRFI uses NRFI_PICK_MIN_EV.)");
  row_('MIN_EV_BET_CARD', '0.10', 'Min EV per $1 on 🃏 card; 0 = any positive EV. Raised 0.03→0.10 (2026-05-30): graded log shows EV 0-0.10 = -10.9% ROI; the only profitable EV band is 0.10-0.20. Tune from 💰 Profitability_Report. If this key is missing, re-run menu "0. Build Config tab".');
  row_('MAX_EV_BET_CARD', '0.20', 'Max EV per $1 on 🃏 card — kills the "edge mirage". Lowered 0.30→0.20 (2026-05-30): EV 0.20-0.30 = -16.5% ROI, 0.30-0.50 = -18% ROI. Big claimed edge = model overestimating P (often on bad data). 0 or blank = no ceiling.');
  row_('MAX_MODEL_PCT_K_OVER', '0', 'Max model P(Win) for K OVER on 🃏 card. OFF as of 2026-05-30: outcome analysis by ODDS band shows the profit is in juiced-favorite Overs (-150..-130 = +25.8% flat ROI, 72.7% hit, n=128), which need HIGH raw P — the old 0.65 cap was deleting our best signal. Quality control now comes from the odds gate (MAX_ODDS_K bans plus-money) not a P ceiling. 0 = no ceiling.');
  row_('MIN_MODEL_PCT_BET_CARD', '0.60', 'Global default model P(Win) floor on 🃏 card. Per-market overrides below take precedence. Blank or 0 falls back to 0.60.');
  row_('MIN_MODEL_PCT_K',  '', 'Per-market model% floor for STRIKEOUTS plays. Blank = use MIN_MODEL_PCT_BET_CARD. Tune from 🎯 Bet_Card_Calibration (recommended_min_model_pct column).');
  row_('MIN_MODEL_PCT_TB', '', 'Per-market model% floor for TOTAL BASES plays. Blank = use MIN_MODEL_PCT_BET_CARD.');
  row_('MIN_MODEL_PCT_H',  '0.65', 'Per-market model% floor for BATTER HITS plays. Set 0.65 (2026-05-30): H below 0.65 loses (0.55-0.60 = -27%, 0.60-0.65 = -11%); 0.65-0.70 (-1%) and 0.75-0.80 (-3%) are near break-even. Blank = use MIN_MODEL_PCT_BET_CARD.');
  row_('MIN_EDGE_K',  '0', 'Min |projection − line| for STRIKEOUTS plays on 🃏 card. 0 = off. Tune from 🎯 Bet_Card_Calibration.');
  row_('MIN_EDGE_TB', '0', 'Min |projection − line| for TOTAL BASES plays on 🃏 card. 0 = off.');
  row_('MIN_EDGE_H',  '0', 'Min |projection − line| for BATTER HITS plays on 🃏 card. 0 = off.');
  row_('MIN_MODEL_PCT_K_OVER',  '0.60', 'Model P(Win) floor for K OVER plays on 🃏 card. Blank = use MIN_MODEL_PCT_K → MIN_MODEL_PCT_BET_CARD → 0.60. Data: K Over ≥0.60 shows +3.5pp edge (n=309 graded).');
  row_('MIN_MODEL_PCT_K_UNDER', '0.70', 'Model P(Win) floor for K UNDER plays on 🃏 card. Lowered 0.75→0.70 (2026-05-30): K Under 0.70-0.75 = +25% ROI (n=60) was being filtered out; 0.65-0.70 is only +3.5% so 0.70 is the floor. Blank falls back to MIN_MODEL_PCT_K.');
  row_('MAX_MODEL_PCT_K_UNDER', '0', 'Max model P(Win) for K UNDER on 🃏 card. OFF as of 2026-05-30: by odds band, K Under raw P 0.8+ = +4.2% flat ROI (n=94); the old 0.80 cap blocked a mild winner. Odds gate (MAX_ODDS_K) is the real control. 0 = no ceiling.');
  row_('MAX_ODDS_K', '100', 'Plus-money ceiling (American) for STRIKEOUTS plays on 🃏 card. Added 2026-05-30: every plus-money K bucket bleeds (K Over +100..+140 = -10.8% flat, K Under +100..+140 = -27.1%) — the book prices longshot Ks for action, not outcome. Blocks any K priced longer than +100. 0 or blank = no cap.');
  row_('MAX_ODDS_H', '-300', 'Most-juiced (American) BATTER HITS price allowed on 🃏 card. Loosened -130→-300 (2026-05-30): the old -130 cap was BACKWARDS — it blocked juiced favorites (odds<-130 = 60.4% hit, -7.9% flat) and kept the longshots we allow (odds≥-130 = 42.2% hit, -19.4% flat). Now we cap only extreme juice beyond -300. Pair with MIN_ODDS_H. 0 or blank = no cap.');
  row_('MIN_ODDS_H', '0', 'Least-juiced (American) BATTER HITS floor on 🃏 card. OFF (2026-06-01): the [-300,-140] favorites-only band blocked most sim rows (-120/-130) while pWin/EV gates already control quality; MAX_ODDS_H still caps extreme juice. Set e.g. -140 only if you want to re-enable favorites-only. 0 or blank = off.');
  // --- Lineup PA-per-slot table (Phase 2A) ---
  row_('LINEUP_PA_SLOT_1', '4.4', 'Estimated PA/game for batting order slot 1. Used when lineup is confirmed; falls back to season PA/game when not. League avg 2024–2025.');
  row_('LINEUP_PA_SLOT_2', '4.3', 'Estimated PA/game for batting order slot 2.');
  row_('LINEUP_PA_SLOT_3', '4.1', 'Estimated PA/game for batting order slot 3.');
  row_('LINEUP_PA_SLOT_4', '4.0', 'Estimated PA/game for batting order slot 4.');
  row_('LINEUP_PA_SLOT_5', '3.9', 'Estimated PA/game for batting order slot 5.');
  row_('LINEUP_PA_SLOT_6', '3.7', 'Estimated PA/game for batting order slot 6.');
  row_('LINEUP_PA_SLOT_7', '3.6', 'Estimated PA/game for batting order slot 7.');
  row_('LINEUP_PA_SLOT_8', '3.4', 'Estimated PA/game for batting order slot 8.');
  row_('LINEUP_PA_SLOT_9', '3.2', 'Estimated PA/game for batting order slot 9.');
  // --- H calibration shrink (Phase 2B) ---
  row_('H_MODEL_P_SHRINK', '0.82', 'Multiplicative shrink on H P(win) before EV calculation. Applied in BOTH 🧪 Batter_Hits_Card_v2-full AND ⚡ Sim_Batter_Hits (sim is authoritative for 🃏 card). Lowered 0.86→0.82 (2026-05-30): H still -9% ROI overall and remains overconfident; deeper shrink trims EV and play count. 1.0 = off. Tune toward 1.0 if hit rate improves with lineup hydration. If this key is missing, re-run "0. Build Config tab".');
  // --- Sim anchor weights (⚡ tabs → 🃏) — tune via 🔬 Sim_Gate_Backtest ---
  row_('ANCHOR_WEIGHT_K', '0.35', '0..1 weight on model λ vs FD K line in ⚡ Sim_Pitcher_K (anchored Poisson). 0.35 = 65% line / 35% model. Tune with 🔬 Sim_Gate_Backtest on graded 📋 MLB_Results_Log.');
  row_('ANCHOR_WEIGHT_BATTER_HITS', '0.35', '0..1 weight on model λ vs FD H line in ⚡ Sim_Batter_Hits. Tune with 🔬 Sim_Gate_Backtest.');
  // --- K walk-forward engine (🗄️ Pitcher_K_Logs → segment registry) ---
  row_('K_SEGMENT_MODE', 'shadow', 'shadow = legacy gates on 🃏 + segment cols for audit; live = segment registry drives K picks; legacy = old gates only.');
  row_('K_SEGMENT_MAX_PLAYS', '5', 'Max K plays on 🃏 when K_SEGMENT_MODE=live.');
  row_('K_LIVE_FALLBACK_LEGACY', 'Y', 'When live mode has 0 registry matches, keep legacy gate picks (Y) instead of empty card.');
  row_('K_BET_CARD_GATES', 'balanced', 'strict | balanced | research — K pWin floors on 🃏. strict uses MIN_MODEL_PCT_K_* (Under 0.75 = very few plays).');
  row_('K_BET_CARD_USE_CALIBRATION', 'N', 'Y = gate checks use 🎯 K_Calibration shrunk P; N = raw sim P. Set N (2026-05-30): calibration is correct that raw K-Over P is overconfident on PLUS-MONEY longshots — but it then drags the juiced-favorite Over pocket (-150..-130, 72.7% hit, +25.8% flat) down to ~0.32 and the floor rejects it, deleting our single best edge AND forcing the card to zero K bets. We now control overconfidence via the odds gate (MAX_ODDS_K bans plus-money) and gate on raw P. K_Calibration report is unaffected.');
  row_('MIN_PWIN_GAP_K', '0.02', 'NBA-style: allow K if (model P − FD implied) ≥ this when pWin is up to 0.05 below side floor. 0=off.');
  row_('K_SEGMENT_INCLUDE_H', 'N', 'Y = merge batter H on 🃏 card; N = K-only card (recommended until K segments prove profitable).');
  row_('K_OPP_L14_BLEND', '0.50', 'Weight on opponent L14 K/PA vs season in M_matchup (0..1).');
  row_('K_OPP_K_STRENGTH', '0.25', 'Max ±λ bump from opp K rate (ablation-tuned; 0=off). Replaces OPP_K_RATE_LAMBDA_STRENGTH for walk-forward path.');
  row_('K_HR_PARK_STRENGTH', '0.08', 'Max ±λ bump from HR park proxy (high HR park → lower K hypothesis). 0=off until ablation passes.');
  row_('K_LINEUP_WHIFF_STRENGTH', '0.10', 'Max ±λ bump from lineup whiff stack when lineups posted. 0=off until ablation passes.');
  row_('K_LINEUP_WHIFF_MIN_PA', '20', 'Min PA per batter (vs-hand or season) to include in lineup whiff average.');
  row_('K_MATCHUP_COMBINED_CAP', '0.25', 'Cap absolute combined M_matchup deviation from 1.0 before calibration.');
  row_('K_LAMBDA_MAX', '13', 'Plausibility cap on a single-start K λ (data-error guard, NOT a reliever ban). No real start projects above ~13 K; a higher λ means a bad input row (reliever mis-tagged with starter IP, corrupt K9/IP). Legit openers/short starts pass naturally (small projIp → small λ). Protects the live card AND walk-forward calibration samples. 0 or blank = off.');
  row_('K_WF_MIN_PRIOR_STARTS', '8', 'Min prior starts in season before a row enters walk-forward backtest.');
  row_('K_WF_OVER_ODDS_PROXY', '-115', 'Walk-forward / segment miner assumed Over juice (American).');
  row_('K_WF_UNDER_ODDS_PROXY', '105', 'Walk-forward / segment miner assumed Under juice (American).');
  row_('K_WF_SEGMENT_MIN_N', '40', 'Segment miner: min sample count to flag candidate=Y.');
  row_('K_WF_SEGMENT_MIN_ROI', '0.03', 'Segment miner: min proxy ROI (per bet unit) for candidate=Y.');
  row_('K_WF_TYPICAL_K_LINES', '3.5,4.5,5.5,6.5,7.5,8.5,9.5,10.5', 'FD-style K ladder for discrepancy report (comma-separated).');
  row_('K_WF_MIN_FAIR_LINE_GAP', '0.5', 'Discrepancy flag when |fair_line − market_line| ≥ this.');
  row_('K_WF_MIN_PWIN_GAP', '0.02', 'Discrepancy flag when |p_model_cal − p_market_implied| ≥ this (NBA MIN_PWIN_GAP spirit).');
  row_('ANTHROPIC_MODEL', 'claude-sonnet-4-6', 'Claude model for 🧠 K Deep Dive. Key: Script property ANTHROPIC_API_KEY (not in this sheet).');
  row_('K_DEEP_DIVE_MAX_PLAYS', '8', 'Max Claude reviews per deep-dive run.');
  row_('K_DEEP_DIVE_MIN_EV', '0.03', 'Live K card deep dive: min best_ev_$1 on 🎰 Pitcher_K_Card.');
  row_('K_DEEP_DIVE_MIN_PWIN_GAP', '0.02', 'Live K card deep dive: min (model P − FD implied) on best side.');
  row_('K_PROXY_LINE_NOISE', '0.0', 'Optional ±0.5 noise on proxy lines in sensitivity pass (0 or 0.5).');
  row_('K_LOGS_DUMP_MIN_IP', '20', 'Min season IP for 🗄️ Pitcher_K_Cache overnight dump (starters + bulk relievers).');
  row_('K_LOGS_DUMP_INTERVAL_MIN', '10', 'Minutes between processPitcherKLogsChunk trigger runs during overnight dump.');
  row_('BANKROLL', '500', 'Bankroll in $ for Kelly stake column on 🃏 card. Default $500 = max bet $7.50 ≈ 1.5% of roll. Edit to your actual roll as it grows.');
  row_('KELLY_FRACTION', '0.25', 'Fractional-Kelly multiplier (0..1). Default 0.25 = quarter-Kelly (conservative, survives model overconfidence). Full-Kelly (1) is aggressive.');
  row_('STAKE_TIER_1_USD', '2.50', '1u stake size in $. With $7.50 cap and 1:2:3 ladder → 1u/2u/3u = $2.50/$5/$7.50.');
  row_('STAKE_TIER_2_USD', '5.00', '2u stake size in $. Edit together with TIER_1 / TIER_3 as your cap grows.');
  row_('STAKE_TIER_3_USD', '7.50', '3u stake size in $ — your effective max bet. Raise as bankroll grows and your model proves +EV.');
  row_('STAKE_TIER_1_KELLY_PCT', '0.5', 'Kelly% of bankroll → 1u tier. Default 0.5%: if quarter-Kelly says risk ≥0.5% of roll, place 1u. Below this floor → no bet.');
  row_('STAKE_TIER_2_KELLY_PCT', '1.0', 'Kelly% of bankroll → 2u tier. Default 1.0%.');
  row_('STAKE_TIER_3_KELLY_PCT', '1.5', 'Kelly% of bankroll → 3u tier. Default 1.5%: any Kelly recommendation ≥1.5% of roll is a max-bet conviction play.');
  row_('MAX_SLATE_EXPOSURE_PCT', '10', 'Max % of bankroll staked across one slate (simultaneous bets). Plays beyond the cap stay on 🃏 at $0 with an exposure_cap flag. Kelly assumes sequential bets — uncapped slates risked 30%+ of roll at once.');
  row_('GRADER_BAND_BUDGET_SEC', '300', 'Time budget (sec) for the grading band at the start of each window. Backlogged regrades beyond the budget stay PENDING and drain over the next windows. Fetch pacing/throttles unchanged.');
  row_('NIGHT_GRADER_BUDGET_SEC', '1200', '🌙 Grader budget (sec) for the Night Audit — post-lock there is nothing competing for runtime, so the backlog drains here. No rebuilds, no clears, ever.');
  row_('INJURY_NEWS_ENABLED', 'Y', '🚑 Y/N — soft-injury news sweep + scratch detection for 🃏 card players. Signal-only (red cell + hover note); never auto-gates stakes.');
  row_('INJURY_NEWS_MAX_FETCH', '15', '🚑 Max Google News RSS fetches per run (one per card player, 250ms pacing).');
  row_('INJURY_NEWS_LOOKBACK_H', '48', '🚑 Headline freshness window in hours for the injury-news sweep.');
  row_('ARSENAL_INGEST_ENABLED', 'Y', '📊 Y/N — fetch Savant pitch-arsenal-stats CSVs (pitcher + batter, 2 fetches/run) for 🎯 matchup scores. Shadow only.');
  row_('ARSENAL_P_CSV_URL', '', '📊 Override URL for the pitcher arsenal CSV. Blank = built-in Savant leaderboard export URL.');
  row_('ARSENAL_B_CSV_URL', '', '📊 Override URL for the batter arsenal CSV. Blank = built-in Savant leaderboard export URL.');
  row_('HM_ENABLED', 'Y', '🎯 Y/N — Hit Machine 2-leg 1+H parlay board + SHADOW paper log. No real stakes until promoted.');
  row_('HM_MIN_P', '0.65', '🎯 Min model P(1+ hit) for PARLAY LEGS only (post-shrink scale, 0.65 ≈ 0.79 raw). The candidate list always shows the top-N most likely hitters regardless.');
  row_('HM_LIST_N', '10', '🎯 Candidate list size — "here are the N guys most likely to get a hit" (BvP/arsenal context fetched for these only). Odds NOT required to make the list.');
  row_('HM_LEG_ODDS_FLOOR', '-350', '🎯 Worst (most negative) acceptable leg price.');
  row_('HM_BVP_MIN_PA', '12', '🎯 Career PA vs tonight\'s SP before the BvP stay-away veto can fire. One-way prune, never a boost.');
  row_('HM_BVP_MAX_AVG', '0.10', '🎯 BvP veto: career avg below this (with PA ≥ min) = stay away.');
  row_('HM_PAPER_STAKE', '2.50', '🎯 Paper stake $ for shadow parlay P/L tracking.');
  row_('HM_ALLOW_SGP', 'Y', '🎯 Y/N — allow a same-game pair when no cross-game pair exists (e.g. one game left). SGP P(both) gets a correlation bump and the logged price a repricing haircut — always verify the actual FD SGP quote.');
  row_('HM_SGP_RHO', '0.08', '🎯 Correlation between same-game 1+H legs: P(both)=p1·p2+ρ·σ1·σ2.');
  row_('HM_SGP_HAIRCUT', '0.10', '🎯 Payout haircut on SGP multiplied price (FD quotes less than straight multiplication for correlated legs).');
  row_('K_PROB_BLEND_MARKET_W', '0.65', '🧪 Shadow only (⚡ Sim_Pitcher_K cols 39-41): weight on de-vigged market prob vs raw model prob. Audit data for market-prior blending; does NOT affect live picks.');
  row_('LEGACY_UNIT_USD', '2.50', 'Flat $ assumed for pre-tier historical bets when running "Backfill historical stakes". Set to what you were actually averaging before the Kelly system.');
  row_('HP_UMP_LAMBDA_MULT', '1', 'Multiply 🎰 λ when hp_umpire listed (1=no change; try 1.02–1.05 cautiously)');
  row_('LHP_K_LAMBDA_MULT', '1', 'Extra λ mult when pitcher throws L (1=no change)');
  row_('RHP_K_LAMBDA_MULT', '1', 'Extra λ mult when pitcher throws R (1=no change)');
  row_('LEAGUE_PITCHING_K9', '8.2', 'Prior league SP K/9 for 🧪 k.v2 shadow regression — pitcher K9 ramps from this toward own K9 across 0→8 starts. Tune yearly.');
  row_('LEAGUE_HITTING_K_PA', '0.225', 'League prior SO/PA (all PA); fallback when vs-hand priors blank or when using season opp_k_pa only.');
  row_(
    'LEAGUE_HITTING_K_PA_VS_L',
    '0.226',
    'League SO/PA for hitters vs LHP (tune yearly). Used for OPP_K ratio when opp_k_pa_vs is present and starter throws L; else falls back to LEAGUE_HITTING_K_PA.'
  );
  row_(
    'LEAGUE_HITTING_K_PA_VS_R',
    '0.224',
    'League SO/PA for hitters vs RHP (tune yearly). Used when opp_k_pa_vs is present and starter throws R; else falls back to LEAGUE_HITTING_K_PA.'
  );
  row_('OPP_K_RATE_LAMBDA_STRENGTH', '0', '0 = off. Try 0.15–0.35: scales 🎰 λ from opponent team season K% vs LEAGUE_HITTING_K_PA (whiff-heavier lineups → higher λ). Tune with Pipeline_Log.');
  row_('ABS_K_LAMBDA_MULT', '1', 'Global ABS λ fallback when no per-team row in Savant ingest (1 = neutral).');
  row_('SAVANT_INGEST_ENABLED', 'false', 'true | false — fetch Savant CSV URLs each ball window (see docs/SAVANT-INGEST.md).');
  row_(
    'SAVANT_ABS_CSV_URL',
    '',
    'HTTPS CSV: team_id,abs_k_mult OR Savant ABS leaderboard export with k_minus/k_flips + team_id/team_name (auto-derives λ).'
  );
  row_(
    'SAVANT_TEAM_WHIFF_CSV_URL',
    '',
    'Optional HTTPS CSV: team_id or abbr + whiff_pct (0–100) or k_pa — lineup whiff fallback when <5 batters qualify.'
  );
  row_(
    'SAVANT_ABS_K_FLIP_SENSITIVITY',
    '0.012',
    'λ bump per K-flip/game above league mean when parsing Savant ABS leaderboard CSV (~0.012 → ~±3% across teams).'
  );
  row_(
    'STATCAST_ENABLED',
    'false',
    'true | false — load 📊 Savant profile tabs (EV/LA/xBA) for card context. Phase 1: display only.'
  );
  row_(
    'STATCAST_PITCHER_PROFILE_CSV_URL',
    '',
    'Optional HTTPS CSV: Savant custom leaderboard type=pitcher with exit_velocity_avg, launch_angle_avg, xba (&csv=true). Writes 📊 Savant_Pitcher_Profile.'
  );
  row_(
    'STATCAST_BATTER_PROFILE_CSV_URL',
    '',
    'Optional HTTPS CSV: Savant custom leaderboard type=batter with exit_velocity_avg, launch_angle_avg, xba (&csv=true). Writes 📊 Savant_Batter_Profile.'
  );
  row_(
    'STATCAST_CACHE_URL',
    '',
    'Reserved: single JSON bundle from Python ETL (phase 2). When set, overrides CSV URLs.'
  );
  row_(
    'STATCAST_MAX_AGE_HOURS',
    '168',
    'Profile cache stale after this many hours (168 = 1 week). Stale cache still loads; warnings only.'
  );
  // HR promo tuning (📣 Batter_HR_Promo). Defaults match the in-code fallbacks
  // — edit here to tune from the sheet instead of changing source.
  row_('HR_PROMO_LINEUP_FALLBACK', 'roster', 'When boxscore lineup is missing: "roster" = score every batter w/ ≥HR_PROMO_MIN_PA & ≥1 HR; "skip" = drop the game and warn.');
  row_('HR_PROMO_MIN_PA', '30', 'Hard gate: exclude batters below this season PA from 📣 HR/GS promo (confirmed lineups too). Stops 1-HR-in-6-AB call-ups from topping the list.');
  row_('HR_PROMO_BLEND_L14_WEIGHT', '0.25', '0..1 blend of last-14-day HR/PA vs season HR/PA. Higher = more reactive to hot/cold streaks; lower = more season-anchored.');
  row_('HR_PROMO_SHRINK_MIN_PA', '50', 'Bayesian shrink min-PA toward season prior. Lower (~25) trusts small samples; higher (~100) needs full season before deviating.');
  row_(
    'OPP_SP_MIN_IP',
    '10',
    'Min season IP on opposing SP before opp_SP mult / HR9 / K9 adjustments apply (Hits/TB v2/v3, HR promo). Below this → neutral mult 1.0 — avoids April call-up traps.'
  );
  row_('HR_PROMO_PITCHER_MULT_MIN', '0.85', 'Floor for SP HR9/league_HR9 multiplier (caps the boost vs HR-prone pitchers).');
  row_('HR_PROMO_PITCHER_MULT_MAX', '1.15', 'Ceiling for SP HR9 multiplier.');
  row_('HR_PROMO_CALIB_MIN_ROWS', '500', 'Min graded rows before Platt calibration fits — until then p_calibrated == p_poisson.');
  row_('HR_PROMO_EXPECTED_PA_JSON', '', 'Optional: JSON array of 9 positive numbers — expected PA per lineup slot 1..9. Empty = built-in default [4.65, 4.55, ..., 3.6].');
  // 🌦️ HR/GS weather — Open-Meteo (free, no key). Warm air + wind blowing out boost HR; cold + wind in suppress. Domes → 1.0; retractable roofs weighted down.
  row_('HR_PROMO_WEATHER', 'Y', 'Y/N — apply Open-Meteo first-pitch weather multiplier to HR & GS λ (warm/wind-out boost, cold/wind-in dock). N = neutral 1.0. Best-effort: any fetch failure → 1.0, never blocks a run.');
  row_('WEATHER_TEMP_BETA', '0.03', 'HR sensitivity to temperature: temp_mult = 1 + β × (tempF − 70)/10. 0.03 ≈ 3% HR per +10°F. 0 = ignore temperature.');
  row_('WEATHER_WIND_BETA', '0.06', 'HR sensitivity to wind along the home→CF axis: wind_mult = 1 + β × alignment × (mph/10). alignment +1 = straight out to CF, −1 = straight in. 0 = ignore wind.');
  row_('WEATHER_MULT_MIN', '0.85', 'Floor for the combined weather (temp × wind) multiplier.');
  row_('WEATHER_MULT_MAX', '1.18', 'Ceiling for the combined weather (temp × wind) multiplier.');
  row_('WEATHER_ROOF_WEIGHT', '0.5', 'Weight applied to the weather swing at retractable-roof parks (roof state unknown pre-game). 0 = treat as dome (no effect), 1 = treat as fully open.');
  // ⚾ HR/GS groundball matchup — sinkerballers allow fewer fly balls → fewer HR.
  row_('HR_PROMO_GB_STRENGTH', '0.3', 'Sensitivity of the HR/GS groundball multiplier to the opposing starter\'s groundout/airout ratio (0 = off). gb_mult = 1 − α × (sp_GO/AO − league)/league, clamped. High GO/AO (sinkerballer) → suppress HR; fly-ball pitchers → boost. Uses the shared pitcher cache (no extra fetch).');
  row_('LEAGUE_PITCHING_GO_AO', '1.05', 'League starter groundout/airout (GO/AO) baseline for the HR/GS groundball multiplier. Update yearly.');
  row_('HR_PROMO_GB_MULT_MIN', '0.85', 'Floor for the HR/GS groundball (GO/AO) multiplier.');
  row_('HR_PROMO_GB_MULT_MAX', '1.15', 'Ceiling for the HR/GS groundball (GO/AO) multiplier.');
  // 💎 Grand Slam promo — bases-loaded environment (a slam needs the bases loaded).
  row_('GS_PROMO_BB_STRENGTH', '0.5', 'Sensitivity of the GS bases-loaded multiplier to the opposing starter\'s walk rate (0 = off). bb_mult = 1 + α × (sp_BB/BF − league)/league, clamped. High-walk starters load the bases more often → higher slam chance; soft-walk aces the opposite. Uses the shared pitcher cache (no extra fetch).');
  row_('GS_PROMO_LEAGUE_BB_RATE', '0.083', 'League starter walk rate (BB/BF) baseline for the GS bases-loaded multiplier. Update yearly.');
  row_('GS_PROMO_BB_MULT_MIN', '0.9', 'Floor for the GS bases-loaded (SP walk-rate) multiplier.');
  row_('GS_PROMO_BB_MULT_MAX', '1.2', 'Ceiling for the GS bases-loaded (SP walk-rate) multiplier.');
  row_('PROMO_EXCLUDE_COLD', 'TRUE', 'When TRUE, drop COLD batters (L5 H/game ≤85% of season) from 🔥 Streak_Picks, 📣 HR promo, and 📣 GS promo lists entirely. Set FALSE to include slumping hitters.');
  // 🔥 Streak picks (FanDuel MLB The Streak) — Streak-only adjustments on top of h.v2-full P(≥1 hit).
  row_('STREAK_K9_LEAGUE', '8.5', 'League SP K/9 baseline for 🔥 Streak_Picks K-rate penalty. Update yearly. Pitchers above this are penalized; below get a small bonus.');
  row_('STREAK_K9_PENALTY_ALPHA', '0.15', 'Sensitivity of Streak K-rate penalty (0 = off). penalty_mult = 1 − α × (sp_k9 − league)/league, clamped 0.80–1.05. Higher α = trust K/9 more.');
  row_('STREAK_PICK_COUNT', '2', 'Number of daily 🔥 Streak picks marked is_pick=TRUE (FanDuel allows 2 active streaks).');
  row_('STREAK_PEN_LEAGUE_H9', '8.5', 'League bullpen H/9 baseline for 🔥 Streak_Picks bullpen leverage. Update yearly.');
  row_('STREAK_PEN_BETA', '0.20', 'Sensitivity of bullpen leverage (0 = off). pen_mult = 1 + pen_share × β × (pen_h9 − league)/league, clamped 0.95–1.05. pen_share = max(0, 1 − exp_sp_ip/9).');
  row_('STREAK_SP_IP_DEFAULT', '5.5', 'Fallback expected SP IP/start when the probable starter has no logged starts this season (early season / spot starter). Used only for bullpen leverage.');
  // 🎟️ Early Win — DraftKings "Up 2 Early Win" daily token (pre-match ML).
  // Token redeems on TEAM_LEADS_BY_2 ∪ TEAM_WINS. Model lifts ML% by an additive
  // share of the losing-team probability mass to approximate "ever leads by 2+".
  row_('EARLY_WIN_LEAD_BOOST', '0.20', '0..1 additive lift to p_win on the 🎟️ Early Win card (CHALK/base anchor): p_redeem = p_win + (1−p_win)×boost. p_win is now DE-VIGGED (no book hold) so EV reflects outcome, not the priced action. 0.20 ≈ "ever leads by 2+" lift on heavy favorites. Tune down if redeem rate underperforms; 0 disables the token edge.');
  row_('EARLY_WIN_LEAD_BOOST_PICKEM', '0.30', '0..1 lead boost at a true coin-flip (p_win=0.50). The card interpolates base→pickem by closeness=1−|2·p_win−1|, because "ever leads by 2+" lift widens toward pick\'em (more lead changes) and shrinks on chalk. Set blank to use a flat EARLY_WIN_LEAD_BOOST. Should be ≥ base.');
  row_('EARLY_WIN_CUTOFF_ET', '16:10', '24h ET cutoff (HH:mm) for token eligibility on 🎟️ Early Win card — games starting at or before this time are scored. DK promo standard is 4:10 PM ET; lock as needed if DK changes the slate window.');
  row_('EARLY_WIN_MAX_BET', '10', 'Max $ stake the promo allows on the 🎟️ Early Win card. Drives the ev_$N column header + value. Default $10 matches DK promo cap; raise only if DK posts a different cap for a given day.');
  row_('EARLY_WIN_PICK_MIN_EV', '0', "Outcome mode only: EV/$1 guardrail for the recommended 🎟️ Early Win pick. The card backs the highest redeem-probability side that clears this floor. Default 0 = still require non-negative EV; lower (negative) to chase the most-likely-to-cash token even at slight -EV.");
  // 💧 Pitcher ER card — FIP-based earned runs Poisson model.
  row_('LEAGUE_FIP', '4.20', 'League prior FIP for 💧 Pitcher_ER_Card regression when sample is thin (ramps pitcher FIP weight 0→1 across 0→8 starts, same spirit as k.v2). Tune yearly.');
  row_('LEAGUE_FIP_CONSTANT', '3.10', 'Constant term in FIP formula: ((13×HR + 3×(BB+HBP) − 2×K) / IP) + c. Used when statsapi does not ship FIP directly. Tune at season start (~3.0–3.2).');
  // 🌅 NRFI card — Poisson 1st-inning runs model.
  row_('LEAGUE_RUNS_1ST_HALF', '0.30', 'League prior λ (expected runs) for one half-inning (top or bottom of 1st). Calibrate so exp(−2×λ) ≈ league NRFI rate (~0.55).');
  row_('LEAGUE_RUNS_PER_GAME', '4.50', 'League prior team runs/game for offense multiplier in 🌅 NRFI_Card (away/home RPG / this). Tune yearly.');
  row_('NRFI_LINEUP_MULT', '1.02', 'Offense multiplier when 📋 lineup top-3 is confirmed for both sides. 1.0 = no boost; >1 raises λ (more YRFI risk).');
  row_('NRFI_PARK_RUN', 'Y', 'Y/N — scale 1st-inning λ by the home park run environment (hitter parks like Coors → more YRFI; pitcher parks → more NRFI). Uses the park hits factor as a run proxy. N = neutral 1.0.');
  row_('NRFI_PARK_RUN_STRENGTH', '0.5', 'How much of the park hits factor carries into the NRFI run multiplier (0 = off, 1 = full). park_mult = clamp(1 + (hits_factor − 1) × strength, 0.9, 1.12). Runs are less park-sensitive than raw hits, so <1.');
  row_('NRFI_PICK_BY', 'outcome', "How 🌅 NRFI_Card picks a side & ranks: 'outcome' (default) backs the higher win-probability side and sorts by confidence — bankroll is finite, being correct beats chasing value. 'ev' = legacy highest-positive-EV behavior.");
  row_('NRFI_MIN_CONFIDENCE', '0.58', "Outcome mode only: minimum model win probability on the chosen side to count as an actionable pick (snapshot). Raise to be more selective about winners.");
  row_('NRFI_PICK_MIN_EV', '-0.05', "Outcome mode only: price guardrail — skip a pick if its EV/$1 is below this even when confidence clears the floor. Negative-tolerant so we'll lay modest juice on strong winners, but won't light money on fire.");
  row_('NRFI_SNAPSHOT_TOP_N', '10', 'Max games snapshotted from 🌅 NRFI_Card to 📋 NRFI_Results_Log per window. Ranked by win probability (outcome mode) or EV (legacy mode).');
  row_('NRFI_SNAPSHOT_MIN_EV', '0.03', 'Legacy ev-mode only: minimum best_ev_$1 on 🌅 NRFI_Card to snapshot into results log. Ignored in outcome mode (NRFI_PICK_MIN_EV guards price there).');
  row_('NRFI_DEFAULT_STAKE', '7.50', 'Default $ stake for NRFI results-log PnL column. Capped at the tier-3 max bet ($7.50 of $500 roll) — keep ≤ TIER_3_USD.');
  row_('F5_SNAPSHOT_TOP_N', '8', 'Max F5 total picks snapshotted from ⚾ F5_Card to 📋 F5_Results_Log per window.');
  row_('F5_SNAPSHOT_MIN_EV', '0.03', 'Minimum best_ev_$1 on ⚾ F5_Card to snapshot into results log.');
  row_('F5_DEFAULT_STAKE', '7.50', 'Default $ stake for F5 results-log PnL column. Capped at the tier-3 max bet ($7.50 of $500 roll) — keep ≤ TIER_3_USD.');
  ss.getNamedRanges().forEach(function (nr) {
    if (nr.getName() === 'CONFIG') nr.remove();
  });
  const start = 3;
  const n = row - start;
  if (n > 0) ss.setNamedRange('CONFIG', sheet.getRange(start, 1, n, 2));
  SpreadsheetApp.flush();
}

function getConfig() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const map = {};
  try {
    const range = ss.getRangeByName('CONFIG');
    if (range) {
      range.getValues().forEach(function (r) {
        if (r[0]) map[String(r[0]).trim()] = r[1];
      });
    }
  } catch (e) {}
  return map;
}

function getOddsApiKey_() {
  const key = PropertiesService.getScriptProperties().getProperty('ODDS_API_KEY');
  if (key && String(key).trim()) return String(key).trim();
  safeAlert_('Missing ODDS_API_KEY', 'Project Settings → Script properties → Add ODDS_API_KEY (the-odds-api.com).');
  return '';
}

function getSlateDateString_(cfg) {
  const tz = Session.getScriptTimeZone();
  const raw = cfg ? cfg['SLATE_DATE'] : '';
  // Sheets auto-coerces yyyy-MM-dd cells to Date objects, and String(Date)
  // fails the regex below — which silently ran TODAY's slate even when a
  // slate date was explicitly set. Format Dates back to yyyy-MM-dd instead
  // (no early return: Dates must flow through the past-date guard below).
  const fromCfg = raw instanceof Date && !isNaN(raw.getTime())
    ? Utilities.formatDate(raw, tz, 'yyyy-MM-dd')
    : raw != null ? String(raw).trim() : '';
  const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  if (fromCfg && /^\d{4}-\d{2}-\d{2}$/.test(fromCfg)) {
    // A PAST slate date is always stale residue, never an intent — a
    // leftover cell (readable again since build 25) made the 6/11 morning
    // window compare today's fresh tabs against 6/10 and clear them.
    // Tomorrow (the menu helper) and today pass through; the past does not.
    if (fromCfg < today) {
      if (typeof addPipelineWarning_ === 'function') {
        addPipelineWarning_('⚙️ SLATE_DATE ' + fromCfg + ' is in the past — ignored, using today ' + today);
      }
      return today;
    }
    return fromCfg;
  }
  if (fromCfg && typeof addPipelineWarning_ === 'function') {
    addPipelineWarning_('⚙️ SLATE_DATE "' + fromCfg + '" unparseable — falling back to today');
  }
  return today;
}

/**
 * Header-name → 0-based column index map from a sheet header row.
 * Lets readers resolve columns by name instead of hard-coded indices, so a
 * column insertion upstream (e.g. pitch_team on the 🎰 K card, build 24)
 * can no longer silently shift every downstream read.
 * Returns {} on any failure; callers should keep index fallbacks.
 */
/**
 * Normalize a sheet date cell to 'yyyy-MM-dd'. Sheets coerces yyyy-MM-dd
 * strings to Date objects on write; String(Date) = "Tue Jun 09 2026 …",
 * which makes lexicographic date comparisons sort by DAY-OF-WEEK NAME.
 * Date objects format back in the script TZ (exactly reverses the coercion);
 * ISO strings keep their leading date part; everything else passes through.
 */
function mlbDateCellToYmd_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  const s = String(v == null ? '' : v).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : s;
}

function mlbHeaderIndexMap_(sh, headerRow) {
  const map = {};
  try {
    const lastCol = sh.getLastColumn();
    if (!lastCol || sh.getLastRow() < headerRow) return map;
    sh.getRange(headerRow, 1, 1, lastCol).getValues()[0].forEach(function (n, i) {
      const key = String(n || '').trim();
      if (key && map[key] == null) map[key] = i;
    });
  } catch (e) {}
  return map;
}

/** Soft validation for tuning keys — logs pipeline warnings only (does not block). */
function validateMlbPipelineConfig_(cfg) {
  if (!pipelineLog_) return;
  const c = cfg || {};
  function warnRange(label, raw, lo, hi) {
    const x = parseFloat(String(raw != null ? raw : '').trim(), 10);
    if (isNaN(x)) return;
    if (x < lo || x > hi) {
      addPipelineWarning_('⚙️ ' + label + '=' + x + ' (expected ' + lo + '..' + hi + ')');
    }
  }
  warnRange('K9_BLEND_L7_WEIGHT', c['K9_BLEND_L7_WEIGHT'], 0, 1);
  warnRange('TB_BLEND_RECENT_WEIGHT', c['TB_BLEND_RECENT_WEIGHT'], 0, 1);
  warnRange('TB_V2_LEAGUE_TB_PER_9',  c['TB_V2_LEAGUE_TB_PER_9'],  1.5, 4.0);
  warnRange('TB_V2_LEAGUE_TB_PER_PA', c['TB_V2_LEAGUE_TB_PER_PA'], 0.30, 0.55);
  warnRange('PICK_MIN_CONFIDENCE', c['PICK_MIN_CONFIDENCE'], 0.5, 0.8);
  warnRange('PICK_MIN_EV', c['PICK_MIN_EV'], -0.3, 0.3);
  warnRange('MIN_EV_BET_CARD', c['MIN_EV_BET_CARD'], 0, 0.5);
  warnRange('MAX_EV_BET_CARD', c['MAX_EV_BET_CARD'], 0.1, 1.0);
  warnRange('MIN_MODEL_PCT_K_OVER',  c['MIN_MODEL_PCT_K_OVER'],  0.50, 0.90);
  warnRange('MIN_MODEL_PCT_K_UNDER', c['MIN_MODEL_PCT_K_UNDER'], 0.50, 0.95);
  warnRange('MAX_MODEL_PCT_K_OVER',  c['MAX_MODEL_PCT_K_OVER'],  0, 0.95);
  warnRange('MAX_MODEL_PCT_K_UNDER', c['MAX_MODEL_PCT_K_UNDER'], 0, 0.99);
  warnRange('MAX_ODDS_K', c['MAX_ODDS_K'], 0, 400);
  warnRange('MAX_ODDS_H', c['MAX_ODDS_H'], -400, 0);
  warnRange('MIN_ODDS_H', c['MIN_ODDS_H'], -300, 0);
  warnRange('ANCHOR_WEIGHT_K', c['ANCHOR_WEIGHT_K'], 0, 1);
  warnRange('MAX_SLATE_EXPOSURE_PCT', c['MAX_SLATE_EXPOSURE_PCT'], 2, 50);
  warnRange('GRADER_BAND_BUDGET_SEC', c['GRADER_BAND_BUDGET_SEC'], 60, 1500);
  warnRange('NIGHT_GRADER_BUDGET_SEC', c['NIGHT_GRADER_BUDGET_SEC'], 300, 1650);
  warnRange('INJURY_NEWS_MAX_FETCH', c['INJURY_NEWS_MAX_FETCH'], 1, 40);
  warnRange('INJURY_NEWS_LOOKBACK_H', c['INJURY_NEWS_LOOKBACK_H'], 6, 168);
  warnRange('HM_MIN_P', c['HM_MIN_P'], 0.55, 0.95);
  warnRange('HM_LIST_N', c['HM_LIST_N'], 2, 20);
  warnRange('HM_LEG_ODDS_FLOOR', c['HM_LEG_ODDS_FLOOR'], -500, 0);
  warnRange('HM_BVP_MIN_PA', c['HM_BVP_MIN_PA'], 6, 60);
  warnRange('HM_BVP_MAX_AVG', c['HM_BVP_MAX_AVG'], 0.02, 0.2);
  warnRange('HM_PAPER_STAKE', c['HM_PAPER_STAKE'], 1, 7.5);
  warnRange('HM_SGP_RHO', c['HM_SGP_RHO'], 0, 0.3);
  warnRange('HM_SGP_HAIRCUT', c['HM_SGP_HAIRCUT'], 0, 0.3);
  warnRange('K_PROB_BLEND_MARKET_W', c['K_PROB_BLEND_MARKET_W'], 0, 1);
  warnRange('ANCHOR_WEIGHT_BATTER_HITS', c['ANCHOR_WEIGHT_BATTER_HITS'], 0, 1);
  warnRange('K_OPP_L14_BLEND', c['K_OPP_L14_BLEND'], 0, 1);
  warnRange('K_OPP_K_STRENGTH', c['K_OPP_K_STRENGTH'], 0, 1);
  warnRange('K_LAMBDA_MAX', c['K_LAMBDA_MAX'], 8, 20);
  warnRange('K_SEGMENT_MAX_PLAYS', c['K_SEGMENT_MAX_PLAYS'], 1, 10);
  warnRange('H_MODEL_P_SHRINK', c['H_MODEL_P_SHRINK'], 0.80, 1.0);
  warnRange('OPP_K_RATE_LAMBDA_STRENGTH', c['OPP_K_RATE_LAMBDA_STRENGTH'], 0, 1);
  warnRange('HP_UMP_LAMBDA_MULT', c['HP_UMP_LAMBDA_MULT'], 0.85, 1.15);
  warnRange('LHP_K_LAMBDA_MULT', c['LHP_K_LAMBDA_MULT'], 0.92, 1.12);
  warnRange('RHP_K_LAMBDA_MULT', c['RHP_K_LAMBDA_MULT'], 0.92, 1.12);
  warnRange('HR_PROMO_MIN_PA', c['HR_PROMO_MIN_PA'], 1, 200);
  warnRange('HR_PROMO_SHRINK_MIN_PA', c['HR_PROMO_SHRINK_MIN_PA'], 1, 200);
  warnRange('HR_PROMO_BLEND_L14_WEIGHT', c['HR_PROMO_BLEND_L14_WEIGHT'], 0, 1);
  warnRange('WEATHER_TEMP_BETA', c['WEATHER_TEMP_BETA'], 0, 0.1);
  warnRange('WEATHER_WIND_BETA', c['WEATHER_WIND_BETA'], 0, 0.2);
  warnRange('WEATHER_MULT_MIN', c['WEATHER_MULT_MIN'], 0.7, 1.0);
  warnRange('WEATHER_MULT_MAX', c['WEATHER_MULT_MAX'], 1.0, 1.4);
  warnRange('WEATHER_ROOF_WEIGHT', c['WEATHER_ROOF_WEIGHT'], 0, 1);
  warnRange('HR_PROMO_GB_STRENGTH', c['HR_PROMO_GB_STRENGTH'], 0, 1);
  warnRange('LEAGUE_PITCHING_GO_AO', c['LEAGUE_PITCHING_GO_AO'], 0.7, 1.5);
  warnRange('HR_PROMO_GB_MULT_MIN', c['HR_PROMO_GB_MULT_MIN'], 0.7, 1.0);
  warnRange('HR_PROMO_GB_MULT_MAX', c['HR_PROMO_GB_MULT_MAX'], 1.0, 1.4);
  warnRange('EARLY_WIN_LEAD_BOOST', c['EARLY_WIN_LEAD_BOOST'], 0, 0.5);
  warnRange('EARLY_WIN_LEAD_BOOST_PICKEM', c['EARLY_WIN_LEAD_BOOST_PICKEM'], 0, 0.6);
  warnRange('EARLY_WIN_MAX_BET', c['EARLY_WIN_MAX_BET'], 1, 100);
  warnRange('EARLY_WIN_PICK_MIN_EV', c['EARLY_WIN_PICK_MIN_EV'], -0.3, 0.3);
  warnRange('LEAGUE_FIP', c['LEAGUE_FIP'], 3.0, 5.5);
  warnRange('LEAGUE_FIP_CONSTANT', c['LEAGUE_FIP_CONSTANT'], 2.5, 4.0);
  warnRange('LEAGUE_RUNS_1ST_HALF', c['LEAGUE_RUNS_1ST_HALF'], 0.15, 0.55);
  warnRange('LEAGUE_RUNS_PER_GAME', c['LEAGUE_RUNS_PER_GAME'], 3.5, 6.0);
  warnRange('NRFI_LINEUP_MULT', c['NRFI_LINEUP_MULT'], 0.9, 1.15);
  warnRange('NRFI_PARK_RUN_STRENGTH', c['NRFI_PARK_RUN_STRENGTH'], 0, 1);
  warnRange('NRFI_MIN_CONFIDENCE', c['NRFI_MIN_CONFIDENCE'], 0.5, 0.8);
  warnRange('NRFI_PICK_MIN_EV', c['NRFI_PICK_MIN_EV'], -0.3, 0.3);
  warnRange('NRFI_SNAPSHOT_TOP_N', c['NRFI_SNAPSHOT_TOP_N'], 1, 30);
  warnRange('NRFI_SNAPSHOT_MIN_EV', c['NRFI_SNAPSHOT_MIN_EV'], 0, 0.5);
  warnRange('NRFI_DEFAULT_STAKE', c['NRFI_DEFAULT_STAKE'], 1, 7.5);
  warnRange('F5_SNAPSHOT_TOP_N', c['F5_SNAPSHOT_TOP_N'], 1, 30);
  warnRange('F5_SNAPSHOT_MIN_EV', c['F5_SNAPSHOT_MIN_EV'], 0, 0.5);
  warnRange('F5_DEFAULT_STAKE', c['F5_DEFAULT_STAKE'], 1, 7.5);
}

function setConfigValue_(key, value) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  try {
    const range = ss.getRangeByName('CONFIG');
    if (!range) {
      buildConfigTab();
    }
    const r2 = ss.getRangeByName('CONFIG');
    if (!r2) return;
    const vals = r2.getValues();
    for (let i = 0; i < vals.length; i++) {
      if (String(vals[i][0]).trim() === key) {
        r2.getCell(i + 1, 2).setValue(value);
        SpreadsheetApp.flush();
        return;
      }
    }
  } catch (e) {}
}
