# Tomorrow’s slate — quick checklist

1. Open the **Google Sheet** bound to this Apps Script project.
2. **Extensions → Apps Script** — confirm **Script property** `ODDS_API_KEY` is set (Project settings → Script properties).
3. Reload the Sheet so **⚾ MLB-BOIZ** appears in the menu.
4. **Today’s slate:** **⚾ MLB-BOIZ → Morning — Injuries + schedule + FanDuel odds** (uses `SLATE_DATE` on **⚙️ Config**, or today if blank).
5. **Tomorrow’s slate (NY calendar):** **⚾ MLB-BOIZ → Set SLATE_DATE to tomorrow (NY) + Morning** — then confirm `📅 MLB_Schedule` and `✅ FanDuel_MLB_Odds` populated for that date.
6. If odds are empty, props may not be posted yet — run Morning again later; injuries + schedule still refresh.
