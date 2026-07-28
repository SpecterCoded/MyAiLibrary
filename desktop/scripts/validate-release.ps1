param(
    [Parameter(Mandatory = $true)]
    [string]$Version,

    [Parameter(Mandatory = $true)]
    [ValidateSet("beta", "stable")]
    [string]$Channel
)

$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$packagePath = Join-Path $repositoryRoot "desktop\package.json"
$changelogPath = Join-Path $repositoryRoot "CHANGELOG.md"
$releaseNotesPath = Join-Path $repositoryRoot "desktop\release-notes\$Version.md"

if ($Channel -eq "beta") {
    if ($Version -notmatch '^\d+\.\d+\.\d+-beta\.\d+$') {
        throw "Beta releases require a version like 0.1.0-beta.1."
    }
} elseif ($Version -notmatch '^\d+\.\d+\.\d+$') {
    throw "Stable releases require a version like 1.0.0."
}

$package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
if ($package.version -ne $Version) {
    throw "Release version $Version does not match desktop/package.json version $($package.version)."
}

if (-not (Test-Path -LiteralPath $changelogPath)) {
    throw "Cumulative CHANGELOG.md is required for every release."
}
$changelog = Get-Content -LiteralPath $changelogPath -Raw
$headingPattern = "(?m)^##\s+\[$([Regex]::Escape($Version))\](?:\s|$)"
if ($changelog -notmatch $headingPattern) {
    throw "CHANGELOG.md does not contain a [$Version] release heading."
}

if (-not (Test-Path -LiteralPath $releaseNotesPath)) {
    throw "Detailed release notes are missing: $releaseNotesPath"
}
if ((Get-Item -LiteralPath $releaseNotesPath).Length -lt 200) {
    throw "Detailed release notes are unexpectedly short: $releaseNotesPath"
}

Write-Host "Validated $Channel release $Version, cumulative changelog, and detailed release notes."
