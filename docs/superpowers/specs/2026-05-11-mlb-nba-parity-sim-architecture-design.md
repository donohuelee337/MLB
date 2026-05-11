# MLB–NBA parity: stacked StatEngine + Sim architecture

**Status:** Approved (design dialogue 2026-05-11).  
**Scope:** Projection and probability architecture only—how MLB-BOIZ should evolve to mimic **NBA AI-BOIZ** spirit: staged pipeline, single authoritative probability path, Sim gates.  
**Non-scope:** Live vs preview `clasp` promotion, new markets beyond what phases below name, UI theme changes.

**Related:** `docs/2026-04-11-mlb-pitcher-k-pipeline-design.md` (detailed K-only reference: anchored mean, context score, double-counting rules, config keys). This spec **does not duplicate** every formula; it **locks architecture and phasing** so implementation plans can cite the older doc for numerics.

---

## 1. North star

- **Intent:** Whenever MLB and NBA differ (sport mechanics, APIs), the **product shape** should still match NBA AI-BOIZ: **Ingest → Slate → Stats (StatEngine) → Sim → Bet Card → Pipeline Log**, with funnel lines, warnings, caps, and selection discipline the user already trusts on NBA.
- **Rule:** The **bet card must not be the sole owner of “true” probability** for a play. It consumes outputs from a **Sim** stage that sits on top of **Stats/StatEngine**, so there is **one coherent probability story** per candidate (aligned with the “anchored Poisson” story in the 2026 pitcher-K pipeline design).

---

## 2. What “bigger architecture” means here

- **Primary meaning:** **Stacked engines**—Stats produces **raw projection + diagnostics**; Sim applies **anchoring**, **bounded context scoring**, and **gates**; Bet Card applies **sorting, floors, caps, Kelly, grades** from Sim outputs plus config.
- **Anchored mean:** Recompute **p vs line** using a mean anchored toward the book line (`ANCHOR_WEIGHT` and family)—see reference doc §10.
- **Context score:** Umpire / framing / ABS-team style signals contribute through **bounded weights and caps**, not silent λ hacks—see reference doc **double-counting table** (talent/park/platoon/blanket ABS on λ; umpire/catcher/ABS team quality in Sim context only).
- **Monte Carlo (optional, later):** If introduced, it **replaces** closed-form `p` **behind the same Sim interface** (same columns consumed by the bet card). It is **not** phase-1 scope.

---

## 3. Approaches (decision record)

| Option | Description | Verdict |
|--------|-------------|---------|
| **Big-bang** | Re-file and re-tab exactly as `MLBMenu` / `MLBSlate` / `MLBStats` / `MLBSim` split in the 2026 design doc | **Deferred** until Sim **I/O contract** is proven on real slates |
| **Sim layer first (chosen)** | Keep current ingest + queues + stat cards where useful; add explicit **Sim** step + sheet (or named range) that writes **authoritative** `p`, edge, tiers; **Bet Card reads Sim only** for EV/selection | **Phase 1 path** |
| **MC-first** | Trial-based joint sim as headline | **Rejected** for phase 1—risks missing NBA-shaped value; revisit only with clear distribution failure |

---

## 4. Component boundaries

| Unit | Responsibility | Depends on |
|------|----------------|------------|
| **Ingest** (existing modules) | Odds, injuries, schedule, logs, optional Savant CSVs | APIs, `Config` |
| **Slate / queues** (existing) | Candidate rows keyed by `gamePk`, player, market, line, odds | Ingest |
| **StatEngine / Stats** | Per-candidate **model mean** (e.g. λ for K), component factors, **diagnostics** (sample size, fallbacks) | Queues, Stats API, config weights |
| **Sim** | **Anchored mean**, recomputed **p_over / p_under** (or equivalent), **context score**, **tier labels**, **CV-style gate inputs** | StatEngine row + FD line/odds + signal columns |
| **Bet Card** | Merge, sort, rubric, Kelly, caps—**no second independent EV math** for fields that Sim already owns | Sim output + schedule for ordering |
| **Pipeline Log** | Step boundaries including explicit **`Sim Engine`** row; warnings on neutral fallbacks | All stages |

---

## 5. Phasing

### Phase 1 — Pitcher K only (contract freeze)

- **Goal:** End-to-end **K** candidates flow **Stats → Sim → Bet Card** with **one authoritative** probability set for over/under vs line.
- **Acceptance:** `Pipeline_Log` shows a **Sim Engine** step; bet card EV / model % for K trace to Sim columns; legacy duplicate Poisson on card is **removed or hard-deprecated** (single code path). Exact Sim tab column names and merge keys are defined in the implementation plan so `MLBBetCard.js` stays stable.
- **Config:** Reuse or align names with reference doc (`ANCHOR_WEIGHT`, gate thresholds); exact defaults belong in the implementation plan.

### Phase 2 — Batter props (same contract)

- Apply the **same Sim shell** to **hits / TB / HR** (and any other FD-backed batter markets in scope), with **distribution choice per market** (e.g. binomial / Poisson / negative binomial) **inside StatEngine**, but **anchoring + gates + context** still owned by Sim.

### Phase 3 — Richer StatEngine inputs

- Multi-window K weights (L7/L15/L30/season), platoon, park, Savant-backed signals per reference doc—**feeding** StatEngine only; Sim rules unchanged unless calibration requires new **bounded** context terms.

---

## 6. Error handling

- Non-fatal ingest or stats failure: **neutral signal or prior**, **`addPipelineWarning_`** (or equivalent), **never** silent wrong edges.
- Missing umpire / catcher / ABS CSV: context term **0** + warning, per reference doc spirit.

---

## 7. Testing and validation

- **Spot:** Manual check on 2–3 pitchers: raw λ, anchored mean, `p` vs FD line vs implied.
- **Regression:** Pipeline dry-run on a partial slate day—no script errors, sensible counts in log.
- **Calibration (ongoing):** Bucket model probability vs outcomes in **`MLB_Results_Log`** after enough graded rows; adjust gates/anchors before touching distribution family.

---

## 8. Explicit non-goals (this spec)

- Changing **live vs preview** deployment policy.
- Adding **Grand Slam / new tabs** or HR model enhancements (user backlog)—those are **separate specs** after Sim contract exists.
- Rewriting **`PipelineMenu.js`** into multiple files in phase 1 **unless** implementation plan shows a smaller extraction (e.g. `MLBSim.js` only) is sufficient.

---

## 9. Canonical workspace

Use repo root **`Documents\Cursor\MLB`** (this repository) for Cursor and `clasp push`, consistent with current team practice; ignore legacy “mlb-boiz” path strings in older doc headers when they conflict with this folder.
