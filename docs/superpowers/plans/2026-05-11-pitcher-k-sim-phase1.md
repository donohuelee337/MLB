# Pitcher K Sim Engine (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a dedicated **Sim** stage for **pitcher strikeouts** only: anchored Poisson `p` and EV become the **single source** the **🃏 MLB_Bet Card** uses for K plays, with **⚾ Pipeline_Log** recording a **Sim Engine** step—matching `docs/superpowers/specs/2026-05-11-mlb-nba-parity-sim-architecture-design.md` Phase 1.

**Architecture:** Keep **`🎰 Pitcher_K_Card`** as the **Stats** surface (raw λ, unanchored `p`/`EV` for audit). New sheet **`⚡ Sim_Pitcher_K`** mirrors the **same 22-column layout** as the K card so **`mlbCollectPlaysFromPitcherOddsCard_`** in `MLBBetCard.js` needs **no column-index changes**—only the **source tab name** switches from card → sim for K. Shared Poisson math moves to **`MLBStatMath.js`** so Sim and Card do not fork formulas. Phase 1 **context score** is **constant 0** (explicit column for future §3 signals); optional config key reserved.

**Tech Stack:** Google Apps Script (V8), Google Sheets, existing `clasp` project layout under `C:\Users\Lee\Documents\Cursor\MLB`.

**Authoritative spec:** `docs/superpowers/specs/2026-05-11-mlb-nba-parity-sim-architecture-design.md`  
**Numeric reference (anchored mean):** `docs/2026-04-11-mlb-pitcher-k-pipeline-design.md` §10 — `anchoredMean = FD_Line * (1 - ANCHOR_WEIGHT) + model_mean * ANCHOR_WEIGHT` with `model_mean = λ` from the card row.

---

## File map (create / modify)

| File | Role |
|------|------|
| `MLBStatMath.js` | **Create** — `mlbPoissonCdf_`, `mlbProbOverUnderK_`, `mlbAmericanImplied_`, `mlbEvPerDollarRisked_` (moved from `MLBPitcherKBetCard.js`). |
| `MLBSimPitcherK.js` | **Create** — `refreshPitcherKSimEngine_()`, tab `⚡ Sim_Pitcher_K`, reads `🎰 Pitcher_K_Card` rows 4+ and writes anchored rows. |
| `MLBPitcherKBetCard.js` | **Modify** — Remove duplicated math functions; call globals from `MLBStatMath.js`; keep `mlbProjIpFromQueueRow_`, `mlbEffectiveK9ForLambda_`, park/ump helpers local. |
| `MLBBetCard.js` | **Modify** — `mlbRebuildStagingForBetCard_`: after `refreshPitcherKBetCard()`, call `refreshPitcherKSimEngine_()`. `refreshMLBBetCardMergeOnly_`: use sim tab for K collection; prerequisite check allows sim OR hits OR TB. Update K disclaimer string. |
| `PipelineMenu.js` | **Modify** — Insert `step('Sim Engine (Pitcher K)', refreshPitcherKSimEngine_);` after K card; extend `outcomes` / `logStep_` indices by one. Add menu item **⚡ Pitcher K Sim only** (emoji distinct from 🎯 `MLB_Slate_Board`). |
| `Config.js` | **Modify** — `buildConfigTab()` add row `ANCHOR_WEIGHT_K` default `0.35` (0..1). |
| `docs/STATUS.md` | **Modify** — One paragraph: Sim tab + pipeline order + bet card reads sim for K. |

---

### Task 1: Shared stat math module

**Files:**
- Create: `MLBStatMath.js`
- Modify: `MLBPitcherKBetCard.js` (remove the four functions listed below after this file exists)

- [ ] **Step 1: Add `MLBStatMath.js` with exact implementations**

Create new file `MLBStatMath.js`:

