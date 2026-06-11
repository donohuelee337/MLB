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

// Shrink history (same h.v2-full projection, different probability layer):
//   build ≤26: symmetric H_MODEL_P_SHRINK (both sides scaled — incoherent,
//     P(O)+P(U) = shrink < 1; suppressed Unders). Now the SHADOW in audit
//     cols 37..40 of ⚡ Sim_Batter_Hits as p_*_sym.
//   build 27+: h.v2-full-sim-os — one-sided shrink LIVE: Over scaled (the
//     documented overconfident side), Under = exact complement on half lines.
const MLB_HITS_MODEL_VERSIONS = {
  active: 'h.v2-full-sim-os',
  shadow: ['h.v1', 'h.v3-contact', 'h.v2-full-sym'],
};

function mlbHitsActiveModelVersion_() {
  return MLB_HITS_MODEL_VERSIONS.active || 'h.v2-full-sim-os';
}

function mlbHitsShadowModelVersions_() {
  const arr = MLB_HITS_MODEL_VERSIONS.shadow || [];
  return arr.slice();
}
