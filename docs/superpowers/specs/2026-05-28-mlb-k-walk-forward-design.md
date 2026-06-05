# MLB-BOIZ — Pitcher K walk-forward engine & segment selection

**Date:** 2026-05-28  
**Status:** Approved (2026-05-28)  
**Scope:** Fix pitcher strikeout bet-finding for MLB-BOIZ by adding NBA-style walk-forward backtesting, honest calibration, segment-based selection, and a **matchup-context layer** that weights opponent/park/situational signals heavily for the here-and-now. Hits and other markets remain out of scope for the live bet card until K is provably profitable out-of-sample.

---

## 1. Goals

### Primary goal

Produce **3–5 high-confidence pitcher K plays per full slate** (flat **$100** stakes), with **positive ROI over a full MLB season** (~180 betting days, ~$90k–$150k handle at 3–5 bets/day).

### Operating constraints (from product discussion)

- **Market:** Pitcher strikeouts only on the live `🃏 MLB_Bet_Card` (K Over + K Under).
- **Book:** FanDuel via existing The Odds API pipeline.
- **Volume:** Target 3–5 picks on typical slates; 0–1 acceptable on thin slates. Current state after recent gate tightening: ~**1 pick total** since changes — too sparse and not yet trustworthy.
- **Evaluation:** Walk-forward out-of-sample (OOS) backtests drive tuning; live graded results validate segments — not the other way around.

### Non-goals (this iteration)

- Re-enabling batter hits, total bases, NRFI, F5, or promo markets on the live card.
- Kelly / bankroll optimization beyond existing stake tiers.
- New paid data vendors (Statcast/Savant beyond optional CSV already supported).
- Replacing Google Sheets + Apps Script platform.

---

## 2. Current system context (baseline)

MLB-BOIZ runs in **Google Sheets + Apps Script** (`mlb-boiz/`). The live K pipeline:

1. Ingest schedule, injuries, FanDuel odds, pitcher game logs (statsapi).
2. Build `📋 Pitcher_K_Queue` → `🎰 Pitcher_K_Card` (Poisson λ + EV).
3. Anchor in `⚡ Sim_Pitcher_K`: `anchoredLambda = line×(1−w) + λ×w`, default **w = 0.35** (65% book / 35% model).
4. Filter in `MLBBetCard.js` with asymmetric gates:
   - K Over: pWin ≥ 60%, capped at **70%** (`MAX_MODEL_PCT_K_OVER`).
   - K Under: pWin ≥ **75%**.
   - Both: EV between **0.03** and **0.30** (`MIN_EV_BET_CARD` / `MAX_EV_BET_CARD`).

### What exists today for opponent / context

| Signal | Status in code | Notes |
|--------|----------------|-------|
| Opponent season K/PA | Queue cols `opp_k_pa`, `opp_k_pa_vs` | Fetched via `MLBTeamHitting.js` |
| Opponent λ multiplier | `OPP_K_RATE_LAMBDA_STRENGTH` in Config | **Default = 0 (OFF)** — data exists but is not applied |
| Platoon (L/R) | `opp_k_pa_vs` + league priors | Applied when strength > 0 |
| Park K environment | `MLBParkFactors.js` static table | Coarse home-team K mult (~±2–4%) |
| HR / contact park | TB/Hits park tables only | Not wired into K λ |
| HP umpire | `HP_UMP_LAMBDA_MULT` | Global scalar, not per-umpire table |
| ABS / Savant team K | Optional CSV ingest | Per-team λ mult when enabled |
| First-pitch aggression | Not in K model | Appears on slate board as game time only |
| High-contact / low-K team | Not explicit | Inverse of K/PA when strength enabled |
| Rolling team form (L7/L14) | Not built | Season totals only |

### Backtesting gap vs NBA

NBA (`Fullbacktest.js`) walks forward through `🗄️ Game_Logs`: at game N, project using games 1..N−1, compare to actual — true OOS.

MLB today replays **logged bet card picks** (`MLBGateBacktest.js`, `MLBSimGateBacktest.js`) and buckets graded results (`MLBCalibration.js`). That tunes **filters on a biased subset**, not the projection engine on the full historical universe.

---

## 3. Problem statement

The bet card is nearly empty because:

1. **Line anchoring** (65% book) shrinks disagreement before EV is computed.
2. **Calibration fixes** (`MAX_EV`, inverted K Over at high pWin) reject rows where the raw model disagrees strongly — often correctly, because the model overclaims.
3. **Gate backtests** optimize on picks we already took, not every historical starter × line.
4. **Opponent context is underused**: opponent K% is fetched but **`OPP_K_RATE_LAMBDA_STRENGTH = 0`**; first-pitch, contact quality, rolling team form, and HR-park effects are absent or coarse.

