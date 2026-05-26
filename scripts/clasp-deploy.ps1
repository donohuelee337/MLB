# Deploy MLB-BOIZ Apps Script: bump build, push, create a new Apps Script version.
# Usage (from repo root):
#   pwsh -File scripts/clasp-deploy.ps1
#   pwsh -File scripts/clasp-deploy.ps1 -Message "platform sim authority"
#   pwsh -File scripts/clasp-deploy.ps1 -SkipTag
param(
  [switch]$SkipTag,
  [string]$Message = ''
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$configPath = Join-Path $repoRoot 'Config.js'
if (-not (Test-Path $configPath)) {
  throw "Config.js not found at $configPath"
}

# ── Bump APPS_SCRIPT_BUILD in Config.js ───────────────────────
$content = Get-Content -Path $configPath -Raw -Encoding UTF8
if ($content -notmatch 'const MLB_APPS_SCRIPT_BUILD = (\d+)') {
  throw 'Config.js missing const MLB_APPS_SCRIPT_BUILD = N — add it before deploying.'
}
$nextBuild = [int]$Matches[1] + 1
$content = [regex]::Replace(
  $content,
  'const MLB_APPS_SCRIPT_BUILD = \d+',
  "const MLB_APPS_SCRIPT_BUILD = $nextBuild"
)
Set-Content -Path $configPath -Value $content -Encoding UTF8 -NoNewline
Write-Host "Bumped MLB_APPS_SCRIPT_BUILD -> $nextBuild" -ForegroundColor Green

git add Config.js
git commit -m "chore: bump APPS_SCRIPT_BUILD to $nextBuild for clasp deploy"
if ($LASTEXITCODE -ne 0) {
  throw 'Failed to commit APPS_SCRIPT_BUILD bump.'
}

if (-not $SkipTag) {
  $tag = 'apps-script/pre-push-{0}-b{1}' -f (Get-Date -Format 'yyyyMMdd-HHmmss'), $nextBuild
  git tag $tag
  Write-Host "Created tag: $tag" -ForegroundColor Green
}

# ── Push ──────────────────────────────────────────────────────
Write-Host 'Pushing code to Apps Script...' -ForegroundColor Cyan
clasp push --force
if ($LASTEXITCODE -ne 0) {
  throw "clasp push failed (exit $LASTEXITCODE)."
}

# ── Apps Script version (new version every deploy) ─────────────
$versionDesc = if ($Message) {
  "build $nextBuild — $Message"
} else {
  "build $nextBuild — deploy $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
}
Write-Host "Creating Apps Script version: $versionDesc" -ForegroundColor Cyan
$versionOutput = clasp version $versionDesc 2>&1 | Out-String
Write-Host $versionOutput
if ($LASTEXITCODE -ne 0) {
  throw "clasp version failed (exit $LASTEXITCODE)."
}

$versionNum = ''
if ($versionOutput -match 'Created version (\d+)') {
  $versionNum = $Matches[1]
} elseif ($versionOutput -match '(\d+)') {
  $versionNum = $Matches[1]
}

Write-Host ""
Write-Host "Done. Local build $nextBuild pushed." -ForegroundColor Green
if ($versionNum) {
  Write-Host "Apps Script project version: $versionNum" -ForegroundColor Green
}
Write-Host 'In the Sheet: run "0. Build Config tab" once so APPS_SCRIPT_BUILD shows on ⚙️ Config.' -ForegroundColor Cyan
