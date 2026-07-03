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

# NOT 'Stop': PowerShell 5.1 turns harmless native stderr (e.g. git's CRLF
# warnings) into terminating errors. We check exit codes explicitly instead.
$ErrorActionPreference = 'Continue'
Set-Location (Split-Path $PSScriptRoot -Parent)

function Assert-Ok([string]$Step) {
  if ($LASTEXITCODE -ne 0) {
    Write-Host "FAILED: $Step (exit $LASTEXITCODE)" -ForegroundColor Red
    exit 1
  }
}

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
git push origin main; Assert-Ok "git push main"
git push origin -f "v$Version"; Assert-Ok "git push tag"

Write-Host "== Building =="
npm run build; Assert-Ok "build"

Write-Host "== Packaging + publishing =="
npx electron-builder --win --publish always; Assert-Ok "package/publish"

Write-Host "== Making release public =="
& "C:\Program Files\GitHub CLI\gh.exe" release edit "v$Version" --repo spezzuti/FalloutTerminal --draft=false
Assert-Ok "undraft"

Write-Host "== Done: https://github.com/spezzuti/FalloutTerminal/releases/tag/v$Version =="
