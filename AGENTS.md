# MLB-BOIZ

## Cursor Cloud specific instructions

This is a **Google Apps Script** project — there is no local server, no Node.js runtime, and no local test framework. All `.js` files are GAS scripts that execute inside Google's cloud, bound to a Google Sheet.

### Key commands

| Action | Command |
|--------|---------|
| Syntax-check all source files | `for f in *.js; do node --check "$f"; done` |
| Show files clasp will deploy | `clasp status` |
| Deploy to GAS (requires auth) | `clasp push -f` |
| Pull remote edits from GAS | `clasp pull` |

### Important caveats

- **No local execution**: GAS globals (`SpreadsheetApp`, `UrlFetchApp`, `PropertiesService`, etc.) do not exist outside the Apps Script runtime. You cannot `node` run these files.
- **No ESLint / linter configured**: Use `node --check *.js` for syntax validation. The project has no `.eslintrc` or equivalent.
- **No automated tests**: Testing is done by running the pipeline in the Google Sheet via the `⚾ MLB-BOIZ` menu.
- **`clasp push` requires Google auth**: Run `clasp login` interactively to authenticate. The Cloud VM cannot complete OAuth without user intervention (see blocking action below).
- **Deploy flow**: See `CLAUDE.md` for the full versioning + deploy workflow (version bump → commit → push → rebase → `clasp push -f`).
- **`.clasp.json` at repo root** is the source of truth for the bound script ID; ignore any other copies.
