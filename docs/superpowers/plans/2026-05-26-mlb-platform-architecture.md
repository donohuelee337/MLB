# MLB Platform Architecture — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Sim as the authoritative probability layer for live K + H picks; run Sim in the main pipeline before publish; bet card reads `⚡ Sim_*` tabs.

**Architecture:** Broker/worker split unchanged in behavior — snapshot stays isolated. Phase 1 only fixes probability authority drift documented in `docs/superpowers/specs/2026-05-26-mlb-platform-architecture-design.md`. K Sim already mirrors K card schema; Hits Sim updated to read live v2 card and write v2-compatible rows.

**Tech Stack:** Google Apps Script (V8), Google Sheets, `clasp push --force`

**Spec:** `docs/superpowers/specs/2026-05-26-mlb-platform-architecture-design.md`

---

## File map

| Action | File | What changes |
|--------|------|--------------|
| Modify | `PipelineMenu.js` | Sim steps after K card + Hits v2; log Sim rows; menu items; Band D/E comments |
| Modify | `MLBBetCard.js` | Read `⚡ Sim_Pitcher_K` + `⚡ Sim_Batter_Hits`; refresh sim before merge; update messages |
| Modify | `MLBSimBatterHits.js` | Source `🧪 Batter_Hits_Card_v2-full`; output v2-compatible schema |
| Modify | `docs/STATUS.md` | Orchestrator order + Sim authority |
| Modify | `docs/superpowers/specs/2026-05-26-mlb-platform-architecture-design.md` | Status → Approved after review |

---

## Task 1: Hits Sim reads v2 live card

**Files:** `MLBSimBatterHits.js`

- [x] Replace undefined `MLB_BATTER_HITS_BINOMIAL_TAB` with `MLB_BATTER_HITS_V2_CARD_TAB`
- [x] Map v2 columns: line=3, λ=6, est_pa=25; anchor λ; recompute binomial p/EV/best_side
- [x] Write sim tab rows matching v2 layout (cols 0–17 + 32–33 passthrough) so bet card column indices unchanged
- [x] Update sheet title string to reference v2 source

---

## Task 2: Pipeline — Sim before publish

**Files:** `PipelineMenu.js`

- [x] After `Pitcher K card`, add `step('Sim Engine (Pitcher K)', refreshPitcherKSimEngine_)`
- [x] After `Batter Hits v2 card`, add `step('Sim Engine (Batter Hits)', refreshBatterHitsSimEngine_)`
- [x] Update `outcomes[]` index constants for logStep_
- [x] Add `logStep_('Sim Engine (Pitcher K)', …)` and `logStep_('Sim Engine (Batter Hits)', …)`
- [x] Add menu: **⚡ Pitcher K Sim only**, **⚡ Batter Hits Sim only**
- [x] Comment blocks: Band C (project) vs Band D (publish) vs Band E (workers)

---

## Task 3: Bet card reads Sim

**Files:** `MLBBetCard.js`

- [x] At start of `refreshMLBBetCard`, call both sim refresh functions (idempotent)
- [x] K merge: `MLB_PITCHER_K_SIM_TAB` primary; warn + fallback to K card if sim empty
- [x] H merge: `MLB_BATTER_HITS_SIM_TAB` primary; warn + fallback to v2 card if sim empty
- [x] Update header comments and empty-state messages to reference `⚡ Sim_*`

---

## Task 4: Docs

**Files:** `docs/STATUS.md`, spec status line

- [x] Update orchestrator step list (Sim steps, TB retired note)
- [x] Mark spec Phase 1 checklist items done

---

## Verification (manual on Sheet)

1. Run **Morning** (or K/H card + sim + bet card only).
2. Confirm `⚡ Sim_Pitcher_K` and `⚡ Sim_Batter_Hits` populated after stat cards.
3. Confirm `🃏` K/H rows: model % and EV match Sim tab for same player/line/side.
4. Temporarily throw in `refreshMLBProfitabilityReport` — bet card and snapshot should still exist from FINAL.

---

## Out of scope (Phase 2+)

- `Config_Park`, `Config_Grades` tabs
- Pure `project*_(ctx)` engine extraction
- Scoped `runKChainOnly_` menu chains
