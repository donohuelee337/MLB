// ============================================================
// 📡 Savant / ABS ingest — optional best-effort (MLB-BOIZ)
// ============================================================
// Validates a user-supplied public CSV URL when enabled. Does not
// mutate λ yet; successful fetch logs a funnel step for visibility.
// Wire real ABS team factors later; keep failures as warnings only.
// ============================================================

/**
 * Optional ping of Savant-style CSV (or any URL) for future ABS wiring.
 * Requires pipelineLog_ (reset in runMLBBallWindow_).
 */
function mlbSavantAbsIngestBestEffort_() {
  if (!pipelineLog_) {
    return;
  }
  const cfg = getConfig() || {};
  const on = String(cfg['SAVANT_INGEST_ENABLED'] != null ? cfg['SAVANT_INGEST_ENABLED'] : '')
    .trim()
    .toLowerCase();
  if (on !== 'true' && on !== '1' && on !== 'yes') {
    return;
  }
  const url = String(cfg['SAVANT_ABS_CSV_URL'] != null ? cfg['SAVANT_ABS_CSV_URL'] : '').trim();
  if (!url) {
    addPipelineWarning_('Savant: SAVANT_INGEST_ENABLED is on but SAVANT_ABS_CSV_URL is empty.');
    return;
  }
  if (url.indexOf('http://') !== 0 && url.indexOf('https://') !== 0) {
    addPipelineWarning_('Savant: SAVANT_ABS_CSV_URL must start with http:// or https://');
    return;
  }
  try {
    const res = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      followRedirects: true,
    });
    const code = res.getResponseCode();
    if (code !== 200) {
      addPipelineWarning_('Savant ABS CSV: HTTP ' + code + ' for URL');
      return;
    }
    const text = res.getContentText() || '';
    if (text.length < 10) {
      addPipelineWarning_('Savant ABS CSV: body too short to be useful');
      return;
    }
  } catch (e) {
    addPipelineWarning_('Savant ABS CSV fetch failed: ' + (e.message || e));
  }
}