```javascript
// ============================================================
// MLBStatMath — shared distribution + odds helpers (Apps Script)
// ============================================================
// Used by 🎰 Pitcher_K_Card and ⚡ Sim_Pitcher_K. Keep in sync
// with docs/2026-04-11-mlb-pitcher-k-pipeline-design.md.
// ============================================================

function mlbPoissonCdf_(maxK, lambda) {
  if (maxK < 0) return 0;
  if (lambda <= 0) return 1;
  let sum = 0;
  let pmf = Math.exp(-lambda);
  sum += pmf;
  for (let k = 1; k <= maxK; k++) {
    pmf *= lambda / k;
    sum += pmf;
    if (sum >= 0.999999 && k >= lambda) break;
  }
  return Math.min(1, sum);
}

function mlbProbOverUnderK_(line, lambda) {
  const L = parseFloat(line, 10);
  if (isNaN(L) || lambda <= 0) return { pOver: '', pUnder: '' };
  const kMinOver = Math.floor(L) + 1;
  const kMaxUnder = Math.floor(L + 1e-9);
  const pOver = 1 - mlbPoissonCdf_(kMinOver - 1, lambda);
  const pUnder = mlbPoissonCdf_(kMaxUnder, lambda);
  return { pOver: pOver, pUnder: pUnder };
}

function mlbAmericanImplied_(odds) {
  const o = parseFloat(odds, 10);
  if (isNaN(o)) return '';
  if (o > 0) return Math.round((100 / (o + 100)) * 1000) / 1000;
  return Math.round((Math.abs(o) / (Math.abs(o) + 100)) * 1000) / 1000;
}

function mlbEvPerDollarRisked_(p, american) {
  const o = parseFloat(american, 10);
  if (isNaN(o) || isNaN(p)) return '';
  let winUnits;
  if (o > 0) winUnits = o / 100;
  else winUnits = 100 / Math.abs(o);
  return Math.round((p * winUnits - (1 - p)) * 1000) / 1000;
}
```

- [ ] **Step 2: Remove duplicates from `MLBPitcherKBetCard.js`**

Delete the four function definitions `mlbPoissonCdf_` through `mlbEvPerDollarRisked_` (lines 11–49 in current `main`—adjust if line numbers drift). Do **not** remove `mlbProjIpFromQueueRow_` or `mlbEffectiveK9ForLambda_`.

- [ ] **Step 3: Commit**

```bash
git add MLBStatMath.js MLBPitcherKBetCard.js
git commit -m "refactor: extract shared Poisson/EV math to MLBStatMath.js"
```

- [ ] **Step 4: Verify (Apps Script)**

In the script editor, **Run** `refreshPitcherKBetCard` (with a Sheet that already has queue data) **once**.

**Expected:** No `ReferenceError`; `🎰 Pitcher_K_Card` repopulates; values match pre-refactor spot-check on 1–2 rows (λ, `p_over`, `ev`).

---

### Task 2: Sim tab + `refreshPitcherKSimEngine_`

**Files:**
- Create: `MLBSimPitcherK.js`

- [ ] **Step 1: Create `MLBSimPitcherK.js`**

Full initial implementation:

