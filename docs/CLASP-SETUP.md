# clasp setup (fix “Project not found” on `clasp push`)

`clasp` needs two things: **you are logged in as the Google account that owns the script**, and **`.clasp.json` contains the correct `scriptId`**.

---

## 1. Install clasp (once)

```bash
npm install -g @google/clasp
```

Check: `clasp --version`

---

## 2. Log in (once per machine / account)

```bash
clasp login
```

A browser opens; authorize **the same Google account** you use for the Sheet / Apps Script.

If you use multiple accounts:

```bash
clasp login --creds creds.json
```

(Advanced; usually `clasp login` is enough.)

---

## 3. Get the correct `scriptId`

### If you already have a Sheet + Apps Script

1. Open the **Spreadsheet**.
2. **Extensions → Apps Script**.
3. Look at the URL in the browser. It will look like:

   `https://script.google.com/home/projects/THIS_LONG_STRING_IS_THE_SCRIPT_ID/edit`

   Copy **`THIS_LONG_STRING_IS_THE_SCRIPT_ID`** (letters, numbers, sometimes hyphens).

### If you do not have a script yet

Either create a Sheet and use step above, **or** from `mlb-boiz` folder:

```bash
cd C:\Users\Garage\Documents\Cursor\mlb-boiz
clasp create --title "MLB-BOIZ" --type sheets
```

That creates a **new** Sheet + container-bound script and writes **`.clasp.json`** for you. Then copy your repo’s `.js` / `appsscript.json` into this folder (or merge) and `clasp push`.

---

## 4. `.clasp.json` in the repo folder

This repo **tracks** `.clasp.json` so clones on other machines work with the same Apps Script project (after `clasp login` on each machine).

- If you fork for a **new** script: copy `.clasp.json.example` → `.clasp.json` and set your own `scriptId`.

Optional: set **rootDir** if script files live in a subfolder; here `""` means this folder.

---

## 5. Push (use the deploy script)

**Preferred:** from repo root, commit your changes first, then:

```powershell
pwsh -File scripts/clasp-deploy.ps1
```

Optional message for the Apps Script version history:

```powershell
pwsh -File scripts/clasp-deploy.ps1 -Message "platform sim authority"
```

The script will:

1. Bump `MLB_APPS_SCRIPT_BUILD` in `Config.js` and commit that bump
2. Tag git (`apps-script/pre-push-YYYYMMDD-HHMMSS-bN`) unless `-SkipTag`
3. `clasp push --force`
4. `clasp version "build N — …"` — **creates a new Apps Script version every deploy**

After deploy, run menu **0. Build Config tab** once so **`APPS_SCRIPT_BUILD`** appears on **`⚙️ Config`**.

**Manual push only** (no version bump — avoid for production):

```bash
clasp push --force
```

If clasp warns that the **remote manifest** (`appsscript.json`) was updated and asks to overwrite, and your **local** manifest is what you want, `--force` **forcibly overwrites the remote manifest** with your local `appsscript.json`.

First push may ask to enable the Apps Script API — follow the link clasp prints, enable it, wait a minute, retry.

---

## Why you see “Project not found”

| Cause | Fix |
|--------|-----|
| No `.clasp.json` or empty `scriptId` | Create file, paste real ID from URL |
| Wrong ID (typo, copied container ID from wrong place) | Re-copy from **script.google.com/home/projects/.../edit** |
| Logged into clasp as **Account A**, script owned by **Account B** | `clasp logout` then `clasp login` with B |
| Script was deleted | New Sheet → Apps Script → new ID → update `.clasp.json` |
| Using **Drive file ID** or **Spreadsheet ID** instead of **Script ID** | Script ID is from **script.google.com** URL, **not** `docs.google.com/spreadsheets/d/...` |

**Important:** The **Spreadsheet ID** is not the same as the **Apps Script project ID**. For container-bound scripts, open **Extensions → Apps Script** and use that project’s URL.

---

## 6. Pull remote changes (optional)

If you edited code in the browser:

```bash
clasp pull
```

---

## 7. Open the project in the browser

```bash
clasp open
```

Opens the correct Apps Script project for your `scriptId`.
