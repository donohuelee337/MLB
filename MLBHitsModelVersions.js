// ============================================================
// 🏷️ MLB hits model versions — central registry
// ============================================================
// Every hits-projection variant tagged here so MLB_Results_Log /
// MLB_Results_Log_v2 rows carry a stable model_version label and the
// 🔬 Hits_Model_Compare panel can pivot on it.
// ============================================================
// To add a new shadow variant: append its name to .shadow and implement
// it in MLBBatterHitsV2.js (e.g. h.v2-rates picks up if a separate card
// tab + snapshot are wired).
// ============================================================

const MLB_HITS_MODEL_VERSIONS = {
  active: 'h.v1',
  shadow: ['h.v2-full'],
};

function mlbHitsActiveModelVersion_() {
  return MLB_HITS_MODEL_VERSIONS.active || 'h.v1';
}

function mlbHitsShadowModelVersions_() {
  const arr = MLB_HITS_MODEL_VERSIONS.shadow || [];
  return arr.slice();
}
