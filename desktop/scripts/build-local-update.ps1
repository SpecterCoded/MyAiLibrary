param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.-]+)?$')]
    [string]$Version,

    [switch]$SkipApplicationBuild
)

$ErrorActionPreference = 'Stop'
$desktopRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$outputDirectory = Join-Path $desktopRoot "release-local\$Version"
$releaseNotesPath = Join-Path $desktopRoot "release-notes\$Version.md"

if (-not (Test-Path -LiteralPath $releaseNotesPath -PathType Leaf)) {
    throw "Missing versioned release notes: $releaseNotesPath"
}

Push-Location $desktopRoot
try {
    if (-not $SkipApplicationBuild) {
        & npm run build
        if ($LASTEXITCODE -ne 0) { throw 'Application build failed.' }
    }

    & npm run verify:resources
    if ($LASTEXITCODE -ne 0) { throw 'Resource verification failed.' }

    New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
    & npm exec electron-builder -- --win nsis --x64 --publish never `
        "--config.directories.output=$outputDirectory" `
        "--config.extraMetadata.version=$Version" `
        '--config.extraMetadata.updatesTestMode=true' `
        "--config.releaseInfo.releaseNotesFile=$releaseNotesPath"
    if ($LASTEXITCODE -ne 0) { throw "Engineering installer build $Version failed." }

    $channelMetadata = Get-ChildItem -LiteralPath $outputDirectory -Filter '*.yml' |
        Where-Object { $_.Name -in @('stable.yml', 'latest.yml') } |
        Select-Object -First 1
    if (-not $channelMetadata) {
        throw 'electron-builder did not generate stable.yml or latest.yml update metadata.'
    }
    if ($channelMetadata.Name -ne 'stable.yml') {
        Copy-Item -LiteralPath $channelMetadata.FullName -Destination (Join-Path $outputDirectory 'stable.yml') -Force
    }

    Write-Host "Engineering update package $Version is ready:"
    Write-Host $outputDirectory
} finally {
    Pop-Location
}
