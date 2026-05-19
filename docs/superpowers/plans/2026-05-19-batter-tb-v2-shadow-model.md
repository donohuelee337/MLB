# Batter TB v2 shadow model — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build a **shadow** Batter TB model that mirrors Hits v2's architecture so it grades in parallel to live TB for ~2–3 weeks before swap. The live `🎲 Batter_TB_Card` stays untouched until promotion.

**Model formula (mirror Hits v2):**

```
base_TB = TB_per_PA(vs hand) × est_PA
λ_TB    = base_TB × park_TB × opp_SP_TB_mult
```

Where:

- `TB_per_PA(vs hand)` = batter season `TB / PA` against the SP's hand, shrunk to season TB/PA with a 60-PA prior (same as hits).
- `est_PA` = season PA/game from gameLogs (capped 2.5–4.2, same as hits).
- `park_TB` = existing `mlbParkTbLambdaMultForHomeAbbr_` (already used by live card).
- `opp_SP_TB_mult` = opposing SP `TB allowed / 9` vs league average TB/9, IP-shrunk with 20-IP prior. Clamped 0.85–1.15.

**Why TB v2 specifically:** the live `MLBBatterTBBetCard` has only park + L7/season blend. No vs-hand, no opposing pitcher adjustment. This is the largest model gap among our three live markets.

**Spec reference:** Hits v2 source files are the de facto template — `MLBBatterHitsV2.js`, `MLBHitsResultsLogV2.js`, `MLBResultsGraderV2.js`, `MLBHitsModelVersions.js`.

---

## File map (create / modify)

| Path | Responsibility |
|------|----------------|
| `MLBBatterTBV2.js` | **Create** — `refreshBatterTBV2BetCard()`; mirrors `MLBBatterHitsV2.js`. Reads odds + schedule, computes per-row multipliers, writes `🧪 Batter_TB_Card_v2-full`. |
| `MLBTBV2ResultsLog.js` | **Create** — `snapshotMLBTBV2BetCardToLog(windowTag)`; writes to a new tab `🧪 MLB_Results_Log_TB_v2`. |
| `MLBResultsGraderV2.js` | **Modify** — add `gradeMLBTBV2PendingResults_()` alongside existing `gradeMLBHitsV2PendingResults_`. Uses existing `mlbBatterTBFromBoxscore_` helper if present; if not, port from `MLBResultsGrader.js`. |
| `MLBTBModelVersions.js` | **Create** — minimal registry: `active: 'tb.v1', shadow: ['tb.v2-full']`. Mirror `MLBHitsModelVersions.js`. |
| `MLBBetCardFormatting.js` | **Modify** — new `mlbAppendBetTrackerSectionTBV2_(ss, sh, startRow, slateDate)` panel under the existing shadow Hits tracker. |
| `MLBBetCard.js` | **Modify** — append v2 shadow tracker for TB right after the existing Hits shadow tracker section call. |
| `PipelineMenu.js` | **Modify** — new `step('Batter TB v2 card (shadow tb.v2-full)', refreshBatterTBV2BetCard)`; pipeline calls `snapshotMLBTBV2BetCardToLog` after the existing Hits shadow snapshot; calls `gradeMLBTBV2PendingResults_()` at the top alongside the other graders; new menu submenu `🧪 TB shadow (tb.v2-full)` mirroring the Hits one. |
| `Config.js` | **Modify** — add `TB_V2_LEAGUE_TB_PER_9` (default `2.65`) and `TB_V2_LEAGUE_TB_PER_PA` (default `0.40`) for transparency / future tuning; pipeline self-validation range checks. |

**No changes to:** `MLBBatterTBBetCard.js`, `MLBBatterTBQueue.js`, live `MLBResultsLog.js`, live `MLBResultsGrader.js`. Live TB stays live.

Constants to define:

- `MLB_BATTER_TB_V2_CARD_TAB = '🧪 Batter_TB_Card_v2-full'`
- `MLB_RESULTS_LOG_TB_V2_TAB = '🧪 MLB_Results_Log_TB_v2'`
- `MLB_RESULTS_LOG_TB_V2_NCOL = 30` (24 base + 6 ablation cols, parallel to Hits v2)

---

## Task 1: `MLBBatterTBV2.js` — card builder

**Files:** create `c:\Users\Lee\Documents\Cursor\MLB\MLBBatterTBV2.js`

