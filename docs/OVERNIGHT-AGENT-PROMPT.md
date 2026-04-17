# Overnight one-liner (wake up to a testable MLB slate)

Paste this as a **new Cursor agent chat** (with **YOLO / auto-run** on) after you have pushed `mlb-boiz` and opened the repo:

---

**Prompt:**

```
You are in repo mlb-boiz (Google Apps Script MLB-BOIZ). Goal: I can test tomorrow's MLB slate tomorrow morning.

Do ALL of this without asking me to approve each tool:

1. Verify ODDS_API_KEY is documented only in README (no secrets in git). Grep the repo for accidental keys.

2. Add any missing glue so `runMorningWindowMLB` is deployable: fix JSON/JS issues, ensure Config SLATE_DATE is documented for "tomorrow" in America/New_York.

3. Optional: add `runForTomorrow()` that sets SLATE_DATE to calendar tomorrow in NY and runs morning window (or document setting Config manually).

4. If clasp is configured, run `clasp push`. If not, print exact steps: create bound script, paste files, set Script Property ODDS_API_KEY.

5. Commit and push to origin main with message: "chore: overnight slate prep".

6. Output a 5-line "tomorrow morning checklist" for me in the Sheet: open menu → set date → run morning → verify two tabs populated.

```

---

## What you must do **before** sleeping (human, ~5 minutes)

1. **GitHub**: create empty repo `mlb-boiz` under your account (if `gh repo create` is not set up).
2. **Local**: `git remote add origin …` and `git push -u origin main` from the `mlb-boiz` folder (first push).
3. **Google**: new Sheet + Apps Script project; **Script property** `ODDS_API_KEY` = your Odds API key.
4. **Clasp** (optional): `clasp login`, copy `scriptId` into `.clasp.json`, `clasp push` once from this repo.

No magic phrase is required beyond **turning on YOLO** and giving the block above; the blocker is usually **GitHub auth + Apps Script binding**, which the agent cannot complete without your accounts.