The books are not universally smarter. We lack an honest replay loop to find **which segments** (side × pWin band × odds band × **matchup context**) are actually +EV, and we underweight the **here-and-now matchup** signals the user cares about.

---

## 4. Approaches considered

| Approach | Idea | Pros | Cons |
|----------|------|------|------|
| **A — Loosen gates only** | Raise `MAX_EV`, lower pWin floors, reduce anchor weight via existing sim gate backtest | Hours, not weeks | Does not fix calibration; reintroduces losing "mirage" buckets documented in Config audits |
| **B — Walk-forward K engine + segment registry (recommended)** | Build `🗄️ Pitcher_K_Logs`, OOS backtest, calibrate P(win), bet only proven segments; add **matchup context layer** with fast recency | Mirrors proven NBA loop; addresses root cause; incorporates opponent/park signals with ablation | 1–2 weeks build; needs proxy historical lines |
| **C — Drop anchoring entirely** | Bet raw calibrated model vs offered odds | Maximum disagreement with book | High risk if calibration immature; only after B proves raw edge > anchored edge OOS |

**Decision:** Adopt **B**. Keep sim anchoring as an **auditable optional step** per segment, not a universal 65% default.

---

## 5. Design

### 5.1 Two-layer projection model

Separate **pitcher baseline** (slow-moving, history-heavy) from **matchup context** (fast-moving, opponent/park/situational).

```
λ_final = λ_pitcher × M_matchup × M_park × M_ump × M_abs

where:
  λ_pitcher  = (K9_eff / 9) × proj_IP     ← walk-forward tuned, recency-weighted
  M_matchup  = product of opponent/context multipliers (fast decay)
  M_park     = park factor (K + HR/contact environment)
  M_ump      = HP umpire factor (when data available)
  M_abs      = ABS/Savant team factor (optional)
```

**Recency philosophy (explicit):**

| Layer | Default weighting | Rationale |
|-------|-------------------|-----------|
| Pitcher K9 / IP depth | L3 (35%) + season (65%), regressed for small samples (existing v2 logic) | Arm talent and role change slowly |
| Opponent K tendency | **L14 (50%) + season (50%)**, tuned in backtest | Lineups and team approach shift within weeks |
| Opponent vs-hand K | Same, platoon-split | Matchup-specific whiff/contact |
| First-pitch swing/aggression | **L14 only** when available | Tactical, game-plan sensitive |
| Contact quality (BABIP, hard-hit against) | **L14 + season blend**, tuned | High-contact teams extend PA, affect K path |
| Park (K + HR) | Static annual table + optional rolling park runs | Coors ≠ Oracle for K environment |

User requirement: opponent/park/situational signals reflect **the here and now** more than pitcher career arc. Implementation: **shorter rolling windows and higher Config tunable strength** on `M_matchup` than on `λ_pitcher`, with each multiplier proven (or rejected) in walk-forward ablation.

### 5.2 Matchup context features (v1)

Each feature becomes a **bounded multiplier** on λ (default cap ±12% per feature, ±25% combined before calibration) and is tested in ablation:

| Feature | Definition | Data source | K Over effect (hypothesis) | K Under effect |
|---------|------------|-------------|------------------------------|----------------|
| **Opp K rate** | Team SO/PA vs pitcher hand, L14 + season blend | statsapi `/teams/{id}/stats` + rolling log | High K% → ↑ λ | Low K% → ↓ λ |
| **Opp contact** | Inverse: low K% + high BABIP or contact% proxy | Team hitting stats; Statcast CSV optional | Low K% → ↓ λ | High contact → ↑ λ for Under |
| **First-pitch swing** | Team or lineup % swings on 0-0 / first pitch | Statcast leaderboard CSV or savant ingest extension | High swing → fewer deep counts → mixed; test OOS | Test OOS |
| **HR park** | Home park HR factor (existing TB table as proxy v1) | `MLBParkFactors.js` extend | HR park may ↑ contact attempts → ↓ K; test OOS | Opposite |
| **K park** | Existing `MLB_HOME_PARK_K_MULT` | Static + annual refresh | Direct | Direct |
| **Lineup whiff stack** | Weighted avg batter K% of projected lineup (when lineups posted) | `MLBLineups.js` + batter splits | Whiff-heavy lineup → ↑ λ | Contact-heavy → ↓ λ |

**v1 pragmatic rule:** Ship **Opp K rate (enable strength)**, **K park**, **lineup whiff stack (when available)**, and **HR park proxy** first. Add first-pitch and contact-quality only when data pipe exists or ablation on proxy justifies it.

