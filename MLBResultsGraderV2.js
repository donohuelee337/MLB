// ============================================================
// 📊 MLB Results Grader v2 — grades 🧪 MLB_Results_Log_v2 (hits shadow)
// ============================================================
// Parallels gradeMLBPendingResults_() but reads from the v2 log. Hits-only.
// v1 grader is untouched. Idempotent: skips rows whose result is set
// and not PENDING. Boxscore source = same statsapi endpoint v1 uses.
// ============================================================

/**
 * Fetch game data from statsapi for grading. Uses /feed/live (v1.1), NOT
 * /boxscore (v1): /boxscore omits game status, so mlbBoxscoreIsFinal_ can
 * never see a 'Final' field and the grader writes "NOT_FINAL — will retry
 * later" on every row forever. /feed/live carries player stats
 * (liveData.boxscore.teams — same shape mlbBoxscoreTeams_ already reads)
 * AND game status (gameData.status / liveData.game.status).
 */
function mlbFetchFeedLiveJsonV2_(gamePk) {
  const g = parseInt(gamePk, 10);
  if (!g) return null;
  // /feed/live lives on v1.1 (not v1) — going through mlbStatsApiBaseUrl_()
  // points at /api/v1/... and returns 404. Hardcode the host here.
  const url = 'https://statsapi.mlb.com/api/v1.1/game/' + g + '/feed/live';
  try {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return null;
    return JSON.parse(res.getContentText());
  } catch (e) {
    Logger.log('mlbFetchFeedLiveJsonV2_: ' + e.message);
    return null;
  }
}

/**
 * Normalize a slate cell (Date or string) to 'yyyy-MM-dd'. Sheets auto-
 * converts yyyy-MM-dd strings to Date on write; reads come back as Date.
 * Without this helper, `String(date) >= 'yyyy-MM-dd'` puts every slate in
 * the future bucket and the grader silently skips every row.
 */
function mlbReadSlateYmdV2_(cell) {
  if (cell == null || cell === '') return '';
  if (Object.prototype.toString.call(cell) === '[object Date]') {
    const tz = Session.getScriptTimeZone();
    return Utilities.formatDate(cell, tz, 'yyyy-MM-dd');
  }
  const s = String(cell).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    const tz = Session.getScriptTimeZone();
    return Utilities.formatDate(d, tz, 'yyyy-MM-dd');
  }
  return s;
}

function gradeMLBHitsV2PendingResults_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logSh = ss.getSheetByName(MLB_RESULTS_LOG_V2_TAB);
  if (!logSh || logSh.getLastRow() < 4) return;

  const today = mlbTodayYmdNY_();
  const last = logSh.getLastRow();
  const data = logSh.getRange(4, 1, last - 3, MLB_RESULTS_LOG_V2_NCOL).getValues();

  let graded = 0;

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const slateStr = mlbReadSlateYmdV2_(row[1]);
    const resCell = String(row[16] || '').trim();
    if (!slateStr || slateStr >= today) continue;
    if (resCell && resCell !== 'PENDING') continue;

    let gamePk = parseInt(row[13], 10);
    let pid = parseInt(row[14], 10);
    const matchup = String(row[4] || '').trim();
    const player = String(row[3] || '').trim();
    const line = row[6];
    const side = row[7];

    if ((!gamePk || isNaN(gamePk)) && slateStr && matchup) {
      gamePk = mlbResolveGamePkFromSchedule_(slateStr, matchup, player);
    }
    if ((!pid || isNaN(pid)) && player) {
      pid = mlbStatsApiResolvePlayerIdFromName_(player);
    }

    if (!gamePk || isNaN(gamePk) || !pid || isNaN(pid)) {
      logSh.getRange(4 + i, 18).setValue('Missing gamePk or player_id — re-run snapshot / check name→id');
      continue;
    }

    let box = mlbFetchFeedLiveJsonV2_(gamePk);
    Utilities.sleep(120);
    if (!box) {
      logSh.getRange(4 + i, 18).setValue('Feed/live fetch failed');
      continue;
    }
    // If feed says not-final on a past slate, the stored gamePk may point
    // at a rescheduled/relocated future game. Re-resolve gamePk from the
    // schedule for this slate's date and retry once.
    if (!mlbBoxscoreIsFinal_(box) && slateStr && matchup) {
      const altPk = mlbResolveGamePkFromSchedule_(slateStr, matchup, player);
      if (altPk && altPk !== gamePk) {
        const box2 = mlbFetchFeedLiveJsonV2_(altPk);
        Utilities.sleep(120);
        if (box2 && mlbBoxscoreIsFinal_(box2)) {
          gamePk = altPk;
          box = box2;
        }
      }
    }
    if (!mlbBoxscoreIsFinal_(box)) {
      // Past-slate row that still can't find a final game: most likely
      // postponed/relocated. VOID it once it's ≥2 days old so it stops
      // getting retried; otherwise leave PENDING for a later window.
      const ageMs = new Date(today + 'T00:00:00').getTime() - new Date(slateStr + 'T00:00:00').getTime();
      const daysOld = Math.floor(ageMs / 86400000);
      if (daysOld >= 2) {
        logSh.getRange(4 + i, 17).setValue('VOID');
        logSh.getRange(4 + i, 18).setValue('Game not played on this slate (postponed/relocated)');
        graded++;
      } else {
        logSh.getRange(4 + i, 18).setValue('NOT_FINAL — will retry later');
      }
      continue;
    }

    const hActual = mlbBatterHitsFromBoxscore_(box, pid);
    if (hActual === null) {
      logSh.getRange(4 + i, 16).setValue('');
      logSh.getRange(4 + i, 17).setValue('VOID');
      logSh.getRange(4 + i, 18).setValue('No batting line (DNP?)');
      graded++;
      continue;
    }

    const g = mlbGradePitcherKRow_(line, side, hActual);
    logSh.getRange(4 + i, 14).setValue(gamePk);
    logSh.getRange(4 + i, 15).setValue(pid);
    logSh.getRange(4 + i, 16).setValue(hActual);
    logSh.getRange(4 + i, 17).setValue(g.result);
    logSh.getRange(4 + i, 18).setValue('statsapi feed/live H (v2) · ' + g.note);
    graded++;
  }

  if (graded > 0) {
    try {
      ss.toast('Graded ' + graded + ' v2 hits row(s)', 'MLB-BOIZ', 6);
    } catch (e) {}
  }
}
