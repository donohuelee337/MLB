# Check-Orphan-Code.ps1
#
# Scans every sibling Claude worktree under .claude/worktrees/* and reports
# any .js file that exists in a worktree but is NOT tracked on origin/main.
# Catches the case where an agent has built real pipeline code in its
# working tree but never committed + merged it — meaning if that worktree
# gets wiped, the code is gone, even though it may already be live in GAS
# via clasp push.
#
# Run from the repo root:
#   pwsh scripts/Check-Orphan-Code.ps1
#
# Read-only — no git mutations, no file edits.

$ErrorActionPreference = 'Stop'

# `--show-toplevel` returns the *worktree's* path inside a worktree. The main
# checkout owns `.claude/worktrees`, so resolve to it via the shared git dir.
$gitCommonDir = git rev-parse --git-common-dir 2>$null
if (-not $gitCommonDir) {
    Write-Error "Not inside a git repository."
    exit 2
}
$gitCommonDir = (Resolve-Path $gitCommonDir).Path
$repoRoot = Split-Path -Parent $gitCommonDir
Write-Host "Main repo root: $repoRoot"

Write-Host "Fetching origin..."
git fetch origin --quiet

$mainFiles = @{}
foreach ($f in (git ls-tree -r --name-only origin/main)) {
    if ($f -match '\.js$') { $mainFiles[$f] = $true }
}
Write-Host ("origin/main tracks {0} .js files" -f $mainFiles.Count)
Write-Host ""

$worktreeRoot = Join-Path $repoRoot '.claude/worktrees'
if (-not (Test-Path $worktreeRoot)) {
    Write-Host "No .claude/worktrees directory — nothing to scan."
    exit 0
}

$report = @()
$totalOrphans = 0

foreach ($wt in Get-ChildItem -Directory $worktreeRoot) {
    $wtJsFiles = Get-ChildItem -File $wt.FullName -Filter *.js -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty Name
    $orphans = $wtJsFiles | Where-Object { -not $mainFiles.ContainsKey($_) }

    if ($orphans -and $orphans.Count -gt 0) {
        $totalOrphans += $orphans.Count
        $report += [pscustomobject]@{
            Worktree    = $wt.Name
            OrphanCount = $orphans.Count
            Files       = ($orphans -join ', ')
        }
    }
}

if ($report.Count -eq 0) {
    Write-Host "OK — every .js file in every worktree is tracked on origin/main."
    exit 0
}

Write-Host ("WARNING — {0} orphan .js file(s) across {1} worktree(s):" -f $totalOrphans, $report.Count)
Write-Host ""
$report | Format-Table -AutoSize -Wrap

Write-Host ""
Write-Host "These files exist locally but not in main. If the worktree is"
Write-Host "deleted, the code is lost — even if it has already been clasped"
Write-Host "to the live GAS project. Commit + merge from each worktree."
exit 1