**Re-enable opponent K today:** Set `OPP_K_RATE_LAMBDA_STRENGTH` > 0 only after walk-forward ablation confirms positive marginal ROI — not by default in live Config.

### 5.3 Historical database — `🗄️ Pitcher_K_Logs`

Expand `📒 Pitcher_Game_Logs` into a persistent season database (NBA `Game_Logs` analogue).

**One row per pitcher start** with columns:

| Column group | Fields |
|--------------|--------|
| Identity | `date`, `game_pk`, `pitcher_id`, `pitcher_name`, `throws` |
| Outcome | `k`, `ip`, `bf`, `pitches` (if available) |
| Opponent | `opp_abbr`, `opp_team_id`, `home_away` |
| Context at game time | `opp_k_pa_season`, `opp_k_pa_vs_hand`, `opp_k_pa_l14`, `park_k_mult`, `park_hr_mult`, `hp_umpire`, `lineup_whiff_avg` (nullable) |
| Market proxy | `proxy_k_line` (see 5.4) |
| Model audit | `lambda_raw`, `lambda_cal`, `p_over`, `p_under` (filled by backtest engine) |

**Maintenance:** Nightly or morning batch append via statsapi; menu item **Build / refresh Pitcher K Logs DB**. Target: full current season + prior season for stability.

### 5.4 Walk-forward backtest engine — `MLBWalkForwardKBacktest.js`

Mirror NBA `Fullbacktest.js` pattern:

1. For each pitcher start at index **g** (minimum 8 prior starts in season):
   - Build `λ_pitcher` using only starts **1..g−1** with Config recency weights.
   - Build `M_matchup` using only opponent stats **known before game date** (no lookahead).
   - Compute Poisson P(Over/Under) vs **proxy line**.
2. Compare to **actual K** (hit/miss/push).
3. Aggregate by **segment** (side × calibrated pWin decile × odds band × matchup flags).

**Proxy lines (v1):** FanDuel does not expose trivial historical prop lines in the current pipeline. Use:

- **Primary:** Round actual rolling median K for that pitcher to nearest half-integer ± noise model (document bias).
- **Stretch:** Store closing/open K lines from `📋 MLB_Results_Log` `close_line` backfill where available; merge into DB over time.
- **Future:** The Odds API historical endpoint if budget allows.

Backtest menu: **🔬 Run K walk-forward backtest** (target 2–4 min for one season in Apps Script; may require row batching).

**Output tab:** `🧪 K_WalkForward_Report` — calibration curves, segment ROI, feature ablation deltas, recommended segment registry entries.

### 5.5 Calibration layer — `MLBKCalibration.js`

Problem: raw Poisson P(win) overstates edge (same pattern as hits `H_MODEL_P_SHRINK`).

**Approach:**

1. Pool OOS predictions from walk-forward run.
2. Fit **isotonic regression** (or piecewise linear buckets if isotonic too heavy for Apps Script) mapping raw P → calibrated P per **side** (Over vs Under separate).
3. Store breakpoints in Config or dedicated `🎯 K_Calibration` tab.
4. Apply calibration **before** EV and segment checks in live pipeline.
5. Retire blunt `MAX_EV_BET_CARD` mirage cap for segments where calibration is validated; keep as safety on uncalibrated paths during rollout.

Success metric: in OOS data, calibrated 65% bucket hits **62–68%** (within sampling error), not 47% as today for high buckets.

### 5.6 Segment registry — `🎯 K_Segment_Registry`

Replace global EV/pWin gates with **explicit OOS-proven buckets**.

**Segment key dimensions:**

- `side`: Over | Under
- `p_win_cal`: e.g. 0.62–0.68, 0.68–0.72, ≥0.78 (Under)
- `odds_band`: American +100 to −160 (configurable)
- `matchup_tag` (optional): e.g. `opp_k_top_quartile`, `hr_park`, `lineup_whiff_heavy`
- `min_sample_oos`: e.g. ≥ 40 starts in backtest bucket
- `min_roi_oos`: e.g. ≥ +3%
- `enabled`: Y/N

**Live bet card logic:**

1. Compute calibrated P and EV for every queue row.
2. Tag matchup context flags.
3. Keep rows matching **any enabled segment**.
4. Rank by `segment_confidence = oos_roi × min(1, n_oos / 100)`.
5. **Cap:** max **5** plays, max **1 per game**.
6. If fewer than 3 qualify, output what qualifies — do not loosen gates dynamically.

**Rollout:** Start with 1–2 segments proven in backtest (likely K Over mid-pWin band and/or K Under high-pWin at plus money). Expand only after 30+ live bets confirm.

### 5.7 Sim anchoring ( revised role )

Keep `⚡ Sim_Pitcher_K` for audit but change authority:

