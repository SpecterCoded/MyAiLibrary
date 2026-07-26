$ErrorActionPreference = "Stop"
$ffmpeg = Join-Path $PSScriptRoot "..\vendor\ffmpeg\ffmpeg.exe"
$ffprobe = Join-Path $PSScriptRoot "..\vendor\ffmpeg\ffprobe.exe"
$ffmpegLicense = Join-Path $PSScriptRoot "..\vendor\ffmpeg\LICENSE-FFMPEG.txt"
$backend = Join-Path $PSScriptRoot "..\..\backend\dist\myailibrary-backend\myailibrary-backend.exe"
$ui = Join-Path $PSScriptRoot "..\..\frontend\dist\index.html"
$journalitPackage = Join-Path $PSScriptRoot "..\..\Journalit-Local-1.8.1-Fresh.zip"

foreach ($required in @($ffmpeg, $ffprobe, $ffmpegLicense, $backend, $ui, $journalitPackage)) {
    if (-not (Test-Path -LiteralPath $required)) { throw "Required packaging resource missing: $required" }
}

$journalitEntries = @(tar -tf $journalitPackage)
foreach ($requiredEntry in @(
    "journalit/main.js",
    "journalit/manifest.json",
    "journalit/styles.css",
    "journalit/docs/JOURNALIT_INTEGRATION_USER_GUIDE.md"
)) {
    if ($journalitEntries -notcontains $requiredEntry) {
        throw "Journalit package is missing required entry: $requiredEntry"
    }
}
Write-Host "Desktop packaging resources are present."