```javascript
// ============================================================
// ⚡ Sim_Pitcher_K — anchored Poisson (Phase 1)
// ============================================================
// Reads 🎰 Pitcher_K_Card (22 cols, row 4+). Writes ⚡ Sim_Pitcher_K
// with the SAME 22-column schema so MLBBetCard merge is unchanged.
// anchoredLambda = line*(1-w) + lambda*w, w = ANCHOR_WEIGHT_K.
// Context score reserved (Phase 3); not written to sheet in v1.
// ============================================================

const MLB_PITCHER_K_SIM_TAB = '⚡ Sim_Pitcher_K';

/**
 * Rebuild sim rows from the current K card. Idempotent.
 * Call only after refreshPitcherKBetCard().
 */
function refreshPitcherKSimEngine_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig();
  const wRaw = String(cfg['ANCHOR_WEIGHT_K'] != null ? cfg['ANCHOR_WEIGHT_K'] : '0.35').trim();
  let w = parseFloat(wRaw, 10);
  if (isNaN(w)) w = 0.35;
  w = Math.max(0, Math.min(1, w));

  const src = ss.getSheetByName(MLB_PITCHER_K_CARD_TAB);
  if (!src || src.getLastRow() < 4) {
    mlbClearPitcherKSimSheet_(ss);
    return;
  }

  const last = src.getLastRow();
  const rows = src.getRange(4, 1, last, 22).getValues();
  const out = [];

  rows.forEach(function (r) {
    const gamePk = r[0];
    const matchup = r[1];
    const side = r[2];
    const pitcher = r[3];
    const line = r[4];
    const fdOver = r[5];
    const fdUnder = r[6];
    const projIp = r[7];
    const lambdaModel = parseFloat(String(r[8]), 10);
    const lineNum = parseFloat(String(line), 10);

    let lamAnch = NaN;
    if (!isNaN(lambdaModel) && lambdaModel > 0 && !isNaN(lineNum)) {
      lamAnch = lineNum * (1 - w) + lambdaModel * w;
      lamAnch = Math.round(lamAnch * 100) / 100;
    }

    let edge = '';
    if (!isNaN(lamAnch) && lamAnch > 0 && !isNaN(lineNum)) {
      edge = Math.round((lamAnch - lineNum) * 100) / 100;
    }

    const hasModel = !isNaN(lamAnch) && lamAnch > 0 && !isNaN(lineNum);
    const pu = hasModel ? mlbProbOverUnderK_(line, lamAnch) : { pOver: '', pUnder: '' };
    const pOver = pu.pOver === '' ? '' : Math.round(pu.pOver * 1000) / 1000;
    const pUnder = pu.pUnder === '' ? '' : Math.round(pu.pUnder * 1000) / 1000;

    const imO = mlbAmericanImplied_(fdOver);
    const imU = mlbAmericanImplied_(fdUnder);
    const evO = pOver !== '' && fdOver !== '' ? mlbEvPerDollarRisked_(pOver, fdOver) : '';
    const evU = pUnder !== '' && fdUnder !== '' ? mlbEvPerDollarRisked_(pUnder, fdUnder) : '';

    let bestSide = '';
    let bestEv = '';
    if (evO !== '' && evU !== '') {
      if (evO >= evU && evO > 0) {
        bestSide = 'Over';
        bestEv = evO;
      } else if (evU > evO && evU > 0) {
        bestSide = 'Under';
        bestEv = evU;
      } else if (evO >= evU) {
        bestSide = 'Over';
        bestEv = evO;
      } else {
        bestSide = 'Under';
        bestEv = evU;
      }
    } else if (evO !== '') {
      bestSide = 'Over';
      bestEv = evO;
    } else if (evU !== '') {
      bestSide = 'Under';
      bestEv = evU;
    }

    out.push([
      gamePk,
      matchup,
      side,
      pitcher,
      line,
      fdOver,
      fdUnder,
      projIp,
      !isNaN(lamAnch) ? lamAnch : '',
      edge,
      pOver,
      pUnder,
      imO,
      imU,
      evO,
      evU,
      bestSide,
      bestEv,
      r[18],
      r[19],
      r[20],
      r[21],
    ]);
  });

  out.sort(function (a, b) {
    const be = parseFloat(b[17], 10);
    const ae = parseFloat(a[17], 10);
    if (isNaN(be) && isNaN(ae)) return 0;
    if (isNaN(be)) return -1;
    if (isNaN(ae)) return 1;
    return be - ae;
  });

  let sh = ss.getSheetByName(MLB_PITCHER_K_SIM_TAB);
  if (sh) {
    const cr = Math.max(sh.getLastRow(), 3);
    const cc = Math.max(sh.getLastColumn(), 22);
    try {
      sh.getRange(1, 1, cr, cc).breakApart();
    } catch (e) {}
    sh.clearContents();
    sh.clearFormats();
  } else {
    sh = ss.insertSheet(MLB_PITCHER_K_SIM_TAB);
  }
  sh.setTabColor('#1565c0');

  sh.getRange(1, 1, 1, 22)
    .merge()
    .setValue(
      '⚡ Sim_Pitcher_K — anchored Poisson (ANCHOR_WEIGHT_K); EV is authoritative for 🃏 K rows.'
    )
    .setFontWeight('bold')
    .setBackground('#0d47a1')
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center')
    .setWrap(true);
  sh.setRowHeight(1, 36);

  const headers = [
    'gamePk',
    'matchup',
    'side',
    'pitcher',
    'fd_k_line',
    'fd_over',
    'fd_under',
    'proj_IP',
    'lambda_K_anchored',
    'edge_vs_line',
    'p_over',
    'p_under',
    'implied_over',
    'implied_under',
    'ev_over_$1',
    'ev_under_$1',
    'best_side',
    'best_ev_$1',
    'flags',
    'pitcher_id',
    'hp_umpire',
    'throws',
  ];
  sh.getRange(3, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight('bold')
    .setBackground('#1976d2')
    .setFontColor('#ffffff');

  if (out.length) {
    sh.getRange(4, 1, out.length, headers.length).setValues(out);
    try {
      ss.setNamedRange('MLB_PITCHER_K_SIM', sh.getRange(4, 1, out.length, headers.length));
    } catch (e) {}
  }
  sh.setFrozenRows(3);
  try {
    ss.toast(out.length + ' sim rows · anchored λ', 'Pitcher K Sim', 6);
  } catch (e) {}
}

/** Empty K card → clear sim tab and leave a one-line hint (no data rows). */
function mlbClearPitcherKSimSheet_(ss) {
  let sh = ss.getSheetByName(MLB_PITCHER_K_SIM_TAB);
  if (!sh) sh = ss.insertSheet(MLB_PITCHER_K_SIM_TAB);
  sh.clear();
  sh.getRange(1, 1).setValue('⚡ Sim_Pitcher_K — run 🎰 Pitcher_K_Card first');
}
```

