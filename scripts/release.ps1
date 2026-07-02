# FalloutTerminal release script — the official release pipeline.
#
#   .\scripts\release.ps1 0.3.0
#
# Bumps the version, commits, tags, pushes, builds, publishes the GitHub
# release, and makes it public. Installed copies then see the update prompt.

param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^\d+\.\d+\.\d+$')]
  [string]$Version
)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

# Machine-specific build environment (see memory / README).
Remove-Item Env:NoDefaultCurrentDirectoryInExePath -ErrorAction SilentlyContinue
$env:PYTHON = "C:\Users\sleve\AppData\Local\Programs\Python\Python311\python.exe"
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
$env:GH_TOKEN = & "C:\Program Files\GitHub CLI\gh.exe" auth token

Write-Host "== Bumping to v$Version =="
npm version $Version --no-git-tag-version --allow-same-version | Out-Null
git add package.json package-lock.json
git commit -m "Release v$Version"
git tag -f "v$Version"
git push origin main
git push origin "v$Version"

Write-Host "== Building =="
npm run build

Write-Host "== Packaging + publishing =="
npx electron-builder --win --publish always

Write-Host "== Making release public =="
& "C:\Program Files\GitHub CLI\gh.exe" release edit "v$Version" --repo spezzuti/FalloutTerminal --draft=false

Write-Host "== Done: https://github.com/spezzuti/FalloutTerminal/releases/tag/v$Version =="