| Phase | Behavior |
|-------|----------|
| Rollout week 1 | Bet card reads **calibrated raw λ**; sim tab shows anchored values for comparison |
| After OOS test | Per-segment Config: `use_anchor Y/N`, `anchor_weight` — only where anchored beats raw in backtest |
| Default long-term | **No universal 65% anchor**; anchoring is a segment-level choice |

### 5.8 Measurement loop

Extend `📋 MLB_Results_Log` snapshot fields:

- `lambda_raw`, `lambda_cal`, `p_win_raw`, `p_win_cal`
- `segment_id`, `matchup_tags` (comma-separated)
- `opp_k_l14`, `lineup_whiff`, `park_hr_mult` (context audit)
- Existing `close_line` / CLV backfill on FINAL

**Weekly review (menu or tab):**

- Segment live ROI vs OOS expectation
- Calibration drift (bucketed hit rate)
- CLV by segment
- Auto-disable segment when live ROI < −5% over 30 bets (manual confirm before re-enable)

### 5.9 Code / sheet surface (conceptual)

| New / changed | Purpose |
|---------------|---------|
| `MLBPitcherKLogsDB.js` | Build/maintain `🗄️ Pitcher_K_Logs` |
| `MLBWalkForwardKBacktest.js` | OOS engine + report tab |
| `MLBKCalibration.js` | Fit/apply P(win) calibration |
| `MLBKSegmentRegistry.js` | Registry tab + bet card integration |
| `MLBMatchupContext.js` | Rolling opp K, lineup whiff, park HR proxy, optional CSV stats |
| `MLBPitcherKBetCard.js` | Call matchup layer; expose audit columns |
| `MLBBetCard.js` | Segment-based selection + daily cap |
| `Config.js` | New keys: recency weights, feature strengths, segment overrides |
| `PipelineMenu.js` | Menu items for DB build, backtest, refresh registry |

---

## 6. Error handling & edge cases

- **Missing opponent stats:** Fall back to league prior; flag `no_opp_context` — segment tags requiring opp data exclude row.
- **Lineup not posted:** Skip lineup whiff multiplier; use team-level L14 only.
- **Small pitcher sample (< 8 starts):** Regress λ_pitcher toward league (existing v2); exclude from high-confidence segments until sample sufficient.
- **Apps Script timeout:** Batch DB build and backtest by month; resume checkpoints in Script Properties.
- **Proxy line bias:** Report sensitivity analysis (±0.5 K line shift) in backtest output; do not enable segments that flip sign under sensitivity.

---

## 7. Testing plan

1. **DB integrity:** Row counts match statsapi game logs for 10 random pitchers.
2. **No lookahead:** Unit test that opponent L14 for game date D uses only games before D.
3. **Walk-forward sanity:** Known arm (e.g. high-K starter) — OOS hit rate directionally reasonable vs naive season K/9.
4. **Calibration:** Reliability diagram — calibrated bins within ±3pp of actual on OOS set.
5. **Ablation:** Each matchup feature removed — report Δ ROI on full OOS set; disable features with negative or null Δ.
6. **Live shadow week:** Run segment engine parallel to current card without betting; compare pick overlap and simulated ROI.
7. **Go-live gate:** At least one segment with **≥ 40 OOS samples** and **≥ +3% ROI** before replacing current bet card gates.

---

## 8. Rollout plan

| Week | Deliverable |
|------|-------------|
| 1 | `🗄️ Pitcher_K_Logs` DB + rolling opp K L14 + re-enable opp K ablation in backtest only |
| 2 | Walk-forward engine + calibration tab + first backtest report |
| 3 | Segment registry + shadow bet card column on existing sheet |
| 4 | Switch live `🃏 MLB_Bet_Card` to segment selection; deprecate global `MAX_EV` / inverted cap for enabled segments |

---

## 9. Open questions (non-blocking)

- Historical FD K lines: invest in Odds API historical vs accumulate from Results Log only?
- First-pitch / contact CSV: extend Savant ingest vs statsapi-only v1?
- Per-umpire table: worth building from graded log CLV or defer?

---

## 10. Summary

MLB-BOIZ will match the NBA learning loop: **local game logs → walk-forward OOS replay → calibrate projections → bet only proven segments**. The key product addition is a **matchup context layer** that weights opponent strikeout tendency, contact quality, park environment (including HR parks), and (when available) lineup whiff and first-pitch behavior — with **faster recency decay** than pitcher baseline stats, and **every feature proven in ablation** before it affects live bets.

This replaces the current circular gate-tuning on ~1 surviving pick per slate with a system designed to deliver **3–5 disciplined K plays** on full slates while staying flat $100 and year-end profitable.
