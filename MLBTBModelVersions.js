// ============================================================
// 🏷️ MLB TB model versions — central registry
// ============================================================
// Mirrors MLBHitsModelVersions.js. Flip `active` when promoting the
// shadow tb.v2-full model to the live 🃏 MLB_Bet_Card. Until then,
// tb.v2-full lives only on 🧪 Batter_TB_Card_v2-full + 🧪 MLB_Results_Log_TB_v2.
// ============================================================

const MLB_TB_MODEL_VERSIONS = {
  active: 'tb.v1',
  shadow: ['tb.v2-full'],
};

function mlbTbActiveModelVersion_() {
  return MLB_TB_MODEL_VERSIONS.active || 'tb.v1';
}

function mlbTbShadowModelVersions_() {
  const arr = MLB_TB_MODEL_VERSIONS.shadow || [];
  return arr.slice();
}
