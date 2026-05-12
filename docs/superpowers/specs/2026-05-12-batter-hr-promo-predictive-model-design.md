# Batter HR promo predictive model

**Status:** Draft for implementation planning (approved design direction 2026-05-12).  
**Goal:** Improve **who is most likely to homer in a given slate game** for **daily promos** where **sportsbook odds and EV are irrelevant**; optimize **out-of-sample predictive quality** (calibration and ranking), accepting heavier build and explicit backtesting.

**Non-scope:** FanDuel line alignment, anchored means toward books, Kelly, or bet-card EV columns. Those remain separate product paths. This spec does **not** require the MLB–NBA Sim shell from `2026-05-11-mlb-nba-parity-sim-architecture-design.md`; future integration is allowed but not a dependency for phase 1.

**Related code today:** `MLBBatterHRQueue.js` (roster-wide season HR/PA × fixed 4 PA × `mlbParkHrLambdaMultForHomeAbbr_`), `MLBBatterTBQueue.js` / `MLBBatterTBBetCard.js` (FD-backed HR queue with L7 blend; HR card uses **TB** park environment—known inconsistency with `MLBParkFactors.js` HR table), `MLBSchedule.js`, Stats API helpers elsewhere in repo.

---

## 1. North star

- **Deliverable:** A **ranked list** (and optional **probability tiers**) of batters for tonight’s slate, each row scoped to **(batter, gamePk)** with a defensible **probability of at least one home run in that game** (or an explicitly documented proxy if full game HR is impractical to label).
- **Success:** On rolling historical backtests, the system **beats** the current baseline (`refreshBatterHRQueue` logic: season HR/PA × 4 PA × HR park) on **Brier score**, **log loss**, **reliability (calibration)**, and **top-decile realized HR rate** among batters with sufficient label history.
- **Promo use:** Operators pick from the **top of the list** or from **tiers**; degraded rows must carry **confidence flags**, not silent downgrades.

---

## 2. Architecture

Two layers with a frozen interface between them:

| Layer | Role |
|--------|------|
| **Feature builder** | Consumes schedule, lineups, pitcher, park, optional weather; outputs **λ_raw** (expected HR count for that game under the Poisson story) plus **diagnostics** (sample sizes, fallbacks used). |
| **Calibration** | Maps model output to **empirical** probabilities using **time-split** training data; outputs **p_calibrated** (primary sort key for promos) alongside **p_poisson** for audit (`1 - exp(-λ)`). |

**Distribution:** Phase 1 keeps **Poisson** for `P(HR ≥ 1 | λ)` unless backtests show systematic failure; alternatives (e.g. Bernoulli with calibrated logit) are out of scope until evidence requires them.

---

## 3. Phase 1 — Slate-grounded enrichment (required)

### 3.1 Eligibility and keys

- **Unit of prediction:** **Starting batter** in the **confirmed lineup** for `gamePk`. If lineup is unavailable within the pipeline’s configured cutoff, emit **degraded** rows (see §6) rather than guessing order.
- **Primary key:** `gamePk` + `batterId` (match existing queue conventions where possible).

### 3.2 Plate appearances

- Replace flat **4.0 PA** with a **deterministic mapping** from lineup slot to expected PA (configurable constants, e.g. higher weight for 1–4 than 7–9). Document default table in the implementation plan; tune only via backtest, not ad hoc.

### 3.3 Batter rate signal

- **Base rate:** Season **HR/PA** (or HR per game × games played, converted consistently with PA model). Retain a **minimum PA** threshold; below threshold, apply **shrinkage** toward league or team prior (exact prior belongs in implementation plan).
- **Recency:** Optional blend of **L14/L30** HR rate with season; **weights are backtest-selected** and stored in `Config.js` (new keys), not reused from `TB_BLEND_RECENT_WEIGHT` unless backtest proves that weight is optimal for HR outcomes.
- **Platoon:** When sample size rules pass, use **split vs opposing pitcher handedness** (L/R); otherwise fall back to overall season rate with a diagnostic flag.

### 3.4 Pitcher and park

- **Starting pitcher:** Pull opponent SP for the game; adjust **λ** with a **bounded** multiplier derived from SP allowed HR rate, fly-ball tendency, or hard-contact allowed—using **Stats API** fields already feasible in Apps Script, or a single derived stat computed in code. Bounds (e.g. 0.85–1.15) prevent one bad estimate from dominating; exact formula in implementation plan.
- **Park:** Apply **`mlbParkHrLambdaMultForHomeAbbr_`** (HR-specific table in `MLBParkFactors.js`) to **all** HR model outputs that currently use TB park factors for HR. This is a **consistency fix**, not an optional enhancement.