- [ ] **Step 2: Commit**

```bash
git add MLBSimPitcherK.js
git commit -m "feat: Pitcher K Sim sheet (anchored Poisson phase 1)"
```

- [ ] **Step 3: Manual verify**

Run `refreshPitcherKBetCard` then **`refreshPitcherKSimEngine_`** from editor.

**Expected:** For a row where `lambda_K` ≠ line, `lambda_K_anchored` on sim sits **between** model λ and FD line when `0 < ANCHOR_WEIGHT_K < 1`. `p_over`/`p_under` on sim differ from card when anchor ≠ 0.

---

### Task 3: Wire bet card + staging rebuild

**Files:**
- Modify: `MLBBetCard.js`

- [ ] **Step 1: Call Sim after K card in `mlbRebuildStagingForBetCard_`**

After `refreshPitcherKBetCard();` insert:

```javascript
  refreshPitcherKSimEngine_();
```

- [ ] **Step 2: Point K plays at sim tab**

In `refreshMLBBetCardMergeOnly_`:

1. Prerequisite block: require **`⚡ Sim_Pitcher_K`** OR hits OR TB — e.g. define `const simTab = ss.getSheetByName(MLB_PITCHER_K_SIM_TAB);` (constant must live in `MLBSimPitcherK.js`; in `MLBBetCard.js` use the **same string literal** `'⚡ Sim_Pitcher_K'` **or** declare `const MLB_PITCHER_K_SIM_TAB = '⚡ Sim_Pitcher_K';` at top of `MLBBetCard.js` and add a one-line comment "keep in sync with MLBSimPitcherK.js". Prefer **duplicate const in MLBBetCard.js** with sync comment to avoid load-order issues across files.)

```javascript
const MLB_PITCHER_K_SIM_TAB = '⚡ Sim_Pitcher_K'; // sync MLBSimPitcherK.js
```

Change prerequisite from only `kTab` to `simTab` for K branch:

```javascript
  const simTab = ss.getSheetByName(MLB_PITCHER_K_SIM_TAB);
  // ...
  if (
    (!simTab || simTab.getLastRow() < 4) &&
    (!hitTab || hitTab.getLastRow() < 4) &&
    (!tbTab  || tbTab.getLastRow()  < 4)
  ) {
```

2. Replace first `mlbCollectPlaysFromPitcherOddsCard_` `srcTab` argument:

Change `MLB_PITCHER_K_CARD_TAB` → `MLB_PITCHER_K_SIM_TAB`.

3. Update disclaimer string for K to:

```javascript
      'Model: Anchored Poisson on λ (ANCHOR_WEIGHT_K) after 🎰 card; EV from ⚡ Sim. Not devigged.',
```

- [ ] **Step 3: Commit**

```bash
git add MLBBetCard.js
git commit -m "feat: bet card reads K plays from Sim tab"
```

- [ ] **Step 4: Manual verify**

Run **`refreshMLBBetCard`** (full).

**Expected:** K rows on `🃏 MLB_Bet_Card` use **anchored** probabilities—compare one play’s `model %` to `⚡ Sim_Pitcher_K` `p_over`/`p_under` for same pitcher/line.

---

### Task 4: Pipeline + menu + Config

**Files:**
- Modify: `PipelineMenu.js`
- Modify: `Config.js`

