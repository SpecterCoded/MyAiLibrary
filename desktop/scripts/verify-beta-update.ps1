param(
    [Parameter(Mandatory = $true)]
    [string]$MetadataPath,

    [Parameter(Mandatory = $true)]
    [string]$InstallerPath,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d+\.\d+\.\d+-beta\.\d+$')]
    [string]$PreviousVersion,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d+\.\d+\.\d+-beta\.\d+$')]
    [string]$ExpectedVersion
)

$ErrorActionPreference = "Stop"
$resolvedMetadata = (Resolve-Path -LiteralPath $MetadataPath -ErrorAction Stop).Path
$resolvedInstaller = (Resolve-Path -LiteralPath $InstallerPath -ErrorAction Stop).Path
$metadata = Get-Content -LiteralPath $resolvedMetadata -Raw
$installer = Get-Item -LiteralPath $resolvedInstaller

function Get-BetaParts {
    param([string]$Version)
    if ($Version -notmatch '^(\d+)\.(\d+)\.(\d+)-beta\.(\d+)$') {
        throw "Invalid beta version: $Version"
    }
    return @(
        [int]$Matches[1],
        [int]$Matches[2],
        [int]$Matches[3],
        [int]$Matches[4]
    )
}

function Compare-BetaVersion {
    param([string]$Left, [string]$Right)
    $leftParts = Get-BetaParts $Left
    $rightParts = Get-BetaParts $Right
    for ($index = 0; $index -lt $leftParts.Count; $index++) {
        if ($leftParts[$index] -lt $rightParts[$index]) { return -1 }
        if ($leftParts[$index] -gt $rightParts[$index]) { return 1 }
    }
    return 0
}

if ((Compare-BetaVersion $PreviousVersion $ExpectedVersion) -ge 0) {
    throw "Expected update version $ExpectedVersion must be newer than $PreviousVersion."
}

$escapedVersion = [Regex]::Escape($ExpectedVersion)
if ($metadata -notmatch "(?m)^version:\s*$escapedVersion\s*$") {
    throw "beta.yml does not declare version $ExpectedVersion."
}
if ($metadata -notmatch "(?m)^path:\s*(?<path>[^\r\n]+)\s*$") {
    throw "beta.yml does not contain an installer path."
}
$metadataInstallerName = $Matches["path"].Trim().Trim("'`"")
if ($metadataInstallerName -ne $installer.Name) {
    throw "beta.yml points to '$metadataInstallerName' instead of '$($installer.Name)'."
}
if ($metadata -notmatch "(?m)^sha512:\s*(?<sha>[A-Za-z0-9+/=]+)\s*$") {
    throw "beta.yml does not contain a SHA-512 digest."
}
$metadataSha512 = $Matches["sha"]
$sha512 = [Security.Cryptography.SHA512]::Create()
try {
    $stream = [IO.File]::OpenRead($installer.FullName)
    try {
        $actualSha512 = [Convert]::ToBase64String($sha512.ComputeHash($stream))
    } finally {
        $stream.Dispose()
    }
} finally {
    $sha512.Dispose()
}
if ($actualSha512 -ne $metadataSha512) {
    throw "beta.yml SHA-512 digest does not match the installer."
}
if ($metadata -notmatch "(?m)^\s+size:\s*(?<size>\d+)\s*$") {
    throw "beta.yml does not contain an installer size."
}
if ([int64]$Matches["size"] -ne $installer.Length) {
    throw "beta.yml installer size does not match the generated installer."
}

$package = Get-Content (Join-Path $PSScriptRoot "..\package.json") -Raw | ConvertFrom-Json
if ($package.updatesTestingEnabled -ne $true) {
    throw "The packaged beta policy does not enable the Testing channel."
}
if ($package.updatesEnabled -ne $false -or $package.updatesTestMode -ne $false) {
    throw "Unsigned Beta must not enable Stable updates or local engineering update mode."
}

Write-Host "Beta update metadata, installer integrity, Testing policy, and $PreviousVersion -> $ExpectedVersion ordering passed."