### 3.5 Weather (optional, guarded)

- **Inclusion rule:** Only when a **config flag** enables it **and** the venue is on an **allowlist** of wind-sensitive parks (maintained in code or config). Otherwise omit weather term entirely (no partial stubs).
- **Effect:** Bounded multiplier on **λ** only, same spirit as pitcher bounds; if API fails, **omit term** and set diagnostic.

---

## 4. Phase 2 — Statcast-forward signal (deferred)

- **Trigger:** Phase 1 is shipped, logging exists, and backtests plateau vs a Statcast-enriched variant on a holdout season segment.
- **Content:** Optional ingest (CSV cache or batched fetch) for **barrel rate**, **average EV on elevated launch angles**, or similar **one-number** summaries per batter to **blend** with HR/PA in the feature builder. Reuse patterns from `MLBSavantIngest.js` where sensible; **no** live per-request Savant scraping in the hot path unless rate limits are solved in the plan.

---

## 5. Calibration (phase 1, required)

- **Method:** Time-based splits (e.g. train on months 1–4, validate on 5–6); fit a **simple** mapping—**isotonic regression** on binned predicted probabilities or **Platt scaling** on logit(`p_poisson`)—chosen by whichever wins on validation Brier.
- **Minimum data:** If insufficient graded games exist in-house, **ship uncalibrated** `p_poisson` with `calibration_status=insufficient_data` until the results log accumulates enough rows (threshold defined in implementation plan).
- **Storage:** Calibration parameters live in **Script Properties**, **sheet tab**, or **config JSON**—follow whichever pattern the repo already uses for similar knobs; document in the plan.

---

## 6. Error handling and degraded modes

| Condition | Behavior |
|-----------|----------|
| No lineup | Fall back to current **roster-wide** model **or** exclude row; must set `confidence=low` and `reason=lineup_missing`. |
| No SP | `confidence=low`, `reason=sp_missing`; use league-average pitcher multiplier **1.0** or documented prior. |
| Stats API failure for batter or pitcher | Skip row or neutral multiplier with **pipeline warning**; never silent incorrect rank. |
| Below PA threshold | Shrinkage + `confidence=medium`. |

---

## 7. Outputs

- **Sheet or named range** (name TBD in plan): columns at minimum **rank**, **gamePk**, **matchup**, **batter**, **batterId**, **λ_raw**, **p_poisson**, **p_calibrated** (or `p_poisson` when calibration inactive), **confidence**, **reason flags**, **lineup_slot**, **opponent_sp_id**, **park_mult_hr**, **pitcher_mult**, **weather_mult** (blank if disabled).
- **Sorting default for promos:** `p_calibrated` descending, tie-break by `λ_raw` then name.

---

## 8. Testing and validation

- **Unit-style:** Pure functions for PA-from-slot, park mult, bounded pitcher mult, Poisson CDF—where the environment allows (Node harness or GAS QUnit if present); if no harness exists, the plan may specify **extracted pure functions** in a new small file for testability.
- **Backtest script or tab:** Rolling evaluation vs game outcomes from **MLB Stats API box score** or existing **`MLBResultsLog` / grader** labels—whichever the codebase already trusts for “did this batter homer in this game.” Report Brier, log loss, reliability bins, and top-decile HR rate vs baseline.
- **Regression:** Full pipeline run on a day with known lineups completes without throw; row counts match expected starters × games.

---

## 9. Self-review (spec quality)

- **Placeholders:** Implementation plan must fix “TBD” names for tab and config keys; none left in this spec body.
- **Consistency:** Park HR table is the single park source for this model; TB park factor is explicitly out for HR promo outputs.
- **Scope:** Phase 1 is one cohesive deliverable (enrichment + calibration path + backtest); Statcast is phase 2 only.
- **Ambiguity resolved:** “Tonight” means **slate date in spreadsheet schedule**; labels align to **that** `gamePk`, not doubleheaders edge cases beyond documenting “first game of DH unless lineup specifies.”

---

## 10. Transition

After this spec is reviewed and approved in git, the next artifact is an **implementation plan** under `docs/superpowers/plans/` produced with the **writing-plans** skill, referencing this file by path and locking file-level tasks.