- [ ] **Step 1: Config key**

In `Config.js` `buildConfigTab` after `K9_BLEND_L7_WEIGHT` row (or next logical row), add:

```javascript
  row_('ANCHOR_WEIGHT_K', '0.35', '0..1 blend of model λ vs FD K line for ⚡ Sim_Pitcher_K (anchored Poisson)');
```

- [ ] **Step 2: Pipeline `runMLBBallWindow_`**

After `step('Pitcher K card', refreshPitcherKBetCard);` insert:

```javascript
  step('Sim Engine (Pitcher K)', refreshPitcherKSimEngine_);
```

Extend `outcomes` handling: there are **12** steps after insert (was 11). Re-index:

| New index | Step name |
|-----------|-----------|
| 0 | Config |
| 1 | MLB injuries |
| 2 | MLB schedule |
| 3 | Pitcher game logs |
| 4 | FanDuel MLB odds |
| 5 | Slate board |
| 6 | Pitcher K queue |
| 7 | Pitcher K card |
| **8** | **Sim Engine (Pitcher K)** |
| 9 | Batter Hits card |
| 10 | Batter TB card |
| 11 | MLB Bet Card |

Replace the **entire** `// Outcomes index` block and following `logStep_` lines through **`MLB Bet Card`** so indices match **12** `step(...)` calls. **Concrete target:**

```javascript
  // Outcomes index (0-based) — must match step() order above
  const oCfg      = outcomes[0]  || { ok: true };
  const oInj      = outcomes[1]  || { ok: true };
  const oSch      = outcomes[2]  || { ok: true };
  const oGameLogs = outcomes[3]  || { ok: true };
  const oOdds     = outcomes[4]  || { ok: true };
  const oSlate    = outcomes[5]  || { ok: true };
  const oPkQ      = outcomes[6]  || { ok: true };
  const oPkC      = outcomes[7]  || { ok: true };
  const oSim      = outcomes[8]  || { ok: true };
  const oHits     = outcomes[9]  || { ok: true };
  const oTb       = outcomes[10] || { ok: true };
  const oBet      = outcomes[11] || { ok: true };

  logStep_('Config',           1, oCfg.ok      ? 1 : 0,  oCfg.ok      ? '' : oCfg.err      || 'failed');
  logStep_('MLB injuries',     0, oInj.ok      ? mlbTabDataRowsBelowHeader3_(ss, MLB_INJURY_CONFIG.tabName)  : 0, oInj.ok      ? '' : oInj.err      || 'failed');
  logStep_('MLB schedule',     0, oSch.ok      ? mlbTabDataRowsBelowHeader3_(ss, MLB_SCHEDULE_TAB)           : 0, oSch.ok      ? '' : oSch.err      || 'failed');
  logStep_('Pitcher game logs',0, oGameLogs.ok ? mlbTabDataRowsBelowHeader3_(ss, MLB_PITCHER_GAME_LOGS_TAB)  : 0, oGameLogs.ok ? '' : oGameLogs.err || 'failed');
  logStep_('FanDuel MLB odds', 0, oOdds.ok     ? mlbTabDataRowsBelowHeader3_(ss, MLB_ODDS_CONFIG.tabName)    : 0, oOdds.ok     ? '' : oOdds.err     || 'failed');
  logStep_('Slate board',      0, oSlate.ok    ? mlbTabDataRowsBelowHeader3_(ss, MLB_SLATE_BOARD_TAB)        : 0, oSlate.ok    ? '' : oSlate.err    || 'failed');
  logStep_('Pitcher K queue',  0, oPkQ.ok      ? mlbTabDataRowsBelowHeader3_(ss, MLB_PITCHER_K_QUEUE_TAB)   : 0, oPkQ.ok      ? '' : oPkQ.err      || 'failed');
  logStep_('Pitcher K card',   0, oPkC.ok      ? mlbTabDataRowsBelowHeader3_(ss, MLB_PITCHER_K_CARD_TAB)    : 0, oPkC.ok      ? '' : oPkC.err      || 'failed');
  logStep_('Sim Engine (Pitcher K)', 0, oSim.ok ? mlbTabDataRowsBelowHeader3_(ss, '⚡ Sim_Pitcher_K') : 0, oSim.ok ? '' : oSim.err || 'failed');
  logStep_('Batter Hits card', 0, oHits.ok     ? mlbTabDataRowsBelowHeader3_(ss, MLB_BATTER_HITS_CARD_TAB)  : 0, oHits.ok     ? '' : oHits.err     || 'failed');
  logStep_('Batter TB card',   0, oTb.ok       ? mlbTabDataRowsBelowHeader3_(ss, MLB_BATTER_TB_CARD_TAB)    : 0, oTb.ok       ? '' : oTb.err       || 'failed');
  logStep_('MLB Bet Card',     0, oBet.ok      ? mlbTabDataRowsBelowHeader3_(ss, MLB_BET_CARD_TAB)          : 0, oBet.ok      ? '' : oBet.err      || 'failed');
```

