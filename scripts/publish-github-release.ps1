# Publish the current package.json version as a DRAFT GitHub Release on tag v<version>.
# Matches .github/workflows/release.yml. Drafts are not visible to electron-updater until published.
# Run after: npm run dist, or via npm run release -- --publish
# Usage:
#   powershell -File scripts/publish-github-release.ps1 [-OutputDir release-1.2.27] [-Force]
# Requires gh on PATH. GH_TOKEN may be set and is never printed.
# Refuses to replace an existing tag or release unless -Force.

param(
  [string]$OutputDir = 'release',
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not [System.IO.Path]::IsPathRooted($OutputDir)) {
  $OutputDir = Join-Path $root $OutputDir
}

$pkg = Get-Content -Raw package.json | ConvertFrom-Json
$ver = [string]$pkg.version
if (-not $ver) { throw 'package.json version missing' }

$setup = Join-Path $OutputDir "LocalAgents-Studio-$ver-setup.exe"
$blockmap = Join-Path $OutputDir "LocalAgents-Studio-$ver-setup.exe.blockmap"
$portable = Join-Path $OutputDir "LocalAgents-Studio-$ver-portable.exe"
$latest = Join-Path $OutputDir 'latest.yml'

foreach ($f in @($setup, $blockmap, $portable, $latest)) {
  if (-not (Test-Path -LiteralPath $f)) {
    throw "Missing artifact: $f (build into this directory first)"
  }
}

$yml = Get-Content -Raw -LiteralPath $latest
if ($yml -notmatch [regex]::Escape("version: $ver")) {
  throw "latest.yml does not match package version $ver — rebuild"
}

$tag = "v$ver"
$notes = @"
## LocalAgents Studio $ver

### Install / update
- **NSIS setup** (``LocalAgents-Studio-$ver-setup.exe``) — required for in-app updates
- **Portable** (``LocalAgents-Studio-$ver-portable.exe``) — manual replace; no auto-update

``latest.yml`` is included so electron-updater can check this release.

Code signing is a pending decision (PLAT-10). This build is unsigned.

This is a draft release and is not visible to electron-updater until it is published.
"@

$repo = 'HipHopGrinch/LocalAgents-Studio'
$prevEap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
gh release view $tag --repo $repo 1>$null 2>$null
$releaseExists = ($LASTEXITCODE -eq 0)
gh api "repos/$repo/git/ref/tags/$tag" 1>$null 2>$null
$tagExists = ($LASTEXITCODE -eq 0)
$ErrorActionPreference = $prevEap

if (($releaseExists -or $tagExists) -and -not $Force) {
  throw "Tag '$tag' already exists. Re-run with -Force to replace assets. Refusing to clobber."
}

if ($releaseExists) {
  Write-Host "Replacing assets on existing release $tag (-Force)..."
  gh release upload $tag $setup $blockmap $portable $latest --clobber --repo $repo
} else {
  Write-Host "Creating draft release $tag..."
  gh release create $tag --draft --title "LocalAgents Studio $ver" --notes $notes --repo $repo `
    $setup $blockmap $portable $latest
}

Write-Host "Done: https://github.com/$repo/releases/tag/$tag"
gh release view $tag --repo $repo --json assets --jq '.assets[].name'
