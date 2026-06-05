// ============================================================
// 🏷️ MLB hits model versions — central registry
// ============================================================
// Every hits-projection variant tagged here so MLB_Results_Log /
// MLB_Results_Log_v2 rows carry a stable model_version label and the
// 🔬 Hits_Model_Compare panel can pivot on it.
// ============================================================
// To add a new shadow variant: append its name to .shadow and implement
// a separate card tab + snapshot (see h.v3-contact in MLBBatterHitsV3.js).
//
// Promote v3 → live only after 🧪 MLB_Results_Log_Hits_v3 shows positive ROI
// vs v2 on the same slates (MIN_MODEL_PCT_H / MIN_EDGE_H gates). v4 should
// fork as a new shadow tab — do not replace v2-full until v3 is promoted.
// ============================================================

// Calibration experiment (not a model family — same h.v2-full projection):
//   h.v2-full-1side — one-sided H_MODEL_P_SHRINK. The live shrink scales both
//   Over and Under; this variant shrinks only the Over (the documented
//   overconfident side) and derives Under as the complement. Runs as audit-only
//   shadow columns 37..40 on ⚡ Sim_Batter_Hits (no separate tab/log). Promote by
//   swapping the live pOAdj/pUAdj block in MLBSimBatterHits.js once its graded
//   ROI beats the symmetric shrink.
const MLB_HITS_MODEL_VERSIONS = {
  active: 'h.v2-full',
  shadow: ['h.v1', 'h.v3-contact'],
};

function mlbHitsActiveModelVersion_() {
  return MLB_HITS_MODEL_VERSIONS.active || 'h.v2-full';
}

function mlbHitsShadowModelVersions_() {
  const arr = MLB_HITS_MODEL_VERSIONS.shadow || [];
  return arr.slice();
}