(`MLB_SLATE_BOARD_TAB` etc. are existing globals in this project.)

**Menu:** add after K card item:

```javascript
    .addItem('⚡ Pitcher K Sim only (anchored → ⚡ tab)', 'refreshPitcherKSimEngine_')
```

- [ ] **Step 3: Commit**

```bash
git add PipelineMenu.js Config.js
git commit -m "feat: pipeline + config for Pitcher K Sim"
```

- [ ] **Step 4: Manual verify**

Run **🌅 Morning** (or Midday) once on a slate with K lines.

**Expected:** `⚾ Pipeline_Log` shows a row **Sim Engine (Pitcher K)** with row count matching `⚡ Sim_Pitcher_K` data rows; no uncaught exceptions.

---

### Task 5: Documentation

**Files:**
- Modify: `docs/STATUS.md`

- [ ] **Step 1: Update orchestrator table and step list**

- Add row under Done: **`⚡ Sim_Pitcher_K`** — anchored Poisson, `ANCHOR_WEIGHT_K`, feeds 🃏 for K.  
- In **`runMLBBallWindow_` order**, insert **Sim Engine (Pitcher K)** between Pitcher K card and Batter Hits (`refreshPitcherKSimEngine_`).

- [ ] **Step 2: Commit**

```bash
git add docs/STATUS.md
git commit -m "docs: STATUS reflects Pitcher K Sim pipeline"
```

---

## Regression checklist (no automated test runner)

| Check | How | Expected |
|-------|-----|------------|
| K card still builds | Menu **🎰 Pitcher K card only** | `🎰 Pitcher_K_Card` has rows when queue OK |
| Sim builds | Menu **⚡ Pitcher K Sim only** | `⚡ Sim_Pitcher_K` rows match card count |
| Bet card K source | Inspect formula N/A — compare numeric `model %` column on 🃏 vs sim `p_*` | Match selected side |
| Hits/TB unchanged | Confirm hits/TB plays still appear when sim thin | Merge still concat three sources |
| Pipeline log | Morning run | **Sim Engine (Pitcher K)** step present with non-zero output when K slate exists |

---

## Plan self-review (skill checklist)

**1. Spec coverage**

| Spec requirement | Task |
|------------------|------|
| Sim stage for pitcher K | Task 2, 4 |
| Single authoritative p for bet card K | Task 3 (merge reads sim) |
| Pipeline_Log **Sim Engine** naming | Use **`Sim Engine (Pitcher K)`** for both `step(...)` display and `logStep_(...)` row label. |
| Config `ANCHOR_WEIGHT` family | Task 4 `ANCHOR_WEIGHT_K` |
| Context score Phase 3 | Explicitly deferred; sim sheet header notes anchored only |
| Non-goals (no live clasp, no new markets) | Honored |

**2. Placeholder scan** — None intended; all code blocks complete.

**3. Type / name consistency** — `MLB_PITCHER_K_SIM_TAB` must match in `MLBSimPitcherK.js` and `MLBBetCard.js` (comment “sync”). `refreshPitcherKSimEngine_` global function name used in `PipelineMenu.js` and `MLBBetCard.js`.

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-11-pitcher-k-sim-phase1.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**

---

## Follow-up (not in this plan)

- Phase 2: same pattern for **`🎰 Batter_Hits_Card`** / TB with binomial/Poisson anchoring.  
- Phase 3: non-zero **context score** from umpire/Savant signals per architecture spec.  
- Optional hardening: on empty K card, write frozen row-3 headers on `⚡ Sim_Pitcher_K` so operators see column names without opening the K card first.
