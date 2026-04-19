# Tomorrow’s slate — quick checklist

1. Open the **Google Sheet** bound to this Apps Script project.
2. **Extensions → Apps Script** — confirm **Script property** `ODDS_API_KEY` is set (Project settings → Script properties).
3. Reload the Sheet so **⚾ MLB-BOIZ** appears in the menu.
4. **Today’s slate:** **⚾ MLB-BOIZ → Morning — Injuries + schedule + FanDuel odds** (uses `SLATE_DATE` on **⚙️ Config**, or today if blank).
5. **Tomorrow’s slate (NY calendar):** **⚾ MLB-BOIZ → Set SLATE_DATE to tomorrow (NY) + Morning** — then confirm `📅 MLB_Schedule` and `✅ FanDuel_MLB_Odds` populated for that date.
6. If odds are empty, props may not be posted yet — run Morning again later; injuries + schedule still refresh.
7. **Full pipeline (optional):** after Morning, confirm tabs populated: **`📒 Pitcher_Game_Logs`**, **`🎯 MLB_Slate_Board`**, **`📋 Pitcher_K_Queue`**, **`🎰 Pitcher_K_Card`**, **`🃏 MLB_Bet_Card`**, and scan **`⚾ Pipeline_Log`** for warnings (`fd_k_miss` in queue notes means FD label join still failed for that arm).
8. **Lighter refresh (same `SLATE_DATE`):** **`⚾ MLB-BOIZ → 🌤 Midday — Odds + slate + K pipeline (injuries unchanged)`** — re-pulls odds and downstream K/slate steps without ESPN injuries.
9. **After games:** **`📊 Grade pending MLB results (boxscore)`**, or run **`🔒 Final — Full refresh + snapshot`** (grades first, then refreshes). **`📋 MLB_Results_Log`** holds snapshots for grading.
10. **One stage failing:** use **`🎯 Slate board only…`**, **`📋 Pitcher K queue only…`**, **`🎰 Pitcher K card only…`**, **`🃏 MLB Bet Card only…`** to isolate.
11. **New Config knobs:** run **0. Build Config tab** once if **`K9_BLEND_L7_WEIGHT`** / **`MIN_EV_BET_CARD`** are missing — they tune 🎰 λ and 🃏 EV floor.