- [ ] **Step 1:** Copy `MLBBatterHitsV2.js` as a starting skeleton; rename:
  - `mlbHitsV2*` → `mlbTBV2*`
  - `MLB_HITS_V2_*` → `MLB_TB_V2_*`
  - `MLB_BATTER_HITS_V2_CARD_TAB` → `MLB_BATTER_TB_V2_CARD_TAB`
  - `MLB_BATTER_HITS_V2_NAMED_RANGE` (if present) → `MLB_BATTER_TB_V2_NAMED_RANGE`
  - market label `'Batter hits'` → `'Batter total bases'`
  - model_version literal `'h.v2-full'` → `'tb.v2-full'`

- [ ] **Step 2:** Replace hits-specific math:
  - `mlbHitsV2OpposingHitRateMult_` → `mlbTBV2OpposingTBRateMult_`. Reads `stat.totalBases` (not `hits`) and `stat.inningsPitched` from SP season pitching stats; shrinks toward `MLB_TB_V2_LEAGUE_TB_PER_9` (2.65 default) with 20-IP prior. Clamp 0.85–1.15.
  - `mlbHitsV2BatterVsHandHPerPa_` → `mlbTBV2BatterVsHandTbPerPa_`. Reads per-split `stat.totalBases` and `stat.plateAppearances`; shrinks toward season TB/PA with 60-PA prior. Clamp the hand-vs-season mult 0.80–1.25 (same rails).
  - Park multiplier: replace `mlbParkHitsLambdaMultForHomeAbbr_` with `mlbParkTbLambdaMultForHomeAbbr_` (already exists in `MLBParkFactors.js`).
  - `est_PA` reuses `mlbHitsV2BatterPaPerGame_` — DO NOT duplicate; just call it (it's already cached).

- [ ] **Step 3:** Card column layout (mirror Hits v2 exactly, 34 cols):
  - Cols 0..17: `gamePk, matchup, batter, fd_tb_line, fd_over, fd_under, lambda_TB_v2, edge, p_over, p_under, implied_over, implied_under, ev_over, ev_under, best_side, best_ev, flags, batter_id`
  - Cols 18..22: `base_lambda, park_mult, opp_sp_mult, hand_mult, ab_mult`
  - Cols 23..30: `tb_per_pa_vs_hand, tb_per_pa_szn, est_pa, vs_hand_sample_pa, opp_sp_name, opp_sp_throws, opp_sp_tb9, opp_sp_ip`
  - Col 31: `model_version`
  - Cols 32..33: `hp_umpire, hot_cold` (so the same swap-to-live mechanic is available later)
  - Tab color `#6a1b9a`, title `'🧪 Batter TB v2 (shadow) — λ = TB/PA(vs hand) × est_PA × park_TB × opp_SP_TB/9'`

- [ ] **Step 4:** `EV-per-$1` and `best_side` selection: copy verbatim from Hits v2 (no TB-specific quirks).

- [ ] **Step 5:** Probability function: TB is multi-outcome (0/1/2/3/4), still well-modeled by Poisson on λ_TB given lines like 1.5 / 2.5. Use the existing `mlbProbOverUnderK_(line, lambda)` helper from `MLBPitcherKBetCard.js` (identical Poisson math).

---

## Task 2: `MLBTBV2ResultsLog.js` — shadow log + snapshotter

**Files:** create `c:\Users\Lee\Documents\Cursor\MLB\MLBTBV2ResultsLog.js`

- [ ] **Step 1:** Copy `MLBHitsResultsLogV2.js` as skeleton; rename:
  - `snapshotMLBHitsV2BetCardToLog` → `snapshotMLBTBV2BetCardToLog`
  - `MLB_RESULTS_LOG_V2_TAB` → `MLB_RESULTS_LOG_TB_V2_TAB` (value `'🧪 MLB_Results_Log_TB_v2'`)
  - `MLB_RESULTS_LOG_V2_NCOL` → `MLB_RESULTS_LOG_TB_V2_NCOL` (30)
  - Market label `'Batter hits (shadow)'` → `'Batter total bases (shadow)'`
  - Header banner copy: `'🧪 MLB-BOIZ TB SHADOW LOG — tracks tb.v2-full alongside the live TB Bet Card'`

- [ ] **Step 2:** Update the card-reader column count to match TB v2 card width (34 cols). Read ablation cols from positions 18..22 just like Hits v2. Tag rows with `'tb.v2-full'`.

- [ ] **Step 3:** Add `mlbSnapshotTBV2Midday_` menu wrapper and `mlbActivateTBV2LogTab_` helper.

---

## Task 3: `MLBResultsGraderV2.js` — add TB v2 grader

**Files:** modify `c:\Users\Lee\Documents\Cursor\MLB\MLBResultsGraderV2.js`

- [ ] **Step 1:** Append `gradeMLBTBV2PendingResults_()` function. Parallels `gradeMLBHitsV2PendingResults_()` but:
  - Reads from `MLB_RESULTS_LOG_TB_V2_TAB`.
  - Uses `mlbBatterTBFromBoxscore_` to compute actual TB.
  - If that helper doesn't exist in `MLBResultsGrader.js`, port it: actual TB = `singles + 2*doubles + 3*triples + 4*homeRuns` from the player's batting line in the boxscore.
  - Note column: `'statsapi boxscore TB (v2) · '`.

- [ ] **Step 2:** Verify the grader skips rows whose result is already `WIN`/`LOSS`/`PUSH`/`VOID` (idempotency). Copy that gate verbatim from Hits.

---

## Task 4: `MLBTBModelVersions.js` — registry

**Files:** create `c:\Users\Lee\Documents\Cursor\MLB\MLBTBModelVersions.js`

- [ ] **Step 1:** Minimal file:

```javascript
const MLB_TB_MODEL_VERSIONS = {
  active: 'tb.v1',
  shadow: ['tb.v2-full'],
};

function mlbTbActiveModelVersion_()  { return MLB_TB_MODEL_VERSIONS.active || 'tb.v1'; }
function mlbTbShadowModelVersions_() { return (MLB_TB_MODEL_VERSIONS.shadow || []).slice(); }
```

This file is the single place a future TB v2 promotion flips one constant (mirror of how the Hits swap worked).

---

## Task 5: shadow tracker panel + bet card wiring

**Files:** modify `MLBBetCardFormatting.js`, `MLBBetCard.js`

- [ ] **Step 1:** In `MLBBetCardFormatting.js` add `mlbAppendBetTrackerSectionTBV2_(ss, sh, startRow, slateDate)`:

```javascript
function mlbAppendBetTrackerSectionTBV2_(ss, sh, startRow, slateDate) {
  if (typeof MLB_RESULTS_LOG_TB_V2_TAB === 'undefined') return startRow;
  return _mlbRenderBetTrackerPanel_(ss, sh, startRow, slateDate, {
    logTab: MLB_RESULTS_LOG_TB_V2_TAB,
    logNcol: typeof MLB_RESULTS_LOG_TB_V2_NCOL !== 'undefined' ? MLB_RESULTS_LOG_TB_V2_NCOL : 30,
    title: 'Bet Tracker (TB shadow)  ·  tb.v2-full advanced-features model  ·  total bases only',
    markets: [
      { key: 'TB', label: 'TOTAL BASES shadow', test: function (m) { return m.indexOf('total base') !== -1; } },
    ],
  });
}
```

- [ ] **Step 2:** In `MLBBetCard.js`, after the existing v2 (now Hits-shadow) tracker call, append a TB v2 shadow tracker:

```javascript
if (typeof mlbAppendBetTrackerSectionTBV2_ === 'function') {
  afterV2 = mlbAppendBetTrackerSectionTBV2_(ss, sh, afterV2 + 1, slateDate);
}
```

(Reuse the same `afterV2` chain so vertical spacing is consistent.)

---

## Task 6: pipeline + menu integration

**Files:** modify `PipelineMenu.js`

- [ ] **Step 1:** In `runMLBBallWindow_`, add a grader call near the existing graders block:

```javascript
try { gradeMLBTBV2PendingResults_(); } catch (e) { Logger.log('gradeMLBTBV2PendingResults_: ' + e); }
```

- [ ] **Step 2:** Add a pipeline step **after** `'Batter TB card'` and before `'Batter Hits queue'`:

```javascript
step('Batter TB v2 card (shadow tb.v2-full)', refreshBatterTBV2BetCard);
```

Update the downstream `outcomes[N]` indices accordingly — there's an existing comment block in the file marking which index is which; reindex carefully and double-check the `logStep_(...)` calls.

- [ ] **Step 3:** After the Hits shadow snapshot block, add:

```javascript
if (typeof snapshotMLBTBV2BetCardToLog === 'function') {
  try {
    snapshotMLBTBV2BetCardToLog(windowTag);
  } catch (e) {
    addPipelineWarning_('TB v2 shadow snapshot: ' + (e.message || e));
  }
}
```

- [ ] **Step 4:** New submenu in `onOpen`:

```javascript
.addSubMenu(
  SpreadsheetApp.getUi()
    .createMenu('🧪 TB shadow (tb.v2-full)')
    .addItem('🧪 Rebuild Batter TB v2 card', 'refreshBatterTBV2BetCard')
    .addItem('🧪 Snapshot TB v2 card → log (MIDDAY tag)', 'mlbSnapshotTBV2Midday_')
    .addItem('📊 Grade pending TB v2 rows', 'gradeMLBTBV2PendingResults_')
    .addItem('🧪 Open TB v2 Results Log', 'mlbActivateTBV2LogTab_')
)
```

---

## Task 7: Config keys (small)

**Files:** modify `Config.js`

- [ ] **Step 1:** Add two `row_` lines next to the existing TB / Hits keys:

```javascript
row_('TB_V2_LEAGUE_TB_PER_9',  '2.65', 'League SP TB-allowed per 9 IP — denominator for opp_SP_TB_mult in tb.v2-full. Update at season start.');
row_('TB_V2_LEAGUE_TB_PER_PA', '0.40', 'League batter TB per PA — fallback prior when vs-hand split sample is thin in tb.v2-full.');
```

- [ ] **Step 2:** Add range checks in `validateMlbPipelineConfig_`:

```javascript
warnRange('TB_V2_LEAGUE_TB_PER_9',  c['TB_V2_LEAGUE_TB_PER_9'],  1.5, 4.0);
warnRange('TB_V2_LEAGUE_TB_PER_PA', c['TB_V2_LEAGUE_TB_PER_PA'], 0.30, 0.55);
```

These are knobs only — the v2 module reads them with sane fallbacks if blank.

---

## Task 8: smoke test

- [ ] **Step 1:** `clasp push --force`, reload the sheet.
- [ ] **Step 2:** Menu → Morning. Verify:
  - `🧪 Batter_TB_Card_v2-full` tab populates with rows.
  - `📊 Pipeline_Log` shows `'Batter TB v2 card (shadow tb.v2-full)'` step OK with row count.
  - `🧪 MLB_Results_Log_TB_v2` gets new rows tagged `'Batter total bases (shadow)'` and `model_version='tb.v2-full'`.
  - `🃏 MLB_Bet_Card` has TWO shadow tracker panels below it (Hits + TB).
  - **Live `🎲 Batter_TB_Card` and `🃏 MLB_Bet_Card` row count are unchanged** vs the previous run (proof that v2 doesn't leak into live).

- [ ] **Step 2:** Wait until the next day's slate has graded TB rows in both logs; confirm `gradeMLBTBV2PendingResults_` populates `actual_TB` + `result` columns.

- [ ] **Step 3:** Refresh the `🎯 Bet_Card_Calibration` panel — it should now show TB shadow rows in addition to live TB.

---

## Open questions for Lee (resolve before starting)

1. **opp_SP_TB_mult — use season TB allowed, or just hits+XBH split?** The MLB Stats API exposes `totalBases` on pitcher season splits; if it's blank/unreliable, fall back to `(hits + 2*doubles + 3*triples + 4*homeRuns) / IP × 9`. Default plan: use `stat.totalBases` directly, fall back to derived if blank.

2. **Hot/cold for TB v2**: Hits v2 reuses `mlbHittingHitsSummary_` to compute hot/cold. For TB, we'd need an analogous `mlbHittingTbSummary_` (or just compute inline from `mlbStatsApiGetHittingGameSplits_` — TB per game last 5 vs season). Recommendation: inline the calc in TB v2 to avoid touching the live TB queue.

3. **Promotion trigger:** how many graded slates before swap? Hits v2 went live after ~3 weeks of shadow with consistent +EV on the shadow tracker. Suggest same bar: ≥3 weeks + ≥100 graded TB v2 rows + shadow hit-rate > live hit-rate by at least 2pp on the calibration panel.

---

## Estimated effort

- Tasks 1–4 (core build): one focused session, ~2 hours.
- Tasks 5–7 (wiring + config): same session, ~30 minutes.
- Task 8 (smoke test): tomorrow's morning pipeline + spot-check.

Total: one ~2.5 hour session, with grading data accumulating passively for ~3 weeks before the promotion decision.
