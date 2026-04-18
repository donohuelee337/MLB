# Creates the GitHub repo and pushes main (requires: gh auth login)
# Run from repo root:  powershell -ExecutionPolicy Bypass -File .\scripts\Create-GitHubRepo.ps1

$ErrorActionPreference = "Stop"
$gh = "${env:ProgramFiles}\GitHub CLI\gh.exe"
if (-not (Test-Path $gh)) { $gh = "gh" }

& $gh auth status 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Not logged in. Run first:  gh auth login" -ForegroundColor Yellow
  exit 1
}

$owner = "donohuelee337"
$name = "mlb-pitcher-k"
$here = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $here

if (git remote get-url origin 2>$null) {
  Write-Host "Remote 'origin' already exists. Pushing..." -ForegroundColor Cyan
  git push -u origin main
  exit $LASTEXITCODE
}

& $gh repo create "$owner/$name" --public `
  --source=. `
  --remote=origin `
  --description "MLB pitcher strikeouts pipeline (Google Sheets + Apps Script)" `
  --push

Write-Host "Done. Repo: https://github.com/$owner/$name" -ForegroundColor Green
