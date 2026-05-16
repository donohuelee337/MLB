# MLB-BOIZ — agent instructions

Google Apps Script + Google Sheets MLB prop pipeline, deployed via `clasp`.

## Versioning & deploy flow (mandatory in auto mode)

Every code change ships as a new `MLB-BOIZ vX.Y.Z` version so any change is a single-commit rollback. Recent history follows this exactly (v0.1.0, v0.1.1, …).

**On every change, in order:**

1. `git log -1 --pretty=%s` → read the latest `MLB-BOIZ vX.Y.Z`, bump the patch (minor for larger features).
2. `git commit -m "MLB-BOIZ vX.Y.Z: <short description>"` — never amend, always a new commit.
3. `git push` to the current `claude/<slug>` branch. **Never push directly to `main`. Never force-push.**
4. `git fetch origin && git rebase origin/main` to absorb whatever sibling agents got merged.
   - If conflicts: resolve them, re-stage, re-commit (same version number), then continue.
5. `clasp push -f` to deploy to the bound GAS project.
   - Clasp CLI: `/c/Users/Garage/AppData/Roaming/npm/clasp`
   - `.clasp.json` at repo root holds the correct scriptId.

**Why the rebase before clasp:** there's only one bound GAS project and `clasp push -f` deploys the entire working tree. Whoever clasps last wins in the Sheet, regardless of what's in git. Step 4 ensures every deploy contains every merged sibling-agent fix instead of silently rolling them back.

## Branch & merge rules

- Each agent works in its own worktree on a `claude/<slug>` branch.
- Push only to your own branch autonomously. **Never push to `main` on your own initiative.**
- **Merging is allowed only when the user explicitly says "merge"** (or equivalent: "ship to main," "promote," etc.). Solo-dev project — no PR review gate needed. Use a fast-forward push of the branch tip to `main`:
  ```
  git fetch origin
  git log --oneline HEAD..origin/main   # MUST be empty (clean fast-forward)
  git push origin <current-branch>:main
  ```
  If `HEAD..origin/main` is non-empty, stop — rebase first, then re-check before pushing.
- Never force-push, hard-reset, or delete branches without explicit user confirmation — those are the only ways to lose another agent's work.

## Manual mode

In manual mode (no `Auto Mode Active` reminder), fall back to asking before commit/push/clasp instead of running the flow automatically. The version-bump format still applies when the user confirms.

## Project facts (verify before relying on)

- GAS scriptId lives in `.clasp.json` at repo root; an older `.clasp.json` copy points at the wrong project — trust the repo-root one.
- Sheet tab convention: row 1 = title, row 3 = headers, row 4+ = data. New tabs should follow this.
- Slate-date cells in the Sheet come back as `Date` objects, not strings — normalize before comparing or passing to APIs.
- GAS `Logger.log` only emits the "MLB injuries" line during pipeline runs; downstream silence ≠ hang location. Instrument before guessing.
- Projection changes: bump a descriptive `MLB_MODEL_VERSIONS` name and run old + new in parallel before retiring old.
